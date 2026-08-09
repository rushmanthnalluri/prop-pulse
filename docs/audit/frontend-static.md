# frontend-static — Frontend Functional Audit (mission §14)

**Agent:** frontend-static · **Date:** 2026-08-07 · **Mode:** static + build-level (no runtime E2E — that is blackbox-e2e's scope). No server started; no ports used.
**Scope:** every file under `frontend/src/` (16 files, 2,271 lines — all read in full), plus the backend contracts the UI codes against (`backend/app/schemas/property.py`, `schemas/responses.py`, `api/model.py`, `api/health.py`, `api/predict.py`, `api/market.py`, `services/cluster_service.py`, `services/monitoring_service.py`), `models/champion.json`, `models/explainability/feature_importance.json` (head), `reports/drift/latest.json` (head), `ml/explainability/service.py` (magnitude semantics), `ml/monitoring/drift_check.py` (status vocabulary).

## Verdict summary

**PASS WITH CONCERN.** The frontend renders every data point from live API responses (zero hardcoded predictions), the form↔schema contract is an exact 55/55 field match, all four UI states exist and are reachable on all three pages, and `npm run lint` / `npm run build` both exit 0 fresh. Concerns: no fetch timeout anywhere (P2) and a cluster of P3 robustness/accessibility nits.

## Evidence index

| File | Contents |
|---|---|
| `evidence/frontend-static-lint.txt` | `npm run lint` fresh run — exit 0 |
| `evidence/frontend-static-build.txt` | `npm run build` fresh run — exit 0, chunk manifest |
| `evidence/frontend-static-format.txt` | Executed `format.js` edge cases (26 cases) under Node 24 |
| `evidence/frontend-static-fieldmap.txt` | Programmatic payload-keys vs `PropertyInput` cross-check — 55/55 |
| `evidence/frontend-static-ranges.txt` | 20 categorical sets + 31 numeric min/max vs schema — ALL_MATCH (incl. correction note: first run's `DISCREPANCIES_FOUND` was a bug in my checker script, not the data; corrected rerun appended in-file) |
| `evidence/frontend-static-contrast.txt` | Computed WCAG contrast ratios for the palette |

## Per-component status

| File (lines read) | Status | Notes |
|---|---|---|
| `src/main.jsx` (11) | PASS — statically verified | StrictMode; leaflet CSS imported at entry (main.jsx:3). |
| `src/App.jsx` (30) | PASS — statically verified | `react-router` v8 imports (installed 8.3.0 — verified in node_modules); lazy routes for map/insights; catch-all `*` → Valuation (App.jsx:23, design choice: bad URLs silently show Valuation, no 404 view). |
| `src/components/Layout.jsx` (113) | PASS — statically verified | Health pill polls `/health` every 30 s; `clearInterval` + `cancelled` guard on unmount (Layout.jsx:48–65). Checks `body.status === 'ok'` which the backend always sends when alive (health.py:19) — see F6. |
| `src/pages/Valuation.jsx` (304) | PASS — statically verified | All 4 states reachable (Valuation.jsx:281–299). Payload assembly at :54–72. See F5. |
| `src/pages/MarketMap.jsx` (148) | PASS — statically verified | All 4 states (:49–65). Color map sorted by cluster_id → stable across renders (:19–26). Popup data from `clusterById` built from the same response. Endpoint failure → `ErrorState` + retry via `useApi.reload`. See F3. |
| `src/pages/ModelInsights.jsx` (267) | PASS — statically verified | 3 independent `useApi` sections, each with loading/error/success. Importance nesting `payload.importance` / `payload.metadata.units` matches artifact + endpoint (:92, :106). Drift `no_data` vs `ok` branches (:172, :179) match the only two statuses `drift_check.py` emits (:217, :319). See F2. |
| `src/components/StateView.jsx` (34) | PASS — statically verified | `role="status"` / `role="alert"`; retry button only when handler given. |
| `src/components/PriceBand.jsx` (26) | PASS — statically verified | `low == high` → span 0 → marker pinned at 50% (:9); estimate outside band → clamped 0–100; `low > high` also degrades to 50% (no crash). |
| `src/components/ProbabilityGauge.jsx` (43) | PASS — statically verified | Fill and threshold both clamped 0–100 (:8–9); threshold 0.203292 → marker+label at 20.3%; `role="meter"` with aria attrs. |
| `src/components/FactorBars.jsx` (37) | PASS — statically verified | Empty/null factors → renders null (:9); all-zero magnitudes → `max` floored at 1e-9, width floored at 4% (:10, :15); magnitude is a 0–1 share per `ml/explainability/service.py:20-21`, so `formatPct` (×100) is correct. |
| `src/components/StatCard.jsx` (10) | PASS — statically verified | Trivial; tone optional. |
| `src/format.js` (73) | **PASS — verified by execution** | 26 edge cases run under Node (0, null, undefined, NaN, negative, huge, string input): all sane — see evidence file. `prettyFeature('')`/`null` → '—'. |
| `src/api/client.js` (75) | PASS WITH CONCERN | Base URL `VITE_API_URL || http://localhost:8000`, trailing slashes stripped (:9); network failure → `ApiError` status 0 with clear message (:44–49); 422 detail list flattened to `field: msg; …` (:23–35); non-JSON bodies tolerated. **No timeout, no AbortController — F1.** |
| `src/api/useApi.js` (30) | PASS WITH CONCERN | `cancelled` flag prevents setState-after-unmount; `reload` bumps key. Fetch itself never aborted (part of F1). |
| `src/constants.js` (132) | **PASS — verified by execution** | All 20 categorical sets byte-identical to schema Literals; 25 neighborhoods identical to `data/external/neighborhood_geo.csv` (`diff` → NEIGHBORHOODS_MATCH); `DEFAULT_FORM` values all inside schema ranges (they are form inputs, not prediction data — explicitly allowed). |
| `src/styles.css` (938) | PASS WITH CONCERN | Hand-rolled CSS (ADR-5); focus styles on inputs; responsive breakpoints. Contrast failures — F4. |

## (1) Hardcoded-value scan — PASS

Grepped all of `frontend/src/`, `index.html`, `public/`, `vite.config.js` for the sentinel demo values (239920, 0.336, 208000, 270000, 248220, 155916, 204881, 250967) and for generic large literals / `$<digits>`: **zero prediction data literals**. Only matches: CSS hex colors, regex fragments, form min/max constants, the 30 s poll interval, and `DEFAULT_FORM` (form *inputs* with an explicit comment "these are form inputs, not prediction data", constants.js:62–67). Every rendered number flows from `api.*` responses. Also no `console.*`, `debugger`, `TODO`, `FIXME` in src.

## (2) Form control → payload key → schema field mapping — PASS (55/55, verified by execution)

Assembly logic (Valuation.jsx:54–72): `neighborhood`, `house_style`, `central_air` always sent; 13 core fields cast with `Number()`; 39 advanced fields sent only when non-empty (`''`/`null`/`undefined` skipped → server defaults apply, matching `to_serving_payload(exclude_unset=True)`). Programmatic diff: **0 payload keys missing from schema, 0 schema fields unsendable** (evidence: frontend-static-fieldmap.txt). Categorical option sets and numeric min/max all byte-identical to `PropertyInput` (evidence: frontend-static-ranges.txt).

| Form control | Payload key | Schema field | Valid range / set | Match |
|---|---|---|---|---|
| Neighborhood select | `neighborhood` | `neighborhood: str` (+validator) | 25 geo-CSV neighborhoods | ✓ (diff-verified) |
| House style select | `house_style` | `HouseStyle` Literal | 8 styles | ✓ |
| Central air select | `central_air` | `central_air: bool` | yes/no → bool cast | ✓ |
| Bedrooms | `bedrooms` | int | 0–8 | ✓ |
| Full baths | `full_bath` | int | 0–4 | ✓ |
| Half baths | `half_bath` | int | 0–2 | ✓ |
| Basement full baths | `bsmt_full_bath` | int | 0–3 | ✓ |
| Basement half baths | `bsmt_half_bath` | int | 0–2 | ✓ |
| Living area | `gr_liv_area` | int | 300–6000 | ✓ |
| Lot area | `lot_area` | int | 500–200000 | ✓ |
| Basement area | `total_bsmt_sf` | int | 0–4000 | ✓ |
| Year built | `year_built` | int | 1870–2026 | ✓ |
| Overall quality | `overall_qual` | int | 1–10 | ✓ |
| Overall condition | `overall_cond` | int | 1–10 | ✓ |
| Garage cars | `garage_cars` | int | 0–5 | ✓ |
| Fireplaces | `fireplaces` | int | 0–4 | ✓ |
| Building type (adv) | `bldg_type` | `BldgType` | 5 values | ✓ |
| MS zoning (adv) | `ms_zoning` | `MSZoning` | 5 values incl. `C (all)` | ✓ |
| Lot frontage (adv) | `lot_frontage` | float\|None | 1–500 | ✓ |
| Remodel year (adv) | `year_remod_add` | int\|None | 1870–2026 | ✓ |
| Garage area (adv) | `garage_area` | float\|None | 0–2000 | ✓ |
| Pool area (adv) | `pool_area` | int | 0–1000 | ✓ |
| Wood deck (adv) | `wood_deck_sf` | int | 0–1500 | ✓ |
| Open porch (adv) | `open_porch_sf` | int | 0–1000 | ✓ |
| Screen porch (adv) | `screen_porch` | int | 0–800 | ✓ |
| Sale date (adv) | `sale_date` | `dt.date`\|None | date input → ISO | ✓ |
| Basement quality (adv) | `bsmt_qual` | `BsmtQual` | Ex/Gd/TA/Fa/None | ✓ |
| Kitchen quality (adv) | `kitchen_qual` | `QualityNoPo` | Ex/Gd/TA/Fa | ✓ |
| Exterior quality (adv) | `exter_qual` | `QualityNoPo` | Ex/Gd/TA/Fa | ✓ |
| Heating QC (adv) | `heating_qc` | `HeatingQC` | 5 values | ✓ |
| Garage type (adv) | `garage_type` | `GarageType` | 7 values | ✓ |
| Garage finish (adv) | `garage_finish` | `GarageFinish` | 4 values | ✓ |
| Foundation (adv) | `foundation` | `Foundation` | 6 values | ✓ |
| Electrical (adv) | `electrical` | `Electrical` | 5 values | ✓ |
| Functional (adv) | `functional` | `Functional` | 7 values | ✓ |
| Fireplace quality (adv) | `fireplace_qu` | `FireplaceQu` | 6 values | ✓ |
| Lot shape (adv) | `lot_shape` | `LotShape` | 4 values | ✓ |
| Lot config (adv) | `lot_config` | `LotConfig` | 5 values | ✓ |
| Land slope (adv) | `land_slope` | `LandSlope` | 3 values | ✓ |
| Proximity condition (adv) | `condition1` | `Condition1` | 9 values | ✓ |
| Roof style (adv) | `roof_style` | `RoofStyle` | 6 values | ✓ |
| Exterior covering (adv) | `exterior1st` | `Exterior1st` | 12 values | ✓ |
| Paved drive (adv) | `paved_drive` | `PavedDrive` | Y/N/P | ✓ |
| Street (adv) | `street` | `Street` | Pave/Grvl | ✓ |
| Masonry veneer (adv) | `mas_vnr_area` | float\|None | 0–2000 | ✓ |
| Kitchens above grade (adv) | `kitchen_abv_gr` | int\|None | 0–3 | ✓ |
| Total rooms above grade (adv) | `tot_rms_abvgrd` | int\|None | 1–15 | ✓ |
| Basement finished (adv) | `bsmt_fin_sf1` | int\|None | 0–2500 | ✓ |
| Basement unfinished (adv) | `bsmt_unf_sf` | int\|None | 0–2500 | ✓ |
| 1st floor (adv) | `first_flr_sf` | int\|None | 300–4000 | ✓ |
| 2nd floor (adv) | `second_flr_sf` | int\|None | 0–3000 | ✓ |
| Enclosed porch (adv) | `enclosed_porch` | int\|None | 0–600 | ✓ |
| Misc value (adv) | `misc_val` | int\|None | 0–20000 | ✓ |
| Month sold override (adv) | `mo_sold` | int\|None | 1–12 | ✓ |
| Year sold override (adv) | `yr_sold` | int\|None | 2006–2026 | ✓ |

## (3) State reachability (read from code paths) — PASS for all 3 pages

| Page | Loading | Error (422 list / network) | Empty | Success |
|---|---|---|---|---|
| Valuation | `state.loading` after submit (Valuation.jsx:281) | catch → `ErrorState`; 422 detail list flattened by `extractDetail` (client.js:26–33); network fail → status-0 ApiError message (:44–49); "Try again" → `reset` keeps form values (:267) | initial, before first submit (:291) | `PredictResult` (:299) |
| MarketMap | `useApi` initial (MarketMap.jsx:49) | fetch reject → `ErrorState` + `reload` retry (:54) | `data.neighborhoods.length === 0` (:59) | map + side cards (:65) |
| ModelInsights | per-section `useApi` (:234, :240, :261) | per-section `ErrorState` + retry; 404 special-case (dead — F2) | ImportanceChart empty-map → `EmptyState` (:102–104); drift `no_data` → `EmptyState` (:172) | ChampionCards / chart / DriftPanel |

## (4) API client — PASS WITH CONCERN

- Base URL: `import.meta.env.VITE_API_URL || 'http://localhost:8000'`, trailing slashes stripped (client.js:9); documented in `.env.example`; vite dev port 5173 is in the backend default CORS origins (config.py:44). ✓
- Non-OK parsing: string `detail` passthrough; 422 array → `loc` minus `body` joined with `msg` (client.js:23–35); unreadable body → `Request failed with status N`. ✓
- Network errors: fetch reject → `ApiError("Cannot reach the PropPulse API at …", 0)`. ✓
- **Timeout: none — F1.** No `AbortSignal.timeout`, no AbortController anywhere.
- Unmount cleanup: `useApi` guards setState with `cancelled` (useApi.js:14–25) but the HTTP request itself is never aborted; Valuation's `submit` (Valuation.jsx:257–263) has no cancellation at all (setState on unmounted component is a harmless no-op in React 19). Health pill interval *is* cleaned up (Layout.jsx:61–64). ✓/F1

## (5) Formatting & component math — PASS (format.js verified by execution)

- `formatUsd(0)="$0"`, null/undefined/NaN→"—", huge→"$123,456,790", string input coerced; `formatPct(0)="0.0%"`; `formatUptime(3721.4)="1h 2m"` — full table in evidence/frontend-static-format.txt.
- ProbabilityGauge threshold math: `clamp(threshold*100)` for both marker and label position (ProbabilityGauge.jsx:9, :28, :32) — correct for threshold 0.203292 → 20.3%.
- PriceBand: `low==high` → 50% marker; estimate outside [low, high] → clamped (PriceBand.jsx:9). Scale caption "~80% prediction interval" matches backend docstring ("Quantile-based ~80% prediction interval", responses.py:17).
- FactorBars empty array → renders nothing (:9); zero-magnitude list → no divide-by-zero (:10).

## (6) MarketMap — PASS

Color mapping deterministic: unique `cluster_id`s sorted numerically then indexed into an 8-color palette (MarketMap.jsx:19–26) — stable across renders/reloads while the payload set is stable (4 clusters → no palette wraparound). Popup stats come from `clusterById` derived from the *same* `/market/clusters` response — no second source. Endpoint failure → ErrorState + retry. Noise-point fallback flagged in popup (`point.fallback`, :99) matching `cluster_service.py:80`.

## (7) ModelInsights — PASS

Importance fetch reads `payload.importance` and `payload.metadata.units` (:92, :106) — matches both the endpoint (`load_model_importance`, model.py:78–83) and the actual artifact (`units: "log1p(SalePrice)"`). Top-20 descending, reversed for recharts vertical layout. Drift panel: `no_data` branch renders `EmptyState` with `drift.detail` (:172–177); `ok` branch renders per-feature PSI bars with warn/drift tones (:179–210); the only two statuses the pipeline emits are exactly `no_data`/`ok` (drift_check.py:217, :319; monitoring_service.py:47–62). Live `reports/drift/latest.json` has `status: "ok"` with all keys the panel reads (`per_feature_psi` present in file; `warn_threshold`, `psi_threshold`, `n_predictions`, `drifted_features`, `retraining_recommended`, `timestamp` all present).

## (8) Navigation / routing / health pill — PASS

react-router **8.3.0** installed (package.json `^8.3.0`); `createBrowserRouter`, `RouterProvider`, `NavLink`, `Outlet` imported from `react-router` — correct for v7+; the successful production build statically proves every import resolves. Lazy boundaries show `<Loading/>` while chunks load. Health pill: immediate check + 30 s interval, both cancelled on unmount (Layout.jsx:48–65).

## (9) Lint & build — PASS (verified by execution)

- `npm run lint` (eslint 9.39.5): **exit 0, zero warnings** (evidence: frontend-static-lint.txt).
- `npm run build` (vite 6.4.3): **exit 0**, 763 modules, 7.36 s; lazy chunks split as designed — `MarketMap-*.js` 158 kB, `ModelInsights-*.js` 389 kB, shared `useApi-*.js` 0.4 kB, main bundle 311 kB (98.7 kB gzip) (evidence: frontend-static-build.txt). Side effect disclosed: this refreshed `frontend/dist/` (generated output, not source).

## (10) Accessibility quick pass — PASS WITH CONCERN

- All form controls wrapped in implicit `<label>` via `Field` (Valuation.jsx:36–44) — label association ✓. `aria-expanded` on advanced toggle; `role="status"`/`role="alert"` on async states; `role="meter"` + aria values on the gauge; `aria-label="Primary"` on nav; decorative SVGs `aria-hidden`.
- Contrast failures (computed, evidence: frontend-static-contrast.txt): `--ink-400 #94a3b8` on white = **2.56:1** (fails AA 4.5:1) used for 11.5–12.5 px hint/caption/footer text (`.field-hint`, `.price-band-scale-caption`, `.prob-gauge-note`, `.model-version-footer`, `.map-popup-code`); primary button white on `--teal-600 #0d9488` = **3.74:1** (fails AA for 14 px/600 text); muted badge 4.23:1 marginally below AA. → F4.

## Findings

| # | Severity | Location | Description |
|---|---|---|---|
| F1 | **P2** | `frontend/src/api/client.js:37-66`, `src/api/useApi.js:13-26`, `src/pages/Valuation.jsx:257-263` | No fetch timeout and no request abort anywhere. A stalled-but-open backend connection leaves any page in its loading state indefinitely with no user feedback or recourse short of reloading; in-flight requests are never cancelled on unmount (only the setState is guarded). Repro: point `VITE_API_URL` at a blackhole (e.g. `http://10.255.255.1`) → submit the form → "Estimating…"/spinner forever. Fix direction: `AbortSignal.timeout(30000)` in `request()`, pass an AbortController through `useApi` cleanup. |
| F2 | P3 | `frontend/src/pages/ModelInsights.jsx:245-247` vs `backend/app/api/model.py:102-103` | Dead special-case: the frontend crafts a friendly "endpoint not available yet (integration wave)" message for HTTP 404, but the backend never returns 404 for `/model/importance` — a missing/malformed artifact yields **503**. The friendly copy can never render; users see the generic error with the backend's detail string (still acceptable). Stale "integration wave" comment in the page header (:3) too. |
| F3 | P3 | `frontend/src/pages/MarketMap.jsx:59, :65` | Success branch dereferences `data.neighborhoods.length` / `data.clusters.map` without shape guards and there is no error boundary in the app — a contract-drifting payload (missing key) throws TypeError and blanks the whole page instead of showing `ErrorState`. Mitigated by `response_model=MarketClustersResponse` server-side (market.py:13), so exploitation requires backend contract drift. |
| F4 | P3 | `frontend/src/styles.css:14, :291, :336-337` (+ `.field-hint` :254-257, `.prob-gauge-note` :537-541, `.model-version-footer` :414-421) | WCAG AA contrast failures: ink-400-on-white 2.56:1 for small hint/caption text; primary button white-on-teal-600 3.74:1; muted badge 4.23:1. Computed ratios in evidence/frontend-static-contrast.txt. |
| F5 | P3 | `frontend/src/pages/Valuation.jsx:152-160`, `src/constants.js:95-131` | Advanced number inputs omit `step={1}` (core inputs have it, :108), so integer-only schema fields (`mo_sold`, `kitchen_abv_gr`, `tot_rms_abvgrd`, …) accept decimals client-side and only fail as 422 after submit. The error path handles it, but the feedback is one round-trip late. |
| F6 | P3 | `frontend/src/components/Layout.jsx:53-54` vs `backend/app/api/health.py:16-21` | Health pill reads only `body.status === 'ok'`, which the backend returns unconditionally while alive; `models_loaded: {…: false}` (degraded model) still shows "API connected". Observability nit, not a functional break — predict failures surface via page error states. |

Non-findings explicitly checked and cleared: NaN propagation in gauge/band styles (degrades to 0-width, no crash); `factor.magnitude` fraction-vs-percent (fraction — correct for `formatPct`); palette wraparound (4 clusters < 8 colors); double-fetch in StrictMode (fetchers memoized with `useCallback([])`, effects idempotent); catch-all route (design choice, noted).

## Contradictions the orchestrator must reconcile

1. **File-count drift in AUDIT_PLAN:** the plan's baseline says `frontend/src/` = **15 files** / 2,271 lines; the tree actually has **16 files** / exactly 2,271 lines (938 of them `styles.css`). Line total matches, file count does not — update FILE_COVERAGE accordingly.
2. **Stale "endpoint rolling out" narrative:** `ModelInsights.jsx:3` and the 404 branch (F2) still describe `/model/importance` as not-yet-deployed, but SPEC §14 says the integration agent added it and `backend/app/api/model.py` implements it (503-on-missing-artifact). If docs-truth or llba-backend agents quote the frontend comment as evidence the endpoint is provisional, that's stale — the endpoint is live code.
3. **`frontend/dist/` regenerated:** my mandated fresh `npm run build` overwrote `dist/` (new content-hashed filenames). Not a source change, but any agent diffing dist against a prior snapshot will see churn caused by me.
4. **Shared TodoList clobbering:** the session todo list was overwritten twice by other agents mid-run (test-audit, llba-training items appeared). No action needed beyond awareness; my tracking survived in this report.

## Coverage

- **Files read in full:** 16/16 under `frontend/src/` (2,271 lines), plus `frontend/index.html`, `vite.config.js`, `eslint.config.js`, `package.json`, `.env.example`, `public/favicon.svg`.
- **Backend cross-reads (contract side):** 8 files listed in the scope header.
- **Functions verified:** every exported function/component in src — `api.{health,predict,modelInfo,modelImportance,marketClusters,metrics}`, `ApiError`, `extractDetail`, `request`, `useApi`, `formatUsd`, `formatPct`, `formatNumber`, `formatUptime`, `prettyFeature`, `App`, `Layout`, `BrandMark`, `ApiStatus`, `ValuationPage`, `ValuationForm`, `Field`, `MicroMarketCard`, `PredictResult`, `MarketMapPage`, `buildColorMap`, `ModelInsightsPage`, `Section`, `ChampionCards`, `ImportanceChart`, `DriftPanel`, `Loading`, `ErrorState`, `EmptyState`, `PriceBand`, `ProbabilityGauge`, `FactorBars`, `StatCard`.
- **Executed (not just read):** lint, production build, format.js edge cases (26), schema field/categorical/range cross-checks (55 + 20 + 31), neighborhood diff (25), contrast computation (14 pairs).
- **Not executed (out of scope, owned by wave B):** live rendering, browser E2E, runtime a11y audit, dev-server proxy behavior.
