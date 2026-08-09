"""Sandbox training + job-runner tests (§3.9/§4, §8 WF-B2 matrix).

Self-contained (no conftest in this directory — ownership boundary). One
module-scoped fixture uploads a tiny 240-row Ames-schema slice, prepares it
and trains a real regression (``linear`` + ``ridge``), classification
(``logistic``) and clustering (``dbscan``) wave under an mlflow import guard;
every write lands in ``tmp_path`` via monkeypatched WF-B1 storage roots.
"""
from __future__ import annotations

import json
import os
import subprocess
import sys
import uuid
from contextlib import contextmanager
from pathlib import Path
from types import SimpleNamespace
from typing import Any

import pandas as pd
import pytest
import numpy as np

from ml.data.ingest import RAW_TRAIN_CSV
from ml.paths import MLRUNS_DIR, MODELS_DIR, REPO_ROOT
from ml.workflow import datasets
from ml.workflow.datasets import save_upload, sandbox_dir
from ml.workflow.prepare import PrepareConfig, prepare_dataset
from ml.workflow.train import (
    ESTIMATOR_N_JOBS,
    UnknownCandidateError,
    UnknownObjectiveError,
    train_objective,
    valid_candidates,
)
from ml.workflow.train_job import assert_sandbox_output, job_dir_for, run_job

#: 240 rows -> 168/36/36 at the default fractions (>= MIN_TRAIN_ROWS).
_UPLOAD_ROWS = 240


@contextmanager
def _mlflow_blocked():
    """Import guard (§4.2): any NEW ``mlflow`` import during training raises."""

    class _Finder:
        def find_module(self, name: str, path: Any = None) -> Any:
            if name == "mlflow" or name.startswith("mlflow."):
                raise ImportError("mlflow is banned from workflow training (§4.2)")
            return None

    sys.meta_path.insert(0, _Finder())
    try:
        yield
    finally:
        sys.meta_path.pop(0)


@pytest.fixture(scope="module")
def trained(tmp_path_factory: pytest.TempPathFactory) -> SimpleNamespace:
    tmp = tmp_path_factory.mktemp("wf_train")
    monkey = pytest.MonkeyPatch()
    monkey.setattr(datasets, "UPLOADS_ROOT", tmp / "uploads")
    monkey.setattr(datasets, "WORKFLOW_MODELS_ROOT", tmp / "workflow_models")

    data = pd.read_csv(RAW_TRAIN_CSV).head(_UPLOAD_ROWS).to_csv(index=False).encode()
    dataset_id = save_upload(data, "slice.csv").dataset_id
    prepare_dataset(dataset_id, PrepareConfig())

    mlruns_before = set(os.listdir(MLRUNS_DIR)) if MLRUNS_DIR.exists() else set()
    mlflow_before = set(sys.modules)
    job_dir = sandbox_dir(dataset_id) / "jobs" / "job_00000001"
    with _mlflow_blocked():
        regression = train_objective(
            dataset_id, job_dir, "regression", ["linear", "ridge"]
        )
        classification = train_objective(
            dataset_id, job_dir, "classification", ["logistic"]
        )
        clustering = train_objective(dataset_id, job_dir, "clustering", ["dbscan"])
    mlflow_imported = sorted(set(sys.modules) - mlflow_before)
    mlruns_after = set(os.listdir(MLRUNS_DIR)) if MLRUNS_DIR.exists() else set()

    ns = SimpleNamespace(
        tmp=tmp,
        dataset_id=dataset_id,
        job_dir=job_dir,
        regression=regression,
        classification=classification,
        clustering=clustering,
        mlflow_imported=mlflow_imported,
        mlruns_delta=sorted(mlruns_after - mlruns_before),
    )
    yield ns
    monkey.undo()


# ---------------------------------------------------------------------------
# Candidate sets & validation (§3.9: 422 lists the valid candidates)
# ---------------------------------------------------------------------------

