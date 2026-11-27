"""Yield model on measured district data (Phase 2, spec 2.1).

The target is the season's departure from the district-crop trend:

    anomaly = log(yield) - log(trend)

where the trend is a robust linear fit over that district-crop's *prior* years only.
The prediction is trend * exp(anomaly). Crop identity and district level live in the
trend, so the model only has to learn what weather, water and soil do to a season;
the old model's 0.99 R² came almost entirely from crop identity (AUDIT B-18, N-1, N-2).

This module holds everything both training (ml/train.py) and serving need, so the
feature layout exists in one place:

- ``build_training_frame`` (pandas): one row per district x crop x season x year with
  the trend, the 5-year-mean baseline and every feature.
- ``YieldModel`` (numpy only, no pandas at request time): loads the released artifact,
  predicts a yield and its 80% range for a district, crop and season, at normal weather
  ("at sowing") or under a rain / irrigation scenario.

Weather enters only as departures from normal, split into a deficit and a surplus. Every
deficit, heat and dry-spell feature carries a monotonic constraint, so less rain, more
heat or a longer dry spell can never raise a prediction.
"""
from __future__ import annotations

import logging
import math
import threading
from pathlib import Path
from typing import Any

import numpy as np

logger = logging.getLogger(__name__)

ROOT = Path(__file__).resolve().parents[1]
CURATED = ROOT / "data" / "curated"
RELEASED = ROOT / "ml" / "models" / "yield" / "current.joblib"

# Years 1997..NORMAL_LAST define "normal" weather. They stop before the time split's
# test years (TEST_FIRST..) so the normals used to score a test season never contain it.
NORMAL_LAST = 2017
TEST_FIRST = 2018
MIN_PRIOR_YEARS = 5
TREND_WINDOW = 15
MAX_STAGES = 5
ANOMALY_CLIP = 2.0

# annual / perennial crops are scored on the main (kharif) monsoon season's weather.
WEATHER_SEASON = {"kharif": "kharif", "rabi": "rabi", "zaid": "zaid",
                  "annual": "kharif", "perennial": "kharif"}

CATEGORICAL = ("crop", "season", "state")

# name -> monotonic constraint (-1: may only lower the prediction; 0: free).
FEATURES: dict[str, int] = {
    "crop": 0, "season": 0, "state": 0,
    "rain_deficit": -1, "rain_surplus": 0,
    "dry_spell_days": -1, "hot_days_35c": -1, "temp_departure_c": 0,
    "onset_delay_days": 0,
    "irrigated_share": 0, "deficit_x_rainfed": -1,
    "soil_acidic": 0, "soil_alkaline": 0, "soil_low_oc": 0, "soil_low_n": 0,
    "prev_anomaly": 0, "mean5_gap": 0, "mean3_gap": 0, "log_sd8": 0,
    **{f"stage{i}_deficit": -1 for i in range(MAX_STAGES)},
    **{f"stage{i}_surplus": 0 for i in range(MAX_STAGES)},
    **{f"stage{i}_hot_days": -1 for i in range(MAX_STAGES)},
    **{f"stage{i}_dry_spell": -1 for i in range(MAX_STAGES)},
}
FEATURE_NAMES = list(FEATURES)
RAIN_FEATURES = ["rain_deficit", "rain_surplus",
                 *[f"stage{i}_deficit" for i in range(MAX_STAGES)],
                 *[f"stage{i}_surplus" for i in range(MAX_STAGES)]]


# --------------------------------------------------------------------------- trend


def _robust_line(x: np.ndarray, y: np.ndarray) -> tuple[float, float]:
    """Least squares, then refit without points more than 3 MADs off the line."""
    if len(x) < 3 or np.ptp(x) == 0:
        return 0.0, float(np.median(y))
    slope, icept = np.polyfit(x, y, 1)
    r = y - (slope * x + icept)
    mad = np.median(np.abs(r - np.median(r))) * 1.4826
    if mad > 0:
        keep = np.abs(r) <= 3 * mad
        if keep.sum() >= 3 and keep.sum() < len(x) and np.ptp(x[keep]) > 0:
            slope, icept = np.polyfit(x[keep], y[keep], 1)
    return float(slope), float(icept)


