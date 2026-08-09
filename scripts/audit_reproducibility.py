"""PropPulse reproducibility audit (steps 1-4 + 6 of the reproducibility review).

Re-runs the deterministic pipelines end-to-end and proves — with hashes and
prediction diffs, not vibes — that the committed artifacts are reproducible:

1. **Data determinism**: md5 of ``data/processed/{train,val,test}.csv`` (plus
   ``schema.json`` / ``outliers_report.json``) before/after
   ``python -m ml.data.pipeline`` — must be byte-identical.
2. **Feature artifacts**: sha1 of ``models/feature_list.json``,
   ``models/neighborhood_stats.json`` and ``models/feature_defaults.json``
   before/after ``python -m ml.features.pipeline`` — must be byte-identical
   and ``feature_version`` must stay the value pinned in ``champion.json``.
3. **Model reproducibility**: backs up ``models/regression/`` and
   ``models/classification/``, fully retrains both
   (``ml.training.train_regression`` / ``ml.training.train_classification``),
   then compares OLD (backup) vs NEW artifact predictions on a fixed 50-row
   validation slice (first 50 rows of ``data/processed/val.csv``) and the
   rewritten ``metrics.json`` files. Retrained MLflow runs are redirected to
   a scratch file store under ``artifacts/`` so ``mlruns/`` stays untouched.
   On divergence the backups are restored and the step FAILs; on success any
   non-byte-identical artifact is also restored so the repo stays byte-stable.
4. **Seed audit**: scans ``ml/`` for ``random_state`` / ``seed`` /
   ``np.random`` usage and flags anything not anchored to ``RANDOM_SEED`` (42).
6. **Dependency pins**: both requirements files must be fully ``==``-pinned
   and ``pip check`` must be clean.

Prints a PASS/FAIL table; exit code 0 = all steps PASS, 1 = any FAIL.

Usage (from repo root)::

    .venv/Scripts/python.exe scripts/audit_reproducibility.py
"""
from __future__ import annotations

import hashlib
import json
import os
import re
import shutil
import subprocess
import sys
from dataclasses import dataclass, field
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[1]
if str(REPO_ROOT) not in sys.path:  # the script lives in scripts/, not the repo root
    sys.path.insert(0, str(REPO_ROOT))
ARTIFACTS_DIR = REPO_ROOT / "artifacts"
BACKUP_DIR = ARTIFACTS_DIR / "repro_audit_backup"
# NOTE: the scratch MLflow store must NOT live under a path component named
# "artifacts" — mlflow 3.15's file store treats any run dir with an
# "artifacts" path part as invalid (ZDI-CAN-26649 traversal defense in
# FileStore._is_valid_run_directory) and create_run then fails with
# "Run '<uuid>' not found". Hence a repo-root-level scratch dir.
SCRATCH_MLRUNS = REPO_ROOT / "mlruns_repro_audit"

#: Retrains get their own throwaway MLflow file store so the real mlruns/
#: inventory is not polluted by audit runs (ml.tracking honors the env var).
AUDIT_ENV = {
    **os.environ,
    "MLFLOW_ALLOW_FILE_STORE": "true",
    "MLFLOW_TRACKING_URI": SCRATCH_MLRUNS.resolve().as_uri(),
}

#: Prediction equivalence tolerance (log-space target for regression,
#: probability for classification). Deterministic retrains should be ~0.
PRED_ATOL = 1e-8

#: Fixed evaluation slice: first N rows of the processed val split.
VAL_SLICE_ROWS = 50

PROCESSED_FILES = ["train.csv", "val.csv", "test.csv", "schema.json", "outliers_report.json"]
FEATURE_FILES = ["feature_list.json", "neighborhood_stats.json", "feature_defaults.json"]
CLASSIFICATION_FIGURES = ["classification_calibration.png", "classification_curves.png"]


@dataclass
class StepResult:
    """Outcome of one audit step."""

    name: str
    passed: bool
    detail: str = ""
    lines: list[str] = field(default_factory=list)


def _md5(path: Path) -> str:
    return hashlib.md5(path.read_bytes()).hexdigest()


def _sha1(path: Path) -> str:
    return hashlib.sha1(path.read_bytes()).hexdigest()


def _run_module(module: str, timeout: int) -> subprocess.CompletedProcess[str]:
    """Run ``python -m <module>`` from the repo root with the audit env."""
    return subprocess.run(
        [sys.executable, "-m", module],
        cwd=REPO_ROOT,
        env=AUDIT_ENV,
        capture_output=True,
        text=True,
        timeout=timeout,
    )


