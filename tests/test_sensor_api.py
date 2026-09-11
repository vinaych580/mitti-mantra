"""
tests/test_sensor_api.py
Integration tests for /api/sensors/upload, /api/sensors/{region_id}, the
live-data merge in /api/iot/telemetry, and the data_sources block in
/api/ml/status.
"""
from __future__ import annotations

from fastapi.testclient import TestClient

from backend.main import app

client = TestClient(app)

REGION = "telangana_medak"


def test_upload_csv_happy_path():
    payload = {
        "region_id": REGION,
        "device_id": "dev_test",
        "filename": "readings.csv",
        "content": "metric,value,unit\nsoil_moisture_pct,55.0,%\nrainfall_mm,8,mm\n",
    }
    response = client.post("/api/sensors/upload", json=payload)
    assert response.status_code == 200
    data = response.json()
    assert data["accepted"] == 2
    assert data["rejected"] == 0


def test_upload_rejects_unknown_region():
    payload = {
        "region_id": "not_a_real_region",
        "filename": "readings.csv",
        "content": "metric,value\nsoil_ph,6.5\n",
    }
    response = client.post("/api/sensors/upload", json=payload)
    assert response.status_code == 400


def test_upload_rejects_unsupported_extension():
    payload = {
        "region_id": REGION,
        "filename": "readings.txt",
        "content": "metric,value\nsoil_ph,6.5\n",
    }
    response = client.post("/api/sensors/upload", json=payload)
    assert response.status_code == 400


def test_upload_json_and_xml_formats():
    json_payload = {
        "region_id": REGION,
        "filename": "readings.json",
        "content": '[{"metric": "soil_ph", "value": 6.8}]',
    }
    xml_payload = {
        "region_id": REGION,
        "filename": "readings.xml",
        "content": "<readings><reading><metric>rainfall_mm</metric><value>5</value></reading></readings>",
    }
    assert client.post("/api/sensors/upload", json=json_payload).json()["accepted"] == 1
    assert client.post("/api/sensors/upload", json=xml_payload).json()["accepted"] == 1


def test_get_sensor_readings_reflects_upload():
    client.post("/api/sensors/upload", json={
        "region_id": REGION, "filename": "readings.csv",
        "content": "metric,value,unit\nsoil_moisture_pct,61.0,%\n",
    })
    response = client.get(f"/api/sensors/{REGION}")
    assert response.status_code == 200
    data = response.json()
    assert data["available"] is True
    assert data["readings"]["soil_moisture_pct"]["value"] == 61.0


def test_get_sensor_readings_empty_when_no_uploads():
    response = client.get("/api/sensors/some_region_with_no_uploads")
    assert response.status_code == 200
    data = response.json()
    assert data["available"] is False
    assert data["readings"] == {}


def test_iot_telemetry_without_region_id_stays_sample_data():
    response = client.post("/api/iot/telemetry", json={"farm_id": "farm_x"})
    assert response.status_code == 200
    data = response.json()
    assert data["source"] == "sample_data"
    assert data["is_live"] is False


def test_iot_telemetry_uses_live_data_when_uploaded():
    client.post("/api/sensors/upload", json={
        "region_id": REGION, "filename": "readings.csv",
        "content": "metric,value,unit\nsoil_moisture_pct,72.5,%\n",
    })
    response = client.post("/api/iot/telemetry", json={"region_id": REGION})
    data = response.json()
    assert data["is_live"] is True
    assert data["source"] == "farmer_upload"
    assert data["soil_moisture_pct"] == 72.5
    assert "soil_moisture_pct" in data["live_metrics"]
    # Fields with no uploaded reading keep the sample default.
    assert data["soil_ph"] == 6.8


def test_ml_status_reports_data_sources():
    client.post("/api/sensors/upload", json={
        "region_id": REGION, "filename": "readings.csv",
        "content": "metric,value\nsoil_ph,6.5\n",
    })
    response = client.get("/api/ml/status")
    assert response.status_code == 200
    data = response.json()
    assert data["data_sources"]["sensor_uploads_available"] is True
    assert data["data_sources"]["regions_with_sensor_data"] >= 1


def test_ml_status_data_sources_false_when_no_uploads():
    response = client.get("/api/ml/status")
    data = response.json()
    assert data["data_sources"]["sensor_uploads_available"] is False
    assert data["data_sources"]["regions_with_sensor_data"] == 0
