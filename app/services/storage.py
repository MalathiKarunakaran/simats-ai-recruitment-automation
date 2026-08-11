"""MinIO object storage wrapper for resume files and (Phase F) Sanctioned
Strength bulk-upload original files.

Resumes are stored per-Candidate (reusable across applications), bucket
`resumes`, keys `{candidate_id}/{filename}`. Bulk-upload originals are stored
per-BulkUploadLog, bucket `MINIO_BUCKET_BULK_UPLOADS` (`bulk-uploads` by
default), keys `{bulk_upload_log_id}/{filename}` -- same shape, new bucket,
so `GET /sanctioned-strength/bulk-uploads/{id}/original-file` and `GET
/sanctioned-strength/bulk-upload/{id}/error-report` (which re-downloads and
re-validates the original bytes rather than caching parsed rows -- see
app/services/sanctioned_strength_import.py) can retrieve them the same way
candidates.py retrieves a resume. This is the only place the `minio` package
is imported.
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


def _ensure_bucket(client: Minio, bucket: str) -> None:
    try:
        if not client.bucket_exists(bucket):
            client.make_bucket(bucket)
    except S3Error as exc:
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY, detail="Could not reach object storage"
        ) from exc


def upload_resume(client: Minio, *, candidate_id: uuid.UUID, filename: str, data: bytes, content_type: str) -> str:
    _ensure_bucket(client, settings.MINIO_BUCKET_RESUMES)
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


def upload_bulk_upload_file(
    client: Minio, *, bulk_upload_log_id: uuid.UUID, filename: str, data: bytes, content_type: str
) -> str:
    _ensure_bucket(client, settings.MINIO_BUCKET_BULK_UPLOADS)
    storage_key = f"{bulk_upload_log_id}/{filename}"
    try:
        client.put_object(
            settings.MINIO_BUCKET_BULK_UPLOADS,
            storage_key,
            io.BytesIO(data),
            length=len(data),
            content_type=content_type,
        )
    except S3Error as exc:
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY, detail="Failed to upload file to object storage"
        ) from exc
    return storage_key


def download_bulk_upload_file_bytes(client: Minio, storage_key: str) -> bytes:
    try:
        response = client.get_object(settings.MINIO_BUCKET_BULK_UPLOADS, storage_key)
        try:
            return response.read()
        finally:
            response.close()
            response.release_conn()
    except S3Error as exc:
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY, detail="Failed to fetch file from object storage"
        ) from exc
