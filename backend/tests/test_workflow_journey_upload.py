"""Full HTTP journey on a crafted small upload (workflow-architecture §8 WF-B4, §9).

The upload is a generated 240-row Ames-schema slice of the bundled raw CSV
(``ames_slice_csv`` — no committed CSV fixture). Covers upload + stages 01-05
on the upload, stage 06 split/clean/attach, real training subprocesses
(regression linear+ridge for the C9 bootstrap; classification logistic for
C11), sandbox predictions (C13-upload), gating transitions (C14) and dataset
deletion (C16).

All workflow writes land in a per-module tmp dir (``workflow_roots`` +
``workflow_subprocess_env``). Journey module: tests run in file order.
"""
from __future__ import annotations

from types import SimpleNamespace

import pytest
from fastapi.testclient import TestClient

from backend.tests.conftest import (
    DATASET_ID_RE,
    DEFAULT_PREPROCESS_BODY,
    MINIMAL_PROPERTY_PAYLOAD,
    ames_slice_csv,
    upload_dataset,
    wait_for_job,
)

pytestmark = pytest.mark.usefixtures("workflow_subprocess_env")

#: 240 rows at the default 70/15/15 fractions (verified live).
EXPECTED_SPLITS = {"train": 168, "val": 36, "test": 36, "rule": "time(YrSold)"}


@pytest.fixture(scope="module")
def uploaded(workflow_client: TestClient, workflow_subprocess_env: SimpleNamespace) -> str:
    """Upload the 240-row slice once for the module; return the dataset_id."""
    body = ames_slice_csv()
    response = upload_dataset(workflow_client, body, filename="ames-slice.csv")
    assert response.status_code == 201, response.text
    return response.json()["dataset_id"]


@pytest.fixture(scope="module")
def upload_jobs(workflow_client: TestClient, uploaded: str) -> SimpleNamespace:
    """Real subprocess jobs on the upload: regression (linear+ridge) + logistic."""
    client = workflow_client
    regression = client.post(
        f"/workflow/datasets/{uploaded}/jobs",
        json={"objective": "regression", "candidates": ["linear", "ridge"]},
    )
    assert regression.status_code == 202, regression.text
    regression_final = wait_for_job(client, regression.json()["job_id"], timeout_s=180)
    assert regression_final["status"] == "done", regression_final.get("error")

    classification = client.post(
        f"/workflow/datasets/{uploaded}/jobs",
        json={"objective": "classification", "candidates": ["logistic"]},
    )
    assert classification.status_code == 202, classification.text
    classification_final = wait_for_job(client, classification.json()["job_id"], timeout_s=180)
    assert classification_final["status"] == "done", classification_final.get("error")

    return SimpleNamespace(regression=regression_final, classification=classification_final)


# ---------------------------------------------------------------------------
# Stage 01 — upload (C1 shape; the full-ames-copy C1 lives in the errors module)
# ---------------------------------------------------------------------------

class TestUpload:
    def test_upload_created(
        self, workflow_client: TestClient, uploaded: str, workflow_subprocess_env: SimpleNamespace
    ) -> None:
        """201 contract: record + validation checks + 8-row preview; file on disk."""
        response = upload_dataset(workflow_client, ames_slice_csv(60), filename="second.csv")
        assert response.status_code == 201, response.text
        body = response.json()
        assert DATASET_ID_RE.fullmatch(body["dataset_id"])
        assert body["source"] == "upload"
        assert body["deletable"] is True
        assert body["name"] == "second.csv"
        assert body["n_rows"] == 60
        assert body["n_cols"] == 81
        assert body["sha256_12"]
        assert body["validation"]["ok"] is True
        codes = {c["code"] for c in body["validation"]["checks"]}
        assert {"format", "parse", "empty", "row_cap", "unique_id", "schema"} <= codes
        assert len(body["preview"]["head"]) == 8
        # Stored verbatim under the module's tmp uploads root; clean up again.
        stored = workflow_subprocess_env.uploads / body["dataset_id"] / "raw.csv"
        assert stored.read_bytes() == ames_slice_csv(60)
        assert workflow_client.delete(f"/workflow/datasets/{body['dataset_id']}").status_code == 204

    def test_upload_listed(
        self, workflow_client: TestClient, uploaded: str
    ) -> None:
        """The module upload appears in the dataset list with source upload."""
        listing = workflow_client.get("/workflow/datasets").json()
        assert listing[0]["dataset_id"] == "ames"  # bundled first
        match = [d for d in listing if d["dataset_id"] == uploaded]
        assert len(match) == 1
        assert match[0]["source"] == "upload"
        assert match[0]["name"] == "ames-slice.csv"
        assert match[0]["n_rows"] == 240


