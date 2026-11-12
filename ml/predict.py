from __future__ import annotations

# FIX (4.4): Removed unused `csv` import
import logging
import math
import threading
from datetime import datetime
from pathlib import Path
from statistics import mean, median
from typing import Any

import numpy as np
from PIL import Image

from utils.calculations import (
    CropParameter,
    calculate_climate_factor,
    calculate_risk_score_and_subscores,
    calculate_yield_kg_per_acre,
    clamp,
    compute_budget_fit,
    compute_roi_normalized,
    compute_smart_score,
    compute_soil_health,
)

# FIX (4.1): Added structured logging for ML fallback diagnostics
logger = logging.getLogger(__name__)


class _Unset:
    """Sentinel for optional arguments whose valid values include None."""


_UNSET = _Unset()

DATASET_DIR = Path(__file__).resolve().parents[1] / "dataset"
MODEL_DIR = Path(__file__).resolve().parent / "models"

# Module-level caches to avoid re-reading CSV on every function call
_cache_crop_params: dict[str, CropParameter] | None = None
_cache_yield_history: list[dict[str, str]] | None = None
_cache_weather: dict[tuple[str, str], dict[str, str]] | None = None
_cache_soil: dict[str, dict[str, str]] | None = None
_cache_mandi: list[dict[str, str]] | None = None

# ML model caches
_ml_yield_model = None
_ml_price_model = None
_ml_recommend_model = None
_ml_label_encoders = None
_ml_price_encoders = None
_ml_recommend_encoders = None
_ml_disease_session = None
_ml_disease_labels: list[str] | None = None

# Each model group tracks its own load state so a request deserialises only what
# it actually uses. This buys far more than the file sizes suggest: unpickling
# any scikit-learn estimator drags in sklearn itself, which costs ~1.5 s on a
# cold instance -- about 85% of the old 1.7 s cold start, and several times the
# ~200 ms the two forests spend deserialising. Leaf-disease detection is pure
# ONNX, so keeping its group separate is what lets that path skip the sklearn
# import altogether rather than merely loading fewer bytes.
_ml_yield_loaded = False
_ml_price_loaded = False
_ml_recommend_loaded = False
_ml_disease_loaded = False
# Set only once every group is resolved. Still honoured as a global
# short-circuit by each group loader, so forcing it True keeps its old meaning
# of "stop trying to load anything".
_ml_models_loaded = False

# Must match ml/training/disease_cnn.py's preprocessing exactly.
_DISEASE_IMAGE_SIZE = 224
_DISEASE_IMAGENET_MEAN = np.array([0.485, 0.456, 0.406], dtype=np.float32)
_DISEASE_IMAGENET_STD = np.array([0.229, 0.224, 0.225], dtype=np.float32)

# FIX (2.1): Thread-safe locks for model loading and cache writes.
# One lock per model group, not one shared lock: backend.main warms every group
# on a startup daemon thread, and on a 1-vCPU serverless box a shared lock would
# make a request for an already-resident group queue behind whichever unrelated
# group the warm-up happens to be deserialising.
_ml_yield_lock = threading.Lock()
_ml_price_lock = threading.Lock()
_ml_recommend_lock = threading.Lock()
_ml_disease_lock = threading.Lock()
_ML_LOAD_LOCKS = (_ml_yield_lock, _ml_price_lock, _ml_recommend_lock, _ml_disease_lock)
# The per-group locks above still let two groups unpickle at once -- the
# warm-up thread on the yield forest while a request pulls in the recommender.
# Both unpickles import scikit-learn's submodules, and two threads doing that
# concurrently trip CPython's import deadlock detector ("deadlock detected by
# _ModuleLock('sklearn.ensemble...')"). The loader caught that, marked yield as
# resolved with no model, and the process served heuristic yields -- which make
# soybean a loss and put jute on top in Sehore -- until it was restarted.
# This lock serialises only the joblib.load itself; a request for a group that
# is already resident returns on its flag check and never touches it.
_joblib_load_lock = threading.Lock()
_cache_lock = threading.Lock()


def _tune_forest(model):
    """Force a deserialised forest to predict on the calling thread.

    The forests were fitted with n_jobs=-1 and scikit-learn pickles that
    setting, so every serve-time predict() spun up a joblib worker pool --
    roughly 150 ms of pool setup to do microseconds of real tree traversal.
    """
    if model is not None and hasattr(model, "n_jobs"):
        model.n_jobs = 1
    return model


def _load_joblib(name: str):
    """Deserialise MODEL_DIR/name, or return None when the file is absent."""
    import joblib
    path = MODEL_DIR / name
    if not path.exists():
        return None
    with _joblib_load_lock:
        return joblib.load(path)


def _load_yield_models():
    """Load the yield regressor and its label encoders. No-op if absent."""
    global _ml_yield_model, _ml_label_encoders, _ml_yield_loaded
    if _ml_yield_loaded or _ml_models_loaded:
        return
    # FIX (2.1): Double-checked locking for thread safety
    with _ml_yield_lock:
        if _ml_yield_loaded or _ml_models_loaded:
            return
        try:
            _ml_yield_model = _tune_forest(_load_joblib("yield_model.joblib"))
            _ml_label_encoders = _load_joblib("label_encoders.joblib")
        except Exception as e:
            # FIX (4.1): Log the actual error instead of silently swallowing
            logger.warning("Failed to load yield model, falling back to heuristics: %s", e)
        _ml_yield_loaded = True


def _load_price_models():
    """Load the mandi-price regressor and its encoders. No-op if absent."""
    global _ml_price_model, _ml_price_encoders, _ml_price_loaded
    if _ml_price_loaded or _ml_models_loaded:
        return
    with _ml_price_lock:
        if _ml_price_loaded or _ml_models_loaded:
            return
        try:
            _ml_price_model = _tune_forest(_load_joblib("price_model.joblib"))
            _ml_price_encoders = _load_joblib("price_encoders.joblib")
        except Exception as e:
            logger.warning("Failed to load price model, falling back to heuristics: %s", e)
        _ml_price_loaded = True


def _load_recommend_models():
    """Load the crop-recommendation classifier and its encoders. No-op if absent.

    This is the expensive group -- 82 MB on disk and ~90 MB resident once
    unpickled -- so it stays behind its own flag rather than riding along with
    the yield model that the other endpoints actually want.
    """
    global _ml_recommend_model, _ml_recommend_encoders, _ml_recommend_loaded
    if _ml_recommend_loaded or _ml_models_loaded:
        return
    with _ml_recommend_lock:
        if _ml_recommend_loaded or _ml_models_loaded:
            return
        try:
            _ml_recommend_model = _tune_forest(_load_joblib("recommend_model.joblib"))
            _ml_recommend_encoders = _load_joblib("recommend_encoders.joblib")
        except Exception as e:
            logger.warning("Failed to load recommend model, falling back to heuristics: %s", e)
        _ml_recommend_loaded = True


def _load_disease_model():
    """Load the ONNX leaf-disease classifier and its label list. No-op if absent.

    Disease detection is a fine-tuned MobileNetV3-Small exported to ONNX and
    trained offline by ml/training/disease_cnn.py -- no joblib, and crucially no
    scikit-learn, which is why this group must never be folded back in with the
    forests above.
    """
    global _ml_disease_session, _ml_disease_labels, _ml_disease_loaded
    if _ml_disease_loaded or _ml_models_loaded:
        return
    with _ml_disease_lock:
        if _ml_disease_loaded or _ml_models_loaded:
            return
        try:
            onnx_path = MODEL_DIR / "disease_model.onnx"
            labels_path = MODEL_DIR / "disease_labels.json"
            if onnx_path.exists() and labels_path.exists():
                import json as _json
                import onnxruntime as _ort
                _ml_disease_session = _ort.InferenceSession(
                    str(onnx_path), providers=["CPUExecutionProvider"]
                )
                with open(labels_path) as f:
                    _ml_disease_labels = _json.load(f)
        except Exception as e:
            logger.warning("Failed to load disease model, falling back to heuristics: %s", e)
        _ml_disease_loaded = True


def _load_ml_models():
    """Load every model group.

    Kept for callers that genuinely need all of them, and for tests. Request
    paths should call the specific group loader instead -- see the comment on
    the load flags for why pulling in a group you do not need is expensive.
    """
    global _ml_models_loaded
    if _ml_models_loaded:
        return
    _load_yield_models()
    _load_price_models()
    _load_recommend_models()
    _load_disease_model()
    _ml_models_loaded = True


