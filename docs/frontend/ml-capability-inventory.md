# ML Capability Inventory — PropPulse `ml/` package & `models/` artifacts

Purpose: factual foundation for the 9-stage guided ML workflow API
(Upload → Analyse → Stats → Missing → Viz → Preprocess → Train → Evaluate → Predict).
Everything below was verified by reading the code and artifacts on 2026-08-08.
`file:line` citations refer to repo-relative paths. Nothing here is aspirational —
if a function is listed, it exists and is exercised by tests and/or the running backend.

Versions (backend/requirements.txt): Python 3.14.5, scikit-learn 1.9.0, xgboost 3.4.0,
pandas 2.3.3, numpy 2.4.6, shap 0.52.0, mlflow 3.15 (file store at `./mlruns`),
joblib 1.5.3, matplotlib (Agg, headless).

---

## 1. PIPELINE MAP — offline stages as implemented

All paths resolve from `ml/paths.py` (`REPO_ROOT = ml/paths.py parents[1]`, line 6);
no module hardcodes absolute paths. Every stage has a `python -m ...` CLI entry point.

| # | Stage | Module / function | Signature | CLI |
|---|-------|-------------------|-----------|-----|
| 1 | Ingest raw | `ml/data/ingest.py:22` `load_raw_train` | `(path: Path \| None = None) -> DataFrame` — reads `data/raw/ames/train.csv` (1460×81), `Id` as int64. Kaggle `test.csv` is deliberately never loaded (no `SalePrice`). | — |
| 1b | Ingest geo | `ml/data/ingest.py:40` `load_neighborhood_geo` | `(path=None) -> DataFrame` — 25-row centroid lookup, validates required cols. | — |
| 2 | Validate raw | `ml/data/validate.py:182` `validate_raw` | `(df) -> df` — 81 columns, unique Id, category sets (`EXPECTED_CATEGORIES`, line 47), numeric ranges (`NUMERIC_RANGES`, line 100). Raises `SchemaError` (line 18). | — |
| 3 | Time split | `ml/data/split.py:20` `time_split` | `(df) -> {"train","val","test"}` — train `YrSold<=2008`, val `2009`, test `2010` (ADR-4); asserts disjoint Ids, no lost rows. | — |
| 4 | Outliers (train only) | `ml/data/outliers.py:39` `apply_outlier_rules` | `(train_df) -> (filtered_df, report)` — one active rule: `GrLivArea>4000 & SalePrice<300k` (partial sales, line 17). Report persisted to `data/processed/outliers_report.json` (2 rows removed: 947→945). | — |
| 5 | Clean | `ml/data/clean.py:81` `fit_cleaner` / `:106` `apply_cleaner` | `fit_cleaner(train_df) -> Cleaner` (per-neighborhood `LotFrontage` medians + global fallback + `Electrical` mode — **train only**); `apply_cleaner(df, cleaner) -> df` (NA="absent" → `"None"`/0 per `NA_ABSENT_CATEGORICAL` line 32 / `NA_ABSENT_NUMERIC` line 51; raises if any NA remains). | — |
| 6 | Target attach | `ml/data/sale_speed.py:264` `attach_sale_speed` | `(df, provider: DomProvider) -> df` — adds `days_on_market` + `sells_within_30_days`. Providers: `SaleSpeedSimulator` (line 50, `.fit(train_df)` line 82, `.transform(df)` line 100) or `RealDomProvider(csv_path, min_coverage=0.95)` (line 123). Provider selection: `ml/data/pipeline.py:79` `select_dom_provider(train_df)` via env `DOM_PROVIDER` / `DOM_CSV_PATH` (default simulated). | — |
| 7 | Geo join | `ml/data/pipeline.py:70` `join_neighborhood_geo` | `(df, geo) -> df` — left-joins `lat`/`long`; hard error on unmapped neighborhood. | — |
| 8 | Validate + persist | `ml/data/validate.py:197` `validate_processed` / `:261` `write_schema_json` | Per-split validation (no NaNs, Ames bbox for lat/long, DOM-target consistency check line 217) then writes `data/processed/{train,val,test}.csv` + `schema.json`. | — |
| 1–8 | **Orchestrator** | `ml/data/pipeline.py:135` `run_pipeline` | `(output_dir=PROCESSED_DIR) -> {"train":945,"val":338,"test":175}` | `python -m ml.data.pipeline` |
| 9 | Feature artifacts | `ml/features/pipeline.py:521` `main` | Fits on **train only**: `fit_neighborhood_stats` (`ml/features/stats.py:117`) → `models/neighborhood_stats.json`; `compute_feature_defaults` (`ml/features/defaults.py:51`) → `models/feature_defaults.json`; `write_feature_list` (`ml/features/pipeline.py:499`) → `models/feature_list.json`. | `python -m ml.features.pipeline` |
| 10 | Feature build | `ml/features/pipeline.py:410` `build_feature_frame` | `(df, stats: NeighborhoodStats \| None = None) -> DataFrame` with exactly the 94 `MODEL_FEATURES` columns (line 195), NaN-free; fills missing optional cols from `FEATURE_DEFAULTS`, geo from neighborhood lookup, unseen neighborhoods → global fallback. | — |
| 11 | Preprocessor | `ml/training/common.py:34` `build_preprocessor` | `(X) -> ColumnTransformer` — numeric: median-impute + `StandardScaler`; categorical: mode-impute + `OneHotEncoder(handle_unknown="ignore")`; dense output. Shared by every model family; fitted **inside** each sklearn Pipeline (leakage-safe under CV). | — |
| 12 | Train regression | `ml/training/train_regression.py:200` `train_all` | `() -> dict` (the `models/regression/metrics.json` payload) | `python -m ml.training.train_regression` |
| 13 | Train classification | `ml/training/train_classification.py:375` `train_all` | `() -> dict` (the `models/classification/metrics.json` payload) | `python -m ml.training.train_classification` |
| 14 | Train clustering | `ml/clustering/train.py:540` `train` | `() -> ClusteringResult` | `python -m ml.clustering.train` |
| 15 | Evaluate + promote | `ml/evaluation/evaluate.py:629` `run_evaluation` | `() -> dict` — champion selection (val only) → registry copies → sealed-test read (once) → `champion.json`, `prediction_reference.json`, MLflow run, `reports/MODEL_EVALUATION.md`. | `python -m ml.evaluation.evaluate` |
| 16 | Explainability artifacts | `ml/explainability/build_artifacts.py:165` `build_artifacts` | `(explainer=None, sample_size=200, seed=42) -> {feature: mean_abs_shap}` | `python -m ml.explainability.build_artifacts` |
| 17 | Comps artifact | `ml/comps/build.py:104` `build_comps_artifact` | `(output_path=COMPS_PATH) -> dict` — 945 slim sale records + similarity scales (train only). | `python -m ml.comps.build` |
| 18 | Monitoring reference | `ml/monitoring/reference.py:78` `build_reference_stats` | `(output_path, n_bins=10, feature_list_path) -> dict` — PSI bin edges/proportions per numeric model feature + 4 key categorical frequency tables (train only). | `python -m ml.monitoring.reference` |
| 19 | Drift check | `ml/monitoring/drift_check.py:301` `run_drift_check` | `(log_path, window=500, ...) -> dict` → `reports/drift/latest.json`; PSI vs reference, calendar features excluded from retrain flag. | `python -m ml.monitoring.drift_check` |

