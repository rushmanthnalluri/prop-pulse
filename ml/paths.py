"""Canonical repository paths. All modules resolve paths from here — never hardcode absolutes."""
from __future__ import annotations

from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[1]

DATA_DIR = REPO_ROOT / "data"
RAW_DIR = DATA_DIR / "raw"
RAW_AMES_DIR = RAW_DIR / "ames"
INTERIM_DIR = DATA_DIR / "interim"
PROCESSED_DIR = DATA_DIR / "processed"
EXTERNAL_DIR = DATA_DIR / "external"

MODELS_DIR = REPO_ROOT / "models"
REGISTRY_DIR = MODELS_DIR / "registry"
CHAMPION_PATH = MODELS_DIR / "champion.json"
FEATURE_LIST_PATH = MODELS_DIR / "feature_list.json"
FEATURE_DEFAULTS_PATH = MODELS_DIR / "feature_defaults.json"
NEIGHBORHOOD_STATS_PATH = MODELS_DIR / "neighborhood_stats.json"

ARTIFACTS_DIR = REPO_ROOT / "artifacts"
MLRUNS_DIR = REPO_ROOT / "mlruns"
REPORTS_DIR = REPO_ROOT / "reports"
FIGURES_DIR = REPO_ROOT / "figures"
LOGS_DIR = REPO_ROOT / "logs"
NOTEBOOKS_DIR = REPO_ROOT / "notebooks"

DATASET_VERSION = "ames-1.0"
RANDOM_SEED = 42
