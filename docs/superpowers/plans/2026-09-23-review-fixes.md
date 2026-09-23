# Review Fixes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix the defects the 2026-09-23 project review verified by running real code, and add the missing live-forecast and season-outcome loops, without breaking the zero-build / offline / honest-by-construction constraints.

**Architecture:** Backend fixes stay inside the existing FastAPI monolith (`backend/main.py`) and its engine/ml/utils modules; each fix gets a focused pytest module. The one new capability (7-day forecast + field-work windows) is a pure-logic engine module plus a thin endpoint, rendered on the dashboard's My Farm tab. The season ledger is client-side (localStorage, per plot + season) because there is no account system yet.

**Tech Stack:** FastAPI, Pydantic v2, scikit-learn, pytest, vanilla JS (no build), Open-Meteo forecast API (free, no key).

**Status (2026-09-23):** Tasks 1–9 implemented inline in the working tree, uncommitted. Deviations from the text below: `single_crop_best` also carries `crop_name`; Task 7's crop check sits after the demo-image shortcut (so pre-labelled demo photos still work) rather than before image decoding; the upload endpoint now also requires `device_id`; the ledger adopts entries logged under the pre-plot `'default'` scope into the first real plot.

**Spec:** the review delivered in-session on 2026-09-23 (sections "Broken right now", "The data problem", "Missing features"). Findings are restated inside each task.

## Global Constraints

- Zero-build vanilla JS frontend: plain `<script defer>`, no bundler, no framework, no TypeScript.
- Every computed figure traces to a real dataset, endpoint, or named institution; failures degrade to an honest "unavailable", never an invented number.
- New user-visible strings get `i18n-data.js` catalog entries for hi / te / kn / ta.
- Bump `VERSION` in `frontend/sw.js` when shipped frontend assets change.
- Python runs from `venv/Scripts/python.exe`. The full suite takes ~8 min; run the targeted module per task and the full suite once at the end.
- Do not commit: the working tree carries the user's uncommitted work (12 files). Leave changes staged-for-review only.

## Out of scope — needs the user

| Item | Blocker |
|---|---|
| Real database (commitments/sensors survive Vercel cold starts) | Choose a provider (Turso / Supabase / Neon) and create the account |
| Live Agmarknet prices replacing synthetic `mandi_prices.csv` | `DATAGOV_API_KEY` in `.env` is unset — register at data.gov.in |
| Phone-OTP accounts | Enable Phone sign-in in the Firebase console for `mitti-mantra-462ac`; decide on backend token verification |
| 2,292 generated consultants with fabricated ratings/reviews | Product decision: relabel as samples, strip ratings, or remove |
| Crop-plausibility ranking (jute in Telangana, rice missing in Thanjavur) | Needs real district crop-area statistics; `yield_history.csv` is synthetic for the pilot regions and would wrongly demote turmeric in Telangana |

---

### Task 1: Pin scikit-learn to the version the models were pickled with

Finding: `requirements.txt` has `scikit-learn>=1.3.0`; artifacts were pickled with 1.9.1 and the venv has 1.9.0 (tests emit `InconsistentVersionWarning`). `pytest` ships in production requirements.

**Files:**
- Modify: `requirements.txt`, `requirements-dev.txt`
- Test: `tests/test_model_versions.py` (create)

- [ ] **Step 1: Write the failing test**

```python
"""Guards that the installed scikit-learn matches the pinned version the
serialized models in ml/models/ were pickled with."""
import re
from pathlib import Path

import sklearn

REQ = Path(__file__).resolve().parents[1] / "requirements.txt"


def test_sklearn_is_pinned_exactly():
    m = re.search(r"^scikit-learn==([\d.]+)\s*$", REQ.read_text(), re.M)
    assert m, "scikit-learn must be pinned with == in requirements.txt"
    assert sklearn.__version__ == m.group(1)


def test_pytest_not_in_production_requirements():
    assert not re.search(r"^pytest", REQ.read_text(), re.M)
```

- [ ] **Step 2: Run it — expect FAIL** (`>=` pin, and pytest present)

`venv/Scripts/python.exe -m pytest tests/test_model_versions.py -q`

