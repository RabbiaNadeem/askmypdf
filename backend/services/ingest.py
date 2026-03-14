import os
from langchain_community.document_loaders import PyMuPDFLoader
from langchain_text_splitters import RecursiveCharacterTextSplitter
from langchain_huggingface import HuggingFaceEmbeddings
from langchain_community.vectorstores import Chroma

CHROMA_PATH = "chroma_db"
COLLECTION_NAME = "local_collection"

def ingest_pdf(file_path: str):
    """
    Ingests a PDF file into the local ChromaDB.
    Returns: The number of chunks added.
    """

    # 1. Load PDF
    if not os.path.exists(file_path):
        raise FileNotFoundError(f"File not found: {file_path}")
        
    loader = PyMuPDFLoader(file_path)
    documents = loader.load()
    
    if not documents:
        return 0
    
    # 2. Split Text (RecursiveCharacterTextSplitter 500/100)
    text_splitter = RecursiveCharacterTextSplitter(
        chunk_size=500,
        chunk_overlap=100,
        length_function=len,
        add_start_index=True,
    )
    chunks = text_splitter.split_documents(documents)
    
    if not chunks:
        return 0

    # 3. Embeddings (Local HuggingFace all-MiniLM-L6-v2)
    # This will download the model (~80MB) on first run
    embedding_function = HuggingFaceEmbeddings(
        model_name="all-MiniLM-L6-v2"
    )
    
    # 4. Store in ChromaDB
    # Persist directly to disk
    Chroma.from_documents(
        documents=chunks,
        embedding=embedding_function,
        persist_directory=CHROMA_PATH,
        collection_name=COLLECTION_NAME
    )
    
    return len(chunks)
