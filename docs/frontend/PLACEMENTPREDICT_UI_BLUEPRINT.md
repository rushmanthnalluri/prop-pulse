# PlacementPredict — UI Blueprint (Reference Source of Truth)

Reverse-engineered from `C:\Machine_Learning\Placement-predict\flask_project\`
(Flask + Jinja, server-rendered; one stylesheet `static/css/style.css`, ~1560 lines;
`static/js/script.js` + `static/js/charts.js`; 13 templates).

Design intent (quoted from the CSS header):
> "Dark, neutral, product-grade. Inter for UI, Plex Mono for data. One flat amber
> accent. Hairlines over boxes. No gradients, no glow."

PropPulse must reproduce this design language with PropTech content. This document
is the authoritative reference for that reconstruction.

---

## 1. Application shape

- **Server-rendered multi-page app.** Every stage is its own route and template; full page loads between stages (no SPA). Chart.js 4.4.3 loaded per-page from CDN; everything else is hand-written CSS/JS.
- **No top header bar.** Brand, navigation and dataset context live in a **left sidebar**; content sits in a centered column.
- **Dark-only theme** (`color-scheme: dark`). Depth is expressed by 3-step background elevation + hairline borders. **Zero box-shadows** (except the active-nav inset indicator). **No icon library** — iconography is typographic (`→`, `←`, `›`, `·`, `↓`) plus one brand mark.
- **Progressive enhancement**: all primary flows (upload, train-inspect, predict) work without JS; JS adds busy buttons, drag-drop, benchmark re-runs. `.needs-js` gates JS-only controls; `<noscript>` notes.

## 2. Design tokens (`:root` in style.css)

### Colors

| Token | Value | Usage |
|---|---|---|
| `--bg` | `#0F1110` | page + sidebar background, input background |
| `--surface` | `#151816` | panels, cards, table header, hover fills |
| `--raised` | `#1B1F1C` | progress tracks, heatmap base, tooltip bg |
| `--border` | `#252A26` | hairlines everywhere |
| `--border-strong` | `#363D37` | input borders, secondary-btn border, scrollbar thumb |
| `--text` | `#EBECE8` | primary text |
| `--text-2` | `#9BA29A` | secondary text |
| `--text-3` | `#8A9189` | muted/labels/captions |
| `--accent` | `#D9A63F` | flat amber — the single accent |
| `--accent-hover` | `#C29434` | primary-button hover |
| `--accent-ink` | `#16130A` | text on amber |
| `--accent-dim` | `rgba(217,166,63,0.14)` | accent-tinted fills (badge-accent) |
| `--success` | `#63A87D` | only coverage bars + positive deltas |
| `--danger` | `#C65D55` | missing values / negative class / errors |
| `--danger-dim` | `rgba(198,93,85,0.1)` | error alert bg, invalid input bg |
| `--slate` | `#6E8FA0` | chart-only (second series / random-forest model color) |

One-offs: `#3A403B` (negative segment in donut/outcome bars), `rgba(217,166,63,0.24)` (text selection), `rgba(217,166,63,0.4)` (badge/banner borders), `rgba(217,166,63,0.05)` (champion row, tp/tn cells), `rgba(217,166,63,0.06)` (bench-banner bg), `rgba(198,93,85,0.45)` (alert-error border).

**Gradients: exactly one** — the heatmap legend bar (`linear-gradient(90deg, --raised, --accent)`). Never on data surfaces.

### Typography

Google Fonts (preconnect + `display=swap`): **Inter 400/500/600** (UI), **IBM Plex Mono 400/500/600** (data/microcopy).
Body: 14px / line-height 1.55 / antialiased.

| Element | Font | Size | Weight | Letter-spacing |
|---|---|---|---|---|
| Page title (`h1`) | sans | 27px | 600 | -0.02em |
| Page kicker (eyebrow) | mono | 11px | 400 | 0.11em, uppercase, text-3 |
| Page description | sans | 14.5px | 400 | text-2, max-width 600px |
| Section title | mono | 11px | 400 | 0.11em, uppercase, text-2 |
| Sub-section title (`h2`) | sans | 15px | 600 | -0.01em |
| Card/panel title | sans | 13px | 600 | -0.01em |
| Section sub (explanatory) | sans | 13.5px | 400 | text-2, max-width 580px |
| Metric value | mono | 23px | 500 | -0.02em, tabular-nums |
| Metric label | sans | 12px | 400 | text-3 |
| Result verdict | sans | 30px | 600 | -0.02em |
| Banner headline | sans | 20px | 600 | -0.01em, accent |
| Buttons | sans | 13px | 500 | -0.005em |
| Table header | mono | 10px | 500 | 0.09em, uppercase, text-3 |
| Table numeric cell | mono | 12px | 400 | tabular-nums |
| Badge | mono | 9.5px | 400 | 0.07em, uppercase |
| Brand line 1 / line 2 | sans 13.5px/600/-0.01em · mono 9.5px/0.09em uppercase text-3 |
| Page meta / footer / sidebar meta | mono | 10.5–11px | 400 | 0.02em, text-3 |
| Field hint | mono | 9.5px | 400 | text-3 |

