# Button Audit — PropPulse × PlacementPredict (mission §39)

Date: 2026-08-10 · Auditor: QA compile agent (code-verified)
Method: every PropPulse control below was traced through `frontend/src/` to a real route, API
call, or handler (file:line cited); screenshots in `docs/screenshots/{reference,proppulse}/`
confirm placement. Live spot-checks against the running stack (frontend `:5300`, backend `:8200`):
`POST /predict` (the valuation "Estimate value" call) returned 200 with a real estimate
($163,061 on the example property), `GET /model/info` 200, `GET /health` 200. `npm run lint`
clean, `npm run build` green (3.89s) on this tree.
Reference column per `docs/frontend/PLACEMENTPREDICT_UI_BLUEPRINT.md` §5/§8.

**Status values:** `PASS` = matches reference position/style and works · `PASS (adapted)` =
reference logic reproduced with PropTech content · `DEVIATION` = deliberate, documented in
`UI_COMPARISON.md` → Documented deviations (D-numbers) · `FAIL` = exists visually but does not work.

**Dead-button verdict: zero FAIL rows.** No visually-present-but-unwired control was found
anywhere in the app. Selects, sort headers, tabs, checkboxes and `<summary>` disclosures count
as controls and are included.

---

## 1. Global chrome (every page)

| PlacementPredict button | Location | Purpose | PropPulse equivalent | Location | Purpose | Visual match | Functional match | Status |
|---|---|---|---|---|---|---|---|---|
| Sidebar stepper items 01–09 | sidebar, "Pipeline" caption | full-page nav to stage route | Sidebar stepper items 01–09 (`Link`, `li.is-active` + inset amber bar, `aria-current`) | sidebar, "Pipeline" caption | SPA nav to `/workflow/{slug}` (`Layout.jsx:176-189`, slugs from `stages.js:14-27`) | ✓ same item anatomy (step-num + label) | ✓ all 9 resolve | PASS |
| — (no product nav) | — | — | Product group: Overview / Valuation / Market Intelligence / Model Insights / Model Health | sidebar, under stepper | nav to the 5 champion pages (`Layout.jsx:25-31,191-203`) | same stepper skin, no step-num | ✓ all 5 resolve (`App.jsx:43-49`) | DEVIATION (D6) |
| "← Overview" | sidebar footer | back to home | "← Overview" | sidebar footer | `Link` → `/` (`Layout.jsx:206`) | ✓ | ✓ | PASS |
| Active dataset name (text) | sidebar footer | context | Active dataset id (text, from shell localStorage) | sidebar footer | context (`Layout.jsx:146-148,207`) | ✓ | ✓ (read-only text) | PASS |
| — (no API indicator) | — | — | API-status pill ("API connected/degraded/offline" + dot) | sidebar footer | click re-polls `GET /health` (`Layout.jsx:127-140,74-118`) | mono quiet chrome, on-system | ✓ live-verified (pill shows "API connected", green dot, screenshots 12/17) | DEVIATION (D1) |
| — (no banners) | — | — | "Retry connection" / "Re-check" (`btn-sm btn-secondary`) in down/degraded banners | top of main column | re-poll `GET /health` (`Layout.jsx:213-234`) | alert-language banner | ✓ handler wired; down-state not triggered live (backend up) | DEVIATION (D1) |
| Skip link "Skip to content" | top of shell | a11y jump to `#main` | Skip link "Skip to content" | top of shell | `href="#main"` (`Layout.jsx:165`) | ✓ appears on focus | ✓ | PASS |
| Stage pager "← Stage NN" / "Stage NN →" | foot of stages 01–09 | prev/next stage | Stage pager links (12-stage chain, `?dataset=` preserved) | foot of every stage 01–12, rendered once by the shell | prev/next stage (`StagePager.jsx:21-43`, mounted at `WorkflowShell.jsx:397`) | ✓ hairline top, mono dir + 14px label | ✓ all links resolve; prev empty on 01, next omitted on 12 | PASS (adapted — 12 stages, D7) |
| — (server-rendered, no dataset switcher) | — | — | Dataset chip + dropdown rows + per-row "Delete"/"Cancel" + "Upload a new CSV →" | workbench context strip, right | switch dataset (`?dataset=`), inline-confirm `DELETE /workflow/datasets/{id}` (`DatasetPicker.jsx:90-205`) | quiet mono chip, hairline dropdown | ✓ wired; delete not exercised (destructive — code-traced only) | DEVIATION (D8) |
| — (no toasts) | — | — | Toast dismiss "×" | bottom-right region | dismiss transient notice (`styles.css:1653`, `Toast.jsx`) | floating layer w/ the one allowed shadow | ✓ | DEVIATION (D2) |
| — (no client errors) | — | — | "Try again" (`btn-secondary btn-sm`, shared `ErrorState`) | every error box, app-wide | re-invokes the failed fetch (`StateView.jsx:50-64`) | ✓ reference alert language | ✓ every instance traced to a real `reload` | PASS (adapted, D2) |

