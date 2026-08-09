"""Async load generator for the PropPulse API (httpx + asyncio only).

Measures per-request latency against a live server and reports
p50/p90/p95/p99/mean latency, throughput (req/s), and error counts.
Reusable for any endpoint (GET or POST).

Examples (from the repo root)::

    # POST /predict, 200 requests at concurrency 10, 3 unmeasured warm-up calls
    .venv/Scripts/python.exe scripts/load_test.py \
        --url http://127.0.0.1:8200 --endpoint /predict \
        --concurrency 10 --requests 200 --warmup 3

    # GET /market/clusters at concurrency 25
    .venv/Scripts/python.exe scripts/load_test.py \
        --url http://127.0.0.1:8200 --endpoint /market/clusters \
        --concurrency 25 --requests 200

    # In-process stage profile of the prediction path (no server needed):
    .venv/Scripts/python.exe scripts/load_test.py --profile --requests 50

``--payload`` accepts an inline JSON string or a path to a JSON file. When
omitted, a built-in representative ``PropertyInput`` body is used for the
``/predict*`` endpoints and no body is sent otherwise (GET).
"""
from __future__ import annotations

import argparse
import asyncio
import json
import math
import re
import sys
import time
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

import httpx

REPO_ROOT = Path(__file__).resolve().parents[1]

#: Representative valid ``PropertyInput`` body (SPEC §8 required fields).
DEFAULT_PAYLOAD: dict[str, Any] = {
    "neighborhood": "NAmes",
    "house_style": "1Story",
    "bldg_type": "1Fam",
    "ms_zoning": "RL",
    "bedrooms": 3,
    "full_bath": 2,
    "half_bath": 0,
    "bsmt_full_bath": 1,
    "bsmt_half_bath": 0,
    "gr_liv_area": 1500,
    "lot_area": 8000,
    "total_bsmt_sf": 1000,
    "year_built": 1975,
    "overall_qual": 6,
    "overall_cond": 5,
    "garage_cars": 2,
    "fireplaces": 1,
    "central_air": True,
}

REQUEST_TIMEOUT = httpx.Timeout(120.0, connect=30.0)


def percentile(sorted_values: list[float], pct: float) -> float:
    """Percentile with linear interpolation (numpy 'linear' method)."""
    if not sorted_values:
        return float("nan")
    rank = (len(sorted_values) - 1) * (pct / 100.0)
    low = math.floor(rank)
    high = math.ceil(rank)
    if low == high:
        return sorted_values[int(rank)]
    return sorted_values[low] + (sorted_values[high] - sorted_values[low]) * (rank - low)


@dataclass
class RunStats:
    """Collected measurements of one load run."""

    latencies_ms: list[float] = field(default_factory=list)
    statuses: dict[int, int] = field(default_factory=dict)
    transport_errors: int = 0
    wall_seconds: float = 0.0

    @property
    def n(self) -> int:
        return len(self.latencies_ms)

    @property
    def errors(self) -> int:
        """HTTP >= 400 responses plus transport-level failures."""
        http_errors = sum(count for code, count in self.statuses.items() if code >= 400)
        return http_errors + self.transport_errors

    def summary(self) -> dict[str, Any]:
        """Compute the reporting stats for this run."""
        ordered = sorted(self.latencies_ms)
        ok = self.n - self.errors
        return {
            "requests": self.n,
            "errors": self.errors,
            "error_rate": round(self.errors / self.n, 6) if self.n else 0.0,
            "throughput_rps": round(ok / self.wall_seconds, 2) if self.wall_seconds else 0.0,
            "wall_seconds": round(self.wall_seconds, 3),
            "latency_ms": {
                "min": round(ordered[0], 2) if ordered else None,
                "mean": round(sum(ordered) / len(ordered), 2) if ordered else None,
                "p50": round(percentile(ordered, 50), 2),
                "p90": round(percentile(ordered, 90), 2),
                "p95": round(percentile(ordered, 95), 2),
                "p99": round(percentile(ordered, 99), 2),
                "max": round(ordered[-1], 2) if ordered else None,
            },
            "statuses": {str(code): self.statuses[code] for code in sorted(self.statuses)},
        }


