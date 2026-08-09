# Forensic Audit — agent `shap` (SHAP / Explainability, mission §11)

Date: 2026-08-07 · Host: Windows + Git Bash · Python: `.venv/Scripts/python.exe` (shap 0.52.0, sklearn 1.9.0)
Champion under audit: **Ridge** (`models/registry/regression_champion.joblib`, per `models/champion.json`), explained via `shap.LinearExplainer` on a 200-row transformed **train** background (seed 42). 296 transformed columns → 94 base features.
No servers started, no ports used, no project files modified. Ambient CPU load from concurrent auditors noted where timing matters.

## Verdict summary

| # | Check | Result | Evidence |
|---|-------|--------|----------|
| 2 | Additivity: `sum(shap) + expected_value == predict` (log space), 5 val rows | **PASS — verified by execution** (max abs err **0.0**, exact) | `evidence/shap-additivity.txt` |
| 3 | One-hot → base aggregation (NridgHt construction) | **PASS — verified by execution** (dummy-sum == aggregated, diff 0.0) | `evidence/shap-aggregation.txt` |
| 4 | Sign checks (manual): OverallQual 8v4, GrLivArea 3000v1000, property_age 90v2 | **PASS — verified by execution** (all 3; manual linear-SHAP matches library exactly) | `evidence/shap-sign-checks.txt` |
| 5 | `explain_instance` top-5 vs independent ranking, 3 val rows | **PASS — verified by execution** (order/signs/magnitudes exact; sums ≤ 1) | `evidence/shap-explain-instance.txt` |
| 6 | Runtime: warm ×20 + cold build | **PASS — verified by execution** (warm p50 **30.2 ms** ≤ ~50 ms claim; cold **~1.77 s**) | `evidence/shap-runtime.txt` |
| 7 | Global importance + npz + figures | **PASS — verified by execution** (ordering identical all 94, value diff 0.0; npz exact; PNGs valid & non-blank) | `evidence/shap-global-importance.txt` |
| 8 | Frontend truth (factors from API, no hardcoding) | **PASS — statically verified** | `frontend/src/pages/Valuation.jsx:213,243`; `frontend/src/components/FactorBars.jsx:8-36` |
| 9 | Edge cases (CollgCr serving row; unseen neighborhood; error paths) | **PASS — verified by execution** (no crashes; clean ValueErrors) | `evidence/shap-edge-cases.txt` |
| — | Existing unit tests `tests/ml/test_explainability.py` | **PASS — verified by execution** (11 passed) | `evidence/shap-unit-tests.txt` |

## Details per check

**(2) Additivity** — 5 val rows (iloc 0/50/100/200/337; Ids 6/276/483/883/1455). Aggregated base-space SHAP sum + `expected_value` (12.000341430947) equals `pipeline.predict` to 0.0 error on every row (tolerance was 1e-6). Cross-checks: transformed-space sums equal base-space sums exactly (aggregation is a true partition); `aggregate_shap()` output identical to `RegressionExplainer.explain()`; expected value independently recomputed as `bg_mean·coef + intercept` = 12.000341430947 (matches).

**(3) Aggregation** — val row Id=26 (Neighborhood=NridgHt; 22 NridgHt rows in val). 25 `cat__Neighborhood_*` dummies exist; exactly one active (`cat__Neighborhood_NridgHt`=1.0). Independent dummy-sum −0.005036476538079 == `explain_one(...)["Neighborhood"]` −0.005036476538079 (diff 0.0). Full mapping audit over all 296 transformed columns: an independently written parser agrees with `parse_base_name` on every column; every parsed base ∈ MODEL_FEATURES; all 94 base features covered; no cross-feature leakage in either direction for the Neighborhood bucket; 41 categorical bases all ∈ RAW_INPUT_COLUMNS.

**(4) Sign checks (manual verification)** — synthetic feature-frame rows differing in exactly one cell (asserted). Independent ground truth computed by hand for the linear model (`shap_j = coef_j·(x_j − E[bg_j])`) matches `shap.LinearExplainer` to 0.0.
- `OverallQual` 8 vs 4: coef +0.063; shap **+0.0925** (qual 8) vs −0.0958 (qual 4) — positive and larger for 8 ✔ (pred delta +0.188 log).
- `GrLivArea` 3000 vs 1000: coef +0.037; shap **+0.1072** vs −0.0350 ✔ (pred delta +0.142 log). Caveat: isolated in feature space; in real serving rows `total_sf` and `living_area_per_bedroom` co-vary with `GrLivArea` (documented, not a defect).
- `property_age` 90 vs 2: coef −0.016; shap −0.0272 (old) vs **+0.0202** (new) — age pushes price down ✔ (pred delta −0.047 log).

**(5) explain_instance contract** — 3 real val rows (Ids 6/695/1455) via the production singleton path. Returned dicts have exactly `{feature, impact, magnitude}`; features are base MODEL_FEATURES names (no dummy columns); order, signs, and 6-decimal magnitudes match my independent recomputation exactly; magnitude sums 0.398 / 0.241 / 0.273 — all ≤ 1 as specified.

**(6) Runtime** — fresh process: cold first `explain_instance` (singleton build: joblib load + 200-row background + lazy shap/numba import) = **1768 ms**. Warm ×20 on varying rows: **p50 30.2 ms, mean 32.0, min 24.8, max 45.5, p95 45.0** — the "~50 ms" claim holds (ambient CPU load from concurrent auditors present; numbers still well under the 300 ms budget).

