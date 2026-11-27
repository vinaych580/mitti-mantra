"""A3 — APMC arrivals and prices (Agmarknet), via India Data Portal.

Two datastore resources, both ODC-By:
  old: 2021-01 .. 2025-10   (21ecb9f0-...)  22.6M daily mandi reports
  new: 2025-?? .. 2026-05   (078fd1ea-...)   3.9M daily mandi reports

Downloading 4+ GB of daily rows is not needed: the portal's SQL endpoint
aggregates on the server to (district, commodity, ISO week), which is the
grain the app and the Phase 2 price model use. Each commodity-year page is
saved under data/raw/apmc/ as returned, so stage() never touches the network.

Prices are Rs/quintal in the source; staged prices are Rs/kg.
"""
from __future__ import annotations

import re
from datetime import date
from pathlib import Path

from pipelines.common import RAW, STAGED, ensure_dirs, http_get_json, log, read_fetch_meta, \
    read_reference, write_fetch_meta

SQL_URL = "https://ckandev.indiadataportal.com/api/3/action/datastore_search_sql"
RAW_DIR = RAW / "apmc"
SOURCE = "Agmarknet APMC arrivals and prices via India Data Portal"
LICENCE = "ODC-By 1.0"
PAGE = 32000  # the portal's rows_max

RESOURCES = {
    "old": {"id": "21ecb9f0-7bf9-42d0-af24-df2e230e4a0a", "date": "report_date",
            "market": "market_code", "years": range(2021, 2026)},
    "new": {"id": "078fd1ea-dab6-4aca-aed9-3a4b8b2c761d", "date": "date",
            "market": "market_center_code", "years": range(2025, date.today().year + 1)},
}


def _slug(s: str) -> str:
    return re.sub(r"[^a-z0-9]+", "_", s.lower()).strip("_")


def _commodities(feed: str | None = None) -> dict[str, str]:
    """Commodity name -> crop_id. The two feeds spell some names differently
    ("Paddy(Dhan)(Common)" old, "Paddy(Common)" new); apmc_commodity_new holds
    the newer spelling where it differs. With no feed, every name of both."""
    out = {}
    for r in read_reference("crop_aliases.csv"):
        old, new = r["apmc_commodity"], r.get("apmc_commodity_new") or r["apmc_commodity"]
        if feed in (None, "old") and old:
            out[old] = r["crop_id"]
        if feed in (None, "new") and new:
            out[new] = r["crop_id"]
    return out


def _sql(res: dict, commodity: str, year: int, offset: int) -> str:
    d, m = res["date"], res["market"]
    c = commodity.replace("'", "''")
    return f"""
SELECT state_code, district_code, max(state_name) AS state_name, max(district_name) AS district_name,
       date_trunc('week', "{d}"::date)::date AS week,
       count(*) AS n_reports, count(DISTINCT "{m}") AS n_mandis, count(DISTINCT "{d}") AS n_days,
       sum(arrival_quantity) AS arrivals_t,
       percentile_cont(0.5) WITHIN GROUP (ORDER BY modal_price) AS modal_median,
       CASE WHEN sum(arrival_quantity) > 0
            THEN sum(modal_price * arrival_quantity) / sum(arrival_quantity) END AS modal_weighted,
       min(min_price) AS min_price, max(max_price) AS max_price
FROM "{res['id']}"
WHERE commodity_name = '{c}' AND "{d}" >= '{year}-01-01' AND "{d}" < '{year + 1}-01-01'
  AND modal_price > 0 AND price_unit ILIKE '%quintal%'
GROUP BY state_code, district_code, week
ORDER BY state_code, district_code, week
LIMIT {PAGE} OFFSET {offset}"""


