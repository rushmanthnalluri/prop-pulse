# PlacementPredict — Definitive UI Inventory

Reverse-engineered from the reference project at `C:\Machine_Learning\Placement-predict\flask_project`.
This document is the single source of truth for the PropPulse frontend rebuild. It describes the
reference app **as built**, not as remembered. Every structural claim cites a file and line number.

**Sources read in full:**

| File | Role |
|---|---|
| `templates/base.html` (66 lines) | App shell, sidebar, footer |
| `templates/index.html` (265 lines) | Overview / landing page |
| `templates/upload.html` (113 lines) | Stage 01 |
| `templates/features.html` (89 lines) | Stage 02 |
| `templates/descriptive.html` (98 lines) | Stage 03 |
| `templates/missing.html` (116 lines) | Stage 04 |
| `templates/visualize.html` (228 lines) | Stage 05 |
| `templates/preprocess.html` (107 lines) | Stage 06 |
| `templates/train.html` (251 lines) | Stage 07 |
| `templates/evaluate.html` (160 lines) | Stage 08 |
| `templates/predict.html` (136 lines) | Stage 09 |
| `templates/stage.html` (22 lines) | Stub for non-live stages (currently unused) |
| `templates/error.html` (14 lines) | Branded HTTP error page |
| `templates/_pager.html` (16 lines) | Prev/next stage pager partial |
| `static/js/script.js` (457 lines) | Global JS behaviors |
| `static/js/charts.js` (533 lines) | Chart.js builders (`window.PPCharts`) |
| `app.py` (976 lines) | Routes, context, validation, JSON API |

---

## 1. APP-LEVEL ARCHITECTURE

### 1.1 Stack and rendering model

- Flask + Jinja2 server-rendered HTML. There is no SPA framework. Chart.js 4.4.3 (UMD build from
  jsDelivr CDN) is loaded per-page, only on pages that render charts
  (`index.html:253`, `visualize.html:216`, `missing.html:108`, `train.html:235`, `evaluate.html:151`).
- Data reaches the browser two ways:
  1. **Server-rendered markup** — tables, metric cards, heatmaps, box plots (SVG) are pure Jinja output.
  2. **Embedded JSON payloads** — `<script>` blocks inject `window.EDA = {...}` (EDA pages),
     `window.MODEL_PAGE = {...}` (train), `window.LR_MODEL / FORM_META / CHAMPION` (predict) via
     Jinja's `tojson` filter. `charts.js` reads these globals and hydrates `<canvas data-chart="…">`
     elements (`charts.js:492-524`).
- Two fonts via Google Fonts: **Inter** (400/500/600) for UI text, **IBM Plex Mono** (400/500/600)
  for numbers, ticks, code (`base.html:10`). Chart.js defaults are set to IBM Plex Mono size 10
  (`charts.js:52-57`).
- Custom inline SVG favicon: gold rounded square (`#D9A63F`) with mono "PP" mark (`base.html:7`).
- One global stylesheet `static/css/style.css` (`base.html:11`); one global script `static/js/script.js`
  loaded on every page (`base.html:63`); page-specific scripts go in the `{% block scripts %}` block
  (`base.html:64`).

### 1.2 Layout skeleton (base.html)

```
<body>
  <a class="skip-link" href="#main">Skip to content</a>          (base.html:15)
  <div class="app-shell">                                         flex row, min-height 100vh
    <aside class="pipeline-sidebar">                              (base.html:19-46)
      <a class="sidebar-brand"> PP mark + "Placement Predict / ML Pipeline"   (base.html:20-26)
      <p class="nav-caption">Pipeline</p>                         (base.html:28)
      <nav class="pipeline-stepper"> ordered list of 9 stages     (base.html:29-40)
      <div class="sidebar-footer"> ← Overview link + active dataset name      (base.html:42-45)
    </aside>
    <div class="app-body">                                        (base.html:48)
      <main id="main" tabindex="-1"> {% block content %}          (base.html:49-51)
      <footer class="site-footer">                                (base.html:53-58)
    </div>
  </div>
```

- **Header:** none in the classic sense — the brand lives in the sidebar. Each page renders its own
  `page-head` section (kicker / H1 / description / meta) inside `main`.
- **Sidebar:** fixed left column, the primary navigation. On ≤900 px viewports the shell switches to
  `flex-direction: column` and the sidebar becomes a horizontal bar with a horizontally scrollable
  stepper (`style.css:1313-1325`).
- **Footer:** one row inside the right column — app name on the left, live-stage counter on the right:
  `{{ pipeline_steps|selectattr('live')|list|length }} of {{ pipeline_steps|length }} stages live`
  (`base.html:56`). Currently renders "9 of 9 stages live".

### 1.3 Navigation structure

The navigation is a **nine-stage ML pipeline stepper**, driven by the `PIPELINE_STEPS` list in
`app.py:109-200` and injected into every template by the `inject_pipeline` context processor
(`app.py:215-222`). Order, labels, and eyebrows are exactly:

| # | id | Label (sidebar) | Eyebrow (page kicker) | Route |
|---|---|---|---|---|
| 01 | `upload` | Upload Dataset | Stage 01 · Intake | `/upload` (GET, POST) |
| 02 | `features` | Analyse Features | Stage 02 · Records | `/features` |
| 03 | `descriptive` | Descriptive Statistics | Stage 03 · Records | `/descriptive` |
| 04 | `missing` | Missing Value Analysis | Stage 04 · Records | `/missing` |
| 05 | `visualize` | Data Visualization | Stage 05 · Records | `/visualize` |
| 06 | `preprocess` | Preprocessing | Stage 06 · Preparation | `/preprocess` |
| 07 | `train` | Model Training | Stage 07 · Modelling | `/train` |
| 08 | `evaluate` | Model Evaluation | Stage 08 · Modelling | `/evaluate` |
| 09 | `predict` | Predict Placement | Stage 09 · Assessment | `/predict` (GET, POST) |

Additional nav affordances:

- Brand block links to `/` (`url_for('home')`, `base.html:20`).
- Sidebar footer: "← Overview" link to `/` plus the **active dataset name** as plain text
  (`base.html:42-45`) — a persistent reminder of which dataset every page is computed from.
- Each stepper item renders: step number (`01`…`09`), label, and a "Soon" badge when
  `not step.live` (`base.html:34-36`). All nine stages are currently `live: True` (`app.py:687-690`),
  so the badge never renders in practice.

**Active-state handling** (`base.html:31-33`): the view passes `active_step`; the matching `<li>`
gets class `is-active` and its link gets `aria-current="page"`. The home page passes
`active_step=None` (`app.py:379`), so no step is highlighted on the landing page. On narrow screens,
`script.js:145-148` scrolls the active stepper item into view (`scrollIntoView`, inline center,
instant) so the current stage is never scrolled out of sight.

**Stage pager:** every stage page includes `_pager.html` at the bottom — a two-cell prev/next
navigation ("← Stage 04 Missing Value Analysis" | "Stage 06 Preprocessing →") built from
`_step_pager()` (`app.py:207-212`). First/last stages render an empty spacer cell on the missing side
(`_pager.html:8`).

### 1.4 Flash messages

**There are none.** Flask's `flash()`/`get_flashed_messages()` is not used anywhere. All feedback is
inline: upload errors render as an `.alert.alert-error` block above the form (`upload.html:15-20`),
predict validation errors as an alert inside the form section (`predict.html:36-41`), benchmark
errors in a dedicated `#benchError` box (`train.html:163`). Upload success is implicit — the preview
panel appears below the form. State change confirmation comes from content, not toasts.

