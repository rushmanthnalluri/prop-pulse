"""Full HTTP journey on the bundled ``ames`` dataset (workflow-architecture §8 WF-B4, §9).

Covers the no-upload demo path: stages 01-05 EDA (C3, the API half of C5/C6),
stage 06 preprocess (C7), real training subprocesses for regression + clustering
(C8, C9, C10, C12), sandbox prediction + champion parity (C13), gating
transitions (C14) and the bundled-delete guard (C16).

All workflow writes land in a per-module tmp dir (``workflow_roots`` +
``workflow_subprocess_env``); the repo's ``models/workflow/`` is never created.

Tests in this module are a *journey*: they run in file order and later classes
depend on earlier ones having run (fresh state -> prepared -> jobs done).
"""
from __future__ import annotations

from types import SimpleNamespace
from typing import Any

import pytest
from fastapi.testclient import TestClient

from backend.tests.conftest import (
    DEFAULT_PREPROCESS_BODY,
    JOB_ID_RE,
    MINIMAL_PROPERTY_PAYLOAD,
    wait_for_job,
)

pytestmark = pytest.mark.usefixtures("workflow_subprocess_env")


@pytest.fixture(scope="module")
def ames_jobs(
    workflow_client: TestClient, workflow_subprocess_env: SimpleNamespace
) -> SimpleNamespace:
    """Run the two real subprocess jobs on ames (regression linear+ridge, dbscan).

    Sequenced strictly one-at-a-time (the server-wide single-job guard would
    409 a concurrent second POST). Returns the final status payloads.
    """
    client = workflow_client
    regression = client.post(
        "/workflow/datasets/ames/jobs",
        json={"objective": "regression", "candidates": ["linear", "ridge"]},
    )
    assert regression.status_code == 202, regression.text
    regression_id = regression.json()["job_id"]
    regression_final = wait_for_job(client, regression_id)
    assert regression_final["status"] == "done", regression_final.get("error")

    clustering = client.post(
        "/workflow/datasets/ames/jobs",
        json={"objective": "clustering", "candidates": ["dbscan"]},
    )
    assert clustering.status_code == 202, clustering.text
    clustering_id = clustering.json()["job_id"]
    clustering_final = wait_for_job(client, clustering_id)
    assert clustering_final["status"] == "done", clustering_final.get("error")

    return SimpleNamespace(
        regression_id=regression_id,
        regression=regression_final,
        clustering_id=clustering_id,
        clustering=clustering_final,
    )


# ---------------------------------------------------------------------------
# Stages 01-05 — bundled EDA out of the box (C3; API halves of C5/C6)
# ---------------------------------------------------------------------------

