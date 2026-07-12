from fastapi import APIRouter

from app.api.v1.routers import (
    applications,
    approved_vacancies,
    audit_logs,
    auth,
    campuses,
    candidates,
    departments,
    employees,
    job_postings,
    joining,
    offers,
    users,
    vacancy_requests,
)

api_router = APIRouter()
api_router.include_router(auth.router)
api_router.include_router(users.router)
api_router.include_router(campuses.router)
api_router.include_router(departments.router)
api_router.include_router(audit_logs.router)

api_router.include_router(vacancy_requests.router)
api_router.include_router(approved_vacancies.router)
api_router.include_router(approved_vacancies.hiring_slots_router)
api_router.include_router(job_postings.router)
api_router.include_router(candidates.router)
api_router.include_router(applications.router)
api_router.include_router(offers.router)
api_router.include_router(joining.router)
api_router.include_router(employees.router)
