# Forensic Runtime Audit — monitoring (Wave B, mission §16)

**Scope:** execution-based audit of `ml/monitoring/` (PSI, reference, drift_check), the backend
monitoring surface (`/metrics`, prediction logging), and the monitoring docs contract (SPEC §10).
CLI-focused; one server run on assigned port **8350** (killed afterwards; port verified free).
**Date:** 2026-08-07. **Mode:** report-only — no project source/config/docs modified. Repo files
touched transiently and restored byte-identical (sha256-verified): `reports/drift/latest.json`
(swap tests + CLI smoke). `logs/predictions.jsonl` was **never written by me** (server used
`PREDICTION_LOG_PATH` → temp file) — but see contradiction C1: another concurrent auditor mutated
it during my window.

**Verdict: PASS WITH CONCERN** — 7 of 8 assigned claims fully verified by execution; F1 confirmed
(and found slightly worse than stated). 5 findings (0 P0, 0 P1, 2 P2, 3 P3).

Ambient note: concurrent auditors (performance on :8500, devops docker stack) were active; no
timing-sensitive assertions were made, so load is irrelevant to these results.

---

## Findings

| # | Sev | Location | One-liner | Evidence |
|---|-----|----------|-----------|----------|
| M1 | P2 | `ml/monitoring/psi.py:121-125,154` + `ml/monitoring/reference.py:101` | **PSI blind spot confirmed — 6 features (11% of numeric) can NEVER drift, even out-of-range.** `3SsnPorch`, `BsmtHalfBath`, `LowQualFinSF`, `MiscVal`, `PoolArea`, `ScreenPorch` store 2 edges (e.g. PoolArea `[0.0, 738.0]`) → `bin_proportions` builds a single `[-inf,+inf]` bin → PSI ≡ 0.0 for *any* production value. Verified: PoolArea all-500.0 → 0.0; all-9,999,999.0 → **0.0** (wave-A F1 said "in-range"; actually even range-breaking values are invisible). Contrast: +50% GrLivArea shift → PSI 1.385. Nothing in `reference_stats.json` or the report flags degenerate features. Train zero-inflation: 92.3–99.4%. | `monitoring-02-f1.txt` §A–D |
| M2 | P2 | `ml/monitoring/drift_check.py:316` vs docs | **Structural calendar drift flips `retraining_recommended=true` on sustained live traffic with zero real drift.** n=250 synthetic today-dated (2026-08) rows, non-calendar features resampled from train: drifted = `[MoSold, YrSold, property_age, sale_month, sale_quarter, sale_year, years_since_remod]` — all calendar-derived; non-calendar drifted = `[]`; `retraining_recommended=True`. Docs disclose only `YrSold`/`sale_year` (API.md:117-119, README.md:379-381, DEPLOYMENT.md:132-135); `property_age`/`years_since_remod` (+18y on the same housing stock) are undisclosed, and DEPLOYMENT.md:178 advises wiring the flag to an alert → permanent alert after ~200 predictions. API.md:94's own example shows `"retraining_recommended": true` from this cause. Caveat: my fixture used constant MoSold=8, so MoSold/sale_month/sale_quarter PSIs (6.8–12.7) overstate mixed-month traffic; YrSold/sale_year (4.36) and property_age/years_since_remod drift regardless. | `monitoring-07-calendar.txt` §C |
| M3 | P3 | `backend/app/config.py:42` | **`DRIFT_PSI_THRESHOLD` is a dead config wire.** Parsed into `Settings.drift_psi_threshold` but referenced nowhere else in `backend/` or `ml/` (grep: only config.py hits). drift_check hardcodes `PSI_DRIFT_THRESHOLD=0.2` (`ml/monitoring/psi.py:31`). README.md:373's claim "0.2 (configurable via `DRIFT_PSI_THRESHOLD`)" is false; also documented in .env.example:32, DEPLOYMENT.md:29, docker/README.md:86, docker/backend.Dockerfile:69. Setting the env var changes nothing. | `monitoring-03-thresholds.txt` §D |
| M4 | P3 | `ml/monitoring/drift_check.py:302-315` + `frontend/src/pages/ModelInsights.jsx:155-163` | **Small-n PSI inflation surfaces "Drift detected" in the UI.** At n=7 (current live report) and n=3 (my real API lines) ~46 of 53 features flag drifted (PSI 4–13) because empty-bin eps penalties dominate tiny windows; `retraining_recommended` correctly stays false. The frontend renders `drift_detected:true` as a red "Drift detected" card. Partially disclosed (reports/DOCKER_SMOKE.md:189 "small-sample noise"); detection itself has no min-n gate (only retraining does). Behavior is defensible PSI semantics but operationally noisy at low traffic. | `monitoring-08-logschema.txt` (tail), `monitoring-06-metrics-swaps.txt` §A |
| M5 | P3 | `ml/monitoring/__init__.py:12-21` | **CLI emits a runpy RuntimeWarning.** `python -m ml.monitoring.drift_check` prints `<frozen runpy>:130: RuntimeWarning: 'ml.monitoring.drift_check' found in sys.modules …` because the package `__init__` eagerly imports the submodule before runpy executes it. Cosmetic (exit code unaffected), but cron logs (DEPLOYMENT.md:125) carry it on every run. | `monitoring-09-cli.txt` |

