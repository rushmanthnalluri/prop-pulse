# PropPulse Design System — as implemented (mission §40)

Date: 2026-08-10 · Author: QA compile agent · **Updated 2026-08-18** (final remediation
pass — token values, text floor, breakpoints, heatmap ramp, tooltip pattern, shared
sheets re-verified against the code; see `FINAL_REMEDIATION_REPORT.md`).
Sources: `frontend/src/styles.css` (2,011 lines, the token + component core),
`frontend/src/components/shared/chartTheme.js` (recharts skin), `frontend/index.html` (fonts),
`frontend/src/constants.js` (cluster palette), per-page stylesheets under `frontend/src/styles/`.
This documents **PropPulse's** system — it mirrors the PlacementPredict reference; the reference
itself is specified in `PLACEMENTPREDICT_UI_BLUEPRINT.md`. Design intent (inherited):
*"Dark, neutral, product-grade. Inter for UI, Plex Mono for data. One flat amber accent.
Hairlines over boxes. No gradients, no glow."*

---

## 1. Colors

Core tokens (`:root`, `styles.css:14-94`) — the reference palette, retuned for dark
contrast (backdrop deepened, text/status brightened; the amber accent ramp is unchanged):

| Token | Value | Usage |
|---|---|---|
| `--bg` | `#0B0D0C` | page backdrop (deepened for contrast), sidebar background, input background |
| `--surface` | `#141715` | panels, cards, table headers, hover fills |
| `--raised` | `#1A1E1B` | progress tracks, tooltip/chart-panel bg, skeletons |
| `--elevated` | `#202521` | floating layers only — dropdowns, toasts, map popups, tooltip disclosures |
| `--border` | `#262B27` | hairlines everywhere |
| `--border-strong` | `#3A403B` | input/select borders, secondary-btn border, scrollbar thumbs |
| `--text` | `#EFF0EB` | primary text |
| `--text-2` | `#A2A8A0` | secondary text |
| `--text-3` | `#8A9189` | muted/labels/captions/chart ticks |
| `--accent` | `#D9A63F` | the single flat amber accent |
| `--accent-hover` | `#E3B254` | primary-button hover, prose-link hover (brightens on dark) |
| `--accent-ink` | `#16130A` | text on amber (buttons, brand mark, strong heat cells) |
| `--accent-dim` | `rgba(217,166,63,0.14)` | accent-tinted fills (`.badge-accent`, band fill) |
| `--success` | `#6FBF8C` | coverage bars, positive deltas (`.pos`), API-up dot, success toast edge |
| `--success-dim` | `rgba(111,191,140,0.1)` | success badge fill |
| `--danger` | `#D36B62` | missing values, negative class, errors, quiet-link hover |
| `--danger-dim` | `rgba(211,107,98,0.1)` | error alert bg, invalid input bg, cm fp/fn cells |
| `--slate` | `#6E8FA0` | chart second series; map cluster-position marker |

One-offs (same as reference): `#3A403B` negative donut segment
(same value as `--border-strong`);
`rgba(217,166,63,0.24)` text selection; `rgba(217,166,63,0.4)` badge/banner/bench
borders; `rgba(217,166,63,0.05)` champion-row + cm tp/tn tint; `rgba(217,166,63,0.06)`
bench-banner/alert-warn bg; `rgba(198,93,85,0.45)` alert-error border;
`rgba(217,166,63,0.5)` / `rgba(198,93,85,0.5)` result-panel borders.

**Compatibility aliases** (`styles.css:53-57`) — mapped onto the amber system for the
per-page stylesheets: `--accent-border` → `rgba(217,166,63,0.4)`, `--accent-wash` →
`rgba(217,166,63,0.05)`, `--warn` → `#D9A63F`, `--warn-dim` → `rgba(217,166,63,0.1)`.
Migration hygiene only; they resolve to system values. The earlier `--ochre`/`--navy`/
`--terra` aliases were deleted in the 2026-08-18 token sweep, along with every other
dead token (`--fs-*`, `--sp-*`, the extra `--z-*` and `--dur-micro/-fast/-base/-slow`
scales, `--ease-in`, `--radius-xl/-pill/-xs`, `--text-4`, `--border-faint`,
`--space-section-lg`, `--info*`, `--accent-active`, `--accent-soft`, `--font-sans`) —
only consumed scales remain, and the surviving z-index layers are wired to
`--z-sticky: 100` / `--z-overlay: 800` / `--z-dropdown: 1000` / `--z-toast: 4000`
(`styles.css:75-78`).