Supporting: `ml/tracking.py` — `track_run(experiment, run_name, params, tags)` context manager
(line 43), `feature_version(path)` = 12-char sha1 of `feature_list.json` (line 37),
`log_model_artifact` (cloudpickle, line 65), `log_dict_artifact` (line 76).
`ml/training/common.py` — `load_split(name)` (line 22, `keep_default_na=False`),
`regression_metrics(y_true, y_pred)` (line 60), `residual_interval(y_log, pred_log, q_low=0.1, q_high=0.9)` (line 74), `write_json` (line 84).

---

## 2. MODEL ZOO

Every supervised model is a **self-contained sklearn Pipeline** (`preprocess` ColumnTransformer
from `build_preprocessor` + estimator), persisted as one joblib. Transformed space after
one-hot: **290 columns** (reports/PERFORMANCE.md:134).

### Regression — target `log1p(SalePrice)` (ADR-10); `ml/training/train_regression.py`

CV: `KFold(5, shuffle, seed=42)`, scoring `neg_root_mean_squared_error` on the log target
(lines 58–60). Val-only evaluation; test sealed. Champion selection is NOT here — it lives
in `ml/evaluation/select.py`.

| Model | Entry point | Hyperparameters / search | Shipped params | Val RMSLE | Track |
|-------|-------------|--------------------------|----------------|-----------|-------|
| `linear` | `_train_linear` (line 135) | none | `{}` | 0.1425 | candidate |
| `ridge` | `_train_alpha_model` (line 144): `GridSearchCV` over alpha `logspace(-3,3,13)` (line 64), `n_jobs=-1` | **one-standard-error rule** `one_se_alpha` (line 107): strongest alpha within 1 SE of best (grid best 31.6 → shipped 100.0) | `alpha=100.0`, `max_iter=10000` | **0.1354** | **CHAMPION** |
| `lasso` | same, grid `logspace(-4,0,13)` (line 65) | one-SE rule | `alpha=0.00464`, `max_iter=10000` | 0.1407 | candidate |
| `random_forest` | `_train_randomized` (line 176): `RandomizedSearchCV(n_iter=8)` (line 78) over `max_depth [None,10,20,30] × min_samples_leaf [1,2,4] × max_features [0.3,0.5,1.0]` (line 68) | base: `n_estimators=300, n_jobs=-1, seed 42` | `max_depth=20, min_samples_leaf=1, max_features=0.5` | 0.1590 | candidate |
| `xgboost` | same, over `max_depth [3,5,7] × min_child_weight [1,3,5] × reg_lambda [1,5,10]` (line 73) | base: `n_estimators=500, lr=0.05, subsample=0.8, colsample_bytree=0.8, tree_method=hist` | `max_depth=3, min_child_weight=1, reg_lambda=1.0` | 0.1398 | runner-up |

