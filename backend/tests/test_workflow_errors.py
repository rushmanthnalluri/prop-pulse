"""Upload + request error matrix over HTTP (workflow-architecture §9 C1/C2; §3 error shapes).

Every upload-validation 422 carries the documented dict-shaped detail
``{"code", "message", "report"}`` (the §3 deviation); pydantic request 422s
carry the standard ``{"detail": [...]}`` list; service errors carry
``{"detail": "<string>"}``. Every failed upload leaves **no directory behind**
(C2 tail) — asserted against the module's tmp uploads root.

No training jobs are spawned in this module.
"""
from __future__ import annotations

from types import SimpleNamespace

import pandas as pd
import pytest
from fastapi.testclient import TestClient

from backend.app import security
from ml.data.ingest import RAW_TRAIN_CSV
from ml.workflow import datasets as wf_datasets
from backend.tests.conftest import (
    DEFAULT_PREPROCESS_BODY,
    MINIMAL_PROPERTY_PAYLOAD,
    ames_slice_csv,
    upload_dataset,
)

pytestmark = pytest.mark.usefixtures("workflow_roots")

_CSV_HEADERS = {"content-type": "text/csv"}


def _uploaded_ids(roots: SimpleNamespace) -> list[str]:
    """Directory names under the module's tmp uploads root (empty when absent)."""
    if not roots.uploads.exists():
        return []
    return sorted(p.name for p in roots.uploads.iterdir())


# ---------------------------------------------------------------------------
# C1 — the full bundled CSV renamed, uploaded, listed
# ---------------------------------------------------------------------------

class TestFullAmesUpload:
    def test_full_ames_copy_accepted(
        self, workflow_client: TestClient, workflow_roots: SimpleNamespace
    ) -> None:
        """C1: a renamed copy of train.csv -> 201, validation.ok, n_rows 1460, listed."""
        response = upload_dataset(
            workflow_client, RAW_TRAIN_CSV.read_bytes(), filename="my-houses.csv"
        )
        assert response.status_code == 201, response.text
        body = response.json()
        assert body["name"] == "my-houses.csv"
        assert body["source"] == "upload"
        assert body["n_rows"] == 1460
        assert body["n_cols"] == 81
        assert body["validation"]["ok"] is True
        assert all(c["status"] in {"pass", "warn"} for c in body["validation"]["checks"])
        assert len(body["preview"]["head"]) == 8

        listing = workflow_client.get("/workflow/datasets").json()
        match = [d for d in listing if d["dataset_id"] == body["dataset_id"]]
        assert len(match) == 1 and match[0]["source"] == "upload"

        assert workflow_client.delete(
            f"/workflow/datasets/{body['dataset_id']}"
        ).status_code == 204
        assert _uploaded_ids(workflow_roots) == []


# ---------------------------------------------------------------------------
# C2 — the rejection matrix (dict-shaped 422 detail; nothing left behind)
# ---------------------------------------------------------------------------

