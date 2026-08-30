from fastapi import Depends, FastAPI, Header, HTTPException, Request, status
from fastapi.middleware.cors import CORSMiddleware
from fastapi.middleware.gzip import GZipMiddleware
from fastapi.staticfiles import StaticFiles
from starlette.middleware.base import BaseHTTPMiddleware
from pydantic import BaseModel, Field, field_validator
from typing import Dict, Any, List, Optional
from statistics import mean
import sys
import os
import secrets
import numpy as np

# Add project root to path to import engine and utils
sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

# Load .env from the project root so DATAGOV_API_KEY is available
# when running `uvicorn backend.main:app` locally. On Vercel the env vars come
# from the project settings so this is a no-op there.
try:
    from dotenv import load_dotenv
    _env_path = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), ".env")
    if os.path.exists(_env_path):
        load_dotenv(_env_path)
except Exception:
    pass

from utils.csv_cache import load as _csv_load, index_by as _csv_index, first_by as _csv_first
from utils.calculations import calculate_ndvi_and_field_health
from engine.farm_score import compute_farm_score
from engine.simulator import simulate
from backend.chatbot import answer as chatbot_answer
from ml.predict import recommend_crops, location_based_insights, mandi_price_analytics, rotation_planner, predict_disease_ml
from engine.disease_features import extract_leaf_features, severity_from_lesion_frac
from engine.features import (
    fertilizer_recommendation,
    get_msp_data,
    msp_vs_market,
    best_time_to_sell,
    irrigation_schedule,
    get_crop_calendar,
    pest_disease_alerts,
    loan_calculator,
    soil_health_projection,
    price_forecast,
    cross_mandi_arbitrage,
    get_strategy_templates,
    region_benchmark,
    match_government_schemes,
    calculate_disease_outbreak_risk,
    calculate_carbon_credits,
)
from engine.disease_actions import build_action_plan


from backend.routers.data import router as data_router

app = FastAPI(title="AgriSim - Farm Intelligence Platform")
app.include_router(data_router, prefix="/api")


@app.on_event("startup")
async def _warm_ml_models() -> None:
    """Deserialize the forests off the request path.

    The models are ~110 MB of joblib and load lazily on first use, so whoever
    clicked first paid ~8 s before seeing anything -- reliably the person
    demoing the product. Warm them on a daemon thread: startup stays instant,
    and by the time a human has filled in a form the models are resident. A
    failure here is not fatal; `_load_ml_models` already falls back to the
    heuristics and logs.
    """
    import threading
    from ml.predict import _load_ml_models

    threading.Thread(target=_load_ml_models, name="ml-warmup", daemon=True).start()

# Cross-origin access is only needed during local development or when the
# static frontend is hosted separately. Same-origin production deployments do
# not need CORS at all. Configure additional origins with CORS_ORIGINS.
_default_cors_origins = "http://localhost:8000,http://127.0.0.1:8000"
_cors_origins = [
    origin.strip().rstrip("/")
    for origin in os.getenv("CORS_ORIGINS", _default_cors_origins).split(",")
    if origin.strip()
]
app.add_middleware(
    CORSMiddleware,
    allow_origins=_cors_origins,
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Gzip: mandi-price / yield-history responses routinely exceed 50 KB of JSON;
# compression cuts that by ~80% on the wire for near-zero CPU cost.
app.add_middleware(GZipMiddleware, minimum_size=800)


#: Content-addressed assets do not exist here -- the frontend is zero-build, so
#: every script and stylesheet keeps a stable URL across deploys. Anything with
#: a stable URL whose *contents* change must therefore be revalidated, or a
#: returning visitor runs yesterday's JS against today's HTML for a full day.
#: Only genuinely immutable payloads (images, boundary geometry, fonts) get a
#: long TTL.
_IMMUTABLE_ASSET_SUFFIXES = (
    ".png", ".jpg", ".jpeg", ".webp", ".gif", ".svg", ".ico",
    ".woff", ".woff2", ".ttf", ".otf", ".geo.json",
)


class StaticCacheHeaders(BaseHTTPMiddleware):
    """Adds sensible Cache-Control headers for the static frontend assets.

    - HTML, service worker, JS & CSS: no-cache, so the browser always
      revalidates (cheap 304s via ETag) and a deploy is picked up immediately.
    - Images / fonts / boundary geometry: 1-day cache with stale-while-revalidate.
    - API responses: short 30s cache (private) so rapid repeat calls feel instant.
    """

    async def dispatch(self, request: Request, call_next):
        response = await call_next(request)
        path = request.url.path
        if path.startswith("/api/"):
            response.headers.setdefault("Cache-Control", "private, max-age=30")
        elif path.endswith(_IMMUTABLE_ASSET_SUFFIXES):
            response.headers.setdefault(
                "Cache-Control", "public, max-age=86400, stale-while-revalidate=604800"
            )
        elif "." in path.rsplit("/", 1)[-1] or path.endswith("/"):
            response.headers.setdefault("Cache-Control", "no-cache")
        return response


app.add_middleware(StaticCacheHeaders)

from backend.models import (
    SimulationRequest,
    RecommendationRequest,
    CompareRequest,
    RotationRequest,
    BatchSimRequest,
    CropMixRequest,
    LoanRequest,
    DiseasePredictQuery,
    SoilProjectionRequest,
    ExpenseLogRequest,
    BenchmarkRequest,
    CropRecQuery,
    YieldPredQuery,
    ProfitEstRequest,
    IrrigationQuery,
    FertilizerQuery,
    NDVIQuery,
    FarmScoreQuery,
    ClimateAlertQuery,
    CarbonCreditQuery,
    IoTTelemetryQuery,
    IoTTriggerRequest,
    UsageCollectRequest,
)




# --- Helper functions ---

# All dataset reads go through the shared mtime-aware CSV cache. Hot endpoints
# below use index_by() to skip full-table scans entirely.
def read_csv(filename: str) -> List[Dict[str, str]]:
    return _csv_load(filename)

_DEFAULT_YIELD_RMSE = 950.0  # fallback if the audit report is unavailable

def _yield_model_rmse() -> float:
    """Read the yield model's RMSE from ml/models/audit_metrics.json."""
    import json
    audit_path = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "ml", "models", "audit_metrics.json")
    try:
        with open(audit_path, "r") as f:
            audit = json.load(f)
        rmse = audit.get("yield_prediction", {}).get("rmse")
        if rmse is not None:
            return float(rmse)
    except (OSError, ValueError, KeyError):
        pass
    return _DEFAULT_YIELD_RMSE

# --- API Endpoints ---

@app.get("/api/health")
async def health_check():
    return {"status": "ok", "service": "AgriSim Engine"}


@app.get("/api/_cache/stats")
async def cache_stats():
    """Diagnostic: current CSV cache state (rows per file + indexes)."""
    from utils.csv_cache import stats as _stats
    return _stats()


@app.get("/api/data-freshness")
def data_freshness():
    """Provenance + age of every dataset behind the numbers shown to the user.

    Lets the frontend badge whether mandi prices are live from data.gov.in or a
    fallback to the seed CSV, which is otherwise a silent downgrade.
    """
    from utils.provenance import describe_sources
    return describe_sources()


@app.get("/api/location-insights/{region_id}")
def get_location_insights(region_id: str, season: str = "kharif"):
    try:
        return location_based_insights(region_id, season)
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))

@app.post("/api/recommend")
def get_recommendations(req: RecommendationRequest):
    try:
        return recommend_crops(
            region_id=req.region_id,
            season=req.season,
            budget_per_acre=req.budget_per_acre,
            area_acres=req.area_acres
        )
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))

@app.post("/api/simulate")
def run_simulation(request: SimulationRequest):
    try:
        strategy = request.model_dump()
        result = simulate(strategy)
        return result
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))

@app.post("/api/compare-strategies")
def compare_strategies(req: CompareRequest):
    try:
        results = []
        for strategy in req.strategies:
            strat_dict = strategy.model_dump()
            res = simulate(strat_dict)
            results.append({
                "strategy": strat_dict,
                "result": res
            })
        return {"comparisons": results}
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))

@app.get("/api/price-analytics/{region_id}/{crop_id}")
def get_price_analytics(region_id: str, crop_id: str):
    """Returns mandi price analytics: trend, volatility, seasonal pattern, moving averages."""
    try:
        return mandi_price_analytics(region_id, crop_id)
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))

