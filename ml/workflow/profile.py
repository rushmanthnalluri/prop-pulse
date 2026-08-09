"""Profiling cores for workflow stages 01–05 (workflow-architecture §3.3–§3.7).

All functions are pure ``DataFrame -> dict`` computations over the raw frame
(:func:`ml.workflow.datasets.load_dataset_frame`), computed per request — at
the 20k-row upload cap every payload builds in well under a second, so v1 has
no cache (§3.3). Payloads are browser-sized: value counts capped at 8, box
groups at 25, scatter points downsampled with the fixed ``RANDOM_SEED``, curves
and matrices bounded by their ``top``/``bins`` arguments (§3.7).

Role/policy metadata is reused verbatim from the pipeline — never
re-implemented: ``RAW_INPUT_COLUMNS`` / ``ENGINEERED_FEATURES`` /
``NEIGHBORHOOD_STAT_FEATURES`` / ``EXCLUDED_RAW_COLUMNS``
(:mod:`ml.features.pipeline`) and the NA policy tables
``NA_ABSENT_CATEGORICAL`` / ``NA_ABSENT_NUMERIC`` plus the train-fitted
``LotFrontage`` / ``Electrical`` rules (:mod:`ml.data.clean`).

Every dict is JSON-safe: numpy scalars are converted to Python natives and NaN
becomes ``None`` (the service layer serializes with the stdlib encoder).
"""
from __future__ import annotations

import logging
import math
from typing import Any

import numpy as np
import pandas as pd

from ml.data.clean import NA_ABSENT_CATEGORICAL, NA_ABSENT_NUMERIC
from ml.data.outliers import apply_outlier_rules
from ml.data.sale_speed import SaleSpeedSimulator, attach_sale_speed
from ml.features.pipeline import (
    ENGINEERED_FEATURES,
    EXCLUDED_RAW_COLUMNS,
    NEIGHBORHOOD_STAT_FEATURES,
    RAW_INPUT_COLUMNS,
)
from ml.paths import RANDOM_SEED
from ml.workflow.split import split_dataset

logger = logging.getLogger(__name__)

__all__ = [
    "box_by",
    "category_aggregate",
    "correlation",
    "descriptive_stats",
    "feature_inventory",
    "histogram",
    "missing_report",
    "profile_dataset",
    "scatter",
]

#: Target-derived raw columns that are not model inputs (§3.4 role detection).
_TARGET_COLUMNS = frozenset({"SalePrice", "days_on_market", "sells_within_30_days"})

#: Per-column "feature absent" phrases from data_description.txt semantics —
#: used in the stage-04 treatment notes (§3.6, PoolQC example is binding).
_ABSENT_PHRASES: dict[str, str] = {
    "Alley": "no alley access",
    "BsmtQual": "no basement",
    "BsmtCond": "no basement",
    "BsmtExposure": "no basement",
    "BsmtFinType1": "no basement",
    "BsmtFinType2": "no basement",
    "FireplaceQu": "no fireplace",
    "GarageType": "no garage",
    "GarageFinish": "no garage",
    "GarageQual": "no garage",
    "GarageCond": "no garage",
    "PoolQC": "no pool",
    "Fence": "no fence",
    "MiscFeature": "no miscellaneous feature",
    "MasVnrType": "no masonry veneer",
}

_POLICY_NOTES = {
    "NA_ABSENT_CATEGORICAL": 'filled with the literal "None" at cleaning',
    "NA_ABSENT_NUMERIC": "filled with 0 at cleaning",
}

_SCATTER_MAX_CAP = 20_000
_HISTOGRAM_BINS_CAP = 200
_BOX_GROUP_CAP = 25
_TOP_VALUES_CAP = 8
_CORRELATION_TOP_CAP = 60


# ---------------------------------------------------------------------------
# JSON-safety + column helpers
# ---------------------------------------------------------------------------

def _py(value: Any) -> Any:
    """Convert a pandas/numpy scalar to a JSON-safe Python native (NaN -> None)."""
    if value is None:
        return None
    if isinstance(value, (bool, int, str)):
        return value
    if isinstance(value, float):
        return None if math.isnan(value) else value
    if isinstance(value, (np.integer,)):
        return int(value)
    if isinstance(value, (np.floating,)):
        return None if math.isnan(float(value)) else float(value)
    if isinstance(value, (np.bool_,)):
        return bool(value)
    if pd.isna(value):
        return None
    return str(value)


