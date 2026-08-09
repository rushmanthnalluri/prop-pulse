"""Training-job service for the workflow API (workflow-architecture §3.9-§3.11, §4.8, §5.2).

Owns the HTTP side of the training engine boundary (the engine itself is
WF-B2, ``ml/workflow/train_job.py``, consumed only via the pinned CLI +
status-file protocol):

- **Spawn** — :func:`spawn_training_job` runs ``sys.executable -m
  ml.workflow.train_job --dataset <id> --job <id> --objective <obj>
  --candidates <csv>`` with ``cwd=REPO_ROOT``. It is deliberately tiny so
  WF-B4 can patch it.
- **Poll** — job truth is the subprocess-written
  ``models/workflow/<dataset_id>/jobs/<job_id>/status.json``; the API writes
  the initial ``queued`` file before spawning so polling works immediately.
- **One job at a time** (§4.8) — a module-level in-memory guard plus a
  startup orphan sweep (any ``queued``/``preparing``/``running`` status file
  found on first use is marked ``failed`` — "server restarted", §3.9). The
  POST handler also scans the on-disk statuses, so a job orphaned by an
  un-swept crash still blocks correctly with 409 naming the running job.
- **Status normalization** — the on-disk protocol spells the terminal success
  state ``complete``; the §3.9 API shape spells it ``done``. The service maps
  ``complete`` -> ``done`` at the HTTP boundary.

Never touches champion state (§4.3); sandbox predictions are never written to
``logs/predictions.jsonl`` (§3.11 — nothing in this layer logs).
"""
from __future__ import annotations

import json
import logging
import math
import subprocess
import sys
import threading
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import numpy as np
import pandas as pd
from fastapi import HTTPException

from ml.paths import REPO_ROOT
from ml.workflow.datasets import (
    MAX_UPLOAD_ROWS,
    WORKFLOW_MODELS_ROOT,
    UnknownDataset,
    get_record,
    sandbox_dir,
)
from ml.workflow.prepare import preview_report

from backend.app.services.workflow.datasets import (
    ACTIVE_JOB_STATES,
    DONE_JOB_STATES,
    WorkflowDatasetService,
    job_status_scan,
    normalize_job_status,
)

logger = logging.getLogger(__name__)

#: Valid candidate sets per objective (§3.9): regression = the five of
#: ``train_regression.train_all``; classification = ``MODEL_NAMES``;
#: clustering = DBSCAN only.
VALID_CANDIDATES: dict[str, tuple[str, ...]] = {
    "regression": ("linear", "ridge", "lasso", "random_forest", "xgboost"),
    "classification": ("logistic", "decision_tree", "random_forest", "xgboost"),
    "clustering": ("dbscan",),
}

#: Job id scheme (§3.9): ``job_`` + uuid8 — mirrors the dataset uuid8 scheme.
_JOB_ID_RE = r"^job_[0-9a-f]{8}$"

#: §3.9 selection blocks per objective (best flag + comparison-table note).
_SELECTION_BLOCKS: dict[str, dict[str, Any]] = {
    "regression": {
        "metric": "rmsle",
        "rule": "min",
        "note": "best = lowest validation RMSLE; test split never touched",
    },
    "classification": {
        "metric": "pr_auc",
        "rule": "max",
        "note": "best = highest validation PR-AUC (SIMULATED target, ADR-3); "
        "test split never touched",
    },
    "clustering": {
        "metric": None,
        "rule": None,
        "note": "single DBSCAN candidate — no champion selection",
    },
}

_JOB_LOCK = threading.Lock()
#: ``(dataset_id, job_id)`` of the job this process spawned and considers active.
_running_job: tuple[str, str] | None = None
_orphan_sweep_done = False


# ---------------------------------------------------------------------------
# Small helpers
# ---------------------------------------------------------------------------

def _utc_now_iso() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def _valid_job_id(job_id: str) -> bool:
    import re  # noqa: PLC0415 — cheap, keeps module import lean

    return bool(re.fullmatch(_JOB_ID_RE, job_id or ""))


def _jobs_dir(dataset_id: str) -> Path:
    return sandbox_dir(dataset_id) / "jobs"


def _read_status_file(path: Path) -> dict[str, Any] | None:
    try:
        payload = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return None
    return payload if isinstance(payload, dict) else None


def _write_status_file(job_dir: Path, payload: dict[str, Any]) -> None:
    job_dir.mkdir(parents=True, exist_ok=True)
    (job_dir / "status.json").write_text(
        json.dumps(payload, indent=2) + "\n", encoding="utf-8"
    )


