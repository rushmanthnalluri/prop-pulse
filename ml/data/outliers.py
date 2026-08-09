"""Conservative, documented, train-only outlier rules.

Rules are applied to the TRAIN split only (never to val/test — evaluation data
must remain untouched, PROJECT_SPEC §4). Every rule is justified in its
docstring; removed rows are returned in a report dict that the pipeline
persists to ``data/processed/outliers_report.json``.
"""
from __future__ import annotations

import logging

import pandas as pd

logger = logging.getLogger(__name__)


def partial_sale_rule(df: pd.DataFrame) -> pd.Series:
    """Known Ames caveat: ``GrLivArea > 4000`` sqft with a low price.

    Justification: the dataset author (De Cock, 2011) and the Kaggle
    competition documentation flag a handful of very large homes (>4000 sqft
    above grade) that sold unusually cheaply; several are known *partial
    sales* (home not completed when assessed), i.e. not arm's-length market
    transactions. Keeping them badly distorts the price/area relationship in
    training. This is the one rule explicitly allowed by PROJECT_SPEC §4.

    A row matches when ``GrLivArea > 4000`` AND ``SalePrice < 300000`` — the
    price condition keeps legitimately expensive large homes: the raw train
    split contains Ids 692 (4316 sqft, $755,000) and 1183 (4476 sqft,
    $745,000), both >4000 sqft and well above $300k. The ``SalePrice`` guard
    is load-bearing, not insurance — without it those two legitimate luxury
    sales would be deleted.

    Returns a boolean mask of rows to REMOVE.
    """
    return (df["GrLivArea"] > 4000) & (df["SalePrice"] < 300_000)


def apply_outlier_rules(train_df: pd.DataFrame) -> tuple[pd.DataFrame, dict]:
    """Apply all documented outlier rules to the train split.

    Args:
        train_df: raw TRAIN split (must include ``SalePrice``). Rules run on
            the raw split, before cleaning (``ml/data/pipeline.py``); the rule
            columns are unaffected by cleaning.

    Returns:
        ``(filtered_df, report)`` where report lists, per rule, the removed
        ``Id`` values and a one-line justification. Deliberately conservative:
        only the partial-sale rule is active.
    """
    rules = {"partial_sale_grlivarea_gt_4000": partial_sale_rule}
    report: dict[str, dict] = {}
    keep_mask = pd.Series(True, index=train_df.index)
    for name, rule in rules.items():
        remove = rule(train_df)
        removed_ids = train_df.loc[remove, "Id"].tolist()
        report[name] = {
            "removed_ids": [int(i) for i in removed_ids],
            "n_removed": int(len(removed_ids)),
            "justification": rule.__doc__.strip().splitlines()[0] if rule.__doc__ else "",
        }
        keep_mask &= ~remove
        logger.info("Outlier rule %s removed %d rows (Ids: %s)", name, len(removed_ids), removed_ids)

    filtered = train_df.loc[keep_mask].copy()
    report["summary"] = {
        "rows_before": int(len(train_df)),
        "rows_after": int(len(filtered)),
        "applied_to": "train split only",
    }
    return filtered, report
