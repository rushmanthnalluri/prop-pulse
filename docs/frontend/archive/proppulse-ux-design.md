# PropPulse — UX & Frontend Design Specification

This is the implementation contract for the PropPulse frontend rebuild. It translates the PlacementPredict quality bar (see `placementpredict-ui-inventory.md`) into a PropTech product with its own identity, built **only** on real backend data (`backend/app/api/*` — no fabricated metrics anywhere).

## 1. Product identity

- **PropPulse — Property Intelligence for Ames, IA.** Professional PropTech analytics product.
- Light theme, navy ink, deep-teal accent. Hairlines over boxes. No gradients, no glow, no decorative illustration.
- Inter for UI, IBM Plex Mono for all data/labels/values (loaded in `index.html` via Google Fonts with `display=swap`).
- Voice: precise, honest, provenance-aware. Every derived number can be traced to an API field. Disclosures (simulated sale-speed target, 2006–2008 training window, approximate geo centroids) appear as mono `note` microcopy exactly where the data is shown.

## 2. Information architecture

Sidebar app-shell (PlacementPredict pattern) with grouped nav — **not** a linear pipeline, because PropPulse is a product, not a wizard.

```
Brand: PropPulse mark + "Property Intelligence"

ANALYZE
  Overview             /
  Valuation            /valuation        (?neighborhood=<code> prefill supported)
  Market Intelligence  /market

PLATFORM
  Model Insights       /model
  System Health        /health

Footer: API status pill + engine version line
```

Catch-all `*` → branded **404 page** (recovery links to Overview + Valuation). Every page sets `document.title` ("Valuation — PropPulse" etc.).

**Why five pages:** each maps to real endpoints. Overview = `/model/info` + `/market/clusters` + `/model/importance` + `/market/trends`. Valuation = `/predict` + `/market/comps` + `/predict/price`. Market = `/market/clusters` + `/market/trends`. Model = `/model/info` + `/model/importance`. Health = `/health` + `/metrics`. No page exists without a data source; "Sale Probability" is a first-class section of the Valuation result, not a separate page (the classifier only exists through `/predict`).

## 3. User journey (designed)

```
Overview (what is this, is it alive, what drives value, market snapshot)
   │  CTA "Value a property"
   ▼
Valuation ── grouped form (Property / Size / Rooms / Quality & age / Amenities / Advanced)
   │  submit (busy verb "Valuing…")
   ▼
Result: hero price + interval band → sale probability → micro-market → market position
        → why this value (factor bars) → comparable sales → what-if explorer
   │  cross-links
   ▼
Market Intelligence (map → cluster → neighborhood table → trends)  ──"Value a home here"──▶ Valuation?neighborhood=X
   │
   ▼
Model Insights (can I trust it: champions, val vs test metrics, confusion matrix, importance, bootstrap)
   │
   ▼
System Health (is it alive: service status, ops counters, drift)
```

PlacementPredict journey equivalent: their pipeline stepper ≙ our grouped nav + cross-link CTAs; their sticky predict result ≙ our sticky result column; their evaluate page ≙ our Model Insights; their benchmark console ≙ our (omitted — no equivalent backend capability).

## 4. Design tokens (`styles.css`)

```css
--bg:#F4F6F7        page background (cool paper)
--surface:#FFFFFF   cards/panels/table headers
--raised:#EDF1F2    wells, tracks, code chips
--border:#DFE4E6    hairlines
--border-strong:#C3CCD0   input borders, hover borders
--text:#16283C      ink navy
--text-2:#48586B    secondary
--text-3:#6E7C8B    tertiary/captions
--accent:#0E7A6D    deep teal (primary action, positive series, active nav)
--accent-hover:#0A655B
--accent-ink:#FFFFFF
--accent-dim:rgba(14,122,109,.10)
--navy:#123152      brand mark only
--success:#1F8A55   --danger:#B6463C  --danger-dim:rgba(182,70,60,.08)
--warn:#A8690F      --warn-dim:rgba(168,105,15,.10)
--slate:#4C6E91     secondary series
--ochre:#B98A2F     categorical 3
--terra:#B4593F     categorical 4 / negative series
--radius-sm:4px  --radius:6px  --radius-lg:8px
```

