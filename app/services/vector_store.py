"""ChromaDB wrapper for resume embeddings / semantic JD matching.

One collection (`resume_embeddings`), one document per candidate, keyed by
candidate_id, using Chroma's built-in default embedding function -- Anthropic
has no public embeddings endpoint, so this is not a Claude call.

Distance-to-similarity-percent conversion below is an approximation
(`(1 - distance) * 100`, clamped to [0, 100]) -- exact enough to serve as one
input signal alongside Claude's own scoring (per app/services/ai_client.py's
score_and_extract_resume), not intended as a precise metric on its own.
"""

import uuid

import chromadb
from chromadb.api.models.Collection import Collection
from fastapi import HTTPException, status

from app.core.config import settings

_DUPLICATE_DISTANCE_THRESHOLD = 0.05  # near-identical resume text


def get_chroma_collection() -> Collection:
    """FastAPI dependency -- overridden with a fake in tests."""
    client = chromadb.HttpClient(host=settings.CHROMA_HOST, port=settings.CHROMA_PORT)
    return client.get_or_create_collection(name=settings.CHROMA_COLLECTION_RESUMES)


def _distance_to_similarity_pct(distance: float) -> float:
    return max(0.0, min(100.0, (1 - distance) * 100))


def upsert_resume_embedding(collection: Collection, *, candidate_id: uuid.UUID, resume_text: str) -> None:
    try:
        collection.upsert(
            ids=[str(candidate_id)],
            documents=[resume_text],
            metadatas=[{"candidate_id": str(candidate_id)}],
        )
    except Exception as exc:  # chromadb raises varied exception types across transports
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY, detail="Could not reach the vector store"
        ) from exc


def jd_similarity_for_candidate(collection: Collection, *, candidate_id: uuid.UUID, jd_text: str) -> float | None:
    try:
        result = collection.query(
            query_texts=[jd_text],
            n_results=1,
            where={"candidate_id": str(candidate_id)},
        )
    except Exception as exc:
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY, detail="Could not reach the vector store"
        ) from exc

    distances = result.get("distances") or [[]]
    if not distances[0]:
        return None
    return _distance_to_similarity_pct(distances[0][0])


def find_near_duplicate(
    collection: Collection, *, candidate_id: uuid.UUID, resume_text: str
) -> uuid.UUID | None:
    """Returns the candidate_id of a near-identical resume belonging to a
    DIFFERENT candidate, if one exists, else None."""
    try:
        result = collection.query(query_texts=[resume_text], n_results=5)
    except Exception as exc:
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY, detail="Could not reach the vector store"
        ) from exc

    ids = result.get("ids") or [[]]
    distances = result.get("distances") or [[]]
    for other_id, distance in zip(ids[0], distances[0]):
        if other_id == str(candidate_id):
            continue
        if distance <= _DUPLICATE_DISTANCE_THRESHOLD:
            return uuid.UUID(other_id)
    return None
