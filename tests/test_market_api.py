"""
tests/test_market_api.py
Regression test for GET /api/market.

Root cause: price_forecast() (engine/features.py) raises ValueError when a
region has fewer than 12 months of mandi-price history for the requested
crop. /api/market called it unconditionally and let that exception turn the
whole response into a 400 -- even though the current price and volatility
above it had already been computed successfully (with their own graceful
default). 8 of the app's 30 regions have zero "rice" rows in
dataset/mandi_prices.csv, so any farmer in one of those regions saw the
dashboard's "Mandi prices unavailable right now" telemetry error every time.
"""
from __future__ import annotations

from fastapi.testclient import TestClient

from backend.main import app

client = TestClient(app)

# mp_indore has no "rice" rows in dataset/mandi_prices.csv at all -- see
# price_forecast()'s "need at least 12 months of data" guard.
REGION_WITHOUT_RICE_HISTORY = "mp_indore"
REGION_WITH_RICE_HISTORY = "telangana_medak"


def test_market_degrades_gracefully_without_enough_price_history():
    response = client.get(
        f"/api/market?region_id={REGION_WITHOUT_RICE_HISTORY}&crop_id=rice"
    )
    assert response.status_code == 200
    data = response.json()
    assert data["current_mandi_price_inr_per_kg"] > 0
    assert data["forecast"] is None


def test_market_still_returns_forecast_when_history_is_sufficient():
    response = client.get(
        f"/api/market?region_id={REGION_WITH_RICE_HISTORY}&crop_id=rice"
    )
    assert response.status_code == 200
    data = response.json()
    assert data["current_mandi_price_inr_per_kg"] > 0
    assert data["forecast"] is not None
    assert data["forecast"]["trend_direction"] in {"rising", "falling", "stable"}
