# PropPulse — UX Architecture & Master Spec (Frontend Rebuild)

**Status:** definitive. This document settles design debates for the build team. Every endpoint,
field, and number traces to `docs/frontend/proppulse-api-contract.md` (cited as CONTRACT §x);
component verdicts trace to `docs/frontend/proppulse-frontend-audit.md` (cited as AUDIT §x).
Hard rules: no new npm dependencies (react, react-dom, react-router, recharts, react-leaflet,
leaflet only); no UI element may promise data the contract marks DERIVABLE or NOT AVAILABLE —
those are labelled **"not shown"** wherever a naive design would have included them.

---

## 1. DESIGN PRINCIPLES

PropPulse is a **valuation instrument, not a marketing site**. "Professional PropTech SaaS"
concretely means:

1. **The number is the hero.** The estimated price is the only 30px element in the app. Every
   page subordinates to the data it serves; chrome never competes with content.
2. **Light, literal, and ledger-like.** Light theme (property tools are trust tools — buyers
   read them in daylight, often beside a listing). Hairline dividers instead of card-in-card
   boxing; tabular mono numerals that align down columns like an appraisal worksheet.
3. **The UI teaches.** Adopt the reference's strongest trait: methodology-narrating copy.
   Every derived number carries one line of how/why ("~80% range — residual quantiles from
   validation; measured coverage 78.3% on the sealed 2010 test set"). Kickers carry real
   content (model version, threshold, scope), not decoration.
4. **Honesty is a feature, placed prominently.** Simulated-target badges, reduced-confidence
   warnings, nearest-cluster fallbacks, and historical-window notes are designed elements with
   dedicated components — never footnote-grey 9px text. Disclosures sit ≥11px (AUDIT §5.11
   sets the readability floor).
5. **Champion framing, decided once.** The backend selected ridge_v1 + random_forest_v1; the UI
   never asks the user to compare raw metrics. Champions are named, badged, and versioned;
   the runner-up bootstrap result (`significant: false`) is disclosed, not hidden.
6. **States are designed, not defaulted.** Every async surface has skeleton → error+retry →
   content, and every empty state offers an action (load example, retry, jump elsewhere).
   Nothing dead-ends (reference strength; AUDIT §5.12–13 shows we only half-do this today).
7. **Exceed the reference where it is weak.** No full-page reloads (we are an SPA — keep it
   that way), sortable tables, busy/progress feedback on every POST (`/predict` is CPU-bound
   at ~4–5 req/s, CONTRACT §5.12 — spinners are mandatory), payload-in-URL shareable
   valuations, and chart data available to screen readers as tables.

**Anti-goals (rejected on sight in review):** neon/saturated gradients, glow effects, particle
backgrounds, heavy glassmorphism, floating blobs, emoji-as-iconography, purple-blue "AI
template" palettes, oversized display type paired with stock illustration, confetti/celebration
animation, fake live data of any kind.

---

## 2. VISUAL IDENTITY / DESIGN TOKENS

### 2.0 Theme decision: EVOLVE, do not replace

The current `frontend/src/styles.css:7-35` theme is light, neutral, teal-accented, with the
exact token architecture (`--bg/--surface/--raised`, `--text/-2/-3`, hairline borders,
Inter+mono split) this spec needs (AUDIT §6.10 says evolve, don't replace). **Decision: keep
the light theme and the teal identity; keep every token name; refine values and add the missing
semantic aliases.** This preserves all 1044 lines of working CSS as a valid starting point,
keeps `styles.css` single-owner, and is strictly lower risk than a flip to dark or a new hue.
The reference's olive/amber is explicitly not adopted; teal-on-light is PropPulse's own mark
(and already what the brand mark in `Layout.jsx:37-45` uses).

### 2.1 Color tokens (exact values; **bold** = changed/added vs current)

| Token | Value | Use + 1-line justification |
|---|---|---|
| `--bg` | `#f4f6f7` | Page wash — cool paper grey; reads "spreadsheet daylight", keeps white panels meaningful. |
| `--surface` | `#ffffff` | Panels/cards — appraiser-white; highest trust surface. |
| `--raised` | `#edf1f2` | Inset tracks, table headers, skeletons — one step down from surface. |
| `--border` | `#dfe4e6` | Default 1px hairline — separation without shadow. |
| `--border-strong` | `#c3ccd0` | Inputs, emphasized hairlines — visible but never heavy. |
| `--text` | `#16283c` | Primary ink — navy-leaning near-black; financial, not sterile. |
| `--text-2` | `#48586b` | Secondary prose. |
| `--text-3` | `#5d6d7d` **(was #6e7c8b)** | Muted labels — darkened one step to hold 4.5:1 on `--bg` at 11–12px. |
| `--accent` | `#0e7a6d` | Brand teal — valuation/primary action; distinct from every competitor's blue and the reference's amber. |
| `--accent-hover` | `#0a655b` | ~8% darker for hover. |
| `--accent-ink` | `#ffffff` | Text on teal. |
| `--accent-dim` | `rgba(14,122,109,0.10)` | Badge washes. |
| `--accent-border` | `rgba(14,122,109,0.4)` **(new)** | Accent hairline — result-panel edge, active states. |
| `--accent-wash` | `rgba(14,122,109,0.05)` **(new)** | Champion-row tint, "measured thing" highlight. |
| `--navy` | `#123152` | Brand depth — hero headings, brand mark, footer; structural, never interactive. |
| `--success` | `#1f8a55` | Positive deltas, healthy status — used sparingly. |
| `--danger` | `#b6463c` | Errors and downward price pressure only — never decoration. |
| `--danger-dim` | `rgba(182,70,60,0.08)` | Error washes. |
| `--warn` | `#a8690f` | Reduced-confidence badge, drift warn band — "caution", distinct from error. |
| `--warn-dim` | `rgba(168,105,15,0.1)` | Warn washes (replaces Layout's inline styles, AUDIT §3.1). |
| `--slate` | `#4c6e91` | Chart series 2 / cluster 2. |
| `--ochre` | `#b98a2f` | Chart series 3 / cluster 3. |
| `--terra` | `#b4593f` | Chart series 4 / cluster 4. |

Semantic assignments (fixed, do not improvise): **teal = the measured thing** (price, primary
actions, champion); **green/red = deltas and health only**; **amber(warn) = honesty caveats**
(reduced confidence, simulated target, drift warn). In SHAP factor bars, positive price impact
= `--accent`, negative = `--danger` — the copy says "pushes the estimate up/down", never
"good/bad" (up is not good for a buyer). Cluster colors stay centralized in
`constants.js clusterColor()` (AUDIT §6.9) — the four series colors above.

### 2.2 Typography — Google-Fonts-free, no new deps

Remove the Google Fonts `<link>` from `frontend/index.html:11-16` (eliminates a render-blocking
third-party request; fixes FOUT; satisfies the no-new-font-deps constraint):

```css
--font-ui:   system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
--font-mono: ui-monospace, "SF Mono", "Cascadia Mono", Menlo, Consolas, "Liberation Mono", monospace;
```

Justification: system stacks are instant, private, and look native-serious on every OS; the
two-voice system (sans for prose, mono for numbers/labels/microcopy) survives the swap because
it is an assignment rule, not a typeface. `font-variant-numeric: tabular-nums` on every numeric
element (existing rule `styles.css:73-81`, KEEP).

Scale (base 14px / 1.55; floors raised per AUDIT §5.11 — nothing below 11px):

| Token | px | Use |
|---|---|---|
| `fs-micro` | **11** | Badges, hints, chart tags, table headers (uppercase mono, +0.06–0.09em) |
| `fs-meta` | 11.5–12 | Fact rows, metric labels, section links |
| `fs-label` | 12.5 | Field labels, notes, disclosure body |
| `fs-ui` | 13–13.5 | Buttons, table body, panel titles, alerts |
| `fs-body` | 14–14.5 | Body, page description |
| `fs-stat` | 22–23 | Metric values (mono 500, −0.02em) |
| `fs-h1` | 26–27 (23 ≤768px) | Page titles (600, −0.02em, `--navy`) |
| `fs-verdict` | 30 (24 ≤420px) | The estimated price — this size used nowhere else |

Signature move (adopted from reference): the **mono kicker** — 11px uppercase mono, +0.09em,
`--text-3`, carrying real content ("THE ESTIMATE — CHAMPION ridge_v1 · ~80% RANGE").

### 2.3 Spacing, radii, hairlines, layout

- Spacing scale (4-based): `4 8 12 16 24 32 48`. Section rhythm 48px, sections separated by
  full-width 1px hairlines (`.divider`), never whitespace alone. Card padding 14–16px;
  result hero 24–26px.
- Radii: `--radius-sm: 4px` (badges/chips), `--radius: 6px` (buttons/inputs/nav),
  `--radius-lg: 8px` (panels). Bars 3px. Nothing larger; no pills except status dots.
- **Hairline-vs-shadow policy:** depth = 3-level surface stack + hairlines. Elevation shadows
  are banned except one token, used only for floating layers (toasts, map popups):
  `--shadow-pop: 0 8px 24px rgba(18,49,82,0.14)` **(new)**. The only other "shadow" is the
  active-nav inset bar `inset 2px 0 0 var(--accent)`.
- Layout: sidebar 248px (keep), content column `--content-max: 1080px` **(was ~unspecified)**,
  page gutters 40px ≥1280 / 28px ≤1280 / 24px ≤900 / 16px ≤420. Prose blocks cap at 720px.

### 2.4 Motion

| Token | Value | Use |
|---|---|---|
| `--dur-hover` | `0.12s ease` | All hovers (color/background/border only) |
| `--dur-emphasis` | `0.5s cubic-bezier(0.2,0.7,0.2,1)` | Range-band fill, gauge fill on new estimate |
| `--dur-toast` | `0.18s ease-out` | Toast slide-in |
| `--dur-shimmer` | `1.4s linear infinite` | Skeleton shimmer |
| charts | 450ms | recharts `animationDuration`; `isAnimationActive={false}` under reduced motion |

Global `@media (prefers-reduced-motion: reduce)`: transitions/animations → 0.01ms, smooth
scroll off (extend existing `styles.css:1036-1044`). New shared hook
`components/shared/useReducedMotion.js` feeds recharts + the smooth-scroll-into-view on
Valuation (generalizes `Valuation.jsx:516-519`).

### 2.5 Breakpoints (max-width media queries; test widths in §8)

`1280` (gutter step) · `1024` (multi-col → single-col) · `900` (sidebar → topbar strip) ·
`640` (densify: metrics 2-up, smaller display type) · `420` (phone gutters). Keeps the four
existing queries (`styles.css:965-1030`) and adds 1280.

---

## 3. INFORMATION ARCHITECTURE

Routes unchanged from `frontend/src/App.jsx` — five pages + catch-all. One label rename.

```
ANALYZE
  Overview              /            landing + live evidence dashboard; every section links onward (fixes AUDIT §5.17 dead ends)
  Valuation             /valuation   the product: estimate + explanation + comps + what-if
  Market Intelligence   /market      map + micro-markets + neighborhoods + trends
PLATFORM
  Model Insights        /model       why trust it: champions, metrics, importance, honesty
  Model Health          /health      LABEL RENAMED from "System Health": page content is drift +
                                     traffic + service status — "Model Health" names the value
                                     (drift/retraining), not the plumbing. Route stays /health
                                     (e2e + bookmarks unbroken).
*                                    NotFound
```

Merge/split rulings (debated, settled): **Valuation stays one page** — predict + explanation +
comps + scenario are one decision flow; splitting would force payload-passing across routes.
**Model Insights and Model Health stay separate** — trust story (static artifacts) vs live
operations (per-process counters, drift) have different audiences and refresh models. **No
"Compare" page** — comps comparison lives inside Valuation where the subject already exists.
**No auth/settings/notifications nav** — the backend has none (CONTRACT §0); not shown.

Layout shell: KEEP `components/Layout.jsx` structure (sidebar → topbar ≤900, status pill,
skip link, 30s `/health` poll paused when hidden). REFINE: delete dead `<Outlet context>`
(`Layout.jsx:199`), move degraded banner to `.alert-warn` classes (no inline styles), add
Toast region mount point, wrap Layout itself in an ErrorBoundary in `App.jsx` (AUDIT §3.2),
guard NotFound with a boundary too.

---

## 4. USER JOURNEYS

### J1 — First-time evaluator ("what's my home worth?")

```
/ Overview
  1. Hero: H1 + "Value a home" CTA; right rail EngineStatusPanel shows API up,
     champions loaded (GET /health, GET /model/info .headline_metrics)
  2. Scans metric strip: test RMSLE 0.1187 · R² 0.9305 · 25 neighborhoods · 4 micro-markets
  3. Clicks "Value a home" ──────────────────────────────────────────────▶ /valuation
/valuation
  4. Form pre-filled with a typical Ames home (DEFAULT_FORM); user edits 4 fields
     (neighborhood, gr_liv_area, year_built, overall_qual); hints show schema ranges
  5. Submit → button busy "Estimating…" (POST /predict, ~180ms warm) → rail fills:
     price hero → ~80% range → sale probability (simulated badge) → micro-market
  6. Reads "Why this value" top-5 SHAP bars (top_price_factors)
  7. Scrolls to Comparable sales (POST /market/comps, top-5 + percentile 75.5 example)
  8. Drags Living-area scenario slider → POST /predict/price per move (debounced 300ms)
```

### J2 — Returning user refining a valuation

```
Direct load /valuation?neighborhood=NAmes&gr_liv_area=1800&… (shared link, §7.7)
  1. Form rehydrates from URL params (validated against constants.js sets; bad values dropped)
  2. Or: last submitted payload restored from localStorage with "Restore last valuation" chip
  3. Adjusts quality/condition; inline revalidation-on-change clears stale errors
  4. Re-submit fails (API restarted) → toast "Estimate failed — previous result kept";
     rail keeps last result dimmed (fixes AUDIT §2.2 flaw, Valuation.jsx:523)
  5. Retry succeeds → toast "Estimate updated"; provenance line shows ridge_v1 · 9b0f8ba4201c
  6. Compares new range band vs comps percentile; exports nothing — copies the URL instead
```

### J3 — ML reviewer inspecting model quality

```
/ Model Insights (/model)
  1. Page head meta: dataset ames-1.0 · features 94 · feature_version 9b0f8ba4201c (GET /model/info)
  2. Champion duo: ridge v1 val vs sealed-test table (MAE 14,526.57→15,075.47, R² 0.928→0.930)
  3. Bootstrap banner: "not statistically decisive vs xgboost (CI95 −0.0133…+0.0060)" — honesty kept
  4. Classification: calibrated RF @ threshold 0.2033, val+test confusion matrices,
     SIMULATED TARGET badge beside every metric block
  5. Global importance chart (GET /model/importance, top 20 of 94) + screen-reader data table
  6. Clicks "Model Health" ──────────────────────────────────────────────▶ /health
/health
  7. Live traffic table (GET /metrics requests_by_path), avg latency (mean) caption
  8. Drift section: status no_data → designed empty state with ops CLI hint
     (`python -m ml.monitoring.drift_check`); no PSI values invented (CONTRACT §5.13)
```

---

## 5. PAGE SPECS

Global section chrome (all pages): `.page-head` = mono kicker / H1 / 14.5px description /
mono meta line with `·` separators. Sections open with a kicker-style `.section-title` +
right-aligned mono meta or link. Every chart gets a visually-hidden data-table alternative
(fixes AUDIT §5.4) via `components/shared/ChartA11yTable.jsx` (NEW, WP-0).

### 5.1 Overview (`/`) — `pages/Overview.jsx` (REFINE) · `styles/overview.css` (NEW)

**Purpose:** prove the product is live and honest in one screen, then route users into it.

| # | Section | Components | Data source |
|---|---|---|---|
| 1 | Hero + engine status | `overview/Hero.jsx` (NEW: H1, desc, CTAs "Value a home" primary → `/valuation`, "Explore the market" → `/market`); `overview/EngineStatusPanel.jsx` (REFINE from in-file panel): model badges + versions, dataset provenance; failed `/model/info` shows "Model details unavailable" with retry — never silent badges (AUDIT §5.8) | `GET /health` (via Layout pill; page reads `GET /model/info` once) |
| 2 | Headline metrics strip | `overview/MetricsRow.jsx` (in-file, KEEP logic): Test RMSLE 0.1187 · Test R² 0.9305 · Interval coverage 78.3% · 25 neighborhoods · 4 micro-markets · 94 features | `GET /model/info .headline_metrics`, `GET /market/clusters .n_clusters` |
| 3 | "What moves a price" | `shared/DriverBars.jsx` (KEEP) top 8; caption: "Mean \|SHAP\| in log1p(SalePrice) over 200 validation rows — relative influence, not dollar impact." Link "All 94 features →" to `/model` | `GET /model/importance .importance` (503 → error+retry, AUDIT-safe) |
| 4 | Micro-markets | `shared/ClusterCard.jsx` ×4 (KEEP-AS-IS); velocity stat carries warn dot + the contract `note` verbatim on hover/expand | `GET /market/clusters .clusters[]` |
| 5 | Market trend teaser | `shared/TrendsChart.jsx` (REFINE: **lazy-loaded via React.lazy** — pulls recharts out of the landing bundle, AUDIT §4) + contract `note` verbatim + "Trends end 2008H2" tag | `GET /market/trends` (self-fetch, KEEP) |
| 6 | How PropPulse works | `overview/HowItWorks.jsx` (REFINE from static HOW_IT_WORKS): 3 rows — Estimate (form→champion→range) / Explain (SHAP top-5) / Compare (comps + scenario), each row a real link (fixes AUDIT §5.17) | static |
| 7 | Disclosures | plain note block: simulated sale-speed target (ADR-3); all market data = 945 training sales 2006–2008, Ames IA, nominal dollars; range = ~80% nominal | static (mirrors Layout footer) |

- **Loading:** per-section skeletons (existing pattern KEEP); metrics skeleton = 6 cells.
- **Error:** per-section inline error + "Retry" (re-runs that fetch only); partial degradation
  stays (a failed importance never blanks metrics).
- **Empty:** clusters empty → designed empty state (exists, KEEP).
- **Responsive:** 1440: hero `1.25fr/0.75fr`, metrics 6-up hairline strip; 1024: hero stacks,
  metrics 3-up; 768 (≤900 topbar): metrics 3-up, chart full-width; 390: metrics 2-up, gutters 16.
- **Visual hierarchy:** 1. H1 + CTA. 2. Metric strip (big mono numbers). 3. Driver bars.
  4. Cluster cards. 5. Trend chart.
- **Microcopy:** kicker `OVERVIEW`; H1 `Know what an Ames home is worth — and why.`; desc:
  `PropPulse estimates market value, explains the estimate factor by factor, and benchmarks it
  against comparable sales — every figure traceable to a published model version.`; meta:
  `Champions ridge_v1 + random_forest_v1 · dataset ames-1.0 · training sales 2006–2008`.

### 5.2 Valuation (`/valuation`) — `pages/Valuation.jsx` (REFINE) · `styles/valuation.css` (NEW)

**Purpose:** the payoff page — property in, explained estimate out. Deepest spec, by design.

**Layout:** two columns `1.15fr / 0.85fr`, gap 36px. Left: the form. Right: sticky result rail
(`top: 24px`). Page head meta is dynamic (KEEP `Valuation.jsx:496-499` pattern):
`Champion ridge_v1 · test RMSLE 0.1187 · range coverage 78.3% · threshold 0.2033` (all from
`GET /model/info`, fetched once, additive-only — page works without it).

#### 5.2.1 The form (left column) — fields verified against `backend/app/schemas/property.py`

Schema-driven from `constants.js` (KEEP the `ADVANCED_FIELDS` declarative pattern, AUDIT §6.4).
`components/shared/PropertyForm.jsx` (NEW — extracts form from the 632-line page; shared so the
ML workbench's sandbox panel reuses it — see `workflow-architecture.md` §6.3-09) with
`components/valuation/FormField.jsx` (NEW shared input: label + control + hint + error).

Core fieldsets (always visible, two-column field grid inside):

1. **LOCATION & LOT** — `neighborhood` (select, 25 codes, required); `lot_area` (500–200,000
   sqft, required); `lot_frontage` (optional, 1–500 ft).
2. **PROPERTY** — `house_style` (8 options, default 1Story); `bldg_type` (5, default 1Fam);
   `ms_zoning` (5, default RL); `year_built` (1870–2026, required; hint "train range
   1872–2008"); `year_remod_add` (optional; cross-field rule ≥ `year_built`).
3. **LIVING SPACE** — `gr_liv_area` (300–6,000, required; hint "train range 334–4,476");
   `total_bsmt_sf` (0–4,000, required; hint "train max 3,200").
4. **ROOMS & BATHS** — `bedrooms` (0–8); `full_bath` (0–4); `half_bath` (0–2);
   `bsmt_full_bath` (0–3); `bsmt_half_bath` (0–2). All required.
5. **QUALITY & CONDITION** — `overall_qual` (1–10); `overall_cond` (1–10). Required; hint
   "10 = very excellent / 1 = very poor".
6. **GARAGE & AMENITIES** — `garage_cars` (0–5, required); `garage_area` (optional, 0–2,000);
   `fireplaces` (0–4, required); `central_air` (checkbox, required); `pool_area`,
   `wood_deck_sf`, `open_porch_sf`, `screen_porch` (schema-default 0).
7. **ADVANCED OVERRIDES** (`<details>`, KEEP) — the 30 `ADVANCED_FIELDS` entries, grouped
   under mono subheadings (Structure / Quality ratings / Garage & basement detail / Porches &
   misc / Sale timing). Includes `sale_date` with honesty hint: "Defaults to the latest
   training month (2008-12); later dates are clamped, never extrapolated."

Progressive disclosure: required 15 + 3 enum defaults + 7 amenity fields visible; everything
train-mode/median-substitutable lives in the `<details>` with "API default: X" placeholders
(existing pattern, KEEP).

**Inline validation rules** (client, then server 422 mapping — both KEEP, upgrade per AUDIT
§5.7): type/integer/range per schema bounds above; `year_remod_add ≥ year_built`; validate on
blur + submit (KEEP), **add revalidate-on-change once a field has an error**; success
affordance = neutral border return, no checkmark theatre. **New warn-not-block tier:** values
passing schema but outside train-observed ranges (GrLivArea 334–4476, LotArea 1533–164,660,
TotalBsmtSF 0–3,200, YearBuilt 1872–2008, YearRemodAdd 1950–2008, GarageArea 0–1,356 —
CONTRACT §2) get a `--warn` hint: "Outside the 2006–2008 training range — the API will answer
with reduced confidence." This pre-announces `confidence.level: "reduced"` instead of
surprising the user. Server 422s map to fields from a **structured** `ApiError.details` list
(new client return — kills the regex at `Valuation.jsx:286-289`); error summary auto-focuses
first invalid field and force-opens `<details>` when needed (KEEP both behaviors).

Submit row: primary "Estimate value" (busy → spinner + "Estimating…", `aria-live` status;
never full-page reload), quiet "Load example property" (fills `DEFAULT_FORM` — kills the
cold-start problem, AUDIT §5.12), quiet "Reset".

#### 5.2.2 Result rail (right column) — sections in strict hierarchy order

Data: `POST /predict` (full bundle) on submit; `POST /market/comps` and `POST /predict/price`
fire from child components against the same stored payload. Keep all four submit-pipeline
behaviors from AUDIT §6.12 (abort-supersede, keep-previous-dimmed, scroll-into-view,
payload-keyed scenario remount) and **fix the error path**: a failed re-submit keeps the
previous result dimmed + error banner + toast; `result: null` only on Reset.

1. **THE ESTIMATE** — `valuation/ResultHero.jsx` (NEW; absorbs `PriceBand.jsx` KEEP-AS-IS):
   kicker `THE ESTIMATE — CHAMPION ridge_v1`; price 30px mono `--navy` (`estimated_price`,
   `formatUsd`); range band low–high with fill animating `--dur-emphasis`; caption:
   `~80% range — validation residual quantiles; measured coverage 78.3% on the sealed 2010
   test set.`; `ConfidenceNote.jsx` (KEEP-AS-IS) renders the warn badge when
   `confidence.level === "reduced"` with its `reasons` listed verbatim.
2. **SALE LIKELIHOOD** — `ProbabilityGauge.jsx` (KEEP-AS-IS): `probability` vs `threshold`
   0.203292 (never hardcode 0.5, CONTRACT §5.4); `sells_within_30_days` verdict chip; **always**
   paired with warn badge + line: `Simulated target — measures consistency with a seeded
   sale-speed simulation (ADR-3), not a real-world listing forecast.`
3. **MICRO-MARKET** — `valuation/MicroMarketCard.jsx` (NEW, presentational): cluster label +
   median price, median $/sqft, n_sales, sale_velocity_30d (warn-dotted, note verbatim from
   the response); `fallback: true` → note "North Ames sits between clusters — stats shown are
   the nearest cluster's." (normal for NAmes/CollgCr/Timber, CONTRACT §5.6 — inform, not
   alarm). Link "Explore this market →" → `/market`.
4. **PRICE POSITION** — `MarketPosition.jsx` (KEEP-AS-IS): subject $/sqft vs neighborhood &
   cluster medians, `vs_neighborhood_pct`, label near/above/below; caption (contract-mandated,
   §2): `Position vs the training-sale median — not an over- or underpricing verdict.`
5. **WHY THIS VALUE** — `FactorBars.jsx` (KEEP-AS-IS): up to 5 rows, `prettyFeature` labels
   (extend dictionary §5.2.4), fill width = `magnitude` share, ↑ `--accent` / ↓ `--danger`;
   caption: `Share of total factor influence for this estimate — relative, not dollars.`
   **Empty case (`top_price_factors: []`, CONTRACT §5.7):** designed empty state:
   `Explanation unavailable for this estimate. The valuation itself is unaffected — see global
   drivers on Model Insights →`.
6. **COMPARABLE SALES** — `CompsTable.jsx` (REFINE: stable keys, sortable price/date columns,
   expandable comparison row §6.4): 5 comps, `match_scope` disclosure ("widened to cluster
   level" when applicable, KEEP), `percentile` line: "Priced above 75.5% of comparable training
   sales", contract `note` verbatim ("Historical sales 2006-2008 (training data), not current
   listings."), `calendar_clamped` badge when true.
7. **WHAT-IF SCENARIOS** — `ScenarioExplorer.jsx` (REFINE: numeric entry beside each slider,
   real "Retry" button replacing "nudge the slider", lever ranges aligned with the form —
   remodel-year lever capped at 2008 **and** the form hint for `year_remod_add` notes the
   training window, resolving the `ScenarioExplorer.jsx:16` conflict): per-lever delta vs base
   estimate via `POST /predict/price`.
8. **Provenance meta** — mono 11.5px: `ridge_v1 + random_forest_v1 · features 9b0f8ba4201c ·
   ames-1.0` (KEEP `metaParts`, restyled up one size).

- **Rail loading:** on submit, rail skeletons in section shapes (hero gets the tallest block);
  on re-submit, previous content dims with `aria-busy="true"` (KEEP pattern).
- **Rail error:** inline alert at rail top, "Try again" resubmits stored payload (KEEP);
  previous result never wiped on failure (fix, above).
- **Rail empty (pre-submit):** designed empty state: em-dash price, `Submit the form to see
  the estimate, its ~80% range, sale likelihood, and comparable sales.` + "Load example
  property" button (also fixes AUDIT §5.12).
- **Responsive:** 1440/1280: two-col sticky rail. ≤1024: single column, rail goes static below
  the form; after success the rail smooth-scrolls into view (KEEP, reduced-motion aware).
  768: fieldset grids → 1 col; hero price 26px. 390: hero price 24px, submit full-width.
- **Visual hierarchy:** 1. The price. 2. Range band. 3. Probability gauge. Everything else
  reads as supporting evidence in the order above. Left column's only job is to never block
  the eye from the rail.
- **Persistence/sharing:** submitted payload mirrored to URL search params (shareable links —
  generalizes the `?neighborhood=` handshake, AUDIT §6.11) and localStorage (`proppulse:last-valuation`);
  on load, URL wins, else "Restore last valuation" chip. Client-only state — no backend exists
  for saved work (CONTRACT §5.15), and none is faked.

#### 5.2.3 `?neighborhood=` prefill — KEEP exact current behavior (validate against the 25
codes, re-apply on param change, `Valuation.jsx:267-279`), now one case of general URL state.

#### 5.2.4 Feature-label dictionary (extend `format.js prettyFeature`, AUDIT §6.1):
`OverallQual→Overall quality`, `OverallCond→Overall condition`, `total_sf→Total floor area`,
`GrLivArea→Living area`, `1stFlrSF→First-floor area`, `2ndFlrSF→Second-floor area`,
`TotalBsmtSF→Basement area`, `BsmtFinSF1→Finished basement area`, `neighborhood_median_price→
Neighborhood median price`, `living_area_per_bedroom→Living area per bedroom`, `total_bath→
Total bathrooms`, `HeatingQC→Heating quality`, `property_age→Property age`, `Neighborhood→
Neighborhood`, `GarageCars→Garage capacity`, `YearBuilt→Year built`, `LotArea→Lot area`,
`KitchenQual→Kitchen quality`. Unknown names fall back to humanized snake/Camel case (existing).

### 5.3 Market (`/market`) — `pages/Market.jsx` (REFINE) · `styles/market.css` (NEW)

**Purpose:** where values come from — 4 micro-markets, 25 neighborhoods, 2006–2008 trend.

| # | Section | Components | Data |
|---|---|---|---|
| 1 | Page head | kicker `MARKET INTELLIGENCE`, H1 `Four micro-markets, twenty-five neighborhoods`; meta from data (`{n} neighborhoods · {k} micro-markets` — **remove the hardcoded "25 · 4"**, AUDIT §2.3) | `GET /market/clusters` |
| 2 | Map + cluster rail | `market/NeighborhoodMap.jsx` (REFINE §7.5 a11y + marker→rail sync); `market/ClusterRail.jsx` (NEW wrapper around 4 × `shared/ClusterCard.jsx` with `onClick`) | `GET /market/clusters .neighborhoods[]` (25 lat/long points), `.clusters[]` |
| 3 | Neighborhood directory | `market/NeighborhoodTable.jsx` (REFINE: sortable §7.6; row action "Value a home here →" → `/valuation?neighborhood=<code>`; caption: `Price stats are cluster-level medians — per-neighborhood medians are not served by the API.` i.e. **not shown** per CONTRACT §3 DERIVABLE row) | same response (client-side join) |
| 4 | Trends | `shared/TrendsChart.jsx` (lazy); null half-years stay gaps (`connectNulls={false}`, KEEP); contract `note` verbatim + tag `Train window 2006H1–2008H2` | `GET /market/trends` |
| 5 | Honesty notes | note block: approximate geocoded centroids; velocity = simulated-target fraction (cluster `note` verbatim) | static/verbatim |

- **Loading:** skeleton grid: map block 460px + 4 rail cards + table rows.
- **Error:** section-level retry; map points that fail coordinate validation are skipped **and
  disclosed**: "2 of 25 neighborhood points could not be placed." (fixes the silent
  `console.warn`, AUDIT §2.3).
- **Empty:** existing empty state KEEP.
- **Responsive:** 1440: map `1.4fr` + rail `0.6fr`, table full-width below; 1024: stack, rail
  2-col card grid, map 380px; 768: map 340px; 390: map 300px, table scrolls horizontally
  (`.table-scroll`, sticky first column).
- **Hierarchy:** 1. Map. 2. Active cluster card. 3. Table. 4. Trend lines.
- **Microcopy:** section titles `THE MAP — APPROXIMATE NEIGHBORHOOD CENTROIDS`, `DIRECTORY —
  SORT ANY COLUMN`, `TRENDS — MEDIAN SALE PRICE BY HALF-YEAR`.

### 5.4 Model Insights (`/model`) — `pages/ModelInsights.jsx` (REFINE) · `styles/model-insights.css` (NEW)

**Purpose:** the trust page — champions, sealed-test evidence, global drivers, open caveats.

| # | Section | Components | Data |
|---|---|---|---|
| 1 | Page head | kicker `MODEL INSIGHTS`; meta: `dataset ames-1.0 · 94 features · feature_version 9b0f8ba4201c · selected 2026-08-07` | `GET /model/info` |
| 2 | Champion duo | two panels: **Regression — ridge v1** (log1p target, alpha via rationale) and **Classification — calibrated random_forest v1** (threshold 0.203292; `SIMULATED TARGET` warn badge mandatory, `headline_metrics.classification.simulated_target === true`) | `GET /model/info .regression/.classification` |
| 3 | Val vs sealed-test tables | `insights/MetricsTable.jsx` (NEW shared by both): regression rows MAE 14,526.57→15,075.47, RMSE, R² 0.928→0.930, RMSLE 0.1354→0.1187, interval coverage 78.3%; classification rows ROC-AUC, PR-AUC, precision, recall, F1, Brier | `.val_metrics/.test_metrics` |
| 4 | Confusion matrices | `ConfusionMatrix.jsx` ×2 (KEEP-AS-IS): val {tn122 fp117 fn18 tp81} and sealed test {tn57 fp69 fn9 tp40}, captioned `@ threshold 0.2033 — simulated target` | `.confusion_matrix` ×2 |
| 5 | Bootstrap honesty banner | `insights/BootstrapNote.jsx` (NEW): "Runner-up xgboost was not statistically worse — RMSLE diff CI95 [−0.0133, +0.0060], 2,000 resamples. The champion is the safer default, not a proven winner." (upgrade from inline text, `ModelInsights.jsx:170-178`) | `.bootstrap_vs_runner_up` |
| 6 | Global drivers | importance bar chart top 20 (recharts, KEEP) **+ `shared/ChartA11yTable.jsx`** with all 20 values; units caption from `metadata.aggregation` (mean \|SHAP\|, log1p units, val n=200); "not dollar impacts" | `GET /model/importance` (503 → error+retry) |
| 7 | Rationale + disclosures | rationale paragraph from API (verbatim); honesty block (KEEP `ModelInsights.jsx:353-360`); closing line: "The sealed 2010 test set was touched exactly once." style | `.rationale`, `.headline_metrics` |
| 8 | Not shown (explicit) | small "What this page doesn't show" note: ROC/PR/calibration curves (**not available** — no curve data exists, CONTRACT §3); full candidate leaderboard (only champions are served — **not shown**); live prediction stats (**not available**). | — |

- **Fixes:** one `AsyncSection` wrapper for all sections (kill the triple-error duplication,
  AUDIT §2.4); CTA row "Try the model →" → `/valuation` (dead-end fix).
- **Responsive:** 1440: duo 2-col; 1024: stack; 768: metric tables scroll; 390: matrix cells
  shrink (existing rule).
- **Hierarchy:** 1. Champion names + badges. 2. Test metrics. 3. Importance chart.
  4. Caveats — prominent by design, not buried.

### 5.5 Model Health (`/health`) — `pages/Health.jsx` (REFINE) · `styles/health.css` (NEW)

**Purpose:** live operations — is it up, how busy, is the data drifting.

| # | Section | Components | Data |
|---|---|---|---|
| 1 | Service status | `health/ServiceStatus.jsx` (NEW from in-file): status, models_loaded badges, uptime (`formatUptime`) | `GET /health` |
| 2 | Live traffic | sortable table of `requests_by_path` (path, count, share) + facts: `requests_total`, `errors_total` (caption: "counts HTTP 5xx only"), `avg_latency_ms` (caption: "mean since process start, not a percentile"), empty-traffic state (KEEP) | `GET /metrics` |
| 3 | Drift report | `health/DriftPanel.jsx` (NEW from in-file): **current real state is `status: "no_data"`** — designed empty state: "No scored traffic in the drift window yet. The drift report refreshes when an operator runs `python -m ml.monitoring.drift_check`." (KEEP the existing honest state + CLI hint). When `status: "ok"`: per-feature PSI bars (warn 0.1 / drift 0.2 threshold colors, KEEP), `drifted_features`/`warn_features` lists, `max_psi`, `low_sample` badge, `retraining_recommended` flag + `recommendation_text`. Never invent PSI values (CONTRACT §5.13). Retraining is a flag only — no trigger button (**no such endpoint; not shown**) | `GET /metrics .drift` |
| 4 | Refresh | auto-refresh 30s, **paused when tab hidden** (fix AUDIT §2.5 inconsistency), "Updated HH:MM:SS" per-fetch (fix overstated freshness), manual refresh button | — |

- **Error:** partial degradation per section (KEEP, best-in-app); **Hierarchy:** status →
  drift verdict → traffic; **Responsive:** status cards 3→1 col at 640; tables scroll.
- **Microcopy:** kicker `MODEL HEALTH`; H1 `Live service & drift`; note: `Counters are
  per-process and reset on restart; drift is a file snapshot, not a live stream.`

### 5.6 NotFound (`*`) — `pages/NotFound.jsx` (KEEP, minor REFINE)

Branded 404: kicker `ERROR 404`, H1 `Page not found`, copy `That page doesn't exist — the
valuation tools are one click away.`, buttons "Back to overview" (primary) + "Value a home"
(secondary). Add the missing ErrorBoundary in `App.jsx:35` (AUDIT §5.6). No search box
(five routes; overkill).

---

## 6. INNOVATION FEATURES — adopted vs rejected

Constraint: only what CONTRACT §3 marks SUPPORTED (client-side derivation from served data
is allowed; nothing is faked).

**6.1 What-if scenario analysis — ADOPTED.** Valuation rail §5.2.2-7. Sliders + numeric entry
for living area, quality, condition, year built, remodel year (≤2008), garage, baths; each move
debounce-POSTs `/predict/price` (~27ms) and shows signed delta vs base estimate. Data: real
endpoint, real champion. (Already built — REFINE, don't rethink.)

**6.2 Value drivers — ADOPTED.** Local: `top_price_factors` top-5 bars on Valuation (§5.2.2-5,
empty-state covered). Global: `/model/importance` chart + table on Model Insights. Both carry
the "relative share, log1p units, not dollars" captions. Data: real SHAP.

**6.3 Price positioning — ADOPTED.** `MarketPosition.jsx`: subject $/sqft vs neighborhood and
cluster medians, `vs_neighborhood_pct`, near/above/below label + comps `percentile` as second
view. Caption fixed by contract: positioning vs median, **not** a pricing verdict.

**6.4 Property ↔ comps comparison — ADOPTED (client-side).** In `CompsTable`: each row expands
to a mini comparison dl — comp vs subject over the fields comps actually serve (`gr_liv_area`,
`overall_qual`, `overall_cond`, `year_built`, `bedrooms`, `baths`, `garage_cars`,
`house_style`) plus `sale_price` vs `estimated_price` delta. Subject values come from the
stored form payload; comp values from `POST /market/comps`. No new endpoint needed.

**6.5 Sale-likelihood gauge — ADOPTED** (already core, §5.2.2-2) with the simulated-target
badge inseparable from the number.

**REJECTED (no data — do not build, do not fake):**
- **Over/underpricing detection verdict** — CONTRACT §2/§5.8: `market_position.label` is
  explicitly *not* a pricing verdict; no list-price or DOM data exists. Positioning display
  (6.3) is the honest maximum.
- **Market opportunity / investment scoring** — needs live listings and post-2010 data;
  CONTRACT §3: NOT AVAILABLE (trends end 2008H2; comps are 2006–2008 training sales).
- **ROC / PR / calibration curves** — NOT AVAILABLE (no curve-point artifacts); scalar AUCs
  only, shown in tables.
- **Full model-candidate leaderboard** — DERIVABLE but not served; only champions reachable
  today → not shown (a one-line note says so, §5.4-8).
- **Per-neighborhood price stats table** — DERIVABLE (`neighborhood_stats.json` has no
  endpoint); table shows cluster-level medians, captioned.
- **Accounts, saved valuations server-side, alerts, portfolio compare** — no auth or write
  endpoints exist (CONTRACT §0/§5.15); localStorage restore + URL sharing is the ceiling.

---

## 7. STATES & MICRO-INTERACTIONS

**7.1 Skeletons vs spinners (global rule).** Initial or full-section load → layout-matched
skeleton (`StateView`, KEEP shapes). User-triggered action with data already on screen →
busy button + dimmed previous content (`aria-busy`), never a skeleton swap. Inline re-fetch
under ~1s expected (`/predict/price` slider) → tiny inline spinner at the control, no layout
change. Full-page spinner after first paint: banned. Delete dead `Loading` export
(AUDIT §3.3).

**7.2 Buttons.** Busy = disabled + 12px spinner + verb label ("Estimating…", "Retrying…"),
restored in `finally` (reference `setBusy` pattern, ported to a `BusyButton` wrapper in
`components/shared/`). Disabled = `opacity .6` + `aria-disabled` reason via `title`.
bfcache analogue: busy state lives in React state keyed by the in-flight request — back-nav
remounts clean.

**7.3 Toast system (NEW).** `components/Toast.jsx` exports `ToastProvider` (mounted in
`App.jsx` inside the router, above Layout) and `useToast()`:

```jsx
const toast = useToast()
toast.push({ kind: 'success' | 'error' | 'info', title, body? })  // returns id
toast.success('Estimate updated')            // sugar
toast.error('Estimate failed — previous result kept')
```

Rules: auto-dismiss 6s (info/success) / 10s (error, also dismissible); **max 3 visible**, FIFO
evicts oldest; stacked bottom-right ≥900px, full-width top <900px; container
`aria-live="polite"`; enter `--dur-toast`, no exit animation under reduced motion; surface
`--surface` + `--shadow-pop` + kind-colored 2px left bar. **Toasts are for transient
success/recovery only** — valuation complete, retry recovered, link copied. Anything that
blocks a section stays an inline alert with its own retry (toasts never replace §7.4).

**7.4 Inline errors & retry.** Section errors: `.alert-error` with bold lead ("Couldn't load
market clusters"), one plain-language line, "Retry" button re-running that fetch only. Copy
tone: state what happened, what still works, what to do — no blame, no codes (the 422 field
list is the exception: field-level copy shows the API message verbatim).

**7.5 Focus & keyboard.** One focus treatment (existing `:focus-visible` rule, KEEP): 2px
`--accent` outline, 2px offset. Tab order follows visual order; sticky rail is after the form
in DOM. Leaflet map: `keyboard: true`, markers focusable, Enter opens popup, popup's "Value a
home here →" link is a real `<a>` reachable by Tab, Esc closes popup (react-leaflet supports
all of this without new deps); the sortable directory table is the full non-map equivalent —
map gets `role="application"` + aria-label saying so (fixes AUDIT §5.4).

**7.6 Table sorting pattern (NEW, all data tables).** `components/shared/useSortable.js` hook
+ `SortHeader` th-button: click cycles asc → desc → natural; `aria-sort` on `<th>`; mono `↑`/`↓`
indicator; numeric columns sort numerically, right-aligned, tabular-nums. Applied to:
NeighborhoodTable (all stat columns), Health traffic table, CompsTable (price, date). Natural
order = API order (distance rank for comps — caption says so).

**7.7 URL state.** Valuation payload ↔ search params (shareable); Market `?cluster=` deep link
from cards. Unknown/invalid params are dropped silently, never error (matches existing prefill
validation).

**7.8 Chart a11y.** Every recharts chart: `role="img"` + one-sentence aria-label **plus** a
visually-hidden `ChartA11yTable` of the exact plotted values. 503/empty chart = designed state,
never a blank canvas.

---

## 8. RESPONSIVE RULES (by test width)

| Width | Nav | Grids | Tables | Charts | Map |
|---|---|---|---|---|---|
| **1440** | sidebar 248px, full labels + footer meta | content ≤1080 centered; valuation 1.15/0.85; market map+rail; metrics 6-up | full, sticky headers | 2-col chart grids; 200–320px wraps | 460px, all 25 points |
| **1280** | same | same; gutters 28px | same | same | 440px |
| **1024** | sidebar kept | multi-col → 1 col (valuation rail static below form; hero stacks; duo stacks) | full width | 1-col | 380px above rail cards (2-up) |
| **768** | ≤900: topbar horizontal scroll strip, active item auto-scrolled into view, active bar = bottom inset; captions hidden (KEEP current) | all 1 col; fieldset grids 1 col; H1 23px | horizontal scroll, sticky first col | 1 col, 220px | 340px |
| **390** | topbar strip | gutters 16px; metrics 2-up; hero price 24px; buttons full-width | scroll; sorting still available | 1 col, 200px; a11y tables unchanged | 300px; popups max-width 260px |

Rules that never bend: tables reflow never — they scroll; toasts go full-width top ≤900;
sticky rail exists only ≥1024; `prefers-reduced-motion` honored at every width.

---

## 9. IMPLEMENTATION SEQUENCING (parallel-safe work packages)

Ownership is exclusive per package. Shared files move to `components/shared/` in WP-0 so no
page package ever edits another's file. `styles.css` has exactly one owner (WP-0); each page
package owns `src/styles/<page>.css`, imported from its page module (Vite handles per-route CSS).

| WP | Scope | Owns exclusively | Depends on |
|---|---|---|---|
| **WP-0 Foundation** | Token evolution (§2), remove Google Fonts links, hairline/radius/motion tokens, `ChartA11yTable`, `useReducedMotion`, `useSortable`+`SortHeader`, `BusyButton`; move `TrendsChart`, `DriverBars`, `ClusterCard` → `components/shared/`; extend `format.js` dictionary (§5.2.4); refine `Layout.jsx` (banner classes, dead context, Toast mount), `ErrorBoundary` (soft reset), `StateView` (delete `Loading`); `constants.js` (train-range hints, label maps) | `styles.css`, `index.html`, `components/Layout.jsx`, `components/ErrorBoundary.jsx`, `components/StateView.jsx`, `components/shared/*`, `src/format.js`, `src/constants.js` | — |
| **WP-1 API & state** | `client.js`: structured 422 `details`, session cache (in-memory Map) for the four static GETs (`/model/info`, `/model/importance`, `/market/clusters`, `/market/trends` — CONTRACT §5.15 says safe); `useApi.js` unchanged shape at call sites; `components/Toast.jsx` + provider wiring in `App.jsx`; boundary around Layout + NotFound | `src/api/*`, `components/Toast.jsx`, `src/App.jsx` | WP-0 |
| **WP-2 Overview** | §5.1 | `pages/Overview.jsx`, `components/overview/*` (Hero, EngineStatusPanel, MetricsRow, HowItWorks), `styles/overview.css` | WP-0, WP-1 |
| **WP-3 Valuation** | §5.2 incl. URL/localStorage state, ResultHero, MicroMarketCard, form extraction, validation tiers; refine CompsTable + ScenarioExplorer (incl. comps comparison expander §6.4); move `PriceBand/ProbabilityGauge/FactorBars/MarketPosition/ConfidenceNote/CompsTable/ScenarioExplorer` → `components/valuation/` | `pages/Valuation.jsx`, `components/valuation/*`, `styles/valuation.css` | WP-0, WP-1 |
| **WP-4 Market** | §5.3 incl. sortable directory, map a11y + sync, dropped-points disclosure; move `NeighborhoodMap/NeighborhoodTable` → `components/market/` | `pages/Market.jsx`, `components/market/*`, `styles/market.css` | WP-0, WP-1 |
| **WP-5 Model Insights** | §5.4 incl. MetricsTable, BootstrapNote, single AsyncSection | `pages/ModelInsights.jsx`, `components/insights/*`, `styles/model-insights.css` (`ConfusionMatrix.jsx` moves here from `components/`) | WP-0, WP-1 |
| **WP-6 Model Health** | §5.5 incl. DriftPanel, ServiceStatus, visibility-paused polling | `pages/Health.jsx`, `components/health/*`, `styles/health.css` | WP-0, WP-1 |
| **WP-7 Polish & QA** | lazy `TrendsChart` import + recharts `manualChunks` fallback (kills the 745kB main chunk, AUDIT §4); dead-CSS purge (AUDIT §1.6 list); `npm run build` + `npm run lint`; Playwright e2e run; a11y keyboard walkthrough of all five routes | `vite.config.js`, `pages/NotFound.jsx`, anything marked "dead" | all above |

Sequence: WP-0 → WP-1 → WP-2…6 in parallel → WP-7. Definition of done per package: build
passes, lint passes, every section renders skeleton/error/empty/content against the live
backend, and every number on screen traces to this spec → which traces to the contract.

---

*Ground truth: `proppulse-api-contract.md` (endpoints, fields, numbers), `proppulse-frontend-audit.md`
(file verdicts, salvage list), `placementpredict-ui-inventory.md` + `placementpredict-design-system.md`
(quality bar). Where this doc and instinct disagree, this doc wins; where this doc and the contract
disagree, the contract wins — file an issue, don't fake data.*

*Companion spec: `workflow-architecture.md` (with `workflow-mechanics.md` +
`ml-capability-inventory.md`) — the guided ML workbench (`/workflow/*`) built on this design
system; its acceptance map §9 is e2e-tested by `e2e/tests/workflow.spec.js`.*
