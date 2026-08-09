# Forensic Audit — llba-ml-services

**Scope (line-by-line, every line read):** `ml/clustering/{dataset.py (115), serve.py (185), train.py (605), __init__.py (31)}`,
`ml/explainability/{explainer.py (260), build_artifacts.py (250), service.py (115), __init__.py (12)}`,
`ml/monitoring/{psi.py (162), reference.py (164), drift_check.py (402), __init__.py (65)}` — 2,226 lines, all reviewed.
**Date:** 2026-08-07. **Mode:** report-only; no project file modified. Evidence: `docs/audit/evidence/llba-ml-services-*.txt`.

**Verdict: PASS WITH CONCERN** — all core logic independently reproduced by execution; 5 findings (0 P0, 0 P1, 1 P2, 4 P3).

---

## Findings

| # | Sev | File:line | Description | Evidence |
|---|-----|-----------|-------------|----------|
| F1 | P2 | `ml/monitoring/reference.py:101` + `ml/monitoring/psi.py:98-125` | **PSI blind spot on degenerate-bin features.** 6 of 53 numeric reference features collapse to **1 bin** (`PoolArea`, `MiscVal`, `3SsnPorch`, `ScreenPorch`, `LowQualFinSF`, + 1 more) and 8 more to 2 bins. With 1 bin, `bin_proportions` puts every in-range value in the single bin → PSI ≡ 0 forever. Proven: production sample of all-`500.0` on `PoolArea` (train is ~98% zeros) yields PSI **0.0**. Drift on these features is silently undetectable; neither `reference_stats.json` nor the drift report flags degenerate features. | `llba-ml-services-drift.txt` ("features with <3 bins", "PoolArea … PSI(all-500 prod): 0.0") |
| F2 | P3 | `ml/clustering/train.py:23-26` | **Stale module docstring.** Claims result is "4 clusters, **4 noise** neighborhoods (BrDale, CollgCr, NAmes, Timber…)". Verified rerun + persisted artifacts give 4 clusters, **3 noise** (CollgCr, NAmes, Timber); BrDale is in cluster 0. The eps≈1.317 and "k=3 knee degenerates to a single cluster" claims verified true (k=3 knee eps 1.5181 → 1 cluster, 4 noise). | `llba-ml-services-clustering-repro.txt`, `llba-ml-services-breakit.txt` |
| F3 | P3 | `ml/clustering/serve.py:66,73` | **Dead artifact load.** `dbscan.joblib` is required and loaded into `self._dbscan` but never referenced again — serving answers come entirely from scaler + assignments + stats + geo. Serving hard-fails if `dbscan.joblib` is missing/corrupt even though it is unused. | `grep _dbscan serve.py` → only line 73 |
| F4 | P3 | `ml/monitoring/drift_check.py:114-132` | **Inconsistent robustness: corrupt feature reference crashes uncaught.** `compute_feature_psi` does not catch the `ValueError` from `bin_proportions` on non-increasing stored edges (verified: uncaught `ValueError: bin edges must be strictly increasing`), while the prediction-PSI path (`drift_check.py:205-209`) catches and downgrades to a warning. A corrupted `reference_stats.json` kills the scheduled CLI with a traceback instead of a clean report. | `llba-ml-services-drift.txt` (last line) |
| F5 | P3 | `ml/clustering/__init__.py:14,27-30` | **`train` export is import-order dependent.** Once `ml.clustering.train` (the submodule) is imported anywhere in the process, the package attribute `train` is the *module*, so the PEP 562 `__getattr__` branch returning the *function* never fires. Verified: after `from ml.clustering.train import …`, `callable(ml.clustering.train)` is `False`. No in-repo caller uses `from ml.clustering import train`, so impact is cosmetic. | `llba-ml-services-breakit.txt` ("lazy exports: … False") |

