"""Owner decision 2026-11-27: show a good farm's profit beside the district average."""
from __future__ import annotations

import pytest

import ml.predict as P
from utils import store

needs_store = pytest.mark.skipif(not store.available(), reason="needs dataset/serving.sqlite")


@needs_store
def test_good_farm_shown_where_the_reference_yield_beats_the_district():
    recs = P.recommend_crops("telangana_medak", "kharif", 30000, 4, top_k=50, include_losses=True)
    rice = next(r for r in recs if r["crop_id"] == "rice")
    good = rice["good_farm"]
    base = P._load_crop_parameters()["rice"].base_yield_kg_per_acre
    assert good["yield_kg_per_acre"] == pytest.approx(base)
    assert good["expected_profit"] > rice["expected_profit"]
    # Same budget and price: only the yield differs.
    expect = P.profit_estimator("rice", base, 4, 30000, rice["price_per_kg"])["expected_profit"]
    assert good["expected_profit"] == pytest.approx(expect)


@needs_store
def test_no_good_farm_figure_where_the_district_already_beats_it():
    recs = P.recommend_crops("punjab_ludhiana", "kharif", 30000, 4, top_k=50, include_losses=True)
    rice = next(r for r in recs if r["crop_id"] == "rice")
    assert "good_farm" not in rice
    turmeric = next(r for r in P.recommend_crops("telangana_medak", "kharif", 70000, 4, top_k=50,
                                                 include_losses=True) if r["crop_id"] == "turmeric")
    assert "good_farm" not in turmeric

