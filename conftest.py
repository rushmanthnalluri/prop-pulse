"""Root pytest configuration.

Guarantees the repository root is importable so ``ml.*`` and ``backend.*``
resolve regardless of how pytest is invoked (``pytest.ini`` also sets
``pythonpath = .``; this is a belt-and-braces fallback for direct
``pytest <file>`` runs and IDE test runners).
"""
from __future__ import annotations

import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent
if str(REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(REPO_ROOT))
