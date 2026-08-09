"""Train DBSCAN micro-market clusters over Ames neighborhoods (ADR-9).

Pipeline (CLI: ``python -m ml.clustering.train``):

1. Build the 25-row neighborhood matrix ``[lat, long, median_price_per_sqft,
   monthly_sale_velocity]`` (``ml.clustering.dataset``) — approximate centroids
   plus TRAIN-split-only market aggregates.
2. Standardize with ``StandardScaler`` and run ``sklearn.cluster.DBSCAN``.
3. Select ``eps`` with the k-distance knee heuristic (``k = min_samples``),
   trying ``min_samples`` in {2, 3}:

   - The knee is the point of maximum perpendicular distance from the sorted
     k-distance curve to its chord (Kneedle-style, axes normalized).
   - A candidate is *valid* when it yields 3–10 non-noise clusters
     (:data:`MIN_CLUSTERS`–:data:`MAX_CLUSTERS`, per the ADR-9 contract).
   - Knees are evaluated first (``min_samples=2`` then ``3``); the first valid
     knee is accepted. If every knee degenerates, ``eps`` is refined over the
     distinct k-distance rungs of all tried ``k``: among valid results the one
     with the fewest noise points wins, tie-broken by closeness to a knee
     rung, then by more clusters. The full search trace is logged to MLflow
     and printed by the CLI so the choice is auditable.

   Result on ames-1.0: the ``k=2`` knee (eps≈1.317) is valid → **4 clusters,
   3 noise neighborhoods** (CollgCr, NAmes, Timber — isolated by
   atypical sale velocity and/or location). The ``k=3`` knee degenerates to a
   single cluster. Noise is expected at this 25-point grain and is handled at
   serving time by nearest-centroid fallback (``ml.clustering.serve``).
4. Enrich each cluster with TRAIN-split descriptive statistics
   (``ml.training.common.load_split('train')``): member neighborhoods,
   ``n_sales``, median ``SalePrice``, median price_per_sqft, and
   ``sale_velocity_30d`` — the fraction of the cluster's train sales with
   ``sells_within_30_days == 1``. That last stat is DESCRIPTIVE over the
   SIMULATED target (ADR-3) and is never a model input (stated in every
   cluster's ``note`` field). Labels combine a price tier (premium / mid /
   affordable, from tertiles of the 25 neighborhoods' train median $/sqft)
   with a compass direction of the cluster centroid relative to downtown Ames
   (42.0347, -93.6199).
5. Persist artifacts (SPEC §6): ``models/clustering/dbscan.joblib``,
   ``dbscan_scaler.joblib``, ``cluster_stats.json``,
   ``cluster_assignments.csv``; figures ``figures/cluster_kdistance.png``,
   ``figures/cluster_map.png``, ``figures/cluster_price_distribution.png``;
   and one MLflow run in experiment ``clustering`` — params, metrics, the
   stats/trace JSON artifacts, and the fitted DBSCAN + scaler as model
   artifacts (SPEC §7; runs from before fitted-model logging was added —
   AUD-26a — contain only the JSON side-artifacts).
"""
from __future__ import annotations

import logging
import os
import time

# MLflow 3.15 raises on the filesystem tracking backend unless this opt-out is
# set; SPEC §7/ADR-8 mandate the local ./mlruns file store via ml.tracking.
# Set here (before mlflow is lazily imported by ml.tracking.track_run) so the
# trainer works regardless of the caller's environment.
os.environ.setdefault("MLFLOW_ALLOW_FILE_STORE", "true")
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

import joblib
import matplotlib

matplotlib.use("Agg")  # headless rendering — no display on this machine

import matplotlib.pyplot as plt
import numpy as np
import pandas as pd
from sklearn.cluster import DBSCAN
from sklearn.neighbors import NearestNeighbors
from sklearn.preprocessing import StandardScaler

from ml.clustering.dataset import CITY_CENTER, FEATURE_COLUMNS, build_neighborhood_matrix
from ml.paths import FEATURE_LIST_PATH, FIGURES_DIR, MODELS_DIR, RANDOM_SEED
from ml.tracking import feature_version, log_dict_artifact, log_model_artifact, track_run
from ml.training.common import load_split, write_json

