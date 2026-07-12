"""Module 3: JD Generation Agent.

Uses an RTCFR-structured system prompt reconstructed for this build -- the
actual n8n JD-generation prompt template referenced in the master spec was
not available to this build; see README "Known stubs/decisions" for the
disclaimer. Human-in-the-loop: the generated jd_draft is plain, human-editable
text, reviewed/edited via the existing PATCH /vacancy-requests/{id} (DRAFT-only)
before submission -- this service does not publish anything on its own.
"""

import anthropic
from fastapi import Request
from sqlalchemy.orm import Session

from app.models.user import User
from app.models.vacancy_request import VacancyRequest
from app.services import ai_client
from app.services.audit import log_update


def generate_and_apply_jd(
    db: Session,
    *,
    vacancy_request: VacancyRequest,
    client: anthropic.Anthropic,
    additional_instructions: str | None,
    actor: User,
    request: Request | None = None,
) -> VacancyRequest:
    before = {"jd_draft": vacancy_request.jd_draft}

    jd_fields = ai_client.generate_jd(client, vacancy_request, additional_instructions)
    vacancy_request.jd_draft = ai_client.render_jd_text(jd_fields)

    log_update(
        db,
        actor=actor,
        entity_type="VacancyRequest",
        entity=vacancy_request,
        campus_context_id=vacancy_request.campus_id,
        before_state=before,
        after_state={"jd_draft": vacancy_request.jd_draft},
        request=request,
    )
    return vacancy_request
