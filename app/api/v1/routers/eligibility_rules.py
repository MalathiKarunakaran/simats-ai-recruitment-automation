"""EligibilityRule master data -- extended (starter regulatory-eligibility-
rules feature, backend Phase 1) with filters/search/sort, a single-item read,
a duplicate-for-review action, an xlsx export, and bulk upload
(validate -> preview -> commit), mirroring `departments.py`'s own
just-landed shape (see `app/services/eligibility_rule_import.py` for the
validate/commit logic). The 4 shared, entity-agnostic bulk-upload endpoints
(list/error-report/original-file/undo) live in
`app/api/v1/routers/sanctioned_strength.py`, dispatched via
`BulkUploadLog.entity_type == ELIGIBILITY_RULE` -- not duplicated here, same
reuse `departments.py`/`locations.py`/`housekeeping_staff.py` already rely
on.

**Not campus-scoped for reads** -- unlike `departments.py`'s `list_departments`
(which forces non-global-scope roles onto their own campus), this endpoint
family was, before this feature, globally readable by any non-CANDIDATE
staff role with zero campus-scope check anywhere in this router (see git
history / the pre-existing `_staff_only` gate below). This feature preserves
that exact existing breadth rather than silently narrowing it -- `campus_id`
is added only as an optional filter any caller may use, not an enforced
scope. Same reasoning applies to the new single-item `GET /{id}` and
`POST /{id}/duplicate` below: introducing `enforce_campus_match` on just
those two endpoints would produce an inconsistent shape where list is global
but detail is campus-restricted, for a master-data table that was always
global. (Contrast with `applications.py`/`job_postings.py`, which import
`enforce_campus_match` because their own list endpoints already enforce
campus scope -- this table's own list never did.)

Write access stays exactly as before (SUPER_ADMIN/HR_ADMIN only).
"""

import io
import uuid
from datetime import date, datetime, timedelta, timezone
from typing import Literal

from fastapi import APIRouter, Depends, File, HTTPException, Query, Request, UploadFile, status
from fastapi.responses import StreamingResponse
from minio import Minio
from sqlalchemy import or_
from sqlalchemy.orm import Session, selectinload

from app.core.deps import get_current_active_user, get_db, require_roles
from app.models.bulk_upload_log import BulkUploadLog
from app.models.campus import Campus
from app.models.department import Department
from app.models.eligibility_rule import EligibilityRule
from app.models.enums import (
    BulkUploadEntityTypeEnum,
    BulkUploadStatusEnum,
    EligibilityRuleStatusEnum,
    RegulatoryAuthorityEnum,
    StaffRoleCategoryEnum,
    UserRoleEnum,
)
from app.models.user import User
from app.schemas.common import PaginatedResponse
from app.schemas.eligibility_rule import EligibilityRuleCreate, EligibilityRuleRead, EligibilityRuleUpdate
from app.schemas.eligibility_rule_import import (
    EligibilityRuleBulkUploadCommitResponse,
    EligibilityRuleBulkUploadRowPreview,
    EligibilityRuleBulkUploadValidationResponse,
)
from app.services import eligibility_rule_import, exports, storage
from app.services.audit import log_create, log_delete, log_event, log_update
from app.services.storage import get_minio_client

router = APIRouter(prefix="/eligibility-rules", tags=["eligibility-rules"])

_WRITE_ROLES = (UserRoleEnum.SUPER_ADMIN, UserRoleEnum.HR_ADMIN)
_XLSX_MEDIA_TYPE = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
_MAX_BULK_UPLOAD_BYTES = 10 * 1024 * 1024  # 10 MB, same cap as every other bulk-upload endpoint in this app

_SORT_FIELDS = Literal["position_title", "staff_category", "regulatory_authority", "status", "is_active", "created_at"]
_SORT_COLUMNS = {
    "position_title": EligibilityRule.position_title,
    "staff_category": EligibilityRule.staff_category,
    "regulatory_authority": EligibilityRule.regulatory_authority,
    "status": EligibilityRule.status,
    "is_active": EligibilityRule.is_active,
    "created_at": EligibilityRule.created_at,
}


