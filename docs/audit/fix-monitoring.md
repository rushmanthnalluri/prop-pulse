# Fix Report — fix-monitoring (Wave C)

**Agent:** fix-monitoring · **Date:** 2026-08-07 · **Scope:** `ml/monitoring/**`,
`tests/ml/test_monitoring.py`, `models/monitoring/reference_stats.json`,
`reports/drift/latest.json` (+ one forced two-line key-set update in
`tests/integration/test_end_to_end.py`, see §6).

**Findings fixed:** AUD-06, AUD-07, AUD-08, AUD-25 (+ the orchestrator-assigned
`low_sample` report key). Sources: `docs/audit/FINDINGS.md`,
`docs/audit/monitoring.md` (M1–M3, M5 + wave-A observation),
`docs/audit/llba-ml-services.md` (F1, F4).

---

## 1. AUD-06 — degenerate-bin PSI blind spot (P2)

**Defect (FINDINGS.md AUD-06):** "PSI blind spot: 6 numeric features collapse to
1 bin → PSI ≡ 0 even for extreme out-of-range values."

**Before (executed against the pre-fix artifact):**

```
BEFORE PoolArea bin_edges: [0.0, 738.0]          # 2 edges → single [-inf,+inf] bin
BEFORE PoolArea expected_proportions: [1.0]
BEFORE all-9999999 proportions: [1.0]
BEFORE PoolArea PSI(all-9999999): 0.0            # blind even to range-breaking values
```

**Fix:**

- `ml/monitoring/psi.py:110` — new `_midpoint_edges()`: when unique quantile
  edges collapse below two bins (`psi_bins_from_train`, `psi.py:177-179`), a
  midpoint cut separates the **modal** value from the rest of the mass (two cuts
  if the mode is interior). Design note: an earlier iteration spread up to
  `n_bins-1` cuts across the distinct tail values; that gave each tail bin an
  expected mass of ~1/945 rows, and the integration suite's clean 189-row window
  tripped `ScreenPorch` at PSI 0.221 (pure sampling noise). Collapsed quantiles
  imply a dominant tie with a sparse tail, so the modal split is the only
  noise-robust binning; the trade-off (no intra-tail sensitivity) is the
  documented "reduced sensitivity".
- `ml/monitoring/psi.py:130` — new public `degenerate_binning(values, n_bins)`:
  True when quantile binning collapses below two bins.
- `ml/monitoring/reference.py:117` — every numeric feature in
  `reference_stats.json` now carries `"degenerate": true|false`; the module
  docstring (`reference.py:6-10`) documents the reduced sensitivity.
- `models/monitoring/reference_stats.json` regenerated
  (`python -m ml.monitoring.reference`; sha256
  `c5b16cb4d7b905c0914b285f79c03ca1de2ae58fa851af050861a17dd066d8dc`).

**After (executed against the regenerated artifact):**

```
degenerate: ['3SsnPorch','BsmtHalfBath','LowQualFinSF','MiscVal','PoolArea','ScreenPorch']
PoolArea edges: [0.0, 256.0, 738.0] | expected: [0.99365, 0.00635]
AFTER PoolArea PSI(all-9999999): 18.748747276743167   # > 0.2 (was exactly 0.0)
AFTER PoolArea PSI(all-500 in-range shift): 20.6 (first fallback iteration) / same path
features with <2 bins remaining: []
```

The six marked features are exactly the audit's blind-spot census (monitoring.md
M1 / llba-ml-services F1). In the regenerated live `reports/drift/latest.json`
the six features now report real PSI values instead of hard 0.0
(`PoolArea 0.0556, MiscVal 0.3060, ScreenPorch 0.8756, 3SsnPorch 0.1651,
LowQualFinSF 0.1881, BsmtHalfBath 0.7192` on the current 19-line window).

**Regression tests:** `test_psi_bins_from_train_handles_duplicate_edges`
(rewritten: fallback ≥3 edges, zero-mass separation, PSI > threshold for both
in-range 500.0 and out-of-range 9 999 999.0 production),
`test_degenerate_binning_flags_collapsed_quantiles`,
`test_reference_builder_marks_degenerate_features` (exact six-feature set +
PoolArea blind-spot proof), edge-count floor tightened to ≥3 in
`test_reference_builder_covers_all_numeric_model_features`.

## 2. AUD-07 — calendar-drift false positive (P2)

**Defect (FINDINGS.md AUD-07):** "Calendar features alone
(YrSold/sale_year/property_age/…) flip `retraining_recommended=true` at n≥200 —
false positive, literally present in API.md example."

