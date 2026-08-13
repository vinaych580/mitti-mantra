# Datasets

Runtime seed data lives in `dataset/` and is loaded through the shared CSV
cache. The main files are `crop_parameters.csv`, `soil.csv`, `weather.csv`,
`mandi_prices.csv`, `msp_prices.csv`, `yield_history.csv`,
`government_schemes.csv`, and `pest_rules.csv`.

Each row uses canonical `crop_id` values and `region_id` values in the form
`state_district`. Prices are INR per kg, land area is acres, and yields are kg
per acre. The ingestion utilities may refresh derived data, but production
requests safely fall back to these committed CSV files.
