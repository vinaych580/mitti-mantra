"""Sensor readings belong to the device that uploaded them.

Review 2026-09-23: /api/iot/telemetry and /api/sensors/{region_id} returned the
latest reading anywhere in the *region*, so one farmer's upload showed up as
LIVE_FARMER_DATA for every other farmer in that region.
"""
from fastapi.testclient import TestClient

from backend.main import app
from utils.sensor_log import append_batch, latest_by_metric

client = TestClient(app)
REGION = "telangana_medak"


def _seed():
    append_batch(region_id=REGION, device_id="dev_a", source="csv_upload",
                 readings=[{"metric": "soil_moisture_pct", "value": 12.0}])


def test_latest_by_metric_filters_by_device():
    _seed()
    assert latest_by_metric(REGION, device_id="dev_b") == {}
    assert "soil_moisture_pct" in latest_by_metric(REGION, device_id="dev_a")


def test_telemetry_does_not_leak_other_devices():
    _seed()
    other = client.post("/api/iot/telemetry", json={"region_id": REGION, "device_id": "dev_b"}).json()
    assert other["is_live"] is False and other["soil_moisture_pct"] != 12.0
    own = client.post("/api/iot/telemetry", json={"region_id": REGION, "device_id": "dev_a"}).json()
    assert own["is_live"] is True and own["soil_moisture_pct"] == 12.0


def test_telemetry_without_device_is_sample_only():
    _seed()
    r = client.post("/api/iot/telemetry", json={"region_id": REGION}).json()
    assert r["is_live"] is False


def test_sensor_get_requires_device():
    _seed()
    assert client.get(f"/api/sensors/{REGION}").status_code == 422
    assert client.get(f"/api/sensors/{REGION}?device_id=dev_a").json()["available"] is True
    assert client.get(f"/api/sensors/{REGION}?device_id=dev_b").json()["available"] is False


def test_upload_requires_device():
    r = client.post("/api/sensors/upload", json={
        "region_id": REGION, "filename": "r.csv", "content": "metric,value\nsoil_moisture_pct,40\n"})
    assert r.status_code == 422