@app.post("/api/rotation-plan")
def get_rotation_plan(req: RotationRequest):
    """Returns optimal kharif→rabi crop rotation plans."""
    try:
        return rotation_planner(req.region_id, req.budget_per_acre, req.area_acres)
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))

@app.get("/api/crop-comparison/{region_id}/{season}")
def get_crop_comparison(region_id: str, season: str, budget_per_acre: float = 15000, area_acres: float = 3):
    """Returns all crops compared for a region/season with full metrics."""
    if budget_per_acre <= 0 or area_acres <= 0:
        raise HTTPException(status_code=400, detail="budget_per_acre and area_acres must be greater than 0")
    try:
        return recommend_crops(region_id, season, budget_per_acre, area_acres, top_k=50)
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))

@app.post("/api/batch-simulate")
def batch_simulate(req: BatchSimRequest):
    """Simulate multiple crops in one call, returning ranked results."""
    # Pre-filter to the region once so each crop lookup is O(k) not O(n).
    region_rows = _csv_index("mandi_prices.csv", "region_id").get(req.region_id, [])
    results = []
    errors = []
    for crop_id in req.crop_ids:
        try:
            crop_prices = [float(r["price_inr_per_kg"]) for r in region_rows if r["crop_id"] == crop_id]
            price = crop_prices[-1] if crop_prices else 25.0
            budget = req.budget_per_acre
            strategy = {
                "crop_id": crop_id,
                "area_acres": req.area_acres,
                "region_id": req.region_id,
                "mandi_price_per_kg": price,
                "irrigation_level": req.irrigation_level,
                "seed_variety": req.seed_variety,
                "sowing_date": req.sowing_date,
                "soil": req.soil,
                "weather": req.weather,
                "input_plan": {
                    "seed_cost_per_acre": budget * 0.12,
                    "fertilizer_cost_per_acre": budget * 0.30,
                    "labour_cost_per_acre": budget * 0.25,
                    "irrigation_cost_per_acre": budget * 0.15,
                    "pesticide_cost_per_acre": budget * 0.10,
                    "machinery_cost_per_acre": budget * 0.08,
                },
            }
            result = simulate(strategy)
            results.append(result)
        except Exception as e:
            errors.append({"crop_id": crop_id, "error": str(e)})
    results.sort(key=lambda x: x["profit"], reverse=True)
    return {"results": results, "errors": errors, "total_simulated": len(results)}

# --- Flagship Feature REST API Endpoints ---
@app.post("/api/field/ndvi")
def get_field_ndvi(req: NDVIQuery):
    """Returns an estimated NDVI index, canopy cover %, and sub-field health grid.

    This is NOT real Sentinel-2 (or any other) satellite imagery -- there is no
    external earth-observation call. The values are deterministically derived
    from the given lat/lon (and crop/area) via a hash-based estimator, which is
    also disclosed to callers in the response payload (`is_estimate: true`).
    Treat this as a plausible stand-in for field health, not a measurement.
    """
    try:
        return calculate_ndvi_and_field_health(
            lat=req.lat,
            lon=req.lon,
            crop_id=req.crop_id or "wheat",
            area_acres=req.area_acres or 4.0
        )
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))

@app.post("/api/farm-score")
def get_farm_score(req: FarmScoreQuery):
    """Blends recommendation, risk, and (when location is given) field-health and
    pest signals from the platform's own tools into one headline score/grade."""
    try:
        return compute_farm_score(
            region_id=req.region_id,
            season=req.season,
            budget_per_acre=req.budget_per_acre,
            area_acres=req.area_acres,
            crop_id=req.crop_id,
            lat=req.lat,
            lon=req.lon,
        )
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))

@app.post("/api/climate/alerts")
def get_climate_alerts(req: ClimateAlertQuery):
    """Returns micro-climate pest and fungal disease outbreak risk alerts."""
    try:
        return calculate_disease_outbreak_risk(
            crop_id=req.crop_id,
            region_id=req.region_id or "mp_sehore",
            weather=req.weather
        )
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))

@app.post("/api/carbon-credits")
def get_carbon_credits(req: CarbonCreditQuery):
    """Returns an unverified carbon-planning estimate, not saleable credits."""
    try:
        return calculate_carbon_credits(
            crop_id=req.crop_id,
            area_acres=req.area_acres,
            tillage_practice=req.tillage_practice or "no_till",
            cover_crop=req.cover_crop if req.cover_crop is not None else True,
            biochar_application=req.biochar_application or False
        )
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))

@app.post("/api/iot/telemetry")
def get_iot_telemetry(req: Optional[IoTTelemetryQuery] = None):
    """Returns a clearly labelled sample payload until a sensor integration exists."""
    try:
        from datetime import datetime, timezone
        farm_id = (req and req.farm_id) or "farm_01"
        return {
            "source": "sample_data",
            "is_live": False,
            "farm_id": farm_id,
            "timestamp": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
            "soil_moisture_pct": 38.5,
            "soil_temp_c": 24.2,
            "soil_ph": 6.8,
            "npk_nitrogen_ppm": 42.0,
            "npk_phosphorus_ppm": 22.0,
            "npk_potassium_ppm": 18.0,
            "ambient_temp_c": 29.4,
            "relative_humidity_pct": 64.0,
            "solar_radiation_wm2": 720.0,
            "battery_level_pct": 94,
            "sensor_status": "ONLINE_NORMAL",
        }
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))


@app.post("/api/iot/pump-trigger")
def trigger_smart_pump(req: IoTTriggerRequest):
    """Calculates a pump-runtime recommendation; it never controls equipment."""
    try:
        deficit_pct = max(0.0, (req.target_moisture_pct or 65.0) - (req.current_moisture_pct or 40.0))
        area = req.area_acres or 4.0
        flow = req.flow_rate_lpm or 120.0

        # ~10,000 liters per acre per 10% moisture deficit
        water_volume_liters = round(deficit_pct * 1000.0 * area, 1)
        runtime_minutes = round(water_volume_liters / max(flow, 1.0), 1)

        return {
            "farm_id": req.farm_id,
            "current_moisture_pct": req.current_moisture_pct,
            "target_moisture_pct": req.target_moisture_pct,
            "moisture_deficit_pct": round(deficit_pct, 1),
            "required_water_liters": water_volume_liters,
            "flow_rate_lpm": flow,
            "recommended_pump_runtime_minutes": runtime_minutes,
            "control_action": "RECOMMEND_IRRIGATION" if deficit_pct > 5 else "NO_ACTION_RECOMMENDED",
            "is_controlled": False,
            "estimated_electricity_kwh": round(runtime_minutes * 0.08, 2),
        }
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))


@app.post("/api/optimal-mix")
def optimal_crop_mix(req: CropMixRequest):
    """Find optimal multi-crop allocation for given land and budget."""
    try:
        all_crops = recommend_crops(req.region_id, req.season, req.total_budget / req.total_area_acres, req.total_area_acres, top_k=50)
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))

    if not all_crops:
        raise HTTPException(status_code=404, detail="No crops available for this region/season")

    # Greedy allocation: assign area proportional to smart_score, minimum 0.5 acres per crop
    total_score = sum(c["smart_score"] for c in all_crops)
    if total_score == 0:
        raise HTTPException(status_code=400, detail="All crops scored 0")

    min_area_per_crop = min(0.5, req.total_area_acres)
    allocations = []
    remaining_area = req.total_area_acres
    remaining_budget = req.total_budget
    for crop in all_crops:
        if remaining_area < 0.05:
            break
        share = crop["smart_score"] / total_score
        target_area = share * req.total_area_acres
        area = round(max(target_area, min_area_per_crop), 2)
        area = min(area, remaining_area)
        if area <= 0:
            continue
        budget_for_crop = round(area / req.total_area_acres * req.total_budget, 2)
        allocations.append({
            "crop_id": crop["crop_id"],
            "crop_name": crop["crop_name"],
            "allocated_acres": area,
            "allocated_budget": budget_for_crop,
            "expected_profit": round(crop["expected_profit"] * (area / req.total_area_acres), 2),
            "roi_percent": crop["roi_percent"],
            "risk_score": crop["risk_score"],
            "smart_score": crop["smart_score"],
        })
        remaining_area -= area
        remaining_budget -= budget_for_crop

    total_profit = sum(a["expected_profit"] for a in allocations)
    avg_risk = mean([a["risk_score"] for a in allocations]) if allocations else 0
    return {
        "region_id": req.region_id,
        "season": req.season,
        "total_area_acres": req.total_area_acres,
        "total_budget": req.total_budget,
        "allocations": allocations,
        "total_expected_profit": round(total_profit, 2),
        "avg_risk_score": round(avg_risk, 2),
        "num_crops": len(allocations),
        "unallocated_budget": round(max(0.0, remaining_budget), 2),
        "unallocated_area_acres": round(max(0.0, remaining_area), 2),
    }