def _preprocess_leaf_image(image: Image.Image) -> np.ndarray:
    """Resize/normalize a leaf photo into the disease model's NCHW input layout.

    Must exactly match the eval-time transform in ml/training/disease_cnn.py
    (resize to 224x224, scale to [0,1], ImageNet mean/std normalize, CHW).
    """
    resized = image.convert("RGB").resize((_DISEASE_IMAGE_SIZE, _DISEASE_IMAGE_SIZE))
    arr = np.asarray(resized, dtype=np.float32) / 255.0  # HWC, [0, 1]
    arr = (arr - _DISEASE_IMAGENET_MEAN) / _DISEASE_IMAGENET_STD
    chw = np.transpose(arr, (2, 0, 1))  # CHW
    return chw[np.newaxis, ...].astype(np.float32)  # NCHW, batch=1


def predict_disease_ml(image: Image.Image, crop: str = "") -> tuple[str, float] | None:
    """Classify a leaf photo with the fine-tuned disease model, if loaded.

    Only `crop`'s classes are considered (mirrors the heuristic fallback's
    crop-bound behaviour). The API rejects crops the model doesn't cover
    before calling this, so an empty or unknown crop returns None rather than
    silently scoring some other crop's classes.

    Returns (class_name, confidence) or None if no exported model is present --
    callers must fall back to the heuristic decision tree in that case.
    """
    _load_disease_model()
    if _ml_disease_session is None or not _ml_disease_labels:
        return None

    x = _preprocess_leaf_image(image)
    (logits,) = _ml_disease_session.run(None, {"image": x})
    logits = logits[0]
    exp = np.exp(logits - np.max(logits))
    proba = exp / exp.sum()

    prefix = crop + "_"
    candidate_idxs = [i for i, c in enumerate(_ml_disease_labels) if c.startswith(prefix)]
    if not crop or not candidate_idxs:
        return None

    best_idx = max(candidate_idxs, key=lambda i: proba[i])
    return _ml_disease_labels[best_idx], float(proba[best_idx])


# FIX (2.2): Cache invalidation function for use after model retraining
def invalidate_caches():
    """Reset all module-level caches. Call after retraining models or updating CSVs."""
    global _cache_crop_params, _cache_yield_history, _cache_weather
    global _cache_soil, _cache_mandi
    global _ml_yield_model, _ml_price_model, _ml_recommend_model
    global _ml_label_encoders, _ml_price_encoders, _ml_recommend_encoders
    global _ml_disease_session, _ml_disease_labels
    global _ml_yield_loaded, _ml_price_loaded, _ml_recommend_loaded, _ml_disease_loaded
    global _ml_models_loaded
    with _cache_lock:
        _cache_crop_params = None
        _cache_yield_history = None
        _cache_weather = None
        _cache_soil = None
        _cache_mandi = None
    for _lock in _ML_LOAD_LOCKS:
        _lock.acquire()
    try:
        _ml_yield_model = None
        _ml_price_model = None
        _ml_recommend_model = None
        _ml_label_encoders = None
        _ml_price_encoders = None
        _ml_recommend_encoders = None
        _ml_disease_session = None
        _ml_disease_labels = None
        _ml_yield_loaded = False
        _ml_price_loaded = False
        _ml_recommend_loaded = False
        _ml_disease_loaded = False
        _ml_models_loaded = False
    finally:
        for _lock in reversed(_ML_LOAD_LOCKS):
            _lock.release()
    logger.info("All predict module caches invalidated.")


def _load_csv(file_name: str) -> list[dict[str, str]]:
    # FIX (3.5): Delegate exclusively to csv_cache — removed redundant import
    from utils.csv_cache import load as _cached_load
    return _cached_load(file_name)


def _load_crop_parameters() -> dict[str, CropParameter]:
    global _cache_crop_params
    if _cache_crop_params is not None:
        return _cache_crop_params
    # FIX (2.1): Thread-safe cache population via double-checked locking
    with _cache_lock:
        if _cache_crop_params is not None:
            return _cache_crop_params
        rows = _load_csv("crop_parameters.csv")
        data: dict[str, CropParameter] = {}
        for row in rows:
            crop_id = row["crop_id"]
            data[crop_id] = CropParameter(
                crop_id=crop_id,
                crop_name=row["crop_name"],
                season=row["season"].lower(),
                base_yield_kg_per_acre=float(row["base_yield_kg_per_acre"]),
                water_requirement_mm=float(row["water_requirement_mm"]),
                temp_min_c=float(row["temp_min_c"]),
                temp_max_c=float(row["temp_max_c"]),
                avg_input_cost_inr_per_acre=float(row["avg_input_cost_inr_per_acre"]),
                mandi_price_min_inr_per_kg=float(row["mandi_price_min_inr_per_kg"]),
                mandi_price_max_inr_per_kg=float(row["mandi_price_max_inr_per_kg"]),
                npk_n_kg_per_acre=float(row["npk_n_kg_per_acre"]),
                npk_p_kg_per_acre=float(row["npk_p_kg_per_acre"]),
                npk_k_kg_per_acre=float(row["npk_k_kg_per_acre"]),
            )
        _cache_crop_params = data
    return data


def _load_yield_history() -> list[dict[str, str]]:
    global _cache_yield_history
    if _cache_yield_history is not None:
        return _cache_yield_history
    # FIX (2.1): Thread-safe cache population
    with _cache_lock:
        if _cache_yield_history is not None:
            return _cache_yield_history
        _cache_yield_history = _load_csv("yield_history.csv")
    return _cache_yield_history


def _load_weather_by_region() -> dict[tuple[str, str], dict[str, str]]:
    """Returns the most recent year's weather data keyed by (region_id, season)."""
    global _cache_weather
    if _cache_weather is not None:
        return _cache_weather
    # FIX (2.1): Thread-safe cache population
    with _cache_lock:
        if _cache_weather is not None:
            return _cache_weather
        rows = _load_csv("weather.csv")
        data: dict[tuple[str, str], dict[str, str]] = {}
        for row in rows:
            key = (row["region_id"], row["season"])
            existing = data.get(key)
            if existing is None or int(row.get("year", 0)) >= int(existing.get("year", 0)):
                data[key] = row
        _cache_weather = data
    return data


def _load_soil_by_region() -> dict[str, dict[str, float | str]]:
    """Average numeric soil values when a region has multiple samples."""
    global _cache_soil
    if _cache_soil is not None:
        return _cache_soil
    # FIX (2.1): Thread-safe cache population
    with _cache_lock:
        if _cache_soil is not None:
            return _cache_soil
        rows = _load_csv("soil.csv")
        grouped: dict[str, list[dict[str, str]]] = {}
        for row in rows:
            grouped.setdefault(row["region_id"], []).append(row)
        numeric_keys = ["ph", "n_kg_per_acre", "p_kg_per_acre", "k_kg_per_acre", "organic_carbon_percent"]
        data: dict[str, dict[str, float | str]] = {}
        for region_id, group in grouped.items():
            merged: dict[str, float | str] = {"region_id": region_id, "soil_type": group[0]["soil_type"]}
            for k in numeric_keys:
                vals = [float(r[k]) for r in group if k in r]
                merged[k] = round(mean(vals), 2) if vals else 0.0
            data[region_id] = merged
        _cache_soil = data
    return data


def _load_mandi_prices() -> list[dict[str, str]]:
    global _cache_mandi
    if _cache_mandi is not None:
        return _cache_mandi
    # FIX (2.1): Thread-safe cache population
    with _cache_lock:
        if _cache_mandi is not None:
            return _cache_mandi
        _cache_mandi = _load_csv("mandi_prices.csv")
    return _cache_mandi


# FIX (5.4): Input validation helpers for numeric parameters
def _validate_non_negative(value: float, name: str) -> float:
    """Validate that a numeric input is a finite non-negative number."""
    if not isinstance(value, (int, float)):
        raise TypeError(f"{name} must be a number, got {type(value).__name__}")
    if math.isnan(value) or math.isinf(value):
        raise ValueError(f"{name} must be a finite number, got {value}")
    if value < 0:
        raise ValueError(f"{name} must be non-negative, got {value}")
    return float(value)