**Cluster palette (`constants.js:88-93`)** — the one multi-hue family, used only for
micro-market identity (map markers, cluster cards, donut, trend lines, MarketPosition marker):
`#2a9d8f / #6E8FA0 / #b98a2f / #b4593f` via `clusterColor(id)`; fallback `#6e7c8b`. Retuned for
dark on 2026-08-09 — slate moved to the system `--slate` `#6E8FA0` (~5.5:1) and teal lightened
to `#2a9d8f` (~5.7:1); ochre `#b98a2f` (~6:1) and terra `#b4593f` (~4:1) kept their hues.
Deviation D65 RESOLVED.

`color-scheme: dark` is set on `:root` and `html`; selection is amber-tinted.

## 2. Typography

Fonts loaded in `index.html:25-30`: Google Fonts (preconnect + `display=swap`) —
**Inter 400/500/600/700** (`--font-ui`) and **IBM Plex Mono 400/500/600/700** (`--font-mono`).
Body: 14px / 1.55 / antialiased (`styles.css:76-85`).
Rule: **data, numbers, labels, chrome microcopy = Plex Mono; prose and titles = Inter.**
`tabular-nums` on `.mono`, `.num`, `.metric-value`, `.kv dd`, `th`, `.result-price`,
`.driver-value` (`styles.css:148-156`).

Scale as implemented:

| Element | Font | Size | Weight | Letter-spacing | Source |
|---|---|---|---|---|---|
| Page title (`page-head h1`) | sans | 27px (23px ≤820px) | 600 | -0.02em | `:451-458`, `:1870` |
| Page kicker (`.page-kicker`/`.kicker`) | mono | 11px | 400 | 0.11em uppercase, text-3 | `:440-449` |
| Page description (`.page-desc`) | sans | 14.5px | 400 | text-2, max-width 600px | `:460-465` |
| Section title (`.section-title`) | mono | 11px | 400 | 0.11em uppercase, text-2 | `:490-497` |
| Sub-section head (`.registry-group-head h2`) | sans | 15px | 600 | -0.01em | `:1600` |
| Card/panel title (`.panel-title`, `.chart-card-head h3`) | sans | 13px | 600 | -0.01em | `:665`, `:714-715` |
| Section sub (`.section-sub`) | sans | 13.5px | 400 | text-2, max-width 580px | `:515-520` |
| Metric value (`.metric-value`) | mono | 23px | 500 | -0.02em, tabular | `:631-638` |
| Metric label (`.metric-label`) | sans | 12px | 400 | text-3 | `:639` |
| Result verdict (`.result-verdict`) | sans | 30px | 600 | -0.02em | `:1551` |
| Result price (`.result-price` / verdict override) | mono | 30px valuation / 28px sandbox | 600 | -0.02em, tabular, plain ink | `:1265-1272`, `workflow-predict.css:31-35` |
| Banner name (`.bench-banner-name`) | sans | 20px | 600 | -0.01em, accent | `:875` |
| Buttons (`.btn`) | sans | 13px (12px `.btn-sm`) | 500 | -0.005em | `:744-758`, `:765` |
| Table header (`.table th`) | mono | 10px | 500 | 0.09em uppercase, text-3 | `:1112-1120` |
| Table numeric cell (`.table .num`) | mono | 12px | 400 | tabular, right | `:1126-1131` |
| Badge (`.badge`) | mono | 10px | 400 | 0.07em uppercase | `:844-855` |
| Brand lines | sans 13.5px/600 · mono 10px/0.09em uppercase text-3 | | | | `:290-298` |
| Page meta / footer / sidebar meta (`.page-meta`, `.footer-row`) | mono | 10.5–11px | 400 | 0.02em, text-3 | `:470-476`, `:401-411` |
| Field hint (`.field-hint`) | mono | 11px | 400 | text-3 | `:963` |
| Note (`.note`) | sans | 12.5px | 400 | text-3, line-height 1.5 | `:163-167` |