- [ ] **Step 3: Implement** — in `requirements.txt` replace `scikit-learn>=1.3.0` with `scikit-learn==1.9.1` (comment: must match the version `ml/models/*.joblib` were pickled with; retrain before bumping), delete `pytest>=8.0.0`; append `pytest>=8.0.0` to `requirements-dev.txt`. Then `venv/Scripts/python.exe -m pip install scikit-learn==1.9.1`.

- [ ] **Step 4: Run it — expect PASS**, and confirm `venv/Scripts/python.exe -W error::sklearn.exceptions.InconsistentVersionWarning -c "import ml.predict as p; p._load_ml_models()"` exits 0.

---

### Task 2: Never rank a loss-making crop above a profitable one

Finding: `/api/crop-comparison/telangana_medak/kharif` ranks jute (−₹2,540) #3, above groundnut (+₹52,973). The existing loss penalty in `_score_single_crop` scales with ROI, so a small loss costs ~0.5 points.

**Files:**
- Modify: `ml/predict.py` (`recommend_crops`, final sort)
- Modify: `tests/fixtures/recommend_crops_golden.json`, `tests/fixtures/recommend_crops_golden_heuristic.json` (deterministic re-sort, values untouched)
- Test: `tests/test_ranking_profitability.py` (create)

**Interfaces:** Produces `ml.predict.rank_recommendations(recs: list[dict]) -> list[dict]` — stable sort, profitable (`expected_profit > 0`) first, then `smart_score` descending.

- [ ] **Step 1: Write the failing test**

```python
import ml.predict as P


def test_rank_puts_every_profitable_crop_first():
    recs = [
        {"crop_id": "a", "expected_profit": -10, "smart_score": 90},
        {"crop_id": "b", "expected_profit": 500, "smart_score": 40},
        {"crop_id": "c", "expected_profit": 0, "smart_score": 80},
        {"crop_id": "d", "expected_profit": 100, "smart_score": 60},
    ]
    assert [r["crop_id"] for r in P.rank_recommendations(recs)] == ["d", "b", "a", "c"]


def test_live_ranking_has_no_loss_above_profit():
    recs = P.recommend_crops("telangana_medak", "kharif", 20000, 3, top_k=50)
    seen_loss = False
    for r in recs:
        if r["expected_profit"] <= 0:
            seen_loss = True
        else:
            assert not seen_loss, f"{r['crop_id']} is profitable but ranked below a loss"
```

- [ ] **Step 2: Run — expect FAIL** (`rank_recommendations` undefined)

- [ ] **Step 3: Implement** in `ml/predict.py` above `recommend_crops`:

```python
def rank_recommendations(recs: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Profitable crops first, then by smart_score.

    smart_score blends ROI with risk/soil/budget/ML fit, so a crop with a small
    expected loss could outscore a clearly profitable one. A farmer asking what
    to sow should never see a money-losing crop ranked above one that makes
    money; the score orders crops *within* each tier.
    """
    return sorted(recs, key=lambda r: (r["expected_profit"] > 0, r["smart_score"]), reverse=True)
```

and replace `ranked = sorted(recommendations, key=lambda x: x["smart_score"], reverse=True)` with `ranked = rank_recommendations(recommendations)`.

- [ ] **Step 4: Re-sort the golden fixtures** (they guard batched-vs-per-crop *values*; the order change is intended). One-off script: for each case, `case["expected"] = rank_recommendations(case["expected"])`, write back with the file's existing indentation. No scored value may change — diff must be reorder-only.

- [ ] **Step 5: Run** `tests/test_ranking_profitability.py tests/test_ml_batch_predict.py` — expect PASS.

---

### Task 3: Replace "Optimal mix" with a real, bounded allocation

Finding: 10 acres in Medak → 19 crops at ~0.5 ac, 12 loss-making, total −₹1,805, while turmeric alone projects ~₹4L. It also requires `soil`/`weather` it ignores.

Design: budget is spent per acre at the farm's rate, so budget is satisfied automatically when area sums to total — the allocation is a land-split problem. Profit is linear, so the pure profit optimum is one crop; a mix exists only to spread risk. Rules:
1. Eligible crops: `expected_profit > 0` only.
2. Order by risk-adjusted profit per acre: `profit_per_acre * (1 - risk_score / 200)`.
3. At most 3 crops; each parcel ≥ 0.5 ac; farms < 1 ac get one crop.
4. No crop gets more than 60% of the land when ≥ 2 crops are used; the last crop takes the remainder.
5. Report `single_crop_best` (all land on the top crop) and `diversification_cost` so the trade-off is visible, not hidden.

