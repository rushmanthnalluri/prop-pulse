# PropPulse ML Workbench (/workflow/*) — Exploratory Browser-QA Report

Date: 2026-08-09 · Tester: exploratory browser-QA agent (Playwright/Chromium, human-like usage)
Stack under test: backend `:8200` + frontend dev `:5300` (shared session), then own isolated stack backend `:8550` + frontend `:5550` after the shared backend was restarted mid-session by a parallel process.
Evidence: `docs/frontend/qa-workbench/*.png` + per-phase logs (`journey-log.md`, `uploads-log.md`, `training-log.md`, `eval-log.md`, `predict-log.md`, `switching-log.md`, `offline-log.md`, `responsive-log.md`, `crossproduct-log.md`).

Scope note: the automated suite (42/42 green) covers scripted happy paths; this pass covered exploratory usage only — edge uploads, job lifecycle interruptions, dataset switching, offline degradation, responsive layouts, and cross-product regression.

---

## Defect summary

| Severity | Count |
|---|---|
| BLOCKER | 0 |
| MAJOR | 1 |
| MINOR | 4 |
| POLISH | 3 |

## Defects

### MAJOR

**M1 — One offline blip on an unvisited stage takes down the entire workbench shell, with no in-app recovery.**
Each stage is a lazy chunk. If the network drops while navigating to a stage whose chunk is not yet cached, the dynamic `import()` fails, the route `ErrorBoundary` catches it — and its fallback replaces the *entire* workbench: stepper, dataset picker, and stage content all unmount. After connectivity returns, the fallback persists; the stepper is gone, so in-app navigation can't recover anything. Only "Reload page", "Back to overview", or the sidebar (leaving the workbench) restores it.
Repro: load `/workflow/03-stats?dataset=ames`; go offline (DevTools); click stepper 05 (never visited this session) → whole shell replaced by "This section failed to render"; go back online → nothing recovers until manual reload.
Evidence: `offline-spa-05-uncached-chunk.png`, `offline-spa-recovery.png`, `offline-log.md` (console shows `TypeError: Failed to fetch dynamically imported module … VizStage.jsx`).
Why it matters: on flaky wifi this is a one-click accident; the designed offline banner ("API offline … Retry connection") already exists for API failures — chunk-load failures should degrade to the same per-stage treatment, not nuke the chrome. Fix direction: catch lazy-import failures per-stage (retry the import on reconnect / keep the shell mounted), or reset the boundary on route change.

### MINOR

