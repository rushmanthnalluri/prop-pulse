"""Workflow training-job runner (workflow-architecture §3.9, work package WF-B2).

The API spawns this module as a subprocess —

    python -m ml.workflow.train_job --dataset <id> --job <id> \
        --objective regression|classification|clustering --candidates <name> [<name> …]

(``--candidates`` also accepts a single comma-separated value) — and polls the
job's ``status.json``. Rationale (§3.9): the subprocess isolates CPU-heavy
fitting from the serving process, contains crashes, and makes every
``lru_cache`` staleness concern moot (fresh interpreter per job, §4.4).

``status.json`` protocol (the pinned WF-B3 contract, §3.9): the file lives at
``models/workflow/<dataset_id>/jobs/<job_id>/status.json`` and is rewritten
**atomically** (sibling temp file + ``os.replace``) on every transition —
queued -> (preparing ->) running -> done|failed — and after every candidate::

    {"job_id", "dataset_id", "objective",
     "status": "queued|preparing|running|done|failed",
     "progress": {"done", "total", "current", "elapsed_s"},
     "results": {"<candidate>": {"status": "pending|running|done|failed",
                                 "val_metrics"?, "best_params"?,
                                 "cv_best_score"?, "train_seconds"?, "error?"}},
     "prepare_fingerprint": "<sha1 of the prepare config + dataset hash>",
     "error": null | "<message>",
     "created_at": "<iso>", "finished_at": null | "<iso>"}

``prepare_fingerprint`` (red-team F1) is persisted when the job starts —
after the auto-prepare self-heal, so it always names the split the job
actually trains on. The serving layer compares it against the *current*
prepare fingerprint to flag stale-split results after a re-prepare.

A failed candidate never fails the job (§6.4); the job is ``done`` when at
least one candidate succeeded, ``failed`` when every candidate failed or the
wave itself raised (bad objective/candidates, prepare failure, …). Exit code
is 0 on ``done``, 1 on ``failed``.

Safety (§4.1/§4.2): the output root is asserted to resolve inside
``models/workflow/`` and to contain no champion-artifact path component
before anything is written; no MLflow is imported or logged (provenance lives
in ``status.json``); the sandbox test split is never read.

Testing/deployment hooks: ``PROPULSE_UPLOADS_ROOT`` and
``PROPULSE_WORKFLOW_MODELS_ROOT`` environment variables rebind the WF-B1
storage roots (:mod:`ml.workflow.datasets` module constants) before any work,
so tests and non-standard deployments can redirect every write.
"""
from __future__ import annotations

import argparse
import json
import logging
import os
import re
import sys
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from ml.workflow import datasets
from ml.workflow.datasets import UnknownDataset, sandbox_dir
from ml.workflow.prepare import (
    PrepareConfig,
    load_prepared_splits,
    prepare_dataset,
    preview_report,
)
from ml.workflow.train import (
    EVENT_CANDIDATE_DONE,
    EVENT_CANDIDATE_FAILED,
    EVENT_CANDIDATE_STARTED,
    train_objective,
    valid_candidates,
)

logger = logging.getLogger(__name__)

__all__ = [
    "JOB_ID_RE",
    "assert_sandbox_output",
    "job_dir_for",
    "main",
    "run_job",
]

#: Job ids are ``"job_" + uuid8`` (§3.9); regex-validated before any path touch.
JOB_ID_RE = re.compile(r"^job_[0-9a-f]{8}$")

#: §4.1 — the output root may contain none of these champion-artifact
#: components (checked against every resolved path part).
_FORBIDDEN_COMPONENTS = frozenset(
    {
        "registry",
        "regression",
        "classification",
        "champion.json",
        "feature_list.json",
        "feature_defaults.json",
        "neighborhood_stats.json",
    }
)

_STATUS_NAME = "status.json"


