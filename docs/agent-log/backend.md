# Agent log — backend

**Scope:** `backend/**` only. Built the complete FastAPI service per SPEC §8 + §10.

## What was delivered

```
backend/
  README.md                      # run instructions + routing choice (root-level, no /api/v1)
  app/
    main.py                      # create_app factory + lifespan artifact loading + CORS + generic 500
    config.py                    # pydantic-settings over the .env.example keys, repo-root path resolution
    api/{deps,health,predict,model,market}.py
    schemas/{property,responses}.py
    services/{prediction_service,cluster_service,monitoring_service}.py
    monitoring/{middleware,prediction_log}.py
  tests/test_api.py              # 15 tests, TestClient + real champions, tmp prediction log
```

Key decisions / contract points:

- **Endpoints (root-level, no prefix — documented in `backend/README.md`):**
  `GET /health`, `GET /metrics`, `POST /predict`, `POST /predict/price`,
  `POST /predict/sale-probability`, `GET /model/info`, `GET /market/clusters`.
- **No re-mapping:** payloads go through `PropertyInput.to_serving_payload()`
  (exclude_unset) → `ml.features.serving.serving_payload_to_raw` →
  `build_feature_frame(stats=...)` (train-fit stats loaded once in lifespan).
- **Nothing hardcoded from champion.json:** `classification.threshold`
  (0.203292) and `regression.residual_interval` (q_low=-0.140954,
  q_high=0.116634) are read from the artifact; range = `expm1(pred_log + q)`.
- **Validation:** SPEC §8 ranges + exact train-split category Literals;
  neighborhood checked against the 25 geo-CSV neighborhoods; `extra="forbid"`.
  Bad enum / negative area / unknown neighborhood / unknown key → 422.
- **Explanations:** `ml.explainability.service.explain_instance(feature_row, top_n=5)`
  imported lazily inside try/except — any failure → `top_price_factors: []`.
  Verified live: real SHAP values returned (LinearExplainer over ridge).
- **Logging (SPEC §10 binding schema):** every prediction appends
  `{timestamp, payload, features (full 94-col row), prediction
  {estimated_price, probability, cluster_id}, model_version}` to
  `logs/predictions.jsonl` — best-effort, thread-safe, never blocks.
- **Metrics:** middleware records counts/latency per path; `/metrics` merges
  counters + avg latency + latest `reports/drift/latest.json`
  (`{"status": "no_data"}` fallback).
- **500 handler** returns `{"detail": "Internal server error"}` — no stack traces.
- **CORS** allows `http://localhost:5173`.

## Verification

- `pytest backend/tests -q` → **15 passed** (health, minimal/full predict,
  5× 422 cases, price-only, probability-only, model/info, market/clusters,
  metrics, prediction-log schema).
- Repo-wide collection still clean: `pytest --collect-only -q` → 104 tests, 0 errors.
- Real server smoke (uvicorn :8123, background):
  - `GET /health` → `{"status":"ok","models_loaded":{"regression":true,"classification":true}}`
  - `POST /predict` (StoneBr, full-ish payload) → 200:
    `estimated_price 242035.94`, range `[210215.16, 271977.86]`,
    `probability 0.336034`, `sells_within_30_days true` (threshold 0.203292),
    micro_market cluster 0 "mid northwest" (fallback false), 5 real SHAP factors,
    model_version `ridge_v1 / random_forest_v1 / 9b0f8ba4201c`.
  - `GET /metrics` → counters + drift summary from `reports/drift/latest.json`.
  - `logs/predictions.jsonl` line verified against the §10 schema (top-level keys
    exact, 94 features, prediction triple correct), then truncated; server killed.

## Notes for the orchestrator

- First `/predict` after startup pays a one-time SHAP explainer construction
  (~4 s, LinearExplainer with 200-row background, owned by the explainability
  agent); subsequent predictions are fast. Not a backend bug.
- `/metrics` latency average includes that first-call spike.
- `backend/requirements.txt` was pre-provided by the scaffold; all pins import
  cleanly in the project venv (pydantic-settings 2.14.2, uvicorn 0.52.1, ...).
- `logs/predictions.jsonl` was left truncated (empty) after the smoke test, as instructed.
