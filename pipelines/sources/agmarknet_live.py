"""C1 — Agmarknet current daily mandi prices, via the data.gov.in OGD API.

The bulk history (pipelines/sources/apmc.py) is a mirror that stops months
behind today. This source keeps prices current: the scheduled job
(.github/workflows/data-refresh.yml) runs daily, saves that day's snapshot of
the OGD resource under data/raw/agmarknet_live/<date>.csv, and the snapshots
accumulate (the workflow caches data/raw between runs). The resource itself
only ever holds the latest reports, so a day not saved is a day lost.

Needs DATAGOV_API_KEY. Without it download() does nothing and the build uses
the bulk history alone; nothing fails.

The feed names districts, not LGD codes, so stage() matches (state, district)
names against the district table. Unmatched names are counted in the log and
left out. The feed carries no arrival quantities, so the weekly price is the
median modal price across the week's reports (the bulk history weights by
arrivals; build_curated prefers it wherever both cover a district-week).
"""
from __future__ import annotations

import os
import re
from datetime import date, datetime
from pathlib import Path

from pipelines.common import RAW, STAGED, ensure_dirs, http_get_json, log, read_reference, utc_now, \
    write_fetch_meta

RESOURCE_ID = "9ef84268-d588-465a-a308-a864a43d0070"
URL = f"https://api.data.gov.in/resource/{RESOURCE_ID}"
RAW_DIR = RAW / "agmarknet_live"
SOURCE = "Agmarknet current daily prices via data.gov.in OGD API"
LICENCE = "Government Open Data Licence - India"
PAGE = 1000


def _norm(s) -> str:
    return re.sub(r"[^a-z0-9]", "", str(s or "").lower())


def _field(rec: dict, name: str):
    """The OGD resources disagree on key case (modal_price vs Modal_Price)."""
    for k, v in rec.items():
        if k.lower() == name:
            return v
    return None


def download(day: date | None = None, api_key: str | None = None) -> Path | None:
    import pandas as pd

    key = api_key or os.getenv("DATAGOV_API_KEY")
    if not key:
        log.info("agmarknet_live: DATAGOV_API_KEY not set; skipping (bulk history only)")
        return None
    RAW_DIR.mkdir(parents=True, exist_ok=True)
    day = day or date.today()
    rows, offset = [], 0
    while True:
        data = http_get_json(URL, {"api-key": key, "format": "json", "limit": PAGE, "offset": offset})
        page = data.get("records") or []
        rows.extend({k.lower(): v for k, v in r.items()} for r in page)
        if len(page) < PAGE:
            break
        offset += PAGE
    path = RAW_DIR / f"{day.isoformat()}.csv"
    pd.DataFrame(rows).to_csv(path, index=False)
    write_fetch_meta(RAW_DIR, url=URL, last_snapshot=path.name)
    log.info("agmarknet_live: %d reports saved to %s", len(rows), path.name)
    return path


def _parse_date(s) -> date | None:
    for fmt in ("%d/%m/%Y", "%Y-%m-%d", "%d-%m-%Y"):
        try:
            return datetime.strptime(str(s).strip(), fmt).date()
        except ValueError:
            continue
    return None


def stage(raw_dir: Path = RAW_DIR, districts=None, out: Path | None = None):
    """Weekly district prices from every saved snapshot. Returns None when
    there are no snapshots (no key yet)."""
    import pandas as pd

    files = sorted(raw_dir.glob("*.csv")) if raw_dir.exists() else []
    frames = []
    for p in files:
        try:
            f = pd.read_csv(p, dtype=str)
        except pd.errors.EmptyDataError:
            continue
        if not f.empty:
            f.columns = [c.lower() for c in f.columns]
            frames.append(f)
    out = out or STAGED / "price_live_weekly.parquet"
    if not frames:
        out.unlink(missing_ok=True)
        return None
    ensure_dirs()
    df = pd.concat(frames, ignore_index=True)
    crop_of = {_norm(r["apmc_commodity"]): r["crop_id"] for r in read_reference("crop_aliases.csv")
               if r["apmc_commodity"]}
    df["crop_id"] = df["commodity"].map(lambda c: crop_of.get(_norm(c)))
    df["day"] = df["arrival_date"].map(_parse_date)
    for c in ("min_price", "max_price", "modal_price"):
        df[c] = pd.to_numeric(df[c], errors="coerce")
    df = df[df["crop_id"].notna() & df["day"].notna() & (df["modal_price"] > 0)].copy()
    # The same report reappears in consecutive snapshots until it ages out.
    df = df.drop_duplicates(["state", "district", "market", "commodity", "variety", "day"])

    d = districts if districts is not None else pd.read_parquet(STAGED / "districts.parquet")
    by_name = {(_norm(s), _norm(n)): (sc, dc, did) for s, n, sc, dc, did in
               zip(d["state_name"], d["district_name"], d["state_code"], d["district_code"],
                   d.get("district_id", [None] * len(d)))}
    keys = [by_name.get((_norm(s), _norm(n))) for s, n in zip(df["state"], df["district"])]
    matched = [k is not None for k in keys]
    if not all(matched):
        miss = df.loc[[not m for m in matched], ["state", "district"]].drop_duplicates()
        log.warning("agmarknet_live: %d district names not matched, e.g. %s", len(miss),
                    miss.head(5).to_dict("records"))
    df = df[matched].copy()
    if df.empty:
        out.unlink(missing_ok=True)
        return None
    df["state_code"] = [k[0] for k, m in zip(keys, matched) if m]
    df["district_code"] = [k[1] for k, m in zip(keys, matched) if m]

    df["week"] = pd.to_datetime(df["day"]).dt.to_period("W-SUN").dt.start_time.dt.date
    g = (df.groupby(["state_code", "district_code", "crop_id", "week"], as_index=False)
           .agg(state_name=("state", "first"), district_name=("district", "first"),
                n_reports=("modal_price", "size"), n_mandis=("market", "nunique"), n_days=("day", "nunique"),
                modal_median=("modal_price", "median"), min_price=("min_price", "min"),
                max_price=("max_price", "max")))
    g["price_inr_kg"] = g["modal_median"] / 100.0  # Rs/quintal -> Rs/kg
    g["modal_median_inr_kg"] = g["price_inr_kg"]
    g["modal_weighted_inr_kg"] = float("nan")
    g["min_inr_kg"] = g["min_price"] / 100.0
    g["max_inr_kg"] = g["max_price"] / 100.0
    g["arrivals_t"] = float("nan")
    g = g.drop(columns=["modal_median", "min_price", "max_price"])
    g["resource"] = "live"
    g["source"] = SOURCE
    g["source_version"] = RESOURCE_ID[:8]
    g["fetched_at"] = utc_now()
    g["licence"] = LICENCE
    g["is_synthetic"] = False
    g.to_parquet(out, index=False)
    log.info("agmarknet_live: staged %d district-weeks from %d snapshots, through %s",
             len(g), len(files), g["week"].max())
    return g
