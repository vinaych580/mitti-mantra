"""Phase 1 pipeline: each source module on a small recorded fixture, the
validation gates, and the serving store reader. No network."""
from __future__ import annotations

import gzip
import json
import sqlite3

import pytest

pd = pytest.importorskip("pandas")
pytest.importorskip("pyarrow")

from pipelines import validate as validate_mod  # noqa: E402
from pipelines.common import write_fetch_meta  # noqa: E402
from pipelines.sources import agmarknet_live, apmc, apy, costs, irrigation, msp, nasa_power, soil_health  # noqa: E402

APY_HEADER = ("id,year,state_name,state_code,district_name,district_code,crop_name,crop_code,crop_type,"
              "season,area,area_unit,production,production_unit,yield,yield_unit\n")


def _apy_fixture(tmp_path, rows):
    raw = tmp_path / "apy"
    raw.mkdir()
    f = raw / "apy.csv"
    f.write_text(APY_HEADER + "".join(r + "\n" for r in rows), encoding="utf-8")
    write_fetch_meta(raw, url="fixture", sha256="abc123")
    return f


def test_apy_stage_converts_units_and_seasons(tmp_path):
    f = _apy_fixture(tmp_path, [
        # milled rice 2 t/ha -> paddy 3 t/ha
        "0,2020-2021,Telangana,36,Medak,513,Rice,1,Cereals,Kharif,1000,Hectare,2000,Tonnes,2,Tonnes/Hectare",
        # cotton: 1000 bales on 500 ha -> 1000*500 kg kapas / 500 ha = 1000 kg/ha
        "1,2020-2021,Telangana,36,Medak,513,Cotton(Lint),2,Fibres,Kharif,500,Hectare,1000,Tonnes,2,Tonnes/Hectare",
        # aus + aman both land on kharif and are summed
        "2,2020-2021,West Bengal,19,Purba Bardhaman,306,Rice,1,Cereals,Autumn,100,Hectare,200,Tonnes,2,Tonnes/Hectare",
        "3,2020-2021,West Bengal,19,Purba Bardhaman,306,Rice,1,Cereals,Winter,300,Hectare,900,Tonnes,3,Tonnes/Hectare",
        # 'Total' rows are dropped (they double count)
        "4,2020-2021,West Bengal,19,Purba Bardhaman,306,Rice,1,Cereals,Total,400,Hectare,1100,Tonnes,2.75,Tonnes/Hectare",
        # zero area is dropped, not imputed
        "5,2020-2021,Telangana,36,Medak,513,Wheat,3,Cereals,Rabi,0,Hectare,0,Tonnes,0,Tonnes/Hectare",
        # crops the app does not model are ignored
        "6,2020-2021,Telangana,36,Medak,513,Sesamum,4,Oilseeds,Kharif,10,Hectare,5,Tonnes,0.5,Tonnes/Hectare",
    ])
    g = apy.stage(f, tmp_path / "out.parquet")
    key = {(r.district_code, r.crop_id, r.season): r for r in g.itertuples()}
    assert len(g) == 3
    rice = key[("513", "rice", "kharif")]
    assert rice.year == 2020
    assert rice.yield_kg_ha == pytest.approx(3000)
    assert rice.yield_kg_acre == pytest.approx(3000 * 0.404686)
    assert key[("513", "cotton", "kharif")].yield_kg_ha == pytest.approx(1000)
    wb = key[("306", "rice", "kharif")]
    assert wb.area_ha == 400
    assert wb.yield_kg_ha == pytest.approx(1100 * 1500 / 400)
    assert not g["is_synthetic"].any()
    assert set(g["source"]) == {apy.SOURCE}


