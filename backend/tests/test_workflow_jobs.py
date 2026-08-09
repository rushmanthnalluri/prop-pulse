"""Job-service mechanics through HTTP with the subprocess boundary patched (§3.9, §4.8).

``backend.app.services.workflow.jobs.spawn_training_job`` is the documented
WF-B4 patch point. Two fakes are used:

- ``spawn_in_process`` — runs the real ``ml.workflow.train_job.run_job``
  in-process (full status-file protocol, real artifacts, seconds instead of a
  fresh interpreter);
- hanging/failing fakes — for the concurrency guard and spawn-failure paths.

Also covered: the startup orphan sweep, the on-disk ``complete`` -> API ``done``
normalization, the auto-prepare self-healing (incl. the bundled-ames case),
and the 404/409/422 evaluation/predict guards driven by hand-written status
files. No real subprocess is spawned in this module.
"""
from __future__ import annotations

import os
from types import SimpleNamespace
from typing import Any

import pytest
from fastapi.testclient import TestClient

import backend.app.services.workflow.jobs as jobs_service
from backend.tests.conftest import (
    JOB_ID_RE,
    MINIMAL_PROPERTY_PAYLOAD,
    ames_slice_csv,
    spawn_in_process,
    upload_dataset,
    wait_for_job,
    write_status_file,
)

pytestmark = pytest.mark.usefixtures("workflow_roots")


def _hanging_spawn(calls: list[tuple[str, str]]) -> Any:
    """A spawn that never starts: the API-written ``queued`` status stays."""

    def _spawn(
        dataset_id: str, job_id: str, objective: str, candidates: list[str], job_dir: Any
    ) -> SimpleNamespace:
        calls.append((dataset_id, job_id))
        return SimpleNamespace(pid=os.getpid())

    return _spawn


def _force_failed(roots: SimpleNamespace, dataset_id: str, job_id: str) -> None:
    """Mark a job's status file failed and clear the in-memory single-job guard."""
    status_path = roots.models / dataset_id / "jobs" / job_id / "status.json"
    import json

    payload = json.loads(status_path.read_text(encoding="utf-8"))
    payload["status"] = "failed"
    payload["error"] = "terminated by the test"
    status_path.write_text(json.dumps(payload), encoding="utf-8")
    jobs_service._running_job = None  # noqa: SLF001


# ---------------------------------------------------------------------------
# Full lifecycle with the in-process spawn (auto-prepare self-healing, §3.9)
# ---------------------------------------------------------------------------