def _records(df: pd.DataFrame, n: int) -> list[dict[str, Any]]:
    """First ``n`` rows as JSON-safe records (NaN -> None)."""
    return [
        {str(k): _py(v) for k, v in row.items()}
        for row in df.head(n).to_dict("records")
    ]


def _require_column(df: pd.DataFrame, column: str) -> None:
    if column not in df.columns:
        raise ValueError(f"unknown column {column!r} for this dataset")


def _require_numeric(df: pd.DataFrame, column: str) -> None:
    _require_column(df, column)
    if not pd.api.types.is_numeric_dtype(df[column]):
        raise ValueError(f"column {column!r} is categorical — a numeric column is required")


def _numeric_values(df: pd.DataFrame, column: str) -> pd.Series:
    """Non-NaN numeric values of a column (coercion-safe)."""
    return pd.to_numeric(df[column], errors="coerce").dropna()


# ---------------------------------------------------------------------------
# §3.3 — dataset profile (stage 01 result)
# ---------------------------------------------------------------------------

def profile_dataset(df: pd.DataFrame) -> dict[str, Any]:
    """Dataset profile for ``GET /workflow/datasets/{id}/profile`` (§3.3).

    Returns ``n_rows``, ``n_cols``, numeric/categorical column counts,
    duplicate-Id count, total missing cells, an 8-row ``head`` and the
    per-column ``{name, dtype}`` list. ``dataset_id``/``name`` are added by the
    service layer from the registry record (they are not frame properties).
    """
    numeric = [c for c in df.columns if pd.api.types.is_numeric_dtype(df[c])]
    categorical = [c for c in df.columns if c not in numeric]
    n_dupes = int(df["Id"].duplicated().sum()) if "Id" in df.columns else 0
    return {
        "n_rows": int(len(df)),
        "n_cols": int(df.shape[1]),
        "n_numeric": len(numeric),
        "n_categorical": len(categorical),
        "n_duplicate_ids": n_dupes,
        "total_missing_cells": int(df.isna().sum().sum()),
        "head": _records(df, 8),
        "columns": [{"name": str(c), "dtype": str(df[c].dtype)} for c in df.columns],
    }


# ---------------------------------------------------------------------------
# §3.4 — feature inventory + target detection (stage 02)
# ---------------------------------------------------------------------------

def _role_for_column(name: str) -> str:
    """Map a raw column to its §3.4 role via the pipeline's own lists."""
    if name == "Id":
        return "identifier"
    if name in _TARGET_COLUMNS:
        return "target"
    if name in RAW_INPUT_COLUMNS:
        return "raw_input"
    if name in EXCLUDED_RAW_COLUMNS:
        return "excluded"
    return "excluded"  # unreachable for validated uploads (full Ames schema)


def _feature_entry(df: pd.DataFrame, name: str) -> dict[str, Any]:
    series = df[name]
    n_rows = len(df)
    n_missing = int(series.isna().sum())
    entry: dict[str, Any] = {
        "name": str(name),
        "dtype": "numeric" if pd.api.types.is_numeric_dtype(series) else "categorical",
        "role": _role_for_column(name),
        "n_unique": int(series.nunique(dropna=True)),
        "n_missing": n_missing,
        "missing_pct": round(100.0 * n_missing / n_rows, 1) if n_rows else 0.0,
    }
    if entry["dtype"] == "numeric":
        values = series.dropna()
        entry["min"] = _py(values.min()) if len(values) else None
        entry["max"] = _py(values.max()) if len(values) else None
        entry["mean"] = _py(values.mean()) if len(values) else None
    else:
        counts = series.dropna().value_counts().head(_TOP_VALUES_CAP)
        entry["top_values"] = [
            {"value": str(v), "count": int(c)} for v, c in counts.items()
        ]
    return entry


def _simulated_positive_rate(df: pd.DataFrame) -> float | None:
    """Train-portion positive rate of the SIMULATED classification target (§3.4).

    Dry-runs the real attach: auto-split -> train portion -> outlier rule ->
    :class:`SaleSpeedSimulator` fit on that train portion -> attach. Cleaning
    is skipped deliberately: it never touches the simulator's inputs
    (``Id``, ``Neighborhood``, ``SalePrice``, ``OverallQual``, ``OverallCond``,
    ``MoSold``), so the rate is identical to the full chain's.
    """
    if len(df) < 10:
        return None
    try:
        train = split_dataset(df, "auto", 0.15, 0.15, RANDOM_SEED)["train"]
        train, _ = apply_outlier_rules(train)
        simulator = SaleSpeedSimulator(seed=RANDOM_SEED).fit(train)
        attached = attach_sale_speed(train, simulator)
        return round(float(attached["sells_within_30_days"].mean()), 4)
    except (KeyError, ValueError, RuntimeError) as exc:
        logger.warning("simulated-target dry run failed: %s", exc)
        return None