**Fix:** `ml/monitoring/drift_check.py:68` — new `CALENDAR_FEATURES` frozenset
{YrSold, MoSold, sale_year, sale_month, sale_quarter, property_age,
years_since_remod}. `_ok_report` (`drift_check.py:391-398`) splits drifted
features into calendar / non-calendar; `retraining_recommended` now requires
**at least one non-calendar** drifted feature AND n ≥ 200. The report gains
`"calendar_drift_features"` (list) so the signal stays visible, and
`_recommendation_text` (`drift_check.py:446-455`) has a dedicated calendar-only
branch explaining the structural cause. `drift_detected` itself is unchanged
(drift is still reported).

**Proof by execution** — n=250 today-dated (2026-08) rows, non-calendar features
sampled from train (seed 42), run through `run_drift_check`:

```
n_predictions: 250
drifted_features: ['MoSold','YrSold','property_age','sale_month','sale_quarter','sale_year','years_since_remod']
calendar_drift_features: (same 7)
non-calendar drifted: []
drift_detected: True
retraining_recommended: False        # pre-fix guard (drift AND n>=200) → True (monitoring-07-calendar.txt §C)
text: "Drift detected only in calendar-derived feature(s) … does NOT recommend retraining …"
```

Control: the same n=250 sample with GrLivArea ×3 (non-calendar) still yields
`retraining_recommended: True` — the guard is calendar-specific.

**Regression tests:** `test_drift_check_calendar_only_drift_never_recommends_retraining`,
`test_drift_check_non_calendar_drift_at_min_sample_still_recommends`.

## 3. AUD-08 — `DRIFT_PSI_THRESHOLD` dead wire (P3)

**Defect (FINDINGS.md AUD-08):** "`DRIFT_PSI_THRESHOLD` env parsed but never
used; README claims configurability."

**Fix:** `ml/monitoring/drift_check.py:100` — new `psi_drift_threshold()` reads
`os.environ["DRIFT_PSI_THRESHOLD"]` per run, with validation (unset/empty,
non-numeric, non-finite or ≤ 0 → warning + SPEC §10 default 0.2).
`run_drift_check` threads the effective value into the report's `psi_threshold`,
the drifted/warn comparisons, and the recommendation text. Verified live:

```
$ DRIFT_PSI_THRESHOLD=0.75 python -m ml.monitoring.drift_check …
psi_threshold with DRIFT_PSI_THRESHOLD=0.75 -> 0.75 | status: no_data
```

README.md:373's claim is now true (the README wording itself is the docs agent's
AUD-27 scope).

**Regression tests:** `test_drift_threshold_env_override_raises_bar` (50.0 →
GrLivArea×3 drops out of `drifted_features` into `warn_features`),
`test_drift_threshold_env_override_lowers_bar` (0.05),
`test_drift_threshold_env_invalid_falls_back_to_default` (parametrized:
"not-a-number", "-1", "0", "nan", "inf", "").

## 4. AUD-25 — runpy warning, corrupt reference, blank-line counting (P3)

**Defect (FINDINGS.md AUD-25):** "runpy RuntimeWarning on
`python -m ml.monitoring.*`; corrupt reference → uncaught ValueError; blank-line
counting docstring mismatch."

**Fixes:**

1. **runpy RuntimeWarning** — `ml/monitoring/__init__.py` rewritten to lazy
   PEP 562 exports (mirrors `ml/clustering/__init__.py`); the package no longer
   imports submodules at package-import time. Verified:
   `python -W error::RuntimeWarning -m ml.monitoring.drift_check …` exits 0 with
   a clean stderr (before: `<frozen runpy>:130: RuntimeWarning: 'ml.monitoring.drift_check'
   found in sys.modules …`, monitoring.md M5). All 24 `__all__` names resolve;
   unknown names raise AttributeError.
2. **Corrupt reference → clean structured error** — `load_reference_stats`
   (`reference.py:189`) now validates the artifact at load: invalid JSON,
   non-dict payload, non-dict `numeric`, and per-feature malformed
   `bin_edges`/`expected_proportions` all raise `ValueError("corrupt drift
   reference <path>: feature '<name>' …")` naming the feature and the problem;
   the CLI catches it (`drift_check.py:516-519`) and exits 2 with a one-line
   logged error instead of a traceback (llba-ml-services F4). Verified:

   ```
   $ python -m ml.monitoring.drift_check --reference corrupt-ref.json …
   exit=2
   stderr: ERROR __main__: corrupt drift reference …: feature 'GrLivArea'
           bin_edges must be a list of >= 2 finite, strictly increasing numbers
   ```

   Additive CLI flags `--reference` / `--output` (defaults unchanged) make this
   path testable without touching repo artifacts.
