# Regional Saturation-Aware Recommendations Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the crop recommender aware of how much of a given crop other nearby farmers have already committed to this season, and nudge (never override) its ranking away from crops the region is already over-planting relative to its own historical norm.

**Architecture:** A new append-only commit log (`dataset/dynamic/commitments.csv`, written via `utils/commitment_log.py`) records farmers' "I'm planting this" actions. `ml/predict.py` compares live commitments against each crop's historical planted acreage (`yield_history.csv`, already on disk) to compute a per-crop saturation ratio, which enters `_score_single_crop`'s existing weighted `smart_score` as a small capped penalty term. A new `POST /api/commit-crop` endpoint writes to the log; the "Smart recommend" dashboard card gains a badge and button to trigger it.

**Tech Stack:** FastAPI + Pydantic (backend), scikit-learn-backed heuristic/ML blend (`ml/predict.py`), CSV-as-datastore (`utils/csv_cache.py` pattern), vanilla JS + zero-build frontend (`frontend/dashboard.js`, `frontend/mm-core.js`), pytest + `fastapi.testclient.TestClient`.

**Spec:** [docs/superpowers/specs/2026-09-02-regional-saturation-aware-recommendations-design.md](../specs/2026-09-02-regional-saturation-aware-recommendations-design.md)

## Global Constraints

- Saturation penalty is capped at **-10 points** on the final `smart_score` (0-100 scale) — a nudge, never an override of a farmer's own soil/ROI/risk/budget fit. (Spec §6)
- A crop/region/season with **zero years** of `yield_history.csv` data gets **no penalty and no badge** (`saturation_ratio = None`, `saturation_label = None`) — absence of data must never suppress a recommendation. (Spec §6, §9)
- A repeat commit from the same `device_id` + `region_id` + `season` + `year` **overwrites** the prior row rather than duplicating it. (Spec §5.1, §9)
- This build touches only `/api/recommend`, `/api/crop`, and the "Smart recommend" dashboard card. Rotation planner, crop-mix tools, and `/api/crop-recommendations` are explicitly out of scope. (Spec §4)
- No new dependencies, no database — CSV-as-datastore, consistent with the rest of the app.

---

### Task 1: Commitment log module

**Files:**
- Create: `utils/commitment_log.py`
- Test: `tests/test_commitment_log.py`

**Interfaces:**
- Produces: `read_all() -> list[dict[str, str]]`, `upsert(*, region_id: str, crop_id: str, season: str, year: int, area_acres: float, device_id: str) -> dict[str, Any]` — both consumed by Task 2 (`ml/predict.py`) and Task 3 (`backend/main.py`).
- `upsert`'s returned dict has keys `commitment_id, region_id, crop_id, season, year, area_acres, device_id, timestamp` (all strings except the caller's original types are stringified for CSV storage).

Note on a spec deviation: the spec (§5.1) suggested delegating reads to `utils/csv_cache.py` for its mtime-based cache. In practice `upsert()` needs to read-modify-write the file, and two upserts issued back-to-back (e.g. the overwrite test below) could hit the same on-disk mtime tick before `csv_cache` would invalidate its cache — a real race, not a hypothetical one. This module instead does its own uncached read on every call, guarded by a single `threading.RLock`, avoiding the race entirely. This costs a full re-parse per call, which is fine given the documented row count (a few hundred rows/season across 30 regions).

- [ ] **Step 1: Write the failing tests**