def _validate_unit_range(value: float, name: str) -> float:
    """Validate that a value is in [0.0, 1.0] range."""
    value = _validate_non_negative(value, name)
    if value > 1.0:
        raise ValueError(f"{name} must be between 0.0 and 1.0, got {value}")
    return value


def _season_match(input_season: str, crop_season: str) -> bool:
    c_s = crop_season.lower()
    i_s = input_season.lower()
    if "annual" in c_s or "perennial" in c_s or "all" in c_s or "any" in c_s:
        return True
    return i_s in c_s


#: Seasons a farmer actually picks in the UI when deciding what to sow now.
GROWING_SEASONS = ("kharif", "rabi", "zaid")

#: Seasons whose crops are grown on irrigation, not on the season's rain.
#: Zaid (March-June) gets 20-100 mm of rain in most districts, so scoring a
#: 400 mm watermelon against that rainfall called every zaid crop a climate
#: mismatch and capped moong at 6-16 kg/acre (defect N-3). The yield model has
#: almost no zaid training rows either, so zaid uses the heuristic with the
#: crop's water need assumed met by irrigation; the irrigation level still
#: scales the yield.
IRRIGATED_SEASONS = ("zaid",)


def normalise_season(season: str) -> str:
    """Lower-case and validate a season name; the error names the field."""
    s = str(season or "").strip().lower()
    known = {key[1] for key in _load_weather_by_region()}
    if s not in known:
        options = ", ".join(sorted(known))
        raise ValueError(f"season: '{season}' is not supported; use one of {options}")
    return s


def _require_known_region(region_id: str, weather_data: dict, soil_data: dict) -> None:
    if region_id not in soil_data or not any(k[0] == region_id for k in weather_data):
        raise ValueError(f"region_id: unknown region '{region_id}'")


def _is_perennial(crop_season: str) -> bool:
    return "perennial" in (crop_season or "").lower()


def _historical_yield_average(crop_id: str, region_id: str, history_rows: list[dict[str, str]]) -> float | None:
    region_crop = [
        float(row["yield_kg_per_acre"])
        for row in history_rows
        if row["crop_id"] == crop_id and row["region_id"] == region_id
    ]
    if region_crop:
        return mean(region_crop)

    crop_only = [float(row["yield_kg_per_acre"]) for row in history_rows if row["crop_id"] == crop_id]
    if crop_only:
        return mean(crop_only)
    return None


def _yield_feature_row(
    crop_code: float, region_code: float, season_code: float,
    cp: CropParameter, soil: dict, weather: dict, irrigation: float,
) -> list[float]:
    """One row in the yield model's 20-column feature layout.

    Shared by the single-crop and batched prediction paths below. Keeping the
    column order in exactly one place is the point: two copies would let the
    same crop get different predictions depending on which path the caller
    happened to take, and nothing would fail loudly when they drifted.
    """
    return [
        crop_code,
        region_code,
        season_code,
        cp.base_yield_kg_per_acre,
        cp.water_requirement_mm,
        cp.temp_min_c,
        cp.temp_max_c,
        cp.npk_n_kg_per_acre,
        cp.npk_p_kg_per_acre,
        cp.npk_k_kg_per_acre,
        float(soil.get("ph", 7.0)),
        float(soil.get("n_kg_per_acre", 40)),
        float(soil.get("p_kg_per_acre", 20)),
        float(soil.get("k_kg_per_acre", 20)),
        float(soil.get("organic_carbon_percent") if soil.get("organic_carbon_percent") is not None else soil.get("organic_carbon_pct", 0.5)),
        float(weather.get("rainfall_mm", 800)),
        float(weather.get("avg_temp_c", 28)),
        float(weather.get("min_temp_c", 20)),
        float(weather.get("max_temp_c", 35)),
        irrigation,
    ]


# A crop the formula scores this badly for the local climate, in a place with
# no recorded harvest of it, is capped at a token yield. This used to be taught
# to the yield model through synthetic "mismatch" training rows, but 145 of
# those rows contradicted real harvests (the formula can't see irrigation, so
# it calls e.g. Punjab rice a drought failure) and they dragged real-row MAPE
# from ~8% to ~20%. The model now trains on real rows only and the rule lives
# here, applied only where there is no real evidence to the contrary.
_CLIMATE_MISMATCH_THRESHOLD = 0.65
_CLIMATE_MISMATCH_YIELD_FRACTION = 0.1


def _yield_history_combos() -> set[tuple[str, str, str]]:
    """(crop_id, region_id, season) triples with at least one recorded harvest."""
    return {
        (r["crop_id"], r["region_id"], r.get("season", "").lower())
        for r in _load_yield_history()
    }


def _apply_climate_guard(
    pred: float, crop_id: str, region_id: str, season: str,
    cp: CropParameter, weather: dict, combos: set[tuple[str, str, str]],
) -> float:
    s = season.lower()
    if any((crop_id, region_id, k) in combos for k in (s, "annual", "perennial")):
        return pred
    climate_factor = calculate_climate_factor(
        {"rainfall_mm": float(weather.get("rainfall_mm", 800)),
         "avg_temp_c": float(weather.get("avg_temp_c", 28))},
        cp,
    )
    if climate_factor >= _CLIMATE_MISMATCH_THRESHOLD:
        return pred
    cap = cp.base_yield_kg_per_acre * climate_factor * _CLIMATE_MISMATCH_YIELD_FRACTION
    return min(pred, cap)


def _encoded_season(season: str) -> str:
    """Season label the encoder knows, defaulting to kharif for anything else."""
    s = season.lower()
    if s not in _ml_label_encoders["season"].classes_:
        return "kharif"
    return s


def _ml_predict_yield(
    crop_id: str, region_id: str, season: str,
    crop_params_dict: dict, soil: dict, weather: dict, irrigation: float,
) -> float | None:
    """Try ML model prediction; return None if model unavailable."""
    _load_yield_models()
    if _ml_yield_model is None or _ml_label_encoders is None:
        return None
    try:
        cp = crop_params_dict.get(crop_id)
        if cp is None:
            return None
        crop_le = _ml_label_encoders["crop"]
        region_le = _ml_label_encoders["region"]
        season_le = _ml_label_encoders["season"]
        # Safely encode — return None if unseen label
        if crop_id not in crop_le.classes_:
            return None
        if region_id not in region_le.classes_:
            return None
        features = np.array([_yield_feature_row(
            crop_le.transform([crop_id])[0],
            region_le.transform([region_id])[0],
            season_le.transform([_encoded_season(season)])[0],
            cp, soil, weather, irrigation,
        )], dtype=np.float32)
        pred = _ml_yield_model.predict(features)[0]
        pred = _apply_climate_guard(
            float(pred), crop_id, region_id, season, cp, weather, _yield_history_combos(),
        )
        return round(float(pred), 2)
    except Exception as e:
        # FIX (4.2): Log error instead of silently returning None
        logger.debug("ML yield prediction failed for %s/%s: %s", crop_id, region_id, e)
        return None


def _ml_predict_yield_batch(
    crop_ids: list[str], region_id: str, season: str,
    crop_params_dict: dict, soil: dict, weather: dict, irrigation: float,
) -> dict[str, float]:
    """Predict yield for many crops sharing one region/season in a single call.

    Returns {crop_id: yield}, omitting any crop the model can't answer for —
    an unknown crop label, a missing crop parameter row — so callers fall back
    to the heuristic for exactly the crops `_ml_predict_yield` would have
    returned None for.

    Ranking a region means predicting ~22 crops that differ only in their crop
    columns; the region, season, soil and weather columns are identical across
    all of them. Asking per crop made the forest pay scikit-learn's per-tree
    Python dispatch over all 200 trees once per crop, which measured ~189 ms
    against ~8 ms for the same rows submitted as one matrix. The arithmetic is
    unchanged — each row is still traversed independently by every tree — so
    this is purely the dispatch overhead going away.
    """
    _load_yield_models()
    if _ml_yield_model is None or _ml_label_encoders is None:
        return {}
    try:
        crop_le = _ml_label_encoders["crop"]
        region_le = _ml_label_encoders["region"]
        season_le = _ml_label_encoders["season"]
        if region_id not in region_le.classes_:
            return {}

        known_crops = set(crop_le.classes_)
        eligible = [
            c for c in crop_ids
            if c in known_crops and crop_params_dict.get(c) is not None
        ]
        if not eligible:
            return {}

        region_code = region_le.transform([region_id])[0]
        season_code = season_le.transform([_encoded_season(season)])[0]
        crop_codes = crop_le.transform(eligible)

        features = np.array([
            _yield_feature_row(
                crop_codes[i], region_code, season_code,
                crop_params_dict[crop_id], soil, weather, irrigation,
            )
            for i, crop_id in enumerate(eligible)
        ], dtype=np.float32)

        preds = _ml_yield_model.predict(features)
        combos = _yield_history_combos()
        return {
            c: round(_apply_climate_guard(
                float(preds[i]), c, region_id, season, crop_params_dict[c], weather, combos,
            ), 2)
            for i, c in enumerate(eligible)
        }
    except Exception as e:
        # Mirror the single-crop path: a failure here is not fatal, the caller
        # falls back to the heuristic formula for every crop.
        logger.debug("Batched ML yield prediction failed for %s: %s", region_id, e)
        return {}


