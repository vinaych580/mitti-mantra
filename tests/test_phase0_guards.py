"""
tests/test_phase0_guards.py

Regression tests for Phase 0 (docs/superpowers/specs/2026-11-11-phase0-stabilise-design.md):
ranking guards (N-3, N-4, N-6), budget spend cap (N-7), input bounds and
errors (N-8, N-17 to N-20), and the stale price forecast (N-9).
"""
from __future__ import annotations

from datetime import datetime

import pytest
from fastapi.testclient import TestClient

import ml.predict as P
from backend.main import app

client = TestClient(app)

# The region/season pairs named in the 2026-11-11 defect register.
DEFECT_PAIRS = [
    ("telangana_medak", "zaid"), ("up_lucknow", "zaid"), ("punjab_ludhiana", "zaid"),
    ("wb_bardhaman", "kharif"), ("punjab_ludhiana", "kharif"), ("punjab_ludhiana", "rabi"),
    ("tn_thanjavur", "kharif"), ("guj_anand", "kharif"),
]


# --- 0.2 ranking guards ---------------------------------------------------

def test_losing_crops_follow_in_order_of_smallest_loss():
    recs = [
        {"crop_id": "jowar", "expected_profit": -58794, "smart_score": 50},
        {"crop_id": "rice", "expected_profit": -4152, "smart_score": 20},
        {"crop_id": "jute", "expected_profit": 9000, "smart_score": 10},
    ]
    assert [r["crop_id"] for r in P.rank_recommendations(recs)] == ["jute", "rice", "jowar"]


def test_loss_guard_drops_losers_when_any_crop_pays():
    ranked = P.rank_recommendations([
        {"crop_id": "a", "expected_profit": 100, "smart_score": 10},
        {"crop_id": "b", "expected_profit": -5, "smart_score": 90},
    ])
    guarded = P.apply_loss_guard(ranked, "kharif")
    assert [r["crop_id"] for r in guarded] == ["a"]
    assert "all_options_lose" not in guarded[0]


def test_loss_guard_flags_a_list_where_everything_loses():
    ranked = [
        {"crop_id": "a", "expected_profit": -5, "smart_score": 10, "budget_adequate": False},
        {"crop_id": "b", "expected_profit": -50, "smart_score": 90, "budget_adequate": False},
    ]
    guarded = P.apply_loss_guard(ranked, "kharif")
    assert len(guarded) == 2
    assert all(r["all_options_lose"] and r["loss_reason"] == "budget_too_low" for r in guarded)


@pytest.mark.parametrize("region_id,season", DEFECT_PAIRS)
def test_recommend_shows_no_loss_beside_a_profit(region_id, season):
    response = client.post("/api/recommend", json={
        "region_id": region_id, "season": season, "budget_per_acre": 15000, "area_acres": 4,
    })
    assert response.status_code == 200, response.text
    recs = response.json()
    assert recs, "a short list is fine, an empty one is not"
    profits = [r["expected_profit"] for r in recs]
    if any(p > 0 for p in profits):
        assert all(p > 0 for p in profits), profits
    else:
        assert all(r["all_options_lose"] for r in recs)


def test_tiny_budget_says_every_option_loses():
    recs = P.recommend_crops("telangana_medak", "kharif", 500, 4)
    assert recs and all(r["all_options_lose"] for r in recs)
    assert recs[0]["loss_reason"] == "budget_too_low"


@pytest.mark.parametrize("region_id", ["telangana_medak", "up_lucknow", "punjab_ludhiana"])
def test_zaid_moong_is_not_a_near_zero_yield(region_id):
    """N-3: moong came out at 6-16 kg/acre because zaid rain was scored as its water."""
    weather, soil = P._prepare_region_data(region_id, "zaid")
    yield_kg, used_ml = P._predict_yield_with_source("moong", region_id, "zaid", weather, soil)
    assert yield_kg > 200
    assert used_ml is False  # zaid uses the heuristic until Phase 2


def test_zaid_irrigation_still_matters():
    weather, soil = P._prepare_region_data("telangana_medak", "zaid")
    low, _ = P._predict_yield_with_source("watermelon", "telangana_medak", "zaid", weather, soil, 0.0)
    high, _ = P._predict_yield_with_source("watermelon", "telangana_medak", "zaid", weather, soil, 1.0)
    assert high > low


def test_validation_report_checks_answers_not_just_shape():
    from ml.train_models import evaluate_validation_cases

    report = evaluate_validation_cases()
    assert report["total"] == 5
    for case in report["test_cases"]:
        assert case["expected_any_of"]
        assert (case["status"] == "PASS") == (not case["failures"])
        assert len(case["top_three"]) <= 3
    assert "Phase 2" in report["note"]


# --- 0.3 budget default and overspend --------------------------------------