def _check_proc(proc: subprocess.CompletedProcess[str], module: str) -> None:
    if proc.returncode != 0:
        tail = "\n".join((proc.stdout + "\n" + proc.stderr).splitlines()[-15:])
        raise RuntimeError(f"`python -m {module}` exited {proc.returncode}:\n{tail}")


def step_data_determinism() -> StepResult:
    """Step 1: re-run the data pipeline; processed outputs must be byte-identical."""
    processed = REPO_ROOT / "data" / "processed"
    before = {name: _md5(processed / name) for name in PROCESSED_FILES}
    _check_proc(_run_module("ml.data.pipeline", timeout=600), "ml.data.pipeline")
    after = {name: _md5(processed / name) for name in PROCESSED_FILES}
    lines = [
        f"  {name:<22} md5 {before[name]} -> {after[name]} "
        + ("OK" if before[name] == after[name] else "MISMATCH")
        for name in PROCESSED_FILES
    ]
    mismatches = [n for n in PROCESSED_FILES if before[n] != after[n]]
    passed = not mismatches
    return StepResult(
        "1. data_determinism",
        passed,
        "all 5 processed outputs byte-identical" if passed else f"MISMATCH: {mismatches}",
        lines,
    )


def step_feature_artifacts() -> StepResult:
    """Step 2: re-run the feature pipeline; artifacts + feature_version must hold."""
    models = REPO_ROOT / "models"
    from ml.paths import FEATURE_LIST_PATH  # noqa: PLC0415
    from ml.tracking import feature_version  # noqa: PLC0415

    champion = json.loads((models / "champion.json").read_text(encoding="utf-8"))
    champion_fv = champion["feature_version"]
    before = {name: _sha1(models / name) for name in FEATURE_FILES}
    fv_before = feature_version(FEATURE_LIST_PATH)

    _check_proc(_run_module("ml.features.pipeline", timeout=600), "ml.features.pipeline")

    after = {name: _sha1(models / name) for name in FEATURE_FILES}
    fv_after = feature_version(FEATURE_LIST_PATH)
    lines = [
        f"  {name:<26} sha1 {before[name][:12]}... -> {after[name][:12]}... "
        + ("OK" if before[name] == after[name] else "MISMATCH")
        for name in FEATURE_FILES
    ]
    lines.append(f"  feature_version: {fv_before} -> {fv_after} (champion.json: {champion_fv})")
    mismatches = [n for n in FEATURE_FILES if before[n] != after[n]]
    passed = not mismatches and fv_before == fv_after == champion_fv
    detail = (
        f"artifacts byte-identical; feature_version={fv_after}"
        if passed
        else f"MISMATCH: files={mismatches}, fv {fv_before}->{fv_after}, champion={champion_fv}"
    )
    return StepResult("2. feature_artifacts", passed, detail, lines)


def _val_slice():
    """Fixed 50-row feature slice from the processed val split (file order)."""
    import pandas as pd  # noqa: PLC0415

    from ml.features.pipeline import build_feature_frame  # noqa: PLC0415
    from ml.features.stats import load_neighborhood_stats  # noqa: PLC0415
    from ml.paths import FEATURE_LIST_PATH, PROCESSED_DIR  # noqa: PLC0415

    val = pd.read_csv(PROCESSED_DIR / "val.csv", keep_default_na=False).head(VAL_SLICE_ROWS)
    stats = load_neighborhood_stats()
    frame = build_feature_frame(val, stats=stats)
    features = json.loads(FEATURE_LIST_PATH.read_text(encoding="utf-8"))["features"]
    return frame[features]


def _diff_metrics(old, new, path: str = ""):
    """Yield ``(path, old, new, close)`` for every differing leaf of two metrics dicts.

    Floats use ``math.isclose(rel_tol=1e-9, abs_tol=1e-12)`` — ulp-level drift
    from thread-order float accumulation (RF predict with n_jobs=-1) is
    tolerated; ints/strings/structure must match exactly.
    """
    import math  # noqa: PLC0415

    if isinstance(old, dict) and isinstance(new, dict):
        if set(old) != set(new):
            yield (path or "<root>", sorted(old), sorted(new), False)
            return
        for key in old:
            yield from _diff_metrics(old[key], new[key], f"{path}.{key}" if path else str(key))
        return
    if isinstance(old, float) or isinstance(new, float):
        try:
            close = math.isclose(float(old), float(new), rel_tol=1e-9, abs_tol=1e-12)
        except (TypeError, ValueError):
            close = False
        if not close:
            yield (path, old, new, False)
        elif old != new:
            yield (path, old, new, True)
        return
    if old != new:
        yield (path, old, new, False)


