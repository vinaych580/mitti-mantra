"""
Refresh dataset/weather.csv with the most recently completed agricultural
seasons, pulled from the Open-Meteo historical archive (no API key needed).

Not wired into production -- same status as the rest of data_ingestion
(see AUDIT_REPORT.md M-22). This is a maintenance script: run it manually
or on a schedule to keep the seed CSV from going stale.

    python -m data_ingestion.refresh_weather_seed

Coordinates are approximate district-headquarters lat/lon for each
region_id, at the same precision as the 3 pilot regions already
hardcoded in fetchers/weather.py -- Open-Meteo's underlying reanalysis
grid is ~9-25km, so district-center precision matches the existing data
rather than downgrading it.
"""
from __future__ import annotations

import csv
import logging
from datetime import date
from pathlib import Path

import requests

logger = logging.getLogger(__name__)

_DATASET_DIR = Path(__file__).resolve().parents[1] / "dataset"
_WEATHER_CSV = _DATASET_DIR / "weather.csv"
_ARCHIVE_URL = "https://archive-api.open-meteo.com/v1/archive"

_FIELDNAMES = ["region_id", "season", "year", "rainfall_mm", "avg_temp_c", "min_temp_c", "max_temp_c"]

# region_id -> (lat, lon), district-HQ coordinates for all 30 regions in
# dataset/weather.csv. The first 3 match fetchers/weather.py's _REGION_COORDS.
REGION_COORDS: dict[str, tuple[float, float]] = {
    "ap_guntur": (16.30, 80.44),
    "assam_nagaon": (26.35, 92.68),
    "bihar_patna": (25.59, 85.14),
    "chhattisgarh_raipur": (21.25, 81.63),
    "goa_north": (15.49, 73.83),
    "guj_anand": (22.56, 72.95),
    "guj_rajkot": (22.30, 70.80),
    "haryana_karnal": (29.68, 76.99),
    "hp_shimla": (31.10, 77.17),
    "jharkhand_ranchi": (23.34, 85.31),
    "jk_pulwama": (33.87, 74.93),
    "kar_belagavi": (15.85, 74.50),
    "kar_mysuru": (12.30, 76.64),
    "kerala_palakkad": (10.78, 76.65),
    "mh_nashik": (20.00, 73.79),
    "mh_pune": (18.52, 73.86),
    "mh_yavatmal": (20.39, 78.13),
    "mp_indore": (22.72, 75.86),
    "mp_sehore": (23.20, 77.08),
    "odisha_cuttack": (20.46, 85.88),
    "punjab_ludhiana": (30.90, 75.85),
    "rajasthan_jaipur": (26.91, 75.79),
    "telangana_medak": (17.61, 78.26),
    "tn_coimbatore": (11.02, 76.96),
    "tn_thanjavur": (10.79, 79.14),
    "tripura_west": (23.83, 91.28),
    "uk_udhamsinghnagar": (28.98, 79.40),
    "up_lucknow": (26.85, 80.95),
    "up_varanasi": (25.32, 82.99),
    "wb_bardhaman": (23.24, 87.86),
}


def _season_range(season: str, year: int) -> tuple[date, date]:
    """Kharif `year` runs Jun-Oct of `year`; rabi `year` runs Nov `year` to
    Mar `year+1` -- matching the existing CSV's agricultural-year convention,
    where "kharif Y" is immediately followed by "rabi Y" for the same crop
    year. Zaid `year` runs Mar-May of `year` -- the summer season between
    rabi's harvest and the next kharif's sowing, entirely within one
    calendar year unlike rabi."""
    if season == "kharif":
        return date(year, 6, 1), date(year, 10, 31)
    if season == "rabi":
        return date(year, 11, 1), date(year + 1, 3, 31)
    if season == "zaid":
        return date(year, 3, 1), date(year, 5, 31)
    raise ValueError(f"unknown season: {season}")


def _completed_seasons(today: date) -> list[tuple[str, int]]:
    """(season, year) pairs whose season has fully ended as of `today`."""
    seasons = []
    for year in range(2022, today.year + 1):
        for season in ("kharif", "rabi", "zaid"):
            _, end = _season_range(season, year)
            if end < today:
                seasons.append((season, year))
    return seasons


def _fetch_season_aggregate(lat: float, lon: float, start: date, end: date) -> dict[str, float] | None:
    params = {
        "latitude": lat,
        "longitude": lon,
        "start_date": start.isoformat(),
        "end_date": end.isoformat(),
        "daily": "precipitation_sum,temperature_2m_max,temperature_2m_min",
        "timezone": "Asia/Kolkata",
    }
    resp = requests.get(_ARCHIVE_URL, params=params, timeout=20)
    resp.raise_for_status()
    daily = resp.json().get("daily", {})
    tmax_raw = daily.get("temperature_2m_max", [])
    tmin_raw = daily.get("temperature_2m_min", [])
    precip = [v for v in daily.get("precipitation_sum", []) if v is not None]
    pairs = [(a, b) for a, b in zip(tmax_raw, tmin_raw) if a is not None and b is not None]

    if not pairs:
        return None

    return {
        "rainfall_mm": round(sum(precip), 1) if precip else 0.0,
        "avg_temp_c": round(sum((a + b) / 2 for a, b in pairs) / len(pairs), 1),
        "min_temp_c": round(min(b for _, b in pairs), 1),
        "max_temp_c": round(max(a for a, _ in pairs), 1),
    }


def refresh(dry_run: bool = False) -> list[dict[str, str]]:
    """Append missing (region, season, year) rows to dataset/weather.csv.
    Returns the rows that were (or would be, if dry_run) added."""
    existing: set[tuple[str, str, str]] = set()
    with _WEATHER_CSV.open("r", newline="", encoding="utf-8") as f:
        for row in csv.DictReader(f):
            existing.add((row["region_id"], row["season"], row["year"]))

    today = date.today()
    to_add: list[dict[str, str]] = []
    for region_id, (lat, lon) in REGION_COORDS.items():
        for season, year in _completed_seasons(today):
            if (region_id, season, str(year)) in existing:
                continue
            start, end = _season_range(season, year)
            try:
                agg = _fetch_season_aggregate(lat, lon, start, end)
            except requests.exceptions.RequestException as e:
                logger.error(f"Failed to fetch {region_id} {season} {year}: {e}")
                continue
            if agg is None:
                logger.warning(f"No usable daily data for {region_id} {season} {year}")
                continue
            to_add.append(
                {
                    "region_id": region_id,
                    "season": season,
                    "year": str(year),
                    "rainfall_mm": str(agg["rainfall_mm"]),
                    "avg_temp_c": str(agg["avg_temp_c"]),
                    "min_temp_c": str(agg["min_temp_c"]),
                    "max_temp_c": str(agg["max_temp_c"]),
                }
            )

    if to_add and not dry_run:
        with _WEATHER_CSV.open("a", newline="", encoding="utf-8") as f:
            csv.DictWriter(f, fieldnames=_FIELDNAMES).writerows(to_add)

    return to_add


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO, format="%(levelname)s %(message)s")
    added = refresh()
    print(f"Added {len(added)} row(s) to {_WEATHER_CSV}")
    for row in added:
        print(row)
