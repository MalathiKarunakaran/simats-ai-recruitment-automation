"""The campus PhD mandate, checked against the CANDIDATE at resume screening
and enforced at the interview line (2026-09-05).

Rule = an ACTIVE TEACHING EligibilityRule with phd_required at the campus
(scripts/seed_phd_mandate_rules.py creates the institutional ones). A
Teaching resume that shows no PhD at such a campus is flagged, its
eligibility score zeroed, and it cannot be called for interview -- or moved
past that point by any path, including scheduling an interview -- unless HR
Admin / Super Admin overrides with an audited reason.
"""

import json

from app.models.audit_log import AuditLog
from app.models.eligibility_rule import EligibilityRule
from app.models.enums import EligibilityRuleStatusEnum, StaffRoleCategoryEnum, UserRoleEnum
from app.services.eligibility import PHD_MANDATE_REASON_PREFIX
from scripts.seed_phd_mandate_rules import seed_phd_mandate_rules
from tests.conftest import FakeOpenAIChoiceMessage, FakeOpenAIResponse, _default_openai_response, auth_headers
from tests.test_resume_screening import _upload_resume


def _screening_that_extracts(qualification: str):
    """The canned screening answer, with the extracted qualification swapped."""

    def provider(kwargs):
        response = _default_openai_response(kwargs)
        content = response.choices[0].message.content
        if content and "eligibility_score" in content:
            data = json.loads(content)
            data["extracted_qualification"] = qualification
            return FakeOpenAIResponse(FakeOpenAIChoiceMessage(content=json.dumps(data)))
        return response

    return provider


def _mandate(db_session, campus, *, department=None, position_title=None) -> EligibilityRule:
    rule = EligibilityRule(
        campus_id=campus.id,
        staff_category=StaffRoleCategoryEnum.TEACHING,
        position_title=position_title,
        department_id=department.id if department is not None else None,
        required_qualification_keyword="PHD",
        phd_required=True,
        is_active=True,
        status=EligibilityRuleStatusEnum.ACTIVE,
        verification_required=False,
    )
    db_session.add(rule)
    db_session.flush()
    return rule


def _screened_application(client, fake_openai_client, vacancy, application_factory, candidate_factory, qualification):
    candidate = candidate_factory(phone_number="+91 9876543210")
    _upload_resume(client, candidate.id, vacancy.hr_admin)
    application = application_factory(vacancy.job_posting, recorded_by=vacancy.hr_admin, candidate=candidate)
    fake_openai_client.response_provider = _screening_that_extracts(qualification)
    response = client.post(f"/api/v1/applications/{application.id}/screen", headers=auth_headers(client, vacancy.hr_admin))
    assert response.status_code == 200, response.text
    return application, response.json()


def _advance(client, actor, application, to_status, **extra):
    return client.patch(
        f"/api/v1/applications/{application.id}/status",
        headers=auth_headers(client, actor),
        json={"status": to_status, **extra},
    )


def _application(client, actor, application):
    return client.get(f"/api/v1/applications/{application.id}", headers=auth_headers(client, actor)).json()


# ----------------------------------------------------------------- screening


def test_no_phd_at_a_mandate_campus_is_flagged_and_scored_zero(
    client, fake_openai_client, published_vacancy_factory, application_factory, candidate_factory, db_session
):
    vacancy = published_vacancy_factory(campus_code="SSE", slot_count=1)
    _mandate(db_session, vacancy.campus)
    application, score = _screened_application(
        client, fake_openai_client, vacancy, application_factory, candidate_factory, "M.E. Computer Science"
    )
    assert score["eligibility_score"] == 0.0
    assert score["extracted_qualification"] == "M.E. Computer Science"
    detail = _application(client, vacancy.hr_admin, application)
    assert detail["qualification_mismatch"] is True
    assert detail["qualification_mismatch_reason"].startswith(PHD_MANDATE_REASON_PREFIX)
    assert "SSE" in detail["qualification_mismatch_reason"]
    assert "M.E. Computer Science" in detail["qualification_mismatch_reason"]


def test_phd_holder_at_a_mandate_campus_is_not_flagged(
    client, fake_openai_client, published_vacancy_factory, application_factory, candidate_factory, db_session
):
    vacancy = published_vacancy_factory(campus_code="SSE", slot_count=1)
    _mandate(db_session, vacancy.campus)
    application, score = _screened_application(
        client, fake_openai_client, vacancy, application_factory, candidate_factory, "Ph.D. in Physics"
    )
    assert score["eligibility_score"] == 82.5
    assert _application(client, vacancy.hr_admin, application)["qualification_mismatch"] is False


