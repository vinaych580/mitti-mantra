"""
ml/train_models.py
Training pipeline for ML models:
  1. Yield Prediction       – RandomForestRegressor
  2. Price Forecasting      – GradientBoostingRegressor with lag features
  3. Crop Recommendation    – RandomForestClassifier (best crop for conditions)

Run directly:  python -m ml.train_models
Or via API:    POST /api/train
"""
from __future__ import annotations

import csv
# FIX (4.3): Removed unused imports `hashlib` and `random`
import json
import logging
import warnings
from pathlib import Path
from typing import Any

import joblib
import numpy as np
from sklearn.ensemble import (
    GradientBoostingRegressor,
    RandomForestClassifier,
    RandomForestRegressor,
)
from sklearn.metrics import (
    accuracy_score,
    mean_absolute_error,
    mean_squared_error,
    r2_score,
)
from sklearn.model_selection import train_test_split
from sklearn.preprocessing import LabelEncoder

# FIX (4.5): Replaced global warnings.filterwarnings with structured logging
logger = logging.getLogger(__name__)

from utils.calculations import CropParameter, calculate_climate_factor, calculate_soil_factor

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

DATASET_DIR = Path(__file__).resolve().parents[1] / "dataset"
MODEL_DIR = Path(__file__).resolve().parent / "models"
MODEL_DIR.mkdir(exist_ok=True)

# FIX (1.1, 1.2): Single canonical season list used consistently across
# training and inference to prevent encoder mismatch.
ALL_SEASONS = sorted({"kharif", "rabi", "annual", "perennial", "perenn"})

# ---------------------------------------------------------------------------
# CSV helpers
# ---------------------------------------------------------------------------

# FIX (1.6): Added `required` parameter to fail fast on missing critical datasets
def _load_csv(name: str, required: bool = False) -> list[dict[str, str]]:
    from utils.csv_cache import load as _cached_load
    rows = _cached_load(name)
    if not rows and required:
        raise FileNotFoundError(f"Required dataset missing or empty: {DATASET_DIR / name}")
    return rows



# ---------------------------------------------------------------------------
# Encoders (saved alongside models so predict.py can reuse them)
# ---------------------------------------------------------------------------

def _fit_label_encoders(crops: list[str], regions: list[str], seasons: list[str]):
    crop_le = LabelEncoder().fit(sorted(set(crops)))
    region_le = LabelEncoder().fit(sorted(set(regions)))
    season_le = LabelEncoder().fit(sorted(set(seasons)))
    return crop_le, region_le, season_le


# ===================================================================
# 1. YIELD PREDICTION MODEL
# ===================================================================

# FIX (1.1): Return type now includes the encoders used during training
def _build_yield_dataset() -> tuple[np.ndarray, np.ndarray, LabelEncoder, LabelEncoder, LabelEncoder]:
    """
    Build training data for yield prediction by joining:
      yield_history × crop_parameters × soil × weather
    Then augment with gaussian noise to ~500+ samples.

    Returns (X, y, crop_le, region_le, season_le) — encoders are returned
    so the exact instances used during training can be persisted.
    """
    # FIX (1.6): Mark critical datasets as required
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

    # FIX (1.1): Use canonical ALL_SEASONS for consistent encoding
    crop_le, region_le, season_le = _fit_label_encoders(all_crops, all_regions, ALL_SEASONS)

    rows_X, rows_y = [], []

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

    # ---- Inject Negative/Mismatched Crop-Climate Examples ----
    # This trains the ML model directly to learn climate bounds (drought, flood)
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
                    # Severe climate mismatch
                    mismatched_yield = float(cp_row["base_yield_kg_per_acre"]) * climate_factor * 0.1
                    features = _yield_features(cid, rid, season, cp_row, soil, weather,
                                               crop_le, region_le, season_le,
                                               irrigation=0.5)
                    rows_X.append(features)
                    rows_y.append(mismatched_yield)

    # ---- Data augmentation ----
    # With only ~70 real rows, we augment by perturbing numeric features ±10%
    rng = np.random.RandomState(42)
    aug_X, aug_y = [], []
    for i in range(len(rows_X)):
        for _ in range(6):  # 6 augmentations per real sample
            noise = rng.uniform(0.90, 1.10, size=len(rows_X[i]))
            # Keep encoded indices intact (first 3 features)
            noised = np.array(rows_X[i]) * noise
            noised[:3] = rows_X[i][:3]
            aug_X.append(noised.tolist())
            aug_y.append(rows_y[i] * rng.uniform(0.92, 1.08))
    rows_X.extend(aug_X)
    rows_y.extend(aug_y)

    # FIX (1.1): Return encoders so they can be saved alongside the model
    return (np.array(rows_X, dtype=np.float32),
            np.array(rows_y, dtype=np.float32),
            crop_le, region_le, season_le)


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

