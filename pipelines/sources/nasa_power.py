"""A5 — NASA POWER daily point data (MERRA-2 based; precipitation bias-corrected
against GPCP), one series per district point from pipelines/districts.py.

Open data, no key. One request per district covers 1997-01-01 to the latest
complete month. The raw JSON is kept per district under data/raw/nasa_power/.

stage() writes:
  weather_daily.parquet   district_id, date, rain_mm, tmin, tmax, tmean, rh, solar, wind
  weather_season.parquet  district_id, season, year, rainfall_mm, avg/min/max temp,
                          dry_spell_max_days, hot_days_35c, n_days
using the season windows the app already uses (data_ingestion/refresh_weather_seed.py):
  kharif Y = Jun-Oct Y, rabi Y = Nov Y - Mar Y+1, zaid Y = Mar-May Y.
A season with fewer than 90% of its days present is left out, not filled.
"""
from __future__ import annotations

import gzip
import json
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import date, timedelta
from pathlib import Path

from pipelines.common import RAW, STAGED, ensure_dirs, http_get_json, log, utc_now, write_fetch_meta

URL = "https://power.larc.nasa.gov/api/temporal/daily/point"
RAW_DIR = RAW / "nasa_power"
SOURCE = "NASA POWER daily (MERRA-2)"
LICENCE = "NASA open data (no restrictions; attribution requested)"
PARAMS = {"PRECTOTCORR": "rain_mm", "T2M_MIN": "tmin", "T2M_MAX": "tmax", "T2M": "tmean",
          "RH2M": "rh", "ALLSKY_SFC_SW_DWN": "solar", "WS2M": "wind"}
START = date(1997, 1, 1)
SEASONS = ("kharif", "rabi", "zaid")


def _end_date() -> date:
    first_of_month = date.today().replace(day=1)
    return first_of_month - timedelta(days=1)


def season_range(season: str, year: int) -> tuple[date, date]:
    if season == "kharif":
        return date(year, 6, 1), date(year, 10, 31)
    if season == "rabi":
        return date(year, 11, 1), date(year + 1, 3, 31)
    if season == "zaid":
        return date(year, 3, 1), date(year, 5, 31)
    raise ValueError(season)


def _fetch_one(did: str, lat: float, lon: float, end: date, force: bool, max_age_days: float | None) -> str:
    import time

    path = RAW_DIR / f"{did}.json.gz"
    if path.exists() and not force:
        age_days = (time.time() - path.stat().st_mtime) / 86400
        if max_age_days is None or age_days < max_age_days:
            return "cached"
    data = http_get_json(URL, {
        "parameters": ",".join(PARAMS), "community": "AG", "format": "JSON",
        "latitude": round(lat, 4), "longitude": round(lon, 4),
        "start": START.strftime("%Y%m%d"), "end": end.strftime("%Y%m%d"),
    }, timeout=300)
    payload = {"district_id": did, "lat": lat, "lon": lon, "fetched_at": utc_now(),
               "parameter": data["properties"]["parameter"]}
    with gzip.open(path, "wt", encoding="utf-8") as f:
        json.dump(payload, f)
    return "fetched"


def download(districts=None, force: bool = False, workers: int = 4, only_pilots: bool = False,
             max_age_days: float | None = None) -> Path:
    import pandas as pd

    RAW_DIR.mkdir(parents=True, exist_ok=True)
    d = districts if districts is not None else pd.read_parquet(STAGED / "districts.parquet")
    d = d[d["lat"].notna()]
    if only_pilots:
        d = d[d["region_id"] != ""]
    end = _end_date()
    done = failed = 0
    with ThreadPoolExecutor(max_workers=workers) as pool:
        futs = {pool.submit(_fetch_one, r.district_id, float(r.lat), float(r.lon), end, force, max_age_days):
                r.district_id
                for r in d.itertuples()}
        for fut in as_completed(futs):
            try:
                fut.result()
                done += 1
            except Exception as exc:
                failed += 1
                log.warning("nasa_power %s: %s", futs[fut], exc)
            if (done + failed) % 50 == 0:
                log.info("nasa_power: %d/%d", done + failed, len(futs))
    write_fetch_meta(RAW_DIR, url=URL, end=end.isoformat(), districts=done, failed=failed)
    log.info("nasa_power: %d ok, %d failed", done, failed)
    return RAW_DIR


def _read_daily(path: Path):
    import pandas as pd

    with gzip.open(path, "rt", encoding="utf-8") as f:
        p = json.load(f)
    cols = {}
    for key, name in PARAMS.items():
        series = p["parameter"].get(key, {})
        cols[name] = pd.Series(series, dtype="float64")
    df = pd.DataFrame(cols)
    df = df.mask(df <= -998)  # POWER's fill value is -999
    df.index = pd.to_datetime(df.index, format="%Y%m%d")
    df = df.rename_axis("date").reset_index()
    df.insert(0, "district_id", p["district_id"])
    df["fetched_at"] = p["fetched_at"]
    return df


def _longest_dry_spell(rain) -> int:
    best = run = 0
    for v in rain:
        if v is not None and v < 2.5:  # IMD "dry day": under 2.5 mm
            run += 1
            best = max(best, run)
        else:
            run = 0
    return best


def season_aggregates(daily):
    import pandas as pd

    rows = []
    for did, g in daily.groupby("district_id"):
        g = g.set_index("date").sort_index()
        years = range(g.index.min().year, g.index.max().year + 1)
        for year in years:
            for season in SEASONS:
                start, end = season_range(season, year)
                s = g.loc[str(start):str(end)]
                expected = (end - start).days + 1
                s = s.dropna(subset=["rain_mm", "tmin", "tmax"])
                if len(s) < 0.9 * expected:
                    continue
                rows.append({
                    "district_id": did, "season": season, "year": year,
                    "rainfall_mm": round(s["rain_mm"].sum(), 1),
                    "avg_temp_c": round(((s["tmin"] + s["tmax"]) / 2).mean(), 1),
                    "min_temp_c": round(s["tmin"].min(), 1),
                    "max_temp_c": round(s["tmax"].max(), 1),
                    "dry_spell_max_days": _longest_dry_spell(s["rain_mm"].tolist()),
                    "hot_days_35c": int((s["tmax"] >= 35).sum()),
                    "n_days": len(s),
                })
    return pd.DataFrame(rows)


def stage():
    import pandas as pd

    ensure_dirs()
    files = sorted(RAW_DIR.glob("*.json.gz"))
    if not files:
        raise FileNotFoundError("no NASA POWER downloads; run the download step first")
    daily = pd.concat([_read_daily(p) for p in files], ignore_index=True)
    for df in (daily,):
        df["source"] = SOURCE
        df["source_version"] = "POWER daily v2"
        df["licence"] = LICENCE
        df["is_synthetic"] = False
    daily.to_parquet(STAGED / "weather_daily.parquet", index=False)

    season = season_aggregates(daily)
    fetched = daily.groupby("district_id")["fetched_at"].first()
    season["fetched_at"] = season["district_id"].map(fetched)
    season["source"] = SOURCE
    season["source_version"] = "POWER daily v2"
    season["licence"] = LICENCE
    season["is_synthetic"] = False
    season.to_parquet(STAGED / "weather_season.parquet", index=False)
    log.info("nasa_power: %d daily rows, %d season rows, %d districts",
             len(daily), len(season), daily["district_id"].nunique())
    return daily, season
