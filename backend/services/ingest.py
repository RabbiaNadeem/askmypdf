import os
from langchain_community.document_loaders import PyMuPDFLoader
from langchain_text_splitters import RecursiveCharacterTextSplitter
from langchain_qdrant import QdrantVectorStore

from config import settings
from services.retrieval import get_embeddings, make_collection_name

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
        chunk_size=1000,
        chunk_overlap=200,
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
    texts = [doc.page_content for doc in chunks]
    metadatas = [doc.metadata for doc in chunks]

    QdrantVectorStore.from_texts(
        texts=texts,
        embedding=get_embeddings(),
        metadatas=metadatas,
        collection_name=collection_name,
        url=settings.QDRANT_URL,
        api_key=settings.QDRANT_API_KEY,
        force_recreate=True,
    )

    return len(chunks), collection_name