Rule: **data, numbers, labels, chrome microcopy = Plex Mono; prose and titles = Inter.** Numbers use `tabular-nums`.

### Radius, shadows, motion

- Radius scale: **4px** (badges, tags, compact selects, focus rings), **6px** (buttons, inputs, nav items, brand mark), **8px** (panels, cards, alerts, table wrappers, dropzone, banners, confusion grid). One-offs: 3px (bars/tracks), 2px (vs-bars, swatches), 1.5px (heat cells, histogram bars), 50% (spinner).
- Shadows: **none**, except active-nav `box-shadow: inset 2px 0 0 var(--accent)` (desktop) / `inset 0 -2px 0` (mobile).
- Transitions: `0.12s ease` on background/border-color/color for all hoverables (table rows 0.1s); result bar `width 0.5s cubic-bezier(0.2,0.7,0.2,1)`; spinner `0.7s linear infinite`; Chart.js `450ms easeOutQuart`; `scroll-behavior: smooth`.
- Focus: single global treatment — `outline: 2px solid var(--accent); outline-offset: 2px` (inputs offset 1px).
- `prefers-reduced-motion`: all animations/transitions → `0.01ms !important`.
- Spacing utilities: `mt-0/10/28/32/36`, `mb-20/24/32`, `pt-12`, `pb-8/56/64`, `scroll-60`/`scroll-68` (max-height 60/68vh), `h-340`, `grid-3`, `mono`, `mono-sm` (10.5px), `dim`, `text-danger`, `text-accent`, `borderless`.
- Section rhythm: `--space-section: 40px`; `.section { padding: 40px 0 }` separated by 1px `.divider` hairlines.

## 3. Layout geometry & shell

```
body
├─ a.skip-link → #main ("Skip to content", appears on focus)
└─ div.app-shell  (flex row, min-height 100vh)
   ├─ aside.pipeline-sidebar   width 264px · sticky top 0 · height 100vh · own scroll
   │  · bg --bg · border-right 1px --border
   │  ├─ a.sidebar-brand → /   padding 20px 20px 18px · gap 11px · bottom hairline
   │  │   ├─ span.brand-mark   "PP" — 28×28 amber rounded square (radius 6), mono 11/600, ink on amber
   │  │   └─ span.brand-text   line1 "Placement Predict" · line2 "ML Pipeline"
   │  ├─ p.nav-caption         "Pipeline" — mono 10px uppercase, padding 18px 20px 8px
   │  ├─ nav.pipeline-stepper (aria-label "ML pipeline stages") > ol > 9 × li > a
   │  └─ div.sidebar-footer    "← Overview" link → /  +  active dataset name (mono, dim)
   └─ div.app-body (flex column)
      ├─ main#main   max-width 940px · margin 0 auto · padding 0 40px
      └─ footer.site-footer   padding 32px 40px 44px · max-width 940px centered
          └─ .footer-row: border-top hairline, padding-top 18px, mono 10.5px text-3,
             space-between — "Placement Predict System" | "9 of 9 stages live"
```

- **No collapsed sidebar state on desktop.** No modals, no dropdown menus, no toasts.
- Home hero `.home-head`: grid `1.25fr 0.75fr`, gap 56px, padding 48px 0 40px.
- Grids: `.metrics` = 4 cols; `.grid-3` = 3 cols; `.metrics-auto` = auto-fit minmax(120px,1fr); `.metrics-rows` row-gap 24px; `.chart-grid` 2 cols gap 16px (wide card spans all); `.group-index` 3 cols hairline cells; `.eval-duo` 2 cols gap 24px margin-top 36px; `.predict-grid` `1.25fr 0.75fr` gap 36px; `.predict-fields` 2 cols gap 14px/16px.
- Metric cards are **unboxed**: bare mono value over label, siblings separated by left hairlines (`border-left` + `padding-left: 24px`).

## 4. Navigation system

### Sidebar stepper (the primary nav)
- Item: `a` flex, gap 10px, `padding: 7px 10px`, radius 6px, color text-2, transition 0.12s.
  - `span.step-num` mono 10.5px text-3, fixed width 18px — "01"…"09".
  - `span.step-label` 13px, ls -0.005em.
- Hover: bg `--surface`, text → `--text`.
- Active (`li.is-active a`): bg `--surface` + **inset 2px amber left bar**, step-num turns amber, label weight 500, `aria-current="page"`.
- Sidebar footer: "← Overview" (mono 11px) + active dataset name.