def test_no_phd_at_a_campus_without_a_mandate_is_not_flagged(
    client, fake_openai_client, published_vacancy_factory, application_factory, candidate_factory
):
    vacancy = published_vacancy_factory(campus_code="SCAD", slot_count=1)
    application, score = _screened_application(
        client, fake_openai_client, vacancy, application_factory, candidate_factory, "M.Arch"
    )
    assert score["eligibility_score"] == 82.5
    assert _application(client, vacancy.hr_admin, application)["qualification_mismatch"] is False


def test_mandate_does_not_apply_to_non_teaching(
    client, fake_openai_client, published_vacancy_factory, application_factory, candidate_factory, db_session
):
    vacancy = published_vacancy_factory(
        campus_code="SSE", slot_count=1, role_category=StaffRoleCategoryEnum.NON_TEACHING
    )
    _mandate(db_session, vacancy.campus)
    application, score = _screened_application(
        client, fake_openai_client, vacancy, application_factory, candidate_factory, "Diploma in Electronics"
    )
    assert score["eligibility_score"] == 82.5
    assert _application(client, vacancy.hr_admin, application)["qualification_mismatch"] is False


def test_department_specific_mandate_applies_only_to_that_department(
    client,
    fake_openai_client,
    published_vacancy_factory,
    application_factory,
    candidate_factory,
    department_factory,
    db_session,
):
    vacancy = published_vacancy_factory(campus_code="SPIER", slot_count=1)
    other_department = department_factory("SPIER", name="Some Other Department")
    _mandate(db_session, vacancy.campus, department=other_department)
    application, score = _screened_application(
        client, fake_openai_client, vacancy, application_factory, candidate_factory, "M.Ed."
    )
    assert score["eligibility_score"] == 82.5
    assert _application(client, vacancy.hr_admin, application)["qualification_mismatch"] is False


def test_rescreen_with_a_phd_resume_clears_the_flag(
    client, fake_openai_client, published_vacancy_factory, application_factory, candidate_factory, db_session
):
    vacancy = published_vacancy_factory(campus_code="SCLAS", slot_count=1)
    _mandate(db_session, vacancy.campus)
    application, _ = _screened_application(
        client, fake_openai_client, vacancy, application_factory, candidate_factory, "M.Com"
    )
    assert _application(client, vacancy.hr_admin, application)["qualification_mismatch"] is True

    fake_openai_client.response_provider = _screening_that_extracts("Doctorate in Commerce")
    rescreen = client.post(f"/api/v1/applications/{application.id}/screen", headers=auth_headers(client, vacancy.hr_admin))
    assert rescreen.status_code == 200
    assert rescreen.json()["eligibility_score"] == 82.5
    detail = _application(client, vacancy.hr_admin, application)
    assert detail["qualification_mismatch"] is False
    assert detail["qualification_mismatch_reason"] is None


# ------------------------------------------------------------ interview line


def test_flagged_candidate_cannot_be_called_for_interview_without_an_override(
    client, fake_openai_client, published_vacancy_factory, application_factory, candidate_factory, db_session
):
    vacancy = published_vacancy_factory(campus_code="SSE", slot_count=1)
    _mandate(db_session, vacancy.campus)
    application, _ = _screened_application(
        client, fake_openai_client, vacancy, application_factory, candidate_factory, "M.Tech"
    )
    assert _advance(client, vacancy.hr_admin, application, "SCREENING").status_code == 200

    blocked = _advance(client, vacancy.hr_admin, application, "CALLED_FOR_INTERVIEW")
    assert blocked.status_code == 409
    assert blocked.json()["detail"].startswith(PHD_MANDATE_REASON_PREFIX)
    assert "eligibility_override_reason" in blocked.json()["detail"]

    # Skipping straight past the interview line is refused just the same.
    assert _advance(client, vacancy.hr_admin, application, "INTERVIEWED").status_code == 409
    # Rejecting is still allowed: the mandate blocks progress, not closure.
    assert _application(client, vacancy.hr_admin, application)["status"] == "SCREENING"


