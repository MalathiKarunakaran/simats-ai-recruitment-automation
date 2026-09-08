"""Reopen / unpublish -- the undo half of the vacancy state machine.

Added 2026-09-08 after a Super Admin closed the live AC Helper requisition
five seconds after publishing it and found CLOSED was terminal. See
vacancy_workflow.reopen's docstring for why REJECTED/CANCELLED are
deliberately NOT reachable this way.
"""

from app.models.enums import (
    HiringSlotStatusEnum,
    JobPostingChannelStatusEnum,
    JobPostingStatusEnum,
    UserRoleEnum,
)
from app.models.hiring_slot import HiringSlot
from app.models.job_posting import JobPosting
from app.models.job_posting_channel import JobPostingChannel

from tests.conftest import auth_headers


def _close(client, vacancy, actor):
    return client.post(
        f"/api/v1/vacancy-requests/{vacancy.vacancy_request.id}/close", headers=auth_headers(client, actor)
    )


def _reopen(client, vacancy, actor):
    return client.post(
        f"/api/v1/vacancy-requests/{vacancy.vacancy_request.id}/reopen", headers=auth_headers(client, actor)
    )


def _unpublish(client, vacancy, actor):
    return client.post(
        f"/api/v1/vacancy-requests/{vacancy.vacancy_request.id}/unpublish",
        headers=auth_headers(client, actor),
    )


def _slots(db_session, vacancy):
    return (
        db_session.query(HiringSlot)
        .filter(HiringSlot.approved_vacancy_id == vacancy.approved_vacancy.id)
        .all()
    )


def test_reopen_restores_status_slots_and_posting(
    client, user_factory, published_vacancy_factory, db_session
):
    """The whole point: a mis-close is fully recoverable. Status, the
    approved vacancy's closed_at, the deleted OPEN slots and the posting all
    come back -- and the posting keeps its own JP number."""
    super_admin = user_factory(UserRoleEnum.SUPER_ADMIN)
    vacancy = published_vacancy_factory(slot_count=3)
    posting_number = vacancy.job_posting.posting_number

    assert _close(client, vacancy, super_admin).status_code == 200
    db_session.expire_all()
    assert _slots(db_session, vacancy) == []

    response = _reopen(client, vacancy, super_admin)
    assert response.status_code == 200
    assert response.json()["status"] == "PUBLISHED"

    db_session.expire_all()
    slots = _slots(db_session, vacancy)
    assert len(slots) == 3
    assert {slot.status for slot in slots} == {HiringSlotStatusEnum.OPEN}
    assert vacancy.approved_vacancy.closed_at is None
    assert vacancy.job_posting.status == JobPostingStatusEnum.PUBLISHED
    assert vacancy.job_posting.is_active is True
    assert vacancy.job_posting.closed_at is None
    assert vacancy.job_posting.posting_number == posting_number


def test_reopen_does_not_resurrect_slots_that_are_still_filled(
    client, user_factory, published_vacancy_factory, application_factory, db_session
):
    """A vacancy closed with a candidate already committed must reopen with
    only the MISSING slots recreated -- never a duplicate of the surviving
    RESERVED one, which would inflate the approved total."""
    super_admin = user_factory(UserRoleEnum.SUPER_ADMIN)
    vacancy = published_vacancy_factory(slot_count=2)
    application = application_factory(vacancy.job_posting, recorded_by=vacancy.hr_admin)
    client.patch(
        f"/api/v1/applications/{application.id}/status",
        headers=auth_headers(client, vacancy.hr_admin),
        json={"status": "SELECTED"},
    )
    assert _close(client, vacancy, super_admin).status_code == 200
    db_session.expire_all()
    assert len(_slots(db_session, vacancy)) == 1

    assert _reopen(client, vacancy, super_admin).status_code == 200
    db_session.expire_all()
    slots = _slots(db_session, vacancy)
    assert len(slots) == 2
    assert len({slot.slot_number for slot in slots}) == 2


