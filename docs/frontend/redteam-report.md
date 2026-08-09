# PropPulse Frontend — Red Team Report

**Date:** 2026-08-09 · **Role:** adversarial review of the rebuilt frontend against
`proppulse-ux-architecture.md` (SPEC), `proppulse-api-contract.md` (CONTRACT), and the
PlacementPredict quality bar. **Method:** full read of `frontend/src/` (8,806 lines),
`npm run build` + `npm run lint` (both pass), then live attack via Playwright/Chromium
against the production build (`vite preview`) with the real backend at `:8000` — network
traffic captured, DOM/computed-style probes, offline simulation, 390×844 mobile pass,
keyboard/contrast pass. Screenshots were taken and inspected at native resolution.

**Verdict up front:** this is *not* an AI-template skin — the design language is real and
disciplined, the honesty system is the best thing about the product, and every number I
traced comes from a live response. But the release is **not** at the PlacementPredict bar
yet: the single most important explanation panel on the product's core page renders
**invisible bars**, and that same core page **breaks horizontally on a phone**. Two one-line
CSS-class bugs stand between this build and a credible "release candidate" claim.

**Overall: 8.0 / 10** (target ≥ 8.5 — blocked by two P0 rendering bugs on `/valuation`)

---

## The 11 attack questions

### 1. Does it look like a professional product — or an AI-generated template?

**Professional.** The anti-template discipline holds up under screenshot inspection:

- Hairlines-not-shadows is real: the only elevation shadow in the app is `--shadow-pop` on
  toasts/map popups (verified in `styles.css:37` and used nowhere else).
- The mono-kicker system is everywhere and carries content, not decoration:
  `THE ESTIMATE — CHAMPION RIDGE_V1`, `DIRECTORY — SORT ANY COLUMN`,
  `validation n=338 (2009) · sealed test n=175 (2010)`.
- The metric strip (0.1187 / 0.9305 / 78.3% / 25 / 4 / 94) reads like a ledger —
  tabular mono, hairline-separated, no card chrome. Directly the reference's move.
- Fieldset legends riding the border (`LOCATION & LOT`), the confusion-matrix hairline grid
  with totals, the champion-row wash — the reference's signature components are all present
  and correctly translated to the light teal identity (per SPEC §2.0, the olive/amber was
  deliberately not adopted).
- No gradients, no glow, no emoji, no confetti, no purple-blue AI palette anywhere.

Where it still whispers "generated": the Overview hero has a slightly dead right-rail balance
at 1440px (engine panel shorter than the text column), and the valuation rail is a flat
9-panel stack with no in-rail navigation — but these are polish items, not template tells.

### 2. Is navigation logical? Is the core action obvious in 5 seconds?

**Yes on desktop.** ANALYZE / PLATFORM grouping is sensible; "Valuation" is nav item 2; the
Overview hero's primary CTA is "Value a home"; every dead end from the audit is fixed
(HowItWorks rows are real links, ModelInsights ends with "Try the model →", Market rows link
to valuations — all click-verified).

**One seam:** at ≤900px the topbar nav is *not* the designed horizontal scroll strip.
`Layout.jsx:103-105` (`NavItems`) wraps each group in a `<div>`, so the flex `.topbar-nav`
lays out **two group divs side-by-side with items stacked vertically** — the nav becomes a
2×2+1 block ~110px tall instead of a strip (visible in every mobile screenshot). The old
frontend had the strip; the rebuild's shared `NavItems` component broke it. Fix: at ≤900px
give the group wrappers `display: contents` so items become direct flex children.

### 3. Too much information anywhere? Important information buried?

- **Valuation rail is long but correctly ordered** (estimate → range → likelihood →
  micro-market → position → factors → comps → what-if → provenance). Nothing load-bearing is
  buried — except that the *explanation* panel visually reads as empty (see P0-1), which
  effectively buries the "why".
- **The verbatim `sale_velocity_30d` contract note renders in full in three places** on
  Market (cluster cards caption, map popups, data notes) and again on Valuation's
  micro-market card. In a map popup it's a 5-line wall of text. Honest, but the full
  300-character note belongs in one place; elsewhere a short "simulated target" badge +
  link would do.
