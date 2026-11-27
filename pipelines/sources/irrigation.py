"""A12 — Crop-wise irrigated area (Land Use Statistics), via India Data Portal.

District x crop x year irrigated area in hectares, 1998-99 to 2023-24. ODC-By.
Most rows carry no season, so irrigated area is summed over the year and the
share is taken against the crop's total sown area for the same district-year
from the yield table (A1). The share is computed in build_curated, where both
tables have canonical district ids.

The download is aggregated on the server to (district, crop, year), one query
per crop, so no raw page approaches the portal's row cap.
"""
from __future__ import annotations

import re
from pathlib import Path

from pipelines.common import RAW, STAGED, agri_year_start, ensure_dirs, log, portal_sql_all, \
    read_fetch_meta, read_reference, write_fetch_meta

RESOURCE_ID = "0fb99c18-a1f7-46f0-b40d-ddffca021319"
RAW_DIR = RAW / "irrigation"
SOURCE = "DES Land Use Statistics, crop-wise irrigated area, via India Data Portal"
LICENCE = "ODC-By 1.0"


def _names() -> dict[str, str]:
    return {r["irrigation_name"]: r["crop_id"] for r in read_reference("crop_aliases.csv")
            if r["irrigation_name"]}


def _slug(s: str) -> str:
    return re.sub(r"[^a-z0-9]+", "_", s.lower()).strip("_")


def download(force: bool = False) -> Path:
    import pandas as pd

    RAW_DIR.mkdir(parents=True, exist_ok=True)
    for name in _names():
        path = RAW_DIR / f"{_slug(name)}.csv"
        if path.exists() and not force:
            continue
        n = name.replace("'", "''")
        rows = portal_sql_all(f"""
SELECT state_code, district_code, max(state_name) AS state_name, max(district_name) AS district_name,
       year, sum(area) AS irrigated_ha
FROM "{RESOURCE_ID}"
WHERE crop_name = '{n}' AND area IS NOT NULL
GROUP BY state_code, district_code, year
ORDER BY state_code, district_code, year""")
        pd.DataFrame(rows).assign(crop_name=name).to_csv(path, index=False)
        log.info("irrigation %s: %d district-years", name, len(rows))
    write_fetch_meta(RAW_DIR, resource=RESOURCE_ID)
    return RAW_DIR


def stage(raw_dir: Path = RAW_DIR, out: Path | None = None):
    import pandas as pd

    ensure_dirs()
    meta = read_fetch_meta(raw_dir)
    crop_of = _names()
    frames = []
    for p in sorted(raw_dir.glob("*.csv")):
        try:
            f = pd.read_csv(p, dtype={"state_code": str, "district_code": str})
        except pd.errors.EmptyDataError:
            continue
        if not f.empty:
            frames.append(f)
    df = pd.concat(frames, ignore_index=True)
    df = df[df["district_code"].notna() & (df["district_code"].astype(str).str.lower() != "nan")]
    df["crop_id"] = df["crop_name"].map(crop_of)
    df = df[df["crop_id"].notna() & (df["irrigated_ha"] >= 0)].copy()
    df["year"] = df["year"].map(agri_year_start)
    df = (df.groupby(["state_code", "district_code", "crop_id", "year"], as_index=False)
            .agg(state_name=("state_name", "first"), district_name=("district_name", "first"),
                 irrigated_ha=("irrigated_ha", "sum")))
    df["source"] = SOURCE
    df["source_version"] = RESOURCE_ID[:8]
    df["fetched_at"] = meta["fetched_at"]
    df["licence"] = LICENCE
    df["is_synthetic"] = False

    out = out or STAGED / "irrigated_area.parquet"
    df.to_parquet(out, index=False)
    log.info("irrigation: staged %d district-crop-years, %d crops, %d-%d", len(df),
             df["crop_id"].nunique(), df["year"].min(), df["year"].max())
    return df
