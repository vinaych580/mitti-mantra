"""
ml/training/disease_model.py
Crop disease detection status reporting.

There is no trained image-classification model for crop disease: the served
feature (`POST /api/disease/predict`) is a rule-based HSV colour/texture
heuristic (see `backend/main.py`), not a neural network. This module used to
generate a placeholder TF.js model with random, untrained weights and report
a fabricated accuracy figure; both were misleading and have been removed.
Nothing in the app loads or serves a disease model file anymore.
"""
from __future__ import annotations

import json
from pathlib import Path
from typing import Any

MODEL_DIR = Path(__file__).resolve().parents[1] / "models"


def train_disease_model() -> dict[str, Any]:
    """Report the true status of crop disease detection: heuristic, not ML."""
    report = {
        "model": "crop_disease",
        "status": "NOT_APPLICABLE",
        "note": (
            "Crop disease screening is a rule-based HSV colour/texture heuristic "
            "(backend/main.py predict_disease_api), not a trained model. There is "
            "nothing to train or evaluate here."
        ),
        "metrics": None,
    }
    update_manifests()
    return report


def update_manifests() -> None:
    """Remove any stale fabricated crop_disease entry from prior runs."""
    for filename in ("evaluation_manifest.json", "audit_metrics.json"):
        path = MODEL_DIR / filename
        if not path.exists():
            continue
        try:
            with open(path, "r") as f:
                data = json.load(f)
            if data.pop("crop_disease", None) is not None:
                with open(path, "w") as f:
                    json.dump(data, f, indent=2)
                print(f"Removed fabricated crop_disease entry from {filename}")
        except Exception as e:
            print(f"Failed to update {filename}: {e}")


if __name__ == "__main__":
    report = train_disease_model()
    print(json.dumps(report, indent=2))