Text floor (canonical policy at `.field-error`, `styles.css:959-962`): **nothing below
10px anywhere** — the single documented exception is the 9px `.heat-cell` numeral (grid
density precludes larger; contrast ≥4.56:1, see §9). User-facing errors/hints floor at
11px (`.field-error`/`.field-hint` 11px, `.field-warn` 11px in `valuation.css`,
`.wfpp-node-status` 10px in `workflow-preprocess.css`); per-page sheets reference this
rule in their headers.

## 3. Spacing & layout geometry

- Content column: `--content-max: 940px`, centered, `padding: 0 40px` (24px ≤900px, 18px ≤520px).
- Section rhythm: `--space-section: 40px`; `.section { padding: 40px 0 }` separated by 1px
  `.divider` hairlines; `.page-head { padding: 44px 0 36px }`.
- Grids: `.metrics` 4 cols (2 ≤820px); `.metrics--3`; `.metrics-auto` `auto-fit minmax(120px,1fr)`;
  `.metrics-rows` row-gap 24px; `.grid-3`; `.chart-grid` 2 cols gap 16 (`.chart-card-wide` spans);
  `.eval-duo` 2 cols gap 24 margin-top 36; `.predict-grid` 1.25fr/0.75fr gap 36;
  `.predict-fields` 2 cols gap 14/16; `.home-head` 1.25fr/0.75fr gap 56, padding 48/40;
  `.group-index` 3-col hairline tiles (1 col ≤820px).
- Utilities: `.mt-0/6/10/12/16/28/32/36`, `.mb-16/20/24/32`, `.pt-12`, `.pb-8/56/64`, `.scroll-60`
  (60vh), `.scroll-68` (68vh), `.h-340`, `.mono`, `.mono-sm` (10.5px), `.dim`, `.text-danger`,
  `.text-accent`, `.borderless`, `.capitalize` (lowercase API labels), `.note-flush/-offset`,
  `.badge-offset` (styles.css Utilities block).
- Sidebar: 264px, sticky, own scroll; main footer `.site-footer` padding 32/40/44.

## 4. Radius & shadows policy

Radius tokens: `--radius-sm: 4px` (badges, role tags, compact selects, focus rings),
`--radius: 6px` (buttons, inputs, nav items, brand mark), `--radius-lg: 8px` (panels, cards,
alerts, table wrappers, dropzone, banners, cm-grid, toasts, empty states). One-offs: 3px
(tracks/fills/swatches), 2px (vs-bars, coverage), 1.5px (heat cells, histogram bars), 50%
(spinner, API dot, map markers).

Shadows: **none on any surface or hover.** Two sanctioned exceptions, both floating layers:
1. `--shadow-pop: 0 8px 24px rgba(0,0,0,0.55)` — toasts and leaflet popups only (`:54`, `:1643`, `:1747`);
2. the active-nav inset indicator `box-shadow: inset 2px 0 0 var(--accent)` (bottom inset
   `0 -2px` ≤900px) and the same inset bar on active `.cluster-card` — functional indicators,
   not elevation (`:317-323`, `:1842-1844`, `:1727`).

