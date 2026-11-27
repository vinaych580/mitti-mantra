"""
engine/features.py
All 14 new feature implementations for AgriSim.
"""
from __future__ import annotations

import csv
import math
from datetime import datetime, timedelta
from pathlib import Path
from statistics import mean
from typing import Any

from utils.calculations import CropParameter, clamp

DATASET_DIR = Path(__file__).resolve().parents[1] / "dataset"

# ---------------------------------------------------------------------------
# Shared CSV loader
# ---------------------------------------------------------------------------

def _load_csv(file_name: str) -> list[dict[str, str]]:
    # Delegate to the shared mtime-aware cache so every CSV is parsed at most
    # once per change, and pre-built indexes are reused across callers.
    from utils.csv_cache import load as _cached_load
    return _cached_load(file_name)


_crop_params_cache: dict[str, CropParameter] | None = None


def _load_crop_params() -> dict[str, CropParameter]:
    global _crop_params_cache
    if _crop_params_cache is not None:
        return _crop_params_cache

    rows = _load_csv("crop_parameters.csv")
    data: dict[str, CropParameter] = {}
    for row in rows:
        cid = row["crop_id"]
        data[cid] = CropParameter(
            crop_id=cid,
            crop_name=row["crop_name"],
            season=row["season"].lower(),
            base_yield_kg_per_acre=float(row["base_yield_kg_per_acre"]),
            water_requirement_mm=float(row["water_requirement_mm"]),
            temp_min_c=float(row["temp_min_c"]),
            temp_max_c=float(row["temp_max_c"]),
            avg_input_cost_inr_per_acre=float(row["avg_input_cost_inr_per_acre"]),
            mandi_price_min_inr_per_kg=float(row["mandi_price_min_inr_per_kg"]),
            mandi_price_max_inr_per_kg=float(row["mandi_price_max_inr_per_kg"]),
            npk_n_kg_per_acre=float(row["npk_n_kg_per_acre"]),
            npk_p_kg_per_acre=float(row["npk_p_kg_per_acre"]),
            npk_k_kg_per_acre=float(row["npk_k_kg_per_acre"]),
        )
    _crop_params_cache = data
    return data


# ===========================================================================
# 1. Fertilizer Recommendation Engine
# ===========================================================================

# Common Indian fertilizers with their NPK content (kg nutrient per 50 kg bag)
FERTILIZER_DB = [
    {"name": "Urea", "grade": "46-0-0", "n_pct": 46, "p_pct": 0, "k_pct": 0, "cost_per_kg": 5.36},
    {"name": "DAP", "grade": "18-46-0", "n_pct": 18, "p_pct": 46, "k_pct": 0, "cost_per_kg": 27.0},
    {"name": "MOP (Muriate of Potash)", "grade": "0-0-60", "n_pct": 0, "p_pct": 0, "k_pct": 60, "cost_per_kg": 17.0},
    {"name": "NPK Complex 10-26-26", "grade": "10-26-26", "n_pct": 10, "p_pct": 26, "k_pct": 26, "cost_per_kg": 24.0},
    {"name": "SSP (Single Super Phosphate)", "grade": "0-16-0", "n_pct": 0, "p_pct": 16, "k_pct": 0, "cost_per_kg": 8.0},
    {"name": "Ammonium Sulphate", "grade": "20.6-0-0", "n_pct": 20.6, "p_pct": 0, "k_pct": 0, "cost_per_kg": 10.0},
]


def fertilizer_recommendation(
    crop_id: str,
    soil: dict[str, Any],
) -> dict[str, Any]:
    """Given crop nutrient needs and soil supply, recommend specific fertilizers + quantities."""
    crop_params = _load_crop_params()
    if crop_id not in crop_params:
        raise ValueError(f"Unknown crop_id: {crop_id}")
    crop = crop_params[crop_id]

    n_soil = float(soil.get("n_kg_per_acre", 0))
    p_soil = float(soil.get("p_kg_per_acre", 0))
    k_soil = float(soil.get("k_kg_per_acre", 0))

    n_deficit = max(crop.npk_n_kg_per_acre - n_soil, 0)
    p_deficit = max(crop.npk_p_kg_per_acre - p_soil, 0)
    k_deficit = max(crop.npk_k_kg_per_acre - k_soil, 0)

    recommendations = []
    total_cost = 0.0

    FERTILIZER_PRICES = {
        "DAP": next((f["cost_per_kg"] for f in FERTILIZER_DB if "DAP" in f["name"]), 27.0),
        "Urea": next((f["cost_per_kg"] for f in FERTILIZER_DB if "Urea" in f["name"]), 5.36),
        "MOP": next((f["cost_per_kg"] for f in FERTILIZER_DB if "MOP" in f["name"]), 17.0),
    }

    # P first via DAP (also supplies some N)
    n_remaining = n_deficit
    if p_deficit > 0:
        dap_kg = p_deficit / 0.46  # 46% P2O5
        dap_n_supplied = dap_kg * 0.18
        n_remaining = max(n_remaining - dap_n_supplied, 0)
        cost = round(dap_kg * FERTILIZER_PRICES["DAP"], 2)
        total_cost += cost
        recommendations.append({
            "fertilizer": "DAP (Di-Ammonium Phosphate)",
            "grade": "18-46-0",
            "quantity_kg_per_acre": round(dap_kg, 2),
            "nutrient_supplied": f"N={round(dap_n_supplied, 1)}kg, P={round(p_deficit, 1)}kg",
            "cost_inr": cost,
            "application_timing": "Basal (at sowing)",
        })

    # N via Urea
    if n_remaining > 0:
        urea_kg = n_remaining / 0.46
        cost = round(urea_kg * FERTILIZER_PRICES["Urea"], 2)
        total_cost += cost
        split_1 = round(urea_kg * 0.5, 2)
        split_2 = round(urea_kg * 0.3, 2)
        split_3 = round(urea_kg * 0.2, 2)
        recommendations.append({
            "fertilizer": "Urea",
            "grade": "46-0-0",
            "quantity_kg_per_acre": round(urea_kg, 2),
            "nutrient_supplied": f"N={round(n_remaining, 1)}kg",
            "cost_inr": cost,
            "application_timing": f"Split: {split_1}kg basal + {split_2}kg at 25-30 DAS + {split_3}kg at 45-50 DAS",
        })

    # K via MOP
    if k_deficit > 0:
        mop_kg = k_deficit / 0.60
        cost = round(mop_kg * FERTILIZER_PRICES["MOP"], 2)
        total_cost += cost
        recommendations.append({
            "fertilizer": "MOP (Muriate of Potash)",
            "grade": "0-0-60",
            "quantity_kg_per_acre": round(mop_kg, 2),
            "nutrient_supplied": f"K={round(k_deficit, 1)}kg",
            "cost_inr": cost,
            "application_timing": "Basal (at sowing)",
        })

    return {
        "crop_id": crop_id,
        "crop_name": crop.crop_name,
        "soil_npk": {"n": n_soil, "p": p_soil, "k": k_soil},
        "crop_requirement_npk": {
            "n": crop.npk_n_kg_per_acre,
            "p": crop.npk_p_kg_per_acre,
            "k": crop.npk_k_kg_per_acre,
        },
        "deficit_npk": {"n": round(n_deficit, 2), "p": round(p_deficit, 2), "k": round(k_deficit, 2)},
        "recommendations": recommendations,
        "total_fertilizer_cost_per_acre": round(total_cost, 2),
        "note": "Quantities are for deficit correction only. Actual dose may vary based on soil test report and local advisory.",
    }


# ===========================================================================
# 2. MSP Database
# ===========================================================================

def get_msp_data(crop_id: str | None = None, year: int | None = None) -> list[dict[str, Any]]:
    rows = _load_csv("msp_prices.csv")
    results = []
    for r in rows:
        if crop_id and r["crop_id"] != crop_id:
            continue
        if year and int(r["year"]) != year:
            continue
        results.append({
            "crop_id": r["crop_id"],
            "crop_name": r["crop_name"],
            "year": int(r["year"]),
            "season": r["season"],
            "msp_inr_per_quintal": float(r["msp_inr_per_quintal"]),
            "msp_inr_per_kg": float(r["msp_inr_per_kg"]),
        })
    return results


