# UI Comparison — PlacementPredict → PropPulse (mission §38, goal requirements 9–10)

Date: 2026-08-10 · Author: QA compile agent
Method: side-by-side screenshot pairs (`docs/screenshots/reference/*.png` Flask `:5000` vs
`docs/screenshots/proppulse/*.png` rebuilt app) + code-level verification of every claim in
`frontend/src/` (file:line evidence in `BUTTON_AUDIT.md`) + live spot-checks on the running
stack (frontend `:5300`, backend `:8200`). Reference behavior per
`docs/frontend/PLACEMENTPREDICT_UI_BLUEPRINT.md`.

Status values: `MATCH` = same structure/behavior · `MATCH (adapted)` = same design logic,
PropTech content · `DEVIATION` = deliberate difference, registered below · `PENDING` = not yet
verified.

---

## 1. Screen-by-screen

| Screen | Reference behavior | PropPulse implementation | Difference | Fix | Status |
|---|---|---|---|---|---|
| Home `/` | 2-col hero (1.25fr/0.75fr); "Active dataset" panel; 8 unboxed metrics 2×4; chart grid (donut, histogram + head select, wide % bars + head select, wide heatmap); insight list; driver rows; group tiles; 9 pipeline rows | Same skeleton: hero, "Active model" panel, 8 metrics (4 record + 4 model facts), chart grid (donut, histogram + select, wide median-price bars + select, wide trend lines), insights, drivers, 8 group tiles, 9 pipeline rows; Disclosures section added | Panel anchors the champion, not an upload; heatmap → trend lines; donut uses cluster palette; disclosures added (D9–D16) | None — intentional | MATCH (adapted) — screenshots 01 |
| Stage 01 Upload | page-head → upload form → loaded panel (badge + filename + Remove file) → 3 metrics → Columns table → 8-row preview → bottom CTA | Same sequence; dropzone with client pre-checks; validation report slot below form; Continue CTA inside loaded panel; context strip above (shell) | `.csv` only; report below form; Columns capped `scroll-60`; exact-case preview headers; manager table removed to shell picker (D17–D23, D8) | None — intentional | MATCH (adapted) — screenshots 02 |
| Stage 02 Features | grid-3 metrics; curated domain groups (Identity…Outcome); Field/Type/Role/Coverage/Unique/Notes tables | grid-3 metrics (81/38/43); payload-derived groups (Identifier, Numeric, Categorical, Targets, Excluded, Pipeline-derived); same 6-column registry anatomy + coverage bars + amber target tag; "Prediction objectives" cards added | Groups/Notes from payload facets only — no invented taxonomy (D24–D26) | None — intentional | MATCH (adapted) — screenshots 03 |
| Stage 03 Descriptive | sticky scroll-68 stats table (mean accent); split-by-outcome vs-rows section; footnote link to missing | Sticky scroll-68 stats table (mean accent, amber target row badge); footnote accent link to stage 04; provenance banner slot | **Split-by-outcome vs-rows omitted** — no grouped-means endpoint; documented, not faked (D27) | Optional: add a by-split means endpoint to restore the section | DEVIATION (D27) — screenshots 04 |
| Stage 04 Missing | 4 metrics (missing red); 320px danger bar chart; Repair table with "Imputed mean" accent column + coverage "x% → 100%" | 4 metrics; 320px danger chart of all 19 gapped columns; Repair table with "Treatment" badge + policy name + same coverage pattern; designed empty state | Treatment badges replace imputed means (real NA policies); all gapped columns charted (D30–D32) | None — intentional | MATCH (adapted) — screenshots 05 |
| Stage 05 Visualize | sticky viz-nav ×5; 10 histograms; standardized slate histograms; server heatmap + influence bars; status-split boxplots; category % bars | sticky viz-nav ×4; 6 histogram cards with head switchers + Gaussian outline; same CSS heatmap (reference lerp base `t=clamp(v,0,1)**0.7`, split into two collinear segments at `HEAT_FLIP=0.6` on t (v ≈ +0.48) with the dark-ink flip at the same threshold — the smooth ramp crossed a contrast-dead band) + influence bars; category median-price bars; scatter relationships card | No z-score or boxplot endpoints → sections dropped; Relationships added; KDE → disclosed smoothing; negatives at base tone (D33–D38) | None — endpoint-bound | MATCH (adapted) — screenshots 06 |
| Stage 06 Preprocess | "The split" 4 metrics (train/sealed test + placed rates); feature-set table (Imputed mean accent / Train std / Transform, amber target row); no controls | "The split" 4 metrics (945/338/175 + Sale-speed rate w/ ADR-3 note); 9-node pipeline flow + 7-step accordion from the real `steps[]`; feature-set table (Dataset mean accent / Missing / Transform, amber target rows); config panel + "Run preprocessing"; before/after panels | PropPulse runs a real configurable preprocess; API exposes no train-fit means (D39–D42) | None — real functionality supersedes | MATCH (adapted) — screenshots 07 |
| Stage 07 Train | model-pick GET form + "Train & evaluate"; detail panel w/ metrics + cm + ROC; benchmark controls (checkboxes + Re-train + "Run benchmark") → banner + 4dp table + grouped bars | Objective tabs + candidate checkboxes + "Start training" (async job → 202 → polling); inspect select + detail panel linking to stage 08; bench-banner + sortable 4dp comparison table ("best" chip) + grouped-bar card; live JobStatus + job history | Training is a real async job, not a synchronous form (D43–D48) | None — real job flow | MATCH (adapted) — screenshots 08 |
| Stage 08 Evaluate | verdict table (Champion badge, 4dp, ROC-AUC accent); ROC + reliability wide cards; eval-duo (cm + RF importance); closing honesty note | Job/candidate picker; verdict table ("best" badge, 4dp, accent follows server selection metric, sortable); per-objective workspaces: regression (scatter + residuals + importance), classification (ROC + reliability + PR + cm + importance), clustering (sizes + noise); closing note (reg/class only) | Per-candidate payloads → picker; "best" not "Champion" (sandbox ≠ production); totals row/col on cm (D48–D53) | None — contract-bound | MATCH (adapted) — screenshots 10 |
| Stage 09 Predict (sandbox) | predict-grid 1.25fr/0.75fr; fieldsets w/ hints; Model select (best alias); "Predict placement"; sticky result aside (idle → filled, amber/danger border, 30px verdict, 8px track, facts dl, hedged note) | Same grid + aside; PropertyForm fieldsets; run + candidate selects ("Best model — {name} (recommended)"); "Predict with sandbox model" / "Predict sale likelihood"; regression verdict = 28px mono plain-ink price, no track; classification keeps the animated track; champion bridge section below | No 0–100 quantity for a price → no track on regression (D54–D56) | None — honesty rule | MATCH (adapted) — screenshots 11 |
| Error 404 | kicker "Error 404", h1, message, primary "Back to overview" + secondary "Upload page"; no active nav | Identical anatomy, copy, button order/variants; no active nav (`NotFound.jsx`; `App.jsx:48` catch-all) | None | — | MATCH — screenshots 12 (1:1) |
| Valuation `/valuation` (PropPulse-only) | (no reference page; extends §8.10) | Reference predict anatomy at product scale: 8 fieldsets, "Estimate value" / "Load example property" / "Reset", restore bar, sticky aside → amber-border result panel (30px mono price, range band, probability track w/ served-threshold tick, facts dl, hedged note, SimulatedBadge + ConfidenceNote), then FactorBars → MicroMarket → MarketPosition → Comps → ScenarioExplorer | No model picker (one champion pair); threshold served (20.3%), never hardcoded 50%; product-scale rail (D57–D63) | None | MATCH (adapted) — screenshots 17; `POST /predict` live-verified |
| Market `/market` (PropPulse-only) | (no reference page) | page-head + mono meta; dark leaflet map (CARTO `dark_all`) + highlight select + popups; cluster rail cards; market profile panel (idle "Awaiting selection"); dense sticky-first-col directory; trends line card; data notes | Map/dark tiles have no reference equivalent (D64–D68) | None | MATCH (adapted) — screenshots 18 |
| Model Insights `/model` (PropPulse-only) | (no reference page; uses §8.9 language) | 4 unboxed headline metrics; champion duo panels; dense metrics tables; confusion matrices (cm-grid); bootstrap banner; global drivers bars; methodology + disclosures notes; primary/secondary CTAs | Headline strip before tables — two champion kinds, not three candidates (D66) | None | MATCH (adapted) — screenshots 19 |
| Model Health `/health` (PropPulse-only) | (no reference page) | page-head; service-status unboxed metrics + badges; live traffic dense table (sortable); drift panels (PSI dense table, status badges); prediction-drift metric cards; designed empty states w/ "Score a property →"; refresh row + 30 s polling | PSI as table not bars; no drift chart (no series in payload) (D70–D74) | None | MATCH (adapted) — screenshots 20 |
| Bridge stages 10–12 | (no reference equivalent) | kicker + desc; sandbox teaser (real job/eval data) with stage-08 or stage-07 CTA; bridge card (find-grid + primary onward link); StagePager chain unbroken | PropPulse-only connective tissue (D69) | None | MATCH (adapted) — screenshots 14–16 |

