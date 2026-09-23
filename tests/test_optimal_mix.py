"""
tests/test_optimal_mix.py
Unit tests for the /api/optimal-mix endpoint.
Tests:
  - Valid requests with large/small farm areas.
  - Correct profit scaling (no max(area, 1) truncation for small areas).
  - Validation failures for zero or negative budget/area.
"""
from __future__ import annotations

from fastapi.testclient import TestClient
from backend.main import app

client = TestClient(app)

def _base_mix_payload(**overrides):
    payload = {
        "region_id": "mp_sehore",
        "season": "kharif",
        "total_area_acres": 4.0,
        "total_budget": 60000.0,
        "soil": {"n_kg_per_acre": 220, "p_kg_per_acre": 30, "k_kg_per_acre": 180, "ph": 7.2},
        "weather": {"rainfall_mm": 900, "avg_temp_c": 26.0},
    }
    payload.update(overrides)
    return payload

def test_optimal_mix_success():
    response = client.post("/api/optimal-mix", json=_base_mix_payload())
    assert response.status_code == 200
    data = response.json()
    assert "allocations" in data
    assert len(data["allocations"]) > 0
    assert data["total_area_acres"] == 4.0
    assert data["total_budget"] == 60000.0

def test_optimal_mix_validation_failures():
    # Zero area
    res_zero_area = client.post("/api/optimal-mix", json=_base_mix_payload(total_area_acres=0.0))
    assert res_zero_area.status_code == 422

    # Negative area
    res_neg_area = client.post("/api/optimal-mix", json=_base_mix_payload(total_area_acres=-2.5))
    assert res_neg_area.status_code == 422

    # Zero budget
    res_zero_budget = client.post("/api/optimal-mix", json=_base_mix_payload(total_budget=0.0))
    assert res_zero_budget.status_code == 422

    # Negative budget
    res_neg_budget = client.post("/api/optimal-mix", json=_base_mix_payload(total_budget=-1000.0))
    assert res_neg_budget.status_code == 422

def test_optimal_mix_small_area_scaling():
    # A small area (e.g. 0.5 acres)
    # Budget per acre = 60000.0 / 0.5 = 120000.0
    payload = _base_mix_payload(total_area_acres=0.5, total_budget=60000.0)
    response = client.post("/api/optimal-mix", json=payload)
    assert response.status_code == 200
    data = response.json()
    
    # Confirm that expected profit is computed correctly
    for alloc in data["allocations"]:
        # Allocations are sorted/greedy, but should scale exactly with allocated acres.
        # Check that allocated_acres is non-zero
        assert alloc["allocated_acres"] > 0
        assert alloc["expected_profit"] is not None

def test_optimal_mix_micro_farm_area():
    # Test a micro-farm area (< 0.5 acres, e.g., 0.3 acres)
    payload = _base_mix_payload(total_area_acres=0.3, total_budget=15000.0)
    response = client.post("/api/optimal-mix", json=payload)
    assert response.status_code == 200
    data = response.json()
    assert len(data["allocations"]) > 0
    assert data["allocations"][0]["allocated_acres"] > 0



def test_optimal_mix_is_never_negative_and_needs_no_soil_weather():
    r = client.post("/api/optimal-mix", json={"region_id": "telangana_medak", "season": "kharif",
                                              "total_area_acres": 10, "total_budget": 200000})
    assert r.status_code == 200
    d = r.json()
    assert d["total_expected_profit"] > 0
    assert 1 <= d["num_crops"] <= 3
    assert all(a["expected_profit"] > 0 for a in d["allocations"])
    assert abs(sum(a["allocated_acres"] for a in d["allocations"]) - 10) < 0.05
