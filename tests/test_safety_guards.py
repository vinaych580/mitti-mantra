"""Regression tests for public API safety and honest capability boundaries."""
from fastapi.testclient import TestClient

from backend.main import app


client = TestClient(app)


def test_model_training_never_runs_in_a_request():
    """Phase 2 removed in-request training; the route says where training lives."""
    response = client.post("/api/ml/train")
    assert response.status_code == 410
    assert "python -m ml.train" in response.json()["detail"]


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


def test_yield_endpoint_reports_honest_prediction_source():
    """B-15: /api/yield used to hardcode "RandomForestRegressor (Tuned)" as
    the algorithm on every response, even on calls where the yield model
    silently fell back to the heuristic formula (e.g. a crop/region/season
    combination unseen by the model's label encoder) -- unlike its sibling
    endpoints (/api/crop, rotation, optimal-mix), which already reported
    this honestly via `prediction_source`. A region_id that cannot be a
    real trained-on label forces that fallback; the response must say so
    instead of claiming the ML algorithm ran.
    """
    response = client.get(
        "/api/yield",
        params={
            "crop_id": "rice",
            "region_id": "zz_nonexistent_region_9999",
            "season": "kharif",
            "irrigation_level": 0.5,
        },
    )
    assert response.status_code == 200
    data = response.json()
    assert data["prediction_source"] == "heuristic"
    assert "RandomForest" not in data["algorithm"]