def _rule_snapshot(rule: EligibilityRule) -> dict:
    return {
        "campus_id": rule.campus_id,
        "department_id": rule.department_id,
        "staff_category": rule.staff_category.value,
        "position_title": rule.position_title,
        "required_qualification_keyword": rule.required_qualification_keyword,
        "net_set_required": rule.net_set_required,
        "subject": rule.subject,
        "skills_keyword": rule.skills_keyword,
        "id_proof_required": rule.id_proof_required,
        "shift_preference": rule.shift_preference,
        "regulatory_authority": rule.regulatory_authority.value if rule.regulatory_authority else None,
        "school_or_college": rule.school_or_college,
        "programme_discipline": rule.programme_discipline,
        "minimum_qualification": rule.minimum_qualification,
        "minimum_percentage": rule.minimum_percentage,
        "required_experience": rule.required_experience,
        "required_credential": rule.required_credential,
        "required_keywords": rule.required_keywords,
        "preferred_keywords": rule.preferred_keywords,
        "phd_required": rule.phd_required,
        "professional_registration": rule.professional_registration,
        "industry_experience": rule.industry_experience,
        "priority": rule.priority,
        "effective_from": rule.effective_from.isoformat() if rule.effective_from else None,
        "effective_to": rule.effective_to.isoformat() if rule.effective_to else None,
        "source_regulation": rule.source_regulation,
        "status": rule.status.value if rule.status else None,
        "verification_required": rule.verification_required,
        "is_active": rule.is_active,
        "notes": rule.notes,
    }


def _staff_only(current_user: User = Depends(get_current_active_user)) -> User:
    if current_user.role == UserRoleEnum.CANDIDATE:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Not permitted")
    return current_user


def _get_or_404(db: Session, rule_id: uuid.UUID) -> EligibilityRule:
    rule = db.get(EligibilityRule, rule_id)
    if rule is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Not found")
    return rule


def _check_uniqueness_conflict(
    db: Session,
    *,
    campus_id: uuid.UUID,
    department_id: uuid.UUID | None,
    position_title: str | None,
    regulatory_authority: RegulatoryAuthorityEnum | None,
    effective_from: date | None,
    exclude_id: uuid.UUID | None = None,
) -> None:
    """Application-level uniqueness on the natural key (campus_id,
    department_id, position_title, regulatory_authority, effective_from).

    Deliberately NOT a DB-level `UniqueConstraint`: 4 of these 5 columns are
    nullable, and Postgres treats every NULL as distinct from every other
    NULL within a unique index -- so a real DB constraint would silently
    fail to catch the case we actually want flagged (e.g. two rows that both
    have department_id=NULL, position_title=NULL, regulatory_authority=NULL,
    effective_from=NULL for the same campus, which really is "the same
    starter row entered twice"). Same reasoning as Department's own
    Code+Campus uniqueness precedent (see
    `departments.py::_check_code_conflict`'s own docstring). Two rules for
    the same (campus, department, position) are explicitly allowed when
    `regulatory_authority` OR `effective_from` differ -- that's the whole
    point of this 5-field key.
    """
    query = db.query(EligibilityRule).filter(EligibilityRule.campus_id == campus_id)
    query = (
        query.filter(EligibilityRule.department_id == department_id)
        if department_id is not None
        else query.filter(EligibilityRule.department_id.is_(None))
    )
    query = (
        query.filter(EligibilityRule.position_title == position_title)
        if position_title is not None
        else query.filter(EligibilityRule.position_title.is_(None))
    )
    query = (
        query.filter(EligibilityRule.regulatory_authority == regulatory_authority)
        if regulatory_authority is not None
        else query.filter(EligibilityRule.regulatory_authority.is_(None))
    )
    query = (
        query.filter(EligibilityRule.effective_from == effective_from)
        if effective_from is not None
        else query.filter(EligibilityRule.effective_from.is_(None))
    )
    if exclude_id is not None:
        query = query.filter(EligibilityRule.id != exclude_id)
    conflict = query.first()
    if conflict is None:
        return
    raise HTTPException(
        status_code=status.HTTP_409_CONFLICT,
        detail=(
            "An eligibility rule already exists for the same campus, department, position title, "
            "regulatory authority, and effective_from. Use a different regulatory authority or "
            "effective_from to add a second rule for this combination, or edit the existing rule instead."
        ),
    )