def test_apmc_stage_prefers_new_feed_and_converts_to_rupees_per_kg(tmp_path, monkeypatch):
    monkeypatch.setattr(apmc, "RAW_DIR", tmp_path)
    cols = ("state_code,district_code,state_name,district_name,week,n_reports,n_mandis,n_days,arrivals_t,"
            "modal_median,modal_weighted,min_price,max_price,commodity\n")
    (tmp_path / "old").mkdir()
    (tmp_path / "new").mkdir()
    (tmp_path / "old" / "wheat_2025.csv").write_text(
        cols + "23,427,Madhya Pradesh,Sehore,2025-10-06,5,2,3,40,2400,2450,2300,2500,Wheat\n"
               "23,427,Madhya Pradesh,Sehore,2025-10-13,5,2,3,40,2410,,2300,2500,Wheat\n", encoding="utf-8")
    (tmp_path / "new" / "wheat_2025.csv").write_text(
        cols + "23,427,Madhya Pradesh,Sehore,2025-10-13,5,2,3,40,2500,2520,2400,2600,Wheat\n", encoding="utf-8")
    write_fetch_meta(tmp_path, url="fixture")
    df = apmc.stage(tmp_path / "out.parquet").sort_values("week")
    assert len(df) == 2
    first, second = df.iloc[0], df.iloc[1]
    assert first["price_inr_kg"] == pytest.approx(24.5)
    assert second["resource"] == "new" and second["price_inr_kg"] == pytest.approx(25.2)
    assert df["crop_id"].eq("wheat").all()


def test_apmc_weighted_price_falls_back_to_median(tmp_path, monkeypatch):
    monkeypatch.setattr(apmc, "RAW_DIR", tmp_path)
    (tmp_path / "old").mkdir()
    (tmp_path / "old" / "onion_2024.csv").write_text(
        "state_code,district_code,state_name,district_name,week,n_reports,n_mandis,n_days,arrivals_t,"
        "modal_median,modal_weighted,min_price,max_price,commodity\n"
        "27,487,Maharashtra,Nashik,2024-03-04,3,1,3,0,1500,,1400,1600,Onion\n", encoding="utf-8")
    write_fetch_meta(tmp_path, url="fixture")
    df = apmc.stage(tmp_path / "out.parquet")
    assert df.iloc[0]["price_inr_kg"] == pytest.approx(15.0)


def test_apmc_sql_avoids_functions_the_portal_blocks():
    sql = apmc._sql(apmc.RESOURCES["old"], "Paddy(Dhan)(Common)", 2024, 0).lower()
    assert "nullif" not in sql  # the portal's allow-list rejects it with HTTP 403


def _power_fixture(path, did, start, days, rain=0.0, tmin=20.0, tmax=33.0):
    dates = pd.date_range(start, periods=days, freq="D").strftime("%Y%m%d")
    param = {k: {} for k in nasa_power.PARAMS}
    for i, d in enumerate(dates):
        param["PRECTOTCORR"][d] = rain if i % 10 else 30.0
        param["T2M_MIN"][d] = tmin
        param["T2M_MAX"][d] = tmax + (5 if i == 3 else 0)
        param["T2M"][d] = (tmin + tmax) / 2
        param["RH2M"][d] = 70
        param["ALLSKY_SFC_SW_DWN"][d] = 20
        param["WS2M"][d] = 2
    with gzip.open(path, "wt", encoding="utf-8") as f:
        json.dump({"district_id": did, "lat": 1, "lon": 2, "fetched_at": "2026-11-18T00:00:00+00:00",
                   "parameter": param}, f)


def test_nasa_power_season_aggregates(tmp_path):
    _power_fixture(tmp_path / "x.json.gz", "36-513", "2024-06-01", 153)  # whole kharif 2024
    daily = nasa_power._read_daily(tmp_path / "x.json.gz")
    s = nasa_power.season_aggregates(daily)
    k = s[(s.season == "kharif") & (s.year == 2024)].iloc[0]
    assert k.n_days == 153
    assert k.rainfall_mm == pytest.approx(16 * 30.0)  # every 10th day of 153
    assert k.max_temp_c == pytest.approx(38.0)
    assert k.hot_days_35c == 1
    assert k.dry_spell_max_days == 9
    # an incomplete rabi (only part of Nov) is left out rather than filled
    assert s[(s.season == "rabi")].empty