async def _worker(
    client: httpx.AsyncClient,
    method: str,
    url: str,
    payload: dict[str, Any] | None,
    remaining: list[int],
    stats: RunStats,
) -> None:
    """Send requests until the shared counter is exhausted."""
    while remaining:
        remaining[0] -= 1
        if remaining[0] < 0:
            return
        started = time.perf_counter()
        try:
            response = await client.request(method, url, json=payload)
            elapsed_ms = (time.perf_counter() - started) * 1000.0
            stats.statuses[response.status_code] = stats.statuses.get(response.status_code, 0) + 1
        except httpx.HTTPError:
            elapsed_ms = (time.perf_counter() - started) * 1000.0
            stats.transport_errors += 1
        stats.latencies_ms.append(elapsed_ms)


async def run_load(
    *,
    base_url: str,
    endpoint: str,
    method: str,
    payload: dict[str, Any] | None,
    concurrency: int,
    requests: int,
    warmup: int,
) -> RunStats:
    """Run ``requests`` measured calls at ``concurrency`` against one endpoint."""
    url = base_url.rstrip("/") + endpoint
    limits = httpx.Limits(
        max_connections=max(concurrency, 1),
        max_keepalive_connections=max(concurrency, 1),
    )
    async with httpx.AsyncClient(timeout=REQUEST_TIMEOUT, limits=limits) as client:
        for _ in range(warmup):  # sequential warm-up, never measured
            await client.request(method, url, json=payload)
        stats = RunStats()
        remaining = [requests]
        started = time.perf_counter()
        await asyncio.gather(
            *(
                _worker(client, method, url, payload, remaining, stats)
                for _ in range(max(1, min(concurrency, requests)))
            )
        )
        stats.wall_seconds = time.perf_counter() - started
    return stats


def _load_payload_arg(raw: str | None, endpoint: str) -> dict[str, Any] | None:
    """Resolve ``--payload``: inline JSON, JSON file, or the built-in default."""
    if raw is None:
        return dict(DEFAULT_PAYLOAD) if endpoint.startswith("/predict") else None
    candidate = Path(raw)
    if candidate.is_file():
        return json.loads(candidate.read_text(encoding="utf-8"))
    return json.loads(raw)


def _print_report(method: str, endpoint: str, concurrency: int, summary: dict[str, Any]) -> None:
    lat = summary["latency_ms"]
    print(f"{method} {endpoint}  concurrency={concurrency}")
    print(
        f"  requests={summary['requests']} errors={summary['errors']} "
        f"({summary['error_rate'] * 100:.2f}%) statuses={summary['statuses']}"
    )
    print(
        f"  latency ms: min={lat['min']} mean={lat['mean']} p50={lat['p50']} "
        f"p90={lat['p90']} p95={lat['p95']} p99={lat['p99']} max={lat['max']}"
    )
    print(f"  wall={summary['wall_seconds']}s throughput={summary['throughput_rps']} req/s")