Selection rule (`ml/evaluation/select.py:127` `rank_regression_candidates`,
`:146` `select_regression_champion`): val RMSLE primary, RMSE then R² tie-break.
Top-2 gap: **paired bootstrap**, 2000 row-level val resamples, seed 42
(`select.py:172` `paired_bootstrap_rmsle_diff`) — ridge vs xgboost diff −0.0043,
95% CI [−0.0133, +0.0060], P(runner-up better)=0.19, **not significant**
(`models/champion.json:28-39`). Val metrics per model incl. MAE/RMSE/R²/RMSLE/rmse_log
+ `residual_interval` (Q10/Q90 of val log residuals): `models/regression/metrics.json`.

### Classification — target `sells_within_30_days` (SIMULATED, ADR-3); `ml/training/train_classification.py`

CV: `StratifiedKFold(5, shuffle, seed=42)`, scoring `average_precision` (PR-AUC — primary
metric for the ~25% positive rate), `GridSearchCV(n_jobs=1)` (line 220 — deliberately
single-threaded to avoid nested joblib spawn storms on Windows). Imbalance-aware:
`class_weight="balanced"` for sklearn models, `scale_pos_weight=neg/pos` for XGBoost
(`candidate_grids`, line 144). Calibration: sigmoid `CalibratedClassifierCV(cv=5)` refit
on train (`fit_calibrated`, line 243); both raw (`{name}_v1.joblib`) and calibrated
(`{name}_calibrated_v1.joblib`) variants are persisted.

| Model | Grid | Shipped params | Val-cal PR-AUC / Brier | Track |
|-------|------|----------------|------------------------|-------|
| `logistic` | `C [0.1,1,10]`, `max_iter=2000` | `C=0.1` | 0.5089 / 0.1913 | candidate |
| `decision_tree` | `max_depth [3,5,8,12,None] × min_samples_leaf [1,5,10,20]` | `depth=8, leaf=10` | 0.4666 / 0.1973 | candidate |
| `random_forest` | `max_depth [None,12] × min_samples_leaf [1,5]`, `n_estimators=300` | `depth=12, leaf=5` | **0.5250 / 0.1856** | **CHAMPION (calibrated)** |
| `xgboost` | `n_estimators [200,400] × max_depth [3,5] × learning_rate [0.05,0.1]`, `eval_metric=aucpr` | `n_est=400, depth=5, lr=0.05` | 0.5032 / 0.1904 | candidate |

Selection rule (`select.py:245` `rank_classification_candidates`,
`:267` `select_classification_champion`): **calibrated** val PR-AUC primary + Brier sanity
(`BRIER_SANITY_TOLERANCE=0.01`, line 67). Operating threshold: F1-maximizing on val
calibrated probabilities (`select.py:324` `pick_f1_threshold`) → **0.2033** (not 0.5).
Champion val @ threshold: ROC-AUC 0.7218, PR-AUC 0.5250, F1 0.5455, P 0.4091, R 0.8182,
Brier 0.1856; test: ROC-AUC 0.7666, PR-AUC 0.5674 (champion.json:41-76).

### Clustering — `ml/clustering/train.py` (ADR-9)