**Observation (not filed):** `read_prediction_window` skips blank lines without counting them in `n_invalid` while its docstring says malformed lines are "skipped and counted" (`drift_check.py:85-88`). Semantically defensible (a blank line is not a JSON line); noted for completeness. Also `dataset.py:60` and `serve.py:83` use plain `pd.read_csv` (no `keep_default_na=False`) on artifact CSVs — harmless for current Ames values (no NA-like neighborhood names), but outside the SPEC §14 convention.

---

## Per-function matrix

### `ml/clustering/dataset.py` — PASS

| Function | What it does / verification | Status |
|---|---|---|
| `load_neighborhood_geo` (50-65) | Loads geo CSV; explicit FileNotFoundError/ValueError on missing file/columns. Read with default NA parsing (see observation above). | PASS — statically verified (50-65) |
| `build_neighborhood_matrix` (68-115) | Joins geo × train-fit stats; unseen neighborhoods → global fallback + warning. Executed: 25×6 frame, all values finite; matrix printed in evidence matches geo CSV + `neighborhood_stats.json`. | PASS — verified by execution |
| Module constants (36-47) | `CITY_CENTER` = (42.0347, -93.6199) matches ADR-2; `FEATURE_COLUMNS` order lat, long, ppsft, velocity — matches ADR-9 and persisted `feature_names`. | PASS — statically verified |

### `ml/clustering/train.py` — PASS (F2 docstring)

| Function | Verification | Status |
|---|---|---|
| `k_distance_curve` (158-170) | `NearestNeighbors(n_neighbors=k)` incl. self → column k−1 = (min_samples−1)-th other-neighbor distance = correct k-distance for DBSCAN's self-counting `min_samples`. Curves for k=2,3 printed. | PASS — verified by execution |
| `knee_index` (173-194) | Min-max normalized, max perpendicular distance to chord; flat curve → median index w/ warning (verified returns 5 for n=10 flat); n<3 → last index (verified n=2 → 1). | PASS — verified by execution |
| `count_clusters` (197-201) | Excludes −1; executed in repro (4, 3). | PASS — verified by execution |
| `_fit_dbscan` (204-206) | 1e-9 relative eps bump for boundary inclusion; persisted model eps = rung×(1+1e-9) confirmed (1.317004520305001 vs 1.3170045189879962). | PASS — verified by execution |
| `select_dbscan_params` (209-276) | Re-executed on live data: 39 candidates, k=2 knee (eps 1.3170045189879962) valid → 4 clusters/3 noise, tie-break preference k=2 first; rationale string accurate. Total-degeneracy path raises loud RuntimeError (verified on ring data). Fallback tie-break order (noise, knee_rank, −clusters) matches docstring. | PASS — verified by execution |
| `price_tier` / `direction_label` (279-312) | Tertile boundaries; compass vs CITY_CENTER with ~1 km central band. Label math exercised in stats recompute — labels match disk ("mid northwest" etc.). | PASS — verified by execution |
| `build_cluster_stats` (315-370) | Stats recomputed from train split only — all 4 clusters' n_sales/median_price/median_ppsft/sale_velocity_30d match `cluster_stats.json` to <1e-9; empty-cluster guard (`continue` + warning) present; velocity note (ADR-3 disclaimer) embedded per cluster. Train-only confirmed: cluster 0 median differs from val (179900 vs 178500) and disk equals train value. | PASS — verified by execution |
| `_plot_*` (373-467) | Headless Agg set before pyplot import; figure files exist on disk (`figures/cluster_*.png`). Not pixel-audited (figures are presentation layer). | PASS — statically verified |
| `_log_mlflow_run` (470-518) | Params/metrics/trace logged inside `track_run("clustering","dbscan_v1")` (signature matches `ml/tracking.py:43`); 1 retry after 30 s on shared-store failure; failure never loses disk artifacts. | PASS — statically verified |
| `train` (521-580) / `main` (583-601) | Full pipeline re-executed in-memory (minus writes): scaler params, eps, labels, stats all bit-match persisted artifacts (`dbscan.joblib`, `dbscan_scaler.joblib`, `cluster_stats.json`, `cluster_assignments.csv` — 0 label mismatches). | PASS — verified by execution |

