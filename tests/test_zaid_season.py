"""
tests/test_zaid_season.py
Regression tests for zaid-season support (crop catalog, weather data,
ML season vocabulary) -- see docs/superpowers/specs/2026-09-11-zaid-season-completion-design.md.
"""
from __future__ import annotations

import csv
import re
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
        budget_per_acre=25000, area_acres=2.0, top_k=50, include_losses=True,
    )
    recommended_ids = {r["crop_id"] for r in recs}
    assert recommended_ids & set(ZAID_CROPS), (
        f"expected at least one of {ZAID_CROPS} in {recommended_ids}"
    )


def test_zaid_weather_rows_exist_for_all_regions():
    with (DATASET_DIR / "weather.csv").open(newline="", encoding="utf-8") as f:
        rows = list(csv.DictReader(f))
    zaid_regions = {r["region_id"] for r in rows if r["season"] == "zaid"}
    all_regions = {r["region_id"] for r in rows}
    assert zaid_regions == all_regions, (
        f"missing zaid weather for: {all_regions - zaid_regions}"
    )


def test_location_based_insights_does_not_crash_for_zaid():
    from ml.predict import location_based_insights

    # Should not raise -- previously crashed because weather.csv had zero
    # zaid rows for any region.
    result = location_based_insights("telangana_medak", "zaid")
    assert result is not None


def test_zaid_in_all_seasons_vocabulary():
    from ml.dataset_builders import ALL_SEASONS

    assert "zaid" in ALL_SEASONS


def test_zaid_encodable_by_a_freshly_fit_season_encoder():
    from ml.dataset_builders import ALL_SEASONS, _fit_label_encoders

    _, _, season_le = _fit_label_encoders(["wheat"], ["telangana_medak"], ALL_SEASONS)
    # Must not raise -- a season LabelEncoder fit on the current
    # ALL_SEASONS must recognize "zaid" as a known class.
    encoded = season_le.transform(["zaid"])
    assert encoded[0] >= 0


def test_dashboard_html_season_selects_all_offer_zaid():
    frontend_dir = Path(__file__).resolve().parents[1] / "frontend"
    html = (frontend_dir / "dashboard.html").read_text(encoding="utf-8")
    kharif_blocks = html.count('<option value="kharif">Kharif</option>')
    zaid_blocks = html.count('<option value="zaid">Zaid</option>')
    assert kharif_blocks > 0, "sanity check: expected pattern not found at all"
    assert zaid_blocks == kharif_blocks, (
        f"{kharif_blocks} Kharif options but only {zaid_blocks} Zaid options in dashboard.html"
    )


def test_index_html_landing_season_select_offers_zaid():
    frontend_dir = Path(__file__).resolve().parents[1] / "frontend"
    html = (frontend_dir / "index.html").read_text(encoding="utf-8")
    # The landing page's crop question (frontend/demo-recommender.js) reads
    # its season from #askSeason.
    select = re.search(r'<select[^>]*id="askSeason"[^>]*>(.*?)</select>', html, re.S)
    assert select, "landing season select #askSeason not found"
    assert 'value="zaid"' in select.group(1)


def test_offline_simulator_has_zaid_crops():
    frontend_dir = Path(__file__).resolve().parents[1] / "frontend"
    js = (frontend_dir / "offline-simulator.js").read_text(encoding="utf-8")
    for crop_id in ZAID_CROPS:
        assert f"{crop_id}:" in js, f"{crop_id} missing from offline-simulator.js CROPS"
