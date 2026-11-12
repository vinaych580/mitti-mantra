"""
tests/test_ml_batch_predict.py

Guards the batched-prediction refactor of ml/predict.py.

`recommend_crops` scores every candidate crop for a region/season. It used to
ask the yield forest for one crop at a time, so a single request paid
scikit-learn's per-tree Python dispatch cost 200 trees x ~22 crops over. The
predictions are now issued as one batched `.predict()` call.

Two things have to stay true through that change:

  1. `_ml_predict_yield_batch` agrees with the per-crop `_ml_predict_yield`
     exactly -- same values, same "no ML answer for this crop" decisions.
  2. `recommend_crops` returns byte-identical output to the pre-refactor
     implementation, on both the ML path and the heuristic-fallback path a
     fresh serverless instance takes before its warm-up thread finishes.

The golden fixtures were generated from the pre-refactor code, and last
regenerated (2026-10-06) when flood/drought risk moved to effective rainfall,
the classifier stopped voting in smart_score, and rows gained `grown_locally`.
Yields, profits and ROI were unchanged by that regeneration.

Regenerated again on 2026-11-11 (Phase 0), deliberately: rows gained
planned_cost / unspent_budget / price_per_kg / water_requirement_mm; spend
is capped at 1.15x a crop's typical input cost, which changes profit and
ROI (never yield) where the budget exceeds that; and losing crops follow in
order of smallest loss. Yields are identical to the previous fixtures.
These tests pass include_losses=True so the full scored list stays pinned.
"""
from __future__ import annotations

import json
from pathlib import Path

import pytest

import ml.predict as P

FIXTURES = Path(__file__).parent / "fixtures"


def _load_golden(name: str) -> list[dict]:
    with (FIXTURES / name).open() as f:
        return json.load(f)


@pytest.fixture
def models_loaded():
    """Real models, or skip -- these tests are about ML/heuristic parity."""
    P._load_ml_models()
    if P._ml_yield_model is None or P._ml_label_encoders is None:
        pytest.skip("trained models not present in ml/models/")
    return True


@pytest.fixture
def no_models(monkeypatch):
    """Pin the module into its heuristic-fallback state for the duration."""
    monkeypatch.setattr(P, "_ml_models_loaded", True)
    monkeypatch.setattr(P, "_ml_yield_model", None)
    monkeypatch.setattr(P, "_ml_label_encoders", None)
    monkeypatch.setattr(P, "_ml_recommend_model", None)
    monkeypatch.setattr(P, "_ml_recommend_encoders", None)


def test_batch_yield_matches_per_crop_prediction(models_loaded):
    """One batched call must produce what N per-crop calls produced."""
    region_id, season = "telangana_medak", "kharif"
    crop_params = P._load_crop_parameters()
    weather, soil = P._prepare_region_data(region_id, season)
    crop_ids = sorted(crop_params.keys())

    batched = P._ml_predict_yield_batch(
        crop_ids, region_id, season, crop_params, soil, weather, 0.5,
    )

    for crop_id in crop_ids:
        individual = P._ml_predict_yield(
            crop_id, region_id, season, crop_params, soil, weather, 0.5,
        )
        if individual is None:
            assert crop_id not in batched, (
                f"{crop_id}: per-crop path declined to predict, batch must too"
            )
        else:
            assert batched[crop_id] == individual, f"{crop_id} diverged"


def test_batch_yield_omits_crops_the_model_never_saw(models_loaded):
    """An unknown crop gets no batch entry, so the caller falls back."""
    region_id, season = "telangana_medak", "kharif"
    crop_params = P._load_crop_parameters()
    weather, soil = P._prepare_region_data(region_id, season)

    batched = P._ml_predict_yield_batch(
        ["dragonfruit_unknown"], region_id, season, crop_params, soil, weather, 0.5,
    )

    assert batched == {}


def test_batch_yield_returns_empty_without_models(no_models):
    """No model loaded means no batch answers -- never a crash."""
    crop_params = P._load_crop_parameters()
    weather, soil = P._prepare_region_data("telangana_medak", "kharif")

    batched = P._ml_predict_yield_batch(
        sorted(crop_params.keys()), "telangana_medak", "kharif",
        crop_params, soil, weather, 0.5,
    )

    assert batched == {}


@pytest.mark.parametrize("case", _load_golden("recommend_crops_golden.json"))
def test_recommend_crops_unchanged_on_ml_path(case, models_loaded):
    actual = P.recommend_crops(
        case["region_id"], case["season"],
        case["budget_per_acre"], case["area_acres"], top_k=50, include_losses=True,
    )
    assert actual == case["expected"]


@pytest.mark.parametrize("case", _load_golden("recommend_crops_golden_heuristic.json"))
def test_recommend_crops_unchanged_on_heuristic_path(case, no_models):
    actual = P.recommend_crops(
        case["region_id"], case["season"],
        case["budget_per_acre"], case["area_acres"], top_k=50, include_losses=True,
    )
    assert actual == case["expected"]
