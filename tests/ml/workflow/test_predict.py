"""Sandbox prediction tests (§3.11, §7 honesty rules, §8 WF-B2 matrix).

Self-contained (no conftest in this directory — ownership boundary). The
module fixture runs two real tiny jobs (regression ``linear``, classification
``logistic``) on a 240-row Ames-schema upload inside ``tmp_path`` and serves
sandbox predictions from them. The champion prediction log
``logs/predictions.jsonl`` is asserted byte-untouched (§3.11).
"""
from __future__ import annotations

import json
import uuid
from pathlib import Path
from types import SimpleNamespace

import pandas as pd
import pytest

from ml.data.ingest import RAW_TRAIN_CSV
from ml.paths import LOGS_DIR
from ml.workflow import datasets
from ml.workflow.datasets import UnknownDataset, save_upload, sandbox_dir
from ml.workflow.predict import (
    CandidateNotReadyError,
    ObjectiveMismatchError,
    SandboxModelService,
    UnknownCandidateError,
    UnknownJobError,
)
from ml.workflow.prepare import PrepareConfig, prepare_dataset
from ml.workflow.train_job import run_job

_UPLOAD_ROWS = 240

#: A PropertyInput-compatible payload (backend/app/schemas/property.py field names).
_PAYLOAD = {
    "neighborhood": "NAmes",
    "overall_qual": 5,
    "overall_cond": 6,
    "gr_liv_area": 1500,
    "lot_area": 8000,
    "year_built": 1990,
    "total_bsmt_sf": 800,
    "bedrooms": 3,
    "full_bath": 2,
    "half_bath": 0,
    "garage_cars": 2,
    "fireplaces": 1,
    "central_air": True,
}


@pytest.fixture(scope="module")
def served(tmp_path_factory: pytest.TempPathFactory) -> SimpleNamespace:
    tmp = tmp_path_factory.mktemp("wf_predict")
    monkey = pytest.MonkeyPatch()
    monkey.setattr(datasets, "UPLOADS_ROOT", tmp / "uploads")
    monkey.setattr(datasets, "WORKFLOW_MODELS_ROOT", tmp / "workflow_models")

    data = pd.read_csv(RAW_TRAIN_CSV).head(_UPLOAD_ROWS).to_csv(index=False).encode()
    dataset_id = save_upload(data, "slice.csv").dataset_id
    prepare_dataset(dataset_id, PrepareConfig())
    reg_job = "job_" + uuid.uuid4().hex[:8]
    cls_job = "job_" + uuid.uuid4().hex[:8]
    assert run_job(dataset_id, reg_job, "regression", ["linear"]) == 0
    assert run_job(dataset_id, cls_job, "classification", ["logistic"]) == 0

    log_path = LOGS_DIR / "predictions.jsonl"
    log_before = log_path.read_bytes() if log_path.exists() else None

    ns = SimpleNamespace(
        tmp=tmp,
        dataset_id=dataset_id,
        reg_job=reg_job,
        cls_job=cls_job,
        log_path=log_path,
        log_before=log_before,
    )
    yield ns
    assert (log_path.read_bytes() if log_path.exists() else None) == ns.log_before
    monkey.undo()


class TestPredictPrice:
    def test_response_shape_and_provenance(self, served: SimpleNamespace) -> None:
        svc = SandboxModelService(served.dataset_id, served.reg_job)
        out = svc.predict_price(_PAYLOAD, "linear")
        assert 10_000 < out["estimated_price"] < 1_000_000
        price_range = out["price_range"]
        assert price_range["low"] < out["estimated_price"] < price_range["high"]
        assert "~80% range" in out["interval_note"]
        assert out["model"] == {
            "candidate": "linear",
            "objective": "regression",
            "job_id": served.reg_job,
        }
        provenance = out["provenance"]
        assert provenance["source"] == "sandbox"
        assert provenance["dataset_id"] == served.dataset_id
        assert provenance["dataset_name"] == "slice.csv"
        assert provenance["n_train_rows"] == 168
        assert "not the PropPulse champion" in provenance["label"]
        assert "your upload" in provenance["label"]

    def test_deterministic_across_service_instances(
        self, served: SimpleNamespace
    ) -> None:
        first = SandboxModelService(served.dataset_id, served.reg_job).predict_price(
            _PAYLOAD, "linear"
        )
        second = SandboxModelService(served.dataset_id, served.reg_job).predict_price(
            _PAYLOAD, "linear"
        )
        assert first["estimated_price"] == second["estimated_price"]

    def test_interval_comes_from_job_residuals(self, served: SimpleNamespace) -> None:
        svc = SandboxModelService(served.dataset_id, served.reg_job)
        out = svc.predict_price(_PAYLOAD, "linear")
        metrics = json.loads(
            (
                sandbox_dir(served.dataset_id) / "jobs" / served.reg_job
                / "candidates" / "linear" / "metrics.json"
            ).read_text()
        )
        interval = metrics["val_metrics"]["residual_interval"]
        import numpy as np

        assert out["price_range"]["low"] == pytest.approx(
            float(np.expm1(np.log1p(out["estimated_price"]) + interval["q_low"]))
        )