class TestUploadRejections:
    def test_empty_file(
        self, workflow_client: TestClient, workflow_roots: SimpleNamespace
    ) -> None:
        """C2a: a header-only CSV -> 422 code empty_file."""
        header = ames_slice_csv(20).split(b"\n", 1)[0] + b"\n"
        response = upload_dataset(workflow_client, header, filename="empty.csv")
        assert response.status_code == 422
        detail = response.json()["detail"]
        assert detail["code"] == "empty_file"
        assert detail["message"]
        assert detail["report"]["ok"] is False
        assert _uploaded_ids(workflow_roots) == []

    def test_corrupt_csv(
        self, workflow_client: TestClient, workflow_roots: SimpleNamespace
    ) -> None:
        """C2b: binary garbage -> 422 code corrupt_csv with a parse error."""
        response = upload_dataset(workflow_client, b"not,a,csv\x00\x01", filename="bad.csv")
        assert response.status_code == 422
        detail = response.json()["detail"]
        assert detail["code"] == "corrupt_csv"
        assert detail["report"]["parse_error"]
        assert _uploaded_ids(workflow_roots) == []

    def test_schema_mismatch_names_column(
        self, workflow_client: TestClient, workflow_roots: SimpleNamespace
    ) -> None:
        """C2c: Ames copy minus SalePrice -> 422 schema_mismatch naming the column."""
        frame = pd.read_csv(RAW_TRAIN_CSV).head(20).drop(columns=["SalePrice"])
        response = upload_dataset(
            workflow_client, frame.to_csv(index=False).encode(), filename="missing-col.csv"
        )
        assert response.status_code == 422
        detail = response.json()["detail"]
        assert detail["code"] == "schema_mismatch"
        assert detail["report"]["missing_columns"] == ["SalePrice"]
        assert "SalePrice" in detail["message"]
        assert _uploaded_ids(workflow_roots) == []

    def test_duplicate_ids_counted(
        self, workflow_client: TestClient, workflow_roots: SimpleNamespace
    ) -> None:
        """C2d: 10 colliding Ids -> 422 duplicate_ids with n_duplicate_ids=10."""
        base = pd.read_csv(RAW_TRAIN_CSV).head(50)
        dup = pd.concat([base, base.head(10)], ignore_index=True)
        response = upload_dataset(
            workflow_client, dup.to_csv(index=False).encode(), filename="dup.csv"
        )
        assert response.status_code == 422
        detail = response.json()["detail"]
        assert detail["code"] == "duplicate_ids"
        assert detail["report"]["n_duplicate_ids"] == 10
        assert detail["report"]["duplicate_id_sample"] == [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]
        assert _uploaded_ids(workflow_roots) == []

    def test_unsupported_format(
        self, workflow_client: TestClient, workflow_roots: SimpleNamespace
    ) -> None:
        """C2e: an .xlsx-named body -> 422 unsupported_format (xlsx deliberately omitted)."""
        response = upload_dataset(
            workflow_client, ames_slice_csv(20), filename="houses.xlsx"
        )
        assert response.status_code == 422
        detail = response.json()["detail"]
        assert detail["code"] == "unsupported_format"
        assert ".csv" in detail["message"]
        assert _uploaded_ids(workflow_roots) == []

    def test_row_cap(
        self, workflow_client: TestClient, workflow_roots: SimpleNamespace,
        monkeypatch: pytest.MonkeyPatch,
    ) -> None:
        """C2-row-cap: over the upload row cap -> 422 row_cap_exceeded (cap patched down)."""
        monkeypatch.setattr(wf_datasets, "MAX_UPLOAD_ROWS", 50)
        response = upload_dataset(workflow_client, ames_slice_csv(), filename="big.csv")
        assert response.status_code == 422
        detail = response.json()["detail"]
        assert detail["code"] == "row_cap_exceeded"
        assert "50" in detail["message"]
        assert _uploaded_ids(workflow_roots) == []


# ---------------------------------------------------------------------------
# Transport-level errors: 400 / 413 / 415
# ---------------------------------------------------------------------------