logger = logging.getLogger(__name__)

__all__ = [
    "CLUSTER_DIR",
    "MAX_CLUSTERS",
    "MIN_CLUSTERS",
    "MIN_SAMPLES_CANDIDATES",
    "ClusteringResult",
    "build_cluster_stats",
    "count_clusters",
    "direction_label",
    "k_distance_curve",
    "knee_index",
    "price_tier",
    "select_dbscan_params",
    "train",
]

CLUSTER_DIR: Path = MODELS_DIR / "clustering"

#: Contract bounds for a defensible micro-market segmentation (ADR-9).
MIN_CLUSTERS = 3
MAX_CLUSTERS = 10

#: min_samples values tried, per assignment / ADR-9.
MIN_SAMPLES_CANDIDATES: tuple[int, ...] = (2, 3)

#: Compass-direction thresholds (degrees) around downtown Ames. 0.008° lat
#: ≈ 0.89 km and 0.012° long ≈ 0.99 km at 42°N — "central" within ~1 km.
DIRECTION_LAT_THRESHOLD = 0.008
DIRECTION_LONG_THRESHOLD = 0.012

#: Price tiers from tertiles of the 25 neighborhoods' train median $/sqft.
TIER_QUANTILES: tuple[float, float] = (1.0 / 3.0, 2.0 / 3.0)

#: Boundary inclusion guard: eps equal to a k-distance rung must include the
#: neighbor sitting exactly at that distance despite float round-off.
_EPS_RTOL = 1e-9

_SIMULATED_VELOCITY_NOTE = (
    "sale_velocity_30d is the fraction of this cluster's TRAIN-split sales with "
    "sells_within_30_days==1. It is a DESCRIPTIVE statistic over the SIMULATED "
    "sale-speed target (ADR-3), not a real-world market measurement, and is "
    "never used as a model input."
)


@dataclass
class EpsCandidate:
    """One evaluated (min_samples, eps) DBSCAN configuration."""

    min_samples: int
    eps: float
    origin: str  # "knee" or "grid"
    knee_rank: int  # rung distance from this k's knee on the k-distance ladder
    n_clusters: int
    n_noise: int
    labels: np.ndarray = field(repr=False)

    @property
    def valid(self) -> bool:
        """Whether the cluster count satisfies the ADR-9 contract bounds."""
        return MIN_CLUSTERS <= self.n_clusters <= MAX_CLUSTERS


@dataclass
class ClusteringResult:
    """Everything produced by :func:`train` (also the CLI summary)."""

    eps: float
    min_samples: int
    n_clusters: int
    n_noise: int
    noise_neighborhoods: list[str]
    labels: np.ndarray = field(repr=False)
    cluster_stats: dict[str, Any] = field(repr=False)
    assignments: pd.DataFrame = field(repr=False)
    frame: pd.DataFrame = field(repr=False)
    trace: list[dict[str, Any]] = field(repr=False)
    selection_rationale: str = ""


def k_distance_curve(X: np.ndarray, k: int) -> np.ndarray:
    """Sorted distance of every point to its k-th nearest neighbor.

    Args:
        X: Scaled feature matrix, shape ``(n_samples, n_features)``.
        k: Neighbor rank; conventionally ``k = min_samples`` for DBSCAN.

    Returns:
        Ascending 1-D array of k-th-nearest-neighbor distances.
    """
    neighbors = NearestNeighbors(n_neighbors=k).fit(X)
    distances, _ = neighbors.kneighbors(X)
    return np.sort(distances[:, k - 1])


