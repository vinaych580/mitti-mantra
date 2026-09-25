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

from ml.predict import smart_risk_score, profit_estimator, _season_match, _is_perennial
from utils.calculations import (
    CropParameter,
    calculate_yield_kg_per_acre,
    compute_budget_fit,
    compute_roi_normalized,
    compute_smart_score,
    compute_soil_health,
)

DATASET_DIR = Path(__file__).resolve().parents[1] / "dataset"
MODEL_DIR = Path(__file__).resolve().parent / "models"
MODEL_DIR.mkdir(exist_ok=True)

# Single canonical season list used consistently across training and
# inference to prevent encoder mismatch.
#
# Note: adding "zaid" here only affects the *next* model retrain -- the
# currently-deployed recommend_model.joblib/yield_model.joblib were
# trained before this change and their saved encoders still don't have
# "zaid" in classes_, so ml/predict.py's existing fallback-to-kharif
# logic (_encoded_season, _ml_recommend_crop) keeps applying to zaid
# requests on the ML path until the next retrain happens.
ALL_SEASONS = sorted({"kharif", "rabi", "zaid", "annual", "perennial", "perenn"})


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

    `source_test`, when given, tags each row's provenance -- "real" for
    yield, "natural"/"topup" for recommendation -- so ml/audit_models.py can
    report headline metrics on rows drawn from the real distribution only.
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


def _weather_lookup(weather_rows: list[dict]):
    """Return weather_for(region_id, season, year) -> weather row or {}.

    Each yield row is joined to its own year's weather. The builder used to
    key weather by (region, season) only, so every year's yield was paired
    with whichever year happened to be read last -- the model could never
    learn year-to-year weather effects. Annual/perennial crops have no weather
    row of their own season, so they fall back to that year's kharif row, then
    to the latest year on record.
    """
    by_year: dict[tuple[str, str, str], dict] = {}
    latest: dict[tuple[str, str], dict] = {}
    for r in sorted(weather_rows, key=lambda w: w.get("year", "")):
        key = (r["region_id"], r["season"].lower())
        by_year[key + (str(r.get("year", "")),)] = r
        latest[key] = r

    def weather_for(region_id: str, season: str, year: str) -> dict:
        for s in (season, "kharif"):
            row = by_year.get((region_id, s, str(year)))
            if row:
                return row
        return latest.get((region_id, season)) or latest.get((region_id, "kharif")) or {}

    return weather_for


def _build_yield_dataset() -> tuple[np.ndarray, np.ndarray, np.ndarray, LabelEncoder, LabelEncoder, LabelEncoder]:
    """
    Build yield-prediction training data from real harvests only:
    yield_history x crop_parameters x soil x that year's weather.

    Returns (X, y, years, crop_le, region_le, season_le). `years` drives the
    time-based holdout (see _yield_time_split).

    Real rows only, deliberately. Measured on the 2024 harvests with a model
    trained on 2022-2023:
      - real rows only                        MAPE  8.3%
      - + synthetic climate-mismatch rows     MAPE ~20%
      - + 6x noise augmentation (old recipe)  MAPE ~20%
      - old deployed model                    MAPE 31%
    The mismatch rows came from the heuristic climate formula, which can't
    see irrigation, and 145 of them contradicted real harvests. The augmented
    copies were also split *after* being generated, so near-copies of test
    rows sat in the training set. The "unsuited climate" behaviour those rows
    were meant to teach is now an explicit rule applied at prediction time --
    ml/predict.py::_apply_climate_guard.
    """
    yield_hist = _load_csv("yield_history.csv", required=True)
    crop_params = {r["crop_id"]: r for r in _load_csv("crop_parameters.csv", required=True)}
    soil_data = {r["region_id"]: r for r in _load_csv("soil.csv", required=True)}
    weather_for = _weather_lookup(_load_csv("weather.csv", required=True))

    crop_le, region_le, season_le = _fit_label_encoders(
        sorted(crop_params.keys()), sorted(soil_data.keys()), ALL_SEASONS,
    )

    rows_X, rows_y, rows_year = [], [], []
    for row in yield_hist:
        cid = row["crop_id"]
        rid = row["region_id"]
        if cid not in crop_params or rid not in soil_data:
            continue
        season = row.get("season", "kharif").lower()
        year = str(row.get("year", ""))
        weather = weather_for(rid, season, year)
        rows_X.append(_yield_features(cid, rid, season, crop_params[cid], soil_data[rid], weather,
                                      crop_le, region_le, season_le, irrigation=0.5))
        rows_y.append(float(row["yield_kg_per_acre"]))
        rows_year.append(int(year) if year.isdigit() else 0)

    return (np.array(rows_X, dtype=np.float32),
            np.array(rows_y, dtype=np.float32),
            np.array(rows_year, dtype=np.int32),
            crop_le, region_le, season_le)