Cluster palette (single source in `constants.js` as `CLUSTER_COLORS`, consumed by map + trends + cards): `['#0E7A6D','#4C6E91','#B98A2F','#B4593F']` indexed by `cluster_id` (fallback for id ≥ length: rotate).

Typography: body 14 px/1.55 Inter. h1 27 px/600/−0.02em (23 px ≤820 px). Kickers/legends/table heads/badges = Plex Mono uppercase (kicker 11 px ls .11em; th 10 px ls .09em; badge 9.5 px ls .07em). Metric values mono 23 px/500. Hero price mono 34 px/600. `tabular-nums` on every numeric display (`th,td,.metric-value,.mono` etc.).

Layout: `.app-shell` flex; `.sidebar` 248 px sticky 100 vh, surface bg + right hairline; `main` max-width 1040 px, padding 0 40 px; `.section` 40 px vertical rhythm; hairline `.divider` between major sections.

Breakpoints: **1024** (two-col page grids → 1 col, result/side rails un-stick), **900** (sidebar → top bar: brand row + horizontal scrollable nav strip, active = inset bottom bar, auto-scroll into view), **640** (metrics 2-col with alternating left borders, h1 23 px, form field grids 1-col), **420** (main padding 18 px, metrics stay 2-col). Must be verified at 1920×1080, 1440×900, 1280×720, 1024×768, 768×1024, 390×844.

Global rules: `::selection` accent-tinted; one focus treatment — `:focus-visible { outline:2px solid var(--accent); outline-offset:2px }` on **every** interactive element (links, buttons, inputs, selects, sliders, summary, scroll regions); `prefers-reduced-motion` kills transitions/animations; thin styled scrollbars on `.table-scroll` and nav strip.

## 5. Class inventory (the shared CSS contract)

Shell: `.app-shell` `.sidebar` `.side-brand` `.side-nav` `.nav-caption` `.nav-item` (`.active`) `.side-foot` `.topbar` (mobile) `.main` `.container`
Page head: `.page-head` `.kicker` `.page-title` `.page-desc` `.page-meta`
Structure: `.section` `.section-head` `.section-title` `.section-note` `.divider`
Metrics: `.metrics` (bare grid, hairline-separated) `.metric` `.metric-label` `.metric-value` `.metric-hint` (tone mods `--good` `--bad` `--warn`)
Panels: `.panel` `.panel-head` `.panel-title` `.panel-body` `.panel-foot`
Charts: `.chart-card` (`.chart-card-wide`) `.chart-head` `.chart-tag` `.chart-wrap` (heights via `--h` var or mods)
Tables: `.table-scroll` `.table` `.table-sticky` cells `.num` `.dim` `.strong` `.accent`; scroll affordance shadow
Badges: `.badge` `.badge-accent` `.badge-warn` `.badge-danger` `.badge-muted`
Alerts: `.alert` `.alert-error` `.alert-info` `.alert-warn` (+`.alert-title` `.alert-actions`) `role=alert`
Buttons: `.btn` `.btn-primary` `.btn-secondary` `.btn-ghost` `.btn-sm` `.is-busy` (injects `.spinner`); disabled 60% opacity
Forms: `.form-grid` `.fieldset` (`legend` mono uppercase) `.field` `.field-label` `.field-input` `.select` `.field-hint` `.field-error` `.input-error` `.field-row` (2-col)
States: `.state-view` `.empty-state` `.skeleton` `.sk-line` `.sk-block` (shimmer, reduced-motion safe)
Result: `.result-hero` `.result-price` `.result-caption` `.band` `.band-fill` `.band-marker` `.gauge` `.gauge-track` `.gauge-fill` `.gauge-tick` `.factor-list` `.factor-row` `.factor-track` `.factor-fill` (`--neg`) `.cm-grid` (confusion matrix) `.legend` `.swatch`
Map: `.map-shell` `.map-legend` `.cluster-card` (`.active`)
Misc: `.note` `.mono` `.link-quiet` `.skip-link` `.spinner` `.error-banner` `.kv` (hairline dl rows) `.pill-tabs`? — **no**, no tabs; sections instead.

