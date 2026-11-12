from __future__ import annotations

from dataclasses import dataclass
from typing import Any


def clamp(value: float, low: float, high: float) -> float:
    return max(low, min(high, value))


@dataclass
class CropParameter:
    crop_id: str
    crop_name: str
    season: str
    base_yield_kg_per_acre: float
    water_requirement_mm: float
    temp_min_c: float
    temp_max_c: float
    avg_input_cost_inr_per_acre: float
    mandi_price_min_inr_per_kg: float
    mandi_price_max_inr_per_kg: float
    npk_n_kg_per_acre: float
    npk_p_kg_per_acre: float
    npk_k_kg_per_acre: float


CROP_OPTIMAL_PH = {
    "rice": (5.5, 7.0),
    "wheat": (6.0, 7.5),
    "maize": (5.8, 7.2),
    "sugarcane": (6.0, 7.5),
    "cotton": (6.0, 8.0),
    "pulses": (6.0, 7.2),
    "groundnut": (5.5, 6.5),
    "soybean": (6.0, 7.0),
}


def calculate_soil_factor(soil: dict[str, Any], crop: CropParameter) -> float:
    ph = float(soil.get("ph", 7.0))
    n = float(soil.get("n_kg_per_acre", soil.get("n", 40.0)))
    p = float(soil.get("p_kg_per_acre", soil.get("p", 20.0)))
    k = float(soil.get("k_kg_per_acre", soil.get("k", 20.0)))

    ph_min, ph_max = CROP_OPTIMAL_PH.get(crop.crop_id.lower(), (6.0, 7.5))
    if ph < ph_min:
        ph_gap = ph_min - ph
    elif ph > ph_max:
        ph_gap = ph - ph_max
    else:
        ph_gap = 0.0

    ph_score = 1.0 - min(ph_gap * 0.12, 0.35)

    # Use crop-specific NPK requirements instead of hardcoded divisors
    n_ratio = n / max(crop.npk_n_kg_per_acre, 1.0)
    p_ratio = p / max(crop.npk_p_kg_per_acre, 1.0)
    k_ratio = k / max(crop.npk_k_kg_per_acre, 1.0)

    nutrient_score = clamp((n_ratio + p_ratio + k_ratio) / 3.0, 0.6, 1.3)
    return clamp(ph_score * nutrient_score, 0.55, 1.3)


def calculate_climate_factor(weather: dict[str, float], crop: CropParameter) -> float:
    """Rain and temperature fit of a crop, 0.05 (severe mismatch) to 1.25.

    A caller that already knows the water the crop receives -- an irrigated
    season, where rain is not the source -- passes `water_supply_mm` and it
    is scored in place of the season's rainfall.

    This is a suitability score (does the crop belong in this climate), not
    a yield response to a change in rain; for that see
    `water_response_factor`.
    """
    if "water_supply_mm" in weather:
        rainfall = float(weather["water_supply_mm"])
    else:
        rainfall = weather.get("rainfall_mm", crop.water_requirement_mm)
    temp = weather.get("avg_temp_c", (crop.temp_min_c + crop.temp_max_c) / 2.0)

    optimal_rainfall = crop.water_requirement_mm

    if temp < crop.temp_min_c:
        temp_gap = (crop.temp_min_c - temp) / max(crop.temp_min_c, 1.0)
    elif temp > crop.temp_max_c:
        temp_gap = (temp - crop.temp_max_c) / max(crop.temp_max_c, 1.0)
    else:
        temp_gap = 0.0

    rainfall_gap = abs(rainfall - optimal_rainfall) / max(optimal_rainfall, 1.0)

    # Allow climate factor to drop to 0.1 for severe mismatches (e.g. pulses in 2200mm rainfall)
    rainfall_score = clamp(1.0 - 0.9 * rainfall_gap, 0.1, 1.2)
    temp_score = clamp(1.0 - 0.9 * temp_gap, 0.1, 1.15)

    return clamp(rainfall_score * temp_score, 0.05, 1.25)


