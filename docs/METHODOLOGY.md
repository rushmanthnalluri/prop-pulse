# PropPulse — ML Methodology

This document describes how the models were built and evaluated, and where
the honest limits are. It expands on `reports/MODEL_EVALUATION.md` (the
numbers) and `docs/DECISIONS.md` (the ADRs); those two remain the binding
sources for any figure quoted here.

Dataset version `ames-1.0` · feature version `9b0f8ba4201c` · seed 42
everywhere.

## 1. Data and time-based split

All labeled work uses the Kaggle Ames `train.csv` (1,460 rows × 81 columns;
De Cock 2011 — citation in `data/README.md`). The competition `test.csv` has
no `SalePrice` and is never used for evaluation.

**Split (ADR-4):** time-based, no shuffle —

| split | YrSold | rows | role |
|---|---|---|---|
| train | ≤ 2008 | 945 | fitting, CV, all statistic fitting |
| val | 2009 | 338 | champion selection, threshold, tuning-free sanity |
| test | 2010 | 175 | **sealed** — read exactly once, after selection |

Rationale: the production question is "predict future sales from past sales",
so evaluation must be out-of-time. Random splitting would leak temporal
information (market conditions, seasonal mix) and inflate metrics. EDA
(§2.14 of `reports/EDA_REPORT.md`) found no regime break across the split
boundary — median price moved +0.6% from 2006→2008 — so the time split costs
little statistical efficiency here.

Cleaning follows `data_description.txt`: NA means "feature absent" for the
structural columns (Alley, Bsmt*, FireplaceQu, Garage*, PoolQC, Fence,
MiscFeature) → filled as the literal string `"None"` (a real category, not an
imputed value); processed files contain zero NaNs. `LotFrontage` (17.7%
genuinely missing) is imputed with the **median within neighborhood computed
on train only**; val/test reuse the train medians, and an unseen neighborhood
falls back to the global train median. Outliers are not blindly deleted: the
known Ames partial-sale artifact is removed **on train only** (2 rows — Ids
524 and 1299, `GrLivArea > 4000` sqft sold far below size-predicted price,
both `SaleCondition = Partial`; documented in
`data/processed/outliers_report.json`). The 39 rows above the price IQR fence
are genuine luxury stock and are kept.

The pipeline is reproducible with `python -m ml.data.pipeline`
(`--output-dir`, `--verbose`).

## 2. Leakage controls

Hard rules (SPEC §5), enforced by construction in `ml/features/`:

- **Train-only statistics.** Every aggregate — neighborhood median/mean
  price, median price per sqft, monthly sale velocity
  (`models/neighborhood_stats.json`), LotFrontage imputation medians, feature
  defaults, monitoring reference distributions — is fit on the train split
  and persisted; val/test/serving reuse the artifact, never refit.
- **Sealed test.** The test split was opened once, after champion selection,
  for the final report. Re-running `ml.evaluation.evaluate` re-reads it and
  should only be done deliberately.
- **No target-derived inputs.** Per-row `price_per_sqft = SalePrice /
  GrLivArea` is EDA/clustering-only and never enters a model.
  `days_on_market` / `sells_within_30_days` are targets, never features.
  `SaleType` / `SaleCondition` are excluded (not knowable pre-listing — and
  they flagged the two partial-sale outliers). `Id` is never a feature.
- **One feature pipeline.** `ml/features/pipeline.py` is the single source of
  truth for training, evaluation, clustering, and the API; preprocessing
  (imputation, `OneHotEncoder(handle_unknown="ignore")`, scaling) lives
  inside each sklearn Pipeline, so a saved champion is one self-contained
  joblib that cannot diverge from training-time preprocessing.

## 3. Targets

- **Regression:** `log1p(SalePrice)` (ADR-10). Raw prices are right-skewed
  (skew 1.967 → 0.175 after log1p) and errors are multiplicative; RMSLE is
  the primary metric and dollar metrics are reported via `expm1`.