```python
"""
tests/test_commitment_log.py
Unit tests for utils/commitment_log.py -- the regional-saturation commit
log written to by /api/commit-crop and read by ml/predict.py's saturation
scoring (see docs/superpowers/specs/2026-09-02-regional-saturation-aware-recommendations-design.md).
"""
from __future__ import annotations

import pytest


@pytest.fixture(autouse=True)
def isolated_commitments_file(tmp_path, monkeypatch):
    from utils import commitment_log
    monkeypatch.setattr(commitment_log, "_COMMITMENTS_PATH", tmp_path / "commitments.csv")
    yield


def test_read_all_returns_empty_list_when_file_missing():
    from utils.commitment_log import read_all
    assert read_all() == []


def test_upsert_creates_a_row():
    from utils.commitment_log import read_all, upsert
    upsert(
        region_id="telangana_medak", crop_id="cotton", season="kharif",
        year=2026, area_acres=4.5, device_id="dev_a",
    )
    rows = read_all()
    assert len(rows) == 1
    assert rows[0]["region_id"] == "telangana_medak"
    assert rows[0]["crop_id"] == "cotton"
    assert rows[0]["season"] == "kharif"
    assert rows[0]["year"] == "2026"
    assert rows[0]["area_acres"] == "4.5"
    assert rows[0]["device_id"] == "dev_a"
    assert rows[0]["commitment_id"].startswith("c_")
    assert rows[0]["timestamp"]


def test_upsert_overwrites_prior_commitment_from_same_device():
    from utils.commitment_log import read_all, upsert
    upsert(region_id="telangana_medak", crop_id="cotton", season="kharif", year=2026, area_acres=4.5, device_id="dev_a")
    upsert(region_id="telangana_medak", crop_id="soybean", season="kharif", year=2026, area_acres=3.0, device_id="dev_a")
    rows = read_all()
    assert len(rows) == 1, "second commit from the same device/region/season/year must replace the first, not add a row"
    assert rows[0]["crop_id"] == "soybean"
    assert rows[0]["area_acres"] == "3.0"


def test_upsert_keeps_separate_rows_for_different_devices():
    from utils.commitment_log import read_all, upsert
    upsert(region_id="telangana_medak", crop_id="cotton", season="kharif", year=2026, area_acres=4.5, device_id="dev_a")
    upsert(region_id="telangana_medak", crop_id="cotton", season="kharif", year=2026, area_acres=2.0, device_id="dev_b")
    rows = read_all()
    assert len(rows) == 2


def test_upsert_keeps_separate_rows_for_different_seasons():
    from utils.commitment_log import read_all, upsert
    upsert(region_id="telangana_medak", crop_id="cotton", season="kharif", year=2026, area_acres=4.5, device_id="dev_a")
    upsert(region_id="telangana_medak", crop_id="wheat", season="rabi", year=2026, area_acres=4.5, device_id="dev_a")
    rows = read_all()
    assert len(rows) == 2
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `venv/Scripts/python.exe -m pytest tests/test_commitment_log.py -v`
Expected: FAIL / ERROR — `ModuleNotFoundError: No module named 'utils.commitment_log'`

- [ ] **Step 3: Implement `utils/commitment_log.py`**

```python
"""
utils/commitment_log.py

Append-only log of farmers' "I'm planting this" commitments, used by
ml/predict.py to compute a regional crop-saturation signal (see
docs/superpowers/specs/2026-09-02-regional-saturation-aware-recommendations-design.md).

Lives in dataset/dynamic/ rather than dataset/ because, unlike the static
seed CSVs, this file is written to at runtime.
"""
from __future__ import annotations

import csv
import threading
import time
import uuid
from pathlib import Path
from typing import Any

from utils.csv_cache import DATASET_DIR

_COMMITMENTS_PATH: Path = DATASET_DIR / "dynamic" / "commitments.csv"
_FIELDNAMES = [
    "commitment_id", "region_id", "crop_id", "season", "year",
    "area_acres", "device_id", "timestamp",
]

_lock = threading.RLock()


def _read_rows_from_disk() -> list[dict[str, str]]:
    if not _COMMITMENTS_PATH.exists():
        return []
    with _COMMITMENTS_PATH.open("r", encoding="utf-8", newline="") as f:
        return list(csv.DictReader(f))


def read_all() -> list[dict[str, str]]:
    """Return all commitment rows, freshly read from disk.

    No in-memory cache: this file is small (a few hundred rows/season
    across 30 regions) and `upsert()` needs a correctness guarantee a
    mtime-based cache can't give it under fast successive writes.
    """
    with _lock:
        return _read_rows_from_disk()


def upsert(
    *, region_id: str, crop_id: str, season: str, year: int,
    area_acres: float, device_id: str,
) -> dict[str, Any]:
    """Record a farmer's planting commitment.

    A prior commitment from the same device_id for the same
    region_id/season/year is replaced in place (latest crop_id/area_acres/
    timestamp wins) rather than duplicated, so one farmer re-committing or
    changing their mind doesn't inflate the region's saturation count.
    """
    with _lock:
        rows = _read_rows_from_disk()
        key = (device_id, region_id, season, str(year))
        rows = [
            r for r in rows
            if (r["device_id"], r["region_id"], r["season"], r["year"]) != key
        ]
        new_row = {
            "commitment_id": f"c_{uuid.uuid4().hex[:12]}",
            "region_id": region_id,
            "crop_id": crop_id,
            "season": season,
            "year": str(year),
            "area_acres": str(area_acres),
            "device_id": device_id,
            "timestamp": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        }
        rows.append(new_row)

        _COMMITMENTS_PATH.parent.mkdir(parents=True, exist_ok=True)
        with _COMMITMENTS_PATH.open("w", encoding="utf-8", newline="") as f:
            writer = csv.DictWriter(f, fieldnames=_FIELDNAMES)
            writer.writeheader()
            writer.writerows(rows)

        return new_row
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `venv/Scripts/python.exe -m pytest tests/test_commitment_log.py -v`
Expected: PASS (5 tests)

- [ ] **Step 5: Commit**

```bash
git add utils/commitment_log.py tests/test_commitment_log.py
git commit -m "feat(commit-log): add append-only regional planting-commitment log"
```

---

### Task 2: Regional saturation scoring in `ml/predict.py`

**Files:**
- Modify: `ml/predict.py:1-19` (imports), `ml/predict.py:1055-1145` (`_score_single_crop`), `ml/predict.py:1148-1225` (`recommend_crops`)
- Test: `tests/test_ml_predict.py` (append)
- Regenerate: `tests/fixtures/recommend_crops_golden.json`, `tests/fixtures/recommend_crops_golden_heuristic.json`