## 6. Component contract (React)

Keep and harden (from current app): `api/client.js` (30 s timeout, ApiError, 422 flattening), `api/useApi.js` (abort + stale-while-revalidate), `StateView` (extend with skeletons), `PriceBand`, `ProbabilityGauge`, `FactorBars`, `MarketPosition`, `ScenarioExplorer`, `TrendsChart`, `CompsTable` (add retry), `StatCard` → becomes `.metrics` usage.

New: `ErrorBoundary` (class component; wraps each route outlet — shows `.alert-error` with "Reload" + reports component stack to console only), `Layout` (sidebar shell, API status pill with 30 s poll + **global `.error-banner` when API is down**, mobile topbar), `NotFound`, `ConfusionMatrix` (CSS grid, real counts from `/model/info`), `MetricsTable` (val vs test), `DriverBars` (global importance top-N), `ClusterRail` + `MapLegend`, `NeighborhoodTable`, `OverviewHero`, `Field` (label + input/select + hint + inline error, `aria-invalid`, `aria-describedby`).

NaN discipline (P0): every numeric prop guarded with `Number.isFinite`; bars/gauges clamp NaN → render null or '—', never `width:NaN%` or `aria-valuenow=NaN`.

**No hardcoded metrics.** MAE/coverage figures come from `/model/info` (`regression.test_metrics.mae`, `regression.test_metrics.interval_coverage`). `ConfidenceNote` and `PriceBand` captions receive these via props (fetched once on Valuation mount, additive — if unavailable, omit the number, keep the note).

## 7. Page specifications

### 7.1 Overview `/`
- **Hero** (grid 1.25fr/0.75fr): kicker `PROPERTY INTELLIGENCE · AMES, IA`, h1 "Know what a home is worth — and why.", desc (valuation + calibrated sale probability + micro-market context, trained on the Ames 2006–2008 corpus), CTAs: primary "Value a property" → `/valuation`, secondary "Explore the market" → `/market`. Right: `.panel` "Engine status" — `/health` (models_loaded as badge rows) + `/model/info` (regression `ridge_v1`, classification `random_forest_v1`, dataset `ames-1.0`, 94 features, selected_at formatted) as `.kv` rows; footer link "Model details →" `/model`.
- **Metrics row** (all real): Neighborhoods covered = `clusters.neighborhoods.length` (25); Micro-markets = `n_clusters` (4); Training sales = Σ `clusters[].n_sales` (675); Test R² = `headline_metrics`/`regression.test_metrics.r2` (0.930); Test MAE = `regression.test_metrics.mae` ($15.1k).
- **What drives value**: top 5 from `/model/importance` as `.driver-row`s (pretty names via `prettyFeature`, mono mean-|SHAP| values, units note "log1p(SalePrice)").
- **Micro-markets**: 4 `.cluster-card`s from `/market/clusters` (label, median price, $/sqft, n_sales, velocity with simulated-target badge) → link `/market`.
- **Market snapshot**: `TrendsChart` (existing, wide).
- **How it works**: 4-step hairline list (Describe the property → Valuation + interval → Sale probability → Explanation & comps) — presentational, links to `/valuation`.
- **Disclosure note**: simulated sale-speed target (ADR-3); historical 2006–2008 data, not current listings.
- States: each section skeletons independently; section-level error alerts with retry; if `/health` down, hero panel shows offline state instead of spinner forever.

### 7.2 Valuation `/valuation`
- Grid `1.05fr/1fr`; right column sticky (`top:24px`) result rail; ≤1024 px stacks.
- **Form** (`.fieldset` groups, 2-col `.field-row`s):
  - *Property*: `neighborhood` (select, 25 codes with display names), `house_style`, `bldg_type`, `ms_zoning` (selects with real enum labels)
  - *Size*: `gr_liv_area` (300–6000 sq ft), `lot_area` (500–200000), `lot_frontage` (1–500, optional), `total_bsmt_sf` (0–4000)
  - *Rooms*: `bedrooms` 0–8, `full_bath` 0–4, `half_bath` 0–2, `bsmt_full_bath` 0–3, `bsmt_half_bath` 0–2
  - *Quality & age*: `overall_qual` 1–10, `overall_cond` 1–10, `year_built` 1870–2010, `year_remod_add` (optional, ≥ year_built)
  - *Amenities*: `garage_cars` 0–5, `garage_area` 0–2000, `fireplaces` 0–4, `central_air` select, `wood_deck_sf`, `open_porch_sf`, `screen_porch`, `pool_area`
  - *Advanced overrides* (`<details>`): the 29 optional overrides from `PropertyInput` (enums as selects, numerics with ranges) — sent only when non-empty.
  - Every field: label, unit in label or hint, sensible default prefill, hint where the backend default is non-obvious (e.g. "blank → training median"). 
