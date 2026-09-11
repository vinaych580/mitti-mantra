"""
tests/test_sensor_parsing.py
Unit tests for utils/sensor_parsing.py -- CSV/XML/JSON sensor upload parsing,
metric allow-listing, range validation, and XXE rejection.
"""
from __future__ import annotations

import pytest

from utils.sensor_parsing import SensorUploadError, parse_readings


def test_parse_csv_happy_path():
    content = "metric,value,unit\nsoil_moisture_pct,42.5,%\nrainfall_mm,12,mm\n"
    accepted, errors = parse_readings("readings.csv", content)
    assert errors == []
    assert len(accepted) == 2
    assert accepted[0] == {"metric": "soil_moisture_pct", "value": 42.5, "unit": "%"}


def test_parse_json_list_form():
    content = '[{"metric": "soil_ph", "value": 6.8}, {"metric": "rainfall_mm", "value": 10}]'
    accepted, errors = parse_readings("readings.json", content)
    assert errors == []
    assert len(accepted) == 2


def test_parse_json_wrapped_form():
    content = '{"readings": [{"metric": "soil_ph", "value": 6.8}]}'
    accepted, errors = parse_readings("readings.json", content)
    assert errors == []
    assert len(accepted) == 1


def test_parse_json_invalid_raises():
    with pytest.raises(SensorUploadError):
        parse_readings("readings.json", "{not valid json")


def test_parse_xml_happy_path():
    content = (
        "<readings>"
        "<reading><metric>soil_ph</metric><value>6.5</value><unit>pH</unit></reading>"
        "<reading><metric>rainfall_mm</metric><value>5</value></reading>"
        "</readings>"
    )
    accepted, errors = parse_readings("readings.xml", content)
    assert errors == []
    assert len(accepted) == 2
    assert accepted[0]["metric"] == "soil_ph"
    assert accepted[0]["value"] == 6.5


def test_parse_xml_rejects_doctype():
    content = (
        '<?xml version="1.0"?>'
        '<!DOCTYPE reading [<!ENTITY xxe SYSTEM "file:///etc/passwd">]>'
        "<readings><reading><metric>soil_ph</metric><value>&xxe;</value></reading></readings>"
    )
    with pytest.raises(SensorUploadError):
        parse_readings("readings.xml", content)


def test_parse_xml_rejects_bare_entity_declaration():
    content = '<!ENTITY foo "bar"><readings></readings>'
    with pytest.raises(SensorUploadError):
        parse_readings("readings.xml", content)


def test_unsupported_extension_raises():
    with pytest.raises(SensorUploadError):
        parse_readings("readings.txt", "metric,value\nsoil_ph,6.5\n")


def test_unrecognized_metric_is_rejected_not_stored():
    content = "metric,value\nhaunted_soil_ghosts,999\n"
    accepted, errors = parse_readings("readings.csv", content)
    assert accepted == []
    assert len(errors) == 1
    assert "unrecognized metric" in errors[0]


def test_out_of_range_value_is_rejected():
    content = "metric,value\nsoil_ph,999\n"
    accepted, errors = parse_readings("readings.csv", content)
    assert accepted == []
    assert "outside the plausible range" in errors[0]


def test_non_numeric_value_is_rejected():
    content = "metric,value\nsoil_ph,not_a_number\n"
    accepted, errors = parse_readings("readings.csv", content)
    assert accepted == []
    assert "not a number" in errors[0]


def test_missing_metric_is_rejected():
    content = "metric,value\n,42\n"
    accepted, errors = parse_readings("readings.csv", content)
    assert accepted == []
    assert "missing metric" in errors[0]


def test_too_many_rows_rejected_outright():
    lines = ["metric,value"] + [f"soil_ph,6.5" for _ in range(5001)]
    content = "\n".join(lines)
    with pytest.raises(SensorUploadError):
        parse_readings("readings.csv", content)


def test_mixed_valid_and_invalid_rows():
    content = "metric,value\nsoil_ph,6.5\nsoil_ph,999\nrainfall_mm,10\n"
    accepted, errors = parse_readings("readings.csv", content)
    assert len(accepted) == 2
    assert len(errors) == 1