**Confirmed wave-A observation (not re-filed):** blank log lines are skipped *without* counting in
`n_invalid` while `read_prediction_window`'s docstring says malformed lines are "skipped and
counted" (`drift_check.py:85-88`); my mixed-garbage test reproduced exactly this (2 blank lines
uncounted, 7 invalid counted). Also: the drift-report path is **not** env-overridable
(`config.py:68-70` hardcodes `REPO_ROOT/reports/drift/latest.json`; only `PREDICTION_LOG_PATH` is
env-driven) — SPEC §12 does not require it, noted for the devops agent.

---

## Per-claim verdicts (assignment tasks 1–8)

### 1. PSI correctness — PASS — verified by execution (`monitoring-01-psi.txt`)
- Hand-computed `e=[.5,.5], a=[.25,.75]` → 0.2746530721670274, matches
  `population_stability_index` exactly; formula is the standard Σ(a−e)·ln(a/e).
- 3 reference features (GrLivArea 10-bin, OverallQual 5-bin, LotArea 10-bin) × hand-built shifted
  samples (seed 42): my independent binning+PSI (no library calls) matches the library to <1e-9
  (0.3816953175 / 1.7426695716 / 2.4040885985). In-distribution controls ≈ 0.00002.
- eps handling: proportions clipped at 1e-6 then renormalized; empty-bin penalty large-but-finite
  (8.155 for the crafted case; 27.631 for full surprise mass at 1e-9 expected).
- Out-of-range values land in edge bins: `[min−5000, max+50000]` → proportions `[0.5, 0, …, 0, 0.5]`;
  all-above-max production → PSI 12.42 (drift-scale). ✓ ±inf open edges work as documented.
- `psi_bins_from_train`: constant → `[c−0.5, c, c+0.5]`; 95%-zero sample → 2 edges (the F1 mechanism);
  empty/junk/`n_bins=0` raise ValueError.

