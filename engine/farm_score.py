"""
Farm Score: a single blended letter-grade that fuses the platform's existing
signals (crop recommendation ranking, ROI, risk, optional satellite/NDVI
field health, and pest pressure) into one headline number.

Every input here is computed by the same engine functions the dashboard's
individual tools already call — this module only re-weights and combines
their outputs. Nothing new is predicted or measured.
"""
from __future__ import annotations

from typing import Any, Optional

from utils.calculations import calculate_ndvi_and_field_health, clamp, compute_roi_normalized
from utils.csv_cache import index_by as _csv_index
from ml.predict import recommend_crops
from engine.features import pest_disease_alerts


def _region_weather(region_id: str, season: str) -> dict[str, float]:
    rows = _csv_index("weather.csv", "region_id").get(region_id, [])
    if season:
        season_rows = [r for r in rows if r.get("season") == season]
        if season_rows:
            rows = season_rows
    if not rows:
        return {"avg_temp_c": 27.0, "rainfall_mm": 600.0}
    latest = rows[-1]
    return {
        "avg_temp_c": float(latest.get("avg_temp_c", 27.0)),
        "rainfall_mm": float(latest.get("rainfall_mm", 600.0)),
    }


def _grade(score: float) -> str:
    if score >= 90:
        return "A+"
    if score >= 80:
        return "A"
    if score >= 70:
        return "B+"
    if score >= 60:
        return "B"
    if score >= 50:
        return "C"
    if score >= 35:
        return "D"
    return "F"


def compute_farm_score(
    region_id: str,
    season: str,
    budget_per_acre: float,
    area_acres: float,
    crop_id: Optional[str] = None,
    lat: Optional[float] = None,
    lon: Optional[float] = None,
) -> dict[str, Any]:
    """Blend recommendation, risk, optional field-health and pest signals into one score."""
    recs = recommend_crops(region_id, season, budget_per_acre, area_acres, top_k=8)
    if not recs:
        raise ValueError(
            f"No crop recommendations available for region '{region_id}' in season '{season}'"
        )

    chosen = recs[0]
    if crop_id:
        match = next((r for r in recs if r["crop_id"] == crop_id), None)
        if match:
            chosen = match

    pillars: dict[str, float] = {
        "profitability": round(compute_roi_normalized(chosen["roi_percent"]), 1),
        "risk_resilience": round(clamp(100.0 - chosen["risk_score"], 0.0, 100.0), 1),
        "market_fit": round(clamp(chosen["smart_score"], 0.0, 100.0), 1),
    }
    weights: dict[str, float] = {
        "profitability": 0.35,
        "risk_resilience": 0.30,
        "market_fit": 0.20,
    }

    if lat is not None and lon is not None:
        try:
            ndvi = calculate_ndvi_and_field_health(lat, lon, chosen["crop_id"], area_acres)
            pillars["field_health"] = round(clamp(ndvi["mean_ndvi"] * 115.0, 0.0, 100.0), 1)
            weights["field_health"] = 0.15
        except Exception:
            pass

    try:
        weather = _region_weather(region_id, season)
        alert_res = pest_disease_alerts(chosen["crop_id"], weather)
        alerts = alert_res.get("alerts", [])
        high = sum(1 for a in alerts if a.get("risk_level") == "HIGH")
        moderate = sum(1 for a in alerts if a.get("risk_level") == "MODERATE")
        pillars["pest_pressure"] = round(clamp(100.0 - high * 20.0 - moderate * 8.0, 0.0, 100.0), 1)
        weights["pest_pressure"] = 0.15
    except Exception:
        pass

    weight_sum = sum(weights.values())
    total = round(clamp(sum(pillars[k] * (weights[k] / weight_sum) for k in pillars), 0.0, 100.0), 1)

    return {
        "farm_score": total,
        "grade": _grade(total),
        "recommended_crop": chosen["crop_id"],
        "crop_name": chosen.get("crop_name"),
        "pillars": pillars,
        "weights": {k: round(v / weight_sum, 2) for k, v in weights.items()},
        "top_alternatives": [r["crop_id"] for r in recs[1:4] if r["crop_id"] != chosen["crop_id"]],
        "prediction_source": chosen.get("prediction_source", "heuristic"),
        "disclaimer": (
            "A planning aid blending yield/profit, risk, market fit, and (when available) "
            "field-health and pest-pressure signals from the platform's own tools. Not a "
            "certified rating, credit score, or guarantee of outcome."
        ),
    }
