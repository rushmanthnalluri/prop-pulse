# PropPulse Frontend Audit — Pre-Rebuild Inventory

**Date:** 2026-08-08 · **Scope:** `frontend/` (Vite 6 + React 19.2 + react-router 8.3 + recharts 2.15 + react-leaflet 5) · **Method:** full read of every file under `frontend/src/` (21 files), `index.html`, `vite.config.js`, `eslint.config.js`, `package.json`, `.env.example`; verified with `npm run build` and `npm run lint`.

**Verdict up front:** this is a disciplined, engineering-first frontend. Data flow, async-state handling, and API honesty are strong. What it lacks is exactly what the rebuild is about: visual ambition, interaction polish, and several UX systems a professional PropTech SaaS treats as table stakes (toasts, cache, table interactions, chart accessibility, saved work). Most component *logic* is salvageable; most *presentation* is not the target quality bar.

---

## 1. Current architecture

### 1.1 Routing (`src/App.jsx`)

`createBrowserRouter` with a single layout route and five children:

| Path | Page component | Loaded | ErrorBoundary |
|---|---|---|---|
| `/` | `pages/Overview.jsx` | eager | yes (`App.jsx:30`) |
| `/valuation` | `pages/Valuation.jsx` | eager | yes (`App.jsx:31`) |
| `/market` | `pages/Market.jsx` | lazy | yes + `Suspense` (`App.jsx:32`) |
| `/model` | `pages/ModelInsights.jsx` | lazy | yes + `Suspense` (`App.jsx:33`) |
| `/health` | `pages/Health.jsx` | lazy | yes + `Suspense` (`App.jsx:34`) |
| `*` | `pages/NotFound.jsx` | eager | **no** |

Lazy routes show `PageSkeleton` while the chunk loads. Note the split logic: `Market` is lazy because of Leaflet, `ModelInsights`/`Health` are lazy — but **recharts still lands in the main bundle** because `TrendsChart` (recharts `LineChart`) is imported eagerly by `Overview.jsx:18` and `Market`. See §4.

### 1.2 Layout (`src/components/Layout.jsx`)

- Desktop: 248px sticky sidebar (`.sidebar`), brand mark (inline SVG, `Layout.jsx:37-45`), two nav groups (`Analyze` / `Platform`, `Layout.jsx:11-27`), footer with API status pill + static meta.
- ≤900px: sidebar hidden, sticky topbar with horizontally scrolling nav (`styles.css:972-1007`); the active item is auto-scrolled into view on route change (`Layout.jsx:131-134`). No hamburger/drawer — nav is a scrollable strip.
- `document.title` per route (`Layout.jsx:29-35, 126-128`).
- Global API status: `useApiStatus` polls `GET /health` every 30s, pauses when the tab is hidden, re-checks on visibility return and on click (`Layout.jsx:47-78`). Four states: `checking | up | degraded | down`; `down`/`degraded` render a global banner with a retry button (`Layout.jsx:175-196`).
- Skip link (`Layout.jsx:138`), `<Outlet context={{ apiStatus: status }}>` (`Layout.jsx:199`) — **the context is dead**: no page calls `useOutletContext`.
- Footer is static text with the standing disclosures (`Layout.jsx:202-205`).

### 1.3 API client (`src/api/client.js`)

- Base URL: `import.meta.env.VITE_API_URL || 'http://localhost:8000'`, trailing slashes stripped (`client.js:14`). Root-level routes, no `/api` prefix. `.env.example` documents the one variable.
- One `request()` wrapper (`client.js:45-87`): JSON headers, **30s timeout** via `AbortSignal.timeout`, caller signal merged via `AbortSignal.any` (`client.js:49-50`) — modern-browser-only API (Chrome 116+/Safari 17.4+), no polyfill.
- Error model: `ApiError` carries `.status`; network failure and timeout become `ApiError` with status 0 and human-readable messages (`client.js:58-70`); FastAPI 422 detail lists are flattened to `"loc: msg; loc2: msg2"` (`client.js:31-43`).
- **No retry/backoff, no cache, no dedup.** Nine methods, all used: `health`, `predict`, `predictPrice`, `modelInfo`, `modelImportance`, `marketClusters`, `getComps`, `getTrends`, `metrics` (`client.js:89-98`).

