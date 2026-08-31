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
    # wheat's avg_input_cost_inr_per_acre is 22000, so a 12000 budget only covers
    # part of the crop's typical input cost and the achievable yield is scaled
    # down accordingly -- see _budget_yield_multiplier.
    res = profit_estimator(
        crop_id="wheat",
        predicted_yield_kg_per_acre=1500.0,
        area_acres=4.0,
        budget_per_acre=12000.0,
        mandi_price_per_kg=22.75,
    )
    multiplier = res["budget_yield_multiplier"]
    assert 0.0 < multiplier < 1.0
    achievable_yield = round(1500.0 * multiplier, 2)
    assert res["achievable_yield_kg_per_acre"] == achievable_yield
    assert res["expected_revenue"] == round(achievable_yield * 4.0 * 22.75, 2)
    assert res["expected_profit"] == round(res["expected_revenue"] - (12000.0 * 4.0), 2)
    assert res["break_even_price_per_kg"] == round(
        (12000.0 * 4.0) / (achievable_yield * 4.0), 2
    )


def test_profit_estimator_full_budget_uses_full_yield():
    # A budget at or above the crop's avg input cost should not derate yield.
    res = profit_estimator(
        crop_id="wheat",
        predicted_yield_kg_per_acre=1500.0,
        area_acres=4.0,
        budget_per_acre=22000.0,
        mandi_price_per_kg=22.75,
    )
    assert res["budget_yield_multiplier"] == 1.0
    assert res["achievable_yield_kg_per_acre"] == 1500.0
    assert res["expected_revenue"] == 1500.0 * 4.0 * 22.75


def test_profit_estimator_token_budget_no_longer_shows_absurd_roi():
    # Regression test: a token budget (e.g. Rs 10/acre) used to produce 700%+ ROI
    # because cost collapsed to near-zero while revenue stayed at the full,
    # budget-independent predicted yield. A budget this far below wheat's
    # avg_input_cost_inr_per_acre (22000) should now be honest: near-total crop
    # failure and a near-total loss of the (tiny) money spent, not a preserved
    # profit ratio.
    res = profit_estimator(
        crop_id="wheat",
        predicted_yield_kg_per_acre=2000.0,
        area_acres=4.0,
        budget_per_acre=10.0,
        mandi_price_per_kg=22.75,
    )
    assert res["roi_percent"] < -90.0
    # achievable_yield_kg_per_acre rounds to 0.0 at this budget, so total_yield
    # is 0 -- break_even_price_per_kg must reflect that break-even is
    # unreachable (>= total cost), never the misleading "Rs 0/kg" a naive
    # zero-yield ternary would report.
    assert res["achievable_yield_kg_per_acre"] == 0.0
    assert res["break_even_price_per_kg"] == 40.0


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