**DBSCAN only** (no KMeans). Input: 25-row neighborhood matrix `[lat, long,
median_price_per_sqft, monthly_sale_velocity]` (`ml/clustering/dataset.py:40`
`FEATURE_COLUMNS`, `build_neighborhood_matrix` line 68), `StandardScaler`, then
`select_dbscan_params` (train.py:212): k-distance knee heuristic (`k_distance_curve`
line 161, `knee_index` line 176) over `min_samples ∈ {2,3}`, valid = 3–10 clusters
(`MIN_CLUSTERS/MAX_CLUSTERS`, lines 100-101), grid-refinement fallback over k-distance
rungs. Result on ames-1.0: `eps=1.317, min_samples=2` → **4 clusters + 3 noise
neighborhoods** (CollgCr, NAmes, Timber). Cluster labels = price tier (tertiles of
median $/sqft) + compass direction vs downtown (42.0347, −93.6199)
(`build_cluster_stats`, line 318). Serving: `MicroMarketLookup`
(`ml/clustering/serve.py:45`) — direct assignment, nearest-scaled-centroid fallback for
noise/unknown neighborhoods.

### Persisted artifacts (`models/`)

- `regression/`: `{linear,ridge,lasso,random_forest,xgboost}_v1.joblib` (21 KB linear
  family … 25 MB RF) + `metrics.json`.
- `classification/`: `{logistic,decision_tree,random_forest,xgboost}_v1.joblib` +
  `{...}_calibrated_v1.joblib` + `metrics.json`.
- `registry/`: `regression_champion.joblib` (= ridge_v1, 21 KB),
  `classification_champion.joblib` (= random_forest_calibrated_v1, 14.6 MB).
  Promotion: `ml/evaluation/evaluate.py:151` `copy_champions_to_registry` (plain file copy).
- `champion.json`: names, versions, val+test metrics, `regression.residual_interval`
  {q_low −0.1410, q_high 0.1166}, `classification.threshold` 0.2033, bootstrap block,
  clustering ref, `dataset_version`/`feature_version`, human rationale.
- `clustering/`: `dbscan.joblib`, `dbscan_scaler.joblib`, `cluster_stats.json`
  (per-cluster label/neighborhoods/n_sales/median_price/median_price_per_sqft/
  sale_velocity_30d/centroid + n_clusters/eps/min_samples/feature_names),
  `cluster_assignments.csv` (25 rows).
- `feature_list.json` (94 features + sha1), `feature_defaults.json` (79 raw-input
  defaults, train mode/median), `neighborhood_stats.json` (25 neighborhoods, 4 stats
  each + global fallback; n_train_rows=945, n_months=36).
- `explainability/`: `feature_importance.json` (94 base features, mean |SHAP| desc),
  `shap_values_sample.npz` (`shap_values` (200,94), `feature_names`, `expected_value`,
  `val_ids`), `shap_bar.png`, `shap_summary.png`.
- `monitoring/`: `reference_stats.json` (53 numeric PSI specs + 4 categorical frequency
  tables, n_rows=945, n_bins=10), `prediction_reference.json` (decile bins of champion
  val predictions: price $58.2k–$559.2k mean $180.4k; probabilities + threshold).
- `comps/comps.json`: 945 slim sales (13 fields incl. `cluster`; `days_on_market`/
  `sells_within_30_days` explicitly forbidden, build.py:77), similarity scales,
  sale window 2006-01..2008-12.

---

## 3. EVALUATION MACHINERY

**Metric functions** (all pure, array-in/dict-out):

