"""Backend settings — env-driven configuration (SPEC §8/§12).

Reads the keys defined in ``.env.example`` (``MODEL_DIR``, ``DATA_DIR``,
``MLFLOW_TRACKING_URI``, ``API_HOST``, ``API_PORT``, ``VITE_API_URL``,
``LOG_LEVEL``, ``PREDICTION_LOG_PATH``, ``DRIFT_PSI_THRESHOLD``,
``CORS_ORIGINS``). Paths are repo-relative and resolved against
:data:`ml.paths.REPO_ROOT` — no absolute paths are ever constructed from
user input alone.
"""
from __future__ import annotations

from functools import lru_cache
from pathlib import Path

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
    mlflow_tracking_uri: str = ""
    api_host: str = "127.0.0.1"
    api_port: int = 8000
    vite_api_url: str = "http://localhost:8000"
    log_level: str = "INFO"
    prediction_log_path: str = "logs/predictions.jsonl"
    drift_psi_threshold: float = 0.2
    #: Comma-separated browser origins allowed by CORS (dev-only defaults:
    #: Vite dev :5173, Vite preview :4173, docker :8080). Env-var override
    #: behavior is unchanged — CORS_ORIGINS replaces this list wholesale.
    cors_origins: str = "http://localhost:5173,http://localhost:4173,http://localhost:8080"

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
    def resolved_data_dir(self) -> Path:
        """Absolute path of the dataset directory."""
        return self._resolve(self.data_dir)

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
        return [
            origin.strip() for origin in self.cors_origins.split(",") if origin.strip()
        ]


@lru_cache(maxsize=1)
def get_settings() -> Settings:
    """Process-wide cached settings instance."""
    return Settings()
