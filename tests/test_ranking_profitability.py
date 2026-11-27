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
    # Losers follow in order of smallest loss (Phase 0, defect N-4).
    assert [r["crop_id"] for r in P.rank_recommendations(recs)] == ["d", "b", "c", "a"]


def test_live_ranking_has_no_loss_above_profit():
    recs = P.recommend_crops("telangana_medak", "kharif", 20000, 3, top_k=50, include_losses=True)
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
    recs = P.recommend_crops(region_id, "kharif", budget, 4, top_k=50, include_losses=True)
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
    recs = P.recommend_crops("telangana_medak", "kharif", 15000, 4, top_k=50, include_losses=True)
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
import statistics
from collections import defaultdict
from pathlib import Path

DATASET = Path(__file__).resolve().parents[1] / "dataset"


def _full_funding_roi(crop_id):
    c = P._load_crop_parameters()[crop_id]
    price = (c.mandi_price_min_inr_per_kg + c.mandi_price_max_inr_per_kg) / 2.0
    return (c.base_yield_kg_per_acre * price / c.avg_input_cost_inr_per_acre - 1.0) * 100.0


def test_turmeric_yield_is_on_the_cured_basis_its_price_is_quoted_in():
    assert _full_funding_roi("turmeric") < 300.0


# Measured district yields (DES APY, Phase 1) sit at about half of
# base_yield_kg_per_acre for every crop: base yields are good-farm potentials,
# district averages include every farm. That common yield gap is not a unit
# error. A unit error (per hectare vs per acre, lint vs kapas, fresh vs cured)
# moves one crop by a factor of 2.5-5 against the rest, so each crop's ratio is
# checked against the median ratio across crops.
UNIT_ERROR_FACTOR = 1.9

# Crops whose crop_parameters basis is known not to match the measured data.
# Each needs an owner decision on crop_parameters.csv (Phase 1 notes, "Still
# open"); remove a crop here once fixed (the test fails if it is fixed and
# still listed).
#   chilli: base yield is a green-chilli figure; price band and data are dry chilli.
#   mango:  base yield 8,500 kg/acre (21 t/ha) is several times the measured average.
#   tobacco: base yield 650 kg/acre is below the measured district average (~780),
#            where every other crop's base is about twice it; the reference
#            figures describe FCV tobacco, the data all tobacco.
KNOWN_YIELD_BASIS_GAPS = {"chilli", "mango", "tobacco"}


def _yield_ratios() -> dict:
    base = {cid: c.base_yield_kg_per_acre for cid, c in P._load_crop_parameters().items()}
    ratios = defaultdict(list)
    with (DATASET / "yield_history.csv").open(newline="") as f:
        for row in csv.DictReader(f):
            if row["crop_id"] in base:
                ratios[row["crop_id"]].append(float(row["yield_kg_per_acre"]) / base[row["crop_id"]])
    return {c: sum(r) / len(r) for c, r in ratios.items()}


def test_yield_history_is_on_the_same_basis_as_crop_parameters():
    """A crop converted in one file but not the other would reintroduce the
    mismatch through the yield model, which trains on yield_history."""
    mean = _yield_ratios()
    median = statistics.median(mean.values())
    off = {c: round(r, 2) for c, r in mean.items()
           if not median / UNIT_ERROR_FACTOR <= r <= median * UNIT_ERROR_FACTOR}
    assert set(off) <= KNOWN_YIELD_BASIS_GAPS, (
        f"yield_history / base_yield out of line with other crops (median {median:.2f}): {off}")
    fixed = KNOWN_YIELD_BASIS_GAPS - set(off)
    assert not fixed, f"basis now matches; remove from KNOWN_YIELD_BASIS_GAPS: {fixed}"


def test_measured_yields_never_exceed_the_potential_by_much():
    """No crop's district average should beat its good-farm base yield."""
    high = {c: round(r, 2) for c, r in _yield_ratios().items() if r > 1.3}
    assert not high, f"measured yields above base_yield: {high}"


def test_live_fully_funded_turmeric_roi_is_plausible():
    recs = P.recommend_crops("telangana_medak", "kharif", 70000, 4, top_k=50, include_losses=True)
    turmeric = next(r for r in recs if r["crop_id"] == "turmeric")
    assert turmeric["budget_adequate"] is True
    assert turmeric["roi_percent"] < 300.0, turmeric


# Published Indian farm-economics studies put gross returns at roughly 1.2-3x
# full cost of cultivation, and even paid-out-cost-only guides for the most
# lucrative vegetables stop near 5x. Past 5x (400% ROI) a crop's reference
# numbers have always been a data error rather than a great crop: turmeric's
# fresh yield against a cured price, tobacco's per-hectare yield stored per
# acre, cashew's raw-nut yield against a kernel price, and horticultural input
# costs a third of what the crop takes (2026-09-25 audit).
REFERENCE_ROI_CEILING = 400.0


@pytest.mark.parametrize("crop_id", sorted(P._load_crop_parameters()))
def test_reference_economics_are_plausible(crop_id):
    assert _full_funding_roi(crop_id) <= REFERENCE_ROI_CEILING, (
        f"{crop_id}: {_full_funding_roi(crop_id):.0f}% ROI at full funding -- check its yield "
        "basis (per acre, form sold), price basis (farm-gate) and input cost"
    )


def test_mandi_prices_match_crop_parameter_price_basis():
    """A price series on a different basis from crop_parameters (cashew's
    kernel prices against a raw-nut yield) would slip past the reference check."""
    params = P._load_crop_parameters()
    prices = defaultdict(list)
    with (DATASET / "mandi_prices.csv").open(newline="") as f:
        for row in csv.DictReader(f):
            prices[row["crop_id"]].append(float(row["price_inr_per_kg"]))
    off = {}
    for crop_id, series in prices.items():
        c = params[crop_id]
        mean = sum(series) / len(series)
        if not 0.5 * c.mandi_price_min_inr_per_kg <= mean <= 1.5 * c.mandi_price_max_inr_per_kg:
            off[crop_id] = round(mean, 1)
    assert set(off) <= KNOWN_PRICE_BASIS_GAPS, f"mandi_prices mean outside crop_parameters band: {off}"
    fixed = KNOWN_PRICE_BASIS_GAPS - set(off)
    assert not fixed, f"basis now matches; remove from KNOWN_PRICE_BASIS_GAPS: {fixed}"


# Measured Agmarknet prices on a different basis from the crop_parameters band
# (owner decision pending, Phase 1 notes):
#   mango:   band is farm-gate (Rs 20-40); mandi modal prices are wholesale (median ~Rs 54).
#   tobacco: band is FCV auction (Rs 130-230); mandi tobacco is non-FCV leaf (median ~Rs 32).
KNOWN_PRICE_BASIS_GAPS = {"mango", "tobacco"}