Gradients: exactly one data-surface gradient — the heatmap legend bar
`linear-gradient(90deg, --raised, …48% hard stop…, --accent)` (the hard stop at 48%
mirrors the heatmap ramp's ink-flip threshold, §9). One non-data exception exists by design: a
scroll-edge fade **mask** in `workflow-train.css` (a mask/alpha channel, not a fill — D77). The
skeleton is a flat `--raised` block with an opacity **pulse** (no shimmer gradient). No other
gradients in `src/`.

Motion: `--dur-hover: 0.12s ease` (bg/border/color only), `--dur-emphasis: 0.5s
cubic-bezier(0.2,0.7,0.2,1)` (result/gauge fills), `--dur-toast: 0.18s ease-out`,
`--dur-pulse: 1.4s ease-in-out infinite` (skeleton opacity pulse); spinner 0.7s; charts 450ms
ease-out; smooth scrolling.
`prefers-reduced-motion: reduce` zeroes all animation/transition (`:1916-1925`) and
`getAnimationProps(reduced)` does the same for recharts.

## 5. Buttons

`.btn` base (`:744-765`): inline-flex, gap 8px, 13px/500, ls -0.005em, padding 10px 16px,
radius 6px, 1px transparent border, 0.12s transition. **No shadows, ever.**

| Variant | Look | Hover | Usage |
|---|---|---|---|
| `.btn-primary` | `--accent` bg, `--accent-ink` text | `--accent-hover` bg | page CTAs (Start the pipeline, Upload dataset, Run preprocessing, Start training, Estimate value, Predict…) |
| `.btn-secondary` | transparent, `--border-strong` border, `--text` | `--surface` bg, `--text-3` border | quiet actions (Explore the data, Clear selection, Load example, Reset, Refresh now) |
| `.btn-sm` | modifier: 6px 10px, 12px | inherits variant | table-row + alert actions (Try again, View, Evaluate →) |
| `.link-quiet` | mono 11px text-3 underlined (offset 3px) | `--danger` | destructive quiet actions (Remove file, Cancel) |

States: `[disabled]` → opacity 0.6 + default cursor; busy = disabled + inline 12px `.spinner`
+ verb label ("Uploading…", "Estimating…", "Predicting…", "Running preprocessing…",
"Starting job…", "Retrying…", "Refreshing…") via the shared `BusyButton`. `.spinner--dark`
dark-track variant for non-primary buttons. Focus: global amber outline (below).

## 6. Inputs & forms

- `.field-label` 12.5px/500; `.field-input` + `.select`: mono 13px, `--bg` background (darker
  than the card), 1px `--border-strong`, radius 6px, padding 9px 11px, width 100%, tabular-nums
  (`:887-899`). Hover `--text-3` border; focus `--accent` border (no outline); `:focus-visible`
  adds the 2px amber outline at 1px offset.
- Invalid: `:user-invalid` / `.input-error` → `--danger` border + `--danger-dim` bg;
  `.field-error` danger mono 11px (`:964`, at the floor policy). Warn tier (train-range)
  via `.field-warn` in the valuation form.
- `.select`: `appearance:none` + inline-SVG chevron (stroke `#9BA29A`) right 12px, padding-right
  34px; disabled opacity 0.55. Compact `.chart-select` (chart-card heads): mono 11px, radius 4px,
  padding 4px 24px 4px 8px (`:932-950`).
- `.check-input` 15×15 `accent-color: var(--accent)`; benchmark rows add `.bench-check`.
- Range sliders (`input[type=range]`, scenario levers): 4px `--raised` track, amber round thumb
  with `--surface` cut + hairline ring (`:1012-1040`).
- Fieldsets `.predict-fieldset` / `.fieldset`: 1px `--border`, radius 8px, padding 18/18/14,
  mono 10px uppercase legend; `details.fieldset > summary` disclosure with amber `›` rotate
  (`:952-991`).
- Upload dropzone `.upload-drop`: 1.5px dashed `--border-strong`, radius 8px, padding 28/24;
  hover/dragover/focus-within → accent border + surface bg; visually-hidden but focusable file
  input; accent mono filename line (`:1042-1080`).

## 7. Cards, panels, metrics

- `.panel`: 1px `--border`, radius 8px, `--surface` bg; `.panel-head` (13/16 padding + bottom
  hairline + 13px/600 title), `.panel-body` (14/16), `.panel-foot` (hairline top, 12.5px text-3).
- `.chart-card`: same skin + padding 14/16/12; **the only hover effect is
  `border-color: --border-strong`** — no lift, no shadow; head = h3 13/600 + optional `.chart-tag`
  (mono 10px text-3) + optional `.chart-select`; `.chart-wrap` 200px / `.chart-wrap-tall` 320px /
  `.h-340` 340px frames.
- Metrics are **unboxed**: bare mono 23px value over 12px label, siblings separated by left
  hairlines (`border-left` + 24px padding), wrapped rows flush at row starts; `--bad`/`--warn`
  value modifiers (`:624-646`).
- Fact lists: `.dataset-facts` / `.kv` / `.result-facts` — hairline-separated dl rows, mono dd.
- Banners/badges: `.badge` (mono 10px, 3/7 padding, radius 4px; `-accent`/`-warn`/`-danger`/
  `-muted` fills), `.role-tag` (+ `.role-target` amber), `.alert` / `.alert-error` (`role=alert`)
  / `.alert-warn` (max-width 640px, `strong` block title, `.alert-actions`), `.bench-banner`
  (amber border + 0.06 wash, 20px accent name, mono sub), `.error-banner` shell strips. Status
  read-outs use mono **PASS/WARN/FAIL** `.badge` text (the reference status idiom — e.g. the
  stage-01 validation report), never icon glyphs.
- Progress/track family (static, on `--raised`): `.outcome-track` 10px, `.driver-track` 6px,
  `.coverage-track` 4px (success/danger fill), `.vs-bar` 7px, `.result-track` 8px animated
  (`--dur-emphasis`), `.band` 8px with marker, `.gauge` 8px with tick, `.factor-track` 6px,
  `.position-scale` 8px with markers.
- Confusion matrix `.cm-grid`: 1px-gap grid over `--border` (hairline cells), radius 8px
  clipped; 22px mono values; tp/tn amber on 0.05 wash, fp/fn danger on `--danger-dim`
  (`:1482-1523`).
- Empty state `.empty-state`: dashed `--border-strong`, radius 8px, centered, kicker + 14px/600
  title + 13px detail (`:1674-1683`).

## 8. Tables

- Wrapper `.table-scroll`: overflow auto, 1px `--border`, radius 8px; `.scroll-60`/`.scroll-68`
  height caps; thin styled scrollbars double as the scroll affordance (`:127-146`).
  **No client-side pagination; wide tables scroll.** Client-side sorting exists only where
  e2e-pinned/UX-mandated (verdict table, comps, directory, traffic) via `.sort-header`
  (th-inheriting button, mono ↑/↓ amber indicator, `aria-sort`, asc→desc→natural — `:1150-1167`,
  `useSortable.js`).
- `.table`: border-collapse, 13px; `th/td` 9/14 padding, bottom hairline, `nowrap`, last row
  borderless; `th` mono 10px uppercase on `--surface`; row hover `td` bg `--surface` (0.1s);
  **no striping**. Cell modifiers `.num`/`.dim`/`.strong`/`.accent`/`.pos`/`.neg`;
  `.champion-row td` amber 0.05 tint; `.cell-note`/`.cell-role` wide variants.
- Sticky variants: `.table-sticky` thead + `.sticky-col` first column (bg `--bg`, head
  `--surface`) — used on stage 03 stats and the market directory.
- Registry groups: `.registry-group` + head with 15px/600 title + `.registry-count`;
  "Notes" column hidden ≤980px (`.registry-optional`).

## 9. Charts (recharts via `chartTheme.js`)

`chartTheme.js` exports plain spread-props objects so every chart inherits one chrome
(Chart.js 4.4.3 semantics from the reference, recharts implementation):

| Concern | Mapping | Value |
|---|---|---|
| Ticks | `axisTick` → `xAxisProps`/`yAxisProps` | Plex Mono 10px `#8A9189`; axis lines + tick marks off; `tickCount` 7 (x) / 6 (y) ≈ maxTicksLimit |
| Grid | `cartesianGridProps` | y-only hairlines `rgba(235,236,232,0.06)` (`vertical: false`) |
| Tooltip | `tooltipProps` | bg `#1B1F1C`, 1px `#363D37`, radius 6, padding 10, mono 12px, no color chips, `boxShadow: 'none'`; cursor fill 0.04 wash |
| Legend | `legendProps` | 9px rect swatches, mono 11px text-2 (multi-series only) |
| Animation | `getAnimationProps(reduced)` | 450ms ease-out; 0ms under reduced motion (`CHART_ANIMATION_MS`) |
| Heights | CSS classes | 200 / 320 / 340 = `.chart-wrap` / `.chart-wrap-tall` / `.h-340` |

Palette (`CHART_PALETTE`): accent `#D9A63F` / fill 0.55 · slate `#6E8FA0` / 0.45 · neutral
`#8A9189` / 0.4 · danger `#D36B62` / 0.55 · grid/tick/text values
as tokens. Workbench candidates map onto theme hues only
(xgboost amber, random_forest slate, baselines grey — D46).
The home donut uses `clusterColor()` for micro-market identity (D14).

Per-type as implemented: histograms = amber bars (`accentFill` + 1px accent stroke, radius 1.5)
+ `#EBECE8` 1.5px smoothed outline; missing-values = danger bars 320px; influence/importance =
horizontal amber bars (`maxBarSize 18`, radius 2); ROC/reliability/PR = 1.8px lines, dashed
neutral `[5,5]` references ("chance" / "perfectly calibrated" / 45°); benchmark/validation =
grouped bars per-candidate hues; trends = cluster-colored lines, gaps stay gaps
(`connectNulls={false}`); scatter = amber dots 0.55 fill-opacity.

Non-recharts visuals: the correlation heatmap is a CSS grid (`.heat-grid`/`.heat-cell`,
`styles.css:1398-1454`) on the reference lerp base — `t = clamp(v,0,1)**0.7`, RGB
(27,31,28)→(217,166,63) — split at `HEAT_FLIP = 0.6` on t (v ≈ +0.48) into two segments
collinear with that lerp line (`HEAT_MID_LOW` (130,105,47) / `HEAT_MID_HIGH` (154,121,51)),
because the smooth ramp crosses a fill-luminance band neither ink token carries at WCAG
4.5:1; the `.heat-strong` dark-ink flip sits at the same threshold and the step reads as
the strong-correlation band (`VizExplorer.jsx:147-171`). Measured vs fill: ≥4.57:1 below
the flip, ≥4.56:1 at/above it. 1.5px accent outline hover, `title` tooltips, -52° column
labels, "0 ▬ +1" legend bar (the one gradient, with a hard stop at 48% mirroring the
flip); boxplot SVG chrome
(`.bp-*`) exists in the system. Every chart gets `role="img"` + aria-label + a visually-hidden
`ChartA11yTable` of exact values (`.visually-hidden`, `:192-204`).

## 10. Navigation

- **Sidebar stepper** (`Layout.jsx`, `:265-351`): `li.is-active > a > .step-num + .step-label`;
  item = flex, gap 10, 7/10 padding, radius 6, text-2; hover surface bg + text; active = surface
  bg + inset 2px amber bar + amber step-num + 500 label + `aria-current="page"`; two groups —
  "Pipeline" (01–09) and "Product" (5 champion pages), `.nav-caption` mono 10px uppercase;
  footer = "← Overview" + active dataset id + API-status pill.
- **Brand**: `.sidebar-brand` → `/`; 28×28 amber `.brand-mark` "PP" (mono 11/600, ink on amber,
  radius 6) + two-line wordmark ("PropPulse" / "PROPERTY INTELLIGENCE").
- **Stage pager** (`StagePager.jsx`, `:1343-1367`): hairline top, 24/0/64 padding, space-between;
  `.pager-dir` mono 10px uppercase text-3 + `.pager-label` 14px/500 text-2, hover accent; prev
  empty `<span>` on stage 01, next omitted on stage 12; chains all 12 stages with `?dataset=`.
- **Workbench context strip** (`WorkflowShell.jsx`): sandbox-vs-champion disclosure + dataset
  chip dropdown (`.wf-ds-*`, switch / inline-confirm delete / upload link).
- **Viz sub-nav** (`.viz-nav`, `:1373-1392`): the only in-page nav — sticky top 0, `--bg`,
  bottom hairline, 12px/500 text-3 links, hover accent; sections `scroll-margin-top: 48px`.
- **Document titles**: `{Page} · PropPulse` / `{Stage title} · PropPulse` (`Layout.jsx:33-47`).

## 11. States

- **Loading**: layout-matched `.skeleton` blocks (flat `--raised` bg + opacity pulse,
  reduced-motion safe) — panel lines, metric strips, 200px chart frames; `role="status"` on busy lines.
- **Busy**: `BusyButton` = disabled + 12px spinner + verb label; stale content dims
  (shared `.dim-stale` utility) with `aria-busy`.
- **Error**: shared `ErrorState` (alert language + "Try again" btn-sm) per async unit;
  `.alert-error` with `role="alert"`; in-card compact alerts on viz cards; shell-level
  down/degraded banners; route `ErrorBoundary` crash box with Reload/Back actions.
- **Empty**: `.empty-state` (dashed, centered, mono kicker + guidance + CTA where an honest
  unblock action exists); idle predict/valuation aside = kicker "Awaiting input" + "—" verdict
  in text-3 + guidance.
- **Hover**: 0.12s bg/border/color only — nav items, table rows, chart-card border, group
  tiles, pipeline rows, cluster cards, heat-cell outline, quiet links.
- **Focus**: single global treatment — `outline: 2px solid var(--accent); outline-offset: 2px`
  (inputs 1px), radius 4px, on `a/button/input/select/textarea/summary/[tabindex]` +
  scroll regions (`:112-125`).
- **Disabled**: buttons opacity 0.6 + default cursor; selects 0.55; dropzone `.is-disabled`;
  controls disable during submits/polls.
- **Active/selected**: inset amber bar (nav, cluster cards); `.aria-pressed` on toggles;
  `aria-sort` on sort headers; `aria-current="page"`.
- **Toasts**: bottom-right region (top full-width ≤900px), left-edge color per tone
  (success/danger/accent), the one elevation shadow, dismiss ×.

## 12. Breakpoints

Main max-width scale **1024 / 900 / 820 / 640 / 520 / 420**, three measured exceptions
off the main scale (**980 / 480 / 400**), and a single **min-width 1440** ultra-wide
tier — enumerated query-by-query over `styles.css` + `styles/*.css`
(1024×1, 900×4, 820×7, 640×5, 520×6, 480×1, 420×1, 400×1, 980×1, min-1440×1):

| Breakpoint | Changes |
|---|---|
| ≤1024px | Workbench grids collapse to 1 col (train sample grid, candidate cards, step fields — `workflow-train.css:323-327`) |
| ≤980px (exception) | Features-table "Notes" column hidden (`.registry-optional`, `styles.css:1784-1787`) |
| ≤900px | Shell → column; sidebar becomes full-width top bar; stepper → horizontal scroll strip (column items, nowrap, active indicator flips to bottom inset bar; step-label 12px; sidebar footer + step-soon hidden; active item scrolled into view); main padding 0 24px; home hero → 1 col gap 28; sticky rails unstick; toasts go top full-width; map 380px; cluster rail 2-col; the compact `.api-status-compact` dot appears beside the brand |
| ≤820px | h1 → 23px; metrics → 2 cols (hairline on even children); group-index/chart-grid/eval-duo/predict-grid/predict-fields → 1 col; result aside unsticks; cm-grid → 96px 1fr 1fr; driver/vs rows compact; pipeline-note hidden; footer + pager stack; model-pick field full width; result-price 26px; map 320px |
| ≤640px | Health monitor rows → 1 col (`health.css:153`); valuation factor rows compact (`valuation.css:254`); upload checks wrap (`workflow-upload.css:93`); workflow context chip tightens (`workflow.css:211`); train-sheet densify tier (`workflow-train.css`) |
| ≤520px | main padding 0 18px; metrics stay 2 cols; outcome legend stacks; banner padding/stack; result-price 24px |
| ≤480px (exception) | Train tab-strip gains the scroll-edge fade **mask** (432px tabs vs 358px scrollport at 390px — `workflow-train.css:349`) |
| ≤420px | Train config actions go full-width; job-row names may shrink (`workflow-train.css:339-342`) |
| ≤400px (exception) | Tight-screen floor: page-head padding 32px, h1 → 22px (`styles.css:1901-1908`) |
| ≥1440px (min-width) | Content measure widens to `--content-wide: 1200px` so data-dense pages breathe (`styles.css:1891-1896`) |

QA viewports (per blueprint §10): 1920 / 1440 / 1280 / 1024 / 768 / 390. Evidence on file:
1440px desktop pairs for all pages + 390px mobile shots (`m01/m02/m06/m11/m17`).

---

## Appendix — file map

| Concern | File |
|---|---|
| Tokens + core components | `frontend/src/styles.css` |
| Chart theme | `frontend/src/components/shared/chartTheme.js` |
| Fonts | `frontend/index.html` |
| Cluster palette | `frontend/src/constants.js` |
| Per-page extensions (no token redefinitions) | `frontend/src/styles/{overview,valuation,market,insights,health}.css`, `workflow*.css` |
| Reduced motion hook | `frontend/src/components/shared/useReducedMotion.js` |
| Sortable headers | `frontend/src/components/shared/{SortHeader.jsx,useSortable.js}` |
| State primitives | `frontend/src/components/{StateView.jsx,Toast.jsx,ErrorBoundary.jsx}`, `shared/{Skeleton,BusyButton}.jsx` |
