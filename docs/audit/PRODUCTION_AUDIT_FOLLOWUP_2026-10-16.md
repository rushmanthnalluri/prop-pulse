# PropPulse — Production Audit Follow-up (2026-10-16)

## Executive summary

This follow-up reconciles the older comprehensive source-audit ledger with the current API deployment, recent reliability changes, and the remaining production risks. It does **not** claim that no possible defects exist. Release readiness must be established from the exact current `main` commit, its complete CI run, and the matching live Render deployment.

The prior full-source audit records approximately 16,900 auditable lines, 355 function-level coverage entries, and no unreviewed functions in `LINE_BY_LINE_AUDIT.md`. Its detailed historic findings are in `FINDINGS.md`; the Aug 2026 verdict in `FINAL_AUDIT.md` is historical and predates the reliability findings below.

## Findings from this follow-up

| ID | Severity | Finding | Disposition |
|---|---|---|---|
| PP-28 | P2 | Workflow job creation spawned a Python child for every accepted request. Children imported heavy ML/training libraries before acquiring the global admission lock, so bursts could consume memory even though an individual fit was bounded. | The audit change set adds a cross-process submission lock, caps globally queued/running jobs at two (one active plus one waiting), returns HTTP 409 on overflow, and defers heavy trainer/search imports until the child owns the lock. New queue-overflow regression coverage was added. Verify the current PR and deployed commit before calling it released. |
| PP-29 | P2 | A queued child gave up after 60 seconds of lock contention; a legitimate long fit could make the one waiting job fail before it could start. | The audit change set raises the bound to 15 minutes and extracts a testable admission-wait helper. Regression coverage verifies both wait-until-available behavior and timeout behavior. |
| PP-30 | P2 | CI tested Python 3.12 while Render's `PYTHON_VERSION` is 3.14.5, leaving the deployed interpreter outside the regular full-test/audit gate. | The CI Python job now runs dependency audits and the full Python suite on both 3.12 and 3.14.5. Both matrix legs must pass for release. |
| PP-31 | P1 | Prediction, metrics, CSV upload, preprocessing, and training endpoints are public without authentication or rate limiting. The bounded training queue reduces one resource-exhaustion path but does not provide identity, quotas, or protection against repeated uploads/requests. | **Open:** tracked in [issue #10](https://github.com/rushmanthnalluri/prop-pulse/issues/10). Choose the product access model before implementing enforcement: public valuations with carefully scoped abuse controls, API credentials through a safe server-side flow, or user identity/authorization. Never put a static secret in the browser bundle. Include upload/storage quotas as well as request and training limits. |
| PP-32 | P2 / infrastructure constraint | The configured Render Free web service can spin down after inactivity and take time to resume. Increasing the frontend timeout improves user experience but cannot guarantee continuous availability. | Not a source-code defect. Continuous always-on availability requires a paid compute plan or a different hosting arrangement. See [Render's free-service limits](https://render.com/docs/free). |
| PP-33 | P2 / scale constraint | Workflow locking is filesystem-based and runtime metrics are process-local. Multiple API instances without a shared locking/storage layer can admit conflicting workflow operations, while counters are not aggregated. | The single-instance limitation is documented. Before horizontal scaling, use shared storage with reliable lock semantics (or route workflow jobs to one worker) and external metrics aggregation. |
| PP-34 | P3 | The release-status file contained a hard-coded old green SHA, although main had moved on and the new deployment was later than that SHA. | `RELEASE_STATUS.md` now points to live main CI and Render deployment records and labels the `dde8ed9` verification as a historical baseline only. |

## Existing catalog and disposition

The historic ledger `FINDINGS.md` lists AUD-01 through AUD-27. The current implementation already contains the associated remediations or documented decisions recorded in the subsequent final audit:

- **Validation and API hardening:** non-finite JSON values are rejected as validation errors; request bodies are bounded, including streamed/chunked bodies; generic 500 responses avoid leaking stack traces; security headers, CORS origin validation, and readiness behavior are implemented.
- **Metrics and drift:** 500 responses are counted, request metrics use bounded route-template keys, disk I/O is kept out of the metrics lock, degenerate PSI bins and low sample sizes are handled, and calendar-only drift does not trigger a retraining recommendation.
- **Serving and model integrity:** prediction probability fallback is explicit, response models/path exposure are guarded, model-selection/evaluation/prediction validates preparation fingerprints, and workflow sandbox writes are kept apart from champion artifacts.
- **Frontend and request lifecycle:** API calls have bounded timeouts/abort support; UI degraded/empty states and mobile factor rendering were fixed; Recharts 3 is linted/built in CI.
- **Build/dependency/deployment:** compose base and alternate-port configurations are validated; backend Docker images are smoke-tested; dependency audits and strict-warning tests are CI gates.
- **Documented rather than silently changed:** AUD-13's MSSubClass dtype issue is documented instead of forcing a model-space change without evidence of train/serve skew. Other accepted limitations—including the simulated classification target, OOD extrapolation caveat, process-local metrics, and the framework's generic-500 CORS limitation—remain as stated in `FINDINGS.md` and `FINAL_AUDIT.md`.

These are historical audit dispositions; the latest source, tests, CI result, and deployment always take precedence.

## Verification evidence

- Verified pre-follow-up baseline: [main CI run #38833983638](https://github.com/rushmanthnalluri/prop-pulse/actions/runs/38833983638) passed on `dde8ed907971136e8bfa679b02c2d97ab20d3550`; Render reported that revision's deployment live.
- Queue protection, admission timeout, and Python runtime parity are included in the linked audit change set. The release criterion is a **green CI result for the exact final PR head**, followed by a merge and a Render deployment showing the merged main commit live.
- The API's authentication/rate-limiting gap remains open until the product access model is chosen and the resulting controls are tested.
- Render Free-tier cold starts can still happen even after the code checks pass. Do not interpret a long cold-start response as proof of a code crash without correlating it with health and deploy events.
