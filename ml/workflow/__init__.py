"""Guided-ML-workflow data core (workflow-architecture §5.1, work package WF-B1).

This package backs the ``/workflow/*`` endpoints: dataset registry
(:mod:`ml.workflow.datasets`), the upload split protocol
(:mod:`ml.workflow.split`), leakage-safe stage-06 preparation
(:mod:`ml.workflow.prepare`) and the stage 01–05 profiling cores
(:mod:`ml.workflow.profile`). Sandbox artifacts live under
``models/workflow/<dataset_id>/`` only (§4.1); champion artifacts,
``data/processed/`` and the prediction log are never written.

The training-side modules (``train``/``evaluate``/``predict``/``train_job``)
are work package WF-B2 and import the names re-exported here.
"""
from __future__ import annotations

from ml.workflow.datasets import (
    BUNDLED_DATASET_ID,
    MAX_UPLOAD_ROWS,
    UPLOADS_ROOT,
    WORKFLOW_MODELS_ROOT,
    CorruptUpload,
    DatasetBusyError,
    DatasetRecord,
    UnknownDataset,
    UploadReport,
    UploadValidationError,
    delete_dataset,
    get_record,
    list_datasets,
    load_dataset_frame,
    read_csv_bytes,
    sandbox_dir,
    save_upload,
    upload_dir,
    validate_upload,
)
from ml.workflow.prepare import (
    LEAKAGE_NOTE,
    MIN_TRAIN_ROWS,
    PrepareConfig,
    PrepareReport,
    load_prepared_splits,
    prepare_dataset,
    preview_report,
)
from ml.workflow.profile import (
    box_by,
    category_aggregate,
    correlation,
    descriptive_stats,
    feature_inventory,
    histogram,
    missing_report,
    profile_dataset,
    scatter,
)
from ml.workflow.split import STRATEGIES, resolve_strategy, split_dataset

__all__ = [
    # datasets
    "BUNDLED_DATASET_ID",
    "MAX_UPLOAD_ROWS",
    "UPLOADS_ROOT",
    "WORKFLOW_MODELS_ROOT",
    "CorruptUpload",
    "DatasetBusyError",
    "DatasetRecord",
    "UnknownDataset",
    "UploadReport",
    "UploadValidationError",
    "delete_dataset",
    "get_record",
    "list_datasets",
    "load_dataset_frame",
    "read_csv_bytes",
    "sandbox_dir",
    "save_upload",
    "upload_dir",
    "validate_upload",
    # split
    "STRATEGIES",
    "resolve_strategy",
    "split_dataset",
    # prepare
    "LEAKAGE_NOTE",
    "MIN_TRAIN_ROWS",
    "PrepareConfig",
    "PrepareReport",
    "load_prepared_splits",
    "prepare_dataset",
    "preview_report",
    # profile
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
