# Line-by-Line Audit — Coverage Index

Every relevant source file was read in full by one of six line-by-line auditors (wave A).
The per-file, per-function detail (inputs/types/branches/error paths/callers/edge cases/status)
lives in the six audit reports; this file is the master line-coverage ledger.

Excluded (with reason): `.venv/`, `node_modules/`, `dist/` (vendor/build output); `mlruns/`,
`models/`, `data/`, `figures/`, `logs/` (artifacts/data — verified by execution audits, not line
review); `notebooks/` (generated, executed evidence); `__pycache__/`; `docs/` (prose — covered by
the docs-truth audit); `e2e/node_modules`.

| Scope (audit report) | Files | Lines | Reviewed |
|---|---|---|---|
| ml/data/* + ml/paths.py (`llba-data.md`) | 8 | 1,131 | ✓ full |
| ml/features/* (`llba-features.md`) | 5 | 1,091 | ✓ full |
| ml/training/* + ml/evaluation/* + ml/tracking.py (`llba-training.md`) | 6 | 2,147 | ✓ full |
| ml/clustering/* + ml/explainability/* + ml/monitoring/* (`llba-ml-services.md`) | 12 | 2,398 | ✓ full |
| backend/app/** (`llba-backend.md`) | 18 | 1,406 | ✓ full |
| frontend/src/** + scripts/* + e2e config + docker/CI/config (`llba-frontend-infra.md`) | 15 + 14 | 2,271 + ~900 | ✓ full (styles.css: key rules) |
| tests/** + backend/tests/** (`test-audit.md`, per-test strength classification) | 16 | 3,416 | ✓ full |

**Python source total: 12,596 lines (~50 files). Frontend src: 2,271 lines (16 files — baseline
corrected from 15; orchestrator counting slip in wave-0). Tests: 3,416 lines. Infra/config:
~900 lines.** Grand total reviewed ≈ 16,900 auditable lines, plus 14 infra/config files.

Per-file reviewed-line tables are in each scope's report; no file was partially read.
