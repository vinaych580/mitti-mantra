# ML Model Accuracy — Recommendation & Yield — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix the crop-recommendation classifier's label generation (21 of 32 crops currently score 0.00 F1) and the yield model's misleading 321% MAPE, and eliminate the pipeline duplication (`ml/train_models.py` vs `ml/evaluate_models.py`) that lets a dev-only script silently overwrite production model files with a different, easier synthetic dataset.

**Architecture:** Extract the production `smart_score` formula into one shared, pure `compute_smart_score()` function so training labels and live scoring can never drift apart again. Extract both models' dataset-construction code (currently duplicated across two files) into a single new `ml/dataset_builders.py` that `ml/train_models.py` (production) and `ml/evaluate_models.py` (comparison-only, no longer a writer) both import. Fix the recommendation label generator to exclude true perennials from seasonal candidates and score every candidate with the real, shared formula, then label by argmax with `class_weight="balanced"` — verified in a working prototype to take F1-macro from 0.117 to 0.678 and eliminate every 0.00-F1 class. Extend `ml/audit_models.py` to report per-class F1 and yield MAPE split by row provenance, so these regressions are caught automatically from here on.

**Tech Stack:** Python, scikit-learn (RandomForest, with CatBoost/XGBoost/LightGBM as optional comparison-only dependencies), joblib, pytest.

**Spec:** [docs/superpowers/specs/2026-09-06-ml-model-accuracy-design.md](../specs/2026-09-06-ml-model-accuracy-design.md)

## Global Constraints

- Task 1's refactor must be behavior-preserving: `tests/test_ml_batch_predict.py`'s two golden-fixture tests (`test_recommend_crops_unchanged_on_ml_path`, `test_recommend_crops_unchanged_on_heuristic_path`) must still pass, byte-identical, immediately after Task 1 — no model retraining has happened yet at that point.
- When porting a production formula into the label generator, replicate production's actual behavior exactly, including its quirks (e.g. `smart_risk_score` is called without an explicit `irrigation_level`, so it always uses the function's own default of 0.5 — see spec §6.3). Do not "fix" an unrelated quirk while porting it; that's a different, unrequested change.
- `ml/evaluate_models.py` must never write to `ml/models/*.joblib` or `ml/models/*_encoders.joblib` after Task 5. Its only allowed output file is `ml/models/evaluation_manifest.json`.
- The recommendation bake-off's (Task 7) decision metric is **F1-macro**, not raw accuracy — this codebase's whole bug history here is accuracy looking fine while F1-macro was 0.117.
- The full pytest suite (144 tests as of this plan) must stay green after every task's final step. Run `venv/Scripts/python.exe -m pytest -q tests` (Windows venv — this repo's tests do not use a `python -m pytest` without the venv prefix).
- `ml/models/*.joblib`, `*.json` model artifacts are tracked in git (not gitignored) — this repo's established pattern is to commit retrained binaries directly. Any task that retrains commits the resulting artifact changes.
- Match this repo's existing code style: plain prose comments explaining *why*, not `// FIX (ID)`-style tags (those IDs belong to `AUDIT_REPORT.md` findings this work doesn't originate from).

---

## File Structure

**New files:**
- `ml/dataset_builders.py` — the single shared dataset-construction module for both models (Tasks 2, 3).
- `tests/test_calculations.py` — unit tests for `utils/calculations.py`'s pure functions, starting with `compute_smart_score` (Task 1).
- `tests/test_dataset_builders.py` — unit tests for the new module (Tasks 2, 3).
- `tests/test_ml_pipeline_isolation.py` — regression test that `ml/evaluate_models.py` cannot write production artifacts (Task 5).

**Modified files:**
- `utils/calculations.py` — add `compute_smart_score()` (Task 1).
- `ml/predict.py` — `_score_single_crop` calls the extracted function (Task 1).
- `ml/train_models.py` — imports dataset builders from the new module instead of defining its own; `train_recommendation_model()` gets `class_weight="balanced"`; whichever algorithm wins Task 7's bake-off is wired in there (Tasks 4, 7).
- `ml/evaluate_models.py` — imports the shared module; stops writing production artifacts (Task 5).
- `ml/audit_models.py` — per-class F1/support for recommendation, real-vs-synthetic MAPE split for yield (Task 6).
- `requirements.txt` — gains the winning bake-off algorithm's dependency, only if it isn't RandomForest (Task 7, conditional).
- `tests/fixtures/recommend_crops_golden.json` — regenerated after the final retrain (Task 7).

---

### Task 1: Extract `compute_smart_score()` into `utils/calculations.py`

**Files:**
- Create: `tests/test_calculations.py`
- Modify: `utils/calculations.py` (add function)
- Modify: `ml/predict.py:15-20` (import), `ml/predict.py:1184-1210` (call site)

**Interfaces:**
- Produces: `compute_smart_score(roi_normalized: float, confidence_score: float, budget_fit: float, soil_health: float, ml_term: float, saturation_penalty: float = 0.0) -> float` in `utils/calculations.py`. Every later task that generates recommendation training labels calls this exact function.

- [ ] **Step 1: Write the failing test**

Create `tests/test_calculations.py`:

```python
"""
tests/test_calculations.py
Unit tests for utils/calculations.py's pure scoring/math functions.
"""
from __future__ import annotations

from utils.calculations import compute_smart_score


def test_compute_smart_score_weighted_blend():
    score = compute_smart_score(
        roi_normalized=50.0,
        confidence_score=80.0,
        budget_fit=100.0,
        soil_health=90.0,
        ml_term=60.0,
        saturation_penalty=0.0,
    )
    # 0.35*50 + 0.20*80 + 0.15*100 + 0.15*90 + 0.15*60 - 0 = 71.0
    assert score == 71.0


def test_compute_smart_score_saturation_penalty_caps_at_ten_points():
    with_penalty = compute_smart_score(50.0, 80.0, 100.0, 90.0, 60.0, saturation_penalty=40.0)
    without_penalty = compute_smart_score(50.0, 80.0, 100.0, 90.0, 60.0, saturation_penalty=0.0)
    assert without_penalty - with_penalty == 10.0


def test_compute_smart_score_clamps_to_0_100_range():
    assert compute_smart_score(1000, 1000, 1000, 1000, 1000, 0.0) == 100.0
    assert compute_smart_score(-1000, -1000, -1000, -1000, -1000, 0.0) == 0.0


def test_compute_smart_score_saturation_penalty_defaults_to_zero():
    assert compute_smart_score(50.0, 80.0, 100.0, 90.0, 60.0) == 71.0
```

- [ ] **Step 2: Run test to verify it fails**

Run: `venv/Scripts/python.exe -m pytest tests/test_calculations.py -v`
Expected: FAIL with `ImportError: cannot import name 'compute_smart_score'`

- [ ] **Step 3: Implement `compute_smart_score` in `utils/calculations.py`**

Add at the end of `utils/calculations.py`:

```python
def compute_smart_score(
    roi_normalized: float,
    confidence_score: float,
    budget_fit: float,
    soil_health: float,
    ml_term: float,
    saturation_penalty: float = 0.0,
) -> float:
    """The weighted blend `ml/predict.py::_score_single_crop` uses to rank a
    crop for a farmer's request, and `ml/dataset_builders.py` uses to label
    what "best crop" means for training -- extracted here so both call
    sites can never drift apart the way they had (see
    docs/superpowers/specs/2026-09-06-ml-model-accuracy-design.md).
    """
    return clamp(
        0.35 * roi_normalized
        + 0.20 * confidence_score
        + 0.15 * budget_fit
        + 0.15 * soil_health
        + 0.15 * ml_term
        - saturation_penalty * 0.25,
        0.0,
        100.0,
    )
```

- [ ] **Step 4: Run test to verify it passes**

Run: `venv/Scripts/python.exe -m pytest tests/test_calculations.py -v`
Expected: PASS (4 tests)

- [ ] **Step 5: Wire `_score_single_crop` to call the extracted function**

In `ml/predict.py`, change the import block at the top (currently lines 15-20):

```python
from utils.calculations import (
    CropParameter,
    calculate_risk_score_and_subscores,
    calculate_yield_kg_per_acre,
    clamp,
)
```

to:

```python
from utils.calculations import (
    CropParameter,
    calculate_risk_score_and_subscores,
    calculate_yield_kg_per_acre,
    clamp,
    compute_smart_score,
)
```

Then in `_score_single_crop`, replace this block (currently around line 1201):

```python
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

with:

```python
    smart_score = compute_smart_score(
        roi_normalized=roi_normalized,
        confidence_score=risk["confidence_score"],
        budget_fit=budget_fit,
        soil_health=soil_health,
        ml_term=ml_term,
        saturation_penalty=saturation_penalty,
    )
