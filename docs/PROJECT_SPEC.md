# PropPulse — Project Specification (Shared Contract)

**Every agent MUST read this file (and `docs/DECISIONS.md`) before writing any code.**
The Lead/Orchestrator owns this document. Deviations must be recorded in `docs/DECISIONS.md`.

PropPulse predicts (1) property sale price (regression), (2) probability a property sells
within 30 days (classification), (3) neighbourhood micro-market clusters (unsupervised),
served via FastAPI + React dashboard, with SHAP explainability, MLflow versioning,
drift monitoring, tests, and Docker packaging.

---

## 1. Environment (verified facts)

- OS: **Windows**, shell is **Git Bash**. Use forward slashes. Do not use `NUL`, use `/dev/null`.
- Project root: `C:/Machine_Learning/Prop-pulse` (Git Bash: `/c/Machine_Learning/Prop-pulse`).
- Python: **3.14.5** only interpreter available. Virtualenv lives at **`.venv/`** (repo root).
  - Run Python as: `.venv/Scripts/python.exe` (from repo root) — never rely on global python.
  - Install packages with: `.venv/Scripts/python.exe -m pip install ...`
- pandas 3.0.3 / numpy 2.4.6 confirmed installable on 3.14. If a package has no cp314 wheel,
  report it clearly in your result and pick the fallback noted in `docs/DECISIONS.md`.
- Node.js **v24.14.0** + npm 11.9.0 available.
- Docker CLI present but **daemon is NOT running** → Dockerfiles must be written and
  statically validated; note "build not executed (daemon unavailable)" in reports.
- Internet access works (pypi + raw.githubusercontent.com reachable).
- **Never run any git command** (no init/add/commit). Never commit secrets.

## 2. Dataset (decided — do not search for another)

Source zip already in repo root: `house-prices-advanced-regression-techniques1.zip`
= Kaggle **"House Prices: Advanced Regression Techniques"** (Ames, Iowa, USA; sales 2006–2010).

- Extract into `data/raw/ames/` → `train.csv` (1460 rows × 81 cols, has `SalePrice`),
  `test.csv` (1459 rows, **no SalePrice → never used for evaluation**),
  `sample_submission.csv`, `data_description.txt` (authoritative NA semantics).
- All labeled work uses **train.csv only**. Document source in `data/README.md`.
- Known gaps and **documented fallbacks** (see DECISIONS.md ADR-1/2/3):
  1. **No lat/long per property** → static lookup `data/external/neighborhood_geo.csv`:
     25 `Neighborhood` values → approximate real centroids in Ames, IA (approximation
     clearly documented). City-center reference: downtown Ames `42.0347, -93.6199`.
  2. **No days-on-market** → transparent, seeded simulation in `ml/data/sale_speed.py`
     producing `days_on_market` + `sells_within_30_days`. Clearly labelled
     *"SIMULATED TARGET — classification metrics are not real-world performance claims"*.
     The module exposes a clean drop-in interface for real DOM data later.
  3. Sale time granularity is month (`MoSold`) + year (`YrSold`) — sufficient.

## 3. Directory layout (final — create exactly this)

```
backend/            # FastAPI service
  app/{main.py,config.py}
  app/api/          # routers
  app/schemas/      # pydantic models
  app/services/     # prediction/explanation/cluster services
  app/monitoring/   # metrics + drift exposure
  tests/            # API tests
  requirements.txt  # slim serving subset
ml/                 # python package (importable as `ml.*` from repo root)
  paths.py  tracking.py           # PROVIDED BY LEAD — do not rewrite
  data/  features/  training/  evaluation/  clustering/  explainability/  monitoring/
models/             # versioned artifacts (joblib/json) + registry/ + champion.json
artifacts/          # misc run artifacts
mlruns/             # MLflow file store (gitignored)
data/{raw,interim,processed,external}/
notebooks/  reports/  figures/  docs/  docker/  tests/  logs/
frontend/           # Vite + React app
.github/workflows/
.env.example  docker-compose.yml  README.md  requirements.txt  pytest.ini
```

## 4. Data pipeline contract (`ml/data/`)

- Modules: `ingest.py`, `clean.py`, `validate.py`, `outliers.py`, `split.py`,
  `sale_speed.py`, `pipeline.py` (CLI: `python -m ml.data.pipeline`).
- Outputs: `data/processed/{train,val,test}.csv` + `data/processed/schema.json`.
- **Time-based split (no shuffle): train = YrSold ≤ 2008, val = YrSold = 2009,
  test = YrSold = 2010.** Test set is sealed until final evaluation.