def calculate_yield_kg_per_acre(
    crop: CropParameter,
    soil: dict[str, float],
    weather: dict[str, float],
    irrigation_level: float = 0.5,
    seed_variety: str | None = None,
    sowing_date: str | None = None,
) -> float:
    soil_factor = calculate_soil_factor(soil, crop)
    climate_factor = calculate_climate_factor(weather, crop)

    irrigation_factor = clamp(0.7 + (0.5 * irrigation_level), 0.7, 1.2)

    # Variety factor: simple placeholder logic as per requirement
    variety_factor = 1.0
    if seed_variety:
        v = seed_variety.lower()
        if any(term in v for term in ["hybrid", "high-yield", "hyv", "premium"]):
            variety_factor = 1.15
        elif any(term in v for term in ["local", "traditional", "desi"]):
            variety_factor = 0.9

    # Sowing date factor: penalize late/early sowing relative to ideal window
    date_factor = 1.0
    if sowing_date:
        try:
            month = int(sowing_date.split("-")[1])
            season = crop.season.lower()
            if "kharif" in season:
                ideal_months = {6, 7}
            elif "rabi" in season:
                ideal_months = {10, 11}
            else:
                ideal_months = set(range(1, 13))
            if ideal_months and month not in ideal_months:
                # Circular month distance calculation
                gap = min(min(abs(month - m), 12 - abs(month - m)) for m in ideal_months)
                date_factor = clamp(1.0 - gap * 0.06, 0.75, 1.0)
        except (ValueError, IndexError):
            date_factor = 1.0

    return round(crop.base_yield_kg_per_acre * soil_factor * climate_factor * irrigation_factor * variety_factor * date_factor, 2)


def effective_rainfall_mm(seasonal_rainfall_mm: float, months: int = 4) -> float:
    """The part of a season's rain a crop can actually use, in mm.

    Uses the USDA Soil Conservation Service method as applied by FAO's
    CROPWAT (FAO Irrigation and Drainage Paper 56 practice): per month,
    Peff = P(125 - 0.2P)/125 when P <= 250 mm, else 125 + 0.1P. The rest
    runs off or drains below the roots. weather.csv carries seasonal totals,
    so the total is spread evenly over `months` -- four by default, the
    length of the kharif monsoon (June-September) and of a typical
    120-day field-crop season.
    """
    total = max(float(seasonal_rainfall_mm), 0.0)
    if total == 0.0 or months <= 0:
        return 0.0
    p = total / months
    per_month = p * (125.0 - 0.2 * p) / 125.0 if p <= 250.0 else 125.0 + 0.1 * p
    return per_month * months


#: Seasonal yield response factors (Ky) from FAO Irrigation and Drainage
#: Paper 33 (Doorenbos & Kassam, 1979), Table 1, total growing period:
#: relative yield loss = Ky x relative evapotranspiration deficit. Crops the
#: table does not list use DEFAULT_KY.
CROP_YIELD_RESPONSE_KY = {
    "maize": 1.25, "cotton": 0.85, "groundnut": 0.70, "soybean": 0.85,
    "wheat": 1.05, "sugarcane": 1.20, "sunflower": 0.95, "jowar": 0.90,
    "potato": 1.10, "onion": 1.10, "tomato": 1.05, "banana": 1.20,
    "watermelon": 1.10, "chilli": 1.10, "pulses": 1.15,
}
DEFAULT_KY = 1.0


def seasonal_water_supply_mm(
    crop: CropParameter, seasonal_rainfall_mm: float, irrigation_level: float,
) -> float:
    """Water reaching the crop: effective rain plus irrigation of the shortfall.

    `irrigation_level` (0-1) is the share of the remaining shortfall that
    irrigation can cover, the meaning the planner's control already has.
    """
    need = max(crop.water_requirement_mm, 1.0)
    rain = effective_rainfall_mm(seasonal_rainfall_mm)
    shortfall = max(need - rain, 0.0)
    return rain + clamp(irrigation_level, 0.0, 1.0) * shortfall


def water_response_factor(
    crop: CropParameter, seasonal_rainfall_mm: float, irrigation_level: float,
) -> float:
    """Relative yield (0-1) from water supply, by FAO-33: 1 - Ky(1 - supply/need).

    Only a deficit lowers yield; rain beyond the need is runoff here
    (waterlogging is the flood term of the risk score, not this). So less
    rain never raises yield and more irrigation never lowers it -- the
    behaviour the season planner's controls lacked (defects N-1, N-2).
    """
    need = max(crop.water_requirement_mm, 1.0)
    supply = seasonal_water_supply_mm(crop, seasonal_rainfall_mm, irrigation_level)
    ky = CROP_YIELD_RESPONSE_KY.get(crop.crop_id, DEFAULT_KY)
    deficit = clamp(1.0 - supply / need, 0.0, 1.0)
    return clamp(1.0 - ky * deficit, 0.0, 1.0)


