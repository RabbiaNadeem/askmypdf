from __future__ import annotations

import os
from pathlib import Path
from typing import List

from dotenv import load_dotenv
from pydantic_settings import BaseSettings


load_dotenv()


PROJECT_ROOT = Path(__file__).resolve().parent.parent
DEFAULT_STORAGE_DIR = PROJECT_ROOT / "storage"


class Settings(BaseSettings):
	# Server / cors
	CORS_ORIGINS: str = "http://localhost:3000,http://127.0.0.1:3000"

	# Uploads
	UPLOAD_DIR: str = str(DEFAULT_STORAGE_DIR / "uploads")
	MAX_FILE_SIZE: int = 50 * 1024 * 1024  # 50 MB

	# Chroma
	CHROMA_PATH: str = str(DEFAULT_STORAGE_DIR / "chroma_db")
	CHROMA_COLLECTION: str = "local_collection"

	# LLM (Groq)
	GROQ_API_KEY: str | None = None
	GROQ_MODEL: str = "llama-3.3-70b-versatile"

	class Config:
		env_file = ".env"

	def cors_origins_list(self) -> List[str]:
		return [o.strip() for o in (self.CORS_ORIGINS or "").split(",") if o.strip()]


settings = Settings()


def ensure_dirs() -> None:
	"""Create required local directories (uploads, chroma) if missing."""
	os.makedirs(settings.UPLOAD_DIR, exist_ok=True)
	os.makedirs(settings.CHROMA_PATH, exist_ok=True)


ensure_dirs()
