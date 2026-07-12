"""MinIO object storage wrapper for resume files.

Resumes are stored per-Candidate (reusable across applications), bucket
`resumes`, keys `{candidate_id}/{filename}`. This is the only place the
`minio` package is imported.
"""

import io
import uuid

from fastapi import HTTPException, status
from minio import Minio
from minio.error import S3Error

from app.core.config import settings


def get_minio_client() -> Minio:
    """FastAPI dependency -- overridden with a fake in tests."""
    return Minio(
        settings.MINIO_ENDPOINT,
        access_key=settings.MINIO_ACCESS_KEY,
        secret_key=settings.MINIO_SECRET_KEY,
        secure=settings.MINIO_USE_SSL,
    )


def _ensure_bucket(client: Minio) -> None:
    try:
        if not client.bucket_exists(settings.MINIO_BUCKET_RESUMES):
            client.make_bucket(settings.MINIO_BUCKET_RESUMES)
    except S3Error as exc:
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY, detail="Could not reach object storage"
        ) from exc


def upload_resume(client: Minio, *, candidate_id: uuid.UUID, filename: str, data: bytes, content_type: str) -> str:
    _ensure_bucket(client)
    storage_key = f"{candidate_id}/{filename}"
    try:
        client.put_object(
            settings.MINIO_BUCKET_RESUMES,
            storage_key,
            io.BytesIO(data),
            length=len(data),
            content_type=content_type,
        )
    except S3Error as exc:
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY, detail="Failed to upload resume to object storage"
        ) from exc
    return storage_key


def download_resume_bytes(client: Minio, storage_key: str) -> bytes:
    try:
        response = client.get_object(settings.MINIO_BUCKET_RESUMES, storage_key)
        try:
            return response.read()
        finally:
            response.close()
            response.release_conn()
    except S3Error as exc:
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY, detail="Failed to fetch resume from object storage"
        ) from exc
