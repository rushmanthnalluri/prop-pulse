# PlacementPredict — Visual Design System Extraction

Source of truth for the PropPulse frontend rebuild. Every value below is quoted
from the reference project, not approximated.

**Sources analyzed**
- `flask_project/static/css/style.css` (1559 lines, read in full — the entire design system lives in this one file)
- `flask_project/static/js/charts.js` (Chart.js 4.4.3 configuration)
- `flask_project/templates/base.html`, `index.html`, `predict.html`
- `screenshots/home.png`, `predict.png`, `evaluate.png`, `visualize.png`, `demo.gif` (frames)

**Stated design intent** (from the CSS file header):
> "Dark, neutral, product-grade. Inter for UI, Plex Mono for data.
> One flat amber accent. Hairlines over boxes. No gradients, no glow."

That is the whole philosophy: a single dark theme, one accent color, separation
by 1px hairlines instead of shadows or elevation, and a strict two-font system
(sans for prose, mono for anything numeric or meta).

---

## 1. Color system

Dark-only theme. `html { color-scheme: dark; }` (`style.css:41`). There is **no
light theme** and no theme-switching logic anywhere.

### 1.1 Core tokens (`:root`, style.css:7-37)

| Token | Value | Role |
|---|---|---|
| `--bg` | `#0F1110` | Page background — near-black with a faint green cast |
| `--surface` | `#151816` | Cards, panels, table headers, hover fills |
| `--raised` | `#1B1F1C` | Inset tracks (progress bars), tooltip bg, code chips sit on `--surface` |
| `--border` | `#252A26` | Default hairline (1px) |
| `--border-strong` | `#363D37` | Emphasized hairline — inputs, badges, secondary buttons, alert borders |
| `--text` | `#EBECE8` | Primary text — warm off-white |
| `--text-2` | `#9BA29A` | Secondary text — descriptions, nav items |
| `--text-3` | `#8A9189` | Muted text — labels, captions, hints, mono microcopy |
| `--accent` | `#D9A63F` | The one accent — flat amber |
| `--accent-hover` | `#C29434` | Amber darkened ~8% for button hover |
| `--accent-ink` | `#16130A` | Text/icons placed *on* amber (near-black brown) |
| `--accent-dim` | `rgba(217, 166, 63, 0.14)` | Amber wash — accent badge bg, box-plot fill |
| `--success` | `#63A87D` | Muted green — coverage bars, positive deltas |
| `--danger` | `#C65D55` | Muted red — errors, "not placed", negative deltas |
| `--danger-dim` | `rgba(198, 93, 85, 0.1)` | Red wash — error alert/input backgrounds |
| `--slate` | `#6E8FA0` | Blue-grey — second series color (charts only; also `--slate` token in root) |

Note the palette is **desaturated and slightly olive/green-tinted** — even the
greys (`#9BA29A`, `#8A9189`) lean green-grey, matching the `#0F1110` background.
Do not substitute neutral greys; the tint is what makes it feel cohesive.

### 1.2 One-off colors used outside the tokens

| Value | Where | Selector |
|---|---|---|
| `#3A403B` | "Not placed" segment of outcome bar + donut slice | `.outcome-not`, `.outcome-swatch-not`, donut `backgroundColor` |
| `rgba(217, 166, 63, 0.24)` | Text selection highlight | `::selection` |
| `rgba(217, 166, 63, 0.05)` | Champion table-row tint; TP/TN confusion cells | `.champion-row td`, `.cm-tp`, `.cm-tn` |
| `rgba(217, 166, 63, 0.06)` | Benchmark banner background | `.bench-banner` |
| `rgba(217, 166, 63, 0.4)` | Amber hairline — target role-tag, benchmark banner, std-badge borders | `.role-target`, `.bench-banner`, `.std-badge` |
| `rgba(217, 166, 63, 0.5)` | "Placed" result-panel border | `.result-placed` |
| `rgba(198, 93, 85, 0.45)` | Error alert border | `.alert-error` |
| `rgba(198, 93, 85, 0.5)` | "Not placed" result-panel border | `.result-not` |
| `rgba(198, 93, 85, 0.14)` | Box-plot fill (not placed) | `.bp-not` |
| `rgba(22, 19, 10, 0.35)` | Spinner ring (accent-ink at 35%) | `.spinner` |

### 1.3 Semantic assignments

- **Success / positive**: `--success` `#63A87D` — used sparingly (coverage fill, `.vs-delta` positive). Placement *outcomes* do **not** use green — "placed" is **amber**, "not placed" is **danger red**. This is a deliberate, unusual mapping: amber = the thing being measured.
- **Warning**: there is no dedicated warning color; amber with a 40% border + 6% bg (`.bench-banner`) serves as the notice/warning treatment.
- **Danger**: `--danger` + `--danger-dim`, plus the 45–50% alpha borders above.
- **Info**: `--slate` `#6E8FA0` — second data series only, never used for UI chrome.

### 1.4 Chart palette (`charts.js:17-32`, `PALETTE`)

| Key | Value |
|---|---|
| `text` / `text2` / `text3` | `#EBECE8` / `#9BA29A` / `#8A9189` (same as CSS) |
| `accent` | `#D9A63F` |
| `accentFill` | `rgba(217, 166, 63, 0.55)` — bar fills |
| `slate` / `slateFill` | `#6E8FA0` / `rgba(110, 143, 160, 0.45)` |
| `neutral` / `neutralFill` | `#8A9189` / `rgba(138, 145, 137, 0.4)` |
| `danger` / `dangerFill` | `#C65D55` / `rgba(198, 93, 85, 0.55)` |
| `grid` | `rgba(235, 236, 232, 0.06)` — gridlines (text color at 6%) |
| `panel` / `panelBorder` | `#1B1F1C` / `#363D37` — tooltip surface |

