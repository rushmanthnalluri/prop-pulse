# Fix report — fix-docker (AUD-05)

**Date:** 2026-08-07 · **Agent:** fix-docker · **Scope:** AUD-05 only.

## Finding fixed

> **AUD-05** — `docker-compose.override.yml` auto-merges → real ports 18000/18080 while docs lead with 8000/8080; CI only validates merged config (llba-frontend-infra F1, devops D1/D4). Disposition: *FIX (rename to explicit `-f` file + CI validates both)*.

Root cause: Compose v2 auto-merges any `docker-compose.override.yml` sitting next to the base file, so every plain `docker compose …` invocation (including a fresh checkout's `up --build` and CI's `config -q`) silently produced the port-remapped config — opt-**out**, not opt-in.

## Changes (AUD-05 → file:line → one-liner)

- **AUD-05 → `docker-compose.override.yml` → `docker-compose.alt-ports.yml` (rename)** — file renamed so compose never auto-merges it; alt ports become explicit opt-in via `-f docker-compose.yml -f docker-compose.alt-ports.yml`. No YAML body changes (same `!override` port mappings, same `CORS_ORIGINS` / `VITE_API_URL` rewiring).
- **AUD-05 → `docker-compose.alt-ports.yml:1-6`** — header comment rewritten: states the file is committed but opt-in, is *not* the magic override name, and shows the explicit merge command (old header claimed "Local-only … NOT committed defaults" while shipping un-gitignored).
- **AUD-05 → `docker-compose.yml:8-12`** — comments only: defaults stated as 8000/8080/5000; alt-ports file referenced by its new name with the explicit `-f` command and "never merges automatically" (old comment said compose "picks it up automatically"). No directive changed.
- **AUD-05 → `docker/README.md:18-23`** — top-block packaging note now points at the committed `docker-compose.alt-ports.yml` instead of telling users to "drop a `docker-compose.override.yml`" themselves.
- **AUD-05 → `docker/README.md:41-52`** — new "default ports + alt-ports recipe" paragraph under *Build & run*: defaults 8000/8080/5000 lead; the 18000/18080/15000 merge is shown as an explicit command; notes the foreign `showcase-*` containers squatting 8000/8080/5000 are why the file exists.
- **AUD-05 → `docker/README.md:157-159`** — closing note now says CI validates both the base file alone and the merged alt-ports config.
- **AUD-05 → `.github/workflows/ci.yml:4-5`** — header comment: docker job described as validating base + merged alt-ports (was "docker-compose.yml only").
- **AUD-05 → `.github/workflows/ci.yml:67-76`** — docker job now has two steps: `docker compose config -q` (validates the base alone — plain invocation is deliberate: no override file exists to auto-merge) and `docker compose -f docker-compose.yml -f docker-compose.alt-ports.yml config -q` (validates the merged alt-ports config). Fixes devops D4 ("CI validates merged config, never base alone").

## Regression coverage

- **CI (the audit-prescribed guard):** the finding's own disposition ("rename + CI validates both") is implemented in `.github/workflows/ci.yml` — every push/PR now fails if either the base config or the merged alt-ports config breaks. No pytest was added: no `tests/` path is in this agent's ownership, the existing suite has no docker dependency, and this is a packaging/truth-in-docs defect whose automated guard belongs in the CI docker job (D4).
- **Execution verification (local, Docker Server 29.4.0 / Compose v5.1.1):** see below.

## Before / after evidence

Before (pre-rename, 2026-08-07):

```
$ docker compose config -q                      # plain invocation, override auto-merged
exit=0
$ docker compose config | grep published
published: "18000"                              # backend — NOT the documented 8000
published: "18080"                              # frontend — NOT the documented 8080
$ docker compose -f docker-compose.yml config | grep published
published: "8000"
published: "8080"
```

After (post-rename):

```
$ ls docker-compose*.yml
docker-compose.alt-ports.yml
docker-compose.yml                              # no docker-compose.override.yml anywhere

$ docker compose config -q                      # plain invocation = base only now
exit=0
$ docker compose config | grep published
published: "8000"                               # documented default
published: "8080"                               # documented default

$ docker compose -f docker-compose.yml config -q
exit=0
$ docker compose -f docker-compose.yml --profile mlflow config | grep published
published: "8000"
published: "8080"
published: "5000"

$ docker compose -f docker-compose.yml -f docker-compose.alt-ports.yml config -q
exit=0
$ docker compose -f docker-compose.yml -f docker-compose.alt-ports.yml --profile mlflow config | grep published
published: "18000"
published: "18080"
published: "15000"
```

Behavior of the merged alt-ports config is unchanged by the rename — the `!override` port mappings and the browser-side rewiring survive byte-for-byte:

```
$ docker compose -f docker-compose.yml -f docker-compose.alt-ports.yml config | grep -E 'CORS_ORIGINS|VITE_API_URL'
CORS_ORIGINS: http://localhost:5173,http://localhost:18080      # backend env override
VITE_API_URL: http://localhost:8000                             # inert backend-image ENV via .env (pre-existing, llba F10)
VITE_API_URL: http://localhost:18000                            # frontend build ARG override
```

CI workflow parses and runs the two required commands:

```
$ python -c "import yaml; …"   # yaml.safe_load of .github/workflows/ci.yml
jobs: ['python', 'frontend', 'docker']
docker runs: ['docker compose config -q',
              'docker compose -f docker-compose.yml -f docker-compose.alt-ports.yml config -q']
```

## Optional live smoke — NOT run (host ports occupied, config-validation only)

`netstat` shows 8000/8080/5000 bound by foreign processes (PID 10388 — the `showcase-*` containers documented in the alt-ports header), so a base-file `docker compose up -d` would collide; per the assignment this reduces to config-validation + this note. No containers were started, no server was launched (port 8700 unused), `logs/predictions.jsonl` untouched, no foreign containers touched.

## Test suite

Baseline at wave-C start: 162 green. After fix:

```
$ .venv/Scripts/python.exe -m pytest tests backend/tests -q
167 passed, 4 warnings in 46.04s
```

167 ≥ 162 — green (the +5 are other wave-C agents' regression tests landing concurrently; this fix adds no Python tests — see *Regression coverage*). My changed files are YAML/Markdown only; nothing in the pytest path imports them.

## Out of scope / left for others

- `README.md`, `docs/DEPLOYMENT.md`, `FINAL-RELEASE.md`, `reports/DOCKER_SMOKE.md` still reference the old `docker-compose.override.yml` name — owned by the docs agent (AUD-27), who will point them at `docker-compose.alt-ports.yml`.
- `docs/agent-log/*` historical mentions left as-is (historical record).
