# Data Leakage Audit — agent `leakage` (mission §7)

- **Date:** 2026-08-07 · **Mode:** report-only (no project source/config/doc files modified)
- **Method:** full static read of `ml/**` (features, data, training, evaluation, clustering,
  explainability, monitoring, serving) + targeted greps of `backend/**`, then executed
  recomputation of every fitted statistic/artifact against `data/processed/*.csv` and the raw
  Ames file, each paired with a **train+val counterfactual** to prove the check discriminates.
- **Evidence files:** `docs/audit/evidence/leakage-01…08-*.txt` (commands were
  `.venv/Scripts/python.exe` heredocs from repo root; full outputs pasted there).

## Verdict table

| # | Item | Verdict | Evidence |
|---|------|---------|----------|
| 1 | Target leakage: no model input derived from `SalePrice` / `days_on_market` / `sells_within_30_days`; per-row `price_per_sqft` not an input | **SAFE** — verified by execution + statically | `leakage-01-features-splits.txt`; `ml/features/pipeline.py:78-85,88-197,402-486` |
| 2 | Neighborhood stats fit on train only; serving uses the artifact | **SAFE** — verified by execution | `leakage-02-neighborhood-stats.txt`; `ml/features/stats.py:117-155`, `ml/features/pipeline.py:507-518`, `backend/app/main.py:102` |
| 3 | Split integrity: years disjoint (≤2008 / 2009 / 2010), no `Id` in two splits | **SAFE** — verified by execution | `leakage-01-features-splits.txt`; `ml/data/split.py:14-54` |
| 4 | Imputation: LotFrontage medians + FEATURE_DEFAULTS from train only | **SAFE** — verified by execution | `leakage-03-imputation.txt`, `leakage-04-feature-defaults.txt`; `ml/data/clean.py:81-103,106-144`, `ml/features/defaults.py:51-69` |
| 5 | Preprocessing fit inside CV folds only (no pre-fit scaler on full data) | **SAFE** — verified by execution + statically | `leakage-05-cv-pipeline.txt`; `ml/training/common.py:34-57`, `ml/training/train_regression.py:100-104,152-160`, `ml/training/train_classification.py:217-229` |
| 6 | Hyperparameter tuning used train only (no val in fit) | **SAFE** — verified by execution + statically | `leakage-05-cv-pipeline.txt`; `ml/training/train_regression.py:160,170,193`, `ml/training/train_classification.py:229,250` |
| 7 | Threshold 0.203292 selected on VAL, not test | **SAFE** — verified by execution (val recomputation reproduces it exactly; test would give a different value) | `leakage-06-threshold.txt`; `ml/evaluation/evaluate.py:649-651`, `ml/evaluation/select.py:324-371` |
| 8 | Champions chosen on val; test evaluated after selection | **SAFE** — statically verified (code order) + artifact structure | `ml/evaluation/evaluate.py:624-672`; `leakage-05-cv-pipeline.txt` (metrics.json val-only), `leakage-08-champion-shap-meta.txt` |
| 9 | Clustering stats from train only | **SAFE** — verified by execution | `leakage-07-cluster-monitoring-dom.txt`; `ml/clustering/dataset.py:85-107`, `ml/clustering/train.py:534` |
| 10 | SHAP background from train only | **SAFE** — statically verified + artifact metadata | `ml/explainability/explainer.py:176-183`; `leakage-08-champion-shap-meta.txt` |
| 11 | Monitoring reference from train only | **SAFE** for `reference_stats.json` (executed); **note:** `prediction_reference.json` is built from champion **val** predictions by design (not leakage — see below) | `leakage-07-cluster-monitoring-dom.txt`; `ml/monitoring/reference.py:84-86`, `ml/evaluation/evaluate.py:168-209,715-723` |
| 12 | DOM simulator leaks no val/test info into the target (fit on train stats only) | **SAFE** — verified by execution | `leakage-07-cluster-monitoring-dom.txt`; `ml/data/pipeline.py:117,149`, `ml/data/sale_speed.py:82-98` |

**No P0/P1/P2 findings. No leakage violations found.** Three P3 observations below.

## Per-item detail

