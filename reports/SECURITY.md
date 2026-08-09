# PropPulse — Security Audit & Hardening Report

**Date:** 2026-08-07 · **Auditor:** `security-audit` hardening agent ·
**Scope:** dependency vulnerabilities, HTTP hardening, input validation,
secrets/config, model-artifact trust, Docker image review.
**Environment:** Windows + Git Bash, Python 3.14.5 (`.venv/`), Node 24,
`pip-audit 2.10.1`, `npm audit` (npm 11.9.0).

Every claim below is backed by an actual command output (quoted inline, lightly
trimmed). No source was changed outside `backend/`, `backend/tests/`, and this
report; no requirement pin was bumped (see §1.1 for why).

---

## 1. Dependency vulnerabilities

### Methodology

```bash
.venv/Scripts/python.exe -m pip install pip-audit      # pip-audit 2.10.1
.venv/Scripts/python.exe -m pip_audit                  # audits the live venv
.venv/Scripts/python.exe -m pip_audit -r requirements.txt
.venv/Scripts/python.exe -m pip_audit -r backend/requirements.txt
cd frontend && npm audit
```

### 1.1 Python — one finding, fix attempted, reverted (accepted risk)

```
$ .venv/Scripts/python.exe -m pip_audit
Found 1 known vulnerability in 1 package
Name         Version ID              Fix Versions
------------ ------- --------------- ------------
cryptography 49.0.0  PYSEC-2026-3552 50.0.0
```

