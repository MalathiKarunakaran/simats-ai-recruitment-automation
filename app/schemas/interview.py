import uuid
from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field

from app.models.enums import InterviewRecommendationEnum, InterviewScheduleStatusEnum, InterviewTypeEnum


class InterviewScheduleCreate(BaseModel):
    application_id: uuid.UUID
    interview_type: InterviewTypeEnum
    scheduled_at: datetime
    duration_minutes: int = Field(default=30, gt=0)
    meeting_link: str | None = None
    location: str | None = None
    notes: str | None = None
    panel_member_ids: list[uuid.UUID] = Field(min_length=1)


class InterviewScheduleUpdate(BaseModel):
    scheduled_at: datetime | None = None
    duration_minutes: int | None = Field(default=None, gt=0)
    meeting_link: str | None = None
    location: str | None = None
    notes: str | None = None
    status: InterviewScheduleStatusEnum | None = None


class InterviewScheduleRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    application_id: uuid.UUID
    campus_id: uuid.UUID
    interview_type: InterviewTypeEnum
    scheduled_at: datetime
    duration_minutes: int
    meeting_link: str | None
    location: str | None
    status: InterviewScheduleStatusEnum
    scheduled_by_id: uuid.UUID
    notes: str | None
    created_at: datetime
    updated_at: datetime


class InterviewFeedbackCreate(BaseModel):
    technical_score: int | None = Field(default=None, ge=1, le=10)
    communication_score: int | None = Field(default=None, ge=1, le=10)
    research_score: int | None = Field(default=None, ge=1, le=10)
    teaching_demo_score: int | None = Field(default=None, ge=1, le=10)
    overall_recommendation: InterviewRecommendationEnum
    comments: str | None = None


class InterviewFeedbackRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    interview_schedule_id: uuid.UUID
    panel_member_id: uuid.UUID
    technical_score: int | None
    communication_score: int | None
    research_score: int | None
    teaching_demo_score: int | None
    overall_recommendation: InterviewRecommendationEnum
    comments: str | None
    submitted_at: datetime


class InterviewQuestionItem(BaseModel):
    category: str
    question: str


class InterviewQuestionsResponse(BaseModel):
    questions: list[InterviewQuestionItem]