# ---------------------------------------------------------------------------
# Feature Endpoints (14 new features)
# ---------------------------------------------------------------------------

@app.get("/api/fertilizer-recommendation/{crop_id}")
def get_fertilizer_rec(crop_id: str, n: float = 40, p: float = 20, k: float = 20):
    """Get specific fertilizer recommendations based on soil NPK and crop needs."""
    try:
        return fertilizer_recommendation(crop_id, {"n_kg_per_acre": n, "p_kg_per_acre": p, "k_kg_per_acre": k})
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))

@app.get("/api/msp")
async def get_msp(crop_id: Optional[str] = None, year: Optional[int] = None):
    """Get MSP (Minimum Support Price) data."""
    return get_msp_data(crop_id, year)

@app.get("/api/msp-vs-market/{region_id}/{crop_id}")
def get_msp_comparison(region_id: str, crop_id: str):
    """Compare MSP with current mandi prices."""
    try:
        return msp_vs_market(region_id, crop_id)
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))

@app.get("/api/sell-advisor/{region_id}/{crop_id}")
def get_sell_advice(region_id: str, crop_id: str):
    """Get best time to sell recommendation."""
    try:
        return best_time_to_sell(region_id, crop_id)
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))

@app.get("/api/irrigation-schedule/{crop_id}")
def get_irrigation_schedule(crop_id: str, sowing_date: str = "2025-06-15", rainfall_mm: float = 800, irrigation_level: float = 0.5):
    """Get week-by-week irrigation schedule."""
    try:
        return irrigation_schedule(crop_id, sowing_date, rainfall_mm, irrigation_level)
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))

@app.get("/api/crop-calendar/{crop_id}")
def get_calendar(crop_id: str, season: Optional[str] = None):
    """Get crop calendar with key activity dates."""
    try:
        return get_crop_calendar(crop_id, season)
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))

@app.get("/api/pest-alerts/{crop_id}")
def get_pest_alerts(crop_id: str, avg_temp_c: float = 28, rainfall_mm: float = 800):
    """Get pest and disease risk alerts based on weather conditions."""
    try:
        return pest_disease_alerts(crop_id, {"avg_temp_c": avg_temp_c, "rainfall_mm": rainfall_mm})
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))

@app.post("/api/loan-calculator")
def calculate_loan(req: LoanRequest):
    """Calculate loan feasibility and EMI."""
    try:
        return loan_calculator(
            total_cost=req.total_cost,
            expected_profit=req.expected_profit,
            loan_amount=req.loan_amount,
            interest_rate_annual=req.interest_rate_annual,
            tenure_months=req.tenure_months,
        )
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))

@app.post("/api/soil-projection")
def project_soil_health(req: SoilProjectionRequest):
    """Project soil NPK health over multiple years of crop rotation."""
    try:
        return soil_health_projection(
            current_soil=req.current_soil,
            rotation=req.rotation,
            years=req.years,
            apply_fertilizer=req.apply_fertilizer,
        )
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))

@app.get("/api/price-forecast/{region_id}/{crop_id}")
def get_price_forecast(region_id: str, crop_id: str, months_ahead: int = 6):
    """Forecast mandi prices for next N months."""
    try:
        return price_forecast(region_id, crop_id, months_ahead)
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))

@app.get("/api/arbitrage/{crop_id}")
def get_arbitrage(crop_id: str):
    """Find cross-mandi price arbitrage opportunities."""
    try:
        return cross_mandi_arbitrage(crop_id)
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))

@app.get("/api/strategy-templates")
async def get_templates(profile: Optional[str] = None):
    """Get pre-built strategy templates, optionally filtered by profile."""
    return get_strategy_templates(profile)

@app.post("/api/benchmark")
def get_benchmark(req: BenchmarkRequest):
    """Compare user results against regional benchmarks."""
    try:
        return region_benchmark(
            region_id=req.region_id,
            crop_id=req.crop_id,
            user_yield_kg_per_acre=req.user_yield_kg_per_acre,
            user_profit_per_acre=req.user_profit_per_acre,
        )
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))

@app.post("/api/expense/log")
def post_expense(req: ExpenseLogRequest):
    """Expense persistence requires authenticated, tenant-scoped storage."""
    raise HTTPException(status_code=503, detail="Expense storage is disabled until authenticated storage is configured.")

@app.get("/api/expense/{farm_id}")
def get_expenses(farm_id: str, planned_budget: Optional[float] = None):
    """Expense persistence requires authenticated, tenant-scoped storage."""
    raise HTTPException(status_code=503, detail="Expense storage is disabled until authenticated storage is configured.")

@app.get("/api/government-schemes")
def get_schemes(crop_id: str = "all", region_id: str = "all", area_acres: float = 3, season: str = "all"):
    """Match eligible government schemes for farmer profile."""
    return match_government_schemes(crop_id, region_id, area_acres, season)


# ---------------------------------------------------------------------------
# Usage instrumentation
#
# Accepts anonymous event *counts* only — see utils/usage_store for the privacy
# constraints. Disabled unless the operator sets ENABLE_USAGE_COLLECTION=true,
# and the browser only sends anything after an explicit opt-in.
# ---------------------------------------------------------------------------

@app.get("/api/usage/config")
def usage_config():
    """Lets the frontend show or hide the sharing opt-in."""
    from utils.usage_store import collection_enabled
    return {"collection_enabled": collection_enabled()}


@app.post("/api/usage/collect")
def usage_collect(req: UsageCollectRequest):
    from utils.usage_store import collection_enabled, record
    if not collection_enabled():
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Usage collection is disabled on this server.",
        )
    return record(req.counts)


@app.get("/api/usage/summary")
def usage_summary(days: int = 30, x_admin_key: Optional[str] = Header(default=None)):
    """Aggregate counts. Admin-gated: operational data, not a public endpoint."""
    from utils.usage_store import collection_enabled, summary
    if not collection_enabled():
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Usage collection is disabled on this server.",
        )
    expected_key = os.getenv("ADMIN_API_KEY")
    if not expected_key:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Usage reporting requires ADMIN_API_KEY to be configured.",
        )
    if not x_admin_key or not secrets.compare_digest(x_admin_key, expected_key):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid admin key.")
    return summary(days)




# ---------------------------------------------------------------------------
# ML Model Endpoints
# ---------------------------------------------------------------------------

@app.post("/api/ml/train")
def train_models(x_admin_key: Optional[str] = Header(default=None)):
    """Train models only when an administrator explicitly enables the job."""
    if os.getenv("ENABLE_MODEL_TRAINING", "false").lower() != "true":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Model training is disabled. Enable it only for an admin-controlled job.",
        )
    expected_key = os.getenv("ADMIN_API_KEY")
    if not expected_key:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Model-training administration is not configured.",
        )
    if not x_admin_key or not secrets.compare_digest(x_admin_key, expected_key):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid admin key.")
    try:
        from ml.train_models import train_all as ml_train_all
        report = ml_train_all()
        return {"status": "success", "report": report}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/api/ml/status")
def model_status():
    """Check which ML models are loaded and available, merging detailed audit benchmarks."""
    import ml.predict as pred
    pred._load_ml_models()
    model_dir = os.path.join(os.path.dirname(os.path.dirname(__file__)), "ml", "models")
    # Read manifest.json (written by ml/train_models.py), which describes the models
    # actually loaded and serving predictions -- NOT evaluation_manifest.json, which
    # describes a different, unwired model produced by ml/evaluate_models.py. See
    # AUDIT_REPORT.md finding C-2.
    manifest_path = os.path.join(model_dir, "manifest.json")
    audit_path = os.path.join(model_dir, "audit_metrics.json")
    
    manifest = None
    if os.path.exists(manifest_path):
        import json
        with open(manifest_path, "r") as f:
            manifest = json.load(f)
            
    audit = None
    if os.path.exists(audit_path):
        import json
        with open(audit_path, "r") as f:
            audit = json.load(f)
            
    return {
        "yield_model_loaded": pred._ml_yield_model is not None,
        "price_model_loaded": pred._ml_price_model is not None,
        "recommend_model_loaded": pred._ml_recommend_model is not None,
        "disease_model_loaded": pred._ml_disease_session is not None,
        "disease_screening_available": True,
        "model_dir": "ml/models",
        "model_provenance": "Development planning artifacts trained from the repository seed data and synthetic augmentation; not independently validated field models.",
        "models_exist": os.path.exists(os.path.join(model_dir, "yield_model.joblib")),
        "training_enabled": os.getenv("ENABLE_MODEL_TRAINING", "false").lower() == "true",
        "training_report": manifest,
        "audit_metrics": audit
    }

