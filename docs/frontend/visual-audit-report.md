# PropPulse — Visual Audit Report

**Date:** 2026-08-09 · **Auditor:** pixel/UI audit agent · **Method:** Playwright screenshot sweep of the production build (`frontend/dist`, asset-hash verified) served on `http://localhost:5173` against the live backend on `:8000`, every screenshot reviewed by eye, plus programmatic layout metrics (overflow probes, computed font sizes) dumped per page × width.

**Reference bar:** PlacementPredict (`docs/frontend/placementpredict-design-system.md` + reference screenshots). PropPulse intentionally runs a light + teal palette instead of the reference's dark olive/amber; palette difference itself is **not** scored down.

**Evidence:** `docs/frontend/visual-audit/<width>/<page>.png` — six widths (1920×1080, 1440×900, 1280×720, 1024×768, 768×1024, 390×844) × six states (`overview`, `valuation`, `valuation-submitted` [real "Load example" → "Estimate value" submit], `market`, `model`, `health`); full-page captures at 1440; interaction probes in `visual-audit/interactions/`; machine metrics in `visual-audit/metrics.json`.

> Note: the brief said serve on :5330. The backend CORS whitelist (`CORS_ORIGINS`) only admits `localhost:5173` and `localhost:8080` — preflights from :5330 return 400 and every API call fails. Port 5173 was already serving the byte-identical current build (asset hashes match `frontend/dist/index.html`), so the audit ran there.

---

## 1. Verdict

**Overall: 8.7 / 10 — at/above the ≥8.5 bar.** PropPulse matches PlacementPredict's visual-completeness level and beats it in state design (empty/loading/error/honesty states). Two functional rendering defects — invisible factor-bar fills on the valuation result and a 390 px post-submit horizontal overflow — plus a small set of polish nits are all that separate it from a clean exceed.

## 2. Score table (per page, 8 axes)

| Axis | Overview | Valuation | Market | Model Insights | Health | Axis avg |
|---|---|---|---|---|---|---|
| Layout | 9 | 9 | 9 | 9 | 9 | **9.0** |
| Typography | 9 | 9 | 9 | 9 | 9 | **9.0** |
| Spacing | 8 | 9 | 9 | 9 | 8 | **8.6** |
| Components | 9 | 7 | 8 | 9 | 9 | **8.4** |
| Interactions | 9 | 10 | 8 | 8 | 9 | **8.8** |
| Responsiveness | 9 | 7 | 9 | 9 | 9 | **8.6** |
| Data UX | 9 | 8 | 9 | 10 | 9 | **9.0** |
| Polish | 8 | 8 | 8 | 9 | 8 | **8.2** |
| **Page overall** | **8.8** | **8.3** | **8.6** | **9.0** | **8.8** | **8.7** |

Scoring notes:
- **Valuation Components 7** — the "Why this value" factor bars render as five empty tracks (defect D1); the panel is the page's core explanation visual, so the deduction lands here.
- **Valuation Responsiveness 7** — hard horizontal overflow at 390 px in the submitted state (defect D2); every other width/state is clean.
- **Market Interactions 8** — hover/active/focus verified for cards and nav; map popup/fly-to states were exercised live but not captured as before/after evidence.
- **Model Insights Interactions 8** — the page is intentionally near-static (tables, matrices, prose); few interactive elements to score.

## 3. Defects (functional, with evidence)

### D1 — "Why this value" factor bars render empty (all widths)
- **What:** The five factor rows show bare gray tracks — no teal/danger fill at any width. Fill width comes from an inline `style="width: X%"` on `<span class="factor-fill">`, but the span is `display: inline` and `frontend/src/styles.css:885` (`.factor-fill`) sets no `display`, so `width`/`height` are ignored and the fill collapses to zero size.
- **Where:** `frontend/src/components/FactorBars.jsx:51-56` (span markup) + `frontend/src/styles.css:884-886`. The sibling component `components/shared/DriverBars.jsx:48-50` uses `<div>`s — which is why the Overview/Model driver bars render correctly.
- **Evidence:** `visual-audit/1440/valuation-submitted.png` (region x 905–1235, y 1405–1530), `visual-audit/interactions/table-row-hover.png` (right rail).
- **Fix:** add `display: block` to `.factor-fill` (one line), matching `.driver-fill` behavior.

