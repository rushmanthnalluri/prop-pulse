# PropPulse — Current Release Truth

> **Authoritative rule:** this file defines release gates and operational constraints. Numeric test counts and runtime claims are not authoritative unless attached to a GitHub Actions verification run for the exact commit being released.

## Release gates

A commit is release-verifiable only when the CI `verification` job reports every gate as `success`: Python dependency audit + pytest; frontend audit/lint/build; Docker Compose validation; Docker build + health/readiness smoke; and Chromium Playwright E2E.

CI writes `reports/verification/latest.json` and `reports/verification/latest.md` for the run and uploads the report as an artifact. The exact commit and run URL are recorded there.

## Integrity invariants

- Every workflow training job is bound to the preparation fingerprint it actually trains against.
- Evaluation and sandbox prediction reject results whose preparation fingerprint is no longer current.
- Candidate selection is derived from one valid job/candidate pair.
- `can_train` uses the same post-preparation train-row calculation as stage 06.
- Training/preprocessing admission is filesystem-backed and cross-process; it is not a Python-process mutex.
- PSI monitoring explicitly marks degenerate binning and applies an edge-aware fallback rather than silently returning zero drift.
- `/health` is liveness; `/ready` is serving readiness.
- Every request receives an `X-Request-ID` correlation identifier; metrics expose in-flight count and last-request time.

## Historical evidence

`docs/audit/`, `docs/agent-log/`, `reports/`, and dated QA documents are evidence of earlier audits or executions. They are retained for traceability and must not be quoted as current release status without an exact commit/run reference.

## Deployment constraint

The workflow admission lock is shared through the workflow model storage root. Multiple API replicas therefore require storage with reliable cross-replica file locking; local ephemeral storage is not a valid multi-replica coordination backend.

Workflow model state is shared state. Production horizontal scaling therefore requires shared persistent storage or a future database/queue-backed workflow coordinator before enabling multiple workflow-serving replicas.

## Updating release truth

Do not hand-edit historical test counts into this file. For a release candidate, use the CI verification artifact and run URL for the exact commit as the authoritative execution record.