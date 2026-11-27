"""Staged -> curated: canonical district ids, quality flags, manifest.

Rows outside physical limits are not corrected or imputed. They are moved to
data/curated/rejected_<table>.parquet with the reason, and listed in
data/curated/quality_report.json, so a reviewer can see exactly what the
source said and why it was left out.
"""
from __future__ import annotations

import csv
import json

from pipelines.common import CURATED, DATASET, MANIFEST, STAGED, ensure_dirs, file_sha256, log, utc_now
from pipelines.districts import district_id

# Upper physical limit for a district-season average, as a multiple of the app's
# own base (potential) yield. Base yields are optimistic, so 3x is generous;
# anything above it in a district *average* is a reporting or unit error.
YIELD_MAX_X_BASE = 3.0
# Weekly prices outside [band_min / 5, band_max * 5] are unit or entry errors.
PRICE_BAND_SLACK = 5.0
# Irrigated area may exceed sown area slightly where the two DES series round
# differently; beyond 10% they disagree and the row is rejected.
IRRIGATED_SHARE_MAX = 1.10


def _crop_params() -> dict[str, dict[str, float]]:
    with (DATASET / "crop_parameters.csv").open(encoding="utf-8") as f:
        return {r["crop_id"]: {"base": float(r["base_yield_kg_per_acre"]),
                               "pmin": float(r["mandi_price_min_inr_per_kg"]),
                               "pmax": float(r["mandi_price_max_inr_per_kg"])}
                for r in csv.DictReader(f)}


def _split(df, bad_mask, reason: str, table: str, report: dict):
    bad = df[bad_mask].copy()
    bad["reject_reason"] = reason
    report.setdefault(table, {})[reason] = int(len(bad))
    return df[~bad_mask].copy(), bad


def build():
    import pandas as pd

    ensure_dirs()
    cp = _crop_params()
    districts = pd.read_parquet(STAGED / "districts.parquet")
    region_of = dict(zip(districts["district_id"], districts["region_id"]))
    report: dict = {"built_at": utc_now()}
    outputs = {}

    # ---- yields
    y = pd.read_parquet(STAGED / "yield_dcy.parquet")
    y["district_id"] = [district_id(s, d) for s, d in zip(y["state_code"], y["district_code"])]
    y["region_id"] = y["district_id"].map(region_of).fillna("")
    limit = y["crop_id"].map(lambda c: cp[c]["base"] * YIELD_MAX_X_BASE)
    y, rej_y = _split(y, y["yield_kg_acre"] > limit, f"yield above {YIELD_MAX_X_BASE}x base yield",
                      "yield_dcy", report)
    outputs["yield_dcy"] = y
    outputs["rejected_yield_dcy"] = rej_y

    # ---- prices
    p = pd.read_parquet(STAGED / "price_district_weekly.parquet")
    live_path = STAGED / "price_live_weekly.parquet"
    if live_path.exists():
        # Daily OGD snapshots extend the bulk history past its end. Where both
        # cover a district-week the bulk row wins: it is arrival-weighted.
        live = pd.read_parquet(live_path)
        p = pd.concat([p, live], ignore_index=True)
        p["_live"] = (p["resource"] == "live").astype(int)
        key = [p["state_code"].astype(str).str.split(".").str[0],
               p["district_code"].astype(str).str.split(".").str[0], p["crop_id"], p["week"].astype(str)]
        p = (p.assign(_k=list(zip(*key))).sort_values("_live").drop_duplicates("_k", keep="first")
              .drop(columns=["_live", "_k"]))
        report["price_live_weeks_added"] = int((p["resource"] == "live").sum())
    p["district_id"] = [district_id(s, d) for s, d in zip(p["state_code"], p["district_code"])]
    p["region_id"] = p["district_id"].map(region_of).fillna("")
    lo = p["crop_id"].map(lambda c: cp[c]["pmin"] / PRICE_BAND_SLACK)
    hi = p["crop_id"].map(lambda c: cp[c]["pmax"] * PRICE_BAND_SLACK)
    p, rej_p = _split(p, (p["price_inr_kg"] < lo) | (p["price_inr_kg"] > hi),
                      f"price outside reference band widened {PRICE_BAND_SLACK}x", "price_district_weekly", report)
    outputs["price_district_weekly"] = p
    outputs["rejected_price_district_weekly"] = rej_p

    # ---- weather
    for name in ("weather_daily", "weather_season"):
        w = pd.read_parquet(STAGED / f"{name}.parquet")
        w["region_id"] = w["district_id"].map(region_of).fillna("")
        outputs[name] = w

    # ---- growth-stage weather and monsoon onset, derived from daily weather
    from pipelines import weather_stage

    st, on = weather_stage.build(outputs["weather_daily"])
    fetched = outputs["weather_daily"]["fetched_at"].max()
    for name, df in (("weather_stage", st), ("monsoon_onset", on)):
        if df.empty:
            continue
        df["region_id"] = df["district_id"].map(region_of).fillna("")
        df["source"] = "Derived from NASA POWER daily with the app's crop calendar (pipelines/weather_stage.py)"
        df["source_version"] = "derived"
        df["fetched_at"] = fetched
        df["licence"] = "NASA open data (no restrictions; attribution requested)"
        df["is_synthetic"] = False
        outputs[name] = df

    # ---- state-level and national tables (no district key)
    for name in ("cost_state_crop", "msp"):
        if (STAGED / f"{name}.parquet").exists():
            outputs[name] = pd.read_parquet(STAGED / f"{name}.parquet")
        else:
            log.warning("curated: %s not staged; skipped", name)

    # ---- soil health: district shares of tested samples
    if (STAGED / "soil_district.parquet").exists():
        s = pd.read_parquet(STAGED / "soil_district.parquet")
        s["district_id"] = [district_id(a, b) for a, b in zip(s["state_code"], s["district_code"])]
        s["region_id"] = s["district_id"].map(region_of).fillna("")
        outputs["soil_district"] = s
    else:
        log.warning("curated: soil_district not staged; skipped")

    # ---- irrigation share = irrigated area / sown area (all seasons) from the yield table
    if (STAGED / "irrigated_area.parquet").exists():
        ir = pd.read_parquet(STAGED / "irrigated_area.parquet")
        ir["district_id"] = [district_id(a, b) for a, b in zip(ir["state_code"], ir["district_code"])]
        ir["region_id"] = ir["district_id"].map(region_of).fillna("")
        sown = (y.groupby(["district_id", "crop_id", "year"], as_index=False)["area_ha"].sum()
                 .rename(columns={"area_ha": "sown_ha"}))
        ir = ir.merge(sown, on=["district_id", "crop_id", "year"], how="left")
        ir["irrigated_share"] = ir["irrigated_ha"] / ir["sown_ha"]
        # The two DES series are compiled separately; a share far above 1 means
        # they disagree on area. Such rows are reported, not clipped.
        ir, rej_i = _split(ir, ir["irrigated_share"] > IRRIGATED_SHARE_MAX,
                           f"irrigated area above {IRRIGATED_SHARE_MAX}x sown area", "irrigation_share", report)
        outputs["irrigation_share"] = ir
        outputs["rejected_irrigation_share"] = rej_i
    else:
        log.warning("curated: irrigated_area not staged; skipped")

    outputs["districts"] = districts

    manifest = {"built_at": report["built_at"], "tables": {}}
    for name, df in outputs.items():
        path = CURATED / f"{name}.parquet"
        df.to_parquet(path, index=False)
        if name.startswith("rejected_"):
            continue
        manifest["tables"][name] = {
            "rows": int(len(df)), "sha256": file_sha256(path),
            "sources": sorted(df["source"].unique().tolist()) if "source" in df else [],
        }
    (CURATED / "quality_report.json").write_text(json.dumps(report, indent=2), encoding="utf-8")
    previous = json.loads(MANIFEST.read_text(encoding="utf-8")) if MANIFEST.exists() else None
    (CURATED / "manifest.json").write_text(json.dumps(manifest, indent=2), encoding="utf-8")
    log.info("curated: %s", {k: v["rows"] for k, v in manifest["tables"].items()})
    log.info("rejected: %s", report)
    return manifest, previous