def msp_vs_market(region_id: str, crop_id: str) -> dict[str, Any]:
    """Compare current MSP with recent mandi prices."""
    msp_rows = get_msp_data(crop_id)
    if not msp_rows:
        raise ValueError(f"No MSP data for {crop_id}")
    latest_msp = sorted(msp_rows, key=lambda x: x["year"], reverse=True)[0]

    mandi_rows = _load_csv("mandi_prices.csv")
    prices = [float(r["price_inr_per_kg"]) for r in mandi_rows
              if r["region_id"] == region_id and r["crop_id"] == crop_id]
    if not prices:
        raise ValueError(f"No mandi price data for {crop_id} in {region_id}")

    current_mandi = prices[-1]
    avg_mandi = mean(prices[-6:]) if len(prices) >= 6 else mean(prices)
    msp = latest_msp["msp_inr_per_kg"]

    return {
        "crop_id": crop_id,
        "msp_year": latest_msp["year"],
        "msp_inr_per_kg": msp,
        "current_mandi_price": current_mandi,
        "avg_mandi_6m": round(avg_mandi, 2),
        "mandi_above_msp": current_mandi > msp,
        "mandi_msp_gap_pct": round((current_mandi - msp) / msp * 100, 2),
        "recommendation": (
            "Market price is above MSP. Sell in open market for better returns."
            if current_mandi > msp
            else "Market price is below MSP. Consider selling to government procurement agencies at MSP."
        ),
    }


# ===========================================================================
# 3. Best Time to Sell Advisor
# ===========================================================================

class NotFoundError(ValueError):
    """An id in the request names nothing we have data for (maps to HTTP 404)."""


#: A price series whose newest row is older than this is stale (defect N-9).
PRICE_STALE_AFTER_DAYS = 90


def _price_rows(region_id: str, crop_id: str) -> list[dict[str, Any]]:
    """Sorted price history for one region/crop; unknown ids raise NotFoundError."""
    rows = _load_csv("mandi_prices.csv")
    if crop_id not in _load_crop_params():
        raise NotFoundError(f"crop_id: unknown crop '{crop_id}'")
    if not any(r["region_id"] == region_id for r in rows):
        raise NotFoundError(f"region_id: no mandi prices for region '{region_id}'")
    return sorted(
        [{"date": r["date"], "price": float(r["price_inr_per_kg"])}
         for r in rows if r["region_id"] == region_id and r["crop_id"] == crop_id],
        key=lambda x: x["date"],
    )


def price_freshness(last_date: str, today: datetime | None = None) -> dict[str, Any]:
    """`data_through`, its age in days and whether that is stale."""
    today = today or datetime.now()
    try:
        age = (today - datetime.strptime(last_date[:10], "%Y-%m-%d")).days
    except ValueError:
        return {"data_through": last_date, "data_age_days": None, "stale": True}
    return {"data_through": last_date, "data_age_days": age, "stale": age > PRICE_STALE_AFTER_DAYS}


def best_time_to_sell(region_id: str, crop_id: str) -> dict[str, Any]:
    """Analyze seasonal price patterns and recommend hold vs sell.

    The "current price" is the newest row in the dataset. When that row is
    stale the response says so (`stale`, `data_through`) instead of passing a
    year-old price off as today's.
    """
    prices = _price_rows(region_id, crop_id)
    if len(prices) < 6:
        raise ValueError(f"Insufficient price history for {crop_id} in {region_id}")

    prices.sort(key=lambda x: x["date"])
    current_price = prices[-1]["price"]

    # Monthly averages
    monthly: dict[int, list[float]] = {}
    for p in prices:
        try:
            m = int(p["date"].split("-")[1])
            monthly.setdefault(m, []).append(p["price"])
        except (ValueError, IndexError):
            pass

    monthly_avg = {m: round(mean(v), 2) for m, v in sorted(monthly.items())}
    if not monthly_avg:
        raise ValueError("Could not parse monthly patterns")

    best_month = max(monthly_avg, key=monthly_avg.get)
    worst_month = min(monthly_avg, key=monthly_avg.get)
    best_price = monthly_avg[best_month]
    current_month = datetime.now().month

    # Compute potential gain if held until best month
    potential_gain_pct = round((best_price - current_price) / max(current_price, 1) * 100, 2)

    # Trend of last 3 prices
    recent_3 = [p["price"] for p in prices[-3:]]
    trend = "rising" if recent_3[-1] > recent_3[0] else ("falling" if recent_3[-1] < recent_3[0] else "flat")

    # Decision. A hold is only offered for as long as the crop keeps without cold
    # storage (engine/storability.py): "hold tomato until month 5" is advice to let
    # it rot.
    from engine.storability import max_storage_weeks
    keeps = max_storage_weeks(crop_id)
    months_to_best = (best_month - current_month) % 12
    can_wait = (lambda weeks: keeps is None or weeks <= keeps)
    if keeps is not None and keeps < 2 and months_to_best != 0:
        advice = (f"SELL NOW — {crop_id} keeps only about {keeps} week(s) without cold storage, "
                  "so holding for a better month is not an option." if keeps else
                  f"SELL NOW — {crop_id} must be sold within days of harvest.")
        action = "sell"
    elif months_to_best == 0:
        advice = "SELL NOW — Current month historically has the best prices."
        action = "sell"
    elif potential_gain_pct > 10 and months_to_best <= 4 and can_wait(months_to_best * 4.35):
        advice = f"HOLD — Prices typically peak in month {best_month} ({potential_gain_pct}% higher). Consider storing and selling then."
        action = "hold"
    elif trend == "rising":
        advice = "HOLD SHORT-TERM — Prices are currently rising. Monitor weekly and sell when trend reverses."
        action = "hold_short"
    elif current_price >= best_price * 0.95:
        advice = "SELL NOW — Current price is within 5% of historical peak. Good time to sell."
        action = "sell"
    elif can_wait(months_to_best * 4.35):
        advice = f"SELL GRADUALLY — No strong signal. Sell 50% now and hold 50% for month {best_month}."
        action = "partial_sell"
    else:
        advice = (f"SELL NOW — Prices typically peak in month {best_month}, but {crop_id} keeps only about "
                  f"{keeps} weeks without cold storage.")
        action = "sell"

    return {
        "crop_id": crop_id,
        "region_id": region_id,
        "current_price": current_price,
        "current_month": current_month,
        "best_month": best_month,
        "best_month_avg_price": best_price,
        "worst_month": worst_month,
        "worst_month_avg_price": monthly_avg[worst_month],
        "potential_gain_pct": potential_gain_pct,
        "recent_trend": trend,
        "months_to_peak": months_to_best,
        "action": action,
        "advice": advice,
        "max_storage_weeks": keeps,
        "monthly_avg_prices": monthly_avg,
        **price_freshness(prices[-1]["date"]),
    }


# ===========================================================================
# 4. Irrigation Scheduler
# ===========================================================================

# Growing duration in days (approximate) per crop
CROP_DURATION_DAYS = {
    "rice": 120, "wheat": 130, "maize": 100, "sugarcane": 300,
    "cotton": 180, "pulses": 110, "groundnut": 110, "soybean": 100,
}

# Critical water demand stages (fraction of season, relative water need multiplier)
CROP_WATER_STAGES = {
    "rice": [(0.0, 0.2, 1.0, "Nursery/Transplanting"), (0.2, 0.5, 1.3, "Tillering"), (0.5, 0.75, 1.5, "Flowering/Grain fill"), (0.75, 1.0, 0.7, "Maturity")],
    "wheat": [(0.0, 0.15, 0.8, "Crown Root Initiation"), (0.15, 0.35, 1.0, "Tillering"), (0.35, 0.6, 1.4, "Heading/Flowering"), (0.6, 0.85, 1.2, "Grain Fill"), (0.85, 1.0, 0.5, "Maturity")],
    "maize": [(0.0, 0.2, 0.7, "Seedling"), (0.2, 0.45, 1.0, "Knee-high"), (0.45, 0.7, 1.5, "Tasseling/Silking"), (0.7, 1.0, 0.8, "Grain Fill")],
    "sugarcane": [(0.0, 0.1, 0.6, "Germination"), (0.1, 0.3, 1.0, "Tillering"), (0.3, 0.7, 1.4, "Grand Growth"), (0.7, 1.0, 0.7, "Maturity")],
    "cotton": [(0.0, 0.15, 0.6, "Seedling"), (0.15, 0.4, 1.0, "Vegetative"), (0.4, 0.7, 1.4, "Flowering/Boll"), (0.7, 1.0, 0.8, "Boll Opening")],
    "pulses": [(0.0, 0.2, 0.7, "Seedling"), (0.2, 0.5, 1.0, "Vegetative"), (0.5, 0.8, 1.3, "Flowering/Podding"), (0.8, 1.0, 0.6, "Maturity")],
    "groundnut": [(0.0, 0.2, 0.7, "Seedling"), (0.2, 0.45, 1.0, "Vegetative"), (0.45, 0.7, 1.4, "Pegging/Pod Fill"), (0.7, 1.0, 0.7, "Maturity")],
    "soybean": [(0.0, 0.2, 0.7, "Seedling"), (0.2, 0.5, 1.0, "Vegetative"), (0.5, 0.75, 1.4, "Flowering/Pod Fill"), (0.75, 1.0, 0.6, "Maturity")],
}