- Cleaning per `data_description.txt`: NA means "absent feature" for Alley, Bsmt*,
  FireplaceQu, Garage*, PoolQC, Fence, MiscFeature → fill "None"/0 appropriately.
  `LotFrontage` NA → median within Neighborhood **computed on train split only**
  (val/test reuse train medians; unseen neighborhood → global train median).
- Duplicates by `Id` → error. `Id` is never a model feature.
- Outliers: do NOT blindly delete. Known Ames caveat: `GrLivArea > 4000` with low
  price are partial sales; rule-based trimming allowed **on train only**, each rule
  justified in `reports/` and code comments.
- `validate.py` enforces schema (column presence, ranges, category sets, coordinate
  validity, missingness thresholds — dtypes are recorded in `schema.json`, not enforced)
  and is reused by tests.

## 5. Feature engineering contract (`ml/features/`)

Single source of truth — used by training, evaluation, clustering AND the API.
No feature logic may be re-implemented in notebooks/backend/frontend.

- `pipeline.py` exposes:
  - `RAW_INPUT_COLUMNS: list[str]` — fixed raw columns consumed (others ignored).
  - `build_feature_frame(df: pd.DataFrame, stats: NeighborhoodStats | None = None) -> pd.DataFrame`
  - `fit_neighborhood_stats(train_df) -> NeighborhoodStats` → persisted to
    `models/neighborhood_stats.json` (median/mean price, price_per_sqft, monthly sale
    velocity per Neighborhood — **train split only**). Serving loads the artifact.
  - `FEATURE_DEFAULTS: dict` (train-mode/median defaults for optional serving fields),
    persisted to `models/feature_defaults.json`.
  - `MODEL_FEATURES: list[str]` written to `models/feature_list.json` by training.
- Engineered features: `property_age = YrSold - YearBuilt`, `years_since_remod`,
  `total_bath = FullBath + 0.5*HalfBath + BsmtFullBath + 0.5*BsmtHalfBath`,
  `living_area_per_bedroom`, `bathroom_bedroom_ratio`, `total_sf = GrLivArea + TotalBsmtSF`,
  `sale_month/sale_quarter/sale_year`, `lat`, `long` (neighborhood lookup),
  `distance_to_city_center_km` (haversine to 42.0347,-93.6199),
  `amenity_count` = count of {Fireplaces>0, PoolArea>0, WoodDeckSF>0, OpenPorchSF>0,
  ScreenPorch>0, GarageCars>0, CentralAir=='Y', PavedDrive=='Y'},
  plus train-only neighborhood stats joined on `Neighborhood`.
- **Leakage rules (hard):** `SalePrice`-derived per-row values (`price_per_sqft`) are
  EDA/clustering-only — never regression/classification inputs. All aggregate statistics
  are fit on train only. `days_on_market`/`sells_within_30_days` never used as features.
  `SaleType`/`SaleCondition` excluded from model inputs (not knowable pre-listing).
- Preprocessing (imputation + OneHotEncoder(handle_unknown='ignore') + scaling where
  needed) lives **inside sklearn Pipelines**, so a saved model is one self-contained
  joblib that accepts the raw feature frame defined by `MODEL_FEATURES`.

## 6. Model artifact contract (`models/`)

```
models/
  regression/{linear,ridge,lasso,random_forest,xgboost}_v1.joblib
  regression/metrics.json            # {model: {mae, rmse, r2, rmsle, mae_log?...}} on VAL
  classification/{logistic,decision_tree,random_forest,xgboost}_v1.joblib (+ _calibrated.joblib)
  classification/metrics.json        # roc_auc, pr_auc, precision, recall, f1, brier, confusion
  clustering/{dbscan.joblib, dbscan_scaler.joblib, cluster_stats.json, cluster_assignments.csv}
  neighborhood_stats.json  feature_defaults.json  feature_list.json
  monitoring/reference_stats.json
  explainability/{feature_importance.json, shap_summary.png, shap_bar.png, shap_values_sample.npz}
  registry/{regression_champion.joblib, classification_champion.joblib, ...}
  champion.json
```

`champion.json` schema:
```json
{
  "regression": {"name": "xgboost", "version": "v1", "path": "models/registry/regression_champion.joblib", "val_metrics": {}, "test_metrics": {}},
  "classification": {"name": "...", "version": "v1", "path": "models/registry/classification_champion.joblib", "calibrated": true, "val_metrics": {}, "test_metrics": {}},
  "clustering": {"path": "models/clustering/dbscan.joblib", "n_clusters": 0},
  "selected_at": "ISO8601", "dataset_version": "ames-1.0", "feature_version": "<sha1 of feature_list.json>",
  "rationale": "why this champion won"
}
```

