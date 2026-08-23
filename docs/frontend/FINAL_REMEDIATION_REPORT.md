# Final Remediation Report — PropPulse frontend

Date: 2026-08-18 · Author: documentation agent (code-verified)
Audit basis: two independent code-audit passes over `frontend/src/` plus a Playwright
screenshot sweep — 17 desktop routes @1440px and 5 mobile routes @390px against the live
backend, zero console errors. Every finding below was re-verified against the code as it
now stands (file:line evidence cited); build and lint were re-run on this tree for the
release gate at the end.

Related documents: `DESIGN_SYSTEM.md` (system as implemented), `UI_COMPARISON.md`
(reference parity + deviation register), `BUTTON_AUDIT.md` (control inventory),
`design-system/MASTER.md` (global source of truth).

> **Release-gate completion (2026-08-19):** the three `pending-final-run` rows were
> executed on this tree — build/lint re-run green, the full capture sweep
> (`e2e/capture-proppulse.mjs`, live :5300/:8200) produced every desktop and mobile
> capture with zero console errors, and the five 390px routes measure
> `scrollWidth == clientWidth` (no horizontal overflow). All five gates are PASS.

---

## 1. Training pulse — missing keyframes for the live-job dot

- **Finding:** `.wf-pulse-dot` (the pulsing dot on an active training job's status chip)
  animated with `wf-step-pulse`, but no `@keyframes wf-step-pulse` existed anywhere — the
  dot rendered static.
- **Root cause:** the keyframes were referenced from `workflow-train.css` but never
  defined; the per-page stylesheet is only loaded on the train route, so the animation
  also had to resolve regardless of stylesheet import order.
- **Fix:** `@keyframes wf-step-pulse` (opacity 0.35→1, scale 1→1.25, in the idiom of the
  health pulse) defined once in the global sheet, with an explicit
  `prefers-reduced-motion` kill alongside the other animation overrides.
- **Files changed:** `frontend/src/styles.css` (:1929-1935 keyframes, :1951
  reduced-motion kill), `frontend/src/styles/workflow-train.css` (:251-259, animation
  ref :258), `frontend/src/components/workflow/JobStatus.jsx` (:91, `aria-hidden` dot).
- **Verification:** grep confirms the keyframes resolve globally and
  `.wf-pulse-dot { animation: none }` fires under reduced motion; the dot is decorative
  (`aria-hidden="true"`), the status text carries the state.
- **Status:** FIXED.

## 2. Heatmap contrast — mid-ramp numerals below WCAG AA

- **Finding:** correlation-heatmap cell numerals (9px mono) dropped to ~2.65:1 contrast
  in the middle of the single-segment `raised → amber` lerp — the band where the fill is
  too bright for `--text` and too dark for `--accent-ink`.
- **Root cause:** the reference lerp `t = clamp(v,0,1)**0.7` crosses a fill-luminance
  band (~0.15–0.20) that neither ink token carries at 4.5:1; the single ink flip at
  t≥0.45 could not fix both sides of the band.
- **Fix:** the ramp now splits into two segments collinear with the original lerp line,
  jumping the uncarryable band at the ink flip: `HEAT_FLIP = 0.6` on t (v ≈ +0.48) with
  segment endpoints `HEAT_MID_LOW [130,105,47]` / `HEAT_MID_HIGH [154,121,51]`. Ink is
  `--text` below the flip and `--accent-ink` (`.heat-strong`) at/above it; the legend bar
  mirrors the flip with a hard stop at 48%. Measured vs fill: ≥4.57:1 below the flip,
  ≥4.56:1 at/above it (WCAG 2.x relative luminance, full t sweep). The step reads as the
  strong-correlation threshold band. The 9px `.heat-cell` numeral is the documented
  single exception to the 10px text floor (finding 4).
- **Files changed:** `frontend/src/components/workflow/VizExplorer.jsx` (:139-171 ramp +
  `heatStrong`, :442-443 cell render), `frontend/src/styles.css` (:1410-1448 cell/ink/
  legend, legend hard stop :1447).
- **Verification:** ramp constants and ink-flip logic read from the code; contrast
  figures are the measured values recorded in the code comments (full t sweep);
  screenshots 06 desktop/mobile show the threshold band.
- **Status:** FIXED.

## 3. Truth-in-numbers — hardcoded split sizes and model facts

- **Finding:** several pages stated split sizes (945/338/175) and model metadata as if
  they were live API values; `GET /model/info` carries no split sizes, and a note on
  `/market` asserted the 945 training-row count outright.
- **Root cause:** contract constants were rendered without provenance labeling, and no
  honest derivation existed for val/test sizes.
- **Fix:** `SPLIT_CONTRACT { train: 945, val: 338, test: 175 }` and
  `MODEL_INFO_FALLBACKS` (94 features, `ames-1.0`, feature_version, 4 clusters) now live
  in `constants.js`, explicitly contract-labeled and used only as fallbacks.
  `utils/splits.js` `confusionTotal()` derives the real val/test sizes from the
  classification champion's confusion matrices (their totals ARE the split sizes).
  ModelInsights section notes render the derived `n=` and omit the number when a matrix
  is unavailable — never a hardcoded n; the methodology note falls back to the contract
  constants. The page-desc now scopes itself: metrics are traced to live API responses
  while training-window facts are labeled data-contract constants. The `/market` data
  note no longer states 945 ("the training sales, 2006–2008"), and the site footer is
  the static "9-stage ML workflow".
- **Files changed:** `frontend/src/constants.js` (:236, :244-248),
  `frontend/src/utils/splits.js` (new), `frontend/src/pages/ModelInsights.jsx`
  (:114-131, :154-158, :165, :186-189, :279),
  `frontend/src/components/insights/Methodology.jsx` (:12-54),
  `frontend/src/pages/Market.jsx` (:270-273), `frontend/src/components/Layout.jsx`
  (:268), `frontend/src/pages/workflow/PreprocessStage.jsx` (:382-384).
- **Verification:** derivation chain read end-to-end (confusion matrix → total → note,
  with null-omission branches); no rendered `945` remains outside the contract constant
  and live-derived counts (Overview derives its disclosure count from the trends
  payload, `Overview.jsx:408,557`).
- **Status:** FIXED.

## 4. Text floor — sub-10px user-facing microcopy

- **Finding:** field hints/errors and pipeline node statuses rendered at 9.5px — below
  the documented floor and hard to read on dark hairline surfaces.
- **Root cause:** the floor policy existed only as folklore scattered across per-page
  sheets; the shared classes themselves were under it.
- **Fix:** canonical policy stated once at `.field-error` in `styles.css` (:959-962):
  **nothing in the system below 10px — the single documented exception is the 9px
  `.heat-cell` numeral (contrast verified, finding 2); user-facing errors/hints floor at
  11px.** Applied: `.field-hint` 11px (:963), `.field-error` 11px (:964), `.field-warn`
  11px (`styles/valuation.css:99-102`), `.wfpp-node-status` 10px
  (`styles/workflow-preprocess.css:14-19`), badges and brand microcopy 10px
  (`styles.css:847`, :293). Per-page sheet headers now reference the canonical rule
  instead of restating local variants (`health.css:4`, `insights.css:5`,
  `valuation.css:7`, `workflow-evaluate.css:6`, `workflow-preprocess.css:7`,
  `workflow-train-page.css:9`).
- **Files changed:** `frontend/src/styles.css`, `frontend/src/styles/valuation.css`,
  `frontend/src/styles/workflow-preprocess.css`, per-page sheet header comments.
- **Verification:** `grep 'font-size: 9'` over `frontend/src` returns only the 9px heat
  cell; all error/hint classes ≥11px.
- **Status:** FIXED.

## 5. Chart selectors rendered raw schema identifiers

- **Finding:** chart head selects (overview histogram/category switchers, driver lists)
  showed raw column names (`GrLivArea`, `neighborhood_median_price_per_sqft`).
- **Root cause:** option labels were rendered straight from the payload field names.
- **Fix:** selectors render `prettyFeature()` labels (known-label map + snake_case →
  Title Case, CamelCase kept readable) while option `value`s stay the raw schema
  identifiers the API expects. The same helper already drove FactorBars, DriverBars,
  GlobalDrivers, DriftPanel and the evaluation importance charts.
- **Files changed:** `frontend/src/format.js` (:119),
  `frontend/src/components/overview/OverviewCharts.jsx` (:254, :377).
- **Verification:** option elements read — `value={f.column}` raw, label
  `{prettyFeature(f.column)}`.
- **Status:** FIXED.

## 6. Hover-only disclosures — tooltips keyboard/touch users could not reach

- **Finding:** the SimulatedBadge disclosure and the "old split" provenance reasons rode
  hover-only `title` attributes — unreachable by keyboard and touch.
- **Root cause:** `title` tooltips are pointer-only and inconsistent with the system's
  focus treatment.
- **Fix:** a generalized CSS-only tooltip pattern, `.tip-badge` + `.tip-text`
  (`styles.css:1955-2002`): the badge is tabbable (`tabIndex=0`), the tip shows on
  `:hover` AND `:focus` (tap-to-focus covers touch), and is wired with
  `aria-describedby` + `role="tooltip"` instead of `title`, so no duplicate native
  tooltip. Floating-layer styling per the token system (`--elevated`, 1px hairline,
  `--radius-lg`, `--shadow-float`, `--z-overlay` — below dropdowns). SimulatedBadge is
  the `.wf-sim-badge`/`.wf-sim-tip` instance of the same pattern; the pattern is also
  used by ScenarioExplorer's Reduced-confidence badge and TrainStage's StaleSplitBadge.
  ComparisonTable's stale chip is focusable with an `aria-label`, and the visible
  `.wf-stale-note` still carries the full explanation in copy.
- **Files changed:** `frontend/src/styles.css` (:1955-2002),
  `frontend/src/components/workflow/SimulatedBadge.jsx`,
  `frontend/src/components/ScenarioExplorer.jsx` (:237-248),
  `frontend/src/pages/workflow/TrainStage.jsx` (:227-246),
  `frontend/src/components/workflow/ComparisonTable.jsx` (:171-176, :222-230),
  `frontend/src/styles/wf-comparison.css` (:18-20).
- **Verification:** each badge read for `tabIndex`, `aria-describedby`/`aria-label` and
  the paired tip element; CSS shows the tip on both `:hover` and `:focus`; instant swap
  (no animation), so reduced motion needs nothing extra.
- **Status:** FIXED.

## 7. ScenarioExplorer loading state was a bare "…" glyph

- **Finding:** while a what-if lever's debounced re-prediction was in flight, the delta
  cell showed a bare "…" — an unexplained glyph with no accessible announcement.
- **Root cause:** placeholder glyph instead of the system's skeleton idiom.
- **Fix:** an inline `.skeleton.scenario-delta-skeleton` bar sized to the 12.5px mono dd
  value (56×13px, the standard flat `--raised` pulse, reduced-motion safe) plus a
  visually-hidden "Updating…" for screen readers.
- **Files changed:** `frontend/src/components/ScenarioExplorer.jsx` (:266-270),
  `frontend/src/styles.css` (:2004-2010).
- **Verification:** JSX and CSS read; skeleton uses the shared `.skeleton` pulse killed
  by the reduced-motion block.
- **Status:** FIXED.

## 8. Mobile API status — no connectivity signal in the ≤900px top bar

- **Finding:** at ≤900px the sidebar becomes a top bar and the sidebar footer (with the
  API-status pill) is hidden — mobile users lost the only connectivity indicator.
- **Root cause:** the status pill lived only in the hidden footer.
- **Fix:** a compact, non-interactive `.api-status-compact` twin rendered beside the
  brand (`role="status"`, `aria-label` with the same state labels, `aria-hidden` dot).
  Hidden by default (`display: none`); the ≤900px block reveals it positioned on the
  brand row. Dot colours mirror the pill's states on the same semantic tokens
  (`--success` / `--warn` / `--danger` / `--text-3`).
- **Files changed:** `frontend/src/components/Layout.jsx` (:191-199),
  `frontend/src/styles.css` (:408-417 default + state colours, :1822-1830 ≤900px reveal).
- **Verification:** markup and both CSS blocks read; mobile screenshots (m-series
  @390px) show the dot; the full pill still renders in the desktop sidebar footer.
- **Status:** FIXED.

## 9. Breakpoint scale — undocumented drift from the documented four tiers

- **Finding:** the real responsive scale had grown to ten tiers while docs listed four
  (980/900/820/520).
- **Root cause:** per-page sheets accumulated their own media queries; the documented
  scale was never reconciled.
- **Fix:** verification + documentation, not code change. Measured against the
  stylesheets: max-width scale **1024 / 900 / 820 / 640 / 520 / 420** plus three
  measured exceptions off the main scale — **980** (features-table Notes column hides,
  `styles.css:1784-1787`), **480** (train tab-strip scroll-edge fade,
  `workflow-train.css:349` — 432px tabs vs 358px scrollport at 390px), **400**
  (tight-screen floor, `styles.css:1901-1908`) — and a single **min-width 1440**
  ultra-wide tier (`styles.css:1891-1896`, content measure widens to
  `--content-wide: 1200px`). Per-page homes: 1024/640/420/480 in `workflow-train.css`
  (:323-353), 640 also in `health.css:153`, `valuation.css:254`,
  `workflow-upload.css:93`, `workflow.css:211`.
- **Files changed:** documentation only — `design-system/MASTER.md` §10 (earlier pass,
  verified accurate here), `docs/frontend/DESIGN_SYSTEM.md` §12 (this pass).
- **Verification:** every `@media` query in `frontend/src/styles.css` and
  `frontend/src/styles/*.css` enumerated and counted (1024×1, 900×4, 820×7, 640×5,
  520×6, 480×1, 420×1, 400×1, 980×1, min-width 1440×1) — matches the documented scale.
- **Status:** FIXED (docs reconciled with code).

## 10. Token hygiene — dead tokens and hardcoded z-indexes

- **Finding:** the `:root` block carried dead scales (`--fs-*`, `--sp-*`, most `--z-*`,
  `--dur-micro/-fast/-base/-slow`, `--ease-in`, `--radius-xl/-pill/-xs`, `--text-4`,
  `--border-faint`, `--space-section-lg`, `--info*`, `--accent-active`, `--accent-soft`,
  `--font-sans`, `--navy`, `--terra`), and z-indexes were hardcoded per component.
- **Root cause:** migration leftovers from the pre-rebuild theme alongside the rebuilt
  token system.
- **Fix:** dead tokens deleted; the surviving z scale
  `--z-sticky: 100 / --z-overlay: 800 / --z-dropdown: 1000 / --z-toast: 4000`
  (`styles.css:75-78`) is wired into the former hardcoded layers — skip-link + toast
  region (`:217`, `:1578`), viz sub-nav (`:1366`), tooltip disclosures (`:1979`),
  dataset-chip dropdown (`styles/workflow.css:74`). Floating layers (dropdowns, toasts,
  map popups, tooltips) surface on `--elevated: #202521` (`:29`; toasts :1591, leaflet
  popups :1702/:1713, tooltips :1984, dataset dropdown `workflow.css:80`). The surface/
  text/status ramps were also retuned for dark contrast (bg deepened to `#0B0D0C`,
  status pair brightened to `#6FBF8C`/`#D36B62`; accent ramp unchanged) — see
  DESIGN_SYSTEM.md §1 for the current values.
- **Files changed:** `frontend/src/styles.css` (:14-94 + the wiring sites above),
  `frontend/src/styles/workflow.css` (:74, :80), per-page sheets (alias references).
- **Verification:** grep over `frontend/src` for every deleted token name returns zero;
  every `--z-*` reference resolves to the four-token scale.
- **Status:** FIXED.

## 11. CSS consolidation — triplicated component blocks

- **Finding:** the confusion-matrix totals modifiers were triplicated across
  `insights.css`, `workflow-train.css` and `workflow-evaluate.css`; the `.wf-cluster-*`
  card family and the ComparisonTable chrome were duplicated between the train and
  evaluate sheets (the train cluster copy was unreachable — no cluster markup on the
  06–07 routes).
- **Root cause:** organic growth of per-page sheets without a shared home for shared
  components.
- **Fix:** three canonical shared sheets — `styles/confusion-matrix.css` (`.cm-*`
  totals modifiers; the cm title is 11px per the floor, finding 4),
  `styles/wf-cluster.css` (`.wf-cluster-*`, the evaluate copy with hover),
  `styles/wf-comparison.css` (9 ComparisonTable rules: `.wf-clip`, `.wf-best-chip`,
  `.wf-stale-chip`, `.wf-stale-note`, `.wf-threshold-hint`, `.wf-bootstrap`,
  `.wf-chart-caption`, `.wf-sim-note`). Imported before the page sheets so
  equal-specificity page rules keep winning by source order; the base
  `.cm-grid`/`.cm-cell` stay global in `styles.css`, and each page keeps its own
  small-screen densify tier.
- **Files changed:** the three new sheets; imports in
  `frontend/src/pages/ModelInsights.jsx` (:36),
  `frontend/src/pages/workflow/EvaluateStage.jsx` (:26-28),
  `frontend/src/pages/workflow/TrainStage.jsx` (:69-70); duplicates removed from
  `styles/insights.css`, `styles/workflow-train.css`, `styles/workflow-evaluate.css`.
- **Verification:** file headers name the single canonical copy; import graph read;
  build green (no unresolved selectors).
- **Status:** FIXED.

## 12. Copy consistency — mixed CTAs, spellings, units and developer jargon

- **Finding:** CTAs into `/valuation` read variously "Try the model →", "Score a
  property →", "Value a home here/in this market →"; stage 02 used British "Analyse";
  area units mixed "sf"/"sqft"; the market page was also called "Neighbourhood
  Intelligence"; rendered copy carried developer jargon (ADR-N, `GET /…`, payloads,
  `log1p()`); the trends card tag asserted a hardcoded window.