3. **Blank-line counting aligned with the docstring** — `read_prediction_window`
   (`drift_check.py:150-154`): blank lines are now skipped **and counted** in
   `n_invalid`, matching the documented "skipped and counted" contract.

**Regression tests:** `test_load_reference_stats_corrupt_raises_structured_error`
(7 parametrized corrupt payloads), `test_drift_check_corrupt_reference_is_clean_error_not_traceback`
(library-level ValueError + subprocess CLI exit 2, "corrupt drift reference" in
stderr, no "Traceback"), `test_cli_no_runpy_warning_and_exit_zero_on_no_data`
(subprocess: no "RuntimeWarning" in stderr), `test_drift_check_empty_and_invalid_lines`
(updated: crafted log with one real blank line → `n_invalid_lines == 4`, was 3).

## 5. `low_sample` report key (orchestrator assignment)

`drift_check.py:61` — `LOW_SAMPLE_THRESHOLD = 50`. Both report builders now
always emit `"low_sample"`: `_ok_report` sets it to `n_predictions < 50`
(`drift_check.py:402`); `_no_data_report` sets `true` (0 predictions). All other
report keys are unchanged, so the frontend/backend passthrough schema is stable;
the frontend (AUD-24) reads this key for its low-sample note.

## 6. Out-of-owned-files change (forced, flagged)

`tests/integration/test_end_to_end.py:292-313` — the mandated new report keys
(`low_sample`, `calendar_drift_features`) are asserted by that test's exact
report key-set check, so the expected set gained exactly those two keys. No
other out-of-scope file was touched.

## 7. Test evidence

- `pytest tests/ml/test_monitoring.py -q` → **40 passed** (pre-fix file had 19
  tests; the mixed-lines assertion updated 3→4 invalid for the blank-line fix).
- `pytest tests -q` → **157 passed**.
- Full suite `pytest tests backend/tests -q` → **208 passed, 2 failed**; both
  failures are `backend/tests/test_audit_fixes.py`
  (`test_sklearn_parallel_warning_filter_installed` — AUD-11, and
  `test_model_endpoints_have_response_models` — AUD-18), owned by the
  concurrently running fix-backend agent whose work is mid-flight; neither
  touches `ml/monitoring` or the drift artifacts. Re-verified in isolation:
  same 2 failures with identical assertions.
- `tests/integration/test_end_to_end.py` (incl. the two drift pipeline tests
  that caught the first fallback's small-window noise) → green.

## 8. Regenerated artifacts

- `models/monitoring/reference_stats.json` — regenerated from the train split
  (945 rows, 53 numeric + 4 categorical features; `feature_version` unchanged
  `9b0f8ba4201c`).
- `reports/drift/latest.json` — regenerated via `python -m ml.monitoring.drift_check`.
  **Deviation from assignment expectation:** the assignment expected
  `status: no_data` against an "empty-ish" log, but `logs/predictions.jsonl`
  still contains **19 valid lines** at regeneration time (sha256
  `6972fb1452b45a8ea455dc4a6ecba87dd82aa553478d75747e60349cafafcf1b`, unchanged
  through my session; never written by me — hard rule). The honest regenerated
  report is `status: ok, n_predictions: 19, low_sample: true,
  retraining_recommended: false` with the seven calendar features bucketed in
  `calendar_drift_features`. After the orchestrator resets the log, re-running
  `python -m ml.monitoring.drift_check` yields the `no_data` report (verified:
  missing/empty log → `no_data`, exit 0, `low_sample: true`).

## 9. Notes for the orchestrator

- The first AUD-06 fallback iteration (midpoint cuts across all distinct tail
  values) was execution-caught by the integration clean-window test as
  small-window noise (ScreenPorch PSI 0.221 on 189 in-distribution rows); the
  shipped modal-split fallback keeps ≥0.6% expected mass per bin and is
  noise-robust at n≈200 while still proving PSI 18.75 on extreme outliers.
- `logs/predictions.jsonl` was never modified (sha256 constant
  `6972fb14…` across the session).
- No server was needed; port 8700 untouched.
- Docs claiming the old behavior (README threshold claim now true; API.md:94's
  `retraining_recommended: true` example is now stale — it shows calendar-only
  drift) belong to the docs agent's AUD-27 scope; DECISIONS.md calendar-guard
  note likewise.
