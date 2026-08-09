# fix-frontend — Wave-C Fix Report

**Agent:** fix-frontend · **Date:** 2026-08-07 · **Owned scope:** `frontend/**` (all source edits).
Regression spec added at `e2e/tests/frontend-fixes.spec.js` (new file, no existing e2e file
modified — mirrors the precedent of `e2e/tests/audit-blackbox.spec.js`; flagged for the
orchestrator since it lives outside `frontend/**`).

## Fixes applied (AUD-id → location → one-liner)

| AUD-id (source findings) | Location | Fix |
|---|---|---|
| **AUD-10** (frontend-static F1, contract C-F1 — execution-verified: stalled API spins forever) | `frontend/src/api/client.js:19,45-70,89-96` | `AbortSignal.timeout(REQUEST_TIMEOUT_MS)` (30 s) on every request; caller signals race it via `AbortSignal.any`; `TimeoutError` → `ApiError("Request timed out after 30 seconds — … Check your connection and try again.", 0)`; `AbortError` rethrown as a cancellation callers swallow. All `api.*` methods accept an optional signal (backwards compatible). |
| AUD-10 (unmount abort) | `frontend/src/api/useApi.js:16-33` | Per-effect `AbortController` passed to the fetcher; cleanup now aborts the in-flight request, not just the setState guard; `AbortError` never surfaces as an error state. |
| AUD-10 (Valuation submit) | `frontend/src/pages/Valuation.jsx:264-281` | Submit binds an `AbortController` (ref); unmount cleanup aborts the in-flight `/predict`; `AbortError` ignored in the catch. Rapid re-submit semantics unchanged (previous request is *not* aborted — keeps blackbox C7 behavior). |
| AUD-10 (fetcher wiring) | `frontend/src/pages/ModelInsights.jsx:222-224`, `frontend/src/pages/MarketMap.jsx:29` | Page fetchers accept and forward the signal. |
| **AUD-24a** (contract C-F2: bare "Top price factors" header when SHAP fails) | `frontend/src/pages/Valuation.jsx:241-253` | Empty/missing `top_price_factors` renders an explicit note: *"Explanation unavailable for this prediction — the estimate, range, and probability above are unaffected."* instead of a bare header. |
| **AUD-24b** (blackbox-e2e F3: "Neighborhood medi…" ellipsis at 390px) | `frontend/src/styles.css:939-945` (inside the existing ≤620px media query) | `.factor-name` wraps (`white-space: normal; overflow: visible; text-overflow: clip`) on narrow screens instead of ellipsizing (touch devices can't hover the `title` tooltip). Desktop styles untouched. |
| **AUD-24c** (frontend-static F6: pill ignores `models_loaded:false`) | `frontend/src/components/Layout.jsx:45-92` + `frontend/src/styles.css:155-158` | New `degraded` pill state: `status==='ok'` but any `models_loaded.* === false` → amber dot + "API degraded" label (tooltip explains). `up`/`down`/`checking` unchanged. |
| **AUD-24d** (monitoring M4: small-n PSI shows a scary red card with no caveat) | `frontend/src/pages/ModelInsights.jsx:182-186` | When the `/metrics` drift payload carries `low_sample: true` (new optional key from the concurrent monitoring fix), the drift card shows a `.drift-note`: *"Low sample — PSI indicative only: too few predictions in the current window for a reliable drift verdict."* Absent key → no note (backwards compatible). |

### Cheap P3s from `docs/audit/frontend-static.md` applied while editing

| Finding | Location | Fix |
|---|---|---|
| F2 (dead 404 special-case — backend returns 503, never 404; stale "integration wave" comment) | `frontend/src/pages/ModelInsights.jsx:1-5,249` | Dead 404 branch removed (error passes through directly); stale header comment corrected. |
| F3 (unguarded `data.neighborhoods.length` / `data.clusters.map` — contract drift would blank the page) | `frontend/src/pages/MarketMap.jsx:32-44,59-65,73,112` | `clusters`/`neighborhoods` memoized with `Array.isArray` guards; missing keys degrade to the documented empty state instead of a TypeError. |
| F5 (advanced integer inputs accepted decimals → late 422) | `frontend/src/pages/Valuation.jsx:158` + `frontend/src/constants.js:90-92,97,99,123` | Advanced number inputs now send `step={1}` by default; the three float schema fields (`lot_frontage`, `garage_area`, `mas_vnr_area`) opt out with `step: 'any'`. |

**F4 (WCAG contrast) deliberately NOT applied:** it requires palette changes (ink-400
2.56:1, white-on-teal button 3.74:1) — a visual-identity decision, not a defect fix, and
outside the "minimal diffs / no behavior changes beyond the fixes" mandate. Recommend the
orchestrator route it to a design decision rather than a wave-C fix.

## Browser-support note (AUD-10 acceptance check)

`AbortSignal.timeout`: Chrome/Edge 103+, Firefox 100+, Safari 16+ (2022). `AbortSignal.any`:
Chrome/Edge 116+, Firefox 124+, Safari 17.4+ (2023–24). Both are Baseline-widely-available
for modern browsers and fine for this portfolio target (Vite 6 + React 19 stack already
requires a modern engine; Playwright Chromium verified at runtime below).

## Test evidence

### Targeted regression tests — `e2e/tests/frontend-fixes.spec.js` (8 tests, all route-intercepted, order-independent)

- AUD-24a: empty factors → note visible, zero `.factor-row` ✓
- AUD-24b: 390×844 viewport → every `.factor-name` `scrollWidth − clientWidth ≤ 1` (no
  truncation); "Neighborhood median price" fully visible; evidence screenshot
  `docs/audit/evidence/fix-frontend-mobile-390.png` (visually re-inspected: name wraps to
  two lines, no ellipsis — before: blackbox-e2e's "Neighborhood medi…") ✓
- AUD-24c: `models_loaded.regression:false` → `.api-status--degraded` "API degraded" ✓;
  control all-true → "API connected" ✓
- AUD-24d: `low_sample:true` → note visible ✓; control (key absent) → no note ✓
- AUD-10 timeout: `/predict` stalled 35 s → `role="alert"` shows "timed out … check your
  connection" at ~30 s (test duration 30.7 s). Before: contract-hang-demo showed the same
  fetch pending >10 s and never settling ✓
- AUD-10 unmount: hanging `/market/clusters`, navigate away → `requestfailed
  net::ERR_ABORTED` observed, zero page errors ✓

### Full Playwright suite (backend :8100 `CORS_ORIGINS=http://localhost:5200`, vite :5200 `VITE_API_URL=http://localhost:8100`)

```
Running 24 tests using 1 worker
  ok  1-11  tests\audit-blackbox.spec.js  (all pre-existing)
  ok 12-16  tests\dashboard.spec.js       (all pre-existing)
  ok 17-24  tests\frontend-fixes.spec.js  (8 new regression tests)
  24 passed (1.7m)
```

Before the fixes the suite was 16 tests; now 24, all green. (First attempt was stopped and
re-run to export `PREDICTION_LOG_PATH` into the Playwright process so the suite's own
backend-respawn in `audit-blackbox.spec.js:343-353` also logs to a temp file — see hygiene.)

### Lint & build

- `npm run lint` → exit 0, zero warnings (two `react-hooks/exhaustive-deps` warnings from the
  first MarketMap guard draft were fixed by memoizing the guards).
- `npm run build` → exit 0, 763 modules, 4.55 s (chunks: index 312.5 kB / 99.0 kB gzip,
  MarketMap 158.5 kB, ModelInsights 389.3 kB, useApi 0.49 kB). Side effect: `frontend/dist/`
  regenerated (generated output, not source — same as during the audit).

### Full Python suite

- `.venv/Scripts/python.exe -m pytest tests backend/tests -q` → **3 failed, 189 passed**.
  My diff contains zero Python changes. The 3 failures are all in the concurrent
  fix-monitoring agent's scope and reproduce independently of my work:
  - `tests/ml/test_monitoring.py::test_drift_check_empty_and_invalid_lines` —
    `assert report["n_invalid_lines"] == 4` got 3 (AUD-25 blank-line counting, mid-edit).
  - `tests/integration/test_end_to_end.py::test_drift_pipeline_clean_window_no_drift` —
    `drift_detected is False` got True (AUD-06/07 PSI changes, mid-edit).
  - `tests/integration/test_end_to_end.py::test_drift_pipeline_shifted_window_flags_drift` — same area.
  Their todo list showed test updates still in progress at my completion time; orchestrator
  should re-run the full suite after fix-monitoring lands. Frontend-only baseline claim: with
  my changes alone, no Python test result changes.

## Hygiene

- **Ports:** 8100 and 5200 verified free before and after (`netstat -ano` → no LISTENING).
  Vite child survived the npm-wrapper stop (known issue from blackbox-e2e) → killed by PID
  19896 via `taskkill /F`. Backend on 8100 was taskkilled by the suite itself
  (dashboard.spec.js final test), as designed.
- **`logs/predictions.jsonl` untouched:** my backend ran with
  `PREDICTION_LOG_PATH=$TMPDIR/fix-frontend-predictions.jsonl` (17 prediction lines landed in
  the temp file). One stray line appended during the first (stopped) Playwright attempt —
  when the suite's respawned backend lacked the env var — was removed after verifying
  `head -19` hashed byte-identical to the pre-run baseline; final state sha256
  `6972fb1452b45a8ea455dc4a6ecba87dd82aa553478d75747e60349cafafcf1b` (19 lines), identical
  to baseline.
- **Side effects disclosed:** `frontend/dist/` regenerated by the mandated build;
  `docs/screenshots/*.png` regenerated by the sanctioned existing suite (its `shot()`
  helper — same as the audit waves); new evidence file
  `docs/audit/evidence/fix-frontend-mobile-390.png`.

## Notes for the orchestrator

1. `e2e/tests/frontend-fixes.spec.js` is the only file I added outside `frontend/**` (new
   file; no existing e2e file touched). Move it under a different owner if desired — it is
   self-contained.
2. AUD-24d is forward-compatible: the note renders only when `low_sample === true`; today's
   backend (monitoring fix in flight) omits the key and the UI is unchanged (control test
   proves it). Once fix-monitoring's `_ok_report` lands the key, the note appears.
3. F4 contrast fixes deferred (design decision, see above).
4. The timeout test adds ~31 s wall-clock to the e2e suite (it must outwait the real 30 s
   `AbortSignal.timeout`); suite total is 1.7 m.