def test_nasa_power_fill_values_are_missing_not_zero(tmp_path):
    _power_fixture(tmp_path / "x.json.gz", "36-513", "2024-06-01", 5)
    p = json.loads(gzip.open(tmp_path / "x.json.gz", "rt").read())
    first = next(iter(p["parameter"]["PRECTOTCORR"]))
    p["parameter"]["PRECTOTCORR"][first] = -999
    with gzip.open(tmp_path / "x.json.gz", "wt") as f:
        json.dump(p, f)
    daily = nasa_power._read_daily(tmp_path / "x.json.gz")
    assert daily["rain_mm"].isna().sum() == 1


def _curated(tmp_path, *, synthetic=False):
    prov = {"source": "fixture", "fetched_at": "2026-11-18", "licence": "x", "is_synthetic": synthetic}
    districts = pd.DataFrame({"district_id": [f"1-{i}" for i in range(30)],
                              "region_id": [f"r{i}" for i in range(30)]})
    tables = {
        "districts": districts,
        "yield_dcy": pd.DataFrame([{"district_id": "1-0", "crop_id": "rice", "season": "kharif", "year": 2020,
                                    "yield_kg_acre": 1200.0, "area_ha": 10.0, **prov}]),
        "price_district_weekly": pd.DataFrame([{"district_id": "1-0", "crop_id": "rice", "week": "2025-01-06",
                                                "price_inr_kg": 23.0, **prov}]),
        "weather_daily": pd.DataFrame([{"district_id": "1-0", "date": "2025-01-01", "rain_mm": 1.0,
                                        "tmin": 10.0, "tmax": 25.0, **prov}]),
        "weather_season": pd.DataFrame([{"district_id": "1-0", "season": "rabi", "year": 2024, **prov}]),
    }
    for n, df in tables.items():
        df.to_parquet(tmp_path / f"{n}.parquet", index=False)
    (tmp_path / "manifest.json").write_text(json.dumps({"tables": {n: {"rows": len(df)} for n, df in tables.items()}}))


def test_validate_passes_clean_store_and_fails_synthetic_rows(tmp_path, monkeypatch):
    monkeypatch.setattr(validate_mod, "CURATED", tmp_path)
    monkeypatch.setattr(validate_mod, "MANIFEST", tmp_path / "none.json")
    _curated(tmp_path)
    assert validate_mod.validate() == []
    _curated(tmp_path, synthetic=True)
    errors = validate_mod.validate()
    assert any("synthetic" in e for e in errors)


def test_validate_fails_when_rows_shrink(tmp_path, monkeypatch):
    monkeypatch.setattr(validate_mod, "CURATED", tmp_path)
    prev = tmp_path / "prev.json"
    prev.write_text(json.dumps({"tables": {"yield_dcy": {"rows": 100}}}))
    monkeypatch.setattr(validate_mod, "MANIFEST", prev)
    _curated(tmp_path)
    assert any("rows fell" in e for e in validate_mod.validate())
    assert validate_mod.validate(allow_shrink=True) == []


def test_store_reads_serving_db(tmp_path):
    from utils import store

    db = tmp_path / "s.sqlite"
    con = sqlite3.connect(db)
    con.execute("CREATE TABLE yield_dcy (district_id, crop_id, season, year, yield_kg_acre)")
    con.execute("INSERT INTO yield_dcy VALUES ('36-513','rice','kharif',2022,1400)")
    con.commit()
    con.close()
    rows = store.query("SELECT * FROM yield_dcy WHERE district_id = ?", ("36-513",), path=db)
    assert rows == [{"district_id": "36-513", "crop_id": "rice", "season": "kharif", "year": 2022,
                     "yield_kg_acre": 1400}]
    assert store.query("SELECT 1", path=tmp_path / "missing.sqlite") == []
    store.reset()


# ---- national and state tables (A7, A8, A11, A12) ---------------------------

