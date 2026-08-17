# NOT WIRED INTO PRODUCTION -- see AUDIT_REPORT.md M-22.
# Not imported by backend/main.py, backend/routers/*, or any other live
# request-handling code. It is an offline/dev script dependency only.
import logging
from datetime import date, timedelta
from typing import Dict, Optional
from data_ingestion.cache import cached
from data_ingestion.fetchers.base_client import BaseAPIClient

logger = logging.getLogger(__name__)

_BASE_URL = "https://power.larc.nasa.gov/api/temporal/daily/point"
_PARAMS_LIST = "T2M,T2M_MAX,T2M_MIN,PRECTOTCORR,RH2M,ALLSKY_SFC_SW_DWN,WS2M"

class NasaPowerClient(BaseAPIClient):
    def __init__(self):
        # Throttle at 0.2s between calls to respect rate limits (max 10 requests per second)
        super().__init__(base_url=_BASE_URL, rate_limit_delay_seconds=0.2, max_retries=3)

    def fetch_daily_weather(
        self, lat: float, lon: float, start_date: date, end_date: date
    ) -> Optional[Dict[str, Dict[str, float]]]:
        """
        Queries NASA POWER Agro-Climatology point service for daily metrics.
        Returns:
            Dict mapping parameter names to dicts of {date_str: value}.
        """
        params = {
            "latitude": lat,
            "longitude": lon,
            "start": start_date.strftime("%Y%m%d"),
            "end": end_date.strftime("%Y%m%d"),
            "community": "AG",
            "parameters": _PARAMS_LIST,
            "format": "JSON"
        }
        
        resp = self.get(params=params)
        if not resp:
            logger.error(f"NASA POWER failed to return response for coordinates ({lat}, {lon})")
            return None

        try:
            data = resp.json()
            properties = data.get("properties", {})
            parameter_data = properties.get("parameter", {})
            if not parameter_data:
                logger.warning(f"No parameter values returned by NASA POWER for coordinates ({lat}, {lon})")
                return None
            return parameter_data
        except Exception as e:
            logger.error(f"Error parsing NASA POWER response: {e}")
            return None

_client = NasaPowerClient()

@cached(ttl_seconds=60 * 60 * 12, key="nasa_power") # 12-hour caching for daily weather
def get_nasa_weather(
    lat: float, lon: float, start_date: date, end_date: date
) -> Optional[Dict[str, Dict[str, float]]]:
    """
    Standard entrypoint with 12-hour caching.
    Returns daily meteorological values mapping parameter keys to nested {YYYYMMDD: value}.
      - T2M: Daily Mean Temperature (°C)
      - T2M_MAX: Daily Max Temperature (°C)
      - T2M_MIN: Daily Min Temperature (°C)
      - PRECTOTCORR: Daily Rainfall (mm)
      - RH2M: Daily Relative Humidity (%)
      - ALLSKY_SFC_SW_DWN: Downward Solar Radiation (MJ/m^2/day)
      - WS2M: Daily Mean Wind Speed (m/s)
    """
    return _client.fetch_daily_weather(lat, lon, start_date, end_date)
