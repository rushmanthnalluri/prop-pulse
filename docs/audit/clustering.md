# Forensic Audit — clustering (mission §10: clustering / geospatial)

**Agent:** clustering · **Date:** 2026-08-07 · **Mode:** report-only, verify-by-execution
**Scope:** `ml/clustering/*`, `models/clustering/*`, geo data path (`data/external/neighborhood_geo.csv`, `data/processed/*.csv` lat/long grain, `property_geo.csv` override), serving fallback (`ml/clustering/serve.py`), API surface (`backend/app/services/cluster_service.py`, `backend/app/api/market.py`, live `/market/clusters` on port 8370).

## Verdict summary

The clustering subsystem **reproduces exactly** from source artifacts: the 25-row neighborhood matrix, scaler, DBSCAN labels, `cluster_assignments.csv`, and every field of `cluster_stats.json` were recomputed independently and match the persisted artifacts bit-for-bit (floats to 1e-12). Claims of eps=1.317, min_samples=2, 4 clusters, 3 noise neighborhoods (CollgCr, NAmes, Timber) are all TRUE. One stale docstring found (P3).

## Findings

| # | Severity | Location | Description | Evidence |
|---|----------|----------|-------------|----------|
| F1 | P3 | `ml/clustering/train.py:23-25` | Module docstring stale: claims "4 noise neighborhoods (BrDale, CollgCr, NAmes, Timber)". Actual/artifacts/all other docs: **3 noise** (CollgCr, NAmes, Timber). Repro shows the docstring's exact noise set is what eps=1.2754 (the k-distance rung just below the accepted knee) yields — a leftover from an earlier iteration. No behavior impact. | `evidence/clustering-reproduce.txt` (steps 3–4); BrDale-at-1.2754 check in §3 below |

No P0/P1/P2 findings.

## Mission item results

### (2) Reproduction — PASS — verified by execution
Evidence: `evidence/clustering-reproduce.txt` (steps 1–3, 6).
- Rebuilt the 25×4 matrix from `data/external/neighborhood_geo.csv` + `models/neighborhood_stats.json`; fresh `StandardScaler` `mean_`/`scale_` match `dbscan_scaler.joblib` exactly.
- Re-ran `select_dbscan_params` → `min_samples=2`, `eps=1.3170045189879962` → **4 clusters, 3 noise = [CollgCr, NAmes, Timber]**; labels identical to `cluster_assignments.csv` (all 25 rows).
- Saved `dbscan.joblib` `labels_` also match the CSV in frame order. Saved model `eps=1.317004520305001` = rung × (1+1e-9), exactly the documented `_EPS_RTOL` boundary bump (`train.py:113, 204-206`) — by design, not a discrepancy.
- `cluster_stats.json` meta (`n_clusters`, `eps`, `min_samples`, `feature_names`) matches.

### (3) k-distance knee sanity — PASS — verified by execution
Evidence: `evidence/clustering-reproduce.txt` (steps 4–5).
- k=2 curve knee at idx 21 → eps **1.3170**; accepted → 4 clusters / 3 noise (valid per 3–10 contract).
- k=3 knee (eps 1.5181) degenerates to **1 cluster** / 4 noise — correctly rejected, matching the docstring's process description.
- **Second candidate:** k=2, eps=**1.4836** (next rung up; grid origin) → 3 clusters / 2 noise. It is the rung the refinement rule would have picked had all knees degenerated (fewest noise among valid). Adjacent lower rung eps=1.2754 → 4 clusters / 4 noise (BrDale joins the noise set — origin of the stale docstring, F1).
- Defensibility: the accepted eps sits at the point of maximum perpendicular distance from the k=2 curve's chord, and the resulting segmentation is **stable across the whole plateau [1.3170, 1.4836)** (DBSCAN output only changes at rungs) — a ~0.17-wide tolerance band. Knee choice is defensible.

### (4) Cluster stats — PASS — verified by execution
Evidence: `evidence/clustering-reproduce.txt` (step 6).
- Recomputed `median_price`, `median_price_per_sqft`, `sale_velocity_30d`, `n_sales`, `label`, `neighborhoods`, centroids, `note` per cluster from `load_split("train")` only — all match `cluster_stats.json` (floats at rtol 1e-12). Assignments DataFrame equals the CSV.
- **Train-only confirmed:** `build_cluster_stats` receives only `load_split("train")` (`train.py:534-535`); clustered n_sales sum = 675 ≤ 945 train rows (remaining 270 train sales belong to noise neighborhoods — excluded from per-cluster stats by design).
- **Simulated-target note present** on all 4 clusters (`_SIMULATED_VELOCITY_NOTE`, `train.py:115-120`) and served verbatim by the API.

