# PropPulse — Forensic Audit Plan (Agent 0 / Audit Orchestrator)

## Baseline snapshot (recorded before any audit action)

- **VCS:** none — `git status` → "not a git repository". Baseline = filesystem state, 2026-08-07.
- **Source inventory (auditable, excludes `.venv/`, `node_modules/`, `dist/`, `mlruns/`, data, models, caches):**
  - Python (ml/, backend/app/, scripts/, tests/, backend/tests/, e2e/): **12,596 lines / ~50 files**
  - Frontend (frontend/src/): **2,271 lines / 15 files**
  - Config/infra: docker-compose.yml + override, docker/*.Dockerfile + nginx.conf, .github/workflows/ci.yml, pytest.ini, .env.example, requirements.txt ×2, frontend/package.json, e2e/playwright.config.js
- **Key claimed values to verify independently** (from README/FINAL-RELEASE/reports):
  splits 945/338/175; 94 MODEL_FEATURES; champions ridge + calibrated RF; ridge val RMSLE 0.1354 / test R² 0.9305 / MAE $15,075 / RMSLE 0.1187; RF test ROC-AUC 0.7666 / PR-AUC 0.5674 / Brier 0.1710; threshold 0.203292 (val-tuned); 4 DBSCAN clusters + 3 noise; 162 tests; warm /predict p50 ≈197 ms; SHAP warm ≈50 ms; docker build verified; E2E 5/5; reproducibility PASS.

## Rules for all audit agents

1. Report-only in waves A/B — **no code edits**; fixes are orchestrated centrally in wave C after the consistency review. (Exception: none.)
2. PASS requires evidence: `PASS — verified by execution` (paste command+output into `docs/audit/evidence/…`) or `PASS — statically verified` (file:line). Otherwise BLOCKED/FAIL.
3. Every finding gets severity P0/P1/P2/P3 (per mission §24) and a repro.
4. Never trust README/reports/previous agent logs — recompute.
5. Write your audit to `docs/audit/<agent-name>.md`; large outputs to `docs/audit/evidence/<agent-name>-*.txt`.
6. No git commands (there is no repo). No secrets in evidence files. Kill any server you start; verify your assigned ports are free afterwards.
7. Final message: findings table (severity, file:line, evidence) + coverage summary + anything the orchestrator must reconcile.

## Wave plan

- **Wave A (17 agents, static + ML verification):**
  - llba-data (ml/data/*, ml/paths.py) · llba-features (ml/features/*) · llba-training (ml/training/*, ml/evaluation/*, ml/tracking.py) · llba-ml-services (ml/clustering/*, ml/explainability/*, ml/monitoring/*) · llba-backend (backend/app/**) · llba-frontend-infra (frontend/src/**, scripts/*.py, e2e/playwright.config.js, docker/*, compose files, ci.yml, pytest.ini, .env.example, requirements*.txt)
  - data-exec (§6) · leakage (§7) · regression (§8) · classification (§9) · clustering (§10) · shap (§11) · artifacts (§12) · frontend-static (§14) · security (§17) · test-audit (§18) · docs-truth (§21)
- **Wave B (6 agents, runtime):** api (§13, port 8300) · contract (§15, ports 8400/5400) · monitoring (§16, CLI only) · devops (§19, override ports 18000/18080/15000) · performance (§20, port 8500) · blackbox-e2e (§22, ports 8100/5200)
- **Wave C:** fix agents for confirmed defects + regression suite + re-audit of touched files.
- **Wave D (orchestrator):** cross-agent consistency audit, coverage merge (FILE_COVERAGE.md, FUNCTION_COVERAGE.md, LINE_BY_LINE_AUDIT.md), FINDINGS.md, FINAL_AUDIT.md.

Line-by-line agents produce: per-file reviewed-line table + per-function matrix
(inputs/types/validation/side-effects/branches/error-handling/returns/callers/edge-cases/test-coverage/status)
+ findings. Status vocabulary: PASS / PASS WITH CONCERN / FAIL / NOT EXECUTABLE / NOT APPLICABLE.