#: Sowing-window start by season, for crops without a hand-written calendar.
_SEASON_SOWING_START = {"kharif": (6, 15), "rabi": (11, 1), "zaid": (2, 15)}


def _sowing_window_starts(crop_id: str, crop_season: str) -> list[tuple[int, int]]:
    """(month, day) each season's sowing window opens for this crop."""
    starts = []
    for cal in CROP_CALENDAR.get(crop_id, {}).values():
        window = str(cal.get("sowing_transplant", ""))
        try:
            opened = datetime.strptime(window.split("-")[0].strip(), "%b %d")
            starts.append((opened.month, opened.day))
        except ValueError:
            continue
    if not starts:
        lowered = (crop_season or "").lower()
        starts = [md for season, md in _SEASON_SOWING_START.items() if season in lowered]
    return starts or [_SEASON_SOWING_START["kharif"]]


def default_sowing_date(crop_id: str, today: datetime | None = None) -> str:
    """The crop's next calendar sowing date: this year's if not yet past, else next year's.

    Replaces a literal 2025-06-15 that the irrigation schedule used for every
    crop and every year (defect N-17).
    """
    crop_params = _load_crop_params()
    crop_season = crop_params[crop_id].season if crop_id in crop_params else ""
    today = (today or datetime.now()).replace(hour=0, minute=0, second=0, microsecond=0)
    candidates = []
    for month, day in _sowing_window_starts(crop_id, crop_season):
        this_year = datetime(today.year, month, day)
        candidates.append(this_year if this_year >= today else datetime(today.year + 1, month, day))
    return min(candidates).strftime("%Y-%m-%d")


def irrigation_schedule(
    crop_id: str,
    sowing_date: str | None,
    rainfall_mm: float,
    irrigation_level: float = 0.5,
) -> dict[str, Any]:
    """Generate a week-by-week irrigation plan based on crop water needs and expected rainfall.

    A missing sowing date defaults to the crop's next calendar sowing date; an
    invalid one raises instead of being silently replaced (N-17).
    """
    crop_params = _load_crop_params()
    if crop_id not in crop_params:
        raise ValueError(f"crop_id: unknown crop '{crop_id}'")
    crop = crop_params[crop_id]
    duration = CROP_DURATION_DAYS.get(crop_id, 120)
    stages = CROP_WATER_STAGES.get(crop_id, [(0.0, 1.0, 1.0, "Full Season")])

    sowing_date_defaulted = not sowing_date
    if sowing_date_defaulted:
        sowing_date = default_sowing_date(crop_id)
    try:
        sow_dt = datetime.strptime(sowing_date, "%Y-%m-%d")
    except ValueError as exc:
        raise ValueError("sowing_date must be a real date in YYYY-MM-DD format") from exc

    total_water_need = crop.water_requirement_mm
    weekly_rainfall = rainfall_mm / (duration / 7)
    num_weeks = math.ceil(duration / 7)

    schedule = []
    total_irrigation_mm = 0.0
    for week in range(num_weeks):
        day_start = week * 7
        day_end = min(day_start + 7, duration)
        frac_start = day_start / duration
        frac_end = day_end / duration

        # Find active stage
        stage_name = "General"
        stage_mult = 1.0
        for s_start, s_end, mult, name in stages:
            if frac_start >= s_start and frac_start < s_end:
                stage_name = name
                stage_mult = mult
                break

        weekly_need = (total_water_need / num_weeks) * stage_mult
        deficit = max(weekly_need - weekly_rainfall, 0)
        irrigation_mm = deficit * irrigation_level

        week_start = sow_dt + timedelta(days=day_start)
        week_end = sow_dt + timedelta(days=day_end - 1)
        total_irrigation_mm += irrigation_mm

        priority = "high" if stage_mult >= 1.3 else ("medium" if stage_mult >= 1.0 else "low")

        schedule.append({
            "week": week + 1,
            "date_range": f"{week_start.strftime('%b %d')} - {week_end.strftime('%b %d')}",
            "growth_stage": stage_name,
            "water_need_mm": round(weekly_need, 1),
            "expected_rainfall_mm": round(weekly_rainfall, 1),
            "irrigation_required_mm": round(irrigation_mm, 1),
            "priority": priority,
        })

    return {
        "crop_id": crop_id,
        "crop_name": crop.crop_name,
        "sowing_date": sowing_date,
        "sowing_date_defaulted": sowing_date_defaulted,
        "harvest_date": (sow_dt + timedelta(days=duration)).strftime("%Y-%m-%d"),
        "duration_days": duration,
        "total_water_requirement_mm": total_water_need,
        "total_seasonal_rainfall_mm": rainfall_mm,
        "total_irrigation_needed_mm": round(total_irrigation_mm, 1),
        "irrigation_efficiency": irrigation_level,
        "weekly_schedule": schedule,
    }


# ===========================================================================
# 5. Crop Calendar API
# ===========================================================================

