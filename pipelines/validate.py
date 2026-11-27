"""Validation gates on the curated store (spec 1.4). Any violation fails the build.

    python -m pipelines.validate [--allow-shrink]
"""
from __future__ import annotations

import json
import sys

from pipelines.common import CURATED, MANIFEST, log

MAX_SHRINK = 0.05
OPTIONAL_TABLES = ("cost_state_crop", "msp", "soil_district", "irrigation_share", "weather_stage",
                   "monsoon_onset")


class ValidationError(RuntimeError):
    pass


def _check(errors: list[str], ok: bool, msg: str) -> None:
    if not ok:
        errors.append(msg)


def validate(allow_shrink: bool = False) -> list[str]:
    import pandas as pd

    errors: list[str] = []
    t = {n: pd.read_parquet(CURATED / f"{n}.parquet") for n in
         ("districts", "yield_dcy", "price_district_weekly", "weather_daily", "weather_season")}
    for n in OPTIONAL_TABLES:  # gated when built; their absence is a warning in build_curated
        if (CURATED / f"{n}.parquet").exists():
            t[n] = pd.read_parquet(CURATED / f"{n}.parquet")

    for name, df in t.items():
        if name == "districts":
            continue
        for col in ("source", "fetched_at", "licence", "is_synthetic"):
            _check(errors, col in df.columns, f"{name}: missing provenance column {col}")
        if "is_synthetic" in df:
            _check(errors, not df["is_synthetic"].any(), f"{name}: {int(df['is_synthetic'].sum())} synthetic rows")

    y = t["yield_dcy"]
    _check(errors, not y.duplicated(["district_id", "crop_id", "season", "year"]).any(), "yield_dcy: duplicate keys")
    _check(errors, (y["yield_kg_acre"] > 0).all(), "yield_dcy: non-positive yield")
    _check(errors, (y["area_ha"] > 0).all(), "yield_dcy: non-positive area")
    _check(errors, y["season"].isin(["kharif", "rabi", "zaid", "annual", "perennial"]).all(), "yield_dcy: bad season")
    _check(errors, y["year"].between(1990, 2100).all(), "yield_dcy: year out of range")

    p = t["price_district_weekly"]
    _check(errors, not p.duplicated(["district_id", "crop_id", "week"]).any(), "prices: duplicate keys")
    _check(errors, (p["price_inr_kg"] > 0).all(), "prices: non-positive price")
    _check(errors, p["crop_id"].notna().all(), "prices: unmapped commodity")

    w = t["weather_daily"]
    _check(errors, not w.duplicated(["district_id", "date"]).any(), "weather_daily: duplicate keys")
    _check(errors, (w["rain_mm"].dropna() >= 0).all(), "weather_daily: negative rain")
    both = w.dropna(subset=["tmin", "tmax"])
    _check(errors, (both["tmin"] <= both["tmax"] + 0.05).all(), "weather_daily: tmin above tmax")
    _check(errors, both["tmax"].between(-40, 55).all(), "weather_daily: tmax out of range")

    s = t["weather_season"]
    _check(errors, not s.duplicated(["district_id", "season", "year"]).any(), "weather_season: duplicate keys")

    if "cost_state_crop" in t:
        c = t["cost_state_crop"]
        _check(errors, not c.duplicated(["state_code", "crop_id", "year"]).any(), "costs: duplicate keys")
        _check(errors, (c["cost_a2_inr_acre"] > 0).all(), "costs: non-positive A2 cost")
        ok = c.dropna(subset=["cost_c2_inr_acre"])
        _check(errors, (ok["cost_c2_inr_acre"] >= ok["cost_a2_inr_acre"] - 1).all(), "costs: C2 below A2")

    if "msp" in t:
        m = t["msp"]
        _check(errors, not m.duplicated(["crop_id", "year", "season"]).any(), "msp: duplicate keys")
        _check(errors, (m["msp_inr_per_quintal"] > 0).all(), "msp: non-positive MSP")

    if "soil_district" in t:
        s = t["soil_district"]
        _check(errors, not s.duplicated(["district_id", "year", "nutrient"]).any(), "soil: duplicate keys")
        shares = s[[c for c in s.columns if c.startswith("share_")]]
        _check(errors, ((shares.fillna(0) >= 0) & (shares.fillna(0) <= 1)).all().all(), "soil: share outside 0-1")
        _check(errors, ((shares.sum(axis=1) - 1).abs() < 0.01).all(), "soil: shares do not sum to 1")

    if "irrigation_share" in t:
        ir = t["irrigation_share"]
        _check(errors, not ir.duplicated(["district_id", "crop_id", "year"]).any(), "irrigation: duplicate keys")
        _check(errors, (ir["irrigated_share"].dropna() >= 0).all(), "irrigation: negative share")

    if "weather_stage" in t:
        ws = t["weather_stage"]
        _check(errors, not ws.duplicated(["district_id", "crop_id", "season", "year", "stage_idx"]).any(),
               "weather_stage: duplicate keys")
        _check(errors, (ws["rain_mm"] >= 0).all(), "weather_stage: negative rain")
        _check(errors, (ws["dry_spell_max_days"] <= ws["n_days"]).all(), "weather_stage: dry spell longer than stage")

    d = t["districts"]
    _check(errors, d["district_id"].is_unique, "districts: duplicate district_id")
    _check(errors, (d["region_id"] != "").sum() == 30, "districts: expected 30 pilot regions")
    for name in ("yield_dcy", "price_district_weekly", "weather_season"):
        unknown = set(t[name]["district_id"]) - set(d["district_id"])
        _check(errors, not unknown, f"{name}: {len(unknown)} district ids not in districts")

    current = json.loads((CURATED / "manifest.json").read_text(encoding="utf-8"))
    if MANIFEST.exists() and not allow_shrink:
        prev = json.loads(MANIFEST.read_text(encoding="utf-8"))
        for name, info in prev.get("tables", {}).items():
            now = current["tables"].get(name, {}).get("rows", 0)
            if info["rows"] and now < info["rows"] * (1 - MAX_SHRINK):
                errors.append(f"{name}: rows fell from {info['rows']} to {now} (pass --allow-shrink if intended)")
    return errors


def main(argv: list[str] | None = None) -> int:
    argv = argv if argv is not None else sys.argv[1:]
    errors = validate(allow_shrink="--allow-shrink" in argv)
    for e in errors:
        log.error("validate: %s", e)
        print(f"FAIL {e}")
    if not errors:
        print("validate: all gates passed")
    return 1 if errors else 0


if __name__ == "__main__":
    import logging

    logging.basicConfig(level=logging.INFO, format="%(message)s")
    raise SystemExit(main())