class TestLifecycleInProcessSpawn:
    def test_upload_job_end_to_end(
        self,
        workflow_client: TestClient,
        workflow_roots: SimpleNamespace,
        monkeypatch: pytest.MonkeyPatch,
    ) -> None:
        """202 -> done with real artifacts; unprepared upload is auto-prepared."""
        monkeypatch.setattr(jobs_service, "spawn_training_job", spawn_in_process)
        dataset_id = upload_dataset(
            workflow_client, ames_slice_csv(), filename="lifecycle.csv"
        ).json()["dataset_id"]
        try:
            accepted = workflow_client.post(
                f"/workflow/datasets/{dataset_id}/jobs",
                json={"objective": "regression", "candidates": ["linear"]},
            )
            assert accepted.status_code == 202, accepted.text
            body = accepted.json()
            assert JOB_ID_RE.fullmatch(body["job_id"])
            assert body["status"] == "queued"
            assert body["links"] == {"status": f"/workflow/jobs/{body['job_id']}"}

            job = wait_for_job(workflow_client, body["job_id"], timeout_s=60)
            assert job["status"] == "done"
            assert job["results"]["linear"]["status"] == "done"
            assert 0.0 < job["results"]["linear"]["val_metrics"]["rmsle"] < 0.5
            # §3.9 self-healing: the job auto-prepared the unprepared upload.
            assert (workflow_roots.models / dataset_id / "prepare_report.json").exists()

            models = workflow_client.get(
                f"/workflow/datasets/{dataset_id}/models", params={"objective": "regression"}
            ).json()
            assert [c["name"] for c in models["candidates"]] == ["linear"]
            assert models["candidates"][0]["best"] is True
            assert models["bootstrap"] is None  # needs >= 2 candidates

            evaluation = workflow_client.get(
                f"/workflow/jobs/{body['job_id']}/evaluation/linear"
            ).json()
            assert evaluation["split"] == "val"
            assert evaluation["n"] == 36

            prediction = workflow_client.post(
                f"/workflow/jobs/{body['job_id']}/predict/linear",
                json=MINIMAL_PROPERTY_PAYLOAD,
            )
            assert prediction.status_code == 200, prediction.text
            assert prediction.json()["provenance"]["source"] == "sandbox"

            state = workflow_client.get(f"/workflow/datasets/{dataset_id}/state").json()
            assert state["prepared"] is True
            assert state["can_evaluate"] is True
        finally:
            workflow_client.delete(f"/workflow/datasets/{dataset_id}")

    def test_ames_job_auto_prepares(
        self,
        workflow_client: TestClient,
        workflow_roots: SimpleNamespace,
        monkeypatch: pytest.MonkeyPatch,
    ) -> None:
        """Bundled ames without stage 06: the job self-heals (auto-prepare), not crashes.

        Regression test for the WF-B2 guard that only checked the canonical
        splits (which always exist for ames) and forgot the stage-06 sandbox
        artifacts — the job used to fail with FileNotFoundError.
        """
        monkeypatch.setattr(jobs_service, "spawn_training_job", spawn_in_process)
        accepted = workflow_client.post(
            "/workflow/datasets/ames/jobs",
            json={"objective": "clustering", "candidates": ["dbscan"]},
        )
        assert accepted.status_code == 202, accepted.text
        job = wait_for_job(workflow_client, accepted.json()["job_id"], timeout_s=120)
        assert job["status"] == "done", job.get("error")
        assert (workflow_roots.models / "ames" / "prepare_report.json").exists()
        evaluation = workflow_client.get(
            f"/workflow/jobs/{job['job_id']}/evaluation/dbscan"
        ).json()
        assert len(evaluation["assignments"]) == 25


# ---------------------------------------------------------------------------
# One job at a time (§4.8): 409 naming the running job; delete-busy 409
# ---------------------------------------------------------------------------

class TestConcurrencyGuard:
    def test_second_job_409_and_delete_busy_409(
        self,
        workflow_client: TestClient,
        workflow_roots: SimpleNamespace,
        monkeypatch: pytest.MonkeyPatch,
    ) -> None:
        """A hanging job blocks every other job server-wide and pins its dataset."""
        calls: list[tuple[str, str]] = []
        monkeypatch.setattr(jobs_service, "spawn_training_job", _hanging_spawn(calls))
        dataset_id = upload_dataset(
            workflow_client, ames_slice_csv(), filename="busy.csv"
        ).json()["dataset_id"]

        first = workflow_client.post(
            f"/workflow/datasets/{dataset_id}/jobs",
            json={"objective": "regression", "candidates": ["ridge"]},
        )
        assert first.status_code == 202, first.text
        job_id = first.json()["job_id"]
        try:
            # Same dataset…
            second = workflow_client.post(
                f"/workflow/datasets/{dataset_id}/jobs",
                json={"objective": "clustering", "candidates": ["dbscan"]},
            )
            assert second.status_code == 409
            assert job_id in second.json()["detail"]

            # …and any other dataset (the guard is server-wide, §4.8).
            other = workflow_client.post(
                "/workflow/datasets/ames/jobs",
                json={"objective": "regression", "candidates": ["linear"]},
            )
            assert other.status_code == 409
            assert job_id in other.json()["detail"]
            assert len(calls) == 1  # no second subprocess was ever spawned

            busy = workflow_client.delete(f"/workflow/datasets/{dataset_id}")
            assert busy.status_code == 409
            assert job_id in busy.json()["detail"]

            state = workflow_client.get(f"/workflow/datasets/{dataset_id}/state").json()
            assert state["jobs"]["running"] == 1

            live = workflow_client.get(f"/workflow/jobs/{job_id}").json()
            assert live["status"] == "queued"
            assert live["results"]["ridge"]["status"] == "pending"
        finally:
            _force_failed(workflow_roots, dataset_id, job_id)
            assert workflow_client.delete(f"/workflow/datasets/{dataset_id}").status_code == 204

    def test_spawn_failure_503_marks_failed(
        self,
        workflow_client: TestClient,
        workflow_roots: SimpleNamespace,
        monkeypatch: pytest.MonkeyPatch,
    ) -> None:
        """A spawn OSError -> 503, the status file is failed, the guard stays clear."""

        def _boom(*args: Any, **kwargs: Any) -> None:
            raise OSError("exec format error")

        monkeypatch.setattr(jobs_service, "spawn_training_job", _boom)
        dataset_id = upload_dataset(
            workflow_client, ames_slice_csv(), filename="spawnfail.csv"
        ).json()["dataset_id"]
        try:
            response = workflow_client.post(
                f"/workflow/datasets/{dataset_id}/jobs",
                json={"objective": "regression", "candidates": ["ridge"]},
            )
            assert response.status_code == 503
            assert "could not spawn" in response.json()["detail"]
            assert jobs_service._running_job is None  # noqa: SLF001 — guard not held

            jobs = workflow_client.get(f"/workflow/datasets/{dataset_id}/jobs").json()
            assert len(jobs) == 1
            assert jobs[0]["status"] == "failed"
            assert "could not spawn" in jobs[0]["error"]
        finally:
            workflow_client.delete(f"/workflow/datasets/{dataset_id}")


