import json
import logging
import time
from pathlib import Path
import joblib
import numpy as np

from sklearn.metrics import accuracy_score, f1_score, precision_recall_fscore_support, r2_score, mean_absolute_error, mean_squared_error
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
from ml.dataset_builders import (
    RECOMMEND_FEATURE_NAMES,
    YIELD_FEATURE_NAMES,
    _build_yield_dataset,
    _yield_time_split,
)

class ModelAuditor:
    # FIX (C-3): ml/evaluate_models.py's and ml/train_models.py's dataset
    # builders both consume np.random.RandomState(42) in the same row
    # order, so reconstructing a "test split" here with the same seed
    # mostly reproduces the deployed model's *training* rows (measured at
    # 83.6% row-hash overlap) -- this audit was silently grading models on
    # data they'd already seen. Whichever pipeline last trained/saved a
    # model now also persists the exact held-out rows it evaluated itself
    # on (ml/models/holdout_<name>.joblib); prefer those genuinely-unseen
    # rows here instead of rebuilding+resplitting the dataset. (The
    # recommendation holdout is now an independently seeded draw and the
    # yield holdout is the latest harvest year, so neither can overlap
    # training even when regenerated.)
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

        Current yield holdouts are all "real" rows, so both values match.
        The split still matters for an older holdout file that mixed in
        deliberately-tiny "synthetic_mismatch" rows, whose near-zero
        denominators blow up percentage error -- see
        docs/superpowers/specs/2026-09-06-ml-model-accuracy-design.md
        section 7. Without `source_test` there's nothing to split and both
        values are the plain full-set figure.
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

    @staticmethod
    def _weather_noise(X: np.ndarray, cols: list[int], seed: int = 7) -> np.ndarray:
        """Copy of X with the weather columns jittered by up to +/-10%.

        Stands in for real sensor/forecast error. The old robustness check set
        weather to exactly 0 -- 0 mm rain and 0 C -- which no production path
        ever sends (missing weather falls back to regional defaults) and whose
        "correct" answer isn't the original label anyway.
        """
        rng = np.random.RandomState(seed)
        noisy = X.copy()
        noisy[:, cols] *= rng.uniform(0.9, 1.1, size=(len(X), len(cols))).astype(X.dtype)
        return noisy

    def run_audit(self):
        logger.info("Initializing model audit on persisted holdouts...")

        rec_model_path = MODEL_DIR / "recommend_model.joblib"
        yield_model_path = MODEL_DIR / "yield_model.joblib"
        if not rec_model_path.exists() or not yield_model_path.exists():
            logger.error("Model files missing. Please run model training/evaluation first.")
            return

        rec_model = joblib.load(rec_model_path)
        yield_model = joblib.load(yield_model_path)
        rec_encoders = joblib.load(MODEL_DIR / "recommend_encoders.joblib")

        # 1. Crop recommendation
        rec_holdout = self._load_holdout("recommend")
        if rec_holdout is not None:
            X_test_rec, y_test_rec, source_rec = rec_holdout
            logger.info("Using persisted holdout for crop_recommendation audit (n=%d)", len(X_test_rec))
        else:
            logger.warning(
                "No holdout_recommend.joblib found -- generating the independent "
                "holdout draw train_models.py would have saved."
            )
            from ml.train_models import build_recommendation_holdout
            X_test_rec, y_test_rec, source_rec, crop_le_rec, *_ = build_recommendation_holdout()
            # Realign into rec_model's label space in case the crop roster
            # changed since it was trained; raises on an unseen crop rather
            # than silently mislabeling.
            y_test_rec = rec_encoders["crop"].transform(crop_le_rec.inverse_transform(y_test_rec))
        if source_rec is None:
            source_rec = ["natural"] * len(X_test_rec)
        natural = np.array([s == "natural" for s in source_rec])

        pred_rec = rec_model.predict(X_test_rec)
        acc_rec = accuracy_score(y_test_rec[natural], pred_rec[natural])
        f1 = f1_score(y_test_rec[natural], pred_rec[natural], average="macro")

        # Per-crop F1 over the whole holdout, top-up rows included: a crop the
        # scoring formula picks once in 2,500 scenarios has too few natural
        # rows for its F1 to mean anything. `support` makes the sample size
        # behind each figure visible.
        rec_crop_le = rec_encoders["crop"]
        present_labels = sorted(set(y_test_rec.tolist()) | set(pred_rec.tolist()))
        _, _, per_class_f1, per_class_support = precision_recall_fscore_support(
            y_test_rec, pred_rec, labels=present_labels, zero_division=0,
        )
        per_class_f1_named = {
            rec_crop_le.classes_[label]: round(float(f1_val), 4)
            for label, f1_val in zip(present_labels, per_class_f1)
        }
        per_class_support_named = {
            rec_crop_le.classes_[label]: int(n)
            for label, n in zip(present_labels, per_class_support)
        }
        zero_f1_crops = sorted(name for name, f1_val in per_class_f1_named.items() if f1_val == 0.0)

        pi_rec = permutation_importance(
            rec_model, X_test_rec[natural], y_test_rec[natural], n_repeats=5, random_state=42,
        )
        pi_rec_importances = dict(zip(RECOMMEND_FEATURE_NAMES, [round(float(w), 4) for w in pi_rec.importances_mean]))
        pi_rec_importances = dict(sorted(pi_rec_importances.items(), key=lambda x: x[1], reverse=True))

        weather_cols_rec = [RECOMMEND_FEATURE_NAMES.index(c) for c in ("rainfall", "avg_temp", "min_temp", "max_temp")]
        noisy_pred_rec = rec_model.predict(self._weather_noise(X_test_rec[natural], weather_cols_rec))
        noise_agreement = float(np.mean(noisy_pred_rec == pred_rec[natural]))

        # 2. Yield prediction
        yield_holdout = self._load_holdout("yield")
        source_test_y = None
        if yield_holdout is not None:
            X_test_y, y_test_y, source_test_y = yield_holdout
            logger.info("Using persisted holdout for yield_prediction audit (n=%d)", len(X_test_y))
        else:
            logger.warning(
                "No holdout_yield.joblib found -- rebuilding the latest-year split "
                "train_models.py uses."
            )
            X_yield, y_yield, years, *_ = _build_yield_dataset()
            _, test = _yield_time_split(years)
            X_test_y, y_test_y = X_yield[test], y_yield[test]

        pred_yield = yield_model.predict(X_test_y)
        r2 = r2_score(y_test_y, pred_yield)
        mae = mean_absolute_error(y_test_y, pred_yield)
        rmse = np.sqrt(mean_squared_error(y_test_y, pred_yield))
        mape_real, _mape_full = self._split_yield_mape(y_test_y, pred_yield, source_test_y)
        base_col = YIELD_FEATURE_NAMES.index("base_yield")
        baseline_mape, _ = self._split_yield_mape(y_test_y, X_test_y[:, base_col], source_test_y)

        pi_yield = permutation_importance(yield_model, X_test_y, y_test_y, n_repeats=5, random_state=42)
        pi_yield_importances = dict(zip(YIELD_FEATURE_NAMES, [round(float(w), 4) for w in pi_yield.importances_mean]))
        pi_yield_importances = dict(sorted(pi_yield_importances.items(), key=lambda x: x[1], reverse=True))

        weather_cols_y = [YIELD_FEATURE_NAMES.index(c) for c in ("rainfall", "avg_temp", "min_temp", "max_temp")]
        noisy_pred_y = yield_model.predict(self._weather_noise(X_test_y, weather_cols_y))
        noisy_mape, _ = self._split_yield_mape(y_test_y, noisy_pred_y, source_test_y)

        audit_output = {
            "crop_recommendation": {
                "algorithm": type(rec_model).__name__,
                "accuracy": round(float(acc_rec), 4),
                "f1_macro": round(float(f1), 4),
                "per_class_f1": per_class_f1_named,
                "per_class_support": per_class_support_named,
                "zero_f1_crops": zero_f1_crops,
                "permutation_importances": pi_rec_importances,
                "robustness_weather_noise_agreement": round(noise_agreement, 4),
                "test_samples_natural": int(natural.sum()),
                "evaluated_on_persisted_holdout": rec_holdout is not None,
            },
            "yield_prediction": {
                "algorithm": type(yield_model).__name__,
                "r2": round(float(r2), 4),
                "mae": round(float(mae), 2),
                "rmse": round(float(rmse), 2),
                "mape_pct_real_rows": round(float(mape_real), 2),
                "baseline_crop_base_yield_mape_pct": round(float(baseline_mape), 2),
                "permutation_importances": pi_yield_importances,
                "robustness_weather_noise_mape_pct": round(float(noisy_mape), 2),
                "test_samples": int(len(X_test_y)),
                "evaluated_on_persisted_holdout": yield_holdout is not None,
            },
            "audited_at": time.time(),
        }

        output_path = MODEL_DIR / "audit_metrics.json"
        with open(output_path, "w", encoding="utf-8") as f:
            json.dump(audit_output, f, indent=2)

        logger.info(f"Audit completed. Metrics saved to {output_path}")

if __name__ == "__main__":
    auditor = ModelAuditor()
    auditor.run_audit()
