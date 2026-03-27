from __future__ import annotations

import json
import os
import re
from typing import Any, Optional, Union

from fastapi import APIRouter, HTTPException
from fastapi.responses import StreamingResponse
from langchain_core.prompts import ChatPromptTemplate
from langchain_groq import ChatGroq
from pydantic import BaseModel

from config import settings
from services.retrieval import similarity_search_with_score


router = APIRouter()

_llm: Optional[ChatGroq] = None


def get_llm() -> ChatGroq:
    global _llm
    if _llm is None:
        api_key = os.getenv("GROQ_API_KEY") or settings.GROQ_API_KEY
        if not api_key:
            raise HTTPException(
                status_code=500,
                detail="GROQ_API_KEY is not set. Set it in your environment or .env for the backend.",
            )
        _llm = ChatGroq(
            temperature=0,
            model_name=os.getenv("GROQ_MODEL") or settings.GROQ_MODEL,
            api_key=api_key,
        )
    return _llm


class ChatRequest(BaseModel):
    question: str
    # Back-compat: client used to send a single collection string.
    # Multi-doc: allow a list of collection ids.
    collection: Optional[Union[str, list[str]]] = None
    # Alias field (some clients may send `collections`).
    collections: Optional[list[str]] = None
    # Optional hint for the UI's currently active document.
    activeCollection: Optional[str] = None


def _normalize_collections(request: ChatRequest) -> list[str]:
    cols: list[str] = []

    active = (request.activeCollection or "").strip() if isinstance(request.activeCollection, str) else ""

    if isinstance(request.collections, list):
        cols.extend([c for c in request.collections if isinstance(c, str)])

    if isinstance(request.collection, list):
        cols.extend([c for c in request.collection if isinstance(c, str)])
    elif isinstance(request.collection, str):
        cols.append(request.collection)

    # sanitize + de-dupe while preserving order
    out: list[str] = []
    seen: set[str] = set()
    for c in cols:
        c = (c or "").strip()
        if not c or c in seen:
            continue
        seen.add(c)
        out.append(c)

    if active:
        if active in out:
            out = [active] + [c for c in out if c != active]
        else:
            out = [active] + out

    max_cols = int(getattr(settings, "MAX_MULTI_COLLECTIONS", 5) or 5)
    if max_cols < 1:
        max_cols = 1
    return out[:max_cols]


def _sse(payload: dict[str, Any]) -> str:
    return f"data: {json.dumps(payload, ensure_ascii=False)}\n\n"


def _clamp01(value: float) -> float:
    try:
        v = float(value)
    except Exception:
        return 0.0
    if v < 0:
        return 0.0
    if v > 1:
        return 1.0
    return v


def _make_citations(results: list[tuple[Any, float]]) -> list[dict[str, Any]]:
    citations: list[dict[str, Any]] = []
    for idx, (doc, score) in enumerate(results):
        meta = getattr(doc, "metadata", {}) or {}
        source_name = os.path.basename(str(meta.get("source") or meta.get("filename") or "unknown"))
        page_num = int(meta.get("page", 0)) + 1
        content = getattr(doc, "page_content", "") or ""
        snippet = content.strip().replace("\n", " ")
        if len(snippet) > 320:
            snippet = snippet[:320].rstrip() + "…"

        citations.append(
            {
                "id": f"c{idx + 1}",
                "filename": source_name,
                "page": page_num,
                "score": _clamp01(score),
                "snippet": snippet,
            }
        )
    return citations


def _page_key(doc: Any) -> tuple[str, int]:
    meta = getattr(doc, "metadata", {}) or {}
    source_name = os.path.basename(str(meta.get("source") or meta.get("filename") or "unknown"))
    page_num = int(meta.get("page", 0)) + 1
    return (source_name.lower(), page_num)


