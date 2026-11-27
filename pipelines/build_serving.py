"""Curated -> what the app serves (spec 1.5).

dataset/serving.sqlite   every district: last 10 years of yields, all seasonal
                         weather, last 104 weeks of district prices, district list
                         with coverage flags. Read through utils/store.py.
dataset/yield_history.csv, weather.csv, mandi_prices.csv
                         the 30 pilot regions only, same columns the app already
                         reads plus `source` and `is_synthetic`. These are what a
                         fresh clone runs on, and every existing caller keeps working.
"""
from __future__ import annotations

import sqlite3

from pipelines.common import CURATED, DATASET, log, utc_now, write_csv

YIELD_YEARS = 10
PRICE_WEEKS = 104
SERVING_DB = DATASET / "serving.sqlite"


OPTIONAL = ("cost_state_crop", "msp", "soil_district", "irrigation_share", "weather_stage", "monsoon_onset")
STAGE_SEASONS = 3  # spec 1.5: last three seasons of stage weather


def _load():
    import pandas as pd

    t = {n: pd.read_parquet(CURATED / f"{n}.parquet") for n in
         ("districts", "yield_dcy", "price_district_weekly", "weather_season")}
    for n in OPTIONAL:
        if (CURATED / f"{n}.parquet").exists():
            t[n] = pd.read_parquet(CURATED / f"{n}.parquet")
    return t


def _optional_tables(t) -> dict:
    """Serving cuts of the smaller tables, each with its meta row."""
    out = {}
    if "cost_state_crop" in t:
        out["cost_state_crop"] = (t["cost_state_crop"], "year")
    if "msp" in t:
        out["msp"] = (t["msp"], "year")
    if "soil_district" in t:
        s = t["soil_district"]
        latest = s.groupby(["district_id", "nutrient"])["year"].transform("max")
        out["soil_district"] = (s[s["year"] == latest].drop(columns=["state_code", "district_code"]), "year")
    if "irrigation_share" in t:
        ir = t["irrigation_share"]
        out["irrigation_share"] = (ir[ir["year"] > int(ir["year"].max()) - YIELD_YEARS]
                                   .drop(columns=["state_code", "district_code"]), "year")
    if "weather_stage" in t:
        ws = t["weather_stage"]
        out["weather_stage"] = (ws[ws["year"] > int(ws["year"].max()) - STAGE_SEASONS], "year")
    if "monsoon_onset" in t:
        out["monsoon_onset"] = (t["monsoon_onset"], "year")
    return out


def _recent_yields(y):
    last = int(y["year"].max())
    return y[y["year"] > last - YIELD_YEARS]


# Natural key per serving table. Keyed tables are stored WITHOUT ROWID,
# clustered on the key, so lookups by district need no separate index (which
# would duplicate most of the table).
KEYS = {
    "yield_dcy": ("district_id", "crop_id", "season", "year"),
    "price_district_weekly": ("district_id", "crop_id", "week"),
    "weather_season": ("district_id", "season", "year"),
    "weather_stage": ("district_id", "crop_id", "season", "year", "stage_idx"),
    "monsoon_onset": ("district_id", "year"),
    "irrigation_share": ("district_id", "crop_id", "year"),
    "soil_district": ("district_id", "nutrient"),
}
PROV = ("source", "source_version", "fetched_at", "licence", "is_synthetic")
# Carried on the districts table; repeating them on every row only costs space.
REDUNDANT = ("region_id", "state_code", "district_code", "state_name", "district_name", "resource",
             "sown_ha", "end_date")  # end_date = start_date + n_days - 1


def _write(con, name: str, df, cols, prov: dict) -> None:
    """Write one serving table: provenance replaced by a source_id into the
    `provenance` table, redundant district columns dropped, keyed tables
    clustered on their key."""
    df = df.copy()
    for c in PROV:
        if c not in df:
            df[c] = "" if c != "is_synthetic" else False
    tuples = list(zip(*(df[c].astype(str) if c != "is_synthetic" else df[c].astype(bool) for c in PROV)))
    for tup in dict.fromkeys(tuples):
        prov.setdefault(tup, len(prov) + 1)
    df["source_id"] = [prov[tup] for tup in tuples]
    keep = list(cols) if cols else [c for c in df.columns if c not in PROV and c not in REDUNDANT]
    if name in ("cost_state_crop",):  # state-level: state_code is its key
        keep = [c for c in df.columns if c not in PROV]
    df = df[[c for c in keep if c != "source_id"] + ["source_id"]]
    # Rupee prices as whole paise: SQLite stores a small integer in 1-3 bytes
    # against 8 for a float. utils/store.py converts back to *_inr_kg.
    for c in [c for c in df.columns if c.endswith("_inr_kg")]:
        df[c[:-len("_inr_kg")] + "_paise_kg"] = (df[c] * 100).round().astype("Int64")
        df = df.drop(columns=c)
    key = KEYS.get(name)
    if not key:
        df.to_sql(name, con, index=False)
        return
    df.head(0).to_sql(f"_{name}_schema", con, index=False)
    decl = [f'"{r[1]}" {r[2]}' for r in con.execute(f'PRAGMA table_info("_{name}_schema")')]
    con.execute(f'DROP TABLE "_{name}_schema"')
    con.execute(f'CREATE TABLE "{name}" ({", ".join(decl)}, PRIMARY KEY ({", ".join(key)})) WITHOUT ROWID')
    df.to_sql(name, con, index=False, if_exists="append")


