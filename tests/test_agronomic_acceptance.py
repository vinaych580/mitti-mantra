"""Agronomic acceptance set (Phase 2, spec 2.3).

For each pilot district x kharif/rabi, at the district's typical budget, the top three
must include one of the district's two largest crops by recorded area, and must not
include a crop no district in the state has on record. Built from DES APY area by
scripts/ml/build_agronomic_acceptance.py. The gate is >= 90% of cases.

Known misses at the time of writing (3 of 59), where the economics honestly differ
from what is grown: Belagavi rabi (maize and wheat out-earn jowar), Palakkad rabi (a
one-crop record), Nashik rabi (maize is the only crop that turns a profit).
"""
from __future__ import annotations

import json
from pathlib import Path

import pytest

import ml.predict as P
from utils import store

CASES = json.loads((Path(__file__).parent / "fixtures" / "agronomic_acceptance.json")
                   .read_text(encoding="utf-8"))["cases"]
GATE = 0.90

pytestmark = pytest.mark.skipif(not store.available(), reason="needs dataset/serving.sqlite")


def _passes(case) -> tuple[bool, list[str]]:
    budget = P.typical_budget_per_acre(case["region_id"], case["season"])
    top = [r["crop_id"] for r in P.recommend_crops(case["region_id"], case["season"], budget, 2, top_k=3)]
    ok = any(c in top for c in case["must_include_any"]) and not any(c in case["must_not_include"] for c in top)
    return ok, top


def test_agronomic_acceptance_gate():
    results = [(c, *_passes(c)) for c in CASES]
    failed = [(c["region_id"], c["season"], top, c["must_include_any"]) for c, ok, top in results if not ok]
    rate = 1 - len(failed) / len(CASES)
    assert rate >= GATE, f"{rate:.0%} of {len(CASES)} cases pass (gate {GATE:.0%}); failing: {failed}"


def test_no_shortlist_crop_is_unknown_to_the_state_when_a_known_one_pays():
    for c in CASES:
        budget = P.typical_budget_per_acre(c["region_id"], c["season"])
        recs = P.recommend_crops(c["region_id"], c["season"], budget, 2, top_k=3)
        if any(r.get("grown_in_state") for r in recs):
            assert all(r.get("grown_in_state", True) for r in recs), (c["region_id"], c["season"], recs)