def knee_index(sorted_distances: np.ndarray) -> int:
    """Index of the k-distance "knee" (max distance from curve to its chord).

    Both axes are min-max normalized first so the perpendicular-distance
    geometry is scale-free (Kneedle-style). Falls back to the median index
    (with a warning) if the curve is flat.
    """
    d = np.asarray(sorted_distances, dtype=float)
    n = d.size
    if n < 3:
        return max(0, n - 1)
    span = d[-1] - d[0]
    if span <= 0:
        logger.warning("k-distance curve is flat; using median rung as knee")
        return n // 2
    x = np.linspace(0.0, 1.0, n)
    y = (d - d[0]) / span
    # Chord from (0, y[0]) to (1, y[-1]); perpendicular distance of each point.
    direction = np.array([1.0, y[-1] - y[0]])
    norm = float(np.hypot(*direction))
    perpendicular = np.abs(direction[1] * x - direction[0] * y + y[0]) / norm
    return int(np.argmax(perpendicular))


def count_clusters(labels: np.ndarray) -> tuple[int, int]:
    """Return ``(n_non_noise_clusters, n_noise_points)`` for DBSCAN labels."""
    labels = np.asarray(labels)
    non_noise = set(labels.tolist()) - {-1}
    return len(non_noise), int((labels == -1).sum())


def _fit_dbscan(X: np.ndarray, eps: float, min_samples: int) -> DBSCAN:
    """Fit DBSCAN with a tiny relative eps bump for boundary inclusion."""
    return DBSCAN(eps=float(eps) * (1.0 + _EPS_RTOL), min_samples=min_samples).fit(X)


def select_dbscan_params(X: np.ndarray) -> tuple[int, float, np.ndarray, list[EpsCandidate], str]:
    """Select ``(min_samples, eps)`` via the k-distance knee heuristic.

    Tries each ``k`` in :data:`MIN_SAMPLES_CANDIDATES`: the knee eps is
    evaluated first; if no knee yields a valid result (3–10 clusters), the
    distinct k-distance rungs of all tried ``k`` are swept and the valid
    result with the fewest noise points is chosen (ties: closest to a knee
    rung, then more clusters).

    Returns:
        ``(min_samples, eps, labels, trace, rationale)`` where ``trace`` lists
        every evaluated :class:`EpsCandidate` (valid ones first).
    """
    candidates: list[EpsCandidate] = []
    knee_candidates: list[EpsCandidate] = []
    for k in MIN_SAMPLES_CANDIDATES:
        curve = k_distance_curve(X, k)
        rungs = np.unique(curve)
        knee_pos = knee_index(curve)
        knee_rung = int(np.searchsorted(rungs, curve[knee_pos]))
        for rank, rung in enumerate(rungs):
            origin = "knee" if rank == knee_rung else "grid"
            labels = _fit_dbscan(X, float(rung), k).labels_
            n_clusters, n_noise = count_clusters(labels)
            candidate = EpsCandidate(
                min_samples=k,
                eps=float(rung),
                origin=origin,
                knee_rank=abs(rank - knee_rung),
                n_clusters=n_clusters,
                n_noise=n_noise,
                labels=labels,
            )
            candidates.append(candidate)
            if origin == "knee":
                knee_candidates.append(candidate)

    valid_knees = [c for c in knee_candidates if c.valid]
    if valid_knees:
        # Prefer the first tried k whose knee is valid; fewer noise breaks ties.
        chosen = min(valid_knees, key=lambda c: (MIN_SAMPLES_CANDIDATES.index(c.min_samples), c.n_noise))
        rationale = (
            f"k-distance knee accepted: min_samples={chosen.min_samples}, "
            f"eps={chosen.eps:.4f} -> {chosen.n_clusters} clusters, "
            f"{chosen.n_noise} noise (within {MIN_CLUSTERS}-{MAX_CLUSTERS} clusters)"
        )
    else:
        valid = [c for c in candidates if c.valid]
        if not valid:
            raise RuntimeError(
                "no (min_samples, eps) candidate produced "
                f"{MIN_CLUSTERS}-{MAX_CLUSTERS} clusters; k-distance rungs exhausted"
            )
        chosen = min(valid, key=lambda c: (c.n_noise, c.knee_rank, -c.n_clusters))
        rationale = (
            f"all knee candidates degenerate; refined eps over k-distance rungs: "
            f"min_samples={chosen.min_samples}, eps={chosen.eps:.4f} -> "
            f"{chosen.n_clusters} clusters, {chosen.n_noise} noise "
            "(min noise among valid, closest to knee)"
        )
    for c in candidates:
        logger.info(
            "candidate k=%d eps=%.4f [%s] -> clusters=%d noise=%d%s",
            c.min_samples, c.eps, c.origin, c.n_clusters, c.n_noise,
            " VALID" if c.valid else "",
        )
    logger.info("eps selection: %s", rationale)
    return chosen.min_samples, chosen.eps, chosen.labels, candidates, rationale


