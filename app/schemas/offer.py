import uuid
from datetime import date, datetime

from pydantic import BaseModel, ConfigDict, Field

from app.models.enums import OfferStatusEnum


class OfferCreate(BaseModel):
    application_id: uuid.UUID
    salary_amount: float = Field(gt=0)
    salary_currency: str = "INR"
    joining_date: date
    terms: str | None = None
    expires_at: date | None = None


class OfferDeclineRequest(BaseModel):
    reason: str = Field(min_length=1)


class OfferRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    application_id: uuid.UUID
    offered_by_id: uuid.UUID
    salary_amount: float
    salary_currency: str
    joining_date: date
    terms: str | None
    status: OfferStatusEnum
    sent_at: datetime | None
    responded_at: datetime | None
    decline_reason: str | None
    expires_at: date | None
    created_at: datetime
    updated_at: datetime
