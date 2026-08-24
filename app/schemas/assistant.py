from datetime import datetime
from typing import Literal

from pydantic import BaseModel, Field


class ConversationTurn(BaseModel):
    """One prior turn of an additive, frontend-owned chat history (see
    AssistantQueryRequest.conversation_history) -- there is no server-side
    session storage; the frontend resends whatever history it wants
    included with each new question."""

    role: Literal["user", "assistant"]
    content: str


class AssistantQueryRequest(BaseModel):
    question: str = Field(min_length=1, max_length=2000)
    # Additive/optional (defaults to None) so every existing single-turn
    # caller/test keeps working unchanged. When provided, prepended ahead of
    # `question` in app/services/hermes.py::run_assistant_query, capped to
    # the last _MAX_CONVERSATION_HISTORY_TURNS entries there.
    conversation_history: list[ConversationTurn] | None = None


class AssistantAction(BaseModel):
    """Deterministic, code-generated UI affordance attached to a query
    response based on which tool(s) were actually called -- never derived
    from the LLM's own answer text. See
    app/services/hermes.py::_build_actions for how these are populated."""

    type: Literal["open_page", "export_excel"]
    label: str
    path: str | None = None
    query: dict[str, str] | None = None
    report_type: str | None = None
    params: dict[str, str] | None = None


class AssistantQueryResponse(BaseModel):
    answer: str
    tools_used: list[str]
    # Additive (defaults to empty) -- see AssistantAction above.
    actions: list[AssistantAction] = []


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
