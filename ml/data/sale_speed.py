"""SIMULATED TARGET - NOT FOR MODEL PERFORMANCE CLAIMS.

The Ames dataset has no days-on-market (DOM) field, and no credentialed MLS
feed is available (ADR-3). This module therefore simulates ``days_on_market``
from a **transparent, seeded function of real, pre-listing features**, and
derives the classification target ``sells_within_30_days`` from it.

Classification metrics computed against this target measure how well a model
recovers *this simulation rule* — they are NOT real-world performance claims.
All downstream reporting must carry this label.

Drop-in interface for real DOM data
------------------------------------
``attach_sale_speed(df, provider=...)`` accepts any object implementing the
:class:`DomProvider` protocol (``transform(df) -> pd.Series`` of integer days).
:class:`RealDomProvider` implements that protocol on top of an observed
``Id,days_on_market`` CSV with strict validation. ``ml/data/pipeline.py``
selects the provider via the ``DOM_PROVIDER`` / ``DOM_CSV_PATH`` environment
variables (default: simulated), so swapping in real DOM data needs no pipeline
code changes — only retraining (see ``data/README.md``).
"""
from __future__ import annotations

import logging
from dataclasses import dataclass, field
from pathlib import Path
from typing import Protocol, runtime_checkable

import numpy as np
import pandas as pd

from ml.paths import RANDOM_SEED

logger = logging.getLogger(__name__)

DOM_MIN = 1
DOM_MAX = 365
FAST_SALE_THRESHOLD_DAYS = 30


@runtime_checkable
class DomProvider(Protocol):
    """Interface any days-on-market source must implement (simulated or real)."""

    def transform(self, df: pd.DataFrame) -> pd.Series:
        """Return integer days-on-market per row of ``df`` (aligned by index)."""
        ...


@dataclass
class SaleSpeedSimulator:
    """Seeded DOM simulator fitted on train-split market statistics.

    Model (deliberately simple and fully documented):

    ``log(days) = log(base) + pricing + quality + season + noise``

    - ``base``: global train median DOM (fixed at 45 days — a plausible
      US mid-west market median; part of the simulation, not data). Chosen so
      roughly a quarter to a third of homes sell within 30 days, giving the
      classification target a usable class balance.
    - ``pricing``: how the asking outcome compares to the neighborhood median
      price. Over-priced homes linger: ``+0.9 * log(SalePrice / nbhd_median)``.
      Uses the **sale price as a proxy for list-price positioning** — this is
      the acknowledged simplification of a simulated target.
    - ``quality``: ``-0.06 * (OverallQual - 5) - 0.04 * (OverallCond - 5)`` —
      better presented homes sell faster.
    - ``season``: Ames winters are slow: Dec-Feb ``+0.25``, Mar-May ``-0.10``,
      Jun-Aug ``-0.05``, Sep-Nov ``+0.05`` (additive on log days).
    - ``noise``: per-row normal(0, 0.35) from a generator seeded with
      ``(RANDOM_SEED, Id)`` — deterministic per property, independent of row
      order, so the simulation is exactly reproducible.

    Result is exponentiated, clipped to [1, 365] and rounded to int days.
    """

    neighborhood_median_price: dict[str, float] = field(default_factory=dict)
    global_median_price: float = 0.0
    seed: int = RANDOM_SEED
    base_days: float = 45.0

    def fit(self, train_df: pd.DataFrame) -> "SaleSpeedSimulator":
        """Fit neighborhood median prices on the TRAIN split only."""
        medians = train_df.groupby("Neighborhood")["SalePrice"].median()
        self.neighborhood_median_price = {str(k): float(v) for k, v in medians.items()}
        self.global_median_price = float(train_df["SalePrice"].median())
        logger.info(
            "SaleSpeedSimulator fitted on %d train rows (%d neighborhoods)",
            len(train_df), len(self.neighborhood_median_price),
        )
        return self

    def _row_noise(self, ids: pd.Series) -> np.ndarray:
        noises = np.empty(len(ids), dtype=float)
        for i, prop_id in enumerate(ids):
            rng = np.random.default_rng([self.seed, int(prop_id)])
            noises[i] = rng.normal(0.0, 0.35)
        return noises

    def transform(self, df: pd.DataFrame) -> pd.Series:
        """Simulate integer days-on-market for each row of ``df``."""
        if not self.neighborhood_median_price:
            raise RuntimeError("SaleSpeedSimulator must be fitted before transform().")

        nbhd_median = df["Neighborhood"].map(self.neighborhood_median_price)
        nbhd_median = nbhd_median.fillna(self.global_median_price)
        price_ratio = (df["SalePrice"] / nbhd_median).clip(0.5, 2.0)
        pricing = 0.9 * np.log(price_ratio)

        quality = -0.06 * (df["OverallQual"] - 5) - 0.04 * (df["OverallCond"] - 5)

        season_map = {12: 0.25, 1: 0.25, 2: 0.25, 3: -0.10, 4: -0.10, 5: -0.10,
                      6: -0.05, 7: -0.05, 8: -0.05, 9: 0.05, 10: 0.05, 11: 0.05}
        season = df["MoSold"].map(season_map).astype(float)

        noise = self._row_noise(df["Id"])

        log_days = np.log(self.base_days) + pricing + quality + season + noise
        days = np.clip(np.exp(log_days), DOM_MIN, DOM_MAX).round().astype(int)
        return pd.Series(days, index=df.index, name="days_on_market")


