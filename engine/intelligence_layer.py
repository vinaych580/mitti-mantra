import logging
from typing import Dict, Any, List
from utils.calculations import CROP_OPTIMAL_PH

logger = logging.getLogger("IntelligenceLayer")

def explain_crop_recommendation(
    crop_id: str,
    crop_name: str,
    soil: dict,
    weather: dict,
    budget: float,
    cp: dict
) -> List[str]:
    """
    Generates intelligent suitability explanations comparing soil, weather,
    and budgets against specific crop guidelines.
    """
    reasons = []
    
    # 1. Soil pH check
    ph = float(soil.get("ph", 7.0))
    temp_min = float(cp.get("temp_min_c", 15.0))
    temp_max = float(cp.get("temp_max_c", 35.0))
    water_req = float(cp.get("water_requirement_mm", 600.0))
    cost = float(cp.get("avg_input_cost_inr_per_acre", 15000.0))
    
    ph_min, ph_max = CROP_OPTIMAL_PH.get(crop_id.lower(), (6.0, 7.5))
    if ph_min <= ph <= ph_max:
        reasons.append(f"✓ Soil pH ({ph}) is optimal for {crop_name} (prefers {ph_min}--{ph_max}).")
    else:
        reasons.append(f"⚠ Soil pH ({ph}) is sub-optimal but manageable with field liming or gypsum treatment (ideal range is {ph_min}--{ph_max}).")
        
    # 2. Temperature check
    avg_temp = float(weather.get("avg_temp_c", 28.0))
    if temp_min <= avg_temp <= temp_max:
        reasons.append(f"✓ Temperature ({avg_temp}°C) fits within crop limits ({temp_min}°C--{temp_max}°C).")
    else:
        reasons.append(f"⚠ Average temperature ({avg_temp}°C) is outside ideal bounds ({temp_min}°C--{temp_max}°C).")
        
    # 3. Water / Rainfall check
    rain = float(weather.get("rainfall_mm", 800.0))
    if rain >= water_req:
        reasons.append(f"✓ Rainfall ({rain}mm) fully covers crop water requirement ({water_req}mm).")
    else:
        deficit = round(water_req - rain, 1)
        reasons.append(f"⚠ Supplemental irrigation required: {deficit}mm needed (rainfall is {rain}mm vs requirement of {water_req}mm).")

        
    # 4. Budget check
    if budget >= cost:
        reasons.append(f"✓ Budget constraint met: budget ({budget} INR) covers average cost ({cost} INR/acre).")
    else:
        reasons.append(f"⚠ Financial warning: average input cost ({cost} INR/acre) exceeds your budget ({budget} INR).")
        
    # 5. Soil Organic Carbon check
    oc = float(soil.get("organic_carbon_percent", 0.5))
    if oc > 0.75:
        reasons.append(f"✓ Soil Organic Carbon ({oc}%) is high, indicating high organic reserve and soil health.")
    elif oc >= 0.5:
        reasons.append(f"✓ Soil Organic Carbon ({oc}%) is moderate, providing stable baseline fertility.")
    else:
        reasons.append(f"⚠ Soil Organic Carbon ({oc}%) is low, recommending compost and green manure additions.")
        
    return reasons

