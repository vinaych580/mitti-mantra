"""Regression tests for public API safety and honest capability boundaries."""
from fastapi.testclient import TestClient

from backend.main import app


client = TestClient(app)


def test_model_training_is_disabled_by_default():
    response = client.post("/api/ml/train")
    assert response.status_code == 403


def test_expense_storage_is_not_publicly_available():
    response = client.post(
        "/api/expense/log",
        json={"farm_id": "other-user", "category": "seed", "amount": 500},
    )
    assert response.status_code == 503


def test_planning_endpoints_reject_impossible_inputs():
    ndvi = client.post("/api/field/ndvi", json={"lat": 120, "lon": 77})
    pump = client.post(
        "/api/iot/pump-trigger",
        json={"current_moisture_pct": 110, "target_moisture_pct": 65, "flow_rate_lpm": 100},
    )
    assert ndvi.status_code == 422
    assert pump.status_code == 422


def test_satellite_endpoint_does_not_fabricate_an_observation():
    response = client.get("/api/satellite?lat=23.2&lon=77.08")
    assert response.status_code == 200
    data = response.json()
    assert data["available"] is False
    assert "ndvi" not in data