### 1.5 Global JS behaviors (script.js)

Everything runs inside one `DOMContentLoaded` handler (`script.js:134`). All behaviors are
**progressive enhancement** — the comment at `script.js:4-5` states "nothing here is required for the
page to function":

1. **Un-hide JS-only controls** (`.needs-js` class removed, `script.js:136`) — e.g. the benchmark
   console is hidden without JS and replaced by a `<noscript>` note (`train.html:164`).
2. **bfcache guard** (`:139-141`): on `pageshow` with `persisted`, restore any button left in a busy
   (spinner) state so back-navigation never shows a stuck "Predicting…" button.
3. **Active stepper scroll** (see 1.3).
4. **Busy-button helper** (`setBusy`, `:11-19`): disables the button, swaps its label for a CSS
   spinner + text ("Predicting…", "Evaluating…", "Benchmarking…"). Used on live predict-form submit
   (`:263-269`), model-picker submit (`:298-302`), and benchmark runs (`:353`).
5. **Static-build (GitHub Pages) fallbacks** (`:150-258`): the exported static site neutralizes forms;
   script.js detects this and (a) disables the upload button with an explanatory note (`:157-164`),
   (b) wires predict to a hosted API with an in-browser logistic-regression fallback (`:168-259`),
   (c) renders model detail and benchmark from embedded JSON instead of the API (`:290-303`,
   `:331-343`). Relevant mainly as a design lesson: every interactive feature degrades to something
   honest rather than dead-ending.
6. **Home-page chart toggles** (`:391-412`): the two `<select>` dropdowns re-render the histogram and
   rate-by-feature charts from `window.EDA` without a page reload.
7. **Predict-form blur validation** (`:416-422`): leaving an invalid numeric input triggers the
   native `reportValidity()` popup immediately rather than waiting for submit.
8. **Upload dropzone** (`:424-456`): drag-enter/over adds `.is-dragover`, drag-leave/drop removes it,
   dropped files are assigned to the hidden `<input type="file">`, and the chosen filename is shown
   in `#uploadFilename`.

### 1.6 Error pages and HTTP handling

`error.html` is a minimal branded page: kicker "Error {code}", H1 title, description, and two
buttons — "Back to overview" (primary) and "Upload page" (secondary) (`error.html:5-13`). Handlers
exist for 404, 413 (10 MB upload cap — `MAX_CONTENT_LENGTH`, `app.py:59`), 500, and a catch-all
`HTTPException` handler for anything else (`app.py:925-971`). All messages are written in plain,
reassuring language ("Your dataset is unaffected — head back to the overview…").

### 1.7 JSON API (app.py) — for completeness

| Route | Methods | Purpose |
|---|---|---|
| `/api/health` | GET | Status + model warm state; never triggers training (`app.py:698-703`) |
| `/api/dataset` | GET | Dataset summary, insights, distributions, rate-by-feature, correlation (`app.py:706-738`) |
| `/api/predict` | POST | JSON prediction; same validation as the UI form; 415/400/503 error contract (`app.py:741-815`) |
| `/api/benchmark` | POST | `{models: [...], fresh: bool}` comparative evaluation (`app.py:818-893`) |

CORS is open (`Access-Control-Allow-Origin: *`, no credentials) on `/api/*` so the static showcase can
call it (`app.py:73-80`).

---

## 2. PAGE-BY-PAGE INVENTORY

### PAGE: Overview / Home (`/`)

├── **Purpose**
Marketing-grade landing and dashboard hybrid: introduce the pipeline, show live dataset vitals,
surface auto-generated insights, and route the user into the nine stages. Rendered by `home()`
(`app.py:360-380`).

├── **Layout (sections in order)**
1. Hero head: kicker "Overview", H1 "Placement Predict System", description paragraph with live row
   count, two CTA buttons; right side: "Active dataset" panel (`index.html:6-43`).
2. (Conditional) schema-unsupported alert (`index.html:45-56`).
3. "Dataset overview" section: 8-metric strip, then a 4-card chart grid (`index.html:61-173`).
4. "Data insights" bullet list (`index.html:175-183`).
5. "What drives the offer" — top-drivers bar list (`index.html:188-204`).
6. "The record, at a glance" — feature-group index grid (`index.html:208-225`).
7. "The pipeline" — full 9-stage roadmap list with Live/Soon status pills (`index.html:230-247`).
Sections are separated by full-width `.divider` rules.

├── **Components**
- **CTA buttons**: "Start the pipeline" (primary → `/upload`), "Explore the data" (secondary →
  `/visualize`) (`index.html:17-18`).
- **Active dataset panel**: badge (Default / Uploaded accent), filename, 4 fact rows (Records,
  Fields, Placement rate, Completeness) or a schema-warning note, and "Upload a different file →"
  link (`index.html:22-42`).
- **Metric strip** (8 metrics): student records, total features, numerical features, categorical
  features, placed, not placed, placement rate %, missing values (red `text-danger` when > 0)
  (`index.html:67-100`). A header annotation reports "N anomalous records flagged · M corrupt records
  removed" (`index.html:64`).
- **Chart: Placement distribution** — doughnut chart with "N% placed" tag (`index.html:103-112`,
  `buildDonut` in `charts.js:403-438`; 62 % cutout, accent vs dark-green segments, bottom legend).
- **Chart: Feature distribution** — histogram + smoothed KDE line with a `<select>` of all
  histogrammed columns (default CGPA) (`index.html:114-127`; `buildHistogram`, `charts.js:84-119`).
- **Chart: Placement rate by feature** — bar chart of placement rate per band, own `<select>`
  (`index.html:129-142`; `buildRateBars`, `charts.js:441-484`; y-axis 0-100 %, tooltip shows
  `% placed · n=count`).
- **Chart: Correlation heatmap (core fields)** — pure HTML/CSS grid, not Chart.js: cells colored
  server-side, value in each cell, `title` tooltip "A × B: value", `heat-strong` class for strong
  correlations, 0→+1 legend bar (`index.html:144-172`). A note links to the full 21-field matrix on
  `/visualize`.
- **Data insights list**: plain-language auto-generated findings (`_dataset_insights`, `app.py:309-357`)
  — e.g. "Half of all students have a CGPA between 6.52 and 8.12…".
- **Top drivers**: rows of name / horizontal fill bar (`--w` percent) / correlation value, strongest
  first (`index.html:195-203`).
- **Group index**: grid of clickable group cards (e.g. Academics, Skills) showing "N fields →",
  deep-linking to `/features#group-<slug>` (`index.html:213-224`).
- **Pipeline roadmap**: numbered rows with label, one-line note, Live/Soon status pill, and chevron;
  each row is a link to the stage (`index.html:234-246`).

├── **Data sources (from app.py)**
`schema_ok`, `bundle` (full cached EDA bundle), `overview`, `top_drivers`, `features`,
`dropped_rows`, `insights` (auto-generated strings), `dataset_name`, `is_default` (`app.py:368-380`).
Chart payload embedded as `window.EDA = {overview, histograms, rateByFeature}` (`index.html:257-261`).
The model-derived insight is included only if the model bundle is already warm — the home page never
triggers a cold train (`app.py:296-306`).

├── **API calls / form posts**
None. All rendering is server-side; the two `<select>` toggles re-render charts client-side from the
embedded payload (`script.js:391-412`).

