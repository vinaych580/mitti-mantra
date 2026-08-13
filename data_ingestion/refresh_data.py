import logging
import argparse
from pathlib import Path

# Setup logging
logging.basicConfig(level=logging.INFO, format="%(asctime)s - %(name)s - %(levelname)s - %(message)s")
logger = logging.getLogger("DataRefresh")

# Set up relative imports from parent directory
import sys
sys.path.append(str(Path(__file__).resolve().parents[1]))

from data_ingestion.etl_pipeline import ETLPipeline, PILOT_COORDINATES
from data_ingestion.cache import clear_all

def refresh_datasets(force_clear_cache: bool = False):
    """
    Automated job scheduler running on cron or triggered manually.
    Clears cache if requested, then executes ETL runs for all target pilot locations.
    """
    if force_clear_cache:
        logger.info("Force clearing all API and request caches before run...")
        clear_all()
        logger.info("Cache successfully cleared.")

    logger.info("Initiating automated pipeline refresh cycle...")
    pipeline = ETLPipeline()
    
    success_count = 0
    total_count = len(PILOT_COORDINATES)
    
    for idx, coord in enumerate(PILOT_COORDINATES, start=1):
        logger.info(f"[{idx}/{total_count}] Refreshing: {coord['crop']} in {coord['district']}, {coord['state']}")
        try:
            result = pipeline.run_etl(
                lat=coord["lat"],
                lon=coord["lon"],
                state=coord["state"],
                district=coord["district"],
                crop=coord["crop"]
            )
            if result:
                success_count += 1
        except Exception as e:
            logger.error(f"ETL run failed for {coord['crop']} in {coord['district']}: {e}", exc_info=True)
            
    logger.info(f"Pipeline refresh completed: {success_count}/{total_count} datasets updated successfully.")

def main():
    parser = argparse.ArgumentParser(description="MittiMantra Automated Data Refresh Script")
    parser.add_argument("--force-clear-cache", action="store_true", help="Wipes all JSON cache files prior to pipeline runs")
    args = parser.parse_args()

    refresh_datasets(force_clear_cache=args.force_clear_cache)

if __name__ == "__main__":
    main()