## 2. Overview — `/` (blueprint §8.1)

| PlacementPredict button | Location | Purpose | PropPulse equivalent | Location | Purpose | Visual match | Functional match | Status |
|---|---|---|---|---|---|---|---|---|
| "Start the pipeline" (btn-primary) | hero left, 1st | → `/upload` | "Start the pipeline" (btn-primary) | hero left, 1st | `Link` → `/workflow/01-upload` (`Hero.jsx:21-23`) | ✓ | ✓ | PASS |
| "Explore the data" (btn-secondary) | hero left, 2nd | → `/visualize` | "Explore the data" (btn-secondary) | hero left, 2nd | `Link` → `/workflow/05-viz` (`Hero.jsx:24-26`) | ✓ | ✓ | PASS |
| "Upload a different file →" (quiet link) | dataset panel body | → `/upload` | "Inspect the model →" (quiet `.section-link`) | Active-model panel body | `Link` → `/model` (`ActiveModelPanel.jsx:102-104`) | ✓ same quiet mono link | ✓ (different destination — panel anchors the champion, not an upload) | DEVIATION (D10) |
| Head select on "Feature distribution" (`.chart-select`, 10 fields) | chart card ② head | rebuild histogram client-side | Head select on "Field distribution" (`.chart-select`, 5 fields) | chart card ② head | refetch `GET /workflow/datasets/ames/viz/histogram?column=…`, per-column cache (`OverviewCharts.jsx:215-228,246-257`) | ✓ compact mono select | ✓ wired | PASS (adapted) |
| Head select on "Placement rate by feature" (12 fields) | wide card ③ head | rebuild % bars | Head select on "Median sale price by field" (4 fields) | wide card ③ head | refetch `GET …/viz/category?column=…` (`OverviewCharts.jsx:342-355,369-380`) | ✓ | ✓ wired | PASS (adapted) |
| "Full analysis →" (head link) | drivers section head, right | → `/visualize` | "Full analysis →" | "What drives the price" head, right | `Link` → `/model` (`Overview.jsx:470-472`) | ✓ | ✓ | PASS (adapted) |
| "All 31 fields →" (head link) | record section head, right | → `/features` | "All 81 fields →" (count live) | "The record, at a glance" head, right | `Link` → `/workflow/02-features` (`Overview.jsx:497-499`) | ✓ | ✓ | PASS |
| 6 group tiles (`.group-cell`) | group-index grid | → `/features#group-{slug}` | 8 group tiles | group-index grid | `Link` → `/workflow/02-features` — plain, **no `#group-` anchor** (`Overview.jsx:521-533`) | ✓ hairline tiles | ✓ links work; anchor contract absent (anchors exist on stage 02, nothing links to them) | DEVIATION (D15) |
| 9 pipeline rows (`.pipeline-row` + "Live" pill + →) | "The pipeline" `ol` | → stage routes | 9 pipeline rows | "The pipeline" `ol` | `Link` → `/workflow/{slug}` 01–09 (`Overview.jsx:568-582`) | ✓ | ✓ all resolve; note: rows 08/09 read "Live" even when the shell gates them — the link lands on a designed locked state, not a dead end | PASS (adapted; pill nuance noted D7) |
| — | — | — | "Open market intelligence" / "Open Visualization" / "Analyse features" (`btn-secondary btn-sm`) | empty states of donut / histogram / tiles | `Link` → `/market`, `/workflow/05-viz`, `/workflow/02-features` (`OverviewCharts.jsx:128-130,269-271`; `Overview.jsx:515-517`) | quiet secondary | ✓ | DEVIATION (D2 — client-rendered empty states) |

## 3. Stage 01 — Upload Dataset (blueprint §8.2)