def _backup_tree(src: Path, names: list[str], dst: Path) -> None:
    dst.mkdir(parents=True, exist_ok=True)
    for name in names:
        shutil.copy2(src / name, dst / name)


def _restore_tree(names: list[str], src_backup: Path, dst: Path) -> None:
    for name in names:
        shutil.copy2(src_backup / name, dst / name)


def step_model_reproducibility() -> StepResult:
    """Step 3: full retrain of both families; old vs new predictions must match."""
    import joblib  # noqa: PLC0415
    import numpy as np  # noqa: PLC0415

    models = REPO_ROOT / "models"
    reg_dir = models / "regression"
    cls_dir = models / "classification"
    fig_dir = REPO_ROOT / "figures"
    reg_names = sorted(p.name for p in reg_dir.glob("*.joblib")) + ["metrics.json"]
    cls_names = sorted(p.name for p in cls_dir.glob("*.joblib")) + ["metrics.json"]

    # --- backup everything the retrain overwrites ---
    if BACKUP_DIR.exists():
        shutil.rmtree(BACKUP_DIR)
    _backup_tree(reg_dir, reg_names, BACKUP_DIR / "regression")
    _backup_tree(cls_dir, cls_names, BACKUP_DIR / "classification")
    _backup_tree(fig_dir, CLASSIFICATION_FIGURES, BACKUP_DIR / "figures")

    lines: list[str] = []
    slice_x = _val_slice()
    reg_champ = "ridge_v1.joblib"
    cls_champ = "random_forest_calibrated_v1.joblib"

    def _predict(joblib_path: Path) -> tuple[np.ndarray, np.ndarray]:
        model = joblib.load(joblib_path)
        if "calibrated" in joblib_path.name or "classification" in str(joblib_path):
            return np.asarray(model.predict_proba(slice_x)[:, 1]), np.empty(0)
        pred_log = np.asarray(model.predict(slice_x), dtype=float)
        return pred_log, np.expm1(pred_log)

    try:
        # --- OLD (backup) predictions on the fixed slice ---
        old_reg_log, old_reg_dollar = _predict(BACKUP_DIR / "regression" / reg_champ)
        old_cls_proba, _ = _predict(BACKUP_DIR / "classification" / cls_champ)

        # --- full retrain (MLflow redirected to the scratch store) ---
        for module, timeout in (
            ("ml.training.train_regression", 3600),
            ("ml.training.train_classification", 3600),
        ):
            proc = _run_module(module, timeout=timeout)
            _check_proc(proc, module)
            summary = [ln for ln in proc.stderr.splitlines() if "rmsle" in ln or "PR-AUC" in ln]
            lines.extend(f"  [retrain] {ln.strip()}" for ln in summary[:8])

        # --- NEW predictions on the same fixed slice ---
        new_reg_log, new_reg_dollar = _predict(reg_dir / reg_champ)
        new_cls_proba, _ = _predict(cls_dir / cls_champ)

        reg_log_diff = float(np.max(np.abs(old_reg_log - new_reg_log)))
        reg_dollar_diff = float(np.max(np.abs(old_reg_dollar - new_reg_dollar)))
        cls_diff = float(np.max(np.abs(old_cls_proba - new_cls_proba)))
        lines.append(
            f"  ridge_v1 50-row val slice: max|dlog|={reg_log_diff:.3e} "
            f"max|d$|=${reg_dollar_diff:.4f}"
        )
        lines.append(
            f"  random_forest_calibrated_v1 50-row val slice: max|dprob|={cls_diff:.3e}"
        )

        # --- metrics.json: val metrics must agree (float-tolerant) ---
        # RF predict/predict_proba accumulates tree outputs in thread-
        # completion order (n_jobs=-1), so ulp-level (~1e-16) float drift is
        # expected; anything larger indicates real nondeterminism.
        metrics_ok = True
        for family in ("regression", "classification"):
            old_metrics = json.loads((BACKUP_DIR / family / "metrics.json").read_text())
            new_metrics = json.loads((models / family / "metrics.json").read_text())
            byte_equal = _md5(BACKUP_DIR / family / "metrics.json") == _md5(
                models / family / "metrics.json"
            )
            diffs = list(_diff_metrics(old_metrics, new_metrics))
            hard_diffs = [d for d in diffs if not d[3]]
            metrics_ok &= not hard_diffs
            lines.append(
                f"  {family}/metrics.json: bytes {'identical' if byte_equal else 'differ'}; "
                f"{len(diffs)} leaf value(s) differ, {len(hard_diffs)} beyond tolerance"
            )
            for path, old_v, new_v, _close in diffs[:12]:
                lines.append(f"    {path}: {old_v!r} -> {new_v!r}")

        preds_ok = reg_log_diff <= PRED_ATOL and cls_diff <= PRED_ATOL
        passed = preds_ok and metrics_ok

        # --- byte-identity of every retrained artifact (before any restore) ---
        for family, names, target in (
            ("regression", reg_names, reg_dir),
            ("classification", cls_names, cls_dir),
            ("figures", CLASSIFICATION_FIGURES, fig_dir),
        ):
            identical = [n for n in names if _md5(BACKUP_DIR / family / n) == _md5(target / n)]
            changed = sorted(set(names) - set(identical))
            lines.append(
                f"  {family}: {len(identical)}/{len(names)} artifacts byte-identical"
                + (f"; changed: {changed}" if changed else "")
            )

        # --- keep the repo byte-stable: restore backups on FAIL, and restore
        # any artifact whose bytes changed even on PASS (predictions proved
        # equivalent; the committed bytes stay canonical). ---
        restored: list[str] = []
        for family, names, target in (
            ("regression", reg_names, reg_dir),
            ("classification", cls_names, cls_dir),
            ("figures", CLASSIFICATION_FIGURES, fig_dir),
        ):
            for name in names:
                backup = BACKUP_DIR / family / name
                current = target / name
                if not passed or _md5(backup) != _md5(current):
                    shutil.copy2(backup, current)
                    restored.append(f"{family}/{name}")
        if restored:
            lines.append(
                f"  restored {len(restored)} file(s) from backup to keep the repo byte-stable"
            )
        detail = (
            f"predictions match (max|dlog|={reg_log_diff:.2e}, max|dprob|={cls_diff:.2e}); "
            "metrics.json equal within float tolerance"
            if passed
            else f"reg_log_diff={reg_log_diff:.3e} cls_diff={cls_diff:.3e} "
            f"metrics_ok={metrics_ok} — backups restored"
        )
        if passed:
            # Scratch runs + backups are throwaway on success; keep them only
            # for post-mortem when the step FAILED.
            shutil.rmtree(SCRATCH_MLRUNS, ignore_errors=True)
            shutil.rmtree(BACKUP_DIR, ignore_errors=True)
        return StepResult("3. model_reproducibility", passed, detail, lines)
    except Exception as exc:  # restore on any failure, then report FAIL
        _restore_tree(reg_names, BACKUP_DIR / "regression", reg_dir)
        _restore_tree(cls_names, BACKUP_DIR / "classification", cls_dir)
        _restore_tree(CLASSIFICATION_FIGURES, BACKUP_DIR / "figures", fig_dir)
        lines.append(f"  exception: {exc!r} — backups restored")
        return StepResult("3. model_reproducibility", False, f"exception: {exc}", lines)


