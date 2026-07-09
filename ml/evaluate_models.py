import os
import csv
import json
import logging
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

# Try importing XGBoost
try:
    from xgboost import XGBClassifier, XGBRegressor
    XGBOOST_AVAILABLE = True
except Exception:
    XGBOOST_AVAILABLE = False

# Try importing CatBoost
try:
    from catboost import CatBoostClassifier, CatBoostRegressor
    CATBOOST_AVAILABLE = True
except Exception:
    CATBOOST_AVAILABLE = False

# Try importing LightGBM
try:
    from lightgbm import LGBMClassifier, LGBMRegressor
    LIGHTGBM_AVAILABLE = True
except Exception:
    LIGHTGBM_AVAILABLE = False

warnings.filterwarnings("ignore")
logger = logging.getLogger("ModelEvaluation")
logging.basicConfig(level=logging.INFO, format="%(asctime)s - %(levelname)s - %(message)s")

# Paths
BASE_DIR = Path(__file__).resolve().parents[1]
DATASET_DIR = BASE_DIR / "dataset"
MODEL_DIR = BASE_DIR / "ml" / "models"
MODEL_DIR.mkdir(parents=True, exist_ok=True)

# ---------------------------------------------------------------------------
# CSV Helper
# ---------------------------------------------------------------------------
def _load_csv(name: str) -> list[dict[str, str]]:
    path = DATASET_DIR / name
    if not path.exists():
        return []
    with path.open("r", newline="", encoding="utf-8") as f:
        return list(csv.DictReader(f))

def _fit_label_encoders(crops: list[str], regions: list[str], seasons: list[str]):
    crop_le = LabelEncoder().fit(sorted(set(crops)))
    region_le = LabelEncoder().fit(sorted(set(regions)))
    season_le = LabelEncoder().fit(sorted(set(seasons)))
    return crop_le, region_le, season_le

# ===================================================================
# 1. YIELD PREDICTION DATA BUILDER (20 Features Schema)
# ===================================================================
def _build_yield_dataset() -> tuple[np.ndarray, np.ndarray, LabelEncoder, LabelEncoder, LabelEncoder]:
    yield_hist = _load_csv("yield_history.csv")
    crop_params = {r["crop_id"]: r for r in _load_csv("crop_parameters.csv")}
    soil_data = {r["region_id"]: r for r in _load_csv("soil.csv")}
    weather_data = {(r["region_id"], r["season"].lower()): r for r in _load_csv("weather.csv")}

    all_crops = sorted(crop_params.keys())
    all_regions = sorted(soil_data.keys())
    
    # Extract unique seasons dynamically to handle variants (perenn, annual, etc.)
    seasons_set = {"kharif", "rabi", "annual", "perennial", "perenn"}
    for row in yield_hist:
        if row.get("season"):
            seasons_set.add(row["season"].lower().strip())
    all_seasons = sorted(list(seasons_set))

    crop_le, region_le, season_le = _fit_label_encoders(all_crops, all_regions, all_seasons)
    rows_X, rows_y = [], []

    def safe(d, k, default=0.0):
        try:
            return float(d.get(k, default))
        except (ValueError, TypeError):
            return default

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

        features = [
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
            0.5, # Default irrigation proxy
        ]
        rows_X.append(features)
        rows_y.append(yld)

    # Apply data augmentation to expand representation
    rng = np.random.RandomState(42)
    aug_X, aug_y = [], []
    for i in range(len(rows_X)):
        for _ in range(6):
            noise = rng.uniform(0.90, 1.10, size=len(rows_X[i]))
            noised = np.array(rows_X[i]) * noise
            noised[:3] = rows_X[i][:3]  # Preserve encoders
            aug_X.append(noised.tolist())
            aug_y.append(rows_y[i] * rng.uniform(0.92, 1.08))
    rows_X.extend(aug_X)
    rows_y.extend(aug_y)

    return np.array(rows_X, dtype=np.float32), np.array(rows_y, dtype=np.float32), crop_le, region_le, season_le

