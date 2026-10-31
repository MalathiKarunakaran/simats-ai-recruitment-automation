"""'Last updated by' (pipeline brief Phase 6, decision B) --
app/services/last_updated.py and its two API surfaces."""

from datetime import date, datetime, timedelta, timezone

from sqlalchemy import event

from app.models.audit_log import AuditLog
from app.models.enums import UserRoleEnum
from app.models.joining import JoiningDocument, JoiningRecord
from app.services.last_updated import last_updated_by

from tests.conftest import auth_headers

T0 = datetime(2026, 10, 1, 9, 0, tzinfo=timezone.utc)


def _audit(db, entity_type, entity_id, actor, at):
    db.add(
        AuditLog(
            action="UPDATE",
            entity_type=entity_type,
            entity_id=entity_id,
            actor_user_id=actor.id if actor else None,
            created_at=at,
        )
    )
    db.flush()


def _setup(db_session, published_vacancy_factory, application_factory, user_factory):
    vacancy = published_vacancy_factory(slot_count=3)
    hr = vacancy.hr_admin
    officer = vacancy.recruitment_officer
    other = user_factory(UserRoleEnum.HR_ADMIN)
    first, second, third = (application_factory(vacancy.job_posting, recorded_by=hr) for _ in range(3))
    return vacancy, hr, officer, other, first, second, third


def test_latest_actor_across_application_and_joining_rows(
    db_session, published_vacancy_factory, application_factory, user_factory
):
    vacancy, hr, officer, other, first, second, third = _setup(
        db_session, published_vacancy_factory, application_factory, user_factory
    )

    record = JoiningRecord(application_id=first.id, joining_date=date(2026, 10, 5))
    document = JoiningDocument(application_id=first.id, document_type="PAN")
    db_session.add_all([record, document])
    db_session.flush()

    _audit(db_session, "Application", first.id, hr, T0)
    _audit(db_session, "JoiningRecord", record.id, officer, T0 + timedelta(hours=1))
    _audit(db_session, "JoiningDocument", document.id, other, T0 + timedelta(hours=2))
    # Newer, but not about this application at all: a different entity type
    # carrying the application's id must not count, nor an unlinked entity.
    _audit(db_session, "Offer", first.id, hr, T0 + timedelta(hours=5))
    _audit(db_session, "JoiningRecord", first.id, hr, T0 + timedelta(hours=5))

    _audit(db_session, "Application", second.id, hr, T0)
    _audit(db_session, "Application", second.id, None, T0 + timedelta(hours=3))  # system / sync write

    result = last_updated_by(db_session, [first.id, second.id, third.id])

    assert result[first.id] == (other.full_name, T0 + timedelta(hours=2))
    assert result[second.id] == (None, T0 + timedelta(hours=3))
    assert third.id not in result  # no audit row at all


def test_application_row_newer_than_joining_row_wins(
    db_session, published_vacancy_factory, application_factory, user_factory
):
    vacancy, hr, officer, other, first, *_ = _setup(
        db_session, published_vacancy_factory, application_factory, user_factory
    )
    record = JoiningRecord(application_id=first.id, joining_date=date(2026, 10, 5))
    db_session.add(record)
    db_session.flush()
    _audit(db_session, "JoiningRecord", record.id, officer, T0)
    _audit(db_session, "Application", first.id, hr, T0 + timedelta(minutes=1))

    assert last_updated_by(db_session, [first.id])[first.id] == (hr.full_name, T0 + timedelta(minutes=1))


def test_many_ids_in_one_query(db_session, published_vacancy_factory, application_factory, user_factory):
    vacancy, hr, officer, other, *_ = _setup(
        db_session, published_vacancy_factory, application_factory, user_factory
    )
    applications = [application_factory(vacancy.job_posting, recorded_by=hr) for _ in range(12)]
    for index, application in enumerate(applications):
        _audit(db_session, "Application", application.id, hr if index % 2 else officer, T0 + timedelta(minutes=index))

    statements = []

    def _count(conn, cursor, statement, parameters, context, executemany):
        statements.append(statement)

    engine = db_session.get_bind().engine
    event.listen(engine, "before_cursor_execute", _count)
    try:
        result = last_updated_by(db_session, [application.id for application in applications])
    finally:
        event.remove(engine, "before_cursor_execute", _count)

    assert len(statements) == 1
    assert len(result) == 12
    assert result[applications[3].id] == (hr.full_name, T0 + timedelta(minutes=3))
    assert result[applications[4].id] == (officer.full_name, T0 + timedelta(minutes=4))


def test_empty_ids_runs_no_query(db_session):
    assert last_updated_by(db_session, []) == {}


def test_list_and_detail_carry_last_updated(
    client, db_session, published_vacancy_factory, application_factory, user_factory
):
    vacancy, hr, officer, other, first, second, third = _setup(
        db_session, published_vacancy_factory, application_factory, user_factory
    )
    _audit(db_session, "Application", first.id, officer, T0)
    _audit(db_session, "Application", second.id, None, T0)

    headers = auth_headers(client, hr)
    detail = client.get(f"/api/v1/applications/{first.id}", headers=headers)
    assert detail.status_code == 200
    assert detail.json()["last_updated_by_name"] == officer.full_name
    assert datetime.fromisoformat(detail.json()["last_updated_at"]) == T0

    listing = client.get(
        "/api/v1/applications", headers=headers, params={"job_posting_id": str(vacancy.job_posting.id)}
    )
    assert listing.status_code == 200
    rows = {row["id"]: row for row in listing.json()["items"]}
    assert rows[str(first.id)]["last_updated_by_name"] == officer.full_name
    assert rows[str(second.id)]["last_updated_by_name"] is None
    assert rows[str(second.id)]["last_updated_at"] is not None
    assert rows[str(third.id)]["last_updated_at"] is None


def test_real_status_move_is_attributed(client, db_session, published_vacancy_factory, application_factory):
    vacancy = published_vacancy_factory(slot_count=1)
    application = application_factory(vacancy.job_posting, recorded_by=vacancy.hr_admin)
    headers = auth_headers(client, vacancy.hr_admin)

    moved = client.patch(
        f"/api/v1/applications/{application.id}/status", headers=headers, json={"status": "SCREENING"}
    )
    assert moved.status_code == 200, moved.text

    detail = client.get(f"/api/v1/applications/{application.id}", headers=headers).json()
    assert detail["last_updated_by_name"] == vacancy.hr_admin.full_name