### `ml/clustering/serve.py` — PASS (F3)

| Function | Verification | Status |
|---|---|---|
| `__init__` (59-113) | Artifact presence check with actionable error; consistency check stats-keys == assignment labels; centroids = mean of scaler-transformed member vectors (manually recomputed for cluster 1 — matches). | PASS — verified by execution |
| `_feature_vector` (125-138) | Known → own geo+stats row; unknown → CITY_CENTER + global fallback stats. Verified via lookup of `"NoSuchPlace"`. | PASS — verified by execution |
| `_nearest_cluster` (140-148) | Scaled-space Euclidean distance; manual distance computation for unknown (dists 28.27/28.38/29.25/28.83 → cluster 2) and noise CollgCr (→ cluster 2) match `lookup` output. Tie-break by cluster id. | PASS — verified by execution |
| `_payload` / `lookup` (150-185) | Payload keys match backend `MicroMarket` schema exactly (`backend/app/schemas/responses.py:31-45`). Known→`fallback:false`; noise (CollgCr/NAmes/Timber) and unknown→nearest centroid `fallback:true`, label unchanged per ADR-9. `.strip()` on input verified; lookup is case-sensitive (lowercase "nridght" → fallback path, reasonable). | PASS — verified by execution |

### `ml/clustering/__init__.py` — PASS WITH CONCERN (F5)

Lazy PEP 562 exports verified for `FEATURE_COLUMNS`, `MicroMarketLookup`, `build_neighborhood_matrix`; unknown name raises AttributeError. `train` export shadowed once submodule imported (F5).

### `ml/explainability/explainer.py` — PASS

| Function | Verification | Status |
|---|---|---|
| `parse_base_name` (61-84) | All 296 real transformed names parse into MODEL_FEATURES (0 failures). Adversarial: `cat__MSZoning_C (all)`→MSZoning, digit-suffix features (`BsmtFinType1`, `1stFlrSF`), `Condition1`/`Condition2` disambiguation, value with extra underscores (`MiscFeature_TenC_x_y`) all correct. Longest-prefix collision probe (`MS` vs `MSZoning`) resolves correctly. Unknown base → rsplit fallback + warning (never crashes). Invariant verified: no categorical MODEL_FEATURE contains `_`; the one underscore-prefix pair (`neighborhood_median_price[_per_sqft]`) is numeric-only → never hits the cat path. | PASS — verified by execution |
| `aggregate_shap` (87-113) | Synthetic case exact (A=1, B=2+3=5, C=4); shape-mismatch ValueError present. | PASS — verified by execution |
| `RegressionExplainer.__init__` (130-195) | Champion pipeline introspection: finds ColumnTransformer, rejects missing model / non-pipeline / unknown columns with RuntimeError. Background = 200 train rows, seed 42, dense (296 cols) — `sparse_threshold=0.0` in `build_preprocessor` makes `np.asarray(..., float)` safe. Loud RuntimeError if preprocessor drifts from MODEL_FEATURES. | PASS — verified by execution |
| `explainer_kind` / `_build_explainer` (197-223) | Ridge → LinearExplainer; `Independent(background, max_samples=200)` — correct: full background, no silent subsample to 100. `expected_value` 12.00034 == mean of model predictions on background (exact match) — confirms correct masker/reference usage. Unsupported estimator → RuntimeError. | PASS — verified by execution |
| `explain` / `explain_one` (225-260) | Additivity `sum(shap) + expected_value == prediction` max err **1.8e-15** over 50 val rows. Missing-column ValueError; single-row enforcement; extra cols dropped via `[MODEL_FEATURES]`. | PASS — verified by execution |

### `ml/explainability/service.py` — PASS

