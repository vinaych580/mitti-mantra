"""
ml/train_models.py
Training pipeline for ML models:
  1. Yield Prediction       – RandomForestRegressor on real harvests
  2. Price Forecasting      – GradientBoostingRegressor, anchored to each series' mean
  3. Crop Recommendation    – HistGradientBoostingClassifier (best crop for conditions)

Every model is scored on data it could not have seen, split the way it's used:
yield on the latest harvest year, price on the latest months, recommendation
on an independently generated set of scenarios. Each report carries the naive
baseline it has to beat, so a model that doesn't is visible in manifest.json.

Run directly:  python -m ml.train_models
Or via API:    POST /api/train
"""
from __future__ import annotations

import hashlib
import json
import logging
import time
import warnings
from collections import defaultdict
from pathlib import Path
from typing import Any

import joblib
import numpy as np
from sklearn.ensemble import (
    GradientBoostingRegressor,
    HistGradientBoostingClassifier,
    RandomForestRegressor,
)
from sklearn.dummy import DummyRegressor
from sklearn.inspection import permutation_importance
from sklearn.metrics import (
    accuracy_score,
    f1_score,
    mean_absolute_error,
    mean_squared_error,
    r2_score,
)
from sklearn.preprocessing import LabelEncoder

# FIX (4.5): Replaced global warnings.filterwarnings with structured logging
logger = logging.getLogger(__name__)

from ml.dataset_builders import (
    YIELD_FEATURE_NAMES,
    RECOMMEND_FEATURE_NAMES,
    _build_yield_dataset,
    _build_recommendation_dataset,
    _save_holdout,
    _load_csv,
    _time_split,
    _yield_time_split,
)
from ml.predict import price_feature_row

DATASET_DIR = Path(__file__).resolve().parents[1] / "dataset"
MODEL_DIR = Path(__file__).resolve().parent / "models"
MODEL_DIR.mkdir(exist_ok=True)


def _regression_metrics(y_true: np.ndarray, y_pred: np.ndarray) -> dict[str, float]:
    y_true = np.asarray(y_true, dtype=np.float64)
    y_pred = np.asarray(y_pred, dtype=np.float64)
    return {
        "mae": round(float(mean_absolute_error(y_true, y_pred)), 2),
        "rmse": round(float(np.sqrt(mean_squared_error(y_true, y_pred))), 2),
        "r2": round(float(r2_score(y_true, y_pred)), 4),
        "mape_pct": round(float(np.mean(np.abs(y_true - y_pred) / y_true) * 100.0), 2),
    }


# ===================================================================
# 1. YIELD PREDICTION MODEL
# ===================================================================

YIELD_BASE_COL = YIELD_FEATURE_NAMES.index("base_yield")


def train_yield_model() -> dict[str, Any]:
    """Train RandomForest yield prediction on real harvests; hold out the latest year."""
    X, y, years, crop_le, region_le, season_le = _build_yield_dataset()
    train, test = _yield_time_split(years)

    with warnings.catch_warnings():
        warnings.filterwarnings("ignore", category=UserWarning, module="sklearn")
        model = RandomForestRegressor(
            n_estimators=300,
            min_samples_leaf=2,
            random_state=42,
            n_jobs=-1,
        )
        model.fit(X[train], y[train])

    y_test = y[test]
    metrics = _regression_metrics(y_test, model.predict(X[test]))
    metrics.update({
        "train_samples": int(train.sum()),
        "test_samples": int(test.sum()),
        "test_year": int(years.max()),
    })

    # Baselines the model has to beat: the crop's textbook yield, and the
    # region+crop's own average over earlier years (what the heuristic
    # fallback in ml/predict.py leans on).
    history: dict[tuple[float, float], list[float]] = defaultdict(list)
    for row, target in zip(X[train], y[train]):
        history[(row[0], row[1])].append(float(target))
    prior_mean = np.array([
        np.mean(history[(row[0], row[1])]) if history.get((row[0], row[1])) else row[YIELD_BASE_COL]
        for row in X[test]
    ])
    metrics["baselines"] = {
        "crop_base_yield": _regression_metrics(y_test, X[test][:, YIELD_BASE_COL]),
        "prior_years_mean": _regression_metrics(y_test, prior_mean),
    }

    importances = dict(zip(YIELD_FEATURE_NAMES,
                           [round(float(x), 4) for x in model.feature_importances_]))

    joblib.dump(model, MODEL_DIR / "yield_model.joblib")
    # FIX (1.1): Save the EXACT encoder instances from training — not re-fitted ones
    joblib.dump({"crop": crop_le, "region": region_le, "season": season_le},
                MODEL_DIR / "label_encoders.joblib")
    _save_holdout("yield", X[test], y_test, source_test=["real"] * int(test.sum()))

    return {"model": "yield_prediction", "algorithm": "RandomForestRegressor",
            "metrics": metrics, "feature_importances": importances}


