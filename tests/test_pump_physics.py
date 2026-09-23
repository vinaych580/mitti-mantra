"""Pump runtime must come from real soil-water physics.

Review 2026-09-23: the old rule of thumb (10,000 L per acre per 10% moisture
deficit) under-counted by ~12x. Volume = volumetric deficit x root-zone depth
x area: 0.10 x 0.30 m x 4,046.86 m^2 = 121.4 m^3 = 121,406 L.
"""
from fastapi.testclient import TestClient

from backend.main import app

client = TestClient(app)
BASE = {"current_moisture_pct": 30, "target_moisture_pct": 40, "area_acres": 1}


def test_ten_percent_deficit_one_acre_30cm():
    r = client.post("/api/iot/pump-trigger", json={**BASE, "flow_rate_lpm": 100}).json()
    assert abs(r["required_water_liters"] - 121405.8) < 5
    assert abs(r["recommended_pump_runtime_minutes"] - 1214.1) < 0.5
    assert r["root_zone_depth_cm"] == 30.0


def test_depth_scales_linearly():
    a = client.post("/api/iot/pump-trigger", json={**BASE, "root_zone_depth_cm": 15}).json()
    b = client.post("/api/iot/pump-trigger", json={**BASE, "root_zone_depth_cm": 30}).json()
    assert abs(b["required_water_liters"] - 2 * a["required_water_liters"]) < 1


def test_depth_bounds_validated():
    assert client.post("/api/iot/pump-trigger", json={**BASE, "root_zone_depth_cm": 2}).status_code == 422