CROP_CALENDAR = {
    "rice": {
        "kharif": {
            "nursery": "May 15 - Jun 10",
            "sowing_transplant": "Jun 15 - Jul 15",
            "first_fertilizer": "15-20 DAS (basal N+P+K)",
            "second_fertilizer": "30-35 DAS (top-dress N)",
            "third_fertilizer": "55-60 DAS (top-dress N at panicle initiation)",
            "critical_irrigation": "Transplanting to grain fill (maintain 5cm standing water)",
            "pest_watch": "30-60 DAS (BPH, Blast)",
            "harvest_window": "Oct 15 - Nov 15",
            "duration_days": 120,
        },
    },
    "wheat": {
        "rabi": {
            "land_prep": "Oct 15 - Nov 01",
            "sowing_transplant": "Nov 01 - Nov 25",
            "first_fertilizer": "At sowing (basal N+P+K)",
            "second_fertilizer": "21 DAS (first irrigation + top-dress N)",
            "third_fertilizer": "45 DAS (second top-dress N at heading)",
            "critical_irrigation": "CRI (21 DAS), Flowering (60 DAS), Grain fill (85 DAS)",
            "pest_watch": "Jan-Feb (Yellow rust in cool wet spells)",
            "harvest_window": "Mar 25 - Apr 20",
            "duration_days": 130,
        },
    },
    "maize": {
        "kharif": {
            "land_prep": "Jun 01 - Jun 15",
            "sowing_transplant": "Jun 15 - Jul 10",
            "first_fertilizer": "At sowing (basal N+P+K)",
            "second_fertilizer": "25-30 DAS (knee-high stage N top-dress)",
            "third_fertilizer": "45-50 DAS (pre-tasseling N top-dress)",
            "critical_irrigation": "Tasseling/Silking (45-65 DAS) — most sensitive",
            "pest_watch": "20-40 DAS (Fall Armyworm in whorl)",
            "harvest_window": "Sep 20 - Oct 20",
            "duration_days": 100,
        },
        "rabi": {
            "land_prep": "Oct 15 - Nov 01",
            "sowing_transplant": "Nov 01 - Nov 20",
            "first_fertilizer": "At sowing (basal)",
            "second_fertilizer": "25-30 DAS",
            "third_fertilizer": "45-50 DAS",
            "critical_irrigation": "Every 15-20 days",
            "pest_watch": "Stem borer throughout",
            "harvest_window": "Feb 15 - Mar 15",
            "duration_days": 110,
        },
    },
    "sugarcane": {
        "annual": {
            "land_prep": "Jan 15 - Feb 15",
            "sowing_transplant": "Feb 15 - Mar 15 (spring planting)",
            "first_fertilizer": "At planting (basal N+P+K)",
            "second_fertilizer": "45 DAS (first top-dress N)",
            "third_fertilizer": "90 DAS (second top-dress N)",
            "critical_irrigation": "Every 7-10 days during grand growth (Apr-Aug)",
            "pest_watch": "Mar-May (Early shoot borer), Aug-Oct (Red rot if wet)",
            "harvest_window": "Dec - Mar (12-14 months after planting)",
            "duration_days": 300,
        },
    },
    "cotton": {
        "kharif": {
            "land_prep": "May 15 - Jun 01",
            "sowing_transplant": "Jun 01 - Jun 30 (after pre-monsoon showers)",
            "first_fertilizer": "At sowing (basal N+P+K)",
            "second_fertilizer": "30-35 DAS (square formation N top-dress)",
            "third_fertilizer": "60 DAS (flowering N+K top-dress)",
            "critical_irrigation": "Flowering and boll development (60-120 DAS)",
            "pest_watch": "Bollworm (60-90 DAS), Whitefly (throughout in dry spells)",
            "harvest_window": "Oct - Dec (multiple pickings)",
            "duration_days": 180,
        },
    },
    "pulses": {
        "rabi": {
            "land_prep": "Sep 25 - Oct 10",
            "sowing_transplant": "Oct 10 - Nov 05",
            "first_fertilizer": "At sowing (low N, full P+K + Rhizobium seed treatment)",
            "second_fertilizer": "Not usually needed (legume N-fixation)",
            "third_fertilizer": "Foliar spray at flowering if needed",
            "critical_irrigation": "Pre-flowering (35-40 DAS), Pod fill (60-70 DAS)",
            "pest_watch": "Flowering stage pod borer (55-70 DAS)",
            "harvest_window": "Jan 20 - Feb 20",
            "duration_days": 110,
        },
        "kharif": {
            "land_prep": "Jun 01 - Jun 15",
            "sowing_transplant": "Jun 15 - Jul 05",
            "first_fertilizer": "At sowing (Rhizobium + P+K)",
            "second_fertilizer": "Not usually needed",
            "third_fertilizer": "Foliar spray if yellowing",
            "critical_irrigation": "Rainfed mostly; supplemental at flowering",
            "pest_watch": "Pod borer at flowering",
            "harvest_window": "Sep 20 - Oct 20",
            "duration_days": 100,
        },
    },
    "groundnut": {
        "kharif": {
            "land_prep": "Jun 01 - Jun 15",
            "sowing_transplant": "Jun 15 - Jul 05",
            "first_fertilizer": "At sowing (basal N+P+K + Gypsum 200kg/acre)",
            "second_fertilizer": "Gypsum at pegging (45 DAS)",
            "third_fertilizer": "Not usually needed",
            "critical_irrigation": "Pegging and pod fill (45-80 DAS)",
            "pest_watch": "Tikka leaf spot (30-60 DAS), White grub in sandy soils",
            "harvest_window": "Oct 01 - Nov 01",
            "duration_days": 110,
        },
    },
    "soybean": {
        "kharif": {
            "land_prep": "Jun 01 - Jun 15",
            "sowing_transplant": "Jun 15 - Jul 05",
            "first_fertilizer": "At sowing (low N + full P+K + Rhizobium/PSB)",
            "second_fertilizer": "Not usually needed (N-fixing legume)",
            "third_fertilizer": "Foliar spray at R1 stage if needed",
            "critical_irrigation": "Flowering (R1-R2) and pod fill (R5-R6)",
            "pest_watch": "Girdle beetle (20-30 DAS), Yellow mosaic (throughout)",
            "harvest_window": "Oct 01 - Oct 25",
            "duration_days": 100,
        },
    },
    "watermelon": {
        "zaid": {
            "land_prep": "Jan 20 - Feb 05",
            "sowing_transplant": "Feb 05 - Feb 25",
            "first_fertilizer": "At sowing (basal N+P+K)",
            "second_fertilizer": "25-30 DAS (vine growth N top-dress)",
            "third_fertilizer": "45-50 DAS (flowering/fruit-set K top-dress)",
            "critical_irrigation": "Flowering to fruit development (35-70 DAS) — avoid water stress at fruit-fill",
            "pest_watch": "Fruit fly (45-75 DAS), powdery mildew in humid spells",
            "harvest_window": "May 01 - May 25",
            "duration_days": 90,
        },
    },
    "cucumber": {
        "zaid": {
            "land_prep": "Feb 01 - Feb 15",
            "sowing_transplant": "Feb 15 - Mar 05",
            "first_fertilizer": "At sowing (basal N+P+K)",
            "second_fertilizer": "20-25 DAS (vine growth N top-dress)",
            "third_fertilizer": "35-40 DAS (flowering K top-dress)",
            "critical_irrigation": "Flowering to fruit picking (25-55 DAS), frequent light irrigation",
            "pest_watch": "Fruit fly and downy mildew throughout fruiting",
            "harvest_window": "Apr 10 - May 05",
            "duration_days": 65,
        },
    },
    "muskmelon": {
        "zaid": {
            "land_prep": "Jan 25 - Feb 10",
            "sowing_transplant": "Feb 10 - Mar 01",
            "first_fertilizer": "At sowing (basal N+P+K)",
            "second_fertilizer": "25-30 DAS (vine growth N top-dress)",
            "third_fertilizer": "45-50 DAS (fruit development K top-dress)",
            "critical_irrigation": "Flowering to net formation (35-65 DAS) — reduce irrigation near harvest for sweetness",
            "pest_watch": "Fruit fly (45-75 DAS), powdery mildew",
            "harvest_window": "Apr 25 - May 20",
            "duration_days": 85,
        },
    },
}


def get_crop_calendar(crop_id: str, season: str | None = None) -> dict[str, Any]:
    """Return crop calendar with all key dates and activities."""
    if crop_id not in CROP_CALENDAR:
        raise ValueError(f"No calendar data for crop: {crop_id}")
    calendars = CROP_CALENDAR[crop_id]
    if season:
        s = season.lower()
        for cal_season, cal_data in calendars.items():
            if s in cal_season or cal_season in s:
                return {"crop_id": crop_id, "season": cal_season, "calendar": cal_data}
        raise ValueError(f"No calendar for {crop_id} in season {season}")
    # Return all seasons
    return {"crop_id": crop_id, "seasons": calendars}


# ===========================================================================
# 6. Pest & Disease Risk Alerts
# ===========================================================================

def pest_disease_alerts(
    crop_id: str,
    weather: dict[str, Any],
) -> dict[str, Any]:
    """Flag pest/disease risks based on current weather conditions."""
    rules = _load_csv("pest_rules.csv")
    crop_rules = [r for r in rules if r["crop_id"] == crop_id]
    if not crop_rules:
        return {"crop_id": crop_id, "alerts": [], "message": "No pest rules available for this crop."}

    temp = float(weather.get("avg_temp_c", 25))
    rainfall = float(weather.get("rainfall_mm", 500))

    alerts = []
    for rule in crop_rules:
        temp_min = float(rule["trigger_temp_min_c"])
        temp_max = float(rule["trigger_temp_max_c"])
        rain_min = float(rule["trigger_rainfall_min_mm"])

        temp_in_range = temp_min <= temp <= temp_max
        rain_sufficient = rainfall >= rain_min

        if temp_in_range and rain_sufficient:
            risk_level = "HIGH"
        elif temp_in_range or rain_sufficient:
            risk_level = "MODERATE"
        else:
            risk_level = "LOW"

        alerts.append({
            "pest_disease": rule["pest_disease"],
            "risk_level": risk_level,
            "severity": rule["severity"],
            "trigger": f"Temp {temp_min}-{temp_max}°C, Rain ≥{rain_min}mm",
            "current_conditions": f"Temp {temp}°C, Rain {rainfall}mm",
            "description": rule["description"],
            "management": rule["management"],
        })

    # Sort by risk level
    risk_order = {"HIGH": 0, "MODERATE": 1, "LOW": 2}
    alerts.sort(key=lambda x: risk_order.get(x["risk_level"], 3))

    high_count = sum(1 for a in alerts if a["risk_level"] == "HIGH")
    return {
        "crop_id": crop_id,
        "temperature_c": temp,
        "rainfall_mm": rainfall,
        "total_alerts": len(alerts),
        "high_risk_count": high_count,
        "alerts": alerts,
    }


# ===========================================================================
# 7. Loan/Credit Feasibility Calculator
# ===========================================================================

def loan_calculator(
    total_cost: float,
    expected_profit: float,
    loan_amount: float | None = None,
    interest_rate_annual: float = 4.0,  # KCC default
    tenure_months: int = 12,
) -> dict[str, Any]:
    """Compute EMI, total repayment, and whether the crop can service the loan."""
    if loan_amount is None:
        loan_amount = total_cost  # Assume full cost is borrowed

    monthly_rate = interest_rate_annual / 100 / 12
    if monthly_rate > 0:
        emi = loan_amount * monthly_rate * (1 + monthly_rate) ** tenure_months / ((1 + monthly_rate) ** tenure_months - 1)
    else:
        emi = loan_amount / tenure_months

    total_repayment = emi * tenure_months
    total_interest = total_repayment - loan_amount
    expected_revenue = expected_profit + total_cost
    net_after_loan = expected_revenue - total_repayment
    can_service = net_after_loan > 0
    dscr = expected_revenue / max(total_repayment, 1)  # Debt Service Coverage Ratio

    # Breakeven: how many months of revenue needed to cover loan
    monthly_revenue = expected_revenue / max(tenure_months, 1)
    breakeven_months = math.ceil(total_repayment / max(monthly_revenue, 1))

    return {
        "loan_amount": round(loan_amount, 2),
        "interest_rate_annual_pct": interest_rate_annual,
        "tenure_months": tenure_months,
        "emi": round(emi, 2),
        "total_repayment": round(total_repayment, 2),
        "total_interest": round(total_interest, 2),
        "expected_revenue": round(expected_revenue, 2),
        "expected_profit_after_loan": round(net_after_loan, 2),
        "can_service_loan": can_service,
        "debt_service_coverage_ratio": round(dscr, 2),
        "breakeven_months": breakeven_months,
        "verdict": (
            "SAFE — Crop revenue comfortably covers loan repayment."
            if dscr >= 1.5 else
            "FEASIBLE — Revenue covers loan but with thin margin. Consider lower loan amount."
            if dscr >= 1.0 else
            "RISKY — Expected revenue may not cover full loan repayment. Reduce loan or choose higher-profit crop."
        ),
        "kcc_note": "Kisan Credit Card loans at 4% p.a. (with prompt repayment subvention). Apply at any bank with land records.",
    }


