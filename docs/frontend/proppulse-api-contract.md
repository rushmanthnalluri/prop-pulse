# PropPulse — API & Data Capability Contract (Frontend Rebuild)

**Purpose:** the definitive contract the rebuilt frontend is designed against. Every
number below traces to a real backend response captured from a live server or to a
real on-disk artifact. Nothing here is aspirational.

**How this was produced (2026-08-08):**

- Full read of `backend/app/` (`main.py`, `config.py`, `security.py`, `api/`,
  `schemas/`, `services/`, `monitoring/`), `backend/README.md`, `ml/clustering/serve.py`,
  `ml/explainability/service.py`, `ml/features/serving.py`, `ml/monitoring/drift_check.py`.
- Artifact inventory under `models/` and `reports/` (paths cited per claim).
- **Live capture:** the backend was run with
  `.venv/Scripts/python.exe -m uvicorn backend.app.main:app --host 127.0.0.1 --port 8765`
  from the repo root (repo venv, Python 3.14.5, per `backend/requirements.txt`). Every
  endpoint was called with `curl`; raw responses are saved under
  `artifacts/api-contract/` and the examples below are those real responses
  (pretty-printed, truncated only where marked). Server was killed afterwards.
- Server startup: ~3 s to `/health` OK; SHAP explainer is warmed *during* lifespan
  startup, so the first `/predict` is already warm (~180 ms observed).

---

## 0. Base URL, routing, auth, CORS

- **Routes are mounted at ROOT level — there is NO `/api` or `/api/v1` prefix**
  (`backend/README.md` "Routing choice"; routers in `backend/app/main.py:271-275`).
  The frontend reads the base URL from `VITE_API_URL` (default `http://localhost:8000`,
  `backend/app/config.py:41`). Correct paths are `/predict`, `/market/clusters`, etc.
- **Auth: NONE.** No API keys, tokens, or auth headers exist anywhere in the backend
  (`backend/app/security.py` contains only security headers + a body-size limit).
  Do not build an auth flow against this backend.
- **CORS:** `CORSMiddleware` with `allow_credentials=True`, `allow_methods=["*"]`,
  `allow_headers=["*"]`, origins from the `CORS_ORIGINS` env var — default
  `http://localhost:5173,http://localhost:4173,http://localhost:8080`
  (`backend/app/config.py:46`,
  `backend/app/main.py:256-262`). Verified preflight: `OPTIONS /predict` with
  `Origin: http://localhost:5173` returns `access-control-allow-origin:
  http://localhost:5173`, `allow-credentials: true`. Any other origin is not
  allowed — the dev server must run on an allowed origin or `CORS_ORIGINS` must be set.
- **Every response** carries security headers (`backend/app/security.py:24-30`),
  verified live: `x-content-type-options: nosniff`, `x-frame-options: DENY`,
  `referrer-policy: no-referrer`, `cache-control: no-store`.
- **Request body limit:** 64 KiB (`MAX_BODY_BYTES`, `backend/app/security.py:34`);
  larger bodies → HTTP 413 `{"detail": "Request body too large; limit is 65536 bytes"}`.
  Legit prediction payloads are < 1 KiB, so this never fires in normal use.
- **Interactive docs:** Swagger UI at `/docs`, OpenAPI JSON at `/openapi.json`
  (FastAPI defaults, `backend/app/main.py:245-254`).

---

## 1. ENDPOINT CATALOG

All response models are defined in `backend/app/schemas/responses.py`; all request
validation in `backend/app/schemas/property.py`. Example responses below are **real
captures** from the live server on 2026-08-08 (files in `artifacts/api-contract/`).

### 1.1 `GET /health` — liveness + per-model status

Source: `backend/app/api/health.py:15-21`. Schema: `HealthResponse`.

Real response (HTTP 200, ~5 ms):

```json
{"status": "ok", "models_loaded": {"regression": true, "classification": true}}
```

Frontend-relevant: `models_loaded` per champion. Startup fails hard if either
champion artifact is missing (`backend/app/main.py:169-171`), so a running server
always reports both true.

### 1.2 `GET /metrics` — request counters, latency, drift summary

Source: `backend/app/api/health.py:24-29`, `backend/app/services/monitoring_service.py:64-78`.
Schema: `MetricsResponse`.

Real response after 25 requests (truncated drift block shown in full — this is the
current real state):

```json
{
  "requests_total": 25,
  "errors_total": 0,
  "requests_by_path": {"/health": 3, "/metrics": 1, "/model/info": 1,
    "/model/importance": 1, "/market/clusters": 1, "/market/trends": 1,
    "/predict": 9, "/predict/price": 2, "/predict/sale-probability": 2,
    "/market/comps": 2, "unmatched": 2},
  "avg_latency_ms": 38.757,
  "uptime_seconds": 102.224,
  "drift": {
    "timestamp": "2026-08-07T16:01:00.292063+00:00",
    "window": 500, "psi_threshold": 0.2, "warn_threshold": 0.1,
    "min_sample_for_retraining": 200,
    "reference_feature_version": "9b0f8ba4201c",
    "status": "no_data", "n_predictions": 0, "low_sample": true,
    "drift_detected": false, "drifted_features": [],
    "calendar_drift_features": [], "warn_features": [],
    "per_feature_psi": {}, "max_psi": null, "prediction_psi": null,
    "retraining_recommended": false,
    "recommendation_text": "No usable prediction data (log is empty: ...); drift check skipped..."
  }
}
```

Facts the frontend must respect:

- Counters are **per-process, in-memory** (`MonitoringService`,
  `backend/app/services/monitoring_service.py:29-36`) — they reset on every restart.