# ===================================================================
# 2. CROP RECOMMENDATION DATA BUILDER (13 Features Schema)
# ===================================================================
def _build_recommendation_dataset() -> tuple[np.ndarray, np.ndarray, LabelEncoder, LabelEncoder, LabelEncoder]:
    crop_params_list = _load_csv("crop_parameters.csv")
    crop_params = {r["crop_id"]: r for r in crop_params_list}
    soil_data = {r["region_id"]: r for r in _load_csv("soil.csv")}
    weather_data = {(r["region_id"], r["season"].lower()): r for r in _load_csv("weather.csv")}
    mandi_rows = _load_csv("mandi_prices.csv")

    mandi_latest = {}
    for r in sorted(mandi_rows, key=lambda x: x["date"]):
        mandi_latest[(r["region_id"], r["crop_id"])] = float(r["price_inr_per_kg"])

    all_crops = sorted(crop_params.keys())
    all_regions = sorted(soil_data.keys())
    all_seasons = ["kharif", "rabi"]

    crop_le, region_le, season_le = _fit_label_encoders(all_crops, all_regions, all_seasons + ["annual", "perennial", "perenn"])

    def sf(d, k, default=0.0):
        try:
            return float(d.get(k, default))
        except (ValueError, TypeError):
            return default

    X_all, y_all = [], []
    ph_variants = [5.8, 6.8, 7.8]
    rain_variants = [500, 950]
    temp_variants = [24, 30]

    for rid in all_regions:
        base_soil = soil_data[rid]
        for season in all_seasons:
            wkey = (rid, season)
            base_weather = weather_data.get(wkey, {})

            for budget in [12000, 24000]:
                for irr in [0.2, 0.7]:
                    for ph in ph_variants:
                        for rain in rain_variants:
                            for temp in temp_variants:
                                best_crop = None
                                best_score = -1e9
                                for cid, cp in crop_params.items():
                                    crop_season = cp["season"].lower()
                                    if season not in crop_season and "annual" not in crop_season:
                                        continue

                                    base_yield = float(cp["base_yield_kg_per_acre"])
                                    cost = float(cp["avg_input_cost_inr_per_acre"])
                                    price = mandi_latest.get(
                                        (rid, cid),
                                        (float(cp["mandi_price_min_inr_per_kg"]) + float(cp["mandi_price_max_inr_per_kg"])) / 2
                                    )
                                    water_req = float(cp["water_requirement_mm"])
                                    temp_min = float(cp["temp_min_c"])
                                    temp_max = float(cp["temp_max_c"])
                                    n_req = float(cp["npk_n_kg_per_acre"])

                                    budget_fit = 1.0 if budget >= cost else budget / cost * 0.5
                                    water_supply = rain + irr * water_req
                                    water_fit = min(water_supply / max(water_req, 1), 1.3)
                                    water_fit = max(water_fit, 0.3)

                                    if temp_min <= temp <= temp_max:
                                        temp_fit = 1.0
                                    elif temp < temp_min:
                                        temp_fit = max(0.3, 1.0 - (temp_min - temp) / 10)
                                    else:
                                        temp_fit = max(0.3, 1.0 - (temp - temp_max) / 10)

                                    ph_fit = max(0.4, 1.0 - abs(ph - 6.8) / 3)
                                    if cid in ("rice",) and ph < 6.5:
                                        ph_fit *= 0.7
                                    if cid in ("pulses", "groundnut") and ph > 7.5:
                                        ph_fit *= 0.8

                                    soil_n = sf(base_soil, "n_kg_per_acre", 40) * (ph / 7.0)
                                    n_fit = min(soil_n / max(n_req, 1), 1.2)

                                    yield_est = base_yield * water_fit * temp_fit * ph_fit * n_fit * (0.6 + 0.5 * irr)
                                    profit = (yield_est * price - cost) * budget_fit
                                    
                                    if profit > best_score:
                                        best_score = profit
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
                                    temp - 8,
                                    temp + 7,
                                    budget,
                                    irr,
                                ]
                                X_all.append(features)
                                y_all.append(crop_le.transform([best_crop])[0])

    # Apply data augmentation
    rng = np.random.RandomState(42)
    base_len = len(X_all)
    for i in range(base_len):
        noised = np.array(X_all[i])
        noised[2:11] *= rng.uniform(0.92, 1.08, size=9)
        noised[11] *= rng.uniform(0.9, 1.1)
        noised[12] = np.clip(noised[12] + rng.uniform(-0.1, 0.1), 0.05, 1.0)
        X_all.append(noised.tolist())
        y_all.append(y_all[i])

    return np.array(X_all, dtype=np.float32), np.array(y_all, dtype=np.int32), crop_le, region_le, season_le

