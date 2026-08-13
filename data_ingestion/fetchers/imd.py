import logging
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
        # Do not fabricate public safety alerts. This connector has no active
        # IMD/CAP feed integration yet, so callers must treat the status as
        # unavailable and consult official IMD advisories.
        return {
            "alert_level": "Unavailable",
            "description": "Live IMD alerts are not configured. Check the official IMD warning feed before field operations.",
            "source": "not_configured",
        }

_client = IMDClient()

@cached(ttl_seconds=60 * 60 * 3, key="imd_alerts") # 3-hour cache for warning alerts
def get_imd_alerts(state: str, district: str) -> Dict[str, str]:
    """
    Standard entrypoint with 3-hour caching.
    Returns:
        Dict with keys: alert_level (str) and description (str).
    """
    return _client.fetch_district_alerts(state, district)
