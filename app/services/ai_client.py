"""Centralized AI client construction and call patterns.

As of the Module 14 ("Hermes") OpenAI port, everything in this codebase runs
on OpenAI (gpt-4o):

- generate_jd, score_and_extract_resume, generate_interview_questions -- the
  three structured-output calls behind Module 3 (JD generation) and Module 6
  (resume screening/interview questions).
- call_with_tools_openai, generate_narrative_openai -- Module 14 ("Hermes",
  assistant chat + daily briefing)'s tool-calling loop and single-call
  narrative generation, both via get_openai_client(). Hermes was originally
  built against Anthropic's tool_use content-block format; it was ported to
  OpenAI's `tools`/`tool_calls` function-calling shape (see
  app/services/hermes.py's module docstring) because production has a
  working OPENAI_API_KEY but no ANTHROPIC_API_KEY configured.

Never import `openai` directly in a router or another service file; always
go through get_openai_client()/the functions below.

get_ai_client()/call_with_tools()/generate_narrative() (Anthropic) are kept
here, unused by any current caller, in case Anthropic is reintroduced later --
not deleted as part of this port since removing them isn't needed to
complete it. `ANTHROPIC_API_KEY`/`ANTHROPIC_MODEL` remain valid config either
way.

Anthropic has no public embeddings endpoint -- semantic similarity is
handled by ChromaDB's own default embedding function (see
app/services/vector_store.py), not an LLM call either way.

Provider switch (2026-09-07, RMS step 6): `settings.AI_PROVIDER` picks who
answers. "openai" is OpenAI as before; "ollama" is a self-hosted Ollama
server reached through its OpenAI-compatible endpoint with the SAME
`openai.OpenAI` client class -- so get_openai_client() is still the one
dependency, `_call_openai` is still the one error mapper, and every call
below is unchanged apart from reading `settings.ai_model`. The two things a
local model needs that OpenAI does not are handled in one place each:
Qwen3's "thinking" is switched off per request (`_provider_extra`) and a
<think> preamble is stripped defensively from any content that still
carries one (`_strip_thinking`).
"""

import json
import re

