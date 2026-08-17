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
    # M-18 fix: risk is now genuinely scoped per crop from dataset/pest_rules.csv
    # instead of always returning the same 3 fixed generic categories regardless
    # of crop. Wheat currently has 2 real documented entries (Yellow Rust, Aphids),
    # so this only asserts the endpoint returns real, non-empty, crop-relevant data.
    assert len(data["diseases"]) >= 1
    assert all(d["name"] for d in data["diseases"])


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


def test_farm_score_basic():
    payload = {
        "region_id": "mp_sehore",
        "season": "kharif",
        "budget_per_acre": 15000,
        "area_acres": 4.0,
    }
    response = client.post("/api/farm-score", json=payload)
    assert response.status_code == 200
    data = response.json()
    assert 0.0 <= data["farm_score"] <= 100.0
    assert data["grade"] in {"A+", "A", "B+", "B", "C", "D", "F"}
    assert "recommended_crop" in data
    assert "profitability" in data["pillars"]
    assert "risk_resilience" in data["pillars"]
    assert "market_fit" in data["pillars"]
    # No lat/lon given, so the optional field-health pillar must be absent.
    assert "field_health" not in data["pillars"]


def test_farm_score_with_location_adds_field_health():
    payload = {
        "region_id": "mp_sehore",
        "season": "kharif",
        "budget_per_acre": 15000,
        "area_acres": 4.0,
        "lat": 23.20,
        "lon": 77.08,
    }
    response = client.post("/api/farm-score", json=payload)
    assert response.status_code == 200
    data = response.json()
    assert "field_health" in data["pillars"]
    # Weights are individually rounded to 2dp for display, so their sum can be
    # off from 1.0 by a couple cents -- the underlying score blend itself
    # uses the unrounded weights.
    assert abs(sum(data["weights"].values()) - 1.0) < 0.02


def test_farm_score_invalid_region_errors():
    payload = {
        "region_id": "not_a_real_region",
        "season": "kharif",
        "budget_per_acre": 15000,
        "area_acres": 4.0,
    }
    response = client.post("/api/farm-score", json=payload)
    assert response.status_code == 400


def test_iot_telemetry_and_pump_trigger():
    # Telemetry
    res_tel = client.post("/api/iot/telemetry?farm_id=test_farm")
    assert res_tel.status_code == 200
    data_tel = res_tel.json()
    assert data_tel["source"] == "sample_data"
    assert data_tel["is_live"] is False
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
    assert data_pump["control_action"] == "RECOMMEND_IRRIGATION"
    assert data_pump["is_controlled"] is False
