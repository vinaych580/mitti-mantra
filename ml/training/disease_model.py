"""
ml/training/disease_model.py

Trains a RandomForestClassifier over the HSV colour/texture feature vector
defined in engine/disease_features.py, using labeled photos under
dataset/plantvillage/.

That folder is a small (~500 image) sample pulled from the public
spMohanty/PlantVillage-Dataset research benchmark (see
scripts/fetch_plantvillage_sample.py) -- real leaf photos, but from a
curated academic dataset shot under lab conditions, not this platform's own
farmer-submitted images. Report accuracy as a lab-bench figure, not a
field-validated one, and keep it clearly labeled as such wherever it's shown.

If dataset/plantvillage/ is missing or too small to fit reliably, this
reports NOT_APPLICABLE and clears any stale model file -- the live endpoint
(backend/main.py predict_disease_api) then falls back to its hand-tuned
HSV/texture decision tree. Nothing here ever reports a fabricated accuracy
number for an untrained/placeholder model.
"""
from __future__ import annotations

import json
from pathlib import Path
from typing import Any

import joblib
import numpy as np
from PIL import Image
from sklearn.ensemble import RandomForestClassifier
from sklearn.metrics import accuracy_score, f1_score
from sklearn.model_selection import StratifiedKFold, cross_val_score, train_test_split
from sklearn.preprocessing import LabelEncoder

from engine.disease_features import FEATURE_NAMES, extract_leaf_features, feature_vector

MODEL_DIR = Path(__file__).resolve().parents[1] / "models"
DATASET_DIR = Path(__file__).resolve().parents[2] / "dataset" / "plantvillage"
MIN_IMAGES_PER_CLASS = 10


def _load_dataset() -> tuple[list[list[float]], list[str]]:
    X: list[list[float]] = []
    y: list[str] = []
    if not DATASET_DIR.exists():
        return X, y
    for class_dir in sorted(DATASET_DIR.iterdir()):
        if not class_dir.is_dir():
            continue
        images = sorted(class_dir.glob("*.jpg")) + sorted(class_dir.glob("*.png"))
        for img_path in images:
            try:
                with Image.open(img_path) as im:
                    feats = extract_leaf_features(im)
                X.append(feature_vector(feats))
                y.append(class_dir.name)
            except Exception:
                continue
    return X, y


def _clear_stale_model() -> None:
    for name in ("disease_model.joblib", "disease_label_encoder.joblib"):
        path = MODEL_DIR / name
        if path.exists():
            path.unlink()


def train_disease_model() -> dict[str, Any]:
    """Fit a real classifier on dataset/plantvillage/, or report NOT_APPLICABLE."""
    X, y = _load_dataset()

    class_counts: dict[str, int] = {}
    for label in y:
        class_counts[label] = class_counts.get(label, 0) + 1
    usable_classes = {c for c, n in class_counts.items() if n >= MIN_IMAGES_PER_CLASS}

    if len(usable_classes) < 2:
        _clear_stale_model()
        return {
            "model": "crop_disease",
            "status": "NOT_APPLICABLE",
            "note": (
                f"Fewer than 2 classes have {MIN_IMAGES_PER_CLASS}+ labeled images under "
                f"{DATASET_DIR}. Crop disease screening stays a rule-based HSV/texture "
                "heuristic (backend/main.py predict_disease_api) -- nothing to train."
            ),
            "metrics": None,
        }

    filtered = [(xi, yi) for xi, yi in zip(X, y) if yi in usable_classes]
    X_arr = np.array([xi for xi, _ in filtered])
    y_labels = [yi for _, yi in filtered]

    le = LabelEncoder()
    y_enc = le.fit_transform(y_labels)

    X_train, X_test, y_train, y_test = train_test_split(
        X_arr, y_enc, test_size=0.25, random_state=42, stratify=y_enc,
    )

    model = RandomForestClassifier(
        n_estimators=300,
        max_depth=10,
        min_samples_leaf=2,
        class_weight="balanced",
        random_state=42,
        n_jobs=-1,
    )
    model.fit(X_train, y_train)

    y_pred = model.predict(X_test)
    test_accuracy = float(accuracy_score(y_test, y_pred))
    macro_f1 = float(f1_score(y_test, y_pred, average="macro"))

    n_splits = min(5, min(class_counts[c] for c in usable_classes))
    cv_scores: list[float] = []
    if n_splits >= 2:
        skf = StratifiedKFold(n_splits=n_splits, shuffle=True, random_state=42)
        cv_scores = cross_val_score(model, X_arr, y_enc, cv=skf).tolist()

    # Refit on the full sample for the artifact that actually gets deployed.
    model.fit(X_arr, y_enc)

    importances = dict(zip(FEATURE_NAMES, [round(float(v), 4) for v in model.feature_importances_]))

    MODEL_DIR.mkdir(parents=True, exist_ok=True)
    joblib.dump(model, MODEL_DIR / "disease_model.joblib")
    joblib.dump(le, MODEL_DIR / "disease_label_encoder.joblib")

    metrics = {
        "test_accuracy": round(test_accuracy, 4),
        "macro_f1": round(macro_f1, 4),
        "cv_mean_accuracy": round(float(np.mean(cv_scores)), 4) if cv_scores else None,
        "cv_folds": n_splits if cv_scores else 0,
        "train_samples": len(X_train),
        "test_samples": len(X_test),
        "classes_covered": sorted(usable_classes),
        "classes_dropped_insufficient_data": sorted(set(class_counts) - usable_classes),
    }

    return {
        "model": "crop_disease",
        "algorithm": "RandomForestClassifier",
        "status": "TRAINED",
        "note": (
            "Trained on a small real-photo sample from the public PlantVillage research "
            "benchmark (see scripts/fetch_plantvillage_sample.py) -- a curated academic "
            "dataset shot under controlled conditions, not this platform's own field "
            "photos. Treat accuracy as a lab-bench figure. The hand-tuned HSV heuristic "
            "remains the fallback whenever this model file is unavailable, and both paths "
            "carry the same 'not a diagnosis' disclaimer at inference time."
        ),
        "metrics": metrics,
        "feature_importances": importances,
    }


if __name__ == "__main__":
    result = train_disease_model()
    print(json.dumps(result, indent=2))
