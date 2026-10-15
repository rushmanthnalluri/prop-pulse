# PropPulse production audit — 2026-10-16

## Snapshot and verification context

- Repository: [rushmanthnalluri/prop-pulse](https://github.com/rushmanthnalluri/prop-pulse)
- Audited baseline: `main` at `03f40d6f4cb9cc08394506d8d84c272c536b72dc` (2026-10-15).
- Recursive Git tree inventory: **1,147 tracked paths**. The repository contains application source, tests, CI/deployment configuration, ML artifacts, datasets, generated figures, and a substantial historical audit archive.
- Existing `docs/audit/FILE_COVERAGE.md`, `LINE_BY_LINE_AUDIT.md`, and area reports provide the earlier full-source audit baseline. This pass cross-checked that baseline and reviewed the current reliability-critical surfaces: CORS settings/error handling, request-body enforcement, readiness/liveness, browser request timeouts, Render configuration, Docker/CI gates, and recent changes.
- Latest main CI observed: [run 38804112930](https://github.com/rushmanthnalluri/prop-pulse/actions/runs/38804112930) — Python tests, frontend audit/lint/build, compose validation, Docker runtime/readiness/training smoke test, E2E, and consolidated verification all succeeded.
- The unrelated [Recharts 3 upgrade PR #7](https://github.com/rushmanthnalluri/prop-pulse/pull/7) was still running its E2E job at the time of this snapshot; its passing jobs were not treated as a completed all-green result.

## Findings and changes

| ID | Severity | Finding | Disposition in this branch |
|---|---|---|---|
| PP-01 | P2 | `backend/app/config.py` accepted arbitrary `CORS_ORIGINS` strings, including empty allow-lists and malformed values that could silently disable browser access or misconfigure CORS. | **Fixed:** validate and canonicalize HTTP(S) origins; reject empty lists, invalid entries, wildcard CORS with credentialed requests, and malformed hosts. Added negative and canonicalization regression tests in `backend/tests/test_security.py`. |
| PP-02 | P2 | `render.yaml` used `/health` for the platform health probe even though `/health` is intentionally liveness-only and can report process status while serving artifacts are not all loaded. | **Fixed:** set Render's health check to `/ready`, which returns success only when required models are loaded. |
| PP-03 | P2 | `frontend/src/api/client.js` aborted every request after 30 seconds. Render documents that a free web service can take about one minute to resume after idling, so the configured timeout could abort a normal cold-start request before the API came back. | **Fixed:** allow 90 seconds for a Render-hosted API while retaining the 30-second limit for local/self-hosted APIs; cold-start timeout feedback is clearer. |
| PP-04 | P3 | Middleware comments incorrectly described `SecurityHeadersMiddleware` as the outermost user middleware even though CORS is added outside it. | **Fixed:** clarify the actual wrapping order to reduce the chance of a future middleware-order regression. |
| PP-05 | P3 | `RELEASE_STATUS.md` still said the hardening branch was pending verification and was last maintained on 2026-10-03, despite later main-branch merges and a green main CI run. | **Fixed:** refresh the status date and document the exact-commit CI requirement. |

## Platform constraint that remains

The Render Blueprint declares `plan: free`. Render's official documentation says free web services spin down after 15 minutes without inbound traffic and take about one minute to start again ([Render free-service limits](https://render.com/docs/free), checked 2026-10-16). That behavior is external to application code. The 90-second timeout prevents the frontend from giving up too early, but **it does not keep the API continuously online**. Continuous availability requires moving the API to a paid compute plan; do not claim the code change removes free-tier spin-down.

## Live Render evidence (read-only inspection, 2026-10-16)

The connected Render account was checked for the actual `prop-pulse-api` service, not inferred from repository configuration:

- Service ID `srv-d9s4um7avr4c73afli80`, URL [prop-pulse-api.onrender.com](https://prop-pulse-api.onrender.com), branch `main`, plan `free`, 1 configured instance. The dashboard was still configured to use `/health` at the time of inspection; `render.yaml` in this PR changes the tracked source-of-truth to `/ready`.
- Render emitted four `server_failed` events with `oomKilled.memoryLimit = 512Mi` on **2026-10-15 at 18:57:43, 19:09:26, 19:23:47 and 19:27:02 UTC**. These are direct platform events and confirm the memory outage was real, not a speculative code finding. They preceded deployment of main commit `03f40d6`, which completed at 20:45:27 UTC and adds bounded training plus a 512 MiB CI regression smoke.
- After that deployment, Render recorded one health-check timeout at **20:49:38 UTC** (`HTTP health check failed (timed out after 5 seconds)`) and a `server_available` event at **20:50:26 UTC**. This is a post-deploy reliability signal; it does not by itself prove continued recurring failure or a specific root cause.
- The sampled memory metric for the restarted instance was approximately **325 MB** at 20:55 and 21:00 UTC. The available metric series had no HTTP request-count or HTTP-latency datapoints, so request-level availability could not be quantified through that metrics response.
- Render application logs included repeated unhandled exceptions from `POST /workflow/datasets/ames/jobs` between 18:32 and 18:37 UTC, before the later commit that added the missing workflow runtime dependencies. The queried error-level logs did not return further application errors after that period; this limited log sample is not proof that no other failures occurred.
- No live end-user HTTP request was sent from this audit, and no production deploy/restart/configuration mutation was triggered. The PR's readiness-probe change still needs to be applied by Render's Blueprint sync/configuration mechanism if the dashboard value does not change automatically after merge.

The current code base and its CI now guard the previously observed training OOM path. A separate health-check timeout was still visible in Render's event timeline after the latest main deployment. **Treat the API as improved, not yet proven continuously available**; the free-tier plan can still sleep, and the production health-check config must be confirmed after rollout.

## Previously catalogued audit findings

The older `docs/audit/FINDINGS.md` catalog (AUD-01 through AUD-27) remains the detailed historical list for the prior source-audit wave. Those findings cover non-finite JSON handling, chunked-upload limit enforcement, missing 500 metrics, metric-cardinality bounds, compose port overrides, degenerate-feature PSI, calendar-only retraining alerts, frontend request timeout/abort behavior, warning floods, regression-test thresholds, data preparation guards, path disclosure, configuration path resolution, monitoring lock/I/O, prediction probability fallback, deployment/data-path ergonomics, model artifact logging, and stale documentation. The contemporaneous `FINAL_AUDIT.md` describes those as fixed, documentation-corrected, or intentionally accepted; the `FIX` labels in `FINDINGS.md` describe the original fix assignment and must not be mistaken for the present open backlog. AUD-13 intentionally corrected the data/schema documentation rather than retraining the verified model.

## Remaining security gap requiring a product decision

- **PP-06 · P1 · Open:** the prediction and workflow API routes are internet-accessible without authentication or rate limiting. `docs/DEPLOYMENT.md` already identifies AuthN/AuthZ and prediction throttling as production hardening work. A proper fix requires choosing an access model (public anonymous valuations, API key, or user identity) and then enforcing it consistently in the API and browser/deployment flow. This pass does not add a fake static browser-side secret or silently break public access; until the access policy is chosen, this remains an explicit production risk.

## Verification still required for this branch

- The code/config changes were made on `audit/production-hardening-2026-10-16`, not directly on `main`.
- GitHub Actions must pass for the exact resulting commit before merge. The previous main-branch green run is baseline evidence, not a substitute for branch CI.
- Render service metadata, recent events, and a bounded log/metrics window were inspected read-only; the public API endpoint was not called directly and no redeploy was triggered.
- Historical audit files are preserved as historical evidence; they were not rewritten to pretend old findings never existed.
