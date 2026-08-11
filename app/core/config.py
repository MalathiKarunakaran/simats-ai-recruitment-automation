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

    # --- Public apply link base (Phase 6: Module 4 job ads / QR codes) ---
    # No candidate portal exists yet (Module 5 deferred) -- this is a
    # documented placeholder base URL used to build the QR-code/apply-link
    # target. Swap for the real careers-page domain once Module 5/the
    # frontend exists.
    PUBLIC_APPLY_BASE_URL: str = "https://careers.simats.edu"

    # --- CORS (Phase 7) ---
    # Comma-separated origins, e.g. "https://app.simats.edu,https://staging.simats.edu".
    # Empty by default -- no frontend exists in this repo yet, so no CORS
    # middleware is added at all (today's implicit same-origin-only behavior
    # is unchanged). Set this once a frontend origin needs cross-origin API
    # access; plain str (not list[str]) to avoid pydantic-settings' JSON-only
    # parsing for list-typed env vars.
    CORS_ALLOWED_ORIGINS: str = ""

    @property
    def cors_allowed_origins_list(self) -> list[str]:
        return [origin.strip() for origin in self.CORS_ALLOWED_ORIGINS.split(",") if origin.strip()]


@lru_cache
def get_settings() -> Settings:
    return Settings()


settings = get_settings()
