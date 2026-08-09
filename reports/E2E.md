# PropPulse — End-to-End (Playwright) Test Report

> **WP-7a integration-hardening addendum (2026-08-08):** the suite was
> rewritten for the rebuilt UI (routes `/` Overview, `/valuation`, `/market`,
> `/model`, `/health`; panel-based valuation rail; 7-lever what-if explorer;
> drift on `/health`). E2E ports moved **5200/8100 → 5300/8200** so the suite
> never kills servers owned by other work streams:
>
> ```bash
> # terminal 1 (repo root)
> CORS_ORIGINS=http://localhost:5300 .venv/Scripts/python.exe -m uvicorn backend.app.main:app --port 8200
> # terminal 2 (repo root)
> cd frontend && VITE_API_URL=http://localhost:8200 npm run dev -- --port 5300 --strictPort
> # terminal 3 — once /health and / both respond
> cd e2e && npx playwright test
> ```
>
> Suite is now **3 spec files / 30 tests**: `audit-blackbox.spec.js` (11),
> `dashboard.spec.js` (9 — overview + health pages added), `frontend-fixes.spec.js`
> (10 — WP-7a signal-free-cache regression test + mocked server-422 field
> mapping added; the old "unmount aborts the clusters request" assertion
> tested behavior WP-7a deliberately removed). The race test now reflects the
> abort-supersede submit pipeline (4 of 5 requests are cancelled client-side).
> One real UI bug was found and fixed: `.factor-name` had regressed to
> ellipsis truncation (`styles.css`) — names wrap again (AUD-24b). Everything
> below this note describes the pre-rebuild run and is kept for history.

**Date:** 2026-08-08 · **Agent:** playwright-e2e · **Status:** ✅ 27/27 tests passing (3 spec files)

> **UI-refresh reconciliation (2026-08-08):** the suite was re-run against the
> refreshed UI and reconciled where the UI legitimately changed. Suite is now
> **3 spec files / 27 tests**: `dashboard.spec.js` (7), `audit-blackbox.spec.js`
> (11), `frontend-fixes.spec.js` (9). Changes made (no frontend/backend code
> was touched — tests only):
>
> - `audit-blackbox.spec.js` *trace-truth*: probability badge text updated to
>   `Fast-sale signal (simulated target)`; micro-market card now asserts the
>   **three** remaining stats (the "Neighborhoods: N" row was removed) plus the
>   always-visible cluster-note caption; the removed model-version footer is
>   replaced by the `About this estimate → /model-insights` link assertion;
>   **added** byte-equal checks for the new `confidence` note and the
>   `market_position` strip (aria-label + vs-median line), keeping the test's
>   "DOM renders exactly the intercepted JSON" contract.
> - `audit-blackbox.spec.js` *noise neighborhoods*: `getByLabel('Neighborhood')`
>   now scoped to `.form-card` — the new market-position track's
>   `role="img"` aria-label contains "neighborhood median", a fuzzy-match
>   collision (strict-mode violation).
> - `dashboard.spec.js`: **new** *valuation result extras* test (confidence
>   note, 3-marker market position, comps card with 5 rows + scope/percentile/
>   historical-data note, scenario explorer delta line + Reset); **new**
>   *prefill flow* test (`/?neighborhood=StoneBr` → select shows StoneBr;
>   unknown code ignored); *market map* extended (velocity caveat caption,
>   "Value a home here" popup link, price-trends LineChart); *model insights*
>   extended (operating-threshold hint + `Models: ridge_v1 + random_forest_v1
>   · features 9b0f8ba4201c` version line; ops StatCards were removed).
> - `frontend-fixes.spec.js`: **new** mocked test — a failed `POST
>   /market/comps` degrades to the documented inline note and leaves the
>   valuation card untouched (no page errors).
>
> Baseline before reconciliation: 22/24 (2 stale-UI failures: badge text,
> Neighborhood-selector collision). After: 27/27. No app bugs found.

Real-browser E2E for the PropPulse dashboard, driven by **Playwright 1.62.1**
(`@playwright/test`) with **Chromium Headless Shell 151.0.7922.34** against the
live FastAPI backend and Vite dev server. `dashboard.spec.js` and
`audit-blackbox.spec.js` use no mocks — every assertion runs against real HTTP
responses from the champion models; `frontend-fixes.spec.js` intercepts all API
traffic (`page.route`) so it is independent of the live backend and of the
suite's backend-killing scenarios.

## Environment & setup