```

- [ ] **Step 6: Verify the refactor is behavior-preserving**

Run: `venv/Scripts/python.exe -m pytest tests/test_ml_batch_predict.py -v`
Expected: PASS, all tests including `test_recommend_crops_unchanged_on_ml_path` and `test_recommend_crops_unchanged_on_heuristic_path` — byte-identical output proves this was a pure refactor.

- [ ] **Step 7: Run the full test suite**

Run: `venv/Scripts/python.exe -m pytest -q tests`
Expected: all tests pass (144 + 4 new = 148)

- [ ] **Step 8: Commit**

```bash
git add utils/calculations.py ml/predict.py tests/test_calculations.py
git commit -m "refactor(ml): extract compute_smart_score as a shared pure function

_score_single_crop's weighted blend now lives in one place instead of
being inlined, so ml/dataset_builders.py (added in a later commit) can
call the exact same formula for training labels instead of a separate,
already-drifted approximation of it."
```

---

### Task 2: Create `ml/dataset_builders.py` with the yield dataset builder (moved + provenance-tagged)

**Files:**
- Create: `ml/dataset_builders.py`
- Create: `tests/test_dataset_builders.py`

**Interfaces:**
- Consumes: `utils.calculations.CropParameter`, `utils.calculations.calculate_climate_factor`, `utils.calculations.calculate_soil_factor` (existing).
- Produces (for Task 3 and Task 4 to consume): `make_crop_param(r: dict) -> CropParameter`; `_load_csv(name: str, required: bool = False) -> list[dict]`; `ALL_SEASONS: list[str]`; `_fit_label_encoders(crops, regions, seasons) -> tuple[LabelEncoder, LabelEncoder, LabelEncoder]`; `_row_hash(row: np.ndarray) -> str`; `_save_holdout(name: str, X_test: np.ndarray, y_test: np.ndarray, source_test: list[str] | None = None) -> None`; `_build_yield_dataset() -> tuple[np.ndarray, np.ndarray, list[str], LabelEncoder, LabelEncoder, LabelEncoder]` — note the new 6-tuple return (was 5-tuple in the old `train_models.py`/`evaluate_models.py` copies): `(X, y, source, crop_le, region_le, season_le)`.

- [ ] **Step 1: Write the failing test**

Create `tests/test_dataset_builders.py`:

```python
"""
tests/test_dataset_builders.py
Unit tests for ml/dataset_builders.py -- the shared dataset-construction
code used by ml/train_models.py and ml/evaluate_models.py.
"""
from __future__ import annotations

from collections import Counter

from ml.dataset_builders import _build_yield_dataset


def test_build_yield_dataset_tags_row_provenance():
    X, y, source, crop_le, region_le, season_le = _build_yield_dataset()

    assert len(source) == len(X) == len(y)
    counts = Counter(source)
    assert set(counts) <= {"real", "augmented", "synthetic_mismatch"}
    # yield_history.csv has real rows; the mismatch-injection loop always
    # finds at least one severe climate mismatch across 30 regions x 2
    # seasons x 32 crops; augmentation (6x per base row) dominates both.
    assert counts["real"] > 0
    assert counts["synthetic_mismatch"] > 0
    assert counts["augmented"] > 0


def test_build_yield_dataset_augmented_rows_inherit_non_real_source():
    _, _, source, _, _, _ = _build_yield_dataset()
    # No augmented row should be tagged "real" -- a noised copy is never
    # an actual recorded observation.
    assert "real" not in {s for s in source if source.count(s) < len(source)} or True
    counts = Counter(source)
    # augmented rows = 6x (real + synthetic_mismatch) base rows
    base_total = counts["real"] + counts["synthetic_mismatch"]
    assert counts["augmented"] == base_total * 6
```

(The second test's first assertion line is intentionally a no-op tautology
guard removed in Step 3 below once the real assertion is confirmed
sufficient — see Step 3 note.)

- [ ] **Step 2: Run test to verify it fails**

Run: `venv/Scripts/python.exe -m pytest tests/test_dataset_builders.py -v`
Expected: FAIL with `ModuleNotFoundError: No module named 'ml.dataset_builders'`

- [ ] **Step 3: Simplify the test's second case, then create `ml/dataset_builders.py`**

First, replace the odd tautology line in `tests/test_dataset_builders.py`'s second test — edit it to:

```python
def test_build_yield_dataset_augmented_rows_inherit_non_real_source():
    _, _, source, _, _, _ = _build_yield_dataset()
    counts = Counter(source)
    # augmented rows = 6x (real + synthetic_mismatch) base rows
    base_total = counts["real"] + counts["synthetic_mismatch"]
    assert counts["augmented"] == base_total * 6
```

Now create `ml/dataset_builders.py`:

```python
"""
ml/dataset_builders.py
Shared dataset-construction code for the yield-prediction and
crop-recommendation models. ml/train_models.py (production training,
wired to POST /api/ml/train) and ml/evaluate_models.py (algorithm
comparison only) both import from here, so they train and compare on
literally the same data -- see
docs/superpowers/specs/2026-09-06-ml-model-accuracy-design.md for why two
separately-maintained copies of this code had drifted apart and made
ml/evaluate_models.py's benchmarks meaningless.
"""
from __future__ import annotations

import hashlib
import json
import time
from collections import Counter
from pathlib import Path

import joblib
import numpy as np
from sklearn.preprocessing import LabelEncoder

from utils.calculations import CropParameter, calculate_climate_factor, calculate_soil_factor

DATASET_DIR = Path(__file__).resolve().parents[1] / "dataset"
MODEL_DIR = Path(__file__).resolve().parent / "models"
MODEL_DIR.mkdir(exist_ok=True)

# Single canonical season list used consistently across training and
# inference to prevent encoder mismatch.
ALL_SEASONS = sorted({"kharif", "rabi", "annual", "perennial", "perenn"})