### Stage pager (`_pager.html`, foot of every stage page except home/error)
- `.stage-pager`: border-top hairline, `padding: 24px 0 64px`, flex space-between.
- Left: `← Stage NN` prev link (`.pager-dir` mono 10px uppercase text-3 + `.pager-label` 14px/500 text-2, hover accent). Empty `<span>` on Stage 01.
- Right: `Stage NN →` next link, same style mirrored. Omitted on Stage 09.

### Visualize sub-nav (only in-page nav)
- `.viz-nav` sticky top 0, bg `--bg`, bottom hairline: anchor links **Distributions · Standardized · Correlations · Status splits · Categories**. Sections have `scroll-margin-top: 48px`.

### Page head pattern (all stage pages)
`p.page-kicker` (eyebrow, e.g. "Stage 01 · Intake") → `h1` step label → `p.page-desc` → optional `p.page-meta` (mono 11px text-3, e.g. "Dataset · name (bundled default) · trained on N rows") → `.divider`.

## 5. Component library

### Buttons (`.btn`)
inline-flex, gap 8px, 13px/500, ls -0.005em, `padding: 10px 16px`, radius 6px, 1px transparent border, transition 0.12s. **No shadows.**
- `.btn-primary`: bg `--accent`, color `--accent-ink`; hover bg `--accent-hover`.
- `.btn-secondary`: transparent, border `--border-strong`, color `--text`; hover bg `--surface`, border-color `--text-3`.
- Disabled/loading: `opacity: 0.6`, cursor default; busy = disabled + inline 12px spinner + verb label ("Predicting…", "Evaluating…", "Benchmarking…"); restored on `pageshow` (bfcache).
- `.link-quiet`: mono 11px text-3 underlined (offset 3px), hover `--danger` — destructive quiet actions ("Remove file").

### Panels & cards
- `.panel`: 1px `--border`, radius 8px, bg `--surface`. `.panel-head` padding 13px 16px + bottom hairline + title 13px/600. `.panel-body` padding 14px 16px.
- `.chart-card`: same skin; padding 14px 16px 12px; hover = `border-color: --border-strong` (the only hover effect — no lift/shadow); head has h3 13px/600 + optional `.chart-tag` (mono 10px text-3) + optional compact select in the head.
- Metric pattern: bare `value(23px mono)/label(12px text-3)` pairs with hairline separators — **not boxed cards**.

### Forms
- `.field-label` 12.5px/500. `.field-input` (input + select): mono 13px, bg `--bg` (darker than the card), 1px `--border-strong`, radius 6px, padding 9px 11px, width 100%, tabular-nums.
- Hover: border `--text-3`. Focus: border `--accent` (no outline); `:focus-visible` adds the 2px accent outline.
- Invalid (`:user-invalid` / `.input-error`): border `--danger`, bg `--danger-dim`; `.field-hint-error` danger text.
- `.field-hint` mono 9.5px text-3 (e.g. "0–10 · blank = median 7.2").
- Select: `appearance:none`, custom chevron = inline SVG data-URI (10×6, stroke `#9BA29A` 1.5) at right 12px; padding-right 34px. Compact `.chart-select`: mono 11px, radius 4px, padding 4px 24px 4px 8px.
- Checkbox `.check-input`: 15×15, `accent-color: var(--accent)`.
- Fieldset `.predict-fieldset`: 1px `--border`, radius 8px, padding 18px 18px 14px; legend mono 10px uppercase ls 0.1em text-3, padding 0 8px.
- Upload dropzone `.upload-drop`: 1.5px dashed `--border-strong`, radius 8px, padding 28px 24px; hover/dragover/focus-within → border `--accent` + bg `--surface`; title 13.5px/500, hint mono 11px text-3, chosen filename mono 12px accent.

### Tables
- Wrapper `.table-scroll`: overflow auto, 1px `--border`, radius 8px; `.scroll-60`/`.scroll-68` cap height. **No client-side sorting/filtering/pagination — wide tables scroll.**
- `.table`: border-collapse, 13px; `th/td` padding 9px 14px, bottom hairline, `white-space: nowrap`; last row borderless.
- `th`: mono 10px uppercase ls 0.09em 500 text-3 on `--surface`. Row hover: `td` bg `--surface` (0.1s). **No striping.**
- Cell modifiers: `.num` (mono 12 tabular, right-aligned), `.mono.strong` (field names), `.dim` (text-3), `.accent` (amber), `.text-danger`.
- `.champion-row td`: bg `rgba(217,166,63,0.05)`.
- Sticky variants: sticky thead + sticky first column (`.table-sticky`, `.sticky-col`).