def test_costs_stage_converts_hectares_to_acres_and_keeps_larger_sample(tmp_path):
    raw = tmp_path / "costs"
    raw.mkdir()
    cols = ["year", "state_code", "state_name", "crop_name", "num_holdings_sample", "derived_yield",
            "prod_cost_a2fl", "prod_cost_c2", *costs.PER_HA]
    base = {c: 1000.0 for c in costs.PER_HA}
    rows = [
        {**base, "year": "2021-22", "state_code": "23", "state_name": "MP", "crop_name": "Wheat",
         "num_holdings_sample": 300, "derived_yield": 40, "prod_cost_a2fl": 1200, "prod_cost_c2": 1800,
         "cul_cost_a2": 27000.0, "cul_cost_c2": 50000.0},
        # a re-release of the same estimate with a smaller sample loses
        {**base, "year": "2021-22", "state_code": "23", "state_name": "MP", "crop_name": "Wheat",
         "num_holdings_sample": 10, "derived_yield": 40, "prod_cost_a2fl": 1, "prod_cost_c2": 1,
         "cul_cost_a2": 99999.0, "cul_cost_c2": 99999.0},
        # crops without an app crop_id are ignored
        {**base, "year": "2021-22", "state_code": "23", "state_name": "MP", "crop_name": "Nigerseed",
         "num_holdings_sample": 5, "derived_yield": 4, "prod_cost_a2fl": 1, "prod_cost_c2": 1},
    ]
    pd.DataFrame(rows, columns=cols).to_csv(raw / "c.csv", index=False)
    write_fetch_meta(raw, resource="fixture")
    df = costs.stage(raw / "c.csv", tmp_path / "out.parquet")
    assert len(df) == 1
    r = df.iloc[0]
    assert (r.crop_id, r.year) == ("wheat", 2021)
    assert r.cost_a2_inr_acre == pytest.approx(27000 * 0.404686)
    assert r.cost_c2_inr_acre == pytest.approx(50000 * 0.404686)
    assert not df["is_synthetic"].any()


def test_msp_stage_uses_fallback_names_and_sugarcane_frp(tmp_path):
    raw = tmp_path / "msp"
    raw.mkdir()
    pd.DataFrame([
        {"year": "2020-2021", "crop": "Cotton", "season": "Kharif", "min_support_price": 5515},
        {"year": "2021-2022", "crop": "Cotton", "season": "Kharif", "min_support_price": 5726},
        {"year": "2021-2022", "crop": "Cotton - Medium Staple", "season": "Kharif", "min_support_price": 5726},
        {"year": "2025-2026", "crop": "Paddy - Common", "season": "Kharif", "min_support_price": 2369},
        {"year": "2017-2018", "crop": "Sugarcane", "season": "Others", "min_support_price": 255},
    ]).to_csv(raw / "m.csv", index=False)
    write_fetch_meta(raw, resource="fixture")
    df = msp.stage(raw / "m.csv", tmp_path / "out.parquet")
    cot = df[df.crop_id == "cotton"].set_index("year")
    assert list(cot.index) == [2020, 2021]  # one row per year, preferred name wins 2021
    assert cot.loc[2021, "msp_variety"] == "Cotton - Medium Staple"
    assert df[(df.crop_id == "rice") & (df.year == 2025)].iloc[0].msp_inr_per_kg == pytest.approx(23.69)
    cane = df[df.crop_id == "sugarcane"].set_index("year")
    assert cane.loc[2017, "season"] == "annual" and cane.loc[2017, "msp_variety"] == "Sugarcane"
    assert cane.loc[2025, "msp_variety"] == "FRP"  # filled from the reference table
    assert "paddy_basmati" not in set(df.crop_id)  # no MSP exists for basmati


def test_irrigation_stage_sums_seasons_into_years(tmp_path):
    raw = tmp_path / "irrigation"
    raw.mkdir()
    (raw / "rice.csv").write_text(
        "state_code,district_code,state_name,district_name,year,irrigated_ha,crop_name\n"
        "36,513.0,Telangana,Medak,2020-2021,1000,Rice\n"
        "36,513.0,Telangana,Medak,2020-2021,500,Rice\n"
        "36,nan,Telangana,,2020-2021,9,Rice\n", encoding="utf-8")
    write_fetch_meta(raw, resource="fixture")
    df = irrigation.stage(raw, tmp_path / "out.parquet")
    assert len(df) == 1
    assert (df.iloc[0].crop_id, df.iloc[0].year, df.iloc[0].irrigated_ha) == ("rice", 2020, 1500)