def make_crop_param(r: dict) -> CropParameter:
    return CropParameter(
        crop_id=r["crop_id"],
        crop_name=r["crop_name"],
        season=r["season"],
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


def _load_csv(name: str, required: bool = False) -> list[dict[str, str]]:
    from utils.csv_cache import load as _cached_load
    rows = _cached_load(name)
    if not rows and required:
        raise FileNotFoundError(f"Required dataset missing or empty: {DATASET_DIR / name}")
    return rows


def _fit_label_encoders(crops: list[str], regions: list[str], seasons: list[str]):
    crop_le = LabelEncoder().fit(sorted(set(crops)))
    region_le = LabelEncoder().fit(sorted(set(regions)))
    season_le = LabelEncoder().fit(sorted(set(seasons)))
    return crop_le, region_le, season_le


def _row_hash(row: np.ndarray) -> str:
    return hashlib.md5(np.round(np.asarray(row, dtype=np.float64), 6).tobytes()).hexdigest()


def _save_holdout(
    name: str,
    X_test: np.ndarray,
    y_test: np.ndarray,
    source_test: list[str] | None = None,
) -> None:
    """Persist the exact held-out test set for `name` alongside the model
    artifact, so a later audit can evaluate on genuinely unseen rows.

    `source_test`, when given, tags each row's provenance ("real",
    "augmented", "synthetic_mismatch") so ml/audit_models.py can report
    metrics split by how representative-of-a-realistic-yield each row is,
    instead of averaging a metric like MAPE across rows that were never
    meant to look like a realistic yield in the first place.
    """
    holdout_path = MODEL_DIR / f"holdout_{name}.joblib"
    payload = {"X_test": X_test, "y_test": y_test}
    if source_test is not None:
        payload["source_test"] = source_test
    joblib.dump(payload, holdout_path)

    manifest_path = MODEL_DIR / f"holdout_{name}.json"
    row_hashes = [_row_hash(row) for row in X_test]
    manifest = {
        "model": name,
        "n_samples": int(len(X_test)),
        "n_features": int(X_test.shape[1]) if X_test.ndim > 1 else 1,
        "row_hashes_sample": row_hashes[:20],
        "row_hash_set_size": len(set(row_hashes)),
        "saved_at": time.time(),
    }
    if source_test is not None:
        manifest["source_counts"] = dict(Counter(source_test))
    with open(manifest_path, "w") as f:
        json.dump(manifest, f, indent=2)


YIELD_FEATURE_NAMES = [
    "crop_enc", "region_enc", "season_enc",
    "base_yield", "water_req", "temp_min", "temp_max",
    "npk_n", "npk_p", "npk_k",
    "soil_ph", "soil_n", "soil_p", "soil_k", "soil_oc",
    "rainfall", "avg_temp", "min_temp", "max_temp",
    "irrigation",
]


def _yield_features(cid, rid, season, cp, soil, weather,
                    crop_le, region_le, season_le, irrigation=0.5):
    """Build feature vector for yield prediction."""
    def safe(d, k, default=0.0):
        try:
            return float(d.get(k, default))
        except (ValueError, TypeError):
            return default

    return [
        crop_le.transform([cid])[0],
        region_le.transform([rid])[0],
        season_le.transform([season.lower() if season else "kharif"])[0],
        safe(cp, "base_yield_kg_per_acre"),
        safe(cp, "water_requirement_mm"),
        safe(cp, "temp_min_c"),
        safe(cp, "temp_max_c"),
        safe(cp, "npk_n_kg_per_acre"),
        safe(cp, "npk_p_kg_per_acre"),
        safe(cp, "npk_k_kg_per_acre"),
        safe(soil, "ph", 7.0),
        safe(soil, "n_kg_per_acre", 40),
        safe(soil, "p_kg_per_acre", 20),
        safe(soil, "k_kg_per_acre", 20),
        safe(soil, "organic_carbon_percent", 0.5),
        safe(weather, "rainfall_mm", 800),
        safe(weather, "avg_temp_c", 28),
        safe(weather, "min_temp_c", 20),
        safe(weather, "max_temp_c", 35),
        irrigation,
    ]


def _build_yield_dataset() -> tuple[np.ndarray, np.ndarray, list[str], LabelEncoder, LabelEncoder, LabelEncoder]:
    """
    Build training data for yield prediction by joining:
      yield_history x crop_parameters x soil x weather
    Then inject severe climate-mismatch negative examples and augment with
    gaussian noise.

    Returns (X, y, source, crop_le, region_le, season_le). `source` tags
    each row "real" (from yield_history.csv), "augmented" (a noise-
    perturbed copy of a real or synthetic_mismatch row), or
    "synthetic_mismatch" (an injected severe climate-mismatch example) --
    see ml/audit_models.py for how this is used to report MAPE split by
    provenance instead of averaged across rows of wildly different
    reliability.
    """
    yield_hist = _load_csv("yield_history.csv", required=True)
    crop_params = {r["crop_id"]: r for r in _load_csv("crop_parameters.csv", required=True)}
    soil_data = {}
    for r in _load_csv("soil.csv", required=True):
        soil_data[r["region_id"]] = r
    weather_rows = _load_csv("weather.csv", required=True)
    weather_data = {}
    for r in weather_rows:
        key = (r["region_id"], r["season"].lower())
        weather_data[key] = r

    all_crops = sorted(crop_params.keys())
    all_regions = sorted(soil_data.keys())

    crop_le, region_le, season_le = _fit_label_encoders(all_crops, all_regions, ALL_SEASONS)

    rows_X, rows_y, rows_source = [], [], []

    for row in yield_hist:
        cid = row["crop_id"]
        rid = row["region_id"]
        season = row.get("season", "kharif").lower()
        yld = float(row["yield_kg_per_acre"])

        if cid not in crop_params or rid not in soil_data:
            continue

        cp = crop_params[cid]
        soil = soil_data[rid]
        wkey = (rid, season)
        weather = weather_data.get(wkey, {})

        features = _yield_features(cid, rid, season, cp, soil, weather,
                                   crop_le, region_le, season_le,
                                   irrigation=0.5)
        rows_X.append(features)
        rows_y.append(yld)
        rows_source.append("real")

    # ---- Inject Negative/Mismatched Crop-Climate Examples ----
    # Trains the model directly on climate bounds (drought, flood) instead
    # of only ever seeing yields for crop/region/season combos that
    # actually got planted historically.
    for rid in all_regions:
        soil = soil_data[rid]
        for season in ["kharif", "rabi"]:
            wkey = (rid, season)
            weather = weather_data.get(wkey)
            if not weather:
                continue

            weather_parsed = {
                "rainfall_mm": float(weather.get("rainfall_mm", 800)),
                "avg_temp_c": float(weather.get("avg_temp_c", 28)),
            }

            for cid, cp_row in crop_params.items():
                cp = make_crop_param(cp_row)
                climate_factor = calculate_climate_factor(weather_parsed, cp)
                if climate_factor < 0.65:
                    mismatched_yield = float(cp_row["base_yield_kg_per_acre"]) * climate_factor * 0.1
                    features = _yield_features(cid, rid, season, cp_row, soil, weather,
                                               crop_le, region_le, season_le,
                                               irrigation=0.5)
                    rows_X.append(features)
                    rows_y.append(mismatched_yield)
                    rows_source.append("synthetic_mismatch")

    # ---- Data augmentation ----
    rng = np.random.RandomState(42)
    aug_X, aug_y, aug_source = [], [], []
    base_len = len(rows_X)
    for i in range(base_len):
        for _ in range(6):
            noise = rng.uniform(0.90, 1.10, size=len(rows_X[i]))
            noised = np.array(rows_X[i]) * noise
            noised[:3] = rows_X[i][:3]
            aug_X.append(noised.tolist())
            aug_y.append(rows_y[i] * rng.uniform(0.92, 1.08))
            # An augmented copy is a noised copy, never an actual recorded
            # observation -- but a noised copy of a synthetic_mismatch row
            # is still a deliberately-tiny value, so it stays tagged that
            # way rather than being promoted to "augmented".
            aug_source.append("augmented" if rows_source[i] == "real" else rows_source[i])
    rows_X.extend(aug_X)
    rows_y.extend(aug_y)
    rows_source.extend(aug_source)

    return (np.array(rows_X, dtype=np.float32),
            np.array(rows_y, dtype=np.float32),
            rows_source,
            crop_le, region_le, season_le)
```

- [ ] **Step 4: Run test to verify it passes**

Run: `venv/Scripts/python.exe -m pytest tests/test_dataset_builders.py -v`
Expected: PASS (2 tests)

- [ ] **Step 5: Run the full test suite**

Run: `venv/Scripts/python.exe -m pytest -q tests`
Expected: all tests pass (148 + 2 new = 150). `ml/train_models.py` and `ml/evaluate_models.py` are untouched so far and still have their own (unmodified) copies of this logic — no behavior change to production yet.

- [ ] **Step 6: Commit**

```bash
git add ml/dataset_builders.py tests/test_dataset_builders.py
git commit -m "feat(ml): add shared dataset_builders module with yield row provenance

Moves the yield-dataset construction logic (currently duplicated,
already-drifted, between train_models.py and evaluate_models.py) into
one shared module, and tags each row's provenance (real/augmented/
synthetic_mismatch) so audit reporting can split MAPE by how
representative-of-a-realistic-yield a row actually is. Nothing imports
this module yet -- train_models.py and evaluate_models.py still use
their own copies until later commits switch them over."
```

---

### Task 3: Add the corrected recommendation dataset builder to `ml/dataset_builders.py`

This is the core fix. Two changes are required *together* (verified in the
spec's prototype — doing the formula fix alone without the eligibility fix
made cashew's dominance worse, not better):

1. **Candidate eligibility**: exclude true perennials from seasonal
   sampling, matching `ml/predict.py::recommend_crops`'s own filter exactly.
2. **Scoring**: use the real `smart_risk_score`/`profit_estimator` (from
   `ml/predict.py`) and `calculate_yield_kg_per_acre` (from
   `utils/calculations.py`) plus the `compute_smart_score` from Task 1 —
   not a separate, cruder approximation — then label by **argmax**, not
   softmax-sampling.

**Files:**
- Modify: `ml/dataset_builders.py` (append)
- Modify: `tests/test_dataset_builders.py` (append)

**Interfaces:**
- Consumes: `compute_smart_score` (`utils.calculations`, Task 1); `smart_risk_score`, `profit_estimator`, `_season_match`, `_is_perennial` (`ml.predict`, existing); `make_crop_param`, `_load_csv`, `ALL_SEASONS`, `_fit_label_encoders` (`ml.dataset_builders`, Task 2).
- Produces: `_build_recommendation_dataset() -> tuple[np.ndarray, np.ndarray, LabelEncoder, LabelEncoder, LabelEncoder]` — same 5-tuple shape as the old `train_models.py`/`evaluate_models.py` copies, so callers don't need to change their unpacking, only their import. `RECOMMEND_FEATURE_NAMES: list[str]`, `_RECOMMEND_SAMPLES_PER_REGION_SEASON: int = 500`.

- [ ] **Step 1: Write the failing test**

Append to `tests/test_dataset_builders.py`:

```python
from ml.dataset_builders import _build_recommendation_dataset


def test_build_recommendation_dataset_staples_are_recommendable():
    X, y, crop_le, region_le, season_le = _build_recommendation_dataset()
    labeled_crops = {crop_le.classes_[i] for i in set(y.tolist())}
    # The concrete regression test for the bug this task fixes: these
    # staples used to never win a single sample (0.00 F1 on the deployed
    # model's real holdout) because the old label formula had no risk/
    # soil-fit term and let perennials compete in every seasonal sample.
    for staple in ("rice", "wheat", "maize", "soybean"):
        assert staple in labeled_crops, f"{staple} should be recommendable at least once"


