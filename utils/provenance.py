"""
Data provenance + freshness reporting.

Every number the platform shows a farmer comes from one of three places:

  live   — fetched from an upstream API on this request (or within its TTL)
  seed   — read from the CSVs committed to `dataset/`
  absent — the source is not configured and there is no fallback

Until now that distinction was invisible: a missing DATAGOV_API_KEY silently
downgraded live mandi prices to a CSV whose newest row is over a year old, and
nothing in the UI said so. `describe_sources()` makes the difference explicit so
the frontend can badge it.

Nothing here is on a hot path — the endpoint is called once per page load.
"""

from __future__ import annotations

import csv
import json
import os
import time
from datetime import date, datetime
from pathlib import Path
from typing import Any, Dict, List, Optional

_ROOT = Path(__file__).resolve().parents[1]
_DATASET_DIR = _ROOT / "dataset"
_MODEL_DIR = _ROOT / "ml" / "models"

# Per-source thresholds, in days: (fresh_below, aging_below). Anything at or
# beyond the second number is "stale". Mandi prices move daily so they go stale
# fast; MSP is announced once per season, so a year-old figure is still current.
_THRESHOLDS: Dict[str, tuple[int, int]] = {
    "mandi_prices": (7, 90),
    "msp": (400, 800),
    "weather": (120, 400),
    "soil": (400, 1100),
    "yield_history": (400, 1100),
    "ml_models": (90, 365),
}

_DEFAULT_THRESHOLD = (90, 365)


def _staleness(source_id: str, age_days: Optional[float]) -> str:
    if age_days is None:
        return "unknown"
    fresh_below, aging_below = _THRESHOLDS.get(source_id, _DEFAULT_THRESHOLD)
    if age_days < fresh_below:
        return "fresh"
    if age_days < aging_below:
        return "aging"
    return "stale"


def _age_days(iso_date: Optional[str]) -> Optional[float]:
    if not iso_date:
        return None
    try:
        parsed = datetime.fromisoformat(iso_date)
        return max(0.0, (datetime.now() - parsed).total_seconds() / 86400.0)
    except (TypeError, ValueError):
        pass
    # Bare year, e.g. an MSP row of "2024" — treat as 1 July of that year, the
    # rough midpoint of the kharif/rabi announcement cycle.
    try:
        year = int(iso_date)
        if 1900 < year < 2200:
            return max(0.0, float((date.today() - date(year, 7, 1)).days))
    except (TypeError, ValueError):
        pass
    return None


def _max_column(csv_name: str, column: str) -> Optional[str]:
    """Largest lexicographic value in a column — works for ISO dates and years."""
    path = _DATASET_DIR / csv_name
    if not path.exists():
        return None
    best: Optional[str] = None
    try:
        with path.open("r", newline="", encoding="utf-8") as f:
            for row in csv.DictReader(f):
                value = (row.get(column) or "").strip()
                if value and (best is None or value > best):
                    best = value
    except OSError:
        return None
    return best


def _file_mtime_iso(path: Path) -> Optional[str]:
    try:
        return datetime.fromtimestamp(path.stat().st_mtime).isoformat(timespec="seconds")
    except OSError:
        return None


def _epoch_to_iso(epoch: Optional[float]) -> Optional[str]:
    if not epoch:
        return None
    try:
        return datetime.fromtimestamp(float(epoch)).isoformat(timespec="seconds")
    except (OverflowError, OSError, ValueError):
        return None


def _entry(
    source_id: str,
    label: str,
    mode: str,
    as_of: Optional[str],
    upstream: str,
    detail: str = "",
) -> Dict[str, Any]:
    age = _age_days(as_of)
    return {
        "id": source_id,
        "label": label,
        "mode": mode,
        "as_of": as_of,
        "age_days": round(age, 1) if age is not None else None,
        "staleness": _staleness(source_id, age),
        "upstream": upstream,
        "detail": detail,
    }