def calculate_risk_score_and_subscores(
    crop: CropParameter,
    weather: dict[str, float],
    soil: dict[str, float],
    irrigation_level: float = 0.5,
) -> tuple[float, dict[str, float]]:
    rainfall = weather.get("rainfall_mm", crop.water_requirement_mm)
    avg_temp = weather.get("avg_temp_c", (crop.temp_min_c + crop.temp_max_c) / 2.0)

    # Drought and waterlogging are judged on the rain the crop can use, not
    # the season's total. Comparing the raw total with a crop's water need
    # read every normal monsoon as a flood for crops that need little water:
    # Sehore's 1,209 mm kharif gave soybean -- the district's main kharif
    # crop -- a 95% flood risk, and jute (1,400 mm need, grown in Bengal, not
    # Madhya Pradesh) none at all, so jute topped kharif recommendations in
    # 19 of 30 districts. A crop missing its rain is a drought; more usable
    # rain than it needs means a saturated root zone.
    usable = effective_rainfall_mm(rainfall) if "rainfall_mm" in weather else rainfall

    drought = clamp(
        (crop.water_requirement_mm - usable) / max(crop.water_requirement_mm, 1.0) * 100.0,
        0.0, 100.0,
    )
    # Irrigation mitigates drought risk
    drought = clamp(drought - (25.0 * irrigation_level), 5.0, 95.0)

    flood = clamp((usable - crop.water_requirement_mm) / max(crop.water_requirement_mm, 1.0) * 100.0, 0.0, 95.0)

    # Temperature / Heat / Cold stress risk
    if avg_temp > crop.temp_max_c:
        temp_stress = (avg_temp - crop.temp_max_c) * 4.0
    elif avg_temp < crop.temp_min_c:
        temp_stress = (crop.temp_min_c - avg_temp) * 4.0
    else:
        temp_stress = 0.0
    heat = clamp(10.0 + temp_stress, 5.0, 95.0)

    # Price volatility
    price_vol = clamp(
        (crop.mandi_price_max_inr_per_kg - crop.mandi_price_min_inr_per_kg)
        / max(crop.mandi_price_min_inr_per_kg, 1.0) * 35.0,
        0.0, 95.0,
    )

    risk_subscores = {
        "drought": round(drought, 2),
        "heat": round(heat, 2),
        "flood": round(flood, 2),
        "price_volatility": round(price_vol, 2),
    }

    # Unified weightage: Agronomic bottleneck (weakest link) - max risk dominates total risk
    max_climatic_risk = max(drought, heat, flood)
    mean_climatic_risk = (drought + heat + flood) / 3.0
    risk_score = (0.50 * max_climatic_risk) + (0.30 * mean_climatic_risk) + (0.20 * price_vol)

    return round(risk_score, 2), risk_subscores


def calculate_ndvi_and_field_health(
    lat: float,
    lon: float,
    crop_id: str = "wheat",
    area_acres: float = 4.0,
) -> dict[str, Any]:
    """Return a deterministic planning estimate when imagery is unavailable.

    This is deliberately not presented as a satellite observation. A real
    imagery integration must replace this estimator before it is used for
    agronomic decisions.
    """
    # Deterministic pseudo-random seed based on lat/lon
    seed = int(abs(lat * 1000 + lon * 100)) % 1000
    base_ndvi = 0.52 + ((seed % 35) / 100.0)  # 0.52 - 0.87
    base_ndvi = clamp(base_ndvi, 0.25, 0.90)

    if base_ndvi >= 0.70:
        health_status = "Vibrant Healthy Canopy"
    elif base_ndvi >= 0.50:
        health_status = "Moderate Stress / Normal Growth"
    else:
        health_status = "High Stress / Moisture Deficit"

    canopy_cover_pct = clamp(base_ndvi * 115.0, 15.0, 98.0)

    grid = []
    for r in range(5):
        for c in range(5):
            # Variance per sub-grid cell
            cell_seed = (seed + r * 7 + c * 13) % 100
            var = (cell_seed - 50) / 300.0  # -0.16 to +0.16
            cell_ndvi = round(clamp(base_ndvi + var, 0.15, 0.95), 2)

            if cell_ndvi >= 0.65:
                status = "Optimal"
                color = "#2e7d32"  # deep green
            elif cell_ndvi >= 0.45:
                status = "Mild Stress"
                color = "#f57c00"  # orange
            else:
                status = "High Stress"
                color = "#d32f2f"  # red

            grid.append({
                "row": r,
                "col": c,
                "sub_cell_id": f"Grid-{r+1}x{c+1}",
                "ndvi": cell_ndvi,
                "status": status,
                "color": color,
            })

    return {
        "lat": round(lat, 5),
        "lon": round(lon, 5),
        "crop_id": crop_id,
        "area_acres": area_acres,
        "mean_ndvi": round(base_ndvi, 2),
        "health_status": health_status,
        "canopy_cover_pct": round(canopy_cover_pct, 1),
        "satellite_source": "Coordinate-based planning estimate (not satellite imagery)",
        "is_estimate": True,
        "last_updated": None,
        "sub_field_grid": grid,
    }


