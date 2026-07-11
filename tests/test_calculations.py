import pytest
from utils.calculations import calculate_soil_factor, calculate_climate_factor, CropParameter

def get_test_crop():
    return CropParameter(
        crop_id="rice",
        crop_name="Rice",
        season="kharif",
        base_yield_kg_per_acre=1000.0,
        water_requirement_mm=1200.0,
        temp_min_c=20.0,
        temp_max_c=35.0,
        avg_input_cost_inr_per_acre=15000.0,
        mandi_price_min_inr_per_kg=20.0,
        mandi_price_max_inr_per_kg=30.0,
        npk_n_kg_per_acre=40.0,
        npk_p_kg_per_acre=20.0,
        npk_k_kg_per_acre=20.0
    )

def test_climate_factor_in_range():
    crop = get_test_crop()
    weather = {"rainfall_mm": 1200.0, "avg_temp_c": 28.0}
    factor = calculate_climate_factor(weather, crop)
    # Factor should be within realistic bounds (0.05 to 1.25 as per logic)
    assert 0.05 <= factor <= 1.25

def test_soil_factor_extreme_ph():
    crop = get_test_crop()
    soil = {"ph": 3.0, "n_kg_per_acre": 10.0, "p_kg_per_acre": 5.0, "k_kg_per_acre": 5.0}
    factor = calculate_soil_factor(soil, crop)
    # Should be heavily penalized
    assert factor < 0.7

def test_climate_factor_extreme_drought_and_heat():
    crop = get_test_crop()
    weather = {"rainfall_mm": 100.0, "avg_temp_c": 45.0}
    factor = calculate_climate_factor(weather, crop)
    # Factor drops significantly when conditions are bad
    assert factor < 0.5
