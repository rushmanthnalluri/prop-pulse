# PropPulse — Browser QA Report (post-rebuild, first human-like pass)

- **Date:** 2026-08-09 (local) · **Build under test:** `frontend/dist` rebuilt 2026-08-08 23:57 local (hashes `index-DrsULQ2o.js` / `index-Y2Er3boU.css`)
- **Method:** scripted Chromium (Playwright 1.56) driving the production bundle, real backend at `http://localhost:8000` (`/health` OK, both models loaded). All routes exercised via the real nav; forms submitted; faults injected with route aborts and full-offline simulation; responsive sweep at 1440x900 / 1024x768 / 768x1024 / 390x844. Evidence screenshots in `docs/frontend/qa-shots/`.
- **Serving note:** the app was served with `vite preview` on **port 5173**, not 5310 — the backend's CORS allowlist only covers `http://localhost:5173` and `http://localhost:8080` (verified with `Origin`-header curls); every API call from :5310 is browser-blocked, which would have made the whole app untestable. See MINOR-4.
- **Environment caveat:** another process rebuilt `frontend/dist` *during* the first sweep (assets 404'd mid-run). That sweep was discarded and re-run against the stable build; all results below are from clean runs.

## Verdict summary

| Area | Verdict |
|---|---|
| Overview (`/`) | **PASS** |
| Valuation (`/valuation`) | **FAIL** — MAJOR-1 (mobile overflow after submit) |
| Market Intelligence (`/market`) | **PASS** |
| Model Insights (`/model`) | **PASS** |
| Model Health (`/health`) | **PASS** |
| NotFound (catch-all) | **PASS** |
| Error resilience (cross-cutting) | **FAIL** — MAJOR-2 (dead "Try again" on chunk failure) |

**Overall: NOT release-ready** — two MAJOR defects, both in core flows (mobile valuation results; error-boundary recovery). Everything else observed is cosmetic. Once MAJOR-1 and MAJOR-2 land, this build looks shippable: zero console errors, zero failed requests, zero forbidden-string sightings across all pages in normal operation, and the error/empty/degraded states are unusually thorough.

**Defect counts: BLOCKER 0 · MAJOR 2 · MINOR 2 · POLISH 3** (+ 3 product notes)

---

## MAJOR

### MAJOR-1 — Valuation result rail triggers horizontal page scroll on phones (< ~625px)
- **Page:** `/valuation`
- **Steps:** viewport 390x844 (or any width below ~625px) → open `/valuation` → click *Estimate value* → result renders → page now scrolls horizontally.
- **Expected:** single-column layout fits the viewport, as it does before submit (measured overflow: 0px).
- **Actual:** after submit the whole page is ~609–625px wide: **+235px overflow at 390px, +133px at 500px**. Root cause measured in the DOM: the comps table (8 columns, min-content width 573px) sits in a `.table` wrapper with `overflow-x: visible`, and the `.valuation-grid` single column refuses to shrink below ~609px (`grid-template-columns: 609.031px` computed at every small width), so the *form column also widens* — every field, hint, and rail panel sticks out past the right edge. Contrast with `/market`, whose wider directory table (1033px) scrolls internally inside `.table-scroll` — no page overflow.
- **Evidence:** `docs/frontend/qa-shots/08-390-overflow.png`, `docs/frontend/qa-shots/06-390x844-valuation-result.png` (full-page capture is 625px wide = the overflow); measurements: `rail-stack w=609`, `table w=573, wrapOverflow=visible` at 390px. Fine at ≥640px (609px grid fits).
- **Why it matters:** valuation is the product's core page, and the overflow appears exactly when the user gets their result — on any portrait phone the result rail, form, and toasts slide off-canvas.

### MAJOR-2 — Error boundary "Try again" cannot recover a failed lazy chunk
- **Page:** any lazy route (`/market`, `/model`, `/health`) — cross-cutting error path
- **Steps:** load the app (e.g. `/valuation`, so the Health chunk is never fetched) → lose connectivity → click *Model Health* in the nav → chunk fetch fails → route ErrorBoundary shows "This section failed to render" (correct so far) → restore connectivity → click **"Try again"**.
- **Expected:** the dynamic import is re-attempted and the page renders.
- **Actual:** the boundary immediately reappears — React caches the rejected `lazy()` import, and the boundary's reset (`ErrorBoundary.jsx:18`, `handleReset`) only re-renders the same poisoned lazy component. In testing, "Try again" never recovered; only **"Reload page"** did. This is the failure mode the boundary will most often meet in production (deploy replacing hashed chunks, flaky networks), and its primary button is a dead end for it. Console shows `[PropPulse] render failure: Error: Unable to preload CSS for /assets/Health-…css`.
- **Evidence:** `docs/frontend/qa-shots/05c-boundary-offline.png` (boundary while offline), `docs/frontend/qa-shots/05c-after-retry.png` (same boundary after "Try again" while back online).
- **Mitigating:** the secondary "Reload page" button works, so users are not fully stuck — but the primary CTA misleads.

---

## MINOR

### MINOR-1 — Years rendered with thousands separators ("1,965", "1,872–2,008")
- **Page:** `/valuation` (two spots, same root cause: `formatNumber` grouping applied to a year)
- **Steps:** (a) submit any valuation → expand a comp row (▸) → the comparison grid shows *Year built — this sale `1,965`, this property `1,995`* (`CompsTable.jsx:79` via `fmtPlain` → `formatNumber(n, 0)`). (b) look at the *Year built* form hint: *"train range 1,872–2,008"* (`formConfig.js` `trainRangeHint`).
- **Expected:** years never grouped: `1965`, `1872–2008` (the comps table's own BUILT column gets this right — it renders the raw year).
- **Actual:** grouped years in both places.
- **Evidence:** `docs/frontend/qa-shots/02-comp-expanded.png`, `docs/frontend/qa-shots/02-validation.png`.

### MINOR-2 — Vite preview/dev ports other than 5173/8080 are fully CORS-blocked
- **Page:** whole app (deployment/DX config)
- **Steps:** serve the built app from any origin except `http://localhost:5173` / `http://localhost:8080` (e.g. `vite preview` default 4173, or the QA-mandated 5310) → open the app.
- **Expected:** app works, or at least the setup docs warn loudly.
- **Actual:** every API call fails CORS (verified: no `access-control-allow-origin` returned for `:5310`/`:4173`); all pages degrade to error states with "Cannot reach the PropPulse API". The graceful degradation works as designed — but a reviewer following the obvious `npm run preview` path sees a broken app. Consider adding common preview origins to `CORS_ORIGINS` or documenting the constraint in the frontend README.
- **Evidence:** curl probes (`access-control-allow-origin: http://localhost:5173` only for 5173/8080); initial QA run on :5310 showed API-blocked pages.

---

## POLISH

### POLISH-1 — Raw operating threshold shown to 6 decimals
- **Page:** `/valuation` result rail (Sale likelihood gauge)
- **Steps:** submit any valuation → gauge footer reads `20.0% within 30 days · threshold 0.203292`.
- **Expected:** consistent presentation, e.g. `threshold 20.3%` (the value itself is correctly served from the API — this is purely display precision, `ProbabilityGauge.jsx:46` interpolates `{thr}` raw).
- **Evidence:** `docs/frontend/qa-shots/02-validation.png` (top-right), rail text dump.

### POLISH-2 — API status pill stays "API connected" for up to 30s after connectivity loss
- **Page:** app shell (sidebar/topbar pill)
- **Steps:** load app → cut connectivity → observe the pill.
- **Actual:** still green "API connected" until the next 30s `/health` poll (`Layout.jsx` polls on an interval; no `online`/`offline` event listener). Clicking the pill forces an immediate re-check, and valuation submit does correctly say "You appear to be offline…", so impact is mild.

### POLISH-3 — Consumer-facing caveat copy leaks raw schema identifiers
- **Page:** `/market` popups, `/valuation` micro-market card
- **Steps:** open any marker popup or micro-market card → read the velocity caveat: *"sale_velocity_30d is the fraction of this cluster's TRAIN-split sales with sells_within_30_days==1…"*.
- **Expected:** plain-language disclosure (the SIMULATED badge and ADR-3 reference already carry the honesty requirement); snake_case identifiers read like a debug paste to non-engineers.
- **Evidence:** `docs/frontend/qa-shots/03-marker-popup.png`.

---

## Product notes (not defects — flagged for a decision)

1. **Refresh restores the form but not the result.** After a submit, the payload is mirrored to the URL (verified: `?neighborhood=NAmes&…&year_built=2020`), and F5 repopulates the form — but the estimate itself is not re-fetched; the rail returns to the "Submit the form…" empty state. This matches the code's stated intent, yet a user sharing/bookmarking that URL probably expects the result. One click restores it; decide consciously.
2. **localStorage restore chip works well** — after a submit, a clean `/valuation` visit offers "Restore last valuation · North Ames · 2,500 sq ft · built 2020"; clicking repopulates the form (verified). Dismiss (×) works. Note it only appears when the URL carries no state, by design.
3. **Bad-type input is sanitized before validation.** Forcing `abc` into a number field makes the browser empty it, so the user sees "Required" rather than "Enter a number" — a slightly confusing message for the underlying mistake, but unreachable without devtools.

---

## What was verified working (no defects found)

- **Routing/nav:** all five routes via sidebar/topbar nav and direct URL loads (SPA fallback OK on deep links); bogus URL → branded 404 with working recovery links (`01-notfound.png`). Page titles update per route.
- **Overview:** all six metric cards show real API numbers (RMSLE 0.1187 · R² 0.9305 · coverage 78.3% · 25 neighborhoods · 4 micro-markets · 94 features); lazy trends chart renders; driver bars; 4 cluster cards link to `/market`; hero CTAs and "All 94 features →" link work; disclosures present.
- **Valuation (desktop):** default submit → full rail in contract order (hero price $160,985 with band $139,820–$180,900, coverage/MAE captions, gauge 20.0% + SIMULATED badge, micro-market with nearest-cluster fallback note, price position −17.6% vs neighborhood, 5 factor bars, 5 comps with percentile line, 7 scenario levers, provenance `ridge_v1 + random_forest_v1 · features 9b0f8ba4201c · ames-1.0 · estimated …`). Comps Price/Sold sort both directions; row expander shows comp-vs-subject grid with signed "Vs the estimate" delta. Sliders fire debounced `/predict/price` and render signed deltas (+$10,370 / +$7,758 / −$4,584). Validation: required / range / integer / remodel-before-built rules all fire inline + summary + first-invalid focus; warn-not-block (year_built 2020) shows the training-range hint, submits fine, and the rail flags reduced confidence. Advanced overrides: all 30 controls render; `sale_date`/`mo_sold`/`yr_sold` accepted by the API. Busy state ("Estimating…", disabled) works; success/error toasts work and do not duplicate. Reset clears form + URL + result; Load example refills.
- **Market:** map renders with OSM tiles and all **25 markers**; click popup shows full stats + honesty copy; markers are keyboard-focusable, Enter opens the popup, Esc closes; popup's "Value a home here →" is a real link. Cluster rail (4 cards) dims non-member markers and syncs the profile. Directory table: 25 rows, all 5 sortable headers order correctly both directions. Handshake `/valuation?neighborhood=Blmngtn` lands with the select prefilled; bogus URL values dropped silently. Trends chart renders with gap note ("gaps = no sales that half-year") and screen-reader table.
- **Model Insights:** champions, regression + classification metric tables, both confusion matrices (val + sealed test), champion-vs-runner-up bootstrap with CI, global importance bars (top 20 of 94), methodology ("How the champions were trained and judged" 01–04), verbatim registry rationale, and plain-spoken caveats incl. honest NOT AVAILABLE entries (no ROC/PR curves).
- **Health:** service status (uptime, models loaded), live traffic with per-path request table, honest drift empty states (both feature and prediction drift: "No scored traffic in the drift window yet… none are invented"), refresh button fires fresh `/metrics`, and auto-refresh observed (1 automatic `/metrics` call in 33s).
- **Error paths:** aborted `/predict` → inline alert + toast + Try again, form values kept, retry recovers; aborted `/model/info` → only dependent sections degrade (importance bars, valuation form unharmed); full offline after load → submit says "You appear to be offline — check your connection", SPA stays alive; failed re-submit keeps the previous estimate dimmed with an explanatory banner (exactly the AUDIT §2.2 behavior).
- **Responsive:** zero horizontal overflow on `/`, `/market`, `/model`, `/health` at 1440/1024/768/390 (pre-submit `/valuation` too); topbar nav usable at ≤768px; map usable at 390px (356x300, 25 markers); forms fully usable at all widths. (Post-submit `/valuation` overflow is MAJOR-1.)
- **Console/network hygiene:** across all normal browsing — **0 console errors, 0 page errors, 0 failed requests, 0 HTTP ≥ 400 responses, 0 forbidden-string sightings** ("undefined"/"NaN"/"[object Object]"/stack traces). The only console warning in the whole run was Chromium complaining about the `abc` value I force-injected during a validation test.

## Reproduction environment

- Frontend: `frontend/dist` via `npm run preview -- --port 5173` (5173 chosen for CORS; see MINOR-2). Backend: pre-existing `uvicorn` on :8000 (not restarted by QA).
- Playwright scripts were temporary (`e2e/qa-*.mjs`), deleted after the run; screenshots kept under `docs/frontend/qa-shots/`.