| Function | Verification | Status |
|---|---|---|
| `_get_explainer` (53-60) | Double-checked locking around lazy singleton; correct under CPython GIL (single construction, atomic global assignment). | PASS — statically verified |
| `explain_instance` (63-115) | Contract executed: 5 dicts `{feature, impact, magnitude}`, keys match backend `PriceFactor` schema; magnitudes sum 0.313 ≤ 1; normalization denominator = sum |shap| over ALL 94 base features (matches docstring); all-zero guard keeps output finite; sign = shap sign (`>=0` → positive); `top_n<1` and non-single-row raise ValueError; `model_path` test hook builds one-off explainer. | PASS — verified by execution |

### `ml/explainability/build_artifacts.py` — PASS

| Function | Verification | Status |
|---|---|---|
| `_load_val_sample` (79-89) | Deterministic val sample (200, seed 42) with `__val_id__` traceability. | PASS — verified by execution |
| `_plot_bar` / `_plot_summary` (92-162) | Top-20, honest grey for categoricals, seed-fixed jitter. PNGs exist. Not pixel-audited. | PASS — statically verified |
| `build_artifacts` (165-237) | **Full recompute bit-exact**: 200-row val SHAP, mean\|shap\| importance, and `shap_values_sample.npz` matrix all equal stored artifacts (`np.allclose` true; 0 importance mismatches). Metadata honest (model, explainer kind, background=train, feature_version 9b0f8ba4201c, units log1p). Figure copies to `models/explainability/` present. | PASS — verified by execution |

### `ml/explainability/__init__.py` — PASS. Docstring-only package init (lazy heavy imports documented and honored — `shap` imported inside `_build_explainer`).

### `ml/monitoring/psi.py` — PASS (design feeds F1)

| Function | Verification | Status |
|---|---|---|
| `population_stability_index` (51-95) | **Hand-recomputed**: e=[.5,.5], a=[.25,.75] → 0.2746530721670274, matches impl to 1e-12. Standard form Σ(a−e)·ln(a/e). Defensive renormalization accepts counts; eps-clip then renormalize → empty-bin penalty large-but-finite (2.486 for a 0.2-mass surprise bin). All four ValueError paths verified. | PASS — verified by execution |
| `psi_bins_from_train` (98-125) | Quantile edges deduped via `np.unique` (zero-inflated PoolArea → [0,700]); constant → [c−0.5, c, c+0.5] so shifts still register (PSI 27.6 on shift). n_bins<1 and empty-sample ValueErrors verified. | PASS — verified by execution |
| `bin_proportions` (128-162) | Outer edges open (±inf): below-range → first bin, above-range → last bin (verified, PSI 12.4 vs ref). Non-numeric/NaN dropped; all-junk → zero vector (callers skip). Strictly-increasing validation verified ([1.0], [2,1], [1,1] all raise). | PASS — verified by execution |

### `ml/monitoring/reference.py` — PASS (F1 consequence)

| Function | Verification | Status |
|---|---|---|
| `load_model_features` (63-66) | Reads feature_list.json `features` key. | PASS — statically verified |
| `build_reference_stats` (69-138) | Train-only (`load_split("train")`, stats fit on train). Persisted artifact spot-recompute: `GrLivArea`, `PoolArea`, `OverallQual`, `neighborhood_median_price` edges AND proportions match exactly; categorical `Neighborhood` 25-cat proportions match exactly. Missing-feature guard raises ValueError. Does not flag degenerate-bin features (F1). | PASS — verified by execution |
| `load_reference_stats` / `main` (141-160) | FileNotFoundError with remediation message. | PASS — statically verified |

### `ml/monitoring/drift_check.py` — PASS (F4)