# ===========================================================================
# 8. Multi-Year Soil Health Projection
# ===========================================================================

# Nutrient depletion/fixation per crop per acre per season (approximate kg)
NUTRIENT_IMPACT = {
    "rice": {"n": -25, "p": -10, "k": -12},       # Heavy N feeder
    "wheat": {"n": -20, "p": -8, "k": -10},
    "maize": {"n": -28, "p": -12, "k": -15},       # Very heavy feeder
    "sugarcane": {"n": -40, "p": -15, "k": -20},    # Heaviest
    "cotton": {"n": -30, "p": -12, "k": -18},
    "pulses": {"n": +15, "p": -5, "k": -5},         # Legume N-fixation
    "groundnut": {"n": +10, "p": -6, "k": -6},      # Legume
    "soybean": {"n": +12, "p": -6, "k": -6},        # Legume
}

# Fertilizer application partially restores (assumed 60% efficiency)
FERTILIZER_RESTORE_EFFICIENCY = 0.60


def soil_health_projection(
    current_soil: dict[str, Any],
    rotation: list[dict[str, str]],  # [{"crop_id": "rice", "season": "kharif"}, ...]
    years: int = 5,
    apply_fertilizer: bool = True,
) -> dict[str, Any]:
    """Project soil NPK over multiple years based on crop rotation choices."""
    n = float(current_soil.get("n_kg_per_acre", 40))
    p = float(current_soil.get("p_kg_per_acre", 20))
    k = float(current_soil.get("k_kg_per_acre", 20))
    crop_params = _load_crop_params()

    timeline = [{"year": 0, "season": "current", "crop": None, "n": round(n, 1), "p": round(p, 1), "k": round(k, 1)}]

    rotation_cycle = rotation if rotation else [{"crop_id": "rice", "season": "kharif"}]

    for year in range(1, years + 1):
        for step in rotation_cycle:
            cid = step["crop_id"]
            impact = NUTRIENT_IMPACT.get(cid, {"n": -15, "p": -5, "k": -5})

            # Crop depletes/fixes
            n += impact["n"]
            p += impact["p"]
            k += impact["k"]

            # Fertilizer partially restores deficit
            if apply_fertilizer and cid in crop_params:
                crop = crop_params[cid]
                n += max(crop.npk_n_kg_per_acre - max(n, 0), 0) * FERTILIZER_RESTORE_EFFICIENCY
                p += max(crop.npk_p_kg_per_acre - max(p, 0), 0) * FERTILIZER_RESTORE_EFFICIENCY
                k += max(crop.npk_k_kg_per_acre - max(k, 0), 0) * FERTILIZER_RESTORE_EFFICIENCY

            # Natural floor
            n = max(n, 5)
            p = max(p, 3)
            k = max(k, 3)

            timeline.append({
                "year": year,
                "season": step.get("season", ""),
                "crop": cid,
                "n": round(n, 1),
                "p": round(p, 1),
                "k": round(k, 1),
            })

    initial = timeline[0]
    final = timeline[-1]
    return {
        "initial_soil": {"n": initial["n"], "p": initial["p"], "k": initial["k"]},
        "final_soil": {"n": final["n"], "p": final["p"], "k": final["k"]},
        "n_change": round(final["n"] - initial["n"], 1),
        "p_change": round(final["p"] - initial["p"], 1),
        "k_change": round(final["k"] - initial["k"], 1),
        "health_trend": (
            "improving" if (final["n"] >= initial["n"] and final["p"] >= initial["p"])
            else "stable" if abs(final["n"] - initial["n"]) < 5
            else "declining"
        ),
        "years_projected": years,
        "rotation_used": [s["crop_id"] for s in rotation_cycle],
        "fertilizer_applied": apply_fertilizer,
        "timeline": timeline,
        "tip": (
            "Include legumes (pulses/soybean/groundnut) in rotation to fix nitrogen and improve soil health."
            if all(NUTRIENT_IMPACT.get(s["crop_id"], {}).get("n", -1) < 0 for s in rotation_cycle)
            else "Good rotation — legume crops are helping maintain nitrogen levels."
        ),
    }


# ===========================================================================
# 9. Price Forecast
# ===========================================================================

def price_forecast(region_id: str, crop_id: str, months_ahead: int = 6) -> dict[str, Any]:
    """Forecast monthly prices for the `months_ahead` months starting this month.

    Steps run on from the last month in the data, so a series that ends in
    the past is extrapolated across the gap; months already past are dropped
    from the answer. A stale series (newest row older than
    PRICE_STALE_AFTER_DAYS) is flagged and every month's confidence capped at
    "low" (defect N-9).
    """
    if not 1 <= int(months_ahead) <= 24:
        raise ValueError("months_ahead must be between 1 and 24")
    prices = _price_rows(region_id, crop_id)
    if len(prices) < 12:
        raise ValueError("Need at least 12 months of data for forecasting")

    price_vals = [p["price"] for p in prices]
    n = len(price_vals)

    # Monthly seasonal indices (used by both ML and heuristic)
    monthly: dict[int, list[float]] = {}
    for p in prices:
        m = int(p["date"].split("-")[1])
        monthly.setdefault(m, []).append(p["price"])
    overall_avg = mean(price_vals)
    seasonal_idx = {}
    for m, vals in monthly.items():
        seasonal_idx[m] = mean(vals) / overall_avg if overall_avg else 1.0

    # Linear trend on last 12 points
    recent = price_vals[-12:]
    x_mean = (len(recent) - 1) / 2.0
    y_mean = mean(recent)
    num = sum((i - x_mean) * (y - y_mean) for i, y in enumerate(recent))
    den = sum((i - x_mean) ** 2 for i in range(len(recent)))
    slope = num / den if den else 0.0
    intercept = y_mean - slope * x_mean

    # Get last date
    last_date = prices[-1]["date"]
    try:
        last_dt = datetime.strptime(last_date, "%Y-%m-%d")
    except ValueError:
        last_dt = datetime.now()

    # Try ML-based forecast
    try:
        from ml.predict import _ml_predict_price
    except ImportError:
        _ml_predict_price = None

    using_ml = False
    forecasts = []
    rolling_prices = list(price_vals)  # mutable copy for iterative ML prediction
    freshness = price_freshness(last_date)
    now = datetime.now()
    # Months from the last data month to this month, which are skipped.
    gap = max(0, (now.year - last_dt.year) * 12 + (now.month - last_dt.month) - 1)

    for i in range(1, gap + months_ahead + 1):
        target_month = (last_dt.month - 1 + i) % 12 + 1
        target_year = last_dt.year + (last_dt.month - 1 + i) // 12
        month = target_month
        year = target_year
        seasonal_factor = seasonal_idx.get(month, 1.0)


        ml_price = None
        if _ml_predict_price is not None:
            ml_price = _ml_predict_price(region_id, crop_id, rolling_prices, month, year)

        used_ml_this_step = ml_price is not None and ml_price > 0
        if used_ml_this_step:
            forecast_price = ml_price
            using_ml = True  # at least one step used the ML model
            rolling_prices.append(forecast_price)  # feed prediction back for next step
        else:
            trend_value = intercept + slope * (len(recent) - 1 + i)
            forecast_price = max(trend_value * seasonal_factor, 0.5)

        if i <= gap:
            continue  # a month already past: computed only to carry the series on
        if freshness["stale"]:
            confidence = "low"
        else:
            confidence = "high" if (used_ml_this_step and i <= 2) else ("medium" if i <= 3 else "low")
        forecasts.append({
            "month": f"{target_year}-{target_month:02d}",
            "month_num": month,
            "forecast_price": round(forecast_price, 2),
            "seasonal_factor": round(seasonal_factor, 3),
            "confidence": confidence,
        })


    return {
        "region_id": region_id,
        "crop_id": crop_id,
        "current_price": price_vals[-1],
        **freshness,
        "trend_slope_per_month": round(slope, 3),
        "trend_direction": "rising" if slope > 0.2 else ("falling" if slope < -0.2 else "stable"),
        "forecasts": forecasts,
        "prediction_source": "ml_model" if using_ml else "heuristic",
        "methodology": (
            "GradientBoosting regression with lag features and iterative multi-step forecasting."
            if using_ml else
            "Seasonal decomposition with linear trend extrapolation on last 12 months."
        ),
    }