- Champion chosen on **validation** metrics (regression: RMSLE primary, then RMSE;
  classification: PR-AUC primary + Brier calibration check), with the one-standard-error
  rule for regularization strength; sealed **test** used once for the final report.
  Rationale must weigh performance, calibration, latency, interpretability — do not
  auto-crown XGBoost.
- Targets: regression trains on `log1p(SalePrice)`, reports dollar-scale metrics via
  `expm1`. Classification target: `sells_within_30_days` (see §2 fallback 2).

## 7. MLflow contract

Use `ml/tracking.py` (provided): `track_run(experiment, run_name, params, tags)` context
manager; logs to file store `./mlruns` (env `MLFLOW_TRACKING_URI` overrides).
Every training run logs: params, val metrics, dataset_version, feature_version,
training timestamp, and the fitted pipeline artifact. Registry = `models/registry/` +
`champion.json` (file-store has no model registry server; documented).

## 8. API contract (`backend/`)

Routers under `app/api/`, services under `app/services/`, pydantic schemas under
`app/schemas/`, settings in `app/config.py` (pydantic-settings, env-driven, no absolute
paths — resolve via `ml/paths.py`). CORS allows `http://localhost:5173`.

Endpoints (prefix `/api/v1` optional but must be consistent; document choice in README):

| Method | Path | Purpose |
|---|---|---|
| GET | `/health` | liveness + model-loaded status |
| GET | `/metrics` | JSON: request counters, latency, latest drift summary |
| POST | `/predict` | full bundle (price + probability + micro-market + top factors) |
| POST | `/predict/price` | price only |
| POST | `/predict/sale-probability` | probability only |
| GET | `/model/info` | champion metadata, metrics, feature version |
| GET | `/market/clusters` | cluster stats + neighborhood points for the map |

`PropertyInput` (POST body — required unless a default is listed):
`neighborhood` (str, one of the 25), `house_style` (default "1Story"), `bldg_type`
(default "1Fam"), `ms_zoning` (default "RL"), `bedrooms` int 0–8, `full_bath` 0–4,
`half_bath` 0–2, `bsmt_full_bath` 0–3, `bsmt_half_bath` 0–2, `gr_liv_area` 300–6000,
`lot_area` 500–200000, `lot_frontage` optional, `total_bsmt_sf` 0–4000,
`year_built` 1870–2026, `year_remod_add` (default = year_built), `overall_qual` 1–10,
`overall_cond` 1–10, `garage_cars` 0–5, `garage_area` optional, `fireplaces` 0–4,
`central_air` bool, `pool_area`/`wood_deck_sf`/`open_porch_sf`/`screen_porch` (schema
default 0; when omitted, serving falls back to `feature_defaults.json` medians — see
API.md),
`sale_date` optional (default: today → mapped to MoSold/YrSold), plus optional advanced
overrides: `bsmt_qual, kitchen_qual, exter_qual, heating_qc, garage_type, garage_finish,
foundation, electrical, functional, fireplace_qu, lot_shape, lot_config, land_slope,
condition1, roof_style, exterior1st, mas_vnr_area, kitchen_abv_gr, tot_rms_abvgrd,
bsmt_fin_sf1, bsmt_unf_sf, first_flr_sf (1stFlrSF), second_flr_sf (2ndFlrSF),
enclosed_porch, misc_val, paved_drive, street, mo_sold, yr_sold`.
Unspecified fields → `models/feature_defaults.json`.

`/predict` response:
```json
{
  "estimated_price": 285000,
  "price_range": {"low": 256500, "high": 313500},
  "sale_probability": {"probability": 0.78, "sells_within_30_days": true},
  "micro_market": {"cluster_id": 3, "label": "Northridge Heights premium", "median_price": 310000, "median_price_per_sqft": 145.2, "sale_velocity_30d": 0.41, "n_neighborhoods": 4},
  "top_price_factors": [{"feature": "OverallQual", "impact": "positive", "magnitude": 0.31}],
  "model_version": {"regression": "xgboost_v1", "classification": "random_forest_v1", "feature_version": "..."}
}
```
Price range = quantile-based interval from residual distribution (val) — document method.
Errors: 422 with field details for bad input; 500 generic (no stack traces/secrets).

## 9. Frontend contract (`frontend/`)

Vite + React (not Next.js — see ADR-5). `VITE_API_URL` env (default
`http://localhost:8000`), dev proxy allowed. Pages/views:
1. **Valuation** — form per §8 inputs → renders estimated price, range, 30-day
   probability, micro-market card, top factors. Real API calls only; loading, error,
   and empty states.
2. **Market Map** — Leaflet (react-leaflet, OSM tiles) with neighborhood markers
   colored by cluster + popups with micro-market stats from `/market/clusters`.