def test_build_recommendation_dataset_excludes_true_perennials():
    X, y, crop_le, region_le, season_le = _build_recommendation_dataset()
    labeled_crops = {crop_le.classes_[i] for i in set(y.tolist())}
    # cashew/coconut/coffee/mango/tea are "Perennial" season crops -- a
    # kharif/rabi request must never recommend a tree that takes 3-5 years
    # to fruit, matching ml/predict.py::recommend_crops's own filter.
    for perennial in ("cashew", "coconut", "coffee", "mango", "tea"):
        assert perennial not in labeled_crops, f"{perennial} is perennial and must not be a seasonal label"
```

- [ ] **Step 2: Run test to verify it fails**

Run: `venv/Scripts/python.exe -m pytest tests/test_dataset_builders.py -v -k recommendation`
Expected: FAIL with `ImportError: cannot import name '_build_recommendation_dataset'`

- [ ] **Step 3: Append the corrected builder to `ml/dataset_builders.py`**

Add the new import at the top of `ml/dataset_builders.py` (alongside the
existing `from utils.calculations import ...` line):

```python
from ml.predict import smart_risk_score, profit_estimator, _season_match, _is_perennial
from utils.calculations import (
    CropParameter,
    calculate_climate_factor,
    calculate_soil_factor,
    calculate_yield_kg_per_acre,
    clamp,
    compute_smart_score,
)
```

Then append to `ml/dataset_builders.py`:

```python
_RECOMMEND_SAMPLES_PER_REGION_SEASON = 500

RECOMMEND_FEATURE_NAMES = [
    "region_enc", "season_enc",
    "soil_ph", "soil_n", "soil_p", "soil_k", "soil_oc",
    "rainfall", "avg_temp", "min_temp", "max_temp",
    "budget", "irrigation",
]


def _build_recommendation_dataset() -> tuple[np.ndarray, np.ndarray, LabelEncoder, LabelEncoder, LabelEncoder]:
    """
    Build crop recommendation training data: for each (region, season),
    simulate randomized conditions and label the best crop using the same
    compute_smart_score() weighting ml/predict.py's _score_single_crop
    uses to rank crops for a real farmer -- see
    docs/superpowers/specs/2026-09-06-ml-model-accuracy-design.md section 6.

    Candidate eligibility matches recommend_crops's own filter exactly:
    true perennials (season == "Perennial") are excluded from kharif/rabi
    sampling, since a request for "this season" can't recommend a tree
    that takes years to fruit.

    Returns (X, y, crop_le, region_le, season_le).
    """
    crop_params_list = _load_csv("crop_parameters.csv", required=True)
    crop_params = {r["crop_id"]: r for r in crop_params_list}
    crop_params_objs = {r["crop_id"]: make_crop_param(r) for r in crop_params_list}
    soil_data = {r["region_id"]: r for r in _load_csv("soil.csv", required=True)}
    weather_rows = _load_csv("weather.csv", required=True)
    weather_data = {}
    for r in weather_rows:
        weather_data[(r["region_id"], r["season"].lower())] = r
    mandi_rows = _load_csv("mandi_prices.csv", required=True)

    mandi_latest: dict[tuple[str, str], float] = {}
    for r in sorted(mandi_rows, key=lambda x: x["date"]):
        mandi_latest[(r["region_id"], r["crop_id"])] = float(r["price_inr_per_kg"])

    all_regions = sorted(soil_data.keys())
    all_seasons = ["kharif", "rabi"]

    crop_le = LabelEncoder().fit(sorted(crop_params.keys()))
    region_le = LabelEncoder().fit(all_regions)
    season_le = LabelEncoder().fit(ALL_SEASONS)

    rng = np.random.RandomState(42)
    X_all, y_all = [], []

    def sf(d, k, default=0.0):
        try:
            return float(d.get(k, default))
        except (ValueError, TypeError):
            return default

    budget_choices = [8000, 12000, 18000, 25000, 35000]

    for rid in all_regions:
        base_soil = soil_data[rid]
        for season in all_seasons:
            for _ in range(_RECOMMEND_SAMPLES_PER_REGION_SEASON):
                budget = float(rng.choice(budget_choices))
                irr = float(rng.uniform(0.05, 0.95))
                ph = float(rng.uniform(5.0, 8.5))
                rain = float(rng.uniform(200, 2500))
                temp = float(rng.uniform(15, 40))

                soil_sim = {
                    "ph": ph,
                    "n_kg_per_acre": sf(base_soil, "n_kg_per_acre", 40),
                    "p_kg_per_acre": sf(base_soil, "p_kg_per_acre", 20),
                    "k_kg_per_acre": sf(base_soil, "k_kg_per_acre", 20),
                    "organic_carbon_percent": sf(base_soil, "organic_carbon_percent", 0.5),
                }
                weather_sim = {"rainfall_mm": rain, "avg_temp_c": temp}

                scores: dict[str, float] = {}
                for cid, cp in crop_params.items():
                    crop_season = cp["season"]
                    # Match recommend_crops's own candidate filter exactly
                    # (ml/predict.py): a seasonal request excludes true
                    # perennials outright, not just down-weights them.
                    if not _season_match(season, crop_season):
                        continue
                    if _is_perennial(crop_season):
                        continue

                    cp_obj = crop_params_objs[cid]

                    # Same deterministic heuristic production falls back to
                    # when no ML yield model is consulted -- not a bespoke
                    # approximation of it.
                    yield_est = calculate_yield_kg_per_acre(cp_obj, soil_sim, weather_sim, irrigation_level=irr)

                    price = mandi_latest.get(
                        (rid, cid),
                        (float(cp["mandi_price_min_inr_per_kg"]) +
                         float(cp["mandi_price_max_inr_per_kg"])) / 2.0,
                    )

                    # Real profit_estimator from ml/predict.py. roi_percent
                    # is scale-invariant in area_acres (revenue and cost
                    # both scale by it), so area_acres=1.0 is exact here,
                    # not an approximation, and this inherits
                    # _budget_yield_multiplier's squared-funding-ratio
                    # curve instead of a cruder linear stand-in.
                    profit = profit_estimator(
                        crop_id=cid, predicted_yield_kg_per_acre=yield_est,
                        area_acres=1.0, budget_per_acre=budget, mandi_price_per_kg=price,
                    )

                    # smart_risk_score is called exactly as _score_single_crop
                    # calls it -- no irrigation_level argument, so it uses
                    # the function's own 0.5 default regardless of the
                    # sampled `irr`. This looks inconsistent with the yield
                    # estimate above (which does use `irr`), but it's what
                    # production actually computes, and labels must reflect
                    # that, not an idealized version of it.
                    risk = smart_risk_score(cid, weather_sim, soil_sim, budget)

                    budget_fit = clamp(
                        (budget / max(cp_obj.avg_input_cost_inr_per_acre, 1.0)) * 100.0, 0.0, 120.0
                    )
                    roi_normalized = clamp(profit["roi_percent"] / 3.0, 0.0, 100.0)
                    n_ratio = soil_sim["n_kg_per_acre"] / max(cp_obj.npk_n_kg_per_acre, 1.0)
                    p_ratio = soil_sim["p_kg_per_acre"] / max(cp_obj.npk_p_kg_per_acre, 1.0)
                    k_ratio = soil_sim["k_kg_per_acre"] / max(cp_obj.npk_k_kg_per_acre, 1.0)
                    soil_health = clamp(((n_ratio + p_ratio + k_ratio) / 3.0) * 100.0, 0.0, 120.0)

                    # ml_term forced to roi_normalized (production's own
                    # no-model-loaded fallback) and saturation_penalty
                    # forced to 0.0 (no commitment-log data exists for a
                    # synthetic scenario) -- breaks the circularity of a
                    # classifier partly trained on its own prior
                    # predictions. See spec section 6.3.
                    score = compute_smart_score(
                        roi_normalized=roi_normalized,
                        confidence_score=risk["confidence_score"],
                        budget_fit=budget_fit,
                        soil_health=soil_health,
                        ml_term=roi_normalized,
                        saturation_penalty=0.0,
                    )
                    scores[cid] = score

                if not scores:
                    continue

                # Argmax, not softmax-sampling: once labels come from
                # compute_smart_score's calibrated 0-100 scale -- the same
                # scale recommend_crops() ranks real farmers' results on --
                # the top-scoring crop *is* the correct label, matching
                # what "the top recommendation" means everywhere else in
                # this codebase.
                best_crop = max(scores, key=scores.get)

                features = [
                    region_le.transform([rid])[0],
                    season_le.transform([season])[0],
                    ph,
                    soil_sim["n_kg_per_acre"],
                    soil_sim["p_kg_per_acre"],
                    soil_sim["k_kg_per_acre"],
                    soil_sim["organic_carbon_percent"],
                    rain,
                    temp,
                    temp - 8,
                    temp + 7,
                    budget,
                    irr,
                ]
                X_all.append(features)
                y_all.append(crop_le.transform([best_crop])[0])

    # Light augmentation (unchanged from the pre-fix formula).
    base_len = len(X_all)
    for i in range(base_len):
        noised = np.array(X_all[i])
        noised[2:11] *= rng.uniform(0.92, 1.08, size=9)
        noised[11] *= rng.uniform(0.9, 1.1)
        noised[12] = np.clip(noised[12] + rng.uniform(-0.1, 0.1), 0.05, 1.0)
        X_all.append(noised.tolist())
        y_all.append(y_all[i])

    return (np.array(X_all, dtype=np.float32),
            np.array(y_all, dtype=np.int32),
            crop_le, region_le, season_le)
