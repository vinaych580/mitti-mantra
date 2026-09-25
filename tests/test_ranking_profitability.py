"""A farmer asking what to sow must never see a money-losing crop ranked
above one that makes money (review 2026-09-23: jute at -Rs 2,540 ranked
above groundnut at +Rs 52,973 for Medak kharif)."""
import ml.predict as P


def test_rank_puts_every_profitable_crop_first():
    recs = [
        {"crop_id": "a", "expected_profit": -10, "smart_score": 90},
        {"crop_id": "b", "expected_profit": 500, "smart_score": 40},
        {"crop_id": "c", "expected_profit": 0, "smart_score": 80},
        {"crop_id": "d", "expected_profit": 100, "smart_score": 60},
    ]
    assert [r["crop_id"] for r in P.rank_recommendations(recs)] == ["d", "b", "a", "c"]


def test_live_ranking_has_no_loss_above_profit():
    recs = P.recommend_crops("telangana_medak", "kharif", 20000, 3, top_k=50)
    seen_loss = False
    for r in recs:
        if r["expected_profit"] <= 0:
            seen_loss = True
        else:
            assert not seen_loss, f"{r['crop_id']} is profitable but ranked below a loss"


# --- Underfunded crops (2026-09-24: turmeric ranked #1 at 22% budget coverage) ---
#
# Medak/Pune kharif at Rs 15,000/acre put turmeric first with ~130-146% ROI
# although the budget covers only 22% of the Rs 68,000/acre it typically
# needs -- not even its seed rhizome. Yield was scaled by coverage**2 but cost
# stayed the farmer's budget, so ROI came out as (full-funding revenue/cost)
# x coverage - 1, and a crop with a large full-funding margin stayed
# "profitable" at almost any budget.

import pytest

LOW_COVERAGE = 0.25
UNDERFUNDED_CASES = [
    ("telangana_medak", 15000),
    ("mh_pune", 15000),
    ("up_lucknow", 20000),
]


def _coverage(crop_id, budget):
    cost = P._load_crop_parameters()[crop_id].avg_input_cost_inr_per_acre
    return budget / cost


def test_budget_below_establishment_cost_cannot_show_a_profit():
    # 22% of turmeric's typical input cost can't buy its planting material,
    # so no harvest can be booked against it.
    res = P.profit_estimator("turmeric", 9500.0, 4.0, 15000.0, mandi_price_per_kg=95.0)
    assert res["budget_coverage"] == pytest.approx(15000 / 68000, abs=1e-4)
    assert res["expected_profit"] < 0
    assert res["roi_percent"] <= 0


@pytest.mark.parametrize("crop_id", sorted(P._load_crop_parameters()))
def test_underfunding_never_improves_roi(crop_id):
    """Cutting a crop's budget must never raise its ROI above what full
    funding earns -- otherwise a thin budget makes a crop look *better*."""
    cost = P._load_crop_parameters()[crop_id].avg_input_cost_inr_per_acre
    full = P.profit_estimator(crop_id, 1000.0, 1.0, cost, mandi_price_per_kg=50.0)["roi_percent"]
    prev = -100.0
    for frac in (0.05, 0.15, 0.24, 0.35, 0.5, 0.75, 0.9, 1.0):
        roi = P.profit_estimator(crop_id, 1000.0, 1.0, cost * frac, mandi_price_per_kg=50.0)["roi_percent"]
        if frac < LOW_COVERAGE:
            assert roi <= 0, f"{crop_id} at {frac:.0%} coverage shows ROI {roi}"
        assert roi <= full + 1e-6, f"{crop_id} at {frac:.0%} coverage beats full funding"
        assert roi >= prev - 1e-6, f"{crop_id} ROI falls as budget rises at {frac:.0%}"
        prev = roi


@pytest.mark.parametrize("region_id,budget", UNDERFUNDED_CASES)
def test_live_ranking_puts_low_coverage_crops_below_funded_profitable_ones(region_id, budget):
    recs = P.recommend_crops(region_id, "kharif", budget, 4, top_k=50)
    for i, r in enumerate(recs):
        if _coverage(r["crop_id"], budget) >= LOW_COVERAGE:
            continue
        assert r["roi_percent"] <= 0, f"{r['crop_id']} shows ROI {r['roi_percent']} at <25% coverage"
        assert r["expected_profit"] <= 0
        outranked = [
            o["crop_id"] for o in recs[i + 1:]
            if _coverage(o["crop_id"], budget) >= 1.0 and o["expected_profit"] > 0
        ]
        assert not outranked, f"{r['crop_id']} (<25% funded) ranks above funded profitable {outranked}"


@pytest.mark.parametrize("region_id,budget", UNDERFUNDED_CASES)
def test_live_ranking_top_pick_is_not_low_coverage(region_id, budget):
    top = P.recommend_crops(region_id, "kharif", budget, 4, top_k=1)[0]
    assert _coverage(top["crop_id"], budget) >= LOW_COVERAGE, top


def test_reason_reports_budget_coverage_not_yield_multiplier():
    # The note used to print the yield multiplier (coverage**2): "covers only
    # 5%" for a budget that covers 22%.
    recs = P.recommend_crops("telangana_medak", "kharif", 15000, 4, top_k=50)
    turmeric = next(r for r in recs if r["crop_id"] == "turmeric")
    assert turmeric["budget_adequate"] is False
    assert "22%" in turmeric["reason"]


# --- Yields must be in the form the crop is sold (2026-09-25) ---
#
# Turmeric's yields were fresh rhizome (~9,500 kg/acre) while its prices are
# cured turmeric (Rs 70-120/kg); curing leaves ~20% of the fresh weight, so
# a fully funded acre showed ~1,227% ROI and topped rankings at any budget
# that could establish it. See dataset/data_dictionary.md.

import csv
from collections import defaultdict
from pathlib import Path

DATASET = Path(__file__).resolve().parents[1] / "dataset"


def _full_funding_roi(crop_id):
    c = P._load_crop_parameters()[crop_id]
    price = (c.mandi_price_min_inr_per_kg + c.mandi_price_max_inr_per_kg) / 2.0
    return (c.base_yield_kg_per_acre * price / c.avg_input_cost_inr_per_acre - 1.0) * 100.0


def test_turmeric_yield_is_on_the_cured_basis_its_price_is_quoted_in():
    assert _full_funding_roi("turmeric") < 300.0


def test_yield_history_is_on_the_same_basis_as_crop_parameters():
    """A crop converted in one file but not the other would reintroduce the
    mismatch through the yield model, which trains on yield_history."""
    base = {cid: c.base_yield_kg_per_acre for cid, c in P._load_crop_parameters().items()}
    ratios = defaultdict(list)
    with (DATASET / "yield_history.csv").open(newline="") as f:
        for row in csv.DictReader(f):
            if row["crop_id"] in base:
                ratios[row["crop_id"]].append(float(row["yield_kg_per_acre"]) / base[row["crop_id"]])
    off = {c: round(sum(r) / len(r), 2) for c, r in ratios.items() if not 0.7 <= sum(r) / len(r) <= 1.3}
    assert not off, f"yield_history mean / base_yield out of range: {off}"


def test_live_fully_funded_turmeric_roi_is_plausible():
    recs = P.recommend_crops("telangana_medak", "kharif", 70000, 4, top_k=50)
    turmeric = next(r for r in recs if r["crop_id"] == "turmeric")
    assert turmeric["budget_adequate"] is True
    assert turmeric["roi_percent"] < 300.0, turmeric
