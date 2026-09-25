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
    from utils import commitment_log, db
    monkeypatch.setattr(db, "DB_PATH", tmp_path / "agrisim.db")

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
    from utils import commitment_log, db
    monkeypatch.setattr(db, "DB_PATH", tmp_path / "agrisim.db")

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


def test_score_single_crop_penalizes_severe_loss_more_than_mild_loss():
    """compute_roi_normalized() floors every negative ROI to 0, so a crop
    losing 90% of the investment used to score identically, on that term, to
    one losing 8% -- this is the fix for a real case where a -28% ROI crop
    (jute) still out-ranked a +129% ROI crop (turmeric) as the top pick. The
    penalty is applied only in _score_single_crop (see the comment above its
    `if profit["roi_percent"] < 0` block), not in compute_roi_normalized
    itself, because ml/dataset_builders.py's synthetic training-label
    formula shares that function and depends on the floor to keep staples
    competitive (see test_build_recommendation_dataset_staples_are_recommendable).
    """
    from ml.predict import _score_single_crop, _load_crop_parameters, _prepare_region_data

    crop_params = _load_crop_parameters()
    weather, soil = _prepare_region_data("telangana_medak", "kharif")
    crop = crop_params["rice"]
    common_kwargs = dict(
        crop_id="rice", crop=crop, weather=weather, soil=soil,
        region_id="telangana_medak", season="kharif",
        budget_per_acre=15000.0, area_acres=3.0,
        ml_conf_map={}, region_saturation={},
    )

    # Same crop/soil/weather/budget -- only the mandi price differs, so it's
    # only ROI (and everything downstream of it) that moves between calls.
    mild_loss = _score_single_crop(**common_kwargs, region_crop_price={"rice": 18.0})
    severe_loss = _score_single_crop(**common_kwargs, region_crop_price={"rice": 3.0})

    assert mild_loss["roi_percent"] < 0
    assert severe_loss["roi_percent"] < mild_loss["roi_percent"]
    assert severe_loss["smart_score"] < mild_loss["smart_score"]


def test_recommend_crops_never_ranks_a_loss_above_a_clear_profit():
    """End-to-end regression for the reported bug: a crop that loses money
    under the farmer's budget (jute, at the time) must not outscore a crop
    that clearly profits under the same budget, nor be the top pick.

    Which crops land on each side depends on the trained yield model -- a
    retrain moved jute from -28% to +126% ROI here -- so this checks every
    clear loss against every clear profit rather than naming crops.
    """
    from ml.predict import recommend_crops

    recs = recommend_crops("telangana_medak", "kharif", 15000.0, 6.14, top_k=50)
    losses = [r for r in recs if r["roi_percent"] < -30]
    profits = [r for r in recs if r["roi_percent"] > 50]

    assert losses and profits, "scenario no longer has both a clear loss and a clear profit"
    assert recs[0]["roi_percent"] > 0
    worst_profit = min(profits, key=lambda r: r["smart_score"])
    best_loss = max(losses, key=lambda r: r["smart_score"])
    assert best_loss["smart_score"] < worst_profit["smart_score"], (best_loss, worst_profit)