def test_reopen_puts_retired_channels_back_for_review(
    client,
    user_factory,
    published_vacancy_factory,
    recruitment_channel_factory,
    channel_rule_factory,
    db_session,
):
    """Channels retired by the close come back as RECOMMENDED, not as
    whatever they were -- the recruiter re-reviews rather than the system
    silently re-declaring a channel POSTED."""
    super_admin = user_factory(UserRoleEnum.SUPER_ADMIN)
    channel = recruitment_channel_factory(code="CAREERS_PAGE")
    channel_rule_factory("Everything to the careers page", [channel])
    vacancy = published_vacancy_factory()

    assert (
        db_session.query(JobPostingChannel)
        .filter(JobPostingChannel.job_posting_id == vacancy.job_posting.id)
        .count()
    ), "the rule should have attached a channel at publish"

    assert _close(client, vacancy, super_admin).status_code == 200
    db_session.expire_all()
    assert {
        row.status
        for row in db_session.query(JobPostingChannel).filter(
            JobPostingChannel.job_posting_id == vacancy.job_posting.id
        )
    } == {JobPostingChannelStatusEnum.REMOVED}

    assert _reopen(client, vacancy, super_admin).status_code == 200
    db_session.expire_all()
    restored = (
        db_session.query(JobPostingChannel)
        .filter(JobPostingChannel.job_posting_id == vacancy.job_posting.id)
        .all()
    )
    assert {row.status for row in restored} == {JobPostingChannelStatusEnum.RECOMMENDED}
    assert all(row.removed_at is None for row in restored)


def test_reopen_is_super_admin_only(client, user_factory, published_vacancy_factory):
    """Deliberately tighter than CLOSE_VACANCY, which the live coordinators
    hold -- undoing an announced decision is a bigger call than making it."""
    super_admin = user_factory(UserRoleEnum.SUPER_ADMIN)
    hr_admin = user_factory(UserRoleEnum.HR_ADMIN)
    vacancy = published_vacancy_factory()
    assert _close(client, vacancy, super_admin).status_code == 200

    assert _reopen(client, vacancy, hr_admin).status_code == 403
    assert _reopen(client, vacancy, super_admin).status_code == 200


def test_reopen_rejected_from_a_status_that_is_not_closed(
    client, user_factory, published_vacancy_factory
):
    super_admin = user_factory(UserRoleEnum.SUPER_ADMIN)
    vacancy = published_vacancy_factory()
    response = _reopen(client, vacancy, super_admin)
    assert response.status_code == 409
    assert "PUBLISHED" in response.json()["detail"]


def test_unpublish_returns_to_approved_and_takes_the_ad_down(
    client, user_factory, published_vacancy_factory, db_session
):
    super_admin = user_factory(UserRoleEnum.SUPER_ADMIN)
    vacancy = published_vacancy_factory(slot_count=2)

    response = _unpublish(client, vacancy, super_admin)
    assert response.status_code == 200
    assert response.json()["status"] == "APPROVED"

    db_session.expire_all()
    assert vacancy.job_posting.status == JobPostingStatusEnum.CLOSED
    assert vacancy.job_posting.is_active is False
    # The approval itself survives: slots and the requisition are untouched.
    assert len(_slots(db_session, vacancy)) == 2
    assert vacancy.approved_vacancy.closed_at is None


def test_republish_after_unpublish_reuses_the_same_posting(
    client, user_factory, published_vacancy_factory, db_session
):
    """The reuse branch in publish. A second JobPosting row would break
    every one_or_none lookup AND hand the same vacancy a second JP number."""
    super_admin = user_factory(UserRoleEnum.SUPER_ADMIN)
    vacancy = published_vacancy_factory()
    posting_id = vacancy.job_posting.id
    posting_number = vacancy.job_posting.posting_number

    assert _unpublish(client, vacancy, super_admin).status_code == 200
    response = client.post(
        f"/api/v1/vacancy-requests/{vacancy.vacancy_request.id}/publish",
        headers=auth_headers(client, super_admin),
    )
    assert response.status_code == 200

    db_session.expire_all()
    postings = (
        db_session.query(JobPosting)
        .filter(JobPosting.approved_vacancy_id == vacancy.approved_vacancy.id)
        .all()
    )
    assert len(postings) == 1
    assert postings[0].id == posting_id
    assert postings[0].posting_number == posting_number
    assert postings[0].status == JobPostingStatusEnum.PUBLISHED


def test_unpublish_refused_once_a_candidate_has_applied(
    client, user_factory, published_vacancy_factory, application_factory
):
    super_admin = user_factory(UserRoleEnum.SUPER_ADMIN)
    vacancy = published_vacancy_factory()
    application_factory(vacancy.job_posting, recorded_by=vacancy.hr_admin)

    response = _unpublish(client, vacancy, super_admin)
    assert response.status_code == 409
    assert "already applied" in response.json()["detail"]


def test_unpublish_is_super_admin_only(client, user_factory, published_vacancy_factory):
    hr_admin = user_factory(UserRoleEnum.HR_ADMIN)
    vacancy = published_vacancy_factory()
    assert _unpublish(client, vacancy, hr_admin).status_code == 403
