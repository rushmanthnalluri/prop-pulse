"""Prediction logger — append-only JSONL log of every served prediction.

Writes the binding SPEC §10 log-line schema to ``logs/predictions.jsonl`` (or
``PREDICTION_LOG_PATH``)::

    {"timestamp": iso8601, "payload": {<PropertyInput fields>},
     "features": {<MODEL_FEATURES name>: value},
     "prediction": {"estimated_price": float, "probability": float,
                    "cluster_id": int},
     "model_version": str}

Logging is strictly best-effort: any failure is logged as a warning and never
propagates to the request path.
"""
from __future__ import annotations

import json
import logging
import threading
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

logger = logging.getLogger(__name__)

__all__ = ["PredictionLogger"]


class PredictionLogger:
    """Best-effort JSONL prediction logger (thread-safe appends).

    Args:
        log_path: Target JSONL file; parent directories are created on demand.
    """

    def __init__(self, log_path: Path) -> None:
        self._log_path = Path(log_path)
        self._lock = threading.Lock()

    @property
    def log_path(self) -> Path:
        """File the records are appended to."""
        return self._log_path

    def log(
        self,
        *,
        payload: dict[str, Any],
        features: dict[str, Any],
        prediction: dict[str, Any],
        model_version: str,
    ) -> bool:
        """Append one SPEC §10 record. Returns True on success, never raises."""
        record = {
            "timestamp": datetime.now(timezone.utc).isoformat(),
            "payload": payload,
            "features": features,
            "prediction": prediction,
            "model_version": model_version,
        }
        try:
            line = json.dumps(record, default=str)
            with self._lock:
                self._log_path.parent.mkdir(parents=True, exist_ok=True)
                with self._log_path.open("a", encoding="utf-8") as handle:
                    handle.write(line + "\n")
            return True
        except Exception as exc:  # noqa: BLE001 — logging must never break serving
            logger.warning("prediction log write failed (%s): %s", self._log_path, exc)
            return False