**m1 — Duplicate dataset submissions are possible; identical bytes stored twice.**
Two `change` events fired synchronously on the dropzone input both pass the `uploading` guard (React hasn't re-rendered yet) → two concurrent `POST /workflow/datasets` → two registry entries with identical content (`ds_c0878824` and `ds_fe80c21b`, both `tiny3.csv`, same `sha256_12`). The server stores both despite the identical hash — no dedupe or "same content already exists" notice.
Repro: programmatic double-fire (or two near-simultaneous drops); observe two identical rows under "Datasets on this server".
Evidence: `uploads-log.md` §Double-fire; `switch-01-upload-tiny3.png` shows three identical `tiny3.csv` rows in the registry (two from the double-fire).
Impact: registry clutter and "which one is active?" confusion; no data loss. Fix direction: client-side in-flight ref guard (synchronous, not state-based); optionally server-side sha dedupe with a 200-pointing-to-existing response.

**m2 — Leaving stage 07 mid-job abandons the live JobStatus panel; returning does not restore it.**
`activeJobId` is TrainStage component state. Any navigation (stepper, reload, deep-link away) unmounts it; on return the "Live job status" section is gone even though the job is still running server-side. The only recovery is noticing the running row in Job history and clicking it. Nothing on the stage says "a job is running — click to watch".
Repro: start any job on stage 07; go to stage 03; return → no live panel (`training-log.md` §A, reproduced twice). Clicking the history row restores polling immediately.
Mitigating: the stepper's 07 dot shows `jobs.running`, and the history row resumes cleanly. Fix direction: auto-resume the newest active job for the dataset on mount (`listJobs` already returns it), or at least an inline "1 job running — view" banner.

**m3 — Mid-job dataset switch shows the live job panel on the wrong dataset.**
With a job running on dataset A, switching the picker to dataset B (SPA, no remount) keeps the "Live job status" panel visible — displaying dataset A's job above dataset B's (empty) history and B's "training unavailable" banner. Mixed, contradictory context on one screen.
Repro: start job on a full dataset → picker-switch to a tiny dataset → live panel for the foreign job persists (`train-3b-switched-midjob.png`).
Fix direction: scope the live panel to jobs whose `dataset_id` matches the active dataset (hide/collapse otherwise — the job keeps running regardless).

**m4 — CSVs with extra columns are silently accepted and stored.**
Uploading an 82-column CSV (81 Ames + `BogusColumn`) passes validation: the schema check reports "all 81 Ames columns present" and the dataset is stored as 82 columns with no "extra columns ignored/dropped" disclosure. In my fixture the bogus column happened to be constant, which triggered an incidental cardinality warning — a non-constant extra column would leave no trace at all.
Repro: `uploads-log.md` §extra-col; API `POST /workflow/datasets` with `extra-col.csv` → 201, `n_cols: 82`.
Impact: user believes their extra column is used; downstream stages silently ignore it. Fix direction: add an informational validation check naming extra columns ("not part of the Ames schema — will be ignored").

### POLISH

**p1 — Phone (390px): the Clustering tab is invisible without swiping the tab row.**
The objective tab row overflows (`scrollWidth 432 > clientWidth 358`, `overflow-x: auto`); "Regression" and "Classification + SIMULATED badge" fill the visible width, so "Clustering" sits entirely off-screen with no fade/arrow affordance. Reachable via horizontal swipe; discoverability is poor. (`crop-phone-tabs2.png`, measurement in session log.)
**p2 — Schema-mismatch 422 renders a raw 81-item Python list repr.**
The "missing required Ames columns" message dumps `['Id', 'MSSubClass', …]` verbatim into the report panel — a wall of brackets and quotes. Honest but unreadable; a count + first-few names ("77 missing: Id, MSSubClass, … +72 more") would serve better. (`uploads-log.md` §not-a-csv.)
**p3 — Deep-linking a deleted dataset falls back to ames but rewrites the URL silently.**
`/workflow/03-stats?dataset=ds_ed5c8cd5` after deletion → toast "That dataset no longer exists — switched to the bundled Ames data." and redirect. Good behavior; noting only that the toast is the *sole* signal — users who miss the (6s) toast may not realize they're now looking at different data. Acceptable as designed.

---

## Verified working (no defect)

- **Journey & routing**: all 12 stages render; bare `/workflow` restores last visited stage; unknown slug → last-visited fallback; invalid `?dataset=` silently dropped; nonexistent dataset → toast + ames fallback; deep links `/workflow/08-evaluate?job=<id>` work cold; bogus `?job=` falls back gracefully, zero page errors.
- **Upload validation**: renamed-.txt→.csv → clean 422 report; 3-row and 50-row CSVs accepted with per-check reports and warnings; >10 MiB blocked client-side with a clear message, and direct API POST → clean JSON 413; delete uses inline-confirm; deleting the active dataset falls back to ames; upload→immediately-delete while wandering other stages → no stale errors.
- **Row-window honesty**: 3-row (~3 post-split), 50-row (~34) and 200-row (~140) datasets all report `can_train:false` with a precise reason ("…require >= 150 … stages 01–05 remain available"); stage 07 disables Start with the reason inline; direct API job POST → clean 400. Degenerate-cluster territory is unreachable by design; the dbscan evaluation on ames is honest (eps/min_samples, 4 clusters / 3 noise, rationale, nearest-centroid-fallback labels).
- **Job concurrency UX**: second job while one runs → 409 alert naming the running job with a "View job_…" action; deleting a dataset mid-job → 409 naming the job; unknown candidate → 422 listing valid ones; server-restart mid-job → job marked failed with honest "server restarted before the job finished".
- **Evaluation**: rapid job/candidate switching ×8 → no race artifacts, no console errors; restart-failed job's done candidate evaluates fine (200), stuck "running" candidate → honest 409; unknown job/candidate → 404 with known-candidates list; never-trainable dataset shows the designed locked state.
- **Sandbox predict**: weird-but-valid extremes (1872 build, quality 10, 4 476 sqft) → $364,982 with ~80% interval and full provenance ("Sandbox model — trained on your upload; not the PropPulse champion."); fast double-submit superseded cleanly (no duplicate results, no errors); champion on identical input → $295,006 on /valuation — the two are unmistakably labelled; clustering candidate → 422 "does not serve per-row predictions".
- **Dataset switching** (the feared stale seam): stages 02–07 and 12 fully react to switches — no stale values from the previous dataset in any view; rapid-fire switching on 05-viz → final state consistent, zero page errors. (Stage 01's registry always lists all datasets by design; m3 covers the one real leak.)
- **Offline/degradation**: full offline with cached chunks → designed "API offline … Retry connection" banner; aborting only `/stats`, `/viz/*`, `/state`, or `/datasets` degrades exactly the owning section with retry — stepper and shell survive (M1 covers the one exception).
- **Responsive**: zero horizontal overflow on all 12 stages at 768×1024 and 390×844; stepper scrolls to keep the current stage visible; forms, tables, and charts usable (p1 excepted).
- **Console/junk hunt**: no `undefined`/`NaN`/`[object Object]` on any stage in any phase; no app-logic console errors anywhere (only expected 4xx during negative tests and navigation aborts).
- **Cross-product regression**: `/`, `/valuation`, `/market`, `/model`, `/health` all render, sidebar nav group intact with ML Workbench added, champion valuation submit works end-to-end.

## Per-stage verdict

| Stage | Verdict |
|---|---|
| 01 Upload | PASS — validation honest; m1 duplicates, m4 extra-column silence |
| 02 Features | PASS — switching clean |
| 03 Stats | PASS — switching clean, offline section-retry works |
| 04 Missing | PASS — offline banner works |
| 05 Visualize | PASS — rapid-switch safe, per-chart degradation |
| 06 Preprocess | PASS (config/preview flows exercised in journey; switching clean) |
| 07 Train | PASS with minors — m2 resume gap, m3 cross-dataset live panel; 409/400 UX excellent |
| 08 Evaluate | PASS — deep links, races, and error shapes all clean |
| 09 Predict | PASS — labels make sandbox vs champion unmistakable |
| 10 Market | PASS — designed empty state + champion bridge |
| 11 Explain | PASS — designed empty state + champion bridge |
| 12 Health | PASS — honest sandbox counts + champion bridge |
| Shell/stepper | MAJOR M1 (offline chunk failure), p1 (phone tab affordance) |

## Overall verdict

**Ship.** No blockers. Core flows — upload → explore → train → evaluate → predict — are robust, honest, and well-labelled under adversarial poking; every negative path I could reach degrades gracefully with a designed state and a recovery action. Fix M1 (offline chunk-load resilience) before calling the workbench flaky-network-safe; m1–m4 are worthwhile hardening; p1–p3 are cosmetic.

Session caveat: mid-session the shared `:8200` backend was restarted by a parallel process (its interrupted job was correctly marked `failed: server restarted before the job finished` — itself a pass). Testing continued on an isolated `:8550`/`:5550` stack against the same project data; two early training observations were re-run cleanly there. One job-start on ames 409'd against the parallel session's job — expected one-job-server-wide behavior, not a defect.