YIELD_FEATURE_NAMES = [
    "crop_enc", "region_enc", "season_enc",
    "base_yield", "water_req", "temp_min", "temp_max",
    "npk_n", "npk_p", "npk_k",
    "soil_ph", "soil_n", "soil_p", "soil_k", "soil_oc",
    "rainfall", "avg_temp", "min_temp", "max_temp",
    "irrigation",
]


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

        model = RandomForestRegressor(
            n_estimators=200,
            max_depth=12,
            min_samples_split=5,
            min_samples_leaf=3,
            random_state=42,
            n_jobs=-1,
        )
        model.fit(X_train, y_train)

    y_pred = model.predict(X_test)
    metrics = {
        "mae": round(float(mean_absolute_error(y_test, y_pred)), 2),
        "rmse": round(float(np.sqrt(mean_squared_error(y_test, y_pred))), 2),
        "r2": round(float(r2_score(y_test, y_pred)), 4),
        "train_samples": len(X_train),
        "test_samples": len(X_test),
    }

    # Feature importances
    importances = dict(zip(YIELD_FEATURE_NAMES,
                           [round(float(x), 4) for x in model.feature_importances_]))

    # Save
    joblib.dump(model, MODEL_DIR / "yield_model.joblib")

    # FIX (1.1): Save the EXACT encoder instances from training — not re-fitted ones
    joblib.dump({"crop": crop_le, "region": region_le, "season": season_le},
                MODEL_DIR / "label_encoders.joblib")

    return {"model": "yield_prediction", "algorithm": "RandomForestRegressor",
            "metrics": metrics, "feature_importances": importances}


# ===================================================================
# 2. PRICE FORECASTING MODEL
# ===================================================================

def _build_price_dataset() -> tuple[np.ndarray, np.ndarray, LabelEncoder, LabelEncoder]:
    """
    Build time-series features for price prediction:
    lag_1, lag_2, lag_3, rolling_mean_3, rolling_std_3, month, year,
    crop_encoded, region_encoded
    """
    # FIX (1.6): Mark critical dataset as required
    rows = _load_csv("mandi_prices.csv", required=True)

    all_crops = sorted({r["crop_id"] for r in rows})
    all_regions = sorted({r["region_id"] for r in rows})
    crop_le = LabelEncoder().fit(all_crops)
    region_le = LabelEncoder().fit(all_regions)

    # Group by (region, crop), sort by date
    groups: dict[tuple[str, str], list[dict]] = {}
    for r in rows:
        key = (r["region_id"], r["crop_id"])
        groups.setdefault(key, []).append(r)

    X_all, y_all = [], []
    for (rid, cid), series in groups.items():
        series.sort(key=lambda x: x["date"])
        prices = [float(s["price_inr_per_kg"]) for s in series]
        dates = [s["date"] for s in series]

        for i in range(3, len(prices)):
            try:
                month = int(dates[i].split("-")[1])
                year = int(dates[i].split("-")[0])
            except (ValueError, IndexError):
                continue

            lag1 = prices[i - 1]
            lag2 = prices[i - 2]
            lag3 = prices[i - 3]
            roll_mean = np.mean(prices[max(0, i - 3):i])
            roll_std = np.std(prices[max(0, i - 3):i]) if i >= 3 else 0.0
            price_range = max(prices) - min(prices)

            features = [
                crop_le.transform([cid])[0],
                region_le.transform([rid])[0],
                month,
                year - 2024,  # normalize year
                lag1, lag2, lag3,
                roll_mean,
                roll_std,
                price_range,
            ]
            X_all.append(features)
            y_all.append(prices[i])

    return (np.array(X_all, dtype=np.float32),
            np.array(y_all, dtype=np.float32),
            crop_le, region_le)