def _region_avg_weather(region_id: str) -> dict[str, float] | None:
    """Region-average rainfall/temperature from dataset/weather.csv, or None
    if the region has no rows on file. Used by calculate_disease_outbreak_risk
    as a region-aware fallback -- see its B-9 fix note below."""
    rows = [r for r in _load_csv("weather.csv") if r.get("region_id") == region_id]
    if not rows:
        return None
    try:
        temps = [float(r["avg_temp_c"]) for r in rows if r.get("avg_temp_c")]
        rains = [float(r["rainfall_mm"]) for r in rows if r.get("rainfall_mm")]
    except ValueError:
        return None
    if not temps or not rains:
        return None
    return {
        "avg_temp_c": round(sum(temps) / len(temps), 1),
        "rainfall_mm": round(sum(rains) / len(rains), 1),
    }


def calculate_disease_outbreak_risk(
    crop_id: str = "wheat",
    region_id: str = "mp_sehore",
    weather: dict | None = None,
) -> dict[str, Any]:
    """Calculate micro-climate pest and fungal disease outbreak risk scores.

    FIX (M-18): Risk is now genuinely scoped per crop using the
    crop-specific trigger rules in dataset/pest_rules.csv (the same table
    `pest_disease_alerts` uses), instead of always evaluating the same three
    fixed disease categories (late blight / rust / whitefly) regardless of
    which crop was asked about. Each of the crop's actual pests/diseases gets
    its own risk score computed from how closely current weather matches its
    documented trigger conditions. Crops with no entries in pest_rules.csv
    fall back to a clearly-labeled generic weather-driven index instead of
    silently pretending it's crop-specific.

    FIX (B-9): `region_id` used to be accepted and echoed into the response
    but never actually used -- when `weather` was omitted, every region got
    the identical fixed nationwide default, so climatically opposite regions
    (e.g. arid Rajasthan vs. humid Kerala) produced byte-identical risk
    scores. Omitted weather is now backfilled from that region's own average
    in dataset/weather.csv, falling back to the old nationwide default only
    if the region has no weather rows on file.
    """
    if weather is None:
        weather = _region_avg_weather(region_id) or {"rainfall_mm": 850.0, "avg_temp_c": 27.5, "humidity_pct": 78.0}

    temp = float(weather.get("avg_temp_c", 27.5))
    rainfall = float(weather.get("rainfall_mm", 800.0))
    # FIX (M-19): `humidity_pct` used to be derived from rainfall_mm / 12.0
    # when not supplied -- an unexplained mm-to-% conversion between two
    # unrelated physical quantities. When it's genuinely missing, fall back
    # to a documented constant instead of a fabricated derivation: 65% is a
    # representative average relative humidity for Indian cropping regions
    # during the primary kharif/rabi growing windows (source: IMD seasonal
    # climatology summaries), not something inferred from rainfall totals.
    DEFAULT_HUMIDITY_PCT = 65.0
    humidity = float(weather.get("humidity_pct", DEFAULT_HUMIDITY_PCT))
    humidity = max(30.0, min(95.0, humidity))

    rules = _load_csv("pest_rules.csv")
    crop_rules = [r for r in rules if r["crop_id"] == crop_id]

    diseases: list[dict[str, Any]] = []
    generic_fallback = False

    if crop_rules:
        for rule in crop_rules:
            t_min = float(rule["trigger_temp_min_c"])
            t_max = float(rule["trigger_temp_max_c"])
            rain_min = float(rule["trigger_rainfall_min_mm"])
            severity = rule.get("severity", "medium")
            severity_weight = {"high": 1.15, "medium": 1.0, "low": 0.85}.get(severity, 1.0)

            temp_in_range = t_min <= temp <= t_max
            rain_sufficient = rainfall >= rain_min
            # Blend humidity in as a secondary modifier -- most of these
            # pests/diseases are humidity-sensitive per the trigger_humidity_hint
            # column, so higher ambient humidity nudges risk up.
            humidity_bonus = (humidity - 50.0) * 0.3

            if temp_in_range and rain_sufficient:
                base_risk = 65.0 + humidity_bonus
            elif temp_in_range or rain_sufficient:
                base_risk = 40.0 + humidity_bonus * 0.5
            else:
                base_risk = 15.0 + humidity_bonus * 0.2

            risk_score = round(max(5.0, min(98.0, base_risk * severity_weight)), 1)

            diseases.append({
                "name": rule["pest_disease"],
                "risk_score": risk_score,
                "status": "High Alert" if risk_score >= 65 else "Normal",
                "recommendation": rule.get("management", ""),
            })
        diseases.sort(key=lambda d: d["risk_score"], reverse=True)
        overall_pest_threat = round(mean(d["risk_score"] for d in diseases), 1)
    else:
        # No crop-specific rules available -- be honest that this is a
        # generic weather-driven index, not a crop-specific assessment.
        generic_fallback = True
        if 15 <= temp <= 24 and humidity >= 75:
            generic_risk = min(98.0, (humidity - 70) * 3.0 + (24 - abs(temp - 20)) * 2.0)
        elif 18 <= temp <= 28 and humidity >= 65:
            generic_risk = min(95.0, 40.0 + (humidity - 65) * 1.5 + (28 - temp) * 1.2)
        else:
            generic_risk = max(12.0, (temp / 40.0) * 30.0)
        overall_pest_threat = round(generic_risk, 1)
        diseases.append({
            "name": "Generic Fungal/Pest Pressure Index",
            "risk_score": overall_pest_threat,
            "status": "High Alert" if overall_pest_threat >= 65 else "Normal",
            "recommendation": "No crop-specific pest rules available for this crop; monitor "
                               "field conditions and consult local agronomy extension services.",
        })

    return {
        "crop_id": crop_id,
        "region_id": region_id,
        "avg_temp_c": round(temp, 1),
        "humidity_pct": round(humidity, 1),
        "crop_specific": not generic_fallback,
        "overall_threat_level": "CRITICAL" if overall_pest_threat >= 70 else ("ELEVATED" if overall_pest_threat >= 45 else "LOW"),
        "overall_pest_score": overall_pest_threat,
        "diseases": diseases,
    }


def calculate_carbon_credits(
    crop_id: str = "wheat",
    area_acres: float = 4.0,
    tillage_practice: str = "no_till",
    cover_crop: bool = True,
    biochar_application: bool = False,
) -> dict[str, Any]:
    """Return a transparent planning estimate, not verified carbon credits.

    FIX: sequestration used to ignore crop_id entirely -- a sugarcane farm and
    a chickpea farm with identical tillage/cover-crop settings got an
    identical estimate. Perennial tree/plantation crops (tagged "Perennial"
    in dataset/crop_parameters.csv -- coconut, tea, coffee, mango, cashew)
    hold continuous, undisturbed root systems and standing woody biomass
    year-round, unlike annual crops that are tilled and replanted each
    season -- a well-established qualitative reason for higher per-acre
    soil+biomass carbon in perennial/agroforestry systems.
    PERENNIAL_SEQUESTRATION_MULT is a documented approximation reflecting
    that difference, not a crop-specific measured coefficient -- it's applied
    only to the baseline biomass term, not the practice-based bonuses below.
    """
    PERENNIAL_SEQUESTRATION_MULT = 1.6
    base_sequestration = 0.4  # baseline tons CO2e / acre / year

    crop = _load_crop_params().get(crop_id)
    is_perennial = crop is not None and "perennial" in (crop.season or "").lower()
    crop_type_mult = PERENNIAL_SEQUESTRATION_MULT if is_perennial else 1.0

    if tillage_practice == "no_till":
        tillage_mult = 1.6
    elif tillage_practice == "reduced_till":
        tillage_mult = 1.25
    else:
        tillage_mult = 0.9

    cover_bonus = 0.35 if cover_crop else 0.0
    biochar_bonus = 0.50 if biochar_application else 0.0

    seq_per_acre = (base_sequestration * tillage_mult * crop_type_mult) + cover_bonus + biochar_bonus
    total_co2e_tons = seq_per_acre * area_acres

    # Global/Indian carbon credit market price (~$15 / ₹1250 per ton CO2e)
    inr_per_ton = 1250.0
    annual_earning_inr = total_co2e_tons * inr_per_ton

    return {
        "crop_id": crop_id,
        "crop_cycle": "perennial" if is_perennial else "seasonal",
        "area_acres": area_acres,
        "tillage_practice": tillage_practice,
        "cover_crop_enabled": cover_crop,
        "biochar_applied": biochar_application,
        "co2e_sequestered_tons_per_acre": round(seq_per_acre, 2),
        "total_co2e_sequestered_tons": round(total_co2e_tons, 2),
        "credit_rate_inr_per_ton": inr_per_ton,
        "estimated_annual_earning_inr": round(annual_earning_inr, 2),
        "is_verified_credit": False,
        "disclaimer": "Estimate only. Soil sampling, an approved methodology, and registry verification are required before any credit can be issued or sold.",
        "environmental_impact": f"Equivalent to removing {round(total_co2e_tons * 0.22, 1)} petrol cars off the road for a year.",
    }



