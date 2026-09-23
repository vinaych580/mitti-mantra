"""
utils/sensor_log.py

Farmer-uploaded sensor readings (soil moisture, NPK, weather, etc.),
written by /api/sensors/upload and read by /api/sensors/{region_id} and the
Smart IoT Pump tool (/api/iot/telemetry, /api/iot/pump-trigger) so those can
prefer real uploaded data over the static sample/seed values when it's
available.

Backed by the shared SQLite database in utils/db.py -- see
commitment_log.py's and db.py's docstrings for why. read_all() and
latest_by_metric() return string-valued dicts on purpose, matching the old
CSV reader's shape (callers do e.g. float(row["value"])); the "value"
column itself is stored as TEXT for the same reason, so no stringify step
is needed on the way out.
"""
from __future__ import annotations

import calendar
import time
import uuid
from typing import Any

from utils.db import connect

_COLUMNS = "reading_id, region_id, device_id, metric, value, unit, timestamp, source"


def read_all() -> list[dict[str, str]]:
    """Return all sensor reading rows, freshly read from the database."""
    with connect() as conn:
        rows = conn.execute(f"SELECT {_COLUMNS} FROM sensor_readings").fetchall()
    return [dict(r) for r in rows]


def append_batch(
    *, region_id: str, device_id: str, source: str,
    readings: list[dict[str, Any]],
) -> list[dict[str, str]]:
    """Append a batch of readings parsed from one uploaded file.

    Each item in `readings` must have `metric` and `value`, and may have
    `unit` and `timestamp` (defaults to now, UTC, when omitted). Returns
    the newly written rows (with generated reading_id/timestamp filled in).
    """
    now = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
    new_rows = [
        {
            "reading_id": f"s_{uuid.uuid4().hex[:12]}",
            "region_id": region_id,
            "device_id": device_id,
            "metric": r["metric"],
            "value": str(r["value"]),
            "unit": r.get("unit") or "",
            "timestamp": r.get("timestamp") or now,
            "source": source,
        }
        for r in readings
    ]
    with connect() as conn:
        conn.executemany(
            f"INSERT INTO sensor_readings ({_COLUMNS}) "
            "VALUES (:reading_id, :region_id, :device_id, :metric, :value, :unit, :timestamp, :source)",
            new_rows,
        )
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


def latest_by_metric(
    region_id: str, max_age_days: float = 30.0, *, device_id: str | None = None,
) -> dict[str, dict[str, str]]:
    """Return the most recent reading per metric for a region.

    Pass `device_id` to see only that device's uploads. Anything shown back to
    a farmer as *their* live data must pass it -- region-wide results mix in
    every other farmer's readings.

    Readings older than `max_age_days` are ignored -- a farmer's stale
    upload from months ago shouldn't silently keep overriding live
    calculations forever.
    """
    cutoff = time.time() - max_age_days * 86400
    latest: dict[str, dict[str, str]] = {}
    latest_ts: dict[str, float] = {}
    sql = f"SELECT {_COLUMNS} FROM sensor_readings WHERE region_id = ?"
    params: tuple[str, ...] = (region_id,)
    if device_id is not None:
        sql += " AND device_id = ?"
        params += (device_id,)
    with connect() as conn:
        rows = conn.execute(sql, params).fetchall()
    for row in rows:
        ts_str = row["timestamp"] or ""
        try:
            ts = calendar.timegm(time.strptime(ts_str, "%Y-%m-%dT%H:%M:%SZ"))
        except ValueError:
            continue
        if ts < cutoff:
            continue
        metric = row["metric"]
        if metric is None:
            continue
        if metric not in latest_ts or ts >= latest_ts[metric]:
            latest_ts[metric] = ts
            latest[metric] = dict(row)
    return latest
