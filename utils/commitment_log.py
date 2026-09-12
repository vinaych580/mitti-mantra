"""
utils/commitment_log.py

Farmers' "I'm planting this" commitments, used by ml/predict.py to compute
a regional crop-saturation signal (see
docs/superpowers/specs/2026-09-02-regional-saturation-aware-recommendations-design.md).

Backed by the shared SQLite database in utils/db.py rather than a flat CSV
-- see that module's docstring for why. read_all()/upsert() intentionally
return the same shape the old CSV reader did: every value stringified, e.g.
"year": "2026" and "area_acres": "4.5", never the native int/float. Callers
(ml/predict.py's `r["year"] == str(year)`, in particular) compare against
those strings, so only this module's own SQL sees real INTEGER/REAL
columns -- the stringified dict is the public contract, not an
implementation detail.
"""
from __future__ import annotations

import time
import uuid
from typing import Any

from utils.db import connect


def _stringify(row: Any) -> dict[str, str]:
    return {
        "commitment_id": row["commitment_id"],
        "region_id": row["region_id"],
        "crop_id": row["crop_id"],
        "season": row["season"],
        "year": str(row["year"]),
        "area_acres": str(row["area_acres"]),
        "device_id": row["device_id"],
        "timestamp": row["timestamp"],
    }


def read_all() -> list[dict[str, str]]:
    """Return all commitment rows, freshly read from the database."""
    with connect() as conn:
        rows = conn.execute(
            "SELECT commitment_id, region_id, crop_id, season, year, "
            "area_acres, device_id, timestamp FROM commitments"
        ).fetchall()
    return [_stringify(r) for r in rows]


def upsert(
    *, region_id: str, crop_id: str, season: str, year: int,
    area_acres: float, device_id: str,
) -> dict[str, Any]:
    """Record a farmer's planting commitment.

    A prior commitment from the same device_id for the same
    region_id/season/year is replaced in place (latest crop_id/area_acres/
    timestamp wins) rather than duplicated, so one farmer re-committing or
    changing their mind doesn't inflate the region's saturation count. The
    UNIQUE(device_id, region_id, season, year) constraint in utils/db.py
    plus ON CONFLICT below makes that replacement one atomic statement
    instead of the old read-whole-file / filter / rewrite-whole-file.
    """
    commitment_id = f"c_{uuid.uuid4().hex[:12]}"
    timestamp = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
    with connect() as conn:
        conn.execute(
            """
            INSERT INTO commitments
                (commitment_id, region_id, crop_id, season, year, area_acres, device_id, timestamp)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(device_id, region_id, season, year) DO UPDATE SET
                commitment_id = excluded.commitment_id,
                crop_id = excluded.crop_id,
                area_acres = excluded.area_acres,
                timestamp = excluded.timestamp
            """,
            (commitment_id, region_id, crop_id, season, year, area_acres, device_id, timestamp),
        )
        row = conn.execute(
            "SELECT commitment_id, region_id, crop_id, season, year, area_acres, device_id, timestamp "
            "FROM commitments WHERE device_id = ? AND region_id = ? AND season = ? AND year = ?",
            (device_id, region_id, season, year),
        ).fetchone()
    return _stringify(row)
