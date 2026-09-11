"""
tests/test_zaid_season.py
Regression tests for zaid-season support (crop catalog, weather data,
ML season vocabulary) -- see docs/superpowers/specs/2026-09-11-zaid-season-completion-design.md.
"""
from __future__ import annotations

import csv
from pathlib import Path

DATASET_DIR = Path(__file__).resolve().parents[1] / "dataset"

ZAID_CROPS = ("watermelon", "cucumber", "muskmelon")


def test_zaid_crops_present_in_crop_parameters():
    with (DATASET_DIR / "crop_parameters.csv").open(newline="", encoding="utf-8") as f:
        rows = {r["crop_id"]: r for r in csv.DictReader(f)}
    for crop_id in ZAID_CROPS:
        assert crop_id in rows, f"{crop_id} missing from crop_parameters.csv"
        assert rows[crop_id]["season"] == "Zaid"


def test_zaid_crops_have_crop_calendars():
    from engine.features import get_crop_calendar

    for crop_id in ZAID_CROPS:
        # get_crop_calendar(crop_id, season) returns {"crop_id", "season",
        # "calendar"} when a season is given -- the "seasons" (plural) key
        # only appears when season=None (all-seasons form).
        cal = get_crop_calendar(crop_id, "zaid")
        assert cal["season"] == "zaid"
        assert cal["calendar"]["duration_days"] > 0


def test_zaid_crops_recommendable_via_heuristic_path():
    from ml.predict import recommend_crops

    # Any region works -- the heuristic path only needs crop_parameters.csv
    # and weather.csv rows for the region/season, both present after Task 2.
    recs = recommend_crops(
        region_id="telangana_medak", season="zaid",
        budget_per_acre=25000, area_acres=2.0, top_k=50,
    )
    recommended_ids = {r["crop_id"] for r in recs}
    assert recommended_ids & set(ZAID_CROPS), (
        f"expected at least one of {ZAID_CROPS} in {recommended_ids}"
    )
