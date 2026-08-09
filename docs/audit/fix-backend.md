# Fix Report — fix-backend (Wave C)

**Agent:** fix-backend · **Date:** 2026-08-07 · **Scope owned:** `backend/**` only.

**Findings fixed:** AUD-01, AUD-02, AUD-03, AUD-04, AUD-11, AUD-17, AUD-18,
AUD-19, AUD-20, AUD-21, AUD-22 (+ AUD-F8 comment, accepted-no-change).
Sources: `docs/audit/FINDINGS.md`, `docs/audit/llba-backend.md` (F1–F12),
`docs/audit/security.md`, `docs/audit/api.md`, `docs/audit/performance.md` (F1).

**Test evidence:** `backend/tests/test_audit_fixes.py` (new, 18 tests).
`pytest backend/tests -q` → **53 passed** (was 35). Full suite
`.venv/Scripts/python.exe -m pytest tests backend/tests -q` → **210 passed, 0 failed**
(≥ the 162 baseline; concurrent fix agents added the rest).

---

## 1. AUD-01 — NaN/±Inf/1e999 JSON literals → 500 instead of 422 (P2)

**Defect (FINDINGS.md AUD-01):** "NaN/±Inf/1e999 JSON literals in numeric
fields → HTTP 500 (should be 422)". Root cause (llba-backend F1): pydantic
rejects the values, but the error dict echoes the non-finite `input`, which
Starlette's strict JSON renderer (`allow_nan=False`) cannot serialize — the
default 422 handler crashes and the generic 500 fires.

**Before (live repro, in-process TestClient):**

```
NaN lot_frontage:        -> 500
+Inf garage_area:        -> 500
-Inf mas_vnr_area:       -> 500
1e999 gr_liv_area (int): -> 500
NaN bedrooms (int):      -> 500
```

**Fix (two layers):**

- `backend/app/schemas/property.py:80,87,121` — `allow_inf_nan=False` on the
  three float fields (`lot_frontage`, `garage_area`, `mas_vnr_area`) so
  rejection is explicit (`finite_number` error). Int fields already reject
  non-finite values at type validation.
- `backend/app/main.py:120-139` — new `_sanitize_validation_errors()`:
  recursively replaces non-finite floats in pydantic error payloads with
  their string form (`"nan"`/`"inf"`/`"-inf"`).
- `backend/app/main.py:263-270` — registered a `RequestValidationError`
  handler returning the standard `{"detail": [...]}` 422 shape over the
  sanitized errors.

**After (regression tests):**
`test_nan_inf_float_fields_rejected_422`,
`test_non_finite_int_fields_rejected_422`,
`test_non_finite_422_body_is_clean_json`,
`test_finite_values_still_accepted` — all 5 repro variants now → **422** with
field detail; happy path unchanged (200, same values).

## 2. AUD-02 — 64 KiB body limit bypassed via chunked transfer (P2)

**Defect (FINDINGS.md AUD-02):** "64 KiB body limit bypassed via
`Transfer-Encoding: chunked` (no Content-Length) — wire-verified 200 KB → 200."

**Before (live repro):** `chunked 205089 bytes -> 200 (no Content-Length)`.

**Fix:** `backend/app/security.py:48-90` — `BodySizeLimitMiddleware` keeps the
fast `Content-Length` path; when no length is declared it now consumes the
body via `request.stream()`, counts bytes, and returns **413** as soon as the
running total exceeds `MAX_BODY_BYTES`. Within-limit bodies are handed
downstream through the request's body cache (`request._body`, the same
attribute `Request.body()` sets and `BaseHTTPMiddleware` forwards), so parsing
is unaffected. The stale "chunked requests cannot be pre-judged" docstring was
replaced.

**After:** `test_chunked_oversized_body_rejected_413` (200 KB chunked → 413,
security headers present), `test_chunked_valid_body_accepted` (streamed valid
payload → 200, price sane). Existing `test_oversized_body_rejected_413` /
`test_body_at_limit_accepted` (declared-length paths) still green.

## 3. AUD-03 — unhandled 500s never counted in /metrics (P2)

**Defect (FINDINGS.md AUD-03):** Starlette's `ServerErrorMiddleware` sits
outside the user middleware stack, so `MetricsMiddleware.dispatch` never sees
unhandled-exception 500s (`call_next` raises): `errors_total` stays 0.

**Before (live repro):** forced 500 → `errors_total 0 -> 0`,
`/_repro_boom` absent from `requests_by_path`.

**Fix:**

- `backend/app/monitoring/middleware.py:19,50` — the middleware stashes the
  request start time in `request.scope["proppulse.metrics_started_at"]` before
  `call_next`, so the 500 handler can record a real latency.
- `backend/app/main.py:283-295` — the generic 500 handler now calls
  `monitoring.record_request(route_template_key(request), 500, latency_ms)`
  (failures logged, never masking the 500).