# Database of 18 disease classes and their treatments/metadata
DISEASE_METADATA = {
    "rice_neck_blast": {
        "disease": "Rice Neck Blast",
        "organic": [
            "Use disease-free seeds and resistant varieties.",
            "Avoid excessive nitrogen fertilizer application.",
            "Apply silica to soil to strengthen plant cell walls."
        ],
        "chemical": [
            "Spray Tricyclazole 75% WP @ 0.6 g/L or Isoprothiolane 40% EC @ 1.5 ml/L.",
            "Apply fungicides at the late booting stage and again at 50% flowering."
        ],
        "schemes": ["pmfby"]
    },
    "maize_physoderma_brown_spot": {
        "disease": "Maize Physoderma Brown Spot",
        "organic": [
            "Rotate crops for at least one year with a non-host.",
            "Tillage to help bury infected crop residue and speed decomposition.",
            "Ensure proper field drainage to reduce water pooling."
        ],
        "chemical": [
            "Fungicides like Azoxystrobin or Pyraclostrobin can be applied preventatively at V4 to V8 stages.",
            "Use protective fungicidal sprays only in highly susceptible hybrids."
        ],
        "schemes": ["pmfby"]
    },
    "maize_common_rust": {
        "disease": "Maize Common Rust",
        "organic": [
            "Destroy infected crop debris after harvest to prevent winter survival.",
            "Plant resistant maize hybrids.",
            "Apply organic copper-based fungicides if caught in very early stages."
        ],
        "chemical": [
            "Spray Mancozeb 75 WP at 2g/L or Propiconazole 25 EC at 1ml/L of water."
        ],
        "schemes": ["pmfby", "kkc"]
    },
    "maize_gray_leaf_spot": {
        "disease": "Maize Gray Leaf Spot",
        "organic": [
            "Rotate crops for 2 or more years with non-host crops (e.g. pulses, soybean).",
            "Deep tillage to bury infected plant residues in the soil."
        ],
        "chemical": [
            "Spray Pyraclostrobin or Azoxystrobin based fungicides at recommended intervals."
        ],
        "schemes": ["pmfby", "kkc"]
    },
    "maize_northern_leaf_blight": {
        "disease": "Maize Northern Leaf Blight",
        "organic": [
            "Select resistant cultivars.",
            "Bury crop residues with deep tillage after harvest."
        ],
        "chemical": [
            "Apply foliar spray of Mancozeb or Zineb when lesions are first observed."
        ],
        "schemes": ["pmfby"]
    },
    "maize_healthy": {
        "disease": "Maize Healthy Leaf",
        "organic": [
            "Continue standard crop rotation.",
            "Ensure balanced fertilization according to soil tests."
        ],
        "chemical": [
            "No chemical inputs are required."
        ],
        "schemes": []
    },
    "potato_early_blight": {
        "disease": "Potato Early Blight",
        "organic": [
            "Prune lower infected leaves.",
            "Avoid overhead irrigation to keep leaves dry.",
            "Apply neem oil spray (0.5%) as a biological preventative."
        ],
        "chemical": [
            "Spray Chlorothalonil or Mancozeb (2g/L) at 10-14 day intervals."
        ],
        "schemes": ["pmfby", "kkc"]
    },
    "potato_late_blight": {
        "disease": "Potato Late Blight",
        "organic": [
            "Plant certified disease-free seed tubers.",
            "Destroy all cull piles and volunteers immediately.",
            "Apply Trichoderma-based bio-fungicides."
        ],
        "chemical": [
            "Foliar application of Metalaxyl-M (8%) + Mancozeb (64%) WP (Ridomil Gold) at 2.5g/L."
        ],
        "schemes": ["pmfby", "kkc"]
    },
    "potato_healthy": {
        "disease": "Potato Healthy Leaf",
        "organic": [
            "Monitor weather patterns (humidity) and spray preventive bio-agents."
        ],
        "chemical": [
            "No chemical fungicide is required."
        ],
        "schemes": []
    },
    "soybean_healthy": {
        "disease": "Soybean Healthy Leaf",
        "organic": [
            "Practice crop rotation.",
            "Ensure proper drainage in fields."
        ],
        "chemical": [
            "No chemical fungicide is required."
        ],
        "schemes": []
    },
    "tomato_bacterial_spot": {
        "disease": "Tomato Bacterial Spot",
        "organic": [
            "Use certified pathogen-free seeds.",
            "Avoid working in fields when foliage is wet.",
            "Apply copper hydroxide bio-blends."
        ],
        "chemical": [
            "Apply Copper Hydroxide (2g/L) mixed with Streptocycline (0.1g/L) at weekly intervals."
        ],
        "schemes": ["pmfby"]
    },
    "tomato_early_blight": {
        "disease": "Tomato Early Blight",
        "organic": [
            "Prune lower branches to improve airflow and reduce soil splash.",
            "Apply organic straw mulch to create a barrier over soil.",
            "Foliar spray of Bacillus subtilis biological agent."
        ],
        "chemical": [
            "Foliar spray of Azoxystrobin 23% SC (1ml/L) or Mancozeb 75 WP (2g/L)."
        ],
        "schemes": ["pmfby", "kkc"]
    },
    "tomato_late_blight": {
        "disease": "Tomato Late Blight",
        "organic": [
            "Remove and burn infected plants immediately.",
            "Avoid overhead irrigation.",
            "Spray copper-based organic fungicides at first sign of rain/fog."
        ],
        "chemical": [
            "Apply Cymoxanil + Mancozeb (Curzate) or Metalaxyl + Mancozeb (Ridomil Gold) immediately."
        ],
        "schemes": ["pmfby", "kkc"]
    },
    "tomato_leaf_mold": {
        "disease": "Tomato Leaf Mold",
        "organic": [
            "Increase spacing and ventilation.",
            "Avoid overhead watering and keep humidity below 85%."
        ],
        "chemical": [
            "Spray Chlorothalonil or Difenoconazole if infection becomes severe."
        ],
        "schemes": []
    },
    "tomato_septoria_leaf_spot": {
        "disease": "Tomato Septoria Leaf Spot",
        "organic": [
            "Remove and destroy lower infected leaves.",
            "Mulch the soil base and water at ground level."
        ],
        "chemical": [
            "Apply Chlorothalonil or Mancozeb sprays at first sign of leaf spots."
        ],
        "schemes": []
    },
    "tomato_spider_mites": {
        "disease": "Tomato Spider Mite Infestation",
        "organic": [
            "Spray neem oil (1-2%) or insecticidal soaps.",
            "Release phytoseiid predatory mites.",
            "Keep plants well irrigated (dry dust promotes mite breeding)."
        ],
        "chemical": [
            "Apply Abamectin or Spiromesifen acaricides."
        ],
        "schemes": []
    },
    "tomato_target_spot": {
        "disease": "Tomato Target Spot",
        "organic": [
            "Improve air circulation through staking and pruning.",
            "Bury or burn crop residues."
        ],
        "chemical": [
            "Spray Azoxystrobin or Chlorothalonil."
        ],
        "schemes": []
    },
    "tomato_yellow_leaf_curl_virus": {
        "disease": "Tomato Yellow Leaf Curl Virus (TYLCV)",
        "organic": [
            "Place yellow sticky traps to catch whitefly vectors.",
            "Use insect netting on nursery beds.",
            "Spray neem seed kernel extract (NSKE) to deter pests."
        ],
        "chemical": [
            "Spray systemic insecticides like Imidacloprid (0.5ml/L) or Thiamethoxam to control whiteflies."
        ],
        "schemes": ["pmfby"]
    },
    "tomato_mosaic_virus": {
        "disease": "Tomato Mosaic Virus (ToMV)",
        "organic": [
            "Drench tools and hands in 10% trisodium phosphate.",
            "Promptly pull out and destroy infected plants."
        ],
        "chemical": [
            "No chemical cure is available for viral infections. Manage vector insects chemically if needed."
        ],
        "schemes": []
    },
    "tomato_healthy": {
        "disease": "Tomato Healthy Leaf",
        "organic": [
            "Maintain clean hygiene and baseline soil nutrient balance."
        ],
        "chemical": [
            "No chemical inputs are required."
        ],
        "schemes": []
    }
}