def feature_inventory(df: pd.DataFrame) -> dict[str, Any]:
    """Per-feature analysis + objective/target reporting (§3.4).

    "Target detection" is objective reporting over the known Ames schema (§7:
    arbitrary schema guessing is deliberately omitted). ``positive_rate`` comes
    from a train-portion dry-run of the simulator attach (SIMULATED, ADR-3).
    """
    raw_features = [_feature_entry(df, c) for c in df.columns]
    pipeline_features = [
        {
            "name": name,
            "role": "engineered",
            "note": "computed in the pipeline — not a raw column",
        }
        for name in ENGINEERED_FEATURES
    ] + [
        {
            "name": name,
            "role": "neighborhood_stat",
            "note": "computed in the pipeline — not a raw column",
        }
        for name in NEIGHBORHOOD_STAT_FEATURES
    ]

    n_years = int(df["YrSold"].nunique()) if "YrSold" in df.columns else 0
    if n_years >= 2:
        recommended_split = {
            "strategy": "time",
            "column": "YrSold",
            "why": f"sales span {n_years} distinct sale years — contiguous (YrSold, MoSold) "
            "blocks keep future data out of training (ADR-4)",
        }
    else:
        recommended_split = {
            "strategy": "random",
            "column": None,
            "why": f"sales span {n_years} distinct sale year(s) — a seeded shuffle "
            f"(seed {RANDOM_SEED}) is used instead",
        }

    return {
        "raw_features": raw_features,
        "pipeline_features": pipeline_features,
        "targets": {
            "regression": {
                "available": "SalePrice" in df.columns,
                "column": "SalePrice",
                "note": "models train on log1p(SalePrice) (ADR-10)",
            },
            "classification": {
                "available": True,
                "column": "sells_within_30_days",
                "derived": "simulated",
                "positive_rate": _simulated_positive_rate(df),
                "note": "derived from the seeded days-on-market simulation (ADR-3) — "
                "SIMULATED target",
            },
            "clustering": {
                "available": True,
                "method": "DBSCAN",
                "note": "neighborhood segmentation on [lat, long, median $/sqft, "
                "monthly velocity]",
            },
        },
        "recommended_split": recommended_split,
    }


# ---------------------------------------------------------------------------
# §3.5 — descriptive statistics (stage 03)
# ---------------------------------------------------------------------------

def _numeric_stats(series: pd.Series) -> dict[str, Any]:
    values = series.dropna()
    if not len(values):
        return {
            "count": 0, "mean": None, "std": None, "min": None,
            "p25": None, "p50": None, "p75": None, "max": None,
        }
    return {
        "count": int(values.count()),
        "mean": _py(values.mean()),
        "std": _py(values.std()),
        "min": _py(values.min()),
        "p25": _py(values.quantile(0.25)),
        "p50": _py(values.quantile(0.50)),
        "p75": _py(values.quantile(0.75)),
        "max": _py(values.max()),
    }


def descriptive_stats(df: pd.DataFrame) -> dict[str, Any]:
    """Pandas ``describe``/``value_counts`` wrapper for ``GET …/stats`` (§3.5)."""
    numeric: list[dict[str, Any]] = []
    categorical: list[dict[str, Any]] = []
    for name in df.columns:
        series = df[name]
        if pd.api.types.is_numeric_dtype(series):
            numeric.append({"name": str(name), **_numeric_stats(series)})
        else:
            counts = series.dropna().value_counts()
            categorical.append(
                {
                    "name": str(name),
                    "count": int(series.count()),
                    "n_unique": int(series.nunique(dropna=True)),
                    "top": _py(counts.index[0]) if len(counts) else None,
                    "top_freq": int(counts.iloc[0]) if len(counts) else 0,
                }
            )
    target = None
    if "SalePrice" in df.columns:
        target = {
            "name": "SalePrice",
            **_numeric_stats(df["SalePrice"]),
            "note": "right-skewed — models use log1p",
        }
    return {"numeric": numeric, "categorical": categorical, "target": target}


# ---------------------------------------------------------------------------
# §3.6 — missing-value analysis + treatment recommendations (stage 04)
# ---------------------------------------------------------------------------