- **Health stacks two near-identical large empty states** (feature drift / prediction
  drift). Each is well designed; together they repeat the same CLI hint and layout.
  Consider one shared explainer with two status lines.
- Overview's six-metric strip + drivers + four cluster cards + trend chart is dense but
  scans fine — the hierarchy (H1 → metrics → bars → cards → chart) works.

### 4. Does the valuation result feel TRUSTWORTHY? Are the honesty blocks present?

This is the product's strongest axis — verified live, not just in code:

- **Hero**: price at 30px navy mono (the only 30px element — verified unique), kicker naming
  the serving champion from `model_version`, range band with asymmetric fill (estimate sits
  left-of-center, matching q_low −0.141 / q_high +0.117), caption with *measured* coverage
  78.3% from `/model/info` — never hardcoded (additive-only, `Valuation.jsx:72-73`).
- **Reduced confidence works end-to-end**: submitted `year_built 2015 / gr_liv_area 5900` →
  hero shows `REDUCED CONFIDENCE` warn badge + the API's three reasons verbatim
  ("Living area above the training range — true error may exceed the shown band." etc.).
  The form's warn-not-block tier pre-announces it ("Outside the 2006–2008 training range…")
  on blur before submit. Exactly the spec's pre-announce behavior.
- **Simulated target is inseparable from the number**: gauge panel carries the warn badge +
  the ADR-3 caveat line; cluster velocity stats carry warn dots/badges; the classification
  metrics section and confusion matrices are captioned "@ threshold 0.2033 — simulated
  target". Threshold is served verbatim (0.203292), never 0.5.
- **Bootstrap honesty banner** renders the CI95 [−0.0133, +0.0060], 2,000 resamples,
  P(runner-up better) = 19.3%, "not statistically decisive" — prominent amber treatment,
  not a footnote.
- **Provenance line** on every result: `ridge_v1 + random_forest_v1 · features
  9b0f8ba4201c · ames-1.0 · estimated <timestamp>`.
- **Health page labels its own counters**: "counts HTTP 5xx only", "mean since process
  start, not a percentile", "per-process and reset on restart". Drift `no_data` is a
  designed empty state with the ops CLI hint — no PSI values invented.

**The one trust underminer**: the "Why this value" panel — the per-estimate SHAP
explanation, i.e. the answer to "why should I believe this number?" — renders **empty bar
tracks** (P0-1). A user sees five gray rails and percentages; the visual half of the
explanation is missing.

### 5. Are charts useful — or decorative? Any that mislead?

- **TrendsChart**: null half-years stay gaps (`connectNulls={false}` — verified the
  affordable-southwest line breaks at 2007H2 where `sales_count` is 0). Contract `note`
  rendered verbatim. Y-axis uses `$180k` compact ticks. **Two honesty nits**: `type="monotone"`
  smooths a 6-sample series (implies continuity that doesn't exist — `type="linear"` is the
  ledger-honest choice), and `domain={['auto','auto']}` truncates the y-axis to ~$110k,
  visually exaggerating half-year moves. Gaps being preserved is the hard requirement and
  it passes; these are P2 polish.
- **DriverBars** (Overview top-8, Insights top-20): bars scale to the max entry with the
  4dp value at the right — relative influence, captioned "not dollar impact". Honest.
- **PriceBand / ProbabilityGauge / MarketPosition**: padded domains with *labeled*
  endpoints, threshold tick served from the API, `role="meter"` with `aria-valuenow`.
  No fake precision, no wrong baselines.
- **ChartA11yTable** present beside both recharts surfaces (verified in DOM: the
  visually-hidden table with exact plotted values exists on Overview and Model Insights).
- **The decorative-looking one is FactorBars** — not because it's ornamental, but because
  it's broken (P0-1).

### 6. Dead screens / buttons / links / fake metrics / hardcoded numbers?

- **No dead UI found.** Every button I clicked did something real: sort headers (aria-sort
  cycles asc→desc→natural), comp-row expanders, scenario Retry, "Load example property",
  restore chip, map toolbar select, cluster cards (flyTo + profile), all CTAs.
- **Console: zero errors/warnings** across the full walkthrough. No lorem/TODO/"coming soon"
  strings in source.