def _dedupe_best_chunk_per_page(results: list[tuple[Any, float]]) -> list[tuple[Any, float]]:
    """Keep only the best-scoring chunk per (filename,page)."""
    best: dict[tuple[str, int], tuple[Any, float]] = {}
    for doc, score in results:
        key = _page_key(doc)
        if key not in best or float(score) > float(best[key][1]):
            best[key] = (doc, score)
    deduped = list(best.values())
    deduped.sort(key=lambda x: float(x[1]), reverse=True)
    return deduped


_STOPWORDS = {
    "a",
    "an",
    "and",
    "are",
    "as",
    "at",
    "be",
    "by",
    "can",
    "could",
    "do",
    "does",
    "for",
    "from",
    "how",
    "i",
    "in",
    "is",
    "it",
    "me",
    "mention",
    "of",
    "on",
    "or",
    "quote",
    "the",
    "this",
    "to",
    "what",
    "where",
    "which",
    "why",
    "with",
    "you",
    "your",

    # Domain-generic terms that otherwise cause over-matching.
    "learning",
    "machine",
    "model",
    "models",
    "pdf",
    "document",
    "documents",
    "page",
    "pages",
    "type",
    "types",
    "definition",
    "define",
    "explain",
}


def _extract_keywords(question: str) -> list[str]:
    """Extract simple topic keywords from the user's question.

    Used only to decide whether retrieved context actually contains the topic;
    if not, we suppress citations to avoid misleading references.
    """
    q = (question or "").strip().lower()
    if not q:
        return []

    # Preserve common phrases that are strong signals.
    strong_phrases = [
        "gradient descent",
        "supervised learning",
        "unsupervised learning",
        "reinforcement learning",
    ]
    phrases = [p for p in strong_phrases if p in q]

    words = re.findall(r"[a-z0-9]+", q)
    keywords = [w for w in words if len(w) >= 4 and w not in _STOPWORDS]

    # De-dupe while preserving order.
    seen: set[str] = set()
    out: list[str] = []
    for term in phrases + keywords:
        if term in seen:
            continue
        seen.add(term)
        out.append(term)
    return out


def _matches_keywords(text: str, keywords: list[str]) -> bool:
    if not keywords:
        return True
    hay = (text or "").lower()
    # If we have a phrase like "gradient descent", require it.
    phrases = [k for k in keywords if " " in k]
    if phrases:
        # Prefer phrase match, but be resilient to PDF line breaks/hyphenation.
        for phrase in phrases:
            if phrase in hay:
                return True
            phrase_words = re.findall(r"[a-z0-9]+", phrase.lower())
            if phrase_words:
                pattern = r"\\b" + r"\\W+".join(map(re.escape, phrase_words)) + r"\\b"
                if re.search(pattern, text or "", flags=re.IGNORECASE):
                    return True

        # If we can't find the contiguous phrase, fall back to keyword hits.
        # This avoids suppressing relevant chunks where the phrase was split.
        non_phrase = [k for k in keywords if " " not in k]
        hits = sum(1 for k in non_phrase if k in hay)
        return hits >= min(2, len(non_phrase)) if non_phrase else False
    # Otherwise, require at least one keyword hit.
    return any(k in hay for k in keywords)


def _format_context(results: list[tuple[Any, float]]) -> str:
    """Format context with explicit filename + page labels so the model can cite page numbers."""
    parts: list[str] = []
    for doc, _score in results:
        meta = getattr(doc, "metadata", {}) or {}
        source_name = os.path.basename(str(meta.get("source") or meta.get("filename") or "unknown"))
        page_num = int(meta.get("page", 0)) + 1
        content = getattr(doc, "page_content", "") or ""
        content = content.strip()
        if not content:
            continue
        parts.append(f"[{source_name} — page {page_num}]\n{content}")
    return "\n\n---\n\n".join(parts)