# ===========================================================================
# 10. Cross-Mandi Arbitrage
# ===========================================================================

def cross_mandi_arbitrage(crop_id: str) -> dict[str, Any]:
    """Compare prices across regions *on one date* to find arbitrage opportunities.

    This used to take each region's own most-recent row, which is not the same
    thing: mandi_prices.csv does not end on the same month for every region, so
    a region last quoted in Dec-2024 was being compared against one quoted in
    Dec-2025. The resulting "52% spread" was mostly a year of drift, and a
    farmer acting on it would truck grain toward a price that no longer exists.
    Compare a single month, and say which month it was.
    """
    rows = _load_csv("mandi_prices.csv")

    by_date: dict[str, dict[str, dict]] = {}
    for r in rows:
        if r["crop_id"] != crop_id:
            continue
        try:
            price = float(r["price_inr_per_kg"])
        except (TypeError, ValueError):
            continue
        by_date.setdefault(r["date"], {})[r["region_id"]] = {
            "region_id": r["region_id"],
            "date": r["date"],
            "price": price,
            "market": r.get("market_name", r["region_id"]),
        }

    # Newest month that at least two mandis actually quoted.
    region_prices: dict[str, dict] = {}
    as_of = None
    for date in sorted(by_date, reverse=True):
        if len(by_date[date]) >= 2:
            region_prices = by_date[date]
            as_of = date
            break

    if len(region_prices) < 2:
        return {
            "crop_id": crop_id,
            "message": "Need at least 2 mandis quoting this crop in the same month for arbitrage analysis.",
            "opportunities": [],
        }

    sorted_regions = sorted(region_prices.values(), key=lambda x: x["price"])
    cheapest = sorted_regions[0]
    costliest = sorted_regions[-1]
    price_gap = costliest["price"] - cheapest["price"]
    gap_pct = round(price_gap / max(cheapest["price"], 1) * 100, 2)

    opportunities = []
    for i, low in enumerate(sorted_regions):
        for high in sorted_regions[i + 1:]:
            diff = high["price"] - low["price"]
            if diff > 2.0:  # Only flag if gap > ₹2/kg
                opportunities.append({
                    "buy_region": low["region_id"],
                    "buy_market": low["market"],
                    "buy_price": low["price"],
                    "sell_region": high["region_id"],
                    "sell_market": high["market"],
                    "sell_price": high["price"],
                    "price_gap_per_kg": round(diff, 2),
                    "gap_pct": round(diff / max(low["price"], 1) * 100, 2),
                })

    opportunities.sort(key=lambda x: x["price_gap_per_kg"], reverse=True)

    return {
        "crop_id": crop_id,
        "as_of": as_of,
        "regions_compared": len(region_prices),
        "cheapest_market": cheapest,
        "costliest_market": costliest,
        "max_price_gap_per_kg": round(price_gap, 2),
        "max_gap_pct": gap_pct,
        "opportunities": opportunities[:10],
        "note": (
            f"All prices compared as of {as_of}. Transport costs typically "
            "₹1-3/kg depending on distance. Factor this before acting."
        ),
    }


# ===========================================================================
# 11. Strategy Templates
# ===========================================================================

STRATEGY_TEMPLATES = [
    {
        "template_id": "small_kharif_rice",
        "name": "Small Holder - Kharif Rice",
        "description": "Typical 2-acre farmer growing paddy in monsoon season with partial irrigation",
        "profile": "Small/marginal farmer, kharif season",
        "config": {
            "crop_id": "rice", "area_acres": 2, "season": "kharif",
            "irrigation_level": 0.5, "seed_variety": "standard",
            "budget_per_acre": 15000, "sowing_date": "2025-06-20",
        },
    },
    {
        "template_id": "medium_cotton",
        "name": "Medium Farmer - Cotton",
        "description": "5-acre cotton farmer with drip irrigation and hybrid seeds",
        "profile": "Medium farmer, kharif season, semi-arid region",
        "config": {
            "crop_id": "cotton", "area_acres": 5, "season": "kharif",
            "irrigation_level": 0.7, "seed_variety": "hybrid",
            "budget_per_acre": 25000, "sowing_date": "2025-06-10",
        },
    },
    {
        "template_id": "large_sugarcane",
        "name": "Large Farmer - Sugarcane",
        "description": "10-acre sugarcane with full canal irrigation, high investment",
        "profile": "Large farmer, annual crop, irrigated",
        "config": {
            "crop_id": "sugarcane", "area_acres": 10, "season": "annual",
            "irrigation_level": 0.9, "seed_variety": "hybrid",
            "budget_per_acre": 40000, "sowing_date": "2025-02-20",
        },
    },
    {
        "template_id": "rabi_wheat_punjab",
        "name": "Punjab Wheat - Rabi",
        "description": "Standard 4-acre wheat in rabi with tube-well irrigation",
        "profile": "Medium farmer, rabi season, Punjab belt",
        "config": {
            "crop_id": "wheat", "area_acres": 4, "season": "rabi",
            "irrigation_level": 0.8, "seed_variety": "hybrid",
            "budget_per_acre": 18000, "sowing_date": "2025-11-10",
        },
    },
    {
        "template_id": "organic_pulses",
        "name": "Organic Pulses (Low Input)",
        "description": "3-acre rainfed pulses with minimal chemical inputs, suitable for PKVY scheme",
        "profile": "Small farmer, organic/natural farming",
        "config": {
            "crop_id": "pulses", "area_acres": 3, "season": "rabi",
            "irrigation_level": 0.2, "seed_variety": "local",
            "budget_per_acre": 10000, "sowing_date": "2025-10-15",
        },
    },
    {
        "template_id": "soybean_mp",
        "name": "MP Soybean - Kharif",
        "description": "Standard 5-acre soybean in Madhya Pradesh kharif with moderate inputs",
        "profile": "Medium farmer, kharif, Malwa region",
        "config": {
            "crop_id": "soybean", "area_acres": 5, "season": "kharif",
            "irrigation_level": 0.3, "seed_variety": "standard",
            "budget_per_acre": 14000, "sowing_date": "2025-06-25",
        },
    },
    {
        "template_id": "groundnut_rainfed",
        "name": "Rainfed Groundnut",
        "description": "4-acre groundnut in kharif with minimal irrigation, sandy loam soil",
        "profile": "Small-medium farmer, kharif, semi-arid",
        "config": {
            "crop_id": "groundnut", "area_acres": 4, "season": "kharif",
            "irrigation_level": 0.3, "seed_variety": "standard",
            "budget_per_acre": 16000, "sowing_date": "2025-06-20",
        },
    },
    {
        "template_id": "diversified_small",
        "name": "Diversified Small Farm",
        "description": "2-acre mixed crop: 1 acre rice kharif + 1 acre wheat rabi for food security",
        "profile": "Marginal farmer, food security focus",
        "config": {
            "crop_id": "rice", "area_acres": 1, "season": "kharif",
            "irrigation_level": 0.4, "seed_variety": "standard",
            "budget_per_acre": 12000, "sowing_date": "2025-06-20",
            "rotation_note": "Follow with wheat on same acre in rabi season",
        },
    },
]


def get_strategy_templates(profile_filter: str | None = None) -> list[dict[str, Any]]:
    if profile_filter:
        pf = profile_filter.lower()
        return [t for t in STRATEGY_TEMPLATES if pf in t["profile"].lower() or pf in t["name"].lower() or pf in t.get("description", "").lower()]
    return STRATEGY_TEMPLATES


# ===========================================================================
# 12. Region Benchmark
# ===========================================================================