- **Hardcoded-literal sweep vs CONTRACT** (`0.1187`, `0.9305`, `78.3`, `0.203292`,
  `14,526`, `15,075`, `9b0f8ba4201c`, `945/338/175`, cluster medians): the UI's live
  numbers all come from responses. What remains hardcoded:
  - `components/insights/Methodology.jsx:10-15` — `FALLBACKS` includes
    `featureVersion: '9b0f8ba4201c'`, `nFeatures: 94`, `dataset: 'ames-1.0'`, rendered **as
    fact when `/model/info` is down**. After any retrain this fallback *lies*. The SPEC's
    own rule ("additive-only — omitted when unavailable, never hardcoded", §5.2) is followed
    by Valuation but not here. Same pattern: `Overview.jsx:46-47` `HERO_META_FALLBACK`
    shows "Champions ridge_v1 + random_forest_v1…" while the engine panel simultaneously
    shows "Model details unavailable" (verified in the offline screenshot — mixed signal).
    Fix: fall back to '—'/omit, like `MetricsRow` already does.
  - Dataset sizes 945/338/175 in Methodology/section-note copy are contract-standing
    narrative — acceptable, but they carry the same rot risk if the dataset version bumps.
- **Stale token literals**: `#6e7c8b` (the *old* `--text-3`) survives in
  `TrendsChart.jsx:106,110` axis ticks and `constants.js:64` `clusterColor()` fallback —
  the SPEC darkened `--text-3` to `#5d6d7d`; these two spots missed the migration.
- **Dead CSS the WP-7 purge missed**: `.grid-valuation`, `.grid-map`, `.state-view`,
  `.state-view-detail` in `styles.css` are referenced by no JSX (grep-verified).

### 7. Does the frontend REALLY work with the backend? (traced chains)

All traffic captured live (Playwright request log); the four static GETs are
session-cached per page load (SPA navigation shares one promise — `client.js:165-193`):

