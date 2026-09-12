"""
utils/db.py

Single shared SQLite database for AgriSim's runtime-written data: farmer
crop commitments (utils/commitment_log.py) and uploaded sensor readings
(utils/sensor_log.py). Both used to be independent flat CSVs, each read in
full and rewritten in full on every write under an in-process
threading.RLock -- correct only within one process, and not across
concurrent worker processes or serverless function instances, which don't
share memory. See the VERCEL branch below: production writes already
redirect to /tmp because the deployed filesystem is read-only, and /tmp is
itself ephemeral per instance, so this doesn't change what survives a cold
start -- it fixes correctness *within* a running instance (concurrent
requests hitting the same worker) via real SQL transactions instead of a
bare read-modify-write, and makes a future swap to a networked database
(Postgres, Turso/LiteFS) a change to this one module instead of two.
"""
from __future__ import annotations

import os
import sqlite3
from contextlib import contextmanager
from pathlib import Path
from typing import Iterator

from utils.csv_cache import DATASET_DIR


def _resolve_db_path() -> Path:
    """Resolve the SQLite file path, honoring VERCEL and AGRISIM_CACHE_DIR env vars.

    Same rationale as the CSV modules this replaces: production (VERCEL)
    writes redirect to /tmp because the deployed filesystem is read-only;
    AGRISIM_CACHE_DIR overrides for tests; otherwise dataset/dynamic/.
    """
    base = os.environ.get("AGRISIM_CACHE_DIR")
    if os.environ.get("VERCEL"):
        base = "/tmp/.cache"
    if base:
        return Path(base) / "dynamic" / "agrisim.db"
    return DATASET_DIR / "dynamic" / "agrisim.db"


DB_PATH: Path = _resolve_db_path()

_SCHEMA = """
CREATE TABLE IF NOT EXISTS commitments (
    commitment_id TEXT PRIMARY KEY,
    region_id     TEXT NOT NULL,
    crop_id       TEXT NOT NULL,
    season        TEXT NOT NULL,
    year          INTEGER NOT NULL,
    area_acres    REAL NOT NULL,
    device_id     TEXT NOT NULL,
    timestamp     TEXT NOT NULL,
    UNIQUE(device_id, region_id, season, year)
);

CREATE TABLE IF NOT EXISTS sensor_readings (
    reading_id TEXT PRIMARY KEY,
    region_id  TEXT NOT NULL,
    device_id  TEXT NOT NULL,
    metric     TEXT NOT NULL,
    value      TEXT NOT NULL,
    unit       TEXT NOT NULL DEFAULT '',
    timestamp  TEXT NOT NULL,
    source     TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_sensor_readings_region_metric
    ON sensor_readings(region_id, metric);
"""


@contextmanager
def connect() -> Iterator[sqlite3.Connection]:
    """Open a connection to the shared AgriSim database, schema applied.

    A fresh connection per call rather than a cached one: DB_PATH is
    monkeypatched to a fresh tmp_path per test (see tests/conftest.py), and
    a cached connection would keep pointing at a stale path across tests.
    Write volume here is a handful of commits/uploads per farmer session,
    so the cost of not pooling is negligible. WAL mode lets concurrent
    readers proceed without blocking on a writer.
    """
    DB_PATH.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(DB_PATH, timeout=10)
    conn.row_factory = sqlite3.Row
    try:
        conn.execute("PRAGMA journal_mode=WAL")
        conn.executescript(_SCHEMA)
        yield conn
        conn.commit()
    finally:
        conn.close()