Cross-cutting: sidebar stepper + Product group + footer "9-stage ML workflow" (D6, D7); workbench
context strip with disclosure + dataset picker on every stage (D8); kickers use the reference
eyebrow groups on every stage (01 Intake · 02–05 Records · 06 Preparation · 07–08 Modelling ·
09 Assessment) with the page h1 carrying the stepper title (D28); sidebar stage titles
are PropTech-adapted ("Missing Values", "Visualization", "Predict Property").

---

## 2. Documented deviations (consolidated register)

Format per mission: **PlacementPredict behavior / PropPulse behavior / Reason / Why the change
improves PropPulse (or why necessary).** Duplicates across agent reports weeded out; D-numbers
are referenced from `BUTTON_AUDIT.md`.

### Global / foundation

- **D1 — API-status chrome.** Ref: none (server-rendered; the server *is* the page). PropPulse: sidebar-footer status pill (30 s visibility-aware poll, click to re-check) + down/degraded banners with retry (`Layout.jsx:74-140,213-234`). Reason: an SPA against a separate API must surface connectivity honestly. Better: failures degrade to a banner + per-section error states instead of a blank page.
- **D2 — Toasts, skeletons, designed empty/error states.** Ref: no toasts/skeletons; loading states don't exist server-side. PropPulse: toast region (success/recovery), layout-matched skeletons, ErrorState "Try again" and EmptyState CTAs everywhere (SPEC StateView pattern). Necessary: client-rendered async app. Styled strictly in-system (toast = the one allowed elevation shadow; skeleton shimmer on `--raised`).
- **D3 — Amber prose links.** Ref: links color themselves per context. PropPulse: content links (`.note a`, `.page-desc a`, `.section-sub a`, `.alert a`, `.panel-body a`, `.empty-state a`, `p a`, `.table a`) are amber, hover `--accent-hover` (`styles.css:93-110`). Better: marks actionable prose links in dense data pages.
- **D4 — `.btn-sm` compact variant.** Ref: single button size. PropPulse keeps `btn-sm` (6px 10px, 12px) for table-row and alert actions. Necessary: dense tables (jobs list, comps) can't fit full-size buttons.
- **D5 — `.note` margin-top omitted.** Ref: `.note` carries its own top margin. PropPulse: `.note` is marginless; spacing via utilities (`.mt-*`) or parent rhythm. Better: no double-margins in varied compositions.
- **D6 — Product nav group.** Ref: sidebar = 9-stage stepper only. PropPulse: stepper (01–09) + "Product" group (Overview/Valuation/Market Intelligence/Model Insights/Model Health), same stepper skin (`Layout.jsx:25-31,191-203`). Necessary: PropPulse is a product (champion pages) + workbench; the reference's stage-09 product surface is a whole page group here.
- **D7 — 12-stage workflow.** Ref: 9 stages; pager chains 9. PropPulse: 12 stages — 10–12 are bridges into the champion pages; sidebar shows 9 (+ Product group), StagePager chains all 12 with `?dataset=` preserved (`stages.js`, `StagePager.jsx`). Necessary: workbench→product hand-off. Nuance: pipeline "Live" pills show on gated stages 08/09 — links land on the designed locked state, not a dead end.
- **D8 — Workbench context strip + DatasetPicker.** Ref: session-cookie dataset context in the sidebar footer only. PropPulse: strip above every stage (sandbox-vs-champion disclosure + dataset chip dropdown with switch/delete/upload) (`WorkflowShell.jsx:389-395`, `DatasetPicker.jsx`). Necessary: real multi-dataset registry; the disclosure is mandated honesty.