### D2 — 390 px: submitted valuation overflows horizontally by 235 px
- **What:** After a real submit, `document.scrollWidth` = 625 at a 390 px viewport; the whole page (form + rail) is pushed ~235 px past the right edge and content clips (range-band caption, gauge badges cut off). Idle `/valuation` at 390 is fine (overflow 0).
- **Root cause:** the comps table's min-content (~609 px) propagates up through `.rail-stack > .panel` into the `.valuation-grid` track — the rail is a grid item without `min-width: 0` (`.main` has it, `.valuation-rail` doesn't), so at ≤1024 px (single-column track) the track stretches to the rail's min-content. Bisected live: hiding `.valuation-rail` drops scrollWidth 625 → 390; hiding rail child #5 (the comps `div.panel`) does the same.
- **Evidence:** `visual-audit/390/valuation-submitted.png`; `visual-audit/metrics.json` (`390/valuation-submitted overflowX=235`).
- **Fix:** `.valuation-grid > * { min-width: 0 }` in `frontend/src/styles/valuation.css` (or `min-width: 0` on `.valuation-rail` + `.rail-stack`). The `.table-scroll` already has `overflow: auto` — it just needs the chain above it allowed to shrink.

### D3 — Market directory CTA column clipped at desktop widths
- **What:** The last table column ("Value a home here →", `components/NeighborhoodTable.jsx:119`) renders as "Value a home her" at 1440 — the table exceeds the content column by ~60 px and the link cell sits inside the table's horizontal scroll. Users must scroll the table sideways to reach the row CTA.
- **Evidence:** `visual-audit/1440/market.png` (region x 1100–1440, y 1000–1200).
- **Fix (any):** shorten the link ("Value →" / "Estimate →"), let the `CODE` column drop ≤1440, or allow the link cell to wrap (`white-space: normal` on that `td`).

## 4. Width-by-width findings

| Width | Result |
|---|---|
| **1920×1080** | Clean. Content column (1080 max) centers; sidebar sticky; no overflow anywhere (metrics.json). Champion-card badge wrap visible (N2). |
| **1440×900** | Clean page-level. D1 (factor bars) and D3 (CTA clip) live here. Full-page captures for every page at this width. |
| **1280×720** | Clean. Cluster-card stat rows wrap ("Median price" / value onto two lines) in the narrow map rail — readable, acceptable. Map height 440 px per spec. |
| **1024×768** | Grids correctly collapse to single column (`grid-hero`, `valuation-grid`, `market-map-grid`, `grid-2`); rail de-sticks; submit scroll-into-view verified in `1024/valuation-submitted.png`. Metrics 6-up → 3-up. |
| **768×1024** | Sidebar → topbar transformation works; active item gets the bottom teal bar. Topbar renders as 2 columns × 3 rows (nit N1). All pages clean, no overflow. |
| **390×844** | All pages clean **except** D2 (post-submit overflow). Buttons go full-width ≤420 px, metrics 2-up, CM cells shrink, map 300 px, tables keep horizontal scroll with sticky first column — verified in `390/*.png`. |

Programmatic checks (every page × width, `metrics.json`):
- **Horizontal overflow:** 0 px on 35 of 36 page-width combinations; the only failure is `390 /valuation-submitted` (D2).
- **Font-size floor:** smallest computed font anywhere is exactly **11 px** — the "nothing below 11 px" invariant holds.

## 5. Polish nits (non-blocking)