class TestCandidateValidation:
    def test_valid_candidate_sets(self) -> None:
        assert valid_candidates("regression") == (
            "linear", "ridge", "lasso", "random_forest", "xgboost",
        )
        assert valid_candidates("classification") == (
            "logistic", "decision_tree", "random_forest", "xgboost",
        )
        assert valid_candidates("clustering") == ("dbscan",)

    def test_unknown_objective_lists_valid(self) -> None:
        with pytest.raises(UnknownObjectiveError, match="valid objectives"):
            valid_candidates("forecasting")

    def test_unknown_candidate_lists_valid(self, trained: SimpleNamespace) -> None:
        with pytest.raises(UnknownCandidateError, match="valid candidates"):
            train_objective(
                trained.dataset_id, trained.job_dir, "regression", ["catboost"]
            )

    def test_unprepared_dataset_raises_for_autoprepare(
        self, trained: SimpleNamespace
    ) -> None:
        data = pd.read_csv(RAW_TRAIN_CSV).head(_UPLOAD_ROWS).to_csv(index=False).encode()
        fresh_id = save_upload(data, "fresh.csv").dataset_id
        with pytest.raises(FileNotFoundError, match="not prepared"):
            train_objective(
                fresh_id,
                sandbox_dir(fresh_id) / "jobs" / "job_00000009",
                "regression",
                ["linear"],
            )

    def test_job_dir_outside_sandbox_rejected(self, trained: SimpleNamespace) -> None:
        with pytest.raises(ValueError, match="escapes the sandbox root"):
            train_objective(
                trained.dataset_id, trained.tmp / "elsewhere", "regression", ["linear"]
            )


# ---------------------------------------------------------------------------
# Safety (§4.1/§4.2): containment + no MLflow
# ---------------------------------------------------------------------------

class TestSafety:
    def test_sandbox_output_containment(self) -> None:
        with pytest.raises(RuntimeError, match="escapes"):
            assert_sandbox_output(MODELS_DIR / "regression")
        with pytest.raises(RuntimeError, match="escapes"):
            assert_sandbox_output(Path("models/workflow") / ".." / "registry")
        ok = datasets.WORKFLOW_MODELS_ROOT / "ames" / "jobs" / "job_00000001"
        assert assert_sandbox_output(ok) == ok.resolve()

    def test_no_mlflow_imported_by_training(self, trained: SimpleNamespace) -> None:
        assert not [m for m in trained.mlflow_imported if m.split(".")[0] == "mlflow"]

    def test_no_mlflow_runs_created(self, trained: SimpleNamespace) -> None:
        assert trained.mlruns_delta == []

    def test_all_writes_inside_sandbox_roots(self, trained: SimpleNamespace) -> None:
        uploads = (trained.tmp / "uploads").resolve()
        models = (trained.tmp / "workflow_models").resolve()
        files = [p for p in trained.tmp.rglob("*") if p.is_file()]
        assert files, "fixture must have written files"
        for path in files:
            resolved = path.resolve()
            assert (
                os.path.commonpath([str(uploads), str(resolved)]) == str(uploads)
                or os.path.commonpath([str(models), str(resolved)]) == str(models)
            ), f"write outside sandbox roots: {path}"


# ---------------------------------------------------------------------------
# Trained artifacts (§3.9/§3.10)
# ---------------------------------------------------------------------------

class TestRegressionArtifacts:
    def test_results_payload(self, trained: SimpleNamespace) -> None:
        for name in ("linear", "ridge"):
            result = trained.regression[name]
            assert result["status"] == "done"
            assert {"mae", "rmse", "r2", "rmsle", "rmse_log", "residual_interval"} <= set(
                result["val_metrics"]
            )
            assert 0.0 < result["val_metrics"]["rmsle"] < 0.5
            assert result["train_seconds"] > 0
        assert trained.regression["linear"]["cv_best_score"] is None
        assert trained.regression["ridge"]["cv_best_score"] is not None
        assert trained.regression["ridge"]["best_params"]["alpha"] > 0

    def test_val_predictions_schema(self, trained: SimpleNamespace) -> None:
        path = trained.job_dir / "candidates" / "ridge" / "val_predictions.csv"
        preds = pd.read_csv(path)
        assert list(preds.columns) == ["Id", "y_true", "y_pred_log", "y_pred_dollar"]
        assert len(preds) == 36  # 240 rows at val_frac=0.15
        assert (preds["y_pred_dollar"] > 0).all()
        assert np.allclose(preds["y_pred_log"], np.log1p(preds["y_pred_dollar"]))

    def test_metrics_json_has_importance_and_provenance(
        self, trained: SimpleNamespace
    ) -> None:
        metrics = json.loads(
            (trained.job_dir / "candidates" / "ridge" / "metrics.json").read_text()
        )
        assert metrics["objective"] == "regression"
        assert metrics["n_train"] == 168
        assert metrics["importance"]  # linear models expose |coef|
        assert metrics["importance"][0]["feature"] == "OverallQual"
        weights = [row["weight"] for row in metrics["importance"]]
        assert weights == sorted(weights, reverse=True)

    def test_split_and_training_determinism(self, trained: SimpleNamespace) -> None:
        other = sandbox_dir(trained.dataset_id) / "jobs" / "job_00000002"
        rerun = train_objective(trained.dataset_id, other, "regression", ["linear"])
        assert (
            rerun["linear"]["val_metrics"] == trained.regression["linear"]["val_metrics"]
        )
        first = (trained.job_dir / "candidates" / "linear" / "val_predictions.csv").read_bytes()
        second = (other / "candidates" / "linear" / "val_predictions.csv").read_bytes()
        assert first == second


