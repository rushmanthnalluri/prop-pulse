# REDTEAM.md — Final red-team verification pass (post-fix)

- **Date:** 2026-08-10 (2026-08-09 UTC)
- **Scope:** Independent re-verification of all 31 fixes (F1–F31) claimed for the 2026-08-09 red-team swarm findings against the PropPulse frontend reconstruction, plus a fresh-eyes regression sweep.
- **Method:** Every finding re-probed at the evidence level — computed styles, DOM structure, and live interactions via throwaway Playwright probes (`e2e/test-results/rt-verify*.mjs`, deleted after the run): locked stage-08/09 CTAs, sticky estimate panel on `/valuation` after a real Estimate submit, stage-01 loaded panel, kickers/h1s/dividers on all 12 stages (incl. 08/09 unlocked via a real `ridge`+`linear` training job, scrubbed afterward per the e2e teardown pattern), stage-06 400-branch alert CTA via a real 120-row upload (deleted afterward), stage-07 table digits after a completed job, stage-09 sandbox explanation after a real sandbox prediction, 404 title, footer metrics at 1440px, glyph/dead-code greps, skeleton animation, utility-class computed margins, and a zero-console-error sweep at 1440px and 390px.
- **Stacks:** PropPulse `http://localhost:5300` (Vite dev) + backend `:8200`; reference `http://localhost:5000` as control. Environment left as found (ames: `prepared:false`, 0 jobs; probe dataset deleted; `models/workflow` + `data/uploads` scrubbed).

## Findings verification