def price_tier(median_price_per_sqft: float, tier_bounds: tuple[float, float]) -> str:
    """Map a median $/sqft to ``affordable`` / ``mid`` / ``premium``."""
    low, high = tier_bounds
    if median_price_per_sqft < low:
        return "affordable"
    if median_price_per_sqft > high:
        return "premium"
    return "mid"


def direction_label(
    centroid_lat: float,
    centroid_long: float,
    reference: tuple[float, float] = CITY_CENTER,
) -> str:
    """Compass direction of a centroid relative to downtown Ames.

    Returns ``central`` within ~1 km, else a combination such as ``north``,
    ``southwest`` (thresholds: :data:`DIRECTION_LAT_THRESHOLD` /
    :data:`DIRECTION_LONG_THRESHOLD`).
    """
    d_lat = centroid_lat - reference[0]
    d_long = centroid_long - reference[1]
    north_south = ""
    if d_lat > DIRECTION_LAT_THRESHOLD:
        north_south = "north"
    elif d_lat < -DIRECTION_LAT_THRESHOLD:
        north_south = "south"
    east_west = ""
    if d_long > DIRECTION_LONG_THRESHOLD:
        east_west = "east"
    elif d_long < -DIRECTION_LONG_THRESHOLD:
        east_west = "west"
    return (north_south + east_west) or "central"


def build_cluster_stats(
    frame: pd.DataFrame,
    labels: np.ndarray,
    train_df: pd.DataFrame,
) -> tuple[dict[str, Any], pd.DataFrame]:
    """Enrich clusters with TRAIN-split descriptive stats and build assignments.

    Args:
        frame: Neighborhood matrix from ``build_neighborhood_matrix``.
        labels: DBSCAN labels aligned with ``frame`` rows (-1 = noise).
        train_df: Processed TRAIN split (never val/test — leakage rules).

    Returns:
        ``(cluster_stats, assignments)``: the ``cluster_stats.json`` payload
        (per-cluster dicts plus the global ``n_clusters`` / ``eps`` /
        ``min_samples`` / ``feature_names`` keys are added by :func:`train`)
        and the ``cluster_assignments.csv`` frame ``(Neighborhood, cluster_id)``.
    """
    enriched = frame.copy()
    enriched["cluster_id"] = labels.astype(int)

    tier_bounds = tuple(
        float(q) for q in np.quantile(frame["median_price_per_sqft"], TIER_QUANTILES)
    )
    stats: dict[str, Any] = {}
    used_labels: set[str] = set()
    for cluster_id in sorted(set(labels.tolist()) - {-1}):
        members = enriched[enriched["cluster_id"] == cluster_id]
        neighborhoods = sorted(members["Neighborhood"].tolist())
        sales = train_df[train_df["Neighborhood"].isin(neighborhoods)]
        if sales.empty:
            logger.warning("cluster %d has no train sales", cluster_id)
            continue
        price = sales["SalePrice"].astype(float)
        price_per_sqft = price / sales["GrLivArea"].astype(float).clip(lower=1.0)
        centroid_lat = float(members["lat"].mean())
        centroid_long = float(members["long"].mean())
        median_ppsft = float(price_per_sqft.median())
        label = f"{price_tier(median_ppsft, tier_bounds)} {direction_label(centroid_lat, centroid_long)}"
        if label in used_labels:
            label = f"{label} {cluster_id}"
        used_labels.add(label)
        stats[str(cluster_id)] = {
            "label": label,
            "neighborhoods": neighborhoods,
            "n_sales": int(len(sales)),
            "median_price": float(price.median()),
            "median_price_per_sqft": median_ppsft,
            "sale_velocity_30d": float(sales["sells_within_30_days"].astype(float).mean()),
            "centroid_lat": centroid_lat,
            "centroid_long": centroid_long,
            "note": _SIMULATED_VELOCITY_NOTE,
        }

    assignments = enriched[["Neighborhood", "cluster_id"]].sort_values("Neighborhood").reset_index(drop=True)
    return stats, assignments


