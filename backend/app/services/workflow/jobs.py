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
- **One operation at a time** (§4.8) — a filesystem admission lock shared by all
  API processes serializes training and preprocessing. The trainer owns the lock
  for the full fit; stale preparation fingerprints are rejected before fitting
  and again at evaluation/prediction boundaries.
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
import os
import re
import subprocess
import sys
import threading
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import numpy as np
import pandas as pd
from filelock import FileLock, Timeout
from fastapi import HTTPException

from ml.paths import REPO_ROOT
from ml.workflow.admission import TrainingAdmissionLock, read_training_owner
from ml.workflow.datasets import (
    UnknownDataset,
    get_record,
    sandbox_dir,
)
from ml.workflow.prepare import preview_report
from ml.workflow import datasets as wf_datasets

from backend.app.services.workflow.datasets import (
    ACTIVE_JOB_STATES,
    DONE_JOB_STATES,
    WorkflowDatasetService,
    job_status_scan,
    normalize_job_status,
)

logger = logging.getLogger(__name__)

#: Job id scheme (§3.9): ``job_`` + uuid8 — mirrors the dataset uuid8 scheme.
_JOB_ID_RE = re.compile(r"^job_[0-9a-f]{8}$")

# One running job plus one waiting job bounds resident trainer subprocesses on
# small deployments. Additional work returns 409 instead of spawning more Python
# children that would each load the ML stack while waiting for the shared lock.
MAX_OUTSTANDING_WORKFLOW_JOBS = 2

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

# Cross-process training/preprocessing admission is authoritative in
# TrainingAdmissionLock. No process-local admission mutex is used as the
# concurrency authority.


# ---------------------------------------------------------------------------
# Small helpers
# ---------------------------------------------------------------------------

def _utc_now_iso() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def _valid_job_id(job_id: str) -> bool:
    return bool(_JOB_ID_RE.fullmatch(job_id or ""))


def _jobs_dir(dataset_id: str) -> Path:
    return sandbox_dir(dataset_id) / "jobs"


def _read_status_file(path: Path) -> dict[str, Any] | None:
    try:
        payload = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError):  # JSONDecodeError + UnicodeDecodeError
        return None
    return payload if isinstance(payload, dict) else None


def _write_status_file(job_dir: Path, payload: dict[str, Any]) -> None:
    """Atomically rewrite ``status.json`` (tmp sibling + ``os.replace``).

    Polling readers (``get_job``/``job_status_scan``) run on other request
    threads, so the rewrite must be atomic — the same protocol the engine
    uses (``ml.workflow.train_job._write_status``); a torn read would look
    like a missing/corrupt job.
    """
    job_dir.mkdir(parents=True, exist_ok=True)
    path = job_dir / "status.json"
    tmp = path.with_name(path.name + ".tmp")
    tmp.write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8")
    os.replace(tmp, path)


def _active_status(payload: dict[str, Any] | None) -> bool:
    return payload is not None and str(payload.get("status")) in ACTIVE_JOB_STATES


def _active_workflow_jobs() -> list[dict[str, Any]]:
    """Return every queued/running job across datasets (training is globally serialized)."""
    root = wf_datasets.WORKFLOW_MODELS_ROOT
    if not root.exists():
        return []
    active: list[dict[str, Any]] = []
    for status_file in root.glob("*/jobs/*/status.json"):
        payload = _read_status_file(status_file)
        if _active_status(payload):
            active.append(payload)
    return active


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

    # Keep the Popen object alive until the child exits and reap it in the
    # background. The trainer owns the status-file protocol, but discarding
    # Popen immediately lets __del__ emit ResourceWarning while a valid job is
    # still training (and can leave a child unreaped in short-lived callers).
    threading.Thread(
        target=process.wait,
        name=f"workflow-reap-{job_id}",
        daemon=True,
    ).start()

    logger.info(
        "spawned training job %s (dataset=%s objective=%s candidates=%s pid=%s)",
        job_id, dataset_id, objective, candidates, process.pid,
    )
    return process


