# Forensic Audit — classification (mission §9)

Agent: **classification** · Date: 2026-08-07 · Mode: report-only (no project files modified; writes limited to this file + `docs/audit/evidence/classification-*.txt`)

Scope: `ml/training/train_classification.py`, `ml/data/sale_speed.py`, `ml/evaluation/select.py` + `ml/evaluation/evaluate.py` (classification parts), `models/classification/*`, `models/registry/classification_champion.joblib`, `models/champion.json`, processed CSVs, and every user-facing doc table quoting classification metrics.

Evidence files:
- `docs/audit/evidence/classification-recompute.py.txt` — exact recompute script (read-only)
- `docs/audit/evidence/classification-recompute-output.txt` — its full stdout
- `docs/audit/evidence/classification-followup.py.txt` — determinism/params follow-up script
- `docs/audit/evidence/classification-followup-output.txt` — its full stdout

Environment note: ambient load from concurrent auditors present; irrelevant here (no timing measurements taken). Local TZ IST (UTC+5:30).

---

## 1. Target: derivation, distribution, SIMULATED status

**PASS — verified by execution** (recompute-output §1, §1b, §1c)

- `sells_within_30_days == (days_on_market <= 30)` holds for **all rows of all splits** (945/338/175), matching `ml/data/sale_speed.py:283` (`FAST_SALE_THRESHOLD_DAYS = 30`, sale_speed.py:38).
- Re-fitting the documented `SaleSpeedSimulator(seed=42)` on the processed train split and calling `transform` reproduces the stored `days_on_market` **exactly for 945/945 train, 338/338 val, 175/175 test rows**. The target in the CSVs is precisely the documented ADR-3 simulation — no hand-edits, no drift.
- Distribution: train **239/945 = 25.291%** (claim "~25.3%", docs/METHODOLOGY.md:77-78 — MATCH); val 99/338 = 29.29%; test 49/175 = 28.0%. Train neg/pos = 2.954 (feeds XGBoost `scale_pos_weight`).
- SIMULATED status confirmed and documented: `ml/data/sale_speed.py:1-10` module banner, ADR-3 (`docs/DECISIONS.md` §ADR-3), `data/processed/schema.json` notes ("days_on_market / sells_within_30_days are SIMULATED (ml/data/sale_speed.py, seed 42)"), trainer docstring `train_classification.py:1-7`, evaluator caveat `evaluate.py:79-84` + report §7.
- Caveat coverage of every report/readme table quoting classification numbers:

  | File | Carries SIMULATED caveat? |
  |---|---|
  | `README.md:224-229` (val/test metrics table) | YES — immediately below table (`:229-230`), plus `:8`, `:148-149` |
  | `reports/MODEL_EVALUATION.md` | YES — header `:11` + dedicated §7 `:131-133` |
  | `FINAL-RELEASE.md:24` | YES — "(simulated target — see §4)"; §4 `:59-61` |
  | `docs/METHODOLOGY.md:77,112-117,140-144` | YES — "(ADR-3)" at each metric mention |
  | `docs/API.md` | YES — `:365` "SIMULATED target (ADR-3)" (payload docs) |
  | `data/README.md:61-68` | YES — dedicated section |
  | `reports/PERFORMANCE.md` | N/A — no classification metric claims (payload example only, `:219`) |
  | `reports/REPRODUCIBILITY.md:60-63,144-145` | **NO — see Finding F2** |

## 2. Champion (calibrated RF) metrics recomputed from artifacts

**PASS — verified by execution** (recompute-output §2, §3; claims from `models/champion.json`)

Registry champion is **byte-identical** (sha256 `d9004a2f…811e7`) to `models/classification/random_forest_calibrated_v1.joblib`. Structure: `CalibratedClassifierCV(method="sigmoid", cv=5)` wrapping a preprocessing+RF pipeline; RF params `class_weight='balanced', random_state=42, n_estimators=300, max_depth=12, min_samples_leaf=5` (matches `metrics.json` best_params).

Recomputed with `build_feature_frame(stats=train-fit artifact)` + `models/feature_list.json` (94 features, matches `MODEL_FEATURES`):

