# NOT WIRED INTO PRODUCTION -- see AUDIT_REPORT.md M-22.
# Only imported by data_ingestion/etl_pipeline.py (itself unwired) and the
# data_ingestion.fetchers package re-export; not reachable from any live
# request-handling code.
import logging
import os
from typing import Dict, List, Optional
from data_ingestion.cache import cached
from data_ingestion.fetchers.base_client import BaseAPIClient

logger = logging.getLogger(__name__)

# Agmarknet Daily Mandi Prices OGD API Endpoint
_BASE_URL = "https://api.data.gov.in/resource/9ef84268-d588-465a-a308-a864a43d0070"

class AgmarknetClient(BaseAPIClient):
    def __init__(self):
        # Throttle at 0.5s to respect daily request quotas (max 10,000 requests per day)
        super().__init__(base_url=_BASE_URL, rate_limit_delay_seconds=0.5, max_retries=3)

    def fetch_mandi_prices(self, commodity: str, state: Optional[str] = None) -> Optional[List[Dict[str, str]]]:
        api_key = os.getenv("DATAGOV_API_KEY")
        if not api_key:
            logger.warning("DATAGOV_API_KEY environment variable is not set. Skipping live market prices fetch.")
            return None

        params = {
            "api-key": api_key,
            "format": "json",
            "limit": 50,
            "filters[Commodity]": commodity
        }
        if state:
            params["filters[State]"] = state

        resp = self.get(params=params)
        if not resp:
            logger.error(f"Agmarknet OGD API failed to return data for commodity: {commodity}")
            return None

        try:
            data = resp.json()
            records = data.get("records", [])
            return records
        except Exception as e:
            logger.error(f"Failed to parse Agmarknet JSON payload: {e}")
            return None

_client = AgmarknetClient()

@cached(ttl_seconds=60 * 60 * 6, key="agmarknet_prices") # 6-hour caching for commodity pricing
def get_mandi_prices(commodity: str, state: Optional[str] = None) -> Optional[List[Dict[str, str]]]:
    """
    Standard entrypoint with 6-hour caching.
    Returns:
        List of dictionaries with commodity pricing metadata, or None on failure.
    """
    return _client.fetch_mandi_prices(commodity, state)