def test_scheduling_an_interview_for_a_flagged_candidate_is_refused(
    client,
    fake_openai_client,
    published_vacancy_factory,
    application_factory,
    candidate_factory,
    user_factory,
    db_session,
):
    vacancy = published_vacancy_factory(campus_code="SSE", slot_count=1)
    _mandate(db_session, vacancy.campus)
    application, _ = _screened_application(
        client, fake_openai_client, vacancy, application_factory, candidate_factory, "M.Tech"
    )
    panel = user_factory(UserRoleEnum.INTERVIEW_PANEL_MEMBER, campus_code="SSE")
    response = client.post(
        "/api/v1/interviews",
        headers=auth_headers(client, vacancy.hr_admin),
        json={
            "application_id": str(application.id),
            "interview_type": "TECHNICAL",
            "scheduled_at": "2030-01-10T10:00:00Z",
            "panel_member_ids": [str(panel.id)],
        },
    )
    assert response.status_code == 409, response.text
    assert PHD_MANDATE_REASON_PREFIX in response.json()["detail"]


def test_hr_admin_can_override_with_a_reason_and_it_is_audited(
    client, fake_openai_client, published_vacancy_factory, application_factory, candidate_factory, db_session
):
    vacancy = published_vacancy_factory(campus_code="SSE", slot_count=1)
    _mandate(db_session, vacancy.campus)
    application, _ = _screened_application(
        client, fake_openai_client, vacancy, application_factory, candidate_factory, "M.Tech"
    )
    blank = _advance(client, vacancy.hr_admin, application, "CALLED_FOR_INTERVIEW", eligibility_override_reason="  ")
    assert blank.status_code == 409

    ok = _advance(
        client,
        vacancy.hr_admin,
        application,
        "CALLED_FOR_INTERVIEW",
        eligibility_override_reason="Director approved: 15 years of industry experience",
    )
    assert ok.status_code == 200, ok.text
    assert ok.json()["status"] == "CALLED_FOR_INTERVIEW"
    # The flag stays on the record as information; the override is in the audit trail.
    assert ok.json()["qualification_mismatch"] is True

    rows = db_session.query(AuditLog).filter(AuditLog.entity_type == "Application", AuditLog.entity_id == application.id).all()
    overrides = [r for r in rows if "eligibility_override_reason" in (r.after_state or {})]
    assert len(overrides) == 1
    row = overrides[0]
    assert row.after_state["status"] == "CALLED_FOR_INTERVIEW"
    assert row.after_state["eligibility_override_reason"] == "Director approved: 15 years of industry experience"
    assert row.after_state["overridden_by"] == str(vacancy.hr_admin.id)

    # Past the line, later steps need no second override.
    assert _advance(client, vacancy.hr_admin, application, "INTERVIEWED").status_code == 200


def test_recruitment_officer_cannot_override(
    client, fake_openai_client, published_vacancy_factory, application_factory, candidate_factory, db_session
):
    vacancy = published_vacancy_factory(campus_code="SSE", slot_count=1)
    _mandate(db_session, vacancy.campus)
    application, _ = _screened_application(
        client, fake_openai_client, vacancy, application_factory, candidate_factory, "M.Tech"
    )
    response = _advance(
        client,
        vacancy.recruitment_officer,
        application,
        "CALLED_FOR_INTERVIEW",
        eligibility_override_reason="I think they are fine",
    )
    assert response.status_code == 403
    assert _application(client, vacancy.hr_admin, application)["status"] == "APPLIED"


def test_an_unflagged_candidate_needs_no_override(
    client, fake_openai_client, published_vacancy_factory, application_factory, candidate_factory, db_session
):
    vacancy = published_vacancy_factory(campus_code="SSE", slot_count=1)
    _mandate(db_session, vacancy.campus)
    application, _ = _screened_application(
        client, fake_openai_client, vacancy, application_factory, candidate_factory, "PhD in Mathematics"
    )
    assert _advance(client, vacancy.hr_admin, application, "CALLED_FOR_INTERVIEW").status_code == 200


# ------------------------------------------------------------------- seed


def test_seed_creates_one_active_wildcard_rule_per_mandate_campus_idempotently(db_session, campus_factory):
    for code in ("SSE", "SCLAS", "SSPE", "SCAD"):
        campus_factory(code)
    first = seed_phd_mandate_rules(db_session)
    assert first == {"SSE": "created", "SCLAS": "created", "SSPE": "created"}
    second = seed_phd_mandate_rules(db_session)
    assert second == {"SSE": "exists", "SCLAS": "exists", "SSPE": "exists"}

    rules = db_session.query(EligibilityRule).filter(EligibilityRule.phd_required.is_(True)).all()
    assert len(rules) == 3
    assert all(r.is_active and r.status == EligibilityRuleStatusEnum.ACTIVE for r in rules)
    assert all(r.position_title is None and r.department_id is None for r in rules)
    assert {r.campus.code for r in rules} == {"SSE", "SCLAS", "SSPE"}
    assert seed_phd_mandate_rules(db_session, ("NOPE",)) == {"NOPE": "no such campus"}
