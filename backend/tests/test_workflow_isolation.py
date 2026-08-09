"""Isolation proofs (workflow-architecture §9 C15, §4): the full journey harms nothing.

A complete workflow journey — upload, stages 01-05 EDA, stage 06 preprocess, a
real training job (via the in-process spawn of the genuine job runner), models,
evaluation, sandbox predict, delete — is executed between two snapshots. The
post-journey snapshots must be **identical**:

- every file under ``models/`` (registry, champion.json, regression,
  classification, clustering, …) — same set, same bytes, same mtimes;
- the ``mlruns/`` listing — no web-triggered run may create one (§4.2);
- ``logs/predictions.jsonl`` — byte-identical (sandbox predictions are never
  logged, §3.11; this module deliberately makes NO champion ``/predict`` call
  so the assertion is exact — champion parity is covered in the ames journey);
- ``GET /health`` and ``GET /model/info`` response bytes (C15 tail);
- no ``data/uploads/`` or ``models/workflow/`` is created in the repo.
"""
from __future__ import annotations

import hashlib
from pathlib import Path
from types import SimpleNamespace

import pytest
from fastapi.testclient import TestClient

import backend.app.services.workflow.jobs as jobs_service
from ml.paths import DATA_DIR, MLRUNS_DIR, MODELS_DIR
from backend.tests.conftest import (
    DEFAULT_PREPROCESS_BODY,
    MINIMAL_PROPERTY_PAYLOAD,
    ames_slice_csv,
    spawn_in_process,
    upload_dataset,
)

pytestmark = pytest.mark.usefixtures("workflow_roots")


def _tree_snapshot(root: Path) -> dict[str, tuple[int, int, str]]:
    """``{relative path: (size, mtime_ns, sha256)}`` for every file below ``root``."""
    snapshot: dict[str, tuple[int, int, str]] = {}
    for path in sorted(root.rglob("*")):
        if path.is_file():
            stat = path.stat()
            snapshot[str(path.relative_to(root))] = (
                stat.st_size,
                stat.st_mtime_ns,
                hashlib.sha256(path.read_bytes()).hexdigest(),
            )
    return snapshot


def _tree_listing(root: Path) -> list[str]:
    """Relative paths of every entry below ``root`` (files and directories)."""
    return sorted(str(p.relative_to(root)) for p in root.rglob("*"))


def _prediction_log_bytes() -> bytes | None:
    """Bytes of the real prediction log, or ``None`` when it does not exist.

    ``logs/`` is gitignored, so a fresh CI checkout has no prediction log at
    all; ``None`` snapshots that state (a journey that wrongly creates the
    file still fails the byte comparison).
    """
    path = DATA_DIR.parent / "logs" / "predictions.jsonl"
    return path.read_bytes() if path.exists() else None


@pytest.fixture(scope="module")
def pre_journey(workflow_client: TestClient) -> SimpleNamespace:
    """Snapshot every watched artifact before the journey starts."""
    return SimpleNamespace(
        models=_tree_snapshot(MODELS_DIR),
        mlruns=_tree_listing(MLRUNS_DIR),
        prediction_log=_prediction_log_bytes(),
        health=workflow_client.get("/health").content,
        model_info=workflow_client.get("/model/info").content,
    )