def test_profit_rises_to_typical_cost_and_is_flat_beyond_the_spend_cap():
    crop = P._load_crop_parameters()["cotton"]
    typical = crop.avg_input_cost_inr_per_acre
    budgets = [typical * f for f in (0.4, 0.6, 0.8, 1.0)]
    profits = [P.profit_estimator("cotton", 1000, 1, b, 70)["expected_profit"] for b in budgets]
    assert profits == sorted(profits)
    capped = typical * P.SPEND_HEADROOM
    at_cap = P.profit_estimator("cotton", 1000, 1, capped, 70)
    beyond = P.profit_estimator("cotton", 1000, 1, typical * 3, 70)
    assert beyond["expected_profit"] == at_cap["expected_profit"]
    assert beyond["unspent_budget"] == pytest.approx(typical * 3 - capped)
    # Spending to the cap costs at most the headroom over the typical cost.
    full = P.profit_estimator("cotton", 1000, 1, typical, 70)["expected_profit"]
    assert full - at_cap["expected_profit"] <= typical * (P.SPEND_HEADROOM - 1) + 1e-6


def test_typical_budget_default():
    rice = P._load_crop_parameters()["rice"].avg_input_cost_inr_per_acre
    assert P.typical_budget_per_acre("telangana_medak", "kharif", "rice") == rice
    median = P.typical_budget_per_acre("telangana_medak", "kharif")
    assert median > 15000  # the old flat default sat below most major crops


def test_budget_default_endpoint():
    response = client.get("/api/budget-default", params={"region_id": "telangana_medak", "season": "Kharif"})
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["budget_per_acre"] > 0 and body["basis"] == "median_in_season"
    response = client.get("/api/budget-default", params={
        "region_id": "telangana_medak", "season": "kharif", "crop_id": "cotton"})
    assert response.json()["basis"] == "crop_typical_cost"
    assert client.get("/api/budget-default", params={"region_id": "nowhere", "season": "kharif"}).status_code == 400


# --- 0.4 input bounds and errors -------------------------------------------

@pytest.mark.parametrize("patch", [
    {"area_acres": 1e9}, {"budget_per_acre": 1e12}, {"area_acres": 0}, {"budget_per_acre": -1},
])
def test_recommend_rejects_absurd_inputs(patch):
    body = {"region_id": "telangana_medak", "season": "kharif", "budget_per_acre": 15000, "area_acres": 4}
    assert client.post("/api/recommend", json={**body, **patch}).status_code == 422


def test_crop_query_rejects_absurd_area():
    response = client.get("/api/crop", params={
        "region_id": "telangana_medak", "season": "kharif", "budget_per_acre": 15000, "area_acres": 1e9})
    assert response.status_code == 422


def test_season_is_case_insensitive_and_errors_name_the_field():
    upper = P.recommend_crops("telangana_medak", "KHARIF", 25000, 4)
    lower = P.recommend_crops("telangana_medak", "kharif", 25000, 4)
    assert [r["crop_id"] for r in upper] == [r["crop_id"] for r in lower]
    with pytest.raises(ValueError, match="^season:"):
        P.recommend_crops("telangana_medak", "winter", 25000, 4)
    with pytest.raises(ValueError, match="^region_id:"):
        P.recommend_crops("atlantis", "kharif", 25000, 4)


def test_invalid_sowing_date_is_422():
    response = client.get("/api/irrigation-schedule/rice", params={"sowing_date": "2026-13-45"})
    assert response.status_code == 422
    response = client.get("/api/irrigation", params={"crop_id": "rice", "sowing_date": "2026-13-45"})
    assert response.status_code == 422


def test_default_sowing_date_is_the_next_calendar_date():
    from engine.features import default_sowing_date

    assert default_sowing_date("rice", datetime(2026, 11, 11)) == "2027-06-15"
    assert default_sowing_date("rice", datetime(2026, 3, 1)) == "2026-06-15"
    response = client.get("/api/irrigation-schedule/rice")
    body = response.json()
    assert body["sowing_date_defaulted"] is True
    assert body["sowing_date"] >= datetime.now().strftime("%Y-%m-%d")
    assert body["harvest_date"] > body["sowing_date"]


def test_location_insights_lists_each_crop_once():
    result = client.get("/api/location-insights/telangana_medak").json()
    crops = [r["crop_id"] for r in result["best_priced_local_crops"]]
    assert len(crops) == len(set(crops))


def test_forecast_unknown_ids_are_404():
    assert client.get("/api/price-forecast/telangana_medak/dragonfruit").status_code == 404
    assert client.get("/api/price-forecast/atlantis/rice").status_code == 404


# --- 0.5 stale price forecast ----------------------------------------------

def test_forecast_starts_this_month_and_flags_stale_data():
    body = client.get("/api/price-forecast/telangana_medak/rice").json()
    assert "data_through" in body
    this_month = datetime.now().strftime("%Y-%m")
    months = [f["month"] for f in body["forecasts"]]
    assert months and months[0] >= this_month
    assert len(months) == 6
    if body["stale"]:
        assert all(f["confidence"] == "low" for f in body["forecasts"])


def test_price_freshness_threshold():
    from engine.features import price_freshness

    today = datetime(2026, 11, 11)
    assert price_freshness("2026-10-01", today)["stale"] is False
    assert price_freshness("2025-12-01", today)["stale"] is True


def test_sell_advisor_reports_freshness():
    body = client.get("/api/sell-advisor/telangana_medak/rice").json()
    assert "stale" in body and "data_through" in body