def _base_query(
    db: Session,
    *,
    campus_id: uuid.UUID | None,
    department_id: uuid.UUID | None,
    staff_category: StaffRoleCategoryEnum | None,
    regulatory_authority: RegulatoryAuthorityEnum | None,
    position_title: str | None,
    rule_status: EligibilityRuleStatusEnum | None,
    is_active: bool | None,
    search: str | None,
):
    query = db.query(EligibilityRule)
    if campus_id is not None:
        query = query.filter(EligibilityRule.campus_id == campus_id)
    if department_id is not None:
        query = query.filter(EligibilityRule.department_id == department_id)
    if staff_category is not None:
        query = query.filter(EligibilityRule.staff_category == staff_category)
    if regulatory_authority is not None:
        query = query.filter(EligibilityRule.regulatory_authority == regulatory_authority)
    if position_title:
        query = query.filter(EligibilityRule.position_title.ilike(f"%{position_title}%"))
    if rule_status is not None:
        query = query.filter(EligibilityRule.status == rule_status)
    if is_active is not None:
        query = query.filter(EligibilityRule.is_active == is_active)
    if search:
        like = f"%{search}%"
        query = query.filter(
            or_(
                EligibilityRule.position_title.ilike(like),
                EligibilityRule.programme_discipline.ilike(like),
                EligibilityRule.school_or_college.ilike(like),
                EligibilityRule.notes.ilike(like),
            )
        )
    return query


def _apply_sort(query, sort_by: str, sort_dir: str):
    column = _SORT_COLUMNS[sort_by]
    return query.order_by(column.desc() if sort_dir == "desc" else column.asc())


@router.get("", response_model=PaginatedResponse[EligibilityRuleRead])
def list_eligibility_rules(
    limit: int = Query(50, ge=1, le=200),
    offset: int = Query(0, ge=0),
    campus_id: uuid.UUID | None = Query(None),
    department_id: uuid.UUID | None = Query(None),
    staff_category: StaffRoleCategoryEnum | None = Query(None),
    regulatory_authority: RegulatoryAuthorityEnum | None = Query(None),
    position_title: str | None = Query(None),
    status_: EligibilityRuleStatusEnum | None = Query(None, alias="status"),
    is_active: bool | None = Query(None),
    search: str | None = Query(None),
    sort_by: _SORT_FIELDS = Query("created_at"),
    sort_dir: Literal["asc", "desc"] = Query("desc"),
    db: Session = Depends(get_db),
    current_user: User = Depends(_staff_only),
) -> PaginatedResponse[EligibilityRuleRead]:
    query = _base_query(
        db,
        campus_id=campus_id,
        department_id=department_id,
        staff_category=staff_category,
        regulatory_authority=regulatory_authority,
        position_title=position_title,
        rule_status=status_,
        is_active=is_active,
        search=search,
    )
    total = query.count()
    query = _apply_sort(query, sort_by, sort_dir)
    rows = query.offset(offset).limit(limit).all()
    return PaginatedResponse(items=rows, total=total, limit=limit, offset=offset)