### Alerts, badges, banners
- `.alert`: 1px `--border-strong`, radius 8px, bg `--surface`, padding 16px 18px, 13.5px text-2, max-width 640px; `strong` block 600 text; links amber underlined; `.alert-actions` margin-top 12px.
- `.alert-error`: border `rgba(198,93,85,0.45)`, bg `--danger-dim`, strong `--danger`, `role="alert"`.
- `.badge`: mono 9.5px uppercase ls 0.07em, padding 3px 7px, radius 4px, 1px `--border-strong`, text-2. `.badge-accent`: bg `--accent-dim`, color `--accent` (used for Uploaded / Champion / Best / Best model).
- `.role-tag`: 9.5px mono, 1px `--border`, padding 2px 6px; `.role-target` amber.
- `.bench-banner`: border `rgba(217,166,63,0.4)`, bg `rgba(217,166,63,0.06)`, radius 8px, padding 16px 18px; kicker + 20px/600 accent name + mono sub.
- Confusion matrix `.cm-grid`: CSS grid `120px 1fr 1fr`, gap 1px over `--border` (hairline cells), radius 8px clipped; cells padding 20px 16px, value mono 22px/500; tp/tn = accent on `rgba(217,166,63,0.05)`; fp/fn = danger on `--danger-dim`; axis labels mono 9.5px uppercase.

### Progress/track bars
Static tracks on `--raised`, radius 2–3px: outcome (h 10px), driver (h 6px), coverage (h 4px, success/danger fill), vs-bars (h 7px), result (h 8px, animated width 0.5s).

### Feedback
- `.spinner`: 12×12, 2px ring `rgba(22,19,10,0.35)` + `--accent-ink` top, spin 0.7s.
- Loading text via `role="status"` lines. **No skeletons anywhere.**
- Empty/idle state example: predict result panel — kicker "Awaiting input", verdict "—" in text-3, guidance note.

### Icons & assets
- No icon library. Brand mark: text "PP" in 28×28 amber rounded square. Favicon: inline SVG data-URI (amber rect rx 6 + "PP").
- Typographic iconography only: `→` (pipeline rows, group cells, CTAs), `←` (back links), `›` (insight bullets via `::before`, accent), `·` separators, `↓` (sort-meaning markers in table headers).

## 6. Chart system

**Chart.js 4.4.3 UMD** (jsdelivr CDN), per-page. Global defaults: Plex Mono 10px ticks color `#8A9189`; borderColor `rgba(235,236,232,0.06)`; animation 450ms easeOutQuart (0 when reduced-motion); builds after `document.fonts.ready`. Every canvas has `role="img"` + descriptive `aria-label`.

- Tooltip: bg `#1B1F1C`, 1px `#363D37` border, title `#EBECE8`, body `#9BA29A`, padding 10, `displayColors: false`, cornerRadius 6.
- Scales: x grid off, border off, ticks maxTicksLimit 7, maxRotation 0; y grid `rgba(235,236,232,0.06)`, border off, maxTicksLimit 6.
- Sizing: `maintainAspectRatio: false` in `.chart-wrap` (h 200px) / `.chart-wrap-tall` (320px) / `.h-340`.
- Legends (only where multi-series): boxWidth 9, boxHeight 9, pointStyle rectRounded (line charts boxWidth 18, boxHeight 2).

Chart palette (charts.js, mirrors CSS): accent `#D9A63F` / fill `rgba(217,166,63,0.55)`; slate `#6E8FA0` / fill `rgba(110,143,160,0.45)`; neutral `#8A9189` / fill `rgba(138,145,137,0.4)`; danger `#C65D55` / fill `rgba(198,93,85,0.55)`; grid `rgba(235,236,232,0.06)`.

Per-type specs:
- **Histogram**: amber bars (accentFill fill, accent 1px border, borderRadius 1.5, barPercentage 1.0, categoryPercentage 0.92) + smoothed KDE line (`#EBECE8`, width 1.5, tension 0.45, no points).
- **Missing-values bar**: danger bars, radius 3, maxBarThickness 48.
- **Influence / importance**: horizontal amber bars, radius 2, maxBarThickness 18.
- **Category / rate bars**: amber, y 0–100 with `%` tick suffix.
- **Grouped bars (gender, benchmark)**: danger vs amber; benchmark radius 2 maxBarThickness 26.
- **ROC / calibration lines**: width 1.8, tension 0.1–0.15; dashed chance diagonal `#8A9189` `borderDash [5,5]` width 1; legend "name · AUC".
- **Donut**: colors `[#D9A63F, #3A403B]`, border `#1B1F1C` width 2, cutout 62%, legend bottom.
- **Per-model fixed colors everywhere**: logistic_regression `#8A9189` (grey), random_forest `#6E8FA0` (slate), gradient_boosting `#D9A63F` (amber).