- `errors_total` only counts HTTP ≥ 500 (`monitoring_service.py:44-45`).
- `avg_latency_ms` is a plain mean over all requests since boot, not a percentile.
- `drift` is a verbatim copy of `reports/drift/latest.json`
  (`monitoring_service.py:47-62`). That file is only refreshed when someone runs
  `python -m ml.monitoring.drift_check` manually — **it is not live**. Current
  committed state is `status: "no_data"`. When data exists, the same schema carries
  `status: "ok"`, `n_predictions`, `per_feature_psi: {feature: psi}`,
  `prediction_psi: {estimated_price: …, probability: …}`, `drifted_features`,
  `warn_features`, `max_psi`, `low_sample`, and `retraining_recommended`
  (`ml/monitoring/drift_check.py:398-420`). `status` can also be the fallback
  `no_data` with a `detail` string when the file is missing/unreadable
  (`monitoring_service.py:50-62`).

### 1.3 `POST /predict` — full prediction bundle

Source: `backend/app/api/predict.py:93-118`. Schema: `PredictResponse`.
Request body: `PropertyInput` (see §1.9 for the full field table).

Real response (request payload in §1.9; observed latency ~180 ms warm):

```json
{
  "estimated_price": 158073.93,
  "price_range": {"low": 137291.7, "high": 177629.07},
  "sale_probability": {"probability": 0.177099, "sells_within_30_days": false,
    "threshold": 0.203292},
  "micro_market": {"cluster_id": 0, "label": "mid northwest",
    "neighborhoods": ["Blmngtn", "BrDale", "BrkSide", "Crawfor", "Gilbert",
      "IDOTRR", "NPkVill", "NWAmes", "NoRidge", "NridgHt", "OldTown", "Somerst",
      "StoneBr", "Veenker"],
    "n_neighborhoods": 14, "n_sales": 461, "median_price": 179900.0,
    "median_price_per_sqft": 119.39218523878436,
    "sale_velocity_30d": 0.27765726681127983,
    "centroid_lat": 42.04567857142858, "centroid_long": -93.63607857142857,
    "fallback": true,
    "note": "sale_velocity_30d is the fraction of this cluster's TRAIN-split sales with sells_within_30_days==1. It is a DESCRIPTIVE statistic over the SIMULATED sale-speed target (ADR-3), not a real-world market measurement, and is never used as a model input."},
  "top_price_factors": [
    {"feature": "OverallCond", "impact": "negative", "magnitude": 0.077303},
    {"feature": "2ndFlrSF", "impact": "negative", "magnitude": 0.061311},
    {"feature": "neighborhood_median_price", "impact": "negative", "magnitude": 0.045249},
    {"feature": "total_bath", "impact": "positive", "magnitude": 0.043198},
    {"feature": "HeatingQC", "impact": "positive", "magnitude": 0.036309}],
  "market_position": {"subject_price_per_sqft": 105.4,
    "neighborhood_median_price_per_sqft": 122.1,
    "cluster_median_price_per_sqft": 119.4,
    "vs_neighborhood_pct": -13.7, "label": "below"},
  "confidence": {"level": "typical", "reasons": []},
  "model_version": {"regression": "ridge_v1", "classification": "random_forest_v1",
    "feature_version": "9b0f8ba4201c"}
}
```

See §2 for the field-by-field semantics.

### 1.4 `POST /predict/price` — price only

Source: `backend/app/api/predict.py:121-157`. Schema: `PriceResponse`. Never runs
the classifier or SHAP (cheaper: ~27 ms observed). Real response:

```json
{
  "estimated_price": 158073.93,
  "price_range": {"low": 137291.7, "high": 177629.07},
  "market_position": {"subject_price_per_sqft": 105.4,
    "neighborhood_median_price_per_sqft": 122.1,
    "cluster_median_price_per_sqft": 119.4, "vs_neighborhood_pct": -13.7,
    "label": "below"},
  "confidence": {"level": "typical", "reasons": []},
  "model_version": {"regression": "ridge_v1", "classification": "random_forest_v1",
    "feature_version": "9b0f8ba4201c"}
}
```

### 1.5 `POST /predict/sale-probability` — probability only

Source: `backend/app/api/predict.py:160-193`. Schema: `SaleProbabilityResponse`.
Never runs the regressor or SHAP (~144 ms observed). Real response:

```json
{
  "probability": 0.177099, "sells_within_30_days": false, "threshold": 0.203292,
  "confidence": {"level": "typical", "reasons": []},
  "model_version": {"regression": "ridge_v1", "classification": "random_forest_v1",
    "feature_version": "9b0f8ba4201c"}
}
```

### 1.6 `GET /model/info` — champion metadata + headline metrics

Source: `backend/app/api/model.py:21-96`. Schema: `ModelInfoResponse`. Payload is
built once at startup and cached (`backend/app/main.py:220`). Real response
(truncated only inside `rationale`; full file at `artifacts/api-contract/model_info.json`):

