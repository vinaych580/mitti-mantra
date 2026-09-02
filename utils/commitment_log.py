"""
utils/commitment_log.py

Append-only log of farmers' "I'm planting this" commitments, used by
ml/predict.py to compute a regional crop-saturation signal (see
docs/superpowers/specs/2026-09-02-regional-saturation-aware-recommendations-design.md).

Lives in dataset/dynamic/ rather than dataset/ because, unlike the static
seed CSVs, this file is written to at runtime.
"""
from __future__ import annotations

import csv
import os
import threading
import time
import uuid
from pathlib import Path
from typing import Any

from utils.csv_cache import DATASET_DIR


def _resolve_commitments_path() -> Path:
    """Resolve the commitments file path, honoring VERCEL and AGRISIM_CACHE_DIR env vars.

    In production (VERCEL), writes redirect to /tmp to avoid read-only filesystem errors.
    In test/dev, AGRISIM_CACHE_DIR can override the location.
    Otherwise, defaults to dataset/dynamic/.
    """
    base = os.environ.get("AGRISIM_CACHE_DIR")
    if os.environ.get("VERCEL"):
        base = "/tmp/.cache"
    if base:
        return Path(base) / "dynamic" / "commitments.csv"
    return DATASET_DIR / "dynamic" / "commitments.csv"


_COMMITMENTS_PATH: Path = _resolve_commitments_path()
_FIELDNAMES = [
    "commitment_id", "region_id", "crop_id", "season", "year",
    "area_acres", "device_id", "timestamp",
]

_lock = threading.RLock()


def _read_rows_from_disk() -> list[dict[str, str]]:
    if not _COMMITMENTS_PATH.exists():
        return []
    with _COMMITMENTS_PATH.open("r", encoding="utf-8", newline="") as f:
        return list(csv.DictReader(f))


def read_all() -> list[dict[str, str]]:
    """Return all commitment rows, freshly read from disk.

    No in-memory cache: this file is small (a few hundred rows/season
    across 30 regions) and `upsert()` needs a correctness guarantee a
    mtime-based cache can't give it under fast successive writes.
    """
    with _lock:
        return _read_rows_from_disk()


def upsert(
    *, region_id: str, crop_id: str, season: str, year: int,
    area_acres: float, device_id: str,
) -> dict[str, Any]:
    """Record a farmer's planting commitment.

    A prior commitment from the same device_id for the same
    region_id/season/year is replaced in place (latest crop_id/area_acres/
    timestamp wins) rather than duplicated, so one farmer re-committing or
    changing their mind doesn't inflate the region's saturation count.
    """
    with _lock:
        rows = _read_rows_from_disk()
        key = (device_id, region_id, season, str(year))
        rows = [
            r for r in rows
            if (r["device_id"], r["region_id"], r["season"], r["year"]) != key
        ]
        new_row = {
            "commitment_id": f"c_{uuid.uuid4().hex[:12]}",
            "region_id": region_id,
            "crop_id": crop_id,
            "season": season,
            "year": str(year),
            "area_acres": str(area_acres),
            "device_id": device_id,
            "timestamp": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        }
        rows.append(new_row)

        _COMMITMENTS_PATH.parent.mkdir(parents=True, exist_ok=True)
        with _COMMITMENTS_PATH.open("w", encoding="utf-8", newline="") as f:
            writer = csv.DictWriter(f, fieldnames=_FIELDNAMES)
            writer.writeheader()
            writer.writerows(rows)

        return new_row
