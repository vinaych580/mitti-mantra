"""A1 — DES Area, Production, Yield (district level), via India Data Portal.

Source: Directorate of Economics and Statistics, MoA&FW (data.desagri.gov.in),
mirrored by India Data Portal with LGD district codes. Licence: Open Data
Commons Attribution (ODC-By). 1997-98 to 2022-23, ~455k rows, 740 districts.

stage() writes data/staged/yield_dcy.parquet at the grain
(district_code, crop_id, season, year), one row per key:

* `year` is the start of the agricultural year ("2022-2023" -> 2022), which is
  how the app already labels kharif 2022 and rabi 2022-23.
* Source seasons collapse onto the app's five (pipelines/reference/apy_seasons.csv);
  rows landing on the same key are summed and yield recomputed from the sums.
* Units are converted to kg per hectare of the product the app prices
  (paddy, kapas, jute fibre) with the factors in crop_aliases.csv.
* A row with zero or missing area or production is dropped, not imputed.
"""
from __future__ import annotations

from pathlib import Path

from pipelines.common import HA_PER_ACRE, RAW, STAGED, ensure_dirs, file_sha256, log, \
    read_fetch_meta, read_reference, write_fetch_meta

RESOURCE_ID = "f980409d-49a2-42ae-9eb0-182365005c04"
URL = ("https://ckandev.indiadataportal.com/dataset/f2bbc28c-6c7c-462b-9064-ea4c4213d466/"
       f"resource/{RESOURCE_ID}/download/crop-wise-area-production-yield.csv")
RAW_DIR = RAW / "apy"
RAW_FILE = RAW_DIR / "crop-wise-area-production-yield.csv"
SOURCE = "DES APY via India Data Portal"
LICENCE = "ODC-By 1.0"



def download(force: bool = False) -> Path:
    import requests

    RAW_DIR.mkdir(parents=True, exist_ok=True)
    if RAW_FILE.exists() and not force:
        log.info("apy: raw file present, skipping download")
        if not (RAW_DIR / "_fetch.json").exists():
            write_fetch_meta(RAW_DIR, url=URL, sha256=file_sha256(RAW_FILE))
        return RAW_FILE
    log.info("apy: downloading %s", URL)
    with requests.get(URL, stream=True, timeout=900) as r:
        r.raise_for_status()
        tmp = RAW_FILE.with_suffix(".part")
        with tmp.open("wb") as f:
            for chunk in r.iter_content(1 << 20):
                f.write(chunk)
        tmp.replace(RAW_FILE)
    write_fetch_meta(RAW_DIR, url=URL, sha256=file_sha256(RAW_FILE))
    return RAW_FILE


def _crop_maps() -> tuple[dict[str, str], dict[str, float]]:
    name_to_crop, factor = {}, {}
    for r in read_reference("crop_aliases.csv"):
        if r["apy_name"]:
            name_to_crop[r["apy_name"]] = r["crop_id"]
            factor[r["crop_id"]] = float(r["apy_kg_per_unit"])
    return name_to_crop, factor


def _perennial_crops() -> set[str]:
    import csv

    from pipelines.common import DATASET

    with (DATASET / "crop_parameters.csv").open(encoding="utf-8") as f:
        return {r["crop_id"] for r in csv.DictReader(f) if r["season"].lower().startswith("perennial")}


def stage(raw_file: Path = RAW_FILE, out: Path | None = None):
    import pandas as pd

    ensure_dirs()
    meta = read_fetch_meta(raw_file.parent)
    df = pd.read_csv(raw_file, dtype={"state_code": str, "district_code": str})
    name_to_crop, factor = _crop_maps()
    season_map = {r["apy_season"]: r["season"] for r in read_reference("apy_seasons.csv")}

    df = df[df["crop_name"].isin(name_to_crop)].copy()
    df["crop_id"] = df["crop_name"].map(name_to_crop)
    df["season"] = df["season"].str.strip().map(season_map)
    df = df[df["season"].notna() & (df["season"] != "")]
    perennial = _perennial_crops()
    df.loc[(df["season"] == "annual") & df["crop_id"].isin(perennial), "season"] = "perennial"
    df["year"] = df["year"].str.slice(0, 4).astype(int)
    df = df[(df["area"] > 0) & (df["production"] > 0)]

    key = ["state_code", "district_code", "crop_id", "season", "year"]
    g = (df.groupby(key, as_index=False)
           .agg(state_name=("state_name", "first"), district_name=("district_name", "first"),
                area_ha=("area", "sum"), production_units=("production", "sum")))
    g["production_kg"] = g["production_units"] * g["crop_id"].map(factor)
    g["yield_kg_ha"] = g["production_kg"] / g["area_ha"]
    g["yield_kg_acre"] = g["yield_kg_ha"] * HA_PER_ACRE
    g["area_acres"] = g["area_ha"] / HA_PER_ACRE
    g = g.drop(columns=["production_units"])
    g["source"] = SOURCE
    g["source_version"] = meta.get("sha256", "")[:12]
    g["fetched_at"] = meta["fetched_at"]
    g["licence"] = LICENCE
    g["is_synthetic"] = False

    out = out or STAGED / "yield_dcy.parquet"
    g.to_parquet(out, index=False)
    log.info("apy: staged %d rows, %d districts, %d-%d -> %s", len(g), g["district_code"].nunique(),
             g["year"].min(), g["year"].max(), out)
    return g