```json
{
  "regression": {"name": "ridge", "version": "v1",
    "val_metrics": {"mae": 14526.572418, "rmse": 21672.72103, "r2": 0.927982,
      "rmsle": 0.135437, "rmse_log": 0.135437,
      "residual_interval": {"q_low": -0.140954, "q_high": 0.116634}},
    "test_metrics": {"mae": 15075.473458, "rmse": 21151.541687, "r2": 0.93048,
      "rmsle": 0.118689, "interval_coverage": 0.782857},
    "residual_interval": {"q_low": -0.140954, "q_high": 0.116634},
    "bootstrap_vs_runner_up": {"runner_up": "xgboost",
      "observed_rmsle_diff": -0.004341, "ci95": [-0.013336, 0.005985],
      "prob_runner_up_better": 0.1925, "n_resamples": 2000, "seed": 42,
      "significant": false}},
  "classification": {"name": "random_forest", "version": "v1", "calibrated": true,
    "threshold": 0.203292,
    "val_metrics": {"roc_auc": 0.721778, "pr_auc": 0.525013, "precision": 0.409091,
      "recall": 0.818182, "f1": 0.545455, "brier": 0.18555, "threshold": 0.203292,
      "confusion_matrix": {"tn": 122, "fp": 117, "fn": 18, "tp": 81}},
    "test_metrics": {"roc_auc": 0.766602, "pr_auc": 0.567363, "precision": 0.366972,
      "recall": 0.816327, "f1": 0.506329, "brier": 0.171026, "threshold": 0.203292,
      "confusion_matrix": {"tn": 57, "fp": 69, "fn": 9, "tp": 40}}},
  "clustering": {"n_clusters": 4},
  "selected_at": "2026-08-07T10:38:48.406646+00:00",
  "dataset_version": "ames-1.0",
  "feature_version": "9b0f8ba4201c",
  "n_features": 94,
  "rationale": "Regression champion = ridge: best validation RMSLE (0.1354 vs runner-up xgboost 0.1398); … Classification target is SIMULATED (ADR-3) — not a real-world performance claim.",
  "headline_metrics": {
    "regression": {"val_rmsle": 0.135437, "val_rmse": 21672.72103,
      "val_mae": 14526.572418, "val_r2": 0.927982, "test_rmsle": 0.118689},
    "classification": {"val_pr_auc": 0.525013, "val_roc_auc": 0.721778,
      "val_brier": 0.18555, "val_f1": 0.545455, "threshold": 0.203292,
      "simulated_target": true}}
}
```

Notes: internal artifact paths are stripped (`backend/app/api/model.py:37-38`);
`ChampionSection` allows extra keys, so full val+test metrics **including confusion
matrices** and the bootstrap comparison pass through (`responses.py:191-201`).
`headline_metrics.classification.simulated_target` is always `true` — the UI must
carry that caveat wherever classification numbers are shown.

### 1.7 `GET /model/importance` — global mean-|SHAP| feature importance

Source: `backend/app/api/model.py:99-111`. Schema: `ModelImportanceResponse`.
Serves the startup-cached read of `models/explainability/feature_importance.json`;
**HTTP 503** `{"detail": "…"}` if the artifact is missing/malformed. Real response
(top 10 of 94 features shown; full file at `artifacts/api-contract/model_importance.json`):

```json
{
  "metadata": {"model": "Ridge", "explainer": "shap.LinearExplainer",
    "units": "log1p(SalePrice)", "background_size": 200, "background_split": "train",
    "val_sample_size": 200, "seed": 42, "feature_version": "9b0f8ba4201c",
    "dataset_version": "ames-1.0", "generated_at": "2026-08-07T10:39:02.217783+00:00",
    "aggregation": "one-hot dummy SHAP values summed back to base MODEL_FEATURES names; mean taken over |aggregated shap| of the val sample"},
  "importance": {"OverallQual": 0.057375, "OverallCond": 0.040484,
    "total_sf": 0.030004, "GrLivArea": 0.026005, "1stFlrSF": 0.021389,
    "TotalBsmtSF": 0.021171, "2ndFlrSF": 0.020866, "BsmtFinSF1": 0.019883,
    "neighborhood_median_price": 0.018702, "living_area_per_bedroom": 0.017678,
    "…": "… (all 94 model features, down to 0.0 for Street/Utilities/PoolQC)"}
}
```

Importance values are mean |SHAP| **in log1p(SalePrice) units** — relative bar
charts only; they are not dollar impacts. Feature names are the 94 model-feature
names (raw Ames CamelCase + engineered snake_case, §4), not API field names.

### 1.8 `GET /market/clusters` — cluster stats + map points

Source: `backend/app/api/market.py:13-20`, built by
`backend/app/services/cluster_service.py:45-88`. Schema: `MarketClustersResponse`.
Cached at startup. Real response (truncated: 2 of 4 clusters, 3 of 25 points):

```json
{
  "n_clusters": 4,
  "clusters": [
    {"cluster_id": 0, "label": "mid northwest",
     "neighborhoods": ["Blmngtn","BrDale","BrkSide","Crawfor","Gilbert","IDOTRR",
       "NPkVill","NWAmes","NoRidge","NridgHt","OldTown","Somerst","StoneBr","Veenker"],
     "n_neighborhoods": 14, "n_sales": 461, "median_price": 179900.0,
     "median_price_per_sqft": 119.39218523878436,
     "sale_velocity_30d": 0.27765726681127983,
     "centroid_lat": 42.04567857142858, "centroid_long": -93.63607857142857,
     "note": "sale_velocity_30d is the fraction of this cluster's TRAIN-split sales with sells_within_30_days==1. It is a DESCRIPTIVE statistic over the SIMULATED sale-speed target (ADR-3), not a real-world market measurement, and is never used as a model input."},
    {"cluster_id": 1, "label": "affordable southwest",
     "neighborhoods": ["Blueste","SWISU"], "n_neighborhoods": 2, "n_sales": 15,
     "median_price": 140000.0, "median_price_per_sqft": 80.57851239669421,
     "sale_velocity_30d": 0.26666666666666666,
     "centroid_lat": 42.014700000000005, "centroid_long": -93.64835, "note": "…"}
  ],
  "neighborhoods": [
    {"neighborhood": "Blmngtn", "name": "Bloomington Heights", "lat": 42.0627,
     "long": -93.6418, "cluster_id": 0, "fallback": false},
    {"neighborhood": "CollgCr", "name": "College Creek", "lat": 42.0193,
     "long": -93.6868, "cluster_id": 2, "fallback": true},
    {"neighborhood": "NAmes", "name": "North Ames", "lat": 42.0424,
     "long": -93.6176, "cluster_id": 0, "fallback": true}
  ]
}
```