def _active_status(payload: dict[str, Any] | None) -> bool:
    return payload is not None and str(payload.get("status")) in ACTIVE_JOB_STATES


def _jsonable(value: Any) -> Any:
    """Best-effort numpy/pandas -> Python conversion for status payloads."""
    if isinstance(value, float) and not math.isfinite(value):
        return None
    if hasattr(value, "item"):
        try:
            return _jsonable(value.item())
        except (ValueError, AttributeError):
            pass
    return value


# ---------------------------------------------------------------------------
# Subprocess boundary (WF-B2 CLI contract; patch point for WF-B4)
# ---------------------------------------------------------------------------

def spawn_training_job(
    dataset_id: str, job_id: str, objective: str, candidates: list[str], job_dir: Path
) -> subprocess.Popen[bytes]:
    """Spawn the training subprocess (§3.9 — the only call into WF-B2).

    ``sys.executable -m ml.workflow.train_job --dataset … --job … --objective …
    --candidates <comma-joined>`` with ``cwd=REPO_ROOT``; stdout/stderr go to
    ``subprocess.log`` inside the job dir so a crashed trainer is debuggable
    without touching the API logs. Kept tiny and side-effect-free apart from
    the spawn so tests can patch it.
    """
    log_path = job_dir / "subprocess.log"
    log_file = open(log_path, "ab")  # noqa: SIM115 — handed to the child process
    try:
        process = subprocess.Popen(
            [
                sys.executable,
                "-m",
                "ml.workflow.train_job",
                "--dataset",
                dataset_id,
                "--job",
                job_id,
                "--objective",
                objective,
                "--candidates",
                ",".join(candidates),
            ],
            cwd=str(REPO_ROOT),
            stdout=log_file,
            stderr=subprocess.STDOUT,
        )
    finally:
        log_file.close()  # the child holds its own handle from here on
    logger.info(
        "spawned training job %s (dataset=%s objective=%s candidates=%s pid=%s)",
        job_id, dataset_id, objective, candidates, process.pid,
    )
    return process


def sweep_orphaned_jobs() -> int:
    """Mark every active status file ``failed`` ("server restarted", §3.9/§4.8).

    Runs once per process (first job-service construction); returns the number
    of status files flipped.
    """
    global _orphan_sweep_done
    with _JOB_LOCK:
        if _orphan_sweep_done:
            return 0
        _orphan_sweep_done = True
        flipped = 0
        if not WORKFLOW_MODELS_ROOT.exists():
            return 0
        for status_file in WORKFLOW_MODELS_ROOT.glob("*/jobs/*/status.json"):
            payload = _read_status_file(status_file)
            if not _active_status(payload):
                continue
            payload["status"] = "failed"
            payload["error"] = "server restarted before the job finished"
            payload["finished_at"] = _utc_now_iso()
            try:
                _write_status_file(status_file.parent, payload)
                flipped += 1
            except OSError as exc:
                logger.warning("orphan sweep could not rewrite %s: %s", status_file, exc)
        if flipped:
            logger.info("orphan sweep marked %d stale job(s) failed", flipped)
        return flipped


# ---------------------------------------------------------------------------
# The service
# ---------------------------------------------------------------------------