def download(force: bool = False, commodities: list[str] | None = None,
             refresh_since: int | None = None) -> Path:
    """Fetch every commodity-year page not already on disk. `refresh_since`
    re-fetches years from that one on (the scheduled job passes this year)."""
    import pandas as pd

    for tag, res in RESOURCES.items():
        out_dir = RAW_DIR / tag
        out_dir.mkdir(parents=True, exist_ok=True)
        names = commodities or list(_commodities(tag))
        for commodity in names:
            for year in res["years"]:
                path = out_dir / f"{_slug(commodity)}_{year}.csv"
                stale = refresh_since is not None and year >= refresh_since
                if path.exists() and not force and not stale:
                    continue
                rows, offset = [], 0
                while True:
                    data = http_get_json(SQL_URL, {"sql": _sql(res, commodity, year, offset)})
                    if not data.get("success"):
                        raise RuntimeError(f"apmc {tag} {commodity} {year}: {data.get('error')}")
                    page = data["result"]["records"]
                    rows.extend(page)
                    if len(page) < PAGE:
                        break
                    offset += PAGE
                pd.DataFrame(rows).assign(commodity=commodity).to_csv(path, index=False)
                log.info("apmc %s %s %d: %d district-weeks", tag, commodity, year, len(rows))
    write_fetch_meta(RAW_DIR, url=SQL_URL, resources={k: v["id"] for k, v in RESOURCES.items()})
    return RAW_DIR


MARKETS_FILE = RAW_DIR / "markets.csv"


def download_markets(force: bool = False) -> Path:
    """Mandi coordinates per district, used as a district point where no
    better one is recorded (pipelines/reference/pilot_regions.csv)."""
    import pandas as pd

    if MARKETS_FILE.exists() and not force:
        return MARKETS_FILE
    res = RESOURCES["new"]
    sql = f"""
SELECT state_code, district_code, max(state_name) AS state_name, max(district_name) AS district_name,
       count(DISTINCT market_center_code) AS n_mandis,
       percentile_cont(0.5) WITHIN GROUP (ORDER BY latitude) AS lat,
       percentile_cont(0.5) WITHIN GROUP (ORDER BY longitude) AS lon
FROM "{res['id']}"
WHERE latitude BETWEEN 6 AND 38 AND longitude BETWEEN 68 AND 98
GROUP BY state_code, district_code"""
    data = http_get_json(SQL_URL, {"sql": sql})
    RAW_DIR.mkdir(parents=True, exist_ok=True)
    pd.DataFrame(data["result"]["records"]).to_csv(MARKETS_FILE, index=False)
    return MARKETS_FILE


def stage(out: Path | None = None):
    import pandas as pd

    ensure_dirs()
    meta = read_fetch_meta(RAW_DIR)
    crop_of = _commodities()
    frames = []
    for tag in RESOURCES:
        for p in sorted((RAW_DIR / tag).glob("*.csv")):
            try:
                f = pd.read_csv(p, dtype={"state_code": str, "district_code": str})
            except pd.errors.EmptyDataError:
                continue
            if f.empty:
                continue
            f["resource"] = tag
            frames.append(f)
    df = pd.concat(frames, ignore_index=True)
    df = df[df["district_code"].notna()]
    df["crop_id"] = df["commodity"].map(crop_of)
    df["week"] = pd.to_datetime(df["week"]).dt.date
    # Where both resources report the same district-week, keep the newer feed.
    df["_pref"] = (df["resource"] == "new").astype(int)
    df = (df.sort_values("_pref").drop_duplicates(["district_code", "crop_id", "week"], keep="last")
            .drop(columns="_pref"))
    for src, dst in (("modal_median", "modal_median_inr_kg"), ("modal_weighted", "modal_weighted_inr_kg"),
                     ("min_price", "min_inr_kg"), ("max_price", "max_inr_kg")):
        df[dst] = df[src] / 100.0  # Rs/quintal -> Rs/kg
    df["price_inr_kg"] = df["modal_weighted_inr_kg"].fillna(df["modal_median_inr_kg"])
    df = df.drop(columns=["modal_median", "modal_weighted", "min_price", "max_price"])
    df["source"] = SOURCE
    df["source_version"] = df["resource"].map({k: v["id"][:8] for k, v in RESOURCES.items()})
    df["fetched_at"] = meta["fetched_at"]
    df["licence"] = LICENCE
    df["is_synthetic"] = False

    out = out or STAGED / "price_district_weekly.parquet"
    df.to_parquet(out, index=False)
    log.info("apmc: staged %d district-weeks, %d crops, %s..%s", len(df), df["crop_id"].nunique(),
             df["week"].min(), df["week"].max())
    return df
