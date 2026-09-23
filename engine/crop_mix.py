"""
engine/crop_mix.py

Split a farm's land across a few profitable crops (/api/optimal-mix).

Budget is spent per acre at the farm's own rate, so it is satisfied whenever
the land adds up -- the only real decision is how to split the land. Expected
profit is linear in area, so the profit-maximising answer is always a single
crop; a mix exists to spread risk, and what that spreading costs is reported
(`diversification_cost`) rather than hidden.

Rules:
  1. Only crops with a positive expected profit are eligible.
  2. Eligible crops are ordered by risk-adjusted profit per acre:
     profit_per_acre * (1 - risk_score / 200), so a risk score of 100 halves
     a crop's weight and 0 leaves it untouched.
  3. At most MAX_CROPS crops, each on at least MIN_PARCEL_ACRES; a farm too
     small for two parcels gets one crop.
  4. With two or more crops, none takes more than MAX_SHARE of the land; the
     last crop takes whatever remains.

This replaced a split proportional to smart_score with a 0.5-acre floor per
crop, which spread 10 acres in Medak across 19 crops -- 12 of them
loss-making -- for a negative total.
"""
from __future__ import annotations

from typing import Any

MAX_CROPS = 3
MIN_PARCEL_ACRES = 0.5
MAX_SHARE = 0.6


def _risk_adjusted_per_acre(rec: dict[str, Any], total_area: float) -> float:
    return (rec["expected_profit"] / total_area) * (1 - rec["risk_score"] / 200.0)


def _split(total: float, k: int) -> list[float]:
    """Areas for k ranked crops: each capped at MAX_SHARE of the land (when
    k > 1) while leaving MIN_PARCEL_ACRES for every crop still to come."""
    if k == 1:
        return [total]
    cap = total * MAX_SHARE
    areas: list[float] = []
    remaining = total
    for i in range(k):
        still_to_come = k - i - 1
        if still_to_come == 0:
            areas.append(remaining)
        else:
            area = min(cap, remaining - still_to_come * MIN_PARCEL_ACRES)
            areas.append(area)
            remaining -= area
    return areas


def allocate(recs: list[dict[str, Any]], total_area: float, budget_per_acre: float) -> dict[str, Any]:
    """Allocate `total_area` across `recs`.

    Each rec is a recommend_crops() entry whose `expected_profit` was computed
    for the whole `total_area`; per-parcel profit scales linearly from it.
    """
    profitable = sorted(
        (r for r in recs if r["expected_profit"] > 0),
        key=lambda r: _risk_adjusted_per_acre(r, total_area),
        reverse=True,
    )
    if not profitable:
        return {"allocations": [], "total_expected_profit": 0.0,
                "single_crop_best": None, "diversification_cost": 0.0}

    if total_area < 2 * MIN_PARCEL_ACRES:
        k = 1
    else:
        k = min(MAX_CROPS, len(profitable), int(total_area // MIN_PARCEL_ACRES))

    allocations = []
    for rec, area in zip(profitable[:k], _split(total_area, k)):
        allocations.append({
            "crop_id": rec["crop_id"],
            "crop_name": rec["crop_name"],
            "allocated_acres": round(area, 2),
            "allocated_budget": round(area * budget_per_acre, 2),
            "expected_profit": round(rec["expected_profit"] * area / total_area, 2),
            "roi_percent": rec["roi_percent"],
            "risk_score": rec["risk_score"],
            "smart_score": rec["smart_score"],
        })

    total = round(sum(a["expected_profit"] for a in allocations), 2)
    best = max(profitable, key=lambda r: r["expected_profit"])
    return {
        "allocations": allocations,
        "total_expected_profit": total,
        "single_crop_best": {
            "crop_id": best["crop_id"],
            "crop_name": best["crop_name"],
            "expected_profit": best["expected_profit"],
        },
        "diversification_cost": round(best["expected_profit"] - total, 2),
    }
