"""Population Stability Index (PSI) utilities for drift monitoring (SPEC §10).

PSI quantifies how much a numeric distribution has shifted between a reference
("expected") sample — the train split — and a live ("actual") sample, e.g. the
recent prediction-log window::

    PSI = Σ_i (actual_i − expected_i) · ln(actual_i / expected_i)

over per-bin proportions. Interpretation thresholds (SPEC §10, industry
standard for scorecard monitoring):

- ``PSI < 0.1``            → no significant shift
- ``0.1 ≤ PSI < 0.2``      → warning zone, watch the feature
- ``PSI ≥ 0.2``            → drift detected, investigate / consider retraining

Binning convention: reference quantile bins from :func:`psi_bins_from_train`
(first/last edge = train min/max). :func:`bin_proportions` treats the outer
edges as open-ended (±inf) so production values outside the train range land
in the edge bins and inflate PSI instead of being silently dropped.

Heavy-tie features (e.g. zero-inflated ones such as ``PoolArea``) whose
quantile edges collapse below two bins get fallback midpoint-cut bins so a
production shift still moves PSI; the reference marks them
``"degenerate": true`` (fewer effective bins → reduced sensitivity).
"""
from __future__ import annotations

from typing import Iterable

import numpy as np
import pandas as pd

#: PSI at or above which a feature is considered worth watching (SPEC §10).
PSI_WARN_THRESHOLD: float = 0.1
#: PSI at or above which a feature is considered drifted (SPEC §10).
PSI_DRIFT_THRESHOLD: float = 0.2
#: Default number of quantile bins for numeric drift features.
DEFAULT_N_BINS: int = 10

__all__ = [
    "PSI_WARN_THRESHOLD",
    "PSI_DRIFT_THRESHOLD",
    "DEFAULT_N_BINS",
    "population_stability_index",
    "psi_bins_from_train",
    "degenerate_binning",
    "bin_proportions",
]


def _to_clean_float_array(values: Iterable[object]) -> np.ndarray:
    """Coerce an arbitrary iterable to a float array, dropping NaN/non-numeric."""
    series = pd.to_numeric(pd.Series(list(values)), errors="coerce")
    return series.dropna().to_numpy(dtype=float)


def population_stability_index(
    expected_proportions: Iterable[float],
    actual_proportions: Iterable[float],
    eps: float = 1e-6,
) -> float:
    """Compute PSI between two per-bin proportion vectors.

    Args:
        expected_proportions: Reference (train) proportion per bin.
        actual_proportions: Live (recent window) proportion per bin, same
            binning as ``expected_proportions``.
        eps: Lower clip applied to proportions before the log, so empty bins
            contribute a large-but-finite penalty instead of ±inf.

    Returns:
        The PSI value (≥ 0; 0 means identical distributions). See module
        docstring for the 0.1/0.2 interpretation thresholds.

    Raises:
        ValueError: If the vectors differ in length, are empty, contain
            negative entries, or carry no positive mass.
    """
    expected = np.asarray(list(expected_proportions), dtype=float)
    actual = np.asarray(list(actual_proportions), dtype=float)
    if expected.shape != actual.shape:
        raise ValueError(
            f"proportion vectors must have equal length, got "
            f"{expected.size} vs {actual.size}"
        )
    if expected.size == 0:
        raise ValueError("proportion vectors must not be empty")
    if (expected < 0).any() or (actual < 0).any():
        raise ValueError("proportions must be non-negative")

    # Normalize defensively (callers may pass counts or unnormalized weights),
    # then clip away from zero so empty bins yield a finite penalty.
    e_sum, a_sum = float(expected.sum()), float(actual.sum())
    if e_sum <= 0.0 or a_sum <= 0.0:
        raise ValueError("proportion vectors must carry positive mass")
    expected = np.clip(expected / e_sum, eps, None)
    expected /= expected.sum()
    actual = np.clip(actual / a_sum, eps, None)
    actual /= actual.sum()

    return float(np.sum((actual - expected) * np.log(actual / expected)))


def _quantile_edges(arr: np.ndarray, n_bins: int) -> np.ndarray:
    """Unique quantile edges of a cleaned sample (internal helper)."""
    quantiles = np.linspace(0.0, 1.0, n_bins + 1)
    return np.unique(np.quantile(arr, quantiles))


