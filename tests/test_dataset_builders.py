"""
tests/test_dataset_builders.py
Unit tests for ml/dataset_builders.py -- the shared dataset-construction
code used by ml/train_models.py and ml/evaluate_models.py.
"""
from __future__ import annotations

from collections import Counter

import csv
from pathlib import Path

import numpy as np

from ml.dataset_builders import (
    _build_recommendation_dataset,
    _build_yield_dataset,
    _yield_time_split,
)

DATASET = Path(__file__).resolve().parents[1] / "dataset"


def test_build_yield_dataset_is_one_row_per_real_harvest():
    """Real harvests only -- no synthetic climate-mismatch rows or noised
    copies (see _build_yield_dataset's docstring for why they were dropped)."""
    X, y, years, crop_le, region_le, season_le = _build_yield_dataset()

    with (DATASET / "yield_history.csv").open(newline="") as f:
        history = list(csv.DictReader(f))
    assert len(X) == len(y) == len(years) == len(history)
    assert sorted(y.tolist()) == sorted(float(r["yield_kg_per_acre"]) for r in history)
    assert set(years.tolist()) == {int(r["year"]) for r in history}


def test_yield_time_split_holds_out_the_latest_harvest_year():
    _, _, years, *_ = _build_yield_dataset()
    train, test = _yield_time_split(years)

    assert test.any() and train.any()
    assert (years[test] == years.max()).all()
    assert (years[train] < years.max()).all()
    assert not np.any(train & test)


def test_build_recommendation_dataset_staples_are_recommendable():
    X, y, source, crop_le, region_le, season_le = _build_recommendation_dataset()
    # Only "natural" wins count: the top-up pass pads rare crops to a
    # minimum, which would satisfy this bar without the crop ever winning
    # on its own.
    counts = Counter(crop_le.classes_[i] for i, s in zip(y.tolist(), source) if s == "natural")
    # The concrete regression test for the bug this task fixes: these
    # staples used to never win a single sample (0.00 F1 on the deployed
    # model's real holdout) because the old label formula had no risk/
    # soil-fit term and let perennials compete in every seasonal sample.
    #
    # A bare "wins at least once" bar is satisfied by a single lucky draw
    # from the 35% synthetic weather tail (see
    # docs/superpowers/specs/2026-09-11-rabi-rainfall-sampling-design.md)
    # without the crop being genuinely representable in training data --
    # requiring >=10 wins (the deployed dataset's actual weakest staple,
    # maize, wins 24/60000 at random_state=42) still catches the original
    # regression while ruling out a single-fluke pass.
    for staple in ("rice", "wheat", "maize", "soybean"):
        assert counts[staple] >= 10, (
            f"{staple} should win a genuine number of training samples, not just one "
            f"(got {counts[staple]})"
        )


def test_build_recommendation_dataset_excludes_true_perennials():
    X, y, source, crop_le, region_le, season_le = _build_recommendation_dataset()
    labeled_crops = {crop_le.classes_[i] for i in set(y.tolist())}
    # cashew/coconut/coffee/mango/tea are "Perennial" season crops -- a
    # kharif/rabi request must never recommend a tree that takes 3-5 years
    # to fruit, matching ml/predict.py::recommend_crops's own filter.
    for perennial in ("cashew", "coconut", "coffee", "mango", "tea"):
        assert perennial not in labeled_crops, f"{perennial} is perennial and must not be a seasonal label"


def test_build_recommendation_dataset_tags_row_source():
    X, y, source, *_ = _build_recommendation_dataset()
    assert len(source) == len(X) == len(y)
    assert set(source) <= {"natural", "topup"}
    assert Counter(source)["natural"] > Counter(source)["topup"]