| Metric | val claim | val recomputed | test claim | test recomputed | Match |
|---|---|---|---|---|---|
| ROC-AUC | 0.721778 | 0.721778 | 0.766602 | 0.766602 | ✓ (<5e-7) |
| PR-AUC | 0.525013 | 0.525013 | 0.567363 | 0.567363 | ✓ |
| Brier | 0.18555 | 0.185550 | 0.171026 | 0.171026 | ✓ |
| F1 @0.203292 | 0.545455 | 0.545455 | 0.506329 | 0.506329 | ✓ |
| Precision / recall | 0.409091 / 0.818182 | same | 0.366972 / 0.816327 | same | ✓ |
| Confusion matrix | TN=122 FP=117 FN=18 TP=81 | same | **TP=40 FP=69 FN=9 TN=57** | same | ✓ |

README.md:225-227 and docs/METHODOLOGY.md:142-144 rounded values all match. Champion selection rule verified against `models/classification/metrics.json`: calibrated RF has both the best calibrated val PR-AUC (0.52501 vs logistic 0.50889 / DT 0.46663 / XGB 0.50316) and best calibrated Brier (0.18555 vs 0.19131/0.19730/0.19038) — consistent with SPEC §6 + `select.py:267-321`.

## 3. Operating threshold

**PASS — verified by execution** (recompute-output §4, §4b)

- `pick_f1_threshold` (`ml/evaluation/select.py:324-371`) on val calibrated probabilities reproduces **0.203292 exactly** (F1 0.545455, P 0.409091, R 0.818182); manual `precision_recall_curve` argmax cross-check agrees.
- Test-optimal threshold (computed for demonstration only): **0.258531** (test F1 0.6066 vs 0.5063 at the val-chosen 0.203292). The shipped threshold is demonstrably val-only — no test leakage in selection — and the gap is the honest generalization cost of a 338-row val split. Not a defect.

## 4. Calibration quality

**PASS WITH CONCERN — verified by execution** (recompute-output §5, §5b)

- Calibration helps: calibrated Brier < raw RF Brier on val (0.18555 vs 0.19348) and test (0.17103 vs 0.19155). (Calibrated ROC-AUC on test, 0.7666 > raw 0.7509, is a CV-ensemble side effect, not a calibration guarantee.)
- 10-bin quantile reliability on test: ECE ≈ **0.086** (val ≈ 0.080). Mean predicted 0.254 vs prevalence 0.280 — good in aggregate. But individual bins deviate (test: mean_pred 0.221 → frac_pos 0.000; 0.274 → 0.471). With ~17 rows/bin the bin SE is ~0.11, so deviations are within small-sample noise — the model is *acceptably* calibrated, not *well* calibrated.
- **F3 (P3)**: `models/champion.json` rationale and `docs/METHODOLOGY.md:140-141` say probabilities are "well calibrated". Supported directionally (Brier improves, ECE ~0.08, aggregate bias ~0.03) but the phrase overstates precision at n=175/338. Cosmetic wording issue, not a wrong number.

## 5. Imbalance handling

**PASS — statically verified** (+ artifact inspection, followup-output §C)

- `train_classification.py:159` logistic, `:165` decision tree, `:176` random forest → `class_weight="balanced"`; `:187` XGBoost → `scale_pos_weight=neg_pos_ratio` with ratio computed from train only (`:392`, = 2.954). CV scoring is `average_precision` (`:223`) — appropriate for the 25% positive rate. Fitted champion RF confirmed to carry `class_weight='balanced'`.

## 6. Determinism

**PASS WITH CONCERN — verified by execution** (followup-output §A–C)

- Strictly, "two `predict_proba` calls on the same input are identical" is **FALSE at bit level** for batch inputs: across 8 repeat calls on the 175-row test frame, ~80–90 rows differ by ≤ 2.8e-16 (1 ulp). Root cause: RF `n_jobs=-1` joblib thread batching; with `n_jobs=1` forced inside the champion, calls are bit-identical.
- Impact is nil: 0 threshold-decision flips across repeats; nearest val/test probability to the 0.203292 threshold is 6.1e-06 away — 10 orders of magnitude above the noise. Single-row (serving-path) calls are bit-identical, and single-row equals batch row-0. **F4 (P3)**: serving/reproducibility docs should note the ±1 ulp batch nondeterminism (`reports/REPRODUCIBILITY.md` already reports a ≤2.22e-16 retrain diff — consistent).

## 7. Artifact/timestamp forensics (no action needed, noted for orchestrator)

- `data/processed/*.csv` (17:01 IST) and 6 of 8 classification joblibs (17:04–17:08 IST) were rewritten **after** `champion.json` (16:08 IST) and `metrics.json` (12:15 IST); `random_forest_calibrated_v1.joblib` + `metrics.json` were not rewritten. Verified by execution that all 8 current joblibs still reproduce `metrics.json` val numbers exactly on the current CSVs (recompute-output §5c) and that the champion reproduces `champion.json` — i.e., the re-run pipeline/retraining was content-deterministic (consistent with the ADR-3 addendum "byte-identical" claim and `docs/agent-log/final-qa.md:173`). No inconsistency in content; mtimes only.