class TestClassificationArtifacts:
    def test_val_predictions_schema(self, trained: SimpleNamespace) -> None:
        path = trained.job_dir / "candidates" / "logistic" / "val_predictions.csv"
        preds = pd.read_csv(path)
        assert list(preds.columns) == ["Id", "y_true", "proba_raw", "proba_calibrated"]
        assert ((preds["proba_calibrated"] >= 0) & (preds["proba_calibrated"] <= 1)).all()

    def test_metrics_json(self, trained: SimpleNamespace) -> None:
        metrics = json.loads(
            (trained.job_dir / "candidates" / "logistic" / "metrics.json").read_text()
        )
        assert metrics["simulated_target"] is True
        threshold = metrics["val_metrics"]["threshold"]
        assert 0.0 < threshold < 1.0  # F1-optimal, never a defaulted 0.5
        confusion = metrics["val_metrics"]["confusion_matrix"]
        assert set(confusion) == {"tn", "fp", "fn", "tp"}
        assert sum(confusion.values()) == 36
        assert (trained.job_dir / "candidates" / "logistic" / "model_raw.joblib").exists()

    def test_estimator_n_jobs_pinned(self, trained: SimpleNamespace) -> None:
        import joblib

        from ml.training.train_classification import candidate_grids
        from ml.workflow.train import _pin_estimator_n_jobs

        grids = candidate_grids(3.0)
        forest = grids["random_forest"][0]
        assert forest.n_jobs == -1  # the champion grid ships n_jobs=-1…
        _pin_estimator_n_jobs(forest)
        assert forest.n_jobs == ESTIMATOR_N_JOBS  # …re-pinned for the sandbox
        logistic = grids["logistic"][0]
        _pin_estimator_n_jobs(logistic)
        assert logistic.n_jobs is None  # None stays None (no FutureWarning)

        model_path = (
            trained.job_dir / "candidates" / "logistic" / "model_raw.joblib"
        )
        fitted = joblib.load(model_path)
        assert fitted.named_steps["model"].n_jobs is None


class TestClusteringArtifacts:
    def test_dbscan_artifacts(self, trained: SimpleNamespace) -> None:
        result = trained.clustering["dbscan"]
        assert result["status"] == "done"
        metrics = result["val_metrics"]
        assert metrics["n_clusters"] >= 2
        assert metrics["min_samples"] in (2, 3)
        out = trained.job_dir / "candidates" / "dbscan"
        for name in (
            "model.joblib", "scaler.joblib", "cluster_stats.json",
            "cluster_assignments.csv", "neighborhood_matrix.csv", "metrics.json",
        ):
            assert (out / name).exists(), name
        stored = json.loads((out / "metrics.json").read_text())
        assert stored["importance"] is None
        assert stored["rationale"]