class TestBundledEDA:
    def test_profile(self, workflow_client: TestClient) -> None:
        """C3: profile 200, 1460x81, 7,829 missing cells, 8-row head."""
        body = workflow_client.get("/workflow/datasets/ames/profile").json()
        assert body["dataset_id"] == "ames"
        assert body["n_rows"] == 1460
        assert body["n_cols"] == 81
        assert body["n_duplicate_ids"] == 0
        assert body["total_missing_cells"] == 7829
        assert body["n_numeric"] + body["n_categorical"] == 81
        assert len(body["head"]) == 8
        assert len(body["columns"]) == 81
        assert {c["name"] for c in body["columns"]} >= {"Id", "SalePrice", "PoolQC"}

    def test_features_targets(self, workflow_client: TestClient) -> None:
        """C3/C4-data: 81 raw features, SIMULATED classification target, time split."""
        body = workflow_client.get("/workflow/datasets/ames/features").json()
        assert len(body["raw_features"]) == 81
        targets = body["targets"]
        assert targets["regression"]["column"] == "SalePrice"
        assert targets["regression"]["available"] is True
        classification = targets["classification"]
        assert classification["derived"] == "simulated"
        assert classification["positive_rate"] == pytest.approx(0.249, abs=1e-3)
        assert targets["clustering"]["method"] == "DBSCAN"
        assert body["recommended_split"]["strategy"] == "time"
        assert body["recommended_split"]["column"] == "YrSold"
        assert body["pipeline_features"]  # engineered + neighborhood_stat entries

    def test_stats(self, workflow_client: TestClient) -> None:
        """C5-data: the SalePrice callout carries the raw-frame mean 180,921.20."""
        body = workflow_client.get("/workflow/datasets/ames/stats").json()
        target = body["target"]
        assert target["name"] == "SalePrice"
        assert target["count"] == 1460
        assert target["mean"] == pytest.approx(180_921.20, abs=0.01)
        assert "log1p" in target["note"]
        overall_qual = next(r for r in body["numeric"] if r["name"] == "OverallQual")
        assert overall_qual["count"] == 1460
        neighborhood = next(r for r in body["categorical"] if r["name"] == "Neighborhood")
        assert neighborhood["n_unique"] == 25

    def test_missing(self, workflow_client: TestClient) -> None:
        """C3/C5-data: PoolQC -> fill_absent_token; LotFrontage -> neighborhood median."""
        body = workflow_client.get("/workflow/datasets/ames/missing").json()
        assert body["total_missing"] == 7829
        assert body["n_columns_with_missing"] == 19
        assert body["n_complete_columns"] == 81 - 19
        assert body["blocking"] == []
        columns = {c["name"]: c for c in body["columns"]}
        pool_qc = columns["PoolQC"]
        assert pool_qc["treatment"] == "fill_absent_token"
        assert pool_qc["policy"] == "NA_ABSENT_CATEGORICAL"
        assert pool_qc["n_missing"] == 1453
        assert pool_qc["pct_missing"] == pytest.approx(99.5, abs=0.05)
        assert columns["LotFrontage"]["treatment"] == "impute_neighborhood_median"
        assert columns["Electrical"]["treatment"] == "impute_train_mode"

    def test_viz_histogram(self, workflow_client: TestClient) -> None:
        """C6-data: SalePrice histogram bins sum to 1460 with real stats."""
        body = workflow_client.get(
            "/workflow/datasets/ames/viz/histogram", params={"column": "SalePrice", "bins": 30}
        ).json()
        assert body["column"] == "SalePrice"
        assert len(body["bins"]) == 30
        assert sum(b["count"] for b in body["bins"]) == 1460
        assert body["stats"]["mean"] == pytest.approx(180_921.20, abs=0.01)

    def test_viz_scatter_sampling(self, workflow_client: TestClient) -> None:
        """C6: full scatter un-sampled at 1460 points; max_points=100 -> exactly 100."""
        full = workflow_client.get(
            "/workflow/datasets/ames/viz/scatter",
            params={"x": "GrLivArea", "y": "SalePrice"},
        ).json()
        assert full["sampled"] is False
        assert full["n_total"] == 1460
        assert len(full["points"]) == 1460

        capped = workflow_client.get(
            "/workflow/datasets/ames/viz/scatter",
            params={"x": "GrLivArea", "y": "SalePrice", "max_points": 100},
        ).json()
        assert capped["sampled"] is True
        assert capped["n_total"] == 1460
        assert len(capped["points"]) == 100

    def test_viz_box(self, workflow_client: TestClient) -> None:
        """SalePrice by Neighborhood: <= 25 groups, sorted by median desc."""
        body = workflow_client.get(
            "/workflow/datasets/ames/viz/box",
            params={"column": "SalePrice", "by": "Neighborhood"},
        ).json()
        groups = body["groups"]
        assert 0 < len(groups) <= 25
        medians = [g["median"] for g in groups]
        assert medians == sorted(medians, reverse=True)
        for group in groups:
            assert {"value", "n", "min", "q1", "median", "q3", "max"} <= set(group)

    def test_viz_correlation(self, workflow_client: TestClient) -> None:
        """C6: OverallQual is the top SalePrice correlate; matrix is square."""
        body = workflow_client.get(
            "/workflow/datasets/ames/viz/correlation",
            params={"target": "SalePrice", "top": 20},
        ).json()
        assert body["features"][0] == "OverallQual"
        assert body["features"][-1] == "SalePrice"
        assert len(body["features"]) == 21
        assert len(body["matrix"]) == 21
        assert all(len(row) == 21 for row in body["matrix"])

    def test_viz_category(self, workflow_client: TestClient) -> None:
        """Neighborhood median SalePrice aggregate, sorted desc."""
        body = workflow_client.get(
            "/workflow/datasets/ames/viz/category",
            params={"column": "Neighborhood", "agg": "median", "target": "SalePrice"},
        ).json()
        assert body["agg"] == "median"
        groups = body["groups"]
        assert len(groups) == 25
        values = [g["agg_value"] for g in groups]
        assert values == sorted(values, reverse=True)
        assert {"value", "n", "agg_value"} <= set(groups[0])


