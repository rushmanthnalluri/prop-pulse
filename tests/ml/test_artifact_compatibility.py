"""Runtime compatibility checks for the committed champion artifacts.

The repository ships trusted first-party joblib pipelines. Their scikit-learn
version must match the pinned runtime exactly; loading a mismatched pickle is
unsupported and emits InconsistentVersionWarning.
"""
from __future__ import annotations

import warnings
from pathlib import Path

import joblib
from sklearn.exceptions import InconsistentVersionWarning

from ml.paths import REPO_ROOT


SERVING_ARTIFACTS = (
    Path("models/registry/regression_champion.joblib"),
    Path("models/registry/classification_champion.joblib"),
    Path("models/clustering/dbscan.joblib"),
)


def test_champion_artifacts_match_runtime_sklearn_version() -> None:
    """Both production champions load without sklearn version mismatch warnings."""
    for relative_path in SERVING_ARTIFACTS:
        artifact = REPO_ROOT / relative_path
        assert artifact.is_file(), f"missing committed champion: {relative_path}"
        with warnings.catch_warnings(record=True) as caught:
            warnings.simplefilter("always", InconsistentVersionWarning)
            joblib.load(artifact)
        mismatches = [w for w in caught if issubclass(w.category, InconsistentVersionWarning)]
        assert not mismatches, (
            f"{relative_path} was serialized with another scikit-learn version: "
            + "; ".join(str(w.message) for w in mismatches)
        )