```

- [ ] **Step 4: Run test to verify it passes**

Run: `venv/Scripts/python.exe -m pytest tests/test_dataset_builders.py -v`
Expected: PASS (4 tests). This will take on the order of 10-15 seconds
(building the full dataset calls `profit_estimator`/`smart_risk_score`
~500,000 times) — that's expected, not a hang.

Note: `cotton`, `ginger`, and `potato` will also never appear as labels —
this is expected and verified in the spec (§6.4) to be genuine (each is
individually confirmed to never be the top-`smart_score` choice in this
dataset's sampled range, not a residual bug). The test deliberately does
not assert anything about them either way.

- [ ] **Step 5: Run the full test suite**

Run: `venv/Scripts/python.exe -m pytest -q tests`
Expected: all tests pass (150 + 2 new = 152). Production (`train_models.py`,
`evaluate_models.py`) is still untouched and still uses its own old copies
— no behavior change to what's deployed yet.

- [ ] **Step 6: Commit**

```bash
git add ml/dataset_builders.py tests/test_dataset_builders.py
git commit -m "feat(ml): fix recommendation label generation in dataset_builders

Two changes, verified together in the spec's prototype to be required in
combination: (1) exclude true perennials from seasonal candidate pools,
matching recommend_crops's own filter -- doing the formula fix alone
made cashew's dominance worse, not better, because argmax has no
randomness left to let a structurally-advantaged crop lose sometimes.
(2) score every candidate with the real smart_risk_score/profit_estimator/
calculate_yield_kg_per_acre/compute_smart_score instead of a separate,
cruder approximation, then label by argmax instead of softmax-sampling.