**Files:**
- Create: `engine/crop_mix.py`
- Modify: `backend/main.py` (`optimal_crop_mix`), `backend/models.py` (`CropMixRequest.soil/weather` → `Optional[...] = None`)
- Modify: `frontend/dashboard.js` (mix renderer: comparison line + empty-state copy)
- Test: `tests/test_crop_mix.py` (create), keep `tests/test_optimal_mix.py` passing

**Interfaces:** Produces `engine.crop_mix.allocate(recs: list[dict], total_area: float, budget_per_acre: float) -> dict` with keys `allocations` (list of `{crop_id, crop_name, allocated_acres, allocated_budget, expected_profit, roi_percent, risk_score, smart_score}`), `total_expected_profit`, `single_crop_best` (`{crop_id, expected_profit}` or None), `diversification_cost`. Each rec's `expected_profit` is for `total_area`.

- [ ] **Step 1: Write failing tests** (`tests/test_crop_mix.py`)

```python
from engine.crop_mix import allocate


def _rec(cid, profit, risk=30, score=50):
    return {"crop_id": cid, "crop_name": cid, "expected_profit": profit,
            "roi_percent": 10.0, "risk_score": risk, "smart_score": score}


def test_losses_never_allocated():
    out = allocate([_rec("a", 1000), _rec("b", -50), _rec("c", 400)], 10, 20000)
    assert {a["crop_id"] for a in out["allocations"]} == {"a", "c"}


def test_area_sums_to_total_and_respects_bounds():
    recs = [_rec(c, p) for c, p in [("a", 9000), ("b", 7000), ("c", 5000), ("d", 3000)]]
    out = allocate(recs, 10, 20000)
    areas = [a["allocated_acres"] for a in out["allocations"]]
    assert len(areas) == 3
    assert abs(sum(areas) - 10) < 1e-6
    assert max(areas) <= 6.0 + 1e-6 and min(areas) >= 0.5


def test_small_farm_gets_single_crop():
    out = allocate([_rec("a", 900), _rec("b", 800)], 0.8, 20000)
    assert [a["allocated_acres"] for a in out["allocations"]] == [0.8]


def test_reports_single_crop_comparison():
    out = allocate([_rec("a", 10000), _rec("b", 5000)], 10, 20000)
    assert out["single_crop_best"] == {"crop_id": "a", "expected_profit": 10000}
    assert out["diversification_cost"] == round(10000 - out["total_expected_profit"], 2)
    assert out["total_expected_profit"] > 0


def test_nothing_profitable_returns_empty():
    out = allocate([_rec("a", -1)], 5, 20000)
    assert out["allocations"] == [] and out["single_crop_best"] is None
```

Endpoint-level (append to `tests/test_optimal_mix.py`):

```python
def test_optimal_mix_is_never_negative_and_needs_no_soil_weather():
    r = client.post("/api/optimal-mix", json={"region_id": "telangana_medak", "season": "kharif",
                                              "total_area_acres": 10, "total_budget": 200000})
    assert r.status_code == 200
    d = r.json()
    assert d["total_expected_profit"] > 0
    assert 1 <= d["num_crops"] <= 3
    assert all(a["expected_profit"] > 0 for a in d["allocations"])
    assert abs(sum(a["allocated_acres"] for a in d["allocations"]) - 10) < 0.05
```

- [ ] **Step 2: Run — expect FAIL** (module missing; endpoint returns 422 without soil/weather)

- [ ] **Step 3: Implement `engine/crop_mix.py`**