@router.get("/export")
def export_eligibility_rules(
    campus_id: uuid.UUID | None = Query(None),
    department_id: uuid.UUID | None = Query(None),
    staff_category: StaffRoleCategoryEnum | None = Query(None),
    regulatory_authority: RegulatoryAuthorityEnum | None = Query(None),
    position_title: str | None = Query(None),
    status_: EligibilityRuleStatusEnum | None = Query(None, alias="status"),
    is_active: bool | None = Query(None),
    search: str | None = Query(None),
    sort_by: _SORT_FIELDS = Query("created_at"),
    sort_dir: Literal["asc", "desc"] = Query("desc"),
    db: Session = Depends(get_db),
    current_user: User = Depends(_staff_only),
) -> StreamingResponse:
    """Same filters as `list_eligibility_rules` minus pagination -- exports
    every matching row, not just one page. xlsx only, same as every other
    export in this app."""
    query = _base_query(
        db,
        campus_id=campus_id,
        department_id=department_id,
        staff_category=staff_category,
        regulatory_authority=regulatory_authority,
        position_title=position_title,
        rule_status=status_,
        is_active=is_active,
        search=search,
    )
    query = _apply_sort(query, sort_by, sort_dir)
    rules = query.options(selectinload(EligibilityRule.campus), selectinload(EligibilityRule.department)).all()

    rows = [
        {
            "campus_code": rule.campus.code if rule.campus else None,
            "department_code": rule.department.code if rule.department else None,
            "staff_category": rule.staff_category.value if rule.staff_category else None,
            "position_title": rule.position_title,
            "regulatory_authority": rule.regulatory_authority.value if rule.regulatory_authority else None,
            "school_or_college": rule.school_or_college,
            "programme_discipline": rule.programme_discipline,
            "required_qualification_keyword": rule.required_qualification_keyword,
            "minimum_qualification": rule.minimum_qualification,
            "minimum_percentage": rule.minimum_percentage,
            "required_experience": rule.required_experience,
            "required_credential": rule.required_credential,
            "net_set_required": rule.net_set_required,
            "phd_required": rule.phd_required,
            "professional_registration": rule.professional_registration,
            "industry_experience": rule.industry_experience,
            "priority": rule.priority,
            "effective_from": rule.effective_from,
            "effective_to": rule.effective_to,
            "source_regulation": rule.source_regulation,
            "status": rule.status.value if rule.status else None,
            "verification_required": rule.verification_required,
            "is_active": rule.is_active,
            "notes": rule.notes,
        }
        for rule in rules
    ]
    scope_note = f"{len(rows)} eligibility rule(s) matching the applied filters."
    excel_bytes = exports.build_eligibility_rule_export_excel(rows, datetime.now(timezone.utc), scope_note)
    filename = f"simats-eligibility-rules-{datetime.now(timezone.utc):%Y%m%d}.xlsx"
    return StreamingResponse(
        io.BytesIO(excel_bytes),
        media_type=_XLSX_MEDIA_TYPE,
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


@router.get("/{rule_id}", response_model=EligibilityRuleRead)
def get_eligibility_rule(
    rule_id: uuid.UUID,
    db: Session = Depends(get_db),
    current_user: User = Depends(_staff_only),
) -> EligibilityRule:
    return _get_or_404(db, rule_id)


@router.post("", response_model=EligibilityRuleRead, status_code=status.HTTP_201_CREATED)
def create_eligibility_rule(
    payload: EligibilityRuleCreate,
    request: Request,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_roles(*_WRITE_ROLES)),
) -> EligibilityRule:
    if db.get(Campus, payload.campus_id) is None:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Unknown campus_id")
    if payload.department_id is not None and db.get(Department, payload.department_id) is None:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Unknown department_id")

    _check_uniqueness_conflict(
        db,
        campus_id=payload.campus_id,
        department_id=payload.department_id,
        position_title=payload.position_title,
        regulatory_authority=payload.regulatory_authority,
        effective_from=payload.effective_from,
    )

    rule = EligibilityRule(
        campus_id=payload.campus_id,
        department_id=payload.department_id,
        staff_category=payload.staff_category,
        position_title=payload.position_title,
        required_qualification_keyword=payload.required_qualification_keyword,
        net_set_required=payload.net_set_required,
        subject=payload.subject,
        skills_keyword=payload.skills_keyword,
        id_proof_required=payload.id_proof_required,
        shift_preference=payload.shift_preference,
        regulatory_authority=payload.regulatory_authority,
        school_or_college=payload.school_or_college,
        programme_discipline=payload.programme_discipline,
        minimum_qualification=payload.minimum_qualification,
        minimum_percentage=payload.minimum_percentage,
        required_experience=payload.required_experience,
        required_credential=payload.required_credential,
        required_keywords=payload.required_keywords,
        preferred_keywords=payload.preferred_keywords,
        phd_required=payload.phd_required,
        professional_registration=payload.professional_registration,
        industry_experience=payload.industry_experience,
        priority=payload.priority,
        effective_from=payload.effective_from,
        effective_to=payload.effective_to,
        source_regulation=payload.source_regulation,
        status=payload.status,
        verification_required=payload.verification_required,
        is_active=payload.is_active,
        notes=payload.notes,
    )
    db.add(rule)
    db.flush()

    log_create(
        db,
        actor=current_user,
        entity_type="EligibilityRule",
        entity=rule,
        campus_context_id=rule.campus_id,
        after_state=_rule_snapshot(rule),
        request=request,
    )
    db.commit()
    db.refresh(rule)
    return rule