# ---------------------------------------------------------------------------
# D-8: minimal per-IP rate limit for /api/disease/predict.
#
# This endpoint is fully public and farmer-facing by design (unlike the
# admin-gated training/expense endpoints elsewhere in this file, which use
# an X-Admin-Key check) -- it must keep working with no login. It also does
# real per-request work (base64 decode + image feature extraction), so it's
# the one public ML endpoint worth throttling. There is no rate-limiting
# library anywhere in requirements.txt, so this is a small dependency-free
# fixed-window counter keyed by client IP.
#
# Honest limitation: `_disease_rate_limit_log` is a plain process-local
# dict, not a shared store. It resets on every cold start and is NOT
# shared across concurrent serverless instances, so this only throttles
# repeat calls that land on the *same* warm instance -- it is a best-effort
# speed bump against casual/accidental abuse, not a hard guarantee against
# a determined or distributed caller. A real guarantee would need a shared
# store (e.g. Redis) fronting all instances.
# ---------------------------------------------------------------------------
# `time`/`threading` are imported here (rather than assumed from the
# `import time` / `import threading` further down in this file's "Phase 6"
# section) so this block works correctly regardless of where in the file
# it lives -- re-importing an already-imported stdlib module is a cheap,
# safe no-op.
import time
import threading

_DISEASE_RATE_LIMIT_WINDOW_SEC = 60
_DISEASE_RATE_LIMIT_MAX_REQUESTS = 15
_disease_rate_limit_lock = threading.Lock()
_disease_rate_limit_log: Dict[str, List[float]] = {}


def _disease_rate_limit_check(client_ip: str) -> bool:
    """Record a call from `client_ip` and report whether it's within budget.

    Returns True (and records the call) if `client_ip` has made fewer than
    `_DISEASE_RATE_LIMIT_MAX_REQUESTS` calls in the trailing
    `_DISEASE_RATE_LIMIT_WINDOW_SEC` seconds; False if it should be
    rejected with 429 (in which case the call is NOT recorded again).
    """
    now = time.time()
    window_start = now - _DISEASE_RATE_LIMIT_WINDOW_SEC
    with _disease_rate_limit_lock:
        # Cap distinct tracked IPs so a long-lived warm instance seeing many
        # unique callers can't grow this dict without bound.
        if len(_disease_rate_limit_log) >= 5000:
            _disease_rate_limit_log.clear()
        timestamps = [t for t in _disease_rate_limit_log.get(client_ip, []) if t > window_start]
        if len(timestamps) >= _DISEASE_RATE_LIMIT_MAX_REQUESTS:
            _disease_rate_limit_log[client_ip] = timestamps
            return False
        timestamps.append(now)
        _disease_rate_limit_log[client_ip] = timestamps
        return True