def _mandi_entry() -> Dict[str, Any]:
    from data_ingestion.fetchers.mandi import last_resolution

    resolution = last_resolution()
    key_present = bool(os.getenv("DATAGOV_API_KEY"))
    seed_as_of = _max_column("mandi_prices.csv", "date")

    if resolution.get("mode") == "live":
        return _entry(
            "mandi_prices",
            "Mandi prices",
            "live",
            _epoch_to_iso(resolution.get("live_ok_at")),
            "data.gov.in (Agmarknet daily modal prices)",
            "Live prices, refreshed at most once an hour.",
        )

    if key_present:
        reason = resolution.get("live_error") or "the live API has not been queried yet"
        detail = f"Showing seed data — {reason}."
    else:
        detail = (
            "Showing seed data — DATAGOV_API_KEY is not set, so live Agmarknet "
            "prices are unavailable."
        )
    return _entry(
        "mandi_prices",
        "Mandi prices",
        "seed",
        seed_as_of,
        "dataset/mandi_prices.csv",
        detail,
    )


def _ml_entry() -> Dict[str, Any]:
    manifest_path = _MODEL_DIR / "manifest.json"
    as_of: Optional[str] = None
    detail = "Planning models trained from the repository seed data."
    if manifest_path.exists():
        try:
            with manifest_path.open("r", encoding="utf-8") as f:
                manifest = json.load(f)
            as_of = (
                manifest.get("trained_at")
                or manifest.get("generated_at")
                or manifest.get("timestamp")
            )
            models = manifest.get("models") or []
            if models:
                detail = f"{len(models)} planning models trained from the repository seed data."
        except (OSError, ValueError):
            pass
    if not as_of:
        as_of = _file_mtime_iso(manifest_path)
    return _entry(
        "ml_models",
        "Prediction models",
        "seed",
        as_of,
        "ml/models/*.joblib",
        detail + " Not independently validated against field trials.",
    )


def describe_sources() -> Dict[str, Any]:
    """Freshness + provenance for every dataset behind the user-facing numbers."""
    sources: List[Dict[str, Any]] = [
        _mandi_entry(),
        _entry(
            "msp",
            "Minimum support price",
            "seed",
            _max_column("msp_prices.csv", "year"),
            "dataset/msp_prices.csv (CACP announcements)",
            "MSP is announced once per season and changes rarely.",
        ),
        _entry(
            "weather",
            "Weather",
            "seed",
            _max_column("weather.csv", "year"),
            "dataset/weather.csv (seasonal averages)",
            "Planning uses seasonal averages from the CSV. The live Open-Meteo "
            "fetcher currently covers only the three pilot regions.",
        ),
        # soil.csv carries no observation date, and its file mtime only reflects
        # when the repo was checked out — reporting that as an age would be
        # inventing precision. Left unknown on purpose.
        _entry(
            "soil",
            "Soil profile",
            "seed",
            None,
            "dataset/soil.csv (static reference profiles)",
            "Region-level reference profiles with no survey date. Draw your farm "
            "boundary to fetch a live SoilGrids profile for your own plot.",
        ),
        _entry(
            "yield_history",
            "Yield history",
            "seed",
            _max_column("yield_history.csv", "year"),
            "dataset/yield_history.csv",
            "District yield records used to calibrate forecasts.",
        ),
        _ml_entry(),
    ]

    rank = {"stale": 3, "aging": 2, "fresh": 1, "unknown": 0}
    worst = max(sources, key=lambda s: rank.get(s["staleness"], 0))

    return {
        "generated_at": datetime.now().isoformat(timespec="seconds"),
        "overall": worst["staleness"],
        "any_live": any(s["mode"] == "live" for s in sources),
        "sources": sources,
    }


def source_for(source_id: str) -> Optional[Dict[str, Any]]:
    """Single source record by id, or None if unknown."""
    for entry in describe_sources()["sources"]:
        if entry["id"] == source_id:
            return entry
    return None
