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
    calculate_climate_factor,
    calculate_soil_factor,
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
            # A noised copy of a synthetic_mismatch row (deliberately tiny
            # yield to expose model overfitting) stays tagged that way rather
            # than being promoted to "augmented" -- preserves the provenance
            # signal used by audit_models._split_yield_mape() to exclude
            # non-realistic rows from honest MAPE reporting.
            aug_source.append("augmented" if rows_source[i] == "real" else rows_source[i])
    rows_X.extend(aug_X)
    rows_y.extend(aug_y)
    rows_source.extend(aug_source)

    return (np.array(rows_X, dtype=np.float32),
            np.array(rows_y, dtype=np.float32),
            rows_source,
            crop_le, region_le, season_le)


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

                    budget_fit = compute_budget_fit(budget, cp_obj.avg_input_cost_inr_per_acre)
                    roi_normalized = compute_roi_normalized(profit["roi_percent"])
                    soil_health = compute_soil_health(
                        soil_sim["n_kg_per_acre"],
                        soil_sim["p_kg_per_acre"],
                        soil_sim["k_kg_per_acre"],
                        cp_obj.npk_n_kg_per_acre,
                        cp_obj.npk_p_kg_per_acre,
                        cp_obj.npk_k_kg_per_acre,
                    )

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
