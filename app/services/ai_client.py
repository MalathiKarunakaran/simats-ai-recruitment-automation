"""Centralized Anthropic client construction and call patterns.

Every Claude call in this codebase goes through this module -- never import
`anthropic` directly in a router or another service file. This keeps the
model ID, structured-output schemas, and exception->HTTP mapping in one
place.

Model: claude-opus-4-8 for every call (current Anthropic guidance: always use
this unless a user explicitly names another model). Anthropic has no public
embeddings endpoint -- semantic similarity is handled by ChromaDB's own
default embedding function (see app/services/vector_store.py), not a Claude
call.
"""

import json

import anthropic
from fastapi import HTTPException, status

from app.core.config import settings
from app.models.vacancy_request import VacancyRequest

JD_JSON_SCHEMA = {
    "type": "object",
    "properties": {
        "role_overview": {"type": "string"},
        "responsibilities": {"type": "array", "items": {"type": "string"}},
        "required_qualifications": {"type": "array", "items": {"type": "string"}},
        "preferred_skills": {"type": "array", "items": {"type": "string"}},
        "application_process": {"type": "string"},
    },
    "required": [
        "role_overview",
        "responsibilities",
        "required_qualifications",
        "preferred_skills",
        "application_process",
    ],
    "additionalProperties": False,
}

RESUME_SCORE_JSON_SCHEMA = {
    "type": "object",
    "properties": {
        "eligibility_score": {"type": "number", "minimum": 0, "maximum": 100},
        "skill_match_pct": {"type": "number", "minimum": 0, "maximum": 100},
        "qualification_match_pct": {"type": "number", "minimum": 0, "maximum": 100},
        "experience_match_pct": {"type": "number", "minimum": 0, "maximum": 100},
        "publication_count": {"type": "integer", "minimum": 0},
        "overall_recruitment_score": {"type": "number", "minimum": 0, "maximum": 100},
        "rationale": {"type": "string"},
        "extracted_skills": {"type": "array", "items": {"type": "string"}},
        "extracted_qualification": {"type": "string"},
        "extracted_experience_years": {"type": "number", "minimum": 0},
        "missing_required_fields": {"type": "array", "items": {"type": "string"}},
    },
    "required": [
        "eligibility_score",
        "skill_match_pct",
        "qualification_match_pct",
        "experience_match_pct",
        "publication_count",
        "overall_recruitment_score",
        "rationale",
        "extracted_skills",
        "extracted_qualification",
        "extracted_experience_years",
        "missing_required_fields",
    ],
    "additionalProperties": False,
}

INTERVIEW_QUESTIONS_JSON_SCHEMA = {
    "type": "object",
    "properties": {
        "questions": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "category": {"type": "string"},
                    "question": {"type": "string"},
                },
                "required": ["category", "question"],
                "additionalProperties": False,
            },
        }
    },
    "required": ["questions"],
    "additionalProperties": False,
}

_JD_SYSTEM_PROMPT = """\
# Role
You are an expert HR and academic recruitment copywriter for SIMATS \
(Saveetha Institute of Medical and Technical Sciences), a NAAC A++ deemed \
university. You write clear, accurate, and inclusive job descriptions.

# Task
Generate a structured job description for the vacancy described in the \
user's message.

# Context
You will be given: campus, department, staff role category (Teaching / \
Non-Teaching / Housekeeping), position title, employment type, required \
qualification, required experience, salary band (if provided), priority, \
and any listed skills.

# Format
Respond with the structured JD fields defined by the response schema.

# Result
Produce a JD ready for human review and editing before publication. Do not \
fabricate salary figures beyond the given band. Do not invent accreditation \
or ranking claims not present in the provided context."""

_SCORING_SYSTEM_PROMPT = """\
You are an expert technical recruiter scoring how well a candidate's resume \
matches a job description. Extract structured facts from the resume and \
score the match against the job description's requirements. Be honest and \
calibrated: do not inflate scores for a resume that is a poor match, and do \
not penalize a strong resume for stylistic differences. If required \
information (e.g. total years of experience, a required qualification) is \
missing from the resume, list it in missing_required_fields rather than \
guessing."""

_QUESTION_GEN_SYSTEM_PROMPT = """\
You are an experienced interview panel coordinator. Given a job description \
and interview type, suggest a short list of well-targeted interview \
questions a panel could ask. Keep questions concise and specific to the \
role, not generic."""


def get_ai_client() -> anthropic.Anthropic:
    """FastAPI dependency -- overridden with a fake in tests.

    An empty/unset ANTHROPIC_API_KEY makes the SDK raise a plain TypeError
    (not an anthropic.AnthropicError) on the first call, which would
    otherwise surface as an unhandled 500. Fail clearly here instead.
    """
    if not settings.ANTHROPIC_API_KEY:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="AI features are not configured (ANTHROPIC_API_KEY is not set)",
        )
    return anthropic.Anthropic(api_key=settings.ANTHROPIC_API_KEY)


def _call(fn, *args, **kwargs):
    try:
        return fn(*args, **kwargs)
    except anthropic.RateLimitError as exc:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="AI service is rate-limited; please retry shortly",
        ) from exc
    except anthropic.APIConnectionError as exc:
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY, detail="Could not reach the AI service"
        ) from exc
    except anthropic.APIStatusError as exc:
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail=f"AI service returned an error ({exc.status_code})",
        ) from exc
    except anthropic.AnthropicError as exc:
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail="AI service call failed") from exc


