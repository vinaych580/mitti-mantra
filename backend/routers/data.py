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
def get_satellite_data(lat: float, lon: float):
    """Retrieve satellite telemetry when Earth Engine is configured.

    A plain def (it runs in the thread pool): the Earth Engine calls block. The
    fetcher is imported through utils.lazy_import, inside the try: a cold-start
    concurrent import used to raise here, outside the try, and answer 500."""
    from datetime import date, timedelta
    from utils.lazy_import import fetcher
    today = date.today()
    start_date = today - timedelta(days=30)

    try:
        get_satellite_ndvi = fetcher("google_earth_engine").get_satellite_ndvi
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


# ---- Phase 1 serving store: every district the public sources cover -------
# Backed by dataset/serving.sqlite (utils/store.py). On a deploy without the
# store these return 503 so the UI can fall back to the 30 pilot regions.

def _require_store():
    from utils import store
    if not store.available():
        raise HTTPException(status_code=503, detail="District store not built on this deployment")
    return store


@router.get("/v1/districts")
def list_districts(state: Optional[str] = None):
    """State, district, point and which datasets cover it (spec 1.8)."""
    store = _require_store()
    rows = list(store.districts())
    if state:
        s = state.strip().lower()
        rows = [r for r in rows if (r["state_name"] or "").lower() == s or str(r["state_code"]) == s]
    return {"count": len(rows), "districts": rows}


@router.get("/v1/districts/{district_id}")
def get_district(district_id: str):
    """One district by LGD id ("36-513") or legacy region id ("telangana_medak")."""
    store = _require_store()
    d = store.district(district_id)
    if d is None:
        raise HTTPException(status_code=404, detail=f"Unknown district: {district_id}")
    return d


def _price_forecast(district_id: str, crop_id: str):
    from ml import price_model

    store = _require_store()
    d = store.district(district_id)
    if d is None:
        raise HTTPException(status_code=404, detail=f"Unknown district: {district_id}")
    model = price_model.load()
    if model is None:
        raise HTTPException(status_code=503, detail="Price model not shipped on this deployment")
    series = price_model.series_from_store(d["district_id"], crop_id)
    fc = model.forecast(series) if series is not None else None
    if fc is None:
        raise HTTPException(status_code=404, detail=f"No recent {crop_id} prices for {d['district_name']}")
    from engine.features import price_freshness
    return d, {**fc, "district": d, "freshness": price_freshness(fc["origin_week"])}


@router.get("/v1/districts/{district_id}/price-forecast/crops")
def get_district_forecast_crops(district_id: str):
    """Crops this district has prices for that the price model covers, newest first:
    what the dashboard offers when a farmer picks a crop with no prices here."""
    from ml import price_model

    store = _require_store()
    d = store.district(district_id)
    if d is None:
        raise HTTPException(status_code=404, detail=f"Unknown district: {district_id}")
    model = price_model.load()
    covered = set(model.crops) if model is not None else set()
    rows = store.query("SELECT crop_id, MAX(week) AS last_week FROM price_district_weekly "
                       "WHERE district_id = ? AND price_paise_kg > 0 GROUP BY crop_id", (d["district_id"],))
    crops = sorted(({"crop_id": r["crop_id"], "data_through": r["last_week"]} for r in rows
                    if r["crop_id"] in covered), key=lambda c: (c["data_through"], c["crop_id"]), reverse=True)
    return {"district": d, "crops": crops}


@router.get("/v1/districts/{district_id}/price-forecast")
def get_district_price_forecast(district_id: str, crop_id: str):
    """Weekly price 1-26 weeks ahead with 80% ranges (Phase 2, spec 2.2). Each horizon
    says whether the model or a baseline produced it; see ml/models/price/model_card.md."""
    return _price_forecast(district_id, crop_id)[1]


