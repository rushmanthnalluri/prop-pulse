# PropPulse — Documentation Truth Audit (docs-truth, mission §21)

**Date:** 2026-08-07 · **Auditor:** docs-truth (forensic audit, wave A) · **Mode:** report-only
**Method:** every load-bearing documented claim compared against reality by (a) direct
execution (live API on port 8380, pandas/sklearn recomputation from raw + processed data
and committed artifacts, pytest run, docker CLI), or (b) static source verification
(file:line). Nothing was trusted from README/reports/agent-logs without recomputation.

**Environment:** Windows + Git Bash, `.venv/Scripts/python.exe` (Python 3.14.5, pandas
2.3.3, sklearn 1.9.0, xgboost 3.4.0, shap 0.52.0, mlflow 3.15.1, pytest 9.1.1),
Docker client/server 29.4.0 + Compose v5.1.1 (daemon running), Node 24.
Ambient CPU load from concurrent auditors noted; no timing claim of mine depends on it.

**Server hygiene:** one uvicorn instance was started on my assigned port **8380**
(`LOG_LEVEL=WARNING`, `PREDICTION_LOG_PATH` redirected to
`docs/audit/evidence/docs-truth-server-predictions.jsonl` so the production log was not
polluted), used for all live checks, then killed; `netstat` confirms **port 8380 FREE**
afterwards (evidence: docs-truth-misc.txt).

**Evidence files** (all under `docs/audit/evidence/`):

| file | contents |
|---|---|
| `docs-truth-data.txt` | raw/processed dataset facts recomputed (shapes, splits, NaN=0, EDA numbers) |
| `docs-truth-artifacts.txt` | feature_list sha1/len, feature_importance top-12, metrics.json dumps, artifact sizes |
| `docs-truth-recompute.txt` | **independent metric recomputation** from committed champions on val/test |
| `docs-truth-live-api.txt` | live server (port 8380) responses vs every documented API/demo number, CORS, 422, 413 |
| `docs-truth-geo.txt` | GEOGRAPHY.md numeric claims recomputed from `neighborhood_geo.csv` |
| `docs-truth-paths.txt` | 84 referenced paths existence check + claimed-absent files |
| `docs-truth-pytest.txt` | full suite run: **162 passed** |
| `docs-truth-misc.txt` | versions, docker, compose config, playwright, caveat coverage, md5s, port-free proof |

---

## Verdict summary

**Documentation is exceptionally truthful.** Every load-bearing number I was assigned to
check — dataset shape, splits, feature count, champion metrics, threshold, clustering,
bootstrap CI, versions, demo walkthrough values, API examples, docker sizes/ports, test
counts — **reproduced exactly**, most to full float precision by independent recomputation
or live re-request. Zero fabricated or materially wrong claims found.

Findings are all **P3** (staleness/cosmetic): two stale timestamps quoted in `docs/API.md`
(artifacts were regenerated after the capture), one report quoting classification metrics
without the SIMULATED label, three stale cross-reference/advice lines, one API.md defaults
table nuance. No P0/P1/P2.

---

## Master claims table

Verdicts: **MATCH** (verified) / **STALE** (was true, drifted) / **MISMATCH** (wrong).
Evidence pointers: E1=data, E2=artifacts, E3=recompute, E4=live-api, E5=geo, E6=paths,
E7=pytest, E8=misc (all `docs/audit/evidence/docs-truth-*.txt`).

### A. Assigned minimum claims