├── **User interactions**
- CTA links to `/upload` and `/visualize`.
- `#distSelect` change → rebuild histogram for the chosen feature (`script.js:394-404`).
- `#rateSelect` change → rebuild rate-by-feature chart (`script.js:405-411`).
- Correlation cells: hover for native `title` tooltip with exact value (`index.html:160`).
- Group-index cards → `/features#group-…` anchors.
- Pipeline rows → stage pages.
- "Upload a different file →", "Full analysis →", "All N fields →" section links.

├── **Loading behavior**
None for the page itself. Chart rendering waits for `document.fonts.ready` so mono axis labels are
measured with the real webfont and don't clip (`charts.js:526-532`).

├── **Error behavior**
Schema-mismatch state replaces the data sections with a full-width alert: "Dataset schema not
supported… Remove it to fall back to the bundled 50,000-student cohort" + "Review the upload" link
(`index.html:45-56`). The hero panel swaps its fact grid for an explanatory note (`index.html:36-39`).

├── **Empty behavior**
Not applicable in the empty-data sense (a bundled 50k dataset is always available); the
`schema_ok == False` branch *is* the empty state and is fully designed (see above).

├── **Responsive behavior**
`.chart-grid` collapses to one column ≤820 px; `.metrics` drops to 2-column at ≤820 px and stays
2-up at ≤520 px; `.group-index` collapses to one column ≤820 px (`style.css:1342-1366`).

└── **Visual hierarchy**
1. H1 + primary CTA. 2. The 8-metric strip (large mono numbers). 3. Donut + histogram charts.
4. Insights/drivers prose. 5. Pipeline roadmap at the foot as the "where to go next" element.

---

### PAGE: Upload Dataset (`/upload`, GET + POST)

├── **Purpose**
Stage 01. Accept a CSV/XLSX (≤10 MB), validate it against the placement schema, preview it, and set
it as the active dataset for the whole app. View: `upload_dataset()` (`app.py:383-451`).

├── **Layout (sections in order)**
1. Page head (kicker / H1 / note).
2. Error alert (conditional).
3. Upload form with dropzone.
4. (After upload / always when a dataset is on file) "loaded panel": header + metrics + Columns
   table + Preview table + Continue button.
5. Stage pager (`upload.html:112`).

├── **Components**
- **Dropzone** (`upload.html:23-28`): a `<label>` wrapping a hidden file input — "Drop a file here,
  or click to browse", hint ".csv · .xlsx · up to 10 MB", and a filename slot that fills in after
  selection.
- **Submit button**: "Upload dataset".
- **Loaded panel header**: Default/Uploaded badge, dataset filename, and (for uploads only) an
  inline POST form "Remove file" styled as a quiet link (`upload.html:33-42`).
- **Metrics row**: Rows, Columns, Missing values (red when > 0) (`upload.html:44-57`).
- **Columns table**: Field + dtype for every column (`upload.html:62-79`).
- **Preview table**: first 8 rows (`MAX_PREVIEW_ROWS`, `app.py:35`), numbers rounded to 2 dp
  (`app.py:277-289`), horizontally scrollable with "N columns · scroll →" hint (`upload.html:81-104`).
- **Continue CTA**: "Continue to Analyse Features →" primary button (`upload.html:106`).

├── **Data sources**
`error`, `preview` (rows, columns, missing_total, column_names, head, dtypes), `dataset_name`,
`is_default` (`app.py:441-451`). With no upload on file, the bundled dataset is previewed instead
(`app.py:434-438`).

├── **API calls / form posts**
- `POST /upload` — `multipart/form-data`, field `dataset` (the file). Server validates: file present
  (else "Choose a CSV or Excel file before uploading."), extension in {csv, xlsx}, parseable by
  pandas, and contains all `eda.REQUIRED_COLS` (else "That file is missing required columns: …")
  (`app.py:389-421`). Stored per-session as `<uuid8>_<secure_filename>` so concurrent sessions can't
  clobber each other (`app.py:398-403`).
- `POST /upload/clear` — "Remove file"; deletes the stored file, clears the session keys, redirects
  back to `/upload` (`app.py:454-461`).

├── **User interactions**
- Click dropzone → native file picker; drag & drop file → fills input, shows filename
  (`script.js:424-456`); drag-over highlight via `.is-dragover`.
- Submit uploads and re-renders the page with the preview.
- "Remove file" reverts the whole app to the bundled dataset.
- "Continue to Analyse Features →" advances to stage 02.

├── **Loading behavior**
None — no spinner on the upload submit (a gap; the 10 MB POST on a slow link shows no progress).

├── **Error behavior**
Inline `.alert.alert-error` "Upload failed — <reason>" above the form; the previously active dataset
preview stays visible alongside the error (`app.py:423-431`, `upload.html:15-20`). Oversized files
hit the branded 413 page (`app.py:937-946`).

├── **Empty behavior**
With no upload on file, the bundled dataset is previewed and badged "Default" — the page is never
empty (`upload.html:35`, `app.py:433-438`).

├── **Responsive behavior**
Metrics collapse with the global metric breakpoints; tables scroll horizontally (`.table-scroll`).

└── **Visual hierarchy**
1. Dropzone (large dashed target). 2. Loaded panel with the filename and badge. 3. Metrics.
4. Preview table. 5. Continue button as the exit ramp.

---

### PAGE: Analyse Features (`/features`)

├── **Purpose**
Stage 02. A data dictionary: every column's type, role, coverage, uniqueness, and sample values,
grouped by domain. View: `_eda_stage_view("features", …)` (`app.py:481-483`).

├── **Layout (sections in order)**
1. Page head.
2. Metric strip (3-up): fields per record, numeric, categorical (`features.html:27-42`).
3. One registry group per feature group, each an anchored block (`features.html:44-85`).
4. Stage pager.

├── **Components**
- **Registry groups** (`features.html:46-83`): `<h2>` group name + "N fields" count, then a table
  with columns Field (mono strong), Type (dtype), Role (`role-tag` pill; `role-target` accent for
  the target), Coverage (inline progress bar — red `coverage-low` under 95 % — plus percent), Unique
  count, Notes (free text + "e.g. sample · sample" values). Each group has `id="group-<slug>"` for
  the home page's deep links.

├── **Data sources**
`bundle.features` (groups, registry entries with name/dtype/role/non_null_pct/unique/note/samples),
`bundle.n_cols` (`app.py:464-478`).

├── **API calls / form posts**
None.

├── **User interactions**
Scroll; anchor deep-links from the home page group index (`index.html:216`). No in-page controls.

├── **Loading behavior**
None.

├── **Error behavior**
Standard schema-mismatch alert with "Review the upload" link (`features.html:12-22`).

├── **Empty behavior**
Covered by the schema alert branch; no per-group empty states.

├── **Responsive behavior**
The Notes column (`.registry-optional`, both `<th>` and `<td>`) is hidden ≤980 px
(`style.css:1309-1311`); tables otherwise scroll horizontally.

└── **Visual hierarchy**
1. The three headline metrics. 2. Group headings with counts. 3. Coverage bars (the one colorful,
scan-able column). 4. Notes/samples as tertiary detail.

---

### PAGE: Descriptive Statistics (`/descriptive`)

├── **Purpose**
Stage 03. Centre/spread/range for all numeric fields, then means split by outcome — "the gap
between the two bars is the story the model will learn" (`descriptive.html:69-70`).

├── **Layout (sections in order)**
1. Page head.
2. "All numeric fields — centre, spread, and range" stats table.
3. "Split by outcome — placed vs. not placed" paired-bar block.
4. Stage pager.