**(7) Global importance & artifacts** — recomputed with the exact stored protocol (val sample n=200, `random_state=42`, 200-row train background): ordering of all 94 features in `models/explainability/feature_importance.json` **identical**, values diff **0.0**; metadata consistent (Ridge, LinearExplainer, bg 200/train, seed 42, feature_version 9b0f8ba4201c). `shap_values_sample.npz`: (200, 94) matrix matches recomputation to 0.0; `feature_names`, `expected_value`, `val_ids` all match. Figures: all four PNGs (figures/ + models/explainability/ copies) have valid PNG signatures, sizes 100,574 B (bar) / 265,383 B (summary), pixel std 0.21 / 0.14, non-white fraction 15.2% / 8.0% — non-trivial, not blank; copies byte-identical in size.

**(8) Frontend truth** — `Valuation.jsx:213` destructures `top_price_factors` from the `/predict` API response; `Valuation.jsx:243` passes it to `FactorBars`. `FactorBars.jsx:8-36` renders exactly the prop (widths normalized to max magnitude in the response). Grep over `frontend/src` for `OverallQual|GrLivArea|Neighborhood_` → **no matches**: no hardcoded factor lists or feature names anywhere in the UI. Backend side: `prediction_service.py:206-208` calls `explain_instance(features, top_n=5)` and passes dicts through (str/float coercion only); any failure → `[]` by design (`prediction_service.py:217-219`).

**(9) Edge cases** — full serving path (`serving_payload_to_raw` → `build_feature_frame` → `explain_instance`) for CollgCr: 5 well-formed factors, magnitude sum 0.259 ≤ 1, no crash. Bonus robustness: a truly unseen neighborhood ("NoSuchPlace", which the API schema would 422) still explains cleanly at the ML layer (geo + stats fallbacks, `handle_unknown="ignore"` all-zero dummies) — no crash. Error paths all raise `ValueError` with actionable messages: multi-row frame, non-DataFrame input, `top_n=0`, missing feature column.

## Findings

| Severity | Location | Finding | Evidence |
|----------|----------|---------|----------|
| P3 | `ml/explainability/service.py:24-25` | Docstring claims warm calls are "single-digit milliseconds"; measured warm p50 is **30.2 ms** (min 24.8). Meets the ~50 ms audit-baseline claim and the 300 ms budget — doc text only is wrong. | `evidence/shap-runtime.txt` |
| P3 | `docs/PROJECT_SPEC.md:203` vs `ml/explainability/service.py:108-114` | SPEC §8 example shows factor `feature` in snake_case (`"overall_qual"`); the API actually returns CamelCase MODEL_FEATURES names (`"OverallQual"`). Related: `frontend/src/format.js:39-62` `KNOWN_LABELS` is keyed by snake_case names that never arrive, so those curated labels are dead code for factor display (generic title-casing handles it). Cosmetic; reconcile naming in the contract doc. | static; `evidence/shap-explain-instance.txt` |
| P3 | `ml/explainability/service.py:111` | `impact` is `"positive"` when shap == 0 exactly (`value >= 0.0`). Immaterial in practice (exact zeros essentially never occur with floating-point SHAP), noted for completeness. | static |

No P0/P1/P2 findings. All mission checks pass.

## Coverage

- **Files read line-by-line:** `ml/explainability/__init__.py`, `ml/explainability/explainer.py` (260/260 lines), `ml/explainability/service.py` (115/115), `ml/explainability/build_artifacts.py` (250/250). Supporting: `ml/features/pipeline.py`, `ml/features/serving.py`, `ml/training/common.py`, `backend/app/services/prediction_service.py` (explain path), `frontend/src/pages/Valuation.jsx`, `frontend/src/components/FactorBars.jsx`, `frontend/src/format.js`.
- **Functions verified by execution:** `parse_base_name` (all 296 columns vs independent parser), `aggregate_shap` (partition + exactness), `RegressionExplainer.__init__` (introspection, background, drift guard), `RegressionExplainer.explain` / `explain_one` (additivity, contract), `explain_instance` (ranking, magnitudes, validation, error paths), `build_artifacts` outputs (feature_importance.json, npz, both PNGs) recomputed bit-exactly.
- **Artifacts verified:** `models/explainability/feature_importance.json`, `shap_values_sample.npz`, `shap_bar.png`, `shap_summary.png` (+ `figures/` copies).
- **Tests:** `tests/ml/test_explainability.py` — 11/11 green (5.38 s).

## Contradictions for the orchestrator

1. `service.py` docstring ("single-digit milliseconds") vs measured 30 ms p50 — and the audit baseline claim "SHAP warm ≈50 ms" is itself only loosely true (p50 30 ms, p95 45 ms). Recommend the docs owner align wording with measurement.
2. SPEC §8 `top_price_factors` example uses snake_case feature names; implementation returns CamelCase MODEL_FEATURES names. Contract agent should confirm which casing the API contract is held to; frontend copes with either.
3. My mission brief called CollgCr a "noise-neighborhood"; it is actually the **most frequent** train neighborhood (98/945 rows). Tested as instructed; additionally tested a genuinely unseen neighborhood at the ML layer (no crash). No action needed beyond the record.
