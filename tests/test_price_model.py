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


def test_sell_advice_never_holds_longer_than_the_crop_keeps():
    # Prices rise all the way to 26 weeks: before the cap this said "hold tomato 26 weeks".
    tomato = pm.sell_advice(_fc(), 1000, 0.1, 0, crop_id="tomato")
    assert [o["weeks"] for o in tomato["options"]] == [0, 1]
    assert tomato["recommendation"] in ("sell_now", "hold_1_weeks")
    assert tomato["storage_limited"] is True and tomato["max_storage_weeks"] == 1
    onion = pm.sell_advice(_fc(), 1000, 0.1, 0, crop_id="onion")
    assert max(o["weeks"] for o in onion["options"]) == 12


def test_sugarcane_is_sell_now_only():
    cane = pm.sell_advice(_fc(), 1000, 0.1, 0, crop_id="sugarcane")
    assert [o["action"] for o in cane["options"]] == ["sell_now"]
    assert cane["recommendation"] == "sell_now"
    assert "within days of harvest" in cane["reason"]


def test_grains_keep_every_horizon():
    rice = pm.sell_advice(_fc(), 1000, 0.1, 0, crop_id="rice")
    assert [o["weeks"] for o in rice["options"]] == [0, *pm.HORIZONS]
    assert rice["storage_limited"] is False and rice["max_storage_weeks"] is None


def test_seasonal_sell_advisor_does_not_hold_perishables(monkeypatch):
    from engine import features

    # Peak price four months away, 40% above today: grain is told to hold, tomato to sell.
    rows = [{"date": f"2025-{m:02d}-01", "price": 10.0} for m in range(1, 13)]
    from datetime import datetime as real_dt
    peak = (real_dt.now().month + 3) % 12 + 1
    rows[peak - 1]["price"] = 14.0
    rows.append({"date": "2025-12-15", "price": 10.0})
    monkeypatch.setattr(features, "_price_rows", lambda region, crop: [dict(r) for r in rows])
    tomato = features.best_time_to_sell("x", "tomato")
    assert tomato["action"] == "sell" and "keeps only" in tomato["advice"]
    assert tomato["max_storage_weeks"] == 1
    wheat = features.best_time_to_sell("x", "wheat")
    assert wheat["max_storage_weeks"] is None


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


def test_chatbot_drops_the_peak_for_a_crop_that_cannot_wait_for_it():
    from backend import chatbot

    res = {"advice": "SELL NOW", "best_month": 7, "best_month_avg_price": 32.0, "potential_gain_pct": 150.0,
           "current_price": 12.0, "months_to_peak": 8, "max_storage_weeks": 1}
    assert chatbot._cannot_wait_for_peak(res)
    assert not chatbot._cannot_wait_for_peak({**res, "max_storage_weeks": None})
    assert not chatbot._cannot_wait_for_peak({**res, "months_to_peak": 0})
