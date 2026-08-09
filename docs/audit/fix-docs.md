# Fix Report — fix-docs (Wave C2, AUD-27)

**Agent:** fix-docs · **Date:** 2026-08-07 · **Scope owned:** `README.md`,
`FINAL-RELEASE.md`, `docs/*.md` (API, DEPLOYMENT, METHODOLOGY, DECISIONS,
GEOGRAPHY, DEMO, PROJECT_SPEC), `reports/*.md` (PERFORMANCE, REPRODUCIBILITY,
E2E, DOCKER_SMOKE, SECURITY), plus the two docs-truth-assigned lines in
`docker/README.md` (F5 + the AUD-08 wording twin). No code, test, or
`docs/audit/**` content was modified (this report is the only new file there).

**Verification:** `.venv/Scripts/python.exe -m pytest tests backend/tests -q`
→ **210 passed, 4 warnings in 54.84s** (post-edit run; no code touched, count
matches fix-backend's post-wave-C baseline).

---

## 1. AUD-05 follow-up — compose file rename (`docker-compose.override.yml` → `docker-compose.alt-ports.yml`, opt-in)

| File:line (post-edit) | Old → New |
|---|---|
| `README.md:30` (verification table, Docker row) | "local ports 18000/18080 via `docker-compose.override.yml`" → "default ports 8000/8080, alt ports 18000/18080 via the opt-in `docker-compose.alt-ports.yml`" |
| `README.md:339-353` (Docker section) | "optional **`docker-compose.override.yml`** — local-only, auto-merged by compose when present" → "**`docker-compose.alt-ports.yml`** — committed but **opt-in** … never auto-merges; merge explicitly" + the explicit `-f docker-compose.yml -f docker-compose.alt-ports.yml up --build` command block |
| `README.md:436` (structure tree comment) | "(+ local docker-compose.override.yml port remap)" → "(+ opt-in docker-compose.alt-ports.yml port remap)" |
| `docs/DEPLOYMENT.md:11` (header note) | "port remapping via `docker-compose.override.yml`" → "via the opt-in `docker-compose.alt-ports.yml`" |
| `docs/DEPLOYMENT.md:77-84` (§3) | added the opt-in alt-ports paragraph + explicit merge command (§3 previously never mentioned the remap) |
| `FINAL-RELEASE.md:20` (verification table) | "override ports 18000/18080" → "default ports 8000/8080 — opt-in alt-ports 18000/18080 via `docker-compose.alt-ports.yml`" |
| `FINAL-RELEASE.md:35` (quickstart) | "or with override ports 18000/18080" → "default ports 8000/8080; for 18000/18080 add: -f docker-compose.yml -f docker-compose.alt-ports.yml" |
| `reports/DOCKER_SMOKE.md:3-18` | new top annotation block: (1) post-audit rename, read "override" as "alt-ports" in §1; (2) the smoke predates the wave-9b latency-fix rebuild — devops rebuilt during the audit, current image IDs backend `d67923e8f282` / frontend `1a585b0256a9`, re-smoke PASS (AUD-14); (3) §8's "154 passed" predates the 210-suite |

Historical mentions inside `reports/DOCKER_SMOKE.md` §1/§8 body and
`docs/agent-log/*` intentionally left verbatim (dated evidence; covered by the
annotation block). Verified on disk: `docker-compose.alt-ports.yml` present,
no `docker-compose.override.yml` anywhere.

## 2. docs-truth F1–F6

| Finding | File:line | Old → New |
|---|---|---|
| F1 | `docs/API.md:168` | `"selected_at": "2026-08-07T07:09:17.453829+00:00"` → `"2026-08-07T10:38:48.406646+00:00"` (matches current `models/champion.json:82`) |
| F2 | `docs/API.md:225` | `"generated_at": "2026-08-07T08:36:26.239112+00:00"` → `"2026-08-07T10:39:02.217783+00:00"` (matches current `models/explainability/feature_importance.json`) |
| F3 | `reports/REPRODUCIBILITY.md:5-7` | added the standard caveat after the header: "**SIMULATED TARGET (ADR-3): classification metrics below measure reproducibility against the documented DOM simulation, not real-world sale-speed performance.**" |
| F4 | `reports/PERFORMANCE.md:315` | appended "*(Superseded — resolved: API.md already documents the startup cache; noted during the forensic audit, docs-truth F4.)*" to the stale doc-note |
| F5 | `docker/README.md:143-145` | "Commit the lock file once the frontend stabilizes." → "The lock file is committed, so `npm ci` is the default path." (`frontend/package-lock.json` verified present) |
| F6 | `docs/API.md:484-487` (defaults table) + `docs/API.md:490-496` (new note) + `docs/API.md:452-456` (prose) | four porch/pool rows' Default `0` → "`0` (schema placeholder — see note below)"; new note: omitted fields never materialize the 0 — serving falls back to `feature_defaults.json` train medians (omitted `open_porch_sf` → OpenPorchSF 27, verified against `models/feature_defaults.json`); prose now qualifies "an explicit `null` is treated as omitted **for the nullable (`| null`) fields** — for the non-nullable `int` fields an explicit `null` is a 422" |
| F6 mirror | `docs/PROJECT_SPEC.md:187-189` (§8) | "(default 0)" → "(schema default 0; when omitted, serving falls back to `feature_defaults.json` medians — see API.md)" |

## 3. AUD-19 follow-up — /model/info internal paths

- `docs/API.md:147-149` — "mirror `models/champion.json` verbatim" →
  "verbatim, **except that the internal artifact `path` keys are stripped** from
  the public response".
- `docs/API.md:155` — removed `"path": "models/registry/regression_champion.joblib",`
  from the regression block of the example.
- `docs/API.md:167` — `"clustering": {"path": "models/clustering/dbscan.joblib", "n_clusters": 4}`
  → `"clustering": {"n_clusters": 4}`.

Verified against `backend/app/api/model.py:35-38` (`build_model_info_payload`
pops `path` from all three sections). `/model/importance`'s `model_path`
metadata key is still served (artifact metadata passes through verbatim) —
left documented as-is.

## 4. AUD-02 follow-up — chunked-transfer bypass now fixed

- `reports/SECURITY.md:253` (§7 findings table) — new row 12: "64 KiB body
  limit bypassed via `Transfer-Encoding: chunked` … **Fixed (post-audit,
  wave C)** — `BodySizeLimitMiddleware` now streams length-less bodies through
  a byte counter and returns 413 past 64 KiB".
- `reports/SECURITY.md:262-264` (§8 residual risks, item 3) — "Chunked-upload
  gap … bypass pre-judgment" → "*closed post-audit (wave C, AUD-02)*" +
  reverse-proxy cap kept as defense-in-depth advice.
- `FINAL-RELEASE.md:70-72` (§4 item 5) — "body limit is Content-Length based"
  → post-audit note: the limit now also covers chunked bodies (streaming byte
  counter, 413).

## 5. AUD-07/AUD-08 follow-up — drift example + threshold truth

- `docs/API.md:86-104` (/metrics example) — `"retraining_recommended": true`
  → `false`; added `"low_sample": false` and
  `"calendar_drift_features": ["YrSold", "sale_year"]`; recommendation_text now
  the calendar-only branch ("Drift detected only in calendar-derived
  feature(s) … does NOT recommend retraining …"). Keys verified against
  `ml/monitoring/drift_check.py:398-420` (`_ok_report`).
- `docs/API.md:117-134` (notes) — calendar-only drift never sets
  `retraining_recommended` (guard: ≥1 non-calendar drifted feature AND n≥200);
  `low_sample` (<50) explained; "`psi_threshold` honors `DRIFT_PSI_THRESHOLD`
  (default 0.2); `warn_threshold` fixed 0.1".
- `README.md:388-399` (Monitoring section) — same guard + calendar feature
  list + `low_sample`; the `DRIFT_PSI_THRESHOLD` claim (README.md:373
  original) kept — now genuinely true (verified `drift_check.py:100-128`).
- `docs/DEPLOYMENT.md:29` — "the warn threshold is half of it (0.1)" →
  "honored by `ml.monitoring.drift_check`; the warn threshold is a fixed 0.1
  (half of the default — it does not scale with an override)" (verified
  `ml/monitoring/psi.py:34` constant).
- `docker/README.md:99` — "PSI drift threshold (warn at half)" → "(warn
  threshold fixed at 0.1)".
