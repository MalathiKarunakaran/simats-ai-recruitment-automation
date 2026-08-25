"""Unit coverage for app/services/storage.py's `try_upload_bulk_upload_file`
-- the non-raising, retry-with-backoff archival upload that fixes the
"Could not reach object storage" bug (see the routers' own commit-endpoint
docstrings for the full story). Uses a tiny stub client directly (not
`FakeMinioClient`/the FastAPI `client` fixture) since this is testing the
retry/backoff mechanism in isolation, not a full HTTP round-trip -- the
router-level "storage fails but the commit still succeeds" behavior is
covered separately in test_location_bulk_upload.py /
test_sanctioned_strength_bulk_upload.py / test_housekeeping_staff_bulk_upload.py.
"""

import uuid

from app.services import storage


class _AlwaysFailsClient:
    def __init__(self):
        self.attempts = 0

    def bucket_exists(self, bucket):
        self.attempts += 1
        raise ConnectionError("simulated MinIO outage")


class _FailsThenSucceedsClient:
    """Fails `fail_count` times, then behaves like a normal, empty MinIO."""

    def __init__(self, fail_count: int):
        self.fail_count = fail_count
        self.attempts = 0
        self.put_calls = []

    def bucket_exists(self, bucket):
        self.attempts += 1
        if self.attempts <= self.fail_count:
            raise ConnectionError("simulated transient MinIO outage")
        return True

    def make_bucket(self, bucket):
        pass

    def put_object(self, bucket, object_name, data, length, content_type=None):
        self.put_calls.append((bucket, object_name))


def test_try_upload_succeeds_on_first_attempt_no_retry_needed():
    client = _FailsThenSucceedsClient(fail_count=0)
    key, error = storage.try_upload_bulk_upload_file(
        client,
        bulk_upload_log_id=uuid.uuid4(),
        filename="upload.xlsx",
        data=b"data",
        content_type="application/octet-stream",
        max_attempts=3,
        base_delay_seconds=0.01,
    )
    assert error is None
    assert key is not None
    assert client.attempts == 1
    assert len(client.put_calls) == 1


def test_try_upload_retries_and_succeeds_after_a_transient_failure():
    client = _FailsThenSucceedsClient(fail_count=1)
    key, error = storage.try_upload_bulk_upload_file(
        client,
        bulk_upload_log_id=uuid.uuid4(),
        filename="upload.xlsx",
        data=b"data",
        content_type="application/octet-stream",
        max_attempts=3,
        base_delay_seconds=0.01,
    )
    assert error is None
    assert key is not None
    assert client.attempts == 2  # 1 failure + 1 success
    assert len(client.put_calls) == 1


def test_try_upload_never_raises_and_returns_the_error_after_exhausting_retries():
    client = _AlwaysFailsClient()
    key, error = storage.try_upload_bulk_upload_file(
        client,
        bulk_upload_log_id=uuid.uuid4(),
        filename="upload.xlsx",
        data=b"data",
        content_type="application/octet-stream",
        max_attempts=3,
        base_delay_seconds=0.01,
    )
    assert key is None
    assert error is not None
    assert "simulated MinIO outage" in error
    assert client.attempts == 3  # exhausted every attempt, never raised


def test_try_upload_never_raises_even_when_the_underlying_client_always_errors():
    """No `pytest.raises` here on purpose: if this call raised, the test
    itself would error out -- which is exactly the point. This function's
    entire contract (callers rely on it to never block/fail their
    transaction) hinges on never propagating an exception."""
    client = _AlwaysFailsClient()
    key, error = storage.try_upload_bulk_upload_file(
        client,
        bulk_upload_log_id=uuid.uuid4(),
        filename="upload.xlsx",
        data=b"data",
        content_type="application/octet-stream",
        max_attempts=2,
        base_delay_seconds=0.01,
    )
    assert key is None
    assert error is not None