- Node v24.14.0 / npm 11.9.0; suite lives in `e2e/` (own npm project, own
  `package.json`; `node_modules/`, `test-results/` gitignored).
- Browsers installed once via `npx playwright install chromium`.
- **Port discipline** (other hardening agents run servers concurrently):
  - Backend: `CORS_ORIGINS=http://localhost:5200 .venv/Scripts/python.exe -m uvicorn backend.app.main:app --port 8100`
  - Frontend: `VITE_API_URL=http://localhost:8100 npm run dev -- --port 5200 --strictPort`
- Config: `e2e/playwright.config.js` — baseURL `http://localhost:5200`,
  chromium only, `retries: 0`, `workers: 1` (sequential, because the final
  scenario deliberately stops the backend), viewport 1440×900, screenshots
  on failure + explicit portfolio captures.

## How to re-run

```bash
# terminal 1 (repo root)
CORS_ORIGINS=http://localhost:5200 .venv/Scripts/python.exe -m uvicorn backend.app.main:app --port 8100
# terminal 2 (repo root)
cd frontend && VITE_API_URL=http://localhost:8100 npm run dev -- --port 5200 --strictPort
# terminal 3 — once /health and / both respond
cd e2e && npx playwright test
```

The last dashboard scenario kills the process listening on port 8100 itself
(`netstat -ano` → `taskkill /PID … /F`) to simulate an API outage; re-running
the suite therefore requires restarting the backend.

## Scenarios & results (`dashboard.spec.js`, live backend)

| # | Scenario | What it asserts | Result | Duration |
|---|----------|-----------------|--------|----------|
| 1 | **Valuation flow** (`/`) | Header health indicator shows `API connected`; empty state first; form filled (NridgHt, 2Story, 4 bd, 2.5+1 ba, 2200 sqft, 2003, qual 8); result card shows estimated price matching `/\$[\d,]+/`, price-range band with ≥2 dollar bounds, probability matching `/\d+(\.\d+)?%/`, non-empty micro-market label, **exactly 5** top-factor rows | ✅ pass | 5.0s |
| 2 | **Valuation result extras** (new) | Confidence note visible; market-position strip renders **3** $/sqft markers; comps card (POST `/market/comps`) shows **5 rows**, scope line, percentile line, and the historical-training-data note; scenario explorer renders **5** sliders, moving Overall quality 8→9 produces a signed delta line (`+$…`, via POST `/predict/price`), and **Reset scenarios** clears it | ✅ pass | 5.0s |
| 3 | **Prefill flow** (new) | `/?neighborhood=StoneBr` pre-selects StoneBr in the form (not the default, so it proves the wiring); `/?neighborhood=NoSuchHood` is ignored and falls back to the NAmes default | ✅ pass | 2.8s |
| 4 | **Validation error state** | `gr_liv_area = 50` → API 422 surfaced in UI `role="alert"` mentioning the field name (`gr_liv_area: Input should be greater than or equal to 300`); no result card rendered | ✅ pass | 3.2s |
| 5 | **Market map** (`/market-map`) | `.leaflet-container` renders; **25** SVG circle markers (≥20 required); popup shows micro-market label + median price `/\$[\d,]+/`, the **velocity caveat caption**, and a **"Value a home here"** link matching `/^\/\?neighborhood=[A-Za-z]+$/`; the **Price trends by micro-market** section renders its subtitle ("Training data, 2006–2008 (includes the 2008 downturn).") and ≥2 recharts lines (4 clusters today) | ✅ pass | 6.2s |
| 6 | **Model insights** (`/model-insights`) | Champion cards show `ridge v1` + `random_forest v1`; classifier card hint carries the folded-in `operating threshold`; model-version line shows `ridge_v1 + random_forest_v1 · features 9b0f8ba4201c`; SHAP importance chart renders **20** bars (≥10 required); drift panel shows the documented `No drift report yet` empty state (backend `drift.status = no_data`; the test accepts the PSI card when a report exists); `Drift status` stat card present | ✅ pass | 3.6s |
| 7 | **API-down state** (LAST) | Test kills the backend on :8100 itself, then: header flips to `API offline`; valuation submit shows `role="alert"` with `Cannot reach the PropPulse API`; test asserts the kill really happened | ✅ pass | 6.7s |

The other two specs: `audit-blackbox.spec.js` (11 tests — DOM↔API trace-truth,
extreme/min inputs, noise-fallback badges, submit race, mid-load navigation,
390×844 mobile, reload, 422 field naming, 25-neighborhood select contract,
backend down→restart→recovery) and `frontend-fixes.spec.js` (9 tests — mocked
regressions for fetch timeout/abort, empty-factors note, mobile factor-name
overflow, health-pill degradation, drift low-sample note, and the comps-failure
degradation).