# ---------------------------------------------------------------------------
# Stages 01-05 on the upload
# ---------------------------------------------------------------------------

class TestUploadEDA:
    def test_profile(self, workflow_client: TestClient, uploaded: str) -> None:
        """Profile reflects the slice: 240x81, head 8, zero duplicate ids."""
        body = workflow_client.get(f"/workflow/datasets/{uploaded}/profile").json()
        assert body["dataset_id"] == uploaded
        assert body["name"] == "ames-slice.csv"
        assert body["n_rows"] == 240
        assert body["n_cols"] == 81
        assert body["n_duplicate_ids"] == 0
        assert len(body["head"]) == 8

    def test_features(self, workflow_client: TestClient, uploaded: str) -> None:
        """Target reporting works on the upload (SIMULATED classification target)."""
        body = workflow_client.get(f"/workflow/datasets/{uploaded}/features").json()
        assert len(body["raw_features"]) == 81
        assert body["targets"]["classification"]["derived"] == "simulated"
        assert 0.0 < body["targets"]["classification"]["positive_rate"] < 1.0
        assert body["recommended_split"]["strategy"] == "time"

    def test_stats_and_missing(self, workflow_client: TestClient, uploaded: str) -> None:
        """Stats/missing payloads are internally consistent on the slice."""
        stats = workflow_client.get(f"/workflow/datasets/{uploaded}/stats").json()
        assert stats["target"]["name"] == "SalePrice"
        assert stats["target"]["count"] == 240
        missing = workflow_client.get(f"/workflow/datasets/{uploaded}/missing").json()
        assert missing["total_missing"] > 0
        assert missing["blocking"] == []
        by_name = {c["name"] for c in missing["columns"]}
        assert "LotFrontage" in by_name  # the slice carries the classic NA columns

    def test_viz_all_five_kinds(self, workflow_client: TestClient, uploaded: str) -> None:
        """All five viz kinds return 200 with bounded payloads on the upload."""
        histogram = workflow_client.get(
            f"/workflow/datasets/{uploaded}/viz/histogram",
            params={"column": "SalePrice", "bins": 20},
        ).json()
        assert len(histogram["bins"]) == 20
        assert sum(b["count"] for b in histogram["bins"]) == 240

        scatter = workflow_client.get(
            f"/workflow/datasets/{uploaded}/viz/scatter",
            params={"x": "GrLivArea", "y": "SalePrice"},
        ).json()
        assert scatter["n_total"] == 240
        assert scatter["sampled"] is False

        box = workflow_client.get(
            f"/workflow/datasets/{uploaded}/viz/box",
            params={"column": "SalePrice", "by": "Neighborhood"},
        ).json()
        assert 0 < len(box["groups"]) <= 25

        correlation = workflow_client.get(
            f"/workflow/datasets/{uploaded}/viz/correlation", params={"top": 10}
        ).json()
        assert correlation["features"][-1] == "SalePrice"
        assert len(correlation["matrix"]) == 11

        category = workflow_client.get(
            f"/workflow/datasets/{uploaded}/viz/category",
            params={"column": "Neighborhood", "agg": "count"},
        ).json()
        assert sum(g["n"] for g in category["groups"]) == 240


# ---------------------------------------------------------------------------
# Gating on the fresh upload (C14a)
# ---------------------------------------------------------------------------

class TestUploadGatingFresh:
    def test_state_fresh_upload(self, workflow_client: TestClient, uploaded: str) -> None:
        """C14: no jobs yet -> evaluate/predict locked; 240 rows are inside the window."""
        state = workflow_client.get(f"/workflow/datasets/{uploaded}/state").json()
        assert state["prepared"] is False
        assert state["jobs"] == {"total": 0, "running": 0, "done": 0, "failed": 0}
        assert state["can_train"] is True  # ~168 estimated post-split train rows
        assert state["can_evaluate"] is False
        assert state["can_predict_sandbox"] is False
        assert state["train_blocked_reason"] is None


# ---------------------------------------------------------------------------
# Stage 06 — preprocess the upload (real split/clean/attach chain)
# ---------------------------------------------------------------------------