| PlacementPredict button | Location | Purpose | PropPulse equivalent | Location | Purpose | Visual match | Functional match | Status |
|---|---|---|---|---|---|---|---|---|
| Dropzone (label + hidden file input) | upload form, full width | open file picker; drag-over state | Dropzone `label.upload-drop` + hidden `input[type=file]` | upload form, full width | file picker + drag-drop; client pre-checks (.csv, non-empty, ≤10 MiB) with inline `role=alert` line (`UploadDropzone.jsx:30-95`) | ✓ dashed 1.5px, hover/focus-within accent | ✓ | PASS |
| "Upload dataset" (btn-primary) | directly below dropzone, left | POST multipart upload | "Upload dataset" (btn-primary, BusyButton) | directly below dropzone, left | raw-body `POST /workflow/datasets?filename=…` (`UploadStage.jsx:246-265,289-297`; `api/workflow.js:270-278`); busy "Uploading…" | ✓ | ✓ wired; disabled until a file is selected (reference server-roundtrips the empty case — D17) | PASS (adapted) |
| "Remove file" (`link-quiet`) | loaded panel header (uploaded only) | POST `/upload/clear` | "Remove file" (`link-quiet`) → inline confirm row: "Confirm remove" (`btn-sm btn-secondary`, busy "Removing…") + "Cancel" (`link-quiet`) | loaded panel header (uploaded + deletable only) | `DELETE /workflow/datasets/{id}` → switch to `ames` + toast (`UploadStage.jsx:60-137`; `api/workflow.js:296-301`) | ✓ quiet danger-hover link | ✓ wired (not exercised — destructive; code-traced) | PASS (adapted — inline confirm instead of direct POST) |
| "Continue to Analyse Features →" (btn-primary) | bottom-left | → `/features` | "Continue to Analyse Features →" (btn-primary, `mt-28`) | bottom of loaded panel, left | `goToStage('02-features')` → `/workflow/02-features?dataset=…` (`UploadStage.jsx:226-232`) | ✓ | ✓ | PASS |
| — | — | — | Validation report per-check rows (✓ / ! / ✕ glyphs) | below the form | 422 per-check feedback (`ValidationReport.jsx:170-219`) | reference has a one-line error only | n/a (display, not a control) | DEVIATION (D19) |

## 4. Stage 02 — Analyse Features (blueprint §8.3)

Reference has **no page-level buttons besides nav/pager** — PropPulse matches.

| PlacementPredict button | Location | Purpose | PropPulse equivalent | Location | Purpose | Visual match | Functional match | Status |
|---|---|---|---|---|---|---|---|---|
| — (none) | — | — | "Reload analysis" (`btn-secondary btn-sm`) | registry empty state | re-fetch `GET …/features` (`FeaturesStage.jsx:94-96`) | quiet secondary | ✓ (empty state unreachable on bundled Ames — code-traced) | DEVIATION (D2) |
| — (none) | — | — | "Try again" (shared ErrorState) | error section | re-fetch (`FeaturesStage.jsx:58`) | ✓ | ✓ | PASS (adapted) |

Registry groups carry deep-link anchors `#group-{id}` (`FeatureTable.jsx:128`); the "Prediction
objectives" cards (TargetCards) are presentational, no controls.

## 5. Stage 03 — Descriptive Statistics (blueprint §8.4)

| PlacementPredict button | Location | Purpose | PropPulse equivalent | Location | Purpose | Visual match | Functional match | Status |
|---|---|---|---|---|---|---|---|---|
| Footnote accent link → `/missing` | table footnote | cross-stage nav | "Missing Values" accent link | table footnote | `Link` → `/workflow/04-missing?dataset=…` (`StatsStage.jsx:180`) | ✓ amber prose link | ✓ | PASS |
| — (none else) | — | — | "Review the upload" (`btn-secondary btn-sm`) | EmptyState (no numeric fields) | `Link` → `/workflow/01-upload?dataset=…` (`StatsStage.jsx:106-111`) | quiet secondary | ✓ (code-traced) | DEVIATION (D2) |

## 6. Stage 04 — Missing Values (blueprint §8.5)

Reference has **no page-level buttons besides nav/pager** — PropPulse matches.

| PlacementPredict button | Location | Purpose | PropPulse equivalent | Location | Purpose | Visual match | Functional match | Status |
|---|---|---|---|---|---|---|---|---|
| — (none) | — | — | "Continue to stage 05 — Visualization →" (`btn-primary btn-sm`) | EmptyState (`total_missing === 0`) | `Link` → `/workflow/05-viz?dataset=…` (`MissingStage.jsx:264-269`) | primary sm | ✓ (bundled Ames has 7,829 missing cells — branch code-traced only) | DEVIATION (D2) |
| — (none) | — | — | "Try again" (shared ErrorState) | error section | re-fetch `GET …/missing` (`MissingStage.jsx:146-150`) | ✓ | ✓ | PASS (adapted) |

## 7. Stage 05 — Visualization (blueprint §8.6)

| PlacementPredict button | Location | Purpose | PropPulse equivalent | Location | Purpose | Visual match | Functional match | Status |
|---|---|---|---|---|---|---|---|---|
| Viz-nav anchors ×5 (Distributions · Standardized · Correlations · Status splits · Categories) | sticky sub-nav | in-page scroll | Viz-nav anchors ×4 (Distributions · Correlations · Categories · Relationships) | sticky sub-nav (`top 0`, hairline) | `href="#…"` in-page sections (`VizExplorer.jsx:855-860`) | ✓ | ✓ all 4 land (`scroll-margin-top: 48px`) | DEVIATION (D33 — endpoint set has no z-score/boxplot source; Relationships added) |
| — (static server charts; home carries the select pattern) | — | — | Histogram field switchers ×6 (`.chart-select` + "μ x · σ y" tag) | histogram card heads | refetch `GET …/viz/histogram?column=…` (`VizExplorer.jsx:288-305`) | ✓ compact mono select | ✓ wired; card dims during refetch | PASS (adapted, D34) |
| — | — | — | Scatter x/y switchers (2 × `.chart-select` with mono "x"/"y" labels) | Relationships card head | refetch `GET …/viz/scatter?x=…&y=…` (`VizExplorer.jsx:720-746`) | ✓ | ✓ wired | PASS (adapted, D33) |
| — | — | — | "Try again" (`btn-secondary btn-sm`) per chart card + correlation section + column list | in-card `.wfv-card-alert` / section ErrorState | re-fire the failed fetch (`VizExplorer.jsx:176-188,308,483-485,610,750,837-843`) | ✓ | ✓ | PASS (adapted, D2) |

