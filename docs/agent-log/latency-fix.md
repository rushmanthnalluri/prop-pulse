# Agent Log — latency-fix

**Scope owned:** `backend/` (surgical edits) + 'After fix (wave 9b)' section in
`reports/PERFORMANCE.md` + this file. Status: **complete**.

## What changed and why

Warm `POST /predict` was p50 ≈ 800–970 ms / ~1 req/s (see reports/PERFORMANCE.md): ~85%
of the request was the classification champion's `predict_proba` — 5 calibrated folds each
spawning/tearing down a joblib process pool for a single-row call (`n_jobs=-1`). Four
minimal fixes, **no response-shape or prediction-value changes**:

1. **`n_jobs=1` at load** — new `force_single_threaded()` in
   `backend/app/services/prediction_service.py:45` recursively pins every inner estimator
   that has `n_jobs` (walks Pipeline `steps`, ColumnTransformer `transformers_`/
   `transformer_list`, `CalibratedClassifierCV.calibrated_classifiers_` → their
   `estimator`). Called on the in-memory champion right after `joblib.load` in the lifespan
   (`backend/app/main.py:124`). The joblib artifact on disk is untouched.
2. **Narrow endpoints skip work they don't return** — `PredictionService` gained
   `predict_price()` (no classifier, no SHAP) and `predict_sale_probability()` (no
   regressor, no SHAP); the full `predict()` is unchanged and reuses the same private
   `_price()`/`_probability()` stages (identical operations, order, and rounding).
   `backend/app/api/predict.py` routes the narrow endpoints to them; cluster lookup and
   SPEC §10 logging are kept on all three endpoints — the skipped value is logged as
   `null` (`ml/monitoring/drift_check.py::_coerced` drops non-floats, so feature PSI and
   prediction PSI are unaffected).
3. **SHAP warm-up in lifespan** (`backend/app/main.py:141-153`) — one `explain_instance`
   call on a fixed warm-up payload during startup, try/except with a warning on failure;
   startup never blocks/fails because of it.
4. **Static GET caches** — `/market/clusters`, `/model/info`, `/model/importance` payloads
   built once at startup into `app.state` (`backend/app/main.py:134-139`; builders in
   `backend/app/api/model.py`). `/model/importance` reads the file once at startup and
   caches the error state too — the 503-on-missing behavior is preserved.
   `build_model_info_payload` deep-copies the champion sections so later in-process
   mutation of `app.state.champion` cannot leak into served responses.

## Proof predictions are identical

- 5-row feature frame, champion `predict_proba` before vs after the pin:
  `assert_allclose(rtol=1e-12, atol=1e-12)` PASS; max abs diff 1.11e-16 (one ULP from the
  parallel vote-sum order). 6-decimal served values exactly equal. Locked in by
  `backend/tests/test_latency_fixes.py::test_force_single_threaded_predictions_identical`.
- Live parity: same payload against pre-fix and post-fix servers → byte-identical values
  (`estimated_price` 151147.74, `probability` 0.216313, plus range / sells flag /
  micro_market / top_price_factors / model_version all SAME).

## Measured improvement (port 8200, 100 req/run, real servers)

| run | before | after |
|---|---|---|
| `/predict` c=1 quietest | p50 798.5 ms, 1.23 req/s | **p50 197.5 ms, 4.71 req/s** (sanity target <350 ms: MET) |
| `/predict` c=10 least-contended pair | p50 7660.3 ms, 1.27 req/s | **p50 2406.6 ms, 4.15 req/s** |
| `/predict/price` c=10 | p50 7747.3 ms | **p50 242.8 ms, 37.4 req/s** |
| `/predict/sale-probability` c=10 | ~7858 ms (report) | **p50 2059.2 ms, 4.89 req/s** |
| first `/predict` on fresh process | 3838.7 ms | **514.7 ms** (SHAP pre-warmed) |
| GETs c=1 | 10.1 / 5.9 ms | 4.9 / 5.8 ms |

Errors: 0 in all runs; middleware `requests_total: 1233, errors_total: 0` post-fix.
Full tables + raw outputs + contention annotations: reports/PERFORMANCE.md "After fix
(wave 9b)".

## Tests

- New `backend/tests/test_latency_fixes.py` (8 tests): pin verified on all 5 fold forests;
  probability parity; `/predict/price` 200 with classifier monkeypatched to explode on ANY
  access + SHAP armed to fail (proves both skipped); same for `/predict/sale-probability`
  with broken regressor; `/predict` still uses both champions; narrow values == full-bundle
  values; SHAP singleton warm post-startup; static GETs serve the startup cache.
- Updated `backend/tests/test_api.py::test_model_importance_missing_artifact_503` for the
  startup-cached error state (the endpoint no longer re-reads disk per request).
- `pytest tests backend/tests -q` → **162 passed** (154 pre-existing + 8 new).

## Caveats for the orchestrator

- **Contention:** ambient CPU swung 8–94% during measurement (other agents on the box).
  Every post-fix run — even at 91% ambient — beat the pre-fix baseline taken under lighter
  load; the quietest runs are the headline numbers. Re-measure on an idle machine for
  citable figures.
- **Residual cost** is genuine single-core tree traversal (~165 ms quiet for the
  calibrated classifier). Next levers: multiple uvicorn workers (recommendation 2) or a
  leaner classification champion — both out of scope here.
- `scripts/load_test.py --profile` builds its own service WITHOUT the lifespan's
  `n_jobs=1` pin, so it still profiles the pre-fix path. Left untouched (not my file);
  the after-fix profile in the report was taken with an inline equivalent that applies
  the pin.
- **Stale doc:** `docs/API.md:188-189` claims `/model/importance` re-reads the artifact
  per request — now read once at startup (restart needed to pick up a regenerated file).
  Not edited (docs/ is another agent's scope).
- Prediction-log schema note: narrow endpoints log `null` for the skipped value
  (`estimated_price`/`probability`). All keys remain present; drift tooling verified
  compatible. If the Lead wants this recorded, it belongs in docs/DECISIONS.md.
- Housekeeping: load-test prediction records were redirected via `PREDICTION_LOG_PATH`;
  Git Bash's `$PWD` is a POSIX path that pydantic/`pathlib` resolves to `C:\c\...` —
  the scratch files briefly landed at `C:\c\Machine_Learning\Prop-pulse\scripts\` and
  were fully removed (`C:\c` tree deleted; verified empty). `logs/predictions.jsonl` was
  never touched by my runs. Port 8200 freed and verified (only a TIME_WAIT client socket
  remained after kill).
