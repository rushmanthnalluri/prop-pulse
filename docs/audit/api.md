# API Runtime Audit — PropPulse (mission §13, black-box execution)

- **Agent:** `api` (wave B, runtime) · **Date:** 2026-08-07
- **Mode:** report-only — no project source/config/docs modified. Writes: this file + `docs/audit/evidence/api-*.txt`. `logs/predictions.jsonl` was backed up before testing and **restored byte-identical** afterwards (md5 `270a16853155575cb6fa16e7ad27c734`, 45,576 bytes, verified post-restore).
- **Target:** live server — `.venv/Scripts/python.exe -m uvicorn backend.app.main:app --port 8300` from repo root (assigned port). Server killed after the audit; **no LISTENING socket on 8300** afterwards (verified via `netstat`).
- **Client:** `httpx` battery scripts (`C:/tmp/api_audit.py` etc., outside the project tree) + `curl` for wire-level chunked proof. All raw exchanges pasted into evidence files.
- **Ambient conditions:** other wave-B auditors ran concurrently; no timing assertions made (performance is another agent's scope).

## Per-endpoint status table

| Endpoint | Valid req → 200 + schema | Error handling | Security headers | Status |
|---|---|---|---|---|
| `GET /health` | 200, `{status, models_loaded{regression,classification}}` exact | n/a (405 on POST) | all 4 present | **PASS — verified by execution** |
| `GET /metrics` | 200, all 6 keys, correct counter types | n/a | all 4 present | **PASS — verified by execution** (counter semantics: see F1/F2) |
| `GET /model/info` | 200, full champion payload | n/a | all 4 present | **PASS — verified by execution** |
| `GET /model/importance` | 200, `{metadata, importance}`, 94 numeric values | n/a | all 4 present | **PASS — verified by execution** |
| `GET /market/clusters` | 200, `n_clusters=4`, 25 neighborhood points, point schema exact | n/a | all 4 present | **PASS — verified by execution** |
| `POST /predict` | 200, `PredictResponse` keys exact, SHAP factors schema ok | 13-case invalid battery → all 422 | all 4 present (incl. on 422/500) | **PASS WITH CONCERN** (NaN/Inf → 500 = F3) |
| `POST /predict/price` | 200, `PriceResponse` keys exact | same 13-case battery → all 422 | all 4 present | **PASS WITH CONCERN** (F3 surface) |
| `POST /predict/sale-probability` | 200, keys exact, threshold `0.203292` served | same 13-case battery → all 422 | all 4 present | **PASS WITH CONCERN** (F3 surface) |

Evidence: `api-get-endpoints.txt`, `api-predict-validation.txt`.

## Validation battery (all 3 POST endpoints × 13 cases = 39 probes — every one HTTP 422 with `{"detail":[{type,loc,msg,input}]}`)

missing required field · wrong type (`"three"`, bad bool) · invalid enum (`house_style="Castle"`) · unknown category (`neighborhood="Gotham"`, 422 listing the 25 valid) · unexpected extra field (`foo=1`, `extra_forbidden`) · empty string in numeric · negative (`bedrooms=-1`, `lot_area=-500`) · extremely large (`1e15` → 422 via `le` constraint, no overflow) · float into int (`3.5`) · `null` into required. **0 failures.** No stack traces in any body; every 422 carries all 4 security headers. Evidence: `api-predict-validation.txt`.

## Boundary battery (31 constrained numerics: min, max, one-past — 96 probes, 0 failures)

Every documented bound accepted at exactly min/max (200) and rejected one past (422): `bedrooms 0/8`, `overall_qual 1/10`, `gr_liv_area 300/6000`, `year_built 1870/2026`, `lot_area 500/200000`, `lot_frontage 1.0/500.0`, `total_bsmt_sf 0/4000`, `garage_cars 0/5`, `garage_area 0/2000`, `fireplaces 0/4`, `mo_sold 1/12`, `yr_sold 2006/2026`, and 19 more (full list in evidence). An all-at-max payload returned a sane 200 prediction. Evidence: `api-predict-boundaries.txt`.

## Wave-A claim verdicts

| # | Wave-A claim (source) | Verdict | Evidence |
|---|---|---|---|
| C1 | NaN/Infinity/±1e999 JSON literals in numeric fields → **HTTP 500**, not 422 (security F1, llba-backend F1) | **CONFIRMED live.** All 4 variants (NaN, +Inf, −Inf, 1e999) → HTTP 500, exact body `{"detail":"Internal server error"}` — **no internals leak, no stack trace on the wire, all 4 security headers present**. Server log shows the claimed mechanism verbatim: `ValueError: Out of range float values are not JSON compliant: nan` during 422-response serialization. | `api-abuse.txt`, `api-server-log.txt` |
| C2 | 64 KiB body limit bypassed via `Transfer-Encoding: chunked` (security F2, llba-backend F4) | **CONFIRMED at wire level.** Content-Length path exact: 65,536 B valid padded JSON → 200 (full prediction); 65,537 B → 413 `{"detail":"Request body too large; limit is 65536 bytes"}`. Same 200,036-byte valid body sent chunked (curl verbose shows `> Transfer-Encoding: chunked`, no Content-Length) → **HTTP 200 full prediction**. httpx generator-body repro agrees. | `api-abuse.txt` |
| C3 | `/metrics` never counts unhandled 500s (llba-backend F2, security F5) | **CONFIRMED live.** Sent 3×200 + 2×422 (`/predict/price`), 1×404, 1×NaN-500 (`/predict`): `requests_by_path["/predict/price"]` +5 ✓, 404 path recorded ✓, but `/predict` count **unchanged (19→19)** and `errors_total` **0→0** after a genuine 500. (`requests_total` delta 7 = 6 counted requests + 1 `/metrics` self-count from the before-snapshot — the 500 was *not* among them, as the per-path counters prove.) | `api-metrics.txt` |
| C4 | Unbounded `requests_by_path` cardinality, 404 probes recorded (llba-backend F3) | **CONFIRMED live** — `/api-audit-no-such-route` created a permanent counter entry. | `api-metrics.txt` |
| C5 | Security headers on every response class | **CONFIRMED live on 200/404/405/413/422/500** — `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`, `Referrer-Policy: no-referrer`, `Cache-Control: no-store` on every response captured in all evidence files. | all `api-*.txt` |
| C6 | `/metrics` echoes container path `/app/logs/predictions.jsonl` (security F4) | **CONFIRMED live** — observed in the `/metrics` drift payload. | `api-get-endpoints.txt` |
| C7 | Threshold sourced from `champion.json` = 0.203292, comparison `>=` (llba-backend hunt list) | **CONFIRMED live + statically.** Served threshold `0.203292` on `/predict` and `/predict/sale-probability`. Executed straddle: adjacent `gr_liv_area` ints flip the boolean exactly at the threshold — `gr_liv_area=1649` → `p=0.203109` (183e-6 below) → `sells_within_30_days=false`; `gr_liv_area=1648` → `p=0.203514` (222e-6 above) → `true`. Plus 80-sample grid (`overall_qual` × `gr_liv_area`): **0 violations** of `bool == (p >= 0.203292)`. Static: `prediction_service.py:159,181` (`probability >= self.threshold`), threshold from `champion.json` (`main.py:126`). | `api-threshold.txt` |

## Additional protocol probes (new, not in wave-A batteries)

| Probe | Result | Verdict |
|---|---|---|
| GET with JSON body (`GET /health`) | 200, body ignored | OK (standard) |
| POST without Content-Type / `text/plain`, valid JSON body | 422 `model_attributes_type` — note: the **entire raw body string is echoed** in `input` | Acceptable (same class as security F8 input-echo, P3-info); not a new defect |
| Malformed JSON | 422 `json_invalid` with parser position | OK |
| Empty body (Content-Length 0) | 422 `missing` on `body` | OK |
| Wrong method (POST /health, GET /predict) | 405 `{"detail":"Method Not Allowed"}` + security headers | OK |
| All error responses across the audit | zero stack traces, zero fs-path leaks in bodies | OK |

## Findings (all are independent live confirmations of wave-A items; no new defects found)

| # | Severity | Location | Finding | Evidence |
|---|---|---|---|---|
| F1 | P2 | `backend/app/monitoring/middleware.py:20-33` | **`errors_total` blind spot confirmed black-box:** a genuine unauthenticated 500 (NaN payload) leaves `errors_total` at 0 and does not even increment the path counter. Docs claim ("errors_total counts status ≥ 500") is false at runtime. | `api-metrics.txt` |
| F2 | P2 | `backend/app/security.py:57-74` | **Chunked bypass of the 64 KiB limit confirmed at wire level** (curl, `Transfer-Encoding: chunked`, 200 KB → 200 full prediction; same body with Content-Length → 413). Unauthenticated memory/CPU DoS vector in the shipped proxy-less compose topology. | `api-abuse.txt` |
| F3 | P2 | FastAPI default validation path (no `RequestValidationError` handler, `backend/app/main.py:194`) | **NaN/±Inf/1e999 JSON literals → HTTP 500, not 422** — confirmed on the live server; body is generic (no leak), but it's a trivially triggered wrong-status + server-side traceback/log-spam, and it evades `/metrics` (compounds F1). | `api-abuse.txt`, `api-server-log.txt` |
| F4 | P3 | `backend/app/services/monitoring_service.py:42` | **Unbounded `requests_by_path` cardinality confirmed** — arbitrary 404 paths become permanent counter keys. | `api-metrics.txt` |
| F5 | P3 | `reports/drift/latest.json` → `/metrics` | Internal container path `/app/logs/predictions.jsonl` echoed in the live `/metrics` payload (already security F4). | `api-get-endpoints.txt` |

## Items for the orchestrator

1. **No contradictions with wave-A.** Every wave-A backend/security claim I re-tested live on port 8300 was confirmed: C1–C7 all CONFIRM. My F1–F5 are the same defects as llba-backend F1/F2/F3 and security F1/F2/F4/F5 — merge, don't double-count.
2. **Threshold claim is now proven end-to-end**: served value 0.203292 == champion.json; boolean flips between two adjacent-integer payloads straddling the threshold by <2.3e-4 (plus 80-sample consistency grid, 0 violations).
3. **Minor observation (P3-info, fold into security F8 class):** wrong/missing Content-Type → 422 echoes the entire raw body string in the error `input`. Harmless (JSON-encoded), but it is a full request-body reflection.
4. `sale_date` unboundedness (llba-backend F6) was not re-tested live (server already verified it in wave-A); nothing in my run contradicts it.
5. Cleanup verified: server killed, **no LISTENING socket on port 8300**; `logs/predictions.jsonl` restored byte-identical (md5 match); no project files modified outside `docs/audit/`.
