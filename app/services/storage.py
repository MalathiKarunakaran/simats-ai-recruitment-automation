"""MinIO object storage wrapper for resume files and (Phase F) Sanctioned
Strength/Location/Housekeeping-Staff bulk-upload original files.

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

Resumes go through `upload_resume` (raises on failure -- a resume IS the
primary data, so a hard fail is correct there). Bulk-upload archival copies
go through `try_upload_bulk_upload_file` instead (never raises -- see its
own docstring for why: the archived copy is a nice-to-have audit/undo
convenience, not the source of truth for the records a bulk upload actually
creates, and treating it as a hard blocking dependency was a real, reported
bug -- a transient MinIO hiccup surfaced as "Could not reach object storage"
and rolled back valid rows that Postgres was never even given a chance to
write).
"""

import io
import time
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


def try_upload_bulk_upload_file(
    client: Minio,
    *,
    bulk_upload_log_id: uuid.UUID,
    filename: str,
    data: bytes,
    content_type: str,
    max_attempts: int = 3,
    base_delay_seconds: float = 0.3,
) -> tuple[str | None, str | None]:
    """Best-effort archival upload for a bulk upload's original workbook --
    unlike `upload_resume` above (which raises, since a resume IS the
    primary data), this NEVER raises. It retries transient failures with
    short exponential backoff (base_delay * 2**attempt, so ~0.3s/0.6s by
    default across 3 attempts) and then gives up, returning (None, <error
    message>) rather than propagating.

    Why this needs to exist at all: the archived copy in MinIO is a
    nice-to-have audit/undo convenience (it lets `original-file`/
    `error-report` re-download the exact bytes later -- see
    `download_bulk_upload_file_bytes`'s callers) -- it is never the primary
    source of truth for the records a bulk upload actually creates (Postgres
    is). A commit endpoint that hard-fails the entire request -- rolling
    back rows that were never even written yet, since the archival upload
    used to run *before* `commit_rows` -- just because MinIO happened to be
    briefly unreachable was a real, reported bug: the UI showed "Could not
    reach object storage" even though the workbook had already parsed and
    validated cleanly, and the user's valid rows were never given a chance
    to actually commit. Callers should call this AFTER writing the real
    records (or independently of them), treat a `None` return as a
    non-blocking warning to surface to the user, and leave
    `BulkUploadLog.stored_file_object_key` (nullable) as `None` in that
    case -- `original-file`/`error-report` already handle a null key by
    returning 404 "Original file not available" rather than crashing.
    """
    last_error: str | None = None
    storage_key = f"{bulk_upload_log_id}/{filename}"
    for attempt in range(max_attempts):
        try:
            if not client.bucket_exists(settings.MINIO_BUCKET_BULK_UPLOADS):
                client.make_bucket(settings.MINIO_BUCKET_BULK_UPLOADS)
            client.put_object(
                settings.MINIO_BUCKET_BULK_UPLOADS,
                storage_key,
                io.BytesIO(data),
                length=len(data),
                content_type=content_type,
            )
            return storage_key, None
        except Exception as exc:  # noqa: BLE001 -- deliberately broad: ANY failure here (S3Error,
            # connection refused, DNS, timeout, ...) must degrade to a warning, never raise/propagate.
            last_error = str(exc) or exc.__class__.__name__
            if attempt < max_attempts - 1:
                time.sleep(base_delay_seconds * (2**attempt))
    return None, last_error


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