# ===================================================================
# 2. PRICE FORECASTING MODEL
# ===================================================================

PRICE_FEATURE_NAMES = [
    "crop_enc", "region_enc", "month",
    "lag_1_rel", "lag_2_rel", "lag_3_rel",
    "rolling_mean_3_rel", "rolling_std_3_rel", "price_range_rel",
]


def _build_price_dataset() -> tuple[np.ndarray, np.ndarray, np.ndarray, np.ndarray, np.ndarray,
                                    LabelEncoder, LabelEncoder]:
    """
    One row per (region, crop, month) with at least 3 prior months, built
    only from prices *before* that month -- the old price_range feature used
    the whole series, future months included.

    Returns (X, y, anchor, last_price, dates, crop_le, region_le). The model's
    target is y / anchor (see ml.predict.price_feature_row); `last_price` is
    kept for the naive "same as last month" baseline.
    """
    # FIX (1.6): Mark critical dataset as required
    rows = _load_csv("mandi_prices.csv", required=True)

    crop_le = LabelEncoder().fit(sorted({r["crop_id"] for r in rows}))
    region_le = LabelEncoder().fit(sorted({r["region_id"] for r in rows}))

    groups: dict[tuple[str, str], list[dict]] = {}
    for r in rows:
        groups.setdefault((r["region_id"], r["crop_id"]), []).append(r)

    X_all, y_all, anchors, last_prices, dates = [], [], [], [], []
    for (rid, cid), series in groups.items():
        series.sort(key=lambda x: x["date"])
        prices = [float(s["price_inr_per_kg"]) for s in series]
        crop_code = crop_le.transform([cid])[0]
        region_code = region_le.transform([rid])[0]
        for i in range(3, len(prices)):
            try:
                month = int(series[i]["date"].split("-")[1])
            except (ValueError, IndexError):
                continue
            row, anchor = price_feature_row(crop_code, region_code, month, prices[:i])
            X_all.append(row)
            y_all.append(prices[i])
            anchors.append(anchor)
            last_prices.append(prices[i - 1])
            dates.append(series[i]["date"])

    return (np.array(X_all, dtype=np.float32),
            np.array(y_all, dtype=np.float64),
            np.array(anchors, dtype=np.float64),
            np.array(last_prices, dtype=np.float64),
            np.array(dates),
            crop_le, region_le)


def train_price_model() -> dict[str, Any]:
    """Train the price model on earlier months; score it on the latest 20% of months.

    Shallow on purpose. On rolling time-ordered splits of this data the
    historical mean alone (MAE ~4.17) beat the old depth-6 absolute-price
    model (~4.54); a depth-2 model on mean-relative features only matches
    it (~4.15). There is little month-to-month signal here beyond each
    series' level, and a deep model mostly fits noise.

    Whichever of the model and the historical mean scores better on the
    holdout is what gets deployed. The mean ships as a constant-1.0
    DummyRegressor on the same mean-relative target, so serving
    (ml.predict._ml_predict_price) is identical either way;
    metrics["deployed"] records which one won.
    """
    X, y, anchor, last_price, dates, crop_le, region_le = _build_price_dataset()
    train, test = _time_split(dates)

    with warnings.catch_warnings():
        warnings.filterwarnings("ignore", category=UserWarning, module="sklearn")
        model = GradientBoostingRegressor(
            n_estimators=150,
            max_depth=2,
            learning_rate=0.05,
            subsample=0.8,
            random_state=42,
        )
        model.fit(X[train], y[train] / anchor[train])

    y_test = y[test]
    model_metrics = _regression_metrics(y_test, model.predict(X[test]) * anchor[test])
    mean_metrics = _regression_metrics(y_test, anchor[test])
    use_mean = model_metrics["mae"] >= mean_metrics["mae"]
    if use_mean:
        model = DummyRegressor(strategy="constant", constant=1.0).fit(X[train], y[train] / anchor[train])
        algorithm = "DummyRegressor (historical mean)"
        importances = {}
    else:
        algorithm = "GradientBoostingRegressor"
        importances = dict(zip(PRICE_FEATURE_NAMES,
                               [round(float(x), 4) for x in model.feature_importances_]))

    metrics = dict(mean_metrics if use_mean else model_metrics)
    metrics.update({
        "deployed": "historical_mean" if use_mean else "gradient_boosting",
        "gradient_boosting": model_metrics,
        "train_samples": int(train.sum()),
        "test_samples": int(test.sum()),
        "test_from": min(dates[test].tolist()),
        "baselines": {
            "historical_mean": mean_metrics,
            "last_month": _regression_metrics(y_test, last_price[test]),
        },
    })

    joblib.dump(model, MODEL_DIR / "price_model.joblib")
    joblib.dump({"crop": crop_le, "region": region_le},
                MODEL_DIR / "price_encoders.joblib")

    return {"model": "price_forecasting", "algorithm": algorithm,
            "metrics": metrics, "feature_importances": importances}