def _utc_now_iso() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def _apply_root_overrides() -> None:
    """Rebind WF-B1 storage roots from the environment (testing hook)."""
    uploads = os.environ.get("PROPULSE_UPLOADS_ROOT")
    models = os.environ.get("PROPULSE_WORKFLOW_MODELS_ROOT")
    if uploads:
        datasets.UPLOADS_ROOT = Path(uploads)
    if models:
        datasets.WORKFLOW_MODELS_ROOT = Path(models)


def assert_sandbox_output(path: Path) -> Path:
    """Assert ``path`` resolves inside the workflow sandbox root (§4.1).

    The resolved path must stay under ``WORKFLOW_MODELS_ROOT``
    (``models/workflow/``) and none of its components may be a champion
    artifact name (``registry``, ``regression``, ``classification``,
    ``champion.json``, ``feature_list.json``, ``feature_defaults.json``,
    ``neighborhood_stats.json``).

    Raises:
        RuntimeError: on any containment violation (review-blocker, §4.1).
    """
    root = datasets.WORKFLOW_MODELS_ROOT.resolve()
    resolved = Path(path).resolve()
    if os.path.commonpath([str(root), str(resolved)]) != str(root):
        raise RuntimeError(
            f"sandbox output root escapes {root}: {path} — writes outside "
            "models/workflow/ are a review-blocker (§4.1)"
        )
    forbidden = _FORBIDDEN_COMPONENTS & set(resolved.parts)
    if forbidden:
        raise RuntimeError(
            f"sandbox output path contains champion-artifact component(s) "
            f"{sorted(forbidden)}: {resolved} (§4.1)"
        )
    return resolved


def job_dir_for(dataset_id: str, job_id: str) -> Path:
    """The job's sandbox directory ``models/workflow/<dataset_id>/jobs/<job_id>/``.

    Raises:
        ValueError: malformed job id (-> failed status cannot even be written;
            the CLI exits 2).
        UnknownDataset: malformed dataset id.
    """
    if not JOB_ID_RE.fullmatch(job_id):
        raise ValueError(f"malformed job id: {job_id!r} (expected job_[0-9a-f]{{8}})")
    return sandbox_dir(dataset_id) / "jobs" / job_id


def _write_status(job_dir: Path, payload: dict[str, Any]) -> None:
    """Atomically rewrite ``status.json`` (tmp sibling + ``os.replace``)."""
    job_dir.mkdir(parents=True, exist_ok=True)
    path = job_dir / _STATUS_NAME
    tmp = path.with_name(path.name + ".tmp")
    tmp.write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8")
    os.replace(tmp, path)