### 2. Wave-A llba-ml-services F1 — **CONFIRMED** (and slightly worse than stated) — finding M1
6 one-bin features: `3SsnPorch, BsmtHalfBath, LowQualFinSF, MiscVal, PoolArea, ScreenPorch`
(F1's "+1 more" = `BsmtHalfBath`). 8 two-bin: `BsmtFinSF2, BsmtFullBath, EnclosedPorch, Fireplaces,
HalfBath, KitchenAbvGr, YrSold, sale_year`. Edges/proportions printed in evidence §A. Blind-spot
demo on PoolArea: in-range shift → PSI 0.0; **extreme out-of-range → PSI 0.0 too** (single
`[-inf,+inf]` bin has no edges at all). Shifted healthy feature (GrLivArea +50%) → PSI 1.385 ≫ 0.2.

### 3. Thresholds + retraining guard — PASS — verified by execution (`monitoring-03-thresholds.txt`, `monitoring-03b-control.txt`)
- Constants `PSI_WARN_THRESHOLD=0.1` (psi.py:29), `PSI_DRIFT_THRESHOLD=0.2` (psi.py:31),
  `MIN_SAMPLE_FOR_RETRAINING=200` (drift_check.py:50) match SPEC §10 (PROJECT_SPEC.md:226,235) and
  DEPLOYMENT.md:29,107,132. Comparison operators `>= 0.2` / `0.1 <= psi < 0.2` /
  `drift and n >= 200` (drift_check.py:304,309,316) match the doc wording.
- Boundary in a TEMP dir (repo log/report untouched): drift@n=199 → retraining **False**;
  drift@n=200 → **True**; drift@n=201 → True; in-distribution n=300 (train-resampled) →
  drift False / retraining False (max PSI 0.064). Guard is exactly `drift AND n≥200`.

### 4. No auto-retrain path — PASS — statically verified
- `ml/monitoring/` + `backend/`: no `subprocess`/`os.system`/`Popen`/spawn/train invocations
  (only import from training code is `ml.training.common.{load_split, write_json}` — pure IO).
  `retraining_recommended` is a JSON boolean; text says "a human must review and trigger any
  retraining run" (drift_check.py:352-353).
- Repo-wide: the only retrain automation is `scripts/audit_reproducibility.py` (manual audit tool,
  backs up/restores artifacts); CI workflow, docker, and cron (DEPLOYMENT.md:125) run only
  `drift_check`. DEPLOYMENT.md:178 explicitly says wire the flag "to an alert, not to" retraining.

### 5. drift_check robustness — PASS — verified by execution (`monitoring-05-robustness.txt`)
Malformed JSON, non-dict JSON (`[1,2,3]`, `42`, `"str"`), missing `features`, non-dict `features`
(list/str) → all skipped+counted (3 valid / 7 invalid on a crafted 12-line file; blanks uncounted).
Empty file and missing file → `status=no_data`, exit-safe. All-garbage → `no_data` with
`n_invalid_lines=3`. 1MB valid line parses (valid); 1MB malformed line → counted invalid, no crash.
Non-numeric values (`"abc"`, None, NaN, ±Infinity — including raw JSON `NaN`/`Infinity` tokens —
lists, dicts) are dropped; bools coerce to 0/1; an all-junk feature is silently omitted from
`per_feature_psi` (status stays `ok`, `max_psi=null`, recommendation text explains). Window = last N
**raw** lines (invalid lines consume window slots). No crash anywhere.

### 6. /metrics exposure — PASS — verified by execution on :8350 (`monitoring-06-metrics-swaps.txt`)
- With the real (docker-smoke) report: `drift` passes the full ok report through — `status`,
  `n_predictions`, `drift_detected`, `per_feature_psi` (53), `warn_threshold`/`psi_threshold`,
  `min_sample_for_retraining`, `retraining_recommended`, `prediction_psi` — the exact shape
  `ModelInsights.jsx:140-207` consumes (no_data placeholder handled there with `?? 0.1`/`?? 0.2`).
- Report missing → `{status:"no_data", detail:"…run python -m ml.monitoring.drift_check…"}`;
  crafted ok report → verbatim passthrough; malformed JSON → `{status:"no_data",
  detail:"unreadable drift report"}` (no exception/path leak); non-dict JSON → `{status:"no_data"}`.
- **Env override not supported** for the drift report (hardcoded `config.py:68-70`); tests used
  backup/swap/restore (sha256 `eb18910d…` identical before and after).

### 7. YrSold/sale_year structural drift — CONFIRMED, docs PARTIALLY disclose — finding M2 (`monitoring-07-calendar.txt`)
- All-2026 production → PSI **4.358638** for both `YrSold` and `sale_year` — bit-identical to the
  value in the live `reports/drift/latest.json`, which was produced by real docker-smoke traffic.
- Split ranges verified: train YrSold 2006–2008 (945), val 2009 (338), test 2010 (175) — the
  time-based split (ADR-4) makes post-2008 calendar drift structural and permanent.
- Disclosure exists in 3 places (API.md:117-119, README.md:379-381, DEPLOYMENT.md:132-135) but
  covers only `YrSold`/`sale_year`; execution shows `property_age`/`years_since_remod` (and on
  single-month traffic `MoSold`/`sale_month`/`sale_quarter`) drift too, and at n≥200 the
  **retraining flag fires on calendar features alone** (M2).
- Side observation: live report's identical `prediction_psi` for `estimated_price` and
  `probability` (10.48874) is **not** a bug — both prediction references have near-uniform
  expected proportions ([0.101×…, 0.098×…] identical per bin), so an all-same-bin window yields
  identical PSI for both fields.

### 8. Prediction-log schema via real API — PASS — verified by execution on :8350 (`monitoring-08-logschema.txt`)
- POST `/predict`, `/predict/price`, `/predict/sale-probability` (HTTP 200 ×3) each appended exactly
  one line with the exact SPEC §10 top-level keys `{timestamp, payload, features, prediction,
  model_version}` and prediction sub-keys `{estimated_price, probability, cluster_id}`.
- `features` = the full built row: **94/94 keys == MODEL_FEATURES**, no nulls.
- Narrow endpoints log `null` for skipped values (wave-9b claim CONFIRMED): `/predict/price` →
  `probability: null`; `/predict/sale-probability` → `estimated_price: null`. drift_check's
  `_coerced` drops these nulls, so feature PSI is unaffected.
- Default `sale_date` → today: logged features `YrSold=2026, sale_year=2026.0, MoSold=8` — the live
  mechanism behind M2. drift_check over the 3 real lines: `status=ok, n=3, n_invalid_lines=0`.
- Repo `logs/predictions.jsonl` untouched by me (server ran with `PREDICTION_LOG_PATH`=temp file).

---

## Evidence index (`docs/audit/evidence/`)

| File | Contents |
|---|---|
| `monitoring-01-psi.txt` (+`.py.txt`) | PSI hand-recompute vs library (3 features), eps penalty, edge-bin out-of-range, bin conventions |
| `monitoring-02-f1.txt` (+`.py.txt`) | Degenerate-bin census (6×1-bin, 8×2-bin), train zero-inflation, PoolArea blind-spot proof incl. out-of-range, GrLivArea contrast |
| `monitoring-03-thresholds.txt` / `monitoring-03b-control.txt` (+`.py.txt`) | Constants vs docs, n=199/200/201/300 boundary in temp dir, in-distribution control, dead-wire grep |
| `monitoring-05-robustness.txt` (+`.py.txt`) | Full robustness matrix incl. 1MB lines, NaN/±Infinity tokens, all-junk feature, window semantics |
| `monitoring-06-metrics-swaps.txt` | /metrics live + missing/crafted/malformed/non-dict swap tests, frontend shape mapping, restore sha256 |
| `monitoring-07-calendar.txt` (+`.py.txt`) | All-2026 PSI = 4.358638 (= live report), split year ranges, n=250 today-dated full drift check, disclosure inventory |
| `monitoring-08-logschema.txt` | 3 real API predictions → exact SPEC §10 schema, 94/94 features, null-skip confirmation, drift loop-closure |
| `monitoring-09-cli.txt` | CLI smoke: exit 0 on no_data + on real lines; runpy warning; report restored |

## Hygiene verification

- Port 8350: server killed; `netstat` shows only TIME_WAIT (no listener); `curl` → connection refused.
- `reports/drift/latest.json`: sha256 `eb18910d48f0253c3bed7f5d564cae449e21cc4782811d93219797578d5c5aef` before and after — byte-identical.
- `logs/predictions.jsonl`: never written by my server/tests (temp `PREDICTION_LOG_PATH`); see C1.
- Scratch dir `%TEMP%\proppulse-monitoring-audit` contains only my temp files (server log, temp log, backup).

## Contradictions / notes for the orchestrator

1. **C1 — `logs/predictions.jsonl` mutated by a concurrent auditor during my window.** My baseline
   (2026-08-07 ~13:50Z): sha256 `c4429c89…`, **210 lines**. At ~14:00Z: sha256 `6972fb14…`,
   **19 lines**. I never wrote to it (proof: my server's `PREDICTION_LOG_PATH` pointed at a temp
   file; my drift_check runs only read). The devops agent's plan includes a backup/restore of this
   file — orchestrator should confirm its final state matches their baseline. Cross-agent
   interference makes any audit assertion about this file's contents time-boxed.
2. **C2 — wave-A F1 wording:** "6 of 53 … (+1 more)" → the 6th is `BsmtHalfBath`; and the blind
   spot covers out-of-range values too (single `[-inf,+inf]` bin), which F1's "every in-range
   value" phrasing understates. Verdict unchanged: F1 CONFIRMED (P2 upheld).
3. **C3 — README.md:373 vs code:** "configurable via `DRIFT_PSI_THRESHOLD`" contradicts the dead
   wire (M3). Reconcile with docs-truth/security agents (both grepped this var).
4. **C4 — API.md:94 example shows `"retraining_recommended": true`** with only `YrSold`/`sale_year`
   drifted — i.e., the docs' own example displays the M2 false-positive. If another agent rates
   SPEC §10 "retraining only on real drift" satisfied, M2 qualifies that verdict.
5. **C5 — live drift state:** `reports/drift/latest.json` currently shows `drift_detected: true`
   (n=7, retraining false) — matches wave-A's note; any "no drift" claim in docs/UI contradicts it.