Nothing imports this yet -- train_models.py and evaluate_models.py still
use their own old copies until the next two commits switch them over."
```

---

### Task 4: Wire `ml/train_models.py` to the shared module, add `class_weight="balanced"`, retrain

**Files:**
- Modify: `ml/train_models.py`
- Modify: `ml/models/*.joblib`, `ml/models/*_encoders.joblib`, `ml/models/manifest.json`, `ml/models/audit_metrics.json`, `ml/models/holdout_*.joblib`, `ml/models/holdout_*.json` (regenerated by running training)

**Interfaces:**
- Consumes: everything `ml/dataset_builders.py` produces (Tasks 2, 3).

- [ ] **Step 1: Remove the duplicated dataset-building code from `ml/train_models.py`, import from the shared module instead**

In `ml/train_models.py`, delete these now-duplicated definitions (they now
live in `ml/dataset_builders.py`): `ALL_SEASONS`, `make_crop_param`,
`_load_csv`, `_fit_label_encoders`, `_row_hash`, `_save_holdout`,
`_yield_features`, `YIELD_FEATURE_NAMES`, `_build_yield_dataset`,
`_RECOMMEND_SAMPLES_PER_REGION_SEASON`, `RECOMMEND_FEATURE_NAMES`,
`_build_recommendation_dataset`. Keep `DATASET_DIR`, `MODEL_DIR`, the
sklearn imports actually still used by `train_price_model`/
`train_yield_model`/`train_recommendation_model`/`train_all`, and the
`hashlib`/`json`/`time`/`warnings`/`Path`/`joblib`/`np` imports still used
elsewhere in the file (price-model training and `train_all`'s manifest
hashing both stay in this file, unchanged).

Add this import near the top of `ml/train_models.py`, right after the
existing `from utils.calculations import ...` line:

```python
from ml.dataset_builders import (
    YIELD_FEATURE_NAMES,
    RECOMMEND_FEATURE_NAMES,
    _build_yield_dataset,
    _build_recommendation_dataset,
    _save_holdout,
)
```

(`ALL_SEASONS` is not imported here — after Step 1's deletions, nothing in
`ml/train_models.py` references it directly anymore; it's only used
internally by `ml/dataset_builders.py`'s own functions.)

- [ ] **Step 2: Update `train_yield_model()` for the new 6-tuple return and thread `source` through the split/holdout**

Replace:

```python
def train_yield_model() -> dict[str, Any]:
    """Train RandomForest yield prediction model."""
    # FIX (1.1): Unpack the actual encoders used during training
    X, y, crop_le, region_le, season_le = _build_yield_dataset()

    # FIX (4.5): Scope warning suppression to sklearn training only
    with warnings.catch_warnings():
        warnings.filterwarnings("ignore", category=UserWarning, module="sklearn")
        X_train, X_test, y_train, y_test = train_test_split(
            X, y, test_size=0.2, random_state=42,
        )
```

with:

```python
def train_yield_model() -> dict[str, Any]:
    """Train RandomForest yield prediction model."""
    X, y, source, crop_le, region_le, season_le = _build_yield_dataset()

    with warnings.catch_warnings():
        warnings.filterwarnings("ignore", category=UserWarning, module="sklearn")
        X_train, X_test, y_train, y_test, source_train, source_test = train_test_split(
            X, y, source, test_size=0.2, random_state=42,
        )
```

Further down in the same function, replace:

```python
    # FIX (C-3): Persist the real held-out test rows for later unbiased audit
    _save_holdout("yield", X_test, y_test)
```

with:

```python
    # Persist the real held-out test rows, tagged with provenance, for
    # later unbiased and honestly-split audit reporting.
    _save_holdout("yield", X_test, y_test, source_test=source_test)
```

- [ ] **Step 3: Add `class_weight="balanced"` to `train_recommendation_model()`**

In `ml/train_models.py`, find:

```python
        model = RandomForestClassifier(
            n_estimators=200,
            max_depth=10,
            min_samples_split=4,
            random_state=42,
            n_jobs=-1,
        )
```

and change it to:

```python
        model = RandomForestClassifier(
            n_estimators=200,
            max_depth=10,
            min_samples_split=4,
            random_state=42,
            n_jobs=-1,
            class_weight="balanced",
        )
```

This is the difference between "most crops are recommendable" (F1-macro
0.50 without it, measured in the spec's prototype) and "every crop that
ever wins at least once is recommendable" (F1-macro 0.678 with it) — the
class imbalance among jute/jowar/mustard (thousands of labels) vs.
rice/wheat (dozens) persists even after Task 3's formula fix, and this is
the standard, one-line answer to it.

- [ ] **Step 4: Retrain and inspect the result**

Run: `venv/Scripts/python.exe -m ml.train_models`

Expected: prints yield R²/MAE, price R²/MAE, recommendation accuracy, then
refreshes `ml/models/audit_metrics.json`. This takes roughly 20-40 seconds
(recommendation dataset construction dominates).

- [ ] **Step 5: Verify the fix against the refreshed audit**

Run:
```bash
venv/Scripts/python.exe -c "
import json
d = json.load(open('ml/models/audit_metrics.json'))
print('accuracy:', d['crop_recommendation']['accuracy'])
print('f1_macro:', d['crop_recommendation']['f1_macro'])
"
```

Expected: `accuracy` around 0.85 and `f1_macro` around 0.68 (matching the
spec's prototype — exact figures may differ slightly since `train_models.py`
augments differently than the throwaway prototype script, but should be in
the same range, dramatically above the pre-fix 0.5595/0.1171).

- [ ] **Step 6: Run the full test suite**

Run: `venv/Scripts/python.exe -m pytest -q tests`
Expected: all tests pass except possibly
`tests/test_ml_batch_predict.py::test_recommend_crops_unchanged_on_ml_path`
(parametrized, 32 cases) — this is **expected to fail now**, because
`recommend_model.joblib` just changed and that test's golden fixture
encodes the *old* model's exact output. Confirm every other test still
passes, and confirm this is the *only* failure category (all failures are
in that one parametrized test, not elsewhere) before proceeding — a
failure anywhere else means something broke that this task didn't intend
to change. Do not regenerate the golden fixture yet — that happens once,
after Task 7's final retrain, to avoid regenerating it twice.

- [ ] **Step 7: Commit**

```bash
git add ml/train_models.py ml/models/
git commit -m "fix(ml): wire train_models.py to the corrected dataset_builders

Recommendation and yield now train on the shared, corrected dataset
(perennial exclusion, real smart_score-aligned labels, argmax,
class_weight=balanced). Measured: crop-recommendation accuracy
0.56->0.85, F1-macro 0.117->~0.68. tests/test_ml_batch_predict.py's
ML-path golden fixture now legitimately mismatches the retrained model
and will be regenerated once after the algorithm bake-off (next tasks),
not twice."
```

---

### Task 5: Refactor `ml/evaluate_models.py` into a read-only comparison tool

**Files:**
- Create: `tests/test_ml_pipeline_isolation.py`
- Modify: `ml/evaluate_models.py`

**Interfaces:**
- Consumes: `ml.dataset_builders._build_yield_dataset`, `ml.dataset_builders._build_recommendation_dataset`, `ml.dataset_builders._save_holdout` (Tasks 2, 3) — used only in-memory for its own train/test split, never to overwrite the *production* holdout files.

- [ ] **Step 1: Write the failing test**

Create `tests/test_ml_pipeline_isolation.py`:

```python
"""
tests/test_ml_pipeline_isolation.py

Regression test for the bug where ml/evaluate_models.py (a dev-only
benchmarking script) silently overwrote the same production model files
ml/train_models.py writes, using a different, easier synthetic dataset --
see docs/superpowers/specs/2026-09-06-ml-model-accuracy-design.md.

After this fix, running evaluate_models.py's pipeline must never change
what /api/ml/train would later load.
"""
from __future__ import annotations

import ml.evaluate_models as E


def test_evaluate_models_does_not_write_production_artifacts(tmp_path, monkeypatch):
    monkeypatch.setattr(E, "MODEL_DIR", tmp_path)

    pipeline = E.ModelEvaluationPipeline()
    pipeline.run_pipeline()

    written = {p.name for p in tmp_path.iterdir()}
    forbidden = {
        "recommend_model.joblib", "yield_model.joblib",
        "recommend_encoders.joblib", "yield_encoders.joblib", "label_encoders.joblib",
        "holdout_recommend.joblib", "holdout_yield.joblib",
    }
    assert not (written & forbidden), f"evaluate_models wrote production files: {written & forbidden}"
    assert "evaluation_manifest.json" in written
```

- [ ] **Step 2: Run test to verify it fails**

Run: `venv/Scripts/python.exe -m pytest tests/test_ml_pipeline_isolation.py -v`
Expected: FAIL — `recommend_model.joblib`/`yield_model.joblib`/etc. show up
in `written`, because today's `evaluate_models.py` writes them directly.

- [ ] **Step 3: Refactor `ml/evaluate_models.py`**

Delete the duplicated dataset-building code from `ml/evaluate_models.py`:
`_load_csv`, `_fit_label_encoders`, `_row_hash`, `_save_holdout`,
`_build_yield_dataset`, `_build_recommendation_dataset`. Three imports at
the top of the file are used only inside those functions, and become dead
once they're deleted: `hashlib` (only `_row_hash`), `joblib` (only
`_save_holdout` and the `joblib.dump(...)` calls removed later in this
same step), and `LabelEncoder` (only these functions' return-type hints
and `_fit_label_encoders`). Remove all three in the same edit — but leave
`os`, `csv`, and `pandas` alone even if they look unused by this same
grep: that's a pre-existing condition in this file, not something this
task's deletions caused, and out of scope here.

At the top of the file, change:

```python
import os
import csv
import hashlib
import json
import logging
import time
import warnings
from pathlib import Path
import joblib
import numpy as np
import pandas as pd

from sklearn.model_selection import train_test_split, KFold, StratifiedKFold, RandomizedSearchCV
from sklearn.preprocessing import LabelEncoder
from sklearn.metrics import accuracy_score, f1_score, mean_absolute_error, mean_squared_error, r2_score

# Classifiers & Regressors
from sklearn.ensemble import RandomForestClassifier, RandomForestRegressor
```

to:

```python
import os
import csv
import json
import logging
import time
import warnings
from pathlib import Path
import numpy as np
import pandas as pd

from sklearn.model_selection import train_test_split, KFold, StratifiedKFold, RandomizedSearchCV
from sklearn.metrics import accuracy_score, f1_score, mean_absolute_error, mean_squared_error, r2_score

# Classifiers & Regressors
from sklearn.ensemble import RandomForestClassifier, RandomForestRegressor
```

then add, right after it:

```python
from ml.dataset_builders import _build_yield_dataset, _build_recommendation_dataset
```

Remove the now-unused `_load_csv`/`_fit_label_encoders`/`_row_hash`/
`_save_holdout` function bodies and the two dataset-builder functions
entirely (all now come from `ml.dataset_builders`).

In `evaluate_crop_recommendation()`, `_build_recommendation_dataset()`
returns the same 5-tuple shape as before, so its call site is unchanged.
Remove the two lines that persist production files:

```python
        joblib.dump({"crop": crop_le, "region": region_le, "season": season_le}, MODEL_DIR / "recommend_encoders.joblib")
        # Save label encoders for legacy loading compat
        joblib.dump({"crop": crop_le, "region": region_le, "season": season_le}, MODEL_DIR / "label_encoders.joblib")
```

and, further down:

```python
        joblib.dump(tuned_clf, MODEL_DIR / "recommend_model.joblib")

        # FIX (C-3): Persist the real held-out test rows for this freshly
        # saved model so the audit doesn't re-derive an overlapping split.
        _save_holdout("recommend", X_test, y_test)
```

In `evaluate_yield_prediction()`, `_build_yield_dataset()` now returns a
6-tuple (`X, y, source, crop_le, region_le, season_le`) per Task 2. Update
its call site:

```python
        X, y, crop_le, region_le, season_le = _build_yield_dataset()
```

to:

```python
        X, y, source, crop_le, region_le, season_le = _build_yield_dataset()
```

(`source` is intentionally unused here — this function's own train/test
split is only ever used in-memory for the bake-off comparison, never
persisted as a production holdout, so provenance-splitting doesn't apply
to it.) Remove:

```python
        joblib.dump({"crop": crop_le, "region": region_le, "season": season_le}, MODEL_DIR / "yield_encoders.joblib")
```

and, further down:

```python
        joblib.dump(tuned_reg, MODEL_DIR / "yield_model.joblib")

        # FIX (C-3): Persist the real held-out test rows for this freshly
        # saved model so the audit doesn't re-derive an overlapping split.
        _save_holdout("yield", X_test, y_test)
```

`run_pipeline()`'s existing `evaluation_manifest.json` write is unchanged
— that remains the only file this module writes.

- [ ] **Step 4: Run test to verify it passes**

Run: `venv/Scripts/python.exe -m pytest tests/test_ml_pipeline_isolation.py -v`
Expected: PASS

- [ ] **Step 5: Run the full test suite**

Run: `venv/Scripts/python.exe -m pytest -q tests`
Expected: same result as the end of Task 4 (the one known
`test_recommend_crops_unchanged_on_ml_path` golden-fixture failure, nothing
new broken) plus the 1 new isolation test passing.

- [ ] **Step 6: Commit**

```bash
git add ml/evaluate_models.py tests/test_ml_pipeline_isolation.py
git commit -m "fix(ml): evaluate_models.py no longer writes production artifacts

It now imports the same corrected dataset_builders train_models.py uses
(so any future comparison is apples-to-apples, not measured on a
different, easier synthetic grid) and its only output file is
evaluation_manifest.json. Running it by hand can no longer silently
change what /api/ml/train would have deployed."
```

---

### Task 6: Extend `ml/audit_models.py` with per-class F1 and split yield MAPE

**Files:**
- Modify: `ml/audit_models.py`
- Modify: `tests/test_ml_pipeline_isolation.py` (append — or create `tests/test_audit_models.py`; using the existing file keeps all the new pipeline-correctness tests together)

**Interfaces:**
- Consumes: `holdout_recommend.joblib`'s `X_test`/`y_test` (unchanged shape); `holdout_yield.joblib`'s `X_test`/`y_test`/`source_test` (new key from Task 4, may be absent on an old-format file).

- [ ] **Step 1: Write the failing test**

Append to `tests/test_ml_pipeline_isolation.py`:

```python
import numpy as np

from ml.audit_models import ModelAuditor


def test_split_yield_mape_by_provenance():
    # 2 "real" rows with easy-to-predict targets, 1 "synthetic_mismatch"
    # row with a near-zero target that would explode a naive MAPE.
    y_test = np.array([100.0, 200.0, 0.5], dtype=np.float32)
    y_pred = np.array([110.0, 190.0, 50.0], dtype=np.float32)
    source_test = ["real", "real", "synthetic_mismatch"]

    auditor = ModelAuditor()
    real_mape, full_mape = auditor._split_yield_mape(y_test, y_pred, source_test)

    # real rows only: |100-110|/100 + |200-190|/200 -> mean 7.5%
    assert round(real_mape, 2) == 7.5
    # full set additionally includes the exploded synthetic row:
    # |0.5-50|/0.5 = 9900% -> pulls the mean way up
    assert full_mape > real_mape * 100


def test_split_yield_mape_without_provenance_returns_same_value_twice():
    # An old-format holdout file predating the provenance field has no
    # source_test at all -- there's nothing to split, so both returned
    # values must be identical (the plain full-set MAPE).
    y_test = np.array([100.0, 200.0], dtype=np.float32)
    y_pred = np.array([110.0, 190.0], dtype=np.float32)

    auditor = ModelAuditor()
    real_mape, full_mape = auditor._split_yield_mape(y_test, y_pred, None)

    assert real_mape == full_mape
```

- [ ] **Step 2: Run test to verify it fails**

Run: `venv/Scripts/python.exe -m pytest tests/test_ml_pipeline_isolation.py -v -k split_yield_mape`
Expected: FAIL with `AttributeError: 'ModelAuditor' object has no attribute '_split_yield_mape'`

- [ ] **Step 3: Implement the split-MAPE helper and per-class F1 reporting in `ml/audit_models.py`**

Add this import near the top of `ml/audit_models.py` (alongside the
existing `from sklearn.metrics import ...` line):

```python
from sklearn.metrics import precision_recall_fscore_support
```

Add this static method to the `ModelAuditor` class (near `_load_holdout`):

```python
    @staticmethod
    def _split_yield_mape(y_test, y_pred, source_test: list[str] | None):
        """Return (real_and_augmented_mape, full_mape) as percentages.

        `source_test` tags each row "real"/"augmented"/"synthetic_mismatch"
        (see ml/dataset_builders.py). The full-set MAPE is dominated by the
        deliberately-tiny synthetic_mismatch rows (near-zero denominators
        blow up percentage error) and conflates "the model is bad at real
        yields" with "this metric is unfair to rows never meant to look
        realistic" -- see
        docs/superpowers/specs/2026-09-06-ml-model-accuracy-design.md
        section 7. When `source_test` isn't available (an old-format
        holdout file predating this field), both values are the same
        full-set figure -- there's nothing to split.
        """
        y_test = np.asarray(y_test)
        y_pred = np.asarray(y_pred)
        full_ape = np.abs((y_test - y_pred) / y_test) * 100.0
        full_mape = float(np.mean(full_ape))

        if not source_test:
            return full_mape, full_mape

        trustworthy_mask = np.array([s in ("real", "augmented") for s in source_test])
        if not trustworthy_mask.any():
            return full_mape, full_mape
        real_mape = float(np.mean(full_ape[trustworthy_mask]))
        return real_mape, full_mape
```

Update `_load_holdout` to also return `source_test` when present:

```python
    @staticmethod
    def _load_holdout(name: str):
        holdout_path = MODEL_DIR / f"holdout_{name}.joblib"
        if not holdout_path.exists():
            return None
        data = joblib.load(holdout_path)
        return data.get("X_test"), data.get("y_test"), data.get("source_test")
```

This changes `_load_holdout`'s return from a 2-tuple to a 3-tuple —
update both call sites in `run_audit()`. Change:

```python
        rec_holdout = self._load_holdout("recommend")
        if rec_holdout is not None:
            X_test_rec, y_test_rec = rec_holdout
```

to:

```python
        rec_holdout = self._load_holdout("recommend")
        if rec_holdout is not None:
            X_test_rec, y_test_rec, _rec_source_unused = rec_holdout
```

and change:

```python
        yield_holdout = self._load_holdout("yield")
        if yield_holdout is not None:
            X_test_y, y_test_y = yield_holdout
```

to:

```python
        yield_holdout = self._load_holdout("yield")
        source_test_y = None
        if yield_holdout is not None:
            X_test_y, y_test_y, source_test_y = yield_holdout
```

Now use the new helper and add per-class recommendation metrics. Find:

```python
        pred_rec = rec_model.predict(X_test_rec)
        acc_rec = accuracy_score(y_test_rec, pred_rec)
        prec, rec, f1, _ = precision_recall_fscore_support(y_test_rec, pred_rec, average="macro")
```

and add immediately after it:

```python
        rec_crop_le = rec_encoders["crop"]
        present_labels = sorted(set(y_test_rec.tolist()) | set(pred_rec.tolist()))
        per_class_prec, per_class_rec, per_class_f1, per_class_support = precision_recall_fscore_support(
            y_test_rec, pred_rec, labels=present_labels, zero_division=0,
        )
        per_class_f1_named = {
            rec_crop_le.classes_[label]: round(float(f1_val), 4)
            for label, f1_val in zip(present_labels, per_class_f1)
        }
        zero_f1_crops = sorted(name for name, f1_val in per_class_f1_named.items() if f1_val == 0.0)
```

Find where `y_pred = yield_model.predict(X_test_y)` / `mape = ...` are
computed (in the yield section) — currently:

```python
        pred_yield = yield_model.predict(X_test_y)
        r2 = r2_score(y_test_y, pred_yield)
        mae = mean_absolute_error(y_test_y, pred_yield)
        rmse = np.sqrt(mean_squared_error(y_test_y, pred_yield))
        mape = float(np.mean(np.abs((y_test_y - pred_yield) / y_test_y))) * 100
```

Replace the last line with:

```python
        pred_yield = yield_model.predict(X_test_y)
        r2 = r2_score(y_test_y, pred_yield)
        mae = mean_absolute_error(y_test_y, pred_yield)
        rmse = np.sqrt(mean_squared_error(y_test_y, pred_yield))
        mape_real, mape_full = self._split_yield_mape(y_test_y, pred_yield, source_test_y)
```

Finally, update `audit_output`'s two dicts. In `crop_recommendation`, add
the new fields (keep everything already there):

```python
            "crop_recommendation": {
                "algorithm": type(rec_model).__name__,
                "accuracy": round(float(acc_rec), 4),
                "f1_macro": round(float(f1), 4),
                "per_class_f1": per_class_f1_named,
                "zero_f1_crops": zero_f1_crops,
                "correlations": correlations,
                "permutation_importances": pi_rec_importances,
                "robustness_noisy_weather_accuracy": round(float(noisy_acc_rec), 4),
                "evaluated_on_persisted_holdout": rec_holdout is not None,
            },
```

In `yield_prediction`, replace the single `"mape_pct"` field with the
split version:

```python
            "yield_prediction": {
                "algorithm": type(yield_model).__name__,
                "r2": round(float(r2), 4),
                "mae": round(float(mae), 2),
                "rmse": round(float(rmse), 2),
                "mape_pct_real_rows": round(float(mape_real), 2),
                "mape_pct_full_including_synthetic": round(float(mape_full), 2),
                "permutation_importances": pi_yield_importances,
                "robustness_drought_r2": round(float(drought_r2), 4),
                "evaluated_on_persisted_holdout": yield_holdout is not None,
            },
```

- [ ] **Step 4: Run test to verify it passes**

Run: `venv/Scripts/python.exe -m pytest tests/test_ml_pipeline_isolation.py -v`
Expected: PASS (3 tests in this file now)

- [ ] **Step 5: Refresh the real audit output and inspect it**

Run: `venv/Scripts/python.exe -m ml.audit_models`

Then:
```bash
venv/Scripts/python.exe -c "
import json
d = json.load(open('ml/models/audit_metrics.json'))
print('zero_f1_crops:', d['crop_recommendation']['zero_f1_crops'])
print('mape real rows:', d['yield_prediction']['mape_pct_real_rows'])
print('mape full:', d['yield_prediction']['mape_pct_full_including_synthetic'])
"
```

Expected: `zero_f1_crops` should be empty or contain only crops already
known from Task 3/4 to be genuinely non-competitive (not e.g. rice or
wheat) — this is the concrete, ongoing regression check for the bug this
whole plan fixes. `mape real rows` should be well below `mape full`
(matching the spec's 113.6% vs 321.6% baseline finding, though exact
numbers will differ slightly now that the underlying dataset changed in
Task 2 — this call is about the *split existing and being sane*, not
matching the baseline number exactly, since Task 4/7 haven't changed the
yield model's algorithm itself).

- [ ] **Step 6: Run the full test suite**

Run: `venv/Scripts/python.exe -m pytest -q tests`
Expected: same as end of Task 5 (one known golden-fixture failure) plus 2
new passing tests here.

- [ ] **Step 7: Commit**

```bash
git add ml/audit_models.py tests/test_ml_pipeline_isolation.py ml/models/audit_metrics.json
git commit -m "feat(ml): report per-class F1 and provenance-split yield MAPE in audits

audit_metrics.json now surfaces zero_f1_crops directly (empty after this
plan's fix, was 21 crops) and splits yield MAPE into real-rows vs.
full-including-synthetic-mismatch, so neither regression can hide inside
an averaged headline number again."
```

---

### Task 7: Fair algorithm bake-off, promotion, final retrain, golden fixture regeneration

**Files:**
- Modify: `ml/train_models.py` (only if a non-RandomForest algorithm wins)
- Modify: `requirements.txt` (only if a non-RandomForest algorithm wins)
- Modify: `ml/models/*` (final retrain)
- Modify: `tests/fixtures/recommend_crops_golden.json` (regenerated)

- [ ] **Step 1: Run the (now-fair, now-correctly-isolated) bake-off**

Run: `venv/Scripts/python.exe -m ml.evaluate_models`

This trains RandomForest and, for whichever of CatBoost/XGBoost/LightGBM
are installed in the venv, those too, all on the exact same corrected
dataset `ml/train_models.py` uses. It only writes
`ml/models/evaluation_manifest.json`. Inspect it:

```bash
venv/Scripts/python.exe -c "
import json
d = json.load(open('ml/models/evaluation_manifest.json'))
print('recommendation winner:', d['crop_recommendation']['winning_algorithm'])
print(json.dumps(d['crop_recommendation']['benchmarks'], indent=2))
print('yield winner:', d['yield_prediction']['winning_algorithm'])
print(json.dumps(d['yield_prediction']['benchmarks'], indent=2))
"
```

- [ ] **Step 2: Decide, using F1-macro (not accuracy) for recommendation**

Per this plan's Global Constraints, the recommendation decision metric is
`test_f1_macro`, not `test_accuracy` — `evaluate_models.py`'s own
`evaluate_crop_recommendation()` currently picks its winner by
`test_acc` (see the `if test_acc > best_acc:` line). If the printed
benchmarks show a different algorithm would win on `test_f1_macro` than
what `winning_algorithm` reports, treat `test_f1_macro`'s winner as
authoritative for the promotion decision in Step 3 — this plan's whole
premise is that accuracy alone hides class-imbalance problems. For yield,
`evaluate_models.py`'s own R²-based winner selection is fine as-is.

- [ ] **Step 3a: If RandomForest still wins both** (skip to Step 4)

No changes needed to `ml/train_models.py` — the model already trained in
Task 4/6 is the one to keep. Proceed to Step 4.

- [ ] **Step 3b: If a different algorithm wins recommendation and/or yield**

Update the relevant constructor in `ml/train_models.py`
(`train_recommendation_model()` and/or `train_yield_model()`) to use the
winning algorithm's class and the tuned hyperparameters
`evaluate_models.py`'s `RandomizedSearchCV` step found (`search.best_params_`
— add a `print(search.best_params_)` to `evaluate_models.py` temporarily
if you need to see them, or read them from the fitted `tuned_clf`/
`tuned_reg` object's `.get_params()`). If the winning recommendation
algorithm supports a "balanced" class-weighting equivalent to Task 4's
`class_weight="balanced"` (e.g. CatBoost's `auto_class_weights="Balanced"`),
apply the equivalent setting — don't silently drop Task 4's imbalance fix
just because the algorithm changed.

If the winning algorithm isn't already a production dependency
(`RandomForestClassifier`/`RandomForestRegressor` are, via `scikit-learn`
in `requirements.txt`), move its package from `requirements-dev.txt` to
`requirements.txt`, following this repo's existing comment-the-why
convention in that file (see e.g. the `numpy==2.5.1` comment there citing
`AUDIT_REPORT.md H-10`) — state which model uses it and why it won.

Measure the size consequence before committing to it:
```bash
venv/Scripts/python.exe -c "
import os
for f in ['recommend_model.joblib', 'yield_model.joblib']:
    p = f'ml/models/{f}'
    print(f, f'{os.path.getsize(p)/1e6:.1f} MB' if os.path.exists(p) else 'missing')
"
```
`AUDIT_REPORT.md` (B-14) already flags `recommend_model.joblib` at 82.5MB
against Vercel's bundle constraints — if the new model is meaningfully
larger, note the before/after sizes in the commit message so this is
visible, not discovered later at deploy time.

- [ ] **Step 4: Final retrain**

Run: `venv/Scripts/python.exe -m ml.train_models`

This regenerates `ml/models/*.joblib`, `*_encoders.joblib`,
`holdout_*.joblib`, `holdout_*.json`, `manifest.json`, and (via
`train_all()`'s existing post-training audit refresh) `audit_metrics.json`.

- [ ] **Step 5: Regenerate the ML-path golden fixture**

The retrained `recommend_model.joblib` legitimately changes
`recommend_crops()`'s `ml_confidence`/`smart_score` output for the same
inputs — that's the intended effect of this whole plan, not a regression.
Regenerate `tests/fixtures/recommend_crops_golden.json` against the same
32 `(region_id, season, budget_per_acre, area_acres)` cases it already
contains:

```bash
venv/Scripts/python.exe -c "
import json
from pathlib import Path
import ml.predict as P

path = Path('tests/fixtures/recommend_crops_golden.json')
cases = json.loads(path.read_text())

P._load_ml_models()
if P._ml_yield_model is None or P._ml_label_encoders is None:
    raise SystemExit('Models not loaded -- run ml.train_models first')

for case in cases:
    case['expected'] = P.recommend_crops(
        case['region_id'], case['season'],
        case['budget_per_acre'], case['area_acres'], top_k=50,
    )

path.write_text(json.dumps(cases, indent=2))
print(f'Regenerated {len(cases)} cases')
"
```

Do **not** touch `tests/fixtures/recommend_crops_golden_heuristic.json` —
the heuristic path never consults `recommend_model.joblib`, so its
expected output is unaffected by this plan's retraining (it does depend on
`compute_smart_score`'s formula from Task 1, but Task 1 was verified
behavior-preserving in its own commit, before this file's baseline was
last captured).

- [ ] **Step 6: Run the full test suite — this must now be fully green**

Run: `venv/Scripts/python.exe -m pytest -q tests`
Expected: **all tests pass, including
`test_recommend_crops_unchanged_on_ml_path`** — this was the one known,
expected failure carried since Task 4, and regenerating the golden fixture
in Step 5 is what resolves it. If anything else fails, stop and diagnose
before committing — that would be an unintended regression, not the
expected golden-fixture drift.

- [ ] **Step 7: Manual spot-check against a real request**

```bash
venv/Scripts/python.exe -c "
import ml.predict as P
P._load_ml_models()
recs = P.recommend_crops('up_meerut', 'rabi', 18000, 3.0, top_k=10)
for r in recs:
    print(r['crop_id'], r['smart_score'], r.get('ml_confidence'))
"
```
(Substitute a region you know is wheat-growing if `up_meerut` isn't in
`dataset/soil.csv` — check with
`venv/Scripts/python.exe -c "import csv; print([r['region_id'] for r in csv.DictReader(open('dataset/soil.csv'))])"`
first if needed.) Confirm wheat appears somewhere in the ranked list with
a non-trivial `ml_confidence`, rather than being absent or stuck at
near-zero confidence — the concrete, product-level proof that the original
bug (rice/wheat/etc. structurally unrecommendable) is fixed.

- [ ] **Step 8: Commit**

```bash
git add ml/models/ tests/fixtures/recommend_crops_golden.json requirements.txt ml/train_models.py
git commit -m "feat(ml): promote bake-off winner, final retrain, regenerate golden fixture

Ran the algorithm comparison on the now-corrected, now-shared dataset
(previous benchmarks in evaluation_manifest.json were measured on a
different, easier synthetic grid and aren't comparable to this run).
[Fill in: RandomForest retained for both models / <Algorithm> promoted
for <model>, chosen by F1-macro for recommendation and R2 for yield.]
tests/fixtures/recommend_crops_golden.json regenerated against the
retrained recommend_model.joblib -- its ml_confidence/smart_score values
legitimately changed; the 32 scenarios it covers did not."
```

(Fill in the bracketed sentence with the actual bake-off outcome before
committing — this is the one line in this plan whose content depends on
Step 1-3's real result, not a placeholder to leave in the commit.)

---

## Self-Review Notes

- **Spec coverage:** §6.1 (compute_smart_score) → Task 1. §6.2 (perennial exclusion) → Task 3. §6.3 (input sourcing) → Task 3. §6.4 (argmax + class_weight) → Tasks 3-4. §7 (yield provenance/split MAPE) → Tasks 2, 6. §8 (unify pipelines, bake-off, promotion) → Tasks 2-3 (unify), 5 (isolate), 7 (bake-off/promote). §9 (dependency/bundle consequence) → Task 7 Step 3b. §10 (testing) → each task's own test, plus Task 7's manual spot-check.
- **Type/signature consistency checked:** `_build_yield_dataset`'s new 6-tuple return is threaded consistently through Task 2 (definition), Task 4 (`train_yield_model`), Task 5 (`evaluate_yield_prediction`), and Task 6 (`_load_holdout`'s new 3-tuple return, consumed in `run_audit`). `_build_recommendation_dataset` deliberately keeps its old 5-tuple shape throughout, so Tasks 4-5's call sites don't need to change beyond the import line.
- **No placeholders** except the one explicitly-called-out bracketed sentence in Task 7's final commit message, whose content depends on that task's own empirical result and cannot be known before running it.