- **Classification:** `sells_within_30_days`, derived from the **SIMULATED**
  days-on-market target (ADR-3 — see §10). Train positive rate ≈ 25.3%
  (239/945), so training is class-imbalance-aware
  (`class_weight="balanced"`; XGBoost `scale_pos_weight = neg/pos`) and
  PR-AUC is the primary metric.

## 4. Tuning protocol

All hyperparameters were chosen on the **train split only**; the val split
was never used for fitting or tuning.

- **Regression:** 5-fold `KFold(shuffle=True, random_state=42)`, scoring =
  log-space RMSE (`neg_root_mean_squared_error` on the log1p target).
  - Ridge/lasso: alpha grids `logspace(-3, 3, 13)` / `logspace(-4, 0, 13)`
    with `GridSearchCV`, then the **one-standard-error rule** — the strongest
    regularization within one SE of the best CV score. Ridge shipped
    alpha = 100 although the grid best was 31.6 (preferring the simpler,
    more stable model).
  - Random forest / XGBoost: `RandomizedSearchCV`, **n_iter = 8** (deliberate
    budget — the train split has only 945 rows). RF space: max_depth
    {None,10,20,30}, min_samples_leaf {1,2,4}, max_features {0.3,0.5,1.0}.
    XGB space: max_depth {3,5,7}, min_child_weight {1,3,5}, reg_lambda
    {1.0,5.0,10.0}.
- **Classification:** 5-fold `StratifiedKFold(shuffle=True, random_state=42)`,
  scoring = average precision, small `GridSearchCV` grids for all four
  candidates (again sized for 945 rows).

One known imperfection: the neighborhood statistics are fit on the **full
train split** (loaded from the persisted artifact) before cross-validation
runs, so each CV fold's hold-out rows contributed to their own
`neighborhood_*` features — CV scores are mildly optimistic. This touches
tuning only: champion selection and every reported metric use the clean
val/test path, where the stats are strictly train-fit.

Every training run is logged to the MLflow file store (`./mlruns`) with
params, val metrics, dataset/feature versions, and the fitted pipeline
artifact.

## 5. Calibration and threshold selection

- **Calibration:** each tuned classifier is refit as a sigmoid
  `CalibratedClassifierCV(cv=5)` on train. Champion selection considers
  **calibrated variants only**, and the Brier score acts as a sanity check
  alongside PR-AUC. The calibrated random forest won both (val PR-AUC
  0.5250, val Brier 0.1856).
- **Operating threshold (SPEC §14):** 0.203292, chosen to **maximize F1 on
  the val calibrated probabilities** — deliberately not 0.5, because
  calibrated probabilities sit near the ~25% prevalence. At 0.5 the champion
  would return recall 0.08; at 0.2033 it returns val precision 0.4091 /
  recall 0.8182 / F1 0.5455. The threshold lives in
  `models/champion.json` (`classification.threshold`) and the backend reads
  it from the artifact — nothing is hardcoded.

## 6. Champion selection and statistics

Selection rules (SPEC §6): regression = val RMSLE primary, RMSE then R² as
tie-breaks; classification = val PR-AUC primary among calibrated variants +
Brier check (tolerance 0.01).

- **Regression: ridge** — val RMSLE 0.1354 vs runner-up XGBoost 0.1398, and
  best val RMSE/MAE/R² as well. Because point estimates on 338 rows are
  noisy, the top-2 gap was tested with a **paired bootstrap**: 2,000
  row-level resamples of the val split (seed 42), 95% percentile CI of
  RMSLE(champion) − RMSLE(runner-up). Result: observed diff −0.0043, CI
  **[−0.0133, +0.0060]**, P(runner-up better) = 0.193. **The CI includes 0 —
  the win is not statistically decisive.** Ridge carries the decision on the
  secondary criteria: interpretability (signed coefficients), size (~21 KB vs
  ~25 MB), and serving latency. The sealed-test numbers underline why the
  discipline matters: on test, XGBoost is actually better (RMSLE 0.1051 vs
  0.1187) — but selection is locked to validation by design, and that
  discipline is what keeps the test estimate honest.
