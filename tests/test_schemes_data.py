"""Scheme eligibility must match current rules.

PM-KISAN's 2-hectare landholding cap was removed in June 2019; all
landholding farmer families qualify, subject to exclusions (income-tax
payers, institutional landholders, some professionals).
"""
from engine.features import match_government_schemes


def test_pmkisan_has_no_area_cap():
    res = match_government_schemes("wheat", "punjab_ludhiana", area_acres=12)
    ids = {s["scheme_id"] for s in res["eligible_schemes"]}
    assert "pmkisan" in ids
