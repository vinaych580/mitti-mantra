"""A7 — Cost of Cultivation (DES / CACP), via India Data Portal.

State-by-crop cost per hectare from the Comprehensive Scheme farm surveys,
1996-97 to 2021-22, ~3,900 rows. ODC-By. One state-crop-year is one survey
estimate; a state is only surveyed for the crops it grows a lot of, so many
state-crop pairs have no row. Missing stays missing.

Cost concepts (CACP definitions):
  A2     paid-out costs: seed, fertiliser, hired labour and machinery, rent paid...
  A2+FL  A2 plus the imputed value of family labour  (the MSP benchmark)
  C2     A2+FL plus imputed rent and interest on owned land and capital

stage() writes cost_state_crop.parquet with per-acre rupees (the app's unit)
and the main paid-out components, at grain (state_code, crop_id, year).
"""
from __future__ import annotations

from pathlib import Path

from pipelines.common import HA_PER_ACRE, RAW, STAGED, agri_year_start, ensure_dirs, log, \
    portal_sql_all, read_fetch_meta, read_reference, write_fetch_meta

RESOURCE_ID = "be22e37e-acfc-43a9-859c-d4a066489a69"
RAW_DIR = RAW / "costs"
RAW_FILE = RAW_DIR / "cost_of_cultivation.csv"
SOURCE = "DES Cost of Cultivation (CACP farm surveys) via India Data Portal"
LICENCE = "ODC-By 1.0"

# per-hectare source columns -> per-acre staged columns
PER_HA = {
    "cul_cost_a2": "cost_a2", "cul_cost_a2fl": "cost_a2fl", "cul_cost_c2": "cost_c2",
    "opr_cost_seed": "seed", "opr_cost_fertilizer": "fertilizer", "opr_cost_manure": "manure",
    "opr_cost_insecticides": "pesticide", "opr_cost_irrigation_chrg": "irrigation",
    "opr_cost_hmn_lab_casual": "hired_labour", "opr_cost_hmn_lab_family": "family_labour",
    "opr_cost_mch_lab_hired": "machinery_hired", "opr_cost_mch_lab_owned": "machinery_owned",
    "main_product_value": "main_product_value",
}


def download(force: bool = False) -> Path:
    import pandas as pd

    if RAW_FILE.exists() and not force:
        return RAW_FILE
    cols = ", ".join(["year", "state_code", "state_name", "crop_name", "num_holdings_sample",
                      "derived_yield", "prod_cost_a2fl", "prod_cost_c2", *PER_HA])
    rows = portal_sql_all(f'SELECT {cols} FROM "{RESOURCE_ID}" ORDER BY _id')
    RAW_DIR.mkdir(parents=True, exist_ok=True)
    pd.DataFrame(rows).to_csv(RAW_FILE, index=False)
    write_fetch_meta(RAW_DIR, resource=RESOURCE_ID, rows=len(rows))
    log.info("costs: %d rows", len(rows))
    return RAW_FILE


def stage(raw_file: Path = RAW_FILE, out: Path | None = None):
    import pandas as pd

    ensure_dirs()
    meta = read_fetch_meta(raw_file.parent)
    crop_of = {r["coc_name"]: r["crop_id"] for r in read_reference("crop_aliases.csv") if r["coc_name"]}
    df = pd.read_csv(raw_file, dtype={"state_code": str})
    df = df[df["crop_name"].isin(crop_of)].copy()
    df["crop_id"] = df["crop_name"].map(crop_of)
    df["year"] = df["year"].map(agri_year_start)
    # A2+FL is blank in older rows; A2 is always reported, so A2+FL is left
    # blank rather than derived from columns the survey may not have filled.
    for src, dst in PER_HA.items():
        df[f"{dst}_inr_acre"] = pd.to_numeric(df[src], errors="coerce") * HA_PER_ACRE
    df = df[df["cost_a2_inr_acre"] > 0]
    df = df.rename(columns={"num_holdings_sample": "n_holdings", "derived_yield": "yield_q_ha",
                            "prod_cost_a2fl": "cost_a2fl_inr_quintal", "prod_cost_c2": "cost_c2_inr_quintal"})
    keep = ["state_code", "state_name", "crop_id", "year", "n_holdings", "yield_q_ha",
            "cost_a2fl_inr_quintal", "cost_c2_inr_quintal", *[f"{d}_inr_acre" for d in PER_HA.values()]]
    df = df[keep]
    # Two survey rows for one state-crop-year (rare: a re-released estimate):
    # keep the one with the larger sample.
    df = (df.sort_values("n_holdings").drop_duplicates(["state_code", "crop_id", "year"], keep="last")
            .sort_values(["state_code", "crop_id", "year"]).reset_index(drop=True))
    df["source"] = SOURCE
    df["source_version"] = RESOURCE_ID[:8]
    df["fetched_at"] = meta["fetched_at"]
    df["licence"] = LICENCE
    df["is_synthetic"] = False

    out = out or STAGED / "cost_state_crop.parquet"
    df.to_parquet(out, index=False)
    log.info("costs: staged %d state-crop-years, %d crops, %d-%d", len(df), df["crop_id"].nunique(),
             df["year"].min(), df["year"].max())
    return df