- `ml/training/common.py:60` `regression_metrics(y_true, y_pred)` — dollar-scale MAE, RMSE, R², RMSLE (pass `expm1`'d values).
- `ml/training/common.py:74` `residual_interval(y_true_log, y_pred_log, q_low=0.1, q_high=0.9)` — additive log-space ~80% interval.
- `ml/training/train_regression.py:122` `_val_report` — adds `rmse_log` + interval (currently private; trivially reusable logic).
- `ml/training/train_classification.py:254` `classification_metrics(y_true, proba, threshold=0.5)` — ROC-AUC, PR-AUC, precision/recall/F1 @ threshold, Brier, labelled confusion matrix {tn,fp,fn,tp}.
- `ml/evaluation/evaluate.py:114` `interval_coverage(y_true_log, pred_log, interval)` — empirical interval coverage.
- `ml/evaluation/select.py:324` `pick_f1_threshold(y_true, proba)` — F1-optimal threshold + its P/R.
- `ml/evaluation/select.py:172` `paired_bootstrap_rmsle_diff(...)` — 95% CI for champion-vs-runner-up RMSLE gap.

**Persisted vs computable:**

- Persisted: per-model val metric bundles (`models/*/metrics.json`), champion val+test
  metrics + confusion-matrix counts (`champion.json`), SHAP importance + 200-row sample
  matrix, calibration/ROC-PR figures (`figures/classification_calibration.png`,
  `classification_curves.png` — PNG only, generated by `train_classification.py:283`
  `plot_calibration_curves` / `:315` `plot_best_model_curves`).
- **Not persisted but cheaply computable**: actual-vs-predicted arrays, residual vectors,
  ROC/PR/calibration curve *points* — every candidate joblib + processed split is on disk;
  pattern: `joblib.load(models/regression/{name}_v1.joblib).predict(X)` with
  `X` from `ml/evaluation/evaluate.py:87` `load_eval_frame(split)` (returns
  `(feature_frame_in_MODEL_FEATURES_order, raw_frame)` — the canonical eval loader).
  Raw arrays are also embedded in `shap_values_sample.npz` (200 val rows, ids included).

**Explainability (SHAP):**

- `ml/explainability/explainer.py:116` `RegressionExplainer(model_path=registry/regression_champion.joblib, background_size=200, seed=42)` — auto-selects `shap.LinearExplainer` (linear champs) vs `shap.TreeExplainer` (tree); background = 200 transformed train rows; **aggregates one-hot dummy SHAP values back to base features** (`aggregate_shap` line 87, `parse_base_name` line 61). `.explain(feature_frame) -> (n,94) array in log1p units`, `.explain_one(row) -> {feature: shap}`.
- Global artifacts: `ml/explainability/build_artifacts.py:165` `build_artifacts()` → `feature_importance.json`, `shap_values_sample.npz`, both PNGs. Top-5 by mean |SHAP|: OverallQual 0.057, OverallCond 0.041, total_sf 0.030, GrLivArea 0.026, 1stFlrSF 0.021.
- Local/serving: `ml/explainability/service.py:64` `explain_instance(feature_row, top_n=5)` → `[{"feature","impact","magnitude"}]` — process-wide lazy singleton (line 50), warm call ~22–45 ms.

No classification explainability exists (SHAP is regression-champion only).

---

## 4. DATA FACTS

- **Raw**: `data/raw/ames/train.csv` = 1460×81 (80 predictors + `SalePrice`); all splits
  derive from this file only. Kaggle `test.csv` (1459×80, no target) is never used.
- **Processed** (`data/processed/`, written by `run_pipeline`): **train 945×85**,
  **val 338×85**, **test 175×85** (85 = 81 raw + `lat`,`long`,`days_on_market`,
  `sells_within_30_days`). Zero NaNs by contract; absent features stored as literal
  `"None"` → always read with `keep_default_na=False` (`ml/training/common.py:22`).
  Split rule: time-based (ADR-4). Train lost 2 rows to the partial-sale outlier rule
  (`data/processed/outliers_report.json`).
- **Targets**: regression = `SalePrice` (models train on `log1p(SalePrice)`, ADR-10).
  Classification = **`sells_within_30_days` = `days_on_market <= 30`**
  (`ml/data/sale_speed.py:283`, threshold const at line 38). `days_on_market` is
  **SIMULATED** (`SaleSpeedSimulator.transform`, sale_speed.py:100):
  `log(days) = log(45) + 0.9·log(SalePrice/nbhd_median[train], clipped 0.5–2)
  − 0.06·(OverallQual−5) − 0.04·(OverallCond−5) + season(MoSold) + N(0,0.35)`
  with per-row noise seeded by `(42, Id)`; result clipped to [1,365]. Fit on train
  medians only (line 82). Positive rates: train 25.3%, val 29.3%, test 28.0%;
  median DOM 41/39/37 days. Real-DOM drop-in: `RealDomProvider` + `DOM_PROVIDER=csv`.
- **Features**: 94 `MODEL_FEATURES` (`ml/features/pipeline.py:195`) = 79 raw inputs
  (`RAW_INPUT_COLUMNS`, line 88 — `Id`, `SalePrice`, both targets, `SaleType`,
  `SaleCondition` excluded, line 78) + 11 engineered (`ENGINEERED_FEATURES`, line 172:
  property_age, years_since_remod, total_bath, living_area_per_bedroom,
  bathroom_bedroom_ratio, total_sf, sale_month/quarter/year,
  distance_to_city_center_km, amenity_count) + 4 train-only neighborhood aggregates
  (`NEIGHBORHOOD_STAT_FEATURES`, line 187: median/mean price, median $/sqft,
  monthly_sale_velocity — `ml/features/stats.py:117`).
- **Geo**: `data/external/neighborhood_geo.csv` = 25 rows × 5 cols
  (`Neighborhood,name,lat,long,note`) — approximate centroids from Barbour & Fragkias
  (Data in Brief 2025), Ames bbox lat 41.98–42.09 / long −93.72…−93.55
  (`ml/data/validate.py:123`). Optional per-property override hook:
  `data/external/property_geo.csv` (absent by default; `ml/features/pipeline.py:211`).
- **Canonical metrics/training facts**: `reports/MODEL_EVALUATION.md` (generated by
  `run_evaluation`; methodology §1, val/test tables §2–5, interval method §8) and
  `reports/PERFORMANCE.md` (serving latencies; see §6 below).

---

## 5. REUSE PLAN RAW MATERIAL — per workflow stage

| Workflow stage | Existing machinery | Status |
|---|---|---|
| **1. Upload dataset** | `validate_raw` (ml/data/validate.py:182) can validate any Ames-schema CSV in memory; `load_raw_train` accepts a `path` argument (ingest.py:22). No upload/store/version machinery, no support for non-Ames schemas. | **MISSING — must be built** (upload endpoint + storage); validation reusable as-is for Ames-schema uploads. |
| **2. Analyse features** | Schema metadata: `EXPECTED_CATEGORIES` (validate.py:47), `NUMERIC_RANGES` (validate.py:100), `schema.json` (per-column dtypes + category sets, on disk); feature roles: `RAW_INPUT_COLUMNS` / `ENGINEERED_FEATURES` / `NEIGHBORHOOD_STAT_FEATURES` / `MODEL_FEATURES` (ml/features/pipeline.py:88-195); numeric-vs-categorical split logic in `build_preprocessor` (common.py:40-41). | **PARTIAL** — metadata exists; no per-feature profile function (dtype, cardinality, uniques) — thin wrapper to build. |
| **3. Descriptive stats** | `_aggregate` (ml/features/stats.py:104) for price/velocity aggregates; `decile_profile` (ml/evaluation/evaluate.py:127) for quantile binning; neighborhood rollups on disk (`neighborhood_stats.json`). No general describe/summary module. | **MISSING — must be built** (pandas `describe`/`value_counts` wrappers over a loaded split; trivial). |
| **4. Missing values** | Policy tables: `NA_ABSENT_CATEGORICAL` / `NA_ABSENT_NUMERIC` (clean.py:32,51); `apply_cleaner` guarantees zero-NaN output or raises (clean.py:144-147); missingness figure exists in EDA (`figures/12_missingness_raw.png`, generated inline in `notebooks/build_01_eda.py`, not a reusable function). | **MISSING as a function** — per-column NA counts on raw/uploaded data = `df.isna().sum()` + the clean.py policy tables for the "action taken" narrative. |
| **5. Visualization data** | Reusable aggregations: neighborhood stats JSON, `cluster_stats.json`, comps.json (per-sale slim records), `bin_proportions`/`psi_bins_from_train` (ml/monitoring/psi.py:147,183) for histograms. EDA chart aggregations exist only inline in `notebooks/build_01_eda.py` (groupby patterns: neighborhood medians line 478, per-month lines 750-759, quality tables lines 351-354, bedrooms line 268, decade line 314, amenity line 390). | **PARTIAL** — binning + grouped aggregates reusable; per-chart API payloads must be built (the notebook script is the recipe catalog). |
| **6. Preprocessing (before/after preview)** | Full chain is callable on any frame: `fit_cleaner`/`apply_cleaner` (clean.py) → `attach_sale_speed` → `join_neighborhood_geo` → `build_feature_frame` (features/pipeline.py:410) → `build_preprocessor(...).fit_transform` (common.py:34). `serving_payload_to_raw` (features/serving.py:257) shows the single-row mapping. All fits are train-only and reusable on val/test/serving unchanged. | **EXISTS** — a preview endpoint = run raw rows through these and diff input vs output columns. |
| **7. Model training (candidates + comparison)** | `train_all()` regression (train_regression.py:200) & classification (train_classification.py:375); per-family trainers `_train_linear`/`_train_alpha_model`/`_train_randomized` and `tune_on_train`/`fit_calibrated` are importable and reusable on any `(X, y)`. `load_model_frame(split)` (train_regression.py:81) is the canonical (X, y_log, y_dollar) loader. | **EXISTS for the Ames pipeline** — but monolithic: fixed 5/4 candidate sets, fixed output paths, always all-or-nothing, always MLflow-logged. Parameterized "train subset of candidates on uploaded data" needs a thin refactor. |
| **8. Model evaluation (dashboards)** | All metric functions (§3), comparison tables in `models/*/metrics.json`, champion/bootstrap/threshold machinery in `ml/evaluation/select.py`, curve-plot functions `plot_calibration_curves`/`plot_best_model_curves` (train_classification.py:283,315), SHAP global/local (§3). | **EXISTS** — dashboard data = metrics.json + recomputed predictions via `load_eval_frame`. |
| **9. Predict** | Full serving chain live in the backend: payload → `serving_payload_to_raw` → `build_feature_frame` → champion pipelines (`backend/app/services/prediction_service.py`), residual-interval price range, thresholded probability, `explain_instance` top factors, `MicroMarketLookup` cluster, comps via `CompsService`. | **EXISTS** (already exposed as `/predict`, `/predict/price`, `/predict/sale-probability`, `/market/*`, `/model/*`). |

---

## 6. TRAINING COST (evidence: MLflow run wall-times in `mlruns/`, 2026-08-07)

Durations are full run wall-times (fit + CV + val eval + joblib dump + MLflow model
logging) read from run `meta.yaml` start/end. Machine caveat: ambient CPU 14–65% from
co-running agents during measurement (reports/PERFORMANCE.md:25).

| Wave | Model | Latest run | Observed range across re-runs |
|------|-------|-----------:|------------------------------|
| regression | linear | 13.9 s | 5–14 s |
| regression | ridge | 6.9 s | 4–7 s |
| regression | lasso | 6.3 s | 4–6 s |
| regression | random_forest | 4.7 s | ~5 s |
| regression | xgboost | 4.8 s | ~5 s |
| **regression total (5 models)** | | **≈ 35–45 s** | |
| classification | logistic | 43.2 s | 30–43 s |
| classification | decision_tree | 34.3 s | ~34 s |
| classification | random_forest | 52.4 s | ~52 s |
| classification | xgboost | 32.1 s | ~32 s |
| **classification total (4 models, incl. calibration)** | | **≈ 2.5–3 min** | |
| clustering (DBSCAN + figures) | | 0.2 s | |
| evaluation (selection + bootstrap + sealed test + report) | | 0.3 s | |
| SHAP explainer build (one-time) | | ≈ 3.9–4.6 s (PERFORMANCE.md:112) | + 200-row explain (seconds) |
| data pipeline (`run_pipeline`, 1460 rows) | | seconds (no persisted timing; all ops are small-frame pandas) | |

**API design implication**: single regression candidate (≤ ~15 s) is borderline
sync-feasible behind a loading state; a full comparison wave (35 s regression,
~3 min classification) must be a **background job** with polling/webhook. Warm
prediction is ~0.2–1.0 s (PERFORMANCE.md §post-fix: p50 ≈ 197 ms after the
`n_jobs=1` serving fix; SHAP warm ~30–45 ms).

---

## 7. GOTCHAS (concurrency / state / leakage)

**Global state & caches**

- `FEATURE_DEFAULTS` is loaded **at import time** into a module global
  (ml/features/defaults.py:122); `load_feature_defaults` is `lru_cache`d (line 89);
  `_geo_lookup` (features/pipeline.py:219) and `_property_geo_lookup` (line 298) are
  `lru_cache`d for the process lifetime — **regenerating artifacts on disk is not
  picked up by a running server**; restart required ("F1 stale-cache semantics",
  documented in the docstrings).
- `ml/explainability/service.py:50` keeps a process-wide explainer singleton
  (double-checked lock, thread-safe); first call costs ~4–5 s.
- The current backend loads every artifact once into `app.state` during lifespan
  (backend/app/main.py:159-208) and pins `n_jobs=1` on champions for serving
  (`force_single_threaded`, prediction_service.py:61). A workflow API that retrain
  models must decide how/whether to refresh this state (currently: restart).
- `ml.tracking` sets env `MLFLOW_ALLOW_FILE_STORE=true` at import (tracking.py:25);
  tracking URI = env override else `<repo>/mlruns` file store.

**Non-pure functions / file-path assumptions**

- Every trainer/pipeline stage reads and writes **fixed repo paths**
  (`data/processed/*.csv`, `models/**`, `figures/`, `reports/`) via `ml.paths`.
  `train_all()` (both) overwrites `{name}_v1.joblib` + `metrics.json` in place and
  appends MLflow runs — **two concurrent training runs will clobber each other's
  artifacts**; the clustering trainer already retries MLflow logging once after 30 s
  on shared-file-store lock errors (clustering/train.py:516-537). Workflow training
  jobs must be serialized (a lock/queue) or redirected to per-job output dirs (the
  trainers don't currently accept one; `run_pipeline(output_dir=...)` does,
  pipeline.py:135).
- `GridSearchCV`/`RandomizedSearchCV` in the regression trainer use `n_jobs=-1`
  (train_regression.py:158,191) and RF uses `n_jobs=-1` — a training job will saturate
  all cores and degrade co-located serving (this exact interference was observed:
  PERFORMANCE.md:71). The classification trainer deliberately uses `n_jobs=1` for the
  search (train_classification.py:220) because nested joblib pools spawn-storm on
  Windows. Plan: pin training jobs to a separate process/worker.
- `matplotlib.use("Agg")` is set at import in the plotting trainers — headless-safe.
- `load_split` requires the processed CSVs to exist (common.py:22) — any "train on
  uploaded dataset" flow must first produce a processed split through `run_pipeline`
  (or an equivalent), because features assume the processed schema (incl. `lat/long`,
  `Neighborhood` in the 25 known values for stats join; unseen neighborhoods fall back
  to global stats, so partial novelty is tolerated).
- `evaluate.run_evaluation` **reads the sealed test split** (evaluate.py:667) and
  rewrites `champion.json` + registry copies — it is a promotion ceremony, not a
  preview; do not wire it to an ad-hoc "evaluate my candidates" endpoint without
  forking its side-effecting steps (selection/report functions in `select.py` and the
  metric functions are side-effect-free and safe to reuse).

**Leakage safety (verified)**

- All fitted statistics are train-only: cleaner (clean.py:81), neighborhood stats
  (stats.py:117), feature defaults (defaults.py:51), DOM simulator (sale_speed.py:82),
  PSI reference (reference.py:78), comps (build.py:104). Outlier removal is train-only
  (outliers.py:39). Val/test/serving reuse fitted artifacts unchanged.
- The sklearn preprocessor is fit **inside** each Pipeline/CV fold (common.py:34) —
  no preprocessing leakage in CV.
- Champion selection, threshold and bootstrap use **val only**; the test split is read
  exactly once, after selection, inside `run_evaluation` (evaluate.py:629-701).
- Target-derived columns (`SalePrice`, `days_on_market`, `sells_within_30_days`,
  `SaleType`, `SaleCondition`, `Id`) are excluded from model inputs
  (features/pipeline.py:78). Note: the four `neighborhood_*` features are aggregated
  from train `SalePrice` — leakage-safe by the train-only fit, but they must be
  **refit** if the workflow trains on a new/uploaded dataset.
- Serving clamps calendar features to the train window (≤ 2008-12) to avoid
  extrapolation (`serving_payload_to_raw`, features/serving.py:257; clamp flag via
  `calendar_clamp_applied`, line 246).
- One documented exception to "categorical as string": `MSSubClass` round-trips to
  int64 through CSV and is treated as a scaled numeric everywhere (clean.py:135-142,
  schema.json declares this) — don't "fix" it in the workflow without invalidating
  the champions.

---

## Appendix — tests as executable API documentation

- `tests/ml/test_regression.py` — loads each candidate joblib, checks predict shape/range,
  metrics.json schema, and smoke-refits `LinearRegression` through `make_pipeline`
  on `train.head(200)` (the pattern for a "quick train" endpoint).
- `tests/ml/test_classification.py` — artifact/metrics contract, calibrated proba in
  [0,1], smoke refit of logistic through `build_preprocessor`.
- `tests/ml/test_evaluation.py` — selection rules on synthetic metrics, bootstrap
  reproducibility, champion.json schema, registry models predict, threshold recomputed
  from val matches champion.json.
- `tests/ml/test_clustering.py` — `build_neighborhood_matrix` shape (25×4),
  `MicroMarketLookup` direct/noise/unknown paths, persisted DBSCAN reproduces
  assignments.
- `tests/ml/test_explainability.py` — SHAP additivity (`shap.sum + expected_value ==
  prediction`), `explain_instance` contract, npz contents.
- `tests/ml/test_monitoring.py` (727 lines) — PSI math, reference build/load, drift
  report states.
- `tests/integration/test_end_to_end.py` — the canonical in-process serving chain
  (`serving_payload_to_raw` → `build_feature_frame` → registry champions) asserted
  equal to HTTP `/predict`; drift pipeline end-to-end.
- `tests/data/test_data_pipeline.py`, `tests/data/test_dom_adapter.py`,
  `tests/features/test_features.py`, `tests/features/test_geo_override.py` — pipeline,
  DOM provider, feature-frame determinism and geo-override contracts.
