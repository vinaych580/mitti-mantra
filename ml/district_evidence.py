"""What a district's own record says about a crop (Phase 2, spec 2.3).

Two signals for the recommender, both from the serving store (dataset/serving.sqlite):

- ``adoption_share``: the crop's share of the district's recorded area in the season,
  over the last five years on record. Shown as evidence ("grown on 38% of kharif area
  here") and used as a mild prior, so a crop nobody grows nearby needs stronger
  economics to rank.
- ``revenue_variability``: the spread of log yield across recorded seasons combined
  with the spread of log weekly prices, i.e. how much a season's revenue moves. It
  replaces the hand-set drought/heat/flood risk terms wherever the record exists.

Each function returns None (or an empty dict) where the store has no record, and the
caller keeps its rule-based value.
"""
from __future__ import annotations

import math
from functools import lru_cache
from typing import Any

from utils import store

ADOPTION_YEARS = 5
# Adoption at or above this share earns the full prior; below it the prior falls
# with the square root, so 1% of area still earns ~45% of it and 0% earns none.
ADOPTION_FULL_AT = 0.05
# Revenue log-spread that maps to a risk score of 100. A crop whose revenue swings by
# a factor of e^0.6 (~1.8x) between ordinary seasons is as risky as the scale goes.
RISK_FULL_AT = 0.6
PRICE_WEEKS = 156

_SEASON_ALIASES = {"kharif": ("kharif",), "rabi": ("rabi",), "zaid": ("zaid",)}


def _seasons(season: str) -> tuple[str, ...]:
    return _SEASON_ALIASES.get(season.lower(), (season.lower(),))


@lru_cache(maxsize=512)
def adoption_shares(district_id: str, season: str) -> dict[str, float]:
    """{crop_id: share of the season's recorded area}, last ADOPTION_YEARS on record.

    Whole-year crops (sugarcane, turmeric...) are recorded as annual; they count toward
    every season, because they occupy the land through it.
    """
    seasons = _seasons(season) + ("annual", "perennial")
    marks = ",".join("?" * len(seasons))
    rows = store.query(
        f"SELECT crop_id, year, area_acres FROM yield_dcy WHERE district_id = ? "
        f"AND season IN ({marks}) AND area_acres > 0", (district_id, *seasons))
    if not rows:
        return {}
    last = max(r["year"] for r in rows)
    recent = [r for r in rows if r["year"] > last - ADOPTION_YEARS]
    total = sum(r["area_acres"] for r in recent)
    if total <= 0:
        return {}
    by_crop: dict[str, float] = {}
    for r in recent:
        by_crop[r["crop_id"]] = by_crop.get(r["crop_id"], 0.0) + r["area_acres"]
    return {c: a / total for c, a in by_crop.items()}


# DES records basmati inside "rice". Rice's record stands in for basmati's only in the
# states of the basmati GI area (APEDA): J&K, Himachal, Punjab, Uttarakhand, Haryana,
# Delhi and Uttar Pradesh (LGD state codes). Elsewhere basmati has no record.
EVIDENCE_ALIAS = {"paddy_basmati": ("rice", frozenset({"1", "2", "3", "5", "6", "7", "9"}))}
# Points off the smart score for a crop no district in the state has on record.
NOT_IN_STATE_PENALTY = 10.0


def evidence_crop(crop_id: str, district_id: str) -> str | None:
    """The crop whose record counts as evidence for crop_id here (None: none does)."""
    alias = EVIDENCE_ALIAS.get(crop_id)
    if alias is None:
        return crop_id
    stand_in, states = alias
    return stand_in if district_id.split("-")[0] in states else None


@lru_cache(maxsize=4096)
def state_has_record(district_id: str, crop_id: str, season: str) -> bool:
    """Does any district in this district's state record the crop in the season?"""
    crop = evidence_crop(crop_id, district_id)
    if crop is None:
        return False
    seasons = _seasons(season) + ("annual", "perennial")
    marks = ",".join("?" * len(seasons))
    state = district_id.split("-")[0]
    rows = store.query(
        f"SELECT 1 FROM yield_dcy WHERE district_id LIKE ? AND crop_id = ? AND season IN ({marks}) "
        f"AND area_acres > 0 LIMIT 1", (f"{state}-%", crop, *seasons))
    return bool(rows)


@lru_cache(maxsize=256)
def district_for_region(region_id: str) -> str | None:
    """The canonical district_id behind one of the app's region_ids, if any."""
    rows = store.query("SELECT district_id FROM districts WHERE region_id = ? LIMIT 1", (region_id,))
    return rows[0]["district_id"] if rows else None


def adoption_term(share: float | None) -> float | None:
    """0-100 prior from an adoption share; None without a record."""
    if share is None:
        return None
    return 100.0 * min(1.0, math.sqrt(max(share, 0.0) / ADOPTION_FULL_AT))


def _log_sd(values: list[float]) -> float | None:
    logs = [math.log(v) for v in values if v and v > 0]
    if len(logs) < 4:
        return None
    m = sum(logs) / len(logs)
    return math.sqrt(sum((x - m) ** 2 for x in logs) / (len(logs) - 1))


@lru_cache(maxsize=2048)
def revenue_variability(district_id: str, crop_id: str, season: str) -> dict[str, Any] | None:
    """{"yield_log_sd", "price_log_sd", "revenue_log_sd", "risk_score"} or None."""
    seasons = _seasons(season) + ("annual", "perennial")
    marks = ",".join("?" * len(seasons))
    yrows = store.query(
        f"SELECT year, yield_kg_acre FROM yield_dcy WHERE district_id = ? AND crop_id = ? "
        f"AND season IN ({marks}) ORDER BY year", (district_id, crop_id, *seasons))
    ysd = _log_sd([r["yield_kg_acre"] for r in yrows])
    if ysd is None:
        return None
    prows = store.query(
        "SELECT price_paise_kg FROM price_district_weekly WHERE district_id = ? AND crop_id = ? "
        "ORDER BY week DESC LIMIT ?", (district_id, crop_id, PRICE_WEEKS))
    psd = _log_sd([r["price_inr_kg"] for r in prows])
    rev = math.sqrt(ysd ** 2 + (psd or 0.0) ** 2)
    return {
        "yield_log_sd": round(ysd, 4),
        "price_log_sd": None if psd is None else round(psd, 4),
        "revenue_log_sd": round(rev, 4),
        "seasons_on_record": len(yrows),
        "risk_score": round(min(100.0, 100.0 * rev / RISK_FULL_AT), 2),
    }


@lru_cache(maxsize=512)
def unrecorded_risk(district_id: str, season: str) -> float | None:
    """Risk for a crop the district has no record of: as risky as the riskiest crop it
    does record. No evidence is not evidence of safety; the rule-based drought/heat
    terms are far gentler than any measured record, so without this an unproven crop
    looked safer than every crop farmers there actually grow."""
    risks = [v["risk_score"] for c in adoption_shares(district_id, season)
             if (v := revenue_variability(district_id, c, season)) is not None]
    return max(risks) if risks else None


def reset() -> None:
    unrecorded_risk.cache_clear()
    state_has_record.cache_clear()
    adoption_shares.cache_clear()
    revenue_variability.cache_clear()
    district_for_region.cache_clear()
