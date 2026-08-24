from datetime import datetime, timezone

import anthropic
from fastapi import APIRouter, Depends, HTTPException, Request, status
from sqlalchemy.orm import Session

from app.core.deps import (
    CampusScope,
    DepartmentScope,
    get_campus_scope,
    get_current_active_user,
    get_db,
    get_department_scope,
)
from app.models.enums import UserRoleEnum
from app.models.user import User
from app.schemas.assistant import (
    AssistantAction,
    AssistantQueryRequest,
    AssistantQueryResponse,
    DailyBriefingResponse,
    DailyBriefingStats,
)
from app.services import hermes
from app.services.ai_client import get_ai_client
from app.services.audit import log_event

router = APIRouter(prefix="/assistant", tags=["assistant"])


def _staff_only(current_user: User = Depends(get_current_active_user)) -> User:
    if current_user.role == UserRoleEnum.CANDIDATE:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Not permitted")
    return current_user


@router.post("/query", response_model=AssistantQueryResponse)
def query_assistant(
    payload: AssistantQueryRequest,
    request: Request,
    db: Session = Depends(get_db),
    current_user: User = Depends(_staff_only),
    scope: CampusScope = Depends(get_campus_scope),
    dept_scope: DepartmentScope = Depends(get_department_scope),
    ai: anthropic.Anthropic = Depends(get_ai_client),
) -> AssistantQueryResponse:
    conversation_history = (
        [turn.model_dump() for turn in payload.conversation_history] if payload.conversation_history else None
    )
    answer, tools_used, actions = hermes.run_assistant_query(
        db,
        scope=scope,
        dept_scope=dept_scope,
        client=ai,
        question=payload.question,
        actor_role=current_user.role.value,
        conversation_history=conversation_history,
    )

    log_event(
        db,
        actor=current_user,
        action="ASSISTANT_QUERY",
        campus_context_id=scope.campus_id,
        after_state={
            "question": payload.question[:2000],
            "answer": answer[:4000],
            "tools_used": tools_used,
            "actions": actions,
        },
        request=request,
    )
    db.commit()
    return AssistantQueryResponse(
        answer=answer, tools_used=tools_used, actions=[AssistantAction(**action) for action in actions]
    )


@router.get("/daily-briefing", response_model=DailyBriefingResponse)
def get_daily_briefing(
    request: Request,
    db: Session = Depends(get_db),
    current_user: User = Depends(_staff_only),
    scope: CampusScope = Depends(get_campus_scope),
    ai: anthropic.Anthropic = Depends(get_ai_client),
) -> DailyBriefingResponse:
    stats = hermes.build_daily_briefing_stats(db, scope)
    narrative = hermes.narrate_daily_briefing(ai, stats)
    generated_at = datetime.now(timezone.utc)

    log_event(
        db,
        actor=current_user,
        action="ASSISTANT_DAILY_BRIEFING",
        campus_context_id=scope.campus_id,
        after_state={"stats": stats, "narrative": narrative[:4000]},
        request=request,
    )
    db.commit()
    return DailyBriefingResponse(stats=DailyBriefingStats(**stats), narrative=narrative, generated_at=generated_at)