# ---------------------------------------------------------------------------
# Orphan sweep (§3.9/§4.8) + status normalization (complete -> done)
# ---------------------------------------------------------------------------

class TestOrphanSweepAndNormalization:
    def test_orphan_sweep_marks_active_jobs_failed(
        self, workflow_client: TestClient, workflow_roots: SimpleNamespace
    ) -> None:
        """queued/running status files are failed ('server restarted') on startup."""
        write_status_file(workflow_roots.models, "ames", "job_0000000a", status="running")
        write_status_file(workflow_roots.models, "ames", "job_0000000b", status="queued")
        write_status_file(workflow_roots.models, "ames", "job_0000000c", status="done")

        jobs_service._orphan_sweep_done = False  # simulate a fresh API process
        try:
            flipped = jobs_service.sweep_orphaned_jobs()
        finally:
            jobs_service._orphan_sweep_done = True
        assert flipped == 2

        for job_id in ("job_0000000a", "job_0000000b"):
            body = workflow_client.get(f"/workflow/jobs/{job_id}").json()
            assert body["status"] == "failed"
            assert "server restarted" in body["error"]
            assert body["finished_at"] is not None
        untouched = workflow_client.get("/workflow/jobs/job_0000000c").json()
        assert untouched["status"] == "done"

        # The sweep is once-per-process: a second call flips nothing new.
        jobs_service._orphan_sweep_done = False
        try:
            assert jobs_service.sweep_orphaned_jobs() == 0
        finally:
            jobs_service._orphan_sweep_done = True

    def test_complete_normalized_to_done(
        self, workflow_client: TestClient, workflow_roots: SimpleNamespace
    ) -> None:
        """An on-disk ``complete`` job is served as ``done`` and unlocks the stages."""
        dataset_id = upload_dataset(
            workflow_client, ames_slice_csv(60), filename="legacy.csv"
        ).json()["dataset_id"]
        try:
            write_status_file(
                workflow_roots.models,
                dataset_id,
                "job_0000000d",
                status="complete",  # legacy on-disk spelling
                results={"ridge": {"status": "done", "val_metrics": {"rmsle": 0.12}}},
            )
            body = workflow_client.get("/workflow/jobs/job_0000000d").json()
            assert body["status"] == "done"
            state = workflow_client.get(f"/workflow/datasets/{dataset_id}/state").json()
            assert state["jobs"] == {"total": 1, "running": 0, "done": 1, "failed": 0}
            assert state["objectives_done"] == ["regression"]
            assert state["can_evaluate"] is True
            assert state["can_predict_sandbox"] is True
        finally:
            workflow_client.delete(f"/workflow/datasets/{dataset_id}")


