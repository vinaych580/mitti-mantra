import logging
import random
from datetime import date
from typing import Dict, List, Optional
from data_ingestion.cache import cached

logger = logging.getLogger(__name__)

class IMDClient:
    """
    Client for querying IMD daily weather warnings and monsoon onset details.
    """
    def __init__(self):
        pass

    def fetch_district_alerts(self, state: str, district: str) -> Dict[str, str]:
        """
        Retrieves active weather alerts for a district.
        In production, parses the NDMA/IMD CAP alert feed.
        """
        # Under normal conditions, alert is Green (No Warning)
        # Randomly generate weather warnings for simulation if precipitation conditions look anomalous
        # Warning codes: "Green", "Yellow", "Orange", "Red"
        # Alert reasons: "Heavy Rainfall", "Heat Wave", "Thundery Activities", "None"
        seed_val = hash(state + district + date.today().isoformat()) % 100
        
        if seed_val > 95:
            return {"alert_level": "Red", "description": "Extreme Heavy Rainfall warning. Sowing operations should be delayed."}
        elif seed_val > 88:
            return {"alert_level": "Orange", "description": "Severe Thunderstorms and heavy showers expected."}
        elif seed_val > 80:
            return {"alert_level": "Yellow", "description": "Light to moderate showers with gusty winds. Monitor irrigation channels."}
            
        return {"alert_level": "Green", "description": "Normal weather conditions. Safe to execute sowing and spraying."}

_client = IMDClient()

@cached(ttl_seconds=60 * 60 * 3, key="imd_alerts") # 3-hour cache for warning alerts
def get_imd_alerts(state: str, district: str) -> Dict[str, str]:
    """
    Standard entrypoint with 3-hour caching.
    Returns:
        Dict with keys: alert_level (str) and description (str).
    """
    return _client.fetch_district_alerts(state, district)
