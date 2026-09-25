# Data Dictionary

## `soil.csv`

- `region_id`: Region identifier used across datasets.
- `soil_type`: Dominant soil class.
- `ph`: Soil pH (unitless, 0-14).
- `n_kg_per_acre`: Available nitrogen in kg/acre.
- `p_kg_per_acre`: Available phosphorus in kg/acre.
- `k_kg_per_acre`: Available potassium in kg/acre.
- `organic_carbon_percent`: Soil organic carbon percentage.

## `weather.csv`

- `region_id`: Region identifier.
- `season`: Crop season (`kharif`, `rabi`, `annual`).
- `year`: Observation year.
- `rainfall_mm`: Seasonal rainfall in mm.
- `avg_temp_c`: Average temperature in Celsius.
- `min_temp_c`: Minimum observed temperature in Celsius.
- `max_temp_c`: Maximum observed temperature in Celsius.

## `yield_history.csv`

- `region_id`: Region identifier.
- `crop_id`: Crop identifier.
- `year`: Production year.
- `season`: Crop season.
- `yield_kg_per_acre`: Yield in kg/acre, in marketable form (see note below).
- `area_acres`: Cultivated area in acres.
- `production_kg`: Total production in kg.

Yields everywhere in this dataset are in the form the crop is sold at mandi, so `yield x price_inr_per_kg` is revenue. Turmeric is priced cured (dried, polished), so its yields are cured weight -- about 20% of the fresh rhizome harvested. Every figure is per acre (tobacco's yield was once a per-hectare figure), and prices are what the farmer's produce fetches (cashew is the raw nut, not the kernel; mango is farm-gate, not retail). Coconut is kg of dehusked nuts, about 2 nuts per kg.

## `mandi_prices.csv`

- `region_id`: Region identifier.
- `crop_id`: Crop identifier.
- `date`: Price observation date (`YYYY-MM-DD`).
- `price_inr_per_kg`: Price in INR per kg.
- `market_name`: Market/APMC name.

## `crop_parameters.csv`

- `crop_id`: Canonical crop key.
- `crop_name`: Display name.
- `season`: Typical crop season.
- `base_yield_kg_per_acre`: Baseline yield for simulation, in marketable form (turmeric: cured).
- `water_requirement_mm`: Seasonal crop water need in mm.
- `npk_n_kg_per_acre`: Recommended nitrogen application.
- `npk_p_kg_per_acre`: Recommended phosphorus application.
- `npk_k_kg_per_acre`: Recommended potassium application.
- `temp_min_c`: Lower bound of suitable temperature.
- `temp_max_c`: Upper bound of suitable temperature.
- `growing_degree_days`: Approximate growing-degree-day requirement.
- `avg_input_cost_inr_per_acre`: Baseline input cost per acre at the yield level of `base_yield_kg_per_acre`: seed or planting material, fertiliser, protection, irrigation and hired plus family labour -- the basis of published farm-economics studies, not a paid-out-inputs-only estimate. Horticultural crops (ginger, chilli, tomato, banana, onion, the melons, cucumber) were corrected to this basis in 2026-09; tests/test_ranking_profitability.py guards it.
- `mandi_price_min_inr_per_kg`: Conservative mandi price band floor.
- `mandi_price_max_inr_per_kg`: Conservative mandi price band ceiling.