#: Value expressions that anchor randomness to the project seed (42).
_SEED_OK = re.compile(r"^(42|RANDOM_SEED|seed|random_state|self\.seed|\[self\.seed,.*\])$")
_SEED_ASSIGN = re.compile(r"(?:random_state|seed)\s*=\s*([^,\)\n]+)")
_RNG_CALL = re.compile(r"np\.random\.(default_rng|RandomState)\(([^)]*)\)")
_RNG_BAD = re.compile(r"np\.random\.(rand|randn|random|randint|choice|shuffle|permutation)\(")
_STDLIB_RANDOM = re.compile(r"^\s*(import\s+random|from\s+random\s+import)\b", re.M)


def step_seed_audit() -> StepResult:
    """Step 4: every random_state/seed in ml/ must resolve to RANDOM_SEED (42)."""
    lines: list[str] = []
    exceptions: list[str] = []
    n_ok = 0
    for path in sorted((REPO_ROOT / "ml").rglob("*.py")):
        text = path.read_text(encoding="utf-8")
        rel = path.relative_to(REPO_ROOT)
        for match in _SEED_ASSIGN.finditer(text):
            value = match.group(1).strip()
            if _SEED_OK.match(value) or "RANDOM_SEED" in value:
                n_ok += 1
            else:
                exceptions.append(f"{rel}: seed/random_state = {value!r}")
        for match in _RNG_CALL.finditer(text):
            arg = match.group(2).strip()
            if "seed" in arg or "RANDOM_SEED" in arg or arg == "42":
                n_ok += 1
            else:
                exceptions.append(f"{rel}: np.random.{match.group(1)}({arg}) unseeded")
        for match in _RNG_BAD.finditer(text):
            exceptions.append(f"{rel}: unseeded np.random.{match.group(1)}()")
        for _ in _STDLIB_RANDOM.finditer(text):
            exceptions.append(f"{rel}: stdlib `random` module imported")
        # Line-based (not regex-over-parens): all .sample() calls in ml/ are
        # single-line statements, so random_state must appear on the same line.
        for lineno, line in enumerate(text.splitlines(), start=1):
            if ".sample(" in line and "random_state" not in line:
                exceptions.append(f"{rel}:{lineno}: .sample() without random_state")
    lines.append(f"  seeded/42-anchored usages verified: {n_ok}")
    lines.append(f"  exceptions: {len(exceptions)}")
    lines.extend(f"    - {e}" for e in exceptions)
    passed = not exceptions
    return StepResult(
        "4. seed_audit",
        passed,
        f"all randomness anchored to RANDOM_SEED=42 ({n_ok} usages, 0 exceptions)"
        if passed
        else f"{len(exceptions) if exceptions else 0} exception(s)",
        lines,
    )