Heatmap cells are hover-only (1.5px accent outline + `title` tooltip) — matches the reference's
non-clickable heat grid.

## 8. Stage 06 — Preprocessing (blueprint §8.7)

Reference page has **no controls** (static report). PropPulse's stage runs a real configurable
preprocess, so the config controls are additions in the reference's form language.

| PlacementPredict button | Location | Purpose | PropPulse equivalent | Location | Purpose | Visual match | Functional match | Status |
|---|---|---|---|---|---|---|---|---|
| — (none) | — | — | Outlier-rule checkbox (`.check-input`) | config panel | set config (`PreprocessConfig.jsx:42-47`) | ✓ accent checkbox | ✓ | DEVIATION (D42) |
| — (none) | — | — | Split-strategy select `#wf-split-strategy` (`.select`) | config panel | set config (`PreprocessConfig.jsx:62-68`) | ✓ | ✓ | DEVIATION (D42) |
| — (none) | — | — | "Advanced — fractions & seed" `<summary>` + val/test fraction + seed inputs | config panel | set config, invalid → `.field-error` (`PreprocessConfig.jsx:76-132`) | ✓ fieldset disclosure | ✓ | DEVIATION (D42) |
| — (none) | — | — | **"Run preprocessing"** (btn-primary, BusyButton, busy "Running preprocessing…") | config actions row, left | `POST /workflow/datasets/{id}/preprocess/preview` (runs **and** persists) → toast + state reload (`PreprocessStage.jsx:298-315,403-415`; `api/workflow.js:376-383`); disabled + title hint when fractions invalid | ✓ primary placement per reference CTA logic | ✓ wired (not exercised — mutation; code-traced) | DEVIATION (D42) |
| — (none) | — | — | 7 × step `<summary>` accordions (`.wf-step`) | pipeline section | native disclosure of per-step details (`PreprocessStage.jsx:521-533`) | ✓ quiet disclosure | ✓ native | DEVIATION (D41) |
| — (none) | — | — | "Back to stage 01 — Upload" (`btn-secondary btn-sm`) | 400 run-error alert | `Link` → `/workflow/01-upload?dataset=…` (`PreprocessStage.jsx:392-397`) | ✓ | ✓ (code-traced) | DEVIATION (D2/D42) |

## 9. Stage 07 — Model Training (blueprint §8.8)

