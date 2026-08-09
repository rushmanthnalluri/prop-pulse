# test-audit — Testing audit (mission §18)

Date: 2026-08-07 · Auditor: test-audit · Mode: report-only
Scope: `tests/**`, `backend/tests/**`, `e2e/tests/**`, `pytest.ini`, `conftest.py`.
Evidence: `docs/audit/evidence/test-run.txt`, `docs/audit/evidence/test-audit-coverage.txt`,
`docs/audit/evidence/.coverage-test-audit` (coverage data file).

## 1. Headline verdict

| Claim | Verdict | Evidence |
|---|---|---|
| "162 tests pass" | **PASS — verified by execution** (twice: 162 passed / 35.00s; 162 passed / 38.15s under coverage) | evidence/test-run.txt RUN 1, RUN 5 |
| Integration marker runs separately | **PASS — verified by execution** (`-m integration` → 8 passed, 154 deselected, 10.82s) | evidence/test-run.txt RUN 2 |
| e2e not counted in the 162 | **PASS — statically verified** (`pytest.ini:3` testpaths = `tests backend/tests`; e2e is JavaScript) | pytest.ini:3 |
| e2e has real assertions | **PASS — statically verified** (5 tests, substantive DOM/value assertions) | e2e/tests/dashboard.spec.js:68-189 |
| Test suite is meaningful overall | **PASS WITH CONCERN** — no vacuous tests found; several weak spots (§4, §5) | this file |

The suite is unusually strong for a project of this size: hand-computed PSI proofs,
byte-identity regression guards on the data pipeline, threshold recomputation from the
registry artifact, train-only leakage probes, and HTTP-vs-in-process parity checks.
No `assert True`, no status-200-only tests (every 200 assertion is followed by body/range
checks), no mocking of the system under test (mocks are used only as *detonators* in
`test_latency_fixes.py` to prove components are skipped).

## 2. Per-file strength table

