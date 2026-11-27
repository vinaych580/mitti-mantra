"""Canonical district table (spec 1.2, 1.8).

district_id is "<state LGD code>-<district LGD code>" as the sources report them.
The 30 legacy region_ids map one-to-one through pipelines/reference/pilot_regions.csv,
so saved plans and every existing route keep working.

Point coordinates, in order of preference:
  pilot     district-HQ coordinates already used by the app
  mandi     median position of the district's mandis (Agmarknet metadata)
  schools   median position of the district's schools (UDISE+), where no mandi is geocoded
A district with neither has no point and gets no weather series.
"""
from __future__ import annotations

from pathlib import Path

from pipelines.common import STAGED, ensure_dirs, log, read_reference


def district_id(state_code, district_code) -> str:
    return f"{int(float(state_code))}-{int(float(district_code))}"


def build(out: Path | None = None):
    import pandas as pd

    from pipelines.sources import apmc

    ensure_dirs()
    y = pd.read_parquet(STAGED / "yield_dcy.parquet")
    d = (y.groupby(["state_code", "district_code"], as_index=False)
          .agg(state_name=("state_name", "last"), district_name=("district_name", "last"),
               yield_first_year=("year", "min"), yield_last_year=("year", "max"),
               yield_crops=("crop_id", "nunique")))

    markets = pd.read_csv(apmc.download_markets(), dtype={"state_code": str, "district_code": str})
    # A few mandi groups carry no LGD district code in the source (Delhi, one
    # in Lakhimpur). There is no key to join them on, so they are left out
    # rather than assigned a guessed code.
    uncoded = markets["state_code"].isna() | markets["district_code"].isna()
    if uncoded.any():
        log.warning("districts: %d mandi groups without an LGD code left out: %s", int(uncoded.sum()),
                    markets.loc[uncoded, ["state_name", "district_name"]].to_dict("records"))
        markets = markets[~uncoded]
    markets = markets.rename(columns={"state_name": "m_state", "district_name": "m_district"})
    d = d.merge(markets, on=["state_code", "district_code"], how="outer")
    d["state_name"] = d["state_name"].fillna(d["m_state"])
    d["district_name"] = d["district_name"].fillna(d["m_district"])
    d = d.drop(columns=["m_state", "m_district"])
    # Districts with mandi prices but no yield series and no geocoded mandi
    # (new districts such as Rajasthan's 2023 ones, Delhi's revenue districts).
    prices = STAGED / "price_district_weekly.parquet"
    if prices.exists():
        p = (pd.read_parquet(prices, columns=["state_code", "district_code", "state_name", "district_name"])
               .dropna(subset=["state_code", "district_code"])
               .drop_duplicates(["state_code", "district_code"]))
        have = {district_id(s, c) for s, c in zip(d["state_code"], d["district_code"])}
        p = p[[district_id(s, c) not in have for s, c in zip(p["state_code"], p["district_code"])]]
        if len(p):
            log.info("districts: %d added from mandi prices only", len(p))
            d = pd.concat([d, p], ignore_index=True)
    d["n_mandis"] = d["n_mandis"].fillna(0).astype(int)
    d["point_method"] = d["lat"].notna().map({True: "mandi", False: ""})

    # Districts with no geocoded mandi: median of their schools' locations.
    from pipelines.sources import udise

    sp = udise.points().rename(columns={"lat": "s_lat", "lon": "s_lon"})
    norm = lambda s: s.astype(str).str.split(".").str[0].str.lstrip("0")  # noqa: E731
    d["_sc"], d["_dc"] = norm(d["state_code"]), norm(d["district_code"])
    sp["_sc"], sp["_dc"] = norm(sp["state_code"]), norm(sp["district_code"])
    d = d.merge(sp[["_sc", "_dc", "s_lat", "s_lon"]], on=["_sc", "_dc"], how="left")
    fill = d["lat"].isna() & d["s_lat"].notna()
    d.loc[fill, "lat"] = d.loc[fill, "s_lat"]
    d.loc[fill, "lon"] = d.loc[fill, "s_lon"]
    d.loc[fill, "point_method"] = "schools"
    d = d.drop(columns=["_sc", "_dc", "s_lat", "s_lon"])

    pilots = pd.DataFrame(read_reference("pilot_regions.csv"))
    pilots = pilots[["region_id", "state_code", "district_code", "lat", "lon"]].rename(
        columns={"lat": "p_lat", "lon": "p_lon"})
    d = d.merge(pilots, on=["state_code", "district_code"], how="left")
    has_pilot = d["region_id"].notna()
    d.loc[has_pilot, "lat"] = d.loc[has_pilot, "p_lat"].astype(float)
    d.loc[has_pilot, "lon"] = d.loc[has_pilot, "p_lon"].astype(float)
    d.loc[has_pilot, "point_method"] = "pilot"
    d = d.drop(columns=["p_lat", "p_lon"])
    d["region_id"] = d["region_id"].fillna("")
    d["district_id"] = [district_id(s, c) for s, c in zip(d["state_code"], d["district_code"])]
    d = d.sort_values(["state_name", "district_name"]).reset_index(drop=True)

    missing = set(pilots["region_id"]) - set(d["region_id"])
    if missing:
        raise RuntimeError(f"pilot regions with no district row: {sorted(missing)}")

    out = out or STAGED / "districts.parquet"
    d.to_parquet(out, index=False)
    log.info("districts: %d rows, %d with a point", len(d), d["lat"].notna().sum())
    return d
