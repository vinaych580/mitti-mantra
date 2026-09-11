"""
utils/sensor_parsing.py

Parses farmer-uploaded sensor data files (CSV, XML, JSON) into the
normalized reading shape utils/sensor_log.append_batch() expects, with
metric allow-listing and per-metric range validation so a bad or hostile
upload can't inject garbage into engine calculations or the stored log.
"""
from __future__ import annotations

import csv
import io
import json
import xml.etree.ElementTree as ET
from typing import Any


# (min, max) plausible range per metric. Keys mirror the sample fields
# already returned by /api/iot/telemetry, plus the weather metrics the
# irrigation calc consumes -- so a valid upload can actually feed those
# calculations, not just sit in the log unread.
ALLOWED_METRICS: dict[str, tuple[float, float]] = {
    "soil_moisture_pct": (0.0, 100.0),
    "soil_temp_c": (-10.0, 60.0),
    "soil_ph": (0.0, 14.0),
    "npk_nitrogen_ppm": (0.0, 2000.0),
    "npk_phosphorus_ppm": (0.0, 2000.0),
    "npk_potassium_ppm": (0.0, 2000.0),
    "ambient_temp_c": (-10.0, 60.0),
    "relative_humidity_pct": (0.0, 100.0),
    "solar_radiation_wm2": (0.0, 1500.0),
    "rainfall_mm": (0.0, 2000.0),
    "wind_speed_ms": (0.0, 100.0),
}

MAX_ROWS = 5000


class SensorUploadError(ValueError):
    """Raised when a whole upload must be rejected outright (bad format, too big)."""


def parse_readings(filename: str, content: str) -> tuple[list[dict[str, Any]], list[str]]:
    """Parse `content` per the format implied by `filename`'s extension.

    Returns (accepted_readings, errors). accepted_readings are dicts with
    metric/value/unit/timestamp ready for sensor_log.append_batch(); errors
    is a list of human-readable per-row rejection reasons. Never raises for
    row-level problems -- only for a whole-file problem (bad extension,
    unparseable content, too many rows).
    """
    lower = filename.lower()
    if lower.endswith(".csv"):
        raw_rows = _parse_csv(content)
    elif lower.endswith(".xml"):
        raw_rows = _parse_xml(content)
    elif lower.endswith(".json"):
        raw_rows = _parse_json(content)
    else:
        raise SensorUploadError("Unsupported file type -- upload a .csv, .xml, or .json file")

    if len(raw_rows) > MAX_ROWS:
        raise SensorUploadError(f"Too many rows ({len(raw_rows)}) -- max {MAX_ROWS} per upload")

    return _validate(raw_rows)


def _parse_csv(content: str) -> list[dict[str, Any]]:
    reader = csv.DictReader(io.StringIO(content))
    return list(reader)


def _parse_json(content: str) -> list[dict[str, Any]]:
    try:
        data = json.loads(content)
    except json.JSONDecodeError as e:
        raise SensorUploadError(f"Invalid JSON: {e}") from e
    if isinstance(data, dict):
        data = data.get("readings", [])
    if not isinstance(data, list):
        raise SensorUploadError("JSON upload must be a list of readings, or {\"readings\": [...]}")
    return data


def _parse_xml(content: str) -> list[dict[str, Any]]:
    # xml.etree.ElementTree has no built-in XXE protection (unlike defusedxml,
    # which isn't a project dependency) -- reject any DOCTYPE/ENTITY declaration
    # before parsing untrusted upload content, closing off external-entity and
    # entity-expansion attacks without adding a new dependency.
    lowered = content.lower()
    if "<!doctype" in lowered or "<!entity" in lowered:
        raise SensorUploadError("XML uploads may not declare a DOCTYPE or ENTITY")
    try:
        root = ET.fromstring(content)
    except ET.ParseError as e:
        raise SensorUploadError(f"Invalid XML: {e}") from e

    rows = []
    for reading_el in root.findall(".//reading"):
        row = {child.tag: (child.text or "").strip() for child in reading_el}
        rows.append(row)
    return rows


def _validate(raw_rows: list[dict[str, Any]]) -> tuple[list[dict[str, Any]], list[str]]:
    accepted: list[dict[str, Any]] = []
    errors: list[str] = []
    for i, row in enumerate(raw_rows):
        metric = (row.get("metric") or "").strip()
        if not metric:
            errors.append(f"Row {i}: missing metric")
            continue
        raw_value = row.get("value")
        try:
            value = float(raw_value)
        except (TypeError, ValueError):
            errors.append(f"Row {i}: value '{raw_value}' is not a number")
            continue

        bounds = ALLOWED_METRICS.get(metric)
        if bounds is None:
            errors.append(f"Row {i}: unrecognized metric '{metric}' (skipped)")
            continue
        lo, hi = bounds
        if not (lo <= value <= hi):
            errors.append(f"Row {i}: {metric}={value} is outside the plausible range [{lo}, {hi}]")
            continue

        reading: dict[str, Any] = {"metric": metric, "value": value}
        unit = row.get("unit")
        if unit:
            reading["unit"] = str(unit).strip()
        timestamp = row.get("timestamp")
        if timestamp:
            reading["timestamp"] = str(timestamp).strip()
        accepted.append(reading)

    return accepted, errors