def trend_at(years: np.ndarray, log_yields: np.ndarray, target_year: int) -> float | None:
    """log(trend) at ``target_year`` from observations strictly before it."""
    m = years < target_year
    x, y = years[m][-TREND_WINDOW:], log_yields[m][-TREND_WINDOW:]
    if len(x) < MIN_PRIOR_YEARS:
        return None
    slope, icept = _robust_line(x.astype(float), y)
    # The fitted level at the last observed year; then a trend that may not run away:
    # at most 4% a year either way, extrapolated <= 3 years.
    level = slope * x[-1] + icept
    slope = float(np.clip(slope, -0.04, 0.04))
    return float(level + slope * min(target_year - x[-1], 3))


def add_trend(y) -> Any:
    """Add log_trend, baseline_mean5 and prev_anomaly to a yield frame (pandas)."""
    import pandas as pd

    out = []
    for _, g in y.sort_values("year").groupby(["district_id", "crop_id", "season"], sort=False):
        years = g["year"].to_numpy()
        logs = np.log(g["yield_kg_acre"].to_numpy())
        kg = g["yield_kg_acre"].to_numpy()
        lt = np.full(len(g), np.nan)
        b5 = np.full(len(g), np.nan)
        b3 = np.full(len(g), np.nan)
        sd = np.full(len(g), np.nan)
        for i in range(len(g)):
            t = trend_at(years, logs, int(years[i]))
            if t is not None:
                lt[i] = t
                b5[i] = kg[max(0, i - 5):i].mean()
                b3[i] = kg[max(0, i - 3):i].mean()
                sd[i] = logs[max(0, i - 8):i].std()
        h = g.assign(log_trend=lt, baseline_mean5=b5, baseline_mean3=b3, log_sd8=sd)
        anom = np.log(h["yield_kg_acre"]) - h["log_trend"]
        prev = pd.Series(anom.to_numpy(), index=h["year"]).shift(1)
        prev_year = pd.Series(years, index=h["year"]).shift(1)
        ok = (prev_year.to_numpy() == years - 1)
        h["prev_anomaly"] = np.where(ok, prev.to_numpy(), np.nan)
        out.append(h)
    return pd.concat(out, ignore_index=True)


# ----------------------------------------------------------------------- features


def _deficit(pct):
    return np.clip(1.0 - pct, 0.0, 1.0)


def _surplus(pct):
    return np.clip(pct - 1.0, 0.0, 3.0)


def load_tables(curated: Path = CURATED) -> dict[str, Any]:
    import pandas as pd

    def rd(name, cols=None):
        return pd.read_parquet(curated / f"{name}.parquet", columns=cols)

    return {
        "yield": rd("yield_dcy", ["district_id", "state_code", "crop_id", "season", "year",
                                  "yield_kg_acre", "area_acres", "region_id"]),
        "season": rd("weather_season", ["district_id", "season", "year", "rainfall_mm",
                                        "avg_temp_c", "dry_spell_max_days", "hot_days_35c"]),
        "stage": rd("weather_stage", ["district_id", "crop_id", "season", "year", "stage_idx",
                                      "rain_mm", "hot_days_35c", "dry_spell_max_days"]),
        "onset": rd("monsoon_onset", ["district_id", "year", "onset_doy"]),
        "irr": rd("irrigation_share", ["district_id", "crop_id", "year", "irrigated_share"]),
        "soil": rd("soil_district", ["district_id", "year", "nutrient", "share_acidic",
                                     "share_alkaline", "share_low"]),
        "manifest": (curated / "manifest.json").read_text(encoding="utf-8"),
    }


