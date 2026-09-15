"""How a job posting reaches each recruitment channel (2026-09-15).

One provider per way of posting. `job_channels.post_channel` asks the
channel's provider two things: is it configured, and post this row. The
provider never writes the channel row or the attempt -- job_channels stays
the only writer of both -- it returns a `PostResult` describing what
happened.

Providers are looked up by channel code first, then by the channel's mode,
so a real integration for one portal (a `LinkedInProvider` registered under
"LINKEDIN") can be added without touching the others. None is registered
today: LinkedIn, Indeed, Naukri, FacultyPlus and Email are MANUAL_ASSISTED
(migration e8f9a0b1c2d3) because no approved API access exists, and nothing
here pretends otherwise. An API-mode channel with no n8n host reports
NOT_CONFIGURED and is refused before any attempt is recorded.
"""

from dataclasses import dataclass

import httpx

from app.models.enums import (
    JobPostingChannelStatusEnum,
    PostingAttemptOutcomeEnum,
    RecruitmentChannelModeEnum,
)
from app.services.n8n_client import N8nClient, get_n8n_client

LEGACY_DISTRIBUTION_WEBHOOK = "job-distribution"

# What a channel needs before it can be posted to. Derived, never stored.
AUTOMATIC = "AUTOMATIC"  # this system publishes it (careers page, feed)
MANUAL = "MANUAL"  # a person posts it and records the reference
READY = "READY"  # an integration is configured
NOT_CONFIGURED = "NOT_CONFIGURED"  # an integration is required and absent


@dataclass(frozen=True)
class PostResult:
    status: JobPostingChannelStatusEnum
    outcome: PostingAttemptOutcomeEnum
    request_payload: dict | None = None
    response_payload: dict | None = None
    error_message: str | None = None
    external_ref: str | None = None
    external_url: str | None = None


class RecruitmentChannelProvider:
    # True: posted by this system at the moment the posting is published,
    # with no person involved.
    automatic = False

    def configuration_status(self, channel, n8n_client: N8nClient | None) -> str:
        raise NotImplementedError

    def configuration_message(self, channel, n8n_client: N8nClient | None) -> str | None:
        return None

    def post(self, row, *, attempt_number: int, n8n_client: N8nClient | None) -> PostResult:
        raise NotImplementedError


class InternalCareersProvider(RecruitmentChannelProvider):
    """The institution's own careers page. Nothing is sent anywhere: the
    posting is on /careers/<slug> as soon as it is PUBLISHED, so posting
    records that public URL and the time."""

    automatic = True

    def configuration_status(self, channel, n8n_client):
        return AUTOMATIC

    def post(self, row, *, attempt_number, n8n_client):
        from app.services.job_distribution import build_public_apply_url  # local: avoids an import cycle

        url = build_public_apply_url(row.job_posting)
        return PostResult(
            status=JobPostingChannelStatusEnum.POSTED,
            outcome=PostingAttemptOutcomeEnum.SUCCEEDED,
            request_payload={"mode": RecruitmentChannelModeEnum.INTERNAL.value},
            external_url=url,
        )


class FeedProvider(RecruitmentChannelProvider):
    """The channel pulls a feed this system exposes; nothing to send."""

    automatic = True

    def configuration_status(self, channel, n8n_client):
        return AUTOMATIC

    def post(self, row, *, attempt_number, n8n_client):
        return PostResult(
            status=JobPostingChannelStatusEnum.POSTED,
            outcome=PostingAttemptOutcomeEnum.SUCCEEDED,
            request_payload={"mode": RecruitmentChannelModeEnum.FEED.value},
        )


class ManualAssistedProvider(RecruitmentChannelProvider):
    """FacultyPlus, LinkedIn, Indeed, notice boards: the system prepares the
    content, a person posts it and records where. Posting only hands it over
    (QUEUED, shown as "Manual action required"); nothing claims it is live
    until someone records the reference."""

    def configuration_status(self, channel, n8n_client):
        return MANUAL

    def post(self, row, *, attempt_number, n8n_client):
        return PostResult(
            status=JobPostingChannelStatusEnum.QUEUED,
            outcome=PostingAttemptOutcomeEnum.SUCCEEDED,
            request_payload={"mode": RecruitmentChannelModeEnum.MANUAL_ASSISTED.value, "queued_for_manual_posting": True},
        )


class N8nApiProvider(RecruitmentChannelProvider):
    """An integration reached through one n8n webhook, which holds the
    portal's credentials."""

    def configuration_status(self, channel, n8n_client):
        return READY if n8n_client is not None else NOT_CONFIGURED

    def configuration_message(self, channel, n8n_client):
        if n8n_client is None:
            return "Integration not configured (N8N_BASE_URL is not set)"
        return None

    def post(self, row, *, attempt_number, n8n_client):
        payload = _build_api_payload(row, attempt_number)
        path = row.channel.integration_path or LEGACY_DISTRIBUTION_WEBHOOK
        try:
            response = n8n_client.post_webhook(path, payload)
        except httpx.TimeoutException as exc:
            return PostResult(
                status=JobPostingChannelStatusEnum.FAILED,
                outcome=PostingAttemptOutcomeEnum.TIMEOUT,
                request_payload=payload,
                error_message=f"Timed out reaching n8n: {exc}",
            )
        except httpx.HTTPError as exc:
            return PostResult(
                status=JobPostingChannelStatusEnum.FAILED,
                outcome=PostingAttemptOutcomeEnum.FAILED,
                request_payload=payload,
                error_message=str(exc)[:2000],
            )
        ref = response.get("external_ref") if response else None
        url = response.get("external_url") if response else None
        return PostResult(
            status=JobPostingChannelStatusEnum.POSTED,
            outcome=PostingAttemptOutcomeEnum.SUCCEEDED,
            request_payload=payload,
            response_payload=response,
            external_ref=ref if isinstance(ref, str) and ref else None,
            external_url=url if isinstance(url, str) and url else None,
        )


def _build_api_payload(row, attempt_number: int) -> dict:
    from app.services.job_distribution import generate_job_ad  # local: avoids an import cycle

    ad = generate_job_ad(row.job_posting)
    return {
        **ad,
        "job_posting_id": str(ad["job_posting_id"]),
        "job_posting_channel_id": str(row.id),
        "attempt_number": attempt_number,
        "channel_code": row.channel.code,
        "channel_config": row.channel.config or {},
        # `portals` kept for the existing n8n workflow, which switches on it.
        "portals": [row.channel.code],
    }


_PROVIDERS_BY_MODE: dict[RecruitmentChannelModeEnum, RecruitmentChannelProvider] = {
    RecruitmentChannelModeEnum.INTERNAL: InternalCareersProvider(),
    RecruitmentChannelModeEnum.FEED: FeedProvider(),
    RecruitmentChannelModeEnum.MANUAL_ASSISTED: ManualAssistedProvider(),
    RecruitmentChannelModeEnum.API: N8nApiProvider(),
}

# Channel-specific providers, keyed by channel code; they win over the mode's.
PROVIDERS_BY_CODE: dict[str, RecruitmentChannelProvider] = {}


def provider_for(channel) -> RecruitmentChannelProvider:
    return PROVIDERS_BY_CODE.get(channel.code) or _PROVIDERS_BY_MODE[channel.mode]


def configuration_status(channel) -> str:
    """For read models: whether the channel could be posted to right now."""
    return provider_for(channel).configuration_status(channel, get_n8n_client())


def configuration_message(channel) -> str | None:
    return provider_for(channel).configuration_message(channel, get_n8n_client())
