from functools import lru_cache
from typing import Annotated, Literal

from pydantic import AnyHttpUrl, Field, MySQLDsn, field_validator
from pydantic_settings import BaseSettings, NoDecode, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=".env", env_file_encoding="utf-8", extra="ignore"
    )

    database_url: MySQLDsn
    node_env: Literal["development", "test", "production"] = "development"
    api_host: str = "127.0.0.1"
    api_port: int = 3000
    database_connect_timeout_ms: int = Field(default=5_000, ge=100, le=60_000)
    cors_origins: Annotated[list[str], NoDecode]
    session_secret: str = Field(min_length=32)
    session_ttl_seconds: int = Field(default=28_800, ge=60, le=2_592_000)
    auth_link_secret: str = Field(min_length=32)
    auth_link_base_url: AnyHttpUrl
    invitation_ttl_seconds: int = Field(default=86_400, ge=300, le=604_800)
    password_reset_ttl_seconds: int = Field(default=3_600, ge=300, le=86_400)
    auth_rate_limit_max: int = Field(default=10, ge=1, le=10_000)
    auth_rate_limit_window_seconds: int = Field(default=60, ge=1, le=3_600)
    qr_signing_secret: str = Field(min_length=32)
    public_web_base_url: AnyHttpUrl
    consent_url: AnyHttpUrl
    consent_version: str = Field(min_length=1, max_length=255)
    email_max_attempts: int = Field(default=5, ge=1, le=20)
    email_poll_interval_ms: int = Field(default=1_000, ge=100, le=60_000)

    @field_validator("cors_origins", mode="before")
    @classmethod
    def parse_origins(cls, value: object) -> object:
        if isinstance(value, str):
            return [part.strip() for part in value.split(",") if part.strip()]
        return value

    @field_validator("cors_origins")
    @classmethod
    def validate_origins(cls, origins: list[str]) -> list[str]:
        if not origins or "*" in origins:
            raise ValueError("CORS_ORIGINS must be an exact non-empty allowlist")
        for origin in origins:
            parsed = AnyHttpUrl(origin)
            if parsed.path not in (None, "/") or parsed.query or parsed.fragment:
                raise ValueError("Trusted origins must not contain path/query/fragment")
        return origins

    @property
    def production(self) -> bool:
        return self.node_env == "production"


@lru_cache
def get_settings() -> Settings:
    return Settings()  # type: ignore[call-arg]