def weather_features(t: dict[str, Any]):
    """Per (district, weather season, year) and per (district, crop, season, year) frames
    of weather departures from normal, plus the normals themselves."""
    import pandas as pd

    s = t["season"].copy()
    base = s[s["year"] <= NORMAL_LAST]
    norm = base.groupby(["district_id", "season"]).agg(
        n_rain=("rainfall_mm", "mean"), n_temp=("avg_temp_c", "mean"),
        n_dry=("dry_spell_max_days", "mean"), n_hot=("hot_days_35c", "mean"),
    ).reset_index()
    s = s.merge(norm, on=["district_id", "season"], how="left")
    pct = s["rainfall_mm"] / s["n_rain"].where(s["n_rain"] > 1)
    season_f = pd.DataFrame({
        "district_id": s["district_id"], "wseason": s["season"], "year": s["year"],
        "rain_deficit": _deficit(pct), "rain_surplus": _surplus(pct),
        "dry_spell_days": s["dry_spell_max_days"], "hot_days_35c": s["hot_days_35c"],
        "temp_departure_c": s["avg_temp_c"] - s["n_temp"],
    })

    o = t["onset"]
    on = o[o["year"] <= NORMAL_LAST].groupby("district_id")["onset_doy"].median().rename("n_onset")
    o = o.join(on, on="district_id")
    onset_f = pd.DataFrame({"district_id": o["district_id"], "year": o["year"],
                            "onset_delay_days": o["onset_doy"] - o["n_onset"]})

    st = t["stage"].copy()
    key = ["district_id", "crop_id", "season", "stage_idx"]
    n_st = st[st["year"] <= NORMAL_LAST].groupby(key)["rain_mm"].mean().rename("n_rain")
    st = st.join(n_st, on=key)
    spct = st["rain_mm"] / st["n_rain"].where(st["n_rain"] > 1)
    st = st.assign(deficit=_deficit(spct), surplus=_surplus(spct))
    wide = st.pivot_table(index=["district_id", "crop_id", "season", "year"], columns="stage_idx",
                          values=["deficit", "surplus", "hot_days_35c", "dry_spell_max_days"])
    names = {"deficit": "deficit", "surplus": "surplus", "hot_days_35c": "hot_days",
             "dry_spell_max_days": "dry_spell"}
    wide.columns = [f"stage{int(i)}_{names[v]}" for v, i in wide.columns]
    stage_f = wide.reset_index()

    normals = {
        "season": norm.rename(columns={"season": "wseason"}),
        "stage_hot": st[st["year"] <= NORMAL_LAST].groupby(key)[["hot_days_35c", "dry_spell_max_days"]].mean(),
    }
    return season_f, onset_f, stage_f, normals


def static_features(t: dict[str, Any]):
    """Soil (latest Soil Health Card year) per district; irrigation per district x crop x year."""
    import pandas as pd

    so = t["soil"].sort_values("year").groupby(["district_id", "nutrient"]).last().reset_index()
    soil = pd.DataFrame({"district_id": so["district_id"].unique()}).set_index("district_id")
    for nut, col, name in (("ph", "share_acidic", "soil_acidic"), ("ph", "share_alkaline", "soil_alkaline"),
                           ("oc", "share_low", "soil_low_oc"), ("n", "share_low", "soil_low_n")):
        soil[name] = so[so["nutrient"] == nut].set_index("district_id")[col]
    irr = t["irr"].dropna(subset=["irrigated_share"]).copy()
    irr["irrigated_share"] = irr["irrigated_share"].clip(0, 1)
    return soil.reset_index(), irr


def _attach_irrigation(df, irr):
    """Irrigated share for each row: same year, else the nearest year on record."""
    import pandas as pd

    out = df.copy()
    out["irrigated_share"] = np.nan
    keys = irr.groupby(["district_id", "crop_id"])
    lookup = {k: (g["year"].to_numpy(), g["irrigated_share"].to_numpy()) for k, g in keys}
    vals = np.full(len(out), np.nan)
    for i, (d, c, yr) in enumerate(zip(out["district_id"], out["crop_id"], out["year"])):
        hit = lookup.get((d, c))
        if hit is not None:
            years, shares = hit
            vals[i] = shares[np.abs(years - yr).argmin()]
    out["irrigated_share"] = vals
    return out


def assemble(rows, season_f, onset_f, stage_f, soil, irr):
    """Join features onto rows with district_id, crop_id, season, year (pandas)."""
    df = rows.copy()
    df["wseason"] = df["season"].map(WEATHER_SEASON).fillna("kharif")
    df = df.merge(season_f, on=["district_id", "wseason", "year"], how="left")
    df = df.merge(onset_f, on=["district_id", "year"], how="left")
    df.loc[df["wseason"] != "kharif", "onset_delay_days"] = np.nan
    df = df.merge(stage_f, on=["district_id", "crop_id", "season", "year"], how="left")
    df = df.merge(soil, on="district_id", how="left")
    df = _attach_irrigation(df, irr)
    df["deficit_x_rainfed"] = df["rain_deficit"] * (1.0 - df["irrigated_share"].fillna(0.5))
    if "baseline_mean5" in df and "log_trend" in df:
        df["mean5_gap"] = np.log(df["baseline_mean5"]) - df["log_trend"]
    if "baseline_mean3" in df and "log_trend" in df:
        df["mean3_gap"] = np.log(df["baseline_mean3"]) - df["log_trend"]
    df["state"] = df["district_id"].str.split("-").str[0]
    df["crop"] = df["crop_id"]
    for col in FEATURE_NAMES:
        if col not in df:
            df[col] = np.nan
    return df