def sweep_orphaned_jobs() -> int:
    """Mark active status files failed only when no operation owns the lock."""
    guard = TrainingAdmissionLock(
        dataset_id="*", job_id=None, operation="orphan-sweep"
    )
    if not guard.acquire():
        return 0
    try:
        flipped = 0
        if not wf_datasets.WORKFLOW_MODELS_ROOT.exists():
            return 0
        for status_file in wf_datasets.WORKFLOW_MODELS_ROOT.glob("*/jobs/*/status.json"):
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
    finally:
        guard.release()



# ---------------------------------------------------------------------------
# The service
# ---------------------------------------------------------------------------

class WorkflowJobService:
    """Stateless job facade; admission is cross-process and filesystem-backed."""

    def __init__(self) -> None:
        pass

    # -- create (§3.9) --------------------------------------------------------

    def create_job(
        self, dataset_id: str, objective: str, candidates: list[str]
    ) -> dict[str, Any]:
        """Validate, reserve a bounded queue slot, persist status, and spawn the trainer.

        A separate cross-process submission lock makes the queue-size check
        atomic. The shared training lock is probed before reading preparation
        state so uploads/re-preparation are not read while being rewritten.
        The trainer itself owns the shared lock for the heavy fit.
        """
        try:
            record = get_record(dataset_id)
        except UnknownDataset as exc:
            raise HTTPException(status_code=404, detail=str(exc)) from exc

        from ml.workflow.candidates import OBJECTIVE_CANDIDATES  # noqa: PLC0415

        valid = OBJECTIVE_CANDIDATES[objective]
        unknown = [c for c in candidates if c not in valid]
        if unknown:
            raise HTTPException(
                status_code=422,
                detail=(
                    f"unknown candidates {unknown} for objective {objective!r}; "
                    f"valid candidates: {list(valid)}"
                ),
            )
        candidates = list(dict.fromkeys(candidates))

        job_id = "job_" + uuid.uuid4().hex[:8]
        job_dir = _jobs_dir(dataset_id) / job_id

        queue_root = wf_datasets.WORKFLOW_MODELS_ROOT
        queue_root.mkdir(parents=True, exist_ok=True)
        submission_lock = FileLock(str(queue_root / ".job-submission.lock"))
        try:
            submission_lock.acquire(timeout=0)
        except Timeout as exc:
            raise HTTPException(
                status_code=409,
                detail="another workflow job is being submitted; retry shortly",
            ) from exc

        reservation: TrainingAdmissionLock | None = None
        reservation_acquired = False
        try:
            active_jobs = _active_workflow_jobs()
            if len(active_jobs) >= MAX_OUTSTANDING_WORKFLOW_JOBS:
                active_ids = [
                    str(job.get("job_id") or "unknown") for job in active_jobs
                ]
                raise HTTPException(
                    status_code=409,
                    detail=(
                        "workflow training queue is full "
                        f"({len(active_jobs)}/{MAX_OUTSTANDING_WORKFLOW_JOBS} "
                        f"queued or running jobs; active jobs: {active_ids})"
                    ),
                )

            # Reserve the shared lock while reading preparation state and
            # writing the queued status when it is free. If a trainer already
            # owns it, one waiting job is permitted by the bounded queue. A
            # preprocess/orphan-sweep owner is never treated as a training queue.
            reservation = TrainingAdmissionLock(
                dataset_id=dataset_id,
                job_id=job_id,
                operation="job-submission",
            )
            reservation_acquired = reservation.acquire()
            if not reservation_acquired:
                owner = read_training_owner()
                if owner is None or owner.get("job_id") is None:
                    operation = (
                        str(owner.get("operation") or "unknown")
                        if owner is not None
                        else "unknown"
                    )
                    raise HTTPException(
                        status_code=409,
                        detail=(
                            "cannot submit training while workflow operation "
                            f"{operation!r} is active; retry when it finishes"
                        ),
                    )

            # Check row-window eligibility only after admission confirms that
            # preparation is not rewriting the persisted split artifacts.
            can_train, reason = WorkflowDatasetService._train_window(record)
            if not can_train:
                raise HTTPException(status_code=400, detail=reason)

            report = preview_report(dataset_id)
            prepare_fingerprint = report.fingerprint if report is not None else None
            status_payload: dict[str, Any] = {
                "job_id": job_id,
                "dataset_id": dataset_id,
                "objective": objective,
                "prepare_fingerprint": prepare_fingerprint,
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

            # The child must be able to acquire the workflow lock. Releasing
            # after persisting status makes concurrent submission visible
            # before another request can reserve a queue slot.
            if reservation_acquired:
                reservation.release()
                reservation_acquired = False

            try:
                spawn_training_job(
                    dataset_id, job_id, objective, candidates, job_dir
                )
            except OSError as exc:
                status_payload["status"] = "failed"
                status_payload["error"] = (
                    f"could not spawn the training subprocess ({exc.__class__.__name__})"
                )
                status_payload["finished_at"] = _utc_now_iso()
                _write_status_file(job_dir, status_payload)
                raise HTTPException(
                    status_code=503,
                    detail=f"could not spawn the training subprocess ({exc.__class__.__name__})",
                ) from exc

            logger.info(
                "accepted training job %s (dataset=%s objective=%s candidates=%s fingerprint=%s)",
                job_id,
                dataset_id,
                objective,
                candidates,
                prepare_fingerprint,
            )
            return {
                "job_id": job_id,
                "status": "queued",
                "links": {"status": f"/workflow/jobs/{job_id}"},
            }
        finally:
            if reservation_acquired and reservation is not None:
                reservation.release()
            submission_lock.release()

    # -- reads (§3.9) ----------------------------------------------------------

    def get_job(self, job_id: str) -> dict[str, Any]:
        """Live view of one job's status file; 404 on unknown/malformed ids."""
        _, _, payload = self._job_dir_for(job_id)
        return self._serve_status(payload)

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
        if _valid_job_id(job_id) and wf_datasets.WORKFLOW_MODELS_ROOT.exists():
            for status_file in wf_datasets.WORKFLOW_MODELS_ROOT.glob(f"*/jobs/{job_id}/status.json"):
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

        report = None
        try:
            report = preview_report(dataset_id)
        except UnknownDataset:
            report = None
        current_fingerprint = report.fingerprint if report else None

        fresh = (
            {
                name: entry
                for name, entry in merged.items()
                if current_fingerprint is not None
                and entry.get("prepare_fingerprint") == current_fingerprint
            }
            if current_fingerprint is not None
            else {}
        )
        ranking = self._rank_candidates(objective, fresh)

        candidates: list[dict[str, Any]] = []
        for name, entry in merged.items():
            row = {key: _jsonable(value) for key, value in entry.items()}
            row["best"] = bool(ranking and name == ranking[0])
            # F1 honesty label: the result stays visible but is flagged when
            # the dataset was re-prepared after this job trained (its metrics
            # describe a previous split). Missing fingerprints (pre-F1 jobs)
            # flag too — provenance cannot be verified for them.
            stale = (
                current_fingerprint is None
                or entry.get("prepare_fingerprint") != current_fingerprint
            )
            row["stale_split"] = stale
            row["eligible_for_selection"] = not stale
            if stale:
                row["stale_note"] = (
                    "This result was trained against a different or unverifiable "
                    "preprocessing fingerprint. Re-run preprocessing and training "
                    "before using it for current model comparison."
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
            bootstrap = self._regression_bootstrap(
                dataset_id, fresh, ranking[0], ranking[1]
            )

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
                has no completed result.
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
        report = None
        try:
            report = preview_report(_dataset_id)
        except UnknownDataset:
            report = None
        current_fingerprint = report.fingerprint if report else None
        job_fingerprint = status.get("prepare_fingerprint")
        if current_fingerprint is None or job_fingerprint != current_fingerprint:
            raise HTTPException(
                status_code=409,
                detail=(
                    f"candidate {candidate!r} of job {job_id} is stale or unverifiable: "
                    "its training fingerprint does not match the current preprocessing "
                    "fingerprint; re-run preprocessing and training"
                ),
            )

        from ml.workflow.evaluate import evaluation_payload  # noqa: PLC0415

        try:
            payload = evaluation_payload(job_dir, candidate)
            payload["prepare_fingerprint"] = current_fingerprint
        except FileNotFoundError as exc:
            raise HTTPException(status_code=404, detail=str(exc)) from exc
        except ValueError as exc:
            raise HTTPException(status_code=422, detail=str(exc)) from exc
        return payload


__all__ = [
    "WorkflowJobService",
    "spawn_training_job",
    "sweep_orphaned_jobs",
]