**Fixed per-model colors** (`charts.js:35-39`, consistent on every chart and page):
`logistic_regression` → neutral grey, `random_forest` → slate, `gradient_boosting` → amber.
Fallback order for unknown models: amber → slate → grey.

---

## 2. Typography

### 2.1 Families (`:root`, loaded via Google Fonts in `base.html:10`)

- `--font-sans`: `"Inter", -apple-system, "Segoe UI", sans-serif` — UI prose. Weights loaded: **400, 500, 600**.
- `--font-mono`: `"IBM Plex Mono", ui-monospace, "SF Mono", monospace` — all data, numbers, labels, microcopy. Weights: **400, 500, 600**.

The mono font is a *design material*, not a code font: section titles, table
headers, badges, nav captions, hints, footers, and every numeric value are set
in Plex Mono. `font-variant-numeric: tabular-nums` is applied to every numeric
element (metric values, table `.num`, dataset facts, chart tags, heat cells…).

### 2.2 Base

- `body`: `font-size: 14px; line-height: 1.55;` plus `-webkit-font-smoothing: antialiased` and `text-rendering: optimizeLegibility` (`style.css:43-52`).

### 2.3 Size scale (every size used, with where)

| Size | Used for | Example selectors |
|---|---|---|
| 9px | Heatmap cell values/labels, std-badge | `.heat-cell`, `.heat-col-label span`, `.step-soon` |
| 9.5px | Badges, role tags, field hints, brand sub-line, cm axis | `.badge`, `.role-tag`, `.field-hint`, `.brand-line-2` |
| 10px | Section titles, table headers, kickers, captions, statuses, legends | `.section-title`, `.table th`, `.page-kicker`, `.nav-caption`, `.result-kicker`, `.chart-tag`, `.heat-legend`, `.bp-foot` |
| 10.5px | Nav step numbers, sidebar/footer mono meta, group-cell meta | `.step-num`, `.sidebar-footer`, `.footer-row`, `.group-cell-meta`, `.mono-sm`, `.vs-val` |
| 11px | Section links, page meta, pager direction, upload hints, coverage % | `.section-link`, `.page-meta`, `.pager-dir`, `.coverage-pct`, `.bench-banner-sub`, `.link-quiet` |
| 11.5px | Result meta row, split-bar deltas | `.result-meta`, `.vs-delta` |
| 12px | Metric labels, dataset filename/facts, table numbers, viz-nav links | `.metric-label`, `.dataset-file`, `.table .num`, `.viz-nav a`, `.vs-legend` |
| 12.5px | Fact rows, pipeline notes, field labels, notes, vs names | `.dataset-fact`, `.pipeline-note`, `.field-label`, `.note`, `.result-fact`, `.vs-name` |
| 13px | Buttons, nav step labels, panel/chart titles, table body, list rows | `.btn`, `.step-label`, `.panel-title`, `.chart-card-head h3`, `.table`, `.driver-name`, `.check` |
| 13.5px | Brand line 1, section subs, alerts, pipeline labels | `.brand-line-1`, `.section-sub`, `.alert`, `.pipeline-label`, `.stage-note` |
| 14px | Body default; group-cell names, pager labels | `body`, `.group-cell-name`, `.pager-label` |
| 14.5px | Page description | `.page-desc` |
| 15px | Registry group headings (`h2`) | `.registry-group-head h2` |
| 20px | Benchmark banner model name | `.bench-banner-name` |
| 22px | Confusion-matrix cell values | `.cm-cell strong` |
| 23px | Big metric values | `.metric-value` |
| 27px | Page `h1` | `.page-head h1` |
| 30px | Prediction verdict | `.result-verdict` |

### 2.4 Weights

- **400** — body text default.
- **500** — the workhorse "emphasis" weight: buttons, field labels, panel titles, nav active label, table `.strong`, group-cell names, pager labels, big metric values, cm-cell values, table headers.
- **600** — reserved for real headings: `h1`, `.panel-title`, `.alert strong`, `.brand-line-1`, `.result-verdict`, `.bench-banner-name`, heatmap `.heat-strong`, registry `h2`.
- Nothing uses 700+.

### 2.5 Letter-spacing

- Tight (headings/display): `-0.02em` on `.page-head h1`, `.metric-value`, `.result-verdict`; `-0.01em` on `.brand-line-1`, `.panel-title`, `.pipeline-label`, `.group-cell-name`, `.pager-label`, `.registry-group-head h2`, `.chart-card-head h3`, `.bench-banner-name`; `-0.005em` on `.btn`, `.step-label`.
- Wide (mono uppercase microcopy): `+0.11em` (`.section-title`, `.page-kicker`, `.nav-caption`), `+0.1em` (`legend`, `.result-kicker`, `.bench-banner-kicker`), `+0.09em` (`.table th`, `.brand-line-2`, `.pager-dir`), `+0.08em` (`.pipeline-status`), `+0.07em` (`.badge`, `.step-soon`, `.cm-axis`), `+0.06em` (`.role-tag`), `+0.02em` (`.brand-mark`, `.page-meta`, `.footer-row`).

### 2.6 Signature pattern — the "mono kicker"

Nearly every section opens with an 10–11px IBM Plex Mono, uppercase,
0.09–0.11em letter-spaced label in `--text-3` (page kicker) or `--text-2`
(section title). This, plus the tight-tracked Inter semibold headings, is the
single most recognizable typographic move of the design.

### 2.7 Line-heights

Only three explicit values: `1.55` body, `1.25` (`.brand-text`), `1.2` (`h1`), `1.1` (`.result-verdict`).

---

## 3. Spacing & layout

### 3.1 App shell