Non-Chart.js visuals:
- **Correlation heatmap**: server-rendered CSS grid — `132px repeat(n, minmax(30px,1fr))`, gap 2px, min-width 840px, cells aspect-ratio 1, radius 1.5px, mono 9px; cell color = RGB lerp `(27,31,28)→(217,166,63)` with `t = clamp(v,0,1)**0.7`; text flips dark when `v**0.7 ≥ 0.45`; hover = 1.5px accent outline; `title` tooltip; column labels rotated -52°; legend "0 ▬ +1" gradient bar.
- **Boxplots**: hand-drawn inline SVG (viewBox 240×190): box width 34, whisker caps ±9, median line `#EBECE8` 2px, mean dot r 2.5; negative group fill `rgba(198,93,85,0.14)`/stroke danger, positive `rgba(217,166,63,0.14)`/stroke accent; ticks mono 8.5px; foot shows "med x → y · N outliers".

---

## 7. Workflow & state model

Nine stages, defined once in `PIPELINE_STEPS` (drives sidebar stepper, home roadmap, pager):

| # | Label | Route | Kicker (eyebrow) |
|---|---|---|---|
| 01 | Upload Dataset | `/upload` | Stage 01 · Intake |
| 02 | Analyse Features | `/features` | Stage 02 · Records |
| 03 | Descriptive Statistics | `/descriptive` | Stage 03 · Records |
| 04 | Missing Value Analysis | `/missing` | Stage 04 · Records |
| 05 | Data Visualization | `/visualize` | Stage 05 · Records |
| 06 | Preprocessing | `/preprocess` | Stage 06 · Preparation |
| 07 | Model Training | `/train` | Stage 07 · Modelling |
| 08 | Model Evaluation | `/evaluate` | Stage 08 · Modelling |
| 09 | Predict Placement | `/predict` | Stage 09 · Assessment |

- **No gating.** Every stage is visitable any time — a bundled 50k dataset powers everything before any upload.
- **State**: signed session cookie holds only `dataset_file` + `dataset_name`. EDA bundle and model bundle cached in-process keyed by (path, mtime, size). First model use trains 3 classifiers (~40s cold; artifacts may pre-warm).
- **Soft schema gating**: uploaded file must contain the required columns; otherwise every stage shows a "Dataset schema not supported" alert with a "Review the upload" action instead of content; home shows the alert + paused panel.
- **Active nav**: server sets `active_step`; home/error pages pass `None` (no highlight).
- Page `<title>` pattern: "{Step label} · Placement Predict System"; home "Overview · …"; errors "{code} · …".

## 8. Page-by-page blueprint

Global chrome for every page: sidebar stepper (§4), page-head pattern (§4), footer "Placement Predict System | 9 of 9 stages live", tokens/components per §2/§5, spacing per §3. Per-page below lists only what the page adds. "Container" is always the 940px centered main column.

### 8.1 Overview — `/` (index.html)

- **Purpose**: product home; dataset snapshot + pipeline roadmap.
- **Layout**: `.home-head` 2-col hero (1.25fr/0.75fr, gap 56px), then stacked `.section`s separated by dividers.
- **Sections top→bottom**:
  1. Hero left: kicker "Overview", h1 "Placement Predict System", 14.5px desc (mentions live record count), `.page-actions` — **btn-primary "Start the pipeline" → /upload** then **btn-secondary "Explore the data" → /visualize** (left-aligned, in that order).
  2. Hero right: `.panel` "Active dataset" — panel-head title + badge ("Default" plain / "Uploaded" amber `.badge-accent`); body: dataset filename, `dl` 4 facts (Records, Fields, Placement rate, Completeness), quiet link "Upload a different file →". Schema-bad variant: alert + paused note.
  3. "Dataset overview": right-aligned mono anomaly note ("N anomalous records flagged · M corrupt records removed"); **8 metric cards** (`.metrics.metrics-rows`, 2 rows of 4): Student records, Total features, Numerical, Categorical, Placed, Not placed, Placement rate, Missing values (value red `.text-danger` when >0).
  4. `.chart-grid` (2-col): ① "Placement distribution" donut card (tag "NN% placed"); ② "Feature distribution" card with **`select.chart-select` in the card head** (10 fields, CGPA preselected) → histogram + KDE, client-side rebuild; ③ wide "Placement rate by feature" card with head select (12 fields) → % bars; ④ wide "Correlation — model features & outcome" server-rendered heatmap (tag "hover cells for values"), legend + note linking to /visualize.
  5. "Data insights": `ul.insight-list`, `›` accent bullets, server-computed sentences (counts, IQR, strongest driver, r values, champion ROC-AUC).
  6. "What drives the offer": head link "Full analysis →" → /visualize; sub line; 5 `.driver-row`s = name | 6px track bar (width = |r|×100%) | 2dp value.
  7. "The record, at a glance": head link "All N fields →" → /features; `.group-index` 3-col hairline tiles (group name, "N fields", "→") linking to `/features#group-{slug}`.
  8. "The pipeline" (pb-64): `ol.pipeline-list` — 9 `a.pipeline-row`s: mono index "01", label + `.pipeline-note` (hidden ≤820px), `.status-live` "Live" pill, chevron "→".
