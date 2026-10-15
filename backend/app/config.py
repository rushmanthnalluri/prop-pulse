"""Backend settings — env-driven configuration (SPEC §8/§12).

Reads the keys defined in ``.env.example`` (``MODEL_DIR``, ``DATA_DIR``,
``LOG_LEVEL``, ``PREDICTION_LOG_PATH``, ``CORS_ORIGINS``). Paths are
repo-relative and resolved against :data:`ml.paths.REPO_ROOT` — no absolute
paths are ever constructed from user input alone.
"""
from __future__ import annotations

from functools import lru_cache
from pathlib import Path
from urllib.parse import urlsplit

from pydantic import field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

from ml.paths import REPO_ROOT


class Settings(BaseSettings):
    """Runtime settings for the PropPulse FastAPI service.

    Attributes mirror the ``.env.example`` keys (case-insensitive env match).
    Relative paths are resolved against the repository root.
    """

    # env_file is anchored to the repo root so it is found no matter which
    # directory uvicorn is started from (AUD-20).
    model_config = SettingsConfigDict(
        env_file=str(REPO_ROOT / ".env"),
        env_file_encoding="utf-8",
        extra="ignore",
        case_sensitive=False,
    )

    model_dir: str = "models"
    data_dir: str = "data"
    log_level: str = "INFO"
    prediction_log_path: str = "logs/predictions.jsonl"
    #: Comma-separated browser origins allowed by CORS (dev-only defaults:
    #: Vite dev :5173, Vite preview :4173, docker :8080). Env-var override
    #: behavior is unchanged — CORS_ORIGINS replaces this list wholesale.
    cors_origins: str = "http://localhost:5173,http://localhost:4173,http://localhost:8080"

    @field_validator("cors_origins")
    @classmethod
    def validate_cors_origins(cls, value: str) -> str:
        """Canonicalize explicit HTTP(S) origins and reject malformed allow-list entries."""
        normalized_origins: list[str] = []
        for raw in value.split(","):
            origin = raw.strip()
            if not origin:
                continue
            if any(character.isspace() or ord(character) < 0x20 or ord(character) == 0x7F for character in origin):
                raise ValueError("CORS_ORIGINS entries must not contain whitespace or control characters")
            if origin == "*":
                raise ValueError("CORS_ORIGINS must use explicit origins when credentialed CORS is enabled")
            if "?" in origin or "#" in origin:
                raise ValueError("CORS_ORIGINS entries must not contain a query or fragment")
            try:
                parsed = urlsplit(origin)
                port = parsed.port
            except ValueError as exc:
                raise ValueError("CORS_ORIGINS contains an invalid origin or port") from exc

            scheme = parsed.scheme.lower()
            host = parsed.hostname
            if scheme not in {"http", "https"} or not host:
                raise ValueError("CORS_ORIGINS entries must be absolute HTTP(S) origins")
            if parsed.username is not None or parsed.password is not None:
                raise ValueError("CORS_ORIGINS entries must not contain credentials")
            if parsed.path not in {"", "/"}:
                raise ValueError("CORS_ORIGINS entries must not contain a path")
            if parsed.netloc.endswith(":") or any(character in host for character in ("/", "\\", "%")):
                raise ValueError("CORS_ORIGINS contains an invalid host or port")

            # Browser Origin values omit default ports and use a lowercase host.
            host = host.lower()
            authority = f"[{host}]" if ":" in host else host
            if port is not None and not (
                (scheme == "http" and port == 80) or (scheme == "https" and port == 443)
            ):
                authority = f"{authority}:{port}"
            canonical = f"{scheme}://{authority}"
            if canonical not in normalized_origins:
                normalized_origins.append(canonical)
        return ",".join(normalized_origins)

    @staticmethod
    def _resolve(path: str) -> Path:
        """Resolve ``path`` against the repo root unless already absolute."""
        candidate = Path(path)
        return candidate if candidate.is_absolute() else REPO_ROOT / candidate

    @property
    def resolved_model_dir(self) -> Path:
        """Absolute path of the model artifact directory."""
        return self._resolve(self.model_dir)

    @property
    def resolved_prediction_log_path(self) -> Path:
        """Absolute path of the JSONL prediction log."""
        return self._resolve(self.prediction_log_path)

    @property
    def resolved_drift_report_path(self) -> Path:
        """Absolute path of the latest drift report (``reports/drift/latest.json``)."""
        return REPO_ROOT / "reports" / "drift" / "latest.json"

    @property
    def cors_origin_list(self) -> list[str]:
        """``CORS_ORIGINS`` parsed as a comma-separated list of origins."""
        # Browsers serialize an Origin without a trailing slash. Normalize
        # operator-provided values to that canonical form before matching.
        return [
            value
            for raw in self.cors_origins.split(",")
            if (value := raw.strip().rstrip("/"))
        ]


@lru_cache(maxsize=1)
def get_settings() -> Settings:
    """Process-wide cached settings instance."""
    return Settings()