### Overview

- **D9 — Hero copy.** Ref: live record count injected into the hero description. PropPulse: static PropTech desc; the count lives in the first metric cell. Reason: client-rendered — no post-load reflow, no hardcoded number.
- **D10 — "Active dataset" → "Active model" panel.** Ref: dataset facts + "Upload a different file →". PropPulse: champion facts (algorithm, test R²/RMSE, features, training window) + "Inspect the model →" (`ActiveModelPanel.jsx`). Necessary: PropPulse's anchor is the champion model, not an upload.
- **D11 — Metrics mix.** Ref: 8 dataset facts (records…missing). PropPulse: 4 record facts (training sales 945, neighborhoods 25, micro-markets 4, features 94) + 4 model facts (test R²/RMSLE/interval coverage/sale-speed ROC-AUC); right mono note carries provenance + ADR-3 instead of the anomaly note. Necessary: champion API has no placed/missing analogues; nothing invented.
- **D12 — Chart ④: heatmap → micro-market price-trend lines.** Reason: champion API exposes no correlation payload; the full heatmap lives on workbench stage 05 (`viz.correlation`).
- **D13 — Histogram outline.** Ref: Chart.js KDE. PropPulse: monotone Gaussian outline over server-aggregated bins (same data, honest aggregation).
- **D14 — Donut palette.** Ref: amber + `#3A403B` two-segment. PropPulse: 4-segment micro-market split in the frozen `clusterColor()` palette. Better: identity consistency with map/cards beats one-accent here.
- **D15 — Record tiles.** Ref: 6 curated groups linking to `/features#group-{slug}`. PropPulse: 8 payload-derived groups linking plain to `/workflow/02-features` (anchors exist on stage 02 but no link contract). Necessary: no domain taxonomy in the API; counts computed live (exhaustive over the 81-column schema).
- **D16 — Disclosures section.** No reference slot; mandated ADR-3/historical-window/interval honesty as fine print before the pipeline.

