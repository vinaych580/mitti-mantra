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


# ---------------------------------------------------------------------------
# Effective rainfall in the climate-risk score.
#
# The risk score used to compare a season's *total* rainfall with a crop's
# water requirement, so any normal monsoon looked like a flood to a crop that
# needs little water: Sehore's 1,209 mm kharif gave soybean -- the district's
# main kharif crop -- a 95% flood risk, while jute (1,400 mm requirement, not
# grown anywhere in Madhya Pradesh) scored 0% and topped the recommendation.
# ---------------------------------------------------------------------------
from utils.calculations import calculate_risk_score_and_subscores, effective_rainfall_mm  # noqa: E402
from ml.predict import _load_crop_parameters  # noqa: E402


def test_effective_rainfall_follows_usda_scs_and_is_continuous():
    # <= 250 mm/month: P(125 - 0.2P)/125 per month
    assert abs(effective_rainfall_mm(400, months=4) - 4 * 100 * (125 - 20) / 125) < 1e-9
    # > 250 mm/month: 125 + 0.1P per month
    assert abs(effective_rainfall_mm(1200, months=4) - 4 * (125 + 30)) < 1e-9
    # the two branches meet at 250 mm/month
    assert abs(effective_rainfall_mm(1000 - 1e-6, months=4) - effective_rainfall_mm(1000 + 1e-6, months=4)) < 1e-3
    assert effective_rainfall_mm(0) == 0
    # never more than what fell
    for p in (10, 100, 500, 1500, 3000):
        assert 0 < effective_rainfall_mm(p) <= p


def test_normal_monsoon_is_not_a_flood_for_a_low_water_crop():
    crops = _load_crop_parameters()
    weather = {"rainfall_mm": 1209.2, "avg_temp_c": 26.6}
    soil = {}
    _, soy = calculate_risk_score_and_subscores(crops["soybean"], weather, soil)
    _, jute = calculate_risk_score_and_subscores(crops["jute"], weather, soil)
    assert soy["flood"] < 20, soy
    # jute needs 1,400 mm; a central-Indian monsoon doesn't deliver that to the crop
    assert jute["drought"] > soy["drought"], (jute, soy)


def test_jute_does_not_top_central_indian_kharif_recommendations():
    from ml.predict import recommend_crops
    for region in ("mp_sehore", "mh_pune", "telangana_medak"):
        top = recommend_crops(region, "kharif", 15000, 4, top_k=3)
        assert top[0]["crop_id"] != "jute", (region, [r["crop_id"] for r in top])


def test_recommendations_say_whether_the_district_has_grown_the_crop():
    from ml.predict import recommend_crops
    by_crop = {r["crop_id"]: r for r in recommend_crops("wb_bardhaman", "kharif", 15000, 4, top_k=50)}
    assert by_crop["jute"]["grown_locally"] is True     # yield_history.csv: Bardhaman jute
    guntur = {r["crop_id"]: r for r in recommend_crops("ap_guntur", "kharif", 15000, 4, top_k=50)}
    assert guntur["jute"]["grown_locally"] is False     # no Guntur jute on record
    assert guntur["chilli"]["grown_locally"] is True
