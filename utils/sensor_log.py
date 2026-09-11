"""
utils/sensor_log.py

Append-only log of farmer-uploaded sensor readings (soil moisture, NPK,
weather, etc.), written to by /api/sensors/upload and read by
/api/sensors/{region_id} and the Smart IoT Pump tool
(/api/iot/telemetry, /api/iot/pump-trigger) so those can prefer real
uploaded data over the static sample/seed values when it's available.

Lives in dataset/dynamic/ rather than dataset/ because, unlike the static
seed CSVs, this file is written to at runtime -- same rationale as
utils/commitment_log.py, which this module's shape mirrors.
"""
from __future__ import annotations

import calendar
import csv
import os
import threading
import time
import uuid
from pathlib import Path
from typing import Any

from utils.csv_cache import DATASET_DIR


def _resolve_sensor_readings_path() -> Path:
    """Resolve the sensor readings file path, honoring VERCEL and AGRISIM_CACHE_DIR env vars.

    In production (VERCEL), writes redirect to /tmp to avoid read-only filesystem errors.
    In test/dev, AGRISIM_CACHE_DIR can override the location.
    Otherwise, defaults to dataset/dynamic/.
    """
    base = os.environ.get("AGRISIM_CACHE_DIR")
    if os.environ.get("VERCEL"):
        base = "/tmp/.cache"
    if base:
        return Path(base) / "dynamic" / "sensor_readings.csv"
    return DATASET_DIR / "dynamic" / "sensor_readings.csv"


_SENSOR_READINGS_PATH: Path = _resolve_sensor_readings_path()
_FIELDNAMES = [
    "reading_id", "region_id", "device_id", "metric", "value", "unit",
    "timestamp", "source",
]

_lock = threading.RLock()


def _read_rows_from_disk() -> list[dict[str, str]]:
    if not _SENSOR_READINGS_PATH.exists():
        return []
    with _SENSOR_READINGS_PATH.open("r", encoding="utf-8", newline="") as f:
        return list(csv.DictReader(f))


def read_all() -> list[dict[str, str]]:
    """Return all sensor reading rows, freshly read from disk.

    No in-memory cache, matching commitment_log.py: this file is small and
    append_batch() needs a correctness guarantee a mtime-based cache can't
    give it under fast successive writes.
    """
    with _lock:
        return _read_rows_from_disk()


def append_batch(
    *, region_id: str, device_id: str, source: str,
    readings: list[dict[str, Any]],
) -> list[dict[str, str]]:
    """Append a batch of readings parsed from one uploaded file.

    Each item in `readings` must have `metric` and `value`, and may have
    `unit` and `timestamp` (defaults to now, UTC, when omitted). Returns
    the newly written rows (with generated reading_id/timestamp filled in).
    """
    with _lock:
        rows = _read_rows_from_disk()
        now = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
        new_rows = []
        for r in readings:
            new_rows.append({
                "reading_id": f"s_{uuid.uuid4().hex[:12]}",
                "region_id": region_id,
                "device_id": device_id,
                "metric": r["metric"],
                "value": str(r["value"]),
                "unit": r.get("unit") or "",
                "timestamp": r.get("timestamp") or now,
                "source": source,
            })
        rows.extend(new_rows)

        _SENSOR_READINGS_PATH.parent.mkdir(parents=True, exist_ok=True)
        with _SENSOR_READINGS_PATH.open("w", encoding="utf-8", newline="") as f:
            writer = csv.DictWriter(f, fieldnames=_FIELDNAMES)
            writer.writeheader()
            writer.writerows(rows)

        return new_rows


def regions_with_recent_data(max_age_days: float = 30.0) -> set[str]:
    """Distinct region_ids with at least one reading younger than max_age_days."""
    cutoff = time.time() - max_age_days * 86400
    regions: set[str] = set()
    for row in read_all():
        region_id = row.get("region_id")
        ts_str = row.get("timestamp") or ""
        if not region_id:
            continue
        try:
            ts = calendar.timegm(time.strptime(ts_str, "%Y-%m-%dT%H:%M:%SZ"))
        except ValueError:
            continue
        if ts >= cutoff:
            regions.add(region_id)
    return regions


def latest_by_metric(region_id: str, max_age_days: float = 30.0) -> dict[str, dict[str, str]]:
    """Return the most recent reading per metric for a region.

    Readings older than `max_age_days` are ignored -- a farmer's stale
    upload from months ago shouldn't silently keep overriding live
    calculations forever.
    """
    cutoff = time.time() - max_age_days * 86400
    latest: dict[str, dict[str, str]] = {}
    latest_ts: dict[str, float] = {}
    for row in read_all():
        if row.get("region_id") != region_id:
            continue
        ts_str = row.get("timestamp") or ""
        try:
            ts = calendar.timegm(time.strptime(ts_str, "%Y-%m-%dT%H:%M:%SZ"))
        except ValueError:
            continue
        if ts < cutoff:
            continue
        metric = row.get("metric")
        if metric is None:
            continue
        if metric not in latest_ts or ts >= latest_ts[metric]:
            latest_ts[metric] = ts
            latest[metric] = row
    return latest
