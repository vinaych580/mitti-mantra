# NOT WIRED INTO PRODUCTION -- see AUDIT_REPORT.md M-22.
# This module is not imported by backend/main.py, backend/routers/*, or any
# other live request-handling code. It is an offline/dev script only.
import os
import json
import logging
import argparse
from datetime import date, timedelta
from pathlib import Path
from typing import Any, Dict, List, Optional

# Set up relative imports from parent directory
import sys
sys.path.append(str(Path(__file__).resolve().parents[1]))

from data_ingestion.fetchers.soil_grids import get_soil_properties
from data_ingestion.fetchers.nasa_power import get_nasa_weather
from data_ingestion.fetchers.isro_bhuvan import get_bhuvan_lulc_path
from data_ingestion.fetchers.google_earth_engine import get_satellite_ndvi
from data_ingestion.fetchers.soil_health_card import get_soil_health_card
from data_ingestion.fetchers.agmarknet import get_mandi_prices
from data_ingestion.fetchers.imd import get_imd_alerts

# Setup logging
logging.basicConfig(level=logging.INFO, format="%(asctime)s - %(name)s - %(levelname)s - %(message)s")
logger = logging.getLogger("ETLPipeline")

# Paths
BASE_DIR = Path(__file__).resolve().parents[1]
DATASET_DIR = BASE_DIR / "dataset"
RAW_DIR = DATASET_DIR / "raw"
PROCESSED_DIR = DATASET_DIR / "processed"
TRAINING_DIR = DATASET_DIR / "training"

# Bounding coordinates for standard pilot coordinates (Medak, Sehore, Ludhiana)
PILOT_COORDINATES = [
    {"state": "Telangana", "district": "Medak", "lat": 17.61, "lon": 78.26, "crop": "Rice"},
    {"state": "Madhya Pradesh", "district": "Sehore", "lat": 23.20, "lon": 77.08, "crop": "Soybean"},
    {"state": "Punjab", "district": "Ludhiana", "lat": 30.90, "lon": 75.85, "crop": "Wheat"}
]

