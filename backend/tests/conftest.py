"""Shared fixtures/helpers for the WF-B4 workflow integration tests (workflow-architecture §8/§9).

This file is **additive only**: there was no ``backend/tests/conftest.py`` before
WF-B4 and the five pre-existing test modules keep their own module-scoped
clients — nothing here is registered for them (they never request these
fixtures).

Design notes:

- **One app for all workflow modules.** ``create_app`` loads the champions and
  warms the SHAP singleton (~11 s measured), so every ``test_workflow_*``
  module shares a single session-scoped ``TestClient``. The app's prediction
  log is a session tmp file, so even the champion-parity calls never touch the
  real ``logs/predictions.jsonl``.
- **Per-module storage roots.** ``workflow_roots`` redirects the WF-B1 storage
  roots (``ml.workflow.datasets.UPLOADS_ROOT`` / ``WORKFLOW_MODELS_ROOT`` plus
  the job service's import-time copy of the latter) onto a per-module tmp dir
  — the WF-B1 test pattern (``tests/ml/workflow/test_datasets.py``) extended to
  the HTTP layer. It also resets the job service's process-global guard
  (``_running_job``) and sweep flag (``_orphan_sweep_done``) so modules stay
  independent of each other and of execution order.
- **Real subprocesses get the env hooks.** Modules that spawn real training
  subprocesses through the API additionally request ``workflow_subprocess_env``
  (``PROPULSE_UPLOADS_ROOT`` / ``PROPULSE_WORKFLOW_MODELS_ROOT`` /
  ``PYTHONPATH`` — the documented redirection hooks of
  ``ml.workflow.train_job``), so subprocess writes land in the same tmp roots.
"""
from __future__ import annotations

import json
import re
import time
from pathlib import Path
from types import SimpleNamespace
from typing import Any

import pandas as pd
import pytest
from fastapi.testclient import TestClient

from backend.app.config import Settings
from backend.app.main import create_app
import backend.app.services.workflow.jobs as jobs_service
from ml.data.ingest import RAW_TRAIN_CSV
from ml.paths import REPO_ROOT
from ml.workflow import datasets

#: Rows of the crafted small upload (an Ames-schema slice of the bundled raw
#: CSV, generated per run — no large CSV is committed). 240 rows split
#: 168/36/36 at the default fractions (>= MIN_TRAIN_ROWS=150 post-split train).
SLICE_ROWS = 240

#: Job id scheme (§3.9).
JOB_ID_RE = re.compile(r"^job_[0-9a-f]{8}$")

#: Dataset id scheme for uploads (§2.1).
DATASET_ID_RE = re.compile(r"^ds_[0-9a-f]{8}$")

#: Minimal valid ``PropertyInput`` (same shape the champion ``/predict`` takes —
#: required fields only, per SPEC §8).
MINIMAL_PROPERTY_PAYLOAD: dict[str, Any] = {
    "neighborhood": "NAmes",
    "bedrooms": 3,
    "full_bath": 2,
    "half_bath": 1,
    "bsmt_full_bath": 1,
    "bsmt_half_bath": 0,
    "gr_liv_area": 1500,
    "lot_area": 9000,
    "total_bsmt_sf": 900,
    "year_built": 1995,
    "overall_qual": 6,
    "overall_cond": 5,
    "garage_cars": 2,
    "fireplaces": 1,
    "central_air": True,
}

#: Default stage-06 request body (§3.8).
DEFAULT_PREPROCESS_BODY: dict[str, Any] = {
    "config": {
        "outlier_rule": True,
        "split_strategy": "auto",
        "val_frac": 0.15,
        "test_frac": 0.15,
        "seed": 42,
    }
}


def ames_slice_csv(n: int = SLICE_ROWS) -> bytes:
    """CSV bytes of the first ``n`` rows of the bundled raw Ames train.csv.

    A generator, not a committed fixture file: slicing the real raw CSV
    guarantees the 81-column schema contract without hand-fabricating one
    (the WF-B1/B2 test pattern).
    """
    return pd.read_csv(RAW_TRAIN_CSV).head(n).to_csv(index=False).encode("utf-8")


def wait_for_job(
    client: TestClient,
    job_id: str,
    *,
    timeout_s: float = 240.0,
    interval_s: float = 0.5,
) -> dict[str, Any]:
    """Poll ``GET /workflow/jobs/{job_id}`` until a terminal status.

    Returns the final payload. Fails the test on timeout; a ``failed`` status
    is returned (not raised) so callers can assert on it.
    """
    deadline = time.monotonic() + timeout_s
    last: dict[str, Any] = {}
    while time.monotonic() < deadline:
        response = client.get(f"/workflow/jobs/{job_id}")
        assert response.status_code == 200, response.text
        last = response.json()
        if last["status"] in {"done", "failed"}:
            return last
        time.sleep(interval_s)
    pytest.fail(f"job {job_id} did not reach a terminal status in {timeout_s}s: {last}")