def _predict_yield_with_source(
    crop_id: str,
    region_id: str,
    season: str,
    weather: dict[str, float],
    soil: dict[str, float],
    irrigation_level: float = 0.5,
    seed_variety: str | None = None,
    sowing_date: str | None = None,
    ml_pred: float | None | _Unset = _UNSET,
    force_heuristic: bool = False,
) -> tuple[float, bool]:
    """Return (yield_kg_per_acre, used_ml_model).

    `force_heuristic` skips the model. The season planner uses it for its
    rainfall and irrigation scenarios: the deployed yield model gives weather
    and irrigation importances below 0.003, so it cannot respond to them
    (defects N-1, N-2), while the deterministic climate and irrigation factors
    in utils/calculations.py do. Irrigated seasons (IRRIGATED_SEASONS) always
    take the heuristic, with the crop's water need treated as met.

    Callers that need to report provenance used to re-run `_ml_predict_yield`
    afterwards purely to find out whether the model had been used -- doubling
    the ML work for every crop in a ranking. Ask once, return both answers.

    `ml_pred` lets a caller that has already predicted this crop hand the answer
    in rather than have it predicted again. `recommend_crops` uses it to spend
    one batched forest call on the whole candidate set instead of one call per
    crop. Passing None means "the model had no answer for this crop", which is
    what `_ml_predict_yield` returns in the same situation, so the fallback
    below behaves identically either way. Leaving it unset predicts as before.
    """
    crop_params = _load_crop_parameters()
    # FIX (1.3): Raise clear ValueError instead of unhandled KeyError
    if crop_id not in crop_params:
        raise ValueError(f"Unsupported crop_id: {crop_id}")
    crop = crop_params[crop_id]
    if not _season_match(season, crop.season):
        return 0.0, False

    irrigated_season = season.lower() in IRRIGATED_SEASONS
    if irrigated_season:
        force_heuristic = True
        weather = {**weather, "water_supply_mm": crop.water_requirement_mm}
    if force_heuristic:
        ml_pred = None

    # Try ML model first
    if isinstance(ml_pred, _Unset):
        ml_pred = _ml_predict_yield(
            crop_id, region_id, season, crop_params, soil, weather, irrigation_level,
        )
    if ml_pred is not None and ml_pred > 0:
        return round(ml_pred, 2), True

    # Fallback: heuristic formula
    history_rows = _load_yield_history()
    historical = _historical_yield_average(crop_id, region_id, history_rows)

    calc_yield = calculate_yield_kg_per_acre(
        crop=crop,
        soil=soil,
        weather=weather,
        irrigation_level=irrigation_level,
        seed_variety=seed_variety,
        sowing_date=sowing_date,
    )

    if historical is not None:
        historical_baseline = crop.base_yield_kg_per_acre
        adjustment = historical / historical_baseline if historical_baseline else 1.0
        return round(calc_yield * adjustment, 2), False

    return calc_yield, False


def predict_yield_kg_per_acre(
    crop_id: str,
    region_id: str,
    season: str,
    weather: dict[str, float],
    soil: dict[str, float],
    irrigation_level: float = 0.5,
    seed_variety: str | None = None,
    sowing_date: str | None = None,
) -> float:
    return _predict_yield_with_source(
        crop_id, region_id, season, weather, soil,
        irrigation_level, seed_variety, sowing_date,
    )[0]


def smart_risk_score(
    crop_id: str,
    weather: dict[str, float],
    soil: dict[str, float],
    budget_per_acre: float,
    irrigation_level: float = 0.5,
) -> dict[str, float]:
    # FIX (5.4): Validate numeric inputs
    budget_per_acre = _validate_non_negative(budget_per_acre, "budget_per_acre")
    irrigation_level = _validate_unit_range(irrigation_level, "irrigation_level")

    crop_params = _load_crop_parameters()
    # FIX (1.3): Consistent error handling for unknown crop_id
    if crop_id not in crop_params:
        raise ValueError(f"Unsupported crop_id: {crop_id}")
    crop = crop_params[crop_id]
    
    risk_score, risk_subscores = calculate_risk_score_and_subscores(
        crop=crop,
        weather=weather,
        soil=soil,
        irrigation_level=irrigation_level,
    )
    
    # Budget risk is specific to ML predictor's smart_risk_score
    budget_risk = clamp((crop.avg_input_cost_inr_per_acre - budget_per_acre) / max(crop.avg_input_cost_inr_per_acre, 1.0) * 100.0, 0.0, 100.0)
    
    # Re-calculate total risk including budget risk
    # We'll give budget risk a 15% weight as before, and scale others
    total_risk = (risk_score * 0.85) + (budget_risk * 0.15)
    
    confidence_score = 100.0 - total_risk
    
    return {
        "risk_score": round(total_risk, 2),
        "confidence_score": round(clamp(confidence_score, 0.0, 100.0), 2),
        "drought_risk": risk_subscores["drought"],
        "heat_risk": risk_subscores["heat"],
        "flood_risk": risk_subscores["flood"],
        "price_volatility_risk": risk_subscores["price_volatility"],
        "budget_risk": round(budget_risk, 2),
    }


# Share of a crop's typical input cost that goes into establishing it at all --
# seed or planting material, land preparation and sowing -- before any spend on
# nutrition, protection or irrigation. Roughly a third of paid-out cost for most
# field crops, and more for crops planted from costly material (turmeric's seed
# rhizome alone runs to a third or more of its input cost), so this is a
# conservative floor.
_ESTABLISHMENT_COST_SHARE = 0.35

#: Most a farmer is assumed to spend per acre, as a multiple of the crop's
#: typical input cost; budget above it is reported as unspent, not as cost.
SPEND_HEADROOM = 1.15


def _budget_coverage(budget_per_acre: float, avg_input_cost_inr_per_acre: float) -> float:
    """Fraction of the crop's typical input cost the budget covers, capped at 1."""
    if avg_input_cost_inr_per_acre <= 0:
        return 1.0
    return clamp(budget_per_acre / avg_input_cost_inr_per_acre, 0.0, 1.0)


def _budget_yield_multiplier(budget_per_acre: float, avg_input_cost_inr_per_acre: float) -> float:
    """Estimate what fraction of the fully-funded predicted yield a given budget can
    realistically achieve.

    `predicted_yield_kg_per_acre` always represents the yield a crop would reach with
    adequate seed, fertilizer, irrigation, and labour spend (the crop's
    `avg_input_cost_inr_per_acre`). A budget far below that cannot buy the same
    inputs, so it cannot realistically produce the same yield -- treating the full
    yield as achievable on a token budget is what previously let a ₹10/acre budget
    show 700%+ ROI (near-zero cost divided into a full-size, budget-independent
    revenue).

    A budget that can't cover `_ESTABLISHMENT_COST_SHARE` of the crop's input
    cost can't establish the crop, so it yields nothing; above that floor,
    yield rises linearly to the full prediction at full funding. Since cost is
    the farmer's budget, ROI works out to
    ``(full revenue / full cost) * (c - s) / ((1 - s) * c) - 1`` for coverage
    ``c`` and floor ``s``: it rises with the budget, never exceeds full-funding
    ROI, and is a total loss at or below the floor.

    This replaces a coverage**2 curve, whose ROI was
    ``(full revenue / full cost) * c - 1``. That never reaches a loss for a
    crop with a large full-funding margin: turmeric at 22% of its ₹68,000/acre
    input cost showed +130% ROI and ranked first for Medak kharif on a
    ₹15,000/acre budget that doesn't cover its seed rhizome. Between ~45% and
    full coverage the two curves are within a few points of each other (0.32
    vs 0.31 at 56%), so adequately and moderately funded crops barely move.
    """
    coverage = _budget_coverage(budget_per_acre, avg_input_cost_inr_per_acre)
    share = _ESTABLISHMENT_COST_SHARE
    return round(clamp((coverage - share) / (1.0 - share), 0.0, 1.0), 6)