**After:** `test_unhandled_500_counted_in_metrics` — forced 500 →
`errors_total` +1 and `requests_by_path["/_test_boom_metrics"] == 1`.

## 4. AUD-04 — unbounded `requests_by_path` cardinality (P2)

**Defect (FINDINGS.md AUD-04):** raw URL path used as counter key; 404 probes
grow the dict without bound.

**Before (live repro):** one GET of `/fuzz-probe-123` created a permanent
raw-path key.

**Fix:** `backend/app/monitoring/middleware.py:23-35` — new
`route_template_key()`: keys on the matched route's path template
(`request.scope["route"].path`, set by FastAPI at `fastapi/routing.py:836`);
requests without a match fall into a single `"unmatched"` bucket. Used by both
the middleware and the 500 handler.

**After:** `test_unknown_paths_bucketed_as_unmatched` (404 probe →
`"unmatched"` key, raw URL absent), `test_matched_requests_use_route_templates`
(`/predict/price` template key), plus the AUD-03 test's template-key assertion.

## 5. AUD-11 — sklearn UserWarning flood under concurrent /predict (P2)

**Defect (FINDINGS.md AUD-11):** "~140 warnings/request at c=25 (py3.14),
trigger `sklearn/utils/parallel.py:143`" → container log/disk flood.

**Reproduced first (live server, port 8700, `scripts/load_test.py` c=25,
250 requests):** **170,230** flood lines, server log **53.5 MB** — ~680
warnings/request.

**Root cause (identified beyond the audit):** this is a **non-free-threaded**
Python 3.14.5 build, where `warnings._use_context == 0` — warning filters are
**process-global**, not context-local. sklearn's `_FuncWrapper.__call__`
(`sklearn/utils/parallel.py:155-181`) wraps every delayed call in
`catch_warnings()` + `resetwarnings()` and re-applies the filters captured by
`Parallel.__call__`. Under concurrency these global save/reset/restore cycles
race: a `Parallel.__call__` that captures while another request holds the
global list emptied sees `[]`, so `not warning_filters` is true and every
delayed call warns. Verified in-process: 25 threads with emptied global
filters → 9,752 warnings **even with a per-call `catch_warnings` wrap**
(that wrap was tried and reverted — it adds more global-list churn without
being race-proof).

**Fix:** `backend/app/main.py:55-91` — two layers, both targeting only this
exact message:

1. `warnings.filterwarnings("ignore", message=..., category=UserWarning,
   module=r"sklearn\.utils\.parallel")` at app import — covers all non-racing
   contexts (this alone took the flood 170,230 → 48).
2. A `warnings.showwarning` chokepoint
   (`_showwarning_drop_sklearn_parallel_flood`) that drops exactly this
   message and delegates everything else to the original hook — deterministic
   even when a filter-list race lets the warn fire. `showwarning` is the
   documented process-global hook and is race-immune.

**After (same live burst):** c=25 × 250 requests **and** c=50 × 150 requests
→ **0 flood warnings** (grep count 0; 0 `UserWarning` lines), 250/250 + 150/150
→ 200. Log size in the tens of KB (ordinary INFO request logs).
`test_sklearn_parallel_warning_flood_suppressed` runs a subprocess probe:
message shows before import, is ignored after import, is still dropped after
`resetwarnings()` (race simulation), and a control UserWarning still gets
through.

## 6. AUD-17 — `sale_date` unbounded (P3)

**Defect (FINDINGS.md AUD-17):** "`sale_date` unbounded vs `yr_sold`
2006–2026". Before: `sale_date 1800-01-01 -> 200`, `2030-12-31 -> 200`.

**Fix:** `backend/app/schemas/property.py:94-102` — `sale_date` now bounded
`ge=date(2006, 1, 1), le=date(2026, 12, 31)` (consistent with `yr_sold`).

**After:** `test_sale_date_out_of_bounds_rejected_422` (1800, 2005-12-31,
2027-01-01, 2030 → 422), `test_sale_date_bounds_accepted` (2006-01-01 and
2026-12-31 → 200).

## 7. AUD-18 — no `response_model` on /model/info + /model/importance (P3)

**Fix:**

- `backend/app/schemas/responses.py:122-182` — new `ChampionSection`
  (`extra="allow"` so metric details pass through), `HeadlineMetrics` +
  per-model sections, `ModelInfoResponse`, `ModelImportanceResponse`
  (`importance: dict[str, float]` — values must be numeric, closing the
  llba-backend F9 gap that only dict-ness was checked).
- `backend/app/api/model.py:93,99` — both endpoints wired with
  `response_model=`.

**After:** `test_model_endpoints_have_response_models` (walks FastAPI 0.141's
`_IncludedRouter` nesting) + the pre-existing shape tests
(`test_model_info`, `test_model_importance`) still green — happy-path payload
shapes unchanged.

## 8. AUD-19 — /model/info exposed internal artifact paths (P3)

**Before (live repro):**