├── **Components**
- **Stats table** (`descriptive.html:31-57`): sticky header row and sticky first column
  (`.table-sticky` + `.sticky-col`), inside a max-height scroll region (`.scroll-68`); columns are
  count, mean (accent), std, min, 25%, 50%, 75%, max — pandas `describe()` verbatim. Footnote links
  low counts to the Missing Value Analysis page (`descriptive.html:58-60`).
- **Split-by-outcome bars** (`descriptive.html:71-93`): legend (Not placed = red swatch, Placed =
  gold swatch), then per-factor rows with two horizontal bars normalized to the row max, value labels
  at bar ends, and a signed delta (`vs-delta`, red when negative) at the right edge.

├── **Data sources**
`bundle.descriptive` (stats list, column order, table), `bundle.by_status` (name, placed,
not_placed, delta), `bundle.n_rows`.

├── **API calls / form posts**
None.

├── **User interactions**
Vertical scroll inside the table region; link to `/missing`. Purely read-only page.

├── **Loading behavior**
None.

├── **Error behavior**
Standard schema-mismatch alert (`descriptive.html:12-22`).

├── **Empty behavior**
Schema branch only.

├── **Responsive behavior**
Bars are percentage-width CSS, inherently fluid; the table scrolls horizontally on narrow screens.

└── **Visual hierarchy**
1. The dense stats table (mean column accented in gold). 2. The paired bars — the narrative moment.
3. The signed deltas at the right edge of each row.

---

### PAGE: Missing Value Analysis (`/missing`)

├── **Purpose**
Stage 04. Quantify missingness and show the repair (mean imputation) that all downstream stages use.

├── **Layout (sections in order)**
1. Page head.
2. Metric strip + missing-per-column bar chart.
3. "Repair — mean imputation" table.
4. Stage pager.

├── **Components**
- **Metrics**: Total cells, Missing cells (always `text-danger` red), Complete %, Columns affected
  (`missing.html:27-44`).
- **Chart: Missing values per column** — Chart.js vertical bar, red fill/border, y-axis titled
  "missing cells", all x labels shown rotated ≤30° (`missing.html:46-55`; `buildMissing`,
  `charts.js:121-151`).
- **Repair table** (`missing.html:66-98`): per affected column — Missing count, % of rows, Imputed
  mean (accent; "n/a (no observed values)" when undefined), and a Coverage widget showing
  "before% → 100%" with a fill bar. Closing note: "All other N columns arrive complete — no action
  needed." (`missing.html:99`).

├── **Data sources**
`bundle.missing` (total_cells, total, completeness, affected[] with count/pct/impute_mean/
non_null_pct), `bundle.n_cols`. Chart payload: `window.EDA.missing` (`missing.html:110-112`).

├── **API calls / form posts**
None.

├── **User interactions**
Chart tooltips on hover; otherwise read-only.

├── **Loading behavior**
None (chart renders after `document.fonts.ready`).

├── **Error behavior**
Standard schema-mismatch alert (`missing.html:12-22`).

├── **Empty behavior**
Schema branch only. (If a dataset has zero missing values, `affected` is empty and the table body
renders no rows — the metrics still show; there is no dedicated "nothing missing" empty state.)

├── **Responsive behavior**
Chart card is full width; table scrolls horizontally.

└── **Visual hierarchy**
1. The red missing-cells metric. 2. The red bar chart. 3. The repair table with its before→after
coverage bars.

---

### PAGE: Data Visualization (`/visualize`)

├── **Purpose**
Stage 05. The EDA showcase: five anchored chart sections covering distributions, standardized
scores, correlations, outcome splits, and categorical rates. The densest visual page in the app.

├── **Layout (sections in order)**
1. Page head.
2. **Sticky-style in-page nav** (`visualize.html:35-41`): Distributions · Standardized ·
   Correlations · Status splits · Categories (anchor links).
3. `#distributions` — histogram grid for 10 key fields.
4. `#standardized` — z-scored skill-score histograms.
5. `#correlations` — full correlation heatmap + influence bar chart.
6. `#splits` — SVG box-and-whisker per feature by outcome.
7. `#categories` — placement-rate-by-category bars + gender × outcome grouped bars.
8. Stage pager.

├── **Components**
- **Histogram cards** (`visualize.html:49-60`): one per field with `μ mean · σ std` tag; Chart.js
  bar + KDE line (`data-chart="hist"`).
- **Standardized cards** (`visualize.html:74-85`): same chart but slate-colored and badged with a
  small "z" pill in the title (`data-chart="std"` → `buildHistogram` with slate palette,
  `charts.js:500`).
- **Full heatmap** (`visualize.html:99-119`): same server-rendered CSS-grid technique as the home
  core heatmap but all numeric fields; note explains it uses pairwise-complete observations on the
  raw file vs the imputed frame elsewhere (`visualize.html:96-98`).
- **Influence chart** (`visualize.html:121-130`): horizontal bar of each feature's correlation with
  PlacementStatus (`buildInfluence`, `charts.js:153-185`; accent bars, maxBarThickness 18).
- **Box-and-whisker cards** (`visualize.html:136-172`): **hand-built SVG**, not Chart.js — a Jinja
  macro `bp_box` (`visualize.html:4-13`) draws whiskers, box, median line, and mean dot from
  server-normalized coordinates; red box for Not placed, gold for Placed, mean as a dot (legend at
  `visualize.html:140-144`). Footer under each: "med X → Y · N outliers" (`visualize.html:166-169`).
- **Category rate cards** (`visualize.html:183-194`): vertical bars, y fixed 0-100 %, tooltip
  "% placed · n=…" (`buildCategory`, `charts.js:187-227`).
- **Gender × outcome** (`visualize.html:195-206`): grouped bar, red = not placed, gold = placed,
  point-style legend (`buildGender`, `charts.js:229-267`); rendered only when the column exists.

├── **Data sources**
`bundle.histograms`, `bundle.standardized`, `bundle.heatmap`, `bundle.influence`, `bundle.boxes`,
`bundle.categories`, `bundle.gender_split`. Chart payload: `window.EDA = {histograms, standardized,
influence, categories, gender_split}` (`visualize.html:218-224`). Box plots are fully server-rendered
(no JS payload).

├── **API calls / form posts**
None.

├── **User interactions**
Anchor nav jumps; chart tooltips; heatmap cell `title` hovers. No re-rendering controls on this page.

├── **Loading behavior**
Charts render after `document.fonts.ready` (`charts.js:528-530`); each chart is wrapped in try/catch
so one broken chart never takes the page down (`charts.js:519-522`).

├── **Error behavior**
Standard schema-mismatch alert (`visualize.html:23-32`); per-chart console.error isolation.

├── **Empty behavior**
Histograms/standardized loops skip payloads without labels (`if hist.labels`); gender card omitted
when absent. Schema branch covers the rest.

├── **Responsive behavior**
`.chart-grid` → one column ≤820 px (`style.css:1348`); heatmap scrolls horizontally
(`.heat-scroll`); box-plot SVGs scale by `viewBox`.

└── **Visual hierarchy**
1. The in-page nav (orientation). 2. The histogram wall. 3. The heatmap — largest single visual.
4. Box plots as the "story" section. 5. Category bars at the foot.

---

### PAGE: Preprocessing (`/preprocess`)

├── **Purpose**
Stage 06. Prove the split and transforms are honest: stratified 80/20 split sealed before fitting,
train-only imputation means and z-score stats.

├── **Layout (sections in order)**
1. Page head.
2. "The split — sealed before anything is fit" metric strip.
3. "Feature set — 12 inputs, one target" transform table.
4. Stage pager.