1. **Valuation submit** → `POST /predict` (payload = the 15-field form body) → hero,
   gauge, micro-market, position, factors all render from that one response; then
   `POST /market/comps` → comps table + percentile line ("Priced above 78.9% of comparable
   training sales"). Both calls observed; DOM values match the response fields.
2. **What-if slider** → 30 ArrowRight presses on the living-area lever → exactly **one**
   debounced `POST /predict/price` → signed delta row (`Living area 1,600 → 1,900 → +$…`).
   Abort-supersede, numeric entry, and per-lever Retry all present in code; debounce
   verified by the single network call.
3. **Market → Valuation handshake** → directory row "Value a home here →" →
   `/valuation?neighborhood=Blmngtn` → form select rehydrated to Blmngtn (input value
   read back from the DOM). `?cluster=2` deep link selects + flies + opens the profile;
   `?cluster=99` drops silently. Shared-valuation URLs rehydrate the full form
   (`?neighborhood=StoneBr&gr_liv_area=2400&year_built=2003` verified); invalid values
   (`Gotham`, `99999`) are dropped silently.
4. **Model Insights** → `GET /model/info` + `GET /model/importance` → champion stats,
   both metrics tables, both confusion matrices (122/117/18/81 and 57/69/9/40 with correct
   totals), bootstrap banner, top-20 drivers.
5. **Health** → `GET /health` + `GET /metrics`, 30s polling that pauses when the tab hides
   (`usePolling`), per-endpoint freshness stamps, manual refresh with busy state.
6. **Error path (simulated offline)**: global "API offline" banner with retry, per-section
   error+retry on Overview, rail error on Valuation submit ("Cannot reach the PropPulse API
   at http://localhost:8000…") — and a **failed re-submit keeps the previous result**
   (the AUDIT §2.2 fix — code-verified at `Valuation.jsx:119-129`; the dimmed-keep path is
   exercised by the client-side validation block, which leaves the prior result intact).

### 8. Mobile (390×844): genuinely usable or afterthought?

**Mostly genuine — with one release-blocking break.**

- Works: metrics 2-up with correct hairline resets, tables scroll horizontally (Market
  directory adds a sticky first column), map drops to 300px with 260px-capped popups,
  toasts go full-width top, form fieldsets go single-column, hero price steps 30→24px,
  submit goes full-width. `/`, `/market`, `/model`, `/health` all measure **zero**
  horizontal overflow at 390px.
- **BROKEN: `/valuation` after a result renders** — `documentElement.scrollWidth` = **625px**
  on a 390px viewport. The comps table's min-content (~573px of nowrap cells) propagates
  up through `.panel-body` → `.panel` (flex item of the rail, `min-width: auto`) →
  `.valuation-rail` (grid item, `min-width: auto`) → the single-column `.valuation-grid`
  track, stretching the *entire page* — form inputs, hero caption, gauge labels, and the
  micro-market kv **values** run off the right edge (screenshot-verified: "Median price"
  labels visible, their values off-screen). The empty form does not overflow; the result
  state does. Fix verified live: `.valuation-rail { min-width: 0 }` (or
  `.valuation-grid > * { min-width: 0 }`) drops the document to exactly 390px.
- Secondary: the topbar nav seam (Q2) and the section-note microcopy ("tab to a point ·
  Enter for details · cards fly the map") wrapping to three ragged lines at 390px.

### 9. Where does it still fall short of PlacementPredict's sophistication?

- **Methodology-narrating copy: matched.** Every metric row carries a one-line hint
  ("RMSLE — log-space error — the selection metric"); "The sealed 2010 test set was touched
  exactly once" closes Model Insights; the reference's provenance-by-line pattern is
  everywhere. This was the reference's deepest strength and PropPulse has it.
- **Stepper-like guidance: matched in spirit** — HowItWorks 01/02/03 rows with real links.
  The reference's numbered sidebar stages aren't applicable (five routes, not a pipeline).
- **Formatting discipline: one systematic miss** — years are thousands-grouped
  (`train range 1,872–2,008` hint, `Must be between 1,870 and 2,026` validation message,
  comp comparison `Year built 1,970 / 1,995`, scenario lever labels `Year built 1,995 →
  2,001`). Root cause: `formatNumber()` always groups; there is no year-safe path. The
  reference never lets a grouped year through. P1.
- **Mobile nav**: reference collapses to a true horizontal scroll strip; PropPulse's wraps
  into two stacked columns (Q2). P1.
- **Chart chrome**: reference gridlines are 6%-alpha hairlines with hidden axis borders;
  PropPulse keeps recharts' default-ish axis ticks (in the stale `#6e7c8b`, no less). Close,
  not equal. P2.
- **The result moment**: the reference's predict page concentrates verdict + bar + facts in
  one bordered panel; PropPulse splits hero/gauge into separate panels — defensible — but
  then lets the explanation panel ship broken (P0-1), which the reference never would.

### 10. Consistency across pages (hunting the five-agent seams)

The seams exist but are small; `text-transform: uppercase` masks most copy-case drift:

- **Valuation's FactorBars reimplemented bars with `<span>`** while the shared
  `DriverBars` (same visual pattern!) uses `<div>` — the divergence is exactly what makes
  Valuation's bars invisible while Overview's and Insights' render. Classic parallel-agent
  seam, and the most expensive one.
- **`.factor-fill--neg` is defined twice with different colors** — `--terra` in
  `styles.css:886` vs `--danger` in `valuation.css:163-165`. SPEC §2.1 says negative price
  impact = `--danger`; valuation.css wins on the valuation page, so the visible result is
  correct, but the global default contradicts the spec and the duplicate is a drift trap.
- **Kicker/section-title case**: Market uses literal-uppercase strings ("THE MAP — …"),
  other pages rely on CSS transform — visually identical, source-inconsistent.
- **Page titles**: SPEC §2.2 says H1 uses `--navy`; `.page-title` sets no color (inherits
  `#16283c`). Near-indistinguishable, but it is a spec deviation.
- Typography floors hold everywhere (nothing below 11px — audit §5.11 fixed), spacing
  rhythm is consistent (36px sections + hairline dividers), and tone of copy is uniform —
  plain, confident, no marketing voice. No page feels like a different product.

### 11. Accessibility quick pass

Strongest audit pass after trust:

- **Focus**: one 2px `--accent` outline with offset on every interactive element; verified
  on the first 10 tab stops of Overview (skip link → nav → status pill → CTAs) — all
  visible, logical order.
- **Skip link** → `#main` exists and the target exists.
- **Map keyboard flow (the audit's §5.4 fix) works**: markers focusable, Enter opens the
  popup, focus moves into the popup's "Value a home here →" link (visible focus ring in the
  screenshot), Esc closes and returns focus to the marker. The toolbar select offers the
  same content without pointing; the directory table is the full non-map equivalent and the
  map's `role="application"` label says so.
- **Forms**: every control on `/valuation` has a `<label for>` or aria-label (DOM-verified:
  zero unlabeled); errors wire `aria-invalid` + `aria-describedby`; the error summary
  auto-focuses the first invalid field; the scenario sliders have real labels; the submit
  has an `aria-live` status.
- **Tables**: `aria-sort` on sortable headers (verified `ascending` after click); the
  comps expander has `aria-expanded` + a real accessible name; chart data tables are
  present for screen readers.
- **Contrast** (computed): `--text-3` on `--bg` 4.91:1 ✓; accent on white 5.22:1 ✓;
  white on accent 5.22:1 ✓; **`--warn` on `--warn-dim` ≈ 4.05:1 — below the 4.5:1 AA
  floor** for the 11px badge text ("SIMULATED TARGET", "REDUCED CONFIDENCE" — the honesty
  badges, of all things). P2: darken `--warn` one step (≈ `#8f5a0c`).
- Reduced motion: global CSS compression + `useReducedMotion` feeding recharts, smooth
  scroll, and map flyTo. No keyboard traps found anywhere.

---

## Per-page scores

| Page | Score | Deductions (fix = the named item) |
|---|---|---|
| Overview `/` | **8.5** | −0.5 hero meta hardcoded champion fallback shown even when `/model/info` fails (P2-F2); −0.5 trends smoothing + truncated y-axis (P2-C1); −0.5 hero/panel balance at wide desktop (polish) |
| Valuation `/valuation` | **7.5** | −1.5 invisible factor bars (P0-1); −1.0 mobile 390px horizontal overflow (P0-2); −0.5 grouped years in hints/validation/comparison (P1-F1); +0.5 offset for the best submit pipeline in the app |
| Market `/market` | **8.5** | −0.5 verbatim 300-char velocity note inside map popups (Q3); −0.5 profile CTA prefills the *first* member neighborhood, not "this market" (P2-U1); −0.5 topbar seam affects this page most (shared P1-N1) |
| Model Insights `/model` | **9.0** | −0.5 Methodology hardcoded fallbacks incl. `feature_version` (P2-F2); −0.5 classification badge trio wraps to two lines in the panel head (polish) |
| Model Health `/health` | **8.5** | −0.5 twin drift empty states repeat each other (Q3); −0.5 stale `#6e7c8b`-era fill default + dual `factor-fill--neg` definition live on this page's PSI bars (latent P0-1 sibling, P2-C2) |
| NotFound `*` | **9.0** | −0.5 no popular-links list; otherwise exactly right for five routes |
| **App overall** | **8.0** | gated by the two P0s on the core page |

**Audit-fix verification (proppulse-frontend-audit.md follow-through):** fixed and verified —
main bundle 745→367 kB (recharts lazy, §4); toasts (§5.3); chart a11y tables (§5.4);
sortable tables + stable comp keys (§5.5); ErrorBoundary around Layout + NotFound with
soft reset (§5.6); structured 422 `details` replace the regex (§5.7); engine-panel failure
state (§5.8); Health polling pauses when hidden (§5.9); 11px readability floor (§5.11);
Load-example + rail empty state (§5.12); failed re-submit keeps previous result (§5.13);
URL-payload sharing + localStorage restore (§6.11/§5.1); remodel-year 2008/2026 conflict
resolved (§2.2); map keyboard access (§5.4); dead `Loading` export deleted (§3.3).
**Not done:** dead-CSS purge incomplete (§1.6 — four dead classes remain), component file
moves to `components/valuation|market|insights/` not executed (SPEC §9 ownership map;
no user impact).

---

## Prioritized fix list

### P0 — must fix before release

1. **P0-1 · Invisible "Why this value" factor bars (and latent Health PSI bars).**
   `components/FactorBars.jsx:51-56` and `components/health/DriftPanel.jsx:121-122` render
   `.factor-track`/`.factor-fill` as `<span>`s. The track is blockified by its grid parent,
   but the fill stays `display: inline` — `width`/`height` are ignored, computed size is
   **0×0** (measured live), so every valuation shows five empty gray tracks where the SHAP
   explanation bars should be. **Fix:** give `.factor-track`/`.factor-fill`
   `display: block` in `styles.css:884-886` (or switch to `<div>`s like the working
   `shared/DriverBars.jsx`). One line; restores the payoff panel of the product.
2. **P0-2 · `/valuation` breaks horizontally at 390px once a result renders.**
   Document scrolls to 625px; form inputs and rail values run off-screen. Cause: comps
   table min-content propagates through `.valuation-rail` (grid item, `min-width: auto`).
   **Fix (verified live):** `.valuation-rail { min-width: 0 }` in
   `styles/valuation.css:16-20` (or `.valuation-grid > * { min-width: 0 }`) — document
   returns to exactly 390px. One line; un-breaks the core page on phones.

### P1 — should fix

3. **P1-F1 · Years are thousands-grouped.** "train range 1,872–2,008"
   (`components/valuation/formConfig.js:26-31`), "Must be between 1,870 and 2,026"
   (`validateNumeric`, formConfig.js:194-196), comp comparison "Year built 1,970 / 1,995"
   (`CompsTable.jsx:55-58` via `fmtPlain`), scenario lever labels ("Year built 1,995 →
   2,001", `ScenarioExplorer.jsx:74-76`). **Fix:** add a year-safe path —
   `formatNumber(value, 0, { useGrouping: false })` or a `formatYear()` — and use it for
   `year_built`/`year_remod_add`/`yr_sold` everywhere.
4. **P1-N1 · Mobile topbar nav is two stacked columns, not the scroll strip.**
   `Layout.jsx:103-105` group `<div>`s become the flex children of `.topbar-nav`.
   **Fix:** at ≤900px, `.topbar-nav > div { display: contents }` so items lay out flat
   (keeps captions hidden per existing rule).

### P2 — nice-to-have

5. **P2-F2 · Hardcoded fallbacks render as fact when the API is down.**
   `components/insights/Methodology.jsx:10-15` (`feature_version '9b0f8ba4201c'` et al.)
   and `Overview.jsx:46-47` (champion names in the hero meta). Fix: degrade to '—'/omit,
   matching the SPEC's additive-only rule Valuation already follows.
6. **P2-C1 · Trends chart honesty polish:** `type="monotone"` → `"linear"` (6 samples
   don't earn smoothing); state or pad the truncated y-axis (`TrendsChart.jsx:111`).
7. **P2-C2 · Token/color drift:** `#6e7c8b` in `TrendsChart.jsx:106,110` and
   `constants.js:64` → `#5d6d7d`; delete the duplicate `.factor-fill--neg` definition
   (`styles.css:886` terra vs `valuation.css:163` danger — keep `--danger` per SPEC §2.1).
8. **P2-A1 · Warn-badge contrast 4.05:1 < 4.5 AA** — darken `--warn` (≈ `#8f5a0c`) so the
   11px honesty badges pass.
9. **P2-D1 · Dead CSS purge, round two:** `.grid-valuation`, `.grid-map`, `.state-view`,
   `.state-view-detail` (`styles.css:328-329, 775-784`).
10. **P2-U1 · Market profile CTA** prefills the first member neighborhood of the cluster
    (`components/market/MarketProfile.jsx:108-116`) — either label it as the member it
    picks or drop to the directory.
11. **P2-S1 · Spec file-layout debt:** components meant to live under
    `components/valuation|market|insights/` remain at the components root (SPEC §9); also
    the long verbatim velocity note could render once per page instead of three times on
    Market.

---

*Reproducibility: all findings were captured against the production build
(`npm run build`, vite 6.4.3 — pass; `npm run lint` — clean) served by `vite preview`,
driven by Playwright/Chromium 151 against the live backend (`:8000`, verified `/health`
ok). Computed-style and DOM measurements cited above are from those runs. Temporary test
scripts and screenshots were deleted after the run; the preview server was stopped.*
