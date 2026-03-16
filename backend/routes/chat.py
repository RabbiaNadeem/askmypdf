from fastapi import APIRouter, HTTPException
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
import os
from typing import Optional

from langchain_huggingface import HuggingFaceEmbeddings
from langchain_chroma import Chroma
from langchain_groq import ChatGroq
from langchain_core.prompts import ChatPromptTemplate

from config import settings


router = APIRouter()

_embedding_function: Optional[HuggingFaceEmbeddings] = None
_db: Optional[Chroma] = None
_llm: Optional[ChatGroq] = None


def get_embedding_function() -> HuggingFaceEmbeddings:
    global _embedding_function
    if _embedding_function is None:
        # Must match ingest
        _embedding_function = HuggingFaceEmbeddings(model_name="all-MiniLM-L6-v2")
    return _embedding_function


def get_db() -> Chroma:
    global _db
    if _db is None:
        os.makedirs(settings.CHROMA_PATH, exist_ok=True)
        _db = Chroma(
            persist_directory=settings.CHROMA_PATH,
            embedding_function=get_embedding_function(),
            collection_name=settings.CHROMA_COLLECTION,
        )
    return _db


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

@router.post("/chat")
async def chat(request: ChatRequest):
    """
    Chat with the uploaded PDFs (Streaming Response).
    """
    if not request.question:
        raise HTTPException(status_code=400, detail="Question cannot be empty")

    # 1. Retrieval
    # k=4 chunks
    results = get_db().similarity_search_with_score(request.question, k=4)
    
    # 2. Context Construction
    if not results:
        context_text = ""
    else:
        context_text = "\n\n---\n\n".join([doc.page_content for doc, _score in results])
    
    # 3. Prompting
    prompt_template = ChatPromptTemplate.from_template("""
    Answer the question based ONLY on the following context. 
    If you cannot answer the question based on the context, say "I don't know based on the provided documents."
    
    Context:
    {context}
    
    Question: 
    {question}
    """)
    
    prompt = prompt_template.format(context=context_text, question=request.question)
    
    # 4. Generator function for streaming
    async def generate():
        # Stream the answer
        async for chunk in get_llm().astream(prompt):
            yield chunk.content
            
        # Append sources at the end
        if results:
            yield "\n\n**Sources:**\n"
            for doc, score in results:
                source_name = os.path.basename(doc.metadata.get("source", "unknown"))
                page_num = doc.metadata.get("page", 0) + 1
                yield f"- {source_name} (Page {page_num})\n"

    return StreamingResponse(generate(), media_type="text/plain")