### Playwright summary (verbatim, final run)

```
Running 27 tests using 1 worker

  ok  1 tests\audit-blackbox.spec.js:85:1 › trace-truth: DOM renders exactly the intercepted /predict JSON (8.4s)
  ok  2 tests\audit-blackbox.spec.js:180:1 › extreme max property (8 bd, qual 10, 6000 sqft, …) renders sanely (4.2s)
  ok  3 tests\audit-blackbox.spec.js:206:1 › min-everything property (0 bd, 300 sqft, 1870, qual 1) renders sanely (3.8s)
  ok  4 tests\audit-blackbox.spec.js:225:1 › noise neighborhoods CollgCr/NAmes/Timber show the fallback badge; StoneBr does not (5.9s)
  ok  5 tests\audit-blackbox.spec.js:251:1 › race: 5 rapid submits settle to one consistent result matching the API JSON (7.0s)
  ok  6 tests\audit-blackbox.spec.js:278:1 › mid-load page switching (map → insights → valuation) leaves no errors (6.0s)
  ok  7 tests\audit-blackbox.spec.js:302:1 › mobile viewport 390x844: usable layout, no horizontal overflow (4.0s)
  ok  8 tests\audit-blackbox.spec.js:325:1 › reload mid-session: documented empty state returns, page still works (5.0s)
  ok  9 tests\audit-blackbox.spec.js:340:1 › 422 path: bedrooms=99 (HTML5 bypassed) names the offending field (3.3s)
  ok 10 tests\audit-blackbox.spec.js:354:1 › neighborhood select lists exactly the 25 geo-CSV neighborhoods; unknown rejected (4.7s)
  ok 11 tests\audit-blackbox.spec.js:370:1 › backend down → error + Try again → backend restart → full recovery (LAST) (34.5s)
  ok 12 tests\dashboard.spec.js:72:1 › valuation flow: form → price, range, probability, micro-market, 5 factors (5.0s)
  ok 13 tests\dashboard.spec.js:108:1 › valuation result: confidence note, market position, comps, scenario explorer (5.0s)
  ok 14 tests\dashboard.spec.js:151:1 › prefill flow: /?neighborhood=StoneBr pre-selects StoneBr in the form (2.8s)
  ok 15 tests\dashboard.spec.js:164:1 › validation error state: out-of-range living area surfaces the field name (3.2s)
  ok 16 tests\dashboard.spec.js:184:1 › market map: leaflet renders >=20 markers, popup shows cluster stats (6.2s)
  ok 17 tests\dashboard.spec.js:221:1 › model insights: champions, >=10 importance bars, drift panel (3.6s)
  ok 18 tests\dashboard.spec.js:258:1 › API-down state: valuation submit shows a reachable error (LAST — stops backend) (6.7s)
  ok 19 tests\frontend-fixes.spec.js:57:1 › AUD-24a: empty top_price_factors renders an explicit note, not a bare header (3.1s)
  ok 20 tests\frontend-fixes.spec.js:70:1 › AUD-24b: factor names are not truncated at 390x844 (no ellipsis overflow) (3.0s)
  ok 21 tests\frontend-fixes.spec.js:93:1 › AUD-24c: health pill shows a degraded state when a model is not loaded (2.7s)
  ok 22 tests\frontend-fixes.spec.js:103:1 › AUD-24c control: fully loaded models still show API connected (2.7s)
  ok 23 tests\frontend-fixes.spec.js:129:1 › AUD-24d: drift panel shows the low-sample note when low_sample is true (3.0s)
  ok 24 tests\frontend-fixes.spec.js:139:1 › AUD-24d control: no low-sample note when the key is absent (3.0s)
  ok 25 tests\frontend-fixes.spec.js:147:1 › AUD-10: a stalled API surfaces a timeout error instead of spinning forever (32.9s)
  ok 26 tests\frontend-fixes.spec.js:167:1 › AUD-10: navigating away aborts the in-flight request without page errors (3.7s)
  ok 27 tests\frontend-fixes.spec.js:189:1 › comps failure degrades to an inline note; the valuation card is unaffected (2.9s)

  27 passed (3.0m)
```

