# Agent Log — regression

**Scope owned:** `ml/training/train_regression.py`, `models/regression/`, `tests/ml/test_regression.py`.

## What was built

`ml/training/train_regression.py` (CLI: `python -m ml.training.train_regression`):

- Loads `train`/`val` via `ml.training.common.load_split`; features via
  `build_feature_frame(df, stats=load_neighborhood_stats())`, columns reordered to
  `models/feature_list.json` MODEL_FEATURES (94). Target = `log1p(SalePrice)` (ADR-10).
- Every model = one self-contained sklearn Pipeline
  (`ml.training.common.build_preprocessor` + estimator) → one joblib per model.
- Tuning on TRAIN ONLY, 5-fold `KFold(shuffle, seed 42)`, scoring = neg-RMSE on the
  log target (= log-space RMSE):
  - Ridge/Lasso: `GridSearchCV` over 13 log-spaced alphas; **one-standard-error rule**
    picks the strongest alpha within 1 SE of the best mean score.
  - RandomForest / XGBoost: `RandomizedSearchCV`, `n_iter=8`, seed 42
    (RF: max_depth/min_samples_leaf/max_features, 300 trees, n_jobs=-1;
    XGB: max_depth/min_child_weight/reg_lambda, 500 trees, lr 0.05, subsample 0.8,
    colsample_bytree 0.8, `tree_method='hist'`).
- Val evaluation per model: dollar-scale MAE/RMSE/R²/RMSLE (expm1) via
  `regression_metrics`, log-space RMSE, and `residual_interval` (log-space q10/q90
  of val residuals — serving's price range).
- One MLflow run per model in experiment `regression` (`{name}_v1`), params +
  `val_*` metrics + fitted pipeline artifact; tagged with
  `feature_version` (sha1 of `models/feature_list.json`).
- **test.csv never touched. No champion selected** (evaluation agent owns it).

## Results (VAL split, 338 rows)

| model | MAE ($) | RMSE ($) | R² | RMSLE | RMSE_log | residual interval (q10,q90) | best_params | cv log-RMSE |
|---|---|---|---|---|---|---|---|---|
| linear | 15,888 | 22,809 | 0.9202 | 0.1425 | 0.1425 | (-0.1449, 0.1212) | {} | — |
| ridge | 14,527 | 21,673 | 0.9280 | 0.1354 | 0.1354 | (-0.1410, 0.1166) | alpha=100.0 (1-SE; grid best 31.6) | 0.1106 |
| lasso | 15,355 | 23,298 | 0.9168 | 0.1407 | 0.1407 | (-0.1603, 0.1162) | alpha=0.00464 (1-SE; grid best 0.000464) | 0.1148 |
| random_forest | 18,279 | 27,698 | 0.8824 | 0.1590 | 0.1590 | (-0.1782, 0.1400) | max_depth=20, max_features=0.5, min_samples_leaf=1 | 0.1304 |
| xgboost | 15,461 | 23,460 | 0.9156 | 0.1398 | 0.1398 | (-0.1457, 0.1268) | max_depth=3, min_child_weight=1, reg_lambda=1.0 | 0.1131 |

RMSLE == RMSE_log by construction (RMSLE of expm1'd values = RMSE in log1p space).
Total wall time ≈ 80 s (well under the 10-min budget).

Artifacts: `models/regression/{linear,ridge,lasso,random_forest,xgboost}_v1.joblib`
+ `models/regression/metrics.json`.

## Environment gotchas discovered (affect all training/serving agents)

1. **mlflow 3.15.1 rejects the file store by default** — set env
   `MLFLOW_ALLOW_FILE_STORE=true` or `track_run` raises
   ("filesystem tracking backend is in maintenance mode").
2. **mlflow 3.15.1's sklearn flavor defaults to `serialization_format='skops'`**,
   which fails on fitted sklearn pipelines (`UntrustedTypesFoundException:
   numpy.dtype`). Workaround used here: `mlflow.sklearn.log_model(...,
   serialization_format="cloudpickle")` called directly from
   `train_regression.py` (lead-owned `ml/tracking.py::log_model_artifact` left
   unchanged, but it will hit the skops error as-is).

## Verification

- Training run: real end-to-end, all 5 models, exit 0 (log excerpt above).
- `pytest tests/ml/test_regression.py -q` → **5 passed in 2.15s**
  (artifacts exist/load; each pipeline predicts shape (5,) finite values on a 5-row
  val feature frame; metrics.json has all 5 models with finite RMSLE + sane interval;
  LinearRegression smoke re-train on train head(200) round-trips through
  `build_preprocessor`).
- MLflow `regression` experiment contains all 5 runs with metrics + artifacts.
  (One duplicate `linear_v1` run remains from a first attempt that crashed
  mid-logging before the fixes above; harmless, file store append-only.)

## Not done / handoff notes

- No champion picked, no test-set evaluation — evaluation agent's job.
- `metrics.json` is the single input the champion-selection step needs
  (RMSLE primary per SPEC §6; note ridge's 1-SE alpha makes it the most
  regularized near-best linear model).
