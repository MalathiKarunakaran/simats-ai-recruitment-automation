import uuid

import openai
from chromadb.api.models.Collection import Collection
from fastapi import APIRouter, Depends, HTTPException, Request, status
from minio import Minio
from sqlalchemy.orm import Session

from app.core.deps import CampusScope, enforce_campus_match, get_campus_scope, get_current_active_user, get_db, require_roles
from app.models.application import Application
from app.models.enums import UserRoleEnum
from app.models.resume_score import ResumeScore
from app.models.user import User
from app.schemas.resume_score import ResumeScoreRead
from app.services import resume_screening
from app.services.ai_client import get_openai_client
from app.services.storage import get_minio_client
from app.services.vector_store import get_chroma_collection

router = APIRouter(prefix="/applications", tags=["resume-screening"])

_WRITE_ROLES = (UserRoleEnum.RECRUITMENT_OFFICER, UserRoleEnum.HR_ADMIN, UserRoleEnum.SUPER_ADMIN)


def _staff_only(current_user: User = Depends(get_current_active_user)) -> User:
    if current_user.role == UserRoleEnum.CANDIDATE:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Not permitted")
    return current_user


def _get_application_or_404_scoped(db: Session, application_id: uuid.UUID, scope: CampusScope) -> Application:
    application = db.get(Application, application_id)
    if application is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Not found")
    enforce_campus_match(scope, application.campus_id)
    return application


@router.post("/{application_id}/screen", response_model=ResumeScoreRead)
def screen_application(
    application_id: uuid.UUID,
    request: Request,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_roles(*_WRITE_ROLES)),
    scope: CampusScope = Depends(get_campus_scope),
    minio_client: Minio = Depends(get_minio_client),
    chroma_collection: Collection = Depends(get_chroma_collection),
    ai: openai.OpenAI = Depends(get_openai_client),
) -> ResumeScore:
    application = _get_application_or_404_scoped(db, application_id, scope)
    score = resume_screening.run_screening(
        db,
        application=application,
        minio_client=minio_client,
        chroma_collection=chroma_collection,
        ai=ai,
        actor=current_user,
        request=request,
    )
    db.commit()
    db.refresh(score)
    return score


@router.get("/{application_id}/resume-score", response_model=ResumeScoreRead)
def get_resume_score(
    application_id: uuid.UUID,
    db: Session = Depends(get_db),
    current_user: User = Depends(_staff_only),
    scope: CampusScope = Depends(get_campus_scope),
) -> ResumeScore:
    application = _get_application_or_404_scoped(db, application_id, scope)
    score = db.query(ResumeScore).filter(ResumeScore.application_id == application.id).one_or_none()
    if score is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Not found")
    return score