PRICE_FEATURE_NAMES = [
    "crop_enc", "region_enc", "month", "year_offset",
    "lag_1", "lag_2", "lag_3",
    "rolling_mean_3", "rolling_std_3", "price_range",
]


def train_price_model() -> dict[str, Any]:
    """Train GradientBoosting price forecasting model."""
    X, y, crop_le, region_le = _build_price_dataset()

    # FIX (4.5): Scope warning suppression to sklearn training only
    with warnings.catch_warnings():
        warnings.filterwarnings("ignore", category=UserWarning, module="sklearn")
        X_train, X_test, y_train, y_test = train_test_split(
            X, y, test_size=0.2, random_state=42,
        )

        model = GradientBoostingRegressor(
            n_estimators=300,
            max_depth=6,
            learning_rate=0.05,
            min_samples_split=5,
            subsample=0.8,
            random_state=42,
        )
        model.fit(X_train, y_train)

    y_pred = model.predict(X_test)
    metrics = {
        "mae": round(float(mean_absolute_error(y_test, y_pred)), 2),
        "rmse": round(float(np.sqrt(mean_squared_error(y_test, y_pred))), 2),
        "r2": round(float(r2_score(y_test, y_pred)), 4),
        "train_samples": len(X_train),
        "test_samples": len(X_test),
    }

    importances = dict(zip(PRICE_FEATURE_NAMES,
                           [round(float(x), 4) for x in model.feature_importances_]))

    joblib.dump(model, MODEL_DIR / "price_model.joblib")
    # Price model already saves the exact training encoders — no change needed
    joblib.dump({"crop": crop_le, "region": region_le},
                MODEL_DIR / "price_encoders.joblib")

    return {"model": "price_forecasting", "algorithm": "GradientBoostingRegressor",
            "metrics": metrics, "feature_importances": importances}


# ===================================================================
# 3. CROP RECOMMENDATION MODEL
# ===================================================================

# FIX (3.3): Number of random samples per (region, season) pair instead of
# exhaustive 5-deep nested loop (was R × 6250, now R × 500 per combo).
_RECOMMEND_SAMPLES_PER_REGION_SEASON = 500