Frontend-relevant: everything needed for a real map is here — one
`{lat, long, name, cluster_id, fallback}` point per all 25 neighborhoods
(approximate geocoded centroids, `data/external/neighborhood_geo.csv`), plus
per-cluster centroids and stats. Full cluster table in §4.

### 1.9 `GET /market/trends` — half-year median price per cluster

Source: `backend/app/api/market.py:23-31`, built by
`backend/app/services/comps_service.py:167-201`. Schema: `MarketTrendsResponse`.
Cached at startup. Real response (complete):

```json
{
  "periods": ["2006H1","2006H2","2007H1","2007H2","2008H1","2008H2"],
  "series": [
    {"cluster": 0, "label": "mid northwest",
     "median_price": [165000.0,167570.0,154750.0,174000.0,166950.0,173500.0],
     "sales_count": [107,100,106,113,88,94]},
    {"cluster": 1, "label": "affordable southwest",
     "median_price": [118500.0,160000.0,187500.0,null,136200.0,151000.0],
     "sales_count": [3,1,2,0,6,3]},
    {"cluster": 2, "label": "mid west",
     "median_price": [147250.0,173200.0,143900.0,186250.0,149000.0,173000.0],
     "sales_count": [34,48,45,36,53,40]},
    {"cluster": 3, "label": "mid southeast",
     "median_price": [164000.0,160950.0,144900.0,187000.0,152750.0,175000.0],
     "sales_count": [13,8,16,10,8,11]}],
  "note": "Median sale prices from training data (2006-2008); cluster windows with few sales are noisy."
}
```

Hard limits: **6 half-year periods, 2006H1–2008H2 only** (train-split sale window,
`models/comps/comps.json` `sale_window`). `median_price` is `null` where a cluster
had no sales that half-year (real gap — render as a gap, never interpolate);
`sales_count` is then a real `0`.

### 1.10 `POST /market/comps` — comparable historical sales

Source: `backend/app/api/comps.py:16-56`, `backend/app/services/comps_service.py:114-153`.
Schema: `CompsResponse`. Same `PropertyInput` body as `/predict`. Real response:

```json
{
  "comps": [
    {"sale_price": 163500, "price_per_sqft": 98.7, "gr_liv_area": 1657,
     "overall_qual": 6, "overall_cond": 3, "year_built": 1970, "bedrooms": 3,
     "baths": 2.0, "garage_cars": 2, "house_style": "1Story", "sold": "03/2007",
     "match_scope": "neighborhood"},
    {"sale_price": 180500, "price_per_sqft": 126.7, "gr_liv_area": 1425,
     "overall_qual": 6, "overall_cond": 5, "year_built": 1964, "bedrooms": 3,
     "baths": 2.0, "garage_cars": 2, "house_style": "1Story", "sold": "07/2008",
     "match_scope": "neighborhood"},
    {"sale_price": 160000, "price_per_sqft": 120.8, "gr_liv_area": 1324,
     "overall_qual": 6, "overall_cond": 5, "year_built": 1965, "bedrooms": 3,
     "baths": 2.0, "garage_cars": 2, "house_style": "1Story", "sold": "12/2006",
     "match_scope": "neighborhood"},
    {"sale_price": 158000, "price_per_sqft": 121.4, "gr_liv_area": 1302,
     "overall_qual": 6, "overall_cond": 7, "year_built": 1964, "bedrooms": 3,
     "baths": 1.5, "garage_cars": 1, "house_style": "SLvl", "sold": "10/2007",
     "match_scope": "neighborhood"},
    {"sale_price": 155000, "price_per_sqft": 115.0, "gr_liv_area": 1348,
     "overall_qual": 6, "overall_cond": 5, "year_built": 1966, "bedrooms": 3,
     "baths": 1.5, "garage_cars": 2, "house_style": "2Story", "sold": "07/2006",
     "match_scope": "neighborhood"}],
  "match_scope": "neighborhood",
  "percentile": 75.5,
  "note": "Historical sales 2006-2008 (training data), not current listings.",
  "calendar_clamped": false
}
```

Semantics: exactly top-5 comps ranked by normalized euclidean distance over
`(gr_liv_area, overall_qual, year_built, bedrooms, baths)` — above-grade baths =
`full_bath + 0.5*half_bath` (`comps.py:38-45`). Scope is the subject's neighborhood
when it has ≥ 5 train sales, else its whole cluster (`match_scope` says which).
`percentile` = share of the scope's train sale prices ≤ the subject's estimated
price (here: the estimate sits at the 75.5th percentile of NAmes train sales).
`calendar_clamped` discloses sale-date clamping (§2).

### 1.11 `PropertyInput` — request body for all four POST endpoints

Source: `backend/app/schemas/property.py:59-155`. `extra="forbid"` — unknown fields
→ 422. Omitted optional fields fall back to `models/feature_defaults.json`
(train mode/median, §4). The payload used for all captures above:

```json
{"neighborhood": "NAmes", "house_style": "1Story", "bldg_type": "1Fam",
 "ms_zoning": "RL", "bedrooms": 3, "full_bath": 2, "half_bath": 0,
 "bsmt_full_bath": 1, "bsmt_half_bath": 0, "gr_liv_area": 1500, "lot_area": 8000,
 "total_bsmt_sf": 1000, "year_built": 1975, "overall_qual": 6, "overall_cond": 5,
 "garage_cars": 2, "fireplaces": 1, "central_air": true}
```

**Required fields (no default — omitting any yields 422):**

| field | type | range / values |
|---|---|---|
| `neighborhood` | string | one of the 25 codes: Blmngtn, Blueste, BrDale, BrkSide, ClearCr, CollgCr, Crawfor, Edwards, Gilbert, IDOTRR, MeadowV, Mitchel, NAmes, NPkVill, NWAmes, NoRidge, NridgHt, OldTown, SWISU, Sawyer, SawyerW, Somerst, StoneBr, Timber, Veenker |
| `bedrooms` | int | 0–8 |
| `full_bath` | int | 0–4 |
| `half_bath` | int | 0–2 |
| `bsmt_full_bath` | int | 0–3 |
| `bsmt_half_bath` | int | 0–2 |
| `gr_liv_area` | int (sqft) | 300–6000 |
| `lot_area` | int (sqft) | 500–200000 |
| `total_bsmt_sf` | int (sqft) | 0–4000 |
| `year_built` | int | 1870–2026 |
| `overall_qual` | int | 1–10 |
| `overall_cond` | int | 1–10 |
| `garage_cars` | int | 0–5 |
| `fireplaces` | int | 0–4 |
| `central_air` | bool | — |

**Optional with schema defaults:** `house_style` ("1Story"; one of 1.5Fin, 1.5Unf,
1Story, 2.5Fin, 2.5Unf, 2Story, SFoyer, SLvl), `bldg_type` ("1Fam"; 1Fam, 2fmCon,
Duplex, Twnhs, TwnhsE), `ms_zoning` ("RL"; C (all), FV, RH, RL, RM),
`pool_area` (0; 0–1000), `wood_deck_sf` (0; 0–1500), `open_porch_sf` (0; 0–1000),
`screen_porch` (0; 0–800), `sale_date` (null; ISO date 2006-01-01…2026-12-31),
`lot_frontage` (null; 1.0–500.0), `year_remod_add` (null; 1870–2026, defaults to
`year_built` server-side), `garage_area` (null; 0.0–2000.0).

**Optional advanced overrides (all default null → train mode/median):**
`bsmt_qual`, `kitchen_qual`, `exter_qual` (Ex/Gd/TA/Fa[/None for bsmt]),
`heating_qc` (Ex/Gd/TA/Fa/Po), `garage_type`, `garage_finish`, `foundation`,
`electrical`, `functional`, `fireplace_qu`, `lot_shape`, `lot_config`, `land_slope`,
`condition1`, `roof_style`, `exterior1st`, `paved_drive` (Y/N/P), `street`
(Pave/Grvl) — exact Literal value sets in `property.py:26-49` — plus numeric
`mas_vnr_area` (0–2000), `kitchen_abv_gr` (0–3), `tot_rms_abvgrd` (1–15),
`bsmt_fin_sf1` (0–2500), `bsmt_unf_sf` (0–2500), `first_flr_sf` (300–4000),
`second_flr_sf` (0–3000), `enclosed_porch` (0–600), `misc_val` (0–20000),
`mo_sold` (1–12), `yr_sold` (2006–2026). `mo_sold`/`yr_sold` override `sale_date`
(`ml/features/serving.py:222-243`).

---

## 2. PREDICTION FLOW DETAIL — what `/predict` actually returns

Field-by-field, all from the real response in §1.3 and the code cited:

- **`estimated_price`** (USD, float, 2dp): ridge champion predicts
  `log1p(SalePrice)`; served value is `expm1(pred_log)`
  (`backend/app/services/prediction_service.py:292-298`).
- **`price_range {low, high}`** (USD): a **nominal ~80 % empirical interval** —
  `expm1(pred_log + q_low/q_high)` with val-residual Q10/Q90 quantiles
  `q_low=-0.140954`, `q_high=0.116634` from `models/champion.json`
  `regression.residual_interval`. NOT conformalised; measured coverage on the
  sealed test split is **0.782857** (`test_metrics.interval_coverage`,
  `reports/MODEL_EVALUATION.md` §8). It is asymmetric around the estimate.