- `.app-shell`: `display: flex; min-height: 100vh` — sidebar + `.app-body` column.
- `.app-body main`: `max-width: 940px; margin: 0 auto; padding: 0 40px` (`style.css:119-125`). **940px content column, 40px page gutters** — deliberately narrow; data-dense but never wide.
- `.pipeline-sidebar`: `width: 264px`, sticky full-height (`position: sticky; top: 0; height: 100vh`), `border-right: 1px solid var(--border)`.

### 3.2 Section rhythm

- `--space-section: 40px`; `.section { padding: 40px 0 }`.
- Sections are separated by `.divider` — a full-width `1px` hairline (`background: var(--border)`), never by whitespace alone.
- `.page-head { padding: 44px 0 36px }`; `.section-head { margin-bottom: 20px }` (flex, space-between, baseline-aligned); `.section-sub` pulls up `-10px` and hangs `24px` below.
- Home hero `.home-head`: `grid-template-columns: 1.25fr 0.75fr; gap: 56px; padding: 48px 0 40px`.

### 3.3 Grids (all explicit)

| Pattern | Columns | Gap |
|---|---|---|
| `.metrics` | `repeat(4, 1fr)` | hairline dividers between cells (`.metric + .metric { border-left: 1px solid var(--border); padding-left: 24px }`), `.metrics-rows` adds `row-gap: 24px` |
| `.metrics-auto` | `repeat(auto-fit, minmax(120px, 1fr))` | same divider logic |
| `.chart-grid` | `repeat(2, 1fr)` | `16px`; `.chart-card-wide { grid-column: 1 / -1 }` spans full width |
| `.group-index` | `repeat(3, 1fr)` | no gap — cells divided by hairlines (container has top+left border, each cell right+bottom) |
| `.predict-grid` | `1.25fr 0.75fr` | `36px` |
| `.predict-fields` | `repeat(2, 1fr)` | `14px 16px` (row col) |
| `.eval-duo` | `1fr 1fr` | `24px` |
| `.driver-row` | `180px 1fr 52px` | `18px` |
| `.vs-row` | `168px 1fr 72px` | `18px` |
| `.heat-grid` | `132px repeat(var(--n), minmax(30px, 1fr))` | `2px`; `min-width: 840px` (horizontal scroll) |
| `.cm-grid` | `120px 1fr 1fr` | `1px` gap over a `var(--border)` background — hairlines *are* the grid gap |

### 3.4 Card/panel padding