def _plot_kdistance(X: np.ndarray, chosen_k: int, chosen_eps: float, path: Path) -> None:
    """Save the k-distance curves with knee markers and the chosen eps."""
    fig, ax = plt.subplots(figsize=(9, 5.5))
    for k in MIN_SAMPLES_CANDIDATES:
        curve = k_distance_curve(X, k)
        knee_pos = knee_index(curve)
        ax.plot(np.arange(1, curve.size + 1), curve, marker="o", ms=4, label=f"k = {k}")
        ax.annotate(
            f"knee k={k}\neps={curve[knee_pos]:.3f}",
            xy=(knee_pos + 1, curve[knee_pos]),
            xytext=(knee_pos + 1.5, curve[knee_pos] + 0.35),
            fontsize=8,
            arrowprops={"arrowstyle": "->", "lw": 0.8},
        )
    ax.axhline(chosen_eps, color="crimson", ls="--", lw=1.2,
               label=f"chosen eps = {chosen_eps:.3f} (k = {chosen_k})")
    ax.set_xlabel("neighborhoods sorted by k-th nearest-neighbor distance")
    ax.set_ylabel("distance in standardized feature space")
    ax.set_title("k-distance knee heuristic for DBSCAN eps — Ames neighborhood micro-markets")
    ax.legend()
    fig.tight_layout()
    fig.savefig(path, dpi=150)
    plt.close(fig)


def _plot_cluster_map(frame: pd.DataFrame, stats: dict[str, Any], eps: float, min_samples: int, path: Path) -> None:
    """Scatter approximate neighborhood centroids colored by cluster."""
    fig, ax = plt.subplots(figsize=(10, 8))
    cmap = plt.get_cmap("tab10")
    for i, cid in enumerate(sorted(stats, key=int)):
        members = frame[frame["cluster_id"] == int(cid)]
        ax.scatter(
            members["long"], members["lat"],
            s=90, color=cmap(i % 10), edgecolor="black", linewidth=0.6,
            label=f"{cid}: {stats[cid]['label']} (n={len(members)})", zorder=3,
        )
    noise = frame[frame["cluster_id"] == -1]
    if len(noise):
        ax.scatter(noise["long"], noise["lat"], s=90, marker="x", color="dimgray",
                   linewidth=1.8, label=f"noise (n={len(noise)})", zorder=3)
    for position, row in enumerate(frame.itertuples(index=False)):
        # Alternate the annotation side so near-coincident centroids
        # (e.g. MeadowV/Mitchel) do not overprint each other.
        xytext = (6, 5) if position % 2 == 0 else (6, -13)
        ax.annotate(row.Neighborhood, (row.long, row.lat), textcoords="offset points",
                    xytext=xytext, fontsize=8)
    ax.scatter([CITY_CENTER[1]], [CITY_CENTER[0]], marker="*", s=220, color="gold",
               edgecolor="black", linewidth=0.7, label="downtown Ames", zorder=4)
    ax.set_xlabel("longitude")
    ax.set_ylabel("latitude")
    ax.set_title(
        f"Ames, Iowa neighborhood micro-markets — DBSCAN (eps={eps:.3f}, min_samples={min_samples})\n"
        "approximate neighborhood centroids (ADR-2), train-split market stats only"
    )
    ax.legend(loc="upper left", fontsize=8)
    fig.tight_layout()
    fig.savefig(path, dpi=150)
    plt.close(fig)


