from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api.v1.api import api_router
from app.core.config import settings
from app.core.security_headers import SecurityHeadersMiddleware

app = FastAPI(
    title="SIMATS AI Recruitment Automation System",
    description=(
        "Campus-aware AI recruitment automation for SIMATS, covering the full hiring "
        "lifecycle: requisition/approval, AI-assisted JD generation and resume "
        "screening, interview/offer/joining workflows, the Hermes orchestrator/AI "
        "assistant, executive dashboards & reporting, and n8n-mediated notification "
        "delivery & job-portal distribution. See README.md for the phase-by-phase "
        "build history and DEPLOYMENT.md for the deployment runbook."
    ),
    version="1.0.0",
)

app.add_middleware(SecurityHeadersMiddleware)

if settings.cors_allowed_origins_list:
    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.cors_allowed_origins_list,
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )

app.include_router(api_router, prefix="/api/v1")


@app.get("/health", tags=["health"])
def health() -> dict[str, str]:
    return {"status": "ok"}
