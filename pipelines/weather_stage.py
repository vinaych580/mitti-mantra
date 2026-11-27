"""Growth-stage weather (spec 1.3 `weather_stage`) and monsoon onset.

Derived from curated weather_daily, so no new download. For each district,
crop, season and year it cuts the season into the crop's growth stages and
reports rain, heat and dry spells per stage: the in-season timing a seasonal
total hides (a wet June and a dry flowering month add up to a normal season).

Assumptions, each because the spec's crop-calendar source (A14) is not yet
in hand. They are the app's own agronomy, read from engine/features.py so the
two never drift apart:

* Sowing date = middle of the crop's national sowing window in CROP_CALENDAR
  (rice kharif: Jun 15 - Jul 15 -> Jun 30). States differ by a few weeks;
  a state calendar can replace this per district later.
* Season length = CROP_CALENDAR duration_days; stages = CROP_WATER_STAGES
  fractions of that length. Crops with no stage table get one stage.
* GDD base temperature: 10 C for warm-season crops, 5 C for wheat and rabi
  pulses (common agronomic values), tmean capped at 35 C.
* Monsoon onset (kharif only): the first day from May 15 that starts two days
  with >= 20 mm together, not followed by a 7-day dry spell within 30 days
  (the usual agronomic onset definition). No such day -> no onset row.
* A stage with under 90% of its days present is left out, not filled.
"""
from __future__ import annotations

import re
from datetime import date, datetime, timedelta

from pipelines.common import log

DRY_DAY_MM = 2.5
HOT_C = 35.0
COLD_BASE = {"wheat": 5.0, "barley": 5.0, "pulses": 5.0}
WARM_BASE = 10.0
GDD_CAP = 35.0


def _slug(s: str) -> str:
    return re.sub(r"[^a-z0-9]+", "_", s.lower()).strip("_")


def crop_stage_plans() -> list[dict]:
    """One plan per (crop, season): sowing month/day, duration and stages."""
    from engine.features import CROP_CALENDAR, CROP_WATER_STAGES

    plans = []
    for crop, seasons in CROP_CALENDAR.items():
        for season, cal in seasons.items():
            window = str(cal.get("sowing_transplant", ""))
            parts = re.findall(r"([A-Z][a-z]{2}) (\d{1,2})", window)
            if not parts or not cal.get("duration_days"):
                continue
            d0 = datetime.strptime(f"{parts[0][0]} {parts[0][1]} 2001", "%b %d %Y")
            d1 = datetime.strptime(f"{parts[-1][0]} {parts[-1][1]} 2001", "%b %d %Y") if len(parts) > 1 else d0
            mid = d0 + (d1 - d0) / 2
            stages = CROP_WATER_STAGES.get(crop, [(0.0, 1.0, 1.0, "Full season")])
            plans.append({
                "crop_id": crop, "season": season, "sow_month": mid.month, "sow_day": mid.day,
                "duration_days": int(cal["duration_days"]),
                "gdd_base": COLD_BASE.get(crop, WARM_BASE) if season == "rabi" or crop in ("wheat", "barley")
                else WARM_BASE,
                "stages": [(i, _slug(name), a, b) for i, (a, b, _w, name) in enumerate(stages)],
            })
    return plans


def _dry_run_lengths(rain):
    """run[i] = number of consecutive dry days ending at day i (NaN breaks a run)."""
    import numpy as np

    run = np.zeros(len(rain), dtype=np.int32)
    n = 0
    for i, v in enumerate(rain):
        n = n + 1 if (v == v and v < DRY_DAY_MM) else 0  # v == v is False for NaN
        run[i] = n
    return run


def _window_max_dry(run, a: int, b: int) -> int:
    import numpy as np

    seg = run[a:b + 1]
    return int(np.max(np.minimum(seg, np.arange(1, len(seg) + 1)))) if len(seg) else 0


