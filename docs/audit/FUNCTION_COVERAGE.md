# Function Coverage Matrix — Summary

355 function/config matrix entries were individually reviewed across the six line-by-line
audits (per-function rows: llba-data 54, llba-features 44, llba-training 58, llba-services 48,
llba-backend 74, llba-frontend-infra 77 incl. infra-config directives).

Aggregate status across all matrices:

| Status | Count |
|---|---|
| PASS (verified by execution or statically) | 186 |
| PASS WITH CONCERN (works; documented nit) | 49 |
| NOT EXECUTABLE (dead-by-design code paths, e.g. future providers) | 7 |
| NOT APPLICABLE | 1 |
| FAIL | 0 (all defect findings were filed as P2/P3 and fixed in wave C — see FINDINGS.md) |

Execution coverage: every serving-path function was executed (API audit, contract audit,
black-box E2E, integration tests); training/evaluation/clustering CLIs were executed by the
regression/classification/clustering/artifacts auditors via recomputation and the
reproducibility re-run (not by the unit suite — recorded in test-audit §5 as the structural
coverage gap: total statement coverage 69%, backend 84–100%, serving-side ml 82–100%).

The full per-function matrices (inputs, types, validation, side effects, branches, error
handling, returns, callers, edge cases, test coverage, status) are in:

- `docs/audit/llba-data.md` — data pipeline (incl. DOM simulator + real-DOM adapter)
- `docs/audit/llba-features.md` — feature engineering + serving mapping
- `docs/audit/llba-training.md` — training, tuning, calibration, champion selection, MLflow helper
- `docs/audit/llba-ml-services.md` — clustering, SHAP, monitoring/PSI
- `docs/audit/llba-backend.md` — entire FastAPI app
- `docs/audit/llba-frontend-infra.md` — entire frontend + scripts + Docker/CI/config