### 1. Target leakage — SAFE
`MODEL_FEATURES` (94 features) executed-checked to contain none of `Id`, `SalePrice`,
`days_on_market`, `sells_within_30_days`, `SaleType`, `SaleCondition`, `price_per_sqft`;
`models/feature_list.json` matches `MODEL_FEATURES` exactly. `EXCLUDED_RAW_COLUMNS`
(`ml/features/pipeline.py:78-85`) strips the target, both simulated-target columns, the
identifier, and post-sale fields before any feature is built; `build_feature_frame`
(`pipeline.py:402-486`) derives every engineered feature from non-target raw columns only.
Per-row `price_per_sqft` is **not** a feature anywhere — the only name match is
`neighborhood_median_price_per_sqft`, a train-fit aggregate (see item 2).
**Disclosure:** the four `neighborhood_*` features *are* SalePrice-derived target encodings.
That is the SPEC §5 design; their safety rests entirely on train-only fitting, which item 2
proves byte-for-byte. They are the highest-leverage features in the model — if
`models/neighborhood_stats.json` were ever regenerated on full data, leakage would be silent.

### 2. Neighborhood stats — SAFE (executed)
Recomputed `fit_neighborhood_stats(train.csv)` and compared all 25 neighborhoods × 4 stats +
global fallback against `models/neighborhood_stats.json`: **0 mismatches** (tolerance 1e-9).
Counterfactual: the same fit on train+val changes **93** values (e.g. Blmngtn median_price
194,201 → 186,000), so the comparison genuinely discriminates. Artifact `n_train_rows`=945 =
actual train rows; `n_months`=36 matches train. Generation path reads only
`data/processed/train.csv` (`pipeline.py:510`). Serving never recomputes:
`build_feature_frame(stats=None)` loads the artifact (`pipeline.py:425-426`), backend lifespan
loads it once (`backend/app/main.py:102`), clustering serving loads it
(`ml/clustering/serve.py:88`).

### 3. Split integrity — SAFE (executed)
`data/processed/train.csv`: YrSold ∈ {2006,2007,2008}, n=945; val: all 2009, n=338; test: all
2010, n=175. Pairwise `Id` intersections all empty; union = 1458 = 945+338+175. Re-running the
raw split confirmed 1460 raw rows → 947/338/175, then the train-only outlier rule removes 2
rows → 945 (`leakage-03-imputation.txt`). `ml/data/split.py:41-48` itself hard-fails on any
overlap or row loss.

### 4. Imputation — SAFE (executed)
- **LotFrontage:** refit `fit_cleaner` on the raw train split (post-split, post-outlier-trim,
  exactly the pipeline order), applied to raw val, and compared all 338 val rows against
  `data/processed/val.csv`: **max |diff| = 0.0**. 65 val rows had raw LotFrontage NA; in 14 of
  their neighborhoods the val-own median differs from the train median (e.g. Gilbert 65.0
  train vs 71.0 val-own) — the processed values match the **train** medians, proving provenance.
  Global fallback 69.0 and `Electrical` mode `SBrkr` also train-fitted (`ml/data/clean.py:81-103`).
- **FEATURE_DEFAULTS:** all **79/79** entries of `models/feature_defaults.json` match
  `compute_feature_defaults(train.csv)` exactly; 10 entries would change under train+val
  (e.g. `YearBuilt` median 1972 → 1973), proving the artifact is train-only.

### 5. Preprocessing inside CV — SAFE
`build_preprocessor` (`ml/training/common.py:34-57`) is only ever instantiated as a step of
the sklearn `Pipeline` handed to `GridSearchCV`/`RandomizedSearchCV`, so imputers/scalers/
one-hot are refit per fold. Repository-wide grep for `.fit(`/`StandardScaler`/`SimpleImputer`
in `ml/` shows no standalone pre-fit transformer on full data (the only other
`StandardScaler().fit` is clustering's, fit on the 25-row neighborhood matrix built from the
train-only stats artifact — `ml/clustering/train.py:526`). Executed: both registry champions
loaded via joblib are self-contained (`preprocess` ColumnTransformer + model; classification
champion is `CalibratedClassifierCV` wrapping the same pipeline).

