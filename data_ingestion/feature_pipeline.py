import logging
import numpy as np
import pandas as pd
from pathlib import Path
from typing import Dict, List

# Setup logging
logging.basicConfig(level=logging.INFO, format="%(asctime)s - %(name)s - %(levelname)s - %(message)s")
logger = logging.getLogger("FeaturePipeline")

# Base directories
BASE_DIR = Path(__file__).resolve().parents[1]
DATASET_DIR = BASE_DIR / "dataset"
TRAINING_DIR = DATASET_DIR / "training"

# Regional topographical map
_REGION_GEOGRAPHY = {
    "punjab_ludhiana": {"slope": "Gentle", "elevation": "Lowland", "mandi_distance_km": 12.5},
    "haryana_karnal": {"slope": "Gentle", "elevation": "Lowland", "mandi_distance_km": 14.2},
    "bihar_patna": {"slope": "Gentle", "elevation": "Lowland", "mandi_distance_km": 18.0},
    "up_lucknow": {"slope": "Gentle", "elevation": "Lowland", "mandi_distance_km": 15.5},
    "rajasthan_jaipur": {"slope": "Gentle", "elevation": "Mid-elevation", "mandi_distance_km": 28.5},
    "mp_sehore": {"slope": "Moderate", "elevation": "Mid-elevation", "mandi_distance_km": 22.0},
    "mh_pune": {"slope": "Moderate", "elevation": "Mid-elevation", "mandi_distance_km": 25.0},
    "telangana_medak": {"slope": "Moderate", "elevation": "Mid-elevation", "mandi_distance_km": 19.8},
    "ap_guntur": {"slope": "Moderate", "elevation": "Mid-elevation", "mandi_distance_km": 21.0},
    "kar_mysuru": {"slope": "Moderate", "elevation": "Mid-elevation", "mandi_distance_km": 24.5},
    "tn_thanjavur": {"slope": "Gentle", "elevation": "Lowland", "mandi_distance_km": 11.2},
    "guj_rajkot": {"slope": "Moderate", "elevation": "Mid-elevation", "mandi_distance_km": 26.8}
}