### Upload / Features (01–02)

- **D17 — Empty submit disabled.** Ref: server-roundtrips "no file chosen". PropPulse: submit disabled until a file is selected + client pre-checks (.csv, non-empty, ≤10 MiB). Better: the POST would be guaranteed-futile.
- **D18 — Hint ".csv · up to 10 MB" (no .xlsx).** Reason: server accepts raw `text/csv` only, no multipart. (Cosmetic: limit enforced is 10 MiB.)
- **D19 — Validation report below the form; success report kept.** Ref: error above the form (full-page-reload artifact), no success report. PropPulse: `.alert-error` + per-check status rows adjacent to the action; success report required by binding spec §6.3-01. Status marks are mono **PASS/WARN/FAIL** text badges (the reference's status idiom) — the earlier ✓/!/✕ glyphs were replaced in the 2026-08-09 red-team pass (off-set glyphs).
- **D20 — Dataset manager removed from stage 01.** Ref: none exists. PropPulse pre-rebuild had one; registry switch/delete now lives in the shell DatasetPicker; the page keeps the reference's quiet "Remove file" behind an inline confirm (no `window.confirm`).
- **D21 — Columns table capped `scroll-60` + sticky header.** Ref: uncapped (31 columns); Ames has 81 — the blueprint's own utility applied.
- **D22 — Preview headers keep exact schema case** (`.wfu-th-raw`; ref CSS-uppercases). Necessary: `GrLivArea` uppercased would no longer match the case-sensitive CSV header.
- **D23 — Bundled note copy** — "the bundled Ames CSV exactly as stored; cleaning begins at stage 06" (ref's corrupt-record claim doesn't exist in this pipeline).
- **D24 — Registry groups + Notes from payload facets.** Ref: curated domains + curated notes. PropPulse: role+dtype-derived groups (incl. an Excluded group: SaleType/SaleCondition) and payload-fact notes (`e.g. v1 · v2 · v3` real top values; `range min–max · mean x`). Necessary: the API carries no taxonomy/notes; none invented.
- **D25 — Sort/filter removed; "Prediction objectives" kept.** Blueprint §5 bans client-side sorting/filtering; TargetCards remain (mandatory ADR-3 SimulatedBadge + verbatim API notes).
- **D26 — ProvenanceBanner dropped on 01/02.** Replaced by the reference's own provenance pattern (Bundled/Uploaded badge + `Dataset · name (bundled default)` page-meta); the shell strip still carries the disclosure on every stage.

### Stats / Missing (03–04)

- **D27 — Split-by-outcome vs-rows omitted.** Ref: 12 paired-bar rows of per-group means. PropPulse: `GET …/stats` returns `{numeric[], categorical[], target}` — no grouped means, no endpoint computes them. Documented instead of faked. Necessary: no honest data source.
- **D28 — Eyebrow kickers (RESOLVED 2026-08-09).** Ref: group eyebrows (Intake/Records/…/Assessment). PropPulse now uses the reference group taxonomy on every stage — 01 Intake · 02–05 Records · 06 Preparation · 07–08 Modelling · 09 Assessment (bridges 10–12 keep their descriptive kickers); the page h1 carries the stepper title in title case. Previously 03/04/05/08/09 used stage-title kickers; aligned in the red-team pass.
- **D29 — Metrics value-over-label.** Blueprint §3 DOM (value first, label under) — pre-rebuild PropPulse used label-first; flipped on the rebuilt pages.
- **D30 — "Imputed mean" → "Treatment".** Ref fills every gap with the column mean; PropPulse's pipeline uses documented NA policies (`fill_absent_token`/`fill_zero`/neighborhood-median/train-mode) and the payload carries no imputed mean. Better: the real per-column repair, not a fictional statistic.
- **D31 — Missing chart shows all gapped columns** (~19–30 vs ref's 5), most-missing-first; labels thinned (`minTickGap`), tooltip + a11y table carry full identity.
- **D32 — Totals derived.** Complete % and Total cells computed from `n_rows × n_cols` + `total_missing` (the endpoint returns neither directly) — arithmetic on API values only.

### Visualization (05)

- **D33 — 5 sections → 4** (no "Standardized", no "Status splits"; "Relationships" added). Reason: endpoints are histogram/scatter/correlation/category — no z-score endpoint; status-split boxplots compare against the reference's binary target, which doesn't map to the regression-first workbench.
- **D34 — 10 static histograms → 6 with head switchers.** Each card is a live fetch; 6 bounds the initial burst; the `.chart-select` recovers field coverage interactively.
- **D35 — KDE → Gaussian-smoothed trend from server bin counts** — the only client-side derivation, disclosed in the section note.
- **D36 — Negative correlations render at the base tone** (ref dataset has none; its lerp clamps at 0). Signed values in cells/tooltips; negative influence bars extend left of zero with a caption. Necessary: Ames has real negatives.
- **D37 — σ from `GET …/stats`** (histogram payload carries min/max/mean/median only); tag degrades to μ-only while loading.
- **D38 — Target fallback**: correlation/category default to `targets.regression.column` (SalePrice), else last numeric — keeps uploads working instead of flashing 422s.

### Preprocess / Train (06–07)

- **D39 — 4th split metric "Sale-speed rate".** Ref: "Placed rate · train/test" pair. PropPulse splits are time-based, not stratified — the mono note carries all three rates + the ADR-3 simulated-target caveat (label deliberately avoids the substring "train": frozen e2e locates split metrics by label). Better: honest about rate shift.
- **D40 — Feature-set columns Dataset mean / Missing / Transform.** Ref: Imputed mean (train) / Train std. The API exposes no per-feature train-fit statistics (verified `ml/workflow/prepare.py` + live payload). Necessary: no fabricated numbers.
- **D41 — 9-node pipeline flow + 7-step accordion.** Ref: static transform table only. PropPulse visualizes the real report's `steps[]` with per-node status (source/done/skipped/persisted, SimulatedBadge on the simulated step) + verbatim leakage note. Better: shows the actual pipeline truth.
- **D42 — Config panel + "Run preprocessing".** Ref: no controls (static). PropPulse: outlier rule, split strategy, fractions/seed, one `POST …/preprocess/preview` that runs and persists. Necessary: preprocessing is a real operation here.
- **D43 — Async job flow replaces the model-pick GET form + "Train & evaluate".** Ref: synchronous shared training pass (~40 s blocking). PropPulse: "Start training" → `POST …/jobs` → 202 → visibility-aware polling → `?job=` mirroring; 409 → "View job"; job history with View/Evaluate. Label kept "Start training" (frozen e2e clicks that exact name). Necessary: real long-running jobs.
- **D44 — Detail panel links to stage 08 for cm/ROC.** Ref embeds them; PropPulse separates stages (frozen APIs) — panel shows metrics + meta + onward CTA.
- **D45 — Comparison table stays the shared `ComparisonTable`** (sortable, "best" chip, provenance) — client-side sorting is e2e-pinned product behavior (see D75); the reference's banner/chart/inspect are added around it. The table renders the blueprint's 4dp metric precision on both stages 07 and 08 (red-team F6).
- **D46 — Model colors mapped per candidate** (xgboost amber, random_forest slate, baselines grey) — candidate names differ from the reference trio; no new hues, no collisions within an objective.
- **D47 — "Run benchmark" / "Re-train from scratch" not replicated.** Ref: `POST /api/benchmark` re-runs a subset. PropPulse: training *is* the benchmark — the candidate checkboxes feed "Start training"; the head-to-head section (banner + table + grouped bars) reads the resulting `getModels` payload. Necessary: no separate benchmark endpoint exists; the job flow is the honest equivalent.

### Evaluate / Predict (08–09)

- **D48 — "Champion" → "best" badge.** PropPulse's only champion is the production model; sandbox rows are explicitly "not the PropPulse champion" (also e2e-pinned copy). Necessary for honesty.
- **D49 — Verdict table sortable on every metric** (ref: unsorted). Reason: e2e-pinned feature (`aria-sort`), UX §7.6.
- **D50 — Per-candidate picker.** Ref: all models' curves on shared charts. PropPulse: job + candidate selects (payload is per-candidate); legend keeps the reference language (`{name} · AUC`, dashed "chance"). Necessary given the frozen API.
- **D51 — Objective-specific workspaces.** Regression: actual-vs-predicted scatter (45° dashed) + residual histogram + importance. Classification: ROC + reliability + PR + cm + importance (SimulatedBadge throughout). Clustering: sizes + noise + assignments; **no closing honesty note on clustering** (per-objective composition). Content adaptation to real objectives.
- **D52 — Confusion matrix keeps totals row/column** (SPEC §5.4-4, shared with the insights page); same `.cm-grid` hairline language.
- **D53 — Reliability note omits "Platt-calibrated, 3-fold OOF"** — the sandbox payload says nothing about calibration fitting; the note describes only what the bins mean.
- **D54 — Regression result: no `.result-track`; 28px mono plain-ink verdict.** The payload has no 0–100 quantity for a price; inventing one would be a fabricated metric. Range rides the mono meta row + facts dl; classification keeps the animated probability track exactly per reference.
- **D55 — Best-option labeling + run select.** Ref: `value="best"` alias. PropPulse: the best candidate's own option is labeled "Best model — {name} (recommended)" (unique option values; e2e pins `#wf-sb-candidate`); a training-run select is added (multiple jobs per dataset exist; the ref has exactly one run).
- **D56 — Champion bridge card below the predict-grid** (full-width closing section) — the grid's right column belongs to the sticky result aside; the bridge survives as its own labeled section (product constraint §1/§6.3-09).

### Valuation (product predict page)

- **D57 — Verdict is a 30px mono tabular price in plain ink**, not an amber sans class label. Reason: the design system's own rule (numbers = Plex Mono); amber signal lives on the panel border. Necessary: our verdict is a figure, not a class.
- **D58 — Served threshold (20.3%), never "50%"** — the contract serves a max-F1 operating point (0.203292) and forbids hardcoding 0.5; the tick on the track makes the non-central threshold visible. More honest.
- **D59 — No model-picker fieldset.** The champion page serves exactly one champion pair — a picker would be fake choice; the advanced-overrides `<details>` occupies that slot.
- **D60 — Extra disclosures vs reference:** SimulatedBadge + ADR-3 caveat on the probability block, ConfidenceNote trust badge (typical/reduced + reasons + sealed-test MAE). Mandated honesty blocks, integrated into the panel.
- **D61 — "Load example property" / "Reset" quiet secondaries kept** (existing PropPulse UX, shared-form API), restyled per the reference's button hierarchy.
- **D62 — Restore bar** (`localStorage proppulse:last-valuation`, dismissible) — PropPulse-only convenience (SPEC §5.2.2).
- **D63 — Product-scale rail:** PriceBand range, FactorBars (SHAP), MicroMarketCard, MarketPosition, CompsTable (sortable + expandable rows), ScenarioExplorer (7 debounced levers → `POST /predict/price`). No reference equivalent; all in panel/table/track language.

### Market / Insights / Health (PropPulse-only pages)

- **D64 — CARTO `dark_all` basemap** replaces OSM Standard tiles (no key, no new dependency); popup/tooltip/attribution chromed dark. Necessary: light tiles would break the dark token system; requires internet at runtime (same constraint as before).
- **D65 — Cluster palette (RESOLVED 2026-08-09).** Was: frozen `CLUSTER_COLORS` (`#0e7a6d/#4c6e91/#b98a2f/#b4593f`) picked for the old light theme — slate ~3.6:1 on dark tiles (read as mud). Now (`constants.js:88`): `['#2a9d8f', '#6E8FA0', '#b98a2f', '#b4593f']` — slate retuned to the system `--slate` `#6E8FA0` (~5.5:1) and teal lightened to `#2a9d8f` (~5.7:1); ochre `#b98a2f` (~6:1) and terra `#b4593f` (~4:1) already cleared dark contrast and keep their hues. `clusterColor(id)` remains the single source shared by map, donut, trends, cards, and the MarketPosition micro-market marker.
- **D66 — Insights leads with a 4-metric unboxed strip** before the tables (ref §8.9 leads with the verdict table). Necessary: two champion kinds (regression + classification), not three comparable candidates.
- **D67 — Directory table sticky first column at all widths** (ref pins only on its descriptive table): the table's ~1090px min-content exceeds the 940px column at every viewport.
- **D68 — One error box for map+directory** (shared fetch lifecycle): on clusters failure the directory section is omitted rather than duplicating the error.
- **D69 — Bridge stages (10–12)** — quiet panels (kicker + desc, sandbox teaser with real server-truth data, find-grid, primary CTA bottom-left). No reference counterpart; the design follows blueprint §2/§4/§5.
- **D70 — Per-feature PSI as a dense table, not bars** — a 94-feature model needs exact values; threshold coloring (neg/accent) + status badges carry the hierarchy.
- **D71 — Drift panels boxed in `.panel`; service/traffic sections unboxed** — live counters bare, file snapshot boxed (mirrors the reference's "Active dataset" head-badge pattern).
- **D72 — No recharts chart on PredictionDrift** — `/metrics → drift` serves two scalar PSIs + thresholds, no time series; metric cards + threshold tag are the honest render.
- **D73 — Drift empty-state CTA "Score a property →" → `/valuation`** — scoring a property is the only user action that genuinely fills the drift window (champion `POST /predict` writes `logs/predictions.jsonl`; verified `backend/app/api/predict.py:44`).
- **D74 — Refresh row + 30 s polling** (SPEC §7.1) — mono meta + quiet secondary button, layout-stable; polls pause on hidden tabs.

### Red-team remediation (2026-08-09)

- **D75 — Client-side sorting kept on 4 tables** (D-sort). Ref: no sorting anywhere (server-rendered, fixed order). PropPulse: `SortHeader`-driven client sorting on CompsTable, TrafficTable, NeighborhoodTable, and ComparisonTable (`aria-sort` + `↑`/`↓` sort indicator). Reason: existing product spec (UX §7.6) and e2e-pinned behavior; the frozen table contract predates the rebuild. Why kept: real user value on dense data tables. The `↑`/`↓` glyphs are sanctioned here as part of this deviation — the reference's glyph set (→ ← › · ↓) has no sort arrows because the reference has no sorting.
- **D76 — `.cluster-card.active` selection idiom** (D-clusterbar). Ref: the stepper's inset amber bar marks the active nav item. PropPulse reuses that same inset amber bar (`box-shadow: inset 2px 0 0 var(--accent)`) for the selected micro-market card on `/market` (`styles.css`). Reason: one consistent selection idiom across nav and cards; it is a selection mark, not a data-surface shadow, so it does not break the no-shadows rule.
- **D77 — Mobile `.wf-tabs` scroll-edge mask** (D-mask). Ref: sanctions exactly one gradient (the heatmap legend). PropPulse keeps a `linear-gradient` as the mobile tab strip's scroll-edge **mask** (`workflow-train.css`) — an alpha channel that fades the clipped tab, not a colour fill on a data surface. Reason: scroll affordance; declared a sanctioned exception in a code comment.

### Consistency-sweep follow-up (red-team leftovers, re-checked 2026-08-10)

Agent-11's build-time sweep flagged off-system light-theme hexes in `EvaluationWorkspace.jsx`,
`VizExplorer.jsx`, `TrendsChart.jsx` and a `#ffffff` marker ring in `market.css`. Re-grepped for
this document: **all fixed** — and the 2026-08-09 red-team pass closed the rest: the frozen
`CLUSTER_COLORS` were retuned for dark (D65 RESOLVED), the legacy `--ochre` alias (a duplicate
of `--accent`) is removed, and the off-palette `#3A403B` outcome-bar fill went with the dead
`.outcome*` CSS. Remaining non-reference items by design: the mono PASS/WARN/FAIL status badges
(D19, replacing the old ✓/!/✕ glyphs), the SortHeader `↑`/`↓` sort arrows (D75), the flat
`--raised` skeleton **pulse** (no shimmer gradient), and the scroll-edge mask gradient (D77 —
both masks/animations, not data-surface fills — see DESIGN_SYSTEM.md §Shadows & gradients).

### Innovation pass (2026-08-10, mission §42)

One addition, chosen after inventorying the mission's candidate list against the code
(what-if → ScenarioExplorer; price positioning → MarketPosition; market intelligence → /market
+ stage 10; explanation → FactorBars/GlobalDrivers/MicroMarketCard/ConfidenceNote — all already
present; property comparison → the one real gap):

- **D78 — Pinned-estimate comparison on /valuation.** "Pin this estimate" (quiet secondary,
  empty state is the bare button + mono hint — no panel chrome for one affordance) snapshots the
  current real `/predict` payload + price + sale probability to
  `localStorage proppulse:pinned-estimate` (`PinnedComparison.jsx`, key in `constants.js`).
  Every later estimate on the device renders a `.panel` beside it: pinned vs current price with
  the signed delta (`+$x / −$x (+y.y%)`, the scenario explorer's pos/neg `.kv` idiom) and the
  sale-probability shift in points when both sides serve one; "Update pin" re-snapshots,
  "Remove pin" (`link-quiet`, the destructive-quiet slot) clears. Zero fetches, zero new tokens,
  zero fake numbers — the delta is client-side arithmetic on two real API responses. Reference
  has no counterpart (it predicts once per submission); the panel follows §2/§4/§5 panel/table
  language only. Live-verified 2026-08-10 at 1440px + 390px: pin → `+$0 (+0.0%)` vs itself,
  quality 8→6 re-estimate → `−$21,978 (−9.0%)`, survives reload, no console errors, no
  horizontal overflow.

---

## 3. Final quality bar (mission §43) — status

| # | Quality-bar item | Status | Evidence |
|---|---|---|---|
| 1 | `npm run build` passing | PASS | Re-run 2026-08-10: `✓ built in 3.89s`; `npm run lint` clean (0 findings) |
| 2 | Navigation matches reference quality | PASS | Stepper/pager/brand/footer anatomy verified vs blueprint §3/§4 (`Layout.jsx`, `StagePager.jsx`); screenshots 01–12 |
| 3 | Page structure matches | PASS | Per-screen table above; all 12 reference sections present or deviation-registered |
| 4 | Button positions match reference logic | PASS | BUTTON_AUDIT.md per-page placement columns (hero-left primaries, bottom-left CTAs, quiet destructive links) |
| 5 | Button styling matches reference system | PASS | `.btn`/`.btn-primary`/`.btn-secondary`/`.link-quiet` token-exact (`styles.css:744-779`) |
| 6 | Colors/typography/spacing/cards/forms/tables/charts consistent | PASS | Tokens = blueprint §2 verbatim (`styles.css:14-70`); charts via `chartTheme.js`; sweep follow-up above |
| 7 | Loading, error, empty, hover, focus states exist | PASS | StateView/Skeleton/ErrorState/EmptyState per page (audit "Rendered when" columns); global `:focus-visible` amber outline |
| 8 | Responsive behavior works | PASS | Reconciled scale 1024/900/820/640/520/420 + 980/480/400 exceptions + min-1440 (`styles.css:1784-1908`, per-page sheets — FINAL_REMEDIATION_REPORT finding 9); mobile screenshots m01/m02/m06/m11/m17 (390px) + 1440px desktop pairs |
| 9 | Every important button works | PASS | BUTTON_AUDIT.md — zero dead controls; mutations code-traced, GETs + `POST /predict` live-verified |
| 10 | Every page reachable | PASS | Route table (`App.jsx:43-49`), stepper, pager, Product group, bridge CTAs all resolve; `/workflow` redirects to last-visited stage else 01 |
| 11 | Every API interaction works | PASS | All endpoints cross-checked against `backend/app/api/*`; the §44 walkthrough fired every write path live on `:8200` — real CSV upload + validation report, preprocess run, training job (`job_fe31aa2a`), sandbox + champion predictions, dataset delete → 204 |
| 12 | No fake metrics | PASS | Deviations D11/D27/D30/D40/D54/D72 show removals/replacements instead of fabrication; derived values are arithmetic on API numbers only |
| 13 | No fake prediction | PASS | Live `POST /predict` returned a real estimate with range/probability/micro-market (2026-08-10) |
| 14 | No dead components | PASS | Zero dead controls; one unused component variant (ClusterCard link-mode) — dead variant, not visible UI |
| 15 | No console errors | PASS | Re-verified 2026-08-10 (REDTEAM.md): zero console/page errors on all 18 desktop routes (incl. 404 + all 12 stages) and 8 mobile routes at 390px via Playwright probes; §44 walkthrough: 0 pageerrors, only browser-level network logs for two intentionally-failed 400 preprocess runs |
| 16 | No broken routes | PASS | Catch-all 404 verified (screenshots 12); lazy stage chunks behind per-stage ErrorBoundary |
| 17 | No visual regressions | PASS | 12 screenshot pairs + 4 PropPulse-only pages reviewed for this document; re-captured post-fix 2026-08-10 |
| 18 | E2E suite green against the rebuilt UI | PASS | Full suite re-run 2026-08-10: **49 passed, exit 0** (4 specs — workflow journey 01–09 with real upload/preprocess/train/predict, dashboard incl. pinned-estimate comparison, audit-blackbox, frontend-fixes; backend :8200 + frontend :5300) |

**Verdict:** all 18 quality-bar items PASS. Post-fix verification details: `docs/frontend/REDTEAM.md`
(F1–F31 re-probed, F1 residual closed 2026-08-10 — final verdict PASS, zero unresolved FAILs).

---

## 4. Final user test (mission §44) — 2026-08-10

A UI-only new-user walkthrough drove the full journey on the live stack: homepage → hero CTA →
stage 01 (real 120-row CSV upload, PASS/WARN validation report) → 02 → 03 → 04 → 05 (alternating
sidebar stepper and bottom pager) → 06 real preprocess → 07 real training job → 08 evaluation →
09 real sandbox prediction ($157,723 with range) → champion bridge → /valuation real Estimate
($160,985) → pinned-estimate comparison (+$15,889 delta after raising quality) → /market, /model,
/health. Verdict: **a new user reaches a prediction without confusion**; nothing felt fake or
template-like; no dead ends; 0 pageerrors.

Friction found and fixed (this pass):
1. **Medium — the ≥150-row training minimum was discovered only via a failed run.** Fixed:
   stage 06 now shows an upfront `alert-warn` ("Training unavailable for this dataset" + the
   server's `train_blocked_reason`) whenever `can_train === false`, before the user clicks
   "Run preprocessing" (`PreprocessStage.jsx`).
2. **Low — misleading 400 heading** ("outside the training window" for a row-count problem) →
   retitled "This dataset can't be preprocessed" (the body carries the server's exact reason).
3. **Low — self-referential empty state** ("Train one in stage 07" while on stage 07) →
   neutral "Train a candidate first — …" (`ComparisonTable.jsx`).

Accepted as-is (documented, not defects): sidebar shows the 9 pipeline stages while the pager
chains the 10–12 bridges (registered deviation — reference has exactly 9 stages; bridges live in
the Product nav); the browser's own network-level 400 log lines (not app-suppressible); transient
mobile toast overlap (dismissible, self-clearing).