# ===================================================================
# 3. CROP RECOMMENDATION MODEL
# ===================================================================

# The holdout is a second, independent draw of scenarios (labels are a
# deterministic function of the scenario, so a different seed is a clean
# test set). Smaller than training to keep a retrain reasonably quick.
_RECOMMEND_HOLDOUT_SEED = 2024
_RECOMMEND_HOLDOUT_SAMPLES_PER_REGION_SEASON = 250
_RECOMMEND_HOLDOUT_MIN_PER_CLASS = 50


def build_recommendation_holdout():
    return _build_recommendation_dataset(
        seed=_RECOMMEND_HOLDOUT_SEED,
        samples_per_region_season=_RECOMMEND_HOLDOUT_SAMPLES_PER_REGION_SEASON,
        min_per_class=_RECOMMEND_HOLDOUT_MIN_PER_CLASS,
    )


def train_recommendation_model() -> dict[str, Any]:
    """Train the crop recommendation classifier; score it on an independent draw."""
    X, y, _source, crop_le, region_le, season_le = _build_recommendation_dataset()
    X_test, y_test, source_test, *_ = build_recommendation_holdout()

    with warnings.catch_warnings():
        warnings.filterwarnings("ignore", category=UserWarning, module="sklearn")
        # Gradient boosting instead of the old depth-10 random forest. On the
        # independent holdout: forest 84.0% accuracy / 0.66 macro F1 at 53 MB;
        # this 93.9% / 0.83 at ~10 MB and ~27 ms per prediction. Uncapped
        # forests reached ~90% but weighed 260-420 MB, far past what the
        # Vercel bundle can carry. class_weight="balanced" is not optional:
        # unweighted, boosting collapsed to predicting the majority crops.
        model = HistGradientBoostingClassifier(
            learning_rate=0.15,
            max_iter=150,
            max_leaf_nodes=31,
            class_weight="balanced",
            early_stopping=False,
            random_state=42,
        )
        model.fit(X, y)

    natural = np.array([s == "natural" for s in source_test])
    y_pred = model.predict(X_test)
    metrics = {
        "accuracy": round(float(accuracy_score(y_test[natural], y_pred[natural])), 4),
        "f1_macro": round(float(f1_score(y_test[natural], y_pred[natural], average="macro")), 4),
        "train_samples": len(X),
        "test_samples": int(natural.sum()),
        "num_classes": len(set(y.tolist())),
    }

    # Boosted trees expose no impurity importances; permutation importance
    # on a slice of the natural holdout answers the same question.
    sample = np.flatnonzero(natural)[:3000]
    perm = permutation_importance(model, X_test[sample], y_test[sample], n_repeats=3, random_state=42)
    importances = dict(zip(RECOMMEND_FEATURE_NAMES,
                           [round(float(x), 4) for x in perm.importances_mean]))

    joblib.dump(model, MODEL_DIR / "recommend_model.joblib")
    # FIX (1.2): Save the EXACT encoder instances from training — not re-fitted ones
    joblib.dump({"crop": crop_le, "region": region_le, "season": season_le},
                MODEL_DIR / "recommend_encoders.joblib")
    _save_holdout("recommend", X_test, y_test, source_test=source_test)

    return {"model": "crop_recommendation", "algorithm": "HistGradientBoostingClassifier",
            "metrics": metrics, "feature_importances": importances}


# ===================================================================
# Post-training smoke validation
# ===================================================================

_VALIDATION_CASES = [
    ("Punjab (Rabi - Wheat belt)", "punjab_ludhiana", "rabi"),
    ("Maharashtra (Kharif - Cotton zone)", "mh_nashik", "kharif"),
    ("Tamil Nadu (Kharif - Rice bowl)", "tn_thanjavur", "kharif"),
    ("UP (Rabi - Wheat/Mustard)", "up_lucknow", "rabi"),
    ("Gujarat (Kharif - Groundnut)", "guj_anand", "kharif"),
]