def typical_budget_per_acre(region_id: str, season: str, crop_id: str | None = None) -> float:
    """Default input budget per acre: what the crop typically costs to grow.

    With a crop, its typical input cost. Without one, the median typical cost
    of the seasonal crops that can be sown in this season. The old flat
    Rs 15,000/acre default sat below rice (Rs 27,000) and cotton (Rs 32,000),
    so default rankings scored the major crops underfunded (defect N-7).
    `region_id` is validated so a bad region fails here, not later.
    """
    crop_params = _load_crop_parameters()
    season = normalise_season(season)
    _require_known_region(region_id, _load_weather_by_region(), _load_soil_by_region())
    if crop_id:
        if crop_id not in crop_params:
            raise ValueError(f"crop_id: unknown crop '{crop_id}'")
        return float(crop_params[crop_id].avg_input_cost_inr_per_acre)
    costs = [
        c.avg_input_cost_inr_per_acre for c in crop_params.values()
        if _season_match(season, c.season) and not _is_perennial(c.season)
        and c.avg_input_cost_inr_per_acre > 0
    ]
    if not costs:
        raise ValueError(f"season: no seasonal crops for '{season}'")
    return float(median(costs))


def profit_estimator(
    crop_id: str,
    predicted_yield_kg_per_acre: float,
    area_acres: float,
    budget_per_acre: float,
    mandi_price_per_kg: float | None = None,
    cap_spend: bool = True,
) -> dict[str, float]:
    """Yield, revenue, cost and profit for a crop on a given budget.

    `cap_spend=False` counts the whole budget as cost, the behaviour before
    the spend cap. Only ml/dataset_builders.py uses it, so the recommendation
    classifier's training labels stay what the deployed model was trained on
    until Phase 2 retires that classifier.
    """
    # FIX (5.4): Validate numeric inputs
    predicted_yield_kg_per_acre = _validate_non_negative(predicted_yield_kg_per_acre, "predicted_yield_kg_per_acre")
    area_acres = _validate_non_negative(area_acres, "area_acres")
    budget_per_acre = _validate_non_negative(budget_per_acre, "budget_per_acre")

    crop_params = _load_crop_parameters()
    # FIX (1.3): Consistent error handling for unknown crop_id
    if crop_id not in crop_params:
        raise ValueError(f"Unsupported crop_id: {crop_id}")
    crop = crop_params[crop_id]
    price = mandi_price_per_kg or ((crop.mandi_price_min_inr_per_kg + crop.mandi_price_max_inr_per_kg) / 2.0)

    yield_multiplier = _budget_yield_multiplier(budget_per_acre, crop.avg_input_cost_inr_per_acre)
    achievable_yield_kg_per_acre = round(predicted_yield_kg_per_acre * yield_multiplier, 2)
    total_yield = achievable_yield_kg_per_acre * area_acres
    # A farmer does not pour a ₹1,00,000/acre budget into a ₹32,000/acre crop.
    # Spend is capped a little above the crop's typical input cost and the
    # rest is reported as unspent -- counting it all as cost showed cotton at
    # -₹1,77,491 on a large budget (defect N-7).
    spend_per_acre = budget_per_acre
    if cap_spend and crop.avg_input_cost_inr_per_acre > 0:
        spend_per_acre = min(budget_per_acre, crop.avg_input_cost_inr_per_acre * SPEND_HEADROOM)
    total_cost = spend_per_acre * area_acres
    unspent_budget = (budget_per_acre - spend_per_acre) * area_acres
    expected_revenue = total_yield * price
    expected_profit = expected_revenue - total_cost
    # Return on the farmer's whole budget, not on the part a crop spends:
    # every crop is compared on the same capital, and money left unspent
    # earns 0%. Dividing by spend alone inflated cheap crops' ROI as soon as
    # the budget exceeded their cost (mustard, ragi and urad crowded rice and
    # wheat out of the top three).
    budget_total = budget_per_acre * area_acres
    roi_percent = (expected_profit / budget_total * 100.0) if budget_total else 0.0

    optimistic_profit = (total_yield * 1.1 * price * 1.08) - total_cost
    pessimistic_profit = (total_yield * 0.88 * price * 0.9) - total_cost

    return {
        "achievable_yield_kg_per_acre": achievable_yield_kg_per_acre,
        "budget_coverage": round(_budget_coverage(budget_per_acre, crop.avg_input_cost_inr_per_acre), 4),
        "budget_yield_multiplier": yield_multiplier,
        "expected_revenue": round(expected_revenue, 2),
        "expected_profit": round(expected_profit, 2),
        "roi_percent": round(roi_percent, 2),
        "optimistic_profit": round(optimistic_profit, 2),
        "pessimistic_profit": round(pessimistic_profit, 2),
        "spent_cost": round(total_cost, 2),
        "unspent_budget": round(unspent_budget, 2),
        # max(total_yield, 1.0) avoids the div-by-zero *and* the misleading "you
        # break even at Rs 0/kg" that a zero-yield ternary would report when an
        # underfunded budget scales achievable yield down to ~0 -- mirrors
        # engine/simulator.py's break_even_price calculation.
        "break_even_price_per_kg": round(total_cost / max(total_yield, 1.0), 2),
    }


def mandi_price_analytics(region_id: str, crop_id: str) -> dict[str, Any]:
    """Compute price statistics, trend, volatility, and seasonal pattern for a crop in a region."""
    rows = _load_mandi_prices()
    prices = [
        {"date": r["date"], "price": float(r["price_inr_per_kg"]), "market": r.get("market_name", "")}
        for r in rows
        if r["region_id"] == region_id and r["crop_id"] == crop_id
    ]
    if not prices:
        raise ValueError(f"No mandi price data for {crop_id} in {region_id}")

    prices = sorted(prices, key=lambda x: x["date"])
    price_vals = [p["price"] for p in prices]
    n = len(price_vals)

    avg_price = mean(price_vals)
    std_dev = (sum((p - avg_price) ** 2 for p in price_vals) / max(n - 1, 1)) ** 0.5
    coeff_of_variation = (std_dev / avg_price * 100) if avg_price else 0.0

    # 3-month moving average
    ma3 = []
    for i in range(n):
        window = price_vals[max(0, i - 2):i + 1]
        ma3.append(round(mean(window), 2))

    # Trend direction: linear slope of last 6 prices
    recent = price_vals[-min(6, n):]
    if len(recent) >= 2:
        x_mean = (len(recent) - 1) / 2.0
        y_mean = mean(recent)
        num = sum((i - x_mean) * (y - y_mean) for i, y in enumerate(recent))
        den = sum((i - x_mean) ** 2 for i in range(len(recent)))
        slope = num / den if den else 0.0
        if slope > 0.3:
            trend = "rising"
        elif slope < -0.3:
            trend = "falling"
        else:
            trend = "stable"
    else:
        slope = 0.0
        trend = "insufficient_data"

    # Seasonal pattern: avg price by month
    monthly: dict[int, list[float]] = {}
    for p in prices:
        try:
            month = int(p["date"].split("-")[1])
            monthly.setdefault(month, []).append(p["price"])
        except (ValueError, IndexError):
            pass
    seasonal_pattern = {m: round(mean(v), 2) for m, v in sorted(monthly.items())}
    best_month = max(seasonal_pattern, key=seasonal_pattern.get) if seasonal_pattern else None
    worst_month = min(seasonal_pattern, key=seasonal_pattern.get) if seasonal_pattern else None

    return {
        "region_id": region_id,
        "crop_id": crop_id,
        "data_points": n,
        "current_price": price_vals[-1],
        "avg_price": round(avg_price, 2),
        "min_price": round(min(price_vals), 2),
        "max_price": round(max(price_vals), 2),
        "std_deviation": round(std_dev, 2),
        "volatility_pct": round(coeff_of_variation, 2),
        "trend_direction": trend,
        "trend_slope": round(slope, 3),
        "moving_avg_3m": ma3,
        "seasonal_pattern": seasonal_pattern,
        "best_selling_month": best_month,
        "worst_selling_month": worst_month,
        "price_timeline": [{"date": p["date"], "price": p["price"]} for p in prices],
    }