`PYSEC-2026-3552` (aliases `GHSA-g6cj-pr64-35w5`, `CVE-2026-69247`):
`pkcs7_decrypt_der/pem/smime` in `cryptography` ≥44.0.0 expose a Bleichenbacher
oracle when a service decrypts **attacker-supplied PKCS#7 EnvelopedData** and
reflects the outcome (per the advisory: "Exploitation requires a service that
auto-decrypts untrusted EnvelopedData … such as an S/MIME gateway").

**Fix attempt (executed, then deliberately reverted):**

```
$ pip install cryptography==50.0.0
ERROR: pip's dependency resolver ... mlflow 3.15.1 requires
  cryptography<50,>=43.0.0, but you have cryptography 50.0.0 which is incompatible.
$ pip check
mlflow 3.15.1 has requirement cryptography<50,>=43.0.0, but you have cryptography 50.0.0.
$ pip install cryptography==49.0.0        # revert
Successfully installed cryptography-49.0.0
$ pip check
No broken requirements found.
```

`cryptography` is a **transitive** dependency (`Required-by: google-auth,
mlflow`), pinned nowhere in our requirements files. The only fix version
(50.0.0) violates `mlflow==3.15.1`'s declared upper bound (`cryptography<50`),
so the bump is **not safe** — bumping mlflow itself just to unblock it would be
a non-minimal, risky change to the pinned ML stack (SPEC §14). Downgrading to
43.x is not an option either: it would re-introduce older known-vulnerable
lines.

**Why acceptance is justified:**

- The vulnerable API family is never called. Verified by grep over the
  installed dependency surface we exercise:
  `grep -rln "pkcs7_decrypt" .venv/Lib/site-packages/mlflow/
  .venv/Lib/site-packages/google/` → **no hits**; `cryptography` is imported by
  mlflow only in `mlflow/utils/crypto.py` and
  `mlflow/store/model_registry/dbmodels/models.py` (SQL registry store — we use
  the local file store, ADR-8). No PropPulse code imports `cryptography` at all
  (`grep -rn "cryptography" ml/ backend/ tests/` → no hits).
- PropPulse never decrypts untrusted EnvelopedData; the oracle scenario in the
  advisory does not exist in this system.

**Residual:** re-run `pip-audit` when mlflow is upgraded; bump `cryptography`
to ≥50 as soon as an mlflow release permits it.

- `pip_audit -r requirements.txt` → same single finding (cryptography via mlflow).
- `pip_audit -r backend/requirements.txt` → **`No known vulnerabilities found`** —
  the slim serving image does not carry the vulnerable package at all.

### 1.2 Frontend (npm)

```
$ cd frontend && npm audit
found 0 vulnerabilities
```

No frontend dependency changes were needed; `npm run build` was therefore not
re-triggered by this audit (nothing to validate against).

---

## 2. HTTP hardening (implemented)

New module **`backend/app/security.py`**, wired in **`backend/app/main.py`**
(both in this agent's scope). Diff summary:

| Control | Implementation |
|---|---|
| `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`, `Referrer-Policy: no-referrer`, `Cache-Control: no-store` | `SecurityHeadersMiddleware` — outermost user middleware, so the headers land on 2xx/4xx/413 responses alike. |
| Request-body size limit (64 KiB) | `BodySizeLimitMiddleware` — rejects `Content-Length > 65536` with **413** `{"detail": "Request body too large; limit is 65536 bytes"}` before any parsing. Legit `PropertyInput` payloads are <1 KiB. |
| Generic 500, no internals | Pre-existing handler verified; **enhanced** to attach the security headers explicitly, because Starlette's `ServerErrorMiddleware` runs *outside* the user middleware stack and would otherwise bypass them (`backend/app/main.py`, `unhandled_exception_handler`). |

Middleware order (Starlette runs the last-added user middleware first):
`SecurityHeaders → BodySizeLimit → Metrics → CORS → routes`.

**Live evidence (TestClient capture, real champions loaded):**

```
GET /health -> 200
  x-content-type-options: nosniff
  x-frame-options: DENY
  referrer-policy: no-referrer
  cache-control: no-store
POST /predict 70KB body -> 413 {'detail': 'Request body too large; limit is 65536 bytes'} | x-frame-options: DENY
POST /predict malformed json -> 422 | traceback in body: False
GET /_boom -> 500 {'detail': 'Internal server error'} | sentinel leaked: False | x-content-type-options: nosniff
```

`/_boom` was a **test-only route** raising `RuntimeError("sentinel-internal-detail")`.
The 500 response body is exactly `{"detail": "Internal server error"}` — the
sentinel and stack trace appear only in the server log (`logger.exception`),
never on the wire. The same guarantee is pinned by automated tests (below).

**New tests** — `backend/tests/test_security.py` (9 tests):

```
$ .venv/Scripts/python.exe -m pytest backend/tests -q
27 passed, 4 warnings in 26.50s        # 18 pre-existing + 9 new
```

Covers: headers on 200/404/422/413/500, 413 above 64 KiB, boundary pass at
exactly 65,536 bytes (padded valid payload → 200), 500 shape with a forced
exception (test-only route), malformed-JSON 422 without internals.

---

## 3. Input validation review (`PropertyInput`)

The schema is already strict (`backend/app/schemas/property.py`):
`ConfigDict(extra="forbid", str_strip_whitespace=True)`, `Literal` enums for
every categorical, `ge/le` ranges on every numeric, and a whitelist validator
against the 25 train neighborhoods. Abuse battery (automated in
`test_security.py`, all passing):

| Payload | Result |
|---|---|
| Huge numbers (`bedrooms/gr_liv_area/lot_area/overall_qual = 10**15`) | **422**, field named in detail |
| Type confusion (`bedrooms:"three"`, `gr_liv_area:1500.5`, `central_air:"not-a-bool"`, `year_built:[1995]`, `neighborhood:42`) | **422** each |
| Unicode bomb (`"💣"×500`), NUL-padding (`"NAmes"+"\x00"×100`) in `neighborhood` | **422** (unknown-neighborhood validator) |
| ~100 KiB string value | **413** — the body limit fires before validation (defense in depth working as designed) |
| Deeply nested / container-typed unknown fields | **422** (`extra="forbid"`) |

No payload crashed the service or produced anything but a structured 4xx.

One accepted framework behavior: pydantic lax-mode coercion accepts
`central_air: "yes"`/`1` as bool and numeric strings for ints. This is standard
pydantic v2 semantics, documented here for completeness; the range/enum
constraints still bind after coercion, so no safety property is lost.

---

## 4. Secrets & configuration

- **Secret scan** — `grep -rniE "(api[_-]?key|secret|password|passwd|
  private[_-]?key|access[_-]?token|bearer)\s*[:=]\s*[A-Za-z0-9_/+\-]{12,}"`
  over all tracked text types, excluding `.venv`, `node_modules`,
  `e2e/node_modules`, `mlruns`, `dist` → **zero hits**. PEM/key-material scan
  (`BEGIN … PRIVATE KEY` etc.) → **zero hits**.
- **`.env`** — currently present in the working tree (created by a concurrent
  docker-smoke agent for its compose run) and **byte-identical to
  `.env.example`** (`diff` → IDENTICAL) → no secrets in it; `.env` is
  gitignored (`.gitignore:14`) so it cannot be committed.
- **CORS** — env-driven: `Settings.cors_origins` default
  `http://localhost:5173,http://localhost:8080`, consumed as
  `allow_origins=settings.cors_origin_list` (`backend/app/main.py:131`). No
  `"*"` anywhere (`grep '"\*"' backend/app/config.py` → no match).
  `allow_credentials=True` is safe here because origins are an explicit list
  (Starlette rejects credentials+wildcard combinations anyway).
- **Error paths** — inspected every handler: `predict.py` 422s echo validation
  detail only; `model.py` 503 reports just the exception *class name*; the
  generic 500 is a static string; `PredictionLogger`/`MetricsMiddleware`
  swallow-and-log. **One leak found and fixed:**
  `MonitoringService.latest_drift_summary` echoed `str(exc)` (an `OSError`
  message embeds the absolute server path) into the `GET /metrics` payload —
  now returns the static `"unreadable drift report"` while the exception stays
  in the server log (`backend/app/services/monitoring_service.py`).
- **Absolute paths** — config resolves repo-relative paths via `ml/paths.py`
  (verified by the final-qa grep; unchanged by this audit).

---

## 5. Model-artifact trust boundary

`joblib.load` (used in `backend/app/main.py` lifespan for the two champions,
and inside `ml.clustering.serve`/`ml.explainability.service`) unpickles
arbitrary objects — **loading a malicious artifact is remote code execution**.
The boundary is therefore:

- Every artifact under `models/` is a **first-party build product** of this
  repo's own seeded pipelines (or a deployer's re-run of them). They are loaded
  only from `Settings.resolved_model_dir` at startup.
- The API **never accepts artifact uploads** — there is no endpoint, form
  field, or code path that turns request bytes into a model. Input bytes only
  ever reach pydantic validation and the feature pipeline.
- Operational rule (now documented in `backend/README.md`, Notes section):
  never point `MODEL_DIR` at user-writable/user-supplied artifacts, and treat
  `models/` as deploy-time trusted content (same trust level as the code).

---

## 6. Docker review (read-only — images owned by another agent)

Reviewed `docker/backend.Dockerfile`, `docker/frontend.Dockerfile`,
`docker/nginx.conf` (no edits — concurrent agent owns/builds them).

- **Backend image:** non-root by construction — `useradd --system … appuser`,
  `chown -R appuser:app /app`, `USER appuser` before `CMD` (lines 48–51). Env
  vars are non-sensitive defaults mirroring `.env.example`; **no secrets, no
  copied `.env`** (`.dockerignore` excludes it; only code + artifacts are
  COPYed). Slim base `python:3.12-slim`, `PIP_NO_CACHE_DIR=1`.
- **Frontend image:** multi-stage `node:24-alpine` build → `nginx:alpine`
  serve; no secrets; only `dist/` + `nginx.conf` cross the stage boundary.
  Observation (accepted): the stock `nginx:alpine` master process starts as
  root to bind :80 and drops workers to the `nginx` user — standard for the
  official image; making it fully rootless (unprivileged port + `nginxinc/
  nginx-unprivileged`) is a deployment-hardening candidate, not a defect.
- `nginx.conf` sets SPA fallback + long-cache for fingerprinted assets; the
  API-side security headers (§2) are applied by the backend itself, so proxied
  deployments remain covered.

---

## 7. Findings summary

| # | Finding | Severity | Status |
|---|---|---|---|
| 1 | `cryptography 49.0.0` — CVE-2026-69247 (PYSEC-2026-3552), transitive via mlflow/google-auth; fix (50.0.0) blocked by `mlflow 3.15.1` pin `cryptography<50` | Medium (advisory); **not reachable** here — no `pkcs7_decrypt` usage anywhere in the exercised surface | **Accepted** (documented; re-check on mlflow upgrade) |
| 2 | No security response headers | Low | **Fixed** — `backend/app/security.py` (`SecurityHeadersMiddleware`) |
| 3 | No request-body size limit | Low | **Fixed** — `BodySizeLimitMiddleware` (413 > 64 KiB) |
| 4 | Generic-500 response bypassed user middleware → security headers absent on 500s | Low | **Fixed** — headers attached in the handler (`main.py`) |
| 5 | `/metrics` drift-error path echoed raw exception (absolute server path disclosure) | Low | **Fixed** — static detail (`monitoring_service.py`) |
| 6 | npm dependencies | — | **Clean** (`npm audit`: 0 vulnerabilities) |
| 7 | Secrets in repo / `.env` handling | — | **Clean** (zero scan hits; `.env` == `.env.example`, gitignored) |
| 8 | CORS configuration | — | **Clean** (env-driven explicit origins, no wildcard) |
| 9 | `PropertyInput` robustness vs abuse payloads | — | **Verified strict** (422/413 across the battery) |
| 10 | Non-root container (backend) | — | **Verified** (`USER appuser`); frontend nginx master-as-root noted as accepted platform default |
| 11 | joblib/pickle trust boundary | — | **Documented** (report §5 + `backend/README.md`) |
| 12 | 64 KiB body limit bypassed via `Transfer-Encoding: chunked` (no Content-Length) — wire-verified 200 KB → 200 during the forensic audit (AUD-02) | Medium | **Fixed (post-audit, wave C)** — `BodySizeLimitMiddleware` now streams length-less bodies through a byte counter and returns 413 as soon as the running total exceeds 64 KiB (`backend/app/security.py`; `docs/audit/fix-backend.md`) |

## 8. Residual risks / deployment-hardening items (not fixed by design)

1. **No authentication / authorization** on any endpoint — the API is open.
   For real deployments: API gateway or token auth (tracked in
   `docs/DEPLOYMENT.md` / README "Planned improvements").
2. **No rate limiting** — 413 caps payload size but not request frequency;
   enforce at a reverse proxy/WAF.
3. **Chunked-upload gap** — *closed post-audit (wave C, AUD-02):* the app now
   counts streamed chunked bodies and 413s them past 64 KiB (finding 12 above).
   Capping body size at the reverse proxy too (nginx `client_max_body_size
   64k;`) remains good defense in depth.
4. **cryptography <50 pin** (finding 1) — revisit on the next mlflow upgrade.
5. **Stock nginx frontend image** runs its master process as root (§6).
6. `/docs` (Swagger UI) is exposed — disable in production if undesired.

## 9. Verification

```
$ .venv/Scripts/python.exe -m pytest backend/tests -q
27 passed, 4 warnings                         # 18 pre-existing + 9 new security tests

$ .venv/Scripts/python.exe -m pytest tests backend/tests -q
154 passed, 4 warnings in 42.20s              # final full-suite run
```

The full-suite baseline at audit start was **114 passed** (verified before any
change). The final run shows **154 passed**: +9 are this audit's security
tests, the other +31 were added concurrently by the other hardening agents
working in the same repo. Zero failures at both counts.