# ---------------------------------------------------------------------------
# Gating — fresh ames (in this module's tmp root): locked before any job (C14a)
# ---------------------------------------------------------------------------

class TestGatingBeforeJobs:
    def test_state_fresh(self, workflow_client: TestClient) -> None:
        """C14: unprepared + no jobs -> can_train true, evaluate/predict locked."""
        state = workflow_client.get("/workflow/datasets/ames/state").json()
        assert state["prepared"] is False
        assert state["jobs"] == {"total": 0, "running": 0, "done": 0, "failed": 0}
        assert state["objectives_done"] == []
        assert state["can_train"] is True
        assert state["can_evaluate"] is False
        assert state["can_predict_sandbox"] is False
        assert state["train_blocked_reason"] is None

    def test_detail_record(self, workflow_client: TestClient) -> None:
        """The bundled record: source bundled, never deletable, 1460x81."""
        body = workflow_client.get("/workflow/datasets/ames").json()
        assert body["source"] == "bundled"
        assert body["deletable"] is False
        assert body["n_rows"] == 1460
        assert body["state"]["can_train"] is True


# ---------------------------------------------------------------------------
# Stage 06 — preprocessing on the bundled canonical splits (C7)
# ---------------------------------------------------------------------------

class TestPreprocess:
    def test_preview_default_config(self, workflow_client: TestClient) -> None:
        """C7: default preview -> canonical 945/338/175, zero missing, SIMULATED step."""
        response = workflow_client.post(
            "/workflow/datasets/ames/preprocess/preview", json=DEFAULT_PREPROCESS_BODY
        )
        assert response.status_code == 200, response.text
        body = response.json()
        assert body["splits"] == {
            "train": 945,
            "val": 338,
            "test": 175,
            "rule": "time(YrSold)",
        }
        assert body["before"]["n_rows"] == 1460
        assert body["after"]["total_missing"] == 0
        assert body["fingerprint"]
        steps = {s["step"]: s for s in body["steps"]}
        sale_speed = steps["sale_speed_target"]
        assert sale_speed["provider"] == "simulated"
        assert sale_speed["simulated"] is True
        assert steps["sandbox_stats"]["fit_on"] == "train split only"
        assert "training rows only" in body["leakage_note"]

    def test_preprocess_status_after_preview(self, workflow_client: TestClient) -> None:
        """GET preprocess reports the persisted state; state endpoint shows prepared."""
        body = workflow_client.get("/workflow/datasets/ames/preprocess").json()
        assert body["prepared"] is True
        assert body["config"]["split_strategy"] == "auto"
        assert body["fingerprint"]
        assert body["summary"]["splits"]["train"] == 945
        state = workflow_client.get("/workflow/datasets/ames/state").json()
        assert state["prepared"] is True
        assert state["prepare_config"]["seed"] == 42


# ---------------------------------------------------------------------------
# Stage 07 — real regression subprocess job (C8) + comparison table (C9)
# ---------------------------------------------------------------------------

