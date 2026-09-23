"""Live 7-day forecast + field-work windows (engine/forecast.py, /api/forecast).

Review 2026-09-23: nothing in the running app used a live forecast -- the
spray/irrigation question a farmer asks every morning had no answer. Network
is mocked here; fetch_daily is the only function that touches Open-Meteo.
"""
from fastapi.testclient import TestClient

import engine.forecast as F
from backend.main import app

client = TestClient(app)

DAILY = {
    "time": ["2026-09-23", "2026-09-24", "2026-09-25", "2026-09-26"],
    "precipitation_sum": [0.0, 12.0, 0.0, 0.0],
    "precipitation_probability_max": [10, 80, 5, 0],
    "temperature_2m_max": [33.0, 30.0, 41.0, 34.0],
    "temperature_2m_min": [22.0, 21.0, 26.0, 23.0],
    "wind_speed_10m_max": [8.0, 9.0, 18.0, 6.0],
}


def test_spray_avoided_before_rain_and_in_wind():
    days = F.field_windows(DAILY)
    assert days[0]["spray"] == "avoid"  # rain tomorrow would wash it off
    assert days[1]["spray"] == "avoid"  # raining today
    assert days[2]["spray"] == "avoid"  # 18 km/h wind -> drift
    assert days[3]["spray"] == "good"
    assert all(d["spray_reason"] for d in days)


def test_irrigation_skipped_when_rain_coming():
    days = F.field_windows(DAILY)
    assert days[0]["irrigate"] == "skip"   # 12 mm within the next 2 days
    assert days[3]["irrigate"] == "check"


def test_heat_stress_flag():
    assert [d["heat_stress"] for d in F.field_windows(DAILY)] == [False, False, True, False]


def test_missing_values_are_treated_as_unknown_not_zero():
    daily = {**DAILY, "precipitation_probability_max": [None, None, None, None]}
    days = F.field_windows(daily)
    assert days[3]["rain_prob_pct"] is None
    assert days[3]["spray"] == "good"


def test_malformed_payload_raises_unavailable():
    import pytest
    with pytest.raises(F.ForecastUnavailable):
        F._validate({"time": ["2026-09-23"], "precipitation_sum": []})


def test_endpoint_returns_days(monkeypatch):
    monkeypatch.setattr(F, "fetch_daily", lambda lat, lon: DAILY)
    r = client.get("/api/forecast?lat=18.0&lon=78.3")
    assert r.status_code == 200
    body = r.json()
    assert body["source"] == "Open-Meteo"
    assert len(body["days"]) == 4
    assert "spray" in body["rules"]


def test_endpoint_unavailable_is_honest(monkeypatch):
    def boom(lat, lon):
        raise F.ForecastUnavailable("down")
    monkeypatch.setattr(F, "fetch_daily", boom)
    r = client.get("/api/forecast?lat=18.0&lon=78.3")
    assert r.status_code == 503


def test_endpoint_rejects_points_outside_india():
    assert client.get("/api/forecast?lat=51.5&lon=0.1").status_code == 422
