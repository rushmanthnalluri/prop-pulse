# PropPulse — Current Release Truth

**Status:** hardening branch pending CI verification
**Last maintained:** 2026-10-03

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
| P2 | Candidate-selection synchronization | Frontend derives an effective completed candidate and validates the pair at submission |
| P2 | `can_train` eligibility | Uses the same split/outlier rules as stage-06 preparation |
| P2 | Training lock | Cross-process filesystem admission lock; trainer owns it during the fit |
| P2 | PSI degenerate features | Effective-bin metadata is validated and degenerate features are surfaced in drift reports |
| P3 | Historical documentation contradictions | Current truth separated from historical evidence |
| P3 | Dependency upgrades | Runtime pins upgraded and frontend transitive advisories patched; exact-commit CI must validate resolver/audit compatibility |
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
- The classification sale-speed target remains explicitly simulated for the
  bundled Ames dataset.
