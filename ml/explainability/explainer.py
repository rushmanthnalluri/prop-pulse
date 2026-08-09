"""Core SHAP machinery for the PropPulse regression champion (SPEC §6/§8).

The champion is a self-contained sklearn ``Pipeline``::

    preprocess: ColumnTransformer  (num: impute+scale, cat: impute+one-hot)
    model:      fitted estimator   (ridge today; a tree ensemble would also work)

This module wraps that pipeline with a SHAP explainer built on a transformed
train-split background sample and — critically — **aggregates SHAP values of
one-hot-expanded dummy columns back to their base feature** (e.g. the 25
``cat__Neighborhood_*`` columns sum into one ``Neighborhood`` contribution), so
every downstream artifact, plot and API payload speaks in ``MODEL_FEATURES``
base names, never in dummy columns.

Explainer selection is automatic: linear estimators (``sklearn.linear_model``)
use :class:`shap.LinearExplainer`; tree ensembles (``sklearn.ensemble`` /
``sklearn.tree`` / ``xgboost`` / ``lightgbm``) use :class:`shap.TreeExplainer`
— so a future champion swap needs no code change here.
"""
from __future__ import annotations

import logging
from pathlib import Path
from typing import Collection

import joblib
import numpy as np
import pandas as pd
from sklearn.compose import ColumnTransformer

from ml.features.pipeline import MODEL_FEATURES, build_feature_frame
from ml.paths import RANDOM_SEED, REGISTRY_DIR
from ml.training.common import load_split

logger = logging.getLogger(__name__)

__all__ = [
    "REGRESSION_CHAMPION_PATH",
    "BACKGROUND_SIZE",
    "parse_base_name",
    "aggregate_shap",
    "RegressionExplainer",
]

#: Default champion artifact (SPEC §6 registry contract).
REGRESSION_CHAMPION_PATH: Path = REGISTRY_DIR / "regression_champion.joblib"

#: Transformed train rows used as the SHAP background/reference distribution.
BACKGROUND_SIZE: int = 200

#: sklearn/shap name-mangling prefixes used by the champion preprocessor.
_NUM_PREFIX = "num__"
_CAT_PREFIX = "cat__"

#: Module-prefix → explainer kind. Anything else is a hard error (loud, never
#: silently wrong explanations).
_LINEAR_MODULES = ("sklearn.linear_model",)
_TREE_MODULES = ("sklearn.ensemble", "sklearn.tree", "xgboost", "lightgbm")


def parse_base_name(
    transformed_name: str, known_features: Collection[str] = MODEL_FEATURES
) -> str:
    """Map one transformed column name back to its base ``MODEL_FEATURES`` name.

    ``num__GrLivArea`` → ``GrLivArea``; ``cat__Neighborhood_NridgHt`` →
    ``Neighborhood``. Categorical dummies are resolved by longest-prefix match
    against the known feature list, which is unambiguous because no Ames
    categorical column name contains an underscore; values with spaces
    (``cat__MSZoning_C (all)``) parse correctly too.
    """
    if transformed_name.startswith(_NUM_PREFIX):
        return transformed_name[len(_NUM_PREFIX):]
    if transformed_name.startswith(_CAT_PREFIX):
        rest = transformed_name[len(_CAT_PREFIX):]
        matches = [f for f in known_features if rest.startswith(f + "_")]
        if matches:
            return max(matches, key=len)
        # Unknown base column (feature list drift): fall back to stripping the
        # category suffix rather than crashing the explanation path.
        logger.warning("unrecognized categorical base in %r; using rsplit fallback", transformed_name)
        return rest.rsplit("_", 1)[0]
    # No prefix (e.g. passthrough remainder column): already a base name.
    return transformed_name


def aggregate_shap(
    shap_values: np.ndarray, transformed_names: list[str]
) -> tuple[np.ndarray, list[str]]:
    """Sum per-dummy SHAP values into per-base-feature SHAP values.

    Args:
        shap_values: ``(n_rows, n_transformed)`` SHAP matrix in transformed space.
        transformed_names: the ``n_transformed`` preprocessor output names.

    Returns:
        ``(aggregated, base_names)`` where ``aggregated`` is
        ``(n_rows, n_base)`` and ``base_names`` lists the base features in
        order of first appearance (numeric block first, then categoricals —
        the preprocessor's output order).
    """
    shap_values = np.asarray(shap_values, dtype=float)
    if shap_values.ndim != 2 or shap_values.shape[1] != len(transformed_names):
        raise ValueError(
            f"shap_values shape {shap_values.shape} does not match "
            f"{len(transformed_names)} transformed names"
        )
    base_per_column = [parse_base_name(name) for name in transformed_names]
    base_names = list(dict.fromkeys(base_per_column))  # ordered unique
    aggregated = np.zeros((shap_values.shape[0], len(base_names)), dtype=float)
    for col_idx, base in enumerate(base_per_column):
        aggregated[:, base_names.index(base)] += shap_values[:, col_idx]
    return aggregated, base_names


