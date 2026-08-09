# Agent Log — monitoring

**Scope:** `ml/monitoring/` (`psi.py`, `reference.py`, `drift_check.py`,
`__init__.py`), `models/monitoring/reference_stats.json`,
`tests/ml/test_monitoring.py`, `reports/drift/` (output dir).
Status: **complete**, all 19 tests green.

## What was built (SPEC §10)

- `ml/monitoring/psi.py` — PSI math, no I/O:
  - `population_stability_index(expected, actual, eps=1e-6)` — classic
    `Σ (a−e)·ln(a/e)`; normalizes inputs defensively (accepts counts), clips
    at `eps` so empty bins give a large-but-finite penalty. Thresholds as
    module constants + docstring: warn `>= 0.1` (`PSI_WARN_THRESHOLD`), drift
    `>= 0.2` (`PSI_DRIFT_THRESHOLD`).
  - `psi_bins_from_train(values, n_bins=10)` — quantile edges with
    duplicates removed (`np.unique`), so zero-inflated/tied features
    collapse to fewer bins; a constant sample degenerates to
    `[c−0.5, c, c+0.5]` (single cut at the constant, drift still visible).
  - `bin_proportions(values, edges)` — outer edges treated as ±inf, so
    production values outside the train range land in the edge bins and
    inflate PSI instead of being dropped. Non-numeric/NaN dropped; empty
    input → zero vector (callers skip the feature).
- `ml/monitoring/reference.py` — CLI `python -m ml.monitoring.reference`.
  Builds `models/monitoring/reference_stats.json` from the TRAIN split only:
  `load_split("train")` → `fit_neighborhood_stats(train)` →
  `build_feature_frame(train, stats)` → subset to MODEL_FEATURES read from
  `models/feature_list.json`. Result: **53 numeric features** (bin edges +
  expected proportions) + **4 key categoricals** (Neighborhood, HouseStyle,
  MSZoning, CentralAir frequency proportions). Payload also carries
  `dataset_version`, `feature_version` (sha1[:12] of feature_list.json),
  `n_rows=945`, `n_bins`.
- `ml/monitoring/drift_check.py` — CLI
  `python -m ml.monitoring.drift_check [--window N] [--log PATH]`
  (defaults: window 500, `logs/predictions.jsonl`). Library entry point:
  `run_drift_check(log_path, window, reference_path,
  prediction_reference_path, output_path) -> dict`.
  - Reads last N lines (deque, memory-safe), skips+counts invalid JSON
    lines and records without a `features` dict.
  - Per-numeric-feature PSI vs reference; prediction-distribution PSI vs
    `models/monitoring/prediction_reference.json` **if present** (owned by
    the evaluation agent — see "Cross-agent contract" below).
  - Writes `reports/drift/latest.json` with exactly the §10 keys:
    `timestamp, status (ok|no_data), n_predictions, psi_threshold=0.2,
    warn_threshold=0.1, drift_detected, drifted_features, per_feature_psi,
    prediction_psi (dict|null), retraining_recommended, recommendation_text`
    plus `window, log_path, max_psi, warn_features, n_invalid_lines,
    min_sample_for_retraining=200, reference_feature_version`.
  - `retraining_recommended = drift_detected AND n_predictions >= 200` —
    recommendation flag only, **nothing here ever triggers retraining**.
  - Missing/empty/fully-invalid log → `status: "no_data"`, exit 0 (safe for
    cron before the backend logs anything). Missing reference artifact →
    clear error, exit 2.
- `ml/monitoring/__init__.py` — exports all public API (21 symbols).
- `tests/ml/test_monitoring.py` — 19 tests (details below).

## Cross-agent contract (orchestrator/backend please note)

- **Backend** only needs `run_drift_check(...)` or the CLI; `/metrics` can
  surface `reports/drift/latest.json` verbatim. The log-line schema consumed
  is exactly SPEC §10 (`features` = full built feature row, `prediction` =
  `{estimated_price, probability, cluster_id}`).
- **`models/monitoring/prediction_reference.json`** (evaluation agent's
  file) is read defensively. Verified against the real artifact produced
  during this build: sectioned schema `{"regression": {"field":
  "estimated_price", "bin_edges": [...], "bin_proportions": [...]},
  "classification": {"field": "probability", ...}}`. The reader
  (`_iter_prediction_specs`) accepts that schema **and** a flat
  `{field: {"bin_edges", "expected_proportions"}}` variant
  (`bin_proportions`/`expected_proportions` treated as aliases); anything
  unusable → `prediction_psi: null`, never a crash.
- **Structural caveat:** `YrSold`/`sale_year` are model features and the
  train split is `YrSold ≤ 2008` by construction (ADR-4) — any live traffic
  from a later period will *always* show drift on these two (val sanity run
  below: PSI 4.36). Consumers of `latest.json` may want to ignore pure
  sale-time features when judging data-quality drift; the checker reports
  all numeric MODEL_FEATURES per contract and does not special-case them.

## Verification (all commands from repo root, `.venv/Scripts/python.exe`)

1. Reference build — `python -m ml.monitoring.reference`:
   `INFO: wrote drift reference: 53 numeric + 4 categorical features, 945
   train rows -> models/monitoring/reference_stats.json` (25 KB).
2. Unit tests — `python -m pytest tests/ml/test_monitoring.py -q` →
   **19 passed in ~2.3 s**. Covers: PSI = 0 for identical distributions,
   PSI ≈ 0.8789 hand-computed two-bin proof, sampled same-distribution PSI
   < 0.1 vs shifted (+1.5σ) PSI > 0.2, duplicate-edge/constant-feature bin
   robustness, out-of-range values in edge bins, reference builder covering
   all 53 numeric MODEL_FEATURES (+4 categoricals, proportions sum to 1,
   edges strictly increasing), drift_check: (a) 945 in-distribution train
   rows → `drift_detected=false`, `max_psi=0.0`; (b) 50 rows with
   `GrLivArea × 3` → `drift_detected=true`, `GrLivArea` drifted,
   `retraining_recommended=false` (n < 200); (c) missing log → `no_data`;
   invalid lines counted (3 invalid / 2 valid); prediction PSI computed
   when the reference exists (real sectioned schema).
3. CLI, missing log — `python -m ml.monitoring.drift_check --log
   <absent>` → `status=no_data`, **exit 0**, report written.
4. CLI, realistic sanity — 338 val-split rows (later period) as a synthetic
   log; per-feature PSI (top 10, val window vs train reference):

   ```
   YrSold                                   4.3586   ← expected: time-based split
   sale_year                                4.3586   ← expected: time-based split
   property_age                             0.0707
   GrLivArea                                0.0702
   bathroom_bedroom_ratio                   0.0654
   YearBuilt                                0.0600
   years_since_remod                        0.0583
   LotFrontage                              0.0551
   1stFlrSF                                 0.0473
   TotalBsmtSF                              0.0470
   ```

   All physical features < 0.1 (val is in-distribution); only the structurally
   disjoint sale-year features cross 0.2. `prediction_psi.estimated_price =
   0.0523` (val SalePrice fed as predictions vs champion val deciles — small);
   `probability = 12.42` is an artifact of the constant 0.25 used in the
   synthetic log. `reports/drift/latest.json` currently holds this report.

## Notes

- `python -m ml.monitoring.*` prints a benign `RuntimeWarning` from runpy
  because the package `__init__` re-exports the modules (double import as
  `__main__`); behavior is unaffected.
- No backend code written; no champion artifacts touched. The only file in
  `models/monitoring/` written by this agent is `reference_stats.json`.