def explain_yield_prediction(
    crop_id: str,
    yld: float,
    ci_lower: float,
    ci_upper: float,
    soil: dict,
    weather: dict
) -> Dict[str, Any]:
    """
    Decodes yield outputs, listing positive/negative drivers and uncertainty bounds.
    """
    positive_drivers = []
    negative_drivers = []
    
    # Analyze soil nutrients
    n = float(soil.get("n_kg_per_acre", 40.0))
    ph = float(soil.get("ph", 7.0))
    rain = float(weather.get("rainfall_mm", 800.0))
    
    if n > 45.0:
        positive_drivers.append(f"Rich soil Nitrogen ({n} kg/acre) boosts vegetative growth.")
    elif n < 35.0:
        negative_drivers.append(f"Low soil Nitrogen ({n} kg/acre) restricts yield potential.")
        
    from utils.calculations import CROP_OPTIMAL_PH
    ph_min, ph_max = CROP_OPTIMAL_PH.get(crop_id.lower(), (6.0, 7.5))
    if ph_min <= ph <= ph_max:
        positive_drivers.append(f"Optimal soil pH ({ph}) ensures high nutrient availability.")
    else:
        negative_drivers.append(f"Sub-optimal soil pH ({ph}) limits fertilizer uptake efficiency (ideal range is {ph_min}--{ph_max}).")
        
    if rain > 900.0:
        positive_drivers.append(f"High cumulative precipitation ({rain}mm) provides strong water supply.")
    elif rain < 400.0:
        negative_drivers.append(f"Low cumulative precipitation ({rain}mm) limits moisture availability.")
        
    return {
        "predicted_yield_kg_per_acre": yld,
        "uncertainty_range": f"95% confidence bounds: {ci_lower} to {ci_upper} kg/acre",
        "positive_influences": positive_drivers if positive_drivers else ["Soil and weather properties are within stable average bounds."],
        "negative_influences": negative_drivers if negative_drivers else ["No severe environmental stressors detected."],
        "explanation": "Yield predictions are generated via a Random Forest Regressor trained on regional, crop, soil, and weather variables. Standard prediction intervals are calculated from cross-validated residuals."
    }

def explain_profit_prediction(
    crop_id: str,
    profit: dict,
    cost: float
) -> Dict[str, Any]:
    """
    Explains profit breakdown, break-even limits, and return-on-investment risks.
    """
    expected_profit = profit.get("expected_profit", 0.0)
    roi = profit.get("roi_percent", 0.0)
    break_even = profit.get("break_even_price_per_kg", 0.0)
    
    analysis = []
    if expected_profit > 50000.0:
        analysis.append("Highly profitable crop projection under current regional market averages.")
    elif expected_profit > 10000.0:
        analysis.append("Moderate return-on-investment anticipated.")
    else:
        analysis.append("Tight margins: high input costs or low mandi commodity prices restrict margins.")
        
    analysis.append(f"To cover your cost of {cost} INR/acre, you must achieve a minimum sell price of {break_even} INR/kg.")
    
    return {
        "roi_percent": roi,
        "break_even_price_per_kg": break_even,
        "financial_summary": analysis,
        "recommendation": "Retain this crop if market forecasts are stable. Plan input expenditures (seed, fertilizer) carefully to maintain your margins."
    }

def explain_irrigation(
    crop_id: str,
    total_water_req: float,
    rainfall: float,
    needed: float
) -> List[str]:
    """
    Explains the supplemental water requirement and stage priority.
    """
    notes = [
        f"The crop requires {total_water_req}mm of water during its cycle.",
        f"Seasonal precipitation supplies {rainfall}mm of moisture.",
        f"A supplemental deficit of {needed}mm must be supplied via irrigation."
    ]
    if needed > 300.0:
        notes.append("High irrigation demand: ensure stable tubewell or canal access prior to planting.")
    else:
        notes.append("Low supplemental irrigation required; crop water needs are mostly met by seasonal rains.")
        
    return notes

def explain_fertilizer(
    crop_id: str,
    soil: dict,
    deficit: dict
) -> List[str]:
    """
    Explains soil nutrient deficiencies and suggests commercial fertilizer applications.
    """
    guidelines = []
    n_def = deficit.get("n", 0.0)
    p_def = deficit.get("p", 0.0)
    k_def = deficit.get("k", 0.0)
    
    if n_def > 0:
        guidelines.append(f"Apply nitrogenous fertilizers (e.g. Urea) split-dressed over the vegetative tillering and panicle initiation phases to prevent leaching.")
    if p_def > 0:
        guidelines.append(f"Apply phosphatic fertilizers (e.g. DAP) basal (at sowing) to encourage root development.")
    if k_def > 0:
        guidelines.append(f"Apply potassic fertilizers (e.g. MOP) to improve crop disease resistance and grain size.")
        
    if not guidelines:
        guidelines.append("Current soil NPK meets or exceeds crop requirements. No corrective chemical fertilizer needed.")
        
    return guidelines