- `.panel-head`: `13px 16px`; `.panel-body`: `14px 16px`.
- `.chart-card`: `14px 16px 12px`.
- `.result-panel`: `26px 24px` (roomier — it's the hero of the predict page).
- `.alert` / `.bench-banner`: `16px 18px`.
- `.predict-fieldset`: `18px 18px 14px`.
- `.group-cell`: `18px 20px`.
- Table cells: `9px 14px`.

### 3.5 Border-radius scale

| Token | Value | Used on |
|---|---|---|
| `--radius-sm` | 4px | badges, role tags, code chips, chart-select, focus outline |
| `--radius` | 6px | buttons, inputs, nav items, brand mark, skip link |
| `--radius-lg` | 8px | panels, chart cards, alerts, fieldsets, table containers, banners |
| (literal) 3px | bar tracks/fills, legend bars, std-badge | `.outcome-track`, `.driver-*`, `.result-track`, `.heat-legend-bar` |
| (literal) 2px | swatches, coverage track, vs bars | `.outcome-swatch`, `.vs-swatch`, `.vs-bar`, `.coverage-*` |
| (literal) 1.5px | heatmap cells, chart bar `borderRadius` | `.heat-cell`, histogram bars |

Corners are **small and crisp** — nothing exceeds 8px. No pill shapes except
`border-radius: 50%` on the spinner and the mean-dot legend swatch.

### 3.6 Shadow scale

**There are no elevation shadows anywhere.** The only `box-shadow` in the whole
file is the active-nav indicator: `box-shadow: inset 2px 0 0 var(--accent)`
(`.pipeline-stepper li.is-active a`), which becomes `inset 0 -2px 0` on mobile.
Depth is communicated exclusively through the three-level surface stack
(`--bg` → `--surface` → `--raised`) plus hairlines.

---

## 4. Navigation pattern

### 4.1 Primary nav = left sidebar stepper (not a top navbar)

Structure (`base.html:19-46`):

```
aside.pipeline-sidebar
├── a.sidebar-brand          (PP mark + two-line wordmark)
├── p.nav-caption            "PIPELINE"
├── nav.pipeline-stepper > ol > li > a
│     ├── span.step-num      01–09
│     ├── span.step-label    stage name
│     └── span.step-soon     "Soon" (unreleased stages)
└── div.sidebar-footer       ← Overview link + active dataset filename
```

Styling:
- Sidebar: `264px` wide, `--bg` background (same as page — separated only by the right hairline), sticky, own scroll (`overflow-y: auto`), thin custom scrollbar.
- Brand (`.sidebar-brand`): `padding: 20px 20px 18px`, bottom hairline. Mark is a `28×28px` amber square, radius 6, containing "PP" in mono 11px/600 `--accent-ink`. Wordmark line 1: Inter 13.5px/600, `-0.01em`; line 2: mono 9.5px uppercase `0.09em` `--text-3` ("ML PIPELINE").
- Caption (`.nav-caption`): mono 10px, uppercase, `0.11em`, `--text-3`, `padding: 18px 20px 8px`.
- Items (`.pipeline-stepper a`): flex row, `gap: 10px`, `padding: 7px 10px`, radius 6, `--text-2`, `transition: background 0.12s, color 0.12s`. Step number: mono 10.5px `--text-3`, fixed `width: 18px`, tabular-nums. Label: 13px Inter, `-0.005em`.
- **Hover**: `background: var(--surface); color: var(--text)`.
- **Active** (`li.is-active a`): `background: var(--surface); color: var(--text); box-shadow: inset 2px 0 0 var(--accent)` — a 2px amber bar inset at the left edge; `.step-num` turns amber; label goes to weight 500. Marked with `aria-current="page"`.
- Sidebar footer: top hairline, mono 10.5px `--text-3`; "← Overview" link (`--text-2`, hover amber) + active dataset filename.

### 4.2 Mobile collapse (≤900px, `style.css:1313-1340`)

Sidebar becomes a full-width **horizontal top bar**: `.app-shell` goes
`flex-direction: column`; sidebar `width: 100%; height: auto; position: relative`.
The stepper `<ol>` becomes a horizontal scrollable row (`display: flex; gap: 2px; overflow-x: auto`),
each item stacks number over label (`flex-direction: column`), the active
indicator flips to a **bottom** inset bar (`inset 0 -2px 0 var(--accent)`),
`.step-soon` and `.sidebar-footer` are hidden. No hamburger menu — the nav
itself scrolls horizontally.

### 4.3 Secondary nav patterns

- **`.viz-nav`** — sticky in-page anchor nav on the visualize page: `position: sticky; top: 0; z-index: 20; background: var(--bg); border-bottom: 1px solid var(--border)`; links 12px/500 `--text-3`, `padding: 9px 2px`, `gap: 22px`, hover amber. Sections use `scroll-margin-top: 48px` so anchors land below it.
- **`.stage-pager`** — prev/next footer pager: flex space-between over a top hairline, `padding: 24px 0 64px`. Each link = mono 10px uppercase direction label ("PREV"/"NEXT", `.pager-dir`) over a 14px/500 title (`--text-2`, hover amber). Next is right-aligned via `margin-left: auto`.
- **`.section-link`** — mono 11px `--text-3` "Full analysis →" links in section headers, hover amber.

---

## 5. Component styling catalog

### 5.1 Buttons (`.btn`, style.css:337-377)

Base: `inline-flex; align-items: center; gap: 8px; font: 13px/500 Inter; letter-spacing: -0.005em; padding: 10px 16px; border-radius: 6px; border: 1px solid transparent; transition: background/border-color/color 0.12s ease`.

| Variant | Rest | Hover | Disabled |
|---|---|---|---|
| `.btn-primary` | bg `--accent`, text `--accent-ink` | bg `--accent-hover` | `opacity: 0.6`, hover keeps `--accent` (`.btn-primary[disabled]:hover`) |
| `.btn-secondary` | transparent bg, `1px solid --border-strong`, text `--text` | bg `--surface`, border `--text-3` | `opacity: 0.6` |
| `.link-quiet` | no bg/border/padding, mono 11px `--text-3`, underlined (`text-underline-offset: 3px`) | color `--danger` (destructive actions, e.g. "clear dataset") | — |

- Busy state: JS adds a `.spinner` child — `12×12px` circle, `2px` border `rgba(22,19,10,0.35)` with `border-top-color: --accent-ink`, `animation: spin 0.7s linear infinite` — and sets `disabled`.
- One size only; `.upload-submit { align-self: flex-start }` for form alignment.

### 5.2 Badges / pills (`.badge`, style.css:381-396)

`.badge`: mono 9.5px, uppercase, `0.07em`, `padding: 3px 7px`, radius 4, `1px solid --border-strong`, `--text-2`, `white-space: nowrap`.
`.badge-accent`: transparent border, bg `--accent-dim`, text `--accent`.
Related tags: `.role-tag` (9.5px mono, `--border` hairline; `.role-target` = amber text + 40% amber border), `.std-badge` (9px amber, 40% amber border, radius 3, `padding: 1px 5px`), `.chart-tag` (mono 10px `--text-3`, no box).

### 5.3 Cards / panels (`.panel`, style.css:400-416)

`.panel`: `1px solid --border`, radius 8, bg `--surface`.
`.panel-head`: flex space-between, `padding: 13px 16px`, bottom hairline; `.panel-title` 13px/600 `-0.01em`; typically carries a `.badge` at right.
`.panel-body`: `padding: 14px 16px`.
Chart cards (`.chart-card`) are the same recipe with hover: `border-color: --border-strong` (0.12s) — the only card hover in the system.
Dataset facts inside panels: `.dataset-fact` rows = flex space-between over top hairlines, `padding: 6px 0`, `dt` `--text-3` 12.5px, `dd` mono 12px tabular.

### 5.4 Metric cards / stat rows (`.metrics`, style.css:443-464)

Not boxed cards — an open 4-column grid where **hairline dividers separate
stats**: `.metric + .metric { border-left: 1px solid var(--border); padding-left: 24px }`.
`.metric-value`: mono 23px/500, `-0.02em`, tabular-nums, `--text`.
`.metric-label`: 12px `--text-3`, `3px` gap below value.
`.metrics-auto` variant: `auto-fit, minmax(120px, 1fr)` for 5 evaluation cards.

### 5.5 Tables (`.table`, style.css:606-650)

- Wrapped in `.table-scroll` (`overflow: auto`, 1px `--border`, radius 8) with **styled thin scrollbars** (8px thumb `--border-strong` on transparent, both `-webkit-` and `scrollbar-width: thin`).
- `.table`: `border-collapse: collapse`, 13px. Cells `padding: 9px 14px`, `white-space: nowrap`, bottom hairlines; last row's border removed.
- Header: mono **10px uppercase 0.09em**, weight 500, `--text-3` on `--surface` — the classic data-table look.
- **No zebra striping.** Row hover only: `tbody tr:hover td { background: var(--surface) }` (0.1s).
- Cell modifiers: `.num` (mono 12px tabular), `.dim` (`--text-3`), `.strong` (`--text`, 500), `.accent` (amber).
- Sticky variants: `.table-sticky thead th { position: sticky; top: 0; z-index: 3 }`; `.sticky-col { position: sticky; left: 0; background: var(--bg) }` (header corner z-index 4, `--surface`); hovered rows flip the sticky cell to `--surface`.
- `.champion-row td { background: rgba(217,166,63,0.05) }` — 5% amber tint marks the winning model (see evaluate screenshot).

### 5.6 Forms (style.css:1134-1193, 1371-1395)

- `.field`: flex column, `gap: 5px`. `.field-label`: 12.5px/500 `--text`.
- `.field-input`: **mono 13px** (numbers feel like data), bg `--bg` (input sits *darker* than the page's panels), `1px solid --border-strong`, radius 6, `padding: 9px 11px`, tabular-nums, `transition: border-color 0.12s`.
  - Hover: `border-color: --text-3`.
  - Focus: `border-color: --accent; outline: none`; `:focus-visible` adds `2px solid --accent; outline-offset: 1px`.
  - Invalid (`:user-invalid` or server-set `.input-error`): `border-color: --danger; background: --danger-dim`; focus keeps danger outline; paired `.field-hint-error` turns danger.
- `.field-hint`: mono **9.5px** `--text-3` — range/placeholder guidance under every input.
- Fieldset grouping (`.predict-fieldset`): 1px `--border`, radius 8, `padding: 18px 18px 14px`; `legend` = mono 10px uppercase `0.1em` `--text-3` with `padding: 0 8px` — section labels ride the border.
- Selects (`.select`): `appearance: none`, custom SVG chevron (10×6, stroke `#9BA29A`, 1.5 width) at `right 12px center`, `padding-right: 34px`; `:disabled { opacity: 0.55 }`. Compact variant `.chart-select` (mono 11px, radius 4, `padding: 4px 24px 4px 8px`, 8×5 chevron at `right 8px`) lives in chart-card headers.
- Checkbox (`.check` / `.check-input`): 15×15px, `accent-color: var(--accent)`; label 13px `--text-2`, hover `--text`.

### 5.7 Alerts / flash messages (`.alert`, style.css:767-786)

`.alert`: `1px solid --border-strong`, radius 8, bg `--surface`, `padding: 16px 18px`, 13.5px `--text-2`, `max-width: 640px`. Title is a block-level `<strong>` (13.5px/600 `--text`, 4px bottom margin). Links inside: amber, underlined.
`.alert-error`: border `rgba(198,93,85,0.45)`, bg `--danger-dim`, `<strong>` in `--danger`, `role="alert"`.
`.alert-actions { margin-top: 12px }`.
Notice variant: `.bench-banner` — 40% amber border, 6% amber bg, contains kicker + 20px/600 amber name + mono 11px sub.

### 5.8 Progress / data bars

All bars follow one recipe: `--raised` track, amber (or semantic) fill, tiny radius.

| Component | Track | Fill | Radius |
|---|---|---|---|
| `.outcome-track` (split bar) | `height: 10px`, flex; placed = `--accent`, remainder `#3A403B` | segment widths from data | 3px, `overflow: hidden` |
| `.driver-track` / `.driver-fill` | 6px `--raised` | `--accent`, `width: var(--w)` (inline CSS var) | 3px |
| `.result-track` / `.result-fill` | 8px `--raised` | `--accent` (`--danger` when `.result-not`); **`transition: width 0.5s cubic-bezier(0.2,0.7,0.2,1)`** | 3px |
| `.coverage-track` / `.coverage-fill` | 72px × 4px `--raised` | `--success`; `.coverage-low` → `--danger` | 2px |
| `.vs-bar` | — (inline width) | 7px, `--danger` (`.vs-bar-not`) / `--accent` (`.vs-bar-placed`), `min-width: 2px` | 2px |

Each is paired with mono tabular values: `.driver-value` (12px right-aligned), `.coverage-pct` (11px), `.vs-val` (10.5px), `.vs-delta` (11.5px `--success`, `.vs-delta-neg` `--danger`).

### 5.9 Tabs

No tab component exists — the visualize page uses the `.viz-nav` anchor bar (§4.3) instead. If PropPulse needs tabs, match `.viz-nav`: text-only 12px/500 links, amber hover, hairline under the bar.

### 5.10 Pagination

No numbered pagination — linear prev/next `.stage-pager` (§4.3) plus sidebar stepper.

### 5.11 Tooltips

- Native `title=` attributes on heatmap cells (`index.html:160`).
- Chart.js tooltip skin (charts.js:59-68): bg `#1B1F1C`, `1px solid #363D37`, title `#EBECE8`, body `#9BA29A`, `padding: 10`, `cornerRadius: 6`, `displayColors: false` (except benchmark chart). Matches panel styling exactly.

### 5.12 Chart containers

`.chart-grid` (2-col, 16px gap) of `.chart-card`s; `.chart-card-wide` spans both columns. `.chart-card-head`: flex space-between baseline, 10px bottom margin; `h3` 13px/600; right side holds `.chart-tag` (mono 10px `--text-3`) or a `.chart-select`. `.chart-wrap { position: relative; height: 200px }`; `.chart-wrap-tall { height: 320px }`; utility `.h-340` for 340px.

### 5.13 Section headers

`.section-head`: flex, space-between, **baseline** aligned, `gap: 16px`, `margin-bottom: 20px`. Left: `.section-title` (mono kicker). Right: `.section-link` or mono meta text (`.mono.dim.mono-sm`, e.g. "1,750 anomalous records flagged · 1 corrupt record removed").

### 5.14 Domain-specific components worth copying

- **Result panel** (`.result-panel`): surface card, `padding: 26px 24px`, `gap: 14px`; outcome-colored border (`rgba(accent|danger, 0.5)`); kicker row (mono 10px uppercase + optional badge); **verdict 30px/600 `-0.02em`** colored by outcome; probability bar; meta row (mono, space-between); `.result-facts` dl of hairline rows (7px vertical padding, mono 12px right-aligned values). Idle state: `--text-3` "—".
- **Confusion matrix** (`.cm-grid`): CSS grid with `gap: 1px` over a `--border` background — the gap renders as hairlines. Cells `--surface`, `padding: 20px 16px`; value mono 22px/500; TP/TN amber text on 5% amber bg, FP/FN danger text on `--danger-dim`; axis labels mono 9.5px uppercase.
- **Correlation heatmap** (`.heat-grid`): square cells (`aspect-ratio: 1`), 2px gap, mono 9px values, radius 1.5px, colors computed server-side on a `--raised → --accent` scale; strong cells (`.heat-strong`) flip to `--accent-ink` text at 600. Hover: `outline: 1.5px solid --accent`. Column labels rotated `rotate(-52deg) translate(-4px, 2px)`, mono 9px. Legend: 200×6px bar, the system's **only gradient** — `linear-gradient(90deg, var(--raised), var(--accent))`.
- **Box plots** (server-rendered SVG, `.bp-*`): axis `--border-strong` 1px; ticks mono 8.5px `--text-3`; whiskers `--text-3`; box fill 14% alpha of danger/amber with full-color 1.5px stroke; median line `--text` 2px; mean = filled `--text` dot; foot row (`.bp-foot`) mono 10px over a top hairline ("med 5.74 → 8.02 · 703 outliers").
- **Pipeline list** (`.pipeline-row`): full-width rows, `padding: 13px 4px`, bottom hairlines, hover bg `--surface`; mono 11px index (width 20), 13.5px/500 label + 12.5px `--text-3` note, status (`.status-live` amber / `.status-soon` `--text-3`, mono 10px uppercase), chevron "→" that turns amber on row hover.
- **Group index** (`.group-cell`): 3-col hairline grid of nav cells, `padding: 18px 20px`, hover bg `--surface` and arrow turns amber.
- **Insight list** (`.insight-list li`): hairline rows, 13px `--text-2`, each prefixed by an amber mono "›" (`::before`).
- **Upload dropzone** (`.upload-drop`): `1.5px dashed --border-strong`, radius 8, `padding: 28px 24px`, left-aligned column; hover / `.is-dragover` / `:focus-within` → amber border + `--surface` bg (0.12s). File input visually hidden via clip. Filename shown in mono 12px amber.
- **Skip link**: absolute, `top: -48px → 12px` on focus (0.15s), `--raised` chip with `--border-strong` border.
- **Inline code** (`.note code`): mono 11px, `--surface` bg, 1px `--border`, `padding: 1px 5px`, radius 4.

---

## 6. Chart styling

Library: **Chart.js 4.4.3** (UMD, CDN). All canvas charts share global defaults
(`charts.js:52-57`):

- Font: `'IBM Plex Mono', ui-monospace, monospace`, size **10**, color `#8A9189`.
- `Chart.defaults.borderColor = rgba(235,236,232,0.06)` — gridlines are text-color at 6%.
- Animation: **450ms, `easeOutQuart`**; 0ms under `prefers-reduced-motion`.
- Scales (`baseScales`): **x-axis grid hidden, y-axis grid shown** (6% white), both axis borders hidden; x ticks `maxTicksLimit: 7, maxRotation: 0`, y `maxTicksLimit: 6`.
- Render waits for `document.fonts.ready` so mono axis labels measure correctly.

Per-chart recipes:

| Chart | Style |
|---|---|
| Histogram | bars `accentFill` + 1px `--accent` stroke, `borderRadius: 1.5`, `barPercentage: 1.0, categoryPercentage: 0.92`; overlaid KDE-style line `--text` 1.5px, `tension: 0.45`, no points. Standardized variant uses slate fill/stroke |
| Donut (placement split) | slices `[--accent, #3A403B]`, 2px `--raised`-colored separators, `cutout: "62%"`, legend bottom with 9×9 rounded-rect point swatches |
| Rate-by-feature bars | `accentFill` + amber stroke, radius 2, `maxBarThickness: 34`; y forced 0–100 with `%` tick suffix |
| Horizontal influence bars | `indexAxis: "y"`, `maxBarThickness: 18`, radius 2; x grid on, y grid off |
| Missing-value bars | `dangerFill` + danger stroke, radius 3, `maxBarThickness: 48` |
| Grouped (gender split) | danger + amber fills, radius 3, `maxBarThickness: 40`; legend 9×9 `rectRounded` points |
| ROC curves | one line per model in fixed model colors (§1.4), `borderWidth: 1.8`, `tension: 0.1`, no points; "chance" diagonal = `--text-3` 1px dashed `[5,5]`; linear 0–1 axes with mono titles |
| Calibration | same as ROC + `pointRadius: 2.5` markers; dashed "perfectly calibrated" diagonal |
| Benchmark grouped bars | model fills/strokes, radius 2, `maxBarThickness: 26`; y 0–1 |
| Heatmap | pure CSS grid (§5.14) — not Chart.js |
| Box plots | server-rendered SVG with `.bp-*` classes (§5.14) — not Chart.js |

Sizing: default wrap 200px tall, tall variant 320px, `maintainAspectRatio: false` everywhere.

---

## 7. Motion

| Trigger | Property | Duration / easing | Selector |
|---|---|---|---|
| Universal hover (nav items, buttons, rows, cards, selects, links, cells) | `background`, `border-color`, `color` | **0.12s ease** | `.btn`, `.pipeline-stepper a`, `.pipeline-row`, `.group-cell`, `.chart-card`, `.field-input`, `.upload-drop`, `.pager-label`, `.viz-nav a`, … |
| Table row hover | `background` | 0.1s ease | `.table tbody tr` |
| Skip link reveal | `top` | 0.15s ease | `.skip-link` |
| Prediction probability bar | `width` | **0.5s `cubic-bezier(0.2, 0.7, 0.2, 1)`** (ease-out with slight overshoot feel) | `.result-fill` |
| Busy spinner | `transform: rotate(360deg)` | 0.7s linear infinite | `.spinner` / `@keyframes spin` |
| Chart.js animations | all | 450ms `easeOutQuart` | `Chart.defaults.animation` |
| Page anchor scrolling | — | `scroll-behavior: smooth` | `html` |

Global `prefers-reduced-motion: reduce` handling: all animations/transitions
compressed to 0.01ms, smooth scroll disabled, spinner stops, chart duration 0
(`style.css:100-103`, `:1475`, `charts.js:50,56`).

The motion signature: **fast and functional** — 120ms color fades everywhere,
one celebratory 500ms ease-out on the result bar, nothing bouncy, nothing
decorative.

---

## 8. Responsive system

Four breakpoints, all `max-width`:

| Breakpoint | What changes |
|---|---|
| **980px** | `.registry-optional` table columns hidden (only rule). |
| **900px** | Layout break. `.app-shell` → column; sidebar → full-width horizontal top bar (see §4.2); stepper becomes horizontal scroll with bottom-edge active indicator; `.step-soon`, `.sidebar-footer` hidden; `main` → `max-width: 100%; padding: 0 24px`; footer padding `28px 24px 36px`; `.home-head` → 1 column, `gap: 28px`, `padding-top: 36px`. |
| **820px** | Content densification. `h1` 27→**23px**; `.metrics` → 2 cols with `row-gap: 20px` and even-child left hairlines; `.group-index`, `.chart-grid`, `.eval-duo`, `.predict-grid`, `.predict-fields` → 1 column; `.predict-result` unsticks (`position: static`); `.cm-grid` label col 120→96px; `.driver-row` → `128px 1fr 46px` gap 12; `.vs-row` → `118px 1fr 60px` gap 12; `.pipeline-note` hidden; footer + stage pager stack vertically; `.model-pick-field` full width; `.metrics-auto` → 2 cols; `.bench-controls` gap 18→12. |
| **520px** | `main` padding `0 18px`; `.metrics` stays 2 cols (`1fr 1fr`); `.outcome-legend` stacks. |

Strategy: desktop-first, single sidebar→topbar transformation at 900px, then
progressive single-column stacking. Tables never reflow — they scroll
horizontally inside `.table-scroll` at every width.

---

## 9. Screenshot observations

### home.png (1500×950, Overview page)
- Extreme restraint: the whole viewport contains exactly **two fills** (page bg, panel bg) and **one saturated color** (amber). Everything else is hairlines and type.
- The sidebar has no background separation at all — only the 1px right border — yet reads as a distinct column because of alignment discipline (20px padding everywhere, numbers in a fixed 18px column).
- Metrics row ("50,000 / 7.25 / 76.7% / 65.7%") uses large mono numbers + small muted labels with vertical hairlines between — reads like a Bloomberg terminal strip, zero card chrome.
- The amber/dark split bar + legend is the only "chart" above the fold; data density is high but every number is tabular mono and right-aligned or left-aligned consistently, so it scans cleanly.
- "Active dataset" panel: definition-list facts with hairline row separators; values in mono right-aligned — a pattern repeated in the result panel and footer.
- Section headers pair a tiny mono uppercase label ("DATASET SNAPSHOT") with right-aligned mono meta text — hierarchy comes from size/weight contrast, not color.

### predict.png (Predict Placement)
- Two-column `1.25fr / 0.75fr` split puts the entire form on the left and a **sticky** result card on the right — the answer stays visible while scrolling inputs.
- Form is grouped into fieldsets whose mono uppercase legends ("ACADEMIC", "EXPERIENCE") sit on the border — classic fieldset styling made to look deliberate and technical.
- Every input is mono with a 9.5px mono hint ("4.0–10.0 · median 7.25") — the hints carry real statistical guidance, making the form feel like an instrument panel.
- Result panel earns the only colored border on the site (50% amber) plus the 30px amber "Placed" verdict — maximum contrast reserved for the single most important output.
- The probability bar animates (0.5s) and the meta row ("99.5% probability / threshold 50%") brackets it in mono — the page's one moment of celebration.
- Active sidebar item shows the 2px amber inset bar + amber step number — visible at a glance without any background change beyond `--surface`.

### evaluate.png (Model Evaluation)
- Comparison table: mono uppercase 10px headers, tabular mono metrics, and the champion row washed in 5% amber with a small amber-outline "CHAMPION" badge — the winner is findable in under a second with no bold, no icons.
- Numbers align perfectly down columns thanks to `tabular-nums` + mono — the table reads like a ledger.
- ROC chart: hairline gridlines (6% white), no axis borders, 1.8px lines, dashed grey "chance" diagonal; legend labels carry the AUC inline ("Gradient Boosting · 0.9733") in mono 10px — chart chrome is nearly invisible, data is everything.
- Section title style "THE VERDICT — SEALED TEST SET, THRESHOLD 0.5" shows the mono kicker carrying real content (threshold, dataset), not just decoration.
- Page meta line under the description ("Dataset · placement_predict_50k.csv (bundled default) · assessed once on 10,000 sealed rows") uses mono with `·` separators — a recurring provenance-by-line pattern.

### visualize.png (Data Visualization)
- Sticky anchor nav ("Distributions / Standardized / Correlations / Status splits / Categories") in plain 12px text links — no pills, no underline animation; stickiness + hairline is enough.
- Horizontal bar chart: amber 55%-fill bars with 1px solid amber edges, mono category labels right-aligned against the axis — bars never exceed `maxBarThickness: 18`, keeping the chart airy.
- Box plots are **outlined, not filled**: 14%-alpha fill + 1.5px colored stroke (red = not placed, amber = placed), white 2px median line, white mean dot — the hollow treatment keeps 6+ plots on a dark page from getting heavy.
- Each box plot has a mono foot row ("med 5.74 → 8.02 · 703 outliers") separated by a hairline — statistics as captions.
- Legend swatches are 8×8px rounded squares (+ a circle for mean) with 7px gaps — miniature but precisely aligned with their 12px labels.

### demo.gif (10-frame screencast, 1000×593)
- Confirms the same pages in motion; frame 5 shows the full 21×21 correlation heatmap — amber intensity scale from `--raised` to `--accent`, diagonal cells flip to dark-ink text (`.heat-strong`), mono 9px values centered in square cells with 2px gutters.
- Heatmap column labels rotated −52° along the top keep 21 columns legible in 840px.
- Even at GIF scale the two-font system is obvious: every number on screen is Plex Mono, every word is Inter.

---

## 10. Design tokens table

Direct translation target — drop into `:root` as CSS custom properties (these
are the reference project's own tokens, plus the one-off values lifted to
tokens for the React rebuild):

```css
:root {
  /* surfaces */
  --bg:             #0F1110;
  --surface:        #151816;
  --raised:         #1B1F1C;

  /* borders */
  --border:         #252A26;
  --border-strong:  #363D37;

  /* text */
  --text:           #EBECE8;
  --text-2:         #9BA29A;
  --text-3:         #8A9189;

  /* accent (amber) */
  --accent:         #D9A63F;
  --accent-hover:   #C29434;
  --accent-ink:     #16130A;              /* text on amber */
  --accent-dim:     rgba(217,166,63,0.14);
  --accent-border:  rgba(217,166,63,0.4); /* amber hairline */
  --accent-wash:    rgba(217,166,63,0.05);/* champion rows, TP/TN cells */
  --accent-fill:    rgba(217,166,63,0.55);/* chart bar fill */

  /* semantic */
  --success:        #63A87D;
  --danger:         #C65D55;
  --danger-dim:     rgba(198,93,85,0.1);
  --danger-border:  rgba(198,93,85,0.45);
  --danger-fill:    rgba(198,93,85,0.55);
  --slate:          #6E8FA0;              /* info / 2nd series */
  --slate-fill:     rgba(110,143,160,0.45);
  --neutral-fill:   rgba(138,145,137,0.4);
  --neutral-bar:    #3A403B;              /* "not placed" bar/donut segment */
  --grid-line:      rgba(235,236,232,0.06);

  /* radii */
  --radius-sm:      4px;
  --radius:         6px;
  --radius-lg:      8px;
  --radius-bar:     3px;

  /* type */
  --font-sans:      "Inter", -apple-system, "Segoe UI", sans-serif;
  --font-mono:      "IBM Plex Mono", ui-monospace, "SF Mono", monospace;
  --fs-body:        14px;
  --lh-body:        1.55;
  --tracking-tight: -0.02em;   /* display headings, big numbers */
  --tracking-head:  -0.01em;   /* card/panel titles */
  --tracking-ui:    -0.005em;  /* buttons, nav labels */
  --tracking-mono:  0.09em;    /* uppercase microcopy (range 0.06–0.11em) */

  /* layout */
  --content-max:    940px;
  --page-gutter:    40px;      /* 24px ≤900px, 18px ≤520px */
  --sidebar-w:      264px;
  --space-section:  40px;
  --card-pad-x:     16px;
  --card-pad-y:     14px;

  /* motion */
  --ease-standard:  0.12s ease;            /* all hovers */
  --ease-emphasis:  0.5s cubic-bezier(0.2,0.7,0.2,1);
  --chart-anim:     450ms;                 /* easeOutQuart */

  /* breakpoints (max-width): 980px · 900px · 820px · 520px */
}
```

### Font-size scale (name → px → use)

| Token | px | Use |
|---|---|---|
| `fs-micro` | 9–9.5 | heatmap cells, badges, hints |
| `fs-kicker` | 10–10.5 | section titles, table headers, mono meta |
| `fs-meta` | 11–11.5 | section links, pager dirs, footer |
| `fs-label` | 12–12.5 | metric labels, field labels, fact rows, notes |
| `fs-ui` | 13–13.5 | buttons, body lists, panel titles, alerts |
| `fs-body` | 14–14.5 | body text, page description |
| `fs-h2` | 15 | group headings |
| `fs-stat` | 22–23 | metric values, cm-cell values |
| `fs-h1` | 27 (23 ≤820px) | page titles |
| `fs-verdict` | 30 | hero result |

### Rebuild invariants (the things that make it look like itself)

1. Dark-only, olive-tinted neutrals; **one** amber accent; red reserved for errors/"not placed"; green barely used.
2. Hairlines, not shadows: 1px `--border` dividers/cards; zero elevation shadows; the only shadow is the active-nav inset bar.
3. Two fonts strictly assigned: Inter for words, Plex Mono (with `tabular-nums`) for numbers, labels, and microcopy; uppercase mono kickers everywhere.
4. Radii ≤ 8px; bars ≤ 3px radius; no pills.
5. Fast 0.12s hover fades; motion is functional, never decorative.
6. Narrow 940px content column; dense data, generous section air (40px rhythm + hairline dividers).
7. Sidebar stepper nav with numbered stages; on mobile it becomes a horizontal scroll strip — never a hamburger.