@router.post("/{rule_id}/duplicate", response_model=EligibilityRuleRead, status_code=status.HTTP_201_CREATED)
def duplicate_eligibility_rule(
    rule_id: uuid.UUID,
    request: Request,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_roles(*_WRITE_ROLES)),
) -> EligibilityRule:
    """Copies every field from the source rule into a brand-new row for
    review/editing, EXCEPT it always forces status=DRAFT, is_active=False,
    verification_required=True regardless of what the source rule's own
    values were -- a duplicate is never live until a human reviews and
    re-activates it. Does NOT run the uniqueness check: a fresh DRAFT/
    inactive copy of an existing rule is expected to share the same natural
    key as its source (that's the point of "duplicate for review/editing"),
    and the uniqueness check exists to catch accidental double-entry of a
    live rule, not this deliberate copy.
    """
    source = _get_or_404(db, rule_id)

    marker = f"Duplicated from rule {source.id} on {date.today().isoformat()}."
    notes = f"{source.notes}\n{marker}" if source.notes else marker

    duplicate = EligibilityRule(
        campus_id=source.campus_id,
        department_id=source.department_id,
        staff_category=source.staff_category,
        position_title=source.position_title,
        required_qualification_keyword=source.required_qualification_keyword,
        net_set_required=source.net_set_required,
        subject=source.subject,
        skills_keyword=source.skills_keyword,
        id_proof_required=source.id_proof_required,
        shift_preference=source.shift_preference,
        regulatory_authority=source.regulatory_authority,
        school_or_college=source.school_or_college,
        programme_discipline=source.programme_discipline,
        minimum_qualification=source.minimum_qualification,
        minimum_percentage=source.minimum_percentage,
        required_experience=source.required_experience,
        required_credential=source.required_credential,
        required_keywords=source.required_keywords,
        preferred_keywords=source.preferred_keywords,
        phd_required=source.phd_required,
        professional_registration=source.professional_registration,
        industry_experience=source.industry_experience,
        priority=source.priority,
        effective_from=source.effective_from,
        effective_to=source.effective_to,
        source_regulation=source.source_regulation,
        # Forced regardless of the source row's own values.
        status=EligibilityRuleStatusEnum.DRAFT,
        verification_required=True,
        is_active=False,
        notes=notes,
    )
    db.add(duplicate)
    db.flush()

    log_create(
        db,
        actor=current_user,
        entity_type="EligibilityRule",
        entity=duplicate,
        campus_context_id=duplicate.campus_id,
        after_state=_rule_snapshot(duplicate),
        request=request,
    )
    db.commit()
    db.refresh(duplicate)
    return duplicate


@router.patch("/{rule_id}", response_model=EligibilityRuleRead)
def update_eligibility_rule(
    rule_id: uuid.UUID,
    payload: EligibilityRuleUpdate,
    request: Request,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_roles(*_WRITE_ROLES)),
) -> EligibilityRule:
    rule = _get_or_404(db, rule_id)

    if payload.campus_id is not None and db.get(Campus, payload.campus_id) is None:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Unknown campus_id")
    if payload.department_id is not None and db.get(Department, payload.department_id) is None:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Unknown department_id")

    updates = payload.model_dump(exclude_unset=True)

    # The uniqueness check only re-runs when at least one of the 5 natural-key
    # fields is actually part of this PATCH -- an unrelated field-only update
    # (e.g. just `notes`) never needs to re-check.
    _KEY_FIELDS = ("campus_id", "department_id", "position_title", "regulatory_authority", "effective_from")
    if any(field in updates for field in _KEY_FIELDS):
        _check_uniqueness_conflict(
            db,
            campus_id=updates.get("campus_id", rule.campus_id),
            department_id=updates.get("department_id", rule.department_id),
            position_title=updates.get("position_title", rule.position_title),
            regulatory_authority=updates.get("regulatory_authority", rule.regulatory_authority),
            effective_from=updates.get("effective_from", rule.effective_from),
            exclude_id=rule.id,
        )

    before = _rule_snapshot(rule)
    for field, value in updates.items():
        setattr(rule, field, value)

    log_update(
        db,
        actor=current_user,
        entity_type="EligibilityRule",
        entity=rule,
        campus_context_id=rule.campus_id,
        before_state=before,
        after_state=_rule_snapshot(rule),
        request=request,
    )
    db.commit()
    db.refresh(rule)
    return rule


