from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from uvicorn.middleware.proxy_headers import ProxyHeadersMiddleware

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

# Added LAST so it is the OUTERMOST middleware: everything inside -- the
# security headers' HTTPS check, CORS, the rate limiter, the audit log --
# then sees the real client address and scheme. Only added when at least
# one proxy is configured; with the list empty the raw TCP peer is kept,
# which is right for local dev. See app/core/client_ip.py for why this is
# the only place forwarded headers are ever interpreted.
if settings.trusted_proxy_ips_list:
    app.add_middleware(ProxyHeadersMiddleware, trusted_hosts=settings.trusted_proxy_ips_list)

app.include_router(api_router, prefix="/api/v1")


@app.get("/health", tags=["health"])
def health() -> dict[str, str]:
    return {"status": "ok"}
