# PropPulse Backend (FastAPI)

Serves the registered champions (SPEC §8): ridge regression (log1p price) +
calibrated random forest (30-day sale probability, SIMULATED target — ADR-3)
+ micro-market clusters + SHAP top factors.

## Run

From the repo root:

```bash
.venv/Scripts/python.exe -m uvicorn backend.app.main:app --host 127.0.0.1 --port 8000
```

Configuration comes from env vars / `.env` (see `.env.example`: `MODEL_DIR`,
`DATA_DIR`, `API_HOST`, `API_PORT`, `PREDICTION_LOG_PATH`, ...); relative paths
resolve against the repo root (`backend/app/config.py`).

## Routing choice

Routes are mounted at **root level — no `/api/v1` prefix** (SPEC §8 allows the
prefix as optional; the frontend reads the base URL from `VITE_API_URL`):

| Method | Path | Purpose |
|---|---|---|
| GET | `/health` | liveness + per-model loaded status |
| GET | `/metrics` | request counters, avg latency, latest drift summary |
| POST | `/predict` | full bundle (price + range + probability + micro-market + top factors + market position + confidence) |
| POST | `/predict/price` | price only (+ market position + confidence) |
| POST | `/predict/sale-probability` | probability only |
| GET | `/model/info` | champion metadata + headline metrics + feature version |
| GET | `/model/importance` | mean-\|SHAP\| feature importance (503 if artifact missing) |
| GET | `/market/clusters` | cluster stats + neighborhood map points |
| POST | `/market/comps` | top-5 comparable train-split sales + subject price percentile |
| GET | `/market/trends` | half-year median price + sales count per cluster (train split) |

Interactive docs at `/docs` (Swagger UI).

## Guided ML workflow (`/workflow/*`)

The workbench API (workflow-architecture §3) lets users train **sandboxed**
models on the bundled Ames dataset or their own upload; sandbox artifacts live
under `models/workflow/<dataset_id>/` and never touch the champion artifacts
(`models/registry/`, `champion.json`, …). Sandbox predictions are **not**
written to `logs/predictions.jsonl`.

| Method | Path | Purpose |
|---|---|---|
| POST | `/workflow/datasets?filename=…` | upload a CSV (raw body, `text/csv`/`application/octet-stream`) → 201 + validation report |
| GET | `/workflow/datasets` | list datasets (bundled `ames` first) |
| GET | `/workflow/datasets/{id}` | record + stepper `state` block |
| GET | `/workflow/datasets/{id}/state` | just the `state` block |
| DELETE | `/workflow/datasets/{id}` | delete an upload (204; 400 bundled; 409 while a job runs) |
| GET | `/workflow/datasets/{id}/profile` | stage 01: shape/dtypes/missing/head-8 |
| GET | `/workflow/datasets/{id}/features` | stage 02: feature inventory + target/objective reporting |
| GET | `/workflow/datasets/{id}/stats` | stage 03: descriptive statistics |
| GET | `/workflow/datasets/{id}/missing` | stage 04: missing values + treatment policies |
| GET | `/workflow/datasets/{id}/viz/{histogram\|scatter\|box\|correlation\|category}` | stage 05: pre-aggregated chart payloads |
| GET | `/workflow/datasets/{id}/preprocess` | stage 06 state (`prepared`, `config`, `fingerprint`, `summary`) |
| POST | `/workflow/datasets/{id}/preprocess/preview` | run + persist stage 06 (leakage-safe, fit-on-train-only) |
| POST | `/workflow/datasets/{id}/jobs` | queue a training job → 202 (one at a time server-wide → 409) |
| GET | `/workflow/jobs/{job_id}` | job status/progress/results (status-file protocol) |
| GET | `/workflow/datasets/{id}/jobs` | past jobs of a dataset |
| GET | `/workflow/datasets/{id}/models?objective=…` | comparison table (+ regression bootstrap, provenance) |
| GET | `/workflow/jobs/{job_id}/evaluation/{candidate}` | stage 08 val-split evaluation payload |
| POST | `/workflow/jobs/{job_id}/predict/{candidate}` | stage 09 sandbox prediction (sandbox provenance; `PropertyInput` body) |

Upload-specific notes:

- **Body-limit exception (workflow-architecture §5.3):** `POST
  /workflow/datasets` accepts up to **10 MiB**; every other route keeps the
  global 64 KiB cap (`BODY_LIMIT_RULES` in `backend/app/security.py`). The 413
  message names the resolved limit.
- Uploads must be the full 81-column Ames raw schema (≤ 20,000 rows; training
  additionally needs ≥ 150 post-split train rows). Upload-validation 422s are
  deliberately dict-shaped: `{"detail": {"code", "message", "report"}}` (§3
  deviation from the usual `{"detail": "<string>"}`).
- Training runs in a subprocess (`python -m ml.workflow.train_job`) so CPU-heavy
  fitting never degrades co-located serving; job truth is the
  `models/workflow/<id>/jobs/<job_id>/status.json` protocol file. On startup
  the job service marks stale `queued`/`running` status files `failed`
  ("server restarted").

## Notes

- `PropertyInput` (`backend/app/schemas/property.py`) validates SPEC §8 ranges
  and the exact train-split category sets; unknown fields and unknown
  neighborhoods → 422. Omitted fields fall back to
  `models/feature_defaults.json` via `ml.features.serving.serving_payload_to_raw`
  (the single payload→raw mapping — never re-implemented here).
- Price range = `expm1(pred_log + q_low/q_high)` with the validation-residual
  quantiles from `models/champion.json` (`regression.residual_interval`);
  the sale-probability decision uses `classification.threshold` (≈0.2033).
  Neither is hardcoded.
- `top_price_factors` comes from `ml.explainability.service.explain_instance`;
  any explanation failure yields `[]` and never breaks a prediction.
- Sale-date handling (`ml/features/serving.py`): an omitted `sale_date`
  defaults to the latest train month (2008-12), and explicit dates beyond the
  2006-2008 train window are clamped to that boundary for scoring — the
  champions never extrapolate the calendar features; a clamp is disclosed in
  the `confidence.reasons` list.
- `confidence` flags key numeric inputs outside the observed train range
  (outer PSI bin edges of `models/monitoring/reference_stats.json`) with
  `level: "reduced"` — the estimate is served, the band is just less
  trustworthy.
- `market_position` positions the subject $/sqft against the train-split
  neighborhood/cluster medians; it is positioning, not an overpricing verdict.
- `/market/comps` + `/market/trends` are served from
  `models/comps/comps.json` (regenerate with `python -m ml.comps.build`) — a
  slim train-split sales extract that never contains the simulated-target
  columns (`days_on_market`, `sells_within_30_days`).
- Every prediction is appended to `logs/predictions.jsonl` (best-effort,
  SPEC §10 binding schema) and counted by the metrics middleware.
- Security hardening (see `reports/SECURITY.md`): baseline response headers
  and a 64 KiB request-body limit live in `backend/app/security.py`.
- Trust boundary: the joblib artifacts under `models/` are **first-party
  build products** — `joblib.load`/`pickle` executes embedded code, so never
  point `MODEL_DIR` at (or accept) user-supplied artifacts.

## Tests

```bash
.venv/Scripts/python.exe -m pytest backend/tests -q
```