| ID | Area | Severity | Finding | Status | Verification evidence |
|---|---|---|---|---|---|
| F1 | Global CSS | High | Prose-link rules (`empty-state`/`panel-body`/`alert`/…) override `.btn-*` ink → invisible/off-token CTAs | **FIXED-VERIFIED (residual closed 2026-08-10)** | `:not(.btn)` scoping landed at `styles.css:95-111` and is verified live — locked 08/09 CTA `color: rgb(22,19,10)` on `rgb(217,166,63)` (probe `locked /workflow/08-evaluate`, same on fresh `ds_bc5fb7af`), `/health` DriftEmpty CTA ink-on-amber, prose links still amber (stage-03 footnote `rgb(217,166,63)`). The missed sibling `styles.css:833` `.alert a` was scoped to `.alert a:not(.btn)` on re-review; cascade probe: `btn-secondary` anchor → `rgb(235,236,232)` no underline, `btn-primary` → ink-on-amber, prose link → amber + underline (`verify-alert-cascade`). |
| F2 | Valuation | High | Sticky result aside dead in the filled state | FIXED-VERIFIED | `valuation.css:133-141` `.result-panel--estimate { position: sticky; top: 24px }`; live after a real Estimate submit: `position: sticky`, panel top = 24px at scroll 0 **and** after `scrollTo(0,1400)` (probe `valuation-sticky`), supporting panels scroll beneath. |
| F3 | Stage 09 | Medium | Run-on sentence: period-less `interval_note` + caveat | FIXED-VERIFIED | `SandboxPredictPanel.jsx:133-138` punctuation-guarded join; live sandbox prediction: "…validation residual quantiles. A validation-calibrated estimate…" — `joinOk:true, runOn:false` (probe `sandbox-explanation`). |
| F4 | /market | Medium | Leaflet popup link off-token `#0078A8` blue | FIXED-VERIFIED | `styles.css:1638-1639` override; live popup "Value a home here →" computes `rgb(217,166,63)` (probe `popup-link`). |
| F5 | /market /model /health | Medium | Metric pattern flipped label-over-value (7 components) | FIXED-VERIFIED | Value-first DOM in `HeadlineMetrics.jsx`, `ChampionDuo.jsx`, `ServiceStatus.jsx:36-57`, `TrafficTable.jsx:59-70`, `DriftPanel.jsx:75-80`, `PredictionDrift.jsx:78-85`, `MarketProfile.jsx:63-74`; live first-`.metric` child order = `["metric-value","metric-label",…]` on `/`, `/model`, `/health`; visible in `20-health.png`. |
| F6 | Stage 07 | Medium | Benchmark table 3dp, not blueprint 4dp | FIXED-VERIFIED | `TrainStage.jsx:666` `metricDigits={4}`; live after completed job `job_037e6872`: cells `0.1354 / 0.9280 / 0.1425 / 0.9202`, `fourDp:8, threeDp:0` (probe `train-table`); e2e pin updated to match (`workflow.spec.js:461` `formatMetric(rmsle, 4)`). |
| F7 | Stages 03/04/06–12 | Medium | Page-head divider missing on 8 stage pages | FIXED-VERIFIED | Live `headNext:"divider"` on 01/02/03/04/06/07/10/11/12 and on **unlocked** 08/09 (probes `route …`, `unlocked-head …`); 05-viz stays divider-less = reference parity (`/visualize` omits it for the viz-nav). |
| F8 | Stage kickers | Medium | Group taxonomy broken on 03/04/05/08/09 | FIXED-VERIFIED | Live: `Stage 03 · Records`, `04 · Records`, `05 · Records`, `08 · Modelling`, `09 · Assessment` (route sweep + unlocked-head probes); code `EvaluateStage.jsx:95`, `PredictStage.jsx:47`, `StatsStage.jsx:68`, `MissingStage.jsx:132`, `VizStage.jsx:30`. |
| F9 | Stage h1s | Medium | h1 ≠ stepper label; mixed casing | FIXED-VERIFIED | Live h1s `Descriptive Statistics`, `Missing Values`, `Predict Property` (route sweep + unlocked-head probes; `StatsStage.jsx:69`, `MissingStage.jsx:133`, `PredictStage.jsx:48`). |
| F10 | Stage meta | Low | "(bundled) (bundled default)" stutter | FIXED-VERIFIED | Live meta: `Dataset · Ames Housing (bundled) · 1,460 × 81 · …` — single qualifier (probe `meta 02/03/04`); guards at `StatsStage.jsx:55`, `MissingStage.jsx:123`, `FeaturesStage.jsx:39`. |
| F11 | 404 | Low | Title broke the "{code} · …" convention | FIXED-VERIFIED | Live title `404 · PropPulse` on `/no-such-page` (`Layout.jsx:154`); kicker "Error 404", h1 "Page not found" intact. |
| F12 | Stage 10 | Low | "Neighbourhood" vs "Neighborhood" | FIXED-VERIFIED | `stages.js:24` `Neighborhood Intelligence`; live title `Neighborhood Intelligence · PropPulse` + kicker `Stage 10 · Neighborhood Intelligence`. |
| F13 | Dead code | Low | Duplicate document-title helper in stages.js | FIXED-VERIFIED | `workflowDocumentTitle` exists only in `Layout.jsx:42/153`; `stages.js` (38 lines) no longer exports it (repo-wide grep). |
| F14 | Stage 01 | Low | Loaded panel states provenance twice | FIXED-VERIFIED | Live: badge `Bundled` + name `Ames Housing` (probe `loaded-panel`); `UploadStage.jsx:92-96` strips the suffix when the badge carries it. |
| F15 | Footer | Medium | Footer wraps to two lines at 1440 | FIXED-VERIFIED | Live footer height **35.27px = reference exactly**, `leftLines:1`, copy "PropPulse · property intelligence for Ames, IA" (`Layout.jsx:242`). |
| F16 | Home | Low | Lowercase API cluster label at sentence start | FIXED-VERIFIED | `Overview.jsx:205` `capFirst(clusterLabel(top))`; live insight: "Mid northwest leads the micro-markets at a $179,900 median…" (probe `home`). |
| F17 | Valuation | Medium | Factor bars render as 2.5–7% slivers | FIXED-VERIFIED | `FactorBars.jsx` normalizes to top factor (2.5% floor); live fills `["100%","79.9%","79.3%","62.5%","59.9%"]`, exact shares kept in the value column + tooltip (probe `valuation-sticky`; visible in `13-valuation-result.png`). |
| F18 | Valuation | Medium | "This estimate" and micro-market markers both amber | FIXED-VERIFIED | `MarketPosition.jsx:36-40` inline `clusterColor(cluster_id)`; live markers/swatches = `var(--accent)` / `var(--slate)` / `rgb(110,143,160)` (#6E8FA0) — three distinct series (probe `valuation-sticky`). |
| F19 | Cluster palette | Medium | Slate `#4c6e91` ~3.3:1 on dark tiles | FIXED-VERIFIED | `constants.js:92` `['#2a9d8f','#6E8FA0','#b98a2f','#b4593f']` — slate lightened to the system `--slate`; visible across map/donut/cards in `18-market.png`; D65 marked RESOLVED (`UI_COMPARISON.md:162-164`). |
| F20 | /market | Low | Cluster-card stats wrap mid-stat | FIXED-VERIFIED | `styles.css:1619-1625` `inline-flex + white-space: nowrap` per stat; live computed `whiteSpace:"nowrap"`; one-line stats visible in `18-market.png` rail. |
| F21 | /health | Low | Server absolute path leaks into drift empty state | FIXED-VERIFIED | `DriftEmpty.jsx:35-43` rewrites any `…/logs/…` token to the repo-relative tail; live `pathLeak:false` on `/health` (probe `metrics/health`). |
| F22 | /model | Low | Raw API jargon in GlobalDrivers note | FIXED-VERIFIED | `GlobalDrivers.jsx:17-28` `humanizeAggregation()` maps the "mean taken over \|aggregated shap\|…" shorthand to plain copy. |
| F23 | Valuation form | Low | Field hints never state the numeric fallback | FIXED-VERIFIED | Live hints: `1–500 · blank → training median 70`, `0–2,000 · blank → training median 478` (probe `hints`); values from `FEATURE_DEFAULTS` (`constants.js:217-218`). |
| F24 | BusyButton | Nit | Stale "ink-on-teal" comment | FIXED-VERIFIED | `BusyButton.jsx:44-45` now reads "ink-on-amber (the primary button's --accent-ink on --accent)". |
| F25 | Dead CSS | Medium | Orphaned 584-line `workflow-eda.css` | FIXED-VERIFIED | File deleted; zero `workflow-eda`/`wfe-` references repo-wide. |
| F26 | Dead CSS | Medium | ~30 dead rules in styles.css + 2 page sheets | FIXED-VERIFIED | All listed selectors (`.side-*`, `.nav-item*`, `.outcome*`, `.vs-*`, `.gauge*`, `.bp-*`, `.std-badge`, `.stage-note`, `.grid-hero`, `.sticky-rail`, `.result-hero`, `.driver-list`, `.chart-wrap--tall`, `.cell-role`, `.cm-axis-row`, `.note-tight`, `.field-hint-error`, off-palette `#3A403B`, `wf-duo*`/`wf-result-*`/`wf-sandbox-simnote`, `.wf-best-row`) grep to zero; no page lost styling (zero overflow, zero console errors, screenshots 01–20 reviewed). |
| F27 | Glyphs | Medium | Off-set glyphs (▾▸ ✓✕ ↑) | FIXED-VERIFIED | `ValidationReport.jsx:38` mono PASS/WARN/FAIL text badges; `CompsTable.jsx:240` `›` chevron; `FactorBars.jsx` `+/−`; SortHeader `↑/↓` remains — explicitly sanctioned by D75 (`UI_COMPARISON.md:154`) as part of the approved sorting deviation. |
| F28 | VizExplorer | Low | Hardcoded `#1B1F1C` outside token files | FIXED-VERIFIED | `VizExplorer.jsx:146/428` now reference `CHART_PALETTE.tooltipBg` (`chartTheme.js:49`). |
| F29 | Skeletons | Medium | Second live gradient (shimmer) | FIXED-VERIFIED | `styles.css:1566-1571` opacity pulse; live computed `animationName:"skeleton-pulse"`, `backgroundImage:"none"`; the only remaining styles.css gradient is the sanctioned heat-legend bar (`styles.css:1371-1377`). |
| F30 | Shadows | Low | 1px ring shadows + cluster-card inset bar | FIXED-VERIFIED | Range thumbs (`styles.css:1012/1021`) and `.position-marker` (`styles.css:1240`) use `outline: 1px solid var(--border-strong)`; `.cluster-card.active` inset bar documented as the D76 selection idiom (`UI_COMPARISON.md:155`). |
| F31 | Utilities | Nit | ~25 scattered inline spacing/capitalize styles | FIXED-VERIFIED | Utility scale present (`styles.css:1673-1687` `.mt-*`/`.mb-*`/`.capitalize`); live computed `marginTop:"36px"` on `.section-head.mt-36` — spacing intact, no collapse observed on any swept page. |

## Fresh-eyes regression sweep

Zero console errors and zero pageerrors on **all 18 desktop routes** (`/`, `/valuation`, `/market`, `/model`, `/health`, all 12 workflow stages, `/no-such-page`) and **all 8 mobile routes** re-swept at 390px; zero horizontal overflow at both widths on every swept route. Targeted regression checks: genuine prose links still render amber after the `:not(.btn)` scoping (stage-03 footnote live); the dead-CSS purge removed nothing in use (page structure, sidebar, tables, map, toasts all render — screenshots + computed probes); the skeleton pulse animates; the utility-class swap did not collapse spacing; the F6 4dp change matches the updated e2e pin (`workflow.spec.js:461`), so no frozen-suite breakage. One new item found:

```
FAIL (minor, documentation) — D-register contradicts the fixed stage-07 table precision
Reason: F6 moved the stage-07 comparison table to 4dp (verified live; e2e pin updated to
  formatMetric(rmsle, 4)), but the deviation ledger still describes it as 3dp in two places,
  so the doc now misstates the shipped behavior a reviewer is told to expect.
Evidence: docs/frontend/UI_COMPARISON.md:27 ("sortable 3dp comparison table") and
  UI_COMPARISON.md:112 (D45: "sortable, 3dp … 4dp appears in banner sub, inspection cards…")
  vs live probe train-table {"fourDp":8,"threeDp":0} and e2e/tests/workflow.spec.js:461.
Required change: update the two "3dp" mentions to 4dp (out of this pass's edit scope —
  §43 checklist only).
```

## Pre-approved deviations re-confirmed (noted, not failed)

- **Client-side sorting** on 4 tables, incl. the `↑/↓` sort arrows — D75 (`UI_COMPARISON.md:154`) explicitly sanctions the arrows; sort cycles verified live by the swarm and untouched by the fixes.
- **Cluster palette** — the F19 retune is the D65 follow-up landing; D65 marked RESOLVED at `UI_COMPARISON.md:162-164`.
- **Scroll-edge mask gradient** on the stage-07 tabs — still present at `workflow-train.css:427-428`, documented D77 (`UI_COMPARISON.md:167-168`).
- **Skeletons/toasts** — flat `--raised` skeleton opacity pulse (no shimmer), toast system unchanged; documented at `UI_COMPARISON.md:165-168`.
- **API status pill** in the sidebar footer — live ("API connected"), pre-approved.

## Verdict

~~One unresolved item: the F1 residual~~ **F1 residual closed on re-review (2026-08-10):** `styles.css:833` is now `.alert a:not(.btn) { … }`. Cascade probe (`verify-alert-cascade`, synthetic `.alert` host on the live app): `btn-secondary` anchor → `color: rgb(235,236,232)` (`--text`), no underline; `btn-primary` anchor → `rgb(22,19,10)` on `rgb(217,166,63)`; genuine prose link → amber + underline preserved. Everything else (F2–F31) was fixed and verified at the evidence level by this pass; the fresh-eyes sweep found no app regressions. The doc-staleness item (D45/register "3dp" mentions) was also corrected (`UI_COMPARISON.md` stage-07 row + D45 now record the 4dp table).

FINAL VERDICT: PASS — zero unresolved FAILs (F1–F31 all FIXED-VERIFIED; F1 residual closed and probe-verified 2026-08-10).
