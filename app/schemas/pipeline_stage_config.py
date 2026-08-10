import uuid
from datetime import datetime

from pydantic import BaseModel, ConfigDict

from app.models.enums import ApplicationStatusEnum, InterviewTypeEnum, StaffRoleCategoryEnum


class PipelineStageConfigBase(BaseModel):
    role_category: StaffRoleCategoryEnum
    sequence_position: int
    display_label: str
    maps_to_status: ApplicationStatusEnum
    maps_to_interview_type: InterviewTypeEnum | None = None
    is_active: bool = True


class PipelineStageConfigCreate(PipelineStageConfigBase):
    pass


class PipelineStageConfigUpdate(BaseModel):
    role_category: StaffRoleCategoryEnum | None = None
    sequence_position: int | None = None
    display_label: str | None = None
    maps_to_status: ApplicationStatusEnum | None = None
    maps_to_interview_type: InterviewTypeEnum | None = None
    is_active: bool | None = None


class PipelineStageConfigRead(PipelineStageConfigBase):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    created_at: datetime
    updated_at: datetime
