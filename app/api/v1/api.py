from fastapi import APIRouter

from app.api.v1.routers import (
    application_outcomes,
    applications,
    approved_vacancies,
    assistant,
    audit_logs,
    auth,
    campuses,
    candidates,
    dashboard,
    departments,
    designations,
    eligibility_rules,
    employees,
    housekeeping_staff,
    inbound_emails,
    interviews,
    campaign_posters,
    job_distribution,
    job_postings,
    joining,
    locations,
    migration,
    notifications,
    offers,
    pipeline_stage_configs,
    public_careers,
    reports,
    resume_screening,
    sanctioned_strength,
    talent_pool,
    users,
    vacancy_register,
    public_vacancy_requests,
    recruitment_channels,
    vacancy_requests,
)

api_router = APIRouter()
api_router.include_router(auth.router)
# Unauthenticated intake -- registered alongside the rest, but note it is
# the only router here besides auth with no auth dependency at all. See
# its module docstring for the boundaries that keeps it safe.
api_router.include_router(public_vacancy_requests.router)
# The careers pages and apply form (2026-09-07): unauthenticated as well.
api_router.include_router(public_careers.router)
api_router.include_router(recruitment_channels.router)
api_router.include_router(recruitment_channels.rules_router)
api_router.include_router(users.router)
api_router.include_router(campuses.router)
api_router.include_router(departments.router)
api_router.include_router(vacancy_register.router)
api_router.include_router(sanctioned_strength.router)
api_router.include_router(designations.router)
api_router.include_router(locations.router)
api_router.include_router(housekeeping_staff.router)
api_router.include_router(eligibility_rules.router)
api_router.include_router(pipeline_stage_configs.router)
api_router.include_router(audit_logs.router)

# Mail intake (2026-10-17). The POST here is secret-gated rather than
# open like the two public routers above -- see its module docstring.
api_router.include_router(inbound_emails.router)

# Talent pool (2026-10-23). Read-only; the Google Sheet is the system of
# record and the sync is the only writer -- see the router's docstring.
api_router.include_router(talent_pool.router)

# qr_router first: its /vacancy-requests/qr/* paths would otherwise be
# swallowed by /vacancy-requests/{vacancy_request_id} below.
api_router.include_router(vacancy_requests.qr_router)
api_router.include_router(vacancy_requests.bulk_upload_router)
api_router.include_router(vacancy_requests.router)
api_router.include_router(approved_vacancies.router)
api_router.include_router(approved_vacancies.hiring_slots_router)
api_router.include_router(job_postings.router)
api_router.include_router(job_distribution.router)
api_router.include_router(campaign_posters.router)
api_router.include_router(candidates.router)
api_router.include_router(application_outcomes.router)
api_router.include_router(applications.router)
api_router.include_router(offers.router)
api_router.include_router(joining.router)
api_router.include_router(employees.router)

api_router.include_router(resume_screening.router)
api_router.include_router(interviews.router)
api_router.include_router(notifications.router)
api_router.include_router(assistant.router)

api_router.include_router(dashboard.router)
api_router.include_router(reports.router)
api_router.include_router(migration.router)