- **`sale_probability {probability, sells_within_30_days, threshold}`**:
  calibrated-random-forest `predict_proba` for the positive class, rounded to 6dp;
  decision = `probability >= threshold`, threshold **0.203292** (NOT 0.5 — max-F1
  operating point, SPEC §14). **The target is SIMULATED** (days-on-market
  simulation, ADR-3): the probability measures consistency with a seeded
  simulation rule, not real-world sale speed. The UI must label it as such
  (`reports/MODEL_EVALUATION.md` §7; `data/README.md` "SIMULATED days-on-market
  target").
- **`micro_market`**: the subject neighborhood's DBSCAN micro-market cluster:
  `cluster_id`, human `label`, member `neighborhoods`, `n_sales` (train-split
  sales in member neighborhoods), `median_price`, `median_price_per_sqft`,
  `centroid_lat/long`, and `sale_velocity_30d` (**descriptive fraction over the
  SIMULATED target — same caveat; the `note` field says so verbatim**).
  **`fallback: true` means the neighborhood was DBSCAN noise** (`-1`) and was
  resolved to the nearest cluster centroid — this is the normal case for
  **NAmes, CollgCr, Timber** (`models/clustering/cluster_assignments.csv`;
  `ml/clustering/serve.py:173-190`). Verified live: the NAmes prediction returns
  cluster 0 with `fallback: true`.
- **`top_price_factors`** (list of exactly ≤ 5): per-instance SHAP explanation of
  the **price** prediction from `ml.explainability.service.explain_instance`
  (`shap.LinearExplainer` on the ridge champion). Each item:
  `feature` = base model-feature name (one-hot dummies aggregated, e.g.
  `"Neighborhood"` not `"Neighborhood_NridgHt"` — note these are MODEL feature
  names, CamelCase raw columns or engineered names, not API field names);
  `impact` = `"positive"|"negative"` (pushes predicted log-price up/down);
  `magnitude` = `|shap| / Σ|shap|` over ALL 94 base features — a **0–1 relative
  share** (the five returned shares sum to ≤ 1), NOT dollars and NOT raw SHAP
  (`ml/explainability/service.py` module docstring). **Can be `[]`** if the
  explanation fails — it never breaks the prediction
  (`prediction_service.py:314-334`); the UI must handle an empty list.
- **`market_position`**: subject $/sqft (=`estimated_price / gr_liv_area`) vs
  train-split medians: `neighborhood_median_price_per_sqft` (from
  `models/neighborhood_stats.json`), `cluster_median_price_per_sqft`,
  `vs_neighborhood_pct` (signed %), `label` ∈ `near` (|Δ| ≤ 5 %) / `above` /
  `below`. **Positioning vs the median only — explicitly NOT an overpricing
  verdict** (`prediction_service.py:213-242`).
- **`confidence`**: honesty block (`prediction_service.py:244-290`).
  `level: "typical" | "reduced"`. `"reduced"` with human-readable `reasons` when a
  key numeric input leaves the observed train range (outer PSI bin edges of
  `models/monitoring/reference_stats.json`: GrLivArea 334–4476, LotArea
  1533–164660, TotalBsmtSF 0–3200, YearBuilt 1872–2008, YearRemodAdd 1950–2008,
  GarageArea 0–1356) or when the sale-date calendar clamp fired. **The estimate is
  still served** — this is a trust badge, not an error. Verified live: a
  `gr_liv_area: 6000, year_built: 2020, sale_date: 2026-06-15` payload returns
  HTTP 200 with `"level": "reduced"` and four reasons (see
  `artifacts/api-contract/post_predict_reduced.json`).
- **`model_version`**: `regression: "ridge_v1"`, `classification:
  "random_forest_v1"`, `feature_version: "9b0f8ba4201c"` (content hash of
  `models/feature_list.json`). Display or stash for provenance.
- **Calendar clamp** (`ml/features/serving.py:71-123`): an omitted `sale_date`
  silently defaults to the latest train month **2008-12** (never "today"); an
  explicit date after 2008-12 is clamped to the window boundary for scoring and
  disclosed via `confidence.reasons` (+ `calendar_clamped` on `/market/comps`).
  `year_remod_add` defaults to `year_built` and is pinned ≤ the clamped sale year.

**What `/predict` does NOT return:** no per-comps list (call `/market/comps`), no
absolute SHAP values, no dollar-denominated factor impacts, no prediction-interval
for the probability, no per-property sale history, no image/address data (the Ames
dataset has none).

---

## 3. CAPABILITY MATRIX

SUPPORTED = served by a live endpoint (field cited). DERIVABLE = not served, but a
real artifact/report contains it (the frontend could only show it if the backend
adds an endpoint — today it is NOT reachable by the UI). NOT AVAILABLE = no real
data exists; **must not be faked**.

| Frontend feature | Status | Endpoint + field / artifact |
|---|---|---|
| Point price estimate | SUPPORTED | `POST /predict(.estimated_price)`, `/predict/price` |
| Prediction interval / uncertainty | SUPPORTED | `price_range.{low,high}` — nominal ~80 %, real test coverage 0.782857 (`models/champion.json`); no per-interval confidence level field |
| Local (per-prediction) feature attribution | SUPPORTED | `top_price_factors` — top-5, direction + relative share only; no absolute SHAP, no waterfall values |
| Global feature importance | SUPPORTED | `GET /model/importance` (mean \|SHAP\|, 94 features; 503 on artifact failure). Static PNGs also exist: `models/explainability/shap_summary.png`, `shap_bar.png` (not served by the API) |
| Comparable properties | SUPPORTED | `POST /market/comps` — top-5 real train-split sales + `percentile`; historical 2006-2008 only |
| Neighborhood clusters | SUPPORTED | `GET /market/clusters` — 4 clusters, labels, member lists, stats |
| Geo coordinates for a map | SUPPORTED | `market/clusters.neighborhoods[]` lat/long for all 25 neighborhoods + cluster centroids. **Approximate centroids** (`data/external/neighborhood_geo.csv`); no per-property coordinates exist |
| Market trends over time | SUPPORTED (limited) | `GET /market/trends` — 6 half-year periods 2006H1–2008H2 per cluster; training data only, ends 2008; no current data |
| Model comparison table (all candidates) | DERIVABLE | Not served. Full per-candidate val/test tables in `models/regression/metrics.json`, `models/classification/metrics.json`, `reports/MODEL_EVALUATION.md` §2/§5. `/model/info` serves only the two champions (plus champion-vs-runner-up bootstrap) |
| Confusion matrix | SUPPORTED | `/model/info` → `classification.val_metrics.confusion_matrix` and `test_metrics.confusion_matrix` (champion @ threshold 0.2033) |
| ROC / PR / calibration curves | NOT AVAILABLE | Only scalar `roc_auc`, `pr_auc`, `brier` in `/model/info`. No curve-point artifact exists anywhere under `models/` — do not draw curves |
| Drift metrics (PSI per feature) | SUPPORTED (currently empty) | `GET /metrics .drift` — schema has `per_feature_psi`, `prediction_psi`, `drifted_features`, `warn_features`, `max_psi`; real current value is `status: "no_data"` because `ml.monitoring.drift_check` has not been run over live traffic. Must render an honest "no data" state |
| Prediction-log stats (volume, avg price served…) | NOT AVAILABLE | `logs/predictions.jsonl` exists (79 records, schema below) but no endpoint aggregates or exposes it; `/metrics` has only request counters |
| Retraining status / recommendation | SUPPORTED (flag only) | `GET /metrics .drift.retraining_recommended` (+ `recommendation_text`) when the drift check has run; currently `false` under `no_data`. **No retraining trigger endpoint exists** — flag only (`ml/monitoring/drift_check.py:430`) |
| Live request health (req count, avg latency, errors) | SUPPORTED | `GET /metrics` (per-process, resets on restart; mean latency only) |
| Champion identity & provenance | SUPPORTED | `GET /model/info` + `model_version` on every prediction |
| Current/live listing prices, real DOM, post-2010 data | NOT AVAILABLE | All market data is the Ames, Iowa train split, sales 2006-2008 (val 2009, test 2010 sealed). No ingestion of new data exists |
| Per-neighborhood price stats | DERIVABLE | `models/neighborhood_stats.json` (median/mean price, median $/sqft, monthly velocity per 25 neighborhoods + global fallback) is loaded server-side but only surfaced piecemeal via `market_position` and cluster aggregates |

---

## 4. DATA FACTS

All numbers verified against the cited artifacts on 2026-08-08.

- **Dataset:** Kaggle Ames housing, 1,460 labeled rows (`data/raw/ames/train.csv`),
  time-based splits (`data/README.md`, `reports/MODEL_EVALUATION.md` §1):
  **train 945 rows (YrSold ≤ 2008), val 338 (2009), test 175 (2010, sealed)**.
  `dataset_version: "ames-1.0"`, `feature_version: "9b0f8ba4201c"`.
- **Properties/neighborhoods:** 945 train sales across **25 neighborhoods**
  (`data/external/neighborhood_geo.csv`); comps artifact holds the same 945 sales
  (`models/comps/comps.json` `n_rows`), sale window 2006-01 … 2008-12.
  Global train medians: median price $164,990, mean $182,125, median $/sqft 120.58
  (`models/neighborhood_stats.json` `global_fallback`).
- **Clusters (DBSCAN, eps≈1.317, min_samples=2; `models/clustering/cluster_stats.json`):**
  4 clusters — 0 "mid northwest" (14 nbhds, 461 sales, median $179,900,
  $119.39/sqft), 1 "affordable southwest" (2, 15, $140,000, $80.58/sqft),
  2 "mid west" (4, 158, $144,000, $113.85/sqft), 3 "mid southeast" (2, 41,
  $138,000, $128.57/sqft). Noise (fallback): NAmes, CollgCr, Timber.
- **Champions (`models/champion.json`, served via `/model/info`):**
  regression **ridge v1** (alpha=100, log1p target); classification **calibrated
  random_forest v1** (sigmoid CalibratedClassifierCV cv=5, 300 trees, threshold
  0.203292); both loaded from `models/registry/*.joblib`.
- **Headline metrics — regression ridge** (val 338 rows / sealed test 175 rows;
  `models/champion.json`, `reports/MODEL_EVALUATION.md` §4):
  val MAE $14,526.57, RMSE $21,672.72, R² 0.927982, RMSLE 0.135437;
  test MAE $15,075.47, RMSE $21,151.54, R² 0.93048, RMSLE 0.118689;
  interval coverage 0.782857. Bootstrap vs xgboost runner-up: RMSLE diff CI95
  [-0.0133, +0.0060] — **not statistically decisive** (`significant: false`).
- **Headline metrics — classification calibrated RF @ 0.2033 (SIMULATED target):**
  val ROC-AUC 0.7218, PR-AUC 0.5250, F1 0.5455, precision 0.4091, recall 0.8182,
  Brier 0.1856, confusion {tn 122, fp 117, fn 18, tp 81};
  test ROC-AUC 0.7666, PR-AUC 0.5674, F1 0.5063, precision 0.3670, recall 0.8163,
  Brier 0.1710, confusion {tn 57, fp 69, fn 9, tp 40}.
- **Features:** 94 model features (`/model/info.n_features`,
  `models/feature_list.json`): 79 raw/renamed Ames columns + 15 engineered
  (`property_age`, `years_since_remod`, `total_bath`, `living_area_per_bedroom`,
  `bathroom_bedroom_ratio`, `total_sf`, `sale_month`, `sale_quarter`, `sale_year`,
  `distance_to_city_center_km`, `amenity_count`, `neighborhood_median_price`,
  `neighborhood_mean_price`, `neighborhood_median_price_per_sqft`,
  `neighborhood_monthly_sale_velocity`). The API never takes these directly — the
  15 required + ~40 optional `PropertyInput` fields (§1.11) are expanded
  server-side using `models/feature_defaults.json` (train mode/median, e.g.
  OverallQual 6, YearBuilt 1972, GrLivArea 1456, Neighborhood NAmes).
- **Typical input ranges:** see §1.11 (schema ranges are validation limits; the
  narrower *train-observed* ranges that drive `confidence: "reduced"` are in §2).
- **Prediction log (`logs/predictions.jsonl`, SPEC §10 schema, verified head):**
  one JSON per line —
  `{"timestamp": iso8601-utc, "payload": {<effective input incl. server defaults>},
  "features": {<94 model features>}, "prediction": {"estimated_price": float|null,
  "probability": float|null, "cluster_id": int}, "model_version":
  "ridge_v1+random_forest_v1"}`. Narrow endpoints log `null` for the value they
  skip (`backend/app/api/predict.py:29-58`). Best-effort: logging never blocks a
  response. 79 records at audit time. Not exposed by any endpoint.

---

## 5. GOTCHAS (read before writing any frontend code)

1. **No `/api` prefix.** Base URL + `/predict`, `/market/clusters`, etc. An
   `/api/...` guess 404s (`{"detail": "Not Found"}`).
2. **Units & currency:** all prices USD, nominal 2006-2010 Ames, Iowa dollars — no
   inflation adjustment anywhere. Format as currency; comps `sale_price` are ints,
   `estimated_price`/`price_range` floats (2dp). Areas are sqft; `lat`/`long` are
   WGS-84-ish degrees around Ames (lat 41.99–42.07, long ≈ -93.60…-93.69).
3. **The classification number is SIMULATED.** `sale_probability`, and the cluster
   `sale_velocity_30d`, derive from a seeded days-on-market simulation (ADR-3).
   Every surface showing them must carry the caveat — `/model/info` even ships
   `simulated_target: true` for this purpose.
4. **Threshold is 0.203292, not 0.5.** Use the returned `threshold`; never
   hardcode 0.5 or recompute the boolean — use `sells_within_30_days` as served.
5. **`price_range` is ~80 % nominal, real coverage 78.3 %.** Label it "~80 % range"
   (not "95 % confidence interval"); it comes from val residual quantiles.
6. **`micro_market.fallback: true` is normal** for NAmes/CollgCr/Timber (DBSCAN
   noise) — the stats are the nearest cluster's. Don't hide it; don't error on it.
7. **`top_price_factors` can be `[]`** (explanation failure is swallowed by
   design). Its `magnitude` is a relative share (0–1), not dollars; `feature`
   names are model-feature names — map them to display labels in the frontend.
8. **`market_position.label` ("above"/"below") is NOT a pricing verdict** —
   it's $/sqft vs the neighborhood median. The code comments say so explicitly.
9. **Trends end at 2008H2** and comps are 2006-2008 training sales — the API
   itself ships `note` strings saying exactly this; render them. `median_price`
   `null` = no sales that half-year (gap, not zero).
10. **Confidence honesty block:** inputs can pass validation yet be outside the
    train range (e.g. `year_built` up to 2026 vs train max 2008) — response is 200
    with `confidence.level: "reduced"` + reasons. Show the badge; do not treat as
    an error. Sale dates past 2008-12 are clamped, never extrapolated.
11. **Error shapes (all verified live):**
    - 422 validation: `{"detail": [{"type", "loc": ["body", "<field>"], "msg",
      "input", "ctx"?}, ...]}` — e.g. `type: "missing"` / `"extra_forbidden"` /
      `"less_than_equal"` / `"int_parsing"` / `"value_error"` (unknown
      neighborhood message embeds the full 25-name list). Non-finite floats are
      stringified in `input` (`backend/app/main.py:122-141`).
    - 422 from the service layer (unmappable values): `{"detail": "<string>"}`.
    - 404 `{"detail": "Not Found"}`; 405 `{"detail": "Method Not Allowed"}`;
      413 `{"detail": "Request body too large; limit is 65536 bytes"}`;
      500 `{"detail": "Internal server error"}` (generic, no stack trace);
      503 on `/model/importance` artifact failure: `{"detail": "…"}`.
12. **Latency (observed this machine, warm, single requests; matches
    `reports/PERFORMANCE.md` post-fix numbers):** `POST /predict` ~180-200 ms
    (quiet machine; the calibrated classifier is ~80 % of it), `/predict/price`
    ~27 ms, `/predict/sale-probability` ~144 ms, `POST /market/comps` ~31 ms,
    GETs 6-35 ms. Cold start ~3 s to `/health`; the SHAP build happens during
    startup, so there is no slow first prediction anymore. **Single uvicorn worker
    is CPU-bound: throughput caps ~4-5 req/s on `/predict`** and queues under
    concurrency — spinners/skeletons on predict actions are mandatory; GETs can be
    polled freely. No rate limiting is implemented.
13. **`GET /metrics` is per-process and its `drift` block is a file snapshot** —
    currently `status: "no_data"`. Build an honest empty state for drift; never
    invent PSI values. `avg_latency_ms` is a mean, not p95.
14. **CORS allow-list only** (`localhost:5173`, `localhost:8080` by default);
    `allow_credentials: true`. Other origins get no `access-control-allow-origin`.
15. **All mutation is read-only for the UI:** every POST is a prediction/lookup;
    there are no write endpoints, no auth, no user state. `Cache-Control:
    no-store` is set on every response — don't rely on HTTP caching; the static
    GET payloads (`/market/clusters`, `/market/trends`, `/model/info`,
    `/model/importance`) are server-cached per process and safe to cache
    client-side for a session.

---

*Raw captures referenced above live in `artifacts/api-contract/` (`health.json`,
`metrics.json`, `metrics_after.json`, `model_info.json`, `model_importance.json`,
`market_clusters.json`, `market_trends.json`, `post_predict.json`,
`post_predict_price.json`, `post_predict_sale-probability.json`,
`post_market_comps.json`, `post_predict_reduced.json`, `err_*.json`,
`headers_*.txt`, `payload_valid.json`).*