- `docs/DEPLOYMENT.md:113-119` + `:143-154` (§4) — recommendation now requires
  non-calendar drift + ≥200; calendar features listed and reported under
  `calendar_drift_features`; `low_sample` note; exit 2 = reference missing
  **or corrupt** (AUD-25).
- `docs/DEMO.md:119-123` (talking point) — added "calendar-only drift … is
  structural and never triggers the recommendation".

## 6. Performance honesty (performance.md F3)

Quiet-machine qualifier added wherever the latency figures lead; the wave-9b
before/after improvement statements kept:

- `README.md:32` (table) — "(c=1, quiet machine; ~800 ms before the wave-9b
  fix — contended runs measure 2–3× higher)".
- `README.md:317-321` (setup note) — "measured on an otherwise idle machine;
  contended runs measure 2–3× higher".
- `docs/API.md:23-26` — same qualifier.
- `docs/DEPLOYMENT.md:56-58` — "(quiet machine; expect 2–3× higher under
  concurrent load)".
- `docs/DEMO.md:20-22` — same qualifier.
- `FINAL-RELEASE.md:22` — "quiet-machine figures; contended runs measure 2–3×
  higher".

## 7. AUD-13 — MSSubClass note

- `docs/DECISIONS.md:80-90` — new **ADR-11**: MSSubClass treated as a scaled
  numeric (CSV round-trip yields int64; `schema.json` corrected to declare
  int64); no train/serve skew; one-hot treatment is a documented future
  improvement requiring retrain; no retrain done (working-model rule); metrics
  honest for the trained configuration.