| PlacementPredict button | Location | Purpose | PropPulse equivalent | Location | Purpose | Visual match | Functional match | Status |
|---|---|---|---|---|---|---|---|---|
| Model inspect select ("Choose a model to inspect…") | model-pick row | GET `?model=` detail | "Inspect a trained candidate" select `#wftp-inspect` ("Choose a candidate to inspect…") | `.model-pick` row | open candidate detail panel (`TrainStage.jsx:559-566`) | ✓ row layout, hint below | ✓ | PASS (adapted) |
| "Train & evaluate" (btn-primary) | model-pick row | submit GET form | — (superseded by the async job flow) | — | — | — | — | DEVIATION (D43) |
| "Clear selection" (btn-secondary) | model-pick row (when selected) | → `/train` | "Clear selection" (btn-secondary) | `.model-pick` row (when selected) | `setInspected(null)` (`TrainStage.jsx:582-588`) | ✓ | ✓ | PASS |
| 3 pre-checked model checkboxes + "Re-train from scratch" (`.bench-controls.needs-js`) | benchmark section | pick benchmark subset | Objective tabs Regression / Classification / Clustering (`.wf-tab`, `aria-selected`) + candidate checkboxes (`.wf-check` + `.check-input.bench-check`, e2e-pinned class) | train panel | switch objective / pick candidates (`TrainStage.jsx:491-505`; `TrainPanel.jsx:47-55`) | ✓ amber checkboxes; tabs are an addition | ✓ | DEVIATION (D43/D47) |
| "Run benchmark" (btn-primary, busy "Benchmarking…") | benchmark controls | `POST /api/benchmark` re-run | **"Start training"** (btn-primary, BusyButton, busy "Starting job…") | train panel actions | `POST /workflow/datasets/{id}/jobs` → **202** → polling + `?job=` mirror + toast (`TrainPanel.jsx:65-79`; `TrainStage.jsx:400-416`; `api/workflow.js:396-402`); disabled with title reason when blocked/none selected | ✓ primary, same action slot | ✓ wired (not exercised — starts a real job; code-traced; backend route `workflow_jobs.py:24-26`) | DEVIATION (D43/D47 — training **is** the benchmark run; label kept for frozen e2e) |
| — (status line `role=status`) | — | — | "View job_xxxxxxxx" (`btn-secondary btn-sm`) | 409 alert | focus the running job in JobStatus (`TrainStage.jsx:539-548`) | ✓ | ✓ (code-traced) | DEVIATION (D43) |
| — (detail panel has no onward CTA) | — | — | "Open full evaluation — stage 08 →" (btn-secondary Link) | candidate detail panel | → `/workflow/08-evaluate?dataset=…&job=…` (`TrainStage.jsx:288-293`) | ✓ | ✓ | PASS (adapted, D44) |
| — (no job history in reference) | — | — | JobsList per-row "View" (`btn-secondary btn-sm`) + "Evaluate →" (`btn-secondary btn-sm` Link, done jobs only) | job history table | load job into live panel / → stage 08 (`JobsList.jsx:69-83`) | ✓ dense table actions | ✓ | DEVIATION (D43 — real async jobs need history) |
| Benchmark table headers (static, unsorted) | benchmark table | — | Sort headers on every verdict column (`.sort-header` th-button, mono ↑/↓, `aria-sort`, asc→desc→natural) | comparison table thead | client sort (`ComparisonTable.jsx:196-213`; `useSortable.js:32-38`) | ✓ same th typography | ✓ | DEVIATION (D45 — e2e-pinned feature) |

Benchmark banner ("Best performing model" kicker + 20px accent name + mono sub), the wide
grouped-bar card ("Validation metrics by model") and the closing note links
(`evaluation stage` / `prediction stage`, `TrainStage.jsx:673-675`) reproduce the reference
sections around the real job data.

## 10. Stage 08 — Model Evaluation (blueprint §8.9)

| PlacementPredict button | Location | Purpose | PropPulse equivalent | Location | Purpose | Visual match | Functional match | Status |
|---|---|---|---|---|---|---|---|---|
| — (all models on shared charts; no picker) | — | — | Job select `#wf-eval-job` + Candidate select `#wf-eval-candidate` (`.select`, optgroups per objective) | candidate panel, under page-head | switch evaluation target; honors `?job=` deep link (`EvaluateStage.jsx:169-205`) | ✓ model-pick language | ✓ | DEVIATION (D50 — API is per-candidate) |
| Verdict table headers (static) | verdict table | — | Sort headers on every column (`aria-sort`, mono ↑/↓); 4dp metrics on this stage | verdict table thead | client sort (`ComparisonTable.jsx:196-213`; `metricDigits={4}` at `EvaluateStage.jsx:224`) | ✓ | ✓ | DEVIATION (D49) |
| — (reference has no empty state) | — | — | "Go to stage 07 — Model Training" (`btn-primary btn-sm`) | EmptyState (zero evaluable jobs) | `Link` → `/workflow/07-train?dataset=…` (`EvaluateStage.jsx:121-126`) | ✓ | ✓ | DEVIATION (D2) — CTA label visibility fixed 2026-08-09 (F1: was amber-on-amber; prose-link rules now scoped `:not(.btn)`) |
| — | — | — | "Try again" ×3 (job list / comparison / workspace ErrorStates) | per section | re-fetch (`EvaluateStage.jsx:108`; `EvaluationWorkspace.jsx:896-913`) | ✓ | ✓ | PASS (adapted) |

## 11. Stage 09 — Predict Property, sandbox (blueprint §8.10)