class RealDomProvider:
    """Days-on-market provider backed by observed data from a CSV.

    This is the real-data path of ADR-3: it replaces the simulated target with
    observed days-on-market. The CSV must contain the columns
    ``Id,days_on_market`` (extra columns are ignored), one row per property:

    - ``Id``: integer property identifier matching the Ames ``Id`` column,
      unique across the file;
    - ``days_on_market``: integer number of days within
      [``DOM_MIN``, ``DOM_MAX``] (1–365).

    Validation is strict and happens at construction, so a malformed file
    fails fast with a clear error instead of producing silent NaNs downstream:
    missing file, missing columns, non-integer dtypes (catches floats, blanks
    and text), duplicate Ids and out-of-range days are all hard errors whose
    messages state the offending counts.

    At :meth:`transform` time a coverage check compares the target frame's
    Ids against the observed ones:

    - coverage below ``min_coverage`` → :class:`ValueError` reporting
      matched/total counts and a sample of unobserved Ids — never silent NaNs;
    - ``min_coverage`` <= coverage < 100% → the few unobserved rows are filled
      with the provider's median observed DOM and a warning is logged with the
      exact count.

    The provider is deterministic: the same CSV and frame always yield the
    same series, independent of row order (rows are matched by ``Id``).
    """

    def __init__(self, csv_path: Path | str, min_coverage: float = 0.95) -> None:
        """Load and strictly validate the observed-DOM CSV.

        Args:
            csv_path: path to a CSV with ``Id,days_on_market`` columns.
            min_coverage: minimum fraction of a transformed frame's Ids that
                must have an observed DOM value (default 0.95).

        Raises:
            FileNotFoundError: if ``csv_path`` does not exist.
            ValueError: on invalid ``min_coverage``, missing columns,
                non-integer dtypes, duplicate Ids, or out-of-range days.
        """
        if not 0.0 < min_coverage <= 1.0:
            raise ValueError(f"min_coverage must be in (0, 1], got {min_coverage}")
        self.min_coverage = float(min_coverage)

        path = Path(csv_path)
        if not path.exists():
            raise FileNotFoundError(
                f"Real DOM CSV not found: {path}. Expected a CSV with columns "
                "'Id,days_on_market' (integer days in [1, 365], unique Ids)."
            )
        dom = pd.read_csv(path)
        missing_cols = {"Id", "days_on_market"} - set(dom.columns)
        if missing_cols:
            raise ValueError(
                f"Real DOM CSV {path} is missing required columns: {sorted(missing_cols)} "
                "(expected 'Id,days_on_market')"
            )

        if not pd.api.types.is_integer_dtype(dom["Id"]):
            raise ValueError(
                f"Real DOM CSV {path}: 'Id' must be an integer column, "
                f"got dtype {dom['Id'].dtype}"
            )
        if not pd.api.types.is_integer_dtype(dom["days_on_market"]):
            raise ValueError(
                f"Real DOM CSV {path}: 'days_on_market' must contain integer days, "
                f"got dtype {dom['days_on_market'].dtype} "
                "(check for floats, blanks or text)"
            )

        dupes = sorted(dom.loc[dom["Id"].duplicated(keep=False), "Id"].unique().tolist())
        if dupes:
            raise ValueError(
                f"Real DOM CSV {path}: {len(dupes)} duplicated Id values "
                f"(first 10: {dupes[:10]}) - expected exactly one row per property Id"
            )

        days = dom["days_on_market"]
        n_bad = int(((days < DOM_MIN) | (days > DOM_MAX)).sum())
        if n_bad:
            raise ValueError(
                f"Real DOM CSV {path}: {n_bad} of {len(dom)} rows have days_on_market "
                f"outside [{DOM_MIN}, {DOM_MAX}] "
                f"(observed min={int(days.min())}, max={int(days.max())})"
            )

        self._dom = dom.set_index("Id")["days_on_market"]
        self.median_days = int(days.median())
        logger.info(
            "RealDomProvider loaded %d observed DOM values from %s (median %d days)",
            len(self._dom), path, self.median_days,
        )

    def transform(self, df: pd.DataFrame) -> pd.Series:
        """Return observed days-on-market for each row of ``df``.

        Args:
            df: a frame with an ``Id`` column (e.g. a cleaned pipeline split).

        Returns:
            Integer DOM series aligned with ``df``'s index, named
            ``days_on_market``. Rows are matched by ``Id``, so the result is
            independent of row order.

        Raises:
            ValueError: if the fraction of ``df`` Ids present in the CSV is
                below ``min_coverage`` — the message reports matched/total
                counts and a sample of unobserved Ids.
        """
        ids = df["Id"]
        if len(ids) == 0:
            return pd.Series(dtype=int, index=df.index, name="days_on_market")

        matched = ids.isin(self._dom.index)
        coverage = float(matched.mean())
        n_missing = int((~matched).sum())
        if coverage < self.min_coverage:
            sample = ids[~matched].head(5).tolist()
            raise ValueError(
                f"Real DOM coverage {coverage:.1%} "
                f"({int(matched.sum())}/{len(ids)} Ids matched) is below "
                f"min_coverage={self.min_coverage}: {n_missing} property Ids have no "
                f"observation (sample: {sample}). Provide a more complete "
                "days_on_market CSV or lower min_coverage."
            )

        days = ids.map(self._dom)
        if n_missing:
            logger.warning(
                "Real DOM coverage %.1f%%: %d of %d property Ids have no observation; "
                "filling them with the median observed DOM (%d days)",
                100.0 * coverage, n_missing, len(ids), self.median_days,
            )
            days = days.fillna(self.median_days)
        return days.astype(int).rename("days_on_market")


