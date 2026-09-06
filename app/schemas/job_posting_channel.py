import uuid
from datetime import datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, model_validator

from app.models.enums import (
    ChannelRecommendationSourceEnum,
    JobPostingChannelStatusEnum,
    PostingAttemptOutcomeEnum,
    PostingAttemptTriggerEnum,
    RecruitmentChannelModeEnum,
)


class PostingAttemptRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    job_posting_channel_id: uuid.UUID
    attempt_number: int
    trigger: PostingAttemptTriggerEnum
    outcome: PostingAttemptOutcomeEnum
    request_payload: dict | None
    response_payload: dict | None
    error_message: str | None
    attempted_by_id: uuid.UUID | None
    attempted_at: datetime


class JobPostingChannelRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    job_posting_id: uuid.UUID
    channel_id: uuid.UUID
    channel_code: str
    channel_name: str
    channel_mode: RecruitmentChannelModeEnum
    campus_id: uuid.UUID
    status: JobPostingChannelStatusEnum
    recommended_by: ChannelRecommendationSourceEnum
    recommendation_reason: str | None
    reviewed_by_id: uuid.UUID | None
    reviewed_at: datetime | None
    external_ref: str | None
    external_url: str | None
    posted_at: datetime | None
    expires_at: datetime | None
    removed_at: datetime | None
    attempt_count: int
    last_error: str | None
    last_attempt_id: uuid.UUID | None
    created_at: datetime
    updated_at: datetime


class AttachChannelRequest(BaseModel):
    channel_id: uuid.UUID


class ReviewChannelRequest(BaseModel):
    decision: Literal["SELECT", "REMOVE"]


class ManualPostingRequest(BaseModel):
    external_ref: str | None = Field(default=None, max_length=200)
    external_url: str | None = Field(default=None, max_length=500)

    @model_validator(mode="after")
    def _at_least_one(self):
        if not (self.external_ref or self.external_url):
            raise ValueError("Give the portal's reference, its URL, or both")
        return self


class PostChannelResponse(BaseModel):
    channel: JobPostingChannelRead
    attempt: PostingAttemptRead


class RecommendChannelsResponse(BaseModel):
    created: list[JobPostingChannelRead]