**Interfaces:**
- Consumes: `utils.commitment_log.read_all() -> list[dict[str, str]]` (Task 1).
- Produces: `_compute_region_saturation(region_id: str, season: str, crop_ids: list[str], crop_params: dict[str, CropParameter], year: int | None = None) -> dict[str, dict[str, Any]]`, mapping `crop_id -> {"ratio": float, "label": str | None}` for crops with a historical baseline (crops without one are simply absent from the dict). `_score_single_crop` gains a new required parameter `region_saturation: dict[str, dict[str, Any]]` (inserted after `ml_conf_map`, before `ml_yield`). Both `recommend_crops`'s output dicts and `_score_single_crop`'s output dict gain two new keys: `saturation_ratio: float | None`, `saturation_label: str | None`.

- [ ] **Step 1: Write the failing tests**

Append to `tests/test_ml_predict.py`:

```python
def test_compute_region_saturation_zero_when_no_commitments():
    from ml.predict import _compute_region_saturation, _load_crop_parameters
    crop_params = _load_crop_parameters()
    result = _compute_region_saturation("telangana_medak", "kharif", ["rice"], crop_params, year=2099)
    assert result["rice"]["ratio"] == 0.0
    assert result["rice"]["label"] is None


def test_compute_region_saturation_no_baseline_omits_crop():
    from ml.predict import _compute_region_saturation, _load_crop_parameters
    crop_params = _load_crop_parameters()
    result = _compute_region_saturation("telangana_medak", "kharif", ["dragonfruit_unknown"], crop_params, year=2099)
    assert "dragonfruit_unknown" not in result


def test_compute_region_saturation_ratio_from_real_commitment(monkeypatch, tmp_path):
    from utils import commitment_log
    monkeypatch.setattr(commitment_log, "_COMMITMENTS_PATH", tmp_path / "commitments.csv")

    from ml.predict import _compute_region_saturation, _load_crop_parameters
    crop_params = _load_crop_parameters()

    # telangana_medak/rice/kharif historical area_acres: 170887 (2022), 94356
    # (2023), 111410 (2024) -> average exactly 125551.0.
    commitment_log.upsert(
        region_id="telangana_medak", crop_id="rice", season="kharif",
        year=2099, area_acres=125551.0, device_id="dev_test",
    )
    result = _compute_region_saturation("telangana_medak", "kharif", ["rice"], crop_params, year=2099)
    assert result["rice"]["ratio"] == pytest.approx(1.0)
    assert result["rice"]["label"] == "100% of typical Rice acreage already committed this season"


def test_compute_region_saturation_ratio_clamped_at_two(monkeypatch, tmp_path):
    from utils import commitment_log
    monkeypatch.setattr(commitment_log, "_COMMITMENTS_PATH", tmp_path / "commitments.csv")

    from ml.predict import _compute_region_saturation, _load_crop_parameters
    crop_params = _load_crop_parameters()

    commitment_log.upsert(
        region_id="telangana_medak", crop_id="rice", season="kharif",
        year=2099, area_acres=125551.0 * 5, device_id="dev_test",
    )
    result = _compute_region_saturation("telangana_medak", "kharif", ["rice"], crop_params, year=2099)
    assert result["rice"]["ratio"] == pytest.approx(2.0)


def test_score_single_crop_applies_capped_saturation_penalty():
    from ml.predict import _score_single_crop, _load_crop_parameters, _prepare_region_data

    crop_params = _load_crop_parameters()
    weather, soil = _prepare_region_data("telangana_medak", "kharif")
    crop = crop_params["rice"]
    common_kwargs = dict(
        crop_id="rice", crop=crop, weather=weather, soil=soil,
        region_id="telangana_medak", season="kharif",
        budget_per_acre=15000.0, area_acres=3.0,
        region_crop_price={}, ml_conf_map={},
    )

    baseline = _score_single_crop(**common_kwargs, region_saturation={})
    half_saturated = _score_single_crop(
        **common_kwargs, region_saturation={"rice": {"ratio": 1.0, "label": "x"}},
    )
    fully_saturated = _score_single_crop(
        **common_kwargs, region_saturation={"rice": {"ratio": 2.0, "label": "x"}},
    )

    assert baseline["smart_score"] == pytest.approx(half_saturated["smart_score"] + 5.0, abs=0.01)
    assert baseline["smart_score"] == pytest.approx(fully_saturated["smart_score"] + 10.0, abs=0.01)
    # Cap holds even past ratio=2.0 (defensive -- _compute_region_saturation
    # already clamps to [0, 2], but _score_single_crop must not trust that).
    over_saturated = _score_single_crop(
        **common_kwargs, region_saturation={"rice": {"ratio": 5.0, "label": "x"}},
    )
    assert baseline["smart_score"] == pytest.approx(over_saturated["smart_score"] + 10.0, abs=0.01)


def test_score_single_crop_no_baseline_means_no_penalty():
    from ml.predict import _score_single_crop, _load_crop_parameters, _prepare_region_data

    crop_params = _load_crop_parameters()
    weather, soil = _prepare_region_data("telangana_medak", "kharif")
    crop = crop_params["rice"]
    entry = _score_single_crop(
        crop_id="rice", crop=crop, weather=weather, soil=soil,
        region_id="telangana_medak", season="kharif",
        budget_per_acre=15000.0, area_acres=3.0,
        region_crop_price={}, ml_conf_map={}, region_saturation={},
    )
    assert entry["saturation_ratio"] is None
    assert entry["saturation_label"] is None
```