def test_soil_health_stage_turns_sample_counts_into_shares(tmp_path):
    raw = tmp_path / "soil"
    raw.mkdir()
    (raw / "state_36.csv").write_text(
        "state_code,district_code,state_name,district_name,year,nutrient_name,nutrient_level,n_samples\n"
        "36,513,Telangana,Medak,2024-25,Nitrogen,Low,60\n"
        "36,513,Telangana,Medak,2024-25,Nitrogen,Medium,30\n"
        "36,513,Telangana,Medak,2024-25,Nitrogen,High,10\n"
        "36,513,Telangana,Medak,2024-25,Soil Ph,Acidic,0\n"
        "36,513,Telangana,Medak,2024-25,Soil Ph,Neutral,0\n", encoding="utf-8")
    write_fetch_meta(raw, resource="fixture")
    df = soil_health.stage(raw, tmp_path / "out.parquet")
    assert len(df) == 1  # pH with zero samples is dropped, not shown as 0%
    n = df.iloc[0]
    assert (n.nutrient, n.year, n.n_samples) == ("n", 2024, 100)
    assert (n.share_low, n.share_medium, n.share_high) == (0.6, 0.3, 0.1)


def test_reference_reader_skips_comments_before_header():
    from pipelines.common import read_reference

    frp = read_reference("sugarcane_frp.csv")
    assert frp and all(r["crop_id"] == "sugarcane" for r in frp)


def test_validate_gates_optional_tables(tmp_path, monkeypatch):
    monkeypatch.setattr(validate_mod, "CURATED", tmp_path)
    monkeypatch.setattr(validate_mod, "MANIFEST", tmp_path / "none.json")
    _curated(tmp_path)
    prov = {"source": "fixture", "fetched_at": "2026-11-18", "licence": "x", "is_synthetic": False}
    pd.DataFrame([{"district_id": "1-0", "year": 2024, "nutrient": "n", "share_low": 0.7,
                   "share_medium": 0.7, "share_high": 0.0, **prov}]).to_parquet(tmp_path / "soil_district.parquet")
    pd.DataFrame([{"crop_id": "rice", "year": 2025, "season": "kharif", "msp_inr_per_quintal": 0.0,
                   **prov}]).to_parquet(tmp_path / "msp.parquet")
    errors = validate_mod.validate()
    assert any("do not sum to 1" in e for e in errors)
    assert any("non-positive MSP" in e for e in errors)


def test_live_prices_skip_without_key(monkeypatch):
    monkeypatch.delenv("DATAGOV_API_KEY", raising=False)
    assert agmarknet_live.download() is None


def test_live_prices_match_district_names_and_take_weekly_median(tmp_path):
    raw = tmp_path / "live"
    raw.mkdir()
    cols = "state,district,market,commodity,variety,grade,arrival_date,min_price,max_price,modal_price\n"
    (raw / "2026-11-17.csv").write_text(cols +
        "Madhya Pradesh,Sehore,Sehore,Wheat,Lokwan,FAQ,17/11/2026,2400,2600,2500\n"
        "Madhya Pradesh,Sehore,Ashta,Wheat,Lokwan,FAQ,17/11/2026,2300,2500,2400\n"
        "Madhya Pradesh,Nowhere,X,Wheat,Lokwan,FAQ,17/11/2026,1,1,1\n", encoding="utf-8")
    # the next snapshot repeats one report and adds a new day
    (raw / "2026-11-18.csv").write_text(cols +
        "Madhya Pradesh,Sehore,Sehore,Wheat,Lokwan,FAQ,17/11/2026,2400,2600,2500\n"
        "Madhya Pradesh,Sehore,Sehore,Wheat,Lokwan,FAQ,18/11/2026,2500,2700,2600\n", encoding="utf-8")
    districts = pd.DataFrame({"state_name": ["Madhya Pradesh"], "district_name": ["Sehore"],
                              "state_code": ["23"], "district_code": ["427"], "district_id": ["23-427"]})
    g = agmarknet_live.stage(raw, districts, tmp_path / "out.parquet")
    assert len(g) == 1
    r = g.iloc[0]
    assert str(r.week) == "2026-11-16"  # Monday, same convention as the bulk history
    assert r.n_reports == 3 and r.n_mandis == 2 and r.n_days == 2
    assert r.price_inr_kg == pytest.approx(25.0)  # median of 2500, 2400, 2600
    assert r.resource == "live"