import anthropic
import openai
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
    """FastAPI dependency -- overridden with a fake in tests. Anthropic-only;
    used by Module 14 (Hermes) alone (see module docstring).

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


def get_openai_client() -> openai.OpenAI:
    """FastAPI dependency -- overridden with a fake in tests. Backs every
    generation call in this module, whichever provider is configured.

    With AI_PROVIDER=ollama the same client class talks to the Ollama
    server's OpenAI-compatible endpoint; Ollama needs no key, so the SDK is
    given a placeholder (it refuses an empty one). A provider name that is
    neither is a deployment mistake, reported as the same 503 shape.
    """
    provider = settings.ai_provider
    if provider == "openai":
        if not settings.OPENAI_API_KEY:
            raise HTTPException(
                status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                detail="AI features are not configured (OPENAI_API_KEY is not set)",
            )
        return openai.OpenAI(api_key=settings.OPENAI_API_KEY)
    if provider == "ollama":
        if not settings.OLLAMA_BASE_URL.strip():
            raise HTTPException(
                status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                detail="AI features are not configured (OLLAMA_BASE_URL is not set)",
            )
        return openai.OpenAI(
            base_url=settings.ollama_openai_base_url,
            api_key="ollama",
            timeout=settings.OLLAMA_TIMEOUT_SECONDS,
        )
    raise HTTPException(
        status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
        detail=f"AI features are not configured (AI_PROVIDER={settings.AI_PROVIDER!r} is not openai or ollama)",
    )


_THINK_BLOCK = re.compile(r"<think>.*?</think>\s*", re.DOTALL)


def _strip_thinking(text: str) -> str:
    """Some reasoning models served locally prefix an answer with a
    <think>...</think> block in the content itself. Reasoning is switched
    off per request in `_provider_extra`, but a model that ignores that must
    not turn a valid JSON answer into a parse failure, so the block is
    removed here too."""
    return _THINK_BLOCK.sub("", text).strip()


def _provider_extra() -> dict:
    """Extra request fields for the configured provider. Ollama's
    OpenAI-compatible endpoint honours `reasoning_effort: "none"` to switch
    Qwen3's reasoning off -- a structured-output call has no use for it and
    it costs minutes on a CPU host. Established empirically 2026-09-07
    against Ollama 0.33: a top-level `think: false` is IGNORED there and the
    model spends its whole token budget in a separate `reasoning` field,
    leaving `content` empty; Qwen3's "/no_think" prompt switch is ignored
    too. OpenAI's own models would refuse the value, so it is sent to
    Ollama only."""
    if settings.ai_provider == "ollama":
        return {"reasoning_effort": "none"}
    return {}


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


def _call_openai(fn, *args, **kwargs):
    try:
        return fn(*args, **kwargs)
    except openai.RateLimitError as exc:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="AI service is rate-limited; please retry shortly",
        ) from exc
    except openai.APIConnectionError as exc:
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY, detail="Could not reach the AI service"
        ) from exc
    except openai.APIStatusError as exc:
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail=f"AI service returned an error ({exc.status_code})",
        ) from exc
    except openai.OpenAIError as exc:
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


def _parse_openai_structured_json(response) -> dict:
    content = response.choices[0].message.content if response.choices else None
    content = _strip_thinking(content) if content else content
    if not content:
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY, detail="AI service returned an unexpected response"
        )
    try:
        return json.loads(content)
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
    client: openai.OpenAI, vacancy_request: VacancyRequest, additional_instructions: str | None
) -> dict:
    response = _call_openai(
        client.chat.completions.create,
        model=settings.ai_model,
        **_provider_extra(),
        max_completion_tokens=4000,
        messages=[
            {"role": "system", "content": _JD_SYSTEM_PROMPT},
            {"role": "user", "content": _jd_user_content(vacancy_request, additional_instructions)},
        ],
        response_format={"type": "json_schema", "json_schema": {"name": "job_description", "schema": JD_JSON_SCHEMA, "strict": True}},
    )
    return _parse_openai_structured_json(response)


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
    client: openai.OpenAI, *, jd_text: str, resume_text: str, semantic_similarity: float | None
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
    response = _call_openai(
        client.chat.completions.create,
        model=settings.ai_model,
        **_provider_extra(),
        max_completion_tokens=6000,
        messages=[
            {"role": "system", "content": _SCORING_SYSTEM_PROMPT},
            {"role": "user", "content": user_content},
        ],
        response_format={
            "type": "json_schema",
            "json_schema": {"name": "resume_score", "schema": RESUME_SCORE_JSON_SCHEMA, "strict": True},
        },
    )
    return _parse_openai_structured_json(response)


def generate_interview_questions(
    client: openai.OpenAI, *, jd_text: str, interview_type: str, resume_text: str | None
) -> dict:
    user_content = f"# Job Description\n{jd_text}\n\n# Interview Type\n{interview_type}"
    if resume_text:
        user_content += f"\n\n# Candidate Resume\n{resume_text}"
    response = _call_openai(
        client.chat.completions.create,
        model=settings.ai_model,
        **_provider_extra(),
        max_completion_tokens=2000,
        messages=[
            {"role": "system", "content": _QUESTION_GEN_SYSTEM_PROMPT},
            {"role": "user", "content": user_content},
        ],
        response_format={
            "type": "json_schema",
            "json_schema": {
                "name": "interview_questions",
                "schema": INTERVIEW_QUESTIONS_JSON_SCHEMA,
                "strict": True,
            },
        },
    )
    return _parse_openai_structured_json(response)


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


def call_with_tools_openai(
    client: openai.OpenAI, *, messages: list[dict], tools: list[dict], max_completion_tokens: int = 1500
):
    """Raw OpenAI chat-completions call for Module 14 (Hermes)'s tool-calling
    loop -- returns the SDK response object as-is; the caller
    (app/services/hermes.py) branches on
    response.choices[0].message.tool_calls and builds the next turn.
    `tool_choice="auto"` (the SDK default when `tools` is given) so the
    model can also answer with no tool call, matching this loop's previous
    Anthropic behavior. This establishes this codebase's first tool-calling
    OpenAI integration -- no other OpenAI call site here uses `tools` -- so
    it follows OpenAI's own standard Chat Completions tool-calling shape
    rather than inventing a new convention."""
    return _call_openai(
        client.chat.completions.create,
        model=settings.ai_model,
        **_provider_extra(),
        max_completion_tokens=max_completion_tokens,
        messages=messages,
        tools=tools,
        tool_choice="auto",
    )


def generate_narrative_openai(
    client: openai.OpenAI, *, system: str, user_content: str, max_completion_tokens: int = 800
) -> str:
    """Single-call plain-text generation (no tools) -- used for Module 14's
    daily-briefing narrative summary."""
    response = _call_openai(
        client.chat.completions.create,
        model=settings.ai_model,
        **_provider_extra(),
        max_completion_tokens=max_completion_tokens,
        messages=[{"role": "system", "content": system}, {"role": "user", "content": user_content}],
    )
    content = response.choices[0].message.content if response.choices else None
    content = _strip_thinking(content) if content else content
    if not content:
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY, detail="AI service returned an unexpected response"
        )
    return content
