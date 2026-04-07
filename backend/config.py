from __future__ import annotations

import os
from pathlib import Path
from typing import List

from dotenv import load_dotenv
from pydantic_settings import BaseSettings


BACKEND_DIR = Path(__file__).resolve().parent
ENV_PATH = BACKEND_DIR / ".env"

load_dotenv(ENV_PATH)


PROJECT_ROOT = Path(__file__).resolve().parent.parent
DEFAULT_STORAGE_DIR = PROJECT_ROOT / "storage"


class Settings(BaseSettings):
	# Server / cors
	CORS_ORIGINS: str = "http://localhost:3000,http://127.0.0.1:3000"

	# Uploads
	UPLOAD_DIR: str = str(DEFAULT_STORAGE_DIR / "uploads")
	MAX_FILE_SIZE: int = 50 * 1024 * 1024  # 50 MB

	# Qdrant (Cloud or local)
	# For Qdrant Cloud, set QDRANT_URL to your cluster URL and QDRANT_API_KEY.
	QDRANT_URL: str = "http://localhost:6333"
	QDRANT_API_KEY: str | None = None
	QDRANT_COLLECTION_PREFIX: str = "askmypdf_"

	# RAG
	# Qdrant similarity scores are typically higher-is-better; tune if needed.
	RAG_TOP_K: int = 50
	RAG_MIN_SCORE: float = 0.20
	# How many retrieved chunks are included in the LLM prompt context.
	# Keep this independent from how many citations the UI shows.
	CONTEXT_MAX_CHUNKS: int = 10

	# Citations
	# Limit how many references we show in the UI.
	CITATIONS_MAX: int = 1
	# Optional extra cutoff for citations (can be >= RAG_MIN_SCORE).
	CITATIONS_MIN_SCORE: float = 0.70

	# LLM (Groq)
	GROQ_API_KEY: str | None = None
	GROQ_MODEL: str = "llama-3.3-70b-versatile"

	# Supabase
	# NOTE: This project uses the anon key by default (policy-controlled writes).
	SUPABASE_URL: str | None = None
	SUPABASE_ANON_KEY: str | None = None
	# Optional: enables backend-admin operations (like deleting rows/files) even when RLS blocks anon.
	# Keep this server-side only. Do NOT expose to the browser.
	SUPABASE_SERVICE_ROLE_KEY: str | None = None
	SUPABASE_BUCKET: str = "pdfs"
	SUPABASE_PUBLIC_BUCKET: bool = True

	class Config:
		env_file = str(ENV_PATH)

	def cors_origins_list(self) -> List[str]:
		return [o.strip() for o in (self.CORS_ORIGINS or "").split(",") if o.strip()]


settings = Settings()


def ensure_dirs() -> None:
	"""Create required local directories (uploads) if missing."""
	os.makedirs(settings.UPLOAD_DIR, exist_ok=True)


ensure_dirs()