@router.post("/chat")
async def chat(request: ChatRequest):
    """Stream answer + citations via AI SDK UI-message JSON SSE."""
    question = (request.question or "").strip()
    if not question:
        raise HTTPException(status_code=400, detail="Question cannot be empty")

    collections = _normalize_collections(request)
    if not collections:
        raise HTTPException(
            status_code=400,
            detail="Missing collection(s). Upload a PDF first and pass its collection id(s).",
        )

    top_k = int(getattr(settings, "RAG_TOP_K", 6) or 6)

    raw_results: list[tuple[Any, float]] = []
    failures: list[str] = []
    for collection in collections:
        try:
            raw_results.extend(
                list(
                    similarity_search_with_score(
                        question,
                        collection_name=collection,
                        k=top_k,
                    )
                )
            )
        except Exception:
            failures.append(collection)
            continue

    if not raw_results:
        # If all collections failed, surface an actionable error.
        if failures and len(failures) == len(collections):
            raise HTTPException(
                status_code=502,
                detail="Failed to query vector store for the provided collection(s).",
            )

        # Otherwise proceed with empty context (the prompt handles this).

    min_score = float(getattr(settings, "RAG_MIN_SCORE", 0.55) or 0.55)

    # Basic score cutoff
    scored_results = [(doc, score) for (doc, score) in raw_results if float(score) >= min_score]

    # Topic gating: only keep chunks that actually mention the topic keywords.
    # This prevents "fallback" answers from still showing unrelated citations.
    keywords = _extract_keywords(question)
    relevant_results = [
        (doc, score)
        for (doc, score) in scored_results
        if _matches_keywords(getattr(doc, "page_content", "") or "", keywords)
    ]

    results = relevant_results

    # Context for the LLM should not be limited by how many citations we *display*.
    context_max = int(getattr(settings, "CONTEXT_MAX_CHUNKS", 6) or 6)
    context_src = _dedupe_best_chunk_per_page(results)[: max(0, context_max)]
    context_text = _format_context(context_src) if context_src else ""

    # If nothing clears the threshold, treat context as irrelevant.
    citations_min_score = float(getattr(settings, "CITATIONS_MIN_SCORE", min_score) or min_score)
    citations_max = int(getattr(settings, "CITATIONS_MAX", 4) or 4)
    citations_src = [(doc, score) for (doc, score) in results if float(score) >= citations_min_score]
    citations_src = _dedupe_best_chunk_per_page(citations_src)
    citations_src = citations_src[: max(0, citations_max)]

    citations = _make_citations(citations_src) if citations_src else []

    prompt_template = ChatPromptTemplate.from_template(
        """
You are "Ask My PDFs" — a helpful RAG assistant.

Strict rules:
1. If the question can be answered from the provided document context → Answer using ONLY the context and ALWAYS cite the exact page number(s).
2. If the answer is NOT in the document context (or context is empty/irrelevant) → Start your answer with: "I don't have that specific information in the uploaded documents, but in general: " and give a short, accurate explanation.
3. For meta questions (like "what do you do?") → Answer normally.
4. Never make up page numbers or pretend something is in the PDF.

Be honest, concise and helpful.

Important:
- If the Context is empty, you MUST follow rule 2 and you MUST NOT cite pages.
- If the Context is not empty, you MUST answer ONLY from it and cite page numbers like (p.2).
- If the Context mentions the topic but does not define it, say so explicitly (still citing the pages where it is mentioned).

Context:
{context}

Question:
{question}
""".strip()
    )
    prompt = prompt_template.format(context=context_text, question=question)

    async def generate():
        # Envelope
        yield _sse({"type": "start"})
        yield _sse({"type": "start-step"})
        yield _sse({"type": "text-start", "id": "text-1"})

        # Citations data part
        yield _sse({"type": "data-citations", "id": "citations-1", "data": citations})

        # Answer text streaming
        async for chunk in get_llm().astream(prompt):
            text = getattr(chunk, "content", None)
            if not text:
                continue
            yield _sse({"type": "text-delta", "id": "text-1", "delta": text})

        yield _sse({"type": "text-end", "id": "text-1"})
        yield _sse({"type": "finish-step"})
        yield _sse({"type": "finish", "finishReason": "stop"})

    return StreamingResponse(generate(), media_type="text/event-stream")