def write_validation_report() -> dict[str, Any]:
    """Run recommend_crops end to end against the freshly saved models.

    A smoke test, not an accuracy measure: it checks the served pipeline
    returns a sane top pick with the new artifacts loaded. It's rewritten on
    every training run -- the old validation_report.json was produced once by
    hand and then silently described models that no longer existed.
    """
    from ml import predict

    predict.invalidate_caches()
    cases = []
    for name, region_id, season in _VALIDATION_CASES:
        started = time.perf_counter()
        try:
            recs = predict.recommend_crops(region_id, season, 15000, 1.0, top_k=3)
            error = None
        except Exception as e:  # reported, not raised: one bad region shouldn't hide the rest
            recs, error = [], str(e)
        latency_ms = round((time.perf_counter() - started) * 1000)
        top = recs[0] if recs else None
        ok = bool(
            top
            and np.isfinite(top["smart_score"])
            and top["predicted_yield_kg_per_acre"] > 0
        )
        cases.append({
            "test": name,
            "region_id": region_id,
            "season": season,
            "status": "PASS" if ok else "FAIL",
            "top_crop": top["crop_name"] if top else None,
            "top_score": top["smart_score"] if top else None,
            "top_yield_kg_ac": top["predicted_yield_kg_per_acre"] if top else None,
            "top_profit_inr": top["expected_profit"] if top else None,
            "latency_ms": latency_ms,
            "ml_used": bool(top and top.get("prediction_source") == "ml_model"),
            **({"error": error} if error else {}),
        })

    passed = sum(c["status"] == "PASS" for c in cases)
    report = {
        "test_cases": cases,
        "all_pass": passed == len(cases),
        "passed": passed,
        "total": len(cases),
        "generated_at": time.time(),
    }
    with open(MODEL_DIR / "validation_report.json", "w") as f:
        json.dump(report, f, indent=2)
    return report


# ===================================================================
# Master training function
# ===================================================================

def _previous_disease_report() -> dict[str, Any] | None:
    try:
        with open(MODEL_DIR / "manifest.json") as f:
            models = json.load(f).get("models", [])
    except (OSError, ValueError):
        return None
    return next((m for m in models if m.get("model") == "crop_disease"), None)


def train_all(include_disease: bool = True) -> dict[str, Any]:
    """Train the 4 ML models (yield, price, recommendation, disease) and return a combined report.

    `include_disease=False` retrains only the tabular models and carries the
    disease classifier's existing manifest entry over unchanged (CLI:
    `python -m ml.train_models --skip-disease`).

    The disease classifier trains only if dataset/plantvillage/ has enough
    labeled images per class; otherwise it reports NOT_APPLICABLE and the
    live endpoint falls back to its HSV/texture heuristic — see
    ml/training/disease_cnn.py.
    """
    print("=" * 60)
    print("Training Yield Prediction Model...")
    yield_report = train_yield_model()
    ym = yield_report["metrics"]
    print(f"  {ym['test_year']} harvests: MAPE {ym['mape_pct']}%  MAE {ym['mae']}  "
          f"(crop base yield alone: MAPE {ym['baselines']['crop_base_yield']['mape_pct']}%)")

    print("Training Price Forecasting Model...")
    price_report = train_price_model()
    pm = price_report["metrics"]
    print(f"  From {pm['test_from']}: MAE {pm['mae']}  "
          f"(historical mean alone: MAE {pm['baselines']['historical_mean']['mae']})")

    print("Training Crop Recommendation Model...")
    rec_report = train_recommendation_model()
    print(f"  Accuracy = {rec_report['metrics']['accuracy']}  Macro F1 = {rec_report['metrics']['f1_macro']}")

    if not include_disease:
        print("Skipping Crop Disease Classifier (keeping the existing model and its report).")
        disease_report = _previous_disease_report() or {
            "model": "crop_disease", "status": "NOT_RETRAINED", "metrics": None,
        }
    else:
        disease_report = _train_disease_step()

    return _finish_training_run(yield_report, price_report, rec_report, disease_report)


def _train_disease_step() -> dict[str, Any]:
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
    return disease_report


def _finish_training_run(
    yield_report: dict[str, Any], price_report: dict[str, Any],
    rec_report: dict[str, Any], disease_report: dict[str, Any],
) -> dict[str, Any]:
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

    print("Running end-to-end smoke validation (validation_report.json)...")
    try:
        validation = write_validation_report()
        print(f"  {validation['passed']}/{validation['total']} cases passed.")
    except Exception as e:
        logger.warning("Smoke validation failed to run: %s", e)
        print(f"  Failed to write validation_report.json: {e}")

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
    import sys
    report = train_all(include_disease="--skip-disease" not in sys.argv)
    print(json.dumps(report, indent=2))