├── **Components**
- **Split metrics** (`preprocess.html:41-58`): Training rows, Sealed test rows, Placed rate · train,
  Placed rate · test — with a note that matching rates confirm stratification (`preprocess.html:59-60`).
- **Transform table** (`preprocess.html:73-100`): per feature — name, imputed mean (train, accent),
  train std, transform description ("impute → z-score"); final row for `PlacementStatus` marked with
  a `role-target` pill. Sticky header + first column in a max-height scroll region. Footnote: stats
  computed on the training split only, then frozen (`preprocess.html:101-102`).

├── **Data sources**
`mb` (model bundle): `seed`, `split.{train,test,train_rate,test_rate}`, `features`, `impute_means`,
`scaler.std` — via `_model_stage_view` (`app.py:501-527`).

├── **API calls / form posts**
None.

├── **User interactions**
None beyond scroll; read-only transparency page.

├── **Loading behavior**
None.

├── **Error behavior**
Two-tier: schema-mismatch alert, or "Cannot preprocess this dataset — <model error>" with an upload
link (`preprocess.html:12-31`).

├── **Empty behavior**
Covered by the two alert branches.

├── **Responsive behavior**
Table scrolls; metrics reflow per global breakpoints.

└── **Visual hierarchy**
1. The four split metrics (the honesty proof). 2. The transform table with accented imputation
means.

---

### PAGE: Model Training (`/train`, GET with `?model=` query)

├── **Purpose**
Stage 07. Inspect any of the three trained candidates and run an interactive benchmark console over
any subset — the most interactive page in the app. View: `train_model()` (`app.py:530-566`).

├── **Layout (sections in order)**
1. Page head (meta adds "trained on N rows · assessed once on M sealed rows").
2. "Model selection" — GET form + (conditional) selected-model detail panel.
3. "Benchmark — the candidates, head to head" — controls, banner, table, grouped bar chart.
4. Stage pager.

├── **Components**
- **Model picker form** (`train.html:45-58`): `<select>` of models labelled "Name · CV ROC-AUC x.xxxx",
  a "Train & evaluate" submit, and a "Clear selection" secondary button when a selection is active.
  Submits `GET /train?model=<key>`.
- **Selected-model detail panel** (`train.html:67-133`): panel head with model name + Champion badge
  when applicable; a one-line role summary ("… · input z-scored · … · Platt sigmoid"); five metric
  cards (Accuracy, Precision, Recall, F1, ROC-AUC accented) as percents; meta line (sealed test,
  threshold 0.5, CV ROC-AUC mean ± std, folds, train rows, fit time); then an `.eval-duo` pair:
  CSS-grid **confusion matrix** (four labeled cells: tp/fn/fp/tn with axis captions and full
  `aria-label`) and a **single-model ROC curve** canvas (`data-chart="rocsel"`).
- **Benchmark console** (`train.html:149-164`): one checkbox per model (all checked), a
  "Re-train from scratch" checkbox with explanatory `title`, and a "Run benchmark" primary button —
  all inside `.needs-js` (hidden without JS; `<noscript>` explains the full three-model table below
  is always shown). Status line `#benchStatus` (`role="status" aria-live="polite"`) and error box
  `#benchError` (`role="alert"`, hidden by default).
