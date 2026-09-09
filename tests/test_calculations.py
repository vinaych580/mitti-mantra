"""
tests/test_calculations.py
Unit tests for utils/calculations.py's pure scoring/math functions.
"""
from __future__ import annotations

from utils.calculations import compute_smart_score


def test_compute_smart_score_weighted_blend():
    score = compute_smart_score(
        roi_normalized=50.0,
        confidence_score=80.0,
        budget_fit=100.0,
        soil_health=90.0,
        ml_term=60.0,
        saturation_penalty=0.0,
    )
    # 0.35*50 + 0.20*80 + 0.15*100 + 0.15*90 + 0.15*60 - 0 = 71.0
    assert score == 71.0


def test_compute_smart_score_saturation_penalty_caps_at_ten_points():
    with_penalty = compute_smart_score(50.0, 80.0, 100.0, 90.0, 60.0, saturation_penalty=40.0)
    without_penalty = compute_smart_score(50.0, 80.0, 100.0, 90.0, 60.0, saturation_penalty=0.0)
    assert without_penalty - with_penalty == 10.0


def test_compute_smart_score_clamps_to_0_100_range():
    assert compute_smart_score(1000, 1000, 1000, 1000, 1000, 0.0) == 100.0
    assert compute_smart_score(-1000, -1000, -1000, -1000, -1000, 0.0) == 0.0


def test_compute_smart_score_saturation_penalty_defaults_to_zero():
    assert compute_smart_score(50.0, 80.0, 100.0, 90.0, 60.0) == 71.0
