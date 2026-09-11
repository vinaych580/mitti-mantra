import os
import json
import logging
import time
from pathlib import Path
import joblib
import numpy as np
import pandas as pd

from sklearn.model_selection import train_test_split
from sklearn.preprocessing import LabelEncoder
from sklearn.metrics import accuracy_score, precision_recall_fscore_support, confusion_matrix, r2_score, mean_absolute_error, mean_squared_error
from sklearn.inspection import permutation_importance

logger = logging.getLogger("ModelAudit")
logging.basicConfig(level=logging.INFO, format="%(asctime)s - %(levelname)s - %(message)s")

BASE_DIR = Path(__file__).resolve().parents[1]
MODEL_DIR = BASE_DIR / "ml" / "models"

# Import the shared data loaders from their source module directly, not via
# ml.evaluate_models' re-export: the extra hop is the exact shape of bug that
# caused a real regression earlier (a re-export's target changed shape and a
# downstream unpack broke), and importing ml.evaluate_models would also apply
# its module-scope warnings.filterwarnings("ignore") / logging.basicConfig()
# process-wide as a side effect of importing this audit module.
from ml.dataset_builders import _build_recommendation_dataset, _build_yield_dataset

class ModelAuditor:
    # FIX (C-3): ml/evaluate_models.py's and ml/train_models.py's dataset
    # builders both consume np.random.RandomState(42) in the same row
    # order, so reconstructing a "test split" here with the same seed
    # mostly reproduces the deployed model's *training* rows (measured at
    # 83.6% row-hash overlap) -- this audit was silently grading models on
    # data they'd already seen. Whichever pipeline last trained/saved a
    # model now also persists the exact held-out rows it evaluated itself
    # on (ml/models/holdout_<name>.joblib); prefer those genuinely-unseen
    # rows here instead of rebuilding+resplitting the dataset.
    @staticmethod
    def _load_holdout(name: str):
        holdout_path = MODEL_DIR / f"holdout_{name}.joblib"
        if not holdout_path.exists():
            return None
        data = joblib.load(holdout_path)
        return data.get("X_test"), data.get("y_test"), data.get("source_test")

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

    def run_audit(self):
        logger.info("Initializing model audit on corrected schemas...")

        # Load models
        rec_model_path = MODEL_DIR / "recommend_model.joblib"
        yield_model_path = MODEL_DIR / "yield_model.joblib"
        if not rec_model_path.exists() or not yield_model_path.exists():
            logger.error("Model files missing. Please run model training/evaluation first.")
            return

        rec_model = joblib.load(rec_model_path)
        yield_model = joblib.load(yield_model_path)
        rec_encoders = joblib.load(MODEL_DIR / "recommend_encoders.joblib")

        # 1. Auditing Crop Recommendation
        X_rec, y_rec, crop_le_rec, region_le_rec, season_le_rec = _build_recommendation_dataset()

        # Calculate feature correlations (Pearson) with target
        # For multi-class target, we compute average absolute correlation across unique labels
        correlations = {}
        feature_names_rec = [
            "region_enc", "season_enc", "soil_ph", "soil_n", "soil_p", "soil_k", "soil_oc",
            "rainfall", "avg_temp", "min_temp", "max_temp", "budget", "irrigation"
        ]
        for idx, col in enumerate(feature_names_rec):
            corr = np.corrcoef(X_rec[:, idx], y_rec)[0, 1]
            correlations[col] = round(float(corr) if not np.isnan(corr) else 0.0, 4)

        rec_holdout = self._load_holdout("recommend")
        if rec_holdout is not None:
            X_test_rec, y_test_rec, _rec_source_unused = rec_holdout
            logger.info("Using persisted genuinely-unseen holdout for crop_recommendation audit (n=%d)", len(X_test_rec))
        else:
            logger.warning(
                "No holdout_recommend.joblib found -- falling back to a freshly split "
                "dataset, which may overlap with the deployed model's training rows. "
                "Re-run training via ml/train_models.py or ml/evaluate_models.py to "
                "generate a proper holdout set."
            )
            _, X_test_rec, _, y_test_rec = train_test_split(
                X_rec, y_rec, test_size=0.2, random_state=42, stratify=y_rec
            )

        pred_rec = rec_model.predict(X_test_rec)
        acc_rec = accuracy_score(y_test_rec, pred_rec)
        prec, rec, f1, _ = precision_recall_fscore_support(y_test_rec, pred_rec, average="macro")

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

        pi_rec = permutation_importance(rec_model, X_test_rec, y_test_rec, n_repeats=5, random_state=42)
        pi_rec_importances = dict(zip(feature_names_rec, [round(float(w), 4) for w in pi_rec.importances_mean]))
        pi_rec_importances = dict(sorted(pi_rec_importances.items(), key=lambda x: x[1], reverse=True))
        
        # 2. Auditing Yield Prediction
        X_yield, y_yield, _source_unused, crop_le_y, region_le_y, season_le_y = _build_yield_dataset()

        yield_holdout = self._load_holdout("yield")
        source_test_y = None
        if yield_holdout is not None:
            X_test_y, y_test_y, source_test_y = yield_holdout
            logger.info("Using persisted genuinely-unseen holdout for yield_prediction audit (n=%d)", len(X_test_y))
        else:
            logger.warning(
                "No holdout_yield.joblib found -- falling back to a freshly split "
                "dataset, which may overlap with the deployed model's training rows. "
                "Re-run training via ml/train_models.py or ml/evaluate_models.py to "
                "generate a proper holdout set."
            )
            _, X_test_y, _, y_test_y = train_test_split(
                X_yield, y_yield, test_size=0.2, random_state=42
            )

        pred_yield = yield_model.predict(X_test_y)
        r2 = r2_score(y_test_y, pred_yield)
        mae = mean_absolute_error(y_test_y, pred_yield)
        rmse = np.sqrt(mean_squared_error(y_test_y, pred_yield))
        mape_real, mape_full = self._split_yield_mape(y_test_y, pred_yield, source_test_y)
        
        feature_names_yield = [
            "crop_enc", "region_enc", "season_enc", "base_yield", "water_req", "temp_min", "temp_max",
            "npk_n", "npk_p", "npk_k", "soil_ph", "soil_n", "soil_p", "soil_k", "soil_oc",
            "rainfall", "avg_temp", "min_temp", "max_temp", "irrigation"
        ]
        
        pi_yield = permutation_importance(yield_model, X_test_y, y_test_y, n_repeats=5, random_state=42)
        pi_yield_importances = dict(zip(feature_names_yield, [round(float(w), 4) for w in pi_yield.importances_mean]))
        pi_yield_importances = dict(sorted(pi_yield_importances.items(), key=lambda x: x[1], reverse=True))
        
        # 3. Robustness test (sensor failure / missing weather)
        X_test_noisy = X_test_rec.copy()
        # Set rainfall (col 7) and temp indices (cols 8, 9, 10) to 0.0
        X_test_noisy[:, [7, 8, 9, 10]] = 0.0
        noisy_pred_rec = rec_model.predict(X_test_noisy)
        noisy_acc_rec = accuracy_score(y_test_rec, noisy_pred_rec)
        
        # Robustness test for Yield Regressor (severe drought / zero rainfall)
        X_test_drought = X_test_y.copy()
        X_test_drought[:, 15] = 0.0  # Zero rainfall
        drought_pred = yield_model.predict(X_test_drought)
        drought_r2 = r2_score(y_test_y, drought_pred)
        
        # 4. Save audit metrics
        audit_output = {
            "crop_recommendation": {
                "algorithm": type(rec_model).__name__,
                "accuracy": round(float(acc_rec), 4),
                "f1_macro": round(float(f1), 4),
                "per_class_f1": per_class_f1_named,
                "zero_f1_crops": zero_f1_crops,
                "correlations": correlations,
                "permutation_importances": pi_rec_importances,
                "robustness_noisy_weather_accuracy": round(float(noisy_acc_rec), 4),
                # FIX (C-3): flag whether this audit ran on the genuinely
                # unseen holdout persisted at training time, or fell back to
                # a reconstructed (potentially overlapping) split.
                "evaluated_on_persisted_holdout": rec_holdout is not None,
            },
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
            "audited_at": time.time(),
        }

        output_path = MODEL_DIR / "audit_metrics.json"
        with open(output_path, "w", encoding="utf-8") as f:
            json.dump(audit_output, f, indent=2)
            
        logger.info(f"Audit completed successfully on clean models. Metrics saved to {output_path}")

if __name__ == "__main__":
    auditor = ModelAuditor()
    auditor.run_audit()