def run_profile(iterations: int, payload: dict[str, Any]) -> dict[str, Any]:
    """In-process stage timing of the prediction path (no server needed).

    Loads the real champion artifacts exactly like the backend lifespan does,
    then times each stage of a warm ``/predict``: feature building, ridge
    predict, calibrated RF predict_proba, and the SHAP explanation. The cold
    first call (SHAP singleton build) is measured separately.
    """
    sys.path.insert(0, str(REPO_ROOT))
    import joblib  # noqa: PLC0415

    from backend.app.services.prediction_service import PredictionService  # noqa: PLC0415
    from ml.explainability.service import explain_instance  # noqa: PLC0415
    from ml.features.stats import load_neighborhood_stats  # noqa: PLC0415

    champion = json.loads((REPO_ROOT / "models" / "champion.json").read_text(encoding="utf-8"))
    regression_model = joblib.load(REPO_ROOT / champion["regression"]["path"])
    classification_model = joblib.load(REPO_ROOT / champion["classification"]["path"])
    service = PredictionService(
        regression_model=regression_model,
        classification_model=classification_model,
        neighborhood_stats=load_neighborhood_stats(),
        threshold=champion["classification"]["threshold"],
        residual_interval=champion["regression"]["residual_interval"],
    )

    started = time.perf_counter()
    service.predict(payload)  # cold: first call builds the SHAP singleton
    cold_full_ms = (time.perf_counter() - started) * 1000.0

    stages: dict[str, list[float]] = {
        "build_features": [],
        "ridge_predict": [],
        "rf_predict_proba": [],
        "shap_explain": [],
        "full_predict": [],
    }
    for _ in range(iterations):
        tick = time.perf_counter()
        features = service.build_features(payload)
        stages["build_features"].append((time.perf_counter() - tick) * 1000.0)

        tick = time.perf_counter()
        regression_model.predict(features)
        stages["ridge_predict"].append((time.perf_counter() - tick) * 1000.0)

        tick = time.perf_counter()
        classification_model.predict_proba(features)
        stages["rf_predict_proba"].append((time.perf_counter() - tick) * 1000.0)

        tick = time.perf_counter()
        explain_instance(features, top_n=5)
        stages["shap_explain"].append((time.perf_counter() - tick) * 1000.0)

        tick = time.perf_counter()
        service.predict(payload)
        stages["full_predict"].append((time.perf_counter() - tick) * 1000.0)

    result: dict[str, Any] = {"cold_full_predict_ms": round(cold_full_ms, 1), "stages": {}}
    for name, values in stages.items():
        ordered = sorted(values)
        result["stages"][name] = {
            "mean_ms": round(sum(ordered) / len(ordered), 3),
            "p50_ms": round(percentile(ordered, 50), 3),
            "p95_ms": round(percentile(ordered, 95), 3),
        }
    return result


def main() -> None:
    """CLI entry point."""
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--url", default="http://127.0.0.1:8200", help="base server URL")
    parser.add_argument("--endpoint", default="/predict", help="path, e.g. /predict")
    parser.add_argument("--concurrency", type=int, default=1, help="parallel workers")
    parser.add_argument("--requests", type=int, default=200, help="total measured requests")
    parser.add_argument(
        "--payload",
        default=None,
        help="inline JSON body or path to a JSON file (default: built-in /predict body)",
    )
    parser.add_argument(
        "--method",
        choices=["GET", "POST"],
        default=None,
        help="HTTP method (default: POST when a payload exists, else GET)",
    )
    parser.add_argument("--warmup", type=int, default=0, help="unmeasured warm-up requests")
    parser.add_argument(
        "--profile",
        action="store_true",
        help="in-process stage timing of the prediction path (ignores --url)",
    )
    parser.add_argument("--json", action="store_true", help="also print a JSON summary line")
    args = parser.parse_args()

    endpoint = args.endpoint
    if re.match(r"^[A-Za-z]:[\\/]", endpoint):
        parser.error(
            "endpoint was rewritten by the shell (Git Bash POSIX-to-Windows "
            "path conversion); pass it as --endpoint=/predict instead"
        )
    if not endpoint.startswith("/"):
        endpoint = "/" + endpoint

    payload = _load_payload_arg(args.payload, endpoint)

    if args.profile:
        result = run_profile(max(1, args.requests), payload or dict(DEFAULT_PAYLOAD))
        print(f"cold full predict (SHAP singleton build): {result['cold_full_predict_ms']} ms")
        for name, stats in result["stages"].items():
            print(
                f"  {name:<18} mean={stats['mean_ms']} ms "
                f"p50={stats['p50_ms']} ms p95={stats['p95_ms']} ms"
            )
        if args.json:
            print(json.dumps({"profile": result}))
        return

    method = args.method or ("POST" if payload is not None else "GET")
    stats = asyncio.run(
        run_load(
            base_url=args.url,
            endpoint=endpoint,
            method=method,
            payload=payload,
            concurrency=args.concurrency,
            requests=args.requests,
            warmup=args.warmup,
        )
    )
    summary = stats.summary()
    _print_report(method, endpoint, args.concurrency, summary)
    if args.json:
        print(
            json.dumps(
                {
                    "method": method,
                    "endpoint": endpoint,
                    "concurrency": args.concurrency,
                    **summary,
                }
            )
        )


if __name__ == "__main__":
    main()
