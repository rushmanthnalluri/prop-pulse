"""Workbench-only sandbox prediction (workflow-architecture §3.11, WF-B2).

Serves a *sandbox* candidate — never the champion — for stage 09: payload →
:func:`ml.features.serving.serving_payload_to_raw` (the single API→raw
mapping, reused verbatim) → :func:`ml.features.pipeline.build_feature_frame`
with the **sandbox** neighborhood stats (never the champion's artifact) → the
job's persisted pipeline.

Every response carries the champion-free provenance block (§7 honesty rule 2):
``source: "sandbox"``, the dataset id/name, row counts and the label "not the
PropPulse champion". Classification responses additionally carry
``simulated_target: true`` (ADR-3) and the job's F1-optimal threshold (never a
hardcoded 0.5).

Safety (§4):

- sandbox predictions are **never** written to ``logs/predictions.jsonl`` —
  that log feeds the champion drift reference; mixing populations would
  corrupt PSI (§3.11);
- sandbox stats/defaults are read through this module's own ``(path, mtime)``-
  keyed cache — never the module-global ``lru_cache`` loaders, so the API
  process keeps no stale champion/sandbox state (§4.4);
- the sandbox test split is never read (§4.3).
"""
from __future__ import annotations

import json
import logging
import os
import re
from pathlib import Path
from typing import Any, Callable

import joblib
import numpy as np
import pandas as pd

from ml.features.pipeline import build_feature_frame
from ml.features.stats import NeighborhoodStats
from ml.features.serving import serving_payload_to_raw
from ml.workflow.datasets import get_record, sandbox_dir

logger = logging.getLogger(__name__)

__all__ = [
    "CandidateNotReadyError",
    "ObjectiveMismatchError",
    "SandboxModelService",
    "UnknownCandidateError",
    "UnknownJobError",
]

_JOB_ID_RE = re.compile(r"^job_[0-9a-f]{8}$")

_SANDBOX_LABEL_UPLOAD = (
    "Sandbox model — trained on your upload; not the PropPulse champion."
)
_SANDBOX_LABEL_BUNDLED = (
    "Sandbox model — trained on the bundled Ames Housing dataset; "
    "not the PropPulse champion."
)
_INTERVAL_NOTE = "~80% range — validation residual quantiles"
_SIMULATED_NOTE = (
    "SIMULATED target (ADR-3) — seeded days-on-market simulation; "
    "not a real-world performance claim"
)


class UnknownJobError(Exception):
    """Unknown/malformed job id for the dataset (-> HTTP 404)."""


class UnknownCandidateError(Exception):
    """The job has no such candidate (-> HTTP 404)."""


class CandidateNotReadyError(Exception):
    """Job not done, or the candidate failed (-> HTTP 409)."""


class ObjectiveMismatchError(ValueError):
    """Price requested from a classifier or vice versa (-> HTTP 422)."""


# ---------------------------------------------------------------------------
# (path, mtime)-keyed cache — never the module-global lru_cache loaders (§4.4)
# ---------------------------------------------------------------------------

_CACHE: dict[tuple[str, float], Any] = {}


def _cached(path: Path, loader: Callable[[Path], Any]) -> Any:
    path = Path(path)
    key = (str(path.resolve()), path.stat().st_mtime)
    if key not in _CACHE:
        _CACHE[key] = loader(path)
    return _CACHE[key]


def _load_stats(path: Path) -> NeighborhoodStats:
    return NeighborhoodStats.from_dict(json.loads(path.read_text(encoding="utf-8")))


def _load_defaults(path: Path) -> dict[str, Any]:
    payload = json.loads(path.read_text(encoding="utf-8"))
    if isinstance(payload, dict) and "defaults" in payload:
        return dict(payload["defaults"])
    return dict(payload)


def _load_json(path: Path) -> dict[str, Any]:
    return json.loads(path.read_text(encoding="utf-8"))


def _load_model(path: Path) -> Any:
    return joblib.load(path)


# ---------------------------------------------------------------------------
# Service
# ---------------------------------------------------------------------------

