import logging
import random
from typing import Dict, Optional
from data_ingestion.cache import cached
from data_ingestion.fetchers.soil_grids import get_soil_properties

logger = logging.getLogger(__name__)

class SoilHealthCardClient:
    """
    Client for producing a 12-nutrient Soil Health Card-shaped record.

    HONEST NOTE (see AUDIT_REPORT.md M-21): this does NOT integrate with any
    state Soil Health Card registry or credentialed government API. Only
    nitrogen (derived from SoilGrids), pH, and organic carbon come from a real
    external estimate (SoilGrids). The remaining six nutrients (phosphorus,
    potassium, sulphur, zinc, iron, copper, manganese, boron) plus electrical
    conductivity are fabricated with unseeded `random.random()` calls within a
    plausible Indian-soil range -- they are NOT measurements, estimates tied to
    the given lat/lon, or derived from any registry. Callers must not treat
    these as real values; each output dict also carries a `synthetic_fields`
    list naming exactly which keys are fabricated so downstream consumers can
    disclose or discount them.
    """
    def __init__(self):
        pass

    # Keys below are populated via unseeded random.random() and are NOT real
    # measurements or estimates -- see class docstring and AUDIT_REPORT.md M-21.
    SYNTHETIC_FIELDS = [
        "phosphorus_p",
        "potassium_k",
        "sulphur_s",
        "zinc_zn",
        "iron_fe",
        "copper_cu",
        "manganese_mn",
        "boron_b",
        "electrical_conductivity_ec",
    ]

    def retrieve_card(self, lat: float, lon: float) -> Optional[Dict[str, float]]:
        # Fetch baseline soil properties from SoilGrids first
        soil_props = get_soil_properties(lat, lon)
        if not soil_props:
            logger.warning(f"Could not load fallback soil properties for card creation at ({lat}, {lon})")
            return None

        try:
            # Construct card following the official national 12-nutrient scheme.
            # Macronutrients (N, P, K): only N is derived from a real estimate
            # (SoilGrids); P and K below are fabricated placeholders -- see
            # SYNTHETIC_FIELDS / AUDIT_REPORT.md M-21.
            n_ppm = round(soil_props.get("nitrogen_cg_kg", 100.0) / 4.0, 1) # Estimated conversion
            p_ppm = round(12.0 + (random.random() * 15.0), 1)              # FABRICATED: typical Indian soil range, not measured
            k_ppm = round(180.0 + (random.random() * 200.0), 1)           # FABRICATED

            # Secondary (Sulphur) -- FABRICATED
            s_ppm = round(8.0 + (random.random() * 10.0), 1)

            # Micronutrients (Zn, Fe, Cu, Mn, B) -- all FABRICATED
            zn_ppm = round(0.4 + (random.random() * 0.8), 2)
            fe_ppm = round(3.5 + (random.random() * 4.0), 2)
            cu_ppm = round(0.2 + (random.random() * 0.5), 2)
            mn_ppm = round(2.0 + (random.random() * 3.0), 2)
            b_ppm = round(0.3 + (random.random() * 0.5), 2)

            # Physical metrics: ph and oc come from SoilGrids; ec is FABRICATED.
            ph = soil_props.get("ph", 7.0)
            ec = round(0.1 + (random.random() * 0.5), 2) # FABRICATED: Electrical Conductivity (dS/m)
            oc = soil_props.get("organic_carbon_pct", 0.5)

            return {
                "nitrogen_n": n_ppm,
                "phosphorus_p": p_ppm,
                "potassium_k": k_ppm,
                "sulphur_s": s_ppm,
                "zinc_zn": zn_ppm,
                "iron_fe": fe_ppm,
                "copper_cu": cu_ppm,
                "manganese_mn": mn_ppm,
                "boron_b": b_ppm,
                "ph": ph,
                "electrical_conductivity_ec": ec,
                "organic_carbon_oc": oc,
                "synthetic_fields": list(self.SYNTHETIC_FIELDS),
            }
        except Exception as e:
            logger.error(f"Error compiling simulated Soil Health Card: {e}")
            return None

_client = SoilHealthCardClient()

@cached(ttl_seconds=60 * 60 * 24 * 30, key="soil_health_card") # 30-day cache
def get_soil_health_card(lat: float, lon: float) -> Optional[Dict[str, float]]:
    """
    Standard entrypoint with 30-day caching.
    Returns:
        Dict matching 12-nutrient Soil Health Card standard.
    """
    return _client.retrieve_card(lat, lon)
