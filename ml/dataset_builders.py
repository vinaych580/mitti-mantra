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
