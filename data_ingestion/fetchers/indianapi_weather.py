# NOT WIRED INTO PRODUCTION -- see AUDIT_REPORT.md M-22.
# Same status as data_ingestion/fetchers/weather.py: only reachable via the
# data_ingestion package-level re-export and weather.py's fallback chain,
# neither of which is imported by any live request-handling code
# (backend/main.py, backend/routers/*). Offline/dev script dependency only.

from __future__ import annotations

import logging
import os

import requests

from data_ingestion.cache import cached

logger = logging.getLogger(__name__)

_BASE_URL = "https://weather.indianapi.in"

# IndianAPI's /india/weather endpoint has no rainfall/precipitation field,
# so this fetcher only ever supplies avg_temp_c. Callers must be prepared
# for a partial result and fall back elsewhere for rainfall_mm.


@cached(ttl_seconds=3600, key="indianapi_weather")  # 1-hour TTL
def fetch_weather(city: str) -> dict[str, float] | None:
    """
    Fetch current weather for an Indian city from IndianAPI.

    Returns a partial dict with only "avg_temp_c" (IndianAPI has no
    rainfall field), or None on failure. Requires INDIANAPI_KEY to be set.
    """
    api_key = os.getenv("INDIANAPI_KEY")
    if not api_key:
        logger.info("INDIANAPI_KEY not set; skipping IndianAPI weather fetch.")
        return None

    try:
        resp = requests.get(
            f"{_BASE_URL}/india/weather",
            params={"city": city},
            headers={"x-api-key": api_key},
            timeout=10,
        )
        resp.raise_for_status()
        current = resp.json().get("weather", {}).get("current", {})
        temp = current.get("temperature", {})
        tmax = temp.get("max", {}).get("value")
        tmin = temp.get("min", {}).get("value")

        if tmax is None or tmin is None:
            logger.warning(f"IndianAPI returned no temperature data for city={city}")
            return None

        return {"avg_temp_c": round((tmax + tmin) / 2, 1)}
    except requests.exceptions.RequestException as e:
        logger.error(f"Network error fetching IndianAPI weather data: {e}")
        return None
    except Exception as e:
        logger.error(f"Unexpected error fetching IndianAPI weather data: {e}")
        return None
