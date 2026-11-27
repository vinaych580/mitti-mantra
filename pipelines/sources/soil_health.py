"""A11 — Soil Health Card nutrient status, via India Data Portal.

The portal publishes, per village and nutrient, how many soil samples fell in
each rating class (Low / Medium / High for N, P, K and organic carbon;
Acidic / Neutral / Alkaline for pH; Deficient / Sufficient for micronutrients;
Saline / Non Saline for EC). 2023-24 and 2024-25, ~10.9M rows, ODC-By.

These are counts of real lab-tested samples, so the honest district summary is
the share of samples in each class — not a made-up average value. This
replaces data_ingestion/fetchers/soil_health_card.py, which returned random
numbers (AUDIT D-3).

The download is aggregated on the server to (district, year, nutrient, level),
one query per state.

stage() writes soil_district.parquet, one row per (district, year, nutrient):
  n_samples, share_low, share_medium, share_high      (3-class nutrients)
  share_acidic, share_neutral, share_alkaline          (pH)
  share_deficient, share_sufficient                    (micronutrients)
  share_saline, share_non_saline                       (EC)
"""
from __future__ import annotations

from pathlib import Path

from pipelines.common import RAW, STAGED, ensure_dirs, log, portal_sql_all, read_fetch_meta, \
    write_fetch_meta

RESOURCE_ID = "024cf507-4281-4c89-a40e-37b5add3a4df"
RAW_DIR = RAW / "soil_health"
SOURCE = "Soil Health Card nutrient analysis (DA&FW) via India Data Portal"
LICENCE = "ODC-By 1.0"

NUTRIENT_IDS = {
    "Nitrogen": "n", "Phosphorus": "p", "Potassium": "k", "Organic Carbon": "oc", "Soil Ph": "ph",
    "Electrical Conductivity": "ec", "Sulphur": "s", "Zinc": "zn", "Iron": "fe", "Copper": "cu",
    "Manganese": "mn", "Boron": "b",
}


def _state_codes() -> list[str]:
    rows = portal_sql_all(f'SELECT DISTINCT state_code FROM "{RESOURCE_ID}" ORDER BY state_code')
    return [str(r["state_code"]) for r in rows if r["state_code"] not in (None, "")]


def download(force: bool = False) -> Path:
    import pandas as pd

    RAW_DIR.mkdir(parents=True, exist_ok=True)
    for sc in _state_codes():
        path = RAW_DIR / f"state_{sc}.csv"
        if path.exists() and not force:
            continue
        rows = portal_sql_all(f"""
SELECT state_code, district_code, max(state_name) AS state_name, max(district_name) AS district_name,
       year, nutrient_name, nutrient_level, sum(value) AS n_samples
FROM "{RESOURCE_ID}"
WHERE state_code = '{sc}'
GROUP BY state_code, district_code, year, nutrient_name, nutrient_level
ORDER BY district_code, year, nutrient_name, nutrient_level""")
        pd.DataFrame(rows).to_csv(path, index=False)
        log.info("soil_health state %s: %d rows", sc, len(rows))
    write_fetch_meta(RAW_DIR, resource=RESOURCE_ID)
    return RAW_DIR


def stage(raw_dir: Path = RAW_DIR, out: Path | None = None):
    import pandas as pd

    ensure_dirs()
    meta = read_fetch_meta(raw_dir)
    frames = []
    for p in sorted(raw_dir.glob("state_*.csv")):
        try:
            f = pd.read_csv(p, dtype={"state_code": str, "district_code": str})
        except pd.errors.EmptyDataError:
            continue
        if not f.empty:
            frames.append(f)
    df = pd.concat(frames, ignore_index=True)
    df = df[df["district_code"].notna() & df["nutrient_name"].isin(NUTRIENT_IDS)].copy()
    df["n_samples"] = pd.to_numeric(df["n_samples"], errors="coerce").fillna(0)
    df["year"] = df["year"].str.slice(0, 4).astype(int)
    df["nutrient"] = df["nutrient_name"].map(NUTRIENT_IDS)
    df["level"] = "share_" + df["nutrient_level"].str.strip().str.lower().str.replace(" ", "_")

    key = ["state_code", "district_code", "year", "nutrient"]
    wide = df.pivot_table(index=key, columns="level", values="n_samples", aggfunc="sum", fill_value=0)
    total = wide.sum(axis=1)
    shares = wide.div(total.where(total > 0), axis=0).round(4)
    shares["n_samples"] = total.astype(int)
    shares = shares[shares["n_samples"] > 0].reset_index()
    names = df.groupby(["state_code", "district_code"], as_index=False).agg(
        state_name=("state_name", "first"), district_name=("district_name", "first"))
    shares = shares.merge(names, on=["state_code", "district_code"], how="left")
    shares.columns.name = None
    shares["source"] = SOURCE
    shares["source_version"] = RESOURCE_ID[:8]
    shares["fetched_at"] = meta["fetched_at"]
    shares["licence"] = LICENCE
    shares["is_synthetic"] = False

    out = out or STAGED / "soil_district.parquet"
    shares.to_parquet(out, index=False)
    log.info("soil_health: staged %d district-year-nutrient rows, %d districts", len(shares),
             shares["district_code"].nunique())
    return shares