@router.get("/v1/districts/{district_id}/sell-advice")
def get_district_sell_advice(district_id: str, crop_id: str, quantity_kg: float = 1000.0,
                             storage_inr_kg_month: float = 0.5, interest_pct_year: float = 12.0):
    """Sell now or hold, on the forecast's median and its downside (spec 2.2)."""
    if quantity_kg <= 0 or storage_inr_kg_month < 0 or interest_pct_year < 0:
        raise HTTPException(status_code=422, detail="quantity must be positive; costs non-negative")
    from ml import price_model
    d, fc = _price_forecast(district_id, crop_id)
    return {**price_model.sell_advice(fc, quantity_kg, storage_inr_kg_month, interest_pct_year, crop_id),
            "district": d, "crop_id": crop_id, "freshness": fc["freshness"],
            "assumptions": {"quantity_kg": quantity_kg, "storage_inr_kg_month": storage_inr_kg_month,
                            "interest_pct_year": interest_pct_year}}


@router.get("/v1/districts/{district_id}/yields")
def get_district_yields(district_id: str, crop_id: Optional[str] = None):
    store = _require_store()
    d = store.district(district_id)
    if d is None:
        raise HTTPException(status_code=404, detail=f"Unknown district: {district_id}")
    rows = store.yields(d["district_id"], crop_id)
    return {"district": d, "rows": rows, "sources": store.sources_for(rows)}


@router.get("/v1/districts/{district_id}/prices")
def get_district_prices(district_id: str, crop_id: Optional[str] = None):
    store = _require_store()
    d = store.district(district_id)
    if d is None:
        raise HTTPException(status_code=404, detail=f"Unknown district: {district_id}")
    rows = store.prices(d["district_id"], crop_id)
    return {"district": d, "rows": rows, "sources": store.sources_for(rows)}


@router.get("/v1/districts/{district_id}/soil")
def get_district_soil(district_id: str):
    """Soil Health Card: share of tested samples in each rating class, per nutrient."""
    store = _require_store()
    d = store.district(district_id)
    if d is None:
        raise HTTPException(status_code=404, detail=f"Unknown district: {district_id}")
    rows = store.soil(d["district_id"])
    return {"district": d, "rows": rows, "sources": store.sources_for(rows)}


@router.get("/v1/districts/{district_id}/irrigation")
def get_district_irrigation(district_id: str, crop_id: Optional[str] = None):
    """Irrigated share of each crop's sown area, last ten years."""
    store = _require_store()
    d = store.district(district_id)
    if d is None:
        raise HTTPException(status_code=404, detail=f"Unknown district: {district_id}")
    rows = store.irrigation(d["district_id"], crop_id)
    return {"district": d, "rows": rows, "sources": store.sources_for(rows)}


@router.get("/v1/districts/{district_id}/costs")
def get_district_costs(district_id: str, crop_id: Optional[str] = None):
    """Cost of Cultivation survey estimates for the district's state (Rs/acre).
    The survey is state-level; no district series exists."""
    store = _require_store()
    d = store.district(district_id)
    if d is None:
        raise HTTPException(status_code=404, detail=f"Unknown district: {district_id}")
    rows = store.costs(str(d["state_code"]), crop_id)
    return {"district": d, "level": "state", "rows": rows, "sources": store.sources_for(rows)}


@router.get("/v1/districts/{district_id}/weather")
def get_district_weather(district_id: str, crop_id: Optional[str] = None, season: Optional[str] = None):
    """Measured seasonal weather, growth-stage weather for the last three
    seasons, and monsoon onset dates (NASA POWER daily, per district point)."""
    store = _require_store()
    d = store.district(district_id)
    if d is None:
        raise HTTPException(status_code=404, detail=f"Unknown district: {district_id}")
    seasons = store.weather(d["district_id"], season)
    stages = store.weather_stages(d["district_id"], crop_id)
    onset = store.monsoon_onset(d["district_id"])
    return {"district": d, "seasons": seasons, "stages": stages, "monsoon_onset": onset,
            "sources": store.sources_for(seasons, stages, onset)}