class TestRegressionJob:
    def test_accepted_shape_and_status_file(
        self, ames_jobs: SimpleNamespace, workflow_subprocess_env: SimpleNamespace
    ) -> None:
        """C8: 202 contract + a real status.json under models/workflow/ames/jobs/."""
        job = ames_jobs.regression
        assert JOB_ID_RE.fullmatch(ames_jobs.regression_id)
        status_file = (
            workflow_subprocess_env.models
            / "ames" / "jobs" / ames_jobs.regression_id / "status.json"
        )
        assert status_file.exists()
        assert job["job_id"] == ames_jobs.regression_id
        assert job["dataset_id"] == "ames"
        assert job["objective"] == "regression"

    def test_done_with_real_metrics(self, ames_jobs: SimpleNamespace) -> None:
        """C8: done, per-candidate progress, ridge val RMSLE in the expected range."""
        job = ames_jobs.regression
        assert job["status"] == "done"
        assert job["error"] is None
        assert job["finished_at"] is not None
        assert job["progress"]["done"] == job["progress"]["total"] == 2
        for name in ("linear", "ridge"):
            result = job["results"][name]
            assert result["status"] == "done"
            assert result["train_seconds"] > 0
        # Real trained number, order-of-magnitude assertion (§9 C8).
        assert 0.10 <= job["results"]["ridge"]["val_metrics"]["rmsle"] <= 0.18
        assert 0.0 < job["results"]["linear"]["val_metrics"]["rmsle"] < 0.5

    def test_models_comparison(
        self, workflow_client: TestClient, ames_jobs: SimpleNamespace
    ) -> None:
        """C9: >= 2 candidates, exactly one best, bootstrap present, provenance 945/338."""
        body = workflow_client.get(
            "/workflow/datasets/ames/models", params={"objective": "regression"}
        ).json()
        assert body["objective"] == "regression"
        assert len(body["candidates"]) >= 2
        assert sum(1 for c in body["candidates"] if c["best"]) == 1
        assert body["candidates"][0]["best"] is True  # sorted best-first
        assert body["selection"] == {
            "metric": "rmsle",
            "rule": "min",
            "note": "best = lowest validation RMSLE; test split never touched",
        }
        bootstrap = body["bootstrap"]
        assert bootstrap is not None
        assert "significant" in bootstrap
        assert bootstrap["runner_up"] in {"linear", "ridge"}
        assert len(bootstrap["ci95"]) == 2
        provenance = body["provenance"]
        assert provenance["n_train"] == 945
        assert provenance["n_val"] == 338
        assert provenance["simulated_target"] is False

    def test_evaluation_ridge(
        self, workflow_client: TestClient, ames_jobs: SimpleNamespace
    ) -> None:
        """C10: val-split evaluation, n=338, rmsle equals the job's stored value."""
        stored = ames_jobs.regression["results"]["ridge"]["val_metrics"]["rmsle"]
        body = workflow_client.get(
            f"/workflow/jobs/{ames_jobs.regression_id}/evaluation/ridge"
        ).json()
        assert body["objective"] == "regression"
        assert body["candidate"] == "ridge"
        assert body["split"] == "val"
        assert body["n"] == 338
        assert body["metrics"]["rmsle"] == pytest.approx(stored, rel=1e-9)
        assert 0 < len(body["actual_vs_predicted"]) <= 400
        assert len(body["residual_hist"]["bins"]) == 30
        importance = body["importance"]  # linear models expose |coef| importances
        assert importance
        assert {"feature", "weight"} <= set(importance[0])
        weights = [row["weight"] for row in importance]
        assert weights == sorted(weights, reverse=True)
        assert "OverallQual" in {row["feature"] for row in importance}

    def test_evaluation_linear_consistency(
        self, workflow_client: TestClient, ames_jobs: SimpleNamespace
    ) -> None:
        """The second candidate evaluates from its own persisted val vectors."""
        stored = ames_jobs.regression["results"]["linear"]["val_metrics"]["rmsle"]
        body = workflow_client.get(
            f"/workflow/jobs/{ames_jobs.regression_id}/evaluation/linear"
        ).json()
        assert body["n"] == 338
        assert body["metrics"]["rmsle"] == pytest.approx(stored, rel=1e-9)

    def test_jobs_listed(
        self, workflow_client: TestClient, ames_jobs: SimpleNamespace
    ) -> None:
        """GET /workflow/datasets/ames/jobs lists the finished jobs, newest first."""
        body = workflow_client.get("/workflow/datasets/ames/jobs").json()
        ids = [j["job_id"] for j in body]
        assert ames_jobs.regression_id in ids
        assert all(j["status"] == "done" for j in body)


# ---------------------------------------------------------------------------
# Stage 07/08 — real clustering subprocess job (C12)
# ---------------------------------------------------------------------------

class TestClusteringJob:
    def test_clustering_done(self, ames_jobs: SimpleNamespace) -> None:
        """DBSCAN wave completes; progress is real (1 of 1)."""
        job = ames_jobs.clustering
        assert job["status"] == "done"
        assert job["progress"]["done"] == 1
        assert job["results"]["dbscan"]["status"] == "done"

    def test_clustering_evaluation(
        self, workflow_client: TestClient, ames_jobs: SimpleNamespace
    ) -> None:
        """C12: n_clusters >= 2, 25 assignments with cluster_id+fallback, no silhouette."""
        import json as _json

        body = workflow_client.get(
            f"/workflow/jobs/{ames_jobs.clustering_id}/evaluation/dbscan"
        ).json()
        assert body["objective"] == "clustering"
        assert body["algorithm"] == "DBSCAN"
        assert body["n_clusters"] >= 2
        assert body["eps"] > 0
        assert body["min_samples"] >= 1
        assert body["rationale"]
        assignments = body["assignments"]
        assert len(assignments) == 25
        for entry in assignments:
            assert "cluster_id" in entry
            assert "fallback" in entry
        assert body["clusters"]
        # The machinery never computes a silhouette score (§7 omission).
        assert "silhouette" not in _json.dumps(body).lower()


