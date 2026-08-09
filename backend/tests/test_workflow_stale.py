"""Red-team F1 regression tests — split-drift honesty after a re-prepare.

Every job is bound to the prepare fingerprint it trained on (persisted in
``status.json`` by the job runner). After a re-prepare with a different
config:

- ``GET …/models`` keeps serving the old-split rows (honesty = label, not
  hide) but flags them ``stale_split`` and exposes both fingerprints;
- the regression paired bootstrap is ``null`` whenever the compared pair
  spans different fingerprints (a cross-split comparison is meaningless);
- sandbox predict on a stale-split job still works, but its provenance block
  gains ``stale_split`` + a plain-English note.
"""
from __future__ import annotations

from types import SimpleNamespace

import pytest
from fastapi.testclient import TestClient

import backend.app.services.workflow.jobs as jobs_service
from backend.tests.conftest import (
    DEFAULT_PREPROCESS_BODY,
    MINIMAL_PROPERTY_PAYLOAD,
    ames_slice_csv,
    spawn_in_process,
    upload_dataset,
    wait_for_job,
)

pytestmark = pytest.mark.usefixtures("workflow_roots")

#: A re-prepare config that differs from the default in every split dimension.
_ALT_CONFIG_BODY: dict = {
    "config": {
        "outlier_rule": True,
        "split_strategy": "auto",
        "val_frac": 0.2,
        "test_frac": 0.2,
        "seed": 7,
    }
}


class TestStaleSplitAfterReprepare:
    def test_models_and_predict_flag_stale_split(
        self,
        workflow_client: TestClient,
        workflow_roots: SimpleNamespace,
        monkeypatch: pytest.MonkeyPatch,
    ) -> None:
        """Re-prepare after training -> old job flagged, bootstrap null, predict labelled."""
        monkeypatch.setattr(jobs_service, "spawn_training_job", spawn_in_process)
        # 300 rows: the alt 0.2/0.2 fractions still leave >= 150 train rows.
        dataset_id = upload_dataset(
            workflow_client, ames_slice_csv(300), filename="stale-split.csv"
        ).json()["dataset_id"]
        try:
            # Prepare with the default config, then train ridge on that split.
            first = workflow_client.post(
                f"/workflow/datasets/{dataset_id}/preprocess/preview",
                json=DEFAULT_PREPROCESS_BODY,
            )
            assert first.status_code == 200, first.text
            first_fingerprint = first.json()["fingerprint"]

            accepted1 = workflow_client.post(
                f"/workflow/datasets/{dataset_id}/jobs",
                json={"objective": "regression", "candidates": ["ridge"]},
            )
            assert accepted1.status_code == 202, accepted1.text
            job1_id = accepted1.json()["job_id"]
            job1 = wait_for_job(workflow_client, job1_id, timeout_s=120)
            assert job1["status"] == "done", job1.get("error")
            # The job is bound to the split it trained on (F1 root fix).
            assert job1["prepare_fingerprint"] == first_fingerprint

            models = workflow_client.get(
                f"/workflow/datasets/{dataset_id}/models", params={"objective": "regression"}
            ).json()
            assert models["candidates"][0]["prepare_fingerprint"] == first_fingerprint
            assert models["candidates"][0]["stale_split"] is False
            assert models["provenance"]["prepare_fingerprint"] == first_fingerprint

            fresh_predict = workflow_client.post(
                f"/workflow/jobs/{job1_id}/predict/ridge", json=MINIMAL_PROPERTY_PAYLOAD
            )
            assert fresh_predict.status_code == 200, fresh_predict.text
            assert "stale_split" not in fresh_predict.json()["provenance"]

            # Re-prepare with a different config -> a new fingerprint.
            second = workflow_client.post(
                f"/workflow/datasets/{dataset_id}/preprocess/preview",
                json=_ALT_CONFIG_BODY,
            )
            assert second.status_code == 200, second.text
            second_fingerprint = second.json()["fingerprint"]
            assert second_fingerprint != first_fingerprint

            # The old row stays served but is honestly labelled stale-split.
            stale_models = workflow_client.get(
                f"/workflow/datasets/{dataset_id}/models", params={"objective": "regression"}
            ).json()
            ridge = stale_models["candidates"][0]
            assert ridge["name"] == "ridge"
            assert ridge["stale_split"] is True
            assert ridge["prepare_fingerprint"] == first_fingerprint
            assert stale_models["provenance"]["prepare_fingerprint"] == second_fingerprint
            assert stale_models["provenance"]["n_val"] == int(second.json()["splits"]["val"])

            # Sandbox predict on the stale job still works — flagged provenance.
            stale_predict = workflow_client.post(
                f"/workflow/jobs/{job1_id}/predict/ridge", json=MINIMAL_PROPERTY_PAYLOAD
            )
            assert stale_predict.status_code == 200, stale_predict.text
            provenance = stale_predict.json()["provenance"]
            assert provenance["stale_split"] is True
            assert "previous preprocessing configuration" in provenance["stale_note"]

            # A new job trains on the new split; the mixed pair nulls the bootstrap.
            accepted2 = workflow_client.post(
                f"/workflow/datasets/{dataset_id}/jobs",
                json={"objective": "regression", "candidates": ["linear"]},
            )
            assert accepted2.status_code == 202, accepted2.text
            job2 = wait_for_job(workflow_client, accepted2.json()["job_id"], timeout_s=120)
            assert job2["status"] == "done", job2.get("error")
            assert job2["prepare_fingerprint"] == second_fingerprint

            mixed = workflow_client.get(
                f"/workflow/datasets/{dataset_id}/models", params={"objective": "regression"}
            ).json()
            by_name = {c["name"]: c for c in mixed["candidates"]}
            assert by_name["ridge"]["stale_split"] is True
            assert by_name["linear"]["stale_split"] is False
            assert mixed["bootstrap"] is None  # cross-split pair: meaningless
        finally:
            workflow_client.delete(f"/workflow/datasets/{dataset_id}")

    def test_same_fingerprint_pair_keeps_bootstrap(
        self,
        workflow_client: TestClient,
        workflow_roots: SimpleNamespace,
        monkeypatch: pytest.MonkeyPatch,
    ) -> None:
        """Control: two candidates from one split still get their bootstrap block."""
        monkeypatch.setattr(jobs_service, "spawn_training_job", spawn_in_process)
        dataset_id = upload_dataset(
            workflow_client, ames_slice_csv(), filename="same-split.csv"
        ).json()["dataset_id"]
        try:
            accepted = workflow_client.post(
                f"/workflow/datasets/{dataset_id}/jobs",
                json={"objective": "regression", "candidates": ["ridge", "linear"]},
            )
            assert accepted.status_code == 202, accepted.text
            job = wait_for_job(workflow_client, accepted.json()["job_id"], timeout_s=120)
            assert job["status"] == "done", job.get("error")

            models = workflow_client.get(
                f"/workflow/datasets/{dataset_id}/models", params={"objective": "regression"}
            ).json()
            assert len(models["candidates"]) == 2
            assert all(c["stale_split"] is False for c in models["candidates"])
            assert models["bootstrap"] is not None
            assert models["bootstrap"]["n_resamples"] > 0
        finally:
            workflow_client.delete(f"/workflow/datasets/{dataset_id}")