def attach_sale_speed(
    df: pd.DataFrame,
    provider: DomProvider,
) -> pd.DataFrame:
    """Attach ``days_on_market`` and ``sells_within_30_days`` to a split.

    Args:
        df: a cleaned split with ``Id``, ``SalePrice``, ``Neighborhood``,
            ``OverallQual``, ``OverallCond``, ``MoSold``.
        provider: fitted simulator or real provider (see :class:`DomProvider`).

    Returns:
        Copy of ``df`` with the two target columns added.
    """
    out = df.copy()
    days = provider.transform(out)
    if days.isna().any():
        raise ValueError("DOM provider returned NaN values")
    out["days_on_market"] = days.clip(DOM_MIN, DOM_MAX).astype(int)
    out["sells_within_30_days"] = (out["days_on_market"] <= FAST_SALE_THRESHOLD_DAYS).astype(int)
    if len(out):
        logger.info(
            "Attached sale-speed targets: median DOM=%d days, %.1f%% sell within 30 days",
            int(out["days_on_market"].median()), 100.0 * out["sells_within_30_days"].mean(),
        )
    else:
        # Empty frames are valid input (RealDomProvider.transform supports them);
        # the median of an empty column is NaN, so skip the stats log line.
        logger.info("Attached sale-speed targets: empty input frame (0 rows)")
    return out