# FIX (1.2): Return type now includes the encoders used during training
def _build_recommendation_dataset() -> tuple[np.ndarray, np.ndarray, LabelEncoder, LabelEncoder, LabelEncoder]:
    """
    Build crop recommendation training data:
    For each (region, season), simulate all crops and label the best one
    by estimated profit. Augment with varied budgets and irrigation levels.

    Returns (X, y, crop_le, region_le, season_le) so the exact encoder
    instances can be saved alongside the model.
    """
    # FIX (1.6): Mark critical datasets as required
    crop_params_list = _load_csv("crop_parameters.csv", required=True)
    crop_params = {r["crop_id"]: r for r in crop_params_list}
    crop_params_objs = {r["crop_id"]: make_crop_param(r) for r in crop_params_list}
    soil_data = {r["region_id"]: r for r in _load_csv("soil.csv", required=True)}
    weather_rows = _load_csv("weather.csv", required=True)
    weather_data = {}
    for r in weather_rows:
        weather_data[(r["region_id"], r["season"].lower())] = r
    mandi_rows = _load_csv("mandi_prices.csv", required=True)

    # Latest mandi price per (region, crop)
    mandi_latest: dict[tuple[str, str], float] = {}
    for r in sorted(mandi_rows, key=lambda x: x["date"]):
        mandi_latest[(r["region_id"], r["crop_id"])] = float(r["price_inr_per_kg"])

    all_crops = sorted(crop_params.keys())
    all_regions = sorted(soil_data.keys())
    all_seasons = ["kharif", "rabi"]

    crop_le = LabelEncoder().fit(all_crops)
    region_le = LabelEncoder().fit(all_regions)
    # FIX (1.2): Use canonical ALL_SEASONS for consistent encoding
    season_le = LabelEncoder().fit(ALL_SEASONS)

    rng = np.random.RandomState(42)
    X_all, y_all = [], []

    def sf(d, k, default=0.0):
        try:
            return float(d.get(k, default))
        except (ValueError, TypeError):
            return default

    # FIX (3.3): Replaced 5-deep nested loop with stratified random sampling
    # to avoid combinatorial explosion while still covering the parameter space.
    budget_choices = [8000, 12000, 18000, 25000, 35000]

    for rid in all_regions:
        base_soil = soil_data[rid]
        for season in all_seasons:
            wkey = (rid, season)
            base_weather = weather_data.get(wkey, {})

            for _ in range(_RECOMMEND_SAMPLES_PER_REGION_SEASON):
                budget = rng.choice(budget_choices)
                irr = float(rng.uniform(0.05, 0.95))
                ph = float(rng.uniform(5.0, 8.5))
                rain = float(rng.uniform(200, 2500))
                temp = float(rng.uniform(15, 40))

                # Score each crop with realistic factors
                best_crop = None
                best_score = -1e9
                for cid, cp in crop_params.items():
                    crop_season = cp["season"].lower()
                    if (season not in crop_season and 
                        "annual" not in crop_season and 
                        "perennial" not in crop_season):
                        continue

                    cp_obj = crop_params_objs[cid]
                    base_yield = float(cp["base_yield_kg_per_acre"])
                    cost = float(cp["avg_input_cost_inr_per_acre"])
                    price = mandi_latest.get(
                        (rid, cid),
                        (float(cp["mandi_price_min_inr_per_kg"]) +
                         float(cp["mandi_price_max_inr_per_kg"])) / 2)
                    # Budget penalty: if cost > budget, heavy penalty
                    budget_fit = 1.0 if budget >= cost else budget / cost * 0.5

                    # Use the official climate factor calculation
                    weather_sim = {"rainfall_mm": rain, "avg_temp_c": temp}
                    climate_factor = calculate_climate_factor(weather_sim, cp_obj)

                    # Use the official soil suitability factor
                    soil_sim = {"ph": ph, "n_kg_per_acre": sf(base_soil, "n_kg_per_acre", 40)}
                    soil_factor = calculate_soil_factor(soil_sim, cp_obj)

                    yield_est = base_yield * climate_factor * soil_factor * (0.6 + 0.5 * irr)
                    revenue = yield_est * price
                    profit = (revenue - cost) * budget_fit
                    score = profit

                    if score > best_score:
                        best_score = score
                        best_crop = cid

                if best_crop is None:
                    continue

                features = [
                    region_le.transform([rid])[0],
                    season_le.transform([season])[0],
                    ph,
                    sf(base_soil, "n_kg_per_acre", 40),
                    sf(base_soil, "p_kg_per_acre", 20),
                    sf(base_soil, "k_kg_per_acre", 20),
                    sf(base_soil, "organic_carbon_percent", 0.5),
                    rain,
                    temp,
                    temp - 8,  # approx min_temp
                    temp + 7,  # approx max_temp
                    budget,
                    irr,
                ]
                X_all.append(features)
                y_all.append(crop_le.transform([best_crop])[0])

    # Light augmentation
    base_len = len(X_all)
    for i in range(base_len):
        noised = np.array(X_all[i])
        noised[2:11] *= rng.uniform(0.92, 1.08, size=9)
        noised[11] *= rng.uniform(0.9, 1.1)
        noised[12] = np.clip(noised[12] + rng.uniform(-0.1, 0.1), 0.05, 1.0)
        X_all.append(noised.tolist())
        y_all.append(y_all[i])

    # FIX (1.2): Return encoders alongside dataset
    return (np.array(X_all, dtype=np.float32),
            np.array(y_all, dtype=np.int32),
            crop_le, region_le, season_le)

