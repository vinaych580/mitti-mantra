"""A8 — Minimum Support Prices (CACP), via India Data Portal.

One row per crop and marketing year, 1998-99 onward (~820 rows). The portal
lists no licence for this dataset; MSPs are public announcements by the
Government of India, so the licence is recorded as such.

stage() writes msp.parquet at grain (crop_id, year, season), with `year` the
start of the marketing year ("2025-2026" -> 2025), which is how the app's
msp_prices.csv already labels kharif 2025 and rabi 2025-26.

Sugarcane has had an FRP rather than an MSP since 2009-10; the portal's
sugarcane series stops at 2017-18 and is kept as published.
"""
from __future__ import annotations

from pathlib import Path

from pipelines.common import RAW, STAGED, agri_year_start, ensure_dirs, log, portal_sql_all, \
    read_fetch_meta, read_reference, write_fetch_meta

RESOURCE_ID = "ba385522-103f-4dd6-9257-8e1d15c4a430"
RAW_DIR = RAW / "msp"
RAW_FILE = RAW_DIR / "msp.csv"
SOURCE = "CACP Minimum Support Prices via India Data Portal"
LICENCE = "Government of India public announcement (no licence stated on the mirror)"


def download(force: bool = False) -> Path:
    import pandas as pd

    if RAW_FILE.exists() and not force:
        return RAW_FILE
    rows = portal_sql_all(f'SELECT year, crop, season, min_support_price FROM "{RESOURCE_ID}" ORDER BY _id')
    RAW_DIR.mkdir(parents=True, exist_ok=True)
    pd.DataFrame(rows).to_csv(RAW_FILE, index=False)
    write_fetch_meta(RAW_DIR, resource=RESOURCE_ID, rows=len(rows))
    log.info("msp: %d rows", len(rows))
    return RAW_FILE


def stage(raw_file: Path = RAW_FILE, out: Path | None = None):
    import pandas as pd

    ensure_dirs()
    meta = read_fetch_meta(raw_file.parent)
    # msp_name may list several portal names, best first ("Cotton - Medium
    # Staple|Cotton"): the portal renamed some series, and the earlier name
    # fills only the years the preferred one lacks.
    crop_of, rank = {}, {}
    for r in read_reference("crop_aliases.csv"):
        for i, name in enumerate(n.strip() for n in r["msp_name"].split("|") if n.strip()):
            crop_of[name], rank[name] = r["crop_id"], i
    df = pd.read_csv(raw_file)
    df = df[df["crop"].isin(crop_of) & (df["min_support_price"] > 0)].copy()
    df["crop_id"] = df["crop"].map(crop_of)
    df["_rank"] = df["crop"].map(rank)
    df["year"] = df["year"].map(agri_year_start)
    season = df["season"].str.strip().str.lower()
    df["season"] = season.where(season.isin(["kharif", "rabi"]), "annual")
    df = df.rename(columns={"crop": "msp_variety", "min_support_price": "msp_inr_per_quintal"})
    df = df.sort_values("_rank").drop_duplicates(["crop_id", "year", "season"], keep="first")
    df["source"] = SOURCE
    df["source_version"] = RESOURCE_ID[:8]
    df["fetched_at"] = meta["fetched_at"]
    df["licence"] = LICENCE

    # Sugarcane FRP for the years the portal's series does not reach.
    frp = pd.DataFrame(read_reference("sugarcane_frp.csv"))
    frp["year"] = frp["year"].astype(int)
    frp["msp_inr_per_quintal"] = frp["msp_inr_per_quintal"].astype(float)
    have = set(zip(df["crop_id"], df["year"]))
    frp = frp[[(c, y) not in have for c, y in zip(frp["crop_id"], frp["year"])]]
    frp = frp.assign(source="CCEA sugarcane FRP announcements (pipelines/reference/sugarcane_frp.csv)",
                     source_version="reference", fetched_at=meta["fetched_at"],
                     licence="Government of India public announcement")
    cols = ["crop_id", "msp_variety", "year", "season", "msp_inr_per_quintal", "source",
            "source_version", "fetched_at", "licence"]
    df = pd.concat([df[cols], frp[cols]], ignore_index=True)
    df["msp_inr_per_kg"] = df["msp_inr_per_quintal"] / 100.0
    df["is_synthetic"] = False
    df = df.sort_values(["crop_id", "year"]).reset_index(drop=True)
    df = df[["crop_id", "msp_variety", "year", "season", "msp_inr_per_quintal", "msp_inr_per_kg",
             "source", "source_version", "fetched_at", "licence", "is_synthetic"]]

    out = out or STAGED / "msp.parquet"
    df.to_parquet(out, index=False)
    log.info("msp: staged %d rows, %d crops, %d-%d", len(df), df["crop_id"].nunique(),
             df["year"].min(), df["year"].max())
    return df