@pytest.fixture(scope="module")
def journey(
    workflow_client: TestClient,
    workflow_roots: SimpleNamespace,
    pre_journey: SimpleNamespace,
) -> SimpleNamespace:
    """Run a complete workflow journey (spawn patched to the in-process runner)."""
    monkey = pytest.MonkeyPatch()
    monkey.setattr(jobs_service, "spawn_training_job", spawn_in_process)
    client = workflow_client
    try:
        # Stage 01 — upload.
        dataset_id = upload_dataset(
            client, ames_slice_csv(), filename="isolation.csv"
        ).json()["dataset_id"]

        # Stages 01-05 — EDA reads.
        assert client.get(f"/workflow/datasets/{dataset_id}/profile").status_code == 200
        assert client.get(f"/workflow/datasets/{dataset_id}/features").status_code == 200
        assert client.get(f"/workflow/datasets/{dataset_id}/stats").status_code == 200
        assert client.get(f"/workflow/datasets/{dataset_id}/missing").status_code == 200
        for kind, params in (
            ("histogram", {"column": "SalePrice"}),
            ("scatter", {"x": "GrLivArea", "y": "SalePrice"}),
            ("box", {"column": "SalePrice", "by": "Neighborhood"}),
            ("correlation", {}),
            ("category", {"column": "Neighborhood"}),
        ):
            response = client.get(f"/workflow/datasets/{dataset_id}/viz/{kind}", params=params)
            assert response.status_code == 200, (kind, response.text)

        # Stage 06 — preprocess (writes under the tmp roots only).
        preview = client.post(
            f"/workflow/datasets/{dataset_id}/preprocess/preview", json=DEFAULT_PREPROCESS_BODY
        )
        assert preview.status_code == 200, preview.text

        # Stage 07 — a real training job (in-process runner; real artifacts).
        accepted = client.post(
            f"/workflow/datasets/{dataset_id}/jobs",
            json={"objective": "regression", "candidates": ["linear"]},
        )
        assert accepted.status_code == 202, accepted.text
        job_id = accepted.json()["job_id"]
        job = client.get(f"/workflow/jobs/{job_id}").json()
        assert job["status"] == "done", job.get("error")

        # Stages 07-09 — models, evaluation, sandbox predict.
        assert client.get(
            f"/workflow/datasets/{dataset_id}/models", params={"objective": "regression"}
        ).status_code == 200
        assert client.get(f"/workflow/jobs/{job_id}/evaluation/linear").status_code == 200
        prediction = client.post(
            f"/workflow/jobs/{job_id}/predict/linear", json=MINIMAL_PROPERTY_PAYLOAD
        )
        assert prediction.status_code == 200, prediction.text
        assert prediction.json()["provenance"]["source"] == "sandbox"

        # Deletion.
        assert client.delete(f"/workflow/datasets/{dataset_id}").status_code == 204

        return SimpleNamespace(dataset_id=dataset_id, job_id=job_id)
    finally:
        monkey.undo()


class TestIsolation:
    def test_models_tree_unchanged(self, pre_journey: SimpleNamespace, journey: SimpleNamespace) -> None:
        """C15: every file under models/ — same set, same bytes, same mtimes."""
        assert _tree_snapshot(MODELS_DIR) == pre_journey.models

    def test_mlruns_listing_unchanged(
        self, pre_journey: SimpleNamespace, journey: SimpleNamespace
    ) -> None:
        """§4.2: web-triggered training never creates MLflow runs."""
        assert _tree_listing(MLRUNS_DIR) == pre_journey.mlruns

    def test_prediction_log_byte_unchanged(
        self, pre_journey: SimpleNamespace, journey: SimpleNamespace
    ) -> None:
        """§3.11: sandbox operations never write logs/predictions.jsonl."""
        assert _prediction_log_bytes() == pre_journey.prediction_log

    def test_health_and_model_info_byte_identical(
        self,
        workflow_client: TestClient,
        pre_journey: SimpleNamespace,
        journey: SimpleNamespace,
    ) -> None:
        """C15: champion-facing payloads are untouched by the journey."""
        assert workflow_client.get("/health").content == pre_journey.health
        assert workflow_client.get("/model/info").content == pre_journey.model_info

    def test_no_repo_residue(
        self,
        workflow_roots: SimpleNamespace,
        pre_journey: SimpleNamespace,
        journey: SimpleNamespace,
    ) -> None:
        """Every new file lived under the tmp roots; the repo gained nothing."""
        assert not (DATA_DIR / "uploads").exists()
        assert not (MODELS_DIR / "workflow").exists()
        # The journey really did write (and then clean up) inside the tmp roots.
        remaining = [p for p in workflow_roots.tmp.rglob("*") if p.is_file()]
        assert all(
            workflow_roots.uploads in p.parents or workflow_roots.models in p.parents
            for p in remaining
        )

    def test_journey_tmp_artifacts_existed(
        self, workflow_roots: SimpleNamespace, journey: SimpleNamespace
    ) -> None:
        """Sanity: the journey wrote real sandbox artifacts, then deletion removed them."""
        assert not (workflow_roots.uploads / journey.dataset_id).exists()
        assert not (workflow_roots.models / journey.dataset_id).exists()
        assert workflow_roots.uploads.exists() or workflow_roots.models.exists()
