"""Module 6: AI Resume Screening Agent.

Orchestrates: MinIO fetch -> PDF text extraction -> ChromaDB semantic
similarity + near-duplicate lookup -> Claude structured scoring/extraction ->
write ResumeScore.
"""

import io
from datetime import datetime, timezone

import openai
from fastapi import HTTPException, Request, status
from minio import Minio
from pypdf import PdfReader
from sqlalchemy.orm import Session

from app.core.config import settings
from app.models.application import Application
from app.models.resume_score import ResumeScore
from app.models.user import User
from app.services import ai_client, storage, vector_store
from app.services.audit import log_create, log_update

_MIN_RESUME_TEXT_LENGTH = 200


def _extract_pdf_text(data: bytes) -> str:
    reader = PdfReader(io.BytesIO(data))
    pages_text = [page.extract_text() or "" for page in reader.pages]
    return "\n".join(pages_text).strip()


def run_screening(
    db: Session,
    *,
    application: Application,
    minio_client: Minio,
    chroma_collection,
    ai: openai.OpenAI,
    actor: User,
    request: Request | None = None,
) -> ResumeScore:
    candidate = application.candidate
    if not candidate.resume_storage_key:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST, detail="Candidate has no uploaded resume"
        )

    vacancy_request = application.job_posting.approved_vacancy.vacancy_request
    jd_text = vacancy_request.jd_draft or (
        f"{vacancy_request.position_title}\nQualification: {vacancy_request.qualification}\n"
        f"Experience: {vacancy_request.experience_required}"
    )

    resume_bytes = storage.download_resume_bytes(minio_client, candidate.resume_storage_key)
    resume_text = _extract_pdf_text(resume_bytes)

    incomplete_reasons: list[str] = []
    if len(resume_text) < _MIN_RESUME_TEXT_LENGTH:
        incomplete_reasons.append("RESUME_TEXT_TOO_SHORT")
    if not candidate.phone_number:
        incomplete_reasons.append("MISSING_PHONE_NUMBER")

    vector_store.upsert_resume_embedding(chroma_collection, candidate_id=candidate.id, resume_text=resume_text)
    semantic_similarity = vector_store.jd_similarity_for_candidate(
        chroma_collection, candidate_id=candidate.id, jd_text=jd_text
    )
    duplicate_of = vector_store.find_near_duplicate(
        chroma_collection, candidate_id=candidate.id, resume_text=resume_text
    )

    ai_result = ai_client.score_and_extract_resume(
        ai, jd_text=jd_text, resume_text=resume_text, semantic_similarity=semantic_similarity
    )
    if ai_result.get("missing_required_fields"):
        incomplete_reasons.extend(ai_result["missing_required_fields"])

    existing = db.query(ResumeScore).filter(ResumeScore.application_id == application.id).one_or_none()
    now = datetime.now(timezone.utc)

    if existing is not None:
        before = {"overall_recruitment_score": existing.overall_recruitment_score}
        score = existing
    else:
        before = None
        score = ResumeScore(application_id=application.id)
        db.add(score)

    score.eligibility_score = ai_result["eligibility_score"]
    score.skill_match_pct = ai_result["skill_match_pct"]
    score.qualification_match_pct = ai_result["qualification_match_pct"]
    score.experience_match_pct = ai_result["experience_match_pct"]
    score.publication_count = ai_result["publication_count"]
    score.overall_recruitment_score = ai_result["overall_recruitment_score"]
    score.semantic_similarity_score = semantic_similarity
    score.rationale = ai_result["rationale"]
    score.extracted_skills = ai_result["extracted_skills"]
    score.extracted_qualification = ai_result["extracted_qualification"]
    score.extracted_experience_years = ai_result["extracted_experience_years"]
    score.is_duplicate = duplicate_of is not None
    score.duplicate_of_candidate_id = duplicate_of
    score.is_incomplete_profile = bool(incomplete_reasons)
    score.incomplete_reasons = incomplete_reasons or None
    score.screened_at = now
    score.screened_by_id = actor.id
    score.model_version = settings.OPENAI_MODEL

    db.flush()

    if existing is not None:
        log_update(
            db,
            actor=actor,
            entity_type="ResumeScore",
            entity=score,
            campus_context_id=application.campus_id,
            before_state=before,
            after_state={"overall_recruitment_score": score.overall_recruitment_score},
            request=request,
        )
    else:
        log_create(
            db,
            actor=actor,
            entity_type="ResumeScore",
            entity=score,
            campus_context_id=application.campus_id,
            after_state={"overall_recruitment_score": score.overall_recruitment_score},
            request=request,
        )

    return score
