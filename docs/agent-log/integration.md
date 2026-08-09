# Agent log — integration

**Scope:** `tests/integration/**` + two surgical backend changes (SPEC §14):
the `GET /model/importance` endpoint and env-driven CORS. Status: **complete**,
full suite **114 passed** (104 baseline + 10 added here).

## What was delivered

1. **`GET /model/importance`** (`backend/app/api/model.py`)
   - Per SPEC §14: reads `models/explainability/feature_importance.json`
     (resolved via `settings.resolved_model_dir`, so `MODEL_DIR` is honored)
     and returns `{"metadata": ..., "importance": {feature: mean_abs_shap}}`.
   - Read per-request → regenerated artifacts are served without a restart.
   - Missing/unreadable/malformed artifact → **503** with a clean JSON
     `{"detail": ...}` (no paths/stack traces leaked).
   - Router tests added to `backend/tests/test_api.py` (200 shape + non-empty
     importance + top driver `OverallQual`; 503 via a tmp `model_dir` after
     startup). Backend suite: 15 → **17 tests, all green**.

2. **Env-driven CORS** (`backend/app/config.py`, `backend/app/main.py`,
   `.env.example`)
   - New `Settings.cors_origins: str = "http://localhost:5173,http://localhost:8080"`
     (plain string so pydantic-settings never tries JSON parsing) +
     `cors_origin_list` property (comma-split, whitespace-tolerant, drops empties).
   - `main.py` now passes `settings.cors_origin_list` to `CORSMiddleware`; the
     hardcoded `CORS_ORIGINS` module constant is gone.
   - `CORS_ORIGINS` documented in `.env.example`.
   - Verified in-process: default list, whitespace/empty parsing, env override.
   - This closes the CORS gap the devops log flagged (composed frontend on
     `:8080` was rejected). `docker/README.md:117` still points at the old
     `main.py` constant — left for the devops/docs owners to reword.

3. **`tests/integration/test_end_to_end.py`** — 8 tests, module-level
   `pytestmark = pytest.mark.integration`, all against the REAL artifacts:
   - (a) `POST /predict` (TestClient) == direct in-process chain
     (`serving_payload_to_raw` → `build_feature_frame` → registry joblibs):
     price within 0.01 (API rounds to 2dp), probability within 1e-6 (6dp),
     `sells_within_30_days` consistent with the champion threshold.
   - (b) `champion.json` consistency: paths under `models/registry/` exist,
     `app.state.champion` equals the file, served `model_version` ==
     `name_version` per task, and the artifacts at those paths reproduce the
     served bundle exactly.
   - (c) `/market/clusters`: map points == the 25 geo-CSV neighborhoods; every
     point's `cluster_id` is a served cluster; cluster memberships (22) ∪
     fallback points (3 DBSCAN noise: CollgCr, NAmes, Timber) == all 25,
     disjoint.
   - (d) drift pipeline end-to-end: synthetic SPEC §10 log lines (real built
     feature rows; prediction values cycled through the decile midpoints of
     `models/monitoring/prediction_reference.json`) → `run_drift_check` →
     tmp `latest.json`. Asserts the full 18-key report structure, clean window
     → no drift, GrLivArea ×3 window → ONLY `GrLivArea` drifts (PSI 10.64) with
     `retraining_recommended False` (189 < 200 minimum), missing log →
     `no_data`. The real `reports/drift/latest.json` is never touched.
   - (e) `build_feature_frame` twice on the same raw frame (single serving row
     + 50-row val slice) → `pd.testing.assert_frame_equal`; columns ==
     `MODEL_FEATURES`.
   - (f) prediction logging: real `logs/predictions.jsonl` is backed up, one
     TestClient `/predict` against default settings appends exactly one line
     with the EXACT §10 top-level keys
     `{timestamp, payload, features, prediction, model_version}`,
     `features` == the full 94-key `MODEL_FEATURES` row; log restored
     byte-for-byte in `finally`.

## Notable findings

- **PSI is small-sample sensitive** (monitoring module behaves correctly — no
  bug): a 40-row random sample of the train frame drifts on 20 features
  (max PSI 1.13) because neighborhood-level features are constant within a
  neighborhood, so the sampled mix skews. The clean-window test therefore uses
  a systematic every-5th-row sample (189 rows, mix preserved, max PSI 0.109).
- **Stale smoke server killed:** a leftover uvicorn (PID 6200, the backend
  agent's documented `:8123` smoke) was still listening, serving pre-edit code
  (404 on `/model/importance`, CORS 400 for `:8080`). It was stopped to run the
  mandated post-edit smoke on the same port. If any agent's docs reference a
  running server, it is no longer up.
- `logs/predictions.jsonl` was empty before my tests and is byte-identical
  (empty) after — backup/restore verified.

## Verification (all run for real)

- `.venv/Scripts/python.exe -m pytest tests backend/tests -q` →
  **114 passed, 4 warnings** (baseline was 104; +2 backend router tests,
  +8 integration tests).
- Live smoke (uvicorn `127.0.0.1:8123`, updated code, server killed after):
  - `GET /health` → `{"status":"ok","models_loaded":{"regression":true,"classification":true}}`
  - `GET /model/importance` → 200, metadata (Ridge / shap.LinearExplainer /
    feature_version `9b0f8ba4201c`) + non-empty importance map.
  - `POST /predict` (NridgHt 2Story payload) → 200: `estimated_price
    222687.99`, range `[193410.91, 250236.42]`, `probability 0.41593`
    (threshold 0.203292), micro-market cluster 0 "mid northwest"
    (`fallback: false`), SHAP top factors present.
  - CORS preflight `Origin: http://localhost:8080` → **200,
    `access-control-allow-origin: http://localhost:8080`** (was "Disallowed
    CORS origin" on the stale server); `:5173` still allowed.

## Files touched

```
backend/app/api/model.py            # + GET /model/importance (503 on missing artifact)
backend/app/config.py               # + cors_origins setting + cors_origin_list property
backend/app/main.py                 # CORS middleware reads settings (constant removed)
backend/tests/test_api.py           # + test_model_importance, + test_model_importance_missing_artifact_503
backend/README.md                   # route table row for /model/importance
.env.example                        # + CORS_ORIGINS key
tests/integration/test_end_to_end.py# NEW — 8 integration tests (this agent owns tests/integration/**)
docs/agent-log/integration.md       # this log
```
