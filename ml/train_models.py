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
import hashlib
import json
import logging
import time
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

from ml.dataset_builders import (
    YIELD_FEATURE_NAMES,
    RECOMMEND_FEATURE_NAMES,
    _build_yield_dataset,
    _build_recommendation_dataset,
    _save_holdout,
    _load_csv,
)

DATASET_DIR = Path(__file__).resolve().parents[1] / "dataset"
MODEL_DIR = Path(__file__).resolve().parent / "models"
MODEL_DIR.mkdir(exist_ok=True)

# ===================================================================
# 1. YIELD PREDICTION MODEL
# ===================================================================

def train_yield_model() -> dict[str, Any]:
    """Train RandomForest yield prediction model."""
    X, y, source, crop_le, region_le, season_le = _build_yield_dataset()

    with warnings.catch_warnings():
        warnings.filterwarnings("ignore", category=UserWarning, module="sklearn")
        X_train, X_test, y_train, y_test, _source_train_unused, source_test = train_test_split(
            X, y, source, test_size=0.2, random_state=42,
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

    # Persist the real held-out test rows, tagged with provenance, for
    # later unbiased and honestly-split audit reporting.
    _save_holdout("yield", X_test, y_test, source_test=source_test)

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

def train_recommendation_model() -> dict[str, Any]:
    """Train RandomForest crop recommendation classifier."""
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
            class_weight="balanced",
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

    # FIX (C-3): Persist the real held-out test rows for later unbiased audit
    _save_holdout("recommend", X_test, y_test)

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
    ml/training/disease_cnn.py.
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
        from ml.training.disease_cnn import train_disease_cnn
        disease_report = train_disease_cnn()
        if disease_report.get("status") == "TRAINED":
            print(f"  Test accuracy = {disease_report['metrics']['test_accuracy']}  "
                  f"Macro F1 = {disease_report['metrics']['macro_f1']}")
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

    # FIX (M-20): audit_metrics.json / evaluation_manifest.json go stale
    # relative to whatever model is currently deployed. Now that training
    # persists a genuinely-unseen holdout per model (FIX C-3), regenerate
    # the audit against the models we *just* trained/saved so audit_metrics.json
    # always reflects the currently-deployed model, not a prior run's.
    print("Refreshing model audit (audit_metrics.json) against freshly trained models...")
    try:
        from ml.audit_models import ModelAuditor
        ModelAuditor().run_audit()
        print("  audit_metrics.json refreshed.")
    except Exception as e:
        logger.warning("Post-training audit refresh failed: %s", e)
        print(f"  Failed to refresh audit_metrics.json: {e}")

    print("=" * 60)
    print("All models saved to:", MODEL_DIR)

    # FIX (M-20): stamp the manifest with a timestamp and a content hash of
    # the deployed model artifacts, so consumers (e.g. /api/ml/status) can
    # detect when audit_metrics.json / evaluation_manifest.json were
    # generated against a different model than the one currently loaded.
    def _file_hash(path: Path) -> str | None:
        if not path.exists():
            return None
        h = hashlib.md5()
        with open(path, "rb") as fh:
            for chunk in iter(lambda: fh.read(65536), b""):
                h.update(chunk)
        return h.hexdigest()

    model_hashes = {
        name: _file_hash(MODEL_DIR / name)
        for name in ("yield_model.joblib", "price_model.joblib", "recommend_model.joblib")
    }

    # Save a manifest
    manifest = {
        "models": [yield_report, price_report, rec_report, disease_report],
        "model_dir": "ml/models",
        "trained_at": time.time(),
        "model_hashes": model_hashes,
    }
    with open(MODEL_DIR / "manifest.json", "w") as f:
        json.dump(manifest, f, indent=2)

    return manifest


if __name__ == "__main__":
    report = train_all()
    print(json.dumps(report, indent=2))