def spawn_in_process(
    dataset_id: str, job_id: str, objective: str, candidates: list[str], job_dir: Path
) -> SimpleNamespace:
    """``spawn_training_job`` replacement: run the real job runner in-process.

    Exercises the full status-file protocol (queued -> done/failed, artifacts,
    exit-code semantics) without paying the ~8 s fresh-interpreter startup of
    the real subprocess — the subprocess boundary itself is covered by the
    journey modules' real runs.
    """
    from ml.workflow.train_job import run_job  # noqa: PLC0415

    run_job(dataset_id, job_id, objective, list(candidates))
    return SimpleNamespace(pid=-1)


def write_status_file(
    models_root: Path,
    dataset_id: str,
    job_id: str,
    *,
    status: str = "done",
    objective: str = "regression",
    results: dict[str, Any] | None = None,
    error: str | None = None,
    created_at: str = "2026-01-01T00:00:00+00:00",
    finished_at: str | None = "2026-01-01T00:01:00+00:00",
) -> Path:
    """Hand-write a §3.9 ``status.json`` under ``<models>/<ds>/jobs/<job>/``."""
    job_dir = models_root / dataset_id / "jobs" / job_id
    job_dir.mkdir(parents=True, exist_ok=True)
    payload = {
        "job_id": job_id,
        "dataset_id": dataset_id,
        "objective": objective,
        "status": status,
        "progress": {"done": 0, "total": len(results or {}), "current": None, "elapsed_s": 0.0},
        "results": results or {},
        "error": error,
        "created_at": created_at,
        "finished_at": finished_at,
    }
    path = job_dir / "status.json"
    path.write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8")
    return path


def upload_dataset(
    client: TestClient, body: bytes, *, filename: str = "upload.csv"
) -> Any:
    """POST a CSV upload and return the raw response (caller asserts)."""
    return client.post(
        f"/workflow/datasets?filename={filename}",
        content=body,
        headers={"content-type": "text/csv"},
    )


@pytest.fixture(scope="session")
def workflow_client(tmp_path_factory: pytest.TempPathFactory) -> TestClient:
    """One session-wide TestClient for all workflow modules (tmp prediction log)."""
    log_path = tmp_path_factory.mktemp("wf_predlog") / "predictions.jsonl"
    app = create_app(Settings(prediction_log_path=str(log_path)))
    with TestClient(app) as client:
        yield client


@pytest.fixture(scope="module")
def workflow_roots(tmp_path_factory: pytest.TempPathFactory) -> SimpleNamespace:
    """Redirect workflow storage roots to a per-module tmp dir for one module.

    Yields ``SimpleNamespace(tmp=..., uploads=..., models=...)``. Also resets
    the job service's process-global single-job guard and orphan-sweep flag at
    setup *and* teardown so a hanging fake job in one module can never block
    another module's jobs.
    """
    tmp = tmp_path_factory.mktemp("wf_roots")
    uploads = tmp / "uploads"
    models = tmp / "workflow_models"
    monkey = pytest.MonkeyPatch()
    monkey.setattr(datasets, "UPLOADS_ROOT", uploads)
    monkey.setattr(datasets, "WORKFLOW_MODELS_ROOT", models)
    # The job service imported WORKFLOW_MODELS_ROOT by value (from-import), so
    # its module global must be redirected too.
    monkey.setattr(jobs_service, "WORKFLOW_MODELS_ROOT", models)
    jobs_service._running_job = None  # noqa: SLF001 — process-global guard (§4.8)
    jobs_service._orphan_sweep_done = True  # noqa: SLF001 — no surprise sweeps
    try:
        yield SimpleNamespace(tmp=tmp, uploads=uploads, models=models)
    finally:
        jobs_service._running_job = None  # noqa: SLF001
        jobs_service._orphan_sweep_done = True  # noqa: SLF001
        monkey.undo()


@pytest.fixture(scope="module")
def workflow_subprocess_env(workflow_roots: SimpleNamespace) -> SimpleNamespace:
    """Env hooks so REAL training subprocesses write to the module's tmp roots."""
    monkey = pytest.MonkeyPatch()
    monkey.setenv("PROPULSE_UPLOADS_ROOT", str(workflow_roots.uploads))
    monkey.setenv("PROPULSE_WORKFLOW_MODELS_ROOT", str(workflow_roots.models))
    monkey.setenv("PYTHONPATH", str(REPO_ROOT))
    try:
        yield workflow_roots
    finally:
        monkey.undo()