# ---------------------------------------------------------------------------
# Region display names
# ---------------------------------------------------------------------------
#: State/UT abbreviations that must stay upper-case when a region_id is turned
#: into a label. Without this, `"mp_sehore".title()` yields "Mp · Sehore".
_STATE_ABBR = {
    "mp", "up", "tn", "mh", "kar", "guj", "pb", "ap", "tg", "ka",
    "wb", "or", "jk", "hp", "uk",
}


def region_display_name(region_id: str) -> str:
    """Turn a region_id into a human label: `mp_sehore` -> `MP · Sehore`.

    Three copies of this transform used to exist -- one in the /api/regions
    handler (correct) and two inline `region.replace('_', ' · ').title()`
    expressions in the chatbot, which rendered "Mp · Sehore" and "Up · Lucknow"
    for most of the catalogue while the dropdowns beside them said "MP · Sehore".
    """
    if not region_id:
        return ""
    parts = str(region_id).split("_")
    return " · ".join(p.upper() if p.lower() in _STATE_ABBR else p.capitalize() for p in parts)


def compute_budget_fit(budget_per_acre: float, avg_input_cost_inr_per_acre: float) -> float:
    """The budget-adequacy term `compute_smart_score` blends in, shared by
    `ml/predict.py::_score_single_crop` and `ml/dataset_builders.py`'s
    recommendation label generator so they can never drift apart (see
    docs/superpowers/specs/2026-09-06-ml-model-accuracy-design.md).
    """
    return clamp((budget_per_acre / max(avg_input_cost_inr_per_acre, 1.0)) * 100.0, 0.0, 120.0)


def compute_roi_normalized(roi_percent: float) -> float:
    """The ROI term `compute_smart_score` blends in -- see `compute_budget_fit`."""
    return clamp(roi_percent / 3.0, 0.0, 100.0)


def compute_soil_health(
    n_kg_per_acre: float,
    p_kg_per_acre: float,
    k_kg_per_acre: float,
    npk_n_kg_per_acre: float,
    npk_p_kg_per_acre: float,
    npk_k_kg_per_acre: float,
) -> float:
    """The N/P/K-ratio soil term `compute_smart_score` blends in -- see
    `compute_budget_fit`.
    """
    n_ratio = n_kg_per_acre / max(npk_n_kg_per_acre, 1.0)
    p_ratio = p_kg_per_acre / max(npk_p_kg_per_acre, 1.0)
    k_ratio = k_kg_per_acre / max(npk_k_kg_per_acre, 1.0)
    return clamp(((n_ratio + p_ratio + k_ratio) / 3.0) * 100.0, 0.0, 120.0)


def compute_smart_score(
    roi_normalized: float,
    confidence_score: float,
    budget_fit: float,
    soil_health: float,
    ml_term: float,
    saturation_penalty: float = 0.0,
) -> float:
    """The weighted blend `ml/predict.py::_score_single_crop` uses to rank a
    crop for a farmer's request, and `ml/dataset_builders.py` uses to label
    what "best crop" means for training -- extracted here so both call
    sites can never drift apart the way they had (see
    docs/superpowers/specs/2026-09-06-ml-model-accuracy-design.md).
    """
    return clamp(
        0.35 * roi_normalized
        + 0.20 * confidence_score
        + 0.15 * budget_fit
        + 0.15 * soil_health
        + 0.15 * ml_term
        - saturation_penalty * 0.25,
        0.0,
        100.0,
    )
