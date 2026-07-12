from fastapi import APIRouter

from app.api.v1.routers import audit_logs, auth, campuses, departments, users

api_router = APIRouter()
api_router.include_router(auth.router)
api_router.include_router(users.router)
api_router.include_router(campuses.router)
api_router.include_router(departments.router)
api_router.include_router(audit_logs.router)