```python
"""Split a farm's land across a few profitable crops.

Budget is spent per acre at the farm's own rate, so it is satisfied whenever
the land adds up; the decision is only how to split the land. Expected profit
is linear in area, so the profit-maximising answer is always a single crop --
a mix exists to spread risk, and the cost of that spreading is reported rather
than hidden.
"""
from __future__ import annotations

from typing import Any

MAX_CROPS = 3
MIN_PARCEL_ACRES = 0.5
MAX_SHARE = 0.6


def _risk_adjusted_per_acre(rec: dict[str, Any], total_area: float) -> float:
    return (rec["expected_profit"] / total_area) * (1 - rec["risk_score"] / 200.0)


def _split(total: float, k: int) -> list[float]:
    cap = total * MAX_SHARE
    areas: list[float] = []
    remaining = total
    for i in range(k):
        left_after = k - i - 1
        if left_after == 0:
            areas.append(remaining)
        else:
            area = min(cap, remaining - left_after * MIN_PARCEL_ACRES)
            areas.append(area)
            remaining -= area
    return areas


def allocate(recs: list[dict[str, Any]], total_area: float, budget_per_acre: float) -> dict[str, Any]:
    profitable = sorted(
        (r for r in recs if r["expected_profit"] > 0),
        key=lambda r: _risk_adjusted_per_acre(r, total_area),
        reverse=True,
    )
    if not profitable:
        return {"allocations": [], "total_expected_profit": 0.0,
                "single_crop_best": None, "diversification_cost": 0.0}

    by_profit = max(profitable, key=lambda r: r["expected_profit"])
    k = min(MAX_CROPS, len(profitable), max(1, int(total_area // MIN_PARCEL_ACRES)))
    if total_area < 2 * MIN_PARCEL_ACRES:
        k = 1

    allocations = []
    for rec, area in zip(profitable[:k], _split(total_area, k)):
        allocations.append({
            "crop_id": rec["crop_id"],
            "crop_name": rec["crop_name"],
            "allocated_acres": round(area, 2),
            "allocated_budget": round(area * budget_per_acre, 2),
            "expected_profit": round(rec["expected_profit"] * area / total_area, 2),
            "roi_percent": rec["roi_percent"],
            "risk_score": rec["risk_score"],
            "smart_score": rec["smart_score"],
        })
    total = round(sum(a["expected_profit"] for a in allocations), 2)
    return {
        "allocations": allocations,
        "total_expected_profit": total,
        "single_crop_best": {"crop_id": by_profit["crop_id"], "expected_profit": by_profit["expected_profit"]},
        "diversification_cost": round(by_profit["expected_profit"] - total, 2),
    }
```

Rewrite the endpoint body after the `recommend_crops(...)` call:

```python
    budget_per_acre = req.total_budget / req.total_area_acres
    mix = allocate_crop_mix(all_crops, req.total_area_acres, budget_per_acre)
    allocs = mix["allocations"]
    return {
        "region_id": req.region_id,
        "season": req.season,
        "total_area_acres": req.total_area_acres,
        "total_budget": req.total_budget,
        "allocations": allocs,
        "total_expected_profit": mix["total_expected_profit"],
        "single_crop_best": mix["single_crop_best"],
        "diversification_cost": mix["diversification_cost"],
        "avg_risk_score": round(mean([a["risk_score"] for a in allocs]), 2) if allocs else 0,
        "num_crops": len(allocs),
        "unallocated_budget": 0.0 if allocs else req.total_budget,
        "unallocated_area_acres": 0.0 if allocs else req.total_area_acres,
        "method": "Up to 3 profitable crops, ranked by risk-adjusted profit per acre; no crop above 60% of the land.",
    }
```

(import `from engine.crop_mix import allocate as allocate_crop_mix`; drop the `total_score == 0` branch and the "No crops available" 404 stays.)

- [ ] **Step 4: Frontend** — in the mix renderer, when `allocs` is empty show "No crop is expected to make a profit at this budget in this region and season. Try a larger budget or another season." When `r.single_crop_best && r.diversification_cost > 0`, add a `kpi__sub` line: "Growing only {crop} would earn about {INR(single)} — this mix gives up {INR(cost)} to spread risk." Add the four strings to `i18n-data.js`. Stop sending `soil`/`weather` only if trivially removable — they are now optional, so the existing request keeps working unchanged.

- [ ] **Step 5: Run** `tests/test_crop_mix.py tests/test_optimal_mix.py` — expect PASS.

---

### Task 4: Scope sensor readings to the uploading device