| File (tests) | What it really asserts | Mocks / isolation | Strength |
|---|---|---|---|
| tests/data/test_data_pipeline.py (10) | Processed splits exist, pass `validate_processed`, exact split years {06-08/09/10}, zero Id overlap within/across splits, dup-Id rejection, lat/long bounds, DOM∈[1,365] and flag == (dom≤30), SalePrice plausibility, total rows == raw − outlier trims | None — reads real processed CSVs | **Strong** |
| tests/data/test_dom_adapter.py (20) | RealDomProvider: 7 strict-validation rejections, Id-aligned (not order-aligned) transform, coverage error message contents, median fill + warning, determinism; provider selection env matrix; **full pipeline re-run into tmp dir, targets equal fixture CSV, and byte-identical md5 vs committed CSVs** | tmp_path output dirs; env via monkeypatch | **Strong** (exemplary regression guard) |
| tests/features/test_features.py (14) | RAW_INPUT_COLUMNS excludes leakage cols; MODEL_FEATURES composition + uniqueness; build_feature_frame on all splits → exact column list/order, zero NaN; engineered values hand-verified (total_bath, property_age, total_sf, sale_quarter, haversine bound); zero-bedroom guard; stats=None artifact path; **train-only stats proven by showing full-data medians differ**; unseen-neighborhood fallback exactness; serving payload round-trip incl. centroid lookup + unknown-field rejection; feature_list.json == MODEL_FEATURES + sha1 | None | **Strong** |
| tests/features/test_geo_override.py (12) | Per-property geo override applied by Id, distance recomputed, equivalence with patched input frame; unmatched rows byte-identical to centroid baseline; no-Id serving rows ignore override; 5 parametrized invalid-file rejections; absent-file byte-identical output | monkeypatched `_PROPERTY_GEO_PATH`; tmp files (cache keyed on path — safe) | **Strong** |
| tests/ml/test_regression.py (5) | 5 joblibs + metrics.json exist; each loaded pipeline predicts finite, in-range (log space 8–16) on 5 val rows; metrics.json schema + finite metrics + residual interval straddles 0; smoke LinearRegression re-fit on 200 rows; no absolute paths leaked | None — real artifacts | Moderate (shape/sanity, not metric equality) |
| tests/ml/test_classification.py (7) | 8 joblibs load with predict_proba; calibrated probas finite ∈[0,1]; metrics.json complete, confusion matrices sum to 338 val rows; calibrated Brier < 0.25; calibration doesn't hurt Brier (+0.02); smoke LR re-fit | None — real artifacts | Moderate-Strong |
| tests/ml/test_clustering.py (9) | Artifacts/figures exist; 25-row matrix with ADR-9 columns; assignments cover exactly the 25 geo neighborhoods; cluster_stats consistent with assignments incl. member cross-check; **persisted DBSCAN+scaler reproduce cluster_assignments.csv exactly**; lookup: direct hit, noise fallback, unknown fallback | None | **Strong** |
| tests/ml/test_evaluation.py (14) | select.py pure logic on synthetic inputs (ranking, calibrated-only selection, F1 threshold on separable data, bootstrap determinism + sign); champion.json SPEC §6 schema; paths relative + exist; **champion == val argmin/argmax recomputed from metrics.jsons**; bootstrap block; **threshold + val F1/precision/recall recomputed from registry champion within 1e-6**; test-metric sanity bars; prediction_reference decile structure; report sections | None | **Strong** (but see F2 — bars are loose) |
| tests/ml/test_explainability.py (11) | Artifacts exist + figures non-trivial (>10 KB); importance keys are base features (no dummy leak), sorted, finite; metadata pins champion/path/seed/feature-version; npz shape/finiteness/distinct ids; parse_base_name cases; **SHAP additivity: sum+expected == champion prediction (1e-6)**; missing-model RuntimeError; service contract (5 dicts, exact keys, magnitudes sorted, sum ≤ 1); input validation; warm latency < 300 ms (see F4); OverallQual direction vs ridge coefficient | None — real ridge champion | **Strong** |
| tests/ml/test_monitoring.py (19) | PSI == closed form (1e-12) + known value; identical→0; same-dist small; shifted large; count input + empty-bin clipping; rejections; quantile bins incl. duplicate-edge + constant-feature degenerate; out-of-range→edge bins; junk dropped; reference builder covers all numeric MODEL_FEATURES (945 rows) + 4 key categoricals; drift_check: in-dist clean (PSI 0), shifted GrLivArea flagged with <200 blocking retraining, missing/empty log → no_data, invalid-line counting, prediction-PSI sectioned schema | tmp_path logs/reports only | **Strong** |
| tests/integration/test_end_to_end.py (8) | (a) HTTP /predict == direct in-process computation (price abs 0.01, proba 1e-6) incl. threshold-flag consistency; (b) app serves exactly champion.json's registry paths + name/version; (c) /market/clusters covers all 25 neighborhoods, members ∪ fallbacks == all; (d) drift E2E incl. exact report key set, clean window, shifted window flags ONLY GrLivArea, missing log; (e) feature determinism (frame-equal twice); (f) real-log append with backup/restore (see F5) | None — real champions via TestClient; tmp logs except (f) | **Strong** |
| backend/tests/test_api.py (17) | /health; /predict minimal+full payload with range/shape checks + exact model_version + feature_version len; 6 validation rejections (bad enum, negative area, qual 99, unknown neighborhood, unknown field, missing required); narrow endpoints; /model/info incl. hardcoded champion names + threshold ≈0.203292; /market/clusters shape + 25 points; /metrics (see F1); prediction-log schema on tmp log; /model/importance exact keys + top driver OverallQual; missing-artifact → cached 503 | tmp prediction log; real artifacts | **Strong** |
| backend/tests/test_latency_fixes.py (8) | n_jobs=1 pinned on all 5 calibrated folds; force_single_threaded prediction-identical (1e-12 + 6-dp exact); narrow endpoints provably skip classifier/regressor/SHAP via detonator doubles; narrow == full values; SHAP warmed at startup (see F3); static GETs serve startup cache (tamper-proof) | `_Exploding` doubles + monkeypatch — used to prove non-use, not to fake behavior | **Strong** conceptually; F3 caveat |
| backend/tests/test_security.py (10) | Security headers on 200/422/404/413/500; 64 KiB body limit both sides of boundary; forced-500 shape `{"detail": "Internal server error"}` with sentinel + "Traceback" absence; malformed JSON; abuse battery (huge numbers, type confusion, unicode bombs, nested extras) | Own app instance for the boom route | **Strong** |
| e2e/tests/dashboard.spec.js (5) | Valuation flow (price regex, band bounds, probability %, non-empty micro-market, exactly 5 factors); 422 surfaced with field name; map ≥20 markers + popup cluster stats; insights (champion names, ≥10 SHAP bars, drift panel either state); API-down degraded state with proof the backend was killed | Real Chromium against live :8100/:5200 | **Strong**; flaky risks F7 |

Total: 162 Python tests (14 files) + 5 Playwright tests.

## 3. Targeted verification — would the suite catch…?

- **Feature-order mismatch → CAUGHT (and structurally prevented).** `ml/training/common.py:40-41`
  selects columns *by name*, so DataFrame column order is harmless. A name/list change is
  caught by tests/features/test_features.py:87 (`list(ff.columns) == MODEL_FEATURES`,
  order-sensitive) and :290-293 (feature_list.json == MODEL_FEATURES + sha1). Serving uses
  the same `build_feature_frame` on both sides of the parity test
  (tests/integration/test_end_to_end.py:112-138).