class WorkflowJobService:
    """Stateless-per-request job facade (§5.3); the guard/sweep are module state."""

    def __init__(self) -> None:
        sweep_orphaned_jobs()

    # -- create (§3.9) --------------------------------------------------------

    def create_job(
        self, dataset_id: str, objective: str, candidates: list[str]
    ) -> dict[str, Any]:
        """Validate, persist a ``queued`` status file, spawn the subprocess -> 202 payload.

        Raises:
            HTTPException: 404 unknown dataset; 400 row window; 422 unknown
                candidates (message lists the valid set); 409 a job is already
                active server-wide (message names the running job).
        """
        global _running_job
        try:
            record = get_record(dataset_id)
        except UnknownDataset as exc:
            raise HTTPException(status_code=404, detail=str(exc)) from exc

        can_train, reason = WorkflowDatasetService._train_window(record)
        if not can_train:
            raise HTTPException(status_code=400, detail=reason)

        valid = VALID_CANDIDATES[objective]
        unknown = [c for c in candidates if c not in valid]
        if unknown:
            raise HTTPException(
                status_code=422,
                detail=(
                    f"unknown candidates {unknown} for objective {objective!r}; "
                    f"valid candidates: {list(valid)}"
                ),
            )
        # De-duplicate while preserving order (repeated names would double the cost).
        candidates = list(dict.fromkeys(candidates))

        with _JOB_LOCK:
            running = self._active_job_locked()
            if running is not None:
                run_dataset, run_job = running
                raise HTTPException(
                    status_code=409,
                    detail=(
                        f"job {run_job} (dataset {run_dataset}) is already running — "
                        "one training job at a time server-wide"
                    ),
                )

            job_id = "job_" + uuid.uuid4().hex[:8]
            job_dir = _jobs_dir(dataset_id) / job_id
            status_payload: dict[str, Any] = {
                "job_id": job_id,
                "dataset_id": dataset_id,
                "objective": objective,
                "status": "queued",
                "progress": {
                    "done": 0,
                    "total": len(candidates),
                    "current": None,
                    "elapsed_s": 0.0,
                },
                "results": {name: {"status": "pending"} for name in candidates},
                "error": None,
                "created_at": _utc_now_iso(),
                "finished_at": None,
            }
            _write_status_file(job_dir, status_payload)
            try:
                spawn_training_job(dataset_id, job_id, objective, candidates, job_dir)
            except OSError as exc:
                status_payload["status"] = "failed"
                status_payload["error"] = f"could not spawn the training subprocess: {exc}"
                status_payload["finished_at"] = _utc_now_iso()
                _write_status_file(job_dir, status_payload)
                raise HTTPException(
                    status_code=503,
                    detail=f"could not spawn the training subprocess: {exc}",
                ) from exc
            _running_job = (dataset_id, job_id)

        return {
            "job_id": job_id,
            "status": "queued",
            "links": {"status": f"/workflow/jobs/{job_id}"},
        }

    def _active_job_locked(self) -> tuple[str, str] | None:
        """The currently active job ``(dataset_id, job_id)`` or None (caller holds the lock).

        Consults the in-memory guard first, then falls back to an on-disk scan
        (covers jobs whose in-memory entry was lost); clears the guard when the
        recorded job reached a terminal state.
        """
        global _running_job
        if _running_job is not None:
            dataset_id, job_id = _running_job
            status_file = _jobs_dir(dataset_id) / job_id / "status.json"
            if _active_status(_read_status_file(status_file)):
                return _running_job
            _running_job = None
        if WORKFLOW_MODELS_ROOT.exists():
            for status_file in WORKFLOW_MODELS_ROOT.glob("*/jobs/*/status.json"):
                payload = _read_status_file(status_file)
                if _active_status(payload):
                    dataset_id = status_file.parents[2].name
                    return (dataset_id, status_file.parent.name)
        return None

    # -- reads (§3.9) ----------------------------------------------------------

    def get_job(self, job_id: str) -> dict[str, Any]:
        """Live view of one job's status file; 404 on unknown/malformed ids."""
        if not _valid_job_id(job_id):
            raise HTTPException(status_code=404, detail=f"unknown job id: {job_id!r}")
        if WORKFLOW_MODELS_ROOT.exists():
            for status_file in WORKFLOW_MODELS_ROOT.glob(f"*/jobs/{job_id}/status.json"):
                payload = _read_status_file(status_file)
                if payload is not None:
                    return self._serve_status(payload)
        raise HTTPException(status_code=404, detail=f"unknown job id: {job_id!r}")

    def list_jobs(self, dataset_id: str) -> list[dict[str, Any]]:
        """All jobs of a dataset, newest first (§3.9 scan)."""
        try:
            get_record(dataset_id)
        except UnknownDataset as exc:
            raise HTTPException(status_code=404, detail=str(exc)) from exc
        statuses = [self._serve_status(p) for p in job_status_scan(dataset_id)]
        statuses.sort(key=lambda p: str(p.get("created_at") or ""), reverse=True)
        return statuses

    @staticmethod
    def _serve_status(payload: dict[str, Any]) -> dict[str, Any]:
        """Normalize the on-disk payload to the §3.9 API shape (``complete`` -> ``done``)."""
        served = dict(payload)
        served["status"] = normalize_job_status(payload.get("status"))
        return served

    def _job_dir_for(self, job_id: str) -> tuple[str, Path, dict[str, Any]]:
        """Locate a job dir by id -> ``(dataset_id, job_dir, status payload)``; 404."""
        if _valid_job_id(job_id) and WORKFLOW_MODELS_ROOT.exists():
            for status_file in WORKFLOW_MODELS_ROOT.glob(f"*/jobs/{job_id}/status.json"):
                payload = _read_status_file(status_file)
                if payload is not None:
                    return status_file.parents[2].name, status_file.parent, payload
        raise HTTPException(status_code=404, detail=f"unknown job id: {job_id!r}")

    # -- models merge (§3.9 comparison table) ---------------------------------

    def models_payload(self, dataset_id: str, objective: str) -> dict[str, Any]:
        """Merge the latest successful result per candidate across jobs (§3.9).

        ``best`` follows the objective's selection rule (regression: val RMSLE
        min; classification: val PR-AUC max); the regression bootstrap compares
        best vs runner-up over the persisted val prediction vectors
        (``paired_bootstrap_rmsle_diff``) and is omitted otherwise (§3.9).

        Red-team F1: every row carries the ``prepare_fingerprint`` its job
        trained on plus ``stale_split`` when it no longer matches the current
        prepare (a re-prepare supersedes the split); the bootstrap is ``null``
        whenever the compared pair spans different fingerprints — a
        cross-split comparison is meaningless. Stale rows stay visible
        (honesty = label, not hide).
        """
        try:
            record = get_record(dataset_id)
        except UnknownDataset as exc:
            raise HTTPException(status_code=404, detail=str(exc)) from exc

        # Latest done result per candidate (jobs iterated oldest -> newest wins).
        merged: dict[str, dict[str, Any]] = {}
        statuses = job_status_scan(dataset_id)
        statuses.sort(key=lambda p: str(p.get("created_at") or ""))
        for payload in statuses:
            if str(payload.get("objective")) != objective:
                continue
            if normalize_job_status(payload.get("status")) not in DONE_JOB_STATES:
                continue
            job_id = str(payload.get("job_id"))
            for name, result in (payload.get("results") or {}).items():
                if not isinstance(result, dict):
                    continue
                if normalize_job_status(result.get("status")) not in DONE_JOB_STATES:
                    continue
                merged[name] = {
                    "name": name,
                    "job_id": job_id,
                    "trained_at": payload.get("finished_at"),
                    "val_metrics": result.get("val_metrics"),
                    "best_params": result.get("best_params"),
                    "train_seconds": result.get("train_seconds"),
                    # Red-team F1: the prepare fingerprint the job trained on
                    # (persisted in status.json by the job runner).
                    "prepare_fingerprint": payload.get("prepare_fingerprint"),
                }

        ranking = self._rank_candidates(objective, merged)

        report = None
        try:
            report = preview_report(dataset_id)
        except UnknownDataset:
            report = None
        current_fingerprint = report.fingerprint if report else None

        candidates: list[dict[str, Any]] = []
        for name, entry in merged.items():
            row = {key: _jsonable(value) for key, value in entry.items()}
            row["best"] = bool(ranking and name == ranking[0])
            # F1 honesty label: the result stays visible but is flagged when
            # the dataset was re-prepared after this job trained (its metrics
            # describe a previous split). Missing fingerprints (pre-F1 jobs)
            # flag too — provenance cannot be verified for them.
            row["stale_split"] = bool(
                current_fingerprint is not None
                and entry.get("prepare_fingerprint") != current_fingerprint
            )
            candidates.append(row)
        candidates.sort(
            key=lambda row: ranking.index(row["name"]) if row["name"] in ranking else len(ranking)
        )

        provenance = {
            "dataset": record.name,
            "n_train": int(report.splits["train"]) if report else None,
            "n_val": int(report.splits["val"]) if report else None,
            "simulated_target": objective == "classification",
            "prepare_fingerprint": current_fingerprint,
        }

        bootstrap = None
        if objective == "regression" and len(ranking) >= 2:
            # F1: a cross-split comparison is meaningless — only bootstrap a
            # pair trained on the same prepare fingerprint.
            same_split = merged[ranking[0]].get("prepare_fingerprint") == merged[
                ranking[1]
            ].get("prepare_fingerprint")
            if same_split:
                bootstrap = self._regression_bootstrap(dataset_id, merged, ranking[0], ranking[1])

        return {
            "objective": objective,
            "dataset_id": dataset_id,
            "candidates": candidates,
            "selection": dict(_SELECTION_BLOCKS[objective]),
            "bootstrap": bootstrap,
            "provenance": provenance,
        }

    @staticmethod
    def _rank_candidates(objective: str, merged: dict[str, dict[str, Any]]) -> list[str]:
        """Best-first candidate names under the objective's selection rule."""
        def metric(entry: dict[str, Any], key: str) -> float:
            value = (entry.get("val_metrics") or {}).get(key)
            return float(value) if isinstance(value, (int, float)) else math.nan

        if objective == "regression":
            return sorted(
                merged,
                key=lambda n: (
                    metric(merged[n], "rmsle") if not math.isnan(metric(merged[n], "rmsle")) else math.inf,
                    metric(merged[n], "rmse") if not math.isnan(metric(merged[n], "rmse")) else math.inf,
                ),
            )
        if objective == "classification":
            return sorted(
                merged,
                key=lambda n: (
                    -metric(merged[n], "pr_auc") if not math.isnan(metric(merged[n], "pr_auc")) else math.inf,
                    metric(merged[n], "brier") if not math.isnan(metric(merged[n], "brier")) else math.inf,
                ),
            )
        return sorted(merged)

    @staticmethod
    def _regression_bootstrap(
        dataset_id: str,
        merged: dict[str, dict[str, Any]],
        best: str,
        runner_up: str,
    ) -> dict[str, Any] | None:
        """Paired bootstrap of the val RMSLE gap (best - runner-up), §3.9.

        Reads the persisted ``candidates/<candidate>/val_predictions.csv``
        (``Id, y_true, y_pred_log, y_pred_dollar``, §3.10) of both jobs and
        reuses :func:`ml.evaluation.select.paired_bootstrap_rmsle_diff`
        (``y_true`` is dollar-space in the file; the function wants log1p).
        Returns ``None`` when the vectors are unavailable/unusable — the key
        is then omitted (never fabricated).
        """
        try:
            from ml.evaluation.select import paired_bootstrap_rmsle_diff  # noqa: PLC0415

            vectors: dict[str, pd.DataFrame] = {}
            for name in (best, runner_up):
                csv_path = (
                    _jobs_dir(dataset_id)
                    / str(merged[name]["job_id"])
                    / "candidates"
                    / name
                    / "val_predictions.csv"
                )
                vectors[name] = pd.read_csv(csv_path)
            y_true = vectors[best]["y_true"].to_numpy(dtype=float)
            if not np.array_equal(y_true, vectors[runner_up]["y_true"].to_numpy(dtype=float)):
                raise ValueError("val prediction vectors disagree on y_true")
            result = paired_bootstrap_rmsle_diff(
                np.log1p(y_true),
                vectors[best]["y_pred_log"].to_numpy(dtype=float),
                vectors[runner_up]["y_pred_log"].to_numpy(dtype=float),
                best,
                runner_up,
            )
            return {
                "runner_up": result.runner_up,
                "observed_rmsle_diff": result.observed_diff,
                "ci95": [result.ci_low, result.ci_high],
                "prob_runner_up_better": result.prob_runner_up_better,
                "n_resamples": result.n_resamples,
                "seed": result.seed,
                "significant": result.significant,
            }
        except Exception as exc:  # noqa: BLE001 — honesty: omit, never fabricate
            logger.warning("regression bootstrap unavailable for %s: %s", dataset_id, exc)
            return None

    # -- evaluation (§3.10; engine is WF-B2) -----------------------------------

    def evaluation_payload(self, job_id: str, candidate: str) -> dict[str, Any]:
        """Curves/metrics for one completed candidate (§3.10).

        Raises:
            HTTPException: 404 unknown job or candidate; 409 the job/candidate
                has no completed result; 503 the WF-B2 evaluation module is not
                importable yet.
        """
        _dataset_id, job_dir, status = self._job_dir_for(job_id)
        results = status.get("results") or {}
        if candidate not in results:
            raise HTTPException(
                status_code=404,
                detail=f"job {job_id} has no candidate {candidate!r} "
                f"(known: {sorted(results)})",
            )
        if normalize_job_status(results[candidate].get("status")) not in DONE_JOB_STATES:
            raise HTTPException(
                status_code=409,
                detail=(
                    f"candidate {candidate!r} of job {job_id} has no completed result "
                    f"(status: {results[candidate].get('status')})"
                ),
            )
        try:
            from ml.workflow.evaluate import evaluation_payload  # noqa: PLC0415
        except ImportError as exc:
            raise HTTPException(
                status_code=503,
                detail="the workflow training engine (ml.workflow.evaluate) is not "
                "available in this build",
            ) from exc
        try:
            payload = evaluation_payload(job_dir, candidate)
        except FileNotFoundError as exc:
            raise HTTPException(status_code=404, detail=str(exc)) from exc
        except ValueError as exc:
            raise HTTPException(status_code=422, detail=str(exc)) from exc
        return payload


__all__ = [
    "VALID_CANDIDATES",
    "WorkflowJobService",
    "spawn_training_job",
    "sweep_orphaned_jobs",
]
