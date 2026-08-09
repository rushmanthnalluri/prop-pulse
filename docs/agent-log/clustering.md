# Agent Log — clustering

**Scope owned:** `ml/clustering/`, `models/clustering/`, `figures/cluster_map.png`,
`figures/cluster_price_distribution.png`, `figures/cluster_kdistance.png`,
`tests/ml/test_clustering.py`. Status: **DONE** (2026-08-07).

## What was built (ADR-9)

Micro-market discovery over the 25 Ames neighborhoods with DBSCAN.

- `ml/clustering/dataset.py` — builds the 25-row neighborhood matrix
  `[lat, long, median_price_per_sqft, monthly_sale_velocity]`: approximate
  centroids from `data/external/neighborhood_geo.csv` (ADR-2) joined with
  **train-split-only** market stats from `models/neighborhood_stats.json`
  (leakage rules honored — no val/test data anywhere in this scope).
- `ml/clustering/train.py` — CLI `python -m ml.clustering.train`. StandardScaler
  → DBSCAN; eps selected by the k-distance knee heuristic (k = min_samples,
  knee = max perpendicular distance to the curve's chord on normalized axes);
  enriches clusters with TRAIN descriptive stats; writes artifacts, figures,
  and one MLflow run (experiment `clustering`).
- `ml/clustering/serve.py` — `MicroMarketLookup.lookup(neighborhood)`:
  clustered neighborhoods → their cluster (`fallback: false`); noise or
  never-seen neighborhoods → nearest cluster centroid in **scaled** feature
  space (unknown areas use downtown Ames + global train fallback stats) with
  `fallback: true` and the cluster's `label` unchanged, per ADR-9.
- `tests/ml/test_clustering.py` — 9 tests, all green.

## eps / min_samples selection (audited, reproducible)

Both knee candidates were evaluated; the full 39-candidate trace is logged to
MLflow (`eps_selection_trace.json`) and printed by the CLI:

| candidate | eps | clusters | noise | verdict |
|---|---|---|---|---|
| knee, min_samples=2 | 1.3170 | 4 | 3 | **accepted** (3–10 clusters) |
| knee, min_samples=3 | 1.5181 | 1 | 4 | degenerate — rejected |

The k=2 knee was valid, so no grid refinement was needed (the fallback rule —
min noise among valid rungs, closest to knee — is implemented and documented in
`ml/clustering/train.py`). Noise = 3/25 (12%): **CollgCr, NAmes, Timber** —
isolated by atypical sale velocity (CollgCr 2.72, NAmes 4.08 sales/month vs
~1.0 typical) and/or location (Timber: high-priced far-south). Handled at
serving by nearest-centroid fallback. A finer eps does not exist that keeps
3–10 clusters with less noise on this 25-point matrix (verified by the rung
sweep: next valid rung eps=1.484 gives 3 clusters/2 noise but collapses 19/25
neighborhoods into one blob — the knee result is the better micro-market grain).

## Result — 4 micro-markets (train split, YrSold ≤ 2008)

| cluster | label | neighborhoods | n_sales | median_price | med_$/sqft | sale_velocity_30d* |
|---|---|---|---|---|---|---|
| 0 | mid northwest | 14 (Blmngtn, BrDale, BrkSide, Crawfor, Gilbert, IDOTRR, NPkVill, NWAmes, NoRidge, NridgHt, OldTown, Somerst, StoneBr, Veenker) | 461 | $179,900 | $119.39 | 0.278 |
| 1 | affordable southwest | 2 (Blueste, SWISU) | 15 | $140,000 | $80.58 | 0.267 |
| 2 | mid west | 4 (ClearCr, Edwards, Sawyer, SawyerW) | 158 | $144,000 | $113.85 | 0.196 |
| 3 | mid southeast | 2 (MeadowV, Mitchel) | 41 | $138,000 | $128.57 | 0.220 |

\* `sale_velocity_30d` = fraction of the cluster's train sales with
`sells_within_30_days == 1` — DESCRIPTIVE over the **SIMULATED** target
(ADR-3), stated in every cluster's `note` field; never a model input.

Labels = price tier (premium/mid/affordable from tertiles of the 25
neighborhoods' train median $/sqft: ~$112.9 / ~$133.1) + compass direction of
the cluster centroid vs downtown Ames (42.0347, -93.6199; ~1 km thresholds).

## Artifacts

- `models/clustering/dbscan.joblib` (eps=1.3170045, min_samples=2),
  `dbscan_scaler.joblib`, `cluster_stats.json` (schema exactly per SPEC §6:
  per-cluster keys + global `n_clusters`/`eps`/`min_samples`/`feature_names`),
  `cluster_assignments.csv` (all 25 rows, noise = -1).
- Figures: `figures/cluster_kdistance.png` (both k curves, knees, chosen eps),
  `figures/cluster_map.png` (centroids colored by cluster, annotated, noise as
  ×, downtown marker, cluster colors consistent with the boxplot),
  `figures/cluster_price_distribution.png` (train SalePrice boxplots,
  price-ordered, noise group shown).
- MLflow: experiment `clustering`, run `dbscan_v1` — params (eps, min_samples,
  scaler, features, tier bounds), metrics (n_clusters=4, n_noise=3,
  noise_fraction=0.12), tags (`dataset_version=ames-1.0`,
  `feature_version=9b0f8ba4201c`), artifacts `cluster_stats.json` +
  `eps_selection_trace.json`.

## Environment note for other agents

MLflow 3.15.1 refuses the `./mlruns` filesystem backend unless
`MLFLOW_ALLOW_FILE_STORE=true` is set. `ml/clustering/train.py` does
`os.environ.setdefault("MLFLOW_ALLOW_FILE_STORE", "true")` before mlflow is
lazily imported — same pattern as `ml/training/train_classification.py`.
The MLflow logging block also retries once after 30 s (shared file store).

## Verification

- `python -m ml.clustering.train` — deterministic across 3 runs (identical
  labels/artifacts; DBSCAN + StandardScaler + knee are all deterministic).
- `.venv/Scripts/python.exe -m pytest tests/ml/test_clustering.py -q` →
  **9 passed**. Full `tests/ml` directory: **21 passed** (incl. regression +
  classification scopes).
- Tests cover: artifacts/figures exist, matrix shape (25 × ADR-9 features),
  assignments cover all 25 neighborhoods, cluster_stats ↔ assignments
  consistency + 3–10 cluster contract, persisted model reproduces
  `cluster_assignments.csv` exactly, `lookup('CollgCr')` valid payload (it is a
  noise point → served via fallback to cluster 2 "mid west"),
  `lookup('NoSuchPlace')` → `fallback=true`, noise neighborhoods →
  `fallback=true`, direct hit (`StoneBr` → cluster 0, `fallback=false`).

## Known limitations / handoff notes

- Cluster 0 is a coarse 14-neighborhood north/central blob (461 sales):
  density-based clustering at 25 points cannot split the contiguous north
  premium belt from the central mid tier. This is expected at the ADR-9 grain;
  per-neighborhood medians in `models/neighborhood_stats.json` remain the
  fine-grained signal.
- `data/processed/test.csv` was never read (sealed until evaluation wave).
- No champion selection performed — `models/registry/` / `champion.json` left
  to the evaluation agent.
- Backend `/market/clusters` can consume `cluster_stats.json` +
  `cluster_assignments.csv` directly, or use
  `ml.clustering.serve.MicroMarketLookup` (`lookup`, `clusters`, `assignments`).