Add `import pytest` if not already at the top of `tests/test_ml_predict.py` (it already imports `pytest` per the existing `test_predict_yield_unsupported_crop_raises` test using `pytest.raises`).

- [ ] **Step 2: Run tests to verify they fail**

Run: `venv/Scripts/python.exe -m pytest tests/test_ml_predict.py -v -k saturation`
Expected: FAIL — `ImportError: cannot import name '_compute_region_saturation'` / `TypeError: _score_single_crop() got an unexpected keyword argument 'region_saturation'`

- [ ] **Step 3: Add the `datetime` import**

In `ml/predict.py`, the stdlib import block currently reads:

```python
import logging
import math
import threading
from pathlib import Path
from statistics import mean
from typing import Any
```

Change to:

```python
import logging
import math
import threading
from datetime import datetime
from pathlib import Path
from statistics import mean
from typing import Any
```

- [ ] **Step 4: Add `_compute_region_saturation`**

Insert immediately before `_score_single_crop` (currently `ml/predict.py:1054`, right after the `# FIX (3.2): Extracted per-crop scoring into its own function` comment marker — insert the new function above that comment):

```python
def _compute_region_saturation(
    region_id: str,
    season: str,
    crop_ids: list[str],
    crop_params: dict[str, CropParameter],
    year: int | None = None,
) -> dict[str, dict[str, Any]]:
    """Build a per-crop regional saturation map for this region/season.

    Compares this season's live planting commitments
    (utils.commitment_log) against each crop's historical planted acreage
    in this region (yield_history.csv, averaged over up to its 3 most
    recent years for this exact region/crop/season) to flag crops the
    region is already over-planting relative to its own norm.

    A crop absent from the returned dict has no historical baseline to
    judge against and must not be penalized for it -- see
    _score_single_crop.
    """
    from utils.commitment_log import read_all as _read_commitments

    if year is None:
        year = datetime.now().year

    history_rows = _load_yield_history()
    season_lower = season.lower()
    commit_rows = [
        r for r in _read_commitments()
        if r["region_id"] == region_id
        and r["season"].lower() == season_lower
        and r["year"] == str(year)
    ]
    committed_by_crop: dict[str, float] = {}
    for r in commit_rows:
        committed_by_crop[r["crop_id"]] = (
            committed_by_crop.get(r["crop_id"], 0.0) + float(r["area_acres"])
        )

    saturation: dict[str, dict[str, Any]] = {}
    for crop_id in crop_ids:
        matching = [
            r for r in history_rows
            if r["region_id"] == region_id
            and r["crop_id"] == crop_id
            and r["season"].lower() == season_lower
        ]
        if not matching:
            continue
        matching.sort(key=lambda r: int(r["year"]), reverse=True)
        recent_acres = [float(r["area_acres"]) for r in matching[:3]]
        historical_avg_acres = mean(recent_acres)
        if historical_avg_acres <= 0:
            continue

        committed_acres = committed_by_crop.get(crop_id, 0.0)
        ratio = clamp(committed_acres / historical_avg_acres, 0.0, 2.0)
        label = None
        if ratio > 0:
            crop_name = crop_params[crop_id].crop_name
            label = f"{round(ratio * 100)}% of typical {crop_name} acreage already committed this season"
        saturation[crop_id] = {"ratio": ratio, "label": label}
    return saturation
```

- [ ] **Step 5: Wire saturation into `_score_single_crop`**

Change the signature (currently `ml/predict.py:1055-1067`):

```python
def _score_single_crop(
    crop_id: str,
    crop: CropParameter,
    weather: dict[str, float],
    soil: dict[str, float],
    region_id: str,
    season: str,
    budget_per_acre: float,
    area_acres: float,
    region_crop_price: dict[str, float],
    ml_conf_map: dict[str, float],
    ml_yield: float | None | _Unset = _UNSET,
) -> dict[str, Any]:
```

to:

```python
def _score_single_crop(
    crop_id: str,
    crop: CropParameter,
    weather: dict[str, float],
    soil: dict[str, float],
    region_id: str,
    season: str,
    budget_per_acre: float,
    area_acres: float,
    region_crop_price: dict[str, float],
    ml_conf_map: dict[str, float],
    region_saturation: dict[str, dict[str, Any]],
    ml_yield: float | None | _Unset = _UNSET,
) -> dict[str, Any]:
```