Finding: `/api/iot/telemetry` and `/api/sensors/{region_id}` return the latest reading in the *region*, so one farmer's upload shows as `LIVE_FARMER_DATA` for everyone there.

**Files:**
- Modify: `utils/sensor_log.py` (`latest_by_metric` gains keyword `device_id: str | None = None`)
- Modify: `backend/models.py` (`IoTTelemetryQuery.device_id: Optional[str] = Field(None, max_length=100)`)
- Modify: `backend/main.py` (telemetry: only overlay when `device_id` given; `GET /api/sensors/{region_id}` requires `device_id` query param)
- Modify: `frontend/dashboard.js` (telemetry call sends `device_id: window.MM.deviceId()`)
- Test: `tests/test_sensor_scoping.py` (create)

- [ ] **Step 1: Failing tests**

```python
from fastapi.testclient import TestClient
from backend.main import app
from utils.sensor_log import append_batch, latest_by_metric

client = TestClient(app)


def _seed():
    append_batch(region_id="telangana_medak", device_id="dev_a", source="csv_upload",
                 readings=[{"metric": "soil_moisture_pct", "value": 12.0}])


def test_latest_by_metric_filters_by_device():
    _seed()
    assert latest_by_metric("telangana_medak", device_id="dev_b") == {}
    assert "soil_moisture_pct" in latest_by_metric("telangana_medak", device_id="dev_a")


def test_telemetry_does_not_leak_other_devices():
    _seed()
    r = client.post("/api/iot/telemetry", json={"region_id": "telangana_medak", "device_id": "dev_b"}).json()
    assert r["is_live"] is False and r["soil_moisture_pct"] != 12.0
    r = client.post("/api/iot/telemetry", json={"region_id": "telangana_medak", "device_id": "dev_a"}).json()
    assert r["is_live"] is True and r["soil_moisture_pct"] == 12.0


def test_telemetry_without_device_is_sample_only():
    _seed()
    r = client.post("/api/iot/telemetry", json={"region_id": "telangana_medak"}).json()
    assert r["is_live"] is False


def test_sensor_get_requires_device():
    _seed()
    assert client.get("/api/sensors/telangana_medak").status_code == 422
    assert client.get("/api/sensors/telangana_medak?device_id=dev_a").json()["available"] is True
```

- [ ] **Step 2: Run — expect FAIL**
- [ ] **Step 3: Implement** — SQL becomes `WHERE region_id = ?` plus `AND device_id = ?` when `device_id` is given; telemetry overlays only `if region_id and req.device_id`; GET endpoint signature `device_id: str = Query(..., min_length=1, max_length=100)`. Update existing `tests/test_sensor_api.py` callers that relied on region-wide reads to pass the uploading `device_id`.
- [ ] **Step 4: Run** `tests/test_sensor_scoping.py tests/test_sensor_api.py tests/test_sensor_log.py` — expect PASS.

---

### Task 5: Correct the pump water volume physics

Finding: 10,000 L per acre per 10% deficit. Real volume = deficit fraction × root-zone depth × area: 0.10 × 0.30 m × 4,046.86 m² = 121.4 m³ = 121,406 L.

**Files:**
- Modify: `backend/models.py` (`IoTTriggerRequest.root_zone_depth_cm: Optional[float] = Field(30.0, ge=5, le=150)`)
- Modify: `backend/main.py` (`trigger_smart_pump`)
- Modify: `frontend/dashboard.js` (show runtime as h + min when ≥ 60 min)
- Test: `tests/test_pump_physics.py` (create)

- [ ] **Step 1: Failing test**

```python
from fastapi.testclient import TestClient
from backend.main import app

client = TestClient(app)


def test_ten_percent_deficit_one_acre_30cm():
    r = client.post("/api/iot/pump-trigger", json={"current_moisture_pct": 30, "target_moisture_pct": 40,
                                                   "area_acres": 1, "flow_rate_lpm": 100}).json()
    assert abs(r["required_water_liters"] - 121406.0) < 5
    assert abs(r["recommended_pump_runtime_minutes"] - 1214.1) < 0.5
    assert r["root_zone_depth_cm"] == 30.0


def test_depth_scales_linearly():
    base = {"current_moisture_pct": 30, "target_moisture_pct": 40, "area_acres": 1}
    a = client.post("/api/iot/pump-trigger", json={**base, "root_zone_depth_cm": 15}).json()
    b = client.post("/api/iot/pump-trigger", json={**base, "root_zone_depth_cm": 30}).json()
    assert abs(b["required_water_liters"] - 2 * a["required_water_liters"]) < 1
```

