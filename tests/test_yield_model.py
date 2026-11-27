"""The released Phase 2 yield artifact (ml/models/yield/), spec 2.1.

The behaviour tests run on the shipped artifact, so a release that breaks them fails
the build. They hold whether the app serves the model or its 5-year-mean baseline:
the season planner may switch to the model once it clears its gate.
"""
from __future__ import annotations

import json
from pathlib import Path

import numpy as np
import pytest

from ml import yield_anomaly as ya

MODELS = Path(__file__).resolve().parents[1] / "ml" / "models" / "yield"
pytestmark = pytest.mark.skipif(not (MODELS / "current.joblib").exists(), reason="no released yield artifact")


@pytest.fixture(scope="module")
def model() -> ya.YieldModel:
    ya.reset()
    m = ya.load()
    assert m is not None
    return m


@pytest.fixture(scope="module")
def metrics() -> dict:
    return json.loads((MODELS / "metrics.json").read_text(encoding="utf-8"))


def _scenarios(model, crop):
    keys = [k for k in model.lookup if k[1] == crop]
    rows = []
    for k in keys:
        e = model.lookup[k]
        rows += [(e, crop, 1.0, 0.0), (e, crop, 0.5, 0.0), (e, crop, 1.0, 1.0), (e, crop, 0.5, 1.0)]
    return np.array([r["yield_kg_per_acre"] for r in model.predict_rows(rows)]).reshape(-1, 4)


@pytest.mark.parametrize("crop", ["rice", "cotton", "maize", "wheat"])
def test_less_rain_lowers_rainfed_yield_and_never_raises_it(model, crop):
    p = _scenarios(model, crop)
    assert len(p) > 50
    assert np.all(p[:, 1] <= p[:, 0] + 1e-6), "less rain raised a rainfed yield"
    assert np.median(1 - p[:, 1] / p[:, 0]) > 0


@pytest.mark.parametrize("crop", ["rice", "cotton", "maize", "wheat"])
def test_irrigation_softens_the_drop(model, crop):
    p = _scenarios(model, crop)
    assert np.median(1 - p[:, 3] / p[:, 2]) < np.median(1 - p[:, 1] / p[:, 0])


def test_released_metrics_match_what_serves(model, metrics):
    assert metrics["version"] == model.version
    assert metrics["behaviour_passed"] is True
    assert model.serves_baseline == (not metrics["gate"]["passed"])
    assert (MODELS / "model_card.md").read_text(encoding="utf-8").count(metrics["version"]) >= 1


def test_ranges_are_calibrated_near_80_percent(metrics):
    cal = metrics["calibration"]
    served = cal["baseline_mean5"] if metrics["serves"] == "baseline" else cal["at_sowing"]
    assert 0.75 <= served["coverage"]["overall"] <= 0.9


def test_artifact_fits_the_bundle_budget():
    assert (MODELS / "current.joblib").stat().st_size < 60e6


def test_karnal_wheat_is_a_measured_district_yield(model):
    r = model.predict(model.region_to_district["haryana_karnal"], "wheat", "rabi")
    assert r is not None
    assert 1600 < r["yield_kg_per_acre"] < 2600   # DES: ~2,000-2,300 kg/acre in 2016-2022
    assert r["low"] < r["yield_kg_per_acre"] < r["high"]


def test_a_crop_with_no_record_has_no_measured_yield(model):
    assert model.predict(model.region_to_district["haryana_karnal"], "jute", "kharif") is None


def test_baseline_cannot_answer_a_weather_scenario(model):
    if not model.serves_baseline:
        pytest.skip("model serves")
    assert model.predict(model.region_to_district["haryana_karnal"], "wheat", "rabi", rain_pct=0.5) is None