3. **Model Insights** — model metrics from `/model/info`, feature importance chart
   (recharts) from explanation endpoint/artifact, drift summary from `/metrics`.
Professional, minimal, responsive (Tailwind or plain CSS — pick one, document).

## 10. Monitoring contract (`ml/monitoring/` + `backend/app/monitoring/`)

- `reference_stats.json`: per-numeric-feature bin edges + frequencies from train split.
- PSI implementation (`ml/monitoring/psi.py`): warn ≥ 0.1, drift ≥ 0.2.
- Backend logs every prediction to `logs/predictions.jsonl` (best-effort, never
  block the request). **Log-line schema (binding):**
  `{"timestamp": iso8601, "payload": {<PropertyInput fields>}, "features":
  {<MODEL_FEATURES name>: value — the full built feature row}, "prediction":
  {"estimated_price": float, "probability": float, "cluster_id": int},
  "model_version": str}`. Drift PSI is computed over the numeric `features` entries.
- `ml/monitoring/drift_check.py` (CLI) compares recent log window vs reference →
  `reports/drift/latest.json` with `drift_detected`, per-feature PSI,
  `retraining_recommended` (true only on drift + sufficient sample ≥ 200).
  **Never auto-retrain.** `/metrics` surfaces the latest drift summary.

## 11. Testing contract

- pytest; root `pytest.ini` with `pythonpath = .`, markers: `integration`.
- `tests/data`, `tests/features`, `tests/ml` (unit), `tests/integration` (end-to-end,
  marked), `backend/tests` (API via TestClient + real champion artifacts).
- Every agent writes unit tests for its own modules and **runs them green** before
  reporting done: `.venv/Scripts/python.exe -m pytest <path> -q`.

## 12. Config & security

- `.env.example` keys: `MODEL_DIR`, `DATA_DIR`, `MLFLOW_TRACKING_URI`, `API_HOST`,
  `API_PORT`, `VITE_API_URL`, `LOG_LEVEL`, `PREDICTION_LOG_PATH`, `DRIFT_PSI_THRESHOLD`.
- No secrets anywhere. No absolute paths in code (use `ml/paths.py` / config).
- Random seed = 42 everywhere.

## 13. Coding standards

Type hints; docstrings on public functions; small focused modules; pathlib;
no `print` in library code (use `logging`); pin versions in requirements files;
frontend: functional components, no hardcoded predictions.

## 14. Facts discovered during build (binding)

- **Pinned environment:** pandas **2.3.3** (mlflow 3.15.1 requires pandas<3), numpy 2.4.6,
  scikit-learn 1.9.0, xgboost 3.4.0, shap 0.52.0, mlflow 3.15.1, fastapi 0.141.1,
  pydantic 2.13.4, pytest 9.1.1. Target the pandas 2.3 API.
- **Processed CSV convention:** absent features are stored as the literal string
  `"None"`; files contain **zero NaNs**. Always read with
  `pd.read_csv(..., keep_default_na=False)`. Numeric columns are proper numerics.
- Raw category spellings include `MSZoning="C (all)"`, `BldgType in {"2fmCon","Duplex","Twnhs",...}`.
- Processed splits: train 945 / val 338 / test 175 rows; 85 columns including joined
  `lat`,`long`, and simulated `days_on_market` / `sells_within_30_days`
  (train fast-sale rate ≈ 0.25 → use class-imbalance-aware training).
- `models/feature_list.json` is written by the **features** agent (owns MODEL_FEATURES);
  training agents read it. `feature_version` everywhere = `ml.tracking.feature_version()`
  = sha1 of the file bytes (12 chars).
- **MLflow 3.15:** file store requires env `MLFLOW_ALLOW_FILE_STORE=true` — set
  automatically by `ml/tracking.py` at import; set it in `.env.example` too. Model
  logging must use cloudpickle serialization (`ml.tracking.log_model_artifact` does).
- Classification serving threshold is **not** 0.5 (calibrated probabilities sit near
  prevalence): the evaluation agent picks the operating threshold on val and stores it
  in `champion.json` under `classification.threshold`; the backend uses it.
- API routes live at root level (no `/api/v1` prefix) — documented in `backend/README.md`.
- `GET /model/importance` returns `models/explainability/feature_importance.json`
  (`{"metadata": ..., "importance": {feature: mean_abs_shap}}`) — endpoint added by the
  integration agent; the frontend codes against this contract.
- Champions: regression=ridge, classification=calibrated random forest
  (`models/registry/`). Explanation service: `ml.explainability.service.explain_instance`
  (warmed during app lifespan startup; warm p50 ≈197 ms for the full `/predict`).
