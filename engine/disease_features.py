"""
Shared HSV/texture feature extraction for crop leaf images.

Used by both the live screening endpoint (`backend/main.py predict_disease_api`)
and the offline trainer (`ml/training/disease_model.py`) so the feature vector
a model is trained on is identical, field-for-field, to the one computed at
inference time.
"""
from __future__ import annotations

from typing import Any

import numpy as np
from PIL import Image

# Ordered feature names -- this order is the model's input vector layout.
FEATURE_NAMES = [
    "hue_yellow",
    "hue_green",
    "hue_orange",
    "hue_brown",
    "hue_gray",
    "hue_dark",
    "hue_bright",
    "sat_mean",
    "val_mean",
    "hue_mean",
    "texture_score",
    "lesion_frac",
]


def extract_leaf_features(image: Image.Image) -> dict[str, float]:
    """Compute HSV colour-band fractions + texture + lesion fraction for a leaf photo.

    Measured HSV bands (PIL's 0-255 hue scale, mapping 0-360 degrees) from
    real leaf images:
      Green leaf:  H ~85 (120 deg), S>150
      Yellow leaf: H ~36 (51 deg),  S>200
      Orange/rust: H ~14 (20 deg),  S>150
      Brown (dark):H ~16 (23 deg),  S~127, V<100
      Gray/white:  S<30
    """
    image = image.convert("RGB").resize((128, 128))
    img_hsv = np.array(image.convert("HSV"), dtype=np.float32)
    img_rgb = np.array(image, dtype=np.float32)

    H = img_hsv[:, :, 0]
    S = img_hsv[:, :, 1]
    V = img_hsv[:, :, 2]
    eps = 1e-6

    n_total = float(H.size)

    # NOTE: check yellow BEFORE green since their hue ranges overlap (H 36-40)
    hue_yellow = ((H >= 25) & (H <= 44) & (S > 100) & (V > 100)).sum() / n_total
    hue_green = ((H >= 44) & (H <= 96) & (S > 60) & ~((H >= 25) & (H <= 44) & (S > 100) & (V > 100))).sum() / n_total
    hue_orange = ((H >= 6) & (H <= 20) & (S > 130) & (V > 80)).sum() / n_total
    hue_brown = ((H >= 5) & (H <= 26) & (S > 50) & (V <= 130)).sum() / n_total
    hue_gray = (S < 35).sum() / n_total
    hue_dark = (V < 50).sum() / n_total
    hue_bright = ((V > 200) & (S < 40)).sum() / n_total

    sat_mean = float(S.mean()) / 255.0
    val_mean = float(V.mean()) / 255.0
    hue_mean = float(H.mean()) / 255.0

    block_stds = []
    for row in range(0, 128, 8):
        for col in range(0, 128, 8):
            blk = V[row:row + 8, col:col + 8]
            block_stds.append(float(blk.std()))
    texture_score = float(np.mean(block_stds)) / 255.0

    non_bg = (V > 35)
    green_px = non_bg & (H >= 44) & (H <= 96) & (S > 60)
    lesion_px = non_bg & ~green_px
    n_non_bg = float(non_bg.sum()) + eps
    lesion_frac = float(lesion_px.sum()) / n_non_bg

    return {
        "hue_yellow": float(hue_yellow),
        "hue_green": float(hue_green),
        "hue_orange": float(hue_orange),
        "hue_brown": float(hue_brown),
        "hue_gray": float(hue_gray),
        "hue_dark": float(hue_dark),
        "hue_bright": float(hue_bright),
        "sat_mean": sat_mean,
        "val_mean": val_mean,
        "hue_mean": hue_mean,
        "texture_score": texture_score,
        "lesion_frac": lesion_frac,
    }


def severity_from_lesion_frac(lesion_frac: float) -> str:
    if lesion_frac < 0.08:
        return "early"
    elif lesion_frac < 0.35:
        return "moderate"
    return "severe"


def feature_vector(features: dict[str, float]) -> list[float]:
    """Order a feature dict into the model's expected input vector."""
    return [features[name] for name in FEATURE_NAMES]