| PlacementPredict button | Location | Purpose | PropPulse equivalent | Location | Purpose | Visual match | Functional match | Status |
|---|---|---|---|---|---|---|---|---|
| Model select ("Best model — {name} (recommended)" + named models) | "Model" fieldset | pick predictor | Training-run select `#wf-sb-job` + Model select `#wf-sb-candidate` (first option "Best model — {name} (recommended)", others "{name} · RMSLE/ROC-AUC {4dp}") | "Model" fieldset | pick job + candidate (`SandboxPredictPanel.jsx:104,368-372,512-553`); disabled while submitting | ✓ same fieldset + hint | ✓ | PASS (adapted, D55 — run select added; no `value="best"` alias) |
| "Predict placement" (btn-primary, busy "Predicting…") | form foot, left | POST predict | "Predict with sandbox model" (regression) / "Predict sale likelihood" (classification) (btn-primary BusyButton, busy "Predicting…") | form foot, left, first | client validation → `POST /workflow/jobs/{job}/predict/{candidate}` (`PropertyForm.jsx:149-168,234-241`; `SandboxPredictPanel.jsx:386-419,570-575`; `api/workflow.js:444-450`) | ✓ | ✓ wired (not exercised against a job — code-traced; endpoint verified server-side `workflow_jobs.py:91`) | PASS (adapted) |
| — (no secondaries) | — | — | "Load example property" + "Reset" (btn-secondary ×2) | form foot, after primary | seed defaults / reset + clear (`PropertyForm.jsx:242-257`) | ✓ quiet secondaries | ✓ | DEVIATION (D61) |
| — (no example/reset) | — | — | "Advanced overrides" `<summary>` disclosure | form, above submit row | native disclosure; force-opens when a 422 lands inside (`PropertyForm.jsx:207-231`) | ✓ | ✓ | DEVIATION (D59) |
| — | — | — | "Try again" (`btn-secondary btn-sm`) | non-422 alert above the grid | re-submits the **last payload** (`SandboxPredictPanel.jsx:488-496`) | ✓ | ✓ | PASS (adapted) |
| — | — | — | "Go to stage 07 — Model Training" (`btn-primary btn-sm`) | locked + empty-roster states | `goToStage('07-train')` (`SandboxPredictPanel.jsx:443-449,473-479`; shell `LockedStage` at `WorkflowShell.jsx:143-161`) | ✓ | ✓ | DEVIATION (D2/gating) — CTA label visibility fixed 2026-08-09 (F1: was amber-on-amber; prose-link rules now scoped `:not(.btn)`) |
| — (no bridge) | — | — | "Open the Valuation page →" (`btn-primary wf-bridge-cta`) | champion bridge card, below the grid | `Link` → `/valuation` (`PredictStage.jsx:102-104`) | ✓ primary bottom-left | ✓ | DEVIATION (D56) |

Idle result aside ("Awaiting input" kicker + "—" verdict + guidance) matches the reference
exactly; filled states verified in code (regression: 28px mono plain-ink price, no track —
D54; classification: animated 8px `.result-track`).

## 12. Valuation — `/valuation` (the product's predict page; blueprint §8.10 at product scale)

| PlacementPredict button | Location | Purpose | PropPulse equivalent | Location | Purpose | Visual match | Functional match | Status |
|---|---|---|---|---|---|---|---|---|
| "Predict placement" (btn-primary) | form foot | POST predict | **"Estimate value"** (btn-primary BusyButton, busy "Estimating…") | form foot, left, first | client validation → `POST /predict` (`PropertyForm.jsx:234-241`; `Valuation.jsx:106-142`; `api/client.js:229-230`) | ✓ | ✓ **live-verified 2026-08-10**: example payload → 200, $163,061 + range + probability (threshold 0.203292) | PASS (adapted) |
| — | — | — | "Load example property" (btn-secondary) | form foot, 2nd | seed defaults (`PropertyForm.jsx:242-249`; `Valuation.jsx:144`) | ✓ | ✓ | DEVIATION (D61) |
| — | — | — | "Reset" (btn-secondary) | form foot, 3rd | abort + reseed + clear result/URL/storage (`PropertyForm.jsx:250-257`; `Valuation.jsx:146-155`) | ✓ | ✓ | DEVIATION (D61) |
| — | — | — | "Restore last valuation" (`btn-secondary btn-sm`) + "×" dismiss | restore bar above grid | seed from `localStorage proppulse:last-valuation` / dismiss (`Valuation.jsx:169-216`) | quiet bar | ✓ | DEVIATION (D62) |
| — | — | — | "Load example property" (`btn-secondary btn-sm`) | idle result panel | seed defaults (`Valuation.jsx:275-281`) | ✓ | ✓ | DEVIATION (D61) |
| — | — | — | "Try again" (`btn-secondary btn-sm` BusyButton, busy "Retrying…") | error alert above grid | re-submit last payload (`Valuation.jsx:232-239`) | ✓ | ✓ | PASS (adapted) |
| — (no comps in reference) | — | — | "Price" / "Sold" sort headers + per-row "▸/▾" expander (`aria-expanded`) | comps table | client sort / expand comp-vs-subject (`CompsTable.jsx:204-241`) | ✓ dense table language | ✓ | DEVIATION (D63) |
| — (no what-if in reference) | — | — | 7 lever sliders + numeric twins; per-lever "Retry"; "Reset scenarios" (`btn-secondary btn-sm`) | scenario explorer | 300 ms debounce → `POST /predict/price` (`ScenarioExplorer.jsx:144-151,196-214,246-266`; `api/client.js:237`) | ✓ token tracks/thumbs | ✓ wired (levers not fired — code-traced; endpoint live) | DEVIATION (D63) |
| — | — | — | "Explore this market →" (text link) | micro-market panel foot | `Link` → `/market` (`MicroMarketCard.jsx:66-68`) | ✓ amber prose link | ✓ | DEVIATION (D63) |
| — | — | — | "Model Insights →" (inline Link) | FactorBars empty state | → `/model` (`FactorBars.jsx:31-33`) | ✓ | ✓ | DEVIATION (D63) |
| — | — | — | "Pin this estimate" (`btn-secondary btn-sm`) | result rail, under the estimate panel (unpinned state) | snapshot real `/predict` payload + price + probability → `localStorage proppulse:pinned-estimate` + toast (`PinnedComparison.jsx:52-62,67-71`; `Valuation.jsx:294`) | ✓ quiet secondary | ✓ **live-verified 2026-08-10**: pin → panel shows `+$0 (+0.0%)` vs itself | DEVIATION (D78) |
| — | — | — | "Update pin" (`btn-secondary btn-sm`) | pinned-comparison panel actions | re-snapshot the current estimate over the stored pin (`PinnedComparison.jsx:125-127`) | ✓ | ✓ wired (same `pin()` path, live-verified via probe) | DEVIATION (D78) |
| — | — | — | "Remove pin" (`link-quiet`) | pinned-comparison panel actions | clear the stored snapshot (`PinnedComparison.jsx:128-130`; `useLocalStorage` remove) | ✓ destructive-quiet slot | ✓ live-verified: panel gone, affordance returns | DEVIATION (D78) |