- **Benchmark results** (`train.html:166-210`): banner ("Best performing model / <name> / highest
  cross-validated ROC-AUC — mean ± std over k folds · sealed-test ROC-AUC … · Brier …"), then a
  10-column table: Model (Best badge on champion row), Accuracy, Precision, Recall, F1, ROC-AUC
  (accent), Brier ↓, Log-loss ↓, CV ROC-AUC · k-fold (mean ± std), Train time.
- **Benchmark chart** (`train.html:212-221`): grouped bar — metric groups on x, one bar per model,
  fixed model colors (`buildBenchmark`, `charts.js:352-400`).

├── **Data sources**
`mb` (models[] with key/name/note/needs_scaling/settings/calibration/metrics/cv_auc_mean/cv_auc_std/
train_time/confusion/roc, `best`, `best_key`, `cv_folds`, `cv_rows`, `split`, `seed`), `selected`,
`requested_model`. Embedded payload `window.MODEL_PAGE` (`train.html:239-247`).

├── **API calls / form posts**
- `GET /train?model=<key>` — drill-down navigation (server round-trip in the live app).
- `POST /api/benchmark` — JSON `{models: [keys…], fresh: bool}` from `script.js:358-362`; response
  re-renders banner + table + chart client-side (`renderBenchmark`, `script.js:314-317`). Strict
  boolean handling of `fresh` server-side (`app.py:878-884`).

├── **User interactions**
- Pick a model → submit → page reloads with the detail panel (live) or renders it client-side from
  `window.MODEL_PAGE` including a dynamic ROC chart (static build, `script.js:280-303`); the panel
  smooth-scrolls into view (`script.js:287`).
- "Clear selection" → bare `/train`.
- Toggle model checkboxes / fresh checkbox → "Run benchmark" → async POST → results swap in place.
- Unknown `?model=` key renders a red alert naming the bad key — never a 404 (`train.html:60-65`,
  `app.py:543-552`).

├── **Loading behavior**
The richest in the app. Submit of the picker → `setBusy(btn, "Evaluating…")` (`script.js:298-302`).
Benchmark run → `setBusy(benchRun, "Benchmarking…")` plus a contextual status sentence that differs
for fresh vs cached runs ("Re-training from scratch — … tens of seconds on the free host." /
"Training & evaluating — a first run … ~40 s …; cached runs answer instantly.") (`script.js:353-356`).
Button always restored in `finally` (`script.js:380-384`).

├── **Error behavior**
- Benchmark failure → `#benchError` populated **via textContent/DOM nodes only** (comment at
  `script.js:319-321`: the API echoes request values, so innerHTML would be an XSS hole) with a
  "Benchmark failed" strong lead.
- No models checked → status line "Select at least one model to benchmark." (`script.js:349-352`).
- Static build or network failure → falls back to filtering the embedded recorded run, with a status
  note saying exactly that (`script.js:331-343`, `:369-379`).
- Non-JSON / non-200 responses surface the server error text or `HTTP <status>` (`script.js:363-373`).

├── **Empty behavior**
No-selection state: detail area simply absent; picker shows placeholder "Choose a model to inspect…".
Benchmark table always renders all three models server-side before any interaction.

├── **Responsive behavior**
`.eval-duo` → one column ≤820 px; `.model-pick-field` goes full-width and `.metrics-auto` → 2 columns
≤820 px (`style.css:1349`, `:1508-1512`); confusion-matrix grid re-sizes at ≤820 px
(`style.css:1353`).

└── **Visual hierarchy**
1. The picker (the action). 2. The selected-model panel with its five big percent metrics.
3. The benchmark banner naming the best model. 4. The 10-column table. 5. The grouped bar chart.

---

### PAGE: Model Evaluation (`/evaluate`)

├── **Purpose**
Stage 08. "One honest look at the sealed test set" — the verdict page: full metric table, ROC and
reliability curves for all models, champion confusion matrix, and Random Forest feature importance.

├── **Layout (sections in order)**
1. Page head (meta adds "assessed once on N sealed rows").
2. "The verdict — sealed test set, threshold 0.5" metric table.
3. "ROC curves — ranking quality, all models" chart.
4. "Reliability curves" chart + calibration explainer.
5. Duo: confusion matrix (champion) + feature importance chart.
6. Stage pager.

├── **Components**
- **Verdict table** (`evaluate.html:40-71`): 8 columns (Model, Accuracy, Precision, Recall, F1,
  ROC-AUC accent, Brier ↓, Log-loss ↓), 4-dp formatting, champion row highlighted with
  `.champion-row` + "Champion" badge. Footnote explains Brier/log-loss vs ROC-AUC under calibration
  (`evaluate.html:72-74`).
- **ROC chart** (`evaluate.html:83-92`): one line per model (fixed per-model colors) + dashed chance
  diagonal; legend entries include the AUC ("Name · 0.9823") (`buildRoc`, `charts.js:270-307`).
- **Reliability chart** (`evaluate.html:94-108`): observed placement rate vs predicted probability
  per model + dashed perfect-calibration diagonal; legend includes Brier score. Long footnote
  explains binning and Platt calibration on 3-fold out-of-fold predictions (`buildCalibration`,
  `charts.js:311-349`).
- **Confusion matrix** (`evaluate.html:110-127`): pure CSS grid for the champion — four cells with
  big counts and captions (true positive / false negative / false positive / true negative), axis
  labels "Predicted placed/not" × "Actually placed/not", complete `role="img"` `aria-label`.
- **Feature importance** (`evaluate.html:129-139`): horizontal bar (reuses `buildInfluence` with
  axis title "mean decrease in impurity", `charts.js:507`).
- Closing note: "The sealed set was touched exactly once — this page." (`evaluate.html:141-142`).

├── **Data sources**
`mb.models` (incl. per-model `roc` and `reliability` curves), `mb.best`, `mb.confusion`,
`mb.importance`, `mb.split.test`. Payload: `window.EDA = {models, importance}` (`evaluate.html:153-156`).

├── **API calls / form posts**
None.

├── **User interactions**
Chart tooltips (ROC tooltip titles show "FPR x.xxx"; reliability titles "predicted x.xx"); links to
train/predict pages in the closing note. Otherwise read-only.

├── **Loading behavior**
None beyond deferred chart render.

├── **Error behavior**
Two-tier alerts: schema mismatch, or "Cannot evaluate this dataset — <model error>"
(`evaluate.html:12-31`).

├── **Empty behavior**
Covered by alert branches.

├── **Responsive behavior**
`.eval-duo` → one column ≤820 px; `.cm-grid` re-sizes; charts scale via `maintainAspectRatio: false`
inside fixed-height wraps.

└── **Visual hierarchy**
1. The verdict table with its gold ROC-AUC column and Champion badge. 2. The ROC curves.
3. The reliability curves (the differentiator most apps skip). 4. Confusion matrix + importance duo.

---

### PAGE: Predict Placement (`/predict`, GET + POST)

├── **Purpose**
Stage 09 and the payoff: enter a student profile, choose a model (default: recommended best), get a
placement call with calibrated probability. View: `predict_placement()` (`app.py:607-684`).

├── **Layout (sections in order)**
1. Page head. Meta line is dynamic: when models are ready it reads "Recommended · <champion> ·
   ROC-AUC x.xxxx"; otherwise "Dataset · <name>" (`predict.html:9`).
2. Validation error alert (conditional).
3. Two-column predict grid: form left, sticky result panel right.
4. Stage pager.

├── **Components**
- **Form, three semantic fieldsets** (`predict.html:45-65`):
  - *Academic*: CGPA, AttendancePercent.
  - *Experience*: Internships, Projects, Workshops, Certifications, Publications, ExtraCurricular.
  - *Skill scores*: AptitudeTestScore, SoftSkillsRating, CodingTestScore, MockInterviewScore.
  Each input is `type="number"` with server-provided `min`/`max`/`step`, `inputmode="decimal"`,
  placeholder = median default, current value preserved on re-render, `input-error` class when
  invalid, and a hint line "min–max · blank = median <default>" (`predict.html:53-61`).
- **Model fieldset** (`predict.html:67-79`): `<select>` with "Best model — <name> (recommended)"
  plus one option per model labelled "Name · ROC-AUC x.xxxx"; static hint explains how "best" is
  chosen.
- **Submit**: "Predict placement" primary button; note "Blank inputs fall back to the dataset
  median." (`predict.html:81-82`).
- **Result panel** (`predict.html:85-116`, `aria-live="polite"`):
  - Filled state: kicker "Prediction · <model>" + "Best model" badge when champion; big verdict
    "Placed" / "Not placed" (panel tinted via `.result-placed` / `.result-not`); probability track
    filled to N%; meta row "N% probability · threshold 50%"; fact list (Model used, Placement
    probability, Model ROC-AUC); and a responsible-AI explanation sentence banded by distance from
    the threshold (`_prediction_note`, `app.py:589-604` — e.g. "…leans toward placement, though the
    margin is modest… a calibrated statistical estimate … not a guarantee").
  - Idle state: "Awaiting input", an em-dash verdict, and guidance copy naming the recommended best
    model (`predict.html:107-114`).

├── **Data sources**
`mb` (models, best, `form_meta` with per-field min/max/step/default), `model_ready`, `result`,
`errors`, `invalid_fields`, `values`, `selected_model`. Embedded for the static build:
`window.LR_MODEL` (exported logistic baseline incl. Platt calibrator), `window.FORM_META`,
`window.CHAMPION` (`predict.html:127-134`).

├── **API calls / form posts**
- `POST /predict` — urlencoded form: `model` + the 12 feature fields. Server validation per field:
  blank → median default; non-numeric → "not a number" error; out of observed range → range error;
  unknown model → error listing valid choices (`app.py:628-650`). Errors re-render the page with all
  entered `values` preserved and `invalid_fields` highlighted.
- (Static build only) `POST {LIVE_API}/api/predict` with 9 s AbortController timeout, falling back
  to an in-browser logistic + Platt-calibrated computation (`script.js:213-258`).

├── **User interactions**
- Edit fields; leaving an invalid field fires the native validation popup immediately
  (`script.js:416-422`).
- Change model dropdown.
- Submit → busy button "Predicting…" (`script.js:263-269`) → page reloads with the result panel
  filled.
- Result panel announces politely to screen readers (`aria-live="polite"`).

├── **Loading behavior**
Spinner-in-button on submit via `setBusy`; bfcache restore prevents a stuck spinner when navigating
back (`script.js:139-141`).

├── **Error behavior**
Field-level: red input border (`.input-error`) + red hint (`.field-hint-error`). Form-level: red
alert listing every error above the grid (`predict.html:36-41`). Model-not-ready / schema-mismatch
states replace the whole grid with explanatory alerts and an upload link (`predict.html:12-31`).

├── **Empty behavior**
The idle result panel is a designed empty state ("Awaiting input …") — no blank sidebar.

├── **Responsive behavior**
`.predict-grid` and `.predict-fields` → one column ≤820 px; the result panel loses its sticky
positioning on mobile (`style.css:1350-1352`).

└── **Visual hierarchy**
1. The result panel (sticky, right side) — even idle it anchors the page. 2. The fieldset groups.
3. The model dropdown with its "recommended" framing. 4. The submit button.

---

### PAGE: Stage stub (`stage.html`, route `/<id>` for any non-live stage)

├── **Purpose**
Placeholder for pipeline stages not yet wired up. **Currently unreachable** — all nine stages are in
`LIVE_STAGES` (`app.py:687-690`), so the loop at `app.py:915-922` registers no stub routes. It
exists so a future non-live stage keeps routing, sidebar, and pager for free (`_make_stage_view`,
`app.py:896-912`).

├── **Layout**: Page head → badge "Stage NN · Planned" → explanatory paragraph → pager
(`stage.html:13-21`).

├── **Components / Data / API / Interactions / Loading / Error / Empty**: none beyond the pager;
content is static text. Responsive: inherits shell. Visual hierarchy: the "Planned" badge first.

---

### PAGE: Error (`error.html`, routes: 404 / 413 / 500 / any HTTPException)

├── **Purpose**
Branded, plain-language HTTP error pages that keep the sidebar navigation available.

├── **Layout / Components**
Page head only: kicker "Error {code}", H1 (`Page not found` / `File too large` / `Something broke on
our side` / exception name), human message, and two buttons — "Back to overview" (primary, `/`) and
"Upload page" (secondary, `/upload`) (`error.html:5-13`; handlers `app.py:925-971`). The 413 handler
sets `active_step="upload"` so the sidebar highlights stage 01 (`app.py:945`).

├── **Data sources**: `code`, `title`, `message` passed by each handler.
├── **API calls / form posts**: none.
├── **User interactions**: the two recovery buttons; full sidebar navigation remains.
├── **Loading behavior**: none.
├── **Error behavior**: this *is* the error behavior; the catch-all HTTPException handler guarantees
no unstyled error ever shows.
├── **Empty behavior**: n/a.
├── **Responsive behavior**: inherits shell.
└── **Visual hierarchy**: code → title → message → recovery buttons.

---

## 3. USER JOURNEY MAP

Built from actual links, buttons, and redirects in the templates — not from assumed intent.

```
                         ┌──────────────────────────────────────────────┐
                         │  SIDEBAR (always present): brand → /         │
                         │  stepper 01..09 → every stage, any order     │
                         │  "← Overview" → /                            │
                         └──────────────────────────────────────────────┘

  / (Overview)
   │ "Start the pipeline" (btn-primary)                    "Explore the data" (btn-secondary)
   ▼                                                        ▼
  /upload ──POST file──▶ /upload (preview panel)           /visualize (anchor nav: distributions →
   │                       │ "Continue to Analyse            standardized → correlations → splits →
   │ "Remove file"          │  Features →"                   categories)
   │  (POST /upload/clear)  ▼                                 │ footer pager "Stage 06 →"
   └──────▶ /upload       /features ◀── deep-links from home group-index (#group-<slug>)
      (default dataset)    │ pager "Stage 03 →"
                           ▼
                          /descriptive ──link──▶ /missing ("counts below… reflect missing values")
                           │ pager                    ▲
                           ▼                         │ pager "Stage 04 →"
                          /missing ──────────────────┘
                           │ pager "Stage 05 →"
                           ▼
                          /visualize
                           │ pager "Stage 06 →"
                           ▼
                          /preprocess
                           │ pager "Stage 07 →"
                           ▼
                          /train ──GET ?model=<key>──▶ /train (model detail panel)
                           │  │ "Clear selection" → /train
                           │  └── "Run benchmark" ──POST /api/benchmark──▶ in-place re-render
                           │ pager "Stage 08 →"
                           ▼
                          /evaluate ──links──▶ /train ("evaluation page" cross-links both ways)
                           │ pager "Stage 09 →"
                           ▼
                          /predict ──POST form──▶ /predict (result panel filled; values preserved)
                                                  └── invalid input ──▶ same page, red fields

  Error branches from anywhere:
   - schema-mismatch upload ──▶ every stage page swaps content for alert + "Review the upload" → /upload
   - 404/413/500 ──▶ error.html ──▶ "Back to overview" / or "Upload page"
```

The intended happy path is strictly linear (01→09) and is reinforced three ways: the ordered
sidebar stepper, the prev/next pager at the foot of every stage page, and the "Continue to …"
CTA on `/upload`. Non-linear jumps are possible everywhere via the sidebar. The home page's
pipeline roadmap (`index.html:234-246`) is a third copy of the same ordered navigation.

---

## 4. INTERACTION PATTERN CATALOG

| # | Pattern | Description | Where used |
|---|---|---|---|
| 1 | **Pipeline stepper nav** | Ordered numbered stage list; active item gets `.is-active` + `aria-current="page"`; "Soon" badge for non-live stages; auto-scrolled into view on mobile | `base.html:29-40`, all pages |
| 2 | **Stage pager** | Prev/next two-cell footer nav ("← Stage NN Label" / "Stage NN → Label") | `_pager.html`, included by every stage page |
| 3 | **Server-render + JSON hydrate for charts** | Page embeds `window.EDA` / `window.MODEL_PAGE` via `tojson`; `charts.js` builds Chart.js charts into `<canvas data-chart="…" data-key="…">`; per-chart try/catch isolation; build deferred to `document.fonts.ready` | `index.html:257-261`, `visualize.html:218-224`, `missing.html:110-112`, `train.html:239-247`, `evaluate.html:153-156`; `charts.js:492-532` |
| 4 | **Chart.js chart types** | doughnut (donut, 62 % cutout); bar+line combo histograms (bars + tension-0.45 KDE line); plain bars (missing, red); horizontal bars (`indexAxis:'y'`, influence & importance); percent-axis bars 0–100 with `n=` tooltips (category, rate-by-feature); grouped bars (gender, benchmark); scatter-line ROC with dashed chance diagonal; reliability curves with dashed perfect diagonal | `charts.js:84-484` |
| 5 | **Fixed model color identity** | One color per model across every chart on every page: logistic = neutral grey, random forest = slate, gradient boosting = gold (`MODEL_COLORS`) | `charts.js:35-48` |
| 6 | **Chart palette & motion** | Dark theme: text `#EBECE8`, accent gold `#D9A63F`, danger red `#C65D55` (reserved for missing/not-placed), hairline grids, mono 10 px ticks, 450 ms easeOutQuart, disabled under `prefers-reduced-motion` | `charts.js:17-57` |
| 7 | **Server-rendered heatmap** | CSS grid (`--n` columns) with server-computed cell colors, values in cells, `title` tooltips, `.heat-strong` emphasis, 0→+1 legend bar | `index.html:149-169`, `visualize.html:99-119` |
| 8 | **Server-rendered SVG box plots** | Jinja macro draws whisker/box/median/mean from normalized server data; per-outcome coloring; footer "med X → Y · N outliers" | `visualize.html:4-13`, `:146-172` |
| 9 | **CSS confusion matrix** | Grid of labeled tp/fn/fp/tn cells with axis captions and full `aria-label` | `train.html:105-116`, `evaluate.html:115-126` |
| 10 | **Metric cards** | Big mono value + small label; `.metrics` row variants (`grid-3`, `metrics-rows`, `metrics-auto`); `text-danger` red for missing counts; `text-accent` gold for hero numbers (ROC-AUC, means) | every stage page |
| 11 | **Sticky scroll tables** | `.table-scroll` + `.table-sticky` sticky header, `.sticky-col` sticky first column, max-height variants `.scroll-68`/`.scroll-60` | `descriptive.html:30-31`, `preprocess.html:73-74`, `upload.html` |
| 12 | **Busy-button spinner** | `setBusy()` disables submit, injects `.spinner` + label ("Predicting…", "Evaluating…", "Benchmarking…"); restored in `finally` and on bfcache `pageshow` | `script.js:11-27`, `:139-141`, `:265-269`, `:298-302`, `:353` |
| 13 | **Native + server form validation** | HTML5 `min/max/step` on numeric inputs; blur triggers `reportValidity()` immediately; server re-validates, preserves all entered values, marks `invalid_fields` with red input + hint | `predict.html:53-61`, `script.js:416-422`, `app.py:633-650` |
| 14 | **Blank-means-median inputs** | Empty predict fields fall back to dataset medians, stated in the hint under every input and a note under the submit | `predict.html:60`, `:82`; `app.py:636-637` |
| 15 | **GET-form drill-down** | Model picker submits `GET /train?model=key` — shareable URL, server-rendered detail; unknown keys render an inline alert, never 404 | `train.html:45-58`, `app.py:543-552` |
| 16 | **Async benchmark console** | Checkbox subset + "fresh re-train" flag → `POST /api/benchmark` → banner/table/chart re-rendered client-side; `aria-live` status line; error box written via textContent only (XSS-safe) | `train.html:149-221`, `script.js:305-386` |
| 17 | **Drag-and-drop upload** | Label-wrapped hidden file input; `.is-dragover` highlight; dropped files assigned to the input; chosen filename displayed | `upload.html:23-28`, `script.js:424-456` |
| 18 | **Inline alerts, no toasts** | `.alert` (info) / `.alert.alert-error` blocks with bold lead and an `.alert-actions` link; `role="alert"` on dynamic ones | every stage's schema branch; `upload.html:15-20`, `predict.html:36-41`, `train.html:60-65` |
| 19 | **Schema-gate branch** | Every stage page starts with an identical `{% if not bundle.schema_ok %}` branch replacing content with an alert + "Review the upload" link | all stage templates |
| 20 | **Two-tier model-failure branch** | Model stages add `{% elif not mb.ok %}` — "Cannot train/evaluate/preprocess/predict … <error>" | `train.html:22-30`, `evaluate.html:22-30`, `preprocess.html:22-30`, `predict.html:22-30` |
| 21 | **Anchor sub-navigation** | In-page nav row linking to section anchors on long pages | `visualize.html:35-41`; home group-index deep-links `index.html:216` |
| 22 | **Champion/best framing** | Consistent "Champion"/"Best" badges, `.champion-row` table highlighting, "Best model — recommended" default option, `is_champion` badge in prediction result | `train.html:58`, `:72`, `:194`; `evaluate.html:58`; `predict.html:72`, `:90` |
| 23 | **Responsible-AI copy** | Probability explanations banded by distance from threshold, explicitly "not a guarantee"; sealed-set honesty notes | `app.py:589-604`, `evaluate.html:141-142`, `preprocess.html:59-60` |
| 24 | **Progressive enhancement / static fallback** | `.needs-js` hidden controls + `<noscript>` notes; static build re-renders from embedded JSON; predict falls back hosted-API → in-browser logistic baseline with 9 s timeout | `train.html:149`, `:164`; `script.js:136`, `:150-258`, `:331-343` |
| 25 | **Security headers & escaping** | nosniff/frame-deny/referrer-policy on every response; open CORS only on `/api/*`; network-sourced strings escaped before innerHTML (`esc()`), error box uses textContent | `app.py:68-81`, `script.js:33-34`, `:319-329` |
| 26 | **Reduced-motion & a11y** | Skip link; `aria-current`, `aria-live`, `role="img"` + aria-labels on every chart/matrix; reduced-motion media query kills animations (CSS) and chart animation (JS) | `base.html:15`; `style.css:100-103`; `charts.js:50`, `:56` |

---

## 5. UX SOPHISTICATION NOTES — what PropPulse must match or exceed

**Things that make this frontend feel complete and polished:**

1. **One data model, three navigation surfaces.** The `PIPELINE_STEPS` list drives the sidebar
   stepper, the home roadmap, and the foot pager from a single source (`app.py:103-212`). Stages
   feel like one guided flow, not nine pages. PropPulse should similarly unify its nav, home page,
   and page-to-page flow.
2. **Radical transparency as content.** The app narrates its own methodology in plain language on
   every stage: why split rates match (`preprocess.html:59-60`), why ROC-AUC is unchanged by
   calibration (`evaluate.html:72-74`), how the reliability curve works (`evaluate.html:103-107`),
   "the sealed set was touched exactly once" (`evaluate.html:141-142`). This is the strongest
   differentiator — the UI teaches.
3. **Every empty/error state is designed.** Schema mismatch, model-not-ready, idle prediction
   panel ("Awaiting input"), unknown model key, no-checkbox benchmark, 404/413/500 — each has
   specific, helpful copy and a recovery link. Nothing dead-ends.
4. **Honest loading states.** Buttons get spinners with task-specific labels and the status line
   sets time expectations ("~40 s on the free host"). bfcache handling prevents stuck spinners —
   a detail almost everyone misses.
5. **Server-rendered first, JS as enhancement.** Pages are fully meaningful without JavaScript
   (noscript notes, GET forms, server-rendered tables/heatmaps/SVG box plots). Charts hydrate from
   embedded JSON. The app even ships a static-build mode that degrades honestly instead of breaking.
6. **Restrained, consistent visual language.** One accent color (gold), red reserved semantically
   for missing/not-placed, fixed per-model colors across all charts, mono font for all numbers,
   hairline grids, 450 ms eased animations with reduced-motion support.
7. **Accessibility is structural, not bolted on.** Skip link, `aria-current`, `aria-live` result
   and status regions, `role="img"` with complete aria-labels on charts and the confusion matrix,
   semantic fieldsets/legends, native validation.
8. **Number formatting discipline.** Thousands separators everywhere, consistent 4-dp metrics in
   tables vs 1-dp percents in cards, `mean ± std` for CV scores, "Brier ↓" direction hints in
   headers.
9. **Champion framing.** The best model is identified once (by CV ROC-AUC, sealed set untouched)
   and then surfaced consistently — badges, highlighted rows, default dropdown option, prediction
   result badge. The user never has to compare raw numbers to know what to use.
10. **Security done quietly.** Escaped innerHTML for network data, textContent-only error rendering,
    per-session upload namespacing, path-traversal-safe filename handling, security headers,
    10 MB cap with a friendly 413 page.

**Where it falls short (opportunities for PropPulse to exceed):**

1. **No loading state on upload.** A 10 MB file POST shows no spinner or progress — the one gap in
   an otherwise thorough loading-story (`upload.html:29` has no JS wiring).
2. **Full page reload for predictions.** The predict form is a classic POST-reload; an inline
   fetch would feel faster (the static build already does client-side rendering — the live app
   doesn't).
3. **No table sorting/filtering/pagination.** Tables are scroll regions only; the preview caps at
   8 rows with no way to see more. `_pager.html` is a *stage* pager — there is no data pagination.
4. **No deep-linkable chart state.** The home histogram/rate `<select>` choices aren't in the URL;
   refresh resets to CGPA.
5. **Heatmap tooltips are native `title` attributes** — no styled tooltip, no click-to-inspect,
   and column labels on large matrices rely on horizontal scroll with rotated text.
6. **Client-side chart rebuilds destroy/recreate** Chart instances on toggle (fine) but with no
   transition between datasets (`charts.js:85-86`, `:404-405`).
7. **The stepper has no completion/progress state** — stages are live/soon only; there's no
   "done" marker as the user moves through the pipeline.
8. **Mobile sidebar becomes a horizontal scroller** (workable), but there is no persistent
   page-level heading of the current stage in the nav bar itself — orientation relies on the
   page head.

---

*Inventory compiled from a full read of the 14 templates/partials, both JS files, and app.py route
wiring listed in the sources table. CSS line references are from `static/css/style.css`
(media queries at lines 100, 1309, 1313, 1342, 1362, 1508).*