# ===================================================================
# 3. COMPREHENSIVE PIPELINE EXECUTION
# ===================================================================
class ModelEvaluationPipeline:
    def __init__(self):
        logger.info(f"ML Libraries Available -> RandomForest: True | CatBoost: {CATBOOST_AVAILABLE} | XGBoost: {XGBOOST_AVAILABLE} | LightGBM: {LIGHTGBM_AVAILABLE}")

    def evaluate_crop_recommendation(self):
        logger.info("=========================================")
        logger.info("Evaluating CROP RECOMMENDATION Classifiers")
        logger.info("=========================================")
        
        X, y, crop_le, region_le, season_le = _build_recommendation_dataset()
        logger.info(f"Loaded classifier dataset with shape: {X.shape}")
        
        # Save encoders
        joblib.dump({"crop": crop_le, "region": region_le, "season": season_le}, MODEL_DIR / "recommend_encoders.joblib")
        # Save label encoders for legacy loading compat
        joblib.dump({"crop": crop_le, "region": region_le, "season": season_le}, MODEL_DIR / "label_encoders.joblib")
        
        X_train, X_test, y_train, y_test = train_test_split(
            X, y, test_size=0.2, random_state=42, stratify=y
        )
        
        models = {
            "RandomForest": RandomForestClassifier(random_state=42, n_jobs=-1)
        }
        if XGBOOST_AVAILABLE:
            models["XGBoost"] = XGBClassifier(random_state=42, eval_metric="mlogloss", n_jobs=-1)
        if CATBOOST_AVAILABLE:
            models["CatBoost"] = CatBoostClassifier(random_state=42, verbose=0)
        if LIGHTGBM_AVAILABLE:
            models["LightGBM"] = LGBMClassifier(random_state=42, verbosity=-1, n_jobs=-1)
            
        results = {}
        best_acc = -1
        best_model_name = ""
        best_model = None
        
        cv = StratifiedKFold(n_splits=5, shuffle=True, random_state=42)
        
        for name, clf in models.items():
            logger.info(f"Training {name} Classifier...")
            cv_accs = []
            for train_idx, val_idx in cv.split(X_train, y_train):
                X_tr, X_val = X_train[train_idx], X_train[val_idx]
                y_tr, y_val = y_train[train_idx], y_train[val_idx]
                clf.fit(X_tr, y_tr)
                cv_accs.append(accuracy_score(y_val, clf.predict(X_val)))
                
            clf.fit(X_train, y_train)
            test_acc = accuracy_score(y_test, clf.predict(X_test))
            test_f1 = f1_score(y_test, clf.predict(X_test), average="macro")
            
            results[name] = {
                "cv_accuracy": round(float(np.mean(cv_accs)), 4),
                "test_accuracy": round(float(test_acc), 4),
                "test_f1_macro": round(float(test_f1), 4)
            }
            logger.info(f"  {name} - CV Acc: {results[name]['cv_accuracy']:.4f} | Test Acc: {results[name]['test_accuracy']:.4f}")
            
            if test_acc > best_acc:
                best_acc = test_acc
                best_model_name = name
                best_model = clf
                
        logger.info(f"Winning Classifier: {best_model_name}")
        
        # Hyperparameter tuning
        if best_model_name == "RandomForest":
            param_grid = {
                "n_estimators": [100, 200],
                "max_depth": [6, 10],
                "min_samples_split": [2, 5]
            }
        else:
            param_grid = {
                "n_estimators": [100, 200],
                "max_depth": [4, 6, 8],
                "learning_rate": [0.03, 0.1]
            }
        search = RandomizedSearchCV(best_model, param_grid, n_iter=3, cv=3, random_state=42, n_jobs=-1)
        search.fit(X_train, y_train)
        tuned_clf = search.best_estimator_
        
        joblib.dump(tuned_clf, MODEL_DIR / "recommend_model.joblib")
        
        feature_names = [
            "region_enc", "season_enc", "soil_ph", "soil_n", "soil_p", "soil_k", "soil_oc",
            "rainfall", "avg_temp", "min_temp", "max_temp", "budget", "irrigation"
        ]
        importances = {}
        if hasattr(tuned_clf, "feature_importances_"):
            importances = dict(zip(feature_names, [round(float(w), 4) for w in tuned_clf.feature_importances_]))
            importances = dict(sorted(importances.items(), key=lambda x: x[1], reverse=True))
            
        return best_model_name, results, importances

    def evaluate_yield_prediction(self):
        logger.info("=========================================")
        logger.info("Evaluating CROP YIELD PREDICTION Regressors")
        logger.info("=========================================")
        
        X, y, crop_le, region_le, season_le = _build_yield_dataset()
        logger.info(f"Loaded regressor dataset with shape: {X.shape}")
        
        # Save encoders
        joblib.dump({"crop": crop_le, "region": region_le, "season": season_le}, MODEL_DIR / "yield_encoders.joblib")
        
        X_train, X_test, y_train, y_test = train_test_split(
            X, y, test_size=0.2, random_state=42
        )
        
        models = {
            "RandomForest": RandomForestRegressor(random_state=42, n_jobs=-1)
        }
        if XGBOOST_AVAILABLE:
            models["XGBoost"] = XGBRegressor(random_state=42, n_jobs=-1)
        if CATBOOST_AVAILABLE:
            models["CatBoost"] = CatBoostRegressor(random_state=42, verbose=0)
        if LIGHTGBM_AVAILABLE:
            models["LightGBM"] = LGBMRegressor(random_state=42, verbosity=-1, n_jobs=-1)
            
        results = {}
        best_r2 = -1e9
        best_model_name = ""
        best_model = None
        
        cv = KFold(n_splits=5, shuffle=True, random_state=42)
        
        for name, reg in models.items():
            logger.info(f"Training {name} Regressor...")
            cv_r2s = []
            for train_idx, val_idx in cv.split(X_train, y_train):
                X_tr, X_val = X_train[train_idx], X_train[val_idx]
                y_tr, y_val = y_train[train_idx], y_train[val_idx]
                reg.fit(X_tr, y_tr)
                cv_r2s.append(r2_score(y_val, reg.predict(X_val)))
                
            reg.fit(X_train, y_train)
            pred = reg.predict(X_test)
            test_r2 = r2_score(y_test, pred)
            test_rmse = np.sqrt(mean_squared_error(y_test, pred))
            test_mae = mean_absolute_error(y_test, pred)
            
            results[name] = {
                "cv_r2": round(float(np.mean(cv_r2s)), 4),
                "test_r2": round(float(test_r2), 4),
                "test_rmse": round(float(test_rmse), 2),
                "test_mae": round(float(test_mae), 2)
            }
            logger.info(f"  {name} - CV R2: {results[name]['cv_r2']:.4f} | Test R2: {results[name]['test_r2']:.4f}")
            
            if test_r2 > best_r2:
                best_r2 = test_r2
                best_model_name = name
                best_model = reg
                
        logger.info(f"Winning Regressor: {best_model_name}")
        
        # Hyperparameter tuning
        if best_model_name == "RandomForest":
            param_grid = {
                "n_estimators": [100, 200, 300],
                "max_depth": [6, 12],
                "min_samples_split": [2, 5]
            }
        else:
            param_grid = {
                "n_estimators": [100, 200, 300],
                "max_depth": [4, 6, 8],
                "learning_rate": [0.03, 0.1]
            }
        search = RandomizedSearchCV(best_model, param_grid, n_iter=3, cv=3, random_state=42, n_jobs=-1)
        search.fit(X_train, y_train)
        tuned_reg = search.best_estimator_
        
        joblib.dump(tuned_reg, MODEL_DIR / "yield_model.joblib")
        
        feature_names = [
            "crop_enc", "region_enc", "season_enc", "base_yield", "water_req", "temp_min", "temp_max",
            "npk_n", "npk_p", "npk_k", "soil_ph", "soil_n", "soil_p", "soil_k", "soil_oc",
            "rainfall", "avg_temp", "min_temp", "max_temp", "irrigation"
        ]
        importances = {}
        if hasattr(tuned_reg, "feature_importances_"):
            importances = dict(zip(feature_names, [round(float(w), 4) for w in tuned_reg.feature_importances_]))
            importances = dict(sorted(importances.items(), key=lambda x: x[1], reverse=True))
            
        return best_model_name, results, importances

    def run_pipeline(self):
        rec_winner, rec_results, rec_importances = self.evaluate_crop_recommendation()
        yield_winner, yield_results, yield_importances = self.evaluate_yield_prediction()
        
        manifest = {
            "crop_recommendation": {
                "winning_algorithm": rec_winner,
                "benchmarks": rec_results,
                "top_features": rec_importances
            },
            "yield_prediction": {
                "winning_algorithm": yield_winner,
                "benchmarks": yield_results,
                "top_features": yield_importances
            }
        }
        
        manifest_file = MODEL_DIR / "evaluation_manifest.json"
        with open(manifest_file, "w", encoding="utf-8") as f:
            json.dump(manifest, f, indent=2)
            
        logger.info(f"Evaluation Manifest exported to {manifest_file}")

if __name__ == "__main__":
    pipeline = ModelEvaluationPipeline()
    pipeline.run_pipeline()
