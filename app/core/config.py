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


@lru_cache
def get_settings() -> Settings:
    return Settings()


settings = get_settings()