### 6. Hyperparameter tuning train-only — SAFE
Every search/calibration `.fit` call takes train data only: regression
`train_regression.py:160,193` (GridSearchCV/RandomizedSearchCV, 5-fold KFold seed 42) and
final refits `:140,170`; classification `train_classification.py:229` (StratifiedKFold,
average_precision) and calibration `:250`. Val frames are used exclusively for metric
computation. Executed corroboration: `models/regression/metrics.json` and
`models/classification/metrics.json` contain **only** `val` / `val_calibrated` keys — no test
metrics exist from the training wave.

### 7. Threshold selection — SAFE (executed, decisive)
`champion.json` stores `classification.threshold = 0.203292`. Recomputed
`pick_f1_threshold` on **val** probabilities from the registry champion: **0.203292 exactly**
(F1 0.5455, P 0.4091, R 0.8182). Counterfactual on **test**: max-F1 threshold would be
**0.258531** (F1 0.6066) — a different value, and test F1 at the shipped threshold is only
0.5063. If test had been used for selection, the shipped threshold would be 0.258531; it is
not. Code order: `pick_f1_threshold(y_val_cls, proba_val)` at `ml/evaluation/evaluate.py:650`,
before the test split is first read at `:657`.

### 8. Model selection ordering — SAFE (statically verified)
`run_evaluation` (`ml/evaluation/evaluate.py:619-672`) executes in this order: (1) load
training-wave metrics.json files (verified val-only, item 6) and select champions via
`select_regression_champion` / `select_classification_champion` (`:627-628`); (2) val
predictions for bootstrap + threshold (`:630-651`); (3) registry promotion (`:654`); (4)
**first and only** test read (`:657`) for the final report. The all-candidates test table is
computed after selection and labelled "FINAL REPORT ONLY" (`:674-691`).
`champion.json` corroborates: val_metrics + val bootstrap (2000 resamples, seed 42, CI
[−0.013336, 0.005985], not significant) recorded as the selection basis.

