# File Coverage

| Area | Files | Audited by | Verdict |
|---|---|---|---|
| ml/data (8) | ingest, clean, validate, outliers, split, sale_speed, pipeline, paths | llba-data + data-exec + leakage | PASS (fixes applied: AUD-09/13/16/23) |
| ml/features (5) | pipeline, stats, defaults, serving, __init__ | llba-features + data-exec + leakage | PASS |
| ml/training + ml/evaluation + tracking (6) | common, train_regression, train_classification, select, evaluate, tracking | llba-training + regression + classification + artifacts | PASS (fix: AUD-12/26a) |
| ml/clustering (4) | dataset, train, serve, __init__ | llba-ml-services + clustering | PASS (fixes: AUD-26b/c) |
| ml/explainability (4) | explainer, build_artifacts, service, __init__ | llba-ml-services + shap | PASS (fix: AUD-26d) |
| ml/monitoring (4) | psi, reference, drift_check, __init__ | llba-ml-services + monitoring | PASS (fixes: AUD-06/07/08/25) |
| backend/app (18) | all routers, services, schemas, middleware, security, config, main | llba-backend + api + security | PASS (fixes: AUD-01/02/03/04/11/17/18/19/20/21/22) |
| frontend/src (16) | all pages, components, api client, constants, format | llba-frontend-infra + frontend-static + contract + blackbox | PASS (fixes: AUD-10/24) |
| scripts (2) | load_test.py, audit_reproducibility.py | llba-frontend-infra + performance + artifacts | PASS |
| tests (16) + e2e (3 specs) | all | test-audit + blackbox-e2e | PASS (210 pytest + 24 playwright green post-fix) |
| docker + CI + config (14) | Dockerfiles, nginx.conf, compose ×2, ci.yml, pytest.ini, .env.example, requirements ×2, package.json, vite/playwright configs | llba-frontend-infra + devops + fix-docker | PASS (fix: AUD-05) |
| docs (all .md) | README, FINAL-RELEASE, docs/*, reports/*, READMEs | docs-truth + fix-docs | PASS (48 edits, AUD-27) |

Excluded from line review (verified by execution instead): model/data artifacts (`models/`,
`data/processed/`, `mlruns/`) — byte-level + recomputation verification by the artifacts,
data-exec, regression, classification, clustering, and reproducibility auditors.
