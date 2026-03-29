from __future__ import annotations

import hashlib
import re
from functools import lru_cache
from typing import Iterable, Tuple

from fastapi import HTTPException
from langchain_huggingface import HuggingFaceEmbeddings
from langchain_qdrant import QdrantVectorStore
from qdrant_client import QdrantClient

from config import settings


_COLLECTION_SAFE = re.compile(r"[^a-zA-Z0-9_]+")



def make_collection_name(filename: str, doc_id: str | None = None) -> str:
	"""Deterministic, Qdrant-safe collection name.

	If doc_id is provided, it is incorporated so identical filenames do not collide.
	"""
	base = filename.rsplit("/", 1)[-1].rsplit("\\", 1)[-1]
	stem = base.rsplit(".", 1)[0] if "." in base else base
	stem = _COLLECTION_SAFE.sub("_", stem).strip("_")
	digest_source = f"{doc_id}::{base}" if doc_id else base
	digest = hashlib.sha1(digest_source.encode("utf-8")).hexdigest()[:10]
	return f"{settings.QDRANT_COLLECTION_PREFIX}{stem}_{digest}".lower()


@lru_cache(maxsize=1)
def get_embeddings() -> HuggingFaceEmbeddings:
	# Must match ingest
	return HuggingFaceEmbeddings(model_name="all-MiniLM-L6-v2")


@lru_cache(maxsize=1)
def get_qdrant_client() -> QdrantClient:
	url = settings.QDRANT_URL
	if not url:
		raise HTTPException(
			status_code=500,
			detail="QDRANT_URL is not set. Set it in your backend environment/.env.",
		)
	return QdrantClient(url=url, api_key=settings.QDRANT_API_KEY)


def get_vector_store(collection_name: str) -> QdrantVectorStore:
	"""Return a LangChain Qdrant vector store bound to a collection."""
	return QdrantVectorStore(
		client=get_qdrant_client(),
		collection_name=collection_name,
		embedding=get_embeddings(),
	)


def similarity_search_with_score(
	query: str,
	collection_name: str,
	k: int = 4,
) -> Iterable[Tuple[object, float]]:
	"""Thin wrapper that returns (Document, score) pairs."""
	store = get_vector_store(collection_name)
	return store.similarity_search_with_score(query, k=k)