- **Validation**: client-side on blur + on submit — required, range, type; inline `.field-error` under the field (`aria-invalid`, `aria-describedby`), first-invalid focus, consolidated `.alert-error` summary on submit failure. Server 422 details are mapped back to fields where `loc` matches.
- **Submit**: busy button "Valuing…", abort on unmount, keep previous result visible under a subtle dim while reloading (stale-while-revalidate), scroll result into view on ≤1024 px after success.
- **Result rail** (sticky, in order):
  1. `.result-hero`: kicker "ESTIMATED MARKET VALUE", mono 34 px price, caption "Ridge regression · log-price model · ridge_v1" (from `model_version`).
  2. Price band: `.band` low—estimate—high; caption "Model interval from validation residuals · ≈78% empirical coverage on the sealed test split" — coverage figure from `/model/info`, omitted if unavailable.
  3. Sale probability: `.gauge` with threshold tick at 0.203292 (from response), verdict badge "Likely fast sale"/"Slower sale" at `sells_within_30_days`, **badge-warn "Simulated target"** + note (ADR-3).
  4. Micro-market panel: label, median price, $/sqft, velocity (badge-muted "simulated"), `fallback` → badge-warn "nearest market" + note; link "See on map →" `/market`.
  5. Market position (existing component, NaN-guarded).
  6. Why this value: `.factor-list` (top_price_factors; pretty names; impact sign color; magnitude share bars). Empty → EmptyState "Explanation unavailable for this valuation."
  7. Confidence note: API `confidence.reasons` verbatim; when `level='typical'`, caption uses test MAE from `/model/info` (prop), else nothing hardcoded.
  8. Comparable sales: `CompsTable` (+ retry button on error; `match_scope` note; percentile line; `calendar_clamped` note; honesty note rendered).
  9. What-if explorer: `ScenarioExplorer` (existing; keep debounce+abort; per-lever error gets retry-on-nudge copy).
- **Empty state** (pre-submit): panel with mono kicker "NO VALUATION YET", 3-line explainer of what the result contains.
- **Error state**: `.alert-error` with the flattened 422/network message + "Try again" (resubmits) + form values preserved.
- `?neighborhood=<code>` prefill: validated against the 25 codes; **re-applies when the param changes** (fix current mount-only read).

### 7.3 Market Intelligence `/market`
- Page head + provenance meta "25 neighborhoods · 4 micro-markets · sales 2006–2008".
- **Map section** (grid `1fr/320px`): Leaflet map (Ames center, zoom 12, OSM tiles + attribution), 25 guarded `CircleMarker`s (skip + count log for malformed points), tooltip = display name, popup = cluster label, medians, velocity (simulated caveat), fallback note, "Value a home here →" link. **`.map-legend`** under map: 4 swatches = cluster labels. Right rail: 4 `.cluster-card`s (click → set active, map flies to centroid; active card gets inset accent bar).
- Guard: `cluster.neighborhoods ?? []`, `Number.isFinite(lat/long)` per point.
- **Neighborhood table**: 25 rows (display name, code `.mono`, cluster label + swatch, `fallback` badge-warn "approx." where true). `.table-scroll` with sticky header.
- **Trends**: `TrendsChart` wide + note.
- States: loading skeletons (map block + card lines), error with retry, empty (`neighborhoods.length===0`) → EmptyState.