- [ ] **Step 2: Run — expect FAIL**
- [ ] **Step 3: Implement**

```python
SQM_PER_ACRE = 4046.86
...
        depth_m = (req.root_zone_depth_cm or 30.0) / 100.0
        # Volumetric deficit x root-zone depth x area -> m^3, x1000 -> litres.
        water_volume_liters = round((deficit_pct / 100.0) * depth_m * area * SQM_PER_ACRE * 1000.0, 1)
```

and return `"root_zone_depth_cm": depth_m * 100`.

- [ ] **Step 4: Run — expect PASS**

---

### Task 6: PM-KISAN has no landholding cap

Finding: `government_schemes.csv` caps PM-KISAN at 5 acres; the cap was removed in June 2019 (all landholding farmer families eligible, subject to exclusions such as income-tax payers and institutional landholders).

**Files:**
- Modify: `dataset/government_schemes.csv` (pmkisan `max_area_acres` → `999`, description adds the exclusions)
- Test: `tests/test_schemes_data.py` (create)

- [ ] **Step 1: Failing test**

```python
from engine.features import match_government_schemes


def test_pmkisan_has_no_area_cap():
    ids = {s["scheme_id"] for s in match_government_schemes("wheat", "punjab_ludhiana", area_acres=12)["eligible_schemes"]}
    assert "pmkisan" in ids
```

- [ ] **Step 2–4:** run (FAIL), edit CSV row to
  `pmkisan,PM-KISAN,"Direct income support of Rs 6000/year in 3 installments to landholding farmer families (no landholding cap since 2019; income-tax payers, institutional landholders and some professionals are excluded)",all,all,0,999,cash_transfer,6000,all,https://pmkisan.gov.in`, run (PASS). Check the CSV loader handles the quoted comma field (it uses `csv.DictReader`).

---

### Task 7: Disease scan stops defaulting unsupported leaves to tomato