def build_training_frame(t: dict[str, Any]):
    """Every measured district-crop-season-year with a trend and season weather."""
    y = t["yield"]
    y = y[(y["yield_kg_acre"] > 0) & y["district_id"].notna()]
    y = add_trend(y)
    y = y[y["log_trend"].notna()].copy()
    y["anomaly"] = (np.log(y["yield_kg_acre"]) - y["log_trend"]).clip(-ANOMALY_CLIP, ANOMALY_CLIP)
    season_f, onset_f, stage_f, normals = weather_features(t)
    soil, irr = static_features(t)
    df = assemble(y, season_f, onset_f, stage_f, soil, irr)
    df = df[df["rain_deficit"].notna()].reset_index(drop=True)
    return df, (season_f, onset_f, stage_f, normals, soil, irr)


def to_normal(df, normals):
    """The same rows with every weather feature set to the district's normal season:
    what is known at sowing. Stage features stay missing for crops without stages."""
    out = df.copy()
    sn = normals["season"].set_index(["district_id", "wseason"])
    idx = list(zip(out["district_id"], out["wseason"]))
    out["dry_spell_days"] = sn["n_dry"].reindex(idx).to_numpy()
    out["hot_days_35c"] = sn["n_hot"].reindex(idx).to_numpy()
    out["rain_deficit"] = 0.0
    out["rain_surplus"] = 0.0
    out["temp_departure_c"] = 0.0
    out["onset_delay_days"] = np.where(out["wseason"] == "kharif", 0.0, np.nan)
    out["deficit_x_rainfed"] = 0.0
    st = normals["stage_hot"]
    for i in range(MAX_STAGES):
        key = list(zip(out["district_id"], out["crop_id"], out["season"], [i] * len(out)))
        hot = st["hot_days_35c"].reindex(key).to_numpy()
        dry = st["dry_spell_max_days"].reindex(key).to_numpy()
        has = ~np.isnan(hot)
        out[f"stage{i}_deficit"] = np.where(has, 0.0, np.nan)
        out[f"stage{i}_surplus"] = np.where(has, 0.0, np.nan)
        out[f"stage{i}_hot_days"] = hot
        out[f"stage{i}_dry_spell"] = dry
    return out


def encode(df, categories: dict[str, list[str]] | None = None):
    """Feature matrix (float32) with categoricals as integer codes; unknown -> NaN."""
    if categories is None:
        categories = {c: sorted(df[c].dropna().astype(str).unique().tolist()) for c in CATEGORICAL}
    X = np.empty((len(df), len(FEATURE_NAMES)), dtype=np.float32)
    for j, name in enumerate(FEATURE_NAMES):
        if name in CATEGORICAL:
            idx = {v: k for k, v in enumerate(categories[name])}
            X[:, j] = [idx.get(str(v), np.nan) for v in df[name]]
        else:
            X[:, j] = df[name].to_numpy(dtype=np.float32, na_value=np.nan)
    return X, categories


# ------------------------------------------------------------------------ serving