class TestPredictProba:
    def test_response_shape(self, served: SimpleNamespace) -> None:
        svc = SandboxModelService(served.dataset_id, served.cls_job)
        out = svc.predict_proba(_PAYLOAD, "logistic")
        assert 0.0 <= out["probability"] <= 1.0
        assert 0.0 < out["threshold"] < 1.0  # F1-optimal, never a hardcoded 0.5
        assert out["sells_within_30_days"] == (out["probability"] >= out["threshold"])
        assert out["simulated_target"] is True
        assert "SIMULATED" in out["note"]
        assert out["provenance"]["source"] == "sandbox"
        assert "not the PropPulse champion" in out["provenance"]["label"]


class TestErrors:
    def test_unknown_dataset(self, served: SimpleNamespace) -> None:
        with pytest.raises(UnknownDataset):
            SandboxModelService("ds_00000000", served.reg_job)

    def test_unknown_job(self, served: SimpleNamespace) -> None:
        with pytest.raises(UnknownJobError):
            SandboxModelService(served.dataset_id, "job_ffffffff")
        with pytest.raises(UnknownJobError):
            SandboxModelService(served.dataset_id, "not-a-job")

    def test_unknown_candidate_lists_candidates(self, served: SimpleNamespace) -> None:
        svc = SandboxModelService(served.dataset_id, served.reg_job)
        with pytest.raises(UnknownCandidateError, match="linear"):
            svc.predict_price(_PAYLOAD, "ridge")

    def test_objective_mismatch(self, served: SimpleNamespace) -> None:
        svc = SandboxModelService(served.dataset_id, served.reg_job)
        with pytest.raises(ObjectiveMismatchError, match="regression"):
            svc.predict_proba(_PAYLOAD, "linear")
        svc_cls = SandboxModelService(served.dataset_id, served.cls_job)
        with pytest.raises(ObjectiveMismatchError, match="classification"):
            svc_cls.predict_price(_PAYLOAD, "logistic")

    def test_invalid_payload_fields(self, served: SimpleNamespace) -> None:
        svc = SandboxModelService(served.dataset_id, served.reg_job)
        with pytest.raises(ValueError, match="unknown PropertyInput fields"):
            svc.predict_price({**_PAYLOAD, "garage_color": "red"}, "linear")

    def test_job_not_done_is_409(self, served: SimpleNamespace) -> None:
        # Craft a still-running job by rewriting a copy of the real status.
        job_id = "job_" + uuid.uuid4().hex[:8]
        job_dir = sandbox_dir(served.dataset_id) / "jobs" / job_id
        job_dir.mkdir(parents=True)
        status = json.loads(
            (
                sandbox_dir(served.dataset_id) / "jobs" / served.reg_job / "status.json"
            ).read_text()
        )
        status["status"] = "running"
        (job_dir / "status.json").write_text(json.dumps(status), encoding="utf-8")
        svc = SandboxModelService(served.dataset_id, job_id)
        with pytest.raises(CandidateNotReadyError, match="running"):
            svc.predict_price(_PAYLOAD, "linear")

    def test_failed_candidate_is_409(self, served: SimpleNamespace) -> None:
        job_id = "job_" + uuid.uuid4().hex[:8]
        job_dir = sandbox_dir(served.dataset_id) / "jobs" / job_id
        job_dir.mkdir(parents=True)
        status = {
            "job_id": job_id,
            "dataset_id": served.dataset_id,
            "objective": "regression",
            "status": "done",
            "results": {"ridge": {"status": "failed", "error": "boom"}},
        }
        (job_dir / "status.json").write_text(json.dumps(status), encoding="utf-8")
        svc = SandboxModelService(served.dataset_id, job_id)
        with pytest.raises(CandidateNotReadyError, match="failed"):
            svc.predict_price(_PAYLOAD, "ridge")


class TestChampionIsolation:
    def test_prediction_log_untouched(self, served: SimpleNamespace) -> None:
        SandboxModelService(served.dataset_id, served.reg_job).predict_price(
            _PAYLOAD, "linear"
        )
        SandboxModelService(served.dataset_id, served.cls_job).predict_proba(
            _PAYLOAD, "logistic"
        )
        current = (
            served.log_path.read_bytes() if served.log_path.exists() else None
        )
        assert current == served.log_before  # §3.11: never the drift-reference log

    def test_no_writes_outside_sandbox(self, served: SimpleNamespace) -> None:
        before = {p for p in served.tmp.rglob("*") if p.is_file()}
        SandboxModelService(served.dataset_id, served.reg_job).predict_price(
            _PAYLOAD, "linear"
        )
        after = {p for p in served.tmp.rglob("*") if p.is_file()}
        assert after == before  # serving is read-only