def _parse_structured_json(response) -> dict:
    text_block = next((block for block in response.content if block.type == "text"), None)
    if text_block is None:
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY, detail="AI service returned an unexpected response"
        )
    try:
        return json.loads(text_block.text)
    except json.JSONDecodeError as exc:
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY, detail="AI service returned an unexpected response"
        ) from exc


def _jd_user_content(vacancy_request: VacancyRequest, additional_instructions: str | None) -> str:
    lines = [
        f"Campus: {vacancy_request.campus.code}",
        f"Department: {vacancy_request.department.name}",
        f"Staff role category: {vacancy_request.role_category.value}",
        f"Position title: {vacancy_request.position_title}",
        f"Employment type: {vacancy_request.employment_type.value}",
        f"Required qualification: {vacancy_request.qualification}",
        f"Required experience: {vacancy_request.experience_required}",
        f"Priority: {vacancy_request.priority.value}",
    ]
    if vacancy_request.salary_band_min or vacancy_request.salary_band_max:
        lines.append(f"Salary band: {vacancy_request.salary_band_min} - {vacancy_request.salary_band_max}")
    if vacancy_request.skills:
        lines.append(f"Skills: {', '.join(vacancy_request.skills)}")
    if additional_instructions:
        lines.append(f"Additional instructions from the requester: {additional_instructions}")
    return "\n".join(lines)


def generate_jd(
    client: anthropic.Anthropic, vacancy_request: VacancyRequest, additional_instructions: str | None
) -> dict:
    response = _call(
        client.messages.create,
        model=settings.ANTHROPIC_MODEL,
        max_tokens=4000,
        system=_JD_SYSTEM_PROMPT,
        messages=[{"role": "user", "content": _jd_user_content(vacancy_request, additional_instructions)}],
        output_config={"format": {"type": "json_schema", "schema": JD_JSON_SCHEMA}},
    )
    return _parse_structured_json(response)


def render_jd_text(jd_fields: dict) -> str:
    """Renders the structured JD fields into the plain-text jd_draft column."""
    parts = [
        "## Role Overview",
        jd_fields["role_overview"],
        "",
        "## Responsibilities",
        *[f"- {item}" for item in jd_fields["responsibilities"]],
        "",
        "## Required Qualifications",
        *[f"- {item}" for item in jd_fields["required_qualifications"]],
        "",
        "## Preferred Skills",
        *[f"- {item}" for item in jd_fields["preferred_skills"]],
        "",
        "## Application Process",
        jd_fields["application_process"],
    ]
    return "\n".join(parts)


def score_and_extract_resume(
    client: anthropic.Anthropic, *, jd_text: str, resume_text: str, semantic_similarity: float | None
) -> dict:
    similarity_note = (
        f"A separate semantic-similarity system scored this resume/JD pair at "
        f"{semantic_similarity:.1f}/100 -- use this as one signal among others, not the sole basis for your score."
        if semantic_similarity is not None
        else "No semantic-similarity score is available for this pair."
    )
    user_content = (
        f"# Job Description\n{jd_text}\n\n"
        f"# Resume Text\n{resume_text}\n\n"
        f"# Additional Signal\n{similarity_note}"
    )
    response = _call(
        client.messages.create,
        model=settings.ANTHROPIC_MODEL,
        max_tokens=6000,
        thinking={"type": "adaptive"},
        system=_SCORING_SYSTEM_PROMPT,
        messages=[{"role": "user", "content": user_content}],
        output_config={"format": {"type": "json_schema", "schema": RESUME_SCORE_JSON_SCHEMA}},
    )
    return _parse_structured_json(response)


def generate_interview_questions(
    client: anthropic.Anthropic, *, jd_text: str, interview_type: str, resume_text: str | None
) -> dict:
    user_content = f"# Job Description\n{jd_text}\n\n# Interview Type\n{interview_type}"
    if resume_text:
        user_content += f"\n\n# Candidate Resume\n{resume_text}"
    response = _call(
        client.messages.create,
        model=settings.ANTHROPIC_MODEL,
        max_tokens=2000,
        system=_QUESTION_GEN_SYSTEM_PROMPT,
        messages=[{"role": "user", "content": user_content}],
        output_config={"format": {"type": "json_schema", "schema": INTERVIEW_QUESTIONS_JSON_SCHEMA}},
    )
    return _parse_structured_json(response)


def call_with_tools(
    client: anthropic.Anthropic, *, system: str, tools: list[dict], messages: list[dict], max_tokens: int = 1500
):
    """Raw tool-use call for Module 14 (Hermes) -- returns the SDK response
    object as-is; the caller (app/services/hermes.py) branches on
    response.stop_reason and builds the next turn. tool_choice is left at
    the SDK default ("auto") so Claude can also answer with no tool call."""
    return _call(
        client.messages.create,
        model=settings.ANTHROPIC_MODEL,
        max_tokens=max_tokens,
        system=system,
        tools=tools,
        messages=messages,
    )


def generate_narrative(client: anthropic.Anthropic, *, system: str, user_content: str, max_tokens: int = 800) -> str:
    """Single-call plain-text generation (no output_config, no tools) --
    used for Module 14's daily-briefing narrative summary."""
    response = _call(
        client.messages.create,
        model=settings.ANTHROPIC_MODEL,
        max_tokens=max_tokens,
        system=system,
        messages=[{"role": "user", "content": user_content}],
    )
    text_block = next((block for block in response.content if block.type == "text"), None)
    if text_block is None:
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY, detail="AI service returned an unexpected response"
        )
    return text_block.text
