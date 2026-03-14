from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
import os
from langchain_huggingface import HuggingFaceEmbeddings
from langchain_chroma import Chroma
from langchain_groq import ChatGroq
from langchain_core.prompts import ChatPromptTemplate


router = APIRouter()

CHROMA_PATH = "chroma_db"
COLLECTION_NAME = "local_collection"

# 1. Initialize Embeddings (Must match ingest)
embedding_function = HuggingFaceEmbeddings(model_name="all-MiniLM-L6-v2")

# 2. Initialize Vector Store
# Note: We rely on the persistence directory existing. 
# If it doesn't exist, this might create an empty one or throw a warning.
db = Chroma(
    persist_directory=CHROMA_PATH,
    embedding_function=embedding_function,
    collection_name=COLLECTION_NAME
)

# 3. Initialize LLM
# Using environment variable for model, defaulting to a solid Llama 3 option supported by Groq
llm = ChatGroq(
    temperature=0,
    model_name=os.getenv("GROQ_MODEL", "llama3-70b-8192"),
    api_key=os.getenv("GROQ_API_KEY")
)

class ChatRequest(BaseModel):
    question: str

@router.post("/chat")
async def chat(request: ChatRequest):
    """
    Chat with the uploaded PDFs.
    """
    if not request.question:
        raise HTTPException(status_code=400, detail="Question cannot be empty")

    # 1. Retrieval
    # k=4 chunks
    results = db.similarity_search_with_score(request.question, k=4)
    
    if not results:
        return {"answer": "I couldn't find any relevant information in the uploaded documents.", "sources": []}

    # 2. Context Construction
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
    
    # 4. Generation
    try:
        response = llm.invoke(prompt)
        answer_text = response.content
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"LLM generation failed: {str(e)}")
    
    # 5. Source Formatting
    sources = []
    for doc, score in results:
        sources.append({
            "source": os.path.basename(doc.metadata.get("source", "unknown")),
            "page": doc.metadata.get("page", 0) + 1, # +1 for human readable 1-based indexing
            "score": float(score) 
        })

    return {
        "answer": answer_text,
        "sources": sources
    }