def build_sqlite(t) -> int:
    import pandas as pd

    y = _recent_yields(t["yield_dcy"])
    p = t["price_district_weekly"].copy()
    p["week"] = pd.to_datetime(p["week"])
    p = p[p["week"] > p["week"].max() - pd.Timedelta(weeks=PRICE_WEEKS)]
    p["week"] = p["week"].dt.date.astype(str)
    w = t["weather_season"]

    d = t["districts"].copy()
    d["has_yields"] = d["district_id"].isin(set(y["district_id"]))
    d["has_weather"] = d["district_id"].isin(set(w["district_id"]))
    d["has_prices"] = d["district_id"].isin(set(p["district_id"]))

    cols_y = ["district_id", "crop_id", "season", "year", "yield_kg_acre", "area_acres", "production_kg"]
    cols_p = ["district_id", "crop_id", "week", "price_inr_kg", "min_inr_kg", "max_inr_kg", "arrivals_t",
              "n_mandis"]
    cols_w = ["district_id", "season", "year", "rainfall_mm", "avg_temp_c", "min_temp_c", "max_temp_c",
              "dry_spell_max_days", "hot_days_35c"]
    cols_d = ["district_id", "region_id", "state_code", "state_name", "district_code", "district_name",
              "lat", "lon", "point_method", "n_mandis", "has_yields", "has_weather", "has_prices"]

    tmp = SERVING_DB.with_suffix(".tmp")
    tmp.unlink(missing_ok=True)
    con = sqlite3.connect(tmp)
    prov: dict = {}
    try:
        d[cols_d].to_sql("districts", con, index=False)
        _write(con, "yield_dcy", y, cols_y, prov)
        _write(con, "price_district_weekly", p, cols_p, prov)
        _write(con, "weather_season", w, cols_w, prov)
        extra = _optional_tables(t)
        extra_meta = []
        for name, (df, ycol) in extra.items():
            _write(con, name, df, None, prov)
            extra_meta.append({"table_name": name, "rows": len(df), "data_through": str(int(df[ycol].max())),
                               "fetched_at": df["fetched_at"].max(),
                               "source": "; ".join(sorted(df["source"].unique()))})
        meta = pd.DataFrame(extra_meta + [
            {"table_name": "yield_dcy", "rows": len(y), "data_through": str(int(y["year"].max())),
             "fetched_at": y["fetched_at"].max(), "source": "; ".join(sorted(y["source"].unique()))},
            {"table_name": "price_district_weekly", "rows": len(p), "data_through": p["week"].max(),
             "fetched_at": p["fetched_at"].max(), "source": "; ".join(sorted(p["source"].unique()))},
            {"table_name": "weather_season", "rows": len(w), "data_through": str(int(w["year"].max())),
             "fetched_at": w["fetched_at"].max(), "source": "; ".join(sorted(w["source"].unique()))},
        ])
        meta["built_at"] = utc_now()
        meta.to_sql("meta", con, index=False)
        pd.DataFrame([{"source_id": i, "source": s, "source_version": v, "fetched_at": f, "licence": lic,
                       "is_synthetic": bool(syn)} for (s, v, f, lic, syn), i in prov.items()]
                     ).to_sql("provenance", con, index=False)
        con.executescript("""
            CREATE UNIQUE INDEX ix_d ON districts(district_id);
            CREATE INDEX ix_d_region ON districts(region_id);
        """)
        for name, ddl in (("cost_state_crop", "CREATE INDEX ix_c ON cost_state_crop(state_code, crop_id, year)"),
                          ("msp", "CREATE INDEX ix_m ON msp(crop_id, year)")):
            if name in extra:
                con.execute(ddl)
        con.commit()
        con.execute("VACUUM")
    finally:
        con.close()
    SERVING_DB.unlink(missing_ok=True)
    tmp.replace(SERVING_DB)
    size = SERVING_DB.stat().st_size
    log.info("serving.sqlite: %.1f MB (%d yields, %d price weeks, %d weather seasons, %d districts)",
             size / 1e6, len(y), len(p), len(w), len(d))
    return size