| Function | Verification | Status |
|---|---|---|
| `read_prediction_window` (68-98) | Malformed JSON, non-dict records, non-dict `features` all skipped+counted (3 valid/4 invalid on crafted 8-line file); window = last N **raw** lines (verified 7,8,9 of 10); **memory bounded** — 200k-line log with window 500 peaks at 0.3 MB (deque). | PASS — verified by execution |
| `_coerced` (101-111) | Drops junk/None/NaN/±inf; keeps bools as 0/1 (acceptable). | PASS — verified by execution |
| `compute_feature_psi` (114-132) | Real reference × synthetic records OK; skips absent/empty features. Uncaught ValueError on corrupt stored edges (F4). | PASS — verified by execution |
| `_iter_prediction_specs` / `compute_prediction_psi` (135-210) | Real `prediction_reference.json` (sectioned schema) parsed → fields `estimated_price`, `probability`; flat and nested-`predictions` schema variants verified; malformed/non-dict ref file → None (never blocks feature report); records lacking `prediction` handled. | PASS — verified by execution |
| `run_drift_check` / `_no_data_report` / `_ok_report` (213-335) | Missing/empty/all-garbage log → `no_data`, exit-safe. **Retraining guard boundary verified**: drift at n=199 → `retraining_recommended=False`; same drift at n=200 → `True` (SPEC §10: drift AND n≥200). In-distribution window → max_psi 0.001, no drift. Current production `reports/drift/latest.json` consistent with code path (n=7, drift detected, retraining False — small-sample guard working live). | PASS — verified by execution |
| `_recommendation_text` / `main` (338-398) | All four text branches exercised via the runs above; CLI exit 0 on no-data, 2 on missing reference. | PASS — verified by execution |

### `ml/monitoring/__init__.py` — PASS. Eager re-exports; every name in `__all__` resolves (imported successfully during test runs).

---

## Execution summary (evidence index)

| Evidence file | Contents |
|---|---|
| `llba-ml-services-clustering-repro.txt` | Full in-memory re-execution of clustering training: matrix dump, k-distance curves + knees, eps selection trace, labels vs disk (0 mismatches), scaler params match, cluster stats recompute vs `cluster_stats.json` (exact), train-only proof |
| `llba-ml-services-serve.txt` | `MicroMarketLookup`: known/noise/unknown/blank/lowercase lookups, manual scaled-space nearest-centroid recomputation, centroid re-derivation |
| `llba-ml-services-shap.txt` | Explainer kind, background shape, parse coverage of all 296 transformed names, adversarial parses, additivity (1.8e-15), synthetic aggregation, explain_instance contract, expected_value vs mean background prediction, bit-exact recompute of `feature_importance.json` + npz |
| `llba-ml-services-psi.txt` | PSI hand-computation match, error paths, duplicate-edge/constant/out-of-range binning, reference artifact recompute (4 numeric + categorical spot checks) |
| `llba-ml-services-drift.txt` | Degenerate-bin census + PoolArea blind-spot proof, JSONL robustness matrix, 200k-line memory bound, retraining-guard boundary (n=199 vs 200), no-data paths, prediction-PSI against real reference, corrupt-reference crash (F4) |
| `llba-ml-services-breakit.txt` | Flat-curve knee fallback, degenerate-data RuntimeError, parse adversarial set, MODEL_FEATURES prefix-pair scan, flat/nested prediction-ref schemas, live drift report state, lazy-export shadowing (F5) |
| `llba-ml-services-tests.txt` | `pytest tests/ml/test_clustering.py test_explainability.py test_monitoring.py -q` → **39 passed** |

Ambient CPU load from concurrent auditors was present but irrelevant: no timing-sensitive assertions were made (existing latency test passed within the suite).

## Contradictions for the orchestrator

1. **Cluster noise count**: `ml/clustering/train.py` docstring says 4 noise (incl. BrDale); artifacts + my rerun say 3 noise (CollgCr, NAmes, Timber). AUDIT_PLAN baseline says "4 DBSCAN clusters + 3 noise" — artifacts agree with the plan. docs-truth agent should check README/reports for any 4-noise/BrDale claims.
2. **Live drift state**: `reports/drift/latest.json` currently shows `drift_detected: true` (n=7, retraining not recommended). Any doc claiming "no drift" would contradict this; monitoring wave-B agent should note the log window is tiny (7 records).
3. F1 overlaps the monitoring contract (SPEC §10 "PSI over numeric features"): 6 features can never report drift. If another agent (monitoring/test-audit) rates SPEC §10 fully satisfied, this finding qualifies that verdict.