def _requirement_lines(path: Path) -> list[str]:
    return [
        ln.strip()
        for ln in path.read_text(encoding="utf-8").splitlines()
        if ln.strip() and not ln.strip().startswith("#")
    ]


def step_dependency_pins() -> StepResult:
    """Step 6: requirements fully ==-pinned and `pip check` clean."""
    lines: list[str] = []
    problems: list[str] = []
    for rel in ("requirements.txt", "backend/requirements.txt"):
        entries = _requirement_lines(REPO_ROOT / rel)
        unpinned = [e for e in entries if "==" not in e]
        lines.append(f"  {rel}: {len(entries)} requirements, {len(unpinned)} unpinned")
        problems.extend(f"{rel}: {e!r} not ==-pinned" for e in unpinned)
    proc = subprocess.run(
        [sys.executable, "-m", "pip", "check"],
        cwd=REPO_ROOT,
        capture_output=True,
        text=True,
        timeout=300,
    )
    pip_ok = proc.returncode == 0
    lines.append(f"  pip check: exit {proc.returncode} — {proc.stdout.strip() or proc.stderr.strip()}")
    if not pip_ok:
        problems.append(f"pip check failed: {proc.stdout.strip()}")
    passed = not problems
    return StepResult(
        "6. dependency_pins",
        passed,
        "all requirements ==-pinned; pip check clean" if passed else "; ".join(problems),
        lines,
    )


def main() -> int:
    """Run every audit step, print the PASS/FAIL table, exit accordingly."""
    print("=" * 72)
    print("PropPulse reproducibility audit")
    print(f"repo: {REPO_ROOT}")
    print(f"python: {sys.executable}")
    print("=" * 72)
    results: list[StepResult] = []
    for step in (
        step_data_determinism,
        step_feature_artifacts,
        step_model_reproducibility,
        step_seed_audit,
        step_dependency_pins,
    ):
        print(f"\n--- {step.__name__} ---", flush=True)
        try:
            result = step()
        except Exception as exc:  # a step that crashes is a FAIL, not a crash of the audit
            result = StepResult(step.__name__, False, f"unhandled exception: {exc!r}")
        results.append(result)
        for line in result.lines:
            print(line, flush=True)
        print(f"  -> {'PASS' if result.passed else 'FAIL'}: {result.detail}", flush=True)

    print("\n" + "=" * 72)
    print("SUMMARY")
    for result in results:
        print(f"  {result.name:<28} {'PASS' if result.passed else 'FAIL':<5} {result.detail}")
    overall = all(r.passed for r in results)
    print(f"\nOVERALL: {'PASS' if overall else 'FAIL'}")
    print("=" * 72)
    return 0 if overall else 1


if __name__ == "__main__":
    sys.exit(main())