# ---------------------------------------------------------------------------
# Read-side guards driven by hand-written status files (no artifacts touched)
# ---------------------------------------------------------------------------

class TestReadGuards:
    def test_evaluation_unknown_candidate_404(
        self, workflow_client: TestClient, workflow_roots: SimpleNamespace
    ) -> None:
        """Unknown candidate -> 404 naming the job's real candidates."""
        write_status_file(
            workflow_roots.models,
            "ames",
            "job_0000000e",
            results={"ridge": {"status": "done", "val_metrics": {"rmsle": 0.12}}},
        )
        response = workflow_client.get("/workflow/jobs/job_0000000e/evaluation/lasso")
        assert response.status_code == 404
        assert "ridge" in response.json()["detail"]

    def test_evaluation_candidate_not_done_409(
        self, workflow_client: TestClient, workflow_roots: SimpleNamespace
    ) -> None:
        """A failed/pending candidate has no evaluation yet -> 409."""
        write_status_file(
            workflow_roots.models,
            "ames",
            "job_0000000f",
            status="failed",
            error="every candidate failed",
            results={"ridge": {"status": "failed", "error": "boom"}},
            finished_at="2026-01-01T00:02:00+00:00",
        )
        response = workflow_client.get("/workflow/jobs/job_0000000f/evaluation/ridge")
        assert response.status_code == 409

    def test_predict_job_not_done_409(
        self, workflow_client: TestClient, workflow_roots: SimpleNamespace
    ) -> None:
        """Predictions are served from completed jobs only -> 409 while queued."""
        write_status_file(
            workflow_roots.models,
            "ames",
            "job_00000010",
            status="queued",
            results={"ridge": {"status": "pending"}},
            finished_at=None,
        )
        response = workflow_client.post(
            "/workflow/jobs/job_00000010/predict/ridge", json=MINIMAL_PROPERTY_PAYLOAD
        )
        assert response.status_code == 409

    def test_predict_unknown_candidate_404(
        self, workflow_client: TestClient, workflow_roots: SimpleNamespace
    ) -> None:
        """Unknown predict candidate -> 404 naming the known ones."""
        write_status_file(
            workflow_roots.models,
            "ames",
            "job_00000011",
            results={"ridge": {"status": "done", "val_metrics": {"rmsle": 0.12}}},
        )
        response = workflow_client.post(
            "/workflow/jobs/job_00000011/predict/lasso", json=MINIMAL_PROPERTY_PAYLOAD
        )
        assert response.status_code == 404
        assert "ridge" in response.json()["detail"]

    def test_models_empty_dataset(
        self, workflow_client: TestClient, workflow_roots: SimpleNamespace
    ) -> None:
        """No jobs yet -> empty comparison, no bootstrap, null provenance counts."""
        dataset_id = upload_dataset(
            workflow_client, ames_slice_csv(60), filename="empty-models.csv"
        ).json()["dataset_id"]
        try:
            body = workflow_client.get(
                f"/workflow/datasets/{dataset_id}/models", params={"objective": "regression"}
            ).json()
            assert body["candidates"] == []
            assert body["bootstrap"] is None
            assert body["provenance"]["n_train"] is None
            assert body["selection"]["metric"] == "rmsle"
        finally:
            workflow_client.delete(f"/workflow/datasets/{dataset_id}")

    def test_jobs_listed_newest_first(
        self, workflow_client: TestClient, workflow_roots: SimpleNamespace
    ) -> None:
        """The jobs list is sorted by created_at desc."""
        for job_id, created in (
            ("job_00000021", "2026-01-01T00:00:00+00:00"),
            ("job_00000022", "2026-01-03T00:00:00+00:00"),
            ("job_00000023", "2026-01-02T00:00:00+00:00"),
        ):
            write_status_file(
                workflow_roots.models, "ames", job_id, created_at=created
            )
        listed = workflow_client.get("/workflow/datasets/ames/jobs").json()
        order = [
            j["job_id"] for j in listed
            if j["job_id"] in {"job_00000021", "job_00000022", "job_00000023"}
        ]
        assert order == ["job_00000022", "job_00000023", "job_00000021"]
