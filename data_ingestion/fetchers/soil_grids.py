import logging
from typing import Dict, Optional
from data_ingestion.cache import cached
from data_ingestion.fetchers.base_client import BaseAPIClient

logger = logging.getLogger(__name__)

# Base SoilGrids URL
_BASE_URL = "https://rest.isric.org/soilgrids/v2.0/properties/query"
_PROPERTIES = ["phh2o", "clay", "sand", "silt", "soc", "nitrogen", "cec"]

class SoilGridsClient(BaseAPIClient):
    def __init__(self):
        # 1 request per second throttling to respect SoilGrids endpoints
        super().__init__(base_url=_BASE_URL, rate_limit_delay_seconds=0.5, max_retries=3)

    def fetch_properties(self, lat: float, lon: float) -> Optional[Dict[str, float]]:
        """
        Query SoilGrids API for soil variables at depth interval 0-30cm (typical topsoil).
        """
        params = {
            "lon": lon,
            "lat": lat,
            "property": _PROPERTIES,
            "depth": "0-30cm",
            "value": "mean"
        }
        resp = self.get(params=params)
        if not resp:
            logger.error(f"SoilGrids failed to return response for coordinate ({lat}, {lon})")
            return None
        
        try:
            data = resp.json()
            layers = data.get("properties", {}).get("layers", [])
            values: Dict[str, float] = {}
            for layer in layers:
                name = layer["name"]
                for depth in layer.get("depths", []):
                    raw = depth.get("values", {}).get("mean")
                    if raw is not None:
                        values[name] = float(raw)
                        break
            
            # Assert minimum required data
            if not values:
                logger.warning(f"SoilGrids returned empty layer values for coordinates ({lat}, {lon})")
                return None
                
            return values
        except Exception as e:
            logger.error(f"Failed to parse SoilGrids response: {e}")
            return None

# Instantiated client singleton
_client = SoilGridsClient()

@cached(ttl_seconds=60 * 60 * 24 * 90, key="soil_grids") # 90-day caching for soil composition
def get_soil_properties(lat: float, lon: float) -> Optional[Dict[str, float]]:
    """
    Standard entrypoint with 90-day caching.
    Returns dictionary with clean rescaled soil parameters:
      - ph: float
      - clay_pct: float
      - sand_pct: float
      - silt_pct: float
      - organic_carbon_pct: float
      - nitrogen_mg_kg: float
      - cec_mmol_kg: float
    """
    raw_props = _client.fetch_properties(lat, lon)
    if not raw_props:
        return None
        
    try:
        # SoilGrids returns ph in pH*10. E.g. 74 mean value = 7.4 pH
        ph = round(raw_props.get("phh2o", 70.0) / 10.0, 2)
        
        # Soil proportions are returned as g/kg (divide by 10 for percentage)
        clay = round(raw_props.get("clay", 300.0) / 10.0, 1)
        sand = round(raw_props.get("sand", 400.0) / 10.0, 1)
        silt = round(raw_props.get("silt", 300.0) / 10.0, 1)
        
        # Soil Organic Carbon is returned in dg/kg (decigrams/kg = g/10kg)
        # Convert dg/kg to percentage: (dg/kg) / 100
        soc = round(raw_props.get("soc", 100.0) / 100.0, 2)
        
        # Nitrogen is in cg/kg (centigrams/kg = g/100kg). Keep in cg/kg or float
        nitrogen = float(raw_props.get("nitrogen", 1000.0))
        
        # Cation Exchange Capacity is in mmol(c)/kg.
        cec = float(raw_props.get("cec", 200.0))
        
        return {
            "ph": ph,
            "clay_pct": clay,
            "sand_pct": sand,
            "silt_pct": silt,
            "organic_carbon_pct": soc,
            "nitrogen_cg_kg": nitrogen,
            "cec_mmol_kg": cec
        }
    except Exception as e:
        logger.error(f"Error normalising SoilGrids properties: {e}")
        return None
