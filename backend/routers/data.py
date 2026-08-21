from fastapi import APIRouter, HTTPException
from typing import Optional
from statistics import mean

from utils.calculations import region_display_name
from utils.csv_cache import load as _csv_load, index_by as _csv_index, first_by as _csv_first

router = APIRouter()

def read_csv(filename: str):
    return _csv_load(filename)

@router.get("/crops")
async def get_crops():
    return read_csv("crop_parameters.csv")

@router.get("/crops/{crop_id}")
async def get_crop(crop_id: str):
    crop = _csv_first("crop_parameters.csv", "crop_id", crop_id)
    if crop:
        return crop
    raise HTTPException(status_code=404, detail="Crop not found")

@router.get("/regions")
async def get_regions():
    soil_data = read_csv("soil.csv")
    regions = []
    seen = set()
    for row in soil_data:
        rid = row["region_id"]
        if rid not in seen:
            regions.append({"id": rid, "name": region_display_name(rid)})
            seen.add(rid)
    return regions

@router.get("/weather/{region_id}")
async def get_weather(region_id: str, season: Optional[str] = None):
    results = _csv_index("weather.csv", "region_id").get(region_id, [])
    if season:
        results = [row for row in results if row["season"] == season]
    if not results:
        raise HTTPException(status_code=404, detail="Weather data not found for region")
    # Return the most recent year's data or average
    return results[-1]

@router.get("/soil/{region_id}")
async def get_soil(region_id: str):
    row = _csv_first("soil.csv", "region_id", region_id)
    if row:
        return row
    raise HTTPException(status_code=404, detail="Soil data not found for region")

@router.get("/mandi-prices/{region_id}")
async def get_mandi_prices(region_id: str, crop_id: Optional[str] = None):
    results = _csv_index("mandi_prices.csv", "region_id").get(region_id, [])
    if crop_id:
        results = [row for row in results if row["crop_id"] == crop_id]
    return results

@router.get("/yield-history/{region_id}")
async def get_yield_history(region_id: str, crop_id: Optional[str] = None):
    results = _csv_index("yield_history.csv", "region_id").get(region_id, [])
    if crop_id:
        results = [row for row in results if row["crop_id"] == crop_id]
    return results

@router.get("/yield-trend/{region_id}/{crop_id}")
def get_yield_trend(region_id: str, crop_id: str):
    """Returns historical yield trend with year-over-year growth rate."""
    region_rows = _csv_index("yield_history.csv", "region_id").get(region_id, [])
    results = [row for row in region_rows if row["crop_id"] == crop_id]
    if not results:
        raise HTTPException(status_code=404, detail="No yield history found")
    results = sorted(results, key=lambda x: int(x["year"]))
    trend = []
    for i, row in enumerate(results):
        entry = {
            "year": int(row["year"]),
            "season": row["season"],
            "yield_kg_per_acre": float(row["yield_kg_per_acre"]),
            "yoy_change_percent": None
        }
        if i > 0:
            prev = float(results[i-1]["yield_kg_per_acre"])
            curr = float(row["yield_kg_per_acre"])
            if prev > 0:
                entry["yoy_change_percent"] = round((curr - prev) / prev * 100.0, 2)
            else:
                entry["yoy_change_percent"] = 0.0
        trend.append(entry)
    yields = [float(r["yield_kg_per_acre"]) for r in results]
    return {
        "region_id": region_id,
        "crop_id": crop_id,
        "trend": trend,
        "avg_yield": round(mean(yields), 2),
        "min_yield": round(min(yields), 2),
        "max_yield": round(max(yields), 2),
    }

@router.get("/satellite")
async def get_satellite_data(lat: float, lon: float):
    """Retrieve satellite telemetry when Earth Engine is configured."""
    from data_ingestion.fetchers.google_earth_engine import get_satellite_ndvi
    from datetime import date, timedelta
    today = date.today()
    start_date = today - timedelta(days=30)
    
    try:
        ndvi = get_satellite_ndvi(lat, lon, start_date, today)
        if ndvi is None:
            return {"available": False, "source": "not_configured", "message": "Live satellite imagery is not configured."}
    except Exception:
        return {"available": False, "source": "unavailable", "message": "Live satellite imagery could not be retrieved."}

    canopy = "Excellent" if ndvi > 0.6 else "Good" if ndvi > 0.4 else "Fair" if ndvi > 0.2 else "Poor"
    
    return {
        "available": True,
        "source": "Google Earth Engine / Sentinel-2",
        "ndvi": round(float(ndvi), 2),
        "canopy": canopy
    }