class TestUploadPreprocess:
    def test_preview_persists(
        self, workflow_client: TestClient, uploaded: str, workflow_subprocess_env: SimpleNamespace
    ) -> None:
        """Default config -> 168/36/36 time split; processed CSVs + sandbox stats persist."""
        response = workflow_client.post(
            f"/workflow/datasets/{uploaded}/preprocess/preview", json=DEFAULT_PREPROCESS_BODY
        )
        assert response.status_code == 200, response.text
        body = response.json()
        assert body["splits"] == EXPECTED_SPLITS
        assert body["before"]["n_rows"] == 240
        assert body["before"]["n_cols"] == 81
        assert body["before"]["total_missing"] > 0
        assert body["after"]["total_missing"] == 0
        assert body["after"]["n_rows"] == 240
        steps = {s["step"]: s for s in body["steps"]}
        assert steps["sale_speed_target"]["provider"] == "simulated"
        assert steps["clean"]["fit_on"] == "train split only"
        assert steps["features"]["columns_after"] > steps["features"]["columns_before"]
        assert len(body["sample_before"]) == 5
        assert len(body["sample_after"]) == 5
        # Persisted artifacts (§2.2): processed splits + sandbox stats/defaults.
        upload_dir = workflow_subprocess_env.uploads / uploaded
        for split in ("train", "val", "test"):
            assert (upload_dir / "processed" / f"{split}.csv").exists()
        sandbox = workflow_subprocess_env.models / uploaded
        assert (sandbox / "neighborhood_stats.json").exists()
        assert (sandbox / "feature_defaults.json").exists()
        assert (sandbox / "prepare_report.json").exists()

    def test_preprocess_status(
        self, workflow_client: TestClient, uploaded: str
    ) -> None:
        """GET preprocess + state both reflect the persisted prepare block."""
        body = workflow_client.get(f"/workflow/datasets/{uploaded}/preprocess").json()
        assert body["prepared"] is True
        assert body["fingerprint"]
        assert body["summary"]["splits"]["train"] == 168
        state = workflow_client.get(f"/workflow/datasets/{uploaded}/state").json()
        assert state["prepared"] is True
        assert state["prepare_config"]["outlier_rule"] is True


# ---------------------------------------------------------------------------
# Stages 07-08 — real jobs + comparison + evaluation (C8-upload, C9, C10, C11)
# ---------------------------------------------------------------------------

class TestUploadJobs:
    def test_regression_job_done(self, upload_jobs: SimpleNamespace) -> None:
        """linear+ridge complete on the upload with real val metrics."""
        job = upload_jobs.regression
        assert job["progress"]["done"] == job["progress"]["total"] == 2
        for name in ("linear", "ridge"):
            result = job["results"][name]
            assert result["status"] == "done"
            assert 0.0 < result["val_metrics"]["rmsle"] < 0.5
            assert result["train_seconds"] > 0

    def test_classification_job_done(self, upload_jobs: SimpleNamespace) -> None:
        """logistic completes; threshold is F1-optimal (never a defaulted 0.5)."""
        result = upload_jobs.classification["results"]["logistic"]
        assert result["status"] == "done"
        threshold = result["val_metrics"]["threshold"]
        assert 0.0 < threshold < 1.0
        assert threshold != 0.5

    def test_models_regression_bootstrap(
        self, workflow_client: TestClient, uploaded: str, upload_jobs: SimpleNamespace
    ) -> None:
        """C9: two candidates, one best, paired-bootstrap block, upload provenance."""
        body = workflow_client.get(
            f"/workflow/datasets/{uploaded}/models", params={"objective": "regression"}
        ).json()
        assert len(body["candidates"]) == 2
        assert sum(1 for c in body["candidates"] if c["best"]) == 1
        assert body["bootstrap"] is not None
        assert "significant" in body["bootstrap"]
        provenance = body["provenance"]
        assert provenance["dataset"] == "ames-slice.csv"
        assert provenance["n_train"] == 168
        assert provenance["n_val"] == 36
        assert provenance["simulated_target"] is False

    def test_models_classification(
        self, workflow_client: TestClient, uploaded: str, upload_jobs: SimpleNamespace
    ) -> None:
        """Classification comparison: PR-AUC selection, SIMULATED provenance, no bootstrap."""
        body = workflow_client.get(
            f"/workflow/datasets/{uploaded}/models", params={"objective": "classification"}
        ).json()
        assert len(body["candidates"]) == 1
        assert body["candidates"][0]["name"] == "logistic"
        assert body["candidates"][0]["best"] is True
        assert body["selection"]["metric"] == "pr_auc"
        assert body["bootstrap"] is None  # no bootstrap machinery for classification (§7)
        assert body["provenance"]["simulated_target"] is True

    def test_evaluation_regression(
        self, workflow_client: TestClient, upload_jobs: SimpleNamespace
    ) -> None:
        """C10-upload: ridge val evaluation, n=36, rmsle equals the stored value."""
        stored = upload_jobs.regression["results"]["ridge"]["val_metrics"]["rmsle"]
        body = workflow_client.get(
            f"/workflow/jobs/{upload_jobs.regression['job_id']}/evaluation/ridge"
        ).json()
        assert body["split"] == "val"
        assert body["n"] == 36
        assert body["metrics"]["rmsle"] == pytest.approx(stored, rel=1e-9)
        assert len(body["actual_vs_predicted"]) == 36
        assert body["importance"]

    def test_evaluation_classification(
        self, workflow_client: TestClient, upload_jobs: SimpleNamespace
    ) -> None:
        """C11: curves 2..80 points, confusion sums to 36, F1 threshold, SIMULATED flag."""
        body = workflow_client.get(
            f"/workflow/jobs/{upload_jobs.classification['job_id']}/evaluation/logistic"
        ).json()
        assert body["objective"] == "classification"
        assert body["split"] == "val"
        assert body["n"] == 36
        assert body["simulated_target"] is True
        for curve in ("roc", "pr", "calibration"):
            assert 2 <= len(body[curve]) <= 80, curve
        threshold = body["metrics_at_f1"]["threshold"]
        assert 0.0 < threshold < 1.0
        assert threshold != 0.5
        confusion = body["metrics_at_f1"]["confusion_matrix"]
        assert set(confusion) == {"tn", "fp", "fn", "tp"}
        assert sum(confusion.values()) == 36
        assert 0.0 <= body["positive_rate"] <= 1.0
        assert set(body["metrics_at_0_5"]) == set(body["metrics_at_f1"])