- **N1 — Mobile topbar is two stacked group columns, not one scroll strip** (768/390, all pages). `NavItems` (`components/Layout.jsx:103-118`) wraps each nav group in a `<div>`; inside `.topbar-nav` those become two flex columns → ~130 px tall nav, "Market Intelligence" stranded on row 3. Fix: `.topbar-nav > div { display: contents }` in `styles.css` (≤900 block) — flattens groups into the intended single horizontal scroll row, sidebar markup untouched. Evidence: `visual-audit/768/overview.png`.
- **N2 — Champion-card head wraps unevenly** (`/model`, ≥1280): "Classification · random_forest_v1" wraps to two lines and `SIMULATED TARGET` drops to a second badge row while the regression card head is one line. Fix: allow `.insights-badge-set` to sit on its own row at all widths, or `flex-wrap: nowrap` + smaller gap. Evidence: `visual-audit/1920/model.png`, `1440/model.png` (y ≈ 200–330).
- **N3 — Raw threshold precision on Valuation:** page-meta and gauge meta print `threshold 0.203292` while Model Insights/Health print `0.2033`. Fix: format with the same `formatMetric(threshold, 4)` used elsewhere (`pages/Valuation.jsx:88`, `components/ProbabilityGauge.jsx`). Evidence: `visual-audit/1440/valuation-submitted.png` (gauge meta), `visual-audit/1280/valuation.png` (page meta).
- **N4 — Metric hint wraps mid-token:** "approximate centroids (ADR-2)" breaks to "(ADR-" / "2)" in the 6-up Overview strip. Fix: `white-space: nowrap` on "ADR-2" or a shorter hint ("approx. centroids"). Evidence: `visual-audit/1440/overview.png` (metrics strip).
- **N5 — Health refresh meta optically centered** (≥1024): the visibility-hidden `.health-refreshing` span participates in the `space-between` flex, pushing `.health-refresh-meta` ~96 px off the content's left gridline. Fix: move the indicator inside the meta element, or `margin-left: auto` on the button with `justify-content: flex-start`. Evidence: `visual-audit/768/health.png`, `1440/health.png` (refresh row).
- **N6 — OSM default tiles are visually loud** against the restrained light theme (green/pink/yellow basemap patches compete with cluster colors). A muted basemap (e.g. CARTO Positron) would integrate better; possibly a deliberate no-API-key choice. Evidence: `visual-audit/1440/market.png`.
- **N7 — Map toolbar select clips mid-word at 390** ("Choose a neighborh"). Add `text-overflow: ellipsis` or let the label wrap. Evidence: `visual-audit/390/market.png`.
- **N8 — Local machine path in product UI:** drift empty state prints `C:\Machine_Learning\Prop-pulse\logs\predictions.jsonl`. Honest, but developer-machine paths read unpolished in a product surface; prefer the repo-relative `logs/predictions.jsonl`. Evidence: `visual-audit/1440/health.png` (feature-drift panel).
- **N9 — Over-airy gaps on Overview:** ~100 px of dead space between the metrics strip and "What moves a price", and around the disclosures block — slightly off the otherwise consistent 36 px section rhythm. Evidence: `visual-audit/1440/overview.png`.
- **N10 — "Remodel year" hint wraps "1950–2008"** at 1440 idle form. Trivial. Evidence: `visual-audit/1440/valuation.png`.

## 6. Reference comparison — element vs element

**Where PropPulse is at/above PlacementPredict:**
- **State design (PropPulse wins):** the reference shows no designed empty states in its screenshots; PropPulse has the drift `NO_DATA` panels (facts row, CLI hint chip, "what this panel will show" teaching list), skeleton shimmer stacks, stale-dim revalidation, and a capped FIFO toast system. `visual-audit/1440/health.png`, `interactions/submit-busy.png`.
- **Provenance discipline (PropPulse wins):** every section head carries its source endpoint in mono (`GET /model/info`, `GET /metrics · per-process`); the reference does this only at page level.
- **Honesty UX (PropPulse wins, narrowly):** `SIMULATED TARGET` / `APPROX.` badges, "not current listings" captions, the "NOT AVAILABLE / NOT SHOWN" list, and the verbatim registry rationale block exceed the reference's (already good) bench-banner candor. `visual-audit/1440/model.png`.
- **Tables (tie):** mono uppercase headers, tabular right-aligned numerics, row hover — both. PropPulse adds sortable headers and expandable comp rows; the reference adds the champion-row amber wash.
- **Nav (tie):** sidebar stepper with inset-accent active state on both; reference has numbered stages, PropPulse has grouped captions + live API-status pill in the footer.

