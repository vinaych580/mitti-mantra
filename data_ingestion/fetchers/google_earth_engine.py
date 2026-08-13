import logging
import os
from datetime import date
from typing import Dict, Optional
from data_ingestion.cache import cached

logger = logging.getLogger(__name__)

# Try importing the official Earth Engine client library
try:
    import ee
    GEE_LIBRARY_AVAILABLE = True
except ImportError:
    GEE_LIBRARY_AVAILABLE = False

class GoogleEarthEngineClient:
    def __init__(self):
        self.authenticated = False
        if GEE_LIBRARY_AVAILABLE:
            self._try_authenticate()

    def _try_authenticate(self):
        try:
            # Check for GEE environment variables
            service_account = os.getenv("GEE_SERVICE_ACCOUNT")
            key_file = os.getenv("GEE_KEY_FILE")
            
            if service_account and key_file and os.path.exists(key_file):
                logger.info(f"Authenticating GEE with Service Account: {service_account}")
                ee.Initialize(
                    credentials=ee.ServiceAccountCredentials(service_account, key_file),
                    project=os.getenv("GEE_PROJECT_ID")
                )
                self.authenticated = True
            else:
                # Try default user credentials
                logger.info("No service account credentials found for GEE. Attempting default initialization...")
                ee.Initialize()
                self.authenticated = True
            logger.info("Google Earth Engine initialized successfully.")
        except Exception as e:
            logger.warning(f"GEE Initialization failed (falling back to baseline estimator): {e}")
            self.authenticated = False

    def compute_ndvi_range(
        self, lat: float, lon: float, start_date: date, end_date: date
    ) -> Optional[float]:
        """
        Calculates average NDVI value over the given bounding coordinates.
        If GEE is authenticated, queries COPERNICUS/S2_SR_L2A.
        Otherwise, falls back to a deterministic, crop-dependent seasonal index.
        """
        if self.authenticated and GEE_LIBRARY_AVAILABLE:
            try:
                # Query Sentinel-2 surface reflectance
                point = ee.Geometry.Point([lon, lat])
                # 50m buffer representing farm boundary
                region = point.buffer(50)
                
                collection = ee.ImageCollection("COPERNICUS/S2_SR_L2A") \
                    .filterBounds(region) \
                    .filterDate(start_date.isoformat(), end_date.isoformat()) \
                    .filter(ee.Filter.lt("CLOUDY_PIXEL_PERCENTAGE", 20))
                
                if collection.size().getInfo() == 0:
                    logger.warning("No cloud-free Sentinel-2 imagery found in range.")
                    return None
                
                # NDVI formula: (B8 - B4) / (B8 + B4)
                def calculate_ndvi(img):
                    return img.normalizedDifference(["B8", "B4"]).rename("NDVI")
                
                ndvi_col = collection.map(calculate_ndvi)
                mean_ndvi = ndvi_col.mean().reduceRegion(
                    reducer=ee.Reducer.mean(),
                    geometry=region,
                    scale=10
                ).get("NDVI").getInfo()
                
                if mean_ndvi is not None:
                    return round(float(mean_ndvi), 3)
            except Exception as e:
                logger.error(f"Error computing GEE NDVI: {e}")
        
        logger.info("Earth Engine imagery is unavailable; returning no observation.")
        return None

_client = GoogleEarthEngineClient()

@cached(ttl_seconds=60 * 60 * 24 * 7, key="gee_ndvi") # 7-day caching for satellite imagery
def get_satellite_ndvi(lat: float, lon: float, start_date: date, end_date: date) -> Optional[float]:
    """
    Standard entrypoint with 7-day caching.
    Returns:
        float representing NDVI value (typically 0.1 to 0.85).
    """
    return _client.compute_ndvi_range(lat, lon, start_date, end_date)