- **Root cause:** copy written per-agent over many passes without a terminology sweep.
- **Fix:** every CTA to `/valuation` reads **"Estimate value →"** (ModelInsights,
  PredictStage bridge, DriftEmpty, NeighborhoodTable rows, map popups, MarketProfile
  foot); **"Analyze"** everywhere (stage 02 title, sidebar, Upload CTA, Overview empty
  state); units **"sq ft"** and **"$/sqft"**; **"Market Intelligence"** as the only page
  name (bridge CTA "Open Market Intelligence →"); jargon removed from rendered copy —
  the one exemption is stage 03's `.wfs-notes` log1p note, which is payload-verbatim
  (`data.target.note`, `StatsStage.jsx:172-175`); the TrendsPanel tag derives its window
  from the loaded periods (`train window {start}–{end}`, fallback only when periods are
  missing, `TrendsPanel.jsx:104-108`); the ModelInsights page-desc is scoped (finding
  3); the footer is the static "9-stage ML workflow".
- **Files changed:** `frontend/src/pages/ModelInsights.jsx` (:298),
  `frontend/src/pages/workflow/PredictStage.jsx` (:105),
  `frontend/src/components/health/DriftEmpty.jsx` (:85),
  `frontend/src/components/NeighborhoodTable.jsx` (:127),
  `frontend/src/components/NeighborhoodMap.jsx` (:272),
  `frontend/src/components/market/MarketProfile.jsx` (:130),
  `frontend/src/pages/workflow/MarketStage.jsx` (:216),
  `frontend/src/pages/workflow/FeaturesStage.jsx` (:46),
  `frontend/src/pages/workflow/UploadStage.jsx` (:235),
  `frontend/src/pages/workflow/stages.js` (:16), `frontend/src/pages/Overview.jsx`
  (:522), `frontend/src/components/Layout.jsx` (:268),
  `frontend/src/components/market/TrendsPanel.jsx` (:104-108),
  `frontend/src/constants.js` (form-field unit labels).
