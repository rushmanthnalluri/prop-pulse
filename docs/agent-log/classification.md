# Agent Log — classification

**Scope:** `ml/training/train_classification.py`, `tests/ml/test_classification.py`,
`models/classification/`, `figures/classification_calibration.png`,
`figures/classification_curves.png`, MLflow experiment `classification`.
Status: **complete**, all 7 tests green.

> **SIMULATED TARGET (ADR-3):** `sells_within_30_days` comes from the seeded
> days-on-market simulation in `ml/data/sale_speed.py`. Every metric below is
> pipeline-validation evidence, **not a real-world performance claim**.

## What was built (SPEC §6/§7)

- `ml/training/train_classification.py` — CLI: `.venv/Scripts/python.exe -m ml.training.train_classification`.
  - Data path identical to regression: `common.load_split("train"/"val")`
    (test never read), `build_feature_frame(df, stats)` with the persisted
    train-fit `models/neighborhood_stats.json`, subset to the 94 features of
    `models/feature_list.json` (asserted in sync with `MODEL_FEATURES`).
  - Train positive rate 0.2529 → imbalance-aware estimators:
    `class_weight="balanced"` (logistic / decision tree / random forest),
    `scale_pos_weight = 2.954` (XGBoost).
  - `build_preprocessor` inside each `Pipeline` → saved joblibs are
    self-contained (accept the raw feature frame).
  - Tuning: `GridSearchCV`, 5-fold stratified CV **on train only**,
    `scoring="average_precision"`. Grids: logistic `C ∈ {0.1, 1, 10}`;
    decision tree `max_depth ∈ {3,5,8,12,None}` × `min_samples_leaf ∈
    {1,5,10,20}`; random forest `n_estimators=300, n_jobs=-1`,
    `max_depth ∈ {None,12}` × `min_samples_leaf ∈ {1,5}`; XGBoost
    `tree_method="hist"`, `n_estimators ∈ {200,400}` × `max_depth ∈ {3,5}` ×
    `learning_rate ∈ {0.05,0.1}`.
  - Calibration: sigmoid `CalibratedClassifierCV(cv=5)` refit of each tuned
    pipeline on train. Both variants persisted:
    `models/classification/{name}_v1.joblib` + `{name}_calibrated_v1.joblib`
    (8 joblibs total).
  - Val-only evaluation: ROC-AUC, PR-AUC (average precision),
    precision/recall/F1 @ 0.5, Brier, confusion matrix — raw and calibrated —
    in `models/classification/metrics.json`
    (`{model: {val, val_calibrated, best_params}}`).
  - Figures: `figures/classification_calibration.png` (all 4 calibrated models
    + perfect line) and `figures/classification_curves.png` (ROC + PR for
    random_forest, best calibrated PR-AUC). Both titles carry the
    SIMULATED-target label.
  - **No test-split access, no champion selection** (owned by the evaluation
    wave).

## Validation metrics (val split, n=338, prevalence 0.293) — SIMULATED target

| model | variant | ROC-AUC | PR-AUC | P@0.5 | R@0.5 | F1@0.5 | Brier |
|---|---|---|---|---|---|---|---|
| logistic | raw | 0.6956 | 0.5047 | 0.456 | 0.414 | 0.434 | 0.1983 |
| logistic | calibrated | 0.6996 | 0.5089 | 0.800 | 0.040 | 0.077 | 0.1913 |
| decision_tree | raw | 0.6006 | 0.3689 | 0.324 | 0.455 | 0.378 | 0.2741 |
| decision_tree | calibrated | 0.7013 | 0.4666 | 0.000 | 0.000 | 0.000 | 0.1973 |
| random_forest | raw | 0.7292 | 0.5368 | 0.466 | 0.414 | 0.439 | 0.1935 |
| random_forest | calibrated | 0.7218 | 0.5250 | 0.889 | 0.081 | 0.148 | 0.1856 |
| xgboost | raw | 0.7255 | 0.5148 | 0.557 | 0.343 | 0.425 | 0.1942 |
| xgboost | calibrated | 0.7187 | 0.5032 | 0.727 | 0.081 | 0.145 | 0.1904 |

Best params: logistic `C=0.1`; decision_tree `max_depth=8, min_samples_leaf=10`;
random_forest `max_depth=12, min_samples_leaf=5`; xgboost
`learning_rate=0.05, max_depth=5, n_estimators=400`.

Reading for the champion agent: calibration improved Brier for every model
(e.g. decision_tree 0.274 → 0.197). Calibrated probabilities sit near the true
prevalence, so threshold-0.5 recall on calibrated variants is near zero —
**threshold selection must happen at serving/champion time**, not assumed 0.5.
Raw PR-AUC leader: random_forest (0.5368); calibrated PR-AUC leader:
random_forest (0.5250); calibrated Brier leader: random_forest (0.1856).

## MLflow (experiment `classification`)

4 FINISHED runs (`{name}_v1`), each logging: best params + CV score, all val +
val_calibrated metrics, tags `dataset_version=ames-1.0`,
`feature_version=9b0f8ba4201c`, `target=sells_within_30_days`,
`simulated_target=true (ADR-3)`, per-run metrics JSON artifact, and both
fitted pipelines as MLflow LoggedModels (`model`, `model_calibrated`;
MLflow 3.x stores these under `mlruns/<exp>/models/`, not as run artifacts).

### MLflow 3.15.1 issues the lead/orchestrator should know about

1. **File store is blocked by default**: `mlflow.set_experiment` raises
   unless `MLFLOW_ALLOW_FILE_STORE=true`. `train_classification.py` sets it via
   `os.environ.setdefault` at import (ml/tracking.py is lead-owned, untouched).
2. **`ml.tracking.log_model_artifact` is broken for every sklearn pipeline**
   under mlflow 3.15: the skops-based flavor save raises
   "untrusted types … ['numpy.dtype']" (plus
   `sklearn.calibration._CalibratedClassifier`,
   `sklearn.calibration._SigmoidCalibration`,
   `sklearn.model_selection._split.StratifiedKFold`,
   `xgboost.sklearn.XGBClassifier`, `xgboost.core.Booster` for my models).
   The trainer therefore logs via a local `_log_sklearn_model` helper that
   passes a verified `skops_trusted_types` list (all first-party types, probed
   against all 4 model families raw + calibrated). Recommend patching
   `ml/tracking.py::log_model_artifact` with a `skops_trusted_types`
   passthrough — any other agent using it will hit the same crash.
3. Deleted experiments cannot be recreated by name
   ("Cannot set a deleted experiment") — probe-experiment names must be unique.

## Tests

`tests/ml/test_classification.py` — **7 passed in 3.63s**
(`.venv/Scripts/python.exe -m pytest tests/ml/test_classification.py -q`):
artifact existence/load (8 joblibs), figures exist, calibrated
`predict_proba ∈ [0,1]` on a 5-row frame, metrics.json completeness
(metric keys, ranges, confusion sums = 338), calibrated Brier < 0.25,
calibration-not-worse-than-raw Brier (+0.02 slack), smoke re-fit of
LogisticRegression on `train.head(200)` through `build_preprocessor`.

## Files touched

- `ml/training/train_classification.py` (new)
- `tests/ml/test_classification.py` (new)
- `models/classification/` (8 joblibs + `metrics.json`)
- `figures/classification_calibration.png`, `figures/classification_curves.png`
- MLflow experiment `classification` (4 runs, 8 LoggedModels; orphans from two
  crashed pre-fix attempts soft-deleted)
