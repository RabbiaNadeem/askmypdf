import os
from langchain_community.document_loaders import PyMuPDFLoader
from langchain_text_splitters import RecursiveCharacterTextSplitter
from langchain_qdrant import QdrantVectorStore, RetrievalMode

from config import settings
from services.retrieval import get_embeddings, get_sparse_embeddings, make_collection_name


def _normalize_chunk_text(value) -> str:
    if value is None:
        return ""
    if isinstance(value, str):
        return value
    if isinstance(value, (bytes, bytearray, memoryview)):
        try:
            return bytes(value).decode("utf-8", errors="ignore")
        except Exception:
            return ""
    # Some loaders can produce non-string values; be defensive.
    try:
        return str(value)
    except Exception:
        return ""

def ingest_pdf(file_path: str, *, doc_id: str | None = None):
    """
    Ingests a PDF file into Qdrant.
    Collections are scoped per document.
    Returns: (chunk_count, collection_name)
    """

    # 1. Load PDF
    if not os.path.exists(file_path):
        raise FileNotFoundError(f"File not found: {file_path}")
        
    loader = PyMuPDFLoader(file_path)
    documents = loader.load()
    
    if not documents:
        filename = os.path.basename(file_path)
        return 0, make_collection_name(filename, doc_id=doc_id)
    
    # 2. Split Text (RecursiveCharacterTextSplitter)
    text_splitter = RecursiveCharacterTextSplitter(
        chunk_size=512,
        chunk_overlap=128,
        length_function=len,
        add_start_index=True,
    )
    chunks = text_splitter.split_documents(documents)
    
    if not chunks:
        filename = os.path.basename(file_path)
        return 0, make_collection_name(filename, doc_id=doc_id)

    # 3. Qdrant collection per document
    filename = os.path.basename(file_path)
    collection_name = make_collection_name(filename, doc_id=doc_id)

    # 4. Store in Qdrant
    # NOTE: langchain-qdrant 1.1.x expects url/api_key (not a pre-built client) for this helper.
    texts: list[str] = []
    metadatas: list[dict] = []
    for doc in chunks:
        content = _normalize_chunk_text(getattr(doc, "page_content", ""))
        content = content.strip()
        if not content:
            continue
        texts.append(content)
        meta = getattr(doc, "metadata", None) or {}
        # Ensure payload is JSON-serializable; keep as-is but default to dict.
        metadatas.append(meta if isinstance(meta, dict) else {"meta": str(meta)})

    if not texts:
        return 0, collection_name

    QdrantVectorStore.from_texts(
        texts=texts,
        embedding=get_embeddings(),
        sparse_embedding=get_sparse_embeddings(),
        metadatas=metadatas,
        collection_name=collection_name,
        retrieval_mode=RetrievalMode.HYBRID,
        url=settings.QDRANT_URL,
        api_key=settings.QDRANT_API_KEY,
        force_recreate=True,
    )

    return len(texts), collection_name