class RegressionExplainer:
    """SHAP explainer over the regression champion, in base-feature space.

    Args:
        model_path: Fitted champion pipeline (``preprocess`` + ``model`` steps).
        background_size: Train rows sampled (seed 42) as the SHAP background.
        seed: Sampling seed — fixed at 42 per SPEC §12.

    Raises:
        RuntimeError: If the model, processed train split or feature artifacts
            are missing, the pipeline has no ``ColumnTransformer``, or the
            final estimator is neither linear nor a supported tree ensemble.
    """

    def __init__(
        self,
        model_path: Path = REGRESSION_CHAMPION_PATH,
        background_size: int = BACKGROUND_SIZE,
        seed: int = RANDOM_SEED,
    ) -> None:
        model_path = Path(model_path)
        if not model_path.exists():
            raise RuntimeError(
                f"regression champion not found at {model_path} — run "
                "`python -m ml.training.train_regression` and the registry step first"
            )
        pipeline = joblib.load(model_path)
        steps = getattr(pipeline, "steps", None)
        if not steps:
            raise RuntimeError(
                f"regression champion at {model_path} is not an sklearn Pipeline "
                f"(got {type(pipeline).__name__}); cannot split preprocessing from model"
            )
        preprocessor = next(
            (step for _, step in steps if isinstance(step, ColumnTransformer)), None
        )
        if preprocessor is None:
            raise RuntimeError(
                "regression champion pipeline has no ColumnTransformer step; "
                "expected the shared ml.training.common.build_preprocessor layout"
            )
        self._model = steps[-1][1]
        self._preprocessor = preprocessor
        self.model_name: str = type(self._model).__name__

        # Transformed feature space + base-name mapping (one-hot aggregation).
        self.transformed_feature_names: list[str] = [
            str(n) for n in preprocessor.get_feature_names_out()
        ]
        parsed = [parse_base_name(n) for n in self.transformed_feature_names]
        unknown = sorted(set(parsed) - set(MODEL_FEATURES))
        if unknown:
            raise RuntimeError(
                f"champion preprocessor outputs columns outside MODEL_FEATURES: "
                f"{unknown} — feature_list.json and the champion are out of sync; "
                "retrain or regenerate `python -m ml.features.pipeline`"
            )
        self.base_feature_names: list[str] = list(dict.fromkeys(parsed))

        # Transformed train background (the SHAP reference distribution).
        try:
            train = load_split("train")
        except FileNotFoundError as exc:
            raise RuntimeError(f"cannot build SHAP background: {exc}") from exc
        feature_frame = build_feature_frame(train)
        background = feature_frame.sample(n=background_size, random_state=seed)
        self.background_size = int(background_size)
        self._background = np.asarray(preprocessor.transform(background), dtype=float)

        self._explainer = self._build_explainer()
        self.expected_value: float = float(
            np.atleast_1d(self._explainer.expected_value)[0]
        )
        logger.info(
            "RegressionExplainer ready: %s via %s, %d transformed -> %d base features, "
            "background %d rows, expected_value=%.4f",
            self.model_name, self.explainer_kind,
            len(self.transformed_feature_names), len(self.base_feature_names),
            self.background_size, self.expected_value,
        )

    @property
    def explainer_kind(self) -> str:
        """``"LinearExplainer"`` or ``"TreeExplainer"`` (auto-detected)."""
        module = type(self._model).__module__
        if module.startswith(_LINEAR_MODULES):
            return "LinearExplainer"
        if module.startswith(_TREE_MODULES):
            return "TreeExplainer"
        raise RuntimeError(
            f"unsupported champion estimator {self.model_name} ({module}); "
            f"supported: linear models { _LINEAR_MODULES } or tree ensembles "
            f"{_TREE_MODULES}"
        )

    def _build_explainer(self):  # -> shap.Explainer (typed loosely: shap has no stable base type)
        """Instantiate the SHAP explainer for the final estimator."""
        import shap  # local import: heavy (numba) — pay it only when explaining

        kind = self.explainer_kind  # raises RuntimeError for unsupported models
        if kind == "LinearExplainer":
            # Independent masker with max_samples >= background size so the full
            # 200-row background is used (shap would otherwise subsample to 100).
            masker = shap.maskers.Independent(
                self._background, max_samples=len(self._background)
            )
            return shap.LinearExplainer(self._model, masker)
        return shap.TreeExplainer(self._model, self._background)

    def explain(self, feature_frame: pd.DataFrame) -> np.ndarray:
        """Aggregated per-base-feature SHAP values for ``feature_frame``.

        Args:
            feature_frame: Model-ready frame in ``MODEL_FEATURES`` order (the
                output of :func:`ml.features.pipeline.build_feature_frame`);
                extra columns are dropped, missing columns are an error.

        Returns:
            ``(n_rows, n_base)`` SHAP matrix in ``log1p(SalePrice)`` units,
            columns aligned with :attr:`base_feature_names`. For every row,
            ``shap.sum() + expected_value == model prediction`` (additivity).
        """
        missing = [c for c in MODEL_FEATURES if c not in feature_frame.columns]
        if missing:
            raise ValueError(
                f"feature_frame is missing {len(missing)} MODEL_FEATURES columns "
                f"(e.g. {missing[:5]}); pass the output of build_feature_frame"
            )
        transformed = np.asarray(
            self._preprocessor.transform(feature_frame[MODEL_FEATURES]), dtype=float
        )
        shap_values = np.asarray(self._explainer.shap_values(transformed), dtype=float)
        if shap_values.ndim == 3:  # defensive: multi-output explainers
            shap_values = shap_values[:, :, 0]
        aggregated, _ = aggregate_shap(shap_values, self.transformed_feature_names)
        return aggregated

    def explain_one(self, feature_row: pd.DataFrame) -> dict[str, float]:
        """Aggregated SHAP values of a single-row feature frame as a dict."""
        if len(feature_row) != 1:
            raise ValueError(
                f"explain_one expects exactly one row, got {len(feature_row)}"
            )
        vector = self.explain(feature_row)[0]
        return dict(zip(self.base_feature_names, vector.tolist(), strict=True))
