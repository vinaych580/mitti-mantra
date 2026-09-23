"""engine.crop_mix.allocate -- the land split behind /api/optimal-mix.

Review 2026-09-23: the old proportional-to-smart_score split put 10 acres in
Medak across 19 crops (12 loss-making) for a total of -Rs 1,805.
"""
from engine.crop_mix import allocate


def _rec(cid, profit, risk=30, score=50):
    return {"crop_id": cid, "crop_name": cid, "expected_profit": profit,
            "roi_percent": 10.0, "risk_score": risk, "smart_score": score}


def test_losses_never_allocated():
    out = allocate([_rec("a", 1000), _rec("b", -50), _rec("c", 400)], 10, 20000)
    assert {a["crop_id"] for a in out["allocations"]} == {"a", "c"}


def test_area_sums_to_total_and_respects_bounds():
    recs = [_rec(c, p) for c, p in [("a", 9000), ("b", 7000), ("c", 5000), ("d", 3000)]]
    out = allocate(recs, 10, 20000)
    areas = [a["allocated_acres"] for a in out["allocations"]]
    assert len(areas) == 3
    assert abs(sum(areas) - 10) < 1e-6
    assert max(areas) <= 6.0 + 1e-6 and min(areas) >= 0.5


def test_budget_follows_area():
    out = allocate([_rec("a", 9000), _rec("b", 7000)], 4, 20000)
    assert abs(sum(a["allocated_budget"] for a in out["allocations"]) - 80000) < 1e-6


def test_small_farm_gets_single_crop():
    out = allocate([_rec("a", 900), _rec("b", 800)], 0.8, 20000)
    assert [a["allocated_acres"] for a in out["allocations"]] == [0.8]


def test_riskier_crop_ranked_lower_at_equal_profit():
    out = allocate([_rec("risky", 1000, risk=90), _rec("safe", 1000, risk=10)], 10, 20000)
    assert out["allocations"][0]["crop_id"] == "safe"


def test_reports_single_crop_comparison():
    out = allocate([_rec("a", 10000), _rec("b", 5000)], 10, 20000)
    assert out["single_crop_best"] == {"crop_id": "a", "crop_name": "a", "expected_profit": 10000}
    assert out["diversification_cost"] == round(10000 - out["total_expected_profit"], 2)
    assert out["total_expected_profit"] > 0


def test_nothing_profitable_returns_empty():
    out = allocate([_rec("a", -1)], 5, 20000)
    assert out["allocations"] == [] and out["single_crop_best"] is None