class TestTransport:
    def test_empty_body_400(self, workflow_client: TestClient) -> None:
        """POST with a content type but no bytes -> 400."""
        response = workflow_client.post(
            "/workflow/datasets?filename=nothing.csv", content=b"", headers=_CSV_HEADERS
        )
        assert response.status_code == 400
        assert "empty" in response.json()["detail"]

    def test_oversized_body_413(self, workflow_client: TestClient) -> None:
        """C2f: 10 MiB + 1 byte -> 413 naming the 10 MiB upload-route limit."""
        body = b"a" * (10 * 1024 * 1024 + 1)
        response = workflow_client.post(
            "/workflow/datasets?filename=huge.csv", content=body, headers=_CSV_HEADERS
        )
        assert response.status_code == 413
        assert response.json()["detail"] == (
            f"Request body too large; limit is {10 * 1024 * 1024} bytes"
        )

    def test_rule_table_limit_patched_down(
        self, workflow_client: TestClient, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """The 10 MiB rule is really consulted: a patched-down limit 413s a small body."""
        monkeypatch.setattr(
            security, "BODY_LIMIT_RULES", (("POST", "/workflow/datasets", 1024),)
        )
        response = workflow_client.post(
            "/workflow/datasets?filename=x.csv", content=b"x" * 2048, headers=_CSV_HEADERS
        )
        assert response.status_code == 413
        assert "limit is 1024 bytes" in response.json()["detail"]

    def test_upload_route_exempt_from_global_cap(
        self, workflow_client: TestClient, workflow_roots: SimpleNamespace
    ) -> None:
        """The 240-row slice is > 64 KiB (global cap) yet uploads fine (10 MiB rule)."""
        body = ames_slice_csv()
        assert len(body) > security.MAX_BODY_BYTES
        response = upload_dataset(workflow_client, body, filename="slice.csv")
        assert response.status_code == 201, response.text
        dataset_id = response.json()["dataset_id"]
        assert workflow_client.delete(f"/workflow/datasets/{dataset_id}").status_code == 204

    def test_json_content_type_415(self, workflow_client: TestClient) -> None:
        """JSON bodies are not uploads -> 415."""
        response = workflow_client.post("/workflow/datasets", json={"not": "a csv"})
        assert response.status_code == 415
        assert "unsupported content type" in response.json()["detail"]

    def test_text_plain_content_type_415(self, workflow_client: TestClient) -> None:
        """text/plain is outside the whitelist -> 415."""
        response = workflow_client.post(
            "/workflow/datasets?filename=x.csv",
            content=b"Id,SalePrice\n1,2\n",
            headers={"content-type": "text/plain"},
        )
        assert response.status_code == 415


# ---------------------------------------------------------------------------
# 404s — unknown/malformed identifiers across every route family
# ---------------------------------------------------------------------------

class TestNotFound:
    def test_unknown_dataset_everywhere(self, workflow_client: TestClient) -> None:
        """ds_00000000 (well-formed, absent) -> 404 on every dataset-scoped route."""
        for url in (
            "/workflow/datasets/ds_00000000",
            "/workflow/datasets/ds_00000000/state",
            "/workflow/datasets/ds_00000000/profile",
            "/workflow/datasets/ds_00000000/features",
            "/workflow/datasets/ds_00000000/stats",
            "/workflow/datasets/ds_00000000/missing",
            "/workflow/datasets/ds_00000000/preprocess",
            "/workflow/datasets/ds_00000000/jobs",
            "/workflow/datasets/ds_00000000/models",
        ):
            response = workflow_client.get(url)
            assert response.status_code == 404, url
        assert workflow_client.get(
            "/workflow/datasets/ds_00000000/viz/histogram", params={"column": "SalePrice"}
        ).status_code == 404
        assert workflow_client.delete("/workflow/datasets/ds_00000000").status_code == 404

    def test_malformed_dataset_id_404(self, workflow_client: TestClient) -> None:
        """Ids failing the §4.9 regex are 404 (not 500/422)."""
        assert workflow_client.get("/workflow/datasets/nope").status_code == 404
        assert workflow_client.get("/workflow/datasets/ds_ZZZZZZZZ").status_code == 404

    def test_unknown_viz_kind_404(self, workflow_client: TestClient) -> None:
        """Only the five explicit viz routes exist."""
        response = workflow_client.get(
            "/workflow/datasets/ames/viz/pie", params={"column": "SalePrice"}
        )
        assert response.status_code == 404

    def test_unknown_job_routes(self, workflow_client: TestClient) -> None:
        """Unknown/malformed job ids -> 404 on status, evaluation and predict."""
        assert workflow_client.get("/workflow/jobs/job_00000000").status_code == 404
        assert workflow_client.get("/workflow/jobs/not-a-job").status_code == 404
        assert workflow_client.get(
            "/workflow/jobs/job_00000000/evaluation/ridge"
        ).status_code == 404
        response = workflow_client.post(
            "/workflow/jobs/job_00000000/predict/ridge", json=MINIMAL_PROPERTY_PAYLOAD
        )
        assert response.status_code == 404

    def test_post_jobs_unknown_dataset_404(self, workflow_client: TestClient) -> None:
        """Job creation on an unknown dataset -> 404."""
        response = workflow_client.post(
            "/workflow/datasets/ds_00000000/jobs",
            json={"objective": "regression", "candidates": ["ridge"]},
        )
        assert response.status_code == 404

    def test_preprocess_unknown_dataset_404(self, workflow_client: TestClient) -> None:
        """Preprocess preview on an unknown dataset -> 404."""
        response = workflow_client.post(
            "/workflow/datasets/ds_00000000/preprocess/preview", json=DEFAULT_PREPROCESS_BODY
        )
        assert response.status_code == 404


# ---------------------------------------------------------------------------
# 422s — bad columns / bad viz params / bad configs / bad job requests
# ---------------------------------------------------------------------------

class TestUnprocessable:
    def test_viz_bad_columns_422(self, workflow_client: TestClient) -> None:
        """Unknown or mistyped viz columns -> 422 string detail (§3.7)."""
        cases = [
            ("/workflow/datasets/ames/viz/histogram", {"column": "Neighborhood"}),  # categorical
            ("/workflow/datasets/ames/viz/histogram", {"column": "Nope"}),
            ("/workflow/datasets/ames/viz/scatter", {"x": "Nope", "y": "SalePrice"}),
            ("/workflow/datasets/ames/viz/scatter", {"x": "Neighborhood", "y": "SalePrice"}),
            ("/workflow/datasets/ames/viz/box", {"column": "SalePrice", "by": "SalePrice"}),
            ("/workflow/datasets/ames/viz/box", {"column": "Nope", "by": "Neighborhood"}),
            ("/workflow/datasets/ames/viz/correlation", {"target": "Nope"}),
            ("/workflow/datasets/ames/viz/category", {"column": "Nope"}),
        ]
        for url, params in cases:
            response = workflow_client.get(url, params=params)
            assert response.status_code == 422, (url, params)
            assert isinstance(response.json()["detail"], str), (url, params)

    def test_viz_bad_agg_422(self, workflow_client: TestClient) -> None:
        """category agg outside median|mean|count -> 422."""
        response = workflow_client.get(
            "/workflow/datasets/ames/viz/category",
            params={"column": "Neighborhood", "agg": "total"},
        )
        assert response.status_code == 422
        assert "unknown agg" in response.json()["detail"]

    def test_viz_missing_param_422_list_shape(self, workflow_client: TestClient) -> None:
        """Missing required query param -> pydantic 422 with the list detail shape."""
        response = workflow_client.get("/workflow/datasets/ames/viz/histogram")
        assert response.status_code == 422
        detail = response.json()["detail"]
        assert isinstance(detail, list)
        assert detail[0]["loc"] == ["query", "column"]

    def test_preprocess_bad_config_422(self, workflow_client: TestClient) -> None:
        """Bad stage-06 configs -> 422 (pydantic list detail)."""
        for config in (
            {"split_strategy": "banana"},
            {"val_frac": 2.0},
            {"val_frac": 0.8, "test_frac": 0.8},  # leaves < 10% train
            {"seed": -1},
            {"unknown_knob": True},  # extra=forbid
        ):
            response = workflow_client.post(
                "/workflow/datasets/ames/preprocess/preview", json={"config": config}
            )
            assert response.status_code == 422, config
            assert isinstance(response.json()["detail"], list), config

    def test_jobs_bad_request_422(self, workflow_client: TestClient) -> None:
        """Bad stage-07 requests -> 422; unknown candidates list the valid set."""
        response = workflow_client.post(
            "/workflow/datasets/ames/jobs",
            json={"objective": "forecasting", "candidates": ["ridge"]},
        )
        assert response.status_code == 422  # pydantic Literal guard

        response = workflow_client.post(
            "/workflow/datasets/ames/jobs", json={"objective": "regression", "candidates": []}
        )
        assert response.status_code == 422  # min_length=1

        response = workflow_client.post(
            "/workflow/datasets/ames/jobs",
            json={"objective": "regression", "candidates": ["ridge"], "extra": 1},
        )
        assert response.status_code == 422  # extra=forbid

        response = workflow_client.post(
            "/workflow/datasets/ames/jobs",
            json={"objective": "regression", "candidates": ["catboost"]},
        )
        assert response.status_code == 422
        detail = response.json()["detail"]
        assert "catboost" in detail
        assert "ridge" in detail  # the valid set is named


# ---------------------------------------------------------------------------
# 400 row-window (§2.3): a tiny upload can be explored but not trained
# ---------------------------------------------------------------------------

class TestRowWindow:
    def test_tiny_upload_cannot_train(
        self, workflow_client: TestClient, workflow_roots: SimpleNamespace
    ) -> None:
        """100 rows -> ~70 post-split train rows < 150: jobs + preprocess 400; EDA fine."""
        response = upload_dataset(workflow_client, ames_slice_csv(100), filename="tiny.csv")
        assert response.status_code == 201, response.text
        dataset_id = response.json()["dataset_id"]
        try:
            state = workflow_client.get(f"/workflow/datasets/{dataset_id}/state").json()
            assert state["can_train"] is False
            assert "150" in state["train_blocked_reason"]

            preview = workflow_client.post(
                f"/workflow/datasets/{dataset_id}/preprocess/preview",
                json=DEFAULT_PREPROCESS_BODY,
            )
            assert preview.status_code == 400
            assert "150" in preview.json()["detail"]

            job = workflow_client.post(
                f"/workflow/datasets/{dataset_id}/jobs",
                json={"objective": "regression", "candidates": ["ridge"]},
            )
            assert job.status_code == 400

            # The 01-05 exploration stages remain available (§2.3).
            assert workflow_client.get(
                f"/workflow/datasets/{dataset_id}/profile"
            ).status_code == 200
        finally:
            assert workflow_client.delete(
                f"/workflow/datasets/{dataset_id}"
            ).status_code == 204