- **Charts**: donut, histogram, rate bars, heatmap (per §6). Data injected via `window.EDA`; no fetch.
- **States**: schema-error alert variant; no loading state (server-rendered); empty N/A (default dataset always present).
- **Buttons/actions**: "Start the pipeline" (primary, hero-left), "Explore the data" (secondary, hero-left), "Upload a different file →" (quiet link, panel body), section head links ("Full analysis →", "All N fields →"), 9 pipeline rows, group tiles.
- **Responsive**: ≤900px hero → 1 column gap 28px; ≤820px metrics → 2 cols, pipeline-note hidden.

### 8.2 Upload Dataset — `/upload`

- **Purpose**: ingest CSV/XLSX (≤10 MB) or keep bundled cohort; show file stats + schema + preview.
- **Sections**: page-head (no page-meta) → error alert (when present) → upload form → loaded panel → "Columns" section → "Preview — first 8 rows" section → bottom CTA → pager (next only).
- **Form**: `form.upload-form` POST multipart. Dropzone `label.upload-drop` (dashed 1.5px): title "Drop a file here, or click to browse", hint ".csv · .xlsx · up to 10 MB", JS-filled filename line; hidden file input. Submit **btn-primary "Upload dataset"** directly below dropzone, left-aligned. Drag-over state: accent border + surface bg.
- **Loaded panel**: header row = badge (Default/Uploaded) + filename + (uploaded only) inline POST `/upload/clear` **link-quiet "Remove file"**; `.metrics.grid-3` = Rows / Columns / Missing values (red if >0); default adds note about one corrupt record removed downstream.
- **Tables**: "Columns" = Field | Type (mono names). "Preview" = wide scrollable head-8 table, right mono note "NN columns · scroll →".
- **CTA**: **btn-primary "Continue to Analyse Features →"** → /features, bottom-left.
- **Errors** (alert-error, role=alert, "Upload failed" + one line): no file chosen / wrong extension / unreadable file / missing required columns; oversize → branded 413 page.
- **Responsive**: standard breakpoints; tables scroll.

### 8.3 Analyse Features — `/features`

- **Purpose**: field registry grouped by domain, with role/coverage/uniques/notes.
- **Metrics**: `.grid-3` = Fields per record / Numeric / Categorical.
- **Sections**: one `.registry-group` per group (anchor `id="group-{slug}"`, order follows column order): `h2` 15px/600 group name + `.registry-count` "N fields" in head.
- **Table per group**: Field (mono strong) | Type | Role (`.role-tag`, target = amber `.role-target`) | Coverage (4px mini progress bar + %; `--w` custom prop; tinted when <95) | Unique (num) | Notes (curated note + "e.g. …" samples; hidden ≤980px).
- **Groups (reference)**: Identity, Demographics, Academic, Experience, Skill scores, Outcome.
- **States**: schema-error branch (alert + "Review the upload"); no charts; no buttons besides nav/pager.

### 8.4 Descriptive Statistics — `/descriptive`

- **Sections**: ① "All numeric fields — centre, spread, and range": `.table-scroll.scroll-68` sticky-header + sticky-first-col table — Field, count, **mean (accent)**, std, min, 25%, 50%, 75%, max; footnote with accent link to /missing. ② "Split by outcome — placed vs. not placed": explanatory sub ("The gap between the two bars is the story…"), legend swatches (red Not placed / amber Placed), 12 `.vs-row`s = name | paired 7px bars scaled to pair-max with values | signed `.vs-delta` (+ amber / − `.vs-delta-neg`).
- **No charts (Chart.js) on this page** — bars are CSS. No forms. Tables: 1 sticky scroll table.

### 8.5 Missing Value Analysis — `/missing`

- **Metrics (4)**: Total cells / Missing cells (red) / Complete (%) / Columns affected.
- **Chart**: card "Missing values per column" (tag "raw file · cells"), tall (320px) danger-red bar chart, y-axis title "missing cells".
- **Section "Repair — mean imputation"**: sub explains mean-fill; table Column | Missing | % of rows | **Imputed mean (accent; "n/a" fallback)** | Coverage (bar + "xx.x% → 100%"); closing note "All other N columns arrive complete — no action needed."
- **States**: schema-error branch; Chart.js via `window.EDA = {missing}`.

### 8.6 Data Visualization — `/visualize`

- **Sticky sub-nav** (§4): Distributions · Standardized · Correlations · Status splits · Categories.
- **#distributions**: "Distributions — repaired frame, 10 key fields"; 2-col grid of 10 chart cards; head = field name + tag "μ x · σ y"; 200px histograms + KDE.
- **#standardized**: "Z-score standardized skill scores" + explanatory sub; 4 cards with mono `z` badge; **slate-blue** histograms (only non-amber series family).
- **#correlations**: full ~21-field server heatmap in `.heat-scroll` (sub notes raw pairwise-complete vs imputed); then wide card "Influence on PlacementStatus" (tag "correlation coefficient") = horizontal amber bars.
- **#splits**: "By placement status — box & whisker": legend Not placed / Placed / mean; grid of 9 inline-SVG boxplots (240×190; red at x=95, amber at x=175); foot "med x → y · N outliers".
- **#categories**: "Placement rate by category": % bar cards (0–100 axis, tooltip "x% placed · n=N") for each categorical; conditional "Gender × outcome" grouped bar (danger vs amber, legend).
- **States**: schema-error branch; charts from `window.EDA` payload.