**Where the reference still wins:**
- **Font material:** real Inter + IBM Plex Mono webfonts vs PropPulse's system-ui/ui-monospace stacks. The reference's mono kickers and tabular numbers have more character; PropPulse's deliberate no-webfont stance (SPEC §2.2) trades distinctiveness for resilience. Most visible in big numerics (`$160,985` vs the reference's metric strip).
- **Chart craft density:** the reference's Chart.js skin (6% gridlines, fixed per-model colors, hollow box plots, 21×21 CSS heatmap, ROC curves) is denser and more custom than PropPulse's recharts defaults (which are tidy but closer to stock). `visual-audit/1440/overview.png` trends chart vs reference `evaluate.png` ROC.
- **One-moment-of-celebration hierarchy:** the reference predict page reserves its only colored border + 30 px verdict for the result panel; PropPulse's hero band is close, but the empty factor tracks (D1) currently undercut the "explained" moment.
- **Mobile nav economy:** reference's single-row horizontal stepper vs PropPulse's 3-row topbar (N1).

## 7. Fix list (selector-level, ordered by impact)

1. `.factor-fill` — add `display: block` (`frontend/src/styles.css:885`). Fixes D1 everywhere.
2. `.valuation-grid > *` — add `min-width: 0` (`frontend/src/styles/valuation.css`, base rule). Fixes D2 at 390 px.
3. `.market-directory .table` last column — shorten link text or let it wrap / drop `CODE` ≤1440 (`components/NeighborhoodTable.jsx:119`). Fixes D3.
4. `.topbar-nav > div { display: contents }` inside the ≤900 px block (`frontend/src/styles.css`). Fixes N1.
5. Threshold formatting — `formatMetric(threshold, 4)` in `pages/Valuation.jsx:88` and `components/ProbabilityGauge.jsx`. Fixes N3.
6. `.insights-badge-set` / champion card head — own row or nowrap (`frontend/src/styles/insights.css:29-34`). Fixes N2.
7. Overview metric hint — shorten or `nowrap` "ADR-2" (`pages/Overview.jsx` metrics strip). Fixes N4.
8. `.health-refresh` — keep meta flush left (`frontend/src/styles/health.css:8-15`). Fixes N5.
9. (Optional) muted basemap tiles; toolbar select ellipsis; repo-relative path in drift empty state; section-gap trim on Overview. N6–N10.

## 8. What was verified interactively (evidence in `visual-audit/interactions/`)

- Nav hover fill + active inset bar (`nav-hover.png`)
- Primary-button hover rule present (`.btn-primary:hover` → `--accent-hover`, 0.12 s) and busy state with spinner + disabled dimming (`submit-busy.png`)
- Input focus ring — 2 px teal outline, clearly visible (`input-focus.png`)
- Table row hover fill (`table-row-hover.png`)
- Toast system — "Estimate ready", top full-width ≤900 px / bottom-right ≥900 px, auto-dismiss 6 s (visible in `768/valuation-submitted.png`, `1440/valuation-submitted.png`)
- Skeleton stack during first submit (`submit-busy.png`, right rail)
- Result-bar/gauge 0.5 s emphasis transitions and band-fill animation (CSS `--dur-emphasis`; settled state in `valuation-result-settled.png`)
- Health auto-refresh actually polls (status timestamps differ between captures: 23:57:50 → 23:58:49)