- **Wrong threshold → CAUGHT.** tests/ml/test_evaluation.py:223-239 recomputes
  `pick_f1_threshold` from the registry champion on the full val split and matches
  champion.json within 1e-6 (plus F1/precision/recall). backend/tests/test_api.py:211,223
  hardcode ≈0.203292. The integration parity test re-derives the boolean flag from the
  threshold (test_end_to_end.py:136-138).
- **Broken fallback → CAUGHT.** Unseen-neighborhood stats fallback with exact fallback
  values (test_features.py:166-182); cluster noise + unknown-neighborhood fallbacks
  (test_clustering.py:155-172); geo-override fallbacks (test_geo_override.py:87-118);
  drift no_data (test_monitoring.py:300-313, test_end_to_end.py:349-359); importance 503
  (test_api.py:298-311).
- **NaN in features → CAUGHT.** Zero-NaN asserts on all three splits
  (test_features.py:82-92), zero-bedroom guard (:111-116), serving round-trip (:209-236),
  stats=None path (:119-123).
- **Champion metric regression → PARTIALLY caught — weak (F2).** Only loose sanity bars:
  R²>0.6, 0<RMSLE<0.3, ROC-AUC>0.55, Brier≤0.25 (test_evaluation.py:247-265) against actual
  metrics R² 0.9305 / RMSLE 0.1187 / AUC 0.7666 / Brier 0.1710. No test recomputes
  val/test metrics from the artifacts (only the threshold and its derived P/R/F1 are
  recomputed). A stale or hand-edited champion.json with badly degraded metrics still
  passes if it clears these bars and stays self-consistent with metrics.json.

## 4. Flaky-pattern audit

- **F1 (P3) — order dependence, verified by execution:** `backend/tests/test_api.py::test_metrics`
  **fails standalone** (`assert 0 >= 1`). Middleware records after `call_next`
  (backend/app/monitoring/middleware.py:23-30), so /metrics never counts itself; the test
  relies on earlier tests sharing the module-scoped client (test_api.py:255 comment admits
  it). Passes in the full suite; fails under `-k`/single-test selection or test shuffling.
- **F3 (P3) — shared process-global makes a test vacuous in-suite:**
  test_latency_fixes.py:189-193 asserts `ml.explainability.service._explainer is not None`.
  `_explainer` is a module global (ml/explainability/service.py:49-60) and
  tests/ml/test_explainability.py (collected before backend/tests per pytest.ini testpaths
  order) warms it via `explain_instance`. In the default full-suite run the assertion
  passes even if the lifespan warm-up (backend/app/main.py:141-153) is deleted — the test
  only has teeth standalone.
- **F4 (P3) — wall-clock assertion:** test_explainability.py:191-200 asserts warm
  `explain_instance` < 300 ms (max of 5). Real SHAP computation on shared/loaded CI
  hardware (concurrent audit agents observed during this audit) can spike; no marker or
  skip-guard. It passed in both my runs; treat as flaky-prone.
- **F5 (P3) — real-log write with backup/restore:** test_end_to_end.py:390-436 appends to
  the real `logs/predictions.jsonl`. Backup/restore itself is correct (byte-copy,
  try/finally, unlink-if-absent). But the `+1 line` assertion and the byte-restore race
  with any concurrently running live server appending to the same file — a real hazard
  during this multi-agent audit (wave B runs live servers), benign in CI. The test also
  hardcodes `model_version == "ridge_v1+random_forest_v1"` (line 431) — a deliberate
  champion pin, but it will fail on any legitimate champion change (same pin at
  backend/tests/test_api.py:134-135, 279).
- **No port assumptions in pytest** (all in-process TestClient). **No time-of-day
  dependence.** **No MLflow/mlruns state dependence** (grep-verified; only
  `ml.tracking.feature_version`, a file hash, ml/tracking.py:37-40). **No random-ordering
  plugin installed.** Module-scoped app fixtures are mutated only via function-scoped
  `monkeypatch` (auto-reverted) — no cross-test leakage observed within pytest.
- **e2e (F7, P3):** deliberate order dependence (workers: 1; the LAST test kills the
  backend — playwright.config.js:16, dashboard.spec.js:173-189); `waitForTimeout(2500)`
  for OSM tiles (screenshot cosmetics only, :141); `killPort` runs `taskkill /F` on
  *whatever* listens on 8100 (:46-66) — correct only if the port is truly exclusive.

## 5. Coverage (measured, not reported)

