from fastapi import FastAPI

from app.api.v1.api import api_router

app = FastAPI(
    title="SIMATS AI Recruitment Automation System",
    description="Phase 1: Foundation -- DB schema, auth, campus/role scaffolding, base API skeleton.",
    version="0.1.0",
)

app.include_router(api_router, prefix="/api/v1")


@app.get("/health", tags=["health"])
def health() -> dict[str, str]:
    return {"status": "ok"}