@app.post("/api/disease/predict")
async def predict_disease_api(req: DiseasePredictQuery, request: Request):
    """
    Preliminary visual screening using HSV colour and texture heuristics.
    This is not a validated diagnostic model and must not be used as a basis
    for pesticide use or other irreversible farm decisions.
    """
    # D-8: enforced *before* the try/except below -- that except clause
    # catches Exception broadly and re-raises everything as a 400, which
    # would otherwise swallow a 429 (HTTPException is itself an Exception)
    # and turn it into a misleading "Inference failure" 400.
    #
    # Prefer X-Forwarded-For: on Vercel (where this actually runs) the edge
    # sets/overwrites this header itself and explicitly does not forward a
    # caller-supplied value, specifically to prevent IP spoofing -- see
    # https://vercel.com/docs/headers/request-headers#x-forwarded-for -- so
    # it reflects the real client there. `request.client.host` is the
    # correct fallback for local/dev runs and tests, where there's no
    # Vercel edge in front and this header is simply absent.
    _xff = request.headers.get("x-forwarded-for")
    client_ip = _xff.split(",")[0].strip() if _xff else (request.client.host if request.client else "unknown")
    if not _disease_rate_limit_check(client_ip):
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail=(
                f"Too many disease-scan requests from this address. Limit is "
                f"{_DISEASE_RATE_LIMIT_MAX_REQUESTS} per {_DISEASE_RATE_LIMIT_WINDOW_SEC}s "
                f"-- please wait a moment and try again."
            ),
        )

    import base64
    import io
    import hashlib
    from PIL import Image

    try:
        header, encoded = req.image_b64.split(",", 1) if "," in req.image_b64 else ("", req.image_b64)
        image_data = base64.b64decode(encoded)

        # -----------------------------------------------------------------
        # 1. DEMO MODE: pre-labelled images via MD5 hash
        # -----------------------------------------------------------------
        img_hash = hashlib.md5(image_data).hexdigest()
        demo_file = os.path.join(os.path.dirname(__file__), "demo_images.json")
        if os.path.exists(demo_file):
            import json as _json
            with open(demo_file, "r") as f:
                demo_data = _json.load(f)
            if img_hash in demo_data:
                dm = demo_data[img_hash]
                class_name = dm["class_name"]
                meta = DISEASE_METADATA.get(class_name, DISEASE_METADATA["tomato_healthy"])
                matched_crop = class_name.split("_")[0]

                matched_schemes: list[str] = []
                if req.region_id:
                    try:
                        schemes_res = match_government_schemes(matched_crop, req.region_id)
                        for esc in schemes_res.get("eligible_schemes", []):
                            if esc["scheme_id"] in meta["schemes"] or (
                                esc["scheme_id"] == "pkvy" and len(meta.get("organic", [])) > 0
                            ):
                                matched_schemes.append(
                                    f"{esc['scheme_name']} ({esc['description']}) — URL: {esc['url']}"
                                )
                    except Exception:
                        pass
                if not matched_schemes:
                    for sid in meta.get("schemes", []):
                        if sid == "pmfby":
                            matched_schemes.append("PMFBY (Crop Insurance) — URL: https://pmfby.gov.in")
                        elif sid == "kkc":
                            matched_schemes.append("Kisan Credit Card — URL: https://www.nabard.org")
                        elif sid == "pkvy":
                            matched_schemes.append("PKVY (Organic Cluster Subsidy) — URL: https://pgsindia-ncof.gov.in")

                treatments = (
                    [f"Organic: {o}" for o in meta.get("organic", [])]
                    + [f"Chemical Escalation: {c}" for c in meta.get("chemical", [])]
                )

                return {
                    "analysis_type": "demo_precomputed",
                    "prediction_source": "demo_precomputed",
                    "disclaimer": "This is not a diagnosis. Confirm symptoms with a qualified agronomist before treatment.",
                    "disease": meta["disease"],
                    "confidence": dm["confidence"],
                    "severity": dm["severity"],
                    "treatment": treatments,
                    "organic_treatment": meta.get("organic", []),
                    "chemical_treatment": meta.get("chemical", []),
                    "crop_matched": matched_crop,
                    "region_context": req.region_id or "all",
                    "lesion_area_pct": None,
                    "subsidy_eligible_schemes": matched_schemes,
                    "action_plan": build_action_plan(
                        class_name, req.area_acres or 1.0, dm["severity"]
                    ),
                    "is_demo_mode": True,
                }

        # -----------------------------------------------------------------
        # 2. LOAD + FEATURE EXTRACTION
        #    Shared with the offline trainer (engine/disease_features.py) so
        #    the trained model sees the exact same feature vector at
        #    inference time that it was fit on.
        # -----------------------------------------------------------------
        image = Image.open(io.BytesIO(image_data))
        # Guard against decompression-bomb images: DiseasePredictQuery caps the
        # base64 payload by byte length, but that alone doesn't bound the
        # decoded pixel dimensions (e.g. a tiny, highly-compressible PNG can
        # still unpack to a huge bitmap). Reject anything above ~16 megapixels
        # (e.g. 4000x4000) before running feature extraction. See AUDIT_REPORT.md M-5.
        width, height = image.size
        if width * height > 16_000_000:
            raise HTTPException(
                status_code=400,
                detail="Image dimensions too large (max ~16 megapixels, e.g. 4000x4000).",
            )
        leaf_features = extract_leaf_features(image)
        hue_yellow = leaf_features["hue_yellow"]
        hue_green = leaf_features["hue_green"]
        hue_orange = leaf_features["hue_orange"]
        hue_brown = leaf_features["hue_brown"]
        hue_gray = leaf_features["hue_gray"]
        hue_dark = leaf_features["hue_dark"]
        hue_bright = leaf_features["hue_bright"]
        sat_mean = leaf_features["sat_mean"]
        val_mean = leaf_features["val_mean"]
        hue_mean = leaf_features["hue_mean"]
        texture_score = leaf_features["texture_score"]
        lesion_frac = leaf_features["lesion_frac"]
        severity = severity_from_lesion_frac(lesion_frac)

        # -----------------------------------------------------------------
        # 4. CROP CONTEXT
        # -----------------------------------------------------------------
        crop = (req.crop_id or "").lower().strip()
        valid_crops = {"maize", "potato", "soybean", "tomato"}
        if crop not in valid_crops:
            crop = ""

        # -----------------------------------------------------------------
        # 5. DECISION TREE CLASSIFIER
        #    Each branch uses clear, mutually distinct feature thresholds.
        #    Returns (class_name, raw_confidence 0-1)
        # -----------------------------------------------------------------
        def classify(c: str) -> tuple[str, float]:
            """
            Strictly crop-bound decision tree.
            If the user selected a crop, we ONLY return diseases for that crop.
            If no crop is selected (c == ""), we default to Tomato diseases since they are the most comprehensive.
            """
            if c == "potato":
                if hue_dark > 0.30 or val_mean < 0.25 or (hue_brown > 0.20 and severity == "severe"):
                    return ("potato_late_blight", min(0.97, 0.74 + (1.0 - val_mean) * 0.20))
                elif lesion_frac > 0.15 or hue_brown > 0.10 or hue_yellow > 0.20 or hue_orange > 0.15:
                    return ("potato_early_blight", min(0.97, 0.68 + lesion_frac * 0.20))
                else:
                    return ("potato_healthy", min(0.97, 0.85 + hue_green * 0.12))

            elif c == "maize":
                if hue_gray > 0.30:
                    return ("maize_gray_leaf_spot", min(0.97, 0.70 + hue_gray * 0.25))
                elif hue_brown > 0.08 and hue_green > 0.15 and texture_score < 0.10:
                    return ("maize_northern_leaf_blight", min(0.97, 0.66 + hue_brown * 0.20))
                elif hue_orange > 0.15 or hue_brown > 0.15 or lesion_frac > 0.20:
                    return ("maize_common_rust", min(0.97, 0.74 + hue_orange * 0.30))
                else:
                    return ("maize_healthy", min(0.97, 0.85 + hue_green * 0.12))

            elif c == "soybean":
                # Only a healthy baseline exists for soybean in DISEASE_METADATA
                # (no soybean disease classes are defined), so this heuristic
                # cannot actually detect a soybean disease. Return the floor
                # confidence rather than a confident "healthy" verdict so the
                # caller can flag the coverage gap instead of asserting health.
                return ("soybean_healthy", 0.45)

            else:
                # Default to Tomato (c == "tomato" or c == "")
                if hue_yellow > 0.30:
                    if texture_score < 0.06:
                        return ("tomato_yellow_leaf_curl_virus", min(0.97, 0.72 + hue_yellow * 0.50))
                    else:
                        return ("tomato_leaf_mold", min(0.97, 0.68 + hue_yellow * 0.40))
                elif hue_orange > 0.20:
                    return ("tomato_early_blight", min(0.97, 0.70 + hue_orange * 0.35))
                elif hue_green > 0.45 and lesion_frac < 0.20:
                    return ("tomato_healthy", min(0.97, 0.85 + hue_green * 0.12))
                elif hue_gray > 0.45:
                    return ("tomato_septoria_leaf_spot", min(0.97, 0.68 + hue_gray * 0.30))
                elif hue_dark > 0.30 or val_mean < 0.25:
                    return ("tomato_late_blight", min(0.97, 0.72 + (1.0 - val_mean) * 0.22))
                elif hue_brown > 0.20:
                    if severity == "severe":
                        return ("tomato_late_blight", min(0.97, 0.68 + hue_brown * 0.25))
                    elif texture_score > 0.10:
                        if hue_brown > 0.50:
                            return ("tomato_target_spot", min(0.97, 0.69 + hue_brown * 0.20))
                        else:
                            return ("tomato_bacterial_spot", min(0.97, 0.67 + texture_score * 0.30))
                    else:
                        return ("tomato_early_blight", min(0.97, 0.66 + hue_brown * 0.25))
                elif texture_score > 0.12:
                    if hue_green > 0.15 and hue_yellow > 0.05:
                        return ("tomato_mosaic_virus", min(0.97, 0.65 + texture_score * 0.25))
                    else:
                        return ("tomato_spider_mites", min(0.97, 0.64 + texture_score * 0.28))
                elif lesion_frac > 0.25:
                    return ("tomato_early_blight", min(0.97, 0.63 + lesion_frac * 0.20))
                else:
                    return ("tomato_healthy", 0.78)

        # Soybean has no disease classes in DISEASE_METADATA or the training
        # set — only a healthy baseline exists — so the ML path is skipped
        # entirely rather than let it report an overconfident "healthy" with
        # no disclosure of the coverage gap. The heuristic below already
        # floors confidence and the coverage_note always fires for soybean.
        ml_result = predict_disease_ml(image, crop) if crop != "soybean" else None
        if ml_result is not None:
            best_class, raw_conf = ml_result
            prediction_source = "ml_model"
        else:
            best_class, raw_conf = classify(crop)
            prediction_source = "heuristic"
        confidence = round(float(np.clip(raw_conf, 0.45, 0.97)), 4)

        meta = DISEASE_METADATA.get(best_class, DISEASE_METADATA["tomato_healthy"])

        # -----------------------------------------------------------------
        # 6. GOVERNMENT SCHEME MATCHING
        # -----------------------------------------------------------------
        matched_schemes: list[str] = []
        matched_crop = best_class.split("_")[0]
        if req.region_id:
            try:
                schemes_res = match_government_schemes(matched_crop, req.region_id)
                for esc in schemes_res.get("eligible_schemes", []):
                    if esc["scheme_id"] in meta["schemes"] or (
                        esc["scheme_id"] == "pkvy" and len(meta.get("organic", [])) > 0
                    ):
                        matched_schemes.append(
                            f"{esc['scheme_name']} ({esc['description']}) — URL: {esc['url']}"
                        )
            except Exception:
                pass

        if not matched_schemes:
            for sid in meta.get("schemes", []):
                if sid == "pmfby":
                    matched_schemes.append("PMFBY (Crop Insurance) — URL: https://pmfby.gov.in")
                elif sid == "kkc":
                    matched_schemes.append("Kisan Credit Card — URL: https://www.nabard.org")
                elif sid == "pkvy":
                    matched_schemes.append("PKVY (Organic Cluster Subsidy) — URL: https://pgsindia-ncof.gov.in")

        treatments = (
            [f"Organic: {o}" for o in meta.get("organic", [])]
            + [f"Chemical Escalation: {c}" for c in meta.get("chemical", [])]
        )

        response = {
            "analysis_type": "trained_classifier_screening" if prediction_source == "ml_model" else "heuristic_screening",
            "prediction_source": prediction_source,
            "model_provenance": (
                "MobileNetV3-Small (fine-tuned, ImageNet-pretrained) trained on a small "
                "real-photo sample from the public PlantVillage research benchmark "
                "(lab-bench accuracy, not field-validated)."
                if prediction_source == "ml_model"
                else "Rule-based HSV colour/texture heuristic, not a trained model."
            ),
            "disclaimer": "This is not a diagnosis. Confirm symptoms with a qualified agronomist before treatment.",
            "disease": meta["disease"],
            "confidence": confidence,
            "severity": severity,
            "treatment": treatments,
            "organic_treatment": meta.get("organic", []),
            "chemical_treatment": meta.get("chemical", []),
            "crop_matched": matched_crop,
            "region_context": req.region_id or "all",
            "lesion_area_pct": round(float(lesion_frac * 100), 2),
            "subsidy_eligible_schemes": matched_schemes,
            "action_plan": build_action_plan(best_class, req.area_acres or 1.0, severity),
        }
        if crop == "soybean":
            response["coverage_note"] = (
                "Soybean disease classes are not covered by this heuristic — only a "
                "healthy baseline exists, so a disease cannot be ruled out from this result."
            )
        return response

    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Inference failure: {str(e)}")