### 7.4 Model Insights `/model`
- **Champion cards** row: Regression (`ridge_v1`, headline: Test RMSLE 0.1187, R² 0.930), Classification (`random_forest_v1`, calibrated badge, Test ROC-AUC 0.767, threshold 0.203292, **simulated-target badge**), Clustering (4 markets), plus engine meta (94 features, feature_version hash mono, dataset ames-1.0, selected_at).
- **Regression performance**: `.table` val vs test (MAE, RMSE, R², RMSLE, interval coverage test-only) + bootstrap note (runner-up xgboost, prob 0.1925, "not significant" → plain-English sentence).
- **Classification performance**: val vs test table (ROC-AUC, PR-AUC, Precision, Recall, F1, Brier) + **CSS confusion matrix** (test: tn 57, fp 69, fn 9, tp 40 — from API, not hardcoded) + threshold note ("decision threshold 0.203292, tuned on validation; not 0.5").
- **Feature importance**: top-20 horizontal bars (`/model/importance`), metadata caption (explainer, units, background 200, val sample 200, seed 42).
- **Champion rationale**: `<details>` with `info.rationale`.
- **Honesty block**: simulated target disclosure + "models selected on validation; test split touched once" note.
- States: three independent sections (info / importance), each skeleton + error + retry.

### 7.5 System Health `/health`
- **Service status**: `/health` models_loaded rows (badge-accent "loaded" / badge-danger "missing") + status line; uptime / requests_total / errors_total / avg_latency_ms as `.metrics` (from `/metrics`; caption "process lifetime, resets on restart"); `formatUptime` revived.
- **Traffic**: `requests_by_path` table (route template, count).
- **Feature drift**: existing DriftPanel logic → no_data → EmptyState + how-to-generate note (`python -m ml.monitoring.drift_check` on `logs/predictions.jsonl`; window 500, thresholds PSI 0.1 warn / 0.2 drift from payload); ok → PSI bars + drifted/warn feature lists + prediction PSI + retraining recommendation + timestamp.
- **Prediction logging note**: every `/predict*` call is appended to `logs/predictions.jsonl` (privacy/ops transparency).
- Auto-refresh: 30 s poll (match Layout) with "Updated HH:MM:SS" meta.

### 7.6 NotFound `*`
- Kicker "ERROR 404", h1 "This page moved or never existed.", two buttons: "Back to overview" (primary), "Value a property" (secondary).

## 8. State & quality gates (apply to every async view)

| Concern | Rule |
|---|---|
| Loading | Skeletons matching final layout (not bare spinners) for panels/tables/charts; button busy-verbs for actions |
| Error | `.alert-error` + flattened API detail + **retry** on every fetch view; never `undefined`/`NaN`/`[object Object]`; no stack traces |
| Empty | `.empty-state` with reason + next action |
| API down | Layout poll → global `.error-banner` under header + per-view error states; recovery without reload when API returns |
| Abort | AbortController on every fetch; superseded runs never set state |
| a11y | skip link, focus-visible everywhere, `role=status`/`aria-live` on async regions, `role=img`+aria-label on charts/markers, keyboard-operable `<details>`/selects, reduced-motion |
| Routing | per-page `document.title`, 404 catch-all, lazy routes with Suspense skeleton + ErrorBoundary |
| Numbers | `Number.isFinite` guards; `tabular-nums`; money via `formatUsd`; percents 1dp |
| Copy | "neighborhood" (US spelling) everywhere; provenance captions on every derived figure |

## 9. Explicit non-goals

- No toasts/modals/tabs (PlacementPredict has none; alerts + banners are the idiom), no dark-mode toggle, no fabricated metrics (no "properties analyzed" counters that don't exist — `/metrics` counters only on Health, labeled process-lifetime), no prediction history/save (no backend), no per-property uncertainty claims beyond the global interval, no classifier explanation (none exists), no current-market claims (data is 2006–2008), no map pins for comps (no coords).

## 10. e2e & verification

- Update Playwright specs (`e2e/tests/`) to the new DOM: keep the existing coverage intent (happy paths, API-down, timeout, degraded health, empty factors, mobile 390 px, drift low-sample, comps degradation, trace-truth DOM↔API byte-equal).
- `npm run build` must pass; `npm run lint` must pass.
- Manual QA at all six breakpoints; tab-order pass on Valuation; keyboard-only prediction submission must work.
