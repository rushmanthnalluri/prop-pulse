# PropPulse — Current Release Truth

**Status source:** release readiness is the latest successful CI run on `main` **and** a matching live Render deployment. Check the [main CI runs](https://github.com/rushmanthnalluri/prop-pulse/actions/workflows/ci.yml?query=branch%3Amain) and [Render service/deploy history](https://dashboard.render.com/web/srv-d9s4um7avr4c73afli80) together; a pull-request run alone is not proof that a change is released.
**Verified baseline snapshot:** on 2026-10-16, `dde8ed9` passed main CI run [#38833983638](https://github.com/rushmanthnalluri/prop-pulse/actions/runs/38833983638) and Render reported that deployment live. This baseline is historical evidence, not a substitute for checking later releases.
**Last maintained:** 2026-10-16

This file is the single current release-status authority for PropPulse.
Date-stamped release notes, forensic audits, agent logs, screenshots, and prior
verification reports are historical evidence or technical detail; they must not
be used as current pass/fail or vulnerability status.

## Release gates

| Gate | Current source of truth |
|---|---|
| Functional tests | GitHub Actions `python` job |
| Frontend lint/build | GitHub Actions `frontend` job |
| Compose validation | GitHub Actions `docker` job |
| Docker image + runtime smoke | GitHub Actions `docker-build` job |
| Security dependencies | `pip-audit` + `npm audit` in CI |
| Browser E2E | `e2e/` suite + GitHub Actions `e2e` job |
| Consolidated verification | CI `verification` job artifact + job summary |

## Hardening status

| Priority | Item | Status on this branch |
|---|---|---|
| P0 | One current release truth | Implemented |
| P1 | Prepare-fingerprint binding | Implemented at train, model-selection, evaluation, and sandbox-predict boundaries |
| P1 | Stale model/evaluation combinations | Rejected with HTTP 409; stale candidates remain auditable but are ineligible for selection |
| P1 | Public API authentication and rate limits | **Open:** tracked in [issue #10](https://github.com/rushmanthnalluri/prop-pulse/issues/10); requires an access-model decision. Queue caps mitigate one resource-exhaustion vector but do not replace AuthN/AuthZ or per-client quotas |
| P2 | Candidate-selection synchronization | Frontend derives an effective completed candidate and validates the pair at submission |
| P2 | `can_train` eligibility | Uses the same split/outlier rules as stage-06 preparation |
| P2 | Training lock | Cross-process filesystem admission lock; trainer owns it during the fit |
| P2 | Workflow subprocess fan-out | Audit follow-up bounds queued/running jobs to two, rejects overflow with 409, delays heavyweight training imports until lock ownership, and extends the admission wait to 15 minutes; confirm the exact-head CI and live Render deploy before treating the changes as shipped |
| P2 | Python runtime parity | Audit follow-up runs the Python gate on both 3.12 (Docker/test baseline) and 3.14.5 (configured Render runtime); release gate must pass on both |
| P2 | PSI degenerate features | Effective-bin metadata is validated and degenerate features are surfaced in drift reports |
| P3 | Historical documentation contradictions | Current truth separated from historical evidence |
| P3 | Dependency upgrades | Recharts 3 and refreshed Python/frontend pins; npm audit, pip-audit, strict-warning tests, and both Python runtime versions are release gates |
| P3 | Production observability | Request IDs, in-flight request gauge, last-request timestamp, and readiness probe added |
| P3 | CI verification report | Added as a consolidated generated artifact/summary |
| P3 | Deployment/scaling documentation | Shared-lock/storage and metrics scope documented |

## Verification rule

A hardening change is considered release-ready only when the consolidated CI
verification is green for the exact commit being released. Do not copy test
counts, security findings, or Docker claims from older reports into current
release notes.

## Known architectural constraints

- Workflow training and preprocessing share a filesystem lock. Horizontally
  scaled instances must share a filesystem with reliable locking semantics for
  the configured workflow-model root, or workflow operations must be routed to
  one instance.
- Runtime metrics are process-local counters. Aggregate production metrics
  should come from the deployment's Prometheus/OpenTelemetry/logging layer.
- `render.yaml` currently selects Render's Free web-service plan. Free services
  spin down after 15 minutes without traffic and take about one minute to resume;
  a longer client timeout improves cold-start UX but cannot guarantee continuous
  availability. Continuous availability requires a paid compute plan
  ([Render free-service limits](https://render.com/docs/free)).
- The classification sale-speed target remains explicitly simulated for the
  bundled Ames dataset.