### 8.7 Preprocessing — `/preprocess`

- **Section "The split — sealed before anything is fit"**: sub (stratified, seed 42, test quarantined until evaluation); 4 metrics: Training rows / Sealed test rows / Placed rate · train / Placed rate · test; note about matching rates confirming stratification.
- **Section "Feature set — 12 inputs, one target"**: sub explains target already 0/1, training-mean imputation, z-score for linear model vs raw imputed for trees; sticky-head scroll-60 table — Feature | **Imputed mean (train) (accent)** | Train std (dim) | Transform ("impute → z-score"); final row = target with "—" cells + amber `role-tag` "target"; note: transforms computed on train split only, then frozen.
- Model-failure branch: alert "Cannot preprocess from this dataset" + `mb.error` + "Upload a different file" link.

### 8.8 Model Training — `/train`

- **Section "Model selection"** (right mono note "seed 42 · scikit-learn"): long sub (one shared training pass; first run ~40s; selections read the shared run).
- **Form** `form.model-pick` (GET, row layout): label "Model" + select (placeholder "Choose a model to inspect…", options "{name} · CV ROC-AUC {x.xxxx}") + hint; **btn-primary "Train & evaluate"**; when selected: **btn-secondary "Clear selection"** → /train. Unknown `?model=` → alert-error.
- **Model detail panel** (on selection): head = model name + "Champion" badge if best; `.model-role` mono meta ("note · input z-scored|raw · settings · Platt sigmoid · 3-fold out-of-fold"); `.metrics-auto` 5 metric cards (Accuracy/Precision/Recall/F1 % 1dp + ROC-AUC accent); meta line ("Sealed test set · threshold 0.5 · CV ROC-AUC x ± y · fitted in Ns"); `.eval-duo`: confusion matrix + ROC curve card (h-340).
- **Section #benchmark** (right mono "N sealed test rows · threshold 0.5"): long sub; `.bench-controls.needs-js` (role=group): 3 pre-checked model checkboxes + "Re-train from scratch" checkbox (title tooltip) + **btn-primary "Run benchmark"**; status line `role="status"`; hidden error alert; `<noscript>` fallback note.
- **Benchmark results**: `.bench-banner` (kicker "Best performing model", 20px accent champion name, mono sub with CV + sealed-test ROC-AUC + Brier) + `#benchTable` (Model, Accuracy, Precision, Recall, F1, **ROC-AUC accent**, Brier ↓, Log-loss ↓, CV ROC-AUC · 3-fold "x ± y", Train time; 4dp; champion row amber tint + "Best" badge) + wide grouped-bar card "Sealed-test metrics by model" (tag "0–1 scale · higher is better").
- **Closing note** links to /evaluate and /predict.
- **States**: busy "Evaluating…" on submit; benchmark fetch lifecycle with status strings; static-export fallback. Model colors fixed (§6).

### 8.9 Model Evaluation — `/evaluate`

- **Section "The verdict — sealed test set, threshold 0.5"**: metrics table (Model w/ "Champion" badge, Accuracy…Log-loss ↓, 4dp, ROC-AUC accent column, champion row tinted); note explaining Brier/log-loss vs calibration.
- **Section "ROC curves — ranking quality, all models"**: wide tall card "True-positive rate vs false-positive rate" (tag "dashed = chance") — per-model lines + dashed diagonal, legend "name · AUC", mono axis titles.
- **Wide card "Reliability curves — do the probabilities mean what they say?"** (tag "dashed = perfectly calibrated") + long explanatory note (10 uniform bins, Platt sigmoid, 3-fold OOF).
- `.eval-duo`: left "Confusion matrix — {champion}" (cm-grid), right "Feature importance — Random Forest" (h-340 horizontal bars, axis "mean decrease in impurity").
- **Closing note**: sealed-set honesty statement ("touched exactly once — this page").

### 8.10 Predict Placement — `/predict`

