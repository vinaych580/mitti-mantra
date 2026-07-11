from __future__ import annotations

from utils.calculations import CropParameter

def make_crop_param(r: dict) -> CropParameter:
    return CropParameter(
        crop_id=r["crop_id"],
        crop_name=r["crop_name"],
        season=r["season"].lower(),
        base_yield_kg_per_acre=float(r["base_yield_kg_per_acre"]),
        water_requirement_mm=float(r["water_requirement_mm"]),
        temp_min_c=float(r["temp_min_c"]),
        temp_max_c=float(r["temp_max_c"]),
        avg_input_cost_inr_per_acre=float(r["avg_input_cost_inr_per_acre"]),
        mandi_price_min_inr_per_kg=float(r["mandi_price_min_inr_per_kg"]),
        mandi_price_max_inr_per_kg=float(r["mandi_price_max_inr_per_kg"]),
        npk_n_kg_per_acre=float(r["npk_n_kg_per_acre"]),
        npk_p_kg_per_acre=float(r["npk_p_kg_per_acre"]),
        npk_k_kg_per_acre=float(r["npk_k_kg_per_acre"]),
    )

def load_crop_parameters(csv_rows: list[dict]) -> dict[str, CropParameter]:
    """Single source of truth for CropParameter construction."""
    return {r["crop_id"]: make_crop_param(r) for r in csv_rows}