# ---------------------------------------------------------------------------
# Stage 09 — sandbox prediction + champion parity (C13)
# ---------------------------------------------------------------------------

class TestSandboxPredict:
    def test_sandbox_predict_ridge(
        self, workflow_client: TestClient, ames_jobs: SimpleNamespace
    ) -> None:
        """C13: sandbox price with provenance; sane range; n_train_rows 945."""
        response = workflow_client.post(
            f"/workflow/jobs/{ames_jobs.regression_id}/predict/ridge",
            json=MINIMAL_PROPERTY_PAYLOAD,
        )
        assert response.status_code == 200, response.text
        body = response.json()
        assert 50_000 <= body["estimated_price"] <= 500_000
        price_range = body["price_range"]
        assert 0 < price_range["low"] <= body["estimated_price"] <= price_range["high"]
        assert body["model"] == {
            "candidate": "ridge",
            "objective": "regression",
            "job_id": ames_jobs.regression_id,
        }
        provenance = body["provenance"]
        assert provenance["source"] == "sandbox"
        assert provenance["dataset_id"] == "ames"
        assert provenance["n_train_rows"] == 945
        assert "not the PropPulse champion" in provenance["label"]

    def test_champion_parity(
        self, workflow_client: TestClient, ames_jobs: SimpleNamespace
    ) -> None:
        """C13: the champion still answers /predict — distinct version/provenance blocks.

        (The two models are both ridge on the same canonical train split, so
        the *prices* may legitimately coincide — §9 C13's binding minimum is
        that the responses carry different version/provenance blocks, proving
        the sandbox never replaced the champion.)
        """
        sandbox = workflow_client.post(
            f"/workflow/jobs/{ames_jobs.regression_id}/predict/ridge",
            json=MINIMAL_PROPERTY_PAYLOAD,
        ).json()
        champion = workflow_client.post("/predict", json=MINIMAL_PROPERTY_PAYLOAD)
        assert champion.status_code == 200, champion.text
        champ = champion.json()
        assert champ["model_version"]["regression"]  # champion version block
        assert "provenance" not in champ  # champion responses carry no sandbox block
        assert "model_version" not in sandbox
        assert sandbox["provenance"]["source"] == "sandbox"
        # Both predictions are individually sane.
        assert 20_000 <= champ["estimated_price"] <= 2_000_000

    def test_predict_unknown_candidate_404(
        self, workflow_client: TestClient, ames_jobs: SimpleNamespace
    ) -> None:
        """Predicting an unknown candidate names the known ones (404)."""
        response = workflow_client.post(
            f"/workflow/jobs/{ames_jobs.regression_id}/predict/lasso",
            json=MINIMAL_PROPERTY_PAYLOAD,
        )
        assert response.status_code == 404
        assert "ridge" in response.json()["detail"]

    def test_predict_clustering_objective_422(
        self, workflow_client: TestClient, ames_jobs: SimpleNamespace
    ) -> None:
        """Clustering jobs serve no per-row predictions (422)."""
        response = workflow_client.post(
            f"/workflow/jobs/{ames_jobs.clustering_id}/predict/dbscan",
            json=MINIMAL_PROPERTY_PAYLOAD,
        )
        assert response.status_code == 422
        assert "does not serve per-row predictions" in response.json()["detail"]


# ---------------------------------------------------------------------------
# Gating after jobs (C14b) + bundled-delete guard (C16)
# ---------------------------------------------------------------------------

class TestAfterJourney:
    def test_state_unlocked(self, workflow_client: TestClient, ames_jobs: SimpleNamespace) -> None:
        """C14: with done jobs the evaluation/prediction stages unlock."""
        state = workflow_client.get("/workflow/datasets/ames/state").json()
        assert state["prepared"] is True
        assert state["jobs"]["total"] == 2
        assert state["jobs"]["done"] == 2
        assert state["jobs"]["running"] == 0
        assert state["objectives_done"] == ["clustering", "regression"]
        assert state["can_train"] is True
        assert state["can_evaluate"] is True
        assert state["can_predict_sandbox"] is True

    def test_delete_bundled_400(self, workflow_client: TestClient) -> None:
        """C16: the bundled dataset cannot be deleted."""
        response = workflow_client.delete("/workflow/datasets/ames")
        assert response.status_code == 400
        assert response.json()["detail"] == "The bundled dataset cannot be deleted"