### (5) Serving fallback — PASS — verified by execution
Evidence: `evidence/clustering-serving.txt`.
- `MicroMarketLookup.lookup`: CollgCr → cluster 2, NAmes → 0, Timber → 3, all `fallback: true`; unknown `"NoSuchHood"` → cluster 2, `fallback: true`; control StoneBr → cluster 0, `fallback: false`. Whitespace `" Timber "` handled (strip at `serve.py:176`).
- **Hand distance math (Timber):** unscaled `[41.9964, -93.6489, 133.5677, 0.6944]` → scaled `[-1.749898, -0.297426, 0.735508, -0.398076]`; distances to centroids 0–3 = 2.5055 / 2.5416 / 2.1729 / **2.0831** → argmin = 3 = `lookup()` result. Math checks out.
- Unknown-name vector verified = downtown (42.0347, −93.6199) + global fallback stats (120.5788, 26.25).

### (6) Coordinate grain — PASS — verified by execution
Evidence: `evidence/clustering-geo-grain.txt`.
- Every split (train 945 / val 338 / test 175 rows) has **exactly 1 unique (lat,long) per neighborhood** — centroid-level grain CONFIRMED; all 945 train rows' coords equal the `neighborhood_geo.csv` centroid verbatim (0 mismatches; 25 unique pairs total).
- `data/external/property_geo.csv` **absent** (confirmed on disk); override machinery exists at `ml/features/pipeline.py:211, 294-376` (`_property_geo_lookup` with schema/bbox validation, no-op when absent) — matches `data/external/README.md:45` and `docs/GEOGRAPHY.md` claims.

### (7) Frontend/API consistency — PASS — verified by execution
Evidence: `evidence/clustering-api.txt`, raw payload `evidence/clustering-api-live.json`.
- Started `uvicorn backend.app.main:app` on assigned port **8370**; `GET /market/clusters` → HTTP 200: `n_clusters=4`, 4 cluster entries field-identical to `cluster_stats.json`, **25 points** covering all geo neighborhoods, coords equal to the geo CSV, non-fallback `cluster_id`s equal to `cluster_assignments.csv`, and exactly the 3 noise neighborhoods flagged `fallback: true` with resolved clusters (CollgCr→2, NAmes→0, Timber→3). Payload is precomputed once in the lifespan (`main.py:137`) and served from `app.state`.
- Server killed afterwards (`taskkill PID 29884`); port 8370 verified free (connection refused + no netstat listener).

### (8) Stability — PASS — verified by execution
Evidence: `evidence/clustering-reproduce.txt` (step 7).
- Second independent in-memory run (fresh scaler + `select_dbscan_params`): identical labels, eps, min_samples. Cross-process stability is additionally attested by (a) this run's labels matching artifacts produced by the original training run and (b) the uvicorn subprocess re-deriving identical fallback assignments.

## Notes / observations (not findings)

- `champion.json` `clustering.n_clusters = 4` — consistent.
- All docs except the F1 docstring agree on 3 noise (README.md:238, METHODOLOGY.md:162-170, GEOGRAPHY.md:48, DEMO.md:78, API.md:278, DECISIONS.md:75, agent-log/clustering.md:40).
- Figures `cluster_kdistance.png`, `cluster_map.png`, `cluster_price_distribution.png` all exist in `figures/`.
- Ambient CPU load from concurrent auditors noted; no timing-sensitive measurements were taken in this mission, so no impact.

## Coverage

- **Read fully:** `ml/clustering/dataset.py` (115 lines), `ml/clustering/train.py` (605), `ml/clustering/serve.py` (185), `ml/features/stats.py` (178), `backend/app/services/cluster_service.py` (88), `backend/app/api/market.py` (20). Targeted reads: `ml/features/pipeline.py:200-439` (geo + override), `ml/training/common.py:22-31,84-88`, `ml/paths.py`, `backend/app/main.py` (lifespan), `models/clustering/*`, `data/external/neighborhood_geo.csv`.
- **Executed:** `build_neighborhood_matrix`, `k_distance_curve`, `knee_index`, `select_dbscan_params`, `_fit_dbscan`, `count_clusters`, `build_cluster_stats`, `MicroMarketLookup.__init__/lookup/_feature_vector/_nearest_cluster`, `ClusterService.market_clusters` (via live HTTP), `load_split`, `load_neighborhood_stats`. Functions exercised transitively: `price_tier`, `direction_label` (labels match saved stats), `NeighborhoodStats.for_neighborhood/global_fallback`.
- **Not executed (plotting only, cosmetic):** `_plot_kdistance`, `_plot_cluster_map`, `_plot_price_distribution`, `_log_mlflow_run` (would write to `mlruns/`; avoided per report-only rule — its inputs were verified instead).