def region_benchmark(
    region_id: str,
    crop_id: str,
    user_yield_kg_per_acre: float,
    user_profit_per_acre: float,
) -> dict[str, Any]:
    """Compare user's results against regional historical averages."""
    history = _load_csv("yield_history.csv")
    region_data = [
        float(r["yield_kg_per_acre"]) for r in history
        if r["region_id"] == region_id and r["crop_id"] == crop_id
    ]
    all_data = [
        float(r["yield_kg_per_acre"]) for r in history
        if r["crop_id"] == crop_id
    ]

    if not region_data and not all_data:
        raise ValueError(f"No benchmark data for {crop_id}")

    ref_data = region_data if region_data else all_data
    avg_yield = mean(ref_data)
    max_yield = max(ref_data)
    min_yield = min(ref_data)

    yield_vs_avg = round((user_yield_kg_per_acre - avg_yield) / max(avg_yield, 1) * 100, 2)

    # Estimate regional avg profit from avg yield and crop params
    crop_params = _load_crop_params()
    if crop_id in crop_params:
        crop = crop_params[crop_id]
        avg_price = (crop.mandi_price_min_inr_per_kg + crop.mandi_price_max_inr_per_kg) / 2
        avg_revenue = avg_yield * avg_price
        avg_profit = avg_revenue - crop.avg_input_cost_inr_per_acre
    else:
        avg_profit = 0
        avg_price = 0

    profit_vs_avg = round((user_profit_per_acre - avg_profit) / max(abs(avg_profit), 1) * 100, 2) if avg_profit else 0

    # Percentile rank
    below_user = sum(1 for y in ref_data if y <= user_yield_kg_per_acre)
    percentile = round(below_user / len(ref_data) * 100, 1)

    return {
        "region_id": region_id,
        "crop_id": crop_id,
        "user_yield_kg_per_acre": user_yield_kg_per_acre,
        "user_profit_per_acre": user_profit_per_acre,
        "regional_avg_yield": round(avg_yield, 2),
        "regional_max_yield": round(max_yield, 2),
        "regional_min_yield": round(min_yield, 2),
        "yield_vs_avg_pct": yield_vs_avg,
        "estimated_regional_avg_profit_per_acre": round(avg_profit, 2),
        "profit_vs_avg_pct": profit_vs_avg,
        "yield_percentile": percentile,
        "rating": (
            "Excellent — Top performer in your region!"
            if percentile >= 80 else
            "Good — Above average for your region."
            if percentile >= 50 else
            "Average — Room for improvement. Consider hybrid seeds or better irrigation."
            if percentile >= 25 else
            "Below Average — Review soil health, seed variety, and irrigation strategy."
        ),
        "data_points": len(ref_data),
    }


# ===========================================================================
# 13. Input Cost Tracker
# ===========================================================================

import json
import os
import threading

_expense_file = DATASET_DIR / "expense_store.json"
_store_lock = threading.Lock()


def _load_expenses() -> dict[str, list[dict[str, Any]]]:
    if not _expense_file.exists():
        return {}
    try:
        with _expense_file.open("r", encoding="utf-8") as f:
            return json.load(f)
    except Exception:
        return {}


def _save_expenses(store: dict[str, list[dict[str, Any]]]):
    try:
        temp_file = _expense_file.with_suffix(".tmp")
        with temp_file.open("w", encoding="utf-8") as f:
            json.dump(store, f, indent=2, ensure_ascii=False)
        os.replace(temp_file, _expense_file)
    except Exception:
        pass


def log_expense(
    farm_id: str,
    category: str,
    amount: float,
    date: str | None = None,
    note: str = "",
) -> dict[str, Any]:
    """Log an actual expense against a farm/strategy."""
    with _store_lock:
        store = _load_expenses()
        entries = store.get(farm_id, [])
        entry = {
            "id": len(entries) + 1,
            "category": category,
            "amount": round(amount, 2),
            "date": date or datetime.now().strftime("%Y-%m-%d"),
            "note": note,
        }
        entries.append(entry)
        store[farm_id] = entries
        _save_expenses(store)
        return entry


def get_expense_summary(farm_id: str, planned_budget: float | None = None) -> dict[str, Any]:
    """Get all logged expenses and variance vs planned budget."""
    with _store_lock:
        store = _load_expenses()
        entries = store.get(farm_id, [])
    total_spent = sum(e["amount"] for e in entries)

    by_category: dict[str, float] = {}
    for e in entries:
        by_category[e["category"]] = by_category.get(e["category"], 0) + e["amount"]

    result: dict[str, Any] = {
        "farm_id": farm_id,
        "total_entries": len(entries),
        "total_spent": round(total_spent, 2),
        "by_category": {k: round(v, 2) for k, v in sorted(by_category.items())},
        "entries": entries,
    }

    if planned_budget is not None:
        variance = planned_budget - total_spent
        result["planned_budget"] = planned_budget
        result["variance"] = round(variance, 2)
        result["utilization_pct"] = round(total_spent / max(planned_budget, 1) * 100, 2)
        result["status"] = (
            "Under budget" if variance > planned_budget * 0.1
            else "On track" if variance >= 0
            else "Over budget"
        )
    return result


# ===========================================================================
# 14. Government Scheme Matcher
# ===========================================================================

#: government_schemes.csv stores benefits as slugs, and both the chatbot and the
#: dashboard were rendering them verbatim -- a farmer was shown
#: "Benefit: premium_subsidy" / "Type: cash_transfer". Resolve them once here so
#: every consumer gets the same readable string.
_BENEFIT_TYPE_LABELS = {
    "cash_transfer": "Direct cash transfer",
    "insurance": "Crop insurance",
    "credit": "Credit / loan",
    "advisory": "Free advisory",
    "subsidy": "Input subsidy",
    "price_support": "Price support",
}

_BENEFIT_VALUE_LABELS = {
    "premium_subsidy": "Subsidised insurance premium",
    "4pct_interest": "Interest at 4% a year",
    "free_soil_test": "Free soil test",
    "55pct_irrigation": "55% of irrigation equipment cost",
    "50000_per_ha": "₹50,000 per hectare",
    "seed_subsidy": "Subsidised certified seed",
    "seed_and_equipment": "Subsidised seed and equipment",
    "msp_procurement": "Guaranteed MSP procurement",
    "frp_guaranteed": "Guaranteed fair & remunerative price",
}


def _humanise_benefit(benefit_type: str, benefit_value: str) -> str:
    """Readable one-liner for a scheme's benefit, e.g. `6000` -> `₹6,000 a year`."""
    raw = (benefit_value or "").strip()
    if raw in _BENEFIT_VALUE_LABELS:
        return _BENEFIT_VALUE_LABELS[raw]
    try:
        return f"₹{float(raw):,.0f}"
    except (TypeError, ValueError):
        pass
    return _BENEFIT_TYPE_LABELS.get((benefit_type or "").strip(),
                                    raw.replace("_", " ").capitalize() or "See scheme details")


def match_government_schemes(
    crop_id: str,
    region_id: str = "all",
    area_acres: float = 3,
    season: str = "all",
) -> dict[str, Any]:
    """Match farmer profile to eligible government schemes."""
    schemes = _load_csv("government_schemes.csv")
    if not schemes:
        return {"eligible_schemes": [], "message": "Government schemes database not loaded."}

    eligible = []
    for s in schemes:
        # Crop match
        eligible_crops = s.get("eligible_crops", "all").lower()
        if crop_id.lower() != "all" and eligible_crops != "all" and crop_id.lower() not in eligible_crops:
            continue

        # Region match
        eligible_regions = s.get("eligible_regions", "all").lower()
        if region_id.lower() != "all" and eligible_regions != "all" and region_id.lower() not in eligible_regions:
            continue

        # Area match
        min_area = float(s.get("min_area_acres", 0))
        max_area = float(s.get("max_area_acres", 9999))
        if not (min_area <= area_acres <= max_area):
            continue

        # Season match
        scheme_season = s.get("season", "all").lower()
        if season.lower() != "all" and scheme_season != "all" and season.lower() not in scheme_season:
            continue

        eligible.append({
            "scheme_id": s["scheme_id"],
            "scheme_name": s["scheme_name"],
            "description": s["description"],
            "benefit_type": s["benefit_type"],
            "benefit_value": s["benefit_value"],
            "benefit_label": _humanise_benefit(s["benefit_type"], s["benefit_value"]),
            "benefit_type_label": _BENEFIT_TYPE_LABELS.get(
                s["benefit_type"], s["benefit_type"].replace("_", " ").capitalize()),
            "url": s.get("url", ""),
        })

    return {
        "crop_id": crop_id,
        "region_id": region_id,
        "area_acres": area_acres,
        "eligible_schemes": eligible,
        "total_matched": len(eligible),
    }