### 1.4 Data-fetching hook (`src/api/useApi.js`)

`useApi(fetcher)` → `{ data, loading, error, reload }` (37 lines). Aborts on unmount and on superseding reload; swallows `AbortError`; keeps previous data while reloading (stale-while-revalidate within one page). Requires the fetcher to be memoized — every page does this correctly with `useCallback`. There is **no cross-page cache**: revisiting a page always refetches, and `Layout` polls `/health` independently of pages that also fetch it.

### 1.5 State management

None, deliberately. Server state lives in `useApi` per page; form state is local `useState` in `Valuation`; the only cross-component coordination is props and the `?neighborhood=` search param (Market map → Valuation prefill). No Context, no store library. This is fine at this size but means **nothing persists across navigation** — a submitted valuation is lost when leaving `/valuation`.

### 1.6 Styling

One global 1044-line `styles.css` imported in `main.jsx:4` (plus `leaflet/dist/leaflet.css` globally in `main.jsx:3`). Design tokens as CSS custom properties (`styles.css:7-35`): light-only palette, teal accent `#0e7a6d`, Inter UI + IBM Plex Mono data fonts (Google Fonts in `index.html:11-16`). Naming is BEM-ish kebab with variants (`--modifier`): `.panel`/`.panel-head`/`.panel-body`, `.metric-value--bad`, `.chart-card--wide`. No CSS modules, no preprocessor, no Tailwind. Inline `style={{}}` is used liberally for one-off layout (margins, flex gaps) — ~40 occurrences across pages/components. Responsive: 4 breakpoints (1024/900/640/420, `styles.css:965-1030`), `prefers-reduced-motion` honored (`styles.css:1036-1044`). Dead CSS exists: `.metric-value--good` (:338), `.alert-warn`/`.alert-info` (:440-443 — Layout's degraded banner uses inline styles instead, `Layout.jsx:187`), `.btn-ghost` (:481), `.link-quiet` (:485), `.state-view-title` (:692), `.gauge-fill--neg` (:769) are defined but never used in JSX.

### 1.7 Formatting helpers (`src/format.js`)

Pure, null-safe (`'—'` fallback everywhere): `formatUsd`, `formatPct`, `formatNumber`, `formatUptime`, `formatDateTime`, `formatMetric`, and `prettyFeature` (snake_case/CamelCase → labels with a known-labels dictionary, `format.js:56-90`). One of the strongest files in the codebase — keep verbatim.

### 1.8 Constants (`src/constants.js`)

Hand-mirrored API contract: 25 neighborhoods, enum option sets, `ENUM_LABELS`, `DEFAULT_FORM`, and a 39-entry `ADVANCED_FIELDS` schema that drives the advanced form declaratively. `clusterColor()` is the single source of truth for cluster colors across map/cards/chart (`constants.js:60-66`). Hardcoded `max: 2026` years (`constants.js:124, 159`) will rot.

---

## 2. Page-by-page status

### 2.1 Overview (`src/pages/Overview.jsx`, 362 lines)

- **Purpose:** marketing-flavored landing: hero + engine status, headline metrics, top drivers, micro-market cards, trends, how-it-works, disclosures.
- **Endpoints:** `GET /health`, `GET /model/info`, `GET /market/clusters`, `GET /model/importance` (all page-level, `Overview.jsx:225-232`) **plus** `GET /market/trends` via self-fetching `TrendsChart` — **5 requests on first landing**, no dedup with Layout's concurrent `/health` poll.
- **Sections/components:** `EngineStatusPanel`, `MetricsRow` (in-file), `DriverBars`, `ClusterCard` ×4, `TrendsChart`, static `HOW_IT_WORKS`.
- **States:** every async section has skeleton → error+retry → content; clusters additionally have an explicit empty state (`Overview.jsx:306-312`). Partial degradation is real: a failed `/model/importance` doesn't touch metrics. Metrics degrade individual values to `'—'` rather than lying (`Overview.jsx:153-200`).
- **Issues:** five-fetch waterfall on the most-visited page; hero is a text column + status panel — no product visual, no screenshot, no map teaser; `HOW_IT_WORKS` is static text duplicating what the product tour should show; "Training sales" hint says "2006–2008" which undercuts the "intelligence" framing for a buyer persona.
- **Responsive:** hero grid collapses at 1024px; metrics 5→2 columns at 640px (`styles.css:1013-1014`). Fine.
- **Rating: 7/10.** Structurally excellent, visually anonymous. It reads like an internal tools dashboard, not a PropTech landing.

### 2.2 Valuation (`src/pages/Valuation.jsx`, 632 lines — the core page)

- **Purpose:** property form → `POST /predict` → sticky result rail (price hero, interval, probability, micro-market, position, factors, confidence, comps, what-if).
- **Endpoints:** `GET /model/info` once (additive captions only, `Valuation.jsx:496-499`); `POST /predict` on submit (`Valuation.jsx:511`); then per-result `POST /market/comps` (CompsTable) and `POST /predict/price` per slider move (ScenarioExplorer).
- **Form:** 5 fieldsets (`FIELD_GROUPS`, `Valuation.jsx:54-105`) + a `<details>` with 30 advanced overrides driven by `ADVANCED_FIELDS`. `?neighborhood=` prefill validated against the 25 codes and re-applied on param change (`Valuation.jsx:267-279`) — nicely done.
- **Validation:** client-side type/integer/range + cross-field check (remodel ≥ year built, `Valuation.jsx:143-157`); runs **on blur and on submit, not on change**; inline `field-error` with `aria-invalid`/`aria-describedby`; error summary with the first 6 issues; auto-focuses first invalid field and force-opens the advanced `<details>` when the error is inside it (`Valuation.jsx:317-336`); server 422s are mapped back to fields (`Valuation.jsx:283-297`). This is the best validation in the app — and still mid-tier by SaaS standards: no on-change revalidation after first error, no success affordance, no dirty tracking.
- **States:** first-run skeletons, inline error alert with "Try again" (resubmits the stored payload, `Valuation.jsx:568-582`), pre-submit EmptyState (`:584-590`), previous result kept dimmed while reloading (`:592-601`). **Flaw:** when a re-submit *fails*, the catch wipes the previous result (`setState({ result: null, ... })`, `:523`) — the dimmed-while-loading promise is broken at exactly the moment it matters.
- **Issues:**
  - The 422 mapping parses the flattened `"loc: msg; loc2: msg2"` string with a regex (`Valuation.jsx:286-289`) — brittle string-surgery on a format the frontend itself created in `client.js:34-41`; a structured error payload would be robust.
  - `year_remod_add` allows up to 2026 in the form but ScenarioExplorer caps the lever at 2008 (`ScenarioExplorer.jsx:16`) — a submitted 2020 remodel year silently clamps in the what-if panel.
  - Result rail is a 9-panel stack — long scroll, no summary anchoring, no "back to top", no share/save/export. Leaving the page loses the valuation.
  - `metaParts` version line (`:527-548`) is mono 11px provenance — honest, but invisible to a normal user.
- **Responsive:** two-column → one column at 1024px, rail becomes static and the page smooth-scrolls it into view after success, honoring `prefers-reduced-motion` (`Valuation.jsx:516-519`). Genuinely thoughtful.
- **Rating: 7/10.** The strongest page by far in logic; the weakest in payoff presentation — the "wow" moment (the price) is one mono number in a plain panel.

### 2.3 Market (`src/pages/Market.jsx`, 147 lines)

- **Purpose:** Leaflet map of 25 neighborhoods + clickable micro-market rail (click → `flyTo`) + neighborhood table + trends.
- **Endpoints:** `GET /market/clusters` (shared by map, rail, table — no double fetch, good); `GET /market/trends` via `TrendsChart`.
- **States:** full skeleton grid, error+retry, explicit empty state (`Market.jsx:84-101`); map points are coordinate-validated before render, malformed ones skipped with a `console.warn` (`Market.jsx:39-60`) — **but the user is never told points were dropped**.
- **Issues:** table is unsortable/unfilterable and has no per-row action (the map popup has "Value a home here →", the table doesn't); map popups are mouse-only — keyboard users cannot reach the prefill link; the rail card ↔ map linkage is one-directional (clicking a marker doesn't highlight the card); page meta hardcodes "25 neighborhoods · 4 micro-markets" (`Market.jsx:78`) — cosmetic, but it *is* hardcoded data in a codebase that otherwise forbids it.
- **Responsive:** map+ rail → single column at 1024px, rail becomes 2-col grid then 1-col at 640px; map height shrinks 460→380→320px. Serviceable.
- **Rating: 6/10.** Functional and hardened, but it's a reference map, not an exploration tool: no search, no filtering by price band, no hover sync, no sortable table.

### 2.4 ModelInsights (`src/pages/ModelInsights.jsx`, 363 lines)

- **Purpose:** trust page — champion panels, val vs sealed-test tables, SHAP importance chart, rationale, honesty block.
- **Endpoints:** `GET /model/info`, `GET /model/importance` (`ModelInsights.jsx:275-279`).
- **States:** `AsyncSection` render-prop pattern (`:39-53`) — skeleton → error+retry → content per section. Clean and reusable.
- **Issues:** `/model/info` failure renders **three near-identical error boxes** (Champions, Regression, Classification — `:301-321`); the Classification section hand-rolls the same pattern instead of using `AsyncSection` (`:313-321`) — drift waiting to happen; the importance bar chart (recharts, `:236-264`) has `role="img"` + aria-label but **no data-table alternative** — screen-reader users get one sentence, not the 20 values; heavy `kv` lists make it a spec sheet, not a story.
- **Responsive:** `grid-2` collapses; confusion matrix columns shrink at 640px (`styles.css:1019`). OK.
- **Rating: 6/10.** Content is genuinely differentiated (bootstrap significance note `:170-178`, honesty block `:353-360`); presentation is flat and the triple-error repetition is sloppy.

### 2.5 Health (`src/pages/Health.jsx`, 391 lines)

- **Purpose:** ops page — service status, traffic by route, PSI drift report, logging note.
- **Endpoints:** `GET /health`, `GET /metrics`, auto-refresh every 30s (`Health.jsx:321-327`) — **unlike Layout's poll, this interval does not pause when the tab is hidden**.
- **States:** the most thorough state handling in the app — partial degradation when one of two fetches fails (`:99-108`), empty-traffic state, "no scored traffic yet" drift state with an ops CLI hint (`:285-303`), low-sample and calendar-drift badges, per-feature PSI bars with threshold-colored fills (`:227-255`).
- **Issues:** duplicative with Layout's status pill; "Updated HH:MM:SS" meta (`:342-346`) uses a `Date` in state that also updates on *either* fetch, slightly overstating freshness of the other; traffic table is sorted desc but not re-sortable.
- **Rating: 7/10.** Does its narrow job well; it's an internal page wearing a product skin.

### 2.6 NotFound (`src/pages/NotFound.jsx`, 27 lines)

- Branded 404 with two recovery links; `document.title` handled by Layout. No boundary (trivial render), no search or popular-links list.
- **Rating: 8/10.** Appropriate for its size.

---

## 3. Component-by-component status (16 components)

| # | Component | Props / data source | States handled | Verdict |
|---|---|---|---|---|
| 1 | `Layout.jsx` | none (polls `/health` itself) | checking/up/degraded/down | **KEEP-REFINE** |
| 2 | `ErrorBoundary.jsx` | children | crash state | **KEEP-REFINE** |
| 3 | `StateView.jsx` | — | skeletons/error/empty | **KEEP-REFINE** (delete dead `Loading`) |
| 4 | `ClusterCard.jsx` | `cluster`, `to` XOR `onClick` | finite-guards per stat | **KEEP-AS-IS** |
| 5 | `DriverBars.jsx` | `importance` object prop | empty state | **KEEP-AS-IS** |
| 6 | `TrendsChart.jsx` | self-fetches `/market/trends` | skeleton/error/empty | **KEEP-REFINE** |
| 7 | `NeighborhoodMap.jsx` | `points`, `clusters`, `activeCluster` | parent-validated | **KEEP-REFINE** |
| 8 | `NeighborhoodTable.jsx` | props from page | none needed | **KEEP-REFINE** |
| 9 | `ConfusionMatrix.jsx` | `matrix` prop | renders null on bad data | **KEEP-AS-IS** |
| 10 | `PriceBand.jsx` | `low/high/estimate/coverage` | null on degenerate | **KEEP-AS-IS** |
| 11 | `ProbabilityGauge.jsx` | `probability/threshold/...` | null on NaN | **KEEP-AS-IS** |
| 12 | `FactorBars.jsx` | `factors` prop | empty state | **KEEP-AS-IS** |
| 13 | `MarketPosition.jsx` | `marketPosition` prop | null on non-finite | **KEEP-AS-IS** |
| 14 | `ConfidenceNote.jsx` | `confidence`, `mae` | null on unknown shape | **KEEP-AS-IS** |
| 15 | `CompsTable.jsx` | `payload` → self-fetches `/market/comps` | skeleton/error/empty | **KEEP-REFINE** |
| 16 | `ScenarioExplorer.jsx` | `basePayload/basePrice` → `/predict/price` | per-lever loading/error | **KEEP-REFINE** |

Details on the REFINE set:

- **Layout** — dead `Outlet context` (:199); degraded banner uses inline styles instead of the unused `.alert-warn` class; mobile nav is a scroll-strip, not a real mobile nav; no ErrorBoundary above it (a Layout render error white-screens the app).
- **ErrorBoundary** — recovery is only "Reload page" / "Back to overview" (`ErrorBoundary.jsx:30-41`); no soft reset (re-render children) despite route keys existing in `App.jsx:19-23`; component stack goes to console only — fine, but no reporting hook.
- **StateView** — `Loading` (`StateView.jsx:6-13`) is exported but imported nowhere → delete. Skeletons are good and layout-matched; keep them.
- **TrendsChart** — the reason recharts (and ~700KB of main chunk) is eager; should be lazy-loaded or the chart lib swapped; needs a visually-hidden data table for a11y; otherwise solid (null gaps stay gaps, `connectNulls=false`, `:106-116`).
- **NeighborhoodMap** — popups/links unreachable by keyboard; no marker→rail sync; otherwise well-hardened (FlyToActive double-checks coords, `:23-34`).
- **NeighborhoodTable** — no sorting, no row action, no valuation link; sticky header is nice (`styles.css:663`).
- **CompsTable** — `key={index}` (`:107`); retry via `retryKey` is fine; the cluster-fallback disclosure (`:85-89`) is a good pattern to keep.
- **ScenarioExplorer** — debounced (300ms), aborts superseded runs, keyed by payload (`Valuation.jsx:621-625`) — the mechanics are right. Refine: slider-only input (no numeric entry), error recovery is "Nudge the slider to retry" (`:219`) instead of a retry button, and the 2008 remodel cap conflicts with the form's 2026.

No component needs a full REWRITE for logic reasons; rewrites will be presentation-driven. Nothing is so bad it earns DELETE except the dead `Loading` export and the dead CSS listed in §1.6.

---

## 4. Build & lint results (real, reproduced 2026-08-08)

**`npm run build` — PASS** (vite 6.4.3, 8.14s, 776 modules):

```
dist/index.html                          1.01 kB │ gzip:   0.53 kB
dist/assets/index-8eksE2Z3.css          38.61 kB │ gzip:  11.51 kB
dist/assets/Health-lWjAx6AN.js           9.56 kB │ gzip:   2.68 kB
dist/assets/ModelInsights-B4v6CzsG.js   11.39 kB │ gzip:   3.35 kB
dist/assets/Market-BkQPzG6c.js         161.33 kB │ gzip:  47.34 kB
dist/assets/index-CNO5v58z.js          745.62 kB │ gzip: 218.92 kB
(!) Some chunks are larger than 500 kB after minification.
```

The 745.62 kB main chunk is the one real build issue: recharts is pulled into the landing bundle through `Overview.jsx:18` → `TrendsChart.jsx:13-22`, defeating the route-level code-splitting that `App.jsx` carefully sets up. `leaflet.css` is also loaded globally (`main.jsx:3`) though Leaflet JS is correctly split into the Market chunk. Fixes: lazy-import `TrendsChart`, or `manualChunks` for recharts.

**`npm run lint` — PASS, 0 errors, 0 warnings** (eslint 9 flat config: `js.recommended` + `react-hooks` + `react-refresh`, `eslint.config.js`). Note the config is minimal: no `eslint-plugin-react` (jsx-runtime), no a11y plugin (`jsx-a11y`), no import-order — "lint is clean" means "hooks are correct", not "the code is accessible".

**Tests:** no unit/component tests exist for the frontend (no vitest/jest in `package.json`); only Playwright e2e in `../e2e/`. A rebuild has no JS-level safety net.

---

## 5. Gap analysis vs a professional PropTech SaaS

Ordered by user impact; every item is verifiable at the cited location.

1. **No caching / persistence layer.** Every navigation refetches every endpoint (`useApi.js` has no cache); a completed valuation vanishes when leaving `/valuation`. A SaaS would keep server state in a cache (TanStack Query-style) and valuations in history (localStorage at minimum).
2. **Main bundle 745 kB.** Landing users download recharts for a chart below the fold (`App.jsx` lazy-loads pages but not the chart). Mobile-first PropTech can't ship this.
3. **No toast/notification system.** All feedback is inline per-section alerts; transient successes (valuation complete, retry recovered) are silent.
4. **Chart accessibility is label-only.** `role="img"` + one-sentence `aria-label` on the trends chart (`TrendsChart.jsx:81-85`) and importance chart (`ModelInsights.jsx:238-243`); the underlying data is unavailable to screen readers (no table alternative). Map popups and their "Value a home here" links are mouse-only (`NeighborhoodMap.jsx:105-110`).
5. **Table interactions absent.** No sorting, filtering, or pagination anywhere (`NeighborhoodTable`, `CompsTable`, `TrafficTable`); no row actions; `CompsTable` uses `key={index}` (`CompsTable.jsx:107`).
6. **ErrorBoundary gaps.** NotFound route unguarded (`App.jsx:35`); Layout itself unguarded; recovery requires full page reload (`ErrorBoundary.jsx:34`).
7. **Validation UX is blur-only.** No revalidate-on-change after first error, no success checkmarks, no password-strength-style live feedback; 422 field mapping relies on regex-parsing a flattened string (`Valuation.jsx:286-289`) instead of structured data.
8. **Silent data degradation.** Skipped map points only `console.warn` (`Market.jsx:54-60`); partially-loaded Health sections are handled well but Overview's engine panel mixes skeleton/error/content in ways that can show badges for a failed `/model/info` without saying so clearly (`Overview.jsx:70-127`).
9. **Polling inconsistencies.** Health page polls while the tab is hidden (`Health.jsx:321-327`); Layout polls `/health` independently of pages that also fetch it (two concurrent `/health` consumers on Overview and Health).
10. **Mobile nav is a scroll-strip**, no drawer, no gesture support, captions disappear (`styles.css:1003`); functional but not app-like.
11. **Micro-typography below readability floor.** Field hints/errors at 9.5px mono (`styles.css:564-565`), badges 9.5px uppercase (`styles.css:414`), chart tags 10px — disclosure text nobody can read.
12. **No empty-result recovery paths.** Empty states explain but rarely act (no "try different inputs" prefill, no "load example property" on Valuation — a one-click demo property would kill the cold-start problem).
13. **No dead-end recovery on the result rail:** after an error, previous result is discarded (`Valuation.jsx:523`).
14. **No user-facing export/share** (copy link with payload in URL, PDF/print styles — none exist).
15. **Hardcoded years** (`2026` in `constants.js:124,159`, `Valuation.jsx:88-89`) and the 2008/2026 remodel inconsistency (`ScenarioExplorer.jsx:16`).
16. **Information hierarchy is flat.** Every panel has identical weight (`.panel` + `.panel-title`); the estimated price — the one number the user came for — shares visual rank with nine other panels. No summary bar, no progressive disclosure beyond the advanced `<details>`.
17. **Dead ends:** Market table rows link nowhere; ModelInsights offers no path to "try the model"; Overview's `HOW_IT_WORKS` has one link in four rows.
18. **No dark mode, no density/contrast settings** — `color-scheme: light` only (`styles.css:34`).

---

## 6. Salvage notes — foundations the rebuild must preserve

1. **`src/format.js` — keep verbatim.** Null-safe, consistently `'—'`, `prettyFeature`'s label dictionary is institutional knowledge.
2. **`src/api/client.js` — keep the wrapper semantics.** 30s timeout, `AbortSignal.any` caller-signal merging, FastAPI 422 flattening, `ApiError` with status. Add caching/retry around it; don't rewrite it. (Better: return the parsed 422 detail list structurally so Valuation stops regex-parsing.)
3. **`src/api/useApi.js` — keep the contract** (`{data, loading, error, reload}` + abort discipline); every page consumes it correctly. If a query cache replaces it, keep the same shape at the call sites.
4. **`src/constants.js` — keep as the contract mirror.** The declarative `ADVANCED_FIELDS` schema (name/label/kind/min/max/options/placeholder) is the right pattern — the rebuilt form should stay schema-driven.
5. **State-first rendering discipline.** Every async surface in the app has skeleton/error/empty handling with `Number.isFinite` guards before formatting (e.g. `ClusterCard.jsx:15-17`, `Market.jsx:39-52`). This is the hardest thing to retrofit — it's already done; carry the pattern forward.
6. **`StateView` skeletons and `ErrorState`/`EmptyState`** — keep the components (minus dead `Loading`); restyle, don't rethink.
7. **Route-level `ErrorBoundary` + lazy-route pattern in `App.jsx`** — keep; extend to wrap Layout and NotFound, and add soft reset.
8. **Honesty disclosures as first-class UI** — "simulated target" badges, interval-coverage captions, nearest-market fallbacks, `ConfidenceNote`. This is the product's differentiator; the new design must give it better visual placement, not remove it.
9. **`clusterColor()` single source of truth** (`constants.js:62-66`) — one color map shared by map, cards, table, chart. Keep the pattern whatever the new palette is.
10. **Naming and CSS token architecture** — the `--accent`/`--text-2` token set and `.panel`/`.metric`/`.kv` vocabulary are coherent and worth evolving into the new design system rather than replacing wholesale.
11. **The `?neighborhood=` prefill handshake** (Market popup → `Valuation.jsx:267-279`, validated + re-applied) — a genuinely good cross-page interaction to generalize (e.g. full payload-in-URL for shareable valuations).
12. **Valuation's submit pipeline** — abort-supersede (`Valuation.jsx:505-507`), keep-previous-dimmed (`:510`), scroll-into-view honoring reduced motion (`:516-519`), payload-keyed ScenarioExplorer remount (`:621-625`). Keep all four behaviors; fix the error path that discards the old result.

---

*Audit complete. Every file under `frontend/src/` was read in full; build and lint outputs above are real command results, not inferred.*
