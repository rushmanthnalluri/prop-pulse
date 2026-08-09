# WF-F4 handoff — stages 09–12 (Predict / Market / Explain / Health)

## Files created / changed (all under `frontend/` unless noted)

**New, owned:**
- `src/components/workflow/SandboxPredictPanel.jsx` — stage-09 sandbox half: job + candidate pickers (done jobs from `listJobs`, candidates = the job's `results` entries with `status === "done"`, regression/classification only — clustering jobs are filtered out because the server answers 422 for them), the shared form, submit via `wf.sandboxPredict`, result card, and every gate/empty state.
- `src/pages/workflow/PredictStage.jsx` — two labelled halves, hairline-separated (spec §6.3-09): sandbox panel (main) + champion bridge aside (sticky ≥1025px) with the 3 specced bullets (SHAP factors, comps, what-if), an additive `/model/info` meta line (champion name, test RMSLE, range coverage — session-cached, omitted on failure, never hardcoded), CTA `Link` to `/valuation`.
- `src/pages/workflow/MarketStage.jsx` — sandbox teaser: newest done clustering job → `getEvaluation(job, "dbscan")` → real `n_clusters` / `n_noise` (with `assignments.length` as denominator) / eps / min_samples + link to stage 08; designed empty state naming stage 07's Clustering tab when none. Bridge: 4-card "what you'll find" grid (map, micro-markets, trends, directory), counts (`neighborhoods.length`, `n_clusters`) from session-cached `api.marketClusters()` with un-numbered fallback copy, geo + 2006–2008 caveats (§7 rule 6), honesty line "/market is champion-powered", CTA to `/market`.
- `src/pages/workflow/ExplainStage.jsx` — teaser when a done regression job exists (native importance — "not SHAP" + "SHAP is champion-only" copy, link to stage 08), empty state with stage-07 CTA otherwise; bridge grid (champions, performance & uncertainty, global SHAP, methodology), sealed-sandbox-test honesty note, CTA to `/model`.
- `src/pages/workflow/HealthStage.jsx` — sandbox facts from context `state.jobs` (total/done/running/failed; failed>0 → danger value), honesty note "sandbox models are not monitored / never promoted"; bridge grid (liveness, live traffic, feature drift, prediction drift) describing what `/health` reports without asserting any current drift value; note that sandbox predictions never enter the drift log; CTA to `/health`.
- `src/styles/workflow-bridge.css` — tokens only, ≥11px, hairlines, zero shadows; `.wf-duo` duo grid (stacks ≤1024px, hairline moves left→top), `.wf-result*` (sandbox price at 22px `fs-stat`, deliberately NOT the champion's 30px verdict size), `.wf-dim` busy dim, `.wf-bridge*` / `.wf-find-*` / `.wf-teaser*`, 1024/640 breakpoints. Imported by each of the 4 stage pages (Vite dedupes).

**Conditional ownership exercised (the move):**
- `src/components/valuation/PropertyForm.jsx` → `src/components/shared/PropertyForm.jsx` (moved; internal imports repointed to `../valuation/FormField` + `../valuation/formConfig`, `./BusyButton`; added optional `submitLabel`/`busyLabel` props defaulting to the champion's "Estimate value"/"Estimating…"). `src/pages/Valuation.jsx`: one-line import update, no logic change.

**Form-reuse decision (one line):** reuse-by-move — PropertyForm's props were already flow-agnostic (`onSubmit` delivers a valid `PropertyInput` via the pure `buildPayload`; `serverError` maps any `ApiError` 422), so sandbox integration is exactly the thin submit-handler the task's reuse bar requires; only cosmetic label props were added.

**Smoke artifacts (deleted after the run):** `e2e/smoke-wff4.mjs`, `e2e/test-results/wff4-*.png`.

## States implemented (§6.4)

- **09 sandbox:** `canPredictSandbox === null` → skeleton (never a false lock); `false` → designed EmptyState + `goToStage('07-train')` CTA (defense-in-depth — the shell gates first); jobs loading → skeletons; jobs error → ErrorState+retry; done-jobs-but-none-predictive (e.g. clustering-only, which `can_predict_sandbox` still admits server-side) → EmptyState naming stage 07; submit → BusyButton busy + previous result kept dimmed (`aria-busy`, no skeleton swap); 422 → form field mapping + toast; 404/409 → inline alert + roster reload; retry re-submits the last payload; abort-supersede + unmount abort; dataset switch clears all run state.
- **09 champion half / 10–12 bridges:** always available; additive champion fetches fail silently into un-numbered copy.
- **10/11 teasers:** skeleton → ErrorState+retry → teaser | designed empty state with stage-07 CTA.
- **12 sandbox facts:** stateLoading → skeleton; stateError → ErrorState + `reloadState` retry.
- **Honesty (§7), structural:** `ProvenanceBanner` with the API's verbatim label on every sandbox result (both variants: upload vs bundled-Ames); `SimulatedBadge` + the API's simulated note on classification results + a badge line under the pickers whenever a classification job is selected; `interval_note` verbatim ("~80% range — validation residual quantiles"); threshold copy states it is the job's F1-optimal threshold, never 0.5.

## Verification evidence

- `npm run build` — pass (after WF-F2/F3 stylesheets landed; earlier failures were their missing files, never mine).
- `npm run lint` — 0 errors, whole repo.
- Runtime smoke (backend :8530 + vite :5530, real Ames jobs I trained via the wf API: regression/linear `job_f476e1c3`, clustering/dbscan `job_524fd69d` → 4 clusters / 3 noise / 25 assignments): Playwright script, **27/27 PASS** — fresh upload renders the locked 09 with stage-07 CTA (href preserves `?dataset=`); ames renders both halves; a real sandbox prediction rendered `$162,041` with range, verbatim interval note, verbatim provenance label ("Sandbox model — trained on the bundled Ames Housing dataset; not the PropPulse champion.") and "945 train rows"; 10/11/12 teasers + CTAs verified (hrefs `/market`, `/model`, `/health`); 390px stacking check; zero console errors. API-level sanity: `POST /workflow/jobs/…/predict/linear` returned `estimated_price` $133,216 + provenance block.
- Moved-form regression: `/valuation` renders "Estimate value", champion `/predict` returned $160,985, no console errors.
- No-logging rule: `logs/predictions.jsonl` shows no entries from any sandbox prediction (one new line = the single champion `/predict` from the Valuation check — correct product behavior).

## Deviations / notes

1. **`models/workflow/` + `data/uploads/` NOT deleted** (instructed cleanup): WF-F2 (:5510/:8510) and WF-F3 (:5520/:8520) smokes were still running against that shared state when I finished; deleting it would have broken their verifications. `data/uploads/` is already empty (my smoke deleted its own upload). Whoever finishes last should run `rm -rf models/workflow data/uploads`. My ports 5530/8530 are freed (orphaned vite child needed `taskkill //F`).
2. **Stylesheet location:** `styles/workflow.css`'s header invites stage agents to append there; per my tasking I shipped `styles/workflow-bridge.css` instead (avoids a 3-agent write conflict on WF-F1's file).
3. **Spec §6.3-10/11/12 vs task:** the task's leaner teasers (no cluster cards/assignments table in 10, no importance chart in 11, no artifact-dir facts in 12) were implemented as instructed — those live in stage 08 (WF-F3).
4. **Doc path references now stale:** `docs/frontend/workflow-architecture.md:676` and `proppulse-ux-architecture.md:295` still cite `components/valuation/PropertyForm.jsx` — WF-F5 owns doc cross-links (§8), suggest updating to `components/shared/`.
5. Stage 09's shell-level gate locks the WHOLE stage (champion half included) when `can_predict_sandbox` is false — WF-F1's shipped behavior, not mine to change; my in-panel lock is the redundant layer.

## WF-F5 assertion suggestions (e2e/tests/workflow.spec.js)

- Fresh upload → `/workflow/09-predict?dataset=<id>` shows the locked state whose CTA href is `/workflow/07-train?dataset=<id>`; after a linear job completes on that dataset, the sandbox half renders pickers and a submit yields `.wf-result-price` + `.wf-prov` containing "not the PropPulse champion." (both bundled/upload label variants).
- Roster hygiene: with only a clustering job done, 09 shows the "no trained model can serve predictions" empty state (server `can_predict_sandbox` is true then — good C14 edge).
- Classification candidate selected → `SimulatedBadge` visible pre-submit; result shows probability + F1 threshold (≠ hardcoded 0.5) + the simulated note.
- 10 with a done dbscan job: teaser shows the evaluation's real `n_clusters`/`n_noise`; without one, the stage-07 CTA empty state.
- 11 teaser appears iff a done regression job exists; 12 job counts equal `GET …/state`'s `jobs` block.
- 422 path: submit an out-of-schema value (e.g. `overall_qual` 99 via devtools or API-mock) → form field error, toast, no result card.
- `logs/predictions.jsonl` line count unchanged across a sandbox prediction (C13); `/predict` champion parity unaffected.
- 390px: `.wf-duo` stacks, both halves visible; bridge grids collapse to 1 column.
