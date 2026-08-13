"""
tests/test_engine_features.py
Unit tests for engine/features.py agronomic calculations and financial tools.
"""
from __future__ import annotations

import pytest
from engine.features import (
    fertilizer_recommendation,
    irrigation_schedule,
    get_crop_calendar,
    loan_calculator,
    soil_health_projection,
    cross_mandi_arbitrage,
)


def test_fertilizer_recommendation():
    soil = {"ph": 6.8, "n_kg_per_acre": 25.0, "p_kg_per_acre": 12.0, "k_kg_per_acre": 15.0}
    res = fertilizer_recommendation("wheat", soil)
    assert "soil_npk" in res
    assert "crop_requirement_npk" in res
    assert "recommendations" in res


def test_irrigation_schedule():
    res = irrigation_schedule("cotton", "2025-06-15", rainfall_mm=450.0, irrigation_level=0.7)
    assert "crop_id" in res
    assert "weekly_schedule" in res or "total_irrigation_mm" in res


def test_crop_calendar():
    res = get_crop_calendar("soybean", season="kharif")
    assert res["crop_id"] == "soybean"
    assert "calendar" in res
    assert "sowing_transplant" in res["calendar"]
    assert "harvest_window" in res["calendar"]


def test_loan_calculator():
    res = loan_calculator(
        total_cost=60000.0,
        expected_profit=45000.0,
        interest_rate_annual=4.0,
        tenure_months=12,
    )
    assert res["emi"] > 0
    assert res["debt_service_coverage_ratio"] > 0
    assert "SAFE" in res["verdict"] or "FEASIBLE" in res["verdict"] or "RISKY" in res["verdict"]


def test_soil_health_projection():
    current_soil = {"ph": 6.5, "n_kg_per_acre": 30.0, "organic_carbon_pct": 0.5}
    rotation = [{"crop_id": "soybean", "season": "kharif"}, {"crop_id": "wheat", "season": "rabi"}]
    res = soil_health_projection(current_soil, rotation, years=5, apply_fertilizer=True)
    assert "timeline" in res
    assert len(res["timeline"]) > 5
    assert "initial_soil" in res
    assert "final_soil" in res


def test_cross_mandi_arbitrage():
    res = cross_mandi_arbitrage("soybean")
    assert res["crop_id"] == "soybean"
    assert "opportunities" in res
