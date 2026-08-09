# PropPulse API Reference

FastAPI service in `backend/` (app factory: `backend/app/main.py`). All routes
are mounted at **root level — there is no `/api/v1` prefix** (SPEC §8 allows
the prefix as optional; this deployment omits it). The frontend reads the base
URL from `VITE_API_URL` (default `http://localhost:8000`).

Interactive Swagger UI: `GET /docs` (and ReDoc at `/redoc`) when the server is
running.

```bash
# Run locally from the repo root:
.venv/Scripts/python.exe -m uvicorn backend.app.main:app --host 127.0.0.1 --port 8000
```

General behavior:

- All champion artifacts load once at startup (lifespan); the server refuses
  to start if a champion artifact is missing.
- Every `POST /predict*` call is appended to `logs/predictions.jsonl`
  (best-effort — logging never blocks or breaks a response) and counted by
  the metrics middleware.
- The SHAP explainer is built once during **startup** (lifespan warm-up), so
  no user request pays it: the first `/predict` on a fresh process is ≈ 0.5 s
  and warm `/predict` is p50 ≈ 197 ms (c=1, measured on an otherwise idle
  machine; contended runs measure 2–3× higher — `reports/PERFORMANCE.md`
  "After fix"). `/metrics` latency averages still include the cold call.
- Classification responses refer to a **SIMULATED target (ADR-3)** — the
  30-day sale probability measures consistency with the documented
  days-on-market simulation, not real-world sale-speed performance.

## Endpoints

| Method | Path | Purpose |
|---|---|---|
| GET | `/health` | Liveness + per-model loaded status |
| GET | `/metrics` | Request counters, avg latency, latest drift summary |
| GET | `/model/info` | Champion metadata, headline metrics, feature version |
| GET | `/model/importance` | Global SHAP feature importance (mean \|SHAP\| per base feature) |
| GET | `/market/clusters` | Micro-market cluster stats + neighborhood map points |
| POST | `/market/comps` | Comparable historical (train-split) sales for a subject property |
| GET | `/market/trends` | Half-year median-price / sales-count series per micro-market |
| POST | `/predict` | Full bundle: price + range + probability + micro-market + top factors |
| POST | `/predict/price` | Price only |
| POST | `/predict/sale-probability` | Sale probability only |

---

## GET /health

Liveness plus per-model loaded status. No request body.

```bash
curl http://127.0.0.1:8000/health
```

```json
{
  "status": "ok",
  "models_loaded": {
    "regression": true,
    "classification": true
  }
}
```

---

## GET /metrics

Request counters, average latency, uptime, and the latest drift summary
(read from `reports/drift/latest.json`, written by
`python -m ml.monitoring.drift_check`).

```bash
curl http://127.0.0.1:8000/metrics
```

Shape (values illustrative, from a live server):

```json
{
  "requests_total": 10,
  "errors_total": 0,
  "requests_by_path": {"/health": 2, "/predict": 3, "/model/info": 1},
  "avg_latency_ms": 2189.5,
  "uptime_seconds": 71.129,
  "drift": {
    "status": "ok",
    "n_predictions": 338,
    "low_sample": false,
    "drift_detected": true,
    "drifted_features": ["YrSold", "sale_year"],
    "calendar_drift_features": ["YrSold", "sale_year"],
    "warn_features": [],
    "per_feature_psi": {"GrLivArea": 0.070167, "..." : "..."},
    "max_psi": 4.358638,
    "prediction_psi": {"estimated_price": 0.052306, "probability": 12.419831},
    "retraining_recommended": false,
    "recommendation_text": "Drift detected only in calendar-derived feature(s) ... does NOT recommend retraining ...",
    "window": 500,
    "psi_threshold": 0.2,
    "warn_threshold": 0.1,
    "min_sample_for_retraining": 200
  }
}
```

Before any drift check has run (or if the report is missing/unreadable),
`drift` is a placeholder:

```json
{
  "status": "no_data",
  "detail": "reports/drift/latest.json not found — run `python -m ml.monitoring.drift_check` after predictions are logged."
}
```

Notes:

- `errors_total` counts only responses with status ≥ 500.
- `drifted_features: ["YrSold", "sale_year"]` is expected on any post-2010
  traffic — calendar-derived features drift by construction of the time-based
  split (train = YrSold ≤ 2008). They are split out under
  `calendar_drift_features` (`YrSold`, `MoSold`, `sale_year`, `sale_month`,
  `sale_quarter`, `property_age`, `years_since_remod`), and **calendar-only
  drift never sets `retraining_recommended`** (post-audit guard, AUD-07) —
  the flag requires at least one drifted *non-calendar* feature **and** ≥
  `min_sample_for_retraining` (200) valid predictions, as in the example
  above. `drift_detected` itself is unaffected.
- `low_sample` is `true` when the window holds < 50 valid predictions —
  small-window PSI is noisy; treat the report as informational then.
- `psi_threshold` honors the `DRIFT_PSI_THRESHOLD` env var (default 0.2);
  `warn_threshold` is a fixed 0.1.
- `retraining_recommended` is a recommendation flag only; nothing retrains
  automatically.

---

## GET /model/info

Champion metadata + headline metrics, read from `models/champion.json`
at startup and cached in `app.state` (wave-9b). No request body.

```bash
curl http://127.0.0.1:8000/model/info
```

Response (abridged — the full `regression`, `classification`, and
`rationale` blocks mirror `models/champion.json` verbatim, except that the
internal artifact `path` keys are stripped from the public response):

```json
{
  "regression": {
    "name": "ridge",
    "version": "v1",
    "val_metrics": {"mae": 14526.572418, "rmse": 21672.72103, "r2": 0.927982, "rmsle": 0.135437},
    "test_metrics": {"mae": 15075.473458, "rmse": 21151.541687, "r2": 0.93048, "rmsle": 0.118689, "interval_coverage": 0.782857}
  },
  "classification": {
    "name": "random_forest",
    "version": "v1",
    "calibrated": true,
    "threshold": 0.203292,
    "val_metrics": {"roc_auc": 0.721778, "pr_auc": 0.525013, "f1": 0.545455, "brier": 0.18555},
    "test_metrics": {"roc_auc": 0.766602, "pr_auc": 0.567363, "f1": 0.506329, "brier": 0.171026}
  },
  "clustering": {"n_clusters": 4},
  "selected_at": "2026-08-07T10:38:48.406646+00:00",
  "dataset_version": "ames-1.0",
  "feature_version": "9b0f8ba4201c",
  "n_features": 94,
  "headline_metrics": {
    "regression": {
      "val_rmsle": 0.135437,
      "val_rmse": 21672.72103,
      "val_mae": 14526.572418,
      "val_r2": 0.927982,
      "test_rmsle": 0.118689
    },
    "classification": {
      "val_pr_auc": 0.525013,
      "val_roc_auc": 0.721778,
      "val_brier": 0.18555,
      "val_f1": 0.545455,
      "threshold": 0.203292,
      "simulated_target": true
    }
  },
  "rationale": "Regression champion = ridge: best validation RMSLE ..."
}
```

`feature_version` is the 12-character sha1 of `models/feature_list.json`;
`n_features` is the length of the model feature list (94).

---

## GET /model/importance

Global SHAP importance for the regression champion, with one-hot dummy
contributions aggregated back to base feature names. The payload is built
once at startup from `models/explainability/feature_importance.json` and
cached in `app.state` (wave-9b) — a restart is required to pick up a
regenerated artifact.

```bash
curl http://127.0.0.1:8000/model/importance
```

Real response (abridged to the top 4 of the 94 base features):

```json
{
  "metadata": {
    "model": "Ridge",
    "model_path": "models/registry/regression_champion.joblib",
    "explainer": "shap.LinearExplainer",
    "units": "log1p(SalePrice)",
    "background_size": 200,
    "background_split": "train",
    "val_sample_size": 200,
    "seed": 42,
    "feature_version": "9b0f8ba4201c",
    "dataset_version": "ames-1.0",
    "generated_at": "2026-08-07T10:39:02.217783+00:00",
    "aggregation": "one-hot dummy SHAP values summed back to base MODEL_FEATURES names; mean taken over |aggregated shap| of the val sample"
  },
  "importance": {
    "OverallQual": 0.057375233983035956,
    "OverallCond": 0.04048447448013188,
    "total_sf": 0.030004216713384775,
    "GrLivArea": 0.026005173277184497
  }
}
```