def run_job(
    dataset_id: str,
    job_id: str,
    objective: str,
    candidates: list[str],
) -> int:
    """Run one training job end-to-end, maintaining ``status.json``. Returns the exit code."""
    try:
        job_dir = assert_sandbox_output(job_dir_for(dataset_id, job_id))
    except (ValueError, UnknownDataset) as exc:
        logger.error("job rejected before start: %s", exc)
        return 2

    started = time.perf_counter()
    created_at = _utc_now_iso()
    status: dict[str, Any] = {
        "job_id": job_id,
        "dataset_id": dataset_id,
        "objective": objective,
        "status": "queued",
        "progress": {
            "done": 0,
            "total": len(candidates),
            "current": None,
            "elapsed_s": 0.0,
        },
        "results": {name: {"status": "pending"} for name in candidates},
        "error": None,
        "created_at": created_at,
        "finished_at": None,
    }

    def _flush(status_value: str | None = None) -> None:
        if status_value is not None:
            status["status"] = status_value
        status["progress"]["elapsed_s"] = round(time.perf_counter() - started, 3)
        _write_status(job_dir, status)

    def _fail(message: str) -> int:
        status["error"] = message
        status["finished_at"] = _utc_now_iso()
        _flush("failed")
        logger.error("job %s failed: %s", job_id, message)
        return 1

    _flush("queued")

    # Validate the request before any heavy work (§3.9: 422 lists valid candidates).
    try:
        valid = valid_candidates(objective)
    except ValueError as exc:
        return _fail(str(exc))
    unknown = [c for c in candidates if c not in valid]
    if unknown or not candidates:
        return _fail(
            f"unknown candidates for objective {objective!r}: {unknown}; "
            f"valid candidates: {list(valid)}"
        )

    try:
        # §3.9 self-healing: an unprepared dataset is auto-prepared with the
        # default config, surfaced explicitly as the ``preparing`` phase.
        # "Prepared" means the stage-06 sandbox artifacts exist — for the
        # bundled ames the canonical splits ALWAYS exist (they are read in
        # place), so checking the splits alone would skip the auto-prepare
        # and crash the wave on the missing sandbox neighborhood stats.
        needs_prepare = False
        try:
            load_prepared_splits(dataset_id)
            needs_prepare = not (
                sandbox_dir(dataset_id) / "neighborhood_stats.json"
            ).exists()
        except FileNotFoundError:
            needs_prepare = True
        if needs_prepare:
            _flush("preparing")
            logger.info("dataset %s not prepared — auto-preparing (default config)", dataset_id)
            prepare_dataset(dataset_id, PrepareConfig())

        # Red-team F1: bind the job to the prepare fingerprint it trains on.
        # A later re-prepare changes the fingerprint, and the serving layer
        # (models merge / sandbox predict) flags this job's results as
        # stale-split instead of silently mixing old-split numbers with
        # new-split provenance.
        report = preview_report(dataset_id)
        status["prepare_fingerprint"] = report.fingerprint if report is not None else None
        _flush()

        def _on_progress(event: dict[str, Any]) -> None:
            name = event["candidate"]
            kind = event["event"]
            if kind == EVENT_CANDIDATE_STARTED:
                status["results"][name] = {"status": "running"}
                status["progress"]["current"] = name
                _flush("running")
            elif kind == EVENT_CANDIDATE_DONE:
                status["results"][name] = event["result"]
                status["progress"]["done"] += 1
                status["progress"]["current"] = None
                _flush()
            elif kind == EVENT_CANDIDATE_FAILED:
                status["results"][name] = {"status": "failed", "error": event["error"]}
                status["progress"]["done"] += 1
                status["progress"]["current"] = None
                _flush()

        results = train_objective(
            dataset_id, job_dir, objective, candidates, progress_cb=_on_progress
        )
        n_done = sum(1 for r in results.values() if r["status"] == "done")
        status["finished_at"] = _utc_now_iso()
        if n_done == 0:
            return _fail(
                f"every candidate failed: "
                f"{ {n: r.get('error', '?') for n, r in results.items()} }"
            )
        _flush("done")
        logger.info(
            "job %s done in %.1fs (%d/%d candidates succeeded)",
            job_id,
            time.perf_counter() - started,
            n_done,
            len(results),
        )
        return 0
    except Exception as exc:  # noqa: BLE001 — the crash is contained in this subprocess
        logger.exception("job %s aborted", job_id)
        return _fail(f"{type(exc).__name__}: {exc}")


def _parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        prog="python -m ml.workflow.train_job",
        description="Run one workflow training job (§3.9); maintains status.json.",
    )
    parser.add_argument("--dataset", required=True, help="dataset id (ames|ds_xxxxxxxx)")
    parser.add_argument("--job", required=True, help="job id (job_[0-9a-f]{8})")
    parser.add_argument(
        "--objective",
        required=True,
        choices=["regression", "classification", "clustering"],
    )
    parser.add_argument(
        "--candidates",
        required=True,
        nargs="+",
        help="candidate names (space- or comma-separated)",
    )
    return parser.parse_args(argv)


def main(argv: list[str] | None = None) -> int:
    """CLI entry point. Exit 0 on done, 1 on failed, 2 on a malformed request."""
    logging.basicConfig(level=logging.INFO, format="%(levelname)s %(name)s: %(message)s")
    _apply_root_overrides()
    args = _parse_args(argv)
    candidates = [c.strip() for value in args.candidates for c in value.split(",") if c.strip()]
    return run_job(args.dataset, args.job, args.objective, candidates)


if __name__ == "__main__":
    sys.exit(main())
