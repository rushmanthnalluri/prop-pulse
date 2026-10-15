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
| PP-01 | P2 | `backend/app/config.py` accepted arbitrary `CORS_ORIGINS` strings. Paths, query strings, credentials, unsupported schemes, invalid ports, control/whitespace characters, and wildcard configuration could silently misconfigure CORS rather than failing early. | **Fixed:** validate and canonicalize HTTP(S) origins; reject invalid entries and wildcard CORS with credentialed requests. Added negative and canonicalization regression tests in `backend/tests/test_security.py`. |
| PP-02 | P2 | `render.yaml` used `/health` for the platform health probe even though `/health` is intentionally liveness-only and can report process status while serving artifacts are not all loaded. | **Fixed:** set Render's health check to `/ready`, which returns success only when required models are loaded. |
| PP-03 | P2 | `frontend/src/api/client.js` aborted every request after 30 seconds. Render documents that a free web service can take about one minute to resume after idling, so the configured timeout could abort a normal cold-start request before the API came back. | **Fixed:** allow 90 seconds for a Render-hosted API while retaining the 30-second limit for local/self-hosted APIs; cold-start timeout feedback is clearer. |
| PP-04 | P3 | Middleware comments incorrectly described `SecurityHeadersMiddleware` as the outermost user middleware even though CORS is added outside it. | **Fixed:** clarify the actual wrapping order to reduce the chance of a future middleware-order regression. |
| PP-05 | P3 | `RELEASE_STATUS.md` still said the hardening branch was pending verification and was last maintained on 2026-10-03, despite later main-branch merges and a green main CI run. | **Fixed:** refresh the status date and document the exact-commit CI requirement. |

## Platform constraint that remains

The Render Blueprint declares `plan: free`. Render's official documentation says free web services spin down after 15 minutes without inbound traffic and take about one minute to start again ([Render free-service limits](https://render.com/docs/free), checked 2026-10-16). That behavior is external to application code. The 90-second timeout prevents the frontend from giving up too early, but **it does not keep the API continuously online**. Continuous availability requires moving the API to a paid compute plan; do not claim the code change removes free-tier spin-down.

## Verification still required for this branch

- The code/config changes were made on `audit/production-hardening-2026-10-16`, not directly on `main`.
- GitHub Actions must pass for the exact resulting commit before merge. The previous main-branch green run is baseline evidence, not a substitute for branch CI.
- The current production instance's live health/logs were not available from the GitHub repository connection, so this report does not claim that a live deployment was probed or redeployed.
- Historical audit files are preserved as historical evidence; they were not rewritten to pretend old findings never existed.
