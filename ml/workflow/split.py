"""Train/val/test split protocol for workflow datasets (workflow-architecture §2, §3.8, §4.6).

The bundled ``ames`` dataset never goes through here — its canonical
``data/processed/{train,val,test}.csv`` splits are used in place (§3.8).
Uploads are split by this module:

- ``strategy="time"`` (or ``"auto"`` when ``YrSold`` has ≥ 2 distinct values):
  contiguous blocks sorted by ``(YrSold, MoSold)`` — honoring ADR-4's spirit
  (no future data in train). ``Id`` is the tiebreak so the ordering is fully
  deterministic. ``ml.data.split.time_split`` is deliberately NOT reused: its
  year thresholds are Ames-hardcoded (§3.8).
- ``strategy="random"`` (or ``"auto"`` for single-year data): seeded shuffle.

Determinism (§4.6): the split is a pure function of ``(frame, strategy,
val_frac, test_frac, seed)``; callers persist the resulting split CSVs, not row
assignments. One spec deviation, documented: §4.6 says classification splits
additionally stratify on the *attached* target — impossible inside this pinned
signature, because ``sells_within_30_days`` is attached by stage 06 *after*
the split (§3.8 step order) and fitting the simulator requires a train split.
No stratification is applied; classification CV remains stratified internally
(``StratifiedKFold`` in the trainer).
"""
from __future__ import annotations

import logging

import pandas as pd

from ml.paths import RANDOM_SEED

logger = logging.getLogger(__name__)

__all__ = ["STRATEGIES", "resolve_strategy", "split_dataset"]

#: Accepted ``split_strategy`` values (§3.8 PrepareConfig).
STRATEGIES: tuple[str, ...] = ("auto", "time", "random")

#: Sort keys for the time strategy; ``Id`` is the determinism tiebreak.
_TIME_SORT_KEYS: list[str] = ["YrSold", "MoSold", "Id"]


def resolve_strategy(df: pd.DataFrame, strategy: str) -> str:
    """Resolve ``"auto"`` to the concrete strategy this frame will use (§4.6).

    ``auto`` -> ``"time"`` when ``YrSold`` has ≥ 2 distinct values, else
    ``"random"``. Explicit ``"time"`` on single-year data is rejected: the user
    asked for something the data cannot provide (surfaced as 422 upstream).

    Raises:
        ValueError: unknown strategy, or ``time`` requested without ≥ 2
            distinct ``YrSold`` values.
    """
    if strategy not in STRATEGIES:
        raise ValueError(f"unknown split strategy {strategy!r}; expected one of {STRATEGIES}")
    n_years = int(df["YrSold"].nunique()) if "YrSold" in df.columns else 0
    if strategy == "auto":
        return "time" if n_years >= 2 else "random"
    if strategy == "time" and n_years < 2:
        raise ValueError(
            "strategy='time' requires a YrSold column with >= 2 distinct sale years; "
            f"this dataset has {n_years} — use 'auto' or 'random'"
        )
    return strategy


def split_dataset(
    df: pd.DataFrame,
    strategy: str = "auto",
    val_frac: float = 0.15,
    test_frac: float = 0.15,
    seed: int = RANDOM_SEED,
) -> dict[str, pd.DataFrame]:
    """Split a workflow dataset into ``{"train", "val", "test"}`` (§3.8 step 1).

    Args:
        df: raw dataset frame (uploads: the validated 81-column frame).
        strategy: ``"auto"`` | ``"time"`` | ``"random"`` (see :func:`resolve_strategy`).
        val_frac: fraction of rows for the validation block.
        test_frac: fraction of rows for the test block.
        seed: shuffle seed for the random strategy (``RANDOM_SEED`` = 42 everywhere, §4.6).

    Returns:
        ``{"train": …, "val": …, "test": …}`` — disjoint, exhaustive, index-reset
        frames. Row membership is deterministic in ``(df, strategy, fractions, seed)``.

    Raises:
        ValueError: bad strategy (from :func:`resolve_strategy`), fractions out
            of ``(0, 1)``, fractions leaving no train rows, or an empty frame.
    """
    if not 0.0 < val_frac < 1.0 or not 0.0 < test_frac < 1.0:
        raise ValueError(f"val_frac/test_frac must be in (0, 1), got {val_frac}/{test_frac}")
    if val_frac + test_frac >= 1.0:
        raise ValueError(
            f"val_frac + test_frac must be < 1, got {val_frac} + {test_frac}"
        )
    if len(df) == 0:
        raise ValueError("cannot split an empty frame")
    resolved = resolve_strategy(df, strategy)

    n = len(df)
    n_val = int(round(n * val_frac))
    n_test = int(round(n * test_frac))
    # Tiny-frame guard: never starve train (fractions are validated upstream by
    # PrepareConfig; this keeps direct calls sane on 1–3-row frames).
    while n_test and n - n_val - n_test < 1:
        n_test -= 1
    while n_val and n - n_val - n_test < 1:
        n_val -= 1
    n_train = n - n_val - n_test

    if resolved == "time":
        ordered = df.sort_values(_TIME_SORT_KEYS, kind="mergesort")
    else:
        ordered = df.sample(frac=1.0, random_state=seed)

    splits = {
        "train": ordered.iloc[:n_train].reset_index(drop=True),
        "val": ordered.iloc[n_train : n_train + n_val].reset_index(drop=True),
        "test": ordered.iloc[n_train + n_val :].reset_index(drop=True),
    }
    logger.info(
        "split_dataset: strategy=%s resolved=%s seed=%d -> train=%d val=%d test=%d",
        strategy, resolved, seed, n_train, n_val, n_test,
    )
    return splits
