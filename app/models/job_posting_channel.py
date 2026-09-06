"""Where a job posting is, per channel, and every attempt to put it there.

`JobPostingChannel` is the current state of one posting on one channel
(unique per pair). `PostingAttempt` is append-only history: one row per
try, whether it was a person clicking Post, a bounded retry, or the legacy
"distribute to all portals" call. The channel row's `last_attempt_id`
points at the newest one so a list view needs no aggregate.

The posting stays 1:1 with its approved vacancy; this table is where
"many channels for one vacancy" lives. `campus_id` is denormalized from the
posting for the same reason it is on Application -- campus-scope filters
are an indexed equality, not a two-hop join.
"""

import uuid
from datetime import datetime

from sqlalchemy import DateTime, Enum, ForeignKey, Integer, String, Text, UniqueConstraint, func
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base_class import Base
from app.models.enums import (
    ChannelRecommendationSourceEnum,
    JobPostingChannelStatusEnum,
    PostingAttemptOutcomeEnum,
    PostingAttemptTriggerEnum,
)


class JobPostingChannel(Base):
    __tablename__ = "job_posting_channels"
    __table_args__ = (
        UniqueConstraint("job_posting_id", "channel_id", name="uq_job_posting_channel_posting_channel"),
    )

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, server_default=func.gen_random_uuid()
    )
    job_posting_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("job_postings.id", ondelete="CASCADE"), nullable=False, index=True
    )
    channel_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("recruitment_channels.id", ondelete="RESTRICT"), nullable=False, index=True
    )
    campus_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("campuses.id", ondelete="RESTRICT"), nullable=False, index=True
    )
    status: Mapped[JobPostingChannelStatusEnum] = mapped_column(
        Enum(JobPostingChannelStatusEnum, name="job_posting_channel_status_enum"),
        nullable=False,
        default=JobPostingChannelStatusEnum.RECOMMENDED,
        index=True,
    )
    recommended_by: Mapped[ChannelRecommendationSourceEnum] = mapped_column(
        Enum(ChannelRecommendationSourceEnum, name="channel_recommendation_source_enum"), nullable=False
    )
    # Rule name, or the AI's rationale later -- what the recruiter reads
    # before selecting. NULL when a person attached the channel by hand.
    recommendation_reason: Mapped[str | None] = mapped_column(Text, nullable=True)
    reviewed_by_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    reviewed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    # The portal's own id and public URL, from n8n's response or typed in by
    # the person who posted manually.
    external_ref: Mapped[str | None] = mapped_column(String(200), nullable=True)
    external_url: Mapped[str | None] = mapped_column(String(500), nullable=True)
    posted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    expires_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    removed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    attempt_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    last_error: Mapped[str | None] = mapped_column(Text, nullable=True)
    last_attempt_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True),
        # No FK: posting_attempts already points here (child -> parent); a
        # second FK the other way would make the pair un-droppable in one
        # migration and buy nothing -- attempts are append-only and never
        # deleted while their channel row exists.
        nullable=True,
    )
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )

    job_posting: Mapped["JobPosting"] = relationship(back_populates="channels")  # noqa: F821
    channel: Mapped["RecruitmentChannel"] = relationship()  # noqa: F821
    reviewed_by: Mapped["User | None"] = relationship()  # noqa: F821
    attempts: Mapped[list["PostingAttempt"]] = relationship(
        back_populates="job_posting_channel", order_by="PostingAttempt.attempt_number"
    )

    # Read-only conveniences for the API, same @property-over-relationship
    # pattern as JobPosting.position_title.
    @property
    def channel_code(self) -> str:
        return self.channel.code

    @property
    def channel_name(self) -> str:
        return self.channel.name

    @property
    def channel_mode(self):
        return self.channel.mode

    def __repr__(self) -> str:
        return f"<JobPostingChannel {self.job_posting_id} on {self.channel_id} ({self.status.value})>"


class PostingAttempt(Base):
    __tablename__ = "posting_attempts"
    __table_args__ = (
        UniqueConstraint(
            "job_posting_channel_id", "attempt_number", name="uq_posting_attempt_channel_number"
        ),
    )

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, server_default=func.gen_random_uuid()
    )
    job_posting_channel_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("job_posting_channels.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    campus_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("campuses.id", ondelete="RESTRICT"), nullable=False, index=True
    )
    attempt_number: Mapped[int] = mapped_column(Integer, nullable=False)
    trigger: Mapped[PostingAttemptTriggerEnum] = mapped_column(
        Enum(PostingAttemptTriggerEnum, name="posting_attempt_trigger_enum"), nullable=False
    )
    outcome: Mapped[PostingAttemptOutcomeEnum] = mapped_column(
        Enum(PostingAttemptOutcomeEnum, name="posting_attempt_outcome_enum"), nullable=False, index=True
    )
    # What was sent and what came back. Secrets never enter the payload --
    # n8n holds credentials -- so storing both verbatim is safe and is the
    # only way to debug a portal's rejection weeks later.
    request_payload: Mapped[dict | None] = mapped_column(JSONB, nullable=True)
    response_payload: Mapped[dict | None] = mapped_column(JSONB, nullable=True)
    error_message: Mapped[str | None] = mapped_column(Text, nullable=True)
    attempted_by_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    attempted_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    job_posting_channel: Mapped["JobPostingChannel"] = relationship(back_populates="attempts")
    attempted_by: Mapped["User | None"] = relationship()  # noqa: F821

    def __repr__(self) -> str:
        return f"<PostingAttempt #{self.attempt_number} {self.outcome.value}>"