---

## Findings

| # | Sev | Location | Description | Evidence |
|---|---|---|---|---|
| F1 | P3 | `docs/API.md:155` | Stale `selected_at` (`2026-08-07T07:09:17Z`) vs current `models/champion.json` (`10:38:48Z`); metric values identical, timestamp snapshot from an earlier evaluator run | grep; champion.json; `docs/agent-log/final-qa.md:173` |
| F2 | P3 | `reports/REPRODUCIBILITY.md:60-63,75-76,142-145` | Only user-facing report quoting classification metric values (ROC-AUC/PR-AUC/Brier, "0.5250 / 0.1856") with **zero** "simulated"/ADR-3 mentions in the file — caveat-coverage gap vs the "every table carries the caveat" rule | `grep -ci simulated` = 0 |
| F3 | P3 | `models/champion.json` rationale; `docs/METHODOLOGY.md:140-141` | "well calibrated" overstates: test ECE(10 bins) ≈ 0.086, individual bins off up to ±0.25 abs (n≈17/bin, within sampling noise); calibrated Brier does beat raw on both splits | classification-recompute-output.txt §5/§5b |
| F4 | P3 | champion serving path (`n_jobs=-1` in RF inside `CalibratedClassifierCV`) | Batch `predict_proba` not bit-identical across calls (≤2.8e-16, 1 ulp, thread-batching order; bit-identical with n_jobs=1). Zero threshold flips; no metric impact | classification-followup-output.txt §A–C |

No P0/P1/P2 findings. Every quantitative claim assigned to this audit (target rate ~25.3%, val PR-AUC 0.525/Brier 0.1856, threshold 0.203292 max-F1, test ROC-AUC 0.7666 / PR-AUC 0.5674 / Brier 0.1710 / F1 0.5063 / CM TP=40 FP=69 FN=9 TN=57) **reproduced exactly from current artifacts**.

## Coverage

- Files read in full: `ml/training/train_classification.py` (493 lines), `ml/data/sale_speed.py` (288), `ml/evaluation/select.py` (371), `ml/evaluation/evaluate.py` (798), `ml/training/common.py`, `ml/paths.py`; classification-relevant sections of `ml/data/pipeline.py`.
- Functions verified by execution: `SaleSpeedSimulator.fit/transform` (exact reproduction ×3 splits), `attach_sale_speed` semantics (target == DOM≤30), `pick_f1_threshold` (exact 0.203292 reproduction + tie-break cross-check), `classification_metrics` (via `evaluate.py` path — val/test recompute), `select_classification_champion` logic (ranking recomputed from metrics.json), `CalibratedClassifierCV`/champion `predict_proba` (metrics, calibration, determinism), `build_feature_frame` parity (94 features, matches `MODEL_FEATURES`).
- Artifacts hashed/inspected: `models/registry/classification_champion.joblib` (sha256 == `random_forest_calibrated_v1.joblib`), all 8 `models/classification/*.joblib` re-scored vs `metrics.json`, `models/champion.json`, `data/processed/schema.json`, `models/feature_list.json` (no leakage: no `days_on_market`/`sells_within_30_days`/`SalePrice` among the 94 features — only train-fit neighborhood price stats).
- Docs scanned for caveat coverage: README.md, FINAL-RELEASE.md, reports/{MODEL_EVALUATION,PERFORMANCE,REPRODUCIBILITY,DOCKER_SMOKE}.md, docs/{API,METHODOLOGY,PROJECT_SPEC,DECISIONS}.md, data/README.md.

## For the orchestrator to reconcile

1. **F2 ownership**: REPRODUCIBILITY.md caveat gap overlaps the docs-truth agent's §21 scope — dedupe.
2. **F1** overlaps docs-truth (stale API.md snapshot); final-qa.md:173 already explains the two evaluator runs — confirm no other doc captured the 07:09:17Z snapshot.
3. **Timestamp forensics (§7)** overlaps the artifacts agent (§12): models/data were rewritten after `champion.json`; content verified equivalent here — merge with the reproducibility agent's byte-identity claims.
4. **F4 determinism**: regression agent (§8) may observe the same 1-ulp batch noise in the RF regressor (if any) — align wording of the joint determinism note.