Live values observed during the passing run (via the UI and direct API
cross-checks): estimated price **$247,808**, range **$215,229–$278,464**,
30-day probability **25.6%** (threshold 20.3%, badge `Fast-sale signal
(simulated target)`), confidence `typical` ("Within the training data range"),
micro-market **mid northwest** (3 stats + note caption), market position
$112.6 vs $153.0 neighborhood vs $119.4 micro-market $/sqft (−26.4% line),
comps **5 rows** (neighborhood scope, ~19th percentile, "Historical sales
2006-2008 (training data)" note), scenario delta `Overall quality 8→9
+$11,942`; map: **25 neighborhoods / 4 clusters**, trends 6 half-year periods ×
4 cluster lines; insights: `ridge v1`, `random_forest v1`, version line
`Models: ridge_v1 + random_forest_v1 · features 9b0f8ba4201c`, 20 importance
bars, drift `no_data`.

## Portfolio screenshots (`docs/screenshots/`, full-page, 1440×900)

| File | Captures |
|------|----------|
| `home-empty.png` | Valuation page initial state (form + "No valuation yet" empty state, `API connected` indicator) |
| `valuation-result.png` | Full result column: price hero, confidence note, ~80% range band, market-position strip, probability gauge with simulated-target badge, micro-market card with note caption, 5 top factors, "About this estimate" link, **comparable-sales table (5 rows)**, **scenario explorer (5 sliders)** |
| `market-map.png` | Leaflet/OSM map with 25 cluster-colored markers + open stats popup (velocity caveat + "Value a home here" link) + cluster side panel + **price-trends LineChart** |
| `model-insights.png` | Champion cards, model-version line, 20-bar SHAP importance chart, monitoring & drift panel (empty state) |
| `error-state.png` | 422 validation error surfaced in the UI (`gr_liv_area: Input should be greater than or equal to 300`) |

Screenshot note: full-page captures stitch scroll positions, which makes the
sticky header / sticky result column float mid-page; the suite injects a
test-only stylesheet (`position: static`) during captures. Cosmetic only —
assertions never depend on it.

## Known gaps & notes

- **Chromium only.** WebKit and Firefox are untested (Playwright projects are
  configured for chromium per scope; OSM tile rendering and recharts SVG are
  the most likely cross-browser variables).
- **HTML5 client-side validation vs. scenario 4.** The core form inputs carry
  native `min`/`max` attributes, so Chromium blocks an out-of-range submit
  before any request is made (a validation bubble, e.g. "Value must be greater
  than or equal to 300", is shown and no error card appears). To exercise the
  API 422 → UI error path, scenario 4 sets `form.noValidate = true` in-page
  first. This is documented, deliberate test setup — not a product bug; the
  client-side guard is arguably good UX.
- **Accessible-name collisions.** The valuation form's selects are wrapped in
  their `<label>` elements, so label text is fuzzy-matched by `getByLabel`; the
  market-position track's `role="img"` aria-label ("…neighborhood median…")
  also matches `getByLabel('Neighborhood')` once a result is on screen. Tests
  that re-interact with the form after a valuation scope the lookup to
  `.form-card` (see *noise neighborhoods*). Not a product bug.
- **Extra client calls are tolerated.** After each valuation the page fires
  POST `/market/comps`, and scenario-slider moves fire POST `/predict/price`.
  Live-backend specs let these through; mocked specs (`frontend-fixes`) leave
  them unmocked where they don't affect assertions (a failed comps call renders
  its own inline note — explicitly asserted by the new degradation test).
- **Drift panel tested in its documented empty state.** No drift report
  existed at run time (`/metrics` → `drift.status: no_data`), so the
  `No drift report yet` branch was asserted; the PSI-card branch is covered by
  the same test's conditional once `ml.monitoring.drift_check` has produced
  `reports/drift/latest.json` (and by the mocked AUD-24d tests).
- **OSM basemap needs internet.** Marker/popup assertions do not depend on
  tile images, but the `market-map.png` screenshot does (tiles loaded fine).
- **Single viewport (1440×900) in `dashboard.spec.js`.** The regression specs
  also cover a 390×844 mobile viewport (factor-name overflow, mobile layout);
  broader responsive testing remains open.
- The suite appends a few real predictions to `logs/predictions.jsonl`
  (backend logging is by design, SPEC §10).
- **No functional UI bugs found** in this reconciliation; the two baseline
  failures were stale test expectations, both traced to documented UI changes.

## Regression check

Full Python suite after the E2E work (no backend/frontend code was touched):

```
.venv/Scripts/python.exe -m pytest tests backend/tests -q
232 passed, 4 warnings in 50.93s
```
