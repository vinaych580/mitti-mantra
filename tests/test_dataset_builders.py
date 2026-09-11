"""
tests/test_dataset_builders.py
Unit tests for ml/dataset_builders.py -- the shared dataset-construction
code used by ml/train_models.py and ml/evaluate_models.py.
"""
from __future__ import annotations

from collections import Counter

from ml.dataset_builders import _build_recommendation_dataset, _build_yield_dataset


def test_build_yield_dataset_tags_row_provenance():
    X, y, source, crop_le, region_le, season_le = _build_yield_dataset()

    assert len(source) == len(X) == len(y)
    counts = Counter(source)
    assert set(counts) <= {"real", "augmented", "synthetic_mismatch"}
    # yield_history.csv has real rows; the mismatch-injection loop always
    # finds at least one severe climate mismatch across 30 regions x 2
    # seasons x 32 crops; augmentation (6x per base row) dominates both.
    assert counts["real"] > 0
    assert counts["synthetic_mismatch"] > 0
    assert counts["augmented"] > 0


def test_build_yield_dataset_augmented_rows_inherit_non_real_source():
    _, _, source, _, _, _ = _build_yield_dataset()
    counts = Counter(source)
    # Augmented copies of real rows are tagged "augmented" (6x per real row);
    # augmented copies of synthetic_mismatch rows stay tagged
    # "synthetic_mismatch" to preserve the provenance signal for
    # audit_models._split_yield_mape() -- a noised copy of a deliberately-
    # tiny value is still not a realistic observed yield.
    assert counts["augmented"] == counts["real"] * 6


def test_build_recommendation_dataset_staples_are_recommendable():
    X, y, crop_le, region_le, season_le = _build_recommendation_dataset()
    labeled_crops = {crop_le.classes_[i] for i in set(y.tolist())}
    # The concrete regression test for the bug this task fixes: these
    # staples used to never win a single sample (0.00 F1 on the deployed
    # model's real holdout) because the old label formula had no risk/
    # soil-fit term and let perennials compete in every seasonal sample.
    for staple in ("rice", "wheat", "maize", "soybean"):
        assert staple in labeled_crops, f"{staple} should be recommendable at least once"


def test_build_recommendation_dataset_excludes_true_perennials():
    X, y, crop_le, region_le, season_le = _build_recommendation_dataset()
    labeled_crops = {crop_le.classes_[i] for i in set(y.tolist())}
    # cashew/coconut/coffee/mango/tea are "Perennial" season crops -- a
    # kharif/rabi request must never recommend a tree that takes 3-5 years
    # to fruit, matching ml/predict.py::recommend_crops's own filter.
    for perennial in ("cashew", "coconut", "coffee", "mango", "tea"):
        assert perennial not in labeled_crops, f"{perennial} is perennial and must not be a seasonal label"