`importance` maps each of the 94 base features to its mean |SHAP| value
(sorted descending); units are `log1p(SalePrice)`.

If the artifact is missing/unreadable the endpoint returns **503** (not 500):

```json
{"detail": "feature importance artifact unavailable (FileNotFoundError)"}
```

and `{"detail": "feature importance artifact is malformed"}` when the JSON
parses but carries no usable `importance` mapping.

---

## GET /market/clusters

Micro-market cluster stats plus one map point per neighborhood (for the
frontend Market Map). No request body. The payload is built once at startup
and cached in `app.state` (wave-9b); restart to pick up retrained clustering
artifacts.

```bash
curl http://127.0.0.1:8000/market/clusters
```

Response (abridged to one cluster and two points — the live response carries
all 4 clusters and all 25 neighborhoods):

```json
{
  "n_clusters": 4,
  "clusters": [
    {
      "cluster_id": 0,
      "label": "mid northwest",
      "neighborhoods": ["Blmngtn", "BrDale", "BrkSide", "Crawfor", "Gilbert", "IDOTRR", "NPkVill", "NWAmes", "NoRidge", "NridgHt", "OldTown", "Somerst", "StoneBr", "Veenker"],
      "n_neighborhoods": 14,
      "n_sales": 461,
      "median_price": 179900.0,
      "median_price_per_sqft": 119.39218523878436,
      "sale_velocity_30d": 0.27765726681127983,
      "centroid_lat": 42.04567857142858,
      "centroid_long": -93.63607857142857,
      "note": "sale_velocity_30d is the fraction of this cluster's TRAIN-split sales with sells_within_30_days==1. It is a DESCRIPTIVE statistic over the SIMULATED sale-speed target (ADR-3), not a real-world market measurement, and is never used as a model input."
    }
  ],
  "neighborhoods": [
    {"neighborhood": "Blmngtn", "name": "Bloomington Heights", "lat": 42.0627, "long": -93.6418, "cluster_id": 0, "fallback": false},
    {"neighborhood": "Blueste", "name": "Bluestem", "lat": 42.0094, "long": -93.6457, "cluster_id": 1, "fallback": false}
  ]
}
```

- `cluster_id` is the DBSCAN label; neighborhoods that DBSCAN marked as noise
  (CollgCr, NAmes, Timber) are served via the nearest-centroid fallback and
  carry their assigned cluster with `fallback: true`.
- `lat`/`long` are the **approximate neighborhood centroids** (ADR-2).
- Clustering facts: DBSCAN eps = 1.317, min_samples = 2, features
  `[lat, long, median_price_per_sqft, monthly_sale_velocity]` (scaled).

---

## POST /market/comps