def _onset(dates, rain, run, year: int):
    import numpy as np

    start = np.searchsorted(dates, np.datetime64(date(year, 5, 15)))
    stop = np.searchsorted(dates, np.datetime64(date(year, 9, 30)))
    for i in range(start, min(stop, len(rain) - 31)):
        two = rain[i] + rain[i + 1]
        if two == two and two >= 20.0:
            if _window_max_dry(run, i + 2, i + 31) < 7:
                return dates[i].astype("datetime64[D]").astype(object)
    return None


def build(weather_daily, districts_with_weather=None):
    """Returns (weather_stage, monsoon_onset) DataFrames."""
    import numpy as np
    import pandas as pd

    plans = crop_stage_plans()
    stage_rows, onset_rows = [], []
    w = weather_daily.sort_values(["district_id", "date"])
    for did, g in w.groupby("district_id", sort=False):
        dates = g["date"].values.astype("datetime64[D]")
        if len(dates) == 0:
            continue
        # Daily series are contiguous from NASA POWER; reindex to be safe.
        full = pd.date_range(dates[0], dates[-1], freq="D")
        g = g.set_index("date").reindex(full)
        dates = full.values.astype("datetime64[D]")
        rain = g["rain_mm"].to_numpy(float)
        tmax = g["tmax"].to_numpy(float)
        tmean = g["tmean"].to_numpy(float)
        have = (~np.isnan(rain) & ~np.isnan(tmax) & ~np.isnan(tmean)).astype(np.int32)
        c_have = np.concatenate([[0], np.cumsum(have)])
        c_rain = np.concatenate([[0], np.cumsum(np.nan_to_num(rain))])
        c_tmax = np.concatenate([[0], np.cumsum(np.nan_to_num(tmax))])
        c_tmean = np.concatenate([[0], np.cumsum(np.nan_to_num(tmean))])
        c_hot = np.concatenate([[0], np.cumsum(np.nan_to_num(tmax) > HOT_C)])
        gdd_c = {}
        for base in {p["gdd_base"] for p in plans}:
            gdd_c[base] = np.concatenate([[0], np.cumsum(np.clip(np.minimum(np.nan_to_num(tmean), GDD_CAP) - base,
                                                                 0, None))])
        run = _dry_run_lengths(rain)
        first, last = dates[0], dates[-1]
        y0, y1 = first.astype(object).year, last.astype(object).year

        for year in range(y0, y1 + 1):
            o = _onset(dates, rain, run, year)
            if o is not None:
                onset_rows.append({"district_id": did, "year": year, "onset_date": o.isoformat(),
                                   "onset_doy": o.timetuple().tm_yday})
            for p in plans:
                sow = date(year, p["sow_month"], p["sow_day"])
                for idx, name, fa, fb in p["stages"]:
                    s = sow + timedelta(days=round(fa * p["duration_days"]))
                    e = sow + timedelta(days=round(fb * p["duration_days"]) - 1)
                    a = int((np.datetime64(s) - first).astype(int))
                    b = int((np.datetime64(e) - first).astype(int))
                    if a < 0 or b >= len(dates) or b < a:
                        continue
                    n = b - a + 1
                    present = int(c_have[b + 1] - c_have[a])
                    if present < 0.9 * n:
                        continue
                    stage_rows.append({
                        "district_id": did, "crop_id": p["crop_id"], "season": p["season"], "year": year,
                        "stage_idx": idx, "stage": name, "start_date": s.isoformat(), "end_date": e.isoformat(),
                        "n_days": n,
                        "rain_mm": round(float(c_rain[b + 1] - c_rain[a]), 1),
                        "tmax_mean_c": round(float(c_tmax[b + 1] - c_tmax[a]) / present, 2),
                        "tmean_c": round(float(c_tmean[b + 1] - c_tmean[a]) / present, 2),
                        "hot_days_35c": int(c_hot[b + 1] - c_hot[a]),
                        "dry_spell_max_days": _window_max_dry(run, a, b),
                        "gdd": round(float(gdd_c[p["gdd_base"]][b + 1] - gdd_c[p["gdd_base"]][a]), 1),
                    })
    st = pd.DataFrame(stage_rows)
    on = pd.DataFrame(onset_rows)
    log.info("weather_stage: %d stage rows, %d onsets", len(st), len(on))
    return st, on