def _yield_time_split(years: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
    """(train_mask, test_mask): hold out the most recent harvest year.

    Forecasting a season from earlier seasons is the job the model does in
    production, so that's what the holdout measures. A random row split lets
    the model see the same region/crop's other years on both sides.
    """
    test = years == years.max()
    return ~test, test


def _time_split(dates: np.ndarray, test_frac: float = 0.2) -> tuple[np.ndarray, np.ndarray]:
    """(train_mask, test_mask): the last `test_frac` of distinct dates is the test set."""
    unique = sorted(set(dates.tolist()))
    cutoff = unique[int(len(unique) * (1.0 - test_frac))]
    test = dates >= cutoff
    return ~test, test


_RECOMMEND_SAMPLES_PER_REGION_SEASON = 500

# Rare-label top-up. Labels come from compute_smart_score's argmax, which
# picks some crops almost never (at 500 samples per region+season: maize 12,
# wheat 15, groundnut 51 of 30,000). A classifier can't learn a crop from a
# dozen examples, so after the main pass we keep drawing scenarios in the
# region+seasons where each rare crop has won, keeping only the rare wins,
# until every crop that won at all has _RECOMMEND_MIN_PER_CLASS examples or
# the draw budget runs out. Rows are tagged "topup" so evaluation can report
# headline metrics on the natural distribution only.
_RECOMMEND_MIN_PER_CLASS = 100
# ~0.2 ms per draw, so the worst case is ~80 s. Maize wins about 1 draw in
# 700 even in the region+seasons where it wins at all.
_RECOMMEND_TOPUP_MAX_DRAWS = 400_000

# Per-farm soil varies around the regional average. Without this the
# classifier only ever saw one N/P/K/OC value per region and ignored soil
# entirely, though the scoring formula it imitates responds to it.
_SOIL_NUTRIENT_SPREAD = 0.3   # N, P, K, OC drawn within +/-30% of the region's value

# Weather sampling for training: a mixture of (a) each region+season's own
# observed rainfall/temp range (widened, to cover years the 3-year record
# didn't happen to include) and (b) a minority "tail" drawn from the old
# shared range, standing in for real-but-unobserved extreme years. See
# docs/superpowers/specs/2026-09-11-rabi-rainfall-sampling-design.md for why
# a pure widened-real-range fix over-corrects (it makes wheat/maize/barley
# unrecommendable outright, since their ROI disadvantage in
# compute_smart_score was only ever overcome by the old range's occasional,
# unrealistic near-ideal rainfall draws).
_RAIN_WIDEN_FRAC = 0.25   # +/-25% of the observed rainfall range
_TEMP_WIDEN_C = 3.0       # +/-3 degrees C around the observed temp range
_WEATHER_TAIL_FRAC = 0.35             # fraction of samples drawn from the tail
_WEATHER_TAIL_RAIN_RANGE = (200.0, 2500.0)
_WEATHER_TAIL_TEMP_RANGE = (15.0, 40.0)

RECOMMEND_FEATURE_NAMES = [
    "region_enc", "season_enc",
    "soil_ph", "soil_n", "soil_p", "soil_k", "soil_oc",
    "rainfall", "avg_temp", "min_temp", "max_temp",
    "budget", "irrigation",
]

_BUDGET_CHOICES = [8000, 12000, 18000, 25000, 35000]


def _sf(d: dict, k: str, default: float = 0.0) -> float:
    try:
        return float(d.get(k, default))
    except (ValueError, TypeError):
        return default


def _recommendation_context() -> dict:
    """Everything a single scenario draw needs, loaded once per build."""
    crop_params_list = _load_csv("crop_parameters.csv", required=True)
    soil_data = {r["region_id"]: r for r in _load_csv("soil.csv", required=True)}
    # All observed years per (region, season) -- not just one -- so sampling
    # reflects each region's actual seasonal climate. See
    # docs/superpowers/specs/2026-09-11-rabi-rainfall-sampling-design.md.
    weather_by_region_season: dict[tuple[str, str], list[dict]] = {}
    for r in _load_csv("weather.csv", required=True):
        weather_by_region_season.setdefault((r["region_id"], r["season"].lower()), []).append(r)
    mandi_latest: dict[tuple[str, str], float] = {}
    for r in sorted(_load_csv("mandi_prices.csv", required=True), key=lambda x: x["date"]):
        mandi_latest[(r["region_id"], r["crop_id"])] = float(r["price_inr_per_kg"])

    crop_le = LabelEncoder().fit(sorted(r["crop_id"] for r in crop_params_list))
    region_le = LabelEncoder().fit(sorted(soil_data.keys()))
    season_le = LabelEncoder().fit(ALL_SEASONS)

    cells = []
    for rid in sorted(soil_data.keys()):
        for season in ("kharif", "rabi"):
            # A region can exist in soil.csv without weather rows for every
            # season yet (a newly onboarded region, a partial
            # refresh_weather_seed.py run) -- skip it rather than crash.
            weather_hist = weather_by_region_season.get((rid, season))
            if not weather_hist:
                continue
            rain_hist = [float(w["rainfall_mm"]) for w in weather_hist]
            temp_hist = [float(w["avg_temp_c"]) for w in weather_hist]
            # Rainfall is ratio-scale (0mm is meaningful), so widen it
            # proportionally; temperature is interval-scale, so widen it by a
            # fixed additive margin instead.
            cells.append({
                "rid": rid, "season": season, "soil": soil_data[rid],
                "region_code": float(region_le.transform([rid])[0]),
                "season_code": float(season_le.transform([season])[0]),
                "rain": (max(0.0, min(rain_hist) * (1.0 - _RAIN_WIDEN_FRAC)),
                         max(rain_hist) * (1.0 + _RAIN_WIDEN_FRAC)),
                "temp": (min(temp_hist) - _TEMP_WIDEN_C, max(temp_hist) + _TEMP_WIDEN_C),
            })

    return {
        "crop_params": {r["crop_id"]: r for r in crop_params_list},
        "crop_objs": {r["crop_id"]: make_crop_param(r) for r in crop_params_list},
        "crop_index": {c: i for i, c in enumerate(crop_le.classes_)},
        "mandi_latest": mandi_latest,
        "cells": cells,
        "encoders": (crop_le, region_le, season_le),
    }


def _draw_labeled_scenario(ctx: dict, cell: dict, rng: np.random.RandomState):
    """Sample one farm scenario in `cell` and label it with its best crop.

    Returns (features, crop_id), with crop_id None if no crop is eligible.
    The label is the argmax of the same compute_smart_score() weighting
    ml/predict.py::_score_single_crop uses to rank crops for a real farmer --
    see docs/superpowers/specs/2026-09-06-ml-model-accuracy-design.md section 6.
    """
    budget = float(rng.choice(_BUDGET_CHOICES))
    irr = float(rng.uniform(0.05, 0.95))
    ph = float(rng.uniform(5.0, 8.5))
    if rng.uniform() < _WEATHER_TAIL_FRAC:
        rain = float(rng.uniform(*_WEATHER_TAIL_RAIN_RANGE))
        temp = float(rng.uniform(*_WEATHER_TAIL_TEMP_RANGE))
    else:
        rain = float(rng.uniform(*cell["rain"]))
        temp = float(rng.uniform(*cell["temp"]))
    lo, hi = 1.0 - _SOIL_NUTRIENT_SPREAD, 1.0 + _SOIL_NUTRIENT_SPREAD
    base_soil = cell["soil"]
    soil_sim = {
        "ph": ph,
        "n_kg_per_acre": _sf(base_soil, "n_kg_per_acre", 40) * float(rng.uniform(lo, hi)),
        "p_kg_per_acre": _sf(base_soil, "p_kg_per_acre", 20) * float(rng.uniform(lo, hi)),
        "k_kg_per_acre": _sf(base_soil, "k_kg_per_acre", 20) * float(rng.uniform(lo, hi)),
        "organic_carbon_percent": _sf(base_soil, "organic_carbon_percent", 0.5) * float(rng.uniform(lo, hi)),
    }
    weather_sim = {"rainfall_mm": rain, "avg_temp_c": temp}
    rid, season = cell["rid"], cell["season"]

    best_crop, best_score = None, -np.inf
    for cid, cp in ctx["crop_params"].items():
        crop_season = cp["season"]
        # Match recommend_crops's own candidate filter exactly (ml/predict.py):
        # a seasonal request excludes true perennials outright.
        if not _season_match(season, crop_season) or _is_perennial(crop_season):
            continue
        cp_obj = ctx["crop_objs"][cid]
        # Same deterministic heuristic production falls back to when no ML
        # yield model is consulted.
        yield_est = calculate_yield_kg_per_acre(cp_obj, soil_sim, weather_sim, irrigation_level=irr)
        price = ctx["mandi_latest"].get(
            (rid, cid),
            (float(cp["mandi_price_min_inr_per_kg"]) + float(cp["mandi_price_max_inr_per_kg"])) / 2.0,
        )
        # roi_percent is scale-invariant in area_acres, so 1.0 is exact.
        profit = profit_estimator(
            crop_id=cid, predicted_yield_kg_per_acre=yield_est,
            area_acres=1.0, budget_per_acre=budget, mandi_price_per_kg=price,
        )
        # Called exactly as _score_single_crop calls it -- no irrigation_level
        # argument -- because labels must reflect what production computes.
        risk = smart_risk_score(cid, weather_sim, soil_sim, budget)
        roi_normalized = compute_roi_normalized(profit["roi_percent"])
        # ml_term forced to roi_normalized (production's own no-model
        # fallback) and saturation_penalty to 0.0 (no commitment data for a
        # synthetic scenario) -- breaks the circularity of a classifier
        # trained on its own prior predictions. See spec section 6.3.
        score = compute_smart_score(
            roi_normalized=roi_normalized,
            confidence_score=risk["confidence_score"],
            budget_fit=compute_budget_fit(budget, cp_obj.avg_input_cost_inr_per_acre),
            soil_health=compute_soil_health(
                soil_sim["n_kg_per_acre"], soil_sim["p_kg_per_acre"], soil_sim["k_kg_per_acre"],
                cp_obj.npk_n_kg_per_acre, cp_obj.npk_p_kg_per_acre, cp_obj.npk_k_kg_per_acre,
            ),
            ml_term=roi_normalized,
            saturation_penalty=0.0,
        )
        if score > best_score:
            best_crop, best_score = cid, score

    features = [
        cell["region_code"], cell["season_code"],
        ph,
        soil_sim["n_kg_per_acre"], soil_sim["p_kg_per_acre"],
        soil_sim["k_kg_per_acre"], soil_sim["organic_carbon_percent"],
        rain, temp, temp - 8, temp + 7,
        budget, irr,
    ]
    return features, best_crop


def _build_recommendation_dataset(
    seed: int = 42,
    samples_per_region_season: int = _RECOMMEND_SAMPLES_PER_REGION_SEASON,
    min_per_class: int = _RECOMMEND_MIN_PER_CLASS,
    max_topup_draws: int = _RECOMMEND_TOPUP_MAX_DRAWS,
) -> tuple[np.ndarray, np.ndarray, list[str], LabelEncoder, LabelEncoder, LabelEncoder]:
    """
    Build crop-recommendation data: for each (region, season), simulate
    randomized farm scenarios and label each with its best-scoring crop.

    Candidate eligibility matches recommend_crops's own filter exactly: true
    perennials are excluded from kharif/rabi sampling, since a request for
    "this season" can't recommend a tree that takes years to fruit.

    Returns (X, y, source, crop_le, region_le, season_le). `source` tags each
    row "natural" (the main pass) or "topup" (a rare-crop win kept by the
    top-up pass). Labels are a deterministic function of the scenario, so a
    holdout is simply another build with a different `seed` -- no split, so
    no near-copies of test rows can leak into training. (The old builder
    appended noised copies with unchanged labels and then split, which both
    leaked and taught the model labels that no longer matched the features.)
    """
    ctx = _recommendation_context()
    crop_le, region_le, season_le = ctx["encoders"]
    crop_index = ctx["crop_index"]
    rng = np.random.RandomState(seed)
    X_all, y_all, source = [], [], []
    wins_by_crop: dict[str, set[int]] = {}

    for cell_idx, cell in enumerate(ctx["cells"]):
        for _ in range(samples_per_region_season):
            features, crop = _draw_labeled_scenario(ctx, cell, rng)
            if crop is None:
                continue
            X_all.append(features)
            y_all.append(crop_index[crop])
            source.append("natural")
            wins_by_crop.setdefault(crop, set()).add(cell_idx)

    counts = Counter(y_all)
    deficit = {
        crop: min_per_class - counts[crop_index[crop]]
        for crop in wins_by_crop
        if counts[crop_index[crop]] < min_per_class
    }
    draws = 0
    while deficit and draws < max_topup_draws:
        target_cells = sorted({i for crop in deficit for i in wins_by_crop[crop]})
        for cell_idx in target_cells:
            features, crop = _draw_labeled_scenario(ctx, ctx["cells"][cell_idx], rng)
            draws += 1
            if crop in deficit:
                X_all.append(features)
                y_all.append(crop_index[crop])
                source.append("topup")
                deficit[crop] -= 1
                if deficit[crop] <= 0:
                    del deficit[crop]
            if draws >= max_topup_draws or not deficit:
                break

    return (np.array(X_all, dtype=np.float32),
            np.array(y_all, dtype=np.int32),
            source,
            crop_le, region_le, season_le)
