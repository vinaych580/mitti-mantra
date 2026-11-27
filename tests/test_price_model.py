"""Phase 2 price forecast (spec 2.2): released artifact, serving path and sell advice."""
from __future__ import annotations

import json
from pathlib import Path

import numpy as np
import pytest
from fastapi.testclient import TestClient

from ml import price_model as pm
from utils import store

MODELS = Path(__file__).resolve().parents[1] / "ml" / "models" / "price"
needs_artifact = pytest.mark.skipif(not (MODELS / "current.joblib").exists() or not store.available(),
                                    reason="needs the released price artifact and the serving store")


def _fc(latest=20.0, prices=(21.0, 22.0, 24.0, 26.0, 30.0), lows=None):
    lows = lows or [p * 0.8 for p in prices]
    return {"latest_price_inr_kg": latest, "origin_week": "2026-05-25", "model_version": "t",
            "horizons": [{"horizon_weeks": h, "price_inr_kg": p, "low_inr_kg": lo, "high_inr_kg": p * 1.2,
                          "method": "model", "label": "model forecast"}
                         for h, p, lo in zip(pm.HORIZONS, prices, lows)]}


def test_sell_advice_holds_only_when_the_median_beats_storage_and_interest():
    hold = pm.sell_advice(_fc(), 1000, storage_inr_kg_month=0.1, interest_pct_year=0)
    assert hold["recommendation"].startswith("hold_")
    flat = pm.sell_advice(_fc(prices=(20.0,) * 5), 1000, storage_inr_kg_month=0.5, interest_pct_year=12)
    assert flat["recommendation"] == "sell_now"


def test_sell_advice_shows_the_downside():
    adv = pm.sell_advice(_fc(), 1000, 0.1, 0)
    for o in adv["options"][1:]:
        assert o["low_net_inr"] <= o["net_inr"] <= o["high_net_inr"]
    assert "low end of the range" in adv["reason"]


def test_window_means_ignore_gaps():
    M = np.array([[1.0, np.nan, 3.0, 5.0]])
    assert np.allclose(pm._rolling_mean(M, 2), [[1.0, 1.0, 3.0, 4.0]])


@needs_artifact
def test_every_cell_says_what_serves_it():
    m = json.loads((MODELS / "metrics.json").read_text(encoding="utf-8"))
    for key, cell in m["cells"].items():
        assert cell["served"] in ("model", *pm.BASELINES), key
        if cell["served"] == "model":
            best = min(cell[f"{b}_mape"] for b in pm.BASELINES)
            assert cell["model_mape"] <= (1 - m["config"]["gate"]) * best + 1e-9, key


@needs_artifact
def test_karnal_wheat_forecast_has_ranges_and_labels():
    pm.reset()
    model = pm.load()
    d = store.district("haryana_karnal")
    fc = model.forecast(pm.series_from_store(d["district_id"], "wheat"))
    assert [h["horizon_weeks"] for h in fc["horizons"]] == list(pm.HORIZONS)
    for h in fc["horizons"]:
        assert 0 < h["low_inr_kg"] <= h["price_inr_kg"] <= h["high_inr_kg"]
        assert 10 < h["price_inr_kg"] < 60          # wheat, rupees per kg
        assert h["method"] in ("model", *pm.BASELINES)


@needs_artifact
def test_price_routes():
    from backend.main import app
    client = TestClient(app)
    r = client.get("/api/v1/districts/haryana_karnal/price-forecast", params={"crop_id": "wheat"})
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["freshness"]["data_through"] == body["origin_week"]
    r = client.get("/api/v1/districts/haryana_karnal/sell-advice", params={"crop_id": "wheat", "quantity_kg": 2000})
    assert r.status_code == 200, r.text
    assert r.json()["options"][0]["action"] == "sell_now"
    assert client.get("/api/v1/districts/haryana_karnal/price-forecast",
                      params={"crop_id": "saffron"}).status_code == 404
    assert client.get("/api/v1/districts/haryana_karnal/sell-advice",
                      params={"crop_id": "wheat", "quantity_kg": -1}).status_code == 422


@needs_artifact
def test_forecast_crops_lists_only_what_the_forecast_can_serve():
    from backend.main import app
    client = TestClient(app)
    r = client.get("/api/v1/districts/haryana_karnal/price-forecast/crops")
    assert r.status_code == 200, r.text
    crops = [c["crop_id"] for c in r.json()["crops"]]
    assert "wheat" in crops and "saffron" not in crops
    for c in crops[:5]:  # each one listed really forecasts
        assert client.get("/api/v1/districts/haryana_karnal/price-forecast",
                          params={"crop_id": c}).status_code == 200, c
    assert client.get("/api/v1/districts/nowhere_atall/price-forecast/crops").status_code == 404