- **Classification: calibrated random forest** — best calibrated val PR-AUC
  (0.5250) and best calibrated val Brier (0.1856).
- **Sealed test (read once):** ridge R² 0.9305, MAE $15,075, RMSE $21,152,
  RMSLE 0.1187; classifier ROC-AUC 0.7666, PR-AUC 0.5674, Brier 0.1710 at
  threshold 0.2033 (confusion: TP 40, FP 69, FN 9, TN 57). The
  all-candidates test comparison in `reports/MODEL_EVALUATION.md` §5 is a
  final-report artifact only — never used for selection, tuning, or
  thresholds.
- **Price interval:** additive in log1p space from val residuals —
  `q_low = Q10(r) = −0.1410`, `q_high = Q90(r) = 0.1166`; serving returns
  `expm1(pred_log + q)`. Nominal ~80% interval (not conformalized);
  empirical coverage on the sealed test split is 0.783.

## 7. Clustering protocol (ADR-9)

- **Matrix:** 25 rows (one per neighborhood) ×
  `[lat, long, median_price_per_sqft, monthly_sale_velocity]` — approximate
  centroids from `data/external/neighborhood_geo.csv` (ADR-2) joined with
  **train-only** market stats from `models/neighborhood_stats.json`.
- **Scaling + eps:** `StandardScaler`, then DBSCAN. eps is chosen by the
  **k-distance knee heuristic** (k = min_samples; knee = max perpendicular
  distance to the curve's chord). Both knee candidates were evaluated:
  min_samples=2 → eps **1.3170**, 4 clusters / 3 noise (**accepted**, inside
  the 3–10 cluster contract); min_samples=3 → eps 1.5181, 1 cluster
  (degenerate, rejected). A rung sweep verified no finer eps keeps 3–10
  clusters with less noise on this 25-point matrix. The full 39-candidate
  trace is logged to MLflow (`eps_selection_trace.json`).
- **Result:** 4 micro-markets — mid northwest (14 neighborhoods, 461 train
  sales, median $179,900), affordable southwest (2, 15, $140,000), mid west
  (4, 158, $144,000), mid southeast (2, 41, $138,000) — plus 3 noise
  neighborhoods (CollgCr, NAmes, Timber; 12% of points, isolated by atypical
  sale velocity and/or location). Labels = price tier (tertiles of train
  median $/sqft) + compass direction vs downtown Ames.
- **Enrichment:** per-cluster descriptive stats (n_sales, median price,
  median $/sqft, `sale_velocity_30d`) computed on train only;
  `sale_velocity_30d` is descriptive over the SIMULATED target and is never a
  model input (stated in every cluster's `note` field).
- **Serving fallback:** clustered neighborhoods → their cluster
  (`fallback: false`); noise or unseen neighborhoods → nearest cluster
  centroid in scaled feature space with `fallback: true` (unknown areas use
  downtown Ames + global train fallback stats). Reproduce with
  `python -m ml.clustering.train` (deterministic).

## 8. Explainability

- **Global:** `shap.LinearExplainer` over the ridge champion with a
  transformed 200-row train background (seed 42,
  `shap.maskers.Independent(max_samples=200)`). Explainer choice is
  auto-detected by estimator type (`TreeExplainer` for tree-based champions),
  so a future champion swap needs no code change. One-hot dummy SHAP values
  are summed back to the 94 base feature names (longest-prefix parse, e.g.
  `cat__Neighborhood_NridgHt` → `Neighborhood`); additivity
  (Σ SHAP + E == prediction) is asserted in tests. Global importance is the
  mean |aggregated SHAP| over 200 val rows (units: log1p(SalePrice)) —
  `models/explainability/feature_importance.json`; top features: OverallQual
  0.0574, OverallCond 0.0405, total_sf 0.0300, GrLivArea 0.0260. Three of the
  top-20 are the train-fit target-encoded neighborhood stats
  (`neighborhood_median_price` #9 at 0.0187,
  `neighborhood_median_price_per_sqft` #15 at 0.0117,
  `neighborhood_mean_price` #18 at 0.0103) — comparisons against Ames
  benchmarks whose models use no target encoding should account for this.
- **Per-prediction:** `ml.explainability.service.explain_instance` returns
  the top-5 factors as `{feature, impact, magnitude}` where magnitude is the
  share of total |SHAP| (sums ≤ 1). First call per process builds the
  explainer (~4 s); warm calls ~55 ms. Any explanation failure degrades to an
  empty list — predictions never fail because of SHAP.
- Because the champion is linear, global SHAP here is a rescaling of the
  standardized ridge coefficients — read magnitudes comparatively, not
  causally (heavy multicollinearity in the size block splits importance
  across near-duplicates).

## 9. Experiment tracking and registry

MLflow file store (`./mlruns`; `MLFLOW_TRACKING_URI` overrides). MLflow 3.15
requires `MLFLOW_ALLOW_FILE_STORE=true` for file stores — `ml/tracking.py`
sets it at import. There is no registry server: the registry is
`models/registry/` + `models/champion.json` (SPEC §6 schema: versions,
val/test metrics, threshold, residual interval, bootstrap statistics,
rationale), and `feature_version` is the 12-char sha1 of
`models/feature_list.json` everywhere.

## 10. Limitations (honest)

- **Small, local, dated data.** 1,460 labeled rows from one city, sales
  2006–2010. 945 train rows cap model complexity and make val-set
  comparisons noisy (see the bootstrap). The Ames market of that period was
  unusually stable through the 2008 crash; nothing here transfers to a
  different market or period without retraining.
- **SIMULATED classification target (ADR-3).** `sells_within_30_days` comes
  from the transparent, seeded simulation in `ml/data/sale_speed.py`.
  Classification metrics measure consistency with that simulation — **they
  are not real-world sale-speed performance claims**. The rigor (split,
  calibration, threshold selection) transfers once real DOM data is dropped
  into the `DomProvider` interface; the absolute numbers do not.

  **The numbers are expected by construction.** Every deterministic input of
  the simulator except the realized `SalePrice` is itself a model feature:
  `OverallQual` and `OverallCond` are raw inputs, `MoSold` enters directly
  and as the engineered `sale_month`/`sale_quarter`, and the median the
  pricing term divides by is the train-fit `neighborhood_median_price`
  feature family. The one remaining simulator input, `log(SalePrice)`, is
  recoverable from the feature block at R² ≈ 0.93 (the ridge champion
  scores 0.9280 val / 0.9305 test on `log1p(SalePrice)`). The classifier's
  ROC-AUC 0.7666 / PR-AUC 0.5674 therefore measure **formula inversion plus
  tolerance of the seeded N(0, 0.35) noise term** — not learned market
  signal.
- **Approximate geography (ADR-2).** Neighborhood centroids, not per-property
  coordinates → micro-markets are neighborhood-grain; no street-level
  signal. Cluster 0 is a coarse 14-neighborhood blob because 25 points cannot
  split the contiguous north/central belt; per-neighborhood stats remain the
  fine-grained signal. Rare neighborhoods (Blueste n=1, NPkVill n=3,
  MeadowV n=9) have noisy medians.
- **Champion margin is not decisive.** The ridge-vs-XGBoost bootstrap CI
  includes 0, and XGBoost posts the better sealed-test RMSLE. Ridge is
  defended on interpretability/latency, not on proven superiority.
- **MSSubClass is modeled as a scaled numeric**, not the categorical code it
  semantically is (CSV round-trip yields int64; ADR-11). No train/serve skew
  and metrics are honest for the trained configuration; one-hot treatment is
  a documented future improvement that requires a retrain.
- **Nominal intervals.** The price range is an empirical ~80% residual
  interval (test coverage 78.3%), not conformalized — per-row coverage is not
  guaranteed.
- **No fairness/robustness audit, no production hardening** (auth, rate
  limiting) — see `docs/DEPLOYMENT.md` for what a real deployment still
  needs.