- **Verification:** greps for "Analyse", "Neighbourhood", "Value a home", "Score a
  property", "sf)" variants over `frontend/src` return zero rendered hits; every
  `/valuation` CTA reads "Estimate value →".
- **Status:** FIXED.

## 13. Metadata — no theme color, social cards, or touch icon

- **Finding:** `index.html` had no `theme-color`, no Open Graph/Twitter meta, and no
  apple-touch-icon; document titles used mixed separators.
- **Root cause:** shell metadata never revisited after the rebuild.
- **Fix:** `theme-color #0F1110`; OG `og:title`/`og:description`/`og:type`; Twitter
  `twitter:card`/`twitter:title`/`twitter:description`; `apple-touch-icon.png`
  (180×180, rasterized from `favicon.svg`) in `frontend/public/`; title separator
  unified to "·" across the document title and the route titles (`PropPulse · Property
  Intelligence`, `{Page} · PropPulse`, `{Stage title} · PropPulse`).
- **Files changed:** `frontend/index.html` (:11, :12-23, :24, :31),
  `frontend/public/apple-touch-icon.png` (new), `frontend/src/components/Layout.jsx`
  (:33-49 route titles).
- **Verification:** head read top to bottom; the PNG exists in `frontend/public/`;
  every title in `Layout.jsx` uses "·".
- **Status:** FIXED.

---

## Release gate

| Gate | Status | Evidence |
|---|---|---|
| `npm run build` | PASS (2026-08-19) | Re-run on this tree: `✓ built in 29.43s` |
| `npm run lint` | PASS (2026-08-19) | Re-run on this tree: eslint clean, 0 findings |
| Playwright desktop sweep — 17 routes @1440px | PASS (2026-08-19) | `e2e/capture-proppulse.mjs` against the live stack (:5300/:8200): all desktop routes + the valuation-result state captured into `docs/screenshots/proppulse/` (18 routes + 1 state), zero console errors |
| Playwright mobile sweep — 5 routes @390px | PASS (2026-08-19) | m01/m02/m06/m11/m17 captured; overflow measured per route — `scrollWidth == clientWidth` (390) on all five |
| Console-error probe (all routes, live backend) | PASS (2026-08-19) | capture sweep collected `console errors: none` across every desktop + mobile route |