class ETLPipeline:
    def __init__(self):
        # Create output folders if missing
        for d in [RAW_DIR, PROCESSED_DIR, TRAINING_DIR]:
            d.mkdir(parents=True, exist_ok=True)

    def extract(self, lat: float, lon: float, state: str, district: str, crop: str) -> Dict[str, Any]:
        """
        1. Extract step: Query all active fetchers, save raw JSON representations to raw/.
        """
        logger.info(f"--- EXTRACT: Starting retrieval for ({lat}, {lon}) ---")
        
        # Date window for weather (past 30 days)
        today = date.today()
        start_date = today - timedelta(days=30)
        
        # Trigger modular clients
        soil_grids_raw = get_soil_properties(lat, lon)
        nasa_weather_raw = get_nasa_weather(lat, lon, start_date, today)
        satellite_ndvi_raw = get_satellite_ndvi(lat, lon, start_date, today)
        shc_raw = get_soil_health_card(lat, lon)
        
        # Handle list commodity filters for Agmarknet
        mandi_raw = get_mandi_prices(commodity=crop, state=state)
        imd_alerts_raw = get_imd_alerts(state, district)
        
        # Save raw JSON dumps for auditing/lineage tracking
        raw_payload = {
            "coordinate": {"lat": lat, "lon": lon, "state": state, "district": district, "crop": crop},
            "soil_grids": soil_grids_raw,
            "nasa_weather": nasa_weather_raw,
            "satellite_ndvi": satellite_ndvi_raw,
            "soil_health_card": shc_raw,
            "mandi_prices": mandi_raw,
            "imd_alerts": imd_alerts_raw
        }
        
        raw_file = RAW_DIR / f"raw_data_{lat}_{lon}_{crop.lower()}.json"
        with open(raw_file, "w", encoding="utf-8") as f:
            json.dump(raw_payload, f, indent=2, default=str)
        logger.info(f"Raw data extracted & saved to {raw_file}")
        
        return raw_payload

    def validate(self, raw_payload: Dict[str, Any]) -> bool:
        """
        2. Validate step: Verify schema and data range values.
        """
        logger.info("--- VALIDATE: Running quality checks ---")
        
        # Core checks
        coord = raw_payload.get("coordinate", {})
        if coord.get("lat") is None or coord.get("lon") is None:
            logger.error("Validation failed: Missing coordinate values.")
            return False
            
        soil = raw_payload.get("soil_grids")
        if soil:
            ph = soil.get("ph", 7.0)
            if not (4.0 <= ph <= 10.0):
                logger.error(f"Validation failed: Invalid pH range ({ph}) at ({coord['lat']}, {coord['lon']})")
                return False
                
            clay = soil.get("clay_pct", 30.0)
            sand = soil.get("sand_pct", 40.0)
            silt = soil.get("silt_pct", 30.0)
            total_proportion = clay + sand + silt
            if not (80.0 <= total_proportion <= 120.0):
                logger.error(f"Validation failed: Soil texture ratios sum is out of range ({total_proportion}%)")
                return False
                
        logger.info("Validation passed successfully.")
        return True

    def clean_and_normalize(self, raw_payload: Dict[str, Any]) -> Dict[str, Any]:
        """
        3 & 4. Clean & Normalize step: Impute anomalies, normalize metrics.
        """
        logger.info("--- CLEAN & NORMALIZE: Aligning metrics ---")
        coord = raw_payload["coordinate"]
        soil = raw_payload.get("soil_grids") or {}
        weather_data = raw_payload.get("nasa_weather") or {}
        mandi_records = raw_payload.get("mandi_prices") or []
        shc = raw_payload.get("soil_health_card") or {}
        
        # Normalise weather: compute monthly averages from daily readings, filtering out -999.0 missing flags
        t2m_values = []
        precip_sum = 0.0
        
        t2m_data = weather_data.get("T2M", {}) if weather_data else {}
        precip_data = weather_data.get("PRECTOTCORR", {}) if weather_data else {}
        
        if t2m_data:
            t2m_values = [float(v) for v in t2m_data.values() if v is not None and float(v) > -900.0]
        if precip_data:
            precip_sum = sum(float(v) for v in precip_data.values() if v is not None and float(v) > -900.0)
            
        avg_temp = round(sum(t2m_values) / len(t2m_values), 1) if t2m_values else 27.5
        rainfall = round(precip_sum, 1)

        # Normalise Mandi price: extract modal price and convert quintal to kg (divide by 100)
        # Field names below match the Agmarknet/data.gov.in API's actual capitalized
        # keys ("District", "Modal_Price") -- not the lowercase "district"/"modal_price"
        # this used to look up, which never matched any real record. Confirmed against
        # data_ingestion/fetchers/mandi.py:102, which reads r["Modal_Price"] from the
        # same API. See AUDIT_REPORT.md M-24.
        modal_price_kg = 24.50  # Fallback baseline modal price in INR per kg
        if mandi_records and isinstance(mandi_records, list):
            matching_mandi = [r for r in mandi_records if isinstance(r, dict) and r.get("District", "").lower() == coord["district"].lower()]
            record = matching_mandi[0] if matching_mandi else (mandi_records[0] if isinstance(mandi_records[0], dict) else {})
            raw_modal = record.get("Modal_Price")
            if raw_modal is not None:
                try:
                    modal_price_kg = round(float(raw_modal) / 100.0, 2)
                except (ValueError, TypeError):
                    modal_price_kg = 24.50


        cleaned = {
            "lat": coord["lat"],
            "lon": coord["lon"],
            "state": coord["state"],
            "district": coord["district"],
            "crop": coord["crop"],
            "soil_ph": soil.get("ph", 7.0),
            "clay_pct": soil.get("clay_pct", 33.3),
            "sand_pct": soil.get("sand_pct", 33.3),
            "silt_pct": soil.get("silt_pct", 33.4),
            "organic_carbon_pct": soil.get("organic_carbon_pct", 0.5),
            "nitrogen_cg_kg": soil.get("nitrogen_cg_kg", 1000.0),
            "cec_mmol_kg": soil.get("cec_mmol_kg", 200.0),
            "avg_temp_c": avg_temp,
            "rainfall_mm": rainfall,
            "ndvi": raw_payload.get("satellite_ndvi") or 0.62,
            "soil_health_n_ppm": shc.get("nitrogen_n", 200.0),
            "soil_health_p_ppm": shc.get("phosphorus_p", 15.0),
            "soil_health_k_ppm": shc.get("potassium_k", 250.0),
            "modal_price_inr_kg": modal_price_kg,
            "weather_alert": raw_payload.get("imd_alerts", {}).get("alert_level", "Green")
        }
        
        return cleaned

    def feature_engineering(self, cleaned: Dict[str, Any]) -> Dict[str, Any]:
        """
        5 & 6. Feature Engineering & Merge: Derive target markers.
        """
        logger.info("--- FEATURE ENGINEERING: Generating features ---")
        
        # Calculate Soil Fertility Index (NPK balance proxy)
        n = cleaned["soil_health_n_ppm"]
        p = cleaned["soil_health_p_ppm"]
        k = cleaned["soil_health_k_ppm"]
        # Simplified composite index scaled out of 100
        fertility_index = round(min(100.0, (n / 300.0 * 40) + (p / 25.0 * 30) + (k / 300.0 * 30)), 1)
        
        # Derived Growing Degree Days (GDD) proxy assuming 30 days accumulated
        # GDD = sum(Tavg - Tbase) where Tbase is 10C
        gdd_est = round(max(0.0, (cleaned["avg_temp_c"] - 10.0) * 30), 1)

        # Derived soil texture class (USDA standard simplified classification)
        clay = cleaned["clay_pct"]
        sand = cleaned["sand_pct"]
        if clay > 35:
            texture = "Clay"
        elif sand > 45:
            texture = "Sandy Loam"
        else:
            texture = "Loam"

        features = dict(cleaned)
        features["soil_fertility_index"] = fertility_index
        features["accumulated_gdd_30d"] = gdd_est
        features["soil_texture_class"] = texture
        
        logger.info("Feature engineering complete.")
        return features

    def run_etl(self, lat: float, lon: float, state: str, district: str, crop: str) -> Optional[Dict[str, Any]]:
        """
        Run the entire pipeline end-to-end for a coordinate.
        """
        try:
            raw = self.extract(lat, lon, state, district, crop)
            if not self.validate(raw):
                logger.error("ETL pipeline terminated early due to validation failure.")
                return None
                
            cleaned = self.clean_and_normalize(raw)
            features = self.feature_engineering(cleaned)
            
            # Save processed files
            processed_file = PROCESSED_DIR / f"processed_{lat}_{lon}_{crop.lower()}.json"
            with open(processed_file, "w", encoding="utf-8") as f:
                json.dump(cleaned, f, indent=2, default=str)
                
            training_file = TRAINING_DIR / f"features_{lat}_{lon}_{crop.lower()}.json"
            with open(training_file, "w", encoding="utf-8") as f:
                json.dump(features, f, indent=2, default=str)
                
            logger.info(f"Processed dataset saved to {processed_file}")
            logger.info(f"Feature dataset saved to {training_file}")
            
            return features
        except Exception as e:
            logger.error(f"Critical error running ETL for ({lat}, {lon}): {e}")
            return None

def main():
    parser = argparse.ArgumentParser(description="MittiMantra ETL Pipeline")
    parser.add_argument("--test", action="store_true", help="Run ETL pipeline for standard pilot locations")
    args = parser.parse_args()

    pipeline = ETLPipeline()
    
    if args.test:
        logger.info("Starting MittiMantra ETL test suite...")
        for coord in PILOT_COORDINATES:
            pipeline.run_etl(
                lat=coord["lat"],
                lon=coord["lon"],
                state=coord["state"],
                district=coord["district"],
                crop=coord["crop"]
            )
        logger.info("ETL test suite executed successfully.")
    else:
        logger.info("Use --test flag to trigger pipeline runs.")

if __name__ == "__main__":
    main()