class SandboxModelService:
    """Serves sandbox candidates of one training job (§3.11).

    Args:
        dataset_id: workflow dataset (``ames`` or ``ds_…``).
        job_id: a ``job_[0-9a-f]{8}`` directory under the dataset sandbox.

    Raises:
        UnknownDataset: unknown dataset id (404).
        UnknownJobError: malformed id or no ``status.json`` (404).
    """

    def __init__(self, dataset_id: str, job_id: str) -> None:
        self._record = get_record(dataset_id)  # UnknownDataset -> 404
        if not _JOB_ID_RE.fullmatch(job_id):
            raise UnknownJobError(f"unknown job id: {job_id!r}")
        self._job_dir = sandbox_dir(dataset_id) / "jobs" / job_id
        status_path = self._job_dir / "status.json"
        if not status_path.exists():
            raise UnknownJobError(
                f"unknown job {job_id!r} for dataset {dataset_id!r} (no status.json)"
            )
        self._status = _load_json(status_path)
        self.dataset_id = dataset_id
        self.job_id = job_id
        self.objective = str(self._status.get("objective"))

    # -- artifact accessors -------------------------------------------------

    def _stats(self) -> NeighborhoodStats:
        return _cached(sandbox_dir(self.dataset_id) / "neighborhood_stats.json", _load_stats)

    def _defaults(self) -> dict[str, Any]:
        return _cached(sandbox_dir(self.dataset_id) / "feature_defaults.json", _load_defaults)

    def _candidate_entry(self, candidate: str) -> dict[str, Any]:
        if self._status.get("status") != "done":
            raise CandidateNotReadyError(
                f"job {self.job_id} is {self._status.get('status')} — sandbox "
                "predictions are served from completed jobs only (§3.11)"
            )
        results = self._status.get("results", {})
        if candidate not in results:
            raise UnknownCandidateError(
                f"job {self.job_id} ({self.objective}) has no candidate {candidate!r}; "
                f"candidates: {sorted(results)}"
            )
        entry = results[candidate]
        if entry.get("status") != "done":
            raise CandidateNotReadyError(
                f"candidate {candidate!r} of job {self.job_id} is "
                f"{entry.get('status', 'pending')} (job status: "
                f"{self._status.get('status')}) — only successfully trained "
                "candidates can serve sandbox predictions"
            )
        return entry

    def _candidate_dir(self, candidate: str) -> Path:
        return self._job_dir / "candidates" / candidate

    def _metrics(self, candidate: str) -> dict[str, Any]:
        return _cached(self._candidate_dir(candidate) / "metrics.json", _load_json)

    def _model(self, candidate: str) -> Any:
        return _cached(self._candidate_dir(candidate) / "model.joblib", _load_model)

    def _feature_frame(self, payload: dict[str, Any]) -> pd.DataFrame:
        """Payload -> raw row -> model-ready frame with the SANDBOX stats."""
        raw = serving_payload_to_raw(payload)  # ValueError -> 422
        defaults = self._defaults()
        for column, value in defaults.items():
            raw.setdefault(column, value)
        frame = pd.DataFrame([raw])
        return build_feature_frame(frame, stats=self._stats())

    def _provenance(self, metrics: dict[str, Any]) -> dict[str, Any]:
        is_upload = self._record.source == "upload"
        return {
            "source": "sandbox",
            "dataset_id": self.dataset_id,
            "dataset_name": self._record.name,
            "trained_at": metrics.get("trained_at"),
            "n_train_rows": metrics.get("n_train"),
            "label": _SANDBOX_LABEL_UPLOAD if is_upload else _SANDBOX_LABEL_BUNDLED,
        }

    def _model_block(self, candidate: str) -> dict[str, Any]:
        return {
            "candidate": candidate,
            "objective": self.objective,
            "job_id": self.job_id,
        }

    # -- predictions ----------------------------------------------------------

    def predict_price(self, payload: dict[str, Any], candidate: str) -> dict[str, Any]:
        """Sandbox price estimate + residual interval for a regression candidate.

        Raises:
            UnknownCandidateError / CandidateNotReadyError / ObjectiveMismatchError
            ValueError: invalid payload fields (-> 422).
        """
        self._candidate_entry(candidate)
        metrics = self._metrics(candidate)
        if metrics.get("objective") != "regression":
            raise ObjectiveMismatchError(
                f"candidate {candidate!r} is a {metrics.get('objective')} model, "
                "not regression — price predictions need a regression candidate"
            )
        frame = self._feature_frame(payload)
        pred_log = float(np.asarray(self._model(candidate).predict(frame))[0])
        interval = metrics["val_metrics"]["residual_interval"]
        return {
            "estimated_price": float(np.expm1(pred_log)),
            "price_range": {
                "low": float(np.expm1(pred_log + interval["q_low"])),
                "high": float(np.expm1(pred_log + interval["q_high"])),
            },
            "interval_note": _INTERVAL_NOTE,
            "model": self._model_block(candidate),
            "provenance": self._provenance(metrics),
        }

    def predict_proba(self, payload: dict[str, Any], candidate: str) -> dict[str, Any]:
        """Sandbox sale-speed probability for a classification candidate.

        The threshold is the job's own F1-optimal operating threshold computed
        on val calibrated probabilities (never hardcoded 0.5, §3.10).
        """
        self._candidate_entry(candidate)
        metrics = self._metrics(candidate)
        if metrics.get("objective") != "classification":
            raise ObjectiveMismatchError(
                f"candidate {candidate!r} is a {metrics.get('objective')} model, "
                "not classification — probabilities need a classification candidate"
            )
        frame = self._feature_frame(payload)
        proba = float(self._model(candidate).predict_proba(frame)[0, 1])
        threshold = float(metrics["val_metrics"]["threshold"])
        return {
            "probability": proba,
            "threshold": threshold,
            "sells_within_30_days": bool(proba >= threshold),
            "simulated_target": True,
            "note": _SIMULATED_NOTE,
            "model": self._model_block(candidate),
            "provenance": self._provenance(metrics),
        }