def _policy_for_column(name: str) -> tuple[str, str, str] | None:
    """Map a column to ``(treatment, policy, note)`` from the real policy tables.

    Returns ``None`` when no documented NA policy exists — such columns land in
    ``blocking`` because :func:`ml.data.clean.apply_cleaner` will raise on them.
    """
    if name in NA_ABSENT_CATEGORICAL:
        phrase = _ABSENT_PHRASES.get(name, "feature absent")
        return (
            "fill_absent_token",
            "NA_ABSENT_CATEGORICAL",
            f"NA means '{phrase}' — {_POLICY_NOTES['NA_ABSENT_CATEGORICAL']}",
        )
    if name in NA_ABSENT_NUMERIC:
        return (
            "fill_zero",
            "NA_ABSENT_NUMERIC",
            f"NA means the companion feature is absent — {_POLICY_NOTES['NA_ABSENT_NUMERIC']}",
        )
    if name == "LotFrontage":
        return (
            "impute_neighborhood_median",
            "LOTFRONTAGE_TRAIN_NEIGHBORHOOD_MEDIAN",
            "true missing — imputed with the train-split Neighborhood median "
            "(clean.py); unseen neighborhoods fall back to the global train median",
        )
    if name == "Electrical":
        return (
            "impute_train_mode",
            "ELECTRICAL_TRAIN_MODE",
            "true missing — imputed with the train-split mode (clean.py)",
        )
    return None


def missing_report(df: pd.DataFrame) -> dict[str, Any]:
    """Missing-value analysis with the pipeline's real treatment policies (§3.6).

    ``columns`` lists every column with missing values plus the exact policy
    :func:`apply_cleaner` will apply; columns with missing values but no
    documented policy land in ``blocking`` — cleaning cannot proceed until they
    are resolved (that is the honest "treatment recommendation").
    """
    n_rows = len(df)
    columns: list[dict[str, Any]] = []
    blocking: list[dict[str, Any]] = []
    for name in df.columns:
        n_missing = int(df[name].isna().sum())
        if not n_missing:
            continue
        pct = round(100.0 * n_missing / n_rows, 1) if n_rows else 0.0
        policy = _policy_for_column(str(name))
        if policy is None:
            blocking.append(
                {
                    "name": str(name),
                    "n_missing": n_missing,
                    "pct_missing": pct,
                    "reason": "no documented NA policy — apply_cleaner will raise; "
                    "cleaning cannot proceed",
                }
            )
            continue
        treatment, policy_name, note = policy
        columns.append(
            {
                "name": str(name),
                "n_missing": n_missing,
                "pct_missing": pct,
                "treatment": treatment,
                "policy": policy_name,
                "note": note,
            }
        )
    columns.sort(key=lambda entry: (-entry["pct_missing"], entry["name"]))
    blocking.sort(key=lambda entry: (-entry["pct_missing"], entry["name"]))
    return {
        "total_missing": int(df.isna().sum().sum()),
        "n_columns_with_missing": len(columns) + len(blocking),
        "n_complete_columns": int(df.shape[1]) - len(columns) - len(blocking),
        "columns": columns,
        "blocking": blocking,
    }


# ---------------------------------------------------------------------------
# §3.7 — visualization aggregations (stage 05, browser-sized payloads)
# ---------------------------------------------------------------------------

def histogram(df: pd.DataFrame, column: str, bins: int = 30) -> dict[str, Any]:
    """Histogram bins + summary stats for a numeric column (§3.7)."""
    _require_numeric(df, column)
    bins = max(1, min(int(bins), _HISTOGRAM_BINS_CAP))
    values = _numeric_values(df, column)
    if not len(values):
        raise ValueError(f"column {column!r} has no non-missing values")
    counts, edges = np.histogram(values.to_numpy(dtype=float), bins=bins)
    return {
        "column": column,
        "bins": [
            {"x0": float(edges[i]), "x1": float(edges[i + 1]), "count": int(counts[i])}
            for i in range(len(counts))
        ],
        "stats": {
            "min": float(values.min()),
            "max": float(values.max()),
            "mean": float(values.mean()),
            "median": float(values.median()),
        },
    }