- `docs/METHODOLOGY.md:238-241` (§10 limitations) — one bullet saying the
  same, pointing at ADR-11.

## 8. AUD-24/blackbox F2 follow-up — E2E.md

- `reports/E2E.md:5-11` — new post-audit note: suite is now **3 spec files /
  24 tests** (`dashboard.spec.js` 5 = this report; `audit-blackbox.spec.js`
  11; `frontend-fixes.spec.js` 8 — verified by listing `e2e/tests/` and
  counting `test(`).
- `reports/E2E.md:113-119` — "no 'Try again' button" bullet corrected: the
  button exists (`Valuation.jsx:305` passes `onRetry={reset}`, verified);
  timeout (30 s `AbortSignal.timeout`), mobile factor-name, health-pill, and
  empty-factors fixes landed.
- `reports/E2E.md:111-113` — "Responsive/mobile layouts untested" qualified:
  `frontend-fixes.spec.js` now covers 390×844.

## 9. SPEC §8 example

- `docs/PROJECT_SPEC.md:205` — `"feature": "overall_qual"` →
  `"feature": "OverallQual"` (the API returns base feature names). Note: the
  assignment's `"living_area"`/`"location"` tokens do not exist in the current
  SPEC — nothing to change there.

## 10. Test-count updates (162 → 210)

- `README.md:28` (table), `README.md:366` (Testing section), `README.md:362`
  (code comment `# 210 tests`), `README.md:80` (MLOps bullet "210 automated
  tests") — all updated; "+48 audit regression tests" noted; run time updated
  to the measured ~55 s.
- `README.md:29` — new verification-table row: forensic audit completed, link
  `docs/audit/FINAL_AUDIT.md` (orchestrator-owned file; link per assignment).
- `FINAL-RELEASE.md:17` — "162 passed" → "**210 passed** (post-audit; 162 at
  this release)" with the wave-C explanation.
- Dated pasted run outputs inside `reports/` (154/162 in E2E/SECURITY/
  PERFORMANCE/DOCKER_SMOKE) left verbatim — historical evidence blocks;
  DOCKER_SMOKE's is covered by the new annotation block.

## 11. Sweep — additional stale claims found and fixed

| # | File:line | Stale claim | Fix (verified against) |
|---|---|---|---|
| S1 | `reports/REPRODUCIBILITY.md:9-15` | quoted schema.json md5 `4061da6f…` | post-audit note: AUD-13 corrected `MSSubClass` → int64; current md5 `2721af81cee05c942202bf2f7eb4e43a` (verified by `md5sum`); determinism claim unaffected |
| S2 | `reports/REPRODUCIBILITY.md:291-293` | quoted `drift_check --help` lacks flags | annotated: CLI gained `--reference`/`--output` (AUD-25), verified live |
| S3 | `docs/DEPLOYMENT.md:165-168` (§5) | CI docker job = base `config -q` only | now documents both validations (base + merged alt-ports), matching `.github/workflows/ci.yml` post-fix-docker |
| S4 | `README.md:404-409` (CI section) | same staleness | same update |
| S5 | `docs/PROJECT_SPEC.md:86-87` (§4) | "`validate.py` enforces schema (dtypes, …)" | dtypes are recorded, not enforced (fix-data verification) — list corrected |
| S6 | `docs/DEPLOYMENT.md:131` | exit 2 = missing reference | "missing **or corrupt**" (AUD-25 structured error) |

Sweep items checked and found **still accurate** (no edit): GEOGRAPHY.md "10
tests" for `test_geo_override.py` (10 collected, parametrized);
`reports/MODEL_EVALUATION.md` / `reports/EDA_REPORT.md` (no
audit-affected claims); `docs/ARCHITECTURE.md` (no stale refs found; also
outside my owned list); backend `monitoring_service.snapshot()` passes the
drift report through verbatim, so the new `/metrics` example keys are served
as documented.

## Deliberately not changed (not owned / historical record)

- `docs/AGENT_STATUS.md:24,42` — "114 tests green" / "162 tests passed" dated
  log lines (docs-truth F7 says no edit required; file not in my scope).
- `docs/ARCHITECTURE.md`, `data/README.md`, `backend/README.md`,
  `frontend/README.md`, `docs/agent-log/**` — outside my owned scope.
- `docs/audit/**` content — historical record; this report is the only
  addition.
- `docs/audit/FINAL_AUDIT.md` — orchestrator writes it; README/FINAL-RELEASE
  link to it per assignment (link target pending until the orchestrator lands
  it).

## Files changed (13 + this report)

`README.md`, `FINAL-RELEASE.md`, `docs/API.md`, `docs/DEPLOYMENT.md`,
`docs/METHODOLOGY.md`, `docs/DECISIONS.md`, `docs/DEMO.md`,
`docs/PROJECT_SPEC.md`, `docker/README.md`, `reports/DOCKER_SMOKE.md`,
`reports/REPRODUCIBILITY.md`, `reports/PERFORMANCE.md`, `reports/E2E.md`,
`reports/SECURITY.md` (+ new `docs/audit/fix-docs.md`).
