"""
Turn a disease screening result into something a farmer can act on.

`/api/disease/predict` returned a label and prose paragraphs, which leaves the
farmer to work out the part that actually matters: how much product to buy for
*their* plot, what it costs, and how long they must wait before harvesting.
This module scales the options in dataset/disease_treatments.csv to the plot
area and attaches the safety intervals.

Two intervals are carried through deliberately, because getting them wrong is
the difference between a saleable crop and a rejected one:

  PHI (pre-harvest interval) — days between the last spray and harvest.
  Re-entry — hours before anyone may safely walk back into the sprayed field.

None of this is a prescription. The screening upstream is a colour/texture
heuristic, not a validated diagnostic, and the registered product label is the
legal authority on dose and interval in every case.
"""

from __future__ import annotations

from datetime import date, timedelta
from typing import Any, Dict, List, Optional

from utils.csv_cache import load as _csv_load

_CSV = "disease_treatments.csv"

# Standard spray volume when a row does not state one, in litres per acre.
_DEFAULT_SPRAY_VOLUME_L = 200.0

SAFETY_NOTES = [
    "Read the product label before mixing — the label dose and pre-harvest interval override anything shown here.",
    "Wear gloves, a mask and full sleeves while mixing and spraying.",
    "Spray in still air, early morning or late evening — never into wind or midday heat.",
    "Do not re-enter the field, and keep children and livestock out, until the re-entry period has passed.",
    "Never reuse pesticide containers. Triple-rinse and dispose of them away from water sources.",
]


def _rows() -> List[Dict[str, str]]:
    try:
        return _csv_load(_CSV)
    except Exception:
        return []


def _to_float(value: Any, default: float = 0.0) -> float:
    try:
        return float(value)
    except (TypeError, ValueError):
        return default


def _to_int(value: Any, default: int = 0) -> int:
    try:
        return int(float(value))
    except (TypeError, ValueError):
        return default


def _quantity_for_area(row: Dict[str, str], area_acres: float) -> Optional[Dict[str, Any]]:
    """Total product needed across the whole plot, in a purchasable unit."""
    unit = (row.get("dose_unit") or "").strip()
    dose = _to_float(row.get("dose_value"))
    if unit in ("", "none") or dose <= 0:
        return None

    spray_volume = _to_float(row.get("spray_volume_l_per_acre"), _DEFAULT_SPRAY_VOLUME_L)
    if spray_volume <= 0:
        spray_volume = _DEFAULT_SPRAY_VOLUME_L

    if unit == "g_per_l":
        grams = dose * spray_volume * area_acres
        return _pack(grams, "g", "kg", 1000.0)
    if unit == "ml_per_l":
        millilitres = dose * spray_volume * area_acres
        return _pack(millilitres, "ml", "L", 1000.0)
    if unit == "g_per_acre":
        return _pack(dose * area_acres, "g", "kg", 1000.0)
    if unit == "kg_per_acre":
        return {"value": round(dose * area_acres, 2), "unit": "kg"}
    if unit == "l_per_acre":
        return {"value": round(dose * area_acres, 2), "unit": "L"}
    return None


def _pack(amount: float, small_unit: str, large_unit: str, factor: float) -> Dict[str, Any]:
    """Present 3400 g as 3.4 kg — farmers buy in the larger unit."""
    if amount >= factor:
        return {"value": round(amount / factor, 2), "unit": large_unit}
    return {"value": round(amount, 1), "unit": small_unit}


def _severity_multiplier(severity: Optional[str]) -> float:
    """How many of the recommended applications a given severity warrants.

    A mild infection does not need the full course, but a severe one never
    warrants *more* than the label allows — so this only ever scales down.
    Accepts both severity vocabularies used by the screening endpoint
    (low/medium/high and healthy/early/moderate/severe).
    """
    return {
        "healthy": 0.5,
        "early": 0.5,
        "low": 0.5,
        "moderate": 1.0,
        "medium": 1.0,
        "severe": 1.0,
        "high": 1.0,
    }.get((severity or "medium").lower(), 1.0)


def _build_option(row: Dict[str, str], area_acres: float, severity: Optional[str]) -> Dict[str, Any]:
    applications = _to_int(row.get("applications"), 1)
    if applications > 1:
        applications = max(1, round(applications * _severity_multiplier(severity)))

    per_application = _quantity_for_area(row, area_acres)
    cost_per_acre = _to_float(row.get("approx_cost_inr_per_acre"))
    total_cost = round(cost_per_acre * area_acres * applications)

    spray_volume = _to_float(row.get("spray_volume_l_per_acre"), 0.0)
    phi_days = _to_int(row.get("phi_days"))
    interval_days = _to_int(row.get("interval_days"))

    option: Dict[str, Any] = {
        "mode": (row.get("mode") or "").strip(),
        "product": (row.get("product") or "").strip(),
        "active_ingredient": (row.get("active_ingredient") or "").strip(),
        "dose": _dose_text(row),
        "applications": applications,
        "interval_days": interval_days,
        "quantity_per_application": per_application,
        "total_quantity": _scale_total(per_application, applications),
        "spray_volume_l_total": round(spray_volume * area_acres, 1) if spray_volume else None,
        "approx_cost_inr": total_cost,
        "approx_cost_inr_per_acre": round(cost_per_acre),
        "pre_harvest_interval_days": phi_days,
        "reentry_hours": _to_int(row.get("reentry_hours")),
        "notes": (row.get("notes") or "").strip(),
        "priority": _to_int(row.get("priority"), 99),
    }
    option["schedule"] = _schedule(applications, interval_days, phi_days)
    return option


