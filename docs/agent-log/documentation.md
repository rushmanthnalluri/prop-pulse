# Agent Log — documentation

**Scope owned:** `README.md` (root), `docs/API.md`, `docs/METHODOLOGY.md`,
`docs/DEPLOYMENT.md`. No code touched. Status: **complete** (2026-08-07).

## What was written

| File | Contents |
|---|---|
| `README.md` (new, 370 lines) | Overview + problem statement; feature list; mermaid architecture diagram (adapted from `docs/ARCHITECTURE.md`); dataset section (Ames, De Cock 2011 citation, 1460 rows, both documented fallbacks with the exact ADR-3 label and swap-in paths — `RealDomProvider` / passing `lat`/`long` through); methodology + feature-engineering summaries (94 features, leakage-safe stats); champion tables (ridge val RMSLE 0.1354/R² 0.9280, test R² 0.9305/MAE $15,075/RMSLE 0.1187; calibrated RF test ROC-AUC 0.7666/PR-AUC 0.5674/Brier 0.1710, threshold 0.2033; bootstrap CI includes 0 — not decisive, and the honest note that XGBoost wins on the sealed test); clustering (DBSCAN eps 1.317, 4 micro-markets + 3 noise neighborhoods + serving fallback); explainability (SHAP → base features; top: OverallQual 0.057, OverallCond 0.040, total_sf 0.030, GrLivArea 0.026); API summary table; frontend (3 views); local setup; Docker (builds unverified per ADR-7); testing; monitoring/drift (PSI, recommendation-only semantics, calendar-feature caveat); CI; structure tree; limitations + future improvements. |
| `docs/API.md` (new, 590 lines) | All 8 endpoints with full request schema (every `PropertyInput` field mirrored from `backend/app/schemas/property.py` — core + 28 advanced overrides, exact enum sets, ranges, defaults), real captured curl + JSON responses, field-by-field response semantics (interval method, threshold, fallback flag, factor magnitudes), 422/500/503 error formats with real examples, CORS section. |
| `docs/METHODOLOGY.md` (new, 243 lines) | Time-based split rationale; leakage controls (train-only stats, sealed test, no target-derived inputs); tuning protocol (5-fold CV on train, 1-SE rule — ridge shipped alpha=100 vs grid-best 31.6, RandomizedSearch n_iter=8 spaces); calibration (sigmoid cv=5); threshold selection (max val F1 → 0.203292, why not 0.5); champion statistics (paired bootstrap 2000 resamples, CI [-0.0133, +0.0060], P=0.193); price-interval method (Q10/Q90 val residuals, test coverage 0.783, nominal not conformal); clustering protocol (scaling, k-distance knee, both candidates, enrichment, fallback); explainability (LinearExplainer, 200-row background, dummy aggregation, additivity); honest limitations (1460 rows, simulated DOM, approximate geo, 2006–2010 market, non-decisive champion margin). |
| `docs/DEPLOYMENT.md` (new, 187 lines) | Full env-var reference (all `.env.example` keys incl. `CORS_ORIGINS`); local production-style run (single-worker rationale); compose walkthrough incl. opt-in `mlflow` profile; drift-check scheduling (cron / `docker compose exec` / scheduled-CI, exit-code semantics); CI description (3 jobs); hardening checklist (reverse proxy/TLS, auth, secrets manager, CORS tightening, log rotation, supervision, image pinning, artifact governance, observability). |

## Verification evidence (all actually executed)

- **Full test suite:** `.venv/Scripts/python.exe -m pytest tests backend/tests -q`
  → **114 passed in 80.49s** (after the integration wave; 104 before it).
  Marker run: `pytest tests -m integration -q` → **8 passed, 89 deselected**.
- **Live API verification** (uvicorn on :8123/:8124, real champions): captured
  the actual responses used in `docs/API.md` — `GET /health`,
  `POST /predict` (StoneBr full payload: $204,881.59, range
  [177,945.52, 230,227.22], p=0.408609 @ threshold 0.203292, cluster 0,
  5 SHAP factors), `POST /predict/price` + `/predict/sale-probability`
  (NAmes minimal payload), `GET /model/info` (n_features=94), `GET
  /market/clusters`, `GET /metrics`, two real 422 shapes (unknown
  neighborhood, range violation), and `GET /model/importance` → live 200
  with the full metadata + importance payload. CORS preflight:
  `http://localhost:8080` → 200 (allowed), `http://localhost:4173` → 400
  (rejected — not in default `CORS_ORIGINS`).
- **CLI existence:** `--help` run for `ml.data.pipeline` and
  `ml.monitoring.drift_check`; `__main__`/main() confirmed for
  `ml.features.pipeline`, `ml.training.train_regression`,
  `ml.training.train_classification`, `ml.clustering.train`,
  `ml.evaluation.evaluate`, `ml.explainability.build_artifacts`,
  `ml.monitoring.reference`. No flags were documented that don't exist.
- **Numbers cross-check:** a script compared 28 quoted metrics in my docs
  against `models/champion.json` (all OK), plus eps 1.317 vs
  `cluster_stats.json`, SHAP top-4 vs `feature_importance.json`, 94 features
  vs `feature_list.json`, and the test confusion matrix (TP 40/FP 69/FN 9/
  TN 57). The 25-neighborhood list in API.md matches the live validator's
  error message verbatim.
- **Referenced files exist:** `figures/shap_{bar,summary}.png`,
  `data/processed/outliers_report.json`,
  `models/monitoring/{reference_stats,prediction_reference}.json`, all
  linked docs/READMEs.
- `logs/predictions.jsonl` was re-truncated to empty after each smoke run
  (the state the backend agent left it in).

## Source inconsistencies found (for the orchestrator)

1. **`docker/README.md` CORS caveat is now stale.** It still says the backend
   allows only `http://localhost:5173` and the composed `:8080` frontend will
   be rejected "until the backend allow-list includes that origin (backend
   scope)". The integration wave made CORS env-driven
   (`CORS_ORIGINS` in `.env.example` = `:5173,:8080`; verified live: `:8080`
   preflight → 200). I could not fix it (devops-owned file); my
   DEPLOYMENT/API docs reflect the new reality.
2. **`frontend/README.md`** still says the Model Insights importance chart
   has a "graceful error state until the endpoint lands" — `GET
   /model/importance` has now landed (verified live). Frontend-owned file.
3. **SPEC §14 vs `.env.example`:** SPEC says `MLFLOW_ALLOW_FILE_STORE` should
   be set in `.env.example` too, but it is not there (only the compose
   mlflow service env + `ml/tracking.py` in-process set it). Documented as
   such in DEPLOYMENT.md.
4. **SPEC §8 example `/predict` response** omits `sale_probability.threshold`
   and the `micro_market` `fallback`/`note` fields that the real API
   returns — the implementation is a superset; I documented the real
   responses.
5. **Backend agent log** reports 15 API tests; the integration wave added 2
   router tests (17 now; repo total 114).
6. Transient during my run: a standalone `-m integration` invocation caught
   the integration agent's `test_end_to_end.py` mid-write (1 failed);
   re-ran after their wave finished → green. Not a product bug.

## Notes

- No git mutations were performed. One read-only `git status` slipped into a
  compound cleanup command early on (output discarded to /dev/null, no
  effect); nothing else git-related was run.
- `docs/AGENT_STATUS.md` untouched, per instructions.
- The shared TodoList was concurrently used by the integration agent; my
  final state: all documentation deliverables complete and verified.