Comparable historical sales for a subject property. Body: the same
[`PropertyInput`](#propertyinput-request-schema) as `/predict`.

```bash
curl -X POST http://127.0.0.1:8000/market/comps \
  -H "Content-Type: application/json" \
  -d '{"neighborhood": "NridgHt", "bedrooms": 4, "full_bath": 2, "half_bath": 1,
       "bsmt_full_bath": 1, "bsmt_half_bath": 0, "gr_liv_area": 2500,
       "lot_area": 10000, "total_bsmt_sf": 1300, "year_built": 2005,
       "overall_qual": 8, "overall_cond": 5, "garage_cars": 2,
       "fireplaces": 1, "central_air": true}'
```

Response shape:

```json
{
  "comps": [
    {
      "sale_price": 215000,
      "price_per_sqft": 121.6,
      "gr_liv_area": 1768,
      "overall_qual": 7,
      "overall_cond": 5,
      "year_built": 1995,
      "bedrooms": 3,
      "baths": 2.5,
      "garage_cars": 2,
      "house_style": "2Story",
      "sold": "03/2008",
      "match_scope": "neighborhood"
    }
  ],
  "match_scope": "neighborhood",
  "percentile": 62.5,
  "note": "..."
}
```

- `comps` — matching historical sales; `sold` is the sale month as
  `MM/YYYY`, and each entry carries the `match_scope` it was found under.
- `match_scope` — `"neighborhood"` when enough comps exist in the subject's
  neighborhood, otherwise the widened `"cluster"` (micro-market) scope.
- `percentile` — 0–100; the position of the property's `/predict` estimate
  among the train sale prices in scope.
- `note` — discloses that comps are historical 2006–2008 training data, not
  current listings or a current-market sample.
- `calendar_clamped` — *(additive)* `true` when the requested sale date fell
  beyond the 2006–2008 train window and the subject's price percentile was
  scored at the clamped window boundary.

---

## GET /market/trends

Half-year price/volume series per micro-market cluster, computed from the
historical training data. No request body.

```bash
curl http://127.0.0.1:8000/market/trends
```

Response shape:

```json
{
  "periods": ["2006H1", "2006H2", "..."],
  "series": [
    {
      "cluster": 0,
      "label": "mid northwest",
      "median_price": [181500.0, "..."],
      "sales_count": [42, "..."]
    }
  ],
  "note": "..."
}
```

`median_price` and `sales_count` align index-by-index with `periods`;
`note` carries the same historical-data (2006–2008) disclosure as
`/market/comps`.

The comps/trends artifacts are aggregated from the **train split only**, so
their 2006–2008 range is deliberately narrower than the dataset's full
2006–2010 span — the valuation models are validated on 2009 and tested on
2010, and those splits are never served as "comparable sales".

---

## POST /predict

Full prediction bundle. Body: [`PropertyInput`](#propertyinput-request-schema).

```bash
curl -X POST http://127.0.0.1:8000/predict \
  -H "Content-Type: application/json" \
  -d '{
    "neighborhood": "StoneBr",
    "house_style": "2Story",
    "bldg_type": "1Fam",
    "ms_zoning": "RL",
    "bedrooms": 3,
    "full_bath": 2,
    "half_bath": 1,
    "bsmt_full_bath": 1,
    "bsmt_half_bath": 0,
    "gr_liv_area": 1850,
    "lot_area": 9500,
    "total_bsmt_sf": 950,
    "year_built": 1998,
    "overall_qual": 7,
    "overall_cond": 5,
    "garage_cars": 2,
    "fireplaces": 1,
    "central_air": true,
    "sale_date": "2026-06-15"
  }'
```

Real response (captured from the running service, 2026-08-07):

```json
{
  "estimated_price": 204881.59,
  "price_range": {"low": 177945.52, "high": 230227.22},
  "sale_probability": {
    "probability": 0.408609,
    "sells_within_30_days": true,
    "threshold": 0.203292
  },
  "micro_market": {
    "cluster_id": 0,
    "label": "mid northwest",
    "neighborhoods": ["Blmngtn", "BrDale", "..."],
    "n_neighborhoods": 14,
    "n_sales": 461,
    "median_price": 179900.0,
    "median_price_per_sqft": 119.39218523878436,
    "sale_velocity_30d": 0.27765726681127983,
    "centroid_lat": 42.04567857142858,
    "centroid_long": -93.63607857142857,
    "fallback": false,
    "note": "sale_velocity_30d is the fraction of this cluster's TRAIN-split sales with sells_within_30_days==1. It is a DESCRIPTIVE statistic over the SIMULATED sale-speed target (ADR-3), not a real-world market measurement, and is never used as a model input."
  },
  "top_price_factors": [
    {"feature": "OverallQual", "impact": "positive", "magnitude": 0.089386},
    {"feature": "neighborhood_median_price", "impact": "positive", "magnitude": 0.088983},
    {"feature": "neighborhood_median_price_per_sqft", "impact": "positive", "magnitude": 0.057562},
    {"feature": "neighborhood_mean_price", "impact": "positive", "magnitude": 0.054321},
    {"feature": "GrLivArea", "impact": "positive", "magnitude": 0.050053}
  ],
  "model_version": {
    "regression": "ridge_v1",
    "classification": "random_forest_v1",
    "feature_version": "9b0f8ba4201c"
  }
}
```

Response fields:

- `estimated_price` — dollars; `expm1` of the ridge log1p prediction.
- `price_range` — `expm1(pred_log + q_low)` … `expm1(pred_log + q_high)` with
  the validation-residual quantiles from `champion.json`
  (`q_low = -0.140954`, `q_high = 0.116634`; ~80% nominal interval, empirical
  test coverage 78.3%). Nothing is hardcoded.
- `sale_probability` — calibrated probability, the boolean decision at
  `threshold` (0.203292, from `champion.json`), and the threshold itself.
  SIMULATED target (ADR-3).
- `micro_market` — the property neighborhood's cluster payload;
  `fallback: true` means the neighborhood was a DBSCAN noise point (or
  unseen) and was mapped to the nearest cluster centroid.
- `top_price_factors` — up to 5 SHAP factors for this property:
  base feature name, sign (`impact`), and `magnitude` = share of total
  |SHAP| across all base features (0–1). If the explanation service fails,
  this is `[]` and the prediction still succeeds.
- `model_version` — champion names/versions + feature-list hash.
- `market_position` — *(additive, optional)* where the estimate sits against
  historical scope medians:
  `{"subject_price_per_sqft", "neighborhood_median_price_per_sqft",
  "cluster_median_price_per_sqft", "vs_neighborhood_pct",
  "label": "near" | "above" | "below"}` — `vs_neighborhood_pct` is the
  subject's $/sqft versus the neighborhood median in percent, and `label`
  buckets that gap.
- `confidence` — *(additive, optional)* serving-time reliability flag:
  `{"level": "typical" | "reduced", "reasons": [...]}` — `reduced` lists
  the reasons (e.g. inputs at or beyond the edge of training support);
  `typical` returns an empty `reasons` list.

Both blocks are additive optional fields: they are omitted from older
responses (including the captured example above) and clients should treat
their absence as "not provided", not as an error.

---

## POST /predict/price

Price only — same request schema as `/predict`, subset response.

```bash
curl -X POST http://127.0.0.1:8000/predict/price \
  -H "Content-Type: application/json" \
  -d '{"neighborhood": "NAmes", "bedrooms": 3, "full_bath": 2, "half_bath": 0,
       "bsmt_full_bath": 0, "bsmt_half_bath": 0, "gr_liv_area": 1400,
       "lot_area": 8000, "total_bsmt_sf": 800, "year_built": 1975,
       "overall_qual": 6, "overall_cond": 5, "garage_cars": 2,
       "fireplaces": 0, "central_air": true}'
```

```json
{
  "estimated_price": 137105.86,
  "price_range": {"low": 119080.32, "high": 154067.09},
  "model_version": {
    "regression": "ridge_v1",
    "classification": "random_forest_v1",
    "feature_version": "9b0f8ba4201c"
  }
}
```

---

## POST /predict/sale-probability

Probability only — same request schema as `/predict`, subset response.
SIMULATED target (ADR-3).

```bash
curl -X POST http://127.0.0.1:8000/predict/sale-probability \
  -H "Content-Type: application/json" \
  -d '{"neighborhood": "NAmes", "bedrooms": 3, "full_bath": 2, "half_bath": 0,
       "bsmt_full_bath": 0, "bsmt_half_bath": 0, "gr_liv_area": 1400,
       "lot_area": 8000, "total_bsmt_sf": 800, "year_built": 1975,
       "overall_qual": 6, "overall_cond": 5, "garage_cars": 2,
       "fireplaces": 0, "central_air": true}'
```

```json
{
  "probability": 0.319553,
  "sells_within_30_days": true,
  "threshold": 0.203292,
  "model_version": {
    "regression": "ridge_v1",
    "classification": "random_forest_v1",
    "feature_version": "9b0f8ba4201c"
  }
}
```

- `confidence` — *(additive)* the same serving-time reliability block as
  `/predict` (`{"level": "typical" | "reduced", "reasons": [...]}`); omitted
  from the captured example above.

---

## PropertyInput request schema

Validated by `backend/app/schemas/property.py` (pydantic, `extra="forbid"`,
whitespace stripped). **Unknown fields, unknown neighborhoods, out-of-range
values, and bad enum values all return 422.** Only the fields without a
listed default are required. Omitted optional fields fall back to
`models/feature_defaults.json` (train-split mode/median) via
`ml.features.serving.serving_payload_to_raw`; an explicit `null` is treated
as omitted for the nullable (`| null`) fields — for the non-nullable `int`
fields an explicit `null` is a 422.

### Core fields

| Field | Type | Range / values | Default |
|---|---|---|---|
| `neighborhood` | string | one of the 25 train neighborhoods (below) | **required** |
| `house_style` | string | `1.5Fin, 1.5Unf, 1Story, 2.5Fin, 2.5Unf, 2Story, SFoyer, SLvl` | `"1Story"` |
| `bldg_type` | string | `1Fam, 2fmCon, Duplex, Twnhs, TwnhsE` | `"1Fam"` |
| `ms_zoning` | string | `C (all), FV, RH, RL, RM` | `"RL"` |
| `bedrooms` | int | 0–8 | **required** |
| `full_bath` | int | 0–4 | **required** |
| `half_bath` | int | 0–2 | **required** |
| `bsmt_full_bath` | int | 0–3 | **required** |
| `bsmt_half_bath` | int | 0–2 | **required** |
| `gr_liv_area` | int | 300–6000 (above-grade living sqft) | **required** |
| `lot_area` | int | 500–200000 | **required** |
| `lot_frontage` | float \| null | 1.0–500.0 | `null` → default artifact |
| `total_bsmt_sf` | int | 0–4000 | **required** |
| `year_built` | int | 1870–2026 | **required** |
| `year_remod_add` | int \| null | 1870–2026 | `null` → `year_built` |
| `overall_qual` | int | 1–10 | **required** |
| `overall_cond` | int | 1–10 | **required** |
| `garage_cars` | int | 0–5 | **required** |
| `garage_area` | float \| null | 0.0–2000.0 | `null` → default artifact |
| `fireplaces` | int | 0–4 | **required** |
| `central_air` | bool | — | **required** |
| `pool_area` | int | 0–1000 | `0` (schema placeholder — see note below) |
| `wood_deck_sf` | int | 0–1500 | `0` (schema placeholder — see note below) |
| `open_porch_sf` | int | 0–1000 | `0` (schema placeholder — see note below) |
| `screen_porch` | int | 0–800 | `0` (schema placeholder — see note below) |
| `sale_date` | ISO date \| null | mapped to `MoSold`/`YrSold` | `null` → today |

Note on the four porch/pool/deck fields: the `0` is only the pydantic schema
placeholder. Serving serializes with `exclude_unset=True`, so an **omitted**
field never materializes the 0 — the model input falls back to
`feature_defaults.json` (train median/mode; e.g. omitted `open_porch_sf` →
OpenPorchSF 27, while an explicit `"open_porch_sf": 0` scores a true zero).
Send `0` explicitly if you mean zero.

The 25 valid `neighborhood` values (short codes — the raw Ames
`Neighborhood` values): Blmngtn, Blueste, BrDale, BrkSide, ClearCr, CollgCr,
Crawfor, Edwards, Gilbert, IDOTRR, MeadowV, Mitchel, NAmes, NPkVill, NWAmes,
NoRidge, NridgHt, OldTown, SWISU, Sawyer, SawyerW, Somerst, StoneBr, Timber,
Veenker.

### Optional advanced overrides

All optional; when omitted they fall back to `feature_defaults.json`. Enum
values are the exact train-split category sets (absent features are the
literal string `"None"`).

| Field | Type | Range / values |
|---|---|---|
| `bsmt_qual` | string | `Ex, Gd, TA, Fa, None` |
| `kitchen_qual` | string | `Ex, Gd, TA, Fa` |
| `exter_qual` | string | `Ex, Gd, TA, Fa` |
| `heating_qc` | string | `Ex, Gd, TA, Fa, Po` |
| `garage_type` | string | `2Types, Attchd, Basment, BuiltIn, CarPort, Detchd, None` |
| `garage_finish` | string | `Fin, RFn, Unf, None` |
| `foundation` | string | `BrkTil, CBlock, PConc, Slab, Stone, Wood` |
| `electrical` | string | `FuseA, FuseF, FuseP, Mix, SBrkr` |
| `functional` | string | `Maj1, Maj2, Min1, Min2, Mod, Sev, Typ` |
| `fireplace_qu` | string | `Ex, Gd, TA, Fa, Po, None` |
| `lot_shape` | string | `Reg, IR1, IR2, IR3` |
| `lot_config` | string | `Corner, CulDSac, FR2, FR3, Inside` |
| `land_slope` | string | `Gtl, Mod, Sev` |
| `condition1` | string | `Artery, Feedr, Norm, PosA, PosN, RRAe, RRAn, RRNe, RRNn` |
| `roof_style` | string | `Flat, Gable, Gambrel, Hip, Mansard, Shed` |
| `exterior1st` | string | `AsbShng, BrkFace, CemntBd, HdBoard, ImStucc, MetalSd, Plywood, Stone, Stucco, VinylSd, Wd Sdng, WdShing` |
| `mas_vnr_area` | float | 0.0–2000.0 |
| `kitchen_abv_gr` | int | 0–3 |
| `tot_rms_abvgrd` | int | 1–15 |
| `bsmt_fin_sf1` | int | 0–2500 |
| `bsmt_unf_sf` | int | 0–2500 |
| `first_flr_sf` | int | 300–4000 (1stFlrSF) |
| `second_flr_sf` | int | 0–3000 (2ndFlrSF) |
| `enclosed_porch` | int | 0–600 |
| `misc_val` | int | 0–20000 |
| `paved_drive` | string | `Y, N, P` |
| `street` | string | `Pave, Grvl` |
| `mo_sold` | int | 1–12 (overrides `sale_date` month) |
| `yr_sold` | int | 2006–2026 (overrides `sale_date` year) |

Explicit `mo_sold`/`yr_sold` win over `sale_date` when both are given.

---

## Errors

**422 Unprocessable Content** — request failed validation. `detail` is a list
of pydantic error objects with `type`, `loc`, `msg`, `input`, and `ctx`:

Unknown neighborhood (real response):

```json
{
  "detail": [
    {
      "type": "value_error",
      "loc": ["body", "neighborhood"],
      "msg": "Value error, unknown neighborhood 'NoSuchPlace'; must be one of: Blmngtn, Blueste, BrDale, ...",
      "input": "NoSuchPlace",
      "ctx": {"error": {}}
    }
  ]
}
```

Range violation (real response):

```json
{
  "detail": [
    {
      "type": "less_than_equal",
      "loc": ["body", "bedrooms"],
      "msg": "Input should be less than or equal to 8",
      "input": 99,
      "ctx": {"le": 8}
    }
  ]
}
```

A 422 is also returned (with a plain-string `detail`) when a syntactically
valid payload cannot be mapped into the model feature frame.

**500 Internal Server Error** — a generic handler logs the exception
server-side and returns no stack trace:

```json
{"detail": "Internal server error"}
```

**503 Service Unavailable** — only from `GET /model/importance` when the
feature-importance artifact is missing, unreadable, or malformed (see that
endpoint's section).

---

## CORS

`CORSMiddleware` is configured from the **`CORS_ORIGINS` environment
variable** — a comma-separated list of origins
(`backend/app/config.py`, parsed by `Settings.cors_origin_list`). Default
(also in `.env.example`):

```
CORS_ORIGINS=http://localhost:5173,http://localhost:4173,http://localhost:8080
```

i.e. the Vite dev server, the Vite **preview** origin, and the
docker-compose frontend are all allowed out of the box, with
`allow_credentials=true` and all methods/headers. Verified behavior: a
preflight from `http://localhost:8080` succeeds. Additional origins must be
added to `CORS_ORIGINS`. Non-browser clients (curl,
scripts, backend-to-backend) are unaffected by CORS.