Then, immediately before the existing `smart_score = clamp(...)` block (currently `ml/predict.py:1106-1117`):

```python
    # Blend ML confidence into smart_score if available
    ml_score = ml_conf_map.get(crop_id, 0.0) * 100.0
    ml_term = ml_score if _ml_recommend_model is not None else roi_normalized
    smart_score = clamp(
        0.35 * roi_normalized
        + 0.20 * risk["confidence_score"]
        + 0.15 * budget_fit
        + 0.15 * soil_health
        + 0.15 * ml_term,
        0.0,
        100.0,
    )
```

replace with:

```python
    # Blend ML confidence into smart_score if available
    ml_score = ml_conf_map.get(crop_id, 0.0) * 100.0
    ml_term = ml_score if _ml_recommend_model is not None else roi_normalized

    sat = region_saturation.get(crop_id)
    saturation_ratio = sat["ratio"] if sat is not None else None
    saturation_label = sat["label"] if sat is not None else None
    # Linear 0-40 scale reaching its max at ratio=2.0 (double this region's
    # historical norm), then a further *0.25 caps the score impact at -10
    # points -- a nudge among close candidates, never an override of a
    # farmer's own soil/ROI/risk/budget fit. clamp() here is defensive:
    # region_saturation entries are expected pre-clamped to [0, 2] by
    # _compute_region_saturation, but this function must not trust that.
    saturation_penalty = (
        clamp(saturation_ratio * 20.0, 0.0, 40.0) if saturation_ratio is not None else 0.0
    )

    smart_score = clamp(
        0.35 * roi_normalized
        + 0.20 * risk["confidence_score"]
        + 0.15 * budget_fit
        + 0.15 * soil_health
        + 0.15 * ml_term
        - saturation_penalty * 0.25,
        0.0,
        100.0,
    )
```

Then, in the `rec_entry` dict (currently `ml/predict.py:1120-1142`), add the two new keys right after `"smart_score": round(smart_score, 2),`:

```python
        "smart_score": round(smart_score, 2),
        "saturation_ratio": saturation_ratio,
        "saturation_label": saturation_label,
```

- [ ] **Step 6: Wire `region_saturation` through `recommend_crops`**

In `recommend_crops` (currently `ml/predict.py:1148-1224`), after the existing ML-confidence block and before the `candidates = [...]` list comprehension:

```python
    # Get ML confidence scores if available
    ml_conf = _ml_recommend_crop(region_id, season, soil, weather, budget_per_acre, 0.5)
    ml_conf_map: dict[str, float] = {}
    if ml_conf:
        ml_conf_map = {item["crop_id"]: item["ml_confidence"] for item in ml_conf}
```

leave unchanged, then after the `candidates = [...]` block and before the `batched_yields = _ml_predict_yield_batch(...)` call, insert:

```python
    region_saturation = _compute_region_saturation(
        region_id, season, [crop_id for crop_id, _ in candidates], crop_params,
    )
```

Finally, update the `_score_single_crop(...)` call inside the `for crop_id, crop in candidates:` loop from:

```python
        rec_entry = _score_single_crop(
            crop_id, crop, weather, soil,
            region_id, season,
            budget_per_acre, area_acres,
            region_crop_price, ml_conf_map,
            ml_yield=batched_yields.get(crop_id),
        )
```

to:

```python
        rec_entry = _score_single_crop(
            crop_id, crop, weather, soil,
            region_id, season,
            budget_per_acre, area_acres,
            region_crop_price, ml_conf_map, region_saturation,
            ml_yield=batched_yields.get(crop_id),
        )
```

- [ ] **Step 7: Run the new tests to verify they pass**

Run: `venv/Scripts/python.exe -m pytest tests/test_ml_predict.py -v -k saturation`
Expected: PASS (6 tests)

- [ ] **Step 8: Regenerate the golden fixtures**

`recommend_crops`'s output now carries two new keys on every entry, which will break `tests/test_ml_batch_predict.py`'s byte-identical golden comparison (it asserts `actual == case["expected"]`). Regenerate both fixtures, verifying every *pre-existing* field is unchanged before overwriting (a real assertion, not a rubber stamp — this is the check that would catch an unintended score drift):

Create a temporary script `tests/fixtures/_regen.py`:

```python
"""Temporary, one-time regeneration script -- delete after running.
Adds saturation_ratio/saturation_label to the recommend_crops golden
fixtures without changing any pre-existing field's value."""
import json
from pathlib import Path

import ml.predict as P

FIXTURES = Path(__file__).parent


def regen(name: str, force_no_models: bool) -> None:
    path = FIXTURES / name
    cases = json.loads(path.read_text())

    if force_no_models:
        P._ml_models_loaded = True
        P._ml_yield_model = None
        P._ml_label_encoders = None
        P._ml_recommend_model = None
        P._ml_recommend_encoders = None
    else:
        P._load_ml_models()
        if P._ml_yield_model is None:
            print(f"skipping {name}: trained models not present in ml/models/")
            return

    for case in cases:
        actual = P.recommend_crops(
            case["region_id"], case["season"],
            case["budget_per_acre"], case["area_acres"], top_k=50,
        )
        old_expected = case["expected"]
        assert len(actual) == len(old_expected), f"{name}: row count changed for {case}"
        for new_row, old_row in zip(actual, old_expected):
            for key, old_val in old_row.items():
                assert new_row.get(key) == old_val, (
                    f"{name}: field {key!r} drifted for crop "
                    f"{old_row.get('crop_id')}: {old_val!r} -> {new_row.get(key)!r}"
                )
        case["expected"] = actual

    path.write_text(json.dumps(cases, indent=2) + "\n")
    print(f"regenerated {name}: {len(cases)} cases")


regen("recommend_crops_golden.json", force_no_models=False)
regen("recommend_crops_golden_heuristic.json", force_no_models=True)
```