def rotation_planner(
    region_id: str,
    budget_per_acre: float,
    area_acres: float,
) -> dict[str, Any]:
    """Plan a kharif→rabi annual rotation maximizing combined profit & minimizing risk."""
    # FIX (5.4): Validate inputs
    budget_per_acre = _validate_non_negative(budget_per_acre, "budget_per_acre")
    area_acres = _validate_non_negative(area_acres, "area_acres")

    try:
        kharif_recs = recommend_crops(region_id, "kharif", budget_per_acre, area_acres, top_k=5)
    except ValueError:
        kharif_recs = []
    
    try:
        rabi_recs = recommend_crops(region_id, "rabi", budget_per_acre, area_acres, top_k=5)
    except ValueError:
        rabi_recs = []
    if not kharif_recs and not rabi_recs:
        raise ValueError(f"No crop recommendations available for {region_id}")

    # Score all kharif×rabi combos
    combos: list[dict[str, Any]] = []
    for k in (kharif_recs or [{"crop_id": None, "expected_profit": 0, "risk_score": 50, "smart_score": 0}]):
        for r in (rabi_recs or [{"crop_id": None, "expected_profit": 0, "risk_score": 50, "smart_score": 0}]):
            if k["crop_id"] is None and r["crop_id"] is None:
                continue
            annual_profit = (k.get("expected_profit", 0) or 0) + (r.get("expected_profit", 0) or 0)
            avg_risk = ((k.get("risk_score", 50) or 50) + (r.get("risk_score", 50) or 50)) / 2.0
            diversity_bonus = 5.0 if k.get("crop_id") != r.get("crop_id") else 0.0
            combo_score = ((k.get("smart_score", 0) or 0) + (r.get("smart_score", 0) or 0)) / 2.0 + diversity_bonus
            combos.append({
                "kharif_crop": k.get("crop_id"),
                "kharif_profit": k.get("expected_profit", 0),
                "kharif_risk": k.get("risk_score", 0),
                "rabi_crop": r.get("crop_id"),
                "rabi_profit": r.get("expected_profit", 0),
                "rabi_risk": r.get("risk_score", 0),
                "annual_profit": round(annual_profit, 2),
                "avg_risk_score": round(avg_risk, 2),
                "rotation_score": round(combo_score, 2),
            })

    ranked = sorted(combos, key=lambda x: x["rotation_score"], reverse=True)
    return {
        "region_id": region_id,
        "budget_per_acre": budget_per_acre,
        "area_acres": area_acres,
        "best_rotation": ranked[0] if ranked else None,
        "top_rotations": ranked[:5],
        "kharif_options": kharif_recs,
        "rabi_options": rabi_recs,
    }


def location_based_insights(region_id: str, season: str = "kharif") -> dict[str, Any]:
    weather_data = _load_weather_by_region()
    soil_data = _load_soil_by_region()
    mandi_rows = _load_mandi_prices()

    season = normalise_season(season)
    _require_known_region(region_id, weather_data, soil_data)
    weather_key = (region_id, season)
    if weather_key not in weather_data:
        raise ValueError(f"season: no {season} weather data for region_id '{region_id}'")

    weather = weather_data[weather_key]
    soil = soil_data[region_id]
    # One row per crop, its latest month -- ranking every monthly row listed
    # the same crop several times (defect N-19).
    latest_by_crop: dict[str, dict[str, str]] = {}
    for row in mandi_rows:
        if row["region_id"] != region_id:
            continue
        seen = latest_by_crop.get(row["crop_id"])
        if seen is None or row.get("date", "") >= seen.get("date", ""):
            latest_by_crop[row["crop_id"]] = row
    top_price_rows = sorted(
        latest_by_crop.values(), key=lambda x: float(x["price_inr_per_kg"]), reverse=True,
    )[:3]

    rainfall = float(weather["rainfall_mm"])
    rain_band = "high rainfall" if rainfall >= 800 else ("moderate rainfall" if rainfall >= 450 else "low rainfall")

    return {
        "region_id": region_id,
        "season": weather["season"],
        "rainfall_mm": rainfall,
        "avg_temp_c": float(weather["avg_temp_c"]),
        "soil_type": soil["soil_type"],
        "soil_ph": float(soil["ph"]),
        "rainfall_trend_hint": f"This region is currently in a {rain_band} band.",
        "best_priced_local_crops": [
            {"crop_id": row["crop_id"], "price_inr_per_kg": float(row["price_inr_per_kg"]),
             "price_as_of": row.get("date")}
            for row in top_price_rows
        ],
    }


def _ml_recommend_crop(
    region_id: str, season: str, soil: dict, weather: dict,
    budget: float, irrigation: float,
) -> list[dict[str, float]] | None:
    """Use ML classifier to get ranked crop probabilities. Returns None if unavailable."""
    _load_recommend_models()
    if _ml_recommend_model is None or _ml_recommend_encoders is None:
        return None
    try:
        region_le = _ml_recommend_encoders["region"]
        season_le = _ml_recommend_encoders["season"]
        crop_le = _ml_recommend_encoders["crop"]
        if region_id not in region_le.classes_:
            return None
        s = season.lower()
        if s not in season_le.classes_:
            s = "kharif"
        features = np.array([[
            region_le.transform([region_id])[0],
            season_le.transform([s])[0],
            float(soil.get("ph", 7.0)),
            float(soil.get("n_kg_per_acre", 40)),
            float(soil.get("p_kg_per_acre", 20)),
            float(soil.get("k_kg_per_acre", 20)),
            float(soil.get("organic_carbon_percent") if soil.get("organic_carbon_percent") is not None else soil.get("organic_carbon_pct", 0.5)),
            float(weather.get("rainfall_mm", 800)),
            float(weather.get("avg_temp_c", 28)),
            float(weather.get("min_temp_c", float(weather.get("avg_temp_c", 28)) - 8)),
            float(weather.get("max_temp_c", float(weather.get("avg_temp_c", 28)) + 7)),
            budget,
            irrigation,
        ]], dtype=np.float32)
        probas = _ml_recommend_model.predict_proba(features)[0]
        classes = _ml_recommend_model.classes_
        result = []
        for idx, prob in zip(classes, probas):
            crop_name = crop_le.inverse_transform([idx])[0]
            result.append({"crop_id": crop_name, "ml_confidence": round(float(prob), 4)})
        result.sort(key=lambda x: x["ml_confidence"], reverse=True)
        return result
    except Exception as e:
        # FIX (4.2): Log error instead of silently returning None
        logger.debug("ML crop recommendation failed for %s/%s: %s", region_id, season, e)
        return None


def price_feature_row(
    crop_code: float, region_code: float, month: int, history: list[float],
) -> tuple[list[float], float]:
    """One row in the price model's feature layout, plus the anchor it's scaled by.

    Every price feature is divided by the series' own historical mean, and the
    model predicts next month's price as a multiple of that same mean. Measured
    on a time-ordered split, the historical mean on its own beat the old
    absolute-price model; anchoring to it keeps the model from ever doing worse
    than that baseline by drifting off the series' level. Shared by training
    (ml/train_models.py) and serving so the two can't disagree on the layout.
    """
    anchor = float(np.mean(history))
    recent = history[-3:]
    scale = anchor if anchor > 0 else 1.0
    row = [
        crop_code, region_code, month,
        history[-1] / scale, history[-2] / scale, history[-3] / scale,
        float(np.mean(recent)) / scale,
        float(np.std(recent)) / scale,
        (max(history) - min(history)) / scale,
    ]
    return row, scale