class FeatureEngineeringPipeline:
    def __init__(self):
        TRAINING_DIR.mkdir(parents=True, exist_ok=True)

    def load_datasets(self) -> Dict[str, pd.DataFrame]:
        logger.info("Loading agricultural data tables...")
        return {
            "yield_history": pd.read_csv(DATASET_DIR / "yield_history.csv"),
            "soil": pd.read_csv(DATASET_DIR / "soil.csv"),
            "weather": pd.read_csv(DATASET_DIR / "weather.csv"),
            "mandi_prices": pd.read_csv(DATASET_DIR / "mandi_prices.csv"),
            "crop_params": pd.read_csv(DATASET_DIR / "crop_parameters.csv")
        }

    def merge_tables(self, dfs: Dict[str, pd.DataFrame]) -> pd.DataFrame:
        logger.info("Merging tables into unified tabular workspace...")
        
        # 1. Start with crop yields as base
        df = dfs["yield_history"].copy()
        
        # 2. Merge soil parameters on region_id (many-to-one matching)
        # Note: soil.csv has multiple entries per region representing distinct soil types.
        # We merge on region_id, selecting the first match or average properties for simplicty.
        soil_df = dfs["soil"].groupby("region_id").first().reset_index()
        df = pd.merge(df, soil_df, on="region_id", how="left")
        
        # 3. Merge weather parameters on (region_id, year, season)
        # We standardise season naming casing
        df["season"] = df["season"].str.lower()
        weather = dfs["weather"].copy()
        weather["season"] = weather["season"].str.lower()
        df = pd.merge(df, weather, on=["region_id", "year", "season"], how="left")
        
        # 4. Merge market prices (pre-calculating volatility aggregates to join)
        mandi = dfs["mandi_prices"].copy()
        # Compute volatility (std deviation) and modal average per (region_id, crop_id)
        mandi_aggregates = mandi.groupby(["region_id", "crop_id"]).agg(
            market_price_avg=("price_inr_per_kg", "mean"),
            market_price_volatility=("price_inr_per_kg", "std")
        ).reset_index()
        
        df = pd.merge(df, mandi_aggregates, on=["region_id", "crop_id"], how="left")
        
        # 5. Merge crop standard parameters on crop_id, discarding its redundant default season column
        crop_params = dfs["crop_params"].copy()
        if "season" in crop_params.columns:
            crop_params = crop_params.drop(columns=["season"])
        df = pd.merge(df, crop_params, on="crop_id", how="left")
        
        return df

    def handle_missing_values(self, df: pd.DataFrame) -> pd.DataFrame:
        logger.info("Imputing missing values...")
        # Impute missing weather (mean by region/season)
        weather_cols = ["rainfall_mm", "avg_temp_c", "min_temp_c", "max_temp_c"]
        for col in weather_cols:
            df[col] = df.groupby(["region_id", "season"])[col].transform(lambda x: x.fillna(x.mean()))
            
        # Impute missing market indicators
        df["market_price_avg"] = df.groupby("crop_id")["market_price_avg"].transform(lambda x: x.fillna(x.mean()))
        df["market_price_volatility"] = df.groupby("crop_id")["market_price_volatility"].transform(lambda x: x.fillna(x.mean()))
        
        # Safe default fallback for remaining missing cells
        df = df.bfill().ffill()
        return df

    def detect_outliers(self, df: pd.DataFrame) -> pd.DataFrame:
        logger.info("Detecting outliers via IQR check...")
        
        # Mark yield outliers (yield_kg_per_acre values exceeding 1.5 * IQR)
        q1 = df["yield_kg_per_acre"].quantile(0.25)
        q3 = df["yield_kg_per_acre"].quantile(0.75)
        iqr = q3 - q1
        lower_bound = q1 - 1.5 * iqr
        upper_bound = q3 + 1.5 * iqr
        
        # Add flag instead of removing, keeping dataset intact
        df["is_yield_outlier"] = ((df["yield_kg_per_acre"] < lower_bound) | (df["yield_kg_per_acre"] > upper_bound)).astype(int)
        outliers_count = df["is_yield_outlier"].sum()
        logger.info(f"Tagged {outliers_count} outlier rows in historical yields.")
        return df

    def engineer_features(self, df: pd.DataFrame) -> pd.DataFrame:
        logger.info("Engineering crop-soil-weather-market indicators...")
        
        # 1. Historical Rainfall Average
        df["historical_rainfall_avg"] = df.groupby(["region_id", "season"])["rainfall_mm"].transform("mean")
        
        # 2. Accumulated GDD proxy (lifecycle duration matches season classification)
        duration = np.where(df["season"].isin(["annual", "perennial"]), 300, 120)
        df["growing_degree_days"] = np.maximum(0.0, (df["avg_temp_c"] - 10.0) * duration)
        
        # 3. Moisture Index
        df["moisture_index"] = df["rainfall_mm"] / (df["avg_temp_c"] + 10.0)
        
        # 4. NDVI proxy index
        df["ndvi_proxy"] = 0.3 + 0.5 * (1.0 - np.exp(-df["moisture_index"] / 10.0))
        
        # 5. Soil Fertility Score (NPK weighted sum)
        df["soil_fertility_score"] = (
            (df["n_kg_per_acre"] / 100.0 * 40) +
            (df["p_kg_per_acre"] / 50.0 * 30) +
            (df["k_kg_per_acre"] / 300.0 * 30)
        )
        df["soil_fertility_score"] = df["soil_fertility_score"].clip(0.0, 100.0)
        
        # 6. Organic Carbon Index
        conditions = [
            (df["organic_carbon_percent"] < 0.5),
            (df["organic_carbon_percent"] >= 0.5) & (df["organic_carbon_percent"] <= 0.75),
            (df["organic_carbon_percent"] > 0.75)
        ]
        choices = ["Low", "Medium", "High"]
        df["organic_carbon_index"] = np.select(conditions, choices, default="Medium")
        
        # 7. Terrain Slope & Elevation Class & Mandi Distance (Geographical proxies)
        df["terrain_slope"] = df["region_id"].map(lambda r: _REGION_GEOGRAPHY.get(r, {}).get("slope", "Gentle"))
        df["elevation_class"] = df["region_id"].map(lambda r: _REGION_GEOGRAPHY.get(r, {}).get("elevation", "Lowland"))
        df["distance_to_mandi_km"] = df["region_id"].map(lambda r: _REGION_GEOGRAPHY.get(r, {}).get("mandi_distance_km", 15.0))
        
        # 8. Market Volatility Index
        df["market_volatility_index"] = df["market_price_volatility"] / (df["market_price_avg"] + 1.0)
        
        return df

    def scale_and_encode(self, df: pd.DataFrame) -> pd.DataFrame:
        logger.info("Scaling continuous values & One-Hot encoding categoricals...")
        
        # Copy to keep raw features intact before exporting final training tables
        processed = df.copy()
        
        # Columns to scale
        numeric_cols = [
            "rainfall_mm", "avg_temp_c", "growing_degree_days", "moisture_index", 
            "ndvi_proxy", "soil_fertility_score", "distance_to_mandi_km", 
            "market_volatility_index", "ph", "organic_carbon_percent"
        ]
        
        for col in numeric_cols:
            min_val = processed[col].min()
            max_val = processed[col].max()
            if max_val > min_val:
                processed[f"{col}_normalized"] = (processed[col] - min_val) / (max_val - min_val)
            else:
                processed[f"{col}_normalized"] = 0.0

        # One-Hot encode categoricals
        categorical_cols = ["crop_id", "season", "soil_type", "organic_carbon_index", "terrain_slope", "elevation_class"]
        processed = pd.get_dummies(processed, columns=categorical_cols, drop_first=True)
        
        return processed

    def execute_pipeline(self):
        dfs = self.load_datasets()
        merged = self.merge_tables(dfs)
        imputed = self.handle_missing_values(merged)
        outliers_checked = self.detect_outliers(imputed)
        engineered = self.engineer_features(outliers_checked)
        final_dataset = self.scale_and_encode(engineered)
        
        output_file = TRAINING_DIR / "crop_yield_training_dataset.csv"
        final_dataset.to_csv(output_file, index=False)
        logger.info(f"✅ Success! Training dataset with engineered features saved to: {output_file}")
        logger.info(f"Final shape: {final_dataset.shape}")

if __name__ == "__main__":
    pipeline = FeatureEngineeringPipeline()
    pipeline.execute_pipeline()
