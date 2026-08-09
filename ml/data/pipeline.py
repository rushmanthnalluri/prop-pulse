"""End-to-end data pipeline CLI: raw Ames CSV -> processed splits.

Usage (from repo root)::

    .venv/Scripts/python.exe -m ml.data.pipeline

Steps (order matters — every fitted statistic is train-only, per SPEC §4):

1. ingest raw ``train.csv`` and validate the raw schema;
2. time-split (train YrSold<=2008 / val 2009 / test 2010, ADR-4);
3. apply documented outlier rules to TRAIN only (partial-sale rule);
4. fit the cleaner on train, apply to all splits (NA semantics per
   ``data_description.txt``; LotFrontage by train neighborhood median);
5. select the days-on-market provider (env ``DOM_PROVIDER``; default: the
   seeded simulator fitted on train — SIMULATED target; ``csv``: observed DOM
   from ``DOM_CSV_PATH``) and attach ``days_on_market`` /
   ``sells_within_30_days`` to all splits;
6. join approximate neighborhood centroids (ADR-2);
7. validate every processed split and write
   ``data/processed/{train,val,test}.csv`` + ``schema.json``.
"""
from __future__ import annotations

import argparse
import json
import logging
import os
from pathlib import Path

import pandas as pd

from ml.data.clean import apply_cleaner, fit_cleaner
from ml.data.ingest import load_neighborhood_geo, load_raw_train
from ml.data.outliers import apply_outlier_rules
from ml.data.sale_speed import (
    DomProvider,
    RealDomProvider,
    SaleSpeedSimulator,
    attach_sale_speed,
)
from ml.data.split import time_split
from ml.data.validate import validate_processed, validate_raw, write_schema_json
from ml.paths import DATASET_VERSION, EXTERNAL_DIR, PROCESSED_DIR, RANDOM_SEED, REPO_ROOT

logger = logging.getLogger(__name__)

#: Env vars selecting the days-on-market provider (ADR-3).
DOM_PROVIDER_ENV = "DOM_PROVIDER"
DOM_CSV_PATH_ENV = "DOM_CSV_PATH"
DEFAULT_DOM_CSV_PATH = EXTERNAL_DIR / "days_on_market.csv"

SIMULATED_DOM_NOTE = (
    "days_on_market / sells_within_30_days are SIMULATED (ml/data/sale_speed.py, seed 42)."
)
OBSERVED_DOM_NOTE = (
    "days_on_market / sells_within_30_days come from OBSERVED data "
    "(DOM_PROVIDER=csv; see data/README.md 'Using real days-on-market data')."
)

PIPELINE_NOTES = [
    SIMULATED_DOM_NOTE,
    "lat/long are approximate neighborhood centroids (data/external/neighborhood_geo.csv, ADR-2).",
    "LotFrontage imputed with train-split neighborhood medians.",
    "Outlier rules applied to train only; see data/processed/outliers_report.json.",
    "Absent features are stored as the literal string 'None' with no NaNs anywhere; "
    "readers should use pd.read_csv(..., keep_default_na=False) to preserve this.",
]


def join_neighborhood_geo(df: pd.DataFrame, geo: pd.DataFrame) -> pd.DataFrame:
    """Join approximate neighborhood centroids onto a split (ADR-2)."""
    merged = df.merge(geo[["Neighborhood", "lat", "long"]], on="Neighborhood", how="left")
    if merged["lat"].isna().any():
        missing = merged.loc[merged["lat"].isna(), "Neighborhood"].unique().tolist()
        raise ValueError(f"No geo centroid for neighborhoods: {missing}")
    return merged