## 13. Market Intelligence — `/market` (PropPulse-only page)

No reference page; controls follow the reference's select/toggle/table language.

| PlacementPredict button | Location | Purpose | PropPulse equivalent | Location | Purpose | Visual match | Functional match | Status |
|---|---|---|---|---|---|---|---|---|
| — | — | — | "Highlight a neighborhood" select (`.chart-select`) | map toolbar | focus point + open popup (`NeighborhoodMap.jsx:126-146,72-83`); action menu — value pinned to placeholder by design | ✓ compact select | ✓ | PASS (adapted) |
| — | — | — | 25 map markers (divIcon dots, keyboard: Enter opens, Esc closes) | leaflet map | open popup; dim others when a cluster is active (`NeighborhoodMap.jsx:186-225`) | cluster-color dots, light ring | ✓ | PASS (adapted) |
| — | — | — | "Value a home here →" (amber link) | marker popup | `Link` → `/valuation?neighborhood={code}` (`NeighborhoodMap.jsx:270-274`) | ✓ | ✓ (prefill handshake verified `Valuation.jsx:76`) | PASS (adapted) |
| — | — | — | 4 cluster cards (`button.cluster-card`, `aria-pressed`) | cluster rail | select/deselect + map fly-to (`ClusterRail.jsx:13-25`; `Market.jsx:84-92`) | ✓ active = amber border + inset bar (stepper language) | ✓ | PASS (adapted) |
| — | — | — | "Value a home in this market →" (amber link) | market profile panel foot | → `/valuation?neighborhood={first member}` (`MarketProfile.jsx:123-133`) | ✓ | ✓ | PASS (adapted) |
| — | — | — | 5 sort headers (Neighborhood / Code / Micro-market / Median price / Median $/sqft) + 25 row links "Value a home here →" | directory table | client sort; valuation prefill (`NeighborhoodTable.jsx:62-89,122-129`) | ✓ sticky first column | ✓ | PASS (adapted) |
| — | — | — | "Try again" ×2 (clusters / trends) | section error boxes | independent reloads (`Market.jsx:175-177`; `TrendsPanel.jsx:98-100`) | ✓ | ✓ | PASS (adapted) |

## 14. Model Insights — `/model` (PropPulse-only page)

| PlacementPredict button | Location | Purpose | PropPulse equivalent | Location | Purpose | Visual match | Functional match | Status |
|---|---|---|---|---|---|---|---|---|
| — | — | — | "Try the model →" (btn-primary) | closing CTA row, left | `Link` → `/valuation` (`ModelInsights.jsx:276-278`) | ✓ | ✓ | PASS (adapted) |
| — | — | — | "Model health →" (btn-secondary) | closing CTA row | `Link` → `/health` (`ModelInsights.jsx:279-281`) | ✓ | ✓ | PASS (adapted) |
| — | — | — | "Try again" ×2 (info / importance AsyncSection error boxes) | per section | section-scoped reload, stale content kept (`ModelInsights.jsx:134-138,245-249`; `AsyncSection.jsx:22-30`) | ✓ | ✓ | PASS (adapted) |

## 15. Model Health — `/health` (PropPulse-only page)

