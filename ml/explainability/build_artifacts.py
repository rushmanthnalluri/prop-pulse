"""Build the global SHAP explainability artifacts for the regression champion.

CLI::

    python -m ml.explainability.build_artifacts

Produces (all values from real computation on the val split, seed 42):

- ``models/explainability/feature_importance.json`` — ``{"importance":
  {base_feature: mean_abs_shap}}`` sorted descending, plus run metadata
  (champion name, explainer kind, background size, feature version).
- ``models/explainability/shap_values_sample.npz`` — aggregated SHAP matrix
  for 200 val rows (``shap_values`` ``(200, n_base)``, ``feature_names``,
  ``expected_value``, ``val_ids``).
- ``figures/shap_bar.png`` — top-20 base features by mean |SHAP|.
- ``figures/shap_summary.png`` — aggregated beeswarm-style summary of the same
  200 val rows (numeric features colored by value percentile, categoricals in
  grey — honestly labelled, no dummy columns anywhere).
- Copies of both PNGs under ``models/explainability/`` (SPEC §6 artifact
  layout lists them there; ``figures/`` remains the canonical report location).
"""
from __future__ import annotations

import logging
import shutil
from datetime import datetime, timezone
from pathlib import Path

import matplotlib

matplotlib.use("Agg")  # headless rendering — no display on this machine

import matplotlib.pyplot as plt
import numpy as np
import pandas as pd

from ml.explainability.explainer import BACKGROUND_SIZE, RegressionExplainer
from ml.paths import (
    DATASET_VERSION,
    FEATURE_LIST_PATH,
    FIGURES_DIR,
    MODELS_DIR,
    RANDOM_SEED,
)
from ml.tracking import feature_version
from ml.training.common import load_split, write_json

logger = logging.getLogger(__name__)

__all__ = [
    "EXPLAINABILITY_DIR",
    "FEATURE_IMPORTANCE_PATH",
    "SHAP_SAMPLE_PATH",
    "BAR_FIGURE_PATH",
    "SUMMARY_FIGURE_PATH",
    "VAL_SAMPLE_SIZE",
    "build_artifacts",
    "main",
]

EXPLAINABILITY_DIR: Path = MODELS_DIR / "explainability"
FEATURE_IMPORTANCE_PATH: Path = EXPLAINABILITY_DIR / "feature_importance.json"
SHAP_SAMPLE_PATH: Path = EXPLAINABILITY_DIR / "shap_values_sample.npz"
BAR_FIGURE_PATH: Path = FIGURES_DIR / "shap_bar.png"
SUMMARY_FIGURE_PATH: Path = FIGURES_DIR / "shap_summary.png"

#: Champion path as stored in metadata (repo-relative, never absolute — SPEC §12).
REGRESSION_CHAMPION_RELATIVE: Path = Path("models") / "registry" / "regression_champion.joblib"

#: Val rows explained for the global artifacts (SPEC: 200-row sample).
VAL_SAMPLE_SIZE: int = 200
#: Features shown in the figures.
TOP_N_PLOT: int = 20

_GREY = "#7f7f7f"  # categorical features in the summary plot
_CMAP = plt.get_cmap("coolwarm")


def _load_val_sample(sample_size: int, seed: int) -> pd.DataFrame:
    """Deterministic val-split feature sample (build_feature_frame order)."""
    from ml.features.pipeline import build_feature_frame

    val = load_split("val")
    frame = build_feature_frame(val)
    sample = frame.sample(n=min(sample_size, len(frame)), random_state=seed)
    # Keep raw Ids alongside for traceability in the npz.
    sample = sample.copy()
    sample["__val_id__"] = val.loc[sample.index, "Id"].to_numpy()
    return sample


def _plot_bar(
    importance: dict[str, float],
    explainer: RegressionExplainer,
    n_rows: int,
    path: Path,
) -> None:
    """Top-20 horizontal bar chart of mean |SHAP| per base feature."""
    top = list(importance.items())[:TOP_N_PLOT]
    names = [name for name, _ in top][::-1]
    values = [value for _, value in top][::-1]

    fig, ax = plt.subplots(figsize=(9, 7))
    ax.barh(names, values, color="#1f77b4", edgecolor="white")
    ax.set_xlabel("mean(|SHAP value|) — average impact on log1p(SalePrice) prediction")
    ax.set_title(
        f"Top-{len(top)} base features — {explainer.model_name} regression champion\n"
        f"(one-hot dummies aggregated; val sample n={n_rows}, seed {RANDOM_SEED})"
    )
    for i, value in enumerate(values):
        ax.text(value, i, f" {value:.4f}", va="center", fontsize=8)
    ax.margins(x=0.12)
    fig.tight_layout()
    fig.savefig(path, dpi=150)
    plt.close(fig)
    logger.info("wrote %s", path)


