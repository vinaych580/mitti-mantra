"""
tests/test_sensor_log.py
Unit tests for utils/sensor_log.py -- the farmer-uploaded sensor readings
log read by /api/sensors/{region_id} and the Smart IoT Pump tool.
"""
from __future__ import annotations


def test_read_all_returns_empty_list_when_file_missing():
    from utils.sensor_log import read_all
    assert read_all() == []


def test_append_batch_writes_rows_with_generated_ids():
    from utils.sensor_log import append_batch, read_all
    written = append_batch(
        region_id="telangana_medak", device_id="dev_a", source="csv_upload",
        readings=[
            {"metric": "soil_moisture_pct", "value": 42.0, "unit": "%"},
            {"metric": "rainfall_mm", "value": 12.5, "unit": "mm"},
        ],
    )
    assert len(written) == 2
    for row in written:
        assert row["reading_id"].startswith("s_")
        assert row["region_id"] == "telangana_medak"
        assert row["device_id"] == "dev_a"
        assert row["source"] == "csv_upload"
        assert row["timestamp"]

    rows = read_all()
    assert len(rows) == 2


def test_append_batch_preserves_explicit_timestamp():
    from utils.sensor_log import append_batch
    written = append_batch(
        region_id="telangana_medak", device_id="dev_a", source="json_upload",
        readings=[{"metric": "soil_ph", "value": 6.8, "timestamp": "2026-01-01T00:00:00Z"}],
    )
    assert written[0]["timestamp"] == "2026-01-01T00:00:00Z"


def test_append_batch_accumulates_across_calls():
    from utils.sensor_log import append_batch, read_all
    append_batch(region_id="r1", device_id="dev_a", source="csv_upload",
                 readings=[{"metric": "soil_ph", "value": 6.5}])
    append_batch(region_id="r1", device_id="dev_b", source="csv_upload",
                 readings=[{"metric": "soil_ph", "value": 7.0}])
    assert len(read_all()) == 2


def test_latest_by_metric_returns_most_recent_per_metric():
    from utils.sensor_log import append_batch, latest_by_metric
    append_batch(
        region_id="r1", device_id="dev_a", source="csv_upload",
        readings=[{"metric": "soil_moisture_pct", "value": 30.0, "timestamp": "2026-01-01T00:00:00Z"}],
    )
    append_batch(
        region_id="r1", device_id="dev_a", source="csv_upload",
        readings=[{"metric": "soil_moisture_pct", "value": 55.0, "timestamp": "2026-01-05T00:00:00Z"}],
    )
    latest = latest_by_metric("r1", max_age_days=3650)
    assert latest["soil_moisture_pct"]["value"] == "55.0"


def test_latest_by_metric_ignores_other_regions():
    from utils.sensor_log import append_batch, latest_by_metric
    append_batch(region_id="r1", device_id="dev_a", source="csv_upload",
                 readings=[{"metric": "soil_ph", "value": 6.5, "timestamp": "2026-01-01T00:00:00Z"}])
    append_batch(region_id="r2", device_id="dev_a", source="csv_upload",
                 readings=[{"metric": "soil_ph", "value": 7.5, "timestamp": "2026-01-01T00:00:00Z"}])
    latest = latest_by_metric("r1", max_age_days=3650)
    assert latest["soil_ph"]["value"] == "6.5"


def test_latest_by_metric_ignores_stale_readings():
    from utils.sensor_log import append_batch, latest_by_metric
    append_batch(
        region_id="r1", device_id="dev_a", source="csv_upload",
        readings=[{"metric": "soil_ph", "value": 6.5, "timestamp": "2000-01-01T00:00:00Z"}],
    )
    latest = latest_by_metric("r1", max_age_days=30)
    assert "soil_ph" not in latest