| # | Claim (quote — file:line) | Verified value | Verdict |
|---|---|---|---|
| A1 | "1460 labeled rows" — README.md:87, :118; METHODOLOGY.md:13; data/README.md:34 | raw `train.csv` = **1460 × 81** (E1) | **MATCH — verified by execution** |
| A2 | "train 945 / val 338 / test 175" — README.md:89, :162-164; SPEC §14; METHODOLOGY.md:19-23 | processed CSVs: **945/338/175 rows**, YrSold 2006-08/2009/2010, 85 cols, **0 NaNs** (E1) | **MATCH — verified by execution** |
| A3 | "94 model features" — README.md:90, :186; API.md:158, :181, :224 | `feature_list.json` len = **94**; live `/model/info` `n_features: 94` (E2, E4) | **MATCH — verified by execution** |
| A4 | "25 neighborhoods" — README.md:9, :133; GEOGRAPHY.md:9; API.md:476-480 | raw + processed `Neighborhood`.nunique() = **25**; live `/market/clusters` carries 25 points; live 422 lists the same 25 codes (E1, E4, E5) | **MATCH — verified by execution** |
| A5 | "4 micro-markets … plus 3 noise neighborhoods (CollgCr, NAmes, Timber — 12%)" — README.md:234-239 | `cluster_stats.json` n_clusters=**4** (14+2+4+2=22 neighborhoods); live API: exactly 3 `fallback: true` = CollgCr/NAmes/Timber; 3/25 = 12% (E2, E4) | **MATCH — verified by execution** |
| A6 | "eps=1.317, min_samples=2 … k-distance knee" — README.md:234; API.md:282; GEOGRAPHY.md:45 | `cluster_stats.json` eps = **1.3170045189879962**, min_samples 2; MLflow `eps_selection_trace.json` knee: min_samples=2 → eps 1.317005 → 4 clusters/3 noise; min_samples=3 → eps **1.518148** → 1 cluster (rejected); 39 candidates — all as METHODOLOGY.md:161-166 claims (E2) | **MATCH — statically verified + artifact** |
| A7 | "ridge val RMSLE 0.1354 / test R² 0.9305 / MAE $15,075 / RMSLE 0.1187" — README.md:211-212; FINAL-RELEASE.md:24; MODEL_EVALUATION.md:88-91 | recomputed from `regression_champion.joblib` on processed splits: val RMSLE **0.135437**, test R² **0.93048**, MAE **15075.47**, RMSLE **0.118689** (E3) | **MATCH — verified by execution (recomputed)** |
| A8 | "RF test ROC-AUC 0.7666 / PR-AUC 0.5674 / Brier 0.1710 / F1 0.5063" — README.md:227; MODEL_EVALUATION.md:98 | recomputed from `classification_champion.joblib`: **0.766602 / 0.567363 / 0.171026 / 0.506329**; confusion TP40/FP69/FN9/TN57 exactly as MODEL_EVALUATION.md:100-101 (E3) | **MATCH — verified by execution (recomputed)** |
| A9 | "threshold 0.203292" — API.md:150, :325, :364; SPEC §14; README.md:71 (0.2033) | `champion.json` `classification.threshold` = **0.203292**; live `/predict` echoes 0.203292 (E2, E4) | **MATCH — verified by execution** |
| A10 | "162 passed, 0 failed" — README.md:28, :80, :351, :357; FINAL-RELEASE.md:17 | my run: `162 passed, 4 warnings in 31.25s` (E7). README's "~30 s" consistent; FINAL-RELEASE's "22.6s" lead-run time plausible (machine-dependent) | **MATCH — verified by execution** |
| A11 | "E2E 5/5 … Playwright 1.62.1 (Chromium)" — README.md:30, :361-363; FINAL-RELEASE.md:19; E2E.md | `e2e/tests/dashboard.spec.js` contains exactly **5 tests** matching the 5 documented scenarios; installed `@playwright/test` = **1.62.1**; screenshots present (1440-wide full-page PNGs); E2E-observed UI values independently reproduced via API (see C5) (E6, E8, E4) | **MATCH — statically verified + API cross-check** (full browser re-run belongs to blackbox-e2e agent) |
| A12 | "warm /predict p50 ≈ 197 ms; first call ≈ 0.5 s" — README.md:31, :316-319; API.md:24-26; DEPLOYMENT.md:57; DEMO.md:21 | PERFORMANCE.md after-fix raw log: `p50=197.46 ms`, cold `514.7 ms` — doc quotes match the report exactly. Not re-measured by me (performance agent's scope; ambient audit load would skew it) | **MATCH — statically verified against report's pasted output** |
| A13 | "SHAP warm ~50 ms" (METHODOLOGY.md:199 says "~55 ms") | PERFORMANCE.md profiles: warm `shap_explain` mean 44.4 ms (pre-fix), 33–38 ms (post-fix). "~50 ms"/"~55 ms" same order; slightly above measured | **MATCH (approximate)** — note: measured p50 33–44 ms |
| A14 | "backend 1.77 GB, frontend 93.9 MB" — README.md:29, :331-333; FINAL-RELEASE.md:20; docker/README.md:7-11 | live `docker images`: `proppulse-backend 1.77GB`, `proppulse-frontend 93.9MB`, mlflow 1.64GB (E8) | **MATCH — verified by execution** |
| A15 | "override ports 18000/18080/15000" — README.md:29, :338-341; DOCKER_SMOKE.md §1 | `docker-compose.override.yml`: `!override` ports 18000:8000 / 18080:80 / 15000:5000 + VITE_API_URL/CORS_ORIGINS rewired; `docker compose config -q` VALID with and without override (E8) | **MATCH — verified by execution** |
| A16 | "bootstrap 95% CI [−0.0133, +0.0060]" — README.md:215-216; METHODOLOGY.md:132-134; MODEL_EVALUATION.md:70-72 | `champion.json` ci95 = **[−0.013336, 0.005985]**, observed diff −0.004341, P(runner-up better) 0.1925, n=2000, seed 42, significant=false (E2) | **MATCH — statically verified (artifact)** |
| A17 | "feature_version 9b0f8ba4201c" — API.md:157; METHODOLOGY.md:8; REPRODUCIBILITY.md:23 | recomputed `sha1(feature_list.json)[:12]` = **9b0f8ba4201c**; matches champion.json + feature_importance.json + live API (E2, E4) | **MATCH — verified by execution** |
| A18 | "dataset_version ames-1.0" — API.md:156; METHODOLOGY.md:8 | `champion.json` + `data/processed/schema.json` both `ames-1.0` (E2, E1) | **MATCH — statically verified** |
| A19 | SHAP top order "OverallQual (0.057), OverallCond (0.040), total_sf (0.030), GrLivArea (0.026), 1stFlrSF, TotalBsmtSF" — README.md:249-250; API.md:216-219; METHODOLOGY.md:193-195 | artifact top-6: **OverallQual 0.057375, OverallCond 0.040484, total_sf 0.030004, GrLivArea 0.026005, 1stFlrSF 0.021389, TotalBsmtSF 0.021171** (sorted desc, 94 entries); live `/model/importance` identical (E2, E4) | **MATCH — verified by execution** |
| A20 | "No prediction data is hardcoded — every number comes from the live API" — README.md:279; frontend/README.md:17; DEMO.md:5-6 | grep of `frontend/src/` for every documented prediction value (250967, 236950, 204881, 151147, 137105, probabilities): **zero hits**; only destructuring of API responses + `fetch` via `VITE_API_URL` (E8) | **MATCH — statically verified** |
| A21 | DEMO.md walkthrough numbers — "$250,968 … $217,972 – $282,014 … ≈ 29.2% … 20.3% threshold … mid northwest … OverallQual, GrLivArea, total_sf, neighborhood_median_price, neighborhood_mean_price" (DEMO.md:49-56) | live re-run of the exact DEMO payload on :8380: **250967.50**, range **217972.48–282014.33**, probability **0.291813** @ 0.203292 (sells=true), cluster 0 "mid northwest" fallback=false, factors in the **exact documented order, all positive** (E4) | **MATCH — verified by execution (live re-run)**. ⤷ **Superseded 2026-08-08:** these pre-clamp values were changed by the wave-10 serving calendar clamp; current values in `FINAL-RELEASE.md` v1.1.0 |
| A22 | "every command in README/DEPLOYMENT exists" | all 9 `ml.*` CLIs import with `main()`; `drift_check --window/--log` args exist; `scripts/load_test.py` has all 9 documented flags; npm scripts dev/build/preview/lint exist; `pytest tests -m integration` collects 8/127; compose files validate (E8) | **MATCH — verified by execution** |
| A23 | "every link/path referenced exists on disk" | 84 referenced paths checked (docs, reports, screenshots, figures, models, data, scripts, CI, docker, frontend sources): **0 missing**; `data/external/property_geo.csv` and `days_on_market.csv` correctly **absent** as documented (E6) | **MATCH — verified by execution** |
| A24 | "SIMULATED-target caveat in every doc quoting classification metrics" | present in README.md (×4), FINAL-RELEASE.md (×3, incl. inline "(simulated target — see §4)" at L24), MODEL_EVALUATION.md (×4, header + §7), API.md (×6), DEMO.md (L110), METHODOLOGY.md (×3), EDA_REPORT.md (×7), data/README.md, backend/README.md, SPEC. **Exception: reports/REPRODUCIBILITY.md (0 mentions) quotes calibrated RF ROC-AUC/PR-AUC/Brier at L60-63, L75-76, L145** → finding F3 (E8) | **MISMATCH (1 file) — see F3** |

### B. Regression/classification detail claims (spot-verified by recomputation, E3)

| Claim | Where | Verified | Verdict |
|---|---|---|---|
| ridge val $14,527 / $21,673 / 0.9280 / 0.1354 | README.md:211; MODEL_EVALUATION.md:46 | 14526.57 / 21672.72 / 0.927982 / 0.135437 | **MATCH (recomputed)** |
| xgboost val RMSLE 0.1398 (runner-up) | README.md:214; MODEL_EVALUATION.md:47 | 0.139777 | **MATCH (recomputed)** |
| "On the sealed test split XGBoost actually posts the lower RMSLE, 0.1051" | README.md:219-220; METHODOLOGY.md:137-138; FINAL-RELEASE.md:64-65; MODEL_EVALUATION.md:113 | recomputed xgboost test: RMSLE **0.105059**, R² 0.94461, MAE $12,929, RMSE $18,880 — exactly §5's row | **MATCH (recomputed)** |
| RF val 0.7218/0.5250/0.5455/0.4091/0.8182/0.1856 | README.md:226; MODEL_EVALUATION.md:76-82, :97 | recomputed: 0.721778/0.525013/0.545455/0.409091/0.818182/0.18555, confusion 81/117/18/122 | **MATCH (recomputed)** |
| "at 0.5 … recall 0.08 instead of 0.82" | README.md:178; DEMO.md:109 | metrics.json val_calibrated recall@0.5 = 0.0808; recall@0.203292 = 0.8182 | **MATCH** |
| interval "q_low = −0.140954, q_high = 0.116634 … coverage 78.3%" | API.md:361-362; README.md:68-69; METHODOLOGY.md:149-151; MODEL_EVALUATION.md:142-147 | recomputed val residual Q10/Q90 = **−0.140954 / 0.116634**; test coverage = **0.782857** | **MATCH (recomputed)** |
| champions ridge + calibrated RF (`CalibratedClassifierCV`) | SPEC §14:284-285; README.md:207, :222 | joblib inspection: ridge Pipeline (alpha 100.0), `CalibratedClassifierCV` (E2, E8) | **MATCH** |
| "ridge shipped alpha=100 although the grid best was 31.6" | README.md:173-174; METHODOLOGY.md:92-93; MODEL_EVALUATION.md:23-24 | champion alpha = 100.0 (artifact + MLflow param); grid = logspace(−3,3,13) which contains 31.62; one-SE rule implemented (`one_se_alpha`, train_regression.py:107) | **MATCH (artifact-consistent)** |
| "RandomizedSearchCV n_iter=8", 5-fold CV seed 42 | README.md:174; METHODOLOGY.md:87-101 | `N_ITER_TREE_SEARCH = 8` (train_regression.py:78); `KFold(5, shuffle, 42)` / `StratifiedKFold(5, shuffle, 42)` (E8) | **MATCH — statically verified** |
| "~21 KB vs ~25 MB" artifact sizes | README.md:217; MODEL_EVALUATION.md:129 | ridge champion 21,490 B (**21.0 KiB**); regression RF 24.0 MiB ≈ 25 MB; cls champion 13.95 MiB ≈ PERFORMANCE's "14.6 MB" (decimal) | **MATCH** |

### C. Live API claims (all re-fetched on port 8380, E4)

| Claim | Where | Verified | Verdict |
|---|---|---|---|
| StoneBr `/predict` full response (204881.59, 177945.52/230227.22, 0.408609, factors+ magnitudes, model_version) | API.md:316-353 | **byte-identical values** incl. all 5 factor magnitudes | **MATCH (live)** |
| `/predict/price` NAmes → 137105.86 / 119080.32 / 154067.09 | API.md:391-401 | exact | **MATCH (live)** |
| `/predict/sale-probability` NAmes → 0.319553, true, 0.203292 | API.md:420-431 | exact | **MATCH (live)** |
| `/model/info` block mirrors champion.json | API.md:134-178 | live response == champion.json for every substantive field; **quoted `selected_at` is stale** (F1) | **MATCH except F1** |
| `/model/importance` top-4 + metadata | API.md:197-222 | values exact; **quoted `generated_at` stale** (F2) | **MATCH except F2** |
| `/market/clusters` (n_clusters 4, 25 points, cluster-0 stats, centroid, velocity, note; Blmngtn/Blueste points) | API.md:252-275 | exact; 3 fallback flags on CollgCr/NAmes/Timber | **MATCH (live)** |
| 422 unknown neighborhood message | API.md:531-543 | live message identical format/content | **MATCH (live)** |
| 422 `bedrooms=99` → "Input should be less than or equal to 8" | API.md:545-558 | identical | **MATCH (live)** |
| CORS: :8080 + :5173 allowed, preview :4173 rejected (400, no ACAO) | API.md:590-594; DEPLOYMENT.md:58-61; frontend/README.md:55-58 | preflight :8080 → 200 ACAO; :5173 → 200; :4173 → **400, no ACAO** | **MATCH (live)** |
| 64 KiB body limit → 413 | SECURITY.md:105, :119; backend/README.md:52-53 | 70 KB body → 413 `Request body too large; limit is 65536 bytes` | **MATCH (live)** |
| FINAL-RELEASE lead smoke "$248,220.67, range [$215,587–$278,928], p=0.321 @0.2033, mid northwest, 5 factors" | FINAL-RELEASE.md:18 | payload recovered from `logs/predictions.jsonl` line 9 (DEMO payload but `total_bsmt_sf=1200`); re-run: **248220.67, 215586.79–278927.70, 0.321438**, 5 factors | **MATCH (live re-run)** |
| E2E observed UI values "$236,950, $205,798–$266,263, 31.8%" | E2E.md:62-66 | re-ran the exact `fillValuationForm` payload: **236950.33, 205798.17–266263.13, 0.31783** | **MATCH (live re-run)** |
| PERFORMANCE load payload → "served price ≈ $151,148" / 0.216313 | PERFORMANCE.md:31, :218-219 | live: **151147.74 / 0.216313** | **MATCH (live)** |
| `/health` shape | API.md:54-62; DEPLOYMENT.md:85 | `{"status":"ok","models_loaded":{...}}` | **MATCH (live)** |

### D. Dataset / geography / EDA claims (E1, E5)

| Claim | Where | Verified | Verdict |
|---|---|---|---|
| test.csv 1459×80 no SalePrice; sample_submission 1459×2 | data/README.md:35-36; SPEC §2 | 1459×80 (no SalePrice), 1459×2 | **MATCH** |
| train median $164,990, mean $182,125, range $35,311–$755,000; skew 1.967→0.175 | README.md:123-125; EDA_REPORT.md:19-21 | 164990 / 182125.13 / 35311–755000 / 1.967→0.175 (kurt 7.55→0.82) | **MATCH (recomputed)** |
| fast-sale rate ≈25.3% (239/945) | METHODOLOGY.md:77-78; EDA_REPORT.md:26, :89; SPEC §14 | 0.2529 (239/945) | **MATCH** |
| LotFrontage 17.7% missing; 19/81 raw cols with NA | METHODOLOGY.md:36-37; EDA_REPORT.md:30, :114 | 0.1774; 19 cols | **MATCH** |
| outliers: Ids 524 & 1299 removed, 947→945, both Partial/Edwards; 39 rows above IQR fence kept | METHODOLOGY.md:39-43; EDA_REPORT.md:28-29, :119 | outliers_report.json + raw rows confirm (4676 sqft $184,750; 5642 sqft $160,000); fence $341,750, 39 rows (4.1%) | **MATCH** |
| DOM median 41 d, IQR 30–54, max 141, skew 1.26 | EDA_REPORT.md:27, :89 | 41 / 30–54 / 141 / 1.26 | **MATCH** |
| neighborhood median spread 3.18× (NridgHt $318,000 vs BrDale $100,000); Blueste n=1, NPkVill n=3, MeadowV n=9 | EDA_REPORT.md:25, :82; METHODOLOGY.md:233-234 | 3.18×, exact medians, exact n's | **MATCH** |
| peak July 167 sales / trough Feb 27; 2006→2008 median +0.6% | EDA_REPORT.md:31; METHODOLOGY.md:28-30 | Jul 167 / Feb 27 / +0.6% | **MATCH** |
| OverallQual r=0.789 (Spearman 0.795); GrLivArea 0.752; $/sqft 121.13/120.58 | EDA_REPORT.md:23-24, :45 | 0.789 / 0.795 / 0.752 / 121.13 / 120.58 | **MATCH** |
| geo: 25 unique points; span lat 41.9920–42.0627, long −93.6868…−93.6033; bbox; downtown distance 0.50–5.79 km; NN median 0.76 / min 0.13 (MeadowV/Mitchel) / max 1.62 km; IDOTRR "less representative" | GEOGRAPHY.md:24-32, :60-61, :76 | recomputed from `neighborhood_geo.csv` — all exact, incl. the MeadowV/Mitchel pair and the IDOTRR note | **MATCH (recomputed)** |
| leakage exclusions: no SaleType/SaleCondition/Id/DOM/price_per_sqft in features | README.md:166-170; METHODOLOGY.md:60-64 | none present in `feature_list.json`; decomposition 79 raw + 11 engineered + 4 stats = 94 ✓ | **MATCH** |
| "None" literal tokens, zero NaN, `keep_default_na=False` convention | SPEC §14; data/README.md:42-44 | 0 NaNs; "None" tokens present; raw spellings `C (all)`, `2fmCon`… confirmed | **MATCH** |

### E. Process/infra claims (E6, E7, E8)

| Claim | Where | Verified | Verdict |
|---|---|---|---|
| pytest.ini `pythonpath=.` + integration marker | README.md:355-356; SPEC §11 | pytest.ini:1-5 exact; `-m integration` collects 8/127 | **MATCH** |
| CI: 3 jobs (python 3.12 / frontend Node 24 / docker `config -q`) | README.md:385-389; DEPLOYMENT.md:139-147 | ci.yml matches exactly (incl. `npm ci` guard, `cp .env.example .env`) | **MATCH** |
| `.env.example` keys incl. CORS_ORIGINS + MLFLOW_ALLOW_FILE_STORE | DEPLOYMENT.md:19-31; SPEC §12/§14 | all 11 keys present (lines 5-36) | **MATCH** |
| SPEC §14 pins (pandas 2.3.3, numpy 2.4.6, sklearn 1.9.0, xgboost 3.4.0, shap 0.52.0, mlflow 3.15.1, fastapi 0.141.1, pydantic 2.13.4, pytest 9.1.1) | SPEC §14:261-263 | installed versions identical, all 9 | **MATCH** |
| processed md5s (reproducibility) | REPRODUCIBILITY.md:40-43 | my md5sum identical for all 5 files | **MATCH** |
| docker base ports 8000/8080/5000 + mlflow profile | README.md:325-327; DEPLOYMENT.md:72-80 | compose file lines 26/60/78; `config -q` valid both ways | **MATCH** |
| `.dockerignore` SHAP-background fix (`!data/processed/train.csv`, 334 KB) | DOCKER_SMOKE.md:73-93; docker/README.md:13-17, :139-141 | `.dockerignore:32` un-exclusion present; train.csv = 334,104 B | **MATCH** |
| screenshots exist, 1440×900 viewport | README.md:37-62; E2E.md:68-81 | 5 PNGs exist, all 1440 wide (full-page heights >900 as expected for stitched capture) | **MATCH** |
| "20-bar SHAP importance chart" | README.md:52; DEMO.md:87 | `ModelInsights.jsx:97` `.slice(0, 20)` | **MATCH** |
| root-level routes (no /api/v1) | SPEC §14:280; API.md:4-6; backend/README.md:21-22 | all 8 endpoints live at root on :8380 | **MATCH (live)** |
| ADR-6 (pandas 2.3.3 resolution), ADR-7 (daemon now running, superseded) | DECISIONS.md:49-66 | installed pandas 2.3.3; docker daemon live | **MATCH** |

---

## Findings

### F1 — P3 · STALE · `docs/API.md:155` quotes a superseded `selected_at`
Quoted `/model/info` response: `"selected_at": "2026-08-07T07:09:17.453829+00:00"`.
Current `models/champion.json:82` (and live `/model/info`, E4): `2026-08-07T10:38:48.406646+00:00`.
The artifact was regenerated after the doc capture (same wave-9 morning; all metric values
identical). API.md:134-135 claims the blocks "mirror models/champion.json verbatim" — true
today except for this quoted timestamp.
**Edit:** API.md:155 `2026-08-07T07:09:17.453829+00:00` → `2026-08-07T10:38:48.406646+00:00`.

### F2 — P3 · STALE · `docs/API.md:212` quotes a superseded `generated_at`
Quoted `/model/importance` metadata: `"generated_at": "2026-08-07T08:36:26.239112+00:00"`.
Current `models/explainability/feature_importance.json` (and live endpoint, E4):
`2026-08-07T10:39:02.217783+00:00`. All importance values match exactly.
**Edit:** API.md:212 `2026-08-07T08:36:26.239112+00:00` → `2026-08-07T10:39:02.217783+00:00`.

### F3 — P3 · MISMATCH (project labeling rule) · `reports/REPRODUCIBILITY.md` quotes classification metrics without the SIMULATED label
The file quotes calibrated-RF classification metrics (ROC-AUC/PR-AUC/Brier) at L60-63
(retrain log), L75-76, L98, L145, with **zero** SIMULATED mentions (E8). The project's own
mandate (SPEC §2 fallback 2: *'Clearly labelled "SIMULATED TARGET — classification metrics
are not real-world performance claims"'*) is honored by every other metric-quoting document
(README, FINAL-RELEASE, MODEL_EVALUATION, API, DEMO, METHODOLOGY, EDA — all verified, A24).
Context mitigates (the numbers appear as retrain-comparison evidence, not performance
claims), hence P3 not P2.
**Edit:** add the standard caveat to the header block of `reports/REPRODUCIBILITY.md`
(after L3), e.g. `**SIMULATED TARGET (ADR-3): classification metrics below measure
reproducibility against the documented DOM simulation, not real-world sale-speed
performance.**`

### F4 — P3 · STALE · `reports/PERFORMANCE.md:313-315` doc-note overtaken by the fix
"Doc note for the docs owner: docs/API.md:188-189 still says /model/importance reads the
artifact 'on every request' — stale since wave 9b". Current API.md:187-191 already documents
the startup cache ("built once at startup … cached in app.state (wave-9b) — a restart is
required"); grep for "every request" in API.md → no hit. The requested fix has landed, so
the note now misdescribes the current state. (Was accurate when written; historical report.)
**Edit (optional):** append "(resolved — API.md updated)" to PERFORMANCE.md:313-315.

### F5 — P3 · STALE · `docker/README.md:130-132` lockfile advice
"npm ci when frontend/package-lock.json exists (reproducible), otherwise npm install.
**Commit the lock file once the frontend stabilizes.**" — `frontend/package-lock.json` is
present in the repo (verified, E6), and CI/Dockerfile already take the `npm ci` branch.
The trailing advice is stale.
**Edit:** docker/README.md:131-132 — drop or reword the "Commit the lock file…" sentence
(e.g. "the committed lock file makes npm ci the default path").

### F6 — P3 · MISMATCH (nuance) · `docs/API.md:470-473` defaults table vs serving behavior
Table lists `pool_area / wood_deck_sf / open_porch_sf / screen_porch` with "Default `0`".
That is the *pydantic schema* default (`backend/app/schemas/property.py:90-92`), but
`PropertyInput.to_serving_payload()` uses `exclude_unset=True`, so an omitted field never
materializes the 0 — the model input falls back to train medians/modes from
`ml.features.defaults.FEATURE_DEFAULTS` (== `models/feature_defaults.json` "defaults"
block, 79/79 keys identical). Measured live (E4 + probe): DEMO payload with
`open_porch_sf` **omitted** → OpenPorchSF=27, price 250,967.50 (the documented DEMO
number); with explicit `open_porch_sf: 0` → 247,772.13. So "Default 0" is dead-letter for
omitted fields; the API.md prose at L441-443 ("Omitted optional fields fall back to
feature_defaults.json") is the correct statement and contradicts the table. SPEC §8:187
carries the same "(default 0)" simplification. Note the frontend omits empty advanced
fields (`constants.js` header comment), so UI users get the FEATURE_DEFAULTS path and the
DEMO numbers — docs and UI are self-consistent; only a direct-API reader of the table
would be misled. Related: "an explicit null is treated as omitted" (API.md:442-443) holds
only for the `| null` fields; for the four `int` porch/pool fields an explicit null → 422
(verified live) — consistent with the table's typing, but the blanket sentence overstates.
**Edit:** API.md:470-473 — change Default column for the four fields from `0` to
`0 if sent empty-form; omitted → feature_defaults.json (train median, e.g. OpenPorchSF 27)`,
or add one clarifying line under the table. Optionally qualify L443 to "an explicit null
is treated as omitted for the nullable (`| null`) fields".

### F7 — P3 (informational) · `docs/AGENT_STATUS.md:24` historical "114 tests green"
Wave-8 verdict line; the same file self-supersedes at L42 ("Lead final run: 162 tests
passed"). It is a dated log, so no edit strictly required — flagged only so the
orchestrator's consistency pass does not treat 114 as current.

### F8 — P3 (cross-agent note, not a doc defect) · prediction-log payload fidelity
`backend/app/api/predict.py:45` logs `model_dump(mode="json", exclude_none=True)` — i.e.
the *validated input including schema defaults* (`open_porch_sf: 0`) — while the model
actually consumed `to_serving_payload()` (unset → FEATURE_DEFAULTS, OpenPorchSF=27).
So `logs/predictions.jsonl` payload rows can disagree with the logged `features` rows
(observed on the lead's line-9 smoke; another auditor's replay flagged it). SPEC §10's
binding schema ("payload: {<PropertyInput fields>}") is ambiguous enough that the docs
are not wrong, but the orchestrator should decide whether the log should record the
serving-resolved payload instead. Impact: replay/audit tooling only.

---

## Needed edits (centralized fix list; file:line, old → new)

1. `docs/API.md:155` — `"selected_at": "2026-08-07T07:09:17.453829+00:00"` → `"selected_at": "2026-08-07T10:38:48.406646+00:00"` (F1)
2. `docs/API.md:212` — `"generated_at": "2026-08-07T08:36:26.239112+00:00"` → `"generated_at": "2026-08-07T10:39:02.217783+00:00"` (F2)
3. `reports/REPRODUCIBILITY.md` after L3 — add the SIMULATED-target caveat line (F3)
4. `reports/PERFORMANCE.md:313-315` — mark the doc-note resolved (F4, optional)
5. `docker/README.md:131-132` — remove/reword "Commit the lock file once the frontend stabilizes" (F5)
6. `docs/API.md:470-473` (+ optionally L443) — clarify porch/pool "Default 0" vs FEATURE_DEFAULTS fallback (F6); mirror note in `docs/PROJECT_SPEC.md` §8 L187 if the spec table is ever revised

No other edits needed. Every other checked claim is MATCH.

---

## Coverage summary

**Files audited (19):** README.md, FINAL-RELEASE.md, docs/API.md, docs/METHODOLOGY.md,
docs/DEPLOYMENT.md, docs/ARCHITECTURE.md, docs/DECISIONS.md, docs/GEOGRAPHY.md,
docs/DEMO.md, docs/AGENT_STATUS.md (spot), docs/PROJECT_SPEC.md (§14 in full, §1/§2/§8
cross-checks), data/README.md, docker/README.md, frontend/README.md, backend/README.md,
reports/MODEL_EVALUATION.md, reports/PERFORMANCE.md, reports/DOCKER_SMOKE.md,
reports/E2E.md, reports/REPRODUCIBILITY.md, reports/SECURITY.md, reports/EDA_REPORT.md.

**Verified by execution:** full pytest suite (162 passed); live API on :8380 (all 8 GET/POST
routes, 5 documented payloads byte-exact, 2×422, CORS ×3, 413, /metrics); independent
metric recomputation from committed champions on val+test (regression ×2 models,
classification champion, interval quantiles/coverage); dataset recomputation (shapes,
splits, NaN, EDA statistics, geo distances); sha1/md5 recomputation (feature_version,
5 processed files); docker images + compose validation; CLI/module existence (9 CLIs,
npm scripts, load_test flags); 84-path existence sweep.

**Verified statically:** CI workflow, .env.example keys, pytest.ini, training code
(CV/alpha/n_iter), serving mapping, frontend stack + no-hardcoded-predictions, SPEC §14
pins vs installed, e2e spec structure, ADR consistency.

**Not re-executed (other agents' scopes, claims cross-checked for consistency only):**
full browser Playwright run (blackbox-e2e), latency re-measurement (performance),
pip-audit/npm-audit (security), full retrain determinism (reproducibility script itself —
but its pasted md5/sha1 outputs were independently recomputed and match).

## Contradictions the orchestrator must reconcile

1. **Serving-default semantics (F6/F8):** API.md table says porch/pool "Default 0";
behavior for omitted fields is train-median fallback (OpenPorchSF=27) via FEATURE_DEFAULTS,
and the prediction log records the schema default rather than the served value. Docs,
schema, log, and behavior each tell a slightly different story — decide the canonical
statement and align API.md (+ optionally the log payload). This also explains the
replay mismatch another auditor flagged on `logs/predictions.jsonl` line 9.
2. **Artifact regeneration timestamps (F1/F2):** `champion.json.selected_at` /
`feature_importance.json.generated_at` (10:38–10:39) postdate the API.md captures
(07:09/08:36) and DOCKER_SMOKE's run — consistent with the reproducibility audit's
retrain-and-restore cycle. No value drift; only the two quoted timestamps are stale.
3. **REPRODUCIBILITY.md (F3)** is the lone file breaking the SIMULATED-labeling mandate.
4. **AGENT_STATUS.md (F7)** carries wave-8's "114 tests" verdict; current truth is 162
(my run) — ensure FINDINGS.md quotes 162, not 114.