def _ml_predict_price(
    region_id: str, crop_id: str, recent_prices: list[float], target_month: int, target_year: int,
) -> float | None:
    """Use ML model to predict a single future price point. Returns None if unavailable.

    `target_year` is unused: with two years of history a year feature only
    lets the model extrapolate a trend it has seen once.
    """
    _load_price_models()
    if _ml_price_model is None or _ml_price_encoders is None:
        return None
    try:
        crop_le = _ml_price_encoders["crop"]
        region_le = _ml_price_encoders["region"]
        if crop_id not in crop_le.classes_ or region_id not in region_le.classes_:
            return None
        if len(recent_prices) < 3:
            return None
        row, scale = price_feature_row(
            crop_le.transform([crop_id])[0],
            region_le.transform([region_id])[0],
            target_month,
            [float(p) for p in recent_prices],
        )
        pred = _ml_price_model.predict(np.array([row], dtype=np.float32))[0] * scale
        return round(float(max(pred, 0.5)), 2)
    except Exception as e:
        # FIX (4.2): Log error instead of silently returning None
        logger.debug("ML price prediction failed for %s/%s: %s", crop_id, region_id, e)
        return None


# FIX (3.2): Extracted region data preparation into its own function
def _prepare_region_data(
    region_id: str, season: str,
) -> tuple[dict[str, float], dict[str, float]]:
    """Load and prepare weather and soil data for a region/season pair.

    Returns (weather_dict, soil_dict) with float values ready for ML features.
    Raises ValueError if region or season is unsupported.
    """
    weather_data = _load_weather_by_region()
    soil_data = _load_soil_by_region()

    season = normalise_season(season)
    _require_known_region(region_id, weather_data, soil_data)
    weather_key = (region_id, season)
    if weather_key not in weather_data:
        raise ValueError(f"season: no {season} weather data for region_id '{region_id}'")

    raw_weather = weather_data[weather_key]
    raw_soil = soil_data[region_id]

    weather = {
        "rainfall_mm": float(raw_weather["rainfall_mm"]),
        "avg_temp_c": float(raw_weather["avg_temp_c"]),
        "min_temp_c": float(raw_weather.get("min_temp_c", float(raw_weather["avg_temp_c"]) - 8)),
        "max_temp_c": float(raw_weather.get("max_temp_c", float(raw_weather["avg_temp_c"]) + 7)),
    }
    soil = {
        "ph": float(raw_soil["ph"]),
        "n_kg_per_acre": float(raw_soil["n_kg_per_acre"]),
        "p_kg_per_acre": float(raw_soil["p_kg_per_acre"]),
        "k_kg_per_acre": float(raw_soil["k_kg_per_acre"]),
        "organic_carbon_percent": float(raw_soil.get("organic_carbon_percent", 0.5)),
    }
    return weather, soil


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
    committed_by_crop: dict[str, float] = {}
    # A single malformed/truncated row (e.g. from a crash mid-write) must
    # not raise and take down /api/recommend for every region -- skip just
    # that row and keep processing the rest.
    for r in _read_commitments():
        try:
            if (
                r["region_id"] == region_id
                and r["season"].lower() == season_lower
                and r["year"] == str(year)
            ):
                committed_by_crop[r["crop_id"]] = (
                    committed_by_crop.get(r["crop_id"], 0.0) + float(r["area_acres"])
                )
        except (KeyError, TypeError, ValueError):
            continue

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
        # Only show a label once the rounded percentage is meaningful -- at
        # realistic single-farmer commitment scale against a district-wide
        # historical baseline, round(ratio * 100) is frequently 0 even when
        # ratio is technically nonzero, which would render an uninformative
        # "0% ... already committed" badge. The ratio itself is still
        # returned unchanged for scoring purposes; only label display is
        # gated on this rounding threshold.
        if round(ratio * 100) >= 1:
            crop_name = crop_params[crop_id].crop_name
            label = f"{round(ratio * 100)}% of typical {crop_name} acreage already committed this season"
        saturation[crop_id] = {"ratio": ratio, "label": label}
    return saturation


# FIX (3.2): Extracted per-crop scoring into its own function
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
    """Score a single crop candidate for the recommendation engine.

    Returns a dict containing yield, profit, risk, smart_score, and metadata.

    `ml_yield` is this crop's share of a batched prediction, when the caller
    made one; see `_predict_yield_with_source`.
    """
    # FIX (H-11): `prediction_source` used to reflect whether the ML model
    # *object* was loaded at all, not whether ML was actually used for this
    # specific crop/region/season call (the yield path silently falls back to
    # the heuristic formula per-call, e.g. for unseen crop/region labels). The
    # single call below reports which path it actually took; it used to be
    # followed by a second, identical `_ml_predict_yield` probe whose only
    # purpose was answering that question.
    predicted_yield, used_ml_for_yield = _predict_yield_with_source(
        crop_id, region_id, season, weather, soil, ml_pred=ml_yield,
    )
    risk = smart_risk_score(crop_id, weather, soil, budget_per_acre)
    price = region_crop_price.get(
        crop_id, (crop.mandi_price_min_inr_per_kg + crop.mandi_price_max_inr_per_kg) / 2.0
    )
    profit = profit_estimator(
        crop_id=crop_id,
        predicted_yield_kg_per_acre=predicted_yield,
        area_acres=area_acres,
        budget_per_acre=budget_per_acre,
        mandi_price_per_kg=price,
    )

    budget_fit = compute_budget_fit(budget_per_acre, crop.avg_input_cost_inr_per_acre)
    roi_normalized = compute_roi_normalized(profit["roi_percent"])
    soil_health = compute_soil_health(
        soil.get("n_kg_per_acre", 40.0),
        soil.get("p_kg_per_acre", 20.0),
        soil.get("k_kg_per_acre", 20.0),
        crop.npk_n_kg_per_acre,
        crop.npk_p_kg_per_acre,
        crop.npk_k_kg_per_acre,
    )

    # The recommendation classifier's confidence is reported on the result
    # (ml_confidence) but no longer moves the ranking. Its training labels are
    # the argmax of this same compute_smart_score, with ml_term set to
    # roi_normalized (ml/dataset_builders.py) -- so the best it can do is
    # agree with the formula, never add to it (see the "Approach C" note in
    # docs/superpowers/specs/2026-09-06-ml-model-accuracy-design.md). What it
    # did add was distortion: trained on widened synthetic weather with the
    # district as a feature, it voted for one crop per district at ~100%
    # confidence and 0% for everything else, and that vote was worth a flat
    # 15 points. It put jute -- grown in Bengal and Tripura, not central
    # India -- first for kharif in 12 of 30 districts even after the risk
    # score stopped favouring it, and bajra (Rs 16,536 profit) over pulses
    # (Rs 118,986) in Pune. Using the label's own term here makes the live
    # ranking exactly the definition the classifier is trained to learn.
    ml_term = roi_normalized

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

    smart_score = compute_smart_score(
        roi_normalized=roi_normalized,
        confidence_score=risk["confidence_score"],
        budget_fit=budget_fit,
        soil_health=soil_health,
        ml_term=ml_term,
        saturation_penalty=saturation_penalty,
    )

    # compute_roi_normalized() floors every negative ROI to the same value
    # (0), so a crop losing 90% of the investment scored identically on this
    # term to one losing 5% -- letting soil/budget/ML terms alone decide the
    # live ranking among money-losing crops, and occasionally putting a
    # crop that loses money ahead of one turning a healthy profit (the
    # jute-over-turmeric case this fixes). That floor can't be changed in
    # compute_roi_normalized itself: ml/dataset_builders.py's synthetic
    # training-label formula shares it (see
    # test_score_single_crop_and_recommendation_dataset_derive_identical_values)
    # and actually depends on the floor to keep thin-margin staples like
    # rice/wheat competitive against high-variance cash crops in the
    # training data (see
    # test_build_recommendation_dataset_staples_are_recommendable) --
    # widening it there drops rice/wheat to zero training-label wins.
    # Apply the loss penalty only here, after the shared score, so live
    # ranking gets it without touching training-label generation at all.
    if profit["roi_percent"] < 0:
        loss_normalized = max(profit["roi_percent"] / 3.0, -100.0)  # symmetric with roi_normalized's own +100 ceiling
        smart_score = clamp(smart_score + 0.35 * loss_normalized, 0.0, 100.0)

    budget_adequate = profit["budget_coverage"] >= 1.0
    coverage_pct = round(profit["budget_coverage"] * 100)
    if budget_adequate:
        reason = "Ranked using ML models + location, soil, season fit, budget fit, profit, and risk confidence."
    elif profit["budget_yield_multiplier"] <= 0:
        reason = (
            f"Budget covers only {coverage_pct}% of this crop's typical input cost -- not enough to "
            "establish it (seed or planting material, land preparation, sowing) -- so no harvest is "
            "counted and the budget is shown as a loss."
        )
    else:
        reason = (
            f"Budget covers only {coverage_pct}% of this crop's typical input cost, so yield and ROI "
            "below are scaled down to what's realistically achievable, not the full-funding potential."
        )
    rec_entry = {
        "crop_id": crop_id,
        "crop_name": crop.crop_name,
        # Achievable yield/profit/ROI already account for whether budget_per_acre
        # can actually buy the inputs this crop needs; potential_yield_kg_per_acre
        # is what full, adequate funding (avg_input_cost_inr_per_acre) would reach.
        "predicted_yield_kg_per_acre": profit["achievable_yield_kg_per_acre"],
        "potential_yield_kg_per_acre": predicted_yield,
        "expected_profit": profit["expected_profit"],
        "planned_cost": profit["spent_cost"],
        "unspent_budget": profit["unspent_budget"],
        "price_per_kg": price,
        "water_requirement_mm": crop.water_requirement_mm,
        "roi_percent": profit["roi_percent"],
        "risk_score": risk["risk_score"],
        "smart_score": round(smart_score, 2),
        "saturation_ratio": saturation_ratio,
        "saturation_label": saturation_label,
        "prediction_source": "ml_model" if used_ml_for_yield else "heuristic",
        "crop_cycle": "perennial" if _is_perennial(crop.season) else "seasonal",
        "budget_adequate": budget_adequate,
        "budget_coverage": profit["budget_coverage"],
        "reason": reason,
    }
    if crop_id in ml_conf_map:
        rec_entry["ml_confidence"] = ml_conf_map[crop_id]
    return rec_entry