@router.delete("/{rule_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_eligibility_rule(
    rule_id: uuid.UUID,
    request: Request,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_roles(*_WRITE_ROLES)),
) -> None:
    rule = _get_or_404(db, rule_id)

    # No dependency guard here, unlike the other master-data DELETEs in this
    # app: nothing in app/models/ holds a foreign key to eligibility_rules.id
    # (see app/services/eligibility.py -- rules are read live by (campus_id,
    # staff_category[, position_title]) match at submit-time, never stored
    # as a reference on another row), so there is no real dependent state a
    # soft delete here could orphan.
    before = _rule_snapshot(rule)
    rule.is_active = False

    log_delete(
        db,
        actor=current_user,
        entity_type="EligibilityRule",
        entity=rule,
        campus_context_id=rule.campus_id,
        before_state=before,
        request=request,
    )
    db.commit()


# --- Bulk upload (validate -> preview -> commit) ----------------------------
#
# Same shape as departments.py's own /bulk-upload/* family -- see
# app/services/eligibility_rule_import.py for the validate/commit logic. The
# batch-level history/error-report/original-file/undo endpoints deliberately
# stay in sanctioned_strength.py (same reuse locations.py/housekeeping_staff.py/
# departments.py already rely on).


def _read_upload_bytes(file: UploadFile) -> bytes:
    if not (file.filename or "").lower().endswith((".xlsx", ".csv")):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Only .xlsx or .csv files are accepted")
    data = file.file.read()
    if len(data) > _MAX_BULK_UPLOAD_BYTES:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="File exceeds the 10 MB limit")
    return data


def _row_to_preview(row: eligibility_rule_import.ImportRowResult) -> EligibilityRuleBulkUploadRowPreview:
    return EligibilityRuleBulkUploadRowPreview(
        row_number=row.row_number,
        status=row.status,
        error_reason=row.error_reason,
        campus_code=row.campus_code,
        department_code=row.department_code,
        staff_category=row.staff_category,
        position_title=row.position_title,
        required_qualification_keyword=row.required_qualification_keyword,
        net_set_required=row.net_set_required,
        subject=row.subject,
        skills_keyword=row.skills_keyword,
        id_proof_required=row.id_proof_required,
        shift_preference=row.shift_preference,
        regulatory_authority=row.regulatory_authority,
        school_or_college=row.school_or_college,
        programme_discipline=row.programme_discipline,
        minimum_qualification=row.minimum_qualification,
        minimum_percentage=row.minimum_percentage,
        required_experience=row.required_experience,
        required_credential=row.required_credential,
        required_keywords=row.required_keywords,
        preferred_keywords=row.preferred_keywords,
        phd_required=row.phd_required,
        professional_registration=row.professional_registration,
        industry_experience=row.industry_experience,
        priority=row.priority,
        effective_from=row.effective_from,
        effective_to=row.effective_to,
        source_regulation=row.source_regulation,
        rule_status=row.rule_status,
        verification_required=row.verification_required,
        is_active=row.is_active,
        notes=row.notes,
    )


@router.get("/bulk-upload/template")
def download_eligibility_rule_bulk_upload_template(
    db: Session = Depends(get_db),
    current_user: User = Depends(require_roles(*_WRITE_ROLES)),
) -> StreamingResponse:
    xlsx_bytes = eligibility_rule_import.build_bulk_upload_template_xlsx(db)
    return StreamingResponse(
        io.BytesIO(xlsx_bytes),
        media_type=_XLSX_MEDIA_TYPE,
        headers={"Content-Disposition": 'attachment; filename="eligibility_rule_bulk_upload_template.xlsx"'},
    )


@router.post("/bulk-upload/validate", response_model=EligibilityRuleBulkUploadValidationResponse)
def validate_eligibility_rule_bulk_upload(
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
    current_user: User = Depends(require_roles(*_WRITE_ROLES)),
) -> EligibilityRuleBulkUploadValidationResponse:
    """Parses+validates every row **without writing anything to the DB** --
    a pure preview, same no-server-side-cache contract as every other bulk
    upload in this app."""
    data = _read_upload_bytes(file)
    raw_rows = eligibility_rule_import.parse_rows(data, file.filename)
    validation = eligibility_rule_import.validate_rows(db, raw_rows)
    return EligibilityRuleBulkUploadValidationResponse(
        total=validation.total,
        created_count=validation.created_count,
        updated_count=validation.updated_count,
        unchanged_count=validation.unchanged_count,
        rejected_count=validation.rejected_count,
        rows=[_row_to_preview(row) for row in validation.rows],
    )