def test_live_prices_absent_means_no_table(tmp_path):
    assert agmarknet_live.stage(tmp_path / "none", pd.DataFrame(), tmp_path / "out.parquet") is None


# ---- growth-stage weather ----------------------------------------------------

def test_stage_plans_follow_the_app_calendar():
    from pipelines import weather_stage

    plans = {(p["crop_id"], p["season"]): p for p in weather_stage.crop_stage_plans()}
    rice = plans[("rice", "kharif")]
    assert (rice["sow_month"], rice["sow_day"]) == (6, 30)  # middle of Jun 15 - Jul 15
    assert rice["duration_days"] == 120 and len(rice["stages"]) == 4
    assert plans[("wheat", "rabi")]["gdd_base"] == 5.0
    assert plans[("pulses", "kharif")]["gdd_base"] == 10.0
    assert len(plans[("watermelon", "zaid")]["stages"]) == 1  # no stage table -> one stage


def test_stage_weather_cuts_rain_by_stage_and_finds_onset():
    from pipelines import weather_stage

    days = pd.date_range("2024-01-01", "2025-06-30", freq="D")
    rain = pd.Series(0.0, index=days)
    rain["2024-06-10":"2024-06-11"] = 15.0  # 30 mm over two days ...
    rain["2024-06-12":"2024-10-31"] = 3.0   # ... and no dry spell after: onset Jun 10
    w = pd.DataFrame({"district_id": "36-513", "date": days, "rain_mm": rain.values,
                      "tmax": 36.0, "tmean": 30.0})
    st, on = weather_stage.build(w)
    assert on.set_index("year").loc[2024, "onset_date"] == "2024-06-10"
    rice = st[(st.crop_id == "rice") & (st.year == 2024)].sort_values("stage_idx")
    first = rice.iloc[0]  # Jun 30 + 0..23 days
    assert first.start_date == "2024-06-30" and first.n_days == 24
    assert first.rain_mm == pytest.approx(24 * 3.0)
    assert first.hot_days_35c == 24 and first.dry_spell_max_days == 0
    assert first.gdd == pytest.approx(24 * 20.0)  # (30 - 10) per day
    # rabi 2024 wheat runs into 2025 and is present; rabi 2025 is past the data and absent
    assert not st[(st.crop_id == "wheat") & (st.year == 2024)].empty
    assert st[(st.crop_id == "wheat") & (st.year == 2025)].empty


def test_apmc_uses_each_feeds_own_commodity_spelling():
    old, new = apmc._commodities("old"), apmc._commodities("new")
    assert old["Paddy(Dhan)(Common)"] == "rice" and "Paddy(Common)" not in old
    assert new["Paddy(Common)"] == "rice" and "Paddy(Dhan)(Common)" not in new
    assert new["Wheat"] == "wheat"  # unchanged names carry over
    both = apmc._commodities()
    assert both["Paddy(Common)"] == both["Paddy(Dhan)(Common)"] == "rice"


def test_refresh_builds_when_live_prices_cannot_be_fetched(monkeypatch, caplog, capsys):
    """data.gov.in refuses GitHub's runners; the rest of the refresh must still land."""
    from pipelines import run

    def unreachable():
        raise RuntimeError("GET https://api.data.gov.in/resource/x?api-key=SECRET123&format=json "
                           "failed after 6 tries: No route to host")

    built = []
    monkeypatch.setattr(agmarknet_live, "download", unreachable)
    monkeypatch.setattr(run, "download", lambda: None)
    monkeypatch.setattr(apmc, "download", lambda **kw: None)
    monkeypatch.setattr(nasa_power, "download", lambda **kw: None)
    monkeypatch.setattr(run, "build", lambda allow_shrink=False: built.append(allow_shrink) or 0)
    monkeypatch.setenv("GITHUB_ACTIONS", "true")

    with caplog.at_level("WARNING"):
        assert run.main(["refresh"]) == 0
    assert built == [False]
    out = capsys.readouterr().out
    assert "::warning title=Live mandi prices skipped::" in out
    assert "live snapshot skipped" in caplog.text
    assert "SECRET123" not in out + caplog.text