def select_dom_provider(train_df: pd.DataFrame) -> tuple[DomProvider, str]:
    """Select and prepare the days-on-market provider from the environment (ADR-3).

    Reads two env vars:

    - ``DOM_PROVIDER``: ``simulated`` (default) — the seeded
      :class:`SaleSpeedSimulator` fitted on ``train_df``; or ``csv`` —
      :class:`RealDomProvider` over observed data. A set-but-empty value
      (``DOM_PROVIDER=``, a common .env pattern) is treated as unset, i.e.
      the simulated default.
    - ``DOM_CSV_PATH``: observed-DOM CSV for the ``csv`` provider (default
      ``data/external/days_on_market.csv``). A relative path is resolved
      against the repository root (``ml.paths.REPO_ROOT``), not the process
      CWD.

    Args:
        train_df: cleaned, trimmed train split — used to fit the simulator
            (ignored by the csv provider).

    Returns:
        ``(provider, note)``: a ready-to-use provider plus the
        ``schema.json`` note describing the target's provenance.

    Raises:
        ValueError: on an unknown non-empty ``DOM_PROVIDER`` value.
        FileNotFoundError: ``csv`` selected but the CSV is missing — raised
            before any pipeline output is written, with a fix-it message.
    """
    # Set-but-empty (or whitespace-only) means "unset" -> simulated default.
    kind = os.environ.get(DOM_PROVIDER_ENV, "").strip().lower() or "simulated"
    if kind == "csv":
        csv_path = Path(os.environ.get(DOM_CSV_PATH_ENV, str(DEFAULT_DOM_CSV_PATH))).expanduser()
        # Anchor relative paths to the repo root so resolution is independent
        # of the process CWD (the default is already absolute via ml.paths).
        if not csv_path.is_absolute():
            csv_path = REPO_ROOT / csv_path
        if not csv_path.exists():
            raise FileNotFoundError(
                f"{DOM_PROVIDER_ENV}=csv but no DOM file at {csv_path}. Provide a CSV with "
                "columns 'Id,days_on_market' (integer days in [1, 365], unique Ids) at that "
                f"path, point {DOM_CSV_PATH_ENV} at it, or use {DOM_PROVIDER_ENV}=simulated."
            )
        provider: DomProvider = RealDomProvider(csv_path)
        logger.info("DOM provider: csv - OBSERVED days_on_market from %s", csv_path)
        return provider, OBSERVED_DOM_NOTE
    if kind != "simulated":
        raise ValueError(f"Unknown {DOM_PROVIDER_ENV}={kind!r}; expected 'simulated' or 'csv'.")
    provider = SaleSpeedSimulator(seed=RANDOM_SEED).fit(train_df)
    logger.info(
        "DOM provider: simulated (SaleSpeedSimulator, seed %d) - SIMULATED target, "
        "classification metrics are not real-world performance claims",
        RANDOM_SEED,
    )
    return provider, SIMULATED_DOM_NOTE


def run_pipeline(output_dir: Path = PROCESSED_DIR) -> dict[str, int]:
    """Run the full pipeline and write processed artifacts.

    Returns:
        Row counts per split, e.g. ``{"train": 945, "val": 338, "test": 175}``.
    """
    output_dir.mkdir(parents=True, exist_ok=True)

    raw = validate_raw(load_raw_train())
    geo = load_neighborhood_geo()

    splits = time_split(raw)

    # Outliers: train split only, before fitting anything (SPEC §4).
    trimmed_train, outlier_report = apply_outlier_rules(splits["train"])
    splits["train"] = trimmed_train

    # Cleaning statistics fitted on the (trimmed) train split only.
    cleaner = fit_cleaner(splits["train"])
    splits = {name: apply_cleaner(df, cleaner) for name, df in splits.items()}

    # DOM target: simulated by default, observed when DOM_PROVIDER=csv (ADR-3).
    # Fitted/loaded here and attached to every split.
    provider, dom_note = select_dom_provider(splits["train"])
    splits = {name: attach_sale_speed(df, provider) for name, df in splits.items()}

    # Approximate geo centroids.
    splits = {name: join_neighborhood_geo(df, geo) for name, df in splits.items()}

    counts: dict[str, int] = {}
    for name, df in splits.items():
        validate_processed(df, name)
        out_path = output_dir / f"{name}.csv"
        df.to_csv(out_path, index=False)
        counts[name] = len(df)
        logger.info("Wrote %s (%d rows)", out_path, len(df))

    notes = [dom_note, *PIPELINE_NOTES[1:]]
    write_schema_json(splits, output_dir / "schema.json", DATASET_VERSION, notes)
    (output_dir / "outliers_report.json").write_text(json.dumps(outlier_report, indent=2))
    return counts


def main() -> None:
    """CLI entry point."""
    parser = argparse.ArgumentParser(description="Run the PropPulse data pipeline.")
    parser.add_argument(
        "--output-dir", type=Path, default=PROCESSED_DIR,
        help="Where to write processed CSVs and schema.json (default: data/processed).",
    )
    parser.add_argument("--verbose", action="store_true", help="DEBUG logging.")
    args = parser.parse_args()

    logging.basicConfig(
        level=logging.DEBUG if args.verbose else logging.INFO,
        format="%(levelname)s %(name)s: %(message)s",
    )
    counts = run_pipeline(args.output_dir)
    logger.info("Pipeline complete: %s", counts)


if __name__ == "__main__":
    main()