class TestProgressEvents:
    def test_per_candidate_events_in_order(self, trained: SimpleNamespace) -> None:
        events: list[dict[str, Any]] = []
        other = sandbox_dir(trained.dataset_id) / "jobs" / "job_00000003"
        train_objective(
            trained.dataset_id, other, "regression", ["ridge", "linear"],
            progress_cb=events.append,
        )
        kinds = [(e["event"], e["candidate"]) for e in events]
        assert kinds == [
            ("candidate_started", "ridge"),
            ("candidate_done", "ridge"),
            ("candidate_started", "linear"),
            ("candidate_done", "linear"),
        ]

    def test_failed_candidate_recorded_wave_continues(
        self, trained: SimpleNamespace, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        from ml.workflow import train as train_module

        def _boom(*args: Any, **kwargs: Any) -> None:
            raise RuntimeError("synthetic explosion")

        monkeypatch.setattr(train_module, "_fit_alpha_model", _boom)
        other = sandbox_dir(trained.dataset_id) / "jobs" / "job_00000004"
        results = train_objective(
            trained.dataset_id, other, "regression", ["ridge", "linear"]
        )
        assert results["ridge"]["status"] == "failed"
        assert "synthetic explosion" in results["ridge"]["error"]
        assert results["linear"]["status"] == "done"


# ---------------------------------------------------------------------------
# Job runner (§3.9 status.json protocol)
# ---------------------------------------------------------------------------

class TestRunJob:
    def test_status_protocol_done(self, trained: SimpleNamespace) -> None:
        job_id = "job_" + uuid.uuid4().hex[:8]
        rc = run_job(trained.dataset_id, job_id, "regression", ["linear"])
        assert rc == 0
        status = json.loads(
            (sandbox_dir(trained.dataset_id) / "jobs" / job_id / "status.json").read_text()
        )
        assert set(status) == {
            "job_id", "dataset_id", "objective", "status", "progress",
            "results", "error", "created_at", "finished_at", "prepare_fingerprint",
        }
        assert status["status"] == "done"
        assert status["job_id"] == job_id
        assert status["dataset_id"] == trained.dataset_id
        assert status["error"] is None
        assert status["finished_at"] is not None
        # Red-team F1: the job is bound to the prepare fingerprint it trained on.
        assert isinstance(status["prepare_fingerprint"], str)
        assert len(status["prepare_fingerprint"]) == 40  # sha1 hex
        progress = status["progress"]
        assert (progress["done"], progress["total"]) == (1, 1)
        assert progress["current"] is None
        assert progress["elapsed_s"] > 0
        entry = status["results"]["linear"]
        assert entry["status"] == "done"
        assert 0.0 < entry["val_metrics"]["rmsle"] < 0.5
        assert entry["train_seconds"] > 0

    def test_unknown_candidate_fails_fast(self, trained: SimpleNamespace) -> None:
        job_id = "job_" + uuid.uuid4().hex[:8]
        rc = run_job(trained.dataset_id, job_id, "regression", ["catboost"])
        assert rc == 1
        status = json.loads(
            (sandbox_dir(trained.dataset_id) / "jobs" / job_id / "status.json").read_text()
        )
        assert status["status"] == "failed"
        assert "valid candidates" in status["error"]
        assert status["results"]["catboost"]["status"] == "pending"

    def test_all_candidates_failed_marks_job_failed(
        self, trained: SimpleNamespace, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        from ml.workflow import train as train_module

        def _boom(*args: Any, **kwargs: Any) -> None:
            raise RuntimeError("synthetic explosion")

        monkeypatch.setattr(train_module, "_fit_alpha_model", _boom)
        job_id = "job_" + uuid.uuid4().hex[:8]
        rc = run_job(trained.dataset_id, job_id, "regression", ["ridge"])
        assert rc == 1
        status = json.loads(
            (sandbox_dir(trained.dataset_id) / "jobs" / job_id / "status.json").read_text()
        )
        assert status["status"] == "failed"
        assert status["results"]["ridge"]["status"] == "failed"

    def test_auto_prepare_when_unprepared(self, trained: SimpleNamespace) -> None:
        data = pd.read_csv(RAW_TRAIN_CSV).head(_UPLOAD_ROWS).to_csv(index=False).encode()
        fresh_id = save_upload(data, "fresh.csv").dataset_id
        job_id = "job_" + uuid.uuid4().hex[:8]
        rc = run_job(fresh_id, job_id, "regression", ["linear"])
        assert rc == 0
        sandbox = sandbox_dir(fresh_id)
        assert (sandbox / "prepare_report.json").exists()  # the preparing phase ran
        status = json.loads((sandbox / "jobs" / job_id / "status.json").read_text())
        assert status["status"] == "done"

    def test_malformed_job_id_rejected(self, trained: SimpleNamespace) -> None:
        with pytest.raises(ValueError, match="malformed job id"):
            job_dir_for(trained.dataset_id, "not-a-job")
        assert run_job(trained.dataset_id, "../../evil", "regression", ["linear"]) == 2


class TestSubprocessCli:
    """The real §3.9 spawn contract: ``python -m ml.workflow.train_job``."""

    def test_cli_end_to_end(self, trained: SimpleNamespace) -> None:
        job_id = "job_" + uuid.uuid4().hex[:8]
        env = os.environ.copy()
        env["PROPULSE_UPLOADS_ROOT"] = str(trained.tmp / "uploads")
        env["PROPULSE_WORKFLOW_MODELS_ROOT"] = str(trained.tmp / "workflow_models")
        env["PYTHONPATH"] = str(REPO_ROOT)
        proc = subprocess.run(
            [
                sys.executable, "-m", "ml.workflow.train_job",
                "--dataset", trained.dataset_id,
                "--job", job_id,
                "--objective", "regression",
                "--candidates", "linear",
            ],
            cwd=REPO_ROOT,
            env=env,
            capture_output=True,
            text=True,
            timeout=120,
        )
        assert proc.returncode == 0, proc.stderr[-2000:]
        status_path = (
            trained.tmp / "workflow_models" / trained.dataset_id
            / "jobs" / job_id / "status.json"
        )
        status = json.loads(status_path.read_text())
        assert status["status"] == "done"
        assert status["results"]["linear"]["status"] == "done"
        assert status["progress"]["done"] == status["progress"]["total"] == 1
        # the subprocess wrote nothing outside the redirected roots
        assert not (MODELS_DIR / "workflow" / trained.dataset_id).exists()
