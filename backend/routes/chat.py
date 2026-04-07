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
from supabase import create_client

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
    # Multi-doc: allow a list of collections.
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

    # Heuristic: short questions like "types of ml" lose signal because "ml" is short
    # and "types" is often a stopword. Add strong ML-type phrases so retrieval prefers
    # the section that actually enumerates them.
    wants_types = any(w in {"type", "types", "kind", "kinds", "category", "categories"} for w in words)
    mentions_ml = (
        "machine learning" in q
        or ("machine" in words and "learning" in words)
        or ("ml" in words)
    )
    if wants_types and mentions_ml:
        for p in ["supervised learning", "unsupervised learning", "reinforcement learning"]:
            if p not in phrases:
                phrases.append(p)
        # Also add single-token variants for resilience.
        keywords.extend(["supervised", "unsupervised", "reinforcement"])

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


def _normalize_question_for_search(question: str) -> str:
    """Normalize the user's question for vector search.

    This improves retrieval for short queries like "types of ML" by expanding
    common abbreviations and adding disambiguating terms.
    """
    q = (question or "").strip()
    if not q:
        return ""

    # Expand ML abbreviation when it appears as a token.
    # e.g. "types of ML" -> "types of machine learning"
    q_norm = re.sub(r"\bml\b", "machine learning", q, flags=re.IGNORECASE)

    # If the user is asking for types/categories of ML, add strong terms that
    # help retrieval find the enumerated section.
    words = re.findall(r"[a-z0-9]+", q_norm.lower())
    wants_types = any(w in {"type", "types", "kind", "kinds", "category", "categories"} for w in words)
    mentions_ml = (
        "machine learning" in q_norm.lower()
        or ("machine" in words and "learning" in words)
    )
    if wants_types and mentions_ml:
        q_norm = q_norm + " supervised unsupervised reinforcement"

    return q_norm


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

    base_k = int(getattr(settings, "RAG_TOP_K", 6) or 6)
    search_query = _normalize_question_for_search(question)

    # For multi-collection queries, retrieve from each separately to ensure fair representation
    raw_results: list[tuple[Any, float]] = []
    failures: list[str] = []
    
    if len(collections) > 1:
        # Interleave results from each collection to balance representation
        per_collection_results: dict[str, list[tuple[Any, float]]] = {}
        for collection in collections:
            try:
                per_collection_results[collection] = list(
                    similarity_search_with_score(
                        search_query,
                        collection_name=collection,
                        k=base_k,
                    )
                )
            except Exception:
                failures.append(collection)
                per_collection_results[collection] = []
        
        # Interleave: take one from each collection in round-robin fashion
        max_results = max(len(v) for v in per_collection_results.values()) if per_collection_results else 0
        for idx in range(max_results):
            for collection in collections:
                if idx < len(per_collection_results.get(collection, [])):
                    raw_results.append(per_collection_results[collection][idx])
    else:
        # Single collection: retrieve normally
        try:
            raw_results.extend(
                list(
                    similarity_search_with_score(
                        search_query,
                        collection_name=collections[0],
                        k=base_k,
                    )
                )
            )
        except Exception:
            failures.append(collections[0])

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
    # For multi-PDF queries, apply keyword filtering only when we have meaningful keywords;
    # otherwise fall back to scored results to avoid accidentally dropping a whole PDF.
    keywords = _extract_keywords(question)
    if len(collections) > 1 and not keywords:
        relevant_results = scored_results
    else:
        relevant_results = [
            (doc, score)
            for (doc, score) in scored_results
            if _matches_keywords(getattr(doc, "page_content", "") or "", keywords)
        ]

    results = relevant_results

    # Context for the LLM should not be limited by how many citations we *display*.
    # Don't deduplicate by page for context — we want all relevant chunks.
    # For multi-collection queries, allow more context chunks to ensure all PDFs contribute.
    base_context_max = int(getattr(settings, "CONTEXT_MAX_CHUNKS", 6) or 6)
    context_max = base_context_max * len(collections) if len(collections) > 1 else base_context_max
    context_src = results[: max(0, context_max)]
    context_text = _format_context(context_src) if context_src else ""

    # If nothing clears the threshold, treat context as irrelevant.
    # IMPORTANT: citations must be drawn from the SAME chunks we gave the LLM as context,
    # otherwise the UI can show a reference from the wrong PDF.
    citations_min_score = float(getattr(settings, "CITATIONS_MIN_SCORE", min_score) or min_score)
    citations_max = int(getattr(settings, "CITATIONS_MAX", 4) or 4)

    # Citations are user-facing references. Be stricter than retrieval/context so we don't
    # show misleading references from weak matches (e.g. 50% similarity).
    citations_min_score = max(citations_min_score, 0.70)

    citations_src_all = [(doc, score) for (doc, score) in context_src if float(score) >= citations_min_score]

    if len(collections) > 1:
        # Balance citations across sources (PDFs) but ONLY from context chunks.
        by_source: dict[str, list[tuple[Any, float]]] = {}
        for doc, score in citations_src_all:
            meta = getattr(doc, "metadata", {}) or {}
            source_name = os.path.basename(str(meta.get("source") or meta.get("filename") or "unknown"))
            by_source.setdefault(source_name, []).append((doc, score))

        # Pick best from each source first (stable order based on collections preference).
        # collections are already ordered with activeCollection first.
        preferred_sources: list[str] = []
        for doc, _score in context_src:
            meta = getattr(doc, "metadata", {}) or {}
            source_name = os.path.basename(str(meta.get("source") or meta.get("filename") or "unknown"))
            if source_name not in preferred_sources:
                preferred_sources.append(source_name)

        balanced: list[tuple[Any, float]] = []
        for source_name in preferred_sources:
            chunks = by_source.get(source_name) or []
            if not chunks:
                continue
            chunks.sort(key=lambda x: float(x[1]), reverse=True)
            balanced.append(chunks[0])
            if len(balanced) >= citations_max:
                break

        # Fill remaining slots with next-best chunks overall.
        remaining = []
        chosen_ids = {id(doc) for (doc, _s) in balanced}
        for doc, score in citations_src_all:
            if id(doc) in chosen_ids:
                continue
            remaining.append((doc, score))
        remaining.sort(key=lambda x: float(x[1]), reverse=True)
        balanced.extend(remaining[: max(0, citations_max - len(balanced))])

        citations_src = balanced[: max(0, citations_max)]
    else:
        citations_src = _dedupe_best_chunk_per_page(citations_src_all)
        citations_src = citations_src[: max(0, citations_max)]

    citations = _make_citations(citations_src) if citations_src else []

    prompt_template = ChatPromptTemplate.from_template(
        """
You are "Ask My PDFs", an intelligent and honest RAG assistant specialized in answering questions from uploaded PDF documents.

### Strict Instructions:

1. **When the answer is in the context**:
   - Answer **exclusively** using the provided context.
   - Always cite the exact page number(s) in the format `(p. X)` or `(pp. X-Y)`.
   - Be precise and faithful to the document.
   - write definitions in quotation marks and cite the page number, e.g. "Supervised learning is defined as '...' (p. 5)".
   - If the context contains multiple relevant sections, you can cite multiple pages, e.g. "(pp. 5, 12, 20)".
   - write list and types in bullet points and cite the page number, e.g.:
     - Supervised learning (p. 5)

2. **When the answer is NOT in the context** (or context is empty/irrelevant):
   - Start your response with: **"There is no specific information regarding this in the uploaded documents, but in general: "**
   - Then provide a short, accurate, and helpful general explanation from next line.
   - Do **not** cite any pages.

3. **For meta or general questions** (e.g., "What do you do?", "Who are you?"):
   - Answer normally and naturally without forcing document context.

4. **Never hallucinate**:
   - Do not make up information, page numbers, or pretend content exists in the PDF.
   - If the context mentions the topic but doesn't provide enough detail, explicitly say so.

### Important Guidelines:
- Be concise, professional, and user-friendly.
- If multiple relevant pages exist, cite the most important ones.
- Maintain a helpful and transparent tone at all times.

Context:
{context}

Question:
{question}
""".strip()
    )
    prompt = prompt_template.format(context=context_text, question=question)

    async def generate():
        url = getattr(settings, "SUPABASE_URL", "") or os.getenv("SUPABASE_URL", "")
        key = getattr(settings, "SUPABASE_ANON_KEY", "") or os.getenv("SUPABASE_ANON_KEY", "")
        supabase = None
        if url and key:
            try:
                supabase = create_client(url, key)
            except Exception:
                pass
                
        # Envelope
        yield _sse({"type": "start"})
        yield _sse({"type": "start-step"})
        yield _sse({"type": "text-start", "id": "text-1"})

        # Citations data part
        yield _sse({"type": "data-citations", "id": "citations-1", "data": citations})

        full_answer = ""
        # Answer text streaming
        async for chunk in get_llm().astream(prompt):
            text_chunk = getattr(chunk, "content", None)
            if not text_chunk:
                continue
            full_answer += text_chunk
            yield _sse({"type": "text-delta", "id": "text-1", "delta": text_chunk})

        yield _sse({"type": "text-end", "id": "text-1"})
        yield _sse({"type": "finish-step"})
        yield _sse({"type": "finish", "finishReason": "stop"})

        # Save messages to db
        if supabase:
            try:
                session_id = request.session_id or "default"
                supabase.table("messages").insert([
                    {"session_id": session_id, "role": "user", "content": question},
                    {"session_id": session_id, "role": "assistant", "content": full_answer}
                ]).execute()
            except Exception as e:
                print(f"Error saving to generic messages table: {e}")
        


        

    return StreamingResponse(generate(), media_type="text/event-stream")



@router.get("/chat/{session_id}")
async def get_chat_history(session_id: str):
    url = getattr(settings, "SUPABASE_URL", "") or os.getenv("SUPABASE_URL", "")
    key = getattr(settings, "SUPABASE_ANON_KEY", "") or os.getenv("SUPABASE_ANON_KEY", "")
    if not url or not key:
        return {"messages": []}
    
    try:
        supabase = create_client(url, key)
        res = supabase.table("messages").select("id", "role", "content", "created_at").eq("session_id", session_id).order("created_at").execute()
        
        formatted_messages = []
        for row in (res.data or []):
            formatted_messages.append({
                "id": str(row["id"]),
                "role": row["role"],
                "content": row["content"]
            })
            
        return {"messages": formatted_messages}
    except Exception as e:
        print(f"Error fetching history: {e}")
        return {"messages": []}