def _num(v, nd=0):
    return int(round(v)) if nd == 0 else round(float(v), nd)


def build_fallback_csvs(t) -> dict[str, int]:
    import pandas as pd

    counts = {}
    y = _recent_yields(t["yield_dcy"])
    y = y[y["region_id"] != ""].sort_values(["region_id", "crop_id", "season", "year"])
    counts["yield_history.csv"] = write_csv(DATASET / "yield_history.csv", (
        {"region_id": r.region_id, "crop_id": r.crop_id, "year": r.year, "season": r.season,
         "yield_kg_per_acre": _num(r.yield_kg_acre), "area_acres": _num(r.area_acres),
         "production_kg": _num(r.production_kg), "source": r.source, "is_synthetic": "false"}
        for r in y.itertuples()),
        ["region_id", "crop_id", "year", "season", "yield_kg_per_acre", "area_acres", "production_kg",
         "source", "is_synthetic"])

    w = t["weather_season"]
    w = w[w["region_id"] != ""].sort_values(["region_id", "year", "season"])
    counts["weather.csv"] = write_csv(DATASET / "weather.csv", (
        {"region_id": r.region_id, "season": r.season, "year": r.year, "rainfall_mm": r.rainfall_mm,
         "avg_temp_c": r.avg_temp_c, "min_temp_c": r.min_temp_c, "max_temp_c": r.max_temp_c,
         "source": r.source, "is_synthetic": "false"}
        for r in w.itertuples()),
        ["region_id", "season", "year", "rainfall_mm", "avg_temp_c", "min_temp_c", "max_temp_c",
         "source", "is_synthetic"])

    p = t["price_district_weekly"]
    p = p[p["region_id"] != ""].copy()
    p["month"] = pd.to_datetime(p["week"]).dt.to_period("M").dt.to_timestamp()
    d = t["districts"].set_index("region_id")["district_name"].to_dict()
    m = (p.groupby(["region_id", "crop_id", "month"], as_index=False)
          .agg(price=("price_inr_kg", "mean"), mandis=("n_mandis", "max"), source=("source", "first")))
    m = m.sort_values(["region_id", "crop_id", "month"])
    counts["mandi_prices.csv"] = write_csv(DATASET / "mandi_prices.csv", (
        {"region_id": r.region_id, "crop_id": r.crop_id, "date": r.month.date().isoformat(),
         "price_inr_per_kg": round(r.price, 2),
         "market_name": f"{d.get(r.region_id, r.region_id)} district mandis ({int(r.mandis)})",
         "source": r.source, "is_synthetic": "false"}
        for r in m.itertuples()),
        ["region_id", "crop_id", "date", "price_inr_per_kg", "market_name", "source", "is_synthetic"])
    if "msp" in t:
        counts["msp_prices.csv"] = build_msp_csv(t["msp"])
    log.info("fallback CSVs: %s", counts)
    return counts


def build_msp_csv(m) -> int:
    """dataset/msp_prices.csv from the official series: every year, the
    columns engine/features.py reads, plus the variety and source."""
    import csv

    with (DATASET / "crop_parameters.csv").open(encoding="utf-8") as f:
        names = {r["crop_id"]: r["crop_name"] for r in csv.DictReader(f)}
    m = m.sort_values(["crop_id", "year"])
    return write_csv(DATASET / "msp_prices.csv", (
        {"crop_id": r.crop_id, "crop_name": names.get(r.crop_id, r.crop_id), "year": r.year,
         "season": r.season, "msp_inr_per_quintal": _num(r.msp_inr_per_quintal),
         "msp_inr_per_kg": f"{r.msp_inr_per_kg:.2f}", "msp_variety": r.msp_variety,
         "source": r.source, "is_synthetic": "false"}
        for r in m.itertuples()),
        ["crop_id", "crop_name", "year", "season", "msp_inr_per_quintal", "msp_inr_per_kg", "msp_variety",
         "source", "is_synthetic"])


RELEASE_TAG = "data-store"


def serving_entry(path=SERVING_DB) -> dict:
    """How to fetch this exact store: the release asset is named after its
    checksum, so a deploy built from a given commit always fetches the store
    that commit's manifest describes, however many refreshes come after
    (scripts/fetch_serving_store.cjs)."""
    from pipelines.common import file_sha256

    digest = file_sha256(path)
    return {"release_tag": RELEASE_TAG, "asset": f"serving-{digest[:16]}.sqlite",
            "sha256": digest, "bytes": path.stat().st_size, "built_at": utc_now()}


def build():
    t = _load()
    size = build_sqlite(t)
    counts = build_fallback_csvs(t)
    return size, counts
