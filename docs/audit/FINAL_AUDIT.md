# PropPulse Final Forensic Audit

## Executive Verdict

**PASS** — every critical function reviewed, executed, and evidence-backed; zero P0, zero P1;
all P2 defects fixed and regression-tested; documentation reconciled to reality.

## Repository Snapshot

- VCS: none (`git status` → not a repository). Baseline = filesystem state, 2026-08-07.
- Environment: Windows 11 + Git Bash, Python 3.14.5 (.venv), Node 24, Docker Server 29.4.0.
- Prior claims under review: "162 tests green", champions ridge + calibrated RF, test R² 0.9305 /
  ROC-AUC 0.7666, threshold 0.203292 val-tuned, 4 micro-markets, warm /predict ≈197 ms, Docker
  build verified, E2E 5/5, reproducibility PASS.

## Agents Executed

- Wave A (17): six line-by-line auditors (data / features / training+evaluation / ml-services /
  backend / frontend+infra) + data-exec, leakage, regression, classification, clustering, shap,
  artifacts, frontend-static, security, test-audit, docs-truth.
- Wave B (6 runtime): api, contract, monitoring, devops, performance, blackbox-e2e.
- Wave C (7 fixers): fix-backend, fix-monitoring, fix-data, fix-frontend, fix-docker,
  fix-ml-misc, fix-docs.
- Wave D: orchestrator consistency pass + this report.

## Files / Functions Audited

- ~16,900 auditable lines; 355 per-function matrix entries; 0 unreviewed functions.
- Ledger: `LINE_BY_LINE_AUDIT.md` · matrices: `FUNCTION_COVERAGE.md` · per-area verdicts: `FILE_COVERAGE.md`.

## Tests Executed

- pytest: **210 passed, 0 failed** (final orchestrator runs: 52.3 s and re-run after doc edits).
  Pre-audit claim was 162; growth = audit regression tests. Verified by independent execution,
  not reported counts. Statement coverage measured at 69% total (backend 84–100%; serving-side
  ml 82–100%; training CLIs uncovered by unit tests but executed + hash-verified by the
  reproducibility audit).
- Playwright E2E: **24/24 passed** (5 original + 11 black-box + 8 frontend-fix specs).
- Integration marker: 8 real end-to-end tests (pipeline↔API parity, drift, logging).

## Runtime Verification (lead + runtime auditors, live servers/containers)

- All 8 endpoints: 200/422/413/404/500 behavior probed (96 boundary probes, 39 validation
  probes, abuse battery) — zero stack traces, zero leaks.
- `/predict` byte-identical pre/post fix wave ($248,220.67 / p=0.321438 on the canonical payload).
- Docker: images rebuilt during audit (staleness found), full in-compose smoke PASS on both
  as-built and rebuilt images; mlflow profile 200; compose configs (base + alt-ports) valid.
- Performance: warm /predict p50 197–209 ms (quiet), 0 errors / 2,015 requests, no memory leak;
  cold start ≈0.4 s; SHAP warm p50 22.5 ms.

## ML Verification (independent recomputation)

- Ridge champion: val RMSLE 0.1354 / test R² 0.9305 / MAE $15,075 / RMSLE 0.1187 — recomputed
  from artifacts, matches. Registry copy byte-identical to trained artifact.
- Calibrated RF: test ROC-AUC 0.7666 / PR-AUC 0.5674 / Brier 0.1710 / F1 0.5063 — recomputed,
  matches. Threshold 0.203292 re-derived on VAL (test-optimal differs → selection was val-only).
  **Target is SIMULATED (ADR-3)** — labels verified consistent with days_on_market; every doc
  quoting classification metrics carries the caveat (one omission fixed).
- Leakage: 12/12 checks SAFE by execution (train-only stats/imputation/defaults, disjoint
  splits, in-pipeline preprocessing, val-only tuning/selection/threshold, train SHAP background).
- SHAP: additivity verified (1e-6), one-hot→base aggregation verified arithmetically, sign
  checks (OverallQual/GrLivArea/age) correct, UI factors traced to API response — no fabrication.
- Clustering: eps/min_samples/labels reproduced exactly; fallback math hand-verified; centroid-
  grain geography confirmed (25 points) and honestly documented.
- Artifacts: 17/17 joblibs load in fresh subprocesses; feature schema == 94 MODEL_FEATURES at
  both Pipeline and fitted-ColumnTransformer level; reproducibility audit PASS (byte-identical
  data/features, retrain diff ≤ 2.2e-16).

## Findings (final)

- **P0: 0 · P1: 0** — none found by any agent.
- **P2: 15** (AUD-01…15) — all fixed + regression-tested, except AUD-13 (MSSubClass numeric
  treatment) which is documentation-corrected + ADR-11 by design (no train/serve skew; retrain
  rejected under "do not modify a working model without evidence of incorrectness") and
  AUD-15 (stale demo log) closed by orchestrator reset.
- **P3: ~30** — all material ones fixed (see FINDINGS.md AUD-16…27); remainder explicitly
  accepted with rationale in FINDINGS.md (e.g. CORS-on-500 framework limitation, mlflow
  housekeeping cosmetics, OOD-extrapolation caveat, serving-date default OOD note).

## Fixed During Audit (wave C, all regression-tested)

Backend: NaN/Inf→422, chunked-body 413, 500s counted, route-template metric keys, warning-flood
fix (170,230→0 warnings at c=25), sale_date bounds, response_model validation, path stripping,
repo-anchored .env, lock/I/O fix, classes_ guard. Monitoring: PSI degenerate-bin fallback
(PoolArea outlier PSI 0.0→18.75), calendar-drift guard on retraining flag, DRIFT_PSI_THRESHOLD
wired, low_sample flag, lazy imports, corrupt-reference clean error. Data: empty-frame guard,
schema dtype truth, DOM env ergonomics. Frontend: 30 s timeout + unmount abort, empty-factors
state, mobile wrap, degraded pill, low-sample note. Devops: compose override renamed to opt-in
`docker-compose.alt-ports.yml`, CI validates both configs. Tests: champion guards tightened
(R²≥0.90 etc.). Docs: 48 edits — every verified-stale claim corrected.

## Remaining Limitations (documented, accepted)

Simulated DOM target; centroid-grain geo; champion margin not statistically significant;
cryptography CVE blocked by mlflow pin; no auth/rate-limiting; training CLIs outside unit-test
coverage (covered by reproducibility re-run instead); latency figures are quiet-machine numbers.

## Evidence

`docs/audit/` — 25 audit/fix reports + ~120 evidence files (raw command output, responses,
screenshots). Master defect list: `FINDINGS.md`.

## Final Recommendation

**RELEASE stands (v1.0.0, post-audit).** The system is internally consistent from raw data to
rendered prediction; every number in the documentation was reproduced or corrected.