class YieldModel:
    """The released yield model plus its per district-crop-season lookup.

    The artifact (a dict written by ml/train.py) holds: ``q10``/``q50``/``q90`` fitted
    HistGradientBoostingRegressor models on the anomaly, conformal widths per crop group,
    category lists, and ``lookup``: for each (district_id, crop_id, season) the log trend
    for the coming season, the normal-weather feature row, and the yield range across
    the last seasons' weather.
    """

    def __init__(self, artifact: dict[str, Any]):
        self.a = artifact
        self.version = artifact["version"]
        self.lookup: dict[tuple[str, str, str], dict[str, Any]] = artifact["lookup"]
        self.region_to_district: dict[str, str] = artifact.get("region_to_district", {})
        self.serves_baseline = artifact.get("serve", "model") == "baseline"
        self._col = {n: i for i, n in enumerate(FEATURE_NAMES)}

    def entry(self, district_id: str, crop_id: str, season: str) -> dict[str, Any] | None:
        s = season.lower()
        for key in (s, "annual", "perennial"):
            hit = self.lookup.get((district_id, crop_id, key))
            if hit is not None:
                return hit
        return None

    def _widths(self, crop_id: str) -> tuple[float, float]:
        grp = self.a["crop_group"].get(crop_id, "other")
        w = self.a["conformal"].get(grp) or self.a["conformal"]["_all"]
        return float(w["lo"]), float(w["hi"])

    def _row(self, e: dict[str, Any], rain_pct: float | None, irrigated_share: float | None) -> np.ndarray:
        x = np.array(e["x"], dtype=np.float32)
        c = self._col
        if irrigated_share is not None:
            x[c["irrigated_share"]] = float(np.clip(irrigated_share, 0.0, 1.0))
        if rain_pct is not None:
            pct = max(float(rain_pct), 0.0)
            for name in RAIN_FEATURES:
                x[c[name]] = np.nan if (name.startswith("stage") and np.isnan(x[c[name]])) else (
                    _deficit(pct) if name.endswith("deficit") else _surplus(pct))
        irr = x[c["irrigated_share"]]
        x[c["deficit_x_rainfed"]] = x[c["rain_deficit"]] * (1.0 - (0.5 if np.isnan(irr) else irr))
        return x

    def predict(self, district_id: str, crop_id: str, season: str,
                rain_pct: float | None = None, irrigated_share: float | None = None) -> dict[str, Any] | None:
        """Yield (kg/acre) with an 80% range, or None where the district has no record.

        With no scenario the answer is the "at sowing" one: normal weather, and a range
        that spans both the model's error and the last seasons' weather. With
        ``rain_pct`` (1.0 = normal) and/or ``irrigated_share`` the season is scored
        under that weather, and the range is the model's conformal 80% interval.
        """
        e = self.entry(district_id, crop_id, season)
        if e is None:
            return None
        trend = math.exp(e["log_trend"])
        scenario = rain_pct is not None or irrigated_share is not None
        if self.serves_baseline:
            # The model did not clear its gate (see its model card): serve the district's
            # 5-year mean. A mean cannot answer a weather scenario, so the caller's
            # heuristic does.
            if scenario:
                return None
            return {"yield_kg_per_acre": round(trend * math.exp(e["b50"]), 1),
                    "low": round(trend * math.exp(e["b_lo"]), 1),
                    "high": round(trend * math.exp(e["b_hi"]), 1),
                    "trend_kg_per_acre": round(trend, 1), "model_version": self.version,
                    "source": "district_5yr_mean", "years_on_record": e["n_years"],
                    "last_year": e["last_year"],
                    "range_basis": "how far seasons have strayed from the 5-year mean (calibrated 80%)"}
        if not scenario:
            return {"yield_kg_per_acre": round(trend * math.exp(e["a50"]), 1),
                    "low": round(trend * math.exp(e["a_lo"]), 1),
                    "high": round(trend * math.exp(e["a_hi"]), 1),
                    "trend_kg_per_acre": round(trend, 1), "model_version": self.version,
                    "source": "yield_model", "years_on_record": e["n_years"],
                    "last_year": e["last_year"],
                    "range_basis": "model error and the weather still to come (calibrated 80%)"}
        return self.predict_rows([(e, crop_id, rain_pct, irrigated_share)])[0]

    def predict_rows(self, rows) -> list[dict[str, Any]]:
        X = np.stack([self._row(e, r, i) for e, _, r, i in rows])
        q10, q50, q90 = (self.a[k].predict(X) for k in ("q10", "q50", "q90"))
        out = []
        for k, (e, crop_id, _, _) in enumerate(rows):
            lo_w, hi_w = self._widths(crop_id)
            trend = math.exp(e["log_trend"])
            mid = float(q50[k])
            lo = min(float(q10[k]) - lo_w, mid)
            hi = max(float(q90[k]) + hi_w, mid)
            out.append({"yield_kg_per_acre": round(trend * math.exp(mid), 1),
                        "low": round(trend * math.exp(lo), 1),
                        "high": round(trend * math.exp(hi), 1),
                        "trend_kg_per_acre": round(trend, 1), "model_version": self.version,
                        "source": "yield_model",
                        "range_basis": "model error given this weather (calibrated 80%)"})
        return out


_model: YieldModel | None = None
_model_loaded = False
_lock = threading.Lock()


def load(path: Path = RELEASED) -> YieldModel | None:
    """The released model, loaded once; None when no artifact is shipped."""
    global _model, _model_loaded
    if _model_loaded:
        return _model
    with _lock:
        if not _model_loaded:
            try:
                import joblib
                _model = YieldModel(joblib.load(path)) if path.exists() else None
            except Exception as exc:  # a broken artifact must not take the API down
                logger.warning("yield model not loaded: %s", exc)
                _model = None
            _model_loaded = True
    return _model


def reset() -> None:
    global _model, _model_loaded
    with _lock:
        _model, _model_loaded = None, False
