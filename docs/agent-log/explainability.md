# Agent Log — explainability

**Scope:** `ml/explainability/`, `models/explainability/`,
`tests/ml/test_explainability.py`, `figures/shap_*.png`.
Status: **complete**, all 11 tests green (full `tests/ml` suite: 65 passed).

## What was built (SPEC §6/§8/§9)

- `ml/explainability/explainer.py` — core SHAP machinery:
  - `RegressionExplainer` loads `models/registry/regression_champion.joblib`
    (Pipeline `preprocess` ColumnTransformer → `model` Ridge(alpha=100)),
    locates the `ColumnTransformer` step + final estimator generically, and
    builds a **transformed train background** (200 rows sampled with seed 42
    from `build_feature_frame(load_split("train"))`).
  - Explainer auto-detection by estimator module: `sklearn.linear_model` →
    `shap.LinearExplainer`; `sklearn.ensemble`/`sklearn.tree`/`xgboost`/
    `lightgbm` → `shap.TreeExplainer`; anything else → clear `RuntimeError`
    (a future champion swap needs no code change). The linear path wraps the
    background in `shap.maskers.Independent(..., max_samples=200)` so the full
    200-row background is used (shap would otherwise subsample to 100).
  - **One-hot aggregation:** `parse_base_name` maps transformed names back to
    base `MODEL_FEATURES` (`num__GrLivArea` → `GrLivArea`;
    `cat__Neighborhood_NridgHt` → `Neighborhood` via longest-prefix match —
    robust to values with spaces like `cat__MSZoning_C (all)`);
    `aggregate_shap` sums dummy-column SHAP values per base feature. Every
    parsed name is asserted ∈ `MODEL_FEATURES` (296 transformed → 94 base).
  - `RuntimeError` (not bare `FileNotFoundError`) when the champion, train
    split or feature artifacts are missing/out of sync.
- `ml/explainability/service.py` — **the backend contract**:
  `explain_instance(feature_row: pd.DataFrame, top_n: int = 5) -> list[dict]`.
  Single-row frame in `MODEL_FEATURES` order in → `top_n` dicts with exactly
  `{"feature": base name, "impact": "positive"|"negative",
  "magnitude": |shap| / Σ|shap| over ALL base features (0–1)}` out, sorted by
  descending magnitude (so returned shares sum ≤ 1). Lazy process-wide
  singleton (double-checked lock) built on first call; warm calls ~53 ms
  (budget <300 ms). `model_path` kwarg allows one-off explainers in tests.
- `ml/explainability/build_artifacts.py` — CLI
  (`python -m ml.explainability.build_artifacts`), all real computation on the
  val split (200 rows, seed 42):
  - `models/explainability/feature_importance.json` —
    `{"metadata": {...}, "importance": {base_feature: mean_abs_shap}}` sorted
    desc; metadata pins model, repo-relative model path (POSIX), explainer
    kind, units (`log1p(SalePrice)`), background size/split, val sample size,
    seed 42, `feature_version` (`9b0f8ba4201c`, matches `champion.json`),
    dataset version, timestamp, aggregation note.
  - `models/explainability/shap_values_sample.npz` — `shap_values` (200, 94),
    `feature_names` (94 base names), `expected_value`, `val_ids`.
  - `figures/shap_bar.png` — top-20 base features by mean |SHAP|.
  - `figures/shap_summary.png` — beeswarm-style summary of the 200 val rows
    over aggregated base-feature SHAP; numeric features colored by value
    percentile (coolwarm), **categoricals honestly in grey** (labeled on the
    colorbar); no dummy columns anywhere.
  - Copies of both PNGs in `models/explainability/` (SPEC §6 lists them
    there; `figures/` stays canonical).
- `tests/ml/test_explainability.py` — 11 tests: artifacts exist/valid;
  importance keys ⊆ `MODEL_FEATURES`, no `__`, no dummy suffixes
  (`Neighborhood` present, `Neighborhood_NridgHt` absent), values finite,
  sorted desc; metadata cross-checked against `champion.json` +
  `ml.tracking.feature_version`; npz shape/names/ids; `parse_base_name` unit
  cases; **additivity** (Σ aggregated SHAP + expected_value == pipeline
  prediction, rtol 1e-6); `RuntimeError` on missing champion;
  `explain_instance` contract (exact keys, valid impact, magnitudes ∈ [0,1],
  sum ≤ 1, unique, sorted), `top_n` + input validation, warm latency <300 ms;
  synthetic OverallQual 8-vs-4 pair: SHAP strictly ordered, sign matches the
  aggregated ridge coefficient (+0.0630 > 0), high-quality contribution
  strictly positive.

## Verification evidence

- `.venv/Scripts/python.exe -m pytest tests/ml/test_explainability.py -q` →
  **11 passed in 14.21s**; `pytest tests/ml -q` → **65 passed**.
- Additivity spot-check during development: `sum(shap) + E == pred` exactly
  (12.218821053067032 vs 12.21882105306703).
- Top-10 global base features (mean |SHAP|, log1p(SalePrice) units):

  | # | feature | mean \|SHAP\| |
  |---|---|---|
  | 1 | OverallQual | 0.0574 |
  | 2 | OverallCond | 0.0405 |
  | 3 | total_sf | 0.0300 |
  | 4 | GrLivArea | 0.0260 |
  | 5 | 1stFlrSF | 0.0214 |
  | 6 | TotalBsmtSF | 0.0212 |
  | 7 | 2ndFlrSF | 0.0209 |
  | 8 | BsmtFinSF1 | 0.0199 |
  | 9 | neighborhood_median_price | 0.0187 |
  | 10 | living_area_per_bedroom | 0.0177 |

- Sample `explain_instance` (first val row, top-5):
  `[{"feature": "living_area_per_bedroom", "impact": "positive", "magnitude": 0.128258},
    {"feature": "3SsnPorch", "impact": "positive", "magnitude": 0.122698},
    {"feature": "OverallQual", "impact": "negative", "magnitude": 0.068965},
    {"feature": "BedroomAbvGr", "impact": "negative", "magnitude": 0.043873},
    {"feature": "OverallCond", "impact": "negative", "magnitude": 0.033726}]`
  (that val row genuinely is low-quality/large-per-bedroom — signs are real.)
- Latency: cold call 4.1 s (one-time singleton build), warm calls max 55 ms
  over 10 calls — comfortably under the 300 ms budget.

## Notes for the orchestrator / backend agent

- Import path: `from ml.explainability.service import explain_instance` —
  pass the **built feature frame** (output of `build_feature_frame`), not the
  raw payload dict; one row only.
- `feature_importance.json` schema is `{"metadata": {...}, "importance":
  {base_feature: float}}` (nested, sorted desc) — the frontend Model Insights
  chart should read the `importance` mapping.
- SHAP values/magnitudes are in `log1p(SalePrice)` space; `magnitude` is a
  normalized share, safe to display directly.
- First `explain_instance` call per process pays the ~4 s singleton build;
  construct it at app startup (or accept a slow first request).
