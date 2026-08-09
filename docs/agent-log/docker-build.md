# Agent log — docker-build (2026-08-07)

**Scope owned:** `docker/`, `docker-compose.yml`, `docker-compose.override.yml`
(new), `reports/DOCKER_SMOKE.md` (new). One out-of-scope-by-name but
Docker-infra file touched: root `.dockerignore` (single `!`-un-exclusion line —
required for the Dockerfile fix; flagged to orchestrator).

## What was done

Executed the real Docker build + smoke that ADR-7 had deferred (daemon now
running, Server 29.4.0, Compose v5.1.1). Full evidence with pasted command
output: **`reports/DOCKER_SMOKE.md`**.

1. **Ports:** 8000/8080/5000 squatted by foreign `showcase-*` containers →
   wrote `docker-compose.override.yml` remapping to 18000/18080/15000.
   Key discovery: **Compose v2 appends `ports` on merge** — replacement needs
   the `!override` YAML tag (first draft rendered both 8000 and 18000
   published). Override also sets the frontend `VITE_API_URL` build ARG
   (`http://localhost:18000`) and backend `CORS_ORIGINS` (adds
   `http://localhost:18080`).
2. **Build:** `docker compose build backend frontend` → exit 0 in 175 s, zero
   compilation issues on python:3.12-slim (all cp312 wheels exist for every
   pin). Images: backend **1.77 GB**, frontend **93.9 MB**.
3. **One real defect found & fixed:** SHAP background needs
   `data/processed/train.csv` (`ml/explainability/explainer.py` →
   `load_split("train")`), which `.dockerignore` excluded → `/predict`
   returned empty `top_price_factors`. Fix: un-exclude that one file +
   `COPY` it in `docker/backend.Dockerfile`. Verified: 5 SHAP factors in the
   response after rebuild.
4. **Smoke (all green, in-compose):** `/health` ok; `/predict` full contract
   (price/range/probability/micro_market/top_price_factors/model_version);
   `/market/clusters` (4 clusters); `/model/info`; `/model/importance`;
   `/metrics`; frontend nginx 200 + 311 KB JS bundle pointing at :18000; SPA
   fallback 200; CORS preflight from `http://localhost:18080` → 200 with
   matching `access-control-allow-origin`.
5. **Volumes:** host `logs/predictions.jsonl` received container prediction
   lines (2 → 7, container lines identified by timestamp/payload);
   `docker compose exec backend python -m ml.monitoring.drift_check` ran
   in-container and wrote host-visible `reports/drift/latest.json`
   (`retraining_recommended: false`, n=7 — guardrail correct).
6. **MLflow profile:** `ghcr.io/mlflow/mlflow:latest` (1.64 GB) up on :15000,
   HTTP 200.
7. **Teardown:** `docker compose --profile mlflow down`; all proppulse
   containers/network removed; ports 15000/18000/18080 verified free; foreign
   containers untouched.
8. **Regression:** `docker compose config -q` valid (with override AND base
   file alone — CI unaffected); `pytest tests backend/tests -q` → **154
   passed** (suite grew 114 → 154 from other agents' new tests; all green).

## Files changed

- `docker-compose.override.yml` — new (local port remap, documented)
- `docker/backend.Dockerfile` — +COPY of `data/processed/train.csv`
- `.dockerignore` — +`!data/processed/train.csv`
- `docker-compose.yml` — header comment now points to verified smoke report
- `docker/README.md` — "builds not executed" caveat resolved; fixes + remap
  recipe documented; image-contents note updated
- `reports/DOCKER_SMOKE.md` — new, full evidence

## Handed off / not mine to fix

- Root `README.md` (§Docker) and `docs/DEPLOYMENT.md` still say builds were
  not executed → documentation agent.
- ADR-7 wording ("daemon unavailable") now historical → Lead owns DECISIONS.md.
- Backend image 1.77 GB, dominated by pinned deps: `nvidia` NCCL 242 MB
  (xgboost 3.4.0 linux dep), llvmlite 173 MB (numba/shap). Slimming requires
  `backend/requirements.txt` changes (e.g. xgboost is not a serving champion)
  → backend/integration scope, not docker.
- `.env` was created locally via `cp .env.example .env` (compose `env_file`
  requires it; gitignored, no secrets).
