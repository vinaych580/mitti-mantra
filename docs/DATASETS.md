# Datasets

Runtime seed data lives in `dataset/` and is loaded through the shared CSV
cache. The main files are `crop_parameters.csv`, `soil.csv`, `weather.csv`,
`mandi_prices.csv`, `msp_prices.csv`, `yield_history.csv`,
`government_schemes.csv`, and `pest_rules.csv`.

Each row uses canonical `crop_id` values and `region_id` values in the form
`state_district`. Prices are INR per kg, land area is acres, and yields are kg
per acre. The ingestion utilities may refresh derived data, but production
requests safely fall back to these committed CSV files.

## `dynamic/sensor_readings.csv`

Runtime, farmer-uploaded sensor data (soil, weather, or other farm-sensor
readings), written by `POST /api/sensors/upload` and read by
`GET /api/sensors/{region_id}` and `POST /api/iot/telemetry` via
`utils/sensor_log.py`. Uploads require a `device_id`, and reads are scoped
to it: `GET /api/sensors/{region_id}` needs `?device_id=` and telemetry
only merges the calling device's own readings, never another farmer's in
the same region. Unlike the static seed CSVs above, this file is
written to at request time, so it lives under `dataset/dynamic/` (mirroring
`dynamic/commitments.csv`) rather than `dataset/`. Rows: `reading_id,
region_id, device_id, metric, value, unit, timestamp, source`. `metric` is
restricted to the allow-list in `utils/sensor_parsing.py` (e.g.
`soil_moisture_pct`, `soil_ph`, `rainfall_mm`) so an upload can only ever
feed values the rest of the system already understands.
