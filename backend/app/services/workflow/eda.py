"""EDA dispatch service for workflow stages 01-05 (workflow-architecture §3.3-§3.7, §5.2).

Every method loads the raw frame via ``ml.workflow.datasets`` and delegates to
the pure profiling cores in ``ml.workflow.profile`` (payloads are computed per
request — < 1 s at the 20k-row cap, so no cache, §3.3). Mapping: unknown
dataset -> 404; unknown/mistyped columns and bad viz parameters (``ValueError``
from the cores) -> 422 with the string detail (CONTRACT §5.11).
"""
from __future__ import annotations

from typing import Any, Callable

import pandas as pd
from fastapi import HTTPException

from ml.workflow import profile as wf_profile
from ml.workflow.datasets import UnknownDataset, get_record, load_dataset_frame

#: The §3.7 visualization kinds -> (profiling function, required query params).
_VIZ_DISPATCH: dict[str, Callable[..., dict[str, Any]]] = {
    "histogram": wf_profile.histogram,
    "scatter": wf_profile.scatter,
    "box": wf_profile.box_by,
    "correlation": wf_profile.correlation,
    "category": wf_profile.category_aggregate,
}


class WorkflowEdaService:
    """Stateless adapter over ``ml.workflow.profile`` (one per request, §5.3)."""

    @staticmethod
    def _frame_or_404(dataset_id: str) -> pd.DataFrame:
        """The raw frame for a dataset; 404 on unknown/malformed ids."""
        try:
            get_record(dataset_id)  # 404 gate before any heavy read
            return load_dataset_frame(dataset_id)
        except UnknownDataset as exc:
            raise HTTPException(status_code=404, detail=str(exc)) from exc

    def profile(self, dataset_id: str) -> dict[str, Any]:
        """Stage-01 result payload (§3.3); ``dataset_id``/``name`` added here."""
        try:
            record = get_record(dataset_id)
        except UnknownDataset as exc:
            raise HTTPException(status_code=404, detail=str(exc)) from exc
        payload = wf_profile.profile_dataset(self._frame_or_404(dataset_id))
        return {"dataset_id": record.dataset_id, "name": record.name, **payload}

    def features(self, dataset_id: str) -> dict[str, Any]:
        """Stage-02 feature inventory + objective/target reporting (§3.4)."""
        return wf_profile.feature_inventory(self._frame_or_404(dataset_id))

    def stats(self, dataset_id: str) -> dict[str, Any]:
        """Stage-03 descriptive statistics (§3.5)."""
        return wf_profile.descriptive_stats(self._frame_or_404(dataset_id))

    def missing(self, dataset_id: str) -> dict[str, Any]:
        """Stage-04 missing-value analysis + treatment policies (§3.6)."""
        return wf_profile.missing_report(self._frame_or_404(dataset_id))

    def viz(self, dataset_id: str, kind: str, **params: Any) -> dict[str, Any]:
        """Stage-05 pre-aggregated chart payload (§3.7).

        Raises:
            HTTPException: 404 unknown dataset or unknown viz ``kind``;
                422 unknown/mistyped columns (``ValueError`` from the cores).
        """
        fn = _VIZ_DISPATCH.get(kind)
        if fn is None:
            raise HTTPException(
                status_code=404,
                detail=f"unknown viz kind {kind!r}; expected one of {sorted(_VIZ_DISPATCH)}",
            )
        frame = self._frame_or_404(dataset_id)
        try:
            return fn(frame, **params)
        except ValueError as exc:
            raise HTTPException(status_code=422, detail=str(exc)) from exc


__all__ = ["WorkflowEdaService"]
