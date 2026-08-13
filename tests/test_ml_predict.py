"""
tests/test_ml_predict.py
Unit tests for ml/predict.py algorithms, parameter validation, and fallback handling.
"""
from __future__ import annotations

import pytest
from ml.predict import (
    predict_yield_kg_per_acre,
    smart_risk_score,
    profit_estimator,
    mandi_price_analytics,
    rotation_planner,
    location_based_insights,
)


def test_predict_yield_unsupported_crop_raises():
    weather = {"rainfall_mm": 900, "avg_temp_c": 28}
    soil = {"ph": 6.8, "n_kg_per_acre": 40}
    with pytest.raises(ValueError, match="Unsupported crop_id"):
        predict_yield_kg_per_acre("dragonfruit_unknown", "mp_sehore", "kharif", weather, soil)


def test_smart_risk_score_validation():
    weather = {"rainfall_mm": 800, "avg_temp_c": 27}
    soil = {"ph": 7.0, "n_kg_per_acre": 50}

    # Negative budget should raise ValueError
    with pytest.raises(ValueError):
        smart_risk_score("soybean", weather, soil, budget_per_acre=-500)

    # Irrigation level > 1.0 should raise ValueError
    with pytest.raises(ValueError):
        smart_risk_score("soybean", weather, soil, budget_per_acre=15000, irrigation_level=1.5)

    # Valid run
    res = smart_risk_score("soybean", weather, soil, budget_per_acre=15000, irrigation_level=0.6)
    assert 0 <= res["risk_score"] <= 100
    assert 0 <= res["confidence_score"] <= 100


def test_profit_estimator_calculations():
    res = profit_estimator(
        crop_id="wheat",
        predicted_yield_kg_per_acre=1500.0,
        area_acres=4.0,
        budget_per_acre=12000.0,
        mandi_price_per_kg=22.75,
    )
    assert res["expected_revenue"] == 1500.0 * 4.0 * 22.75
    assert res["expected_profit"] == res["expected_revenue"] - (12000.0 * 4.0)
    assert res["break_even_price_per_kg"] == round((12000.0 * 4.0) / (1500.0 * 4.0), 2)


def test_mandi_price_analytics_structure():
    res = mandi_price_analytics("mp_sehore", "soybean")
    assert res["region_id"] == "mp_sehore"
    assert res["crop_id"] == "soybean"
    assert "trend_direction" in res
    assert "moving_avg_3m" in res
    assert len(res["moving_avg_3m"]) > 0


def test_rotation_planner_combos():
    res = rotation_planner("mh_pune", budget_per_acre=20000, area_acres=5.0)
    assert res["best_rotation"] is not None
    assert "annual_profit" in res["best_rotation"]
    assert len(res["top_rotations"]) <= 5


def test_location_based_insights():
    res = location_based_insights("up_lucknow", season="kharif")
    assert res["region_id"] == "up_lucknow"
    assert "rainfall_trend_hint" in res
    assert len(res["best_priced_local_crops"]) > 0