@router.post("/bulk-upload/commit", response_model=EligibilityRuleBulkUploadCommitResponse)
def commit_eligibility_rule_bulk_upload(
    request: Request,
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
    minio_client: Minio = Depends(get_minio_client),
    current_user: User = Depends(require_roles(*_WRITE_ROLES)),
) -> EligibilityRuleBulkUploadCommitResponse:
    """Re-validates the re-uploaded file defensively, then applies every
    non-rejected row's UPSERT in one DB transaction -- same all-or-nothing
    contract as every other bulk-upload commit endpoint. Writes exactly one
    BulkUploadLog row (entity_type=ELIGIBILITY_RULE) plus one
    BulkUploadRowLog row per non-rejected row.

    The original workbook's archival copy in `MINIO_BUCKET_BULK_UPLOADS` is
    attempted AFTER the real row commit, and is best-effort (retried with
    backoff, never raises -- see `storage.try_upload_bulk_upload_file`'s own
    docstring): a storage hiccup degrades to `storage_warning` in the
    response, it never rolls back or blocks the rows that were actually
    requested to be created/updated.
    """
    data = _read_upload_bytes(file)
    raw_rows = eligibility_rule_import.parse_rows(data, file.filename)
    validation = eligibility_rule_import.validate_rows(db, raw_rows)

    now = datetime.now(timezone.utc)
    log = BulkUploadLog(
        filename=file.filename or "upload",
        entity_type=BulkUploadEntityTypeEnum.ELIGIBILITY_RULE,
        uploaded_by_id=current_user.id,
        rows_total=validation.total,
        rows_created=validation.created_count,
        rows_updated=validation.updated_count,
        rows_rejected=validation.rejected_count,
        status=BulkUploadStatusEnum.COMPLETED,
        undo_deadline=now + timedelta(hours=24),
    )
    db.add(log)

    try:
        db.flush()  # assigns log.id, needed for the row-log FK

        eligibility_rule_import.commit_rows(db, validation=validation, bulk_upload_log_id=log.id)

        log_event(
            db,
            actor=current_user,
            action="ELIGIBILITY_RULE_BULK_UPLOAD_COMMITTED",
            entity_type="BulkUploadLog",
            entity_id=log.id,
            after_state={
                "filename": log.filename,
                "rows_total": log.rows_total,
                "rows_created": log.rows_created,
                "rows_updated": log.rows_updated,
                "rows_rejected": log.rows_rejected,
            },
            request=request,
        )
    except Exception:
        db.rollback()
        raise

    db.commit()
    db.refresh(log)

    # Archival is attempted only now that the real records are safely
    # committed -- its outcome can never change whether this request
    # reports success, only whether `storage_warning` is set.
    storage_key, storage_error = storage.try_upload_bulk_upload_file(
        minio_client,
        bulk_upload_log_id=log.id,
        filename=file.filename or "upload",
        data=data,
        content_type=file.content_type or "application/octet-stream",
    )
    storage_warning = None
    if storage_key is not None:
        log.stored_file_object_key = storage_key
        db.commit()
    else:
        storage_warning = (
            "Workbook storage is temporarily unavailable. The file was successfully parsed, "
            "but the original workbook could not be archived."
        )
        log_event(
            db,
            actor=current_user,
            action="ELIGIBILITY_RULE_BULK_UPLOAD_ARCHIVE_FAILED",
            entity_type="BulkUploadLog",
            entity_id=log.id,
            after_state={"error": storage_error},
            request=request,
        )
        db.commit()

    return EligibilityRuleBulkUploadCommitResponse(
        total=validation.total,
        created_count=validation.created_count,
        updated_count=validation.updated_count,
        unchanged_count=validation.unchanged_count,
        rejected_count=validation.rejected_count,
        rows=[_row_to_preview(row) for row in validation.rows],
        bulk_upload_log_id=log.id,
        storage_warning=storage_warning,
    )
