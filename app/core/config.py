from functools import lru_cache

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    DATABASE_URL: str

    JWT_SECRET_KEY: str
    JWT_ALGORITHM: str = "HS256"
    ACCESS_TOKEN_EXPIRE_MINUTES: int = 30
    REFRESH_TOKEN_EXPIRE_DAYS: int = 7

    SEED_SUPER_ADMIN_EMAIL: str = "superadmin@example.com"
    SEED_SUPER_ADMIN_PASSWORD: str = ""
    SEED_SAMPLE_USER_PASSWORD: str = "DevPass123!"

    # --- Anthropic (Module 14 "Hermes": assistant chat + daily briefing) ---
    # Defaults to "" (not required) so the app/test suite can import and run
    # without a live key -- only real AI-call endpoints need it set; tests
    # override the ai_client dependency with a fake.
    ANTHROPIC_API_KEY: str = ""
    ANTHROPIC_MODEL: str = "claude-opus-4-8"

    # --- OpenAI (Phase 3: JD generation, resume scoring, interview questions) ---
    # Same unconfigured-by-default precedent as ANTHROPIC_API_KEY above --
    # leave blank to run without live AI calls; tests override get_openai_client.
    OPENAI_API_KEY: str = ""
    OPENAI_MODEL: str = "gpt-4o"

    # --- MinIO (Phase 3: resume object storage) ---
    MINIO_ENDPOINT: str = "localhost:9000"
    MINIO_ACCESS_KEY: str = "simats_minio"
    MINIO_SECRET_KEY: str = "change_me_locally"
    MINIO_BUCKET_RESUMES: str = "resumes"
    # --- MinIO (Phase F: Sanctioned Strength bulk-upload original files) ---
    # Separate bucket from resumes -- see app/services/storage.py's
    # upload_bulk_upload_file/download_bulk_upload_file_bytes trio.
    MINIO_BUCKET_BULK_UPLOADS: str = "bulk-uploads"
    MINIO_USE_SSL: bool = False

    # --- ChromaDB (Phase 3: resume embeddings / semantic JD matching) ---
    CHROMA_HOST: str = "localhost"
    CHROMA_PORT: int = 8012
    CHROMA_COLLECTION_RESUMES: str = "resume_embeddings"

    # --- n8n (Phase 6: notification delivery + job-portal distribution) ---
    # Defaults to "" (unconfigured) -- same precedent as ANTHROPIC_API_KEY.
    # app/services/notifications.py and app/services/job_distribution.py both
    # degrade cleanly (never crash) when this is unset.
    N8N_BASE_URL: str = ""
    N8N_TIMEOUT_SECONDS: float = 5.0

    # --- Deployment environment (2026-09-03, audit H1) ---
    #
    # "development" (default), "test" or "production". The ONLY thing this
    # gates is what happens when something that must deliver a secret by
    # email has no delivery configured: outside production the code/token is
    # printed to the server console so the flow can be exercised locally;
    # in production it is never printed and the request fails with 503.
    # docker-compose.yml sets this to "production" for the backend service.
    ENVIRONMENT: str = "development"

    @property
    def is_production(self) -> bool:
        return self.ENVIRONMENT.strip().lower() == "production"

    @property
    def email_delivery_configured(self) -> bool:
        """Whether OTP login codes and password-reset tokens can actually be
        emailed. Delivery goes through the n8n webhooks, so this is exactly
        "is N8N_BASE_URL set"."""
        return bool(self.N8N_BASE_URL.strip())

    @property
    def otp_email_login_available(self) -> bool:
        """What the login page is told. Real delivery, or the dev console
        fallback -- never the production fallback, which is to refuse."""
        return self.email_delivery_configured or not self.is_production

    # --- Public apply link base (Phase 6: Module 4 job ads / QR codes) ---
    # No candidate portal exists yet (Module 5 deferred) -- this is a
    # documented placeholder base URL used to build the QR-code/apply-link
    # target. Swap for the real careers-page domain once Module 5/the
    # frontend exists.
    PUBLIC_APPLY_BASE_URL: str = "https://careers.simats.edu"

    # --- Public vacancy-request (QR) intake, 2026-08-30 ---
    # Base URL of the FRONTEND app, used to build the QR code's target
    # (`<base>/vacancy-request/public`). Deliberately separate from
    # PUBLIC_APPLY_BASE_URL above: that one points at the candidate careers
    # site, while this form lives inside this app. Pointing the QR at the
    # careers domain would send staff to the wrong site entirely.
    #
    # Falls back to the first configured CORS origin when unset, which in
    # every real deployment IS the frontend origin -- that keeps a correct QR
    # in production without a new required env var, while staying overridable.
    # Never hard-code localhost here; see `public_app_base_url`.
    PUBLIC_APP_BASE_URL: str = ""

    # Email of the account QR submissions are attributed to. A public
    # submission has no `User`, but VacancyRequest.requested_by_id is NOT NULL
    # and five notification sites in vacancy_workflow.py dereference it, so
    # every QR row needs an owning account. The requester's own details are
    # stored separately on the row (requester_name/email/mobile).
    #
    # When unset, the intake falls back to the longest-standing active
    # SUPER_ADMIN -- see app/services/vacancy_request_intake.py, which fails
    # with a clear 503 rather than a foreign-key error if there is none.
    QR_INTAKE_USER_EMAIL: str = ""

    # --- CORS (Phase 7) ---
    # Comma-separated origins, e.g. "https://app.simats.edu,https://staging.simats.edu".
    # Empty by default -- no frontend exists in this repo yet, so no CORS
    # middleware is added at all (today's implicit same-origin-only behavior
    # is unchanged). Set this once a frontend origin needs cross-origin API
    # access; plain str (not list[str]) to avoid pydantic-settings' JSON-only
    # parsing for list-typed env vars.
    CORS_ALLOWED_ORIGINS: str = ""

    # --- Reverse proxy trust (2026-09-03) ---
    #
    # Comma-separated peer addresses (IPs or CIDRs) whose X-Forwarded-For /
    # X-Forwarded-Proto headers may be believed. Empty means NO proxy is
    # trusted and request.client.host stays the raw TCP peer -- correct for
    # local dev where uvicorn faces the browser directly.
    #
    # In production the only peer that can reach the container is Caddy on
    # the VPS host, arriving via the Docker bridge gateway; the entrypoint
    # derives that address at startup when this is unset. Never set "*".
    TRUSTED_PROXY_IPS: str = ""

    @property
    def cors_allowed_origins_list(self) -> list[str]:
        return [origin.strip() for origin in self.CORS_ALLOWED_ORIGINS.split(",") if origin.strip()]

    @property
    def trusted_proxy_ips_list(self) -> list[str]:
        return [ip.strip() for ip in self.TRUSTED_PROXY_IPS.split(",") if ip.strip()]

    @property
    def public_app_base_url(self) -> str:
        """Frontend base URL for QR targets, without a trailing slash.

        Explicit setting wins; otherwise the first CORS origin, which is the
        frontend origin in every real deployment. The final fallback is the
        local dev origin -- reached only when neither is configured, i.e. on a
        developer machine, so a QR generated there is correctly local rather
        than silently pointing at a production domain that does not serve it.
        """
        configured = self.PUBLIC_APP_BASE_URL.strip()
        if configured:
            return configured.rstrip("/")
        origins = self.cors_allowed_origins_list
        if origins:
            return origins[0].rstrip("/")
        return "http://localhost:5173"


@lru_cache
def get_settings() -> Settings:
    return Settings()


settings = get_settings()
