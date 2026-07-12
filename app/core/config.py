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

    # --- Anthropic (Phase 3: JD generation, resume scoring) ---
    # Defaults to "" (not required) so the app/test suite can import and run
    # without a live key -- only real AI-call endpoints need it set; tests
    # override the ai_client dependency with a fake.
    ANTHROPIC_API_KEY: str = ""
    ANTHROPIC_MODEL: str = "claude-opus-4-8"

    # --- MinIO (Phase 3: resume object storage) ---
    MINIO_ENDPOINT: str = "localhost:9000"
    MINIO_ACCESS_KEY: str = "simats_minio"
    MINIO_SECRET_KEY: str = "change_me_locally"
    MINIO_BUCKET_RESUMES: str = "resumes"
    MINIO_USE_SSL: bool = False

    # --- ChromaDB (Phase 3: resume embeddings / semantic JD matching) ---
    CHROMA_HOST: str = "localhost"
    CHROMA_PORT: int = 8012
    CHROMA_COLLECTION_RESUMES: str = "resume_embeddings"


@lru_cache
def get_settings() -> Settings:
    return Settings()


settings = get_settings()