def rank_recommendations(recs: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Profitable crops first, then by smart_score.

    smart_score blends ROI with risk/soil/budget/ML fit, and _score_single_crop's
    loss penalty scales with ROI -- so a crop with a small expected loss could
    still outscore a clearly profitable one (jute at -Rs 2,540 above groundnut
    at +Rs 52,973 for Medak kharif). A farmer asking what to sow should never
    see a money-losing crop ranked above one that makes money; the score only
    orders crops *within* the profitable tier. Money-losing crops follow in
    order of smallest loss: ordering them by score put jowar at -Rs 58,794
    above rice at -Rs 4,152 for Bardhaman kharif (defect N-4). The sort is
    stable.
    """
    profitable = [r for r in recs if r["expected_profit"] > 0]
    losing = [r for r in recs if r["expected_profit"] <= 0]
    profitable.sort(key=lambda r: r["smart_score"], reverse=True)
    losing.sort(key=lambda r: r["expected_profit"], reverse=True)
    return profitable + losing


def _all_lose_reason(recs: list[dict[str, Any]], season: str) -> str:
    if recs and all(not r.get("budget_adequate", True) for r in recs):
        return "budget_too_low"
    if season.lower() in IRRIGATED_SEASONS:
        return "season_needs_irrigation"
    return "no_profitable_crop"


def apply_loss_guard(ranked: list[dict[str, Any]], season: str) -> list[dict[str, Any]]:
    """What a farmer is shown: never a money-losing crop beside one that pays.

    If at least one crop is expected to make money, the losers are dropped --
    a short list beats one padded with losses. If none does, the losses are
    kept (least loss first) and every row is flagged `all_options_lose` with a
    `loss_reason`, so the screen says so plainly instead of calling them top
    crops (defect N-3).
    """
    profitable = [r for r in ranked if r["expected_profit"] > 0]
    if profitable:
        return profitable
    reason = _all_lose_reason(ranked, season)
    for r in ranked:
        r["all_options_lose"] = True
        r["loss_reason"] = reason
    return ranked


def recommend_crops(
    region_id: str,
    season: str,
    budget_per_acre: float,
    area_acres: float,
    top_k: int = 3,
    include_losses: bool = False,
) -> list[dict[str, Any]]:
    """Recommend top-k crops for a region/season, ranked by composite smart_score.

    By default money-losing crops are left out whenever a profitable one
    exists (see `apply_loss_guard`). Internal callers that need every
    candidate scored -- the crop-mix optimiser, comparison tables -- pass
    `include_losses=True`.

    FIX (3.2): Decomposed into _prepare_region_data() and _score_single_crop()
    for testability and single-responsibility adherence.
    """
    season = normalise_season(season)
    # FIX (5.4): Validate inputs
    budget_per_acre = _validate_non_negative(budget_per_acre, "budget_per_acre")
    area_acres = _validate_non_negative(area_acres, "area_acres")

    crop_params = _load_crop_parameters()

    # FIX (3.2): Extracted data preparation into reusable function
    weather, soil = _prepare_region_data(region_id, season)

    from utils.csv_cache import index_by as _cached_index_by
    region_rows = _cached_index_by("mandi_prices.csv", "region_id").get(region_id, [])
    region_crop_price: dict[str, float] = {}
    for row in region_rows:
        region_crop_price[row["crop_id"]] = float(row["price_inr_per_kg"])

    # Get ML confidence scores if available
    ml_conf = _ml_recommend_crop(region_id, season, soil, weather, budget_per_acre, 0.5)
    ml_conf_map: dict[str, float] = {}
    if ml_conf:
        ml_conf_map = {item["crop_id"]: item["ml_confidence"] for item in ml_conf}

    # "Which crop for this kharif?" is a question about a crop that will be
    # sown and harvested inside that season. Perennials match every season (a
    # cashew or mango orchard has no kharif/rabi), so they used to be ranked
    # head-to-head with annuals on a single season's economics -- booking a
    # bearing orchard's revenue against one season's input cost. Cashew (Rs
    # 800-1100/kg) consequently won almost every ranking with a ~290% "ROI"
    # that no first-year planting can deliver: the trees take 3-5 years to
    # fruit. They stay fully simulable on request (predict_yield_kg_per_acre
    # and /api/simulate are unchanged) and still rank when the caller asks for
    # a non-seasonal horizon -- they are just no longer the answer to a
    # question about this season.
    seasonal_request = season.lower() in GROWING_SEASONS

    candidates = [
        (crop_id, crop)
        for crop_id, crop in crop_params.items()
        if _season_match(season, crop.season)
        and not (seasonal_request and _is_perennial(crop.season))
    ]

    region_saturation = _compute_region_saturation(
        region_id, season, [crop_id for crop_id, _ in candidates], crop_params,
    )

    # Every candidate shares this region's soil, weather and season, so their
    # yields come out of one batched forest call rather than one call each --
    # the difference between ~190 ms and ~8 ms of model time per request.
    # Crops the model has no answer for are simply absent from the map, and
    # `_score_single_crop` falls back to the heuristic for those.
    batched_yields = _ml_predict_yield_batch(
        [crop_id for crop_id, _ in candidates],
        region_id, season, crop_params, soil, weather, 0.5,
    )

    # Crops with recorded harvests in this district (yield_history.csv). A
    # top pick nobody nearby grows -- jute in Guntur -- can be the formula's
    # honest answer on profit, but the farmer should know there are no
    # neighbours, seed dealers or buyers with experience of it.
    grown_here = {
        row["crop_id"] for row in _cached_index_by("yield_history.csv", "region_id").get(region_id, [])
    }

    recommendations: list[dict[str, Any]] = []
    for crop_id, crop in candidates:
        # FIX (3.2): Extracted per-crop scoring into reusable function
        rec_entry = _score_single_crop(
            crop_id, crop, weather, soil,
            region_id, season,
            budget_per_acre, area_acres,
            region_crop_price, ml_conf_map, region_saturation,
            ml_yield=batched_yields.get(crop_id),
        )
        rec_entry["grown_locally"] = crop_id in grown_here
        recommendations.append(rec_entry)

    ranked = rank_recommendations(recommendations)
    if not include_losses:
        ranked = apply_loss_guard(ranked, season)
    return ranked[:top_k]
