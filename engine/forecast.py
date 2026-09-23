"""
engine/forecast.py

Live 7-day forecast for a farm (Open-Meteo, free, no key) and the day-by-day
field-work calls a farmer makes from it: can I spray today, do I need to
irrigate, is a heat spell coming.

The thresholds are the usual pesticide-label / extension guidance, and they
are returned with every response (RULES) so the advice can be checked rather
than taken on faith:
  - Don't spray when rain is falling or due within ~24 h (it washes the
    chemical off) or when wind is strong enough to drift it.
  - Skip irrigation when meaningful rain is due in the next few days.
  - Flag heat stress at 40 C and above.

fetch_daily() is the only function that touches the network; everything else
is pure and unit-tested.
"""
from __future__ import annotations

import threading
import time
from typing import Any

import requests

FORECAST_URL = "https://api.open-meteo.com/v1/forecast"
DAILY_FIELDS = (
    "precipitation_sum",
    "precipitation_probability_max",
    "temperature_2m_max",
    "temperature_2m_min",
    "wind_speed_10m_max",
)

SPRAY_RAIN_MM = 2.0          # rain today or tomorrow at/above this -> don't spray
SPRAY_RAIN_PROB_PCT = 60     # chance of rain today at/above this -> don't spray
SPRAY_MAX_WIND_KMH = 15.0    # max wind above this -> drift risk
IRRIGATION_SKIP_RAIN_MM = 10.0  # rain today + next 2 days at/above this -> skip
HEAT_STRESS_C = 40.0

RULES = {
    "spray": (
        f"Avoid spraying if {SPRAY_RAIN_MM:g} mm or more of rain is expected today or tomorrow, "
        f"the chance of rain today is {SPRAY_RAIN_PROB_PCT}% or more, or wind exceeds {SPRAY_MAX_WIND_KMH:g} km/h."
    ),
    "irrigate": (
        f"Skip irrigation if {IRRIGATION_SKIP_RAIN_MM:g} mm or more of rain is expected over today and the next "
        "2 days; otherwise check soil moisture before watering."
    ),
    "heat_stress": f"Maximum temperature of {HEAT_STRESS_C:g} C or above.",
}

_CACHE_TTL_SEC = 60 * 60
_cache: dict[tuple[float, float], tuple[float, dict[str, Any]]] = {}
_cache_lock = threading.Lock()


class ForecastUnavailable(Exception):
    """Open-Meteo could not be reached or returned something unusable."""


def _validate(daily: Any) -> dict[str, Any]:
    if not isinstance(daily, dict) or not isinstance(daily.get("time"), list) or not daily["time"]:
        raise ForecastUnavailable("forecast has no days")
    n = len(daily["time"])
    for field in DAILY_FIELDS:
        values = daily.get(field)
        if not isinstance(values, list) or len(values) != n:
            raise ForecastUnavailable(f"forecast field {field!r} missing or misaligned")
    return daily


def fetch_daily(lat: float, lon: float) -> dict[str, Any]:
    """The Open-Meteo `daily` block for the next 7 days, cached for an hour
    per ~1 km cell. Raises ForecastUnavailable on any failure."""
    key = (round(lat, 2), round(lon, 2))
    now = time.time()
    with _cache_lock:
        hit = _cache.get(key)
        if hit and now - hit[0] < _CACHE_TTL_SEC:
            return hit[1]
    try:
        resp = requests.get(
            FORECAST_URL,
            params={
                "latitude": key[0],
                "longitude": key[1],
                "daily": ",".join(DAILY_FIELDS),
                "forecast_days": 7,
                "timezone": "Asia/Kolkata",
            },
            timeout=6,
        )
        resp.raise_for_status()
        daily = _validate(resp.json().get("daily"))
    except ForecastUnavailable:
        raise
    except (requests.RequestException, ValueError) as e:
        raise ForecastUnavailable(str(e)) from e
    with _cache_lock:
        if len(_cache) > 2000:
            _cache.clear()
        _cache[key] = (now, daily)
    return daily


def _num(values: list[Any], i: int) -> float | None:
    if i >= len(values) or values[i] is None:
        return None
    return float(values[i])


def field_windows(daily: dict[str, Any]) -> list[dict[str, Any]]:
    """One advice entry per forecast day. Missing values count as unknown,
    never as zero -- an unknown wind speed does not block spraying, but it is
    reported as None rather than shown as calm."""
    rain = daily["precipitation_sum"]
    prob = daily["precipitation_probability_max"]
    tmax = daily["temperature_2m_max"]
    tmin = daily["temperature_2m_min"]
    wind = daily["wind_speed_10m_max"]

    days = []
    for i, date in enumerate(daily["time"]):
        rain_today = _num(rain, i) or 0.0
        rain_tomorrow = _num(rain, i + 1) or 0.0
        rain_prob = _num(prob, i)
        wind_max = _num(wind, i)
        t_max = _num(tmax, i)

        if rain_today >= SPRAY_RAIN_MM:
            spray, spray_reason = "avoid", f"{rain_today:g} mm rain expected today"
        elif rain_tomorrow >= SPRAY_RAIN_MM:
            spray, spray_reason = "avoid", f"{rain_tomorrow:g} mm rain expected tomorrow could wash it off"
        elif rain_prob is not None and rain_prob >= SPRAY_RAIN_PROB_PCT:
            spray, spray_reason = "avoid", f"{rain_prob:g}% chance of rain today"
        elif wind_max is not None and wind_max > SPRAY_MAX_WIND_KMH:
            spray, spray_reason = "avoid", (
                f"wind up to {wind_max:g} km/h, spray will drift (early morning is usually calmest)"
            )
        else:
            spray, spray_reason = "good", "dry and calm enough to spray"

        rain_3day = sum(_num(rain, j) or 0.0 for j in range(i, min(i + 3, len(rain))))
        if rain_3day >= IRRIGATION_SKIP_RAIN_MM:
            irrigate, irrigate_reason = "skip", f"{rain_3day:g} mm rain expected over 3 days"
        else:
            irrigate, irrigate_reason = "check", "little rain expected; check soil moisture"

        days.append({
            "date": date,
            "rain_mm": _num(rain, i),
            "rain_prob_pct": rain_prob,
            "tmax_c": t_max,
            "tmin_c": _num(tmin, i),
            "wind_max_kmh": wind_max,
            "spray": spray,
            "spray_reason": spray_reason,
            "irrigate": irrigate,
            "irrigate_reason": irrigate_reason,
            "heat_stress": t_max is not None and t_max >= HEAT_STRESS_C,
        })
    return days