- **Layout**: `.predict-grid` 2-col (`1.25fr 0.75fr`, gap 36px) — form left, **sticky result aside right** (top 24px, `aria-live=polite`).
- **Form** (POST): 3 fieldsets with mono-uppercase legends — "Academic" (2 fields), "Experience" (6), "Skill scores" (4); each field = `.field-label` + number input (server-set min/max/step, placeholder = dataset median, repopulated value, inputmode decimal) + `.field-hint` "{min}–{max} · blank = median {d}"; invalid = `.input-error` + red hint. Fieldset "Model": select — first option "Best model — {name} (recommended)" then "{name} · ROC-AUC {x}"; static hint. Submit **btn-primary "Predict placement"**; note "Blank inputs fall back to the dataset median."
- **Result aside**: idle = kicker "Awaiting input", verdict "—" (text-3), guidance note naming recommended best model. Filled = `.result-panel` with amber border (`.result-placed`) or red border (`.result-not`); kicker "Prediction · {model}" + "Best model" badge when champion; **30px/600 verdict** (amber "Placed" / red "Not placed"); 8px `.result-track` bar animated to probability; mono meta row "{p}% probability | threshold 50%"; `.result-facts` dl (Model used / Placement probability / Model ROC-AUC); banded hedged explanation (≥80 / 50–80 / 20–50 / ≤20 wordings, always ending with calibrated-estimate caveat).
- **Errors**: alert-error "Check the highlighted inputs" + one line per error (unknown model / not a number / outside observed range min–max).
- **States**: busy "Predicting…" spinner in button; blur on invalid field → native `reportValidity()`.
- **Responsive**: ≤820px grid → 1 col, aside unsticks, fields → 1 col.

### 8.11 Error pages — `error.html`

- kicker "Error {code}", h1 title, message; actions: **btn-primary "Back to overview" → /** + **btn-secondary "Upload page" → /upload**. Codes: 404 "Page not found", 413 "File too large" (upload-capped message), 500 "Something broke on our side", generic HTTP fallback. No active nav highlight.

## 9. API integration (reference)

- App JS makes exactly **one** live fetch: `POST /api/benchmark` `{models: [...], fresh: bool}` → `{ok, source, seed, cv_folds, split, selection_rule, models:[{key,name,settings,calibration,train_time,cv_auc_mean,cv_auc_std,metrics{…},confusion,roc,reliability}], best, overall_best, dataset}`; errors 400/415/503 with `{error, …}`. JS re-renders banner+table+chart client-side.
- `GET /api/health`, `GET /api/dataset` exist for consumers (not called by app JS). `POST /api/predict` used only by the static Pages build (with in-browser calibrated-logistic fallback).
- All `/api/*` carry `Access-Control-Allow-Origin: *`.
- Everything else is server-rendered with data injected as `window.EDA` / `window.MODEL_PAGE` JSON payloads.

**PropPulse note**: PropPulse keeps its existing FastAPI contracts (goal §36) — the reference's *interaction pattern* (server-computed payloads + one benchmark re-run endpoint + busy/status feedback) is what carries over, not its routes.

## 10. Responsive behavior

| Breakpoint | Changes |
|---|---|
| ≤980px | Features table "Notes" column hidden |
| ≤900px | Shell → column; sidebar full-width static top bar; stepper → horizontal scroll strip (items column, padding 8px 12px, nowrap; active indicator flips to bottom inset bar; step-label 12px; "Soon" + sidebar-footer hidden); main max-width 100%, padding 0 24px; footer 28px 24px 36px; home hero → 1 col gap 28px |
| ≤820px | h1 → 23px; metrics → 2 cols (separators on even children); group-index, chart-grid, eval-duo, predict-grid, predict-fields → 1 col; predict result unsticks; cm-grid → `96px 1fr 1fr`; driver-row/vs-row grids compact; pipeline-note hidden; footer + pager stack; model-pick field full width |
| ≤520px | main padding 0 18px; metrics stay 2 cols; outcome legend stacks |

Target QA viewports for PropPulse: 1920 / 1440 / 1280 / 1024 / 768 / 390.

## 11. Accessibility & progressive enhancement

- Skip link ("Skip to content", appears on focus). `aria-label` on stepper nav; `aria-current="page"` on active item. `aria-live="polite"` on benchmark status + predict result. `role="alert"` on error alerts; `role="status"` on loading lines; `role="img"` + aria-label on every canvas.
- Global amber focus outline (2px, offset 2px; inputs 1px). `:user-invalid` styling + `reportValidity()`.
- All primary flows work with JS disabled (form GET/POST full page loads). `.needs-js` hides JS-only controls; `<noscript>` explanations.
- `prefers-reduced-motion` kills all animation. `color-scheme: dark`. Selection color amber-tinted. Thin scrollbars (8px `--border-strong` thumbs).

## 12. Copy conventions

- Voice: precise, technical, quietly confident; microcopy in mono for meta ("seed 42 · scikit-learn", "N sealed test rows · threshold 0.5").
- Eyebrow kickers group stages: Intake / Records / Preparation / Modelling / Assessment.
- Numbers always tabular mono; percentages 1dp on cards, 4dp in benchmark tables.
- Honest ML framing everywhere (sealed test set, calibration caveats, probability hedges) — PropPulse should keep this register with real-estate semantics.