def _midpoint_edges(arr: np.ndarray) -> np.ndarray:
    """Fallback edges for heavy-tie samples whose quantiles collapse (AUD-06).

    A collapsed quantile binning means one value dominates the sample, so a
    single midpoint cut (two when the modal value is interior) separates the
    modal value from the rest of the mass. Keeping the whole tail in one bin
    gives every bin enough expected mass to stay noise-robust on small live
    windows; endpoints stay at the sample min/max, so out-of-range production
    values still land in the open outer bins and inflate PSI.
    """
    uniques, counts = np.unique(arr, return_counts=True)
    mode = int(np.argmax(counts))
    cuts: list[float] = []
    if mode > 0:
        cuts.append(float(uniques[mode - 1] + uniques[mode]) / 2.0)
    if mode < uniques.size - 1:
        cuts.append(float(uniques[mode] + uniques[mode + 1]) / 2.0)
    return np.concatenate(([uniques[0]], cuts, [uniques[-1]]))


def degenerate_binning(values: Iterable[object], n_bins: int = DEFAULT_N_BINS) -> bool:
    """True when quantile binning of ``values`` collapses below two bins.

    Such features get fallback midpoint-cut bins from
    :func:`psi_bins_from_train`; with fewer effective bins their PSI
    sensitivity is reduced, and the drift reference marks them
    ``"degenerate": true``.

    Raises:
        ValueError: If the sample is empty after cleaning.
    """
    arr = _to_clean_float_array(values)
    if arr.size == 0:
        raise ValueError("cannot derive bins from an empty sample")
    return bool(_quantile_edges(arr, n_bins).size < 3)


def psi_bins_from_train(values: Iterable[object], n_bins: int = DEFAULT_N_BINS) -> list[float]:
    """Derive PSI bin edges from a reference (train) sample via quantiles.

    Args:
        values: Reference sample (non-numeric/NaN entries are dropped).
        n_bins: Target number of bins; can shrink when quantile edges
            duplicate (e.g. zero-inflated features such as ``PoolArea``).

    Returns:
        Strictly increasing bin edges (first = sample min, last = sample max),
        with duplicates removed. A constant sample degenerates to
        ``[c - 0.5, c, c + 0.5]`` — a single interior cut at the constant
        value — so any production change still raises PSI. A sample whose
        quantile edges collapse below two bins (heavy ties) falls back to a
        midpoint cut that separates the modal value from the rest
        (:func:`degenerate_binning` reports this), so out-of-distribution
        production values — including out-of-range ones, captured by the
        open outer bins — still move PSI.

    Raises:
        ValueError: If the sample is empty after cleaning or ``n_bins < 1``.
    """
    if n_bins < 1:
        raise ValueError(f"n_bins must be >= 1, got {n_bins}")
    arr = _to_clean_float_array(values)
    if arr.size == 0:
        raise ValueError("cannot derive bins from an empty sample")
    edges = _quantile_edges(arr, n_bins)
    if edges.size == 1:
        constant = float(edges[0])
        edges = np.array([constant - 0.5, constant, constant + 0.5])
    elif edges.size < 3:
        edges = _midpoint_edges(arr)
    return [float(edge) for edge in edges]


def bin_proportions(values: Iterable[object], edges: Iterable[float]) -> np.ndarray:
    """Bin a sample against train-derived edges and return per-bin proportions.

    The first/last edge are treated as open-ended (±inf): values outside the
    train range are counted in the outer bins rather than dropped, so
    range-breaking production values inflate PSI instead of vanishing.
    Non-numeric/NaN entries are dropped.

    Args:
        values: Sample to bin.
        edges: Strictly increasing edges from :func:`psi_bins_from_train`
            (length ``k`` → ``k - 1`` bins).

    Returns:
        Array of ``len(edges) - 1`` proportions summing to 1, or a zero
        vector when the sample is empty after cleaning (callers should treat
        that as "no data" and skip the feature).

    Raises:
        ValueError: If fewer than two edges or edges are not increasing.
    """
    bounds = np.asarray(list(edges), dtype=float)
    if bounds.size < 2:
        raise ValueError(f"need at least two bin edges, got {bounds.size}")
    if np.any(np.diff(bounds) <= 0):
        raise ValueError("bin edges must be strictly increasing")
    full = np.concatenate(([-np.inf], bounds[1:-1], [np.inf]))
    arr = _to_clean_float_array(values)
    if arr.size == 0:
        return np.zeros(full.size - 1, dtype=float)
    counts, _ = np.histogram(arr, bins=full)
    total = int(counts.sum())
    if total == 0:
        return np.zeros(full.size - 1, dtype=float)
    return counts.astype(float) / float(total)