Run:
```bash
venv/Scripts/python.exe tests/fixtures/_regen.py
```
Expected output: `regenerated recommend_crops_golden.json: 32 cases` and `regenerated recommend_crops_golden_heuristic.json: <N> cases` — or, if `ml/models/` has no trained models checked in, `skipping recommend_crops_golden.json: trained models not present in ml/models/` (in that case `test_recommend_crops_unchanged_on_ml_path` is itself skipped by its `models_loaded` fixture, so there's no drift to guard and nothing further to do for that fixture).

Then delete the temporary script:
```bash
rm tests/fixtures/_regen.py
```

- [ ] **Step 9: Run the full predict + golden test suites to verify nothing broke**

Run: `venv/Scripts/python.exe -m pytest tests/test_ml_predict.py tests/test_ml_batch_predict.py -v`
Expected: PASS, all tests (including the golden-fixture parametrized cases)

- [ ] **Step 10: Commit**

```bash
git add ml/predict.py tests/test_ml_predict.py tests/fixtures/recommend_crops_golden.json tests/fixtures/recommend_crops_golden_heuristic.json
git commit -m "feat(ml): fold regional planting saturation into smart_score"
```

---

### Task 3: `/api/commit-crop` endpoint

**Files:**
- Modify: `backend/models.py` (add `CommitmentRequest`)
- Modify: `backend/main.py:1-13` (imports), `backend/main.py:153-177` (models import block), `backend/main.py:237-247` (new endpoint, next to `/api/recommend`)
- Test: `tests/test_commitment_log.py` (append)

**Interfaces:**
- Consumes: `utils.commitment_log.upsert(...)` (Task 1).
- Produces: `POST /api/commit-crop` — request body `{region_id, crop_id, season, area_acres, device_id}`, response `{"status": "recorded"}` on success, `422` on `area_acres <= 0`.

- [ ] **Step 1: Write the failing tests**

Append to `tests/test_commitment_log.py`:

```python
from fastapi.testclient import TestClient

from backend.main import app

client = TestClient(app)


def test_commit_crop_endpoint_happy_path():
    payload = {
        "region_id": "telangana_medak", "crop_id": "cotton", "season": "kharif",
        "area_acres": 4.5, "device_id": "dev_endpoint_test",
    }
    response = client.post("/api/commit-crop", json=payload)
    assert response.status_code == 200
    assert response.json() == {"status": "recorded"}

    from utils.commitment_log import read_all
    rows = read_all()
    assert any(
        r["device_id"] == "dev_endpoint_test" and r["crop_id"] == "cotton"
        for r in rows
    )


def test_commit_crop_endpoint_rejects_non_positive_area():
    payload = {
        "region_id": "telangana_medak", "crop_id": "cotton", "season": "kharif",
        "area_acres": 0, "device_id": "dev_endpoint_test",
    }
    response = client.post("/api/commit-crop", json=payload)
    assert response.status_code == 422
```

Note: this reuses the module's `isolated_commitments_file` autouse fixture already defined at the top of `tests/test_commitment_log.py`, so these endpoint tests also write to an isolated `tmp_path` file, not the real `dataset/dynamic/commitments.csv`.

- [ ] **Step 2: Run tests to verify they fail**

Run: `venv/Scripts/python.exe -m pytest tests/test_commitment_log.py -v -k endpoint`
Expected: FAIL — `404 Not Found` (route doesn't exist yet)

- [ ] **Step 3: Add `CommitmentRequest` to `backend/models.py`**

Add after the existing `RecommendationRequest` class:

```python
class CommitmentRequest(BaseModel):
    region_id: str
    crop_id: str
    season: str
    area_acres: float
    device_id: str

    @field_validator("area_acres")
    @classmethod
    def area_must_be_positive(cls, v: float) -> float:
        if v <= 0:
            raise ValueError("area_acres must be greater than 0")
        return v
```

- [ ] **Step 4: Wire the endpoint into `backend/main.py`**

Add `from datetime import datetime` to the stdlib import block at the top of `backend/main.py` (currently lines 1-12):

```python
from fastapi import Depends, FastAPI, Header, HTTPException, Request, status
from fastapi.middleware.cors import CORSMiddleware
from fastapi.middleware.gzip import GZipMiddleware
from fastapi.staticfiles import StaticFiles
from starlette.middleware.base import BaseHTTPMiddleware
from pydantic import BaseModel, Field, field_validator
from typing import Dict, Any, List, Optional
from statistics import mean
from datetime import datetime
import sys
import os
import secrets
import numpy as np
```

Add `CommitmentRequest` to the `from backend.models import (...)` block (currently `backend/main.py:153-177`), right after `RecommendationRequest,`:

```python
from backend.models import (
    SimulationRequest,
    RecommendationRequest,
    CommitmentRequest,
    CompareRequest,
    ...
```

Add the endpoint right after `/api/recommend` (currently `backend/main.py:237-247`):

```python
@app.post("/api/recommend")
def get_recommendations(req: RecommendationRequest):
    try:
        return recommend_crops(
            region_id=req.region_id,
            season=req.season,
            budget_per_acre=req.budget_per_acre,
            area_acres=req.area_acres
        )
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))

@app.post("/api/commit-crop")
def commit_crop(req: CommitmentRequest):
    try:
        from utils.commitment_log import upsert as _commit_upsert
        _commit_upsert(
            region_id=req.region_id,
            crop_id=req.crop_id,
            season=req.season,
            year=datetime.now().year,
            area_acres=req.area_acres,
            device_id=req.device_id,
        )
        return {"status": "recorded"}
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `venv/Scripts/python.exe -m pytest tests/test_commitment_log.py -v`
Expected: PASS (7 tests)

- [ ] **Step 6: Run the full backend test suite to verify nothing broke**

Run: `venv/Scripts/python.exe -m pytest tests -q`
Expected: PASS, no regressions

- [ ] **Step 7: Commit**

```bash
git add backend/models.py backend/main.py tests/test_commitment_log.py
git commit -m "feat(api): add POST /api/commit-crop endpoint"
```

---

### Task 4: Frontend — saturation badge and commit button

**Files:**
- Modify: `frontend/mm-core.js:512-516` (add `deviceId` to `window.MM`)
- Modify: `frontend/dashboard.js:1090-1133` (Smart recommend result card)

**Interfaces:**
- Consumes: `window.MM.deviceId() -> string` (new, this task), `POST /api/commit-crop` (Task 3), `top.saturation_label` / `top.crop_id` from the `/api/crop` response (Task 2).
- Produces: `window.MM.deviceId(): () => string`, reusable by any future frontend code that needs the same per-browser identity marketplace.js already uses.

No automated test exists for this frontend (zero-build vanilla JS, no test runner in this repo) — this task ends in a manual browser verification instead, matching how the rest of the frontend is verified.

- [ ] **Step 1: Add `deviceId()` to `frontend/mm-core.js`**

`frontend/marketplace.js` already generates and stores a per-browser id under the localStorage key `'mittimantra_device_id'` (see `frontend/marketplace.js:104,123-129`). Add an equivalent helper to the shared `window.MM` namespace so `dashboard.js` gets the *same* id a farmer may already have from using the marketplace, without dashboard.js depending on marketplace.js directly.

In `frontend/mm-core.js`, immediately before the `// ------------------------------------------------------------------\n  // Public API` comment (currently `frontend/mm-core.js:512-515`):

```javascript
  const DEVICE_ID_KEY = 'mittimantra_device_id';
  function deviceId() {
    let id = null;
    try { id = localStorage.getItem(DEVICE_ID_KEY); } catch (_) {}
    if (!id) {
      id = 'dev_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 8);
      try { localStorage.setItem(DEVICE_ID_KEY, id); } catch (_) {}
    }
    return id;
  }

  // ------------------------------------------------------------------
  // Public API
  // ------------------------------------------------------------------
  window.MM = { fmt, profile, units, a11y, share, toast, escapeHtml, memoGet, deviceId };
```

(Only the `window.MM = { ... }` line actually changes — from `{ fmt, profile, units, a11y, share, toast, escapeHtml, memoGet }` to the version above with `deviceId` appended; the `deviceId()` function is new, inserted just above it.)

- [ ] **Step 2: Add the badge and commit button to the Smart recommend card**

In `frontend/dashboard.js`, inside the `$('[data-form="recommend"]')` submit handler, the current render block (`frontend/dashboard.js:1106-1133`) is:

```javascript
      out.innerHTML = `
        <div class="kpi-grid">
          <div class="kpi kpi--good"><div class="kpi__lbl">Top pick</div>
            <div class="kpi__val" style="font-size:1.3rem;">${cropLabel(top.crop_id)}</div>
            <div class="kpi__sub">Smart score ${FIX(top.smart_score, 1)} / 100</div></div>
          <div class="kpi"><div class="kpi__lbl">Predicted yield</div>
            <div class="kpi__val">${Math.round(top.predicted_yield_kg_per_acre)} <span style="font-size:.5em;color:var(--ink-faint)">kg/ac</span></div></div>
          <div class="kpi kpi--good"><div class="kpi__lbl">Profit (${area} ac)</div>
            <div class="kpi__val">${TT(top.expected_profit, INR(top.expected_profit))}</div>
            <div class="kpi__sub">ROI ${PCT(top.roi_percent)}</div></div>
        </div>

        ${top.budget_adequate === false ? `
        <div class="alert alert--gold" style="margin-top:12px;">
          <div class="alert__body">
            <strong>⚠ Budget below what ${cropLabel(top.crop_id)} typically needs.</strong>
            ${top.reason || 'Yield and ROI above are already scaled down to what this budget can realistically achieve — not the full-funding potential.'}
            ${top.potential_yield_kg_per_acre ? ` With adequate funding, yield could reach ~${Math.round(top.potential_yield_kg_per_acre)} kg/ac.` : ''}
          </div>
        </div>` : ''}

        <div class="alert alert--green" style="margin-top:12px;display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap;background:var(--brand-soft);border:1px solid color-mix(in srgb, var(--brand) 35%, transparent);">
          <div class="alert__body" style="color:var(--brand-deep);">
            <strong>🌾 Ready to sell?</strong> List ${cropLabel(top.crop_id)} on the Marketplace once it's harvested — buyers can see it alongside real mandi price context.
          </div>
          <a class="btn btn-primary" style="flex-shrink:0;" href="marketplace.html?view=sell&crop_id=${encodeURIComponent(top.crop_id)}&qty=${Math.max(1, Math.round(area * top.predicted_yield_kg_per_acre / 100))}">Sell this produce →</a>
        </div>
```

Insert a new block between the budget-warning alert and the "Ready to sell?" CTA (i.e. right after the `</div>` : ''}` line that closes the budget-adequate ternary, before the `<div class="alert alert--green"`):

```javascript
        ${top.saturation_label ? `
        <div class="alert alert--gold" style="margin-top:12px;display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap;">
          <div class="alert__body">
            <strong>📊 ${top.saturation_label}</strong>
          </div>
          <button type="button" class="btn btn-ghost" style="flex-shrink:0;" id="mm-commit-crop-btn"
            data-crop-id="${top.crop_id}" data-region-id="${body.region_id}" data-season="${body.season}" data-area="${area}">
            I'm planting this →
          </button>
        </div>` : ''}

```

(leave the rest, including the "Ready to sell?" block, unchanged).

Then, immediately after the `out.innerHTML = ...;` assignment closes (i.e. right after its terminating backtick + semicolon, still inside the same `try` block, before the existing code that handles `if (!Array.isArray(recs)...)` earlier in the function -- this new code goes *after* the innerHTML write, not before it), add the click handler:

```javascript
      const commitBtn = out.querySelector('#mm-commit-crop-btn');
      if (commitBtn) {
        commitBtn.addEventListener('click', async () => {
          commitBtn.disabled = true;
          commitBtn.textContent = 'Recording…';
          try {
            await api('/api/commit-crop', {
              method: 'POST',
              body: JSON.stringify({
                region_id: commitBtn.dataset.regionId,
                crop_id: commitBtn.dataset.cropId,
                season: commitBtn.dataset.season,
                area_acres: parseFloat(commitBtn.dataset.area),
                device_id: window.MM.deviceId(),
              }),
            });
            commitBtn.textContent = '✓ Recorded — thanks, this helps other farmers nearby.';
          } catch (err) {
            commitBtn.disabled = false;
            commitBtn.textContent = "I'm planting this →";
          }
        });
      }
```

- [ ] **Step 3: Start the app and verify manually**

Start both the backend and frontend dev servers (per `.claude/launch.json`: `backend` on port 8001, `frontend-static` on port 8899), open the dashboard, run "Smart recommend" for `region_id=telangana_medak`, `season=kharif`, then:

1. Confirm the result card renders with no console errors and no saturation badge (fresh install, no commitments yet).
2. Click through to submit a commitment via the browser's dev tools console (no UI exists yet to force a saturation scenario without a second real commit): run
   ```javascript
   fetch('http://localhost:8001/api/commit-crop', {
     method: 'POST', headers: {'Content-Type':'application/json'},
     body: JSON.stringify({region_id:'telangana_medak', crop_id:'rice', season:'kharif', area_acres:125551, device_id:'dev_manual_check'})
   }).then(r => r.json()).then(console.log)
   ```
3. Re-run "Smart recommend" for the same region/season with a budget/area likely to rank Rice highly, and confirm the gold badge now shows a saturation percentage and the smart_score for Rice is measurably lower than before the commitment (compare against the pre-commit run).
4. Click "I'm planting this →" on a fresh recommend result and confirm the button swaps to the "✓ Recorded" confirmation text and a row appears in `dataset/dynamic/commitments.csv`.

- [ ] **Step 4: Commit**

```bash
git add frontend/mm-core.js frontend/dashboard.js
git commit -m "feat(frontend): show regional saturation badge and commit action on Smart recommend"
```