def _dose_text(row: Dict[str, str]) -> str:
    unit = (row.get("dose_unit") or "").strip()
    dose = _to_float(row.get("dose_value"))
    if unit in ("", "none") or dose <= 0:
        return "No spray — cultural practice"
    labels = {
        "g_per_l": "g per litre of water",
        "ml_per_l": "ml per litre of water",
        "g_per_acre": "g per acre",
        "kg_per_acre": "kg per acre",
        "l_per_acre": "litres per acre",
    }
    return f"{dose:g} {labels.get(unit, unit)}"


def _scale_total(per_application: Optional[Dict[str, Any]], applications: int) -> Optional[Dict[str, Any]]:
    if not per_application or applications <= 1:
        return per_application
    return {
        "value": round(per_application["value"] * applications, 2),
        "unit": per_application["unit"],
    }


def _schedule(applications: int, interval_days: int, phi_days: int) -> List[Dict[str, Any]]:
    """Concrete calendar dates — 'in 10 days' is easier to act on than 'repeat at 10 day intervals'."""
    if applications <= 0:
        return []
    today = date.today()
    steps: List[Dict[str, Any]] = []
    for i in range(applications):
        when = today + timedelta(days=i * max(interval_days, 0))
        steps.append({
            "application": i + 1,
            "date": when.isoformat(),
            "label": "Today" if i == 0 else f"In {(when - today).days} days",
        })
    if phi_days > 0 and steps:
        last = date.fromisoformat(steps[-1]["date"])
        steps.append({
            "application": None,
            "date": (last + timedelta(days=phi_days)).isoformat(),
            "label": f"Earliest safe harvest ({phi_days}-day pre-harvest interval)",
            "is_harvest_gate": True,
        })
    return steps


def build_action_plan(
    class_name: str,
    area_acres: float = 1.0,
    severity: Optional[str] = None,
) -> Dict[str, Any]:
    """Costed, area-scaled treatment options for a screened disease class.

    Returns an empty `options` list when the class has no treatment rows, which
    the caller should present as "no action recorded" rather than "nothing to do".
    """
    area = max(0.01, _to_float(area_acres, 1.0))
    rows = [r for r in _rows() if (r.get("class_name") or "").strip() == class_name]

    options = sorted(
        (_build_option(r, area, severity) for r in rows),
        key=lambda o: (o["priority"], o["approx_cost_inr"]),
    )

    organic = [o for o in options if o["mode"] == "organic"]
    chemical = [o for o in options if o["mode"] == "chemical"]

    is_healthy = class_name.endswith("_healthy")
    sprays = [o for o in options if o["applications"] > 0 and o["quantity_per_application"]]

    if is_healthy:
        headline = "No treatment needed — keep scouting."
    elif not options:
        headline = "No treatment plan is recorded for this result."
    elif not sprays:
        headline = "This one is managed by practice, not by spraying."
    else:
        cheapest = min(sprays, key=lambda o: o["approx_cost_inr"])
        headline = (
            f"Start with {cheapest['product']} — about ₹{cheapest['approx_cost_inr']:,} "
            f"for {area:g} acre{'s' if area != 1 else ''}."
        )

    longest_phi = max((o["pre_harvest_interval_days"] for o in options), default=0)

    return {
        "class_name": class_name,
        "area_acres": round(area, 2),
        "severity": severity,
        "headline": headline,
        "recommended_first": (organic[0] if organic else (options[0] if options else None)),
        "options": options,
        "organic_options": organic,
        "chemical_options": chemical,
        "max_pre_harvest_interval_days": longest_phi,
        "safety": SAFETY_NOTES,
        "disclaimer": (
            "Generated from a preliminary visual screening, not a laboratory "
            "diagnosis. Confirm the symptoms with your local agriculture officer "
            "or KVK before spending money on inputs. Costs are indicative Indian "
            "retail estimates and vary by brand and district."
        ),
    }


def treatable_classes() -> List[str]:
    """Every class with at least one recorded treatment row."""
    return sorted({(r.get("class_name") or "").strip() for r in _rows() if r.get("class_name")})
