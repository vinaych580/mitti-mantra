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


def test_compute_region_saturation_zero_when_no_commitments():
    from ml.predict import _compute_region_saturation, _load_crop_parameters
    crop_params = _load_crop_parameters()
    result = _compute_region_saturation("telangana_medak", "kharif", ["rice"], crop_params, year=2099)
    assert result["rice"]["ratio"] == 0.0
    assert result["rice"]["label"] is None


def test_compute_region_saturation_no_baseline_omits_crop():
    from ml.predict import _compute_region_saturation, _load_crop_parameters
    crop_params = _load_crop_parameters()
    result = _compute_region_saturation("telangana_medak", "kharif", ["dragonfruit_unknown"], crop_params, year=2099)
    assert "dragonfruit_unknown" not in result


def test_compute_region_saturation_ratio_from_real_commitment(monkeypatch, tmp_path):
    from utils import commitment_log
    monkeypatch.setattr(commitment_log, "_COMMITMENTS_PATH", tmp_path / "commitments.csv")

    from ml.predict import _compute_region_saturation, _load_crop_parameters
    crop_params = _load_crop_parameters()

    # telangana_medak/rice/kharif historical area_acres: 170887 (2022), 94356
    # (2023), 111410 (2024) -> average exactly 125551.0.
    commitment_log.upsert(
        region_id="telangana_medak", crop_id="rice", season="kharif",
        year=2099, area_acres=125551.0, device_id="dev_test",
    )
    result = _compute_region_saturation("telangana_medak", "kharif", ["rice"], crop_params, year=2099)
    assert result["rice"]["ratio"] == pytest.approx(1.0)
    assert result["rice"]["label"] == "100% of typical Rice (Paddy) acreage already committed this season"


def test_compute_region_saturation_ratio_clamped_at_two(monkeypatch, tmp_path):
    from utils import commitment_log
    monkeypatch.setattr(commitment_log, "_COMMITMENTS_PATH", tmp_path / "commitments.csv")

    from ml.predict import _compute_region_saturation, _load_crop_parameters
    crop_params = _load_crop_parameters()

    commitment_log.upsert(
        region_id="telangana_medak", crop_id="rice", season="kharif",
        year=2099, area_acres=125551.0 * 5, device_id="dev_test",
    )
    result = _compute_region_saturation("telangana_medak", "kharif", ["rice"], crop_params, year=2099)
    assert result["rice"]["ratio"] == pytest.approx(2.0)


def test_score_single_crop_applies_capped_saturation_penalty():
    from ml.predict import _score_single_crop, _load_crop_parameters, _prepare_region_data

    crop_params = _load_crop_parameters()
    weather, soil = _prepare_region_data("telangana_medak", "kharif")
    crop = crop_params["rice"]
    common_kwargs = dict(
        crop_id="rice", crop=crop, weather=weather, soil=soil,
        region_id="telangana_medak", season="kharif",
        budget_per_acre=15000.0, area_acres=3.0,
        region_crop_price={}, ml_conf_map={},
    )

    baseline = _score_single_crop(**common_kwargs, region_saturation={})
    half_saturated = _score_single_crop(
        **common_kwargs, region_saturation={"rice": {"ratio": 1.0, "label": "x"}},
    )
    fully_saturated = _score_single_crop(
        **common_kwargs, region_saturation={"rice": {"ratio": 2.0, "label": "x"}},
    )

    assert baseline["smart_score"] == pytest.approx(half_saturated["smart_score"] + 5.0, abs=0.01)
    assert baseline["smart_score"] == pytest.approx(fully_saturated["smart_score"] + 10.0, abs=0.01)
    # Cap holds even past ratio=2.0 (defensive -- _compute_region_saturation
    # already clamps to [0, 2], but _score_single_crop must not trust that).
    over_saturated = _score_single_crop(
        **common_kwargs, region_saturation={"rice": {"ratio": 5.0, "label": "x"}},
    )
    assert baseline["smart_score"] == pytest.approx(over_saturated["smart_score"] + 10.0, abs=0.01)


def test_score_single_crop_no_baseline_means_no_penalty():
    from ml.predict import _score_single_crop, _load_crop_parameters, _prepare_region_data

    crop_params = _load_crop_parameters()
    weather, soil = _prepare_region_data("telangana_medak", "kharif")
    crop = crop_params["rice"]
    entry = _score_single_crop(
        crop_id="rice", crop=crop, weather=weather, soil=soil,
        region_id="telangana_medak", season="kharif",
        budget_per_acre=15000.0, area_acres=3.0,
        region_crop_price={}, ml_conf_map={}, region_saturation={},
    )
    assert entry["saturation_ratio"] is None
    assert entry["saturation_label"] is None
