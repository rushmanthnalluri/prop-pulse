# PropPulse — Consolidated Findings (Wave A + B, deduplicated by orchestrator)

Severity per mission §24. Detail: per-agent files in `docs/audit/*.md` + `docs/audit/evidence/`.
Status: `FIX` = wave-C fix assigned · `FIXED` = remediated during audit · `ACCEPTED` = documented, no code change (rationale) · `NOTE` = informational.

## P2 — High/medium defects (all assigned for fix)

| ID | Finding | Sources | Disposition |
|---|---|---|---|
| AUD-01 | NaN/±Inf/1e999 JSON literals in numeric fields → HTTP 500 (should be 422); no leak, but metrics-evading | llba-backend F1, security F1, api F3 | FIX (backend: reject non-finite at schema) |
| AUD-02 | 64 KiB body limit bypassed via `Transfer-Encoding: chunked` (no Content-Length) — wire-verified 200 KB → 200 | security F2, api F2, llba-backend F4 | FIX (backend: streaming byte counter) |
| AUD-03 | `/metrics` never counts unhandled-exception 500s (Starlette middleware ordering) | llba-backend F2, api F1 | FIX (count in 500 handler) |
| AUD-04 | Unbounded `requests_by_path` cardinality (raw URL path as counter key) | llba-backend F3, api F4 | FIX (route template keys) |
| AUD-05 | `docker-compose.override.yml` auto-merges → real ports 18000/18080 while docs lead with 8000/8080; CI only validates merged config | llba-frontend-infra F1, devops D1/D4 | FIX (rename to explicit `-f` file + CI validates both) |
| AUD-06 | PSI blind spot: 6 numeric features collapse to 1 bin → PSI ≡ 0 even for extreme out-of-range values | llba-ml-services F1, monitoring M1 | FIX (degenerate-bin handling + regenerate reference) |
| AUD-07 | Calendar features alone (YrSold/sale_year/property_age/…) flip `retraining_recommended=true` at n≥200 — false positive, literally present in API.md example | monitoring M2/C4 | FIX (non-calendar guard for the flag) |
| AUD-08 | `DRIFT_PSI_THRESHOLD` env parsed but never used; README claims configurability | monitoring M3 | FIX (wire into drift_check) |
| AUD-09 | `attach_sale_speed` crashes on empty DataFrame (log of NaN median) | llba-data F1 | FIX (guard + test) |
| AUD-10 | No fetch timeout/abort anywhere in frontend — stalled API spins forever (execution-verified) | frontend-static F1, contract C-F1 | FIX (AbortSignal.timeout + unmount cleanup) |
| AUD-11 | sklearn UserWarning flood under concurrency (~140/request at c=25, py3.14) → container log/disk flood | performance F1 | FIX (targeted warning filter in backend) |
| AUD-12 | Champion-metric regression guards too loose (R²>0.6 etc. vs actual 0.9305) | test-audit F2 | FIX (tighten to actual minus tolerance) |
| AUD-13 | MSSubClass: schema.json says `object`, CSV round-trip yields int64 → treated as scaled numeric, defaults hold median(50) not mode(20). No train/serve skew (both paths int64); metrics honest for what was trained | data-exec F1 | FIX docs/schema only (correct dtype declaration + comments + ADR note). **No retrain**: changing the feature space would invalidate verified-working models for a semantic preference — rejected under mission "do not rebuild/do not modify a working model without evidence of incorrectness". Recorded as future improvement. |
| AUD-14 | Built Docker images were stale (lacked wave-9b latency fix + frontend edit) | devops D2/D3 | **FIXED during audit** (devops rebuilt + re-smoked; new IDs `d67923e8f282`/`1a585b0256a9`) |
| AUD-15 | Historical `logs/predictions.jsonl` entries (stale in-memory dev server, OpenPorchSF=27 defaults) don't replay through current serving path; champions proven innocent (11/11 exact replay from logged features) | artifacts F1 | FIX (reset demo log to empty + document; current code verified correct) |