# ---------------------------------------------------------------------------
# Phase 6 Integration: Asynchronous, Validated, and Cached Endpoints
# ---------------------------------------------------------------------------
import time
import logging
import threading

logger = logging.getLogger("FastAPIIntegration")

# Thread-safe in-memory cache with 30s TTL
_route_cache_lock = threading.Lock()
ROUTE_CACHE = {}

def get_cached_response(key: str, ttl: int = 30):
    now = time.time()
    with _route_cache_lock:
        if key in ROUTE_CACHE:
            entry, timestamp = ROUTE_CACHE[key]
            if now - timestamp < ttl:
                return entry
            else:
                ROUTE_CACHE.pop(key, None)  # Clean up expired key on read
    return None

def set_cached_response(key: str, data: Any):
    now = time.time()
    with _route_cache_lock:
        # Cap size at 1000 to prevent memory leaks
        if len(ROUTE_CACHE) >= 1000:
            # First try to clear expired entries
            expired_keys = [k for k, (_, ts) in ROUTE_CACHE.items() if now - ts >= 30]
            for k in expired_keys:
                ROUTE_CACHE.pop(k, None)
            # If still over limit, evict the oldest entry
            if len(ROUTE_CACHE) >= 1000:
                oldest_key = min(ROUTE_CACHE.keys(), key=lambda k: ROUTE_CACHE[k][1])
                ROUTE_CACHE.pop(oldest_key, None)
        ROUTE_CACHE[key] = (data, now)

# --- Async & Cached REST API Routes ---

@app.get("/api/crop")
async def get_crop_recommendations_api(q: CropRecQuery = Depends()):
    """Retrieves ranked crop suggestions with expected profits, risk scores, and ML confidence."""
    # Query params are validated via the CropRecQuery Pydantic model (positive
    # budget/area) instead of hand-rolled checks -- see AUDIT_REPORT.md M-2.
    region_id, season, budget_per_acre, area_acres = q.region_id, q.season, q.budget_per_acre, q.area_acres
    logger.info(f"Crop rec request received for: region={region_id}, season={season}, budget={budget_per_acre}, area={area_acres}")

    cache_key = f"crop_{region_id}_{season}_{budget_per_acre}_{area_acres}"
    cached = get_cached_response(cache_key)
    if cached is not None:
        return cached
        
    try:
        res = recommend_crops(region_id, season, budget_per_acre, area_acres)
        
        # Integrate Agricultural Intelligence Layer (Phase 5 explainer)
        from engine.intelligence_layer import explain_crop_recommendation
        from ml.predict import _load_crop_parameters, _load_soil_by_region, _load_weather_by_region
        crop_params = _load_crop_parameters()
        soil_data = _load_soil_by_region()
        weather_data = _load_weather_by_region()
        
        wkey = (region_id, season.lower())
        weather = weather_data.get(wkey, {})
        soil = soil_data.get(region_id, {})
        
        for rec in res:
            cid = rec["crop_id"]
            cp = crop_params.get(cid)
            cp_dict = {
                "temp_min_c": cp.temp_min_c if cp else 15.0,
                "temp_max_c": cp.temp_max_c if cp else 35.0,
                "water_requirement_mm": cp.water_requirement_mm if cp else 600.0,
                "avg_input_cost_inr_per_acre": cp.avg_input_cost_inr_per_acre if cp else 15000.0
            }
            reasons = explain_crop_recommendation(cid, rec["crop_name"], soil, weather, budget_per_acre, cp_dict)
            rec["reasons"] = reasons
            
        set_cached_response(cache_key, res)
        return res
    except Exception as e:
        logger.error(f"Crop recommendation failure: {e}")
        raise HTTPException(status_code=400, detail=str(e))

@app.post("/api/crop")
async def post_crop_recommendations_api(req: CropRecQuery):
    """POST wrapper for crop recommendation API checks."""
    return await get_crop_recommendations_api(req)

@app.get("/api/yield")
async def get_yield_prediction_api(q: YieldPredQuery = Depends()):
    """Predicts yield output in kg/acre with 95% confidence intervals and agronomic drivers."""
    # Validated via the YieldPredQuery Pydantic model (irrigation_level bounded
    # 0.0-1.0) instead of a hand-rolled check -- see AUDIT_REPORT.md M-2.
    crop_id, region_id, season, irrigation_level = q.crop_id, q.region_id, q.season, q.irrigation_level
    logger.info(f"Yield prediction request: crop={crop_id}, region={region_id}, irrigation={irrigation_level}")

    cache_key = f"yield_{crop_id}_{region_id}_{season}_{irrigation_level}"
    cached = get_cached_response(cache_key)
    if cached is not None:
        return cached
        
    try:
        from ml.predict import _predict_yield_with_source, _load_weather_by_region, _load_soil_by_region
        weather_data = _load_weather_by_region()
        soil_data = _load_soil_by_region()
        
        wkey = (region_id, season.lower())
        weather = {
            "rainfall_mm": float(weather_data.get(wkey, {}).get("rainfall_mm", 800)),
            "avg_temp_c": float(weather_data.get(wkey, {}).get("avg_temp_c", 28)),
            "min_temp_c": float(weather_data.get(wkey, {}).get("min_temp_c", 20)),
            "max_temp_c": float(weather_data.get(wkey, {}).get("max_temp_c", 35))
        }
        soil = {
            "ph": float(soil_data.get(region_id, {}).get("ph", 7.0)),
            "n_kg_per_acre": float(soil_data.get(region_id, {}).get("n_kg_per_acre", 40)),
            "p_kg_per_acre": float(soil_data.get(region_id, {}).get("p_kg_per_acre", 20)),
            "k_kg_per_acre": float(soil_data.get(region_id, {}).get("k_kg_per_acre", 20)),
            "organic_carbon_percent": float(soil_data.get(region_id, {}).get("organic_carbon_percent", 0.5))
        }
        # FIX (B-15): predict_yield_kg_per_acre() discarded whether ML actually
        # fired for *this* call (it silently falls back to the heuristic
        # formula per-call, e.g. for a crop/region/season combo unseen by the
        # model's encoder) -- so the response below used to hardcode the ML
        # algorithm name even on a heuristic-fallback call. Call the
        # source-reporting variant instead, the same one /api/crop's
        # per-crop scorer already uses (see ml/predict.py's `used_ml_for_yield`
        # in `_score_single_crop`), so this endpoint's "algorithm" claim
        # reflects what actually happened for this specific call.
        yld, used_ml_for_yield = _predict_yield_with_source(
            crop_id, region_id, season, weather, soil, irrigation_level
        )

        # 95% confidence interval: ±1.96 * RMSE, RMSE read live from the
        # yield model's audit report so the band tracks whatever model is
        # actually loaded rather than a number from a past training run.
        rmse = _yield_model_rmse()
        margin = round(1.96 * rmse, 2)
        lower_bound = max(0.0, yld - margin)
        upper_bound = yld + margin
        
        from engine.intelligence_layer import explain_yield_prediction
        explanation = explain_yield_prediction(crop_id, yld, round(lower_bound, 2), round(upper_bound, 2), soil, weather)
        
        res = {
            "predicted_yield_kg_per_acre": round(yld, 2),
            "confidence_interval": {
                "lower_bound": round(lower_bound, 2),
                "upper_bound": round(upper_bound, 2)
            },
            # Honest per-call label instead of a hardcoded claim -- mirrors the
            # prediction_source convention already used by /api/crop,
            # /api/disease/predict, rotation, and optimal-mix (AUDIT_REPORT.md
            # H-11 / B-15).
            "algorithm": "RandomForestRegressor (Tuned)" if used_ml_for_yield else "Heuristic Formula (agronomic calculation)",
            "prediction_source": "ml_model" if used_ml_for_yield else "heuristic",
            "intelligence_report": explanation
        }
        set_cached_response(cache_key, res)
        return res
    except Exception as e:
        logger.error(f"Yield prediction failure: {e}")
        raise HTTPException(status_code=400, detail=str(e))