| PlacementPredict button | Location | Purpose | PropPulse equivalent | Location | Purpose | Visual match | Functional match | Status |
|---|---|---|---|---|---|---|---|---|
| — | — | — | "Refresh now" (`btn-secondary btn-sm` BusyButton, busy "Refreshing…") | refresh row, right | reload `GET /health` + `GET /metrics`; toasts on failure/recovery (`Health.jsx:74-80,141-148`) | quiet secondary | ✓ wired (read-only refresh; page also polls every 30 s, visibility-aware) | PASS (adapted, D74) |
| — | — | — | "Score a property →" (`btn-primary btn-sm`) | DriftEmpty states (feature + prediction drift) | `Link` → `/valuation` (champion `POST /predict` writes `logs/predictions.jsonl` — the honest unblock action) (`DriftEmpty.jsx:71-75`) | ✓ | ✓; visible live (backend currently serves drift `no_data`, screenshot 20) | PASS (adapted, D73) — CTA label visibility fixed 2026-08-09 (F1: was amber-on-amber; prose-link rules now scoped `:not(.btn)`) |
| — | — | — | Sort headers (Route / Requests / Share) | traffic table thead | client sort (`TrafficTable.jsx:98-100`) | ✓ | ✓ | PASS (adapted) |
| — | — | — | "Try again" ×4 (status / traffic / feature drift / prediction drift) | per section | section-scoped reload (`ServiceStatus.jsx:76-84`; `TrafficTable.jsx:43-51`; `DriftPanel.jsx:179-187`; `PredictionDrift.jsx:25-33`) | ✓ | ✓ | PASS (adapted) |

## 16. Bridge stages 10–12 (`/workflow/10-market`, `/11-explain`, `/12-health`)

| PlacementPredict button | Location | Purpose | PropPulse equivalent | Location | Purpose | Visual match | Functional match | Status |
|---|---|---|---|---|---|---|---|---|
| — (no bridge stages) | — | — | "Open Neighbourhood Intelligence →" / "Open Model Insights →" / "Open Model Health →" (`btn-primary wf-bridge-cta`) | bridge card, bottom-left | `Link` → `/market` / `/model` / `/health` (`MarketStage.jsx:213-215`; `ExplainStage.jsx:172-174`; `HealthStage.jsx:142-144`) | ✓ | ✓ | DEVIATION (D69) |
| — | — | — | "Inspect clusters in stage 08 →" / "Open importance in stage 08 →" (`btn-secondary btn-sm`) | sandbox teaser (when a done job exists) | `goToStage('08-evaluate')` (`MarketStage.jsx:131-137`; `ExplainStage.jsx:94-100`) | ✓ | ✓ | DEVIATION (D69) |
| — | — | — | "Go to stage 07 — Model Training" (`btn-primary btn-sm`) | teaser empty state | `goToStage('07-train')` (`MarketStage.jsx:148-154`; `ExplainStage.jsx:111-117`) | ✓ | ✓ | DEVIATION (D69) |
| — | — | — | "Try again" (teaser ErrorState ×3) | teaser section | reload teaser data (`MarketStage.jsx:87-93`; `ExplainStage.jsx:69-75`; `HealthStage.jsx:46-52`) | ✓ | ✓ | PASS (adapted) |

StagePager renders on the bridge stages too (shell foot, `WorkflowShell.jsx:397`) — the 12-stage
chain is unbroken.

## 17. Error page — 404 (blueprint §8.11)

| PlacementPredict button | Location | Purpose | PropPulse equivalent | Location | Purpose | Visual match | Functional match | Status |
|---|---|---|---|---|---|---|---|---|
| "Back to overview" (btn-primary) | under message, 1st | → `/` | "Back to overview" (btn-primary) | under message, 1st | `Link` → `/` (`NotFound.jsx:20-22`) | ✓ | ✓ | PASS |
| "Upload page" (btn-secondary) | under message, 2nd | → `/upload` | "Upload page" (btn-secondary) | under message, 2nd | `Link` → `/workflow/01-upload` (`NotFound.jsx:23-25`) | ✓ | ✓ | PASS |

Catch-all route renders the same kicker/h1/message pattern (`App.jsx:48`; screenshots 12-404
match 1:1, including no active nav highlight). Reference's 413/500 pages have no SPA equivalent
routes; the route ErrorBoundary fallback (`.crash-box` alert with "Try again" / "Reload page" /
"Back to overview", `ErrorBoundary.jsx:47-91`) covers crash states.

---

## Audit conclusion

- **Buttons existing visually but not working: none.** Every control above traces to a route,
  an API endpoint (each cross-checked against `backend/app/api/workflow_*.py` / `client.js`),
  or a working state handler.
- Mutation endpoints (upload, delete, preprocess run, training start, sandbox predict) were
  code-traced but not fired, per the read-only constraint; the valuation `POST /predict` and
  all GETs were exercised live.
- Known cosmetic nuances (none affect function): pipeline "Live" pills on gated stages 08/09;
  upload hint says "10 MB" while the enforced limit is 10 MiB; sidebar stage titles differ
  slightly from the reference ("Missing Values", "Visualization", "Predict Property") —
  PropTech content adaptation, recorded in UI_COMPARISON.md.
