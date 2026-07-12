from datetime import datetime

from pydantic import BaseModel, Field


class AssistantQueryRequest(BaseModel):
    question: str = Field(min_length=1, max_length=2000)


class AssistantQueryResponse(BaseModel):
    answer: str
    tools_used: list[str]


class DailyBriefingStats(BaseModel):
    scope_note: str
    pending_vacancy_approvals: int
    open_vacancies: int
    interviews_today: int
    interviews_this_week: int
    pending_offers: int
    pipeline_status_counts: dict[str, int]


class DailyBriefingResponse(BaseModel):
    stats: DailyBriefingStats
    narrative: str
    generated_at: datetime