def _plot_price_distribution(
    train_df: pd.DataFrame, assignments: pd.DataFrame, stats: dict[str, Any], path: Path
) -> None:
    """Boxplot of TRAIN SalePrice per micro-market cluster (noise shown too)."""
    merged = train_df.merge(assignments, on="Neighborhood", how="left")
    order = sorted(stats, key=lambda cid: stats[cid]["median_price"])
    # Color by cluster-id rank so colors match figures/cluster_map.png.
    color_rank = {cid: i for i, cid in enumerate(sorted(stats, key=int))}
    groups: list[np.ndarray] = []
    tick_labels: list[str] = []
    colors: list[str] = []
    cmap = plt.get_cmap("tab10")
    for cid in order:
        entry = stats[cid]
        prices = merged.loc[merged["cluster_id"] == int(cid), "SalePrice"].astype(float).to_numpy()
        groups.append(prices)
        tick_labels.append(f"{cid}: {entry['label']}\n(n={entry['n_sales']})")
        colors.append(cmap(color_rank[cid] % 10))
    noise_prices = merged.loc[merged["cluster_id"] == -1, "SalePrice"].astype(float).to_numpy()
    if noise_prices.size:
        groups.append(noise_prices)
        tick_labels.append(f"noise\n(n={noise_prices.size})")
        colors.append("lightgray")

    fig, ax = plt.subplots(figsize=(11, 6))
    box = ax.boxplot(groups, tick_labels=tick_labels, patch_artist=True, showfliers=False)
    for patch, color in zip(box["boxes"], colors):
        patch.set_facecolor(color)
        patch.set_alpha(0.75)
    ax.set_ylabel("SalePrice (USD)")
    ax.yaxis.set_major_formatter(lambda x, _: f"${x:,.0f}")
    ax.set_title("TRAIN SalePrice distribution by micro-market cluster — Ames, Iowa (YrSold ≤ 2008)")
    fig.tight_layout()
    fig.savefig(path, dpi=150)
    plt.close(fig)


def _log_mlflow_run(
    result: ClusteringResult,
    tier_bounds: tuple[float, float],
    model: DBSCAN,
    scaler: StandardScaler,
) -> None:
    """Log the run to MLflow (one retry after 30s on shared-store lock errors).

    Logs params/metrics, the cluster-stats + eps-selection JSON artifacts, and
    the fitted DBSCAN + scaler via ``ml.tracking.log_model_artifact`` so the
    run is self-contained like the regression/classification trainer runs
    (SPEC §7, AUD-26a). Historical runs predate fitted-model logging and
    contain only the JSON side-artifacts.
    """
    params = {
        "algorithm": "DBSCAN",
        "eps": f"{result.eps:.6f}",
        "min_samples": result.min_samples,
        "scaler": "StandardScaler",
        "feature_names": ",".join(FEATURE_COLUMNS),
        "price_tier_bounds_ppsft": f"{tier_bounds[0]:.2f},{tier_bounds[1]:.2f}",
        "random_seed": RANDOM_SEED,
    }
    metrics = {
        "n_clusters": result.n_clusters,
        "n_noise": result.n_noise,
        "noise_fraction": result.n_noise / len(result.labels),
        "eps": result.eps,
    }
    trace_payload = {
        "selection_rationale": result.selection_rationale,
        "candidates": [
            {
                "min_samples": c.min_samples,
                "eps": round(c.eps, 6),
                "origin": c.origin,
                "n_clusters": c.n_clusters,
                "n_noise": c.n_noise,
                "valid": c.valid,
            }
            for c in result.trace
        ],
    }
    for attempt in (1, 2):
        try:
            with track_run(
                "clustering",
                "dbscan_v1",
                params=params,
                tags={"feature_version": feature_version(FEATURE_LIST_PATH)},
            ) as (mlflow, _run):
                mlflow.log_metrics(metrics)
                log_dict_artifact(result.cluster_stats, "cluster_stats.json")
                log_dict_artifact(trace_payload, "eps_selection_trace.json")
                # SPEC §7 / AUD-26a: log the fitted artifacts so the run is
                # self-contained like the regression/classification runs.
                log_model_artifact(model, "model")
                log_model_artifact(scaler, "scaler")
            return
        except Exception:  # noqa: BLE001 — shared file store may transiently lock
            if attempt == 2:
                logger.exception("MLflow logging failed after retry; artifacts are already on disk")
                return
            logger.warning("MLflow logging failed (attempt %d); retrying in 30s", attempt)
            time.sleep(30)