def _plot_summary(
    shap_values: np.ndarray,
    base_names: list[str],
    feature_frame: pd.DataFrame,
    importance: dict[str, float],
    explainer: RegressionExplainer,
    path: Path,
) -> None:
    """Beeswarm-style summary over aggregated base-feature SHAP values.

    Each point is one val row; x = aggregated SHAP value of the base feature.
    Numeric features are colored by the row's value percentile within the
    sample (blue low → red high); categorical features have no meaningful
    numeric value after aggregation and are honestly plotted in grey.
    """
    top = list(importance)[:TOP_N_PLOT]
    rng = np.random.default_rng(RANDOM_SEED)

    fig, ax = plt.subplots(figsize=(10, 8))
    for rank, base in enumerate(reversed(top)):  # most important at the top
        col = base_names.index(base)
        x = shap_values[:, col]
        y = np.full(x.shape, rank, dtype=float) + rng.uniform(-0.3, 0.3, size=x.shape)
        values = feature_frame[base]
        if pd.api.types.is_numeric_dtype(values):
            pct = values.rank(pct=True).to_numpy(dtype=float)
            ax.scatter(x, y, c=pct, cmap=_CMAP, vmin=0.0, vmax=1.0, s=14, alpha=0.8, linewidths=0)
        else:
            ax.scatter(x, y, c=_GREY, s=14, alpha=0.8, linewidths=0)

    ax.set_yticks(range(len(top)), labels=list(reversed(top)))
    ax.axvline(0.0, color="black", linewidth=0.8, alpha=0.5)
    ax.set_xlabel("Aggregated SHAP value (impact on log1p(SalePrice) prediction)")
    ax.set_title(
        f"SHAP summary — base features of the {explainer.model_name} champion\n"
        f"(one-hot dummies aggregated into base features; val sample n={shap_values.shape[0]}, seed {RANDOM_SEED})"
    )
    sm = plt.cm.ScalarMappable(cmap=_CMAP, norm=plt.Normalize(0.0, 1.0))
    colorbar = fig.colorbar(sm, ax=ax, pad=0.02, aspect=40)
    colorbar.set_label("Numeric feature value percentile (low → high)\ncategorical features shown in grey")
    fig.tight_layout()
    fig.savefig(path, dpi=150)
    plt.close(fig)
    logger.info("wrote %s", path)


def build_artifacts(
    explainer: RegressionExplainer | None = None,
    sample_size: int = VAL_SAMPLE_SIZE,
    seed: int = RANDOM_SEED,
) -> dict[str, float]:
    """Compute and persist all global explainability artifacts.

    Args:
        explainer: Pre-built :class:`RegressionExplainer` (tests may inject);
            a fresh one is constructed from the champion registry otherwise.
        sample_size: Number of val rows explained (default 200, seed 42).
        seed: Sampling seed.

    Returns:
        The ``{base_feature: mean_abs_shap}`` importance mapping (sorted desc).
    """
    if explainer is None:
        explainer = RegressionExplainer()
    EXPLAINABILITY_DIR.mkdir(parents=True, exist_ok=True)
    FIGURES_DIR.mkdir(parents=True, exist_ok=True)

    sample = _load_val_sample(sample_size, seed)
    val_ids = sample.pop("__val_id__").to_numpy()
    shap_values = explainer.explain(sample)
    base_names = explainer.base_feature_names

    importance = {
        base: float(np.mean(np.abs(shap_values[:, idx])))
        for idx, base in enumerate(base_names)
    }
    importance = dict(sorted(importance.items(), key=lambda kv: (-kv[1], kv[0])))

    write_json(
        FEATURE_IMPORTANCE_PATH,
        {
            "metadata": {
                "model": explainer.model_name,
                "model_path": REGRESSION_CHAMPION_RELATIVE.as_posix(),
                "explainer": f"shap.{explainer.explainer_kind}",
                "units": "log1p(SalePrice)",
                "background_size": explainer.background_size,
                "background_split": "train",
                "val_sample_size": int(len(sample)),
                "seed": int(seed),
                "feature_version": feature_version(FEATURE_LIST_PATH),
                "dataset_version": DATASET_VERSION,
                "generated_at": datetime.now(timezone.utc).isoformat(),
                "aggregation": (
                    "one-hot dummy SHAP values summed back to base MODEL_FEATURES "
                    "names; mean taken over |aggregated shap| of the val sample"
                ),
            },
            "importance": importance,
        },
    )
    logger.info("wrote %s (%d base features)", FEATURE_IMPORTANCE_PATH, len(importance))

    np.savez(
        SHAP_SAMPLE_PATH,
        shap_values=shap_values,
        feature_names=np.array(base_names),
        expected_value=np.float64(explainer.expected_value),
        val_ids=val_ids,
    )
    logger.info("wrote %s %s", SHAP_SAMPLE_PATH, shap_values.shape)

    _plot_bar(importance, explainer, len(sample), BAR_FIGURE_PATH)
    _plot_summary(shap_values, base_names, sample, importance, explainer, SUMMARY_FIGURE_PATH)
    # SPEC §6 also lists the PNGs under models/explainability/ — ship copies.
    for figure in (BAR_FIGURE_PATH, SUMMARY_FIGURE_PATH):
        shutil.copyfile(figure, EXPLAINABILITY_DIR / figure.name)

    return importance


def main() -> None:
    """CLI entry point: build artifacts and log the top-10 base features."""
    logging.basicConfig(level=logging.INFO, format="%(levelname)s %(name)s: %(message)s")
    importance = build_artifacts()
    logger.info("top-10 base features by mean |SHAP| (log1p(SalePrice) units):")
    for rank, (feature, value) in enumerate(list(importance.items())[:10], start=1):
        logger.info("  %2d. %-40s %.4f", rank, feature, value)


if __name__ == "__main__":
    main()