RECOMMEND_FEATURE_NAMES = [
    "region_enc", "season_enc",
    "soil_ph", "soil_n", "soil_p", "soil_k", "soil_oc",
    "rainfall", "avg_temp", "min_temp", "max_temp",
    "budget", "irrigation",
]


def train_recommendation_model() -> dict[str, Any]:
    """Train RandomForest crop recommendation classifier."""
    # FIX (1.2): Unpack the actual encoders used during training
    X, y, crop_le, region_le, season_le = _build_recommendation_dataset()

    # FIX (4.5): Scope warning suppression to sklearn training only
    with warnings.catch_warnings():
        warnings.filterwarnings("ignore", category=UserWarning, module="sklearn")
        X_train, X_test, y_train, y_test = train_test_split(
            X, y, test_size=0.2, random_state=42, stratify=y,
        )

        model = RandomForestClassifier(
            n_estimators=200,
            max_depth=10,
            min_samples_split=4,
            random_state=42,
            n_jobs=-1,
        )
        model.fit(X_train, y_train)

    y_pred = model.predict(X_test)
    accuracy = round(float(accuracy_score(y_test, y_pred)), 4)

    # Per-class probabilities give us ranked recommendations
    metrics = {
        "accuracy": accuracy,
        "train_samples": len(X_train),
        "test_samples": len(X_test),
        "num_classes": len(set(y)),
    }

    importances = dict(zip(RECOMMEND_FEATURE_NAMES,
                           [round(float(x), 4) for x in model.feature_importances_]))

    joblib.dump(model, MODEL_DIR / "recommend_model.joblib")

    # FIX (1.2): Save the EXACT encoder instances from training — not re-fitted ones
    joblib.dump({"crop": crop_le, "region": region_le, "season": season_le},
                MODEL_DIR / "recommend_encoders.joblib")

    return {"model": "crop_recommendation", "algorithm": "RandomForestClassifier",
            "metrics": metrics, "feature_importances": importances}


# ===================================================================
# Master training function
# ===================================================================

def train_all() -> dict[str, Any]:
    """Train the 4 ML models (yield, price, recommendation, disease) and return a combined report.

    The disease classifier trains only if dataset/plantvillage/ has enough
    labeled images per class; otherwise it reports NOT_APPLICABLE and the
    live endpoint falls back to its HSV/texture heuristic — see
    ml/training/disease_model.py.
    """
    print("=" * 60)
    print("Training Yield Prediction Model...")
    yield_report = train_yield_model()
    print(f"  R² = {yield_report['metrics']['r2']}  MAE = {yield_report['metrics']['mae']}")

    print("Training Price Forecasting Model...")
    price_report = train_price_model()
    print(f"  R² = {price_report['metrics']['r2']}  MAE = {price_report['metrics']['mae']}")

    print("Training Crop Recommendation Model...")
    rec_report = train_recommendation_model()
    print(f"  Accuracy = {rec_report['metrics']['accuracy']}")

    print("Training Crop Disease Classifier (or reporting heuristic-only status)...")
    try:
        from ml.training.disease_model import train_disease_model
        disease_report = train_disease_model()
        if disease_report.get("status") == "TRAINED":
            print(f"  Test accuracy = {disease_report['metrics']['test_accuracy']}  "
                  f"CV mean = {disease_report['metrics']['cv_mean_accuracy']}")
        else:
            print(f"  {disease_report['note']}")
    except Exception as e:
        logger.warning("Disease model status update failed: %s", e)
        print(f"  Failed to update disease model status: {e}")
        disease_report = {
            "model": "crop_disease",
            "status": "STATUS_UPDATE_FAILED",
            "error": str(e),
            "metrics": None,
        }

    print("=" * 60)
    print("All models saved to:", MODEL_DIR)

    # Save a manifest
    manifest = {
        "models": [yield_report, price_report, rec_report, disease_report],
        "model_dir": "ml/models",
    }
    with open(MODEL_DIR / "manifest.json", "w") as f:
        json.dump(manifest, f, indent=2)

    return manifest


if __name__ == "__main__":
    report = train_all()
    print(json.dumps(report, indent=2))