## P3 — selected for fix

| ID | Finding | Disposition |
|---|---|---|
| AUD-16 | `outliers.py:29` comment factually wrong (guard is load-bearing: Ids 692/1183) | FIX comment (data) |
| AUD-17 | `sale_date` unbounded vs `yr_sold` 2006–2026 | FIX (backend: bound 2006–2026) |
| AUD-18 | `/model/info` + `/model/importance` served without `response_model` validation | FIX (backend) |
| AUD-19 | `/model/info` publicly exposes internal artifact paths | FIX (backend: strip paths) |
| AUD-20 | `config.py` `.env` path CWD-relative (silently skipped from other CWDs) | FIX (anchor to REPO_ROOT) |
| AUD-21 | `monitoring_service.snapshot()` does disk I/O inside lock; metrics middleware `except Exception: pass` without log | FIX (backend) |
| AUD-22 | `_probability` latent fallback if `classes_` lacked `1` | FIX (backend: explicit check) |
| AUD-23 | `DOM_CSV_PATH` relative resolves vs CWD; `DOM_PROVIDER=""` hard-errors | FIX (data: anchor; treat empty as unset) |
| AUD-24 | Empty `top_price_factors` renders bare header; mobile factor-name truncation; health pill ignores `models_loaded:false`; drift panel needs low-sample note | FIX (frontend) |
| AUD-25 | runpy RuntimeWarning on `python -m ml.monitoring.*`; corrupt reference → uncaught ValueError; blank-line counting docstring mismatch | FIX (monitoring) |
| AUD-26 | Clustering/evaluation MLflow runs log no fitted model artifact (SPEC §7 deviation); stale clustering docstring ("4 noise" vs actual 3); dead `dbscan.joblib` load in serve.py (keep + comment); shap docstring "single-digit ms" (measured 22–45 ms); llba-features P3 docstring/cache-semantics nits | FIX (ml-misc: code comments + mlflow logging lines + docstrings; no retraining) |
| AUD-27 | Doc staleness set: API.md timestamps/caching/caching note, REPRODUCIBILITY.md missing SIMULATED label, PERFORMANCE.md stale note + latency needs load qualifier, E2E.md stale Try-again bullet, DOCKER_SMOKE.md image-ID annotation, SPEC §14 snake_case factor example, README DRIFT_PSI_THRESHOLD claim + port wording, DEPLOYMENT/FINAL-RELEASE port wording, DECISIONS.md MSSubClass + calendar-guard notes | FIX (docs agent, wave C2) |

## ACCEPTED / NOTE (no change, rationale)

- 500 responses lack CORS headers (Starlette ServerErrorMiddleware ordering) — framework-inherent; documented (llba-backend F5).
- POST without Content-Type → 422 echoes raw body in `input` (Starlette default) — accepted, documented (api P3-info).
- mlflow housekeeping: 3 failed runs + .trash probes; absolute `artifact_location` in meta.yaml (artifacts F3/F4) — cosmetic; documented.
- `cluster_stats.json` eps vs fitted Δ≈1.3e-9 — metadata-only (artifacts F5).
- Classification MLflow models logged as skops vs regression cloudpickle (artifacts F6) — both load-verified; noted.
- Serving defaults `sale_date=today` → sale_year 2026 out-of-training-range (data-exec F3) — SPEC-sanctioned; disclosed in docs; future: pin serving reference date.
- OOD extrapolation caveat absent in UI (blackbox F1: max-everything → $1.35M) — documented limitation; no contract change.
- `/metrics` echoes container log path in drift summary (api F5) — informational.
- prediction_reference.json built from val predictions (not train) — no leakage (val never trained on); documented (leakage §11).
- AUDIT_PLAN baseline said frontend/src = 15 files; actual 16 — orchestrator counting slip (one file pair listed as one); corrected in FINAL_AUDIT counts.
