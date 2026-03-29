from __future__ import annotations

from fastapi import APIRouter, File, UploadFile, HTTPException
import os
import tempfile
import uuid
from functools import lru_cache

from supabase import Client, create_client

from config import settings

router = APIRouter()


@lru_cache(maxsize=1)
def get_supabase() -> Client:
    def _sanitize(value: str | None) -> str | None:
        if value is None:
            return None
        v = value.strip()
        # Defensive: .env values sometimes include surrounding quotes
        if len(v) >= 2 and ((v[0] == '"' and v[-1] == '"') or (v[0] == "'" and v[-1] == "'")):
            v = v[1:-1].strip()
        return v or None

    url = _sanitize(settings.SUPABASE_URL)
    key = _sanitize(settings.SUPABASE_ANON_KEY)

    if not url or not key:
        raise HTTPException(
            status_code=500,
            detail="Supabase is not configured. Set SUPABASE_URL and SUPABASE_ANON_KEY in backend/.env.",
        )

    # The anon key is a JWT (3 dot-separated segments). A common cause of
    # "signature verification failed" is pasting the wrong value or including quotes.
    if key.count('.') != 2:
        raise HTTPException(
            status_code=500,
            detail=(
                "SUPABASE_ANON_KEY does not look like a JWT. Paste the 'anon public' API key "
                "from Supabase Project Settings → API (starts with 'eyJ')."
            ),
        )

    return create_client(url, key)


def _raise_supabase_http_error(prefix: str, err: Exception) -> None:
    message = str(err)
    lower = message.lower()

    if 'signature verification failed' in lower:
        raise HTTPException(
            status_code=401,
            detail=(
                f"{prefix}: Supabase auth failed (signature verification failed). "
                "Double-check SUPABASE_ANON_KEY is the anon public key (JWT) and has no quotes/extra spaces."
            ),
        )

    if 'row level security' in lower or 'permission denied' in lower:
        raise HTTPException(status_code=403, detail=f"{prefix}: {message}")

    if 'unauthorized' in lower:
        raise HTTPException(status_code=401, detail=f"{prefix}: {message}")

    raise HTTPException(status_code=500, detail=f"{prefix}: {message}")


@router.get("/documents")
async def list_documents(limit: int = 50):
    """Return recent uploaded documents (metadata stored in Supabase Postgres)."""
    try:
        supabase = get_supabase()
        resp = (
            supabase.table("documents")
            .select("doc_id,filename,url,collection,chunks,created_at")
            .order("created_at", desc=True)
            .limit(limit)
            .execute()
        )
        return {"documents": resp.data or []}
    except HTTPException:
        raise
    except Exception as e:
        _raise_supabase_http_error("Failed to list documents", e)

@router.post("/upload")
async def upload_file(file: UploadFile = File(...)):
    if file.content_type != "application/pdf":
        raise HTTPException(status_code=400, detail="Only PDF files are allowed")

    # Magic byte validation for PDF
    await file.seek(0)
    magic_header = await file.read(4)
    if magic_header != b"%PDF":
        raise HTTPException(status_code=400, detail="Invalid file content. Not a PDF.")
    await file.seek(0)  # Reset cursor

    original_filename = os.path.basename(file.filename)
    doc_id = str(uuid.uuid4())

    tmp_path: str | None = None

    # Save to a temp file (for ingestion only) with size validation
    try:
        size = 0
        fd, tmp_path = tempfile.mkstemp(
            prefix=f"askmypdf_{doc_id}_",
            suffix=f"_{original_filename}",
        )
        with os.fdopen(fd, "wb") as buffer:
            while True:
                chunk = await file.read(1024 * 1024)  # Read 1MB chunks
                if not chunk:
                    break
                size += len(chunk)
                if size > settings.MAX_FILE_SIZE:
                    raise HTTPException(status_code=413, detail="File too large (max 50MB)")
                buffer.write(chunk)

        # --- RAG Ingest Service Call ---
        from services.ingest import ingest_pdf

        chunk_count, collection_name = ingest_pdf(tmp_path, doc_id=doc_id)

        # --- Supabase Storage Upload ---
        supabase = get_supabase()
        storage_path = f"{doc_id}/{original_filename}"
        with open(tmp_path, "rb") as f:
            file_bytes = f.read()

        supabase.storage.from_(settings.SUPABASE_BUCKET).upload(
            storage_path,
            file_bytes,
            file_options={"content-type": "application/pdf", "upsert": False},
        )

        url = None
        if settings.SUPABASE_PUBLIC_BUCKET:
            url = supabase.storage.from_(settings.SUPABASE_BUCKET).get_public_url(storage_path)

        # --- Metadata Insert ---
        supabase.table("documents").insert(
            {
                "doc_id": doc_id,
                "filename": original_filename,
                "storage_path": storage_path,
                "url": url,
                "collection": collection_name,
                "chunks": chunk_count,
            }
        ).execute()

    except Exception as e:
        if isinstance(e, HTTPException):
            raise e
        _raise_supabase_http_error("Processing failed", e)
    finally:
        if tmp_path and os.path.exists(tmp_path):
            try:
                os.remove(tmp_path)
            except Exception:
                pass

    return {
        "doc_id": doc_id,
        "filename": original_filename,
        "message": "File uploaded and ingested successfully",
        "chunks": chunk_count,
        "collection": collection_name,
        "storage_path": storage_path,
        "url": url,
    }

