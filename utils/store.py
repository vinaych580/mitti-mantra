"""Read-only access to dataset/serving.sqlite (Phase 1 serving store).

The store is built by `python -m pipelines.run build` and covers every district
the sources share. When the file is absent (a fresh clone before the store is
built, or a trimmed deploy) every function returns an empty result and callers
keep using the pilot CSVs through utils/csv_cache.py.

Same spirit as csv_cache: one connection per thread, results are plain dicts,
callers must not mutate what they get back from the cached helpers.
"""
from __future__ import annotations

import sqlite3
import threading
from functools import lru_cache
from pathlib import Path
from typing import Any, Dict, List, Optional

_ROOT = Path(__file__).resolve().parent.parent
SERVING_DB = _ROOT / "dataset" / "serving.sqlite"

_local = threading.local()


def available(path: Path = SERVING_DB) -> bool:
    return path.exists()


def _conn(path: Path = SERVING_DB) -> Optional[sqlite3.Connection]:
    if not path.exists():
        return None
    key = str(path)
    conns = getattr(_local, "conns", None)
    if conns is None:
        conns = _local.conns = {}
    con = conns.get(key)
    if con is None:
        con = sqlite3.connect(f"file:{path.as_posix()}?mode=ro", uri=True, check_same_thread=False)
        con.row_factory = sqlite3.Row
        conns[key] = con
    return con


def query(sql: str, params: tuple = (), path: Path = SERVING_DB) -> List[Dict[str, Any]]:
    con = _conn(path)
    if con is None:
        return []
    return [_from_paise(dict(r)) for r in con.execute(sql, params).fetchall()]


def _from_paise(row: Dict[str, Any]) -> Dict[str, Any]:
    """The store keeps rupee prices as integer paise (`*_paise_kg`) to stay
    small; callers always see rupees (`*_inr_kg`)."""
    for k in [k for k in row if k.endswith("_paise_kg")]:
        v = row.pop(k)
        row[k[:-len("_paise_kg")] + "_inr_kg"] = None if v is None else v / 100.0
    return row


@lru_cache(maxsize=1)
def provenance() -> Dict[int, Dict[str, Any]]:
    """source_id -> {source, source_version, fetched_at, licence, is_synthetic}."""
    if not _table_exists("provenance"):
        return {}
    return {r["source_id"]: r for r in query("SELECT * FROM provenance")}


@lru_cache(maxsize=1)
def districts() -> tuple:
    rows = query("SELECT * FROM districts ORDER BY state_name, district_name")
    for r in rows:
        for k in ("has_yields", "has_weather", "has_prices"):
            r[k] = bool(r[k])
    return tuple(rows)


def district(district_id: str) -> Optional[Dict[str, Any]]:
    for r in districts():
        if r["district_id"] == district_id or (r["region_id"] and r["region_id"] == district_id):
            return r
    return None


def meta() -> Dict[str, Dict[str, Any]]:
    return {r["table_name"]: r for r in query("SELECT * FROM meta")}


def yields(district_id: str, crop_id: Optional[str] = None) -> List[Dict[str, Any]]:
    sql = "SELECT * FROM yield_dcy WHERE district_id = ?"
    params: tuple = (district_id,)
    if crop_id:
        sql += " AND crop_id = ?"
        params += (crop_id,)
    return query(sql + " ORDER BY crop_id, season, year", params)


def prices(district_id: str, crop_id: Optional[str] = None) -> List[Dict[str, Any]]:
    sql = "SELECT * FROM price_district_weekly WHERE district_id = ?"
    params: tuple = (district_id,)
    if crop_id:
        sql += " AND crop_id = ?"
        params += (crop_id,)
    return query(sql + " ORDER BY crop_id, week", params)


def weather(district_id: str, season: Optional[str] = None) -> List[Dict[str, Any]]:
    sql = "SELECT * FROM weather_season WHERE district_id = ?"
    params: tuple = (district_id,)
    if season:
        sql += " AND season = ?"
        params += (season.lower(),)
    return query(sql + " ORDER BY year, season", params)


def _table_exists(name: str) -> bool:
    return bool(query("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?", (name,)))


def soil(district_id: str) -> List[Dict[str, Any]]:
    """Soil Health Card shares of tested samples per nutrient, latest year."""
    if not _table_exists("soil_district"):
        return []
    return query("SELECT * FROM soil_district WHERE district_id = ? ORDER BY nutrient", (district_id,))


def irrigation(district_id: str, crop_id: Optional[str] = None) -> List[Dict[str, Any]]:
    if not _table_exists("irrigation_share"):
        return []
    sql = "SELECT * FROM irrigation_share WHERE district_id = ?"
    params: tuple = (district_id,)
    if crop_id:
        sql += " AND crop_id = ?"
        params += (crop_id,)
    return query(sql + " ORDER BY crop_id, year", params)


def costs(state_code: str, crop_id: Optional[str] = None) -> List[Dict[str, Any]]:
    """Cost of Cultivation survey estimates (Rs/acre) for one state."""
    if not _table_exists("cost_state_crop"):
        return []
    sql = "SELECT * FROM cost_state_crop WHERE state_code = ?"
    params: tuple = (str(state_code),)
    if crop_id:
        sql += " AND crop_id = ?"
        params += (crop_id,)
    return query(sql + " ORDER BY crop_id, year", params)


def weather_stages(district_id: str, crop_id: Optional[str] = None) -> List[Dict[str, Any]]:
    """Rain, heat and dry spells per growth stage, last three seasons."""
    if not _table_exists("weather_stage"):
        return []
    sql = "SELECT * FROM weather_stage WHERE district_id = ?"
    params: tuple = (district_id,)
    if crop_id:
        sql += " AND crop_id = ?"
        params += (crop_id,)
    return query(sql + " ORDER BY crop_id, season, year, stage_idx", params)


def monsoon_onset(district_id: str) -> List[Dict[str, Any]]:
    if not _table_exists("monsoon_onset"):
        return []
    return query("SELECT year, onset_date, onset_doy, source_id FROM monsoon_onset WHERE district_id = ? ORDER BY year",
                 (district_id,))


def sources_for(*row_lists: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    """Provenance rows for every source_id the given rows refer to."""
    ids = {r.get("source_id") for rows in row_lists for r in rows}
    table = provenance()
    return [table[i] for i in sorted(i for i in ids if i in table)]


def reset() -> None:
    """Drop cached results and connections (tests, or after a rebuild)."""
    districts.cache_clear()
    provenance.cache_clear()
    for con in getattr(_local, "conns", {}).values():
        con.close()
    _local.conns = {}
