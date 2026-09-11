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

from ml.dataset_builders import _build_yield_dataset, _build_recommendation_dataset

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

        X, y, source, crop_le, region_le, season_le = _build_yield_dataset()
        logger.info(f"Loaded regressor dataset with shape: {X.shape}")

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