def scatter(df: pd.DataFrame, x: str, y: str, max_points: int = 1500) -> dict[str, Any]:
    """Seeded-downsampled scatter points for two numeric columns (§3.7).

    Rows with a missing value in either column are dropped; when more than
    ``max_points`` remain, a deterministic ``RANDOM_SEED`` subset is taken
    (``sampled: true``), so the browser always gets a bounded payload.
    """
    _require_numeric(df, x)
    _require_numeric(df, y)
    max_points = max(1, min(int(max_points), _SCATTER_MAX_CAP))
    frame = df[[x, y]].dropna()
    n_total = int(len(frame))
    sampled = n_total > max_points
    if sampled:
        positions = np.sort(
            np.random.default_rng(RANDOM_SEED).choice(n_total, size=max_points, replace=False)
        )
        frame = frame.iloc[positions]
    return {
        "x": x,
        "y": y,
        "points": [
            [float(px), float(py)]
            for px, py in zip(
                pd.to_numeric(frame[x], errors="coerce"),
                pd.to_numeric(frame[y], errors="coerce"),
            )
        ],
        "n_total": n_total,
        "sampled": sampled,
    }


def box_by(df: pd.DataFrame, column: str, by: str) -> dict[str, Any]:
    """Per-group box statistics (min/q1/median/q3/max), sorted by median desc (§3.7).

    Capped at the 25 highest-median groups; ``by`` must be categorical.
    """
    _require_numeric(df, column)
    _require_column(df, by)
    if pd.api.types.is_numeric_dtype(df[by]):
        raise ValueError(f"'by' column {by!r} is numeric — a categorical column is required")
    frame = df[[column, by]].dropna()
    groups: list[dict[str, Any]] = []
    for value, group in frame.groupby(by, sort=False):
        values = pd.to_numeric(group[column], errors="coerce").dropna()
        if not len(values):
            continue
        groups.append(
            {
                "value": str(value),
                "n": int(len(values)),
                "min": float(values.min()),
                "q1": float(values.quantile(0.25)),
                "median": float(values.median()),
                "q3": float(values.quantile(0.75)),
                "max": float(values.max()),
            }
        )
    groups.sort(key=lambda entry: entry["median"], reverse=True)
    return {"column": column, "by": by, "groups": groups[:_BOX_GROUP_CAP]}


def correlation(df: pd.DataFrame, target: str = "SalePrice", top: int = 20) -> dict[str, Any]:
    """Numeric correlation matrix: top ``top`` by |corr with target| + target (§3.7).

    Features are ordered by descending |correlation with the target|; the
    target itself is appended last. Columns whose correlation is undefined
    (constant or all-missing) are excluded.
    """
    _require_numeric(df, target)
    top = max(1, min(int(top), _CORRELATION_TOP_CAP))
    numeric = df.select_dtypes(include="number")
    corr = numeric.corr()
    with_target = corr[target].drop(index=target).dropna()
    ranked = (
        with_target.abs().sort_values(ascending=False, kind="mergesort").index.tolist()
    )
    features = ranked[:top] + [target]
    matrix = [
        [_py(corr.loc[row, col]) for col in features]
        for row in features
    ]
    return {
        "target": target,
        "features": [str(f) for f in features],
        "matrix": matrix,
    }


def category_aggregate(
    df: pd.DataFrame,
    column: str,
    target: str = "SalePrice",
    agg: str = "median",
) -> dict[str, Any]:
    """Per-category aggregate of a numeric target (§3.7).

    ``agg`` ∈ ``median | mean | count``; groups carry ``{value, n, agg_value}``
    sorted by ``agg_value`` descending. For ``count`` the target is unused
    (``agg_value`` equals the group size ``n``).
    """
    _require_column(df, column)
    if agg not in ("median", "mean", "count"):
        raise ValueError(f"unknown agg {agg!r}; expected one of ('median', 'mean', 'count')")
    if agg != "count":
        _require_numeric(df, target)
    frame = df[[column, target]].copy()
    frame[target] = pd.to_numeric(frame[target], errors="coerce")
    frame = frame.dropna(subset=[column] + ([] if agg == "count" else [target]))
    groups: list[dict[str, Any]] = []
    for value, group in frame.groupby(column, sort=False):
        n = int(len(group))
        if agg == "count":
            agg_value: float | None = float(n)
        elif len(group):
            agg_value = float(getattr(group[target], agg)())
        else:
            agg_value = None
        groups.append({"value": str(value), "n": n, "agg_value": _py(agg_value)})
    groups.sort(
        key=lambda entry: entry["agg_value"] if entry["agg_value"] is not None else -math.inf,
        reverse=True,
    )
    return {"column": column, "target": target, "agg": agg, "groups": groups}