Finding: no crop selected (or a crop the model doesn't cover) falls through to tomato classes, while the UI offers "Auto-detect from image".

Design: the API requires a supported crop (`maize`, `potato`, `soybean`, `tomato`); anything else is a 422 with a plain message listing supported crops. The UI drops the misleading "Auto-detect" option, requires a choice, and says which crops are covered.

**Files:**
- Modify: `backend/main.py` (`predict_disease_api`, crop-context block), `ml/predict.py` (`predict_disease_ml` docstring/prefix: require crop)
- Modify: `frontend/dashboard.html`, `frontend/gyan-seva.html` (select), `frontend/dashboard.js`, `frontend/gyan-seva.js` (client-side guard with `userError`)
- Test: add to `tests/test_disease_api.py`

- [ ] **Step 1: Failing tests** (reuse the module's existing `_img_b64` helper style)

```python
@pytest.mark.parametrize("crop", [None, "", "cotton", "rice"])
def test_disease_predict_rejects_unsupported_or_missing_crop(crop):
    payload = {"image_b64": _leaf_b64(), "crop_id": crop}
    r = client.post("/api/disease/predict", json=payload)
    assert r.status_code == 422
    assert "maize" in r.json()["detail"] and "tomato" in r.json()["detail"]
```

(`_leaf_b64()` builds a 64×64 green PNG as the existing tests do.)

- [ ] **Step 2: Run — expect FAIL** (200 with a tomato diagnosis)
- [ ] **Step 3: Implement** — before image decoding (after rate limiting):

```python
SUPPORTED_DISEASE_CROPS = ("maize", "potato", "soybean", "tomato")
...
    crop = (req.crop_id or "").lower().strip()
    if crop not in SUPPORTED_DISEASE_CROPS:
        raise HTTPException(
            status_code=422,
            detail=("Leaf screening currently covers only "
                    + ", ".join(SUPPORTED_DISEASE_CROPS)
                    + ". Choose one of these crops; other crops cannot be screened yet."),
        )
```

Remove the later `valid_crops` reset and the "default to Tomato" branch comment; `predict_disease_ml` uses `crop + "_"` with no tomato fallback. Frontend: replace the "Auto-detect from image" option with `<option value="" disabled selected>Choose crop…</option>`, add a hint "Covers maize, potato, soybean and tomato leaves only.", and in both click handlers throw/show a `userError('Choose the crop in the photo first.')` when empty. Add strings to `i18n-data.js`.

- [ ] **Step 4: Run** `tests/test_disease_api.py` — expect PASS.

---

### Task 8: Live 7-day forecast with field-work windows

Finding: nothing in the running app uses a live forecast; `/api/weather` returns seasonal CSV averages and the IMD alert is "Unavailable".

**Files:**
- Create: `engine/forecast.py` (fetch + pure advice logic)
- Modify: `backend/main.py` (`GET /api/forecast`)
- Modify: `frontend/dashboard.js` (My Farm "This week" card), `frontend/style.css` (small day-strip styles), `frontend/i18n-data.js`, `frontend/sw.js` (VERSION bump)
- Test: `tests/test_forecast.py` (create; network mocked)

**Interfaces:**
- `engine.forecast.fetch_daily(lat: float, lon: float) -> dict` — Open-Meteo `daily` block; raises `ForecastUnavailable` on any network/shape failure. In-process cache keyed by rounded (lat, lon), TTL 1 h.
- `engine.forecast.field_windows(daily: dict) -> list[dict]` — one entry per day: `{date, rain_mm, rain_prob_pct, tmax_c, tmin_c, wind_max_kmh, spray: "good"|"avoid", spray_reason, irrigate: "skip"|"check", irrigate_reason, heat_stress: bool}`.

Rules (standard label/extension guidance, stated in the response):
- Spray **avoid** if rain ≥ 2 mm today or tomorrow, or rain probability ≥ 60% today, or max wind > 15 km/h; else **good**.
- Irrigation **skip** if today + next 2 days rain ≥ 10 mm; else **check** (check soil moisture).
- Heat stress when tmax ≥ 40 °C.

- [ ] **Step 1: Failing tests**

```python
import pytest
from fastapi.testclient import TestClient

import engine.forecast as F
from backend.main import app

client = TestClient(app)

DAILY = {
    "time": ["2026-09-23", "2026-09-24", "2026-09-25", "2026-09-26"],
    "precipitation_sum": [0.0, 12.0, 0.0, 0.0],
    "precipitation_probability_max": [10, 80, 5, 0],
    "temperature_2m_max": [33.0, 30.0, 41.0, 34.0],
    "temperature_2m_min": [22.0, 21.0, 26.0, 23.0],
    "wind_speed_10m_max": [8.0, 9.0, 18.0, 6.0],
}


def test_spray_avoided_before_rain_and_in_wind():
    days = F.field_windows(DAILY)
    assert days[0]["spray"] == "avoid"      # rain tomorrow
    assert days[1]["spray"] == "avoid"      # rain today
    assert days[2]["spray"] == "avoid"      # wind 18 km/h
    assert days[3]["spray"] == "good"


def test_irrigation_skipped_when_rain_coming():
    days = F.field_windows(DAILY)
    assert days[0]["irrigate"] == "skip"
    assert days[3]["irrigate"] == "check"


def test_heat_stress_flag():
    assert [d["heat_stress"] for d in F.field_windows(DAILY)] == [False, False, True, False]


def test_endpoint_returns_days(monkeypatch):
    monkeypatch.setattr(F, "fetch_daily", lambda lat, lon: DAILY)
    r = client.get("/api/forecast?lat=18.0&lon=78.3")
    assert r.status_code == 200
    body = r.json()
    assert body["source"] == "Open-Meteo" and len(body["days"]) == 4


def test_endpoint_unavailable_is_honest(monkeypatch):
    def boom(lat, lon):
        raise F.ForecastUnavailable("down")
    monkeypatch.setattr(F, "fetch_daily", boom)
    r = client.get("/api/forecast?lat=18.0&lon=78.3")
    assert r.status_code == 503


def test_endpoint_rejects_points_outside_india():
    assert client.get("/api/forecast?lat=51.5&lon=0.1").status_code == 422
```

- [ ] **Step 2: Run — expect FAIL**
- [ ] **Step 3: Implement `engine/forecast.py`** (requests with 6 s timeout; params `daily=precipitation_sum,precipitation_probability_max,temperature_2m_max,temperature_2m_min,wind_speed_10m_max`, `forecast_days=7`, `timezone=Asia/Kolkata`; validate that every listed key exists and lengths match `time`, else raise `ForecastUnavailable`). Endpoint: `lat: float = Query(..., ge=6, le=38)`, `lon: float = Query(..., ge=68, le=98)`; returns `{source: "Open-Meteo", fetched_at, lat, lon, rules: {...human-readable thresholds...}, days: field_windows(daily)}`; `ForecastUnavailable` → 503 "Live forecast is unavailable right now." Response should not be cached by the 30 s route cache beyond the module's own TTL (fine as is).
- [ ] **Step 4: Frontend** — in `renderHome`, after the KPI grid, render a "This week on your farm" card: coordinates from `FarmState.load()` (lat/lon) else the region's entry in `FarmState.REGION_CENTROIDS`. Seven compact day cells: weekday, rain mm, max temp, a Spray chip (green "Spray OK" / red "Don't spray" with reason as `title`), and one summary line (next good spray day; irrigation skip note). On failure: "Live forecast unavailable — check IMD before spraying." Load it after the main render so it never blocks the tab. All dynamic text via `esc()`. Add strings to `i18n-data.js` (hi/te/kn/ta). Bump `sw.js` VERSION.
- [ ] **Step 5: Run** `tests/test_forecast.py` — expect PASS; verify in the browser preview.

---

### Task 9: Season ledger — per-plot expenses, harvest record, planned vs actual

Finding: the loop stops at "commit"; expenses are one global list ignoring plots/seasons; nothing records what was actually harvested or sold.

Design (client-side; no accounts exist yet):
- Expenses gain `plot_id` and `season_key` (`<season>-<year>`, from the profile). The tracker shows the active plot + season; legacy untagged entries are adopted into the active plot/season the first time they are read (one-time migration, persisted).
- New "Harvest & sale" form in the same tool: quantity (kg), price (₹/kg), date, note → stored under `mm_harvests` with the same tags.
- "Season result" block: Planned (committed crop's `expected_profit` and yield from `/api/crop-comparison`, as My Farm already fetches) vs Actual (revenue − spend). If no crop is committed, show actuals only and say so.

**Files:**
- Modify: `frontend/dashboard.html` (expense tool: harvest form + result container; rename heading to "Season ledger")
- Modify: `frontend/dashboard.js` (expense block ~line 2660)
- Modify: `frontend/i18n-data.js`, `frontend/sw.js`

**Interfaces (dashboard.js, internal):**
- `ledgerScope() -> {plot_id: string, season_key: string}` — active plot id (`FarmState.getActiveId()` or `'default'`) and `profile.season + '-' + year`.
- `loadExpenses()` returns only entries matching `ledgerScope()`; `loadAllExpenses()` returns the raw list.
- `loadHarvests()` / `saveHarvests(list)` under `mm_harvests`, scoped the same way.

- [ ] **Step 1:** Write the scoping + migration code; re-render on `mm:plot-changed`.
- [ ] **Step 2:** Harvest form + list with delete, validation (`qty > 0`, `price > 0`) via `MM.toast`.
- [ ] **Step 3:** Season result KPIs: Spent, Revenue, Actual profit, Planned profit (and variance chip).
- [ ] **Step 4:** i18n strings, `sw.js` VERSION bump.
- [ ] **Step 5:** Verify in the browser preview: two plots keep separate ledgers; a harvest entry updates actual profit; switching season hides the other season's entries; reload persists.

---

## Final verification

- [ ] `venv/Scripts/python.exe -m pytest -q tests` — all pass, no `InconsistentVersionWarning`.
- [ ] Browser preview: My Farm forecast card, Optimal mix on 10 ac, disease scan without crop, pump runtime, season ledger.
- [ ] Re-run the review's reproduction: Medak 10 ac mix → positive total, ≤ 3 crops; crop-comparison → no loss ranked above a profit.
