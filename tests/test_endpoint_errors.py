"""
tests/test_endpoint_errors.py
Regression tests for error handling and fallbacks fixed in the code-quality pass.

- /api/soil and /api/weather raised a deliberate 404 inside a broad
  `except Exception` that re-wrapped it as a 400 ("404: ... not found").
- /api/market and /api/batch-simulate fell back to a flat, made-up
  25 INR/kg for any crop with no local mandi history.
- The chatbot's recommend intent missed plural phrasings ("suggestions",
  "recommendations").
"""
from __future__ import annotations

from fastapi.testclient import TestClient

from backend.chatbot import answer
from backend.main import app

client = TestClient(app)


def test_unknown_region_soil_is_404_not_400():
    response = client.get("/api/soil?region_id=nowhere_at_all")
    assert response.status_code == 404


def test_unknown_region_weather_is_404_not_400():
    response = client.get("/api/weather?region_id=nowhere_at_all&season=kharif")
    assert response.status_code == 404


def test_market_without_history_uses_crop_reference_price():
    # Tea is sold at auction, not in mandis: Agmarknet has no tea series, so
    # no region ever has tea rows in dataset/mandi_prices.csv. (This used
    # mp_indore rice, which the measured Phase 1 data now covers.)
    data = client.get("/api/market?region_id=mp_indore&crop_id=tea").json()
    assert data["price_source"] == "crop_reference"
    # crop_parameters.csv: tea mandi band 140-260 INR/kg -> midpoint 200.
    assert data["current_mandi_price_inr_per_kg"] == 200.0


def test_market_with_history_reports_mandi_source():
    data = client.get("/api/market?region_id=telangana_medak&crop_id=rice").json()
    assert data["price_source"] == "mandi_history"


def test_market_unknown_crop_is_404():
    response = client.get("/api/market?region_id=mp_indore&crop_id=not_a_crop")
    assert response.status_code == 404


def test_batch_simulate_reports_unknown_crop_instead_of_inventing_a_price():
    response = client.post("/api/batch-simulate", json={
        "crop_ids": ["rice", "not_a_crop"],
        "area_acres": 2,
        "region_id": "mp_indore",
        "budget_per_acre": 15000,
        "irrigation_level": 0.5,
        "soil": {"ph": 6.8, "n_kg_per_acre": 40, "p_kg_per_acre": 20, "k_kg_per_acre": 20},
        "weather": {"rainfall_mm": 800, "avg_temp_c": 27},
    })
    assert response.status_code == 200
    data = response.json()
    assert [r["crop_id"] for r in data["results"]] == ["rice"]
    assert data["errors"] and data["errors"][0]["crop_id"] == "not_a_crop"


def test_chatbot_recommend_intent_accepts_plurals():
    ctx = {"region_id": "telangana_medak"}
    for msg in ("suggestions for growing rice", "recommendations for kharif", "best crops for my farm"):
        reply = answer(msg, dict(ctx))["reply"]
        assert "Top crops" in reply, msg
