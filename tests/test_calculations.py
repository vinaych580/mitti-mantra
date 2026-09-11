"""
tests/test_calculations.py
Unit tests for utils/calculations.py's pure scoring/math functions.
"""
from __future__ import annotations

from utils.calculations import (
    compute_budget_fit,
    compute_roi_normalized,
    compute_smart_score,
    compute_soil_health,
)


def test_compute_smart_score_weighted_blend():
    score = compute_smart_score(
        roi_normalized=50.0,
        confidence_score=80.0,
        budget_fit=100.0,
        soil_health=90.0,
        ml_term=60.0,
        saturation_penalty=0.0,
    )
    # 0.35*50 + 0.20*80 + 0.15*100 + 0.15*90 + 0.15*60 - 0 = 71.0
    assert score == 71.0


def test_compute_smart_score_saturation_penalty_caps_at_ten_points():
    with_penalty = compute_smart_score(50.0, 80.0, 100.0, 90.0, 60.0, saturation_penalty=40.0)
    without_penalty = compute_smart_score(50.0, 80.0, 100.0, 90.0, 60.0, saturation_penalty=0.0)
    assert without_penalty - with_penalty == 10.0


def test_compute_smart_score_clamps_to_0_100_range():
    assert compute_smart_score(1000, 1000, 1000, 1000, 1000, 0.0) == 100.0
    assert compute_smart_score(-1000, -1000, -1000, -1000, -1000, 0.0) == 0.0


def test_compute_smart_score_saturation_penalty_defaults_to_zero():
    assert compute_smart_score(50.0, 80.0, 100.0, 90.0, 60.0) == 71.0


def test_compute_budget_fit_formula_and_clamp():
    assert compute_budget_fit(budget_per_acre=11000.0, avg_input_cost_inr_per_acre=22000.0) == 50.0
    # Clamped to 120.0 even when budget vastly exceeds input cost
    assert compute_budget_fit(budget_per_acre=1_000_000.0, avg_input_cost_inr_per_acre=1000.0) == 120.0


def test_compute_roi_normalized_formula_and_clamp():
    assert compute_roi_normalized(roi_percent=150.0) == 50.0
    assert compute_roi_normalized(roi_percent=1000.0) == 100.0
    assert compute_roi_normalized(roi_percent=-1000.0) == 0.0


def test_compute_soil_health_formula_and_clamp():
    score = compute_soil_health(
        n_kg_per_acre=50.0, p_kg_per_acre=25.0, k_kg_per_acre=20.0,
        npk_n_kg_per_acre=50.0, npk_p_kg_per_acre=25.0, npk_k_kg_per_acre=20.0,
    )
    assert score == 100.0
    assert compute_soil_health(1000.0, 1000.0, 1000.0, 1.0, 1.0, 1.0) == 120.0


def test_score_single_crop_and_recommendation_dataset_derive_identical_values(monkeypatch):
    """`ml/predict.py::_score_single_crop` and `ml/dataset_builders.py`'s
    `_build_recommendation_dataset` inner scoring block must never silently
    drift apart on budget_fit/roi_normalized/soil_health -- the same class
    of bug that motivated extracting compute_smart_score into this shared
    module (see docs/superpowers/specs/2026-09-06-ml-model-accuracy-design.md,
    section 10). Both call sites now route through compute_budget_fit,
    compute_roi_normalized, and compute_soil_health above; this test proves
    the wiring holds for identical crop/soil/weather/budget inputs, not just
    that the formulas happen to match on paper.
    """
    import ml.dataset_builders as dataset_builders_module
    import ml.predict as predict_module
    from ml.predict import _load_crop_parameters, _score_single_crop

    crop_id = "wheat"
    crop = _load_crop_parameters()[crop_id]
    weather = {"rainfall_mm": 850.0, "avg_temp_c": 24.0}
    soil = {"n_kg_per_acre": 55.0, "p_kg_per_acre": 25.0, "k_kg_per_acre": 30.0, "ph": 6.8}
    budget_per_acre = 18000.0

    # Pin the yield fed to both paths so `roi_normalized` traces back to
    # the same profit_estimator() inputs on each side (predict.py's own
    # yield lookup can apply a historical-average adjustment that
    # dataset_builders.py's synthetic labels intentionally never do).
    predicted_yield = dataset_builders_module.calculate_yield_kg_per_acre(
        crop, soil, weather, irrigation_level=0.5,
    )

    captured_predict_kwargs: dict[str, float] = {}
    real_compute_smart_score = predict_module.compute_smart_score

    def capturing_compute_smart_score(**kwargs):
        captured_predict_kwargs.update(kwargs)
        return real_compute_smart_score(**kwargs)

    monkeypatch.setattr(predict_module, "compute_smart_score", capturing_compute_smart_score)

    _score_single_crop(
        crop_id=crop_id, crop=crop, weather=weather, soil=soil,
        region_id="mp_sehore", season="rabi",
        budget_per_acre=budget_per_acre, area_acres=1.0,
        region_crop_price={}, ml_conf_map={}, region_saturation={},
        ml_yield=predicted_yield,
    )

    # ml/dataset_builders.py's inner scoring block, reproduced call-for-call
    # (it is inline in _build_recommendation_dataset's sampling loop, not an
    # independently callable unit) with the same crop/soil/weather/budget.
    price = (crop.mandi_price_min_inr_per_kg + crop.mandi_price_max_inr_per_kg) / 2.0
    profit = dataset_builders_module.profit_estimator(
        crop_id=crop_id, predicted_yield_kg_per_acre=predicted_yield,
        area_acres=1.0, budget_per_acre=budget_per_acre, mandi_price_per_kg=price,
    )
    dataset_budget_fit = dataset_builders_module.compute_budget_fit(
        budget_per_acre, crop.avg_input_cost_inr_per_acre,
    )
    dataset_roi_normalized = dataset_builders_module.compute_roi_normalized(profit["roi_percent"])
    dataset_soil_health = dataset_builders_module.compute_soil_health(
        soil["n_kg_per_acre"], soil["p_kg_per_acre"], soil["k_kg_per_acre"],
        crop.npk_n_kg_per_acre, crop.npk_p_kg_per_acre, crop.npk_k_kg_per_acre,
    )

    assert captured_predict_kwargs["budget_fit"] == dataset_budget_fit
    assert captured_predict_kwargs["roi_normalized"] == dataset_roi_normalized
    assert captured_predict_kwargs["soil_health"] == dataset_soil_health
