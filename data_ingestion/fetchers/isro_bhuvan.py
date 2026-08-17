# NOT WIRED INTO PRODUCTION -- see AUDIT_REPORT.md M-22.
# Not imported by backend/main.py, backend/routers/*, or any other live
# request-handling code. It is an offline/dev script dependency only.
import logging
import os
from pathlib import Path
from typing import Dict, Optional
from data_ingestion.cache import cached
from data_ingestion.fetchers.base_client import BaseAPIClient

logger = logging.getLogger(__name__)

# Base Bhuvan WMS Gateway URL
_BASE_URL = "https://bhuvan-vec1.nrsc.gov.in/bhuvan/wms"

class BhuvanWMSClient(BaseAPIClient):
    def __init__(self):
        # 1-second delay to prevent IP throttling from government WMS
        super().__init__(base_url=_BASE_URL, rate_limit_delay_seconds=1.0, max_retries=3)

    def fetch_lulc_tile(
        self, min_lat: float, min_lon: float, max_lat: float, max_lon: float, output_path: Path
    ) -> bool:
        """
        Request 50K Land Use Land Cover (LULC) map raster tile from ISRO Bhuvan.
        Saves the resulting image stream to output_path.
        """
        params = {
            "service": "WMS",
            "version": "1.3.0",
            "request": "GetMap",
            "layers": "lulc:IN_LULC50K_2015-16",
            "bbox": f"{min_lat},{min_lon},{max_lat},{max_lon}",
            "width": 512,
            "height": 512,
            "crs": "EPSG:4326",
            "format": "image/png",
            "transparent": "true"
        }
        
        resp = self.get(params=params)
        if not resp or resp.status_code != 200:
            logger.error(f"Bhuvan WMS request failed for bbox ({min_lat}, {min_lon})")
            return False

        # Verify response is indeed an image stream
        content_type = resp.headers.get("Content-Type", "")
        if "image" not in content_type:
            logger.error(f"Bhuvan WMS returned non-image content: {content_type}")
            return False

        try:
            os.makedirs(output_path.parent, exist_ok=True)
            with open(output_path, "wb") as f:
                f.write(resp.content)
            return True
        except Exception as e:
            logger.error(f"Failed to write Bhuvan tile to file: {e}")
            return False

_client = BhuvanWMSClient()

@cached(ttl_seconds=60 * 60 * 24 * 180, key="bhuvan") # 180-day caching for static land maps
def get_bhuvan_lulc_path(
    min_lat: float, min_lon: float, max_lat: float, max_lon: float, raw_dir: str
) -> Optional[str]:
    """
    Downloads Bhuvan Land Use Land Cover raster tile for the given bbox.
    Returns:
        Absolute filepath to the saved image tile on disk, or None on failure.
    """
    filename = f"bhuvan_lulc_{min_lat}_{min_lon}_{max_lat}_{max_lon}.png"
    filepath = Path(raw_dir) / "bhuvan" / filename
    
    success = _client.fetch_lulc_tile(min_lat, min_lon, max_lat, max_lon, filepath)
    if success and filepath.exists():
        return str(filepath.resolve())
    return None