### 9. Clustering — SAFE (executed)
The DBSCAN feature matrix joins geo centroids with the train-only stats artifact
(`ml/clustering/dataset.py:85-107`); descriptive cluster stats use `load_split("train")`
(`ml/clustering/train.py:534`). Executed: recomputed `n_sales`, `median_price`,
`median_price_per_sqft`, `sale_velocity_30d` from train.csv for all 4 clusters — **0
mismatches**; all 4 clusters' stats would change if val rows were included. Note:
`sale_velocity_30d` consumes the simulated target, but train rows only, and the field is
descriptive (never a model input — stated in each cluster's `note`).

### 10. SHAP background — SAFE (static + metadata)
`RegressionExplainer.__init__` builds the background from `load_split("train")` →
`build_feature_frame` → `.sample(n=200, random_state=42)` (`ml/explainability/explainer.py:176-183`).
Artifact metadata agrees: `background_split: "train"`, `background_size: 200`, `seed: 42`.
(The SHAP *values* in `feature_importance.json` are computed over 200 val rows — explaining
held-out data, not fitting anything; no leakage.)

### 11. Monitoring reference — SAFE, with one clarification
`reference_stats.json` (feature drift baseline): payload declares `split: "train"`,
`n_rows: 945`; executed recomputation of PSI bin edges + expected proportions from train.csv
matches exactly for spot-checked features (`GrLivArea`, `OverallQual`), and GrLivArea edges
differ under a train+val recomputation (e.g. 1061.6 → 1072.0). Built at
`ml/monitoring/reference.py:84-86` from train only; `drift_check.py:256` only ever *loads* it.
**Clarification (P3):** the second monitoring artifact, `prediction_reference.json`, is built
from champion **val** predictions (`generated_from: data/processed/val.csv`, n_rows=338 —
`ml/evaluation/evaluate.py:168-209,715-723`). This is not leakage — val predictions of a
train-fitted model are legitimately available post-training and nothing flows back into any
fit — but any doc claiming "monitoring references are train-only" is imprecise for this one
artifact.

### 12. DOM simulation — SAFE (executed)
`SaleSpeedSimulator.fit` computes neighborhood median SalePrice + global median from the
train split only, called with `splits["train"]` (`ml/data/pipeline.py:117,149`;
`ml/data/sale_speed.py:82-91`); per-row noise is seeded by `(seed, Id)` — no cross-row or
cross-split information. Executed: a simulator refit on processed train.csv reproduces
`days_on_market` **exactly** for train (945/945) and val (338/338); a train+val-fit simulator
changes 147/338 val values — so the shipped targets provably encode train-only statistics.
`sells_within_30_days == (days_on_market <= 30)` holds on all three splits.
**Observation (P3, disclosed design):** the simulated target's pricing term uses each row's
*own* SalePrice (ADR-3's acknowledged simplification). Models never see SalePrice, but the
target is partially recoverable from price-correlated features (including the train-fit
`neighborhood_median_price*`). That inflates classification metrics relative to any real DOM
target — the codebase labels this SIMULATED everywhere; this audit confirms the labelling is
accurate and the simulation itself is leak-free across splits.

## Findings

| Severity | Location | Description | Evidence |
|----------|----------|-------------|----------|
| P3 | `ml/data/pipeline.py:130` | Docstring example row counts (`train: 942`) stale vs actual 945 (947 − 2 outliers) | `leakage-03-imputation.txt` |
| P3 | `models/monitoring/prediction_reference.json` / `ml/evaluation/evaluate.py:189` | Prediction-drift reference is val-based, not train-based — fine for leakage, but reconcile with any "train-only reference" wording (SPEC §10 / docs) | `leakage-07-cluster-monitoring-dom.txt` |
| P3 | `ml/data/sale_speed.py:63-66,107-108` | Simulated target is a partial function of the row's own SalePrice → classification metrics measure rule-recovery, not market reality. Disclosed (ADR-3) and leak-free across splits; restated for the final report | `leakage-07-cluster-monitoring-dom.txt` |

## Coverage

- **Files read in full (line-by-line):** `ml/features/pipeline.py`, `ml/features/stats.py`,
  `ml/features/defaults.py`, `ml/features/serving.py`, `ml/data/split.py`, `ml/data/clean.py`,
  `ml/data/pipeline.py`, `ml/data/sale_speed.py`, `ml/data/outliers.py`, `ml/data/ingest.py`,
  `ml/training/common.py`, `ml/training/train_regression.py`, `ml/training/train_classification.py`,
  `ml/evaluation/select.py`, `ml/evaluation/evaluate.py`, `ml/clustering/train.py`,
  `ml/clustering/dataset.py`, `ml/explainability/build_artifacts.py`,
  `ml/explainability/explainer.py`, `ml/monitoring/reference.py`.
- **Targeted greps:** `backend/**` (SalePrice/target usage, groupby/median recomputation →
  none; artifact loads only), `ml/**` for `.fit(`/`pd.concat`/`test.csv` (no cross-split
  fitting; only `evaluate.py` reads processed test.csv).
- **Executed verifications:** 8 evidence files (`leakage-01…08`), each pairing a train-only
  recomputation against the shipped artifact **and** a train+val counterfactual proving the
  test discriminates. Artifacts verified byte/value-exact: `neighborhood_stats.json`,
  `feature_defaults.json`, `feature_list.json`, `cluster_stats.json`, `reference_stats.json`,
  `champion.json` (threshold), processed `val.csv` LotFrontage, processed `days_on_market`
  (train+val), both registry champion joblibs (structure).
- **Not verified / out of scope:** EDA notebook script (`notebooks/build_01_eda.py`) — EDA
  figures only, no model inputs (its own header states test is sealed). MLflow run contents
  beyond params visible in artifacts. File timestamps were not used as evidence (code order +
  artifact contents are stronger).

## Contradictions for the orchestrator

- None with previous QA's PASS verdicts — this audit independently confirms them for §7.
- Reconcile item-11 wording anywhere docs say the monitoring reference is "train-only": the
  feature reference is train-only (proven); the prediction reference is intentionally
  val-based. Not a defect, but the docs should say which is which.
- `ml/data/pipeline.py:130` docstring example (`942`) disagrees with SPEC §14's binding
  `945` — SPEC is correct; the docstring is stale (also flagged to llba-data territory).