def train() -> ClusteringResult:
    """Run the full clustering pipeline and persist all artifacts + figures."""
    frame = build_neighborhood_matrix()
    X = frame[list(FEATURE_COLUMNS)].to_numpy(dtype=float)

    scaler = StandardScaler().fit(X)
    X_scaled = scaler.transform(X)

    min_samples, eps, labels, trace, rationale = select_dbscan_params(X_scaled)
    model = _fit_dbscan(X_scaled, eps, min_samples)
    labels = model.labels_
    n_clusters, n_noise = count_clusters(labels)

    train_df = load_split("train")
    cluster_stats, assignments = build_cluster_stats(frame, labels, train_df)
    tier_bounds = tuple(
        float(q) for q in np.quantile(frame["median_price_per_sqft"], TIER_QUANTILES)
    )
    cluster_stats.update(
        {
            "n_clusters": n_clusters,
            "eps": float(eps),
            "min_samples": int(min_samples),
            "feature_names": list(FEATURE_COLUMNS),
        }
    )

    CLUSTER_DIR.mkdir(parents=True, exist_ok=True)
    joblib.dump(model, CLUSTER_DIR / "dbscan.joblib")
    joblib.dump(scaler, CLUSTER_DIR / "dbscan_scaler.joblib")
    write_json(CLUSTER_DIR / "cluster_stats.json", cluster_stats)
    assignments.to_csv(CLUSTER_DIR / "cluster_assignments.csv", index=False)
    logger.info("wrote clustering artifacts to %s", CLUSTER_DIR)

    FIGURES_DIR.mkdir(parents=True, exist_ok=True)
    enriched = frame.copy()
    enriched["cluster_id"] = labels.astype(int)
    _plot_kdistance(X_scaled, min_samples, eps, FIGURES_DIR / "cluster_kdistance.png")
    _plot_cluster_map(enriched, {k: v for k, v in cluster_stats.items() if k.isdigit()},
                      eps, min_samples, FIGURES_DIR / "cluster_map.png")
    _plot_price_distribution(train_df, assignments,
                             {k: v for k, v in cluster_stats.items() if k.isdigit()},
                             FIGURES_DIR / "cluster_price_distribution.png")
    logger.info("wrote clustering figures to %s", FIGURES_DIR)

    result = ClusteringResult(
        eps=float(eps),
        min_samples=int(min_samples),
        n_clusters=n_clusters,
        n_noise=n_noise,
        noise_neighborhoods=sorted(enriched.loc[enriched["cluster_id"] == -1, "Neighborhood"].tolist()),
        labels=labels,
        cluster_stats=cluster_stats,
        assignments=assignments,
        frame=enriched,
        trace=trace,
        selection_rationale=rationale,
    )
    _log_mlflow_run(result, tier_bounds, model=model, scaler=scaler)
    return result


def main() -> None:
    """CLI entry point: train DBSCAN clusters and log a summary table."""
    logging.basicConfig(level=logging.INFO, format="%(levelname)s %(name)s: %(message)s")
    result = train()
    logger.info("selection: %s", result.selection_rationale)
    logger.info(
        "RESULT: eps=%.4f min_samples=%d -> %d clusters, %d noise (%s)",
        result.eps, result.min_samples, result.n_clusters, result.n_noise,
        ", ".join(result.noise_neighborhoods) or "none",
    )
    header = f"{'cluster':>7}  {'label':<22} {'n_hoods':>7} {'n_sales':>7} {'median_price':>12} {'med_$/sqft':>10} {'vel_30d':>7}"
    logger.info("\n%s", header)
    for cid in sorted((k for k in result.cluster_stats if k.isdigit()), key=int):
        entry = result.cluster_stats[cid]
        logger.info(
            "%7s  %-22s %7d %7d %12.0f %10.2f %7.3f",
            cid, entry["label"], len(entry["neighborhoods"]), entry["n_sales"],
            entry["median_price"], entry["median_price_per_sqft"], entry["sale_velocity_30d"],
        )


if __name__ == "__main__":
    main()