@app.post("/api/profit")
async def post_profit_estimation_api(req: ProfitEstRequest):
    """Evaluates expected profit returns, input expenses, and ROI."""
    logger.info(f"Profit estimation request: crop={req.crop_id}, yield={req.predicted_yield_kg_per_acre}")
    try:
        from ml.predict import profit_estimator, _load_crop_parameters
        res = profit_estimator(
            crop_id=req.crop_id,
            predicted_yield_kg_per_acre=req.predicted_yield_kg_per_acre,
            area_acres=req.area_acres,
            budget_per_acre=req.budget_per_acre,
            mandi_price_per_kg=req.mandi_price_per_kg
        )
        
        crop_params = _load_crop_parameters()
        cp = crop_params.get(req.crop_id)
        cost = cp.avg_input_cost_inr_per_acre if cp else req.budget_per_acre
        
        from engine.intelligence_layer import explain_profit_prediction
        financials = explain_profit_prediction(req.crop_id, res, cost)
        res["intelligence_report"] = financials
        return res
    except Exception as e:
        logger.error(f"Profit estimation failure: {e}")
        raise HTTPException(status_code=400, detail=str(e))

@app.get("/api/irrigation")
async def get_irrigation_api(q: IrrigationQuery = Depends()):
    """Retrieves week-by-week scheduling parameters and supplemental reasoning."""
    # Validated via the IrrigationQuery Pydantic model (irrigation_level bounded
    # 0.0-1.0, rainfall_mm non-negative) instead of a hand-rolled check -- see
    # AUDIT_REPORT.md M-2.
    crop_id, sowing_date, rainfall_mm, irrigation_level = q.crop_id, q.sowing_date, q.rainfall_mm, q.irrigation_level
    logger.info(f"Irrigation schedule query: crop={crop_id}, rain={rainfall_mm}")
    try:
        schedule = irrigation_schedule(crop_id, sowing_date, rainfall_mm, irrigation_level)
        
        # Integrate Agricultural Intelligence Layer (Phase 5 explainer)
        from engine.intelligence_layer import explain_irrigation
        water_req = schedule.get("total_water_requirement_mm", 1200.0)
        needed = schedule.get("total_irrigation_needed_mm", max(0.0, water_req - rainfall_mm))
        reasons = explain_irrigation(crop_id, water_req, rainfall_mm, needed)
        schedule["reasons"] = reasons
        return schedule
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))

@app.get("/api/fertilizer")
async def get_fertilizer_api(q: FertilizerQuery = Depends()):
    """Computes replenishment dosage based on soil NPK indicators and government guidelines."""
    # Validated via the FertilizerQuery Pydantic model (all NPK values ge=0)
    # instead of a hand-rolled check -- see AUDIT_REPORT.md M-2.
    crop_id, n_kg_per_acre, p_kg_per_acre, k_kg_per_acre = q.crop_id, q.n_kg_per_acre, q.p_kg_per_acre, q.k_kg_per_acre
    logger.info(f"Fertilizer requirements calculation: crop={crop_id}, n={n_kg_per_acre}")
    try:
        rec = fertilizer_recommendation(crop_id, {"n_kg_per_acre": n_kg_per_acre, "p_kg_per_acre": p_kg_per_acre, "k_kg_per_acre": k_kg_per_acre})
        
        # Integrate Agricultural Intelligence Layer (Phase 5 explainer)
        from engine.intelligence_layer import explain_fertilizer
        reasons = explain_fertilizer(crop_id, {"n_kg_per_acre": n_kg_per_acre}, rec.get("deficit_npk", {}))
        rec["reasons"] = reasons
        return rec
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))

@app.get("/api/soil")
async def get_soil_details_api(region_id: str):
    """Retrieves soil attributes mapped to region coordinates."""
    logger.info(f"Soil grids lookup: region={region_id}")
    cache_key = f"soil_grid_{region_id}"
    cached = get_cached_response(cache_key)
    if cached is not None:
        return cached
    try:
        row = _csv_first("soil.csv", "region_id", region_id)
        if not row:
            raise HTTPException(status_code=404, detail="Soil details not found for region")
        res = {
            "region_id": region_id,
            "soil_type": row["soil_type"],
            "ph": float(row["ph"]),
            "n_kg_per_acre": float(row["n_kg_per_acre"]),
            "p_kg_per_acre": float(row["p_kg_per_acre"]),
            "k_kg_per_acre": float(row["k_kg_per_acre"]),
            "organic_carbon_percent": float(row["organic_carbon_percent"]),
            "source": "SoilGrids Cache"
        }
        set_cached_response(cache_key, res)
        return res
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))

@app.get("/api/weather")
async def get_weather_details_api(region_id: str, season: str = "kharif"):
    """Fetches meteorological averages and severe IMD weather alerts."""
    logger.info(f"Weather info request: region={region_id}, season={season}")
    cache_key = f"weather_alert_{region_id}_{season}"
    cached = get_cached_response(cache_key)
    if cached is not None:
        return cached
    try:
        results = _csv_index("weather.csv", "region_id").get(region_id, [])
        if season:
            results = [row for row in results if row["season"] == season]
        if not results:
            raise HTTPException(status_code=404, detail="Weather data not found for region")
        latest_weather = results[-1]
        
        # Integrate severe warning simulation matching fetcher class
        from data_ingestion.fetchers.imd import get_imd_alerts
        parts = region_id.split("_")
        state = parts[0].capitalize()
        district = parts[1].capitalize() if len(parts) > 1 else ""
        alert = get_imd_alerts(state, district)
        
        res = {
            "region_id": region_id,
            "season": season,
            "rainfall_mm": float(latest_weather["rainfall_mm"]),
            "avg_temp_c": float(latest_weather["avg_temp_c"]),
            "min_temp_c": float(latest_weather["min_temp_c"]),
            "max_temp_c": float(latest_weather["max_temp_c"]),
            "imd_alert": alert.get("alert_level", "Green"),
            "imd_warning_message": alert.get("description", "No warning issued")
        }
        set_cached_response(cache_key, res)
        return res
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))

@app.get("/api/market")
async def get_market_pricing_api(region_id: str, crop_id: str):
    """Retrieves current commodity averages and price volatility risks."""
    logger.info(f"Market pricing metrics: region={region_id}, crop={crop_id}")
    cache_key = f"market_{region_id}_{crop_id}"
    cached = get_cached_response(cache_key)
    if cached is not None:
        return cached
    try:
        results = _csv_index("mandi_prices.csv", "region_id").get(region_id, [])
        results = [row for row in results if row["crop_id"] == crop_id]
        
        latest_price = float(results[-1]["price_inr_per_kg"]) if results else 25.0
        prices = [float(r["price_inr_per_kg"]) for r in results]
        volatility = np.std(prices) if len(prices) > 1 else 0.0
        
        forecast_data = price_forecast(region_id, crop_id, months_ahead=6)
        
        res = {
            "region_id": region_id,
            "crop_id": crop_id,
            "current_mandi_price_inr_per_kg": latest_price,
            "volatility_std": round(float(volatility), 2),
            "forecast": forecast_data
        }
        set_cached_response(cache_key, res)
        return res
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))

# ---------------------------------------------------------------------------
# Chatbot
# ---------------------------------------------------------------------------
class ChatRequest(BaseModel):
    message: str
    context: Optional[Dict[str, Any]] = None


@app.post("/api/chat")
async def chat(req: ChatRequest):
    """Site-aware assistant grounded in Mitti Mantra's data + engine."""
    try:
        return chatbot_answer(req.message, req.context or {})
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

# Mount frontend files at /
frontend_dir = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "frontend")
if os.path.exists(frontend_dir):
    from fastapi.responses import FileResponse
    
    @app.api_route("/gyan-seva", methods=["GET"])
    @app.api_route("/book-a-consultation", methods=["GET"])
    @app.api_route("/book-consultation", methods=["GET"])
    async def gyan_seva_route(request: Request):
        return FileResponse(os.path.join(frontend_dir, "gyan-seva.html"))

    @app.api_route("/book-a-tractor", methods=["GET"])
    async def book_a_tractor_route(request: Request):
        return FileResponse(os.path.join(frontend_dir, "book-a-tractor.html"))

    @app.api_route("/dashboard", methods=["GET"])
    async def dashboard_route(request: Request):
        return FileResponse(os.path.join(frontend_dir, "dashboard.html"))

    @app.api_route("/login", methods=["GET"])
    async def login_route(request: Request):
        return FileResponse(os.path.join(frontend_dir, "login.html"))

    @app.api_route("/farm-boundary", methods=["GET"])
    async def farm_boundary_route(request: Request):
        return FileResponse(os.path.join(frontend_dir, "farm-boundary.html"))

    @app.api_route("/marketplace", methods=["GET"])
    async def marketplace_route(request: Request):
        return FileResponse(os.path.join(frontend_dir, "marketplace.html"))

    app.mount("/", StaticFiles(directory=frontend_dir, html=True), name="frontend")

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