pytest-cov was **not installed**; I installed pytest-cov 7.1.0 + coverage 7.15.4 into
`.venv` (mission-sanctioned). Command and full table: evidence/test-run.txt RUN 5 and
evidence/test-audit-coverage.txt. Data file redirected into evidence/ so no stray
`.coverage` pollutes the repo root.

**TOTAL: 69% (2871 statements, 886 missed).** Backend: 84–100% per file. ml: serving-side
modules 82–100%; **training/evaluation entry points are the uncovered mass**:

| Module | Cover | Note |
|---|---|---|
| ml/clustering/train.py | **0%** (280 stmts) | CLI never executed by tests; artifact-reproduction test covers only DBSCAN+scaler reload |
| ml/training/train_classification.py | 31% | trainer body untested (search/calibration loops) |
| ml/evaluation/evaluate.py | 32% | report/champion writing untested |
| ml/explainability/build_artifacts.py | 32% | figure/npz generation untested |
| ml/tracking.py | 43% | `track_run` MLflow wrapper untested (lines 51-88) |
| ml/training/train_regression.py | 45% | trainer body untested |
| ml/features/defaults.py | 50% | defaults-computation helper paths |
| ml/training/common.py | 68% | CV/search helpers |

This is the classic artifact-testing trade-off: outputs of the trainers are heavily
tested, the trainer code paths that produce them are not — except the data pipeline, which
has a byte-identity re-run guard (test_dom_adapter.py:281-286) the model waves lack.

## 6. Findings

| # | Sev | Location | Finding | Evidence |
|---|---|---|---|---|
| F1 | P3 | backend/tests/test_api.py:250-258 (+ monitoring/middleware.py:23-30) | `test_metrics` is order-dependent: passes in-suite, FAILS standalone (`assert 0 >= 1`) | evidence/test-run.txt RUN 4 (verified by execution) |
| F2 | P2 | tests/ml/test_evaluation.py:247-265 | Champion-metric regression guard is only loose sanity bars (R²>0.6, RMSLE<0.3, AUC>0.55, Brier≤0.25) vs actual 0.9305/0.1187/0.7666/0.1710; test metrics never recomputed from artifacts — a degraded-but-plausible champion.json passes | statically verified; bars vs reports/MODEL_EVALUATION.md values |
| F3 | P3 | backend/tests/test_latency_fixes.py:189-193 (+ ml/explainability/service.py:49-60) | SHAP-warm test is vacuous in default suite ordering: process-global `_explainer` is already set by tests/ml/test_explainability.py, so removing the lifespan warm-up would not fail the suite | statically verified |
| F4 | P3 | tests/ml/test_explainability.py:191-200 | Wall-clock assert (<300 ms warm SHAP) is flaky-prone under shared CPU load | statically verified |
| F5 | P3 | tests/integration/test_end_to_end.py:390-436 | Real-log test races with any concurrent live server writing logs/predictions.jsonl (false failure + clobbered lines on restore); hardcodes champion version string | statically verified |
| F6 | P3 | ml/clustering/train.py, ml/training/train_*.py, ml/evaluation/evaluate.py, ml/explainability/build_artifacts.py, ml/tracking.py | Training/eval/tracking entry points 0–45% covered; no trainer re-run reproduction guard (unlike the data pipeline's byte-identity test) | evidence/test-audit-coverage.txt (verified by execution) |
| F7 | P3 | e2e/tests/dashboard.spec.js:46-66,141,173-189 | e2e flaky/hazard patterns: taskkill /F on any :8100 listener, fixed 2.5 s tile wait, deliberate order dependence | statically verified |

No P0/P1 findings. The suite genuinely tests behavior; the gaps are in regression-guard
strength (F2), trainer-code coverage (F6), and a few isolation hazards (F1, F3, F5).

## 7. What previous QA's "PASS" didn't say

- 162 is real and reproducible — but ~1/3 of `ml/` statements (trainers/evaluators) run
  zero times under the suite; the green badge covers artifacts, not the code that makes them.
- One test fails the moment you select it individually (F1); another cannot fail in the
  default ordering even if the feature it guards is removed (F3).

## 8. Reconciliation notes for the orchestrator

- pytest-cov/coverage now exist in `.venv` (installed by this audit) — other agents
  assuming a pristine venv package set should be told.
- Coverage data file lives at docs/audit/evidence/.coverage-test-audit (not repo root).
- If wave-B agents run live servers while the integration suite re-runs,
  test_end_to_end.py:390-436 may fail spuriously (F5) — sequence re-runs away from live
  servers rather than treating it as a product bug.
- The champion-version pins ("ridge_v1", "random_forest_v1", threshold ≈0.203292) in
  backend tests will intentionally break if wave C changes champions — update tests in the
  same change, not after.
