"""
tests/test_new_features.py
Unit tests for satellite NDVI, climate early warnings, carbon credits, and IoT endpoints.
"""
from __future__ import annotations

from fastapi.testclient import TestClient
from backend.main import app

client = TestClient(app)


def test_field_ndvi_endpoint():
    payload = {"lat": 23.20, "lon": 77.08, "crop_id": "soybean", "area_acres": 4.0}
    response = client.post("/api/field/ndvi", json=payload)
    assert response.status_code == 200
    data = response.json()
    assert "mean_ndvi" in data
    assert "health_status" in data
    assert "sub_field_grid" in data
    assert len(data["sub_field_grid"]) == 25
    assert 0.1 <= data["mean_ndvi"] <= 1.0


def test_climate_alerts_endpoint():
    payload = {"crop_id": "wheat", "region_id": "mp_sehore"}
    response = client.post("/api/climate/alerts", json=payload)
    assert response.status_code == 200
    data = response.json()
    assert "overall_threat_level" in data
    assert "diseases" in data
    assert len(data["diseases"]) >= 3


def test_carbon_credits_endpoint():
    payload = {
        "crop_id": "cotton",
        "area_acres": 5.0,
        "tillage_practice": "no_till",
        "cover_crop": True,
        "biochar_application": True
    }
    response = client.post("/api/carbon-credits", json=payload)
    assert response.status_code == 200
    data = response.json()
    assert "total_co2e_sequestered_tons" in data
    assert "estimated_annual_earning_inr" in data
    assert data["estimated_annual_earning_inr"] > 0


def test_iot_telemetry_and_pump_trigger():
    # Telemetry
    res_tel = client.post("/api/iot/telemetry?farm_id=test_farm")
    assert res_tel.status_code == 200
    data_tel = res_tel.json()
    assert data_tel["sensor_status"] == "ONLINE_NORMAL"
    assert "soil_moisture_pct" in data_tel

    # Pump trigger
    payload_pump = {
        "farm_id": "test_farm",
        "current_moisture_pct": 35.0,
        "target_moisture_pct": 65.0,
        "area_acres": 4.0,
        "flow_rate_lpm": 120.0
    }
    res_pump = client.post("/api/iot/pump-trigger", json=payload_pump)
    assert res_pump.status_code == 200
    data_pump = res_pump.json()
    assert data_pump["recommended_pump_runtime_minutes"] > 0
    assert data_pump["pump_command"] == "TRIGGER_PUMP_ON"