# ---------------------------------------------------------------------------
# Stage 09 — sandbox predictions on the upload (C13-upload) + gating (C14b)
# ---------------------------------------------------------------------------

class TestUploadSandboxPredict:
    def test_predict_regression(
        self, workflow_client: TestClient, uploaded: str, upload_jobs: SimpleNamespace
    ) -> None:
        """Sandbox price carries the upload provenance block (never the champion's)."""
        response = workflow_client.post(
            f"/workflow/jobs/{upload_jobs.regression['job_id']}/predict/ridge",
            json=MINIMAL_PROPERTY_PAYLOAD,
        )
        assert response.status_code == 200, response.text
        body = response.json()
        assert 30_000 <= body["estimated_price"] <= 600_000
        provenance = body["provenance"]
        assert provenance["source"] == "sandbox"
        assert provenance["dataset_id"] == uploaded
        assert provenance["dataset_name"] == "ames-slice.csv"
        assert provenance["n_train_rows"] == 168
        assert "not the PropPulse champion" in provenance["label"]

    def test_predict_classification(
        self, workflow_client: TestClient, uploaded: str, upload_jobs: SimpleNamespace
    ) -> None:
        """Sandbox probability carries the SIMULATED badge + the job's F1 threshold."""
        stored = upload_jobs.classification["results"]["logistic"]["val_metrics"]["threshold"]
        response = workflow_client.post(
            f"/workflow/jobs/{upload_jobs.classification['job_id']}/predict/logistic",
            json=MINIMAL_PROPERTY_PAYLOAD,
        )
        assert response.status_code == 200, response.text
        body = response.json()
        assert 0.0 <= body["probability"] <= 1.0
        assert body["threshold"] == pytest.approx(stored, rel=1e-9)
        assert body["sells_within_30_days"] == (body["probability"] >= stored)
        assert body["simulated_target"] is True
        assert body["provenance"]["source"] == "sandbox"

    def test_state_after_jobs(
        self, workflow_client: TestClient, uploaded: str, upload_jobs: SimpleNamespace
    ) -> None:
        """C14: done jobs unlock evaluation + sandbox prediction."""
        state = workflow_client.get(f"/workflow/datasets/{uploaded}/state").json()
        assert state["jobs"]["total"] == 2
        assert state["jobs"]["done"] == 2
        assert state["objectives_done"] == ["classification", "regression"]
        assert state["can_evaluate"] is True
        assert state["can_predict_sandbox"] is True


# ---------------------------------------------------------------------------
# Deletion (C16-upload) — last by design
# ---------------------------------------------------------------------------

class TestUploadDeletion:
    def test_delete_upload(
        self, workflow_client: TestClient, uploaded: str, upload_jobs: SimpleNamespace,
        workflow_subprocess_env: SimpleNamespace,
    ) -> None:
        """C16: 204; both directories gone; record + jobs endpoints 404 afterwards."""
        regression_id = upload_jobs.regression["job_id"]
        response = workflow_client.delete(f"/workflow/datasets/{uploaded}")
        assert response.status_code == 204
        assert response.content == b""
        roots = workflow_subprocess_env
        assert not (roots.uploads / uploaded).exists()
        assert not (roots.models / uploaded).exists()
        ids = [d["dataset_id"] for d in workflow_client.get("/workflow/datasets").json()]
        assert uploaded not in ids
        assert workflow_client.get(f"/workflow/datasets/{uploaded}").status_code == 404
        assert workflow_client.get(f"/workflow/datasets/{uploaded}/jobs").status_code == 404
        assert workflow_client.get(f"/workflow/jobs/{regression_id}").status_code == 404
