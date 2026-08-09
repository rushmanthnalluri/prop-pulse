# Agent log — security-audit

**Scope:** security audit + low-risk hardening of PropPulse. Owned files:
`backend/` (surgical additions), requirements files (pin bumps only — none
needed), `reports/SECURITY.md` (new). Date: 2026-08-07. Windows + Git Bash,
Python 3.14.5 via `.venv/Scripts/python.exe`, Node 24. No git commands run; no
servers started (all verification via FastAPI TestClient — no ports used);
`docs/AGENT_STATUS.md` untouched.

## What was done

1. **Dependency audit.**
   - Installed `pip-audit 2.10.1` into the venv. One finding:
     `cryptography 49.0.0` — `PYSEC-2026-3552` / `CVE-2026-69247`
     (Bleichenbacher oracle in `pkcs7_decrypt_*`; transitive via
     mlflow/google-auth; fix version 50.0.0).
   - **Fix attempted and reverted with evidence:** `pip install
     cryptography==50.0.0` → `pip check` fails: `mlflow 3.15.1 requires
     cryptography<50,>=43.0.0`. Reverted to 49.0.0; `pip check` clean again.
     Downgrading to 43.x rejected (would re-introduce older CVE lines).
     Verdict: **accepted risk** — grep proves nothing in the exercised
     dependency surface (mlflow file-store path, google-auth, PropPulse code)
     calls `pkcs7_decrypt`; the advisory's exploit scenario (S/MIME-style
     auto-decryption service) does not exist here. Re-check on mlflow upgrade.
   - `pip_audit -r backend/requirements.txt` → **No known vulnerabilities
     found** (serving image does not carry cryptography).
   - `npm audit` in `frontend/` → **found 0 vulnerabilities**. No frontend
     changes.
2. **HTTP hardening (implemented + tested).**
   - New `backend/app/security.py`: `SecurityHeadersMiddleware`
     (X-Content-Type-Options: nosniff, X-Frame-Options: DENY, Referrer-Policy:
     no-referrer, Cache-Control: no-store on every response) and
     `BodySizeLimitMiddleware` (Content-Length > 64 KiB → 413 before parsing).
   - `backend/app/main.py`: middleware wired outermost (headers also land on
     413/4xx); generic-500 handler now attaches the security headers itself
     because Starlette's `ServerErrorMiddleware` bypasses user middleware.
   - New `backend/tests/test_security.py` (9 tests): headers on
     200/404/422/413/500, 413 above 64 KiB, boundary pass at exactly 65,536
     bytes, forced-exception 500 shape (test-only route, sentinel not leaked),
     malformed-JSON 422 without internals, abuse battery.
3. **Input-validation review.** `PropertyInput` confirmed strict
   (`extra="forbid"`, Literal enums, ranges, neighborhood whitelist). Abuse
   payloads all rejected: `10**15` numerics → 422; type confusion (str/int,
   fractional float, list, int-for-str) → 422; unicode bomb + NUL padding →
   422; ~100 KiB string → 413 (body limit fires first — defense in depth);
   nested/unknown structures → 422.
4. **Secrets/config.** Secret-pattern + PEM scans over tracked files (excl.
   `.venv`/`node_modules`/`e2e/node_modules`/`mlruns`/`dist`) → zero hits.
   `.env` currently present (created by the concurrent docker-smoke agent) is
   **byte-identical to `.env.example`** (diff → IDENTICAL) and gitignored.
   CORS env-driven, default `http://localhost:5173,http://localhost:8080`, no
   wildcard. Error-path inspection found **one real leak, fixed**:
   `MonitoringService.latest_drift_summary` embedded `str(exc)` (absolute
   server path on OSError) into the `/metrics` payload → now a static string
   (`backend/app/services/monitoring_service.py`).
5. **Model-artifact trust.** Documented the joblib/pickle RCE trust boundary
   in `reports/SECURITY.md` §5 + one bullet in `backend/README.md` (Notes):
   artifacts under `models/` are first-party build products; never load
   user-supplied artifacts; the API has no artifact-upload path.
6. **Docker (read-only review; another agent owns/builds).** Backend image:
   non-root `USER appuser` (docker/backend.Dockerfile:48-51), no secrets, no
   `.env` copied. Frontend: multi-stage node→nginx, no secrets; accepted
   observation: stock `nginx:alpine` master runs as root to bind :80 (workers
   drop to `nginx`) — rootless nginx noted as deployment-hardening candidate.

## Files touched

```
backend/app/security.py                     # NEW — headers + 64 KiB body-limit middleware
backend/app/main.py                         # wire middleware; security headers on generic 500
backend/app/services/monitoring_service.py  # stop echoing raw exception into /metrics payload
backend/tests/test_security.py              # NEW — 9 security tests
backend/README.md                           # Notes: security pointer + joblib trust boundary
reports/SECURITY.md                         # NEW — full audit report
docs/agent-log/security-audit.md            # this log
```

No requirement pins were changed (the only fixable-via-bump CVE was blocked by
the mlflow pin — see above; everything else was clean).

## Verification evidence

```
$ .venv/Scripts/python.exe -m pytest tests backend/tests -q   # BEFORE changes
114 passed, 4 warnings in 48.06s

$ .venv/Scripts/python.exe -m pytest backend/tests -q         # after hardening
27 passed, 4 warnings in 26.50s               # 18 pre-existing + 9 new

$ .venv/Scripts/python.exe -m pytest tests backend/tests -q   # FINAL
154 passed, 4 warnings in 42.20s
```

Final count is 154, not 123: besides my +9, the concurrent hardening wave
added +31 tests elsewhere in `tests/` while I worked. Zero failures either way.
Live TestClient capture (headers/413/422/500 incl. sentinel check) is quoted in
`reports/SECURITY.md` §2. `pip check` clean after the cryptography revert.

## Environment notes for the orchestrator

- The venv now additionally contains `pip-audit 2.10.1` + its deps (audit
  tooling only; not imported by the app, not added to requirements files;
  harmless to leave). Its install upgraded `rich` to 15.0.0 (unpinned mlflow
  dep; `pip check` clean; full suite green afterwards).
- `.env` exists in the working tree (docker-smoke agent's, == `.env.example`,
  gitignored) — left in place deliberately.
- Residual risks documented in `reports/SECURITY.md` §8: no auth, no rate
  limiting, chunked-upload gap of the Content-Length-based body limit,
  cryptography pin revisit on mlflow upgrade, stock nginx root master.