```
LEAK .regression.path='models/registry/regression_champion.joblib'
LEAK .classification.path='models/registry/classification_champion.joblib'
LEAK .clustering.path='models/clustering/dbscan.joblib'
```

**Fix:** `backend/app/api/model.py:35-38` — `build_model_info_payload` pops
`path` from the regression/classification/clustering sections of the
(deep-copied) champion dict; names/versions/metrics kept.

**After:** `test_model_info_exposes_no_artifact_paths` — recursive scan finds
no `path` key; `regression.name`, `classification.name`,
`val_metrics.rmsle`, `headline_metrics.classification.threshold` all present.

**Note for docs agent (AUD-27):** `docs/API.md:142,154` still shows `path`
keys in the `/model/info` example — now stale.

## 9. AUD-20 — `.env` lookup CWD-relative (P3)

**Fix:** `backend/app/config.py:27-30` — `env_file=str(REPO_ROOT / ".env")`
(via `ml.paths.REPO_ROOT`, already imported).

**After:** `test_env_file_anchored_to_repo_root` asserts the configured path
is absolute and equals `<REPO_ROOT>/.env`; manually verified `Settings()`
loads identically with CWD=`/tmp`.

## 10. AUD-21 — drift read inside lock + silent metrics failure (P3)

**Fix:**

- `backend/app/services/monitoring_service.py:64-76` — `snapshot()` reads the
  drift report **before** acquiring `_lock` (disk I/O outside the critical
  section).
- `backend/app/monitoring/middleware.py:59-62` — the metrics-recording
  `except Exception` now logs a warning instead of silently passing.

**After:** `test_drift_read_outside_metrics_lock` (probe acquires the lock
inside `latest_drift_summary` — succeeds, proving the read is lock-free),
`test_metrics_recording_failure_logged_not_silent` (broken sink → 200 +
"metrics recording failed" warning).

## 11. AUD-22 — `_probability` silent `proba[-1]` fallback (P3)

**Fix:** `backend/app/services/prediction_service.py:196-205` — if `1` is not
in `classes_`, raise `RuntimeError` ("classes_ … do not include the positive
class 1") → surfaces as a loud generic 500 instead of silently serving the
last probability column. (`ValueError` was deliberately not used: the API
layer maps those to 422, and a broken artifact is a server error.)

**After:** `test_probability_fails_loudly_without_positive_class` — fake
classifier with `classes_=[0, 2]` → `RuntimeError` matching "positive class 1".

## 12. AUD-F8 (ACCEPTED) — documented, no behavior change

`backend/app/api/predict.py:44-47` — one-line comment: the logged `payload`
intentionally includes server-side defaults (`model_dump(mode="json",
exclude_none=True)`) because drift analysis needs the full effective input.

---

## Files changed (all inside `backend/`)

| File | Changes |
|---|---|
| `backend/app/main.py` | AUD-01 handler + sanitizer, AUD-03 recording, AUD-11 filter + showwarning guard |
| `backend/app/security.py` | AUD-02 streamed-body counting, shared 413 helper |
| `backend/app/monitoring/middleware.py` | AUD-03 scope stash, AUD-04 route templates, AUD-21 logging |
| `backend/app/services/monitoring_service.py` | AUD-21 drift read outside lock |
| `backend/app/services/prediction_service.py` | AUD-22 classes_ guard |
| `backend/app/schemas/property.py` | AUD-01 `allow_inf_nan=False` ×3, AUD-17 sale_date bounds |
| `backend/app/schemas/responses.py` | AUD-18 response models |
| `backend/app/api/model.py` | AUD-18 wiring, AUD-19 path stripping |
| `backend/app/config.py` | AUD-20 anchored env_file |
| `backend/app/api/predict.py` | AUD-F8 comment only |
| `backend/tests/test_audit_fixes.py` | **new** — 18 regression tests |

## Deliberately not changed

- Prediction values, response happy-path shapes (except AUD-19 path
  stripping), logged-payload behavior (AUD-F8 accepted), the 64 KiB limit
  value, middleware order, CORS-on-500 (framework-inherent, documented).
- The per-call `catch_warnings` wrap for AUD-11 was implemented, proven
  insufficient (9,752 leaks in a 25-thread adversarial run), and **reverted**
  in favor of the `showwarning` chokepoint.

## Notes for the orchestrator

- `logs/predictions.jsonl` untouched by my verification runs (live server ran
  with `PREDICTION_LOG_PATH=C:/tmp/...`; file still holds its 19 lines).
- Server on port 8700 was started for the AUD-11 bursts and killed after
  (verified down).
- `docs/API.md:142,154` (`path` keys in the /model/info example) and
  `docs/API.md:116` (`errors_total` wording now fully true) — flag for the
  AUD-27 docs pass.
- `reports/SECURITY.md` describes the chunked-body bypass as a residual risk;
  that note is now stale (fixed at the app layer) — docs pass.
