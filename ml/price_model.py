"""Weekly district price forecast (Phase 2, spec 2.2).

Target: the change in log price from the origin week to ``h`` weeks later, for
h in HORIZONS. One gradient-boosted model per horizon, across crops (crop is a
category). Three baselines, all in the same terms:

- ``last``: no change from the latest price;
- ``seasonal``: the change the same weeks showed a year earlier;
- ``mean``: back to the series' two-year mean (the app's previous "model" used the
  historical mean).

Each crop x horizon cell serves the model only where its rolling-origin backtest
beat the best baseline by GATE; elsewhere the best baseline serves, and the API says
"typical for this time of year". Ranges (80%) come from the served method's own
backtest errors for that cell, so they are calibrated by construction.

``features_for`` builds features from a weekly log-price matrix and is shared by
training (all series at once) and serving (one series), so the layout exists once.
"""
from __future__ import annotations

import logging
import math
from pathlib import Path
from typing import Any

import numpy as np

from ml._artifact import LazyArtifact

logger = logging.getLogger(__name__)

ROOT = Path(__file__).resolve().parents[1]
RELEASED = ROOT / "ml" / "models" / "price" / "current.joblib"

HORIZONS = (1, 4, 8, 12, 26)
LAGS = tuple(range(1, 9))
GATE = 0.05
BASELINES = ("last", "seasonal", "mean")
FEATURE_NAMES = (
    [f"chg_{k}" for k in LAGS]
    + ["chg_52", "seasonal_gap", "dev_mean4", "dev_mean13", "vol13", "mean_gap",
       "woy_sin", "woy_cos", "arrivals_anom", "msp_gap", "state_gap", "n_obs52", "crop"]
)
CATEGORICAL = ("crop",)


def _shift(M: np.ndarray, k: int) -> np.ndarray:
    """M shifted right by k weeks along axis 1 (value at t is M[:, t-k])."""
    out = np.full_like(M, np.nan)
    if k < M.shape[1]:
        out[:, k:] = M[:, :-k] if k else M
    return out


MEAN_WEEKS = 104   # the "long-run" mean: two years, all the serving store keeps


def _window_sums(M: np.ndarray, w: int) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    """Trailing-window (sum, sum of squares, count) over the last w weeks, ignoring NaN."""
    ok = ~np.isnan(M)
    x = np.where(ok, M, 0.0)
    def trail(a):
        c = np.cumsum(a, axis=1)
        out = c.copy()
        out[:, w:] = c[:, w:] - c[:, :-w]
        return out
    return trail(x), trail(x * x), trail(ok.astype(float))


def _rolling_mean(M: np.ndarray, w: int) -> np.ndarray:
    s, _, n = _window_sums(M, w)
    return np.where(n > 0, s / np.maximum(n, 1), np.nan)


def _rolling_std(M: np.ndarray, w: int) -> np.ndarray:
    s, ss, n = _window_sums(M, w)
    with np.errstate(all="ignore"):
        var = np.where(n > 1, (ss - s * s / np.maximum(n, 1)) / np.maximum(n, 1), np.nan)
    return np.sqrt(np.clip(var, 0, None))


class _quiet:
    def __enter__(self):
        import warnings
        self._w = warnings.catch_warnings()
        self._w.__enter__()
        warnings.simplefilter("ignore", RuntimeWarning)

    def __exit__(self, *a):
        self._w.__exit__(*a)


def features_for(L: np.ndarray, A: np.ndarray, state_L: np.ndarray, msp_log: np.ndarray,
                 weeks: np.ndarray, crop_codes: np.ndarray, h: int) -> dict[str, np.ndarray]:
    """Feature planes [series, week] for forecasts made at each week, h weeks ahead.

    L: log price, A: arrivals (tonnes), state_L: state-mean log price, msp_log: log
    MSP (rupees/kg) for the week's year, all [series, week] on one weekly grid (NaN =
    no report). weeks: datetime64[D] per column. crop_codes: per series.
    """
    S, W = L.shape
    f: dict[str, np.ndarray] = {}
    for k in LAGS:
        f[f"chg_{k}"] = L - _shift(L, k)
    f["chg_52"] = L - _shift(L, 52)
    # What the same weeks did last year: log P[t-52+h] - log P[t-52].
    last_year = _shift(L, 52)
    ahead = np.full_like(L, np.nan)
    if h < W:
        ahead[:, :W - h] = last_year[:, h:]
    f["seasonal_gap"] = ahead - last_year
    f["dev_mean4"] = L - _rolling_mean(L, 4)
    f["dev_mean13"] = L - _rolling_mean(L, 13)
    f["vol13"] = _rolling_std(L - _shift(L, 1), 13)
    # A fixed two-year window, so training and serving (which only has the store's
    # last two years) compute the same thing.
    f["mean_gap"] = _rolling_mean(L, MEAN_WEEKS) - L
    la = np.log1p(A)
    f["arrivals_anom"] = la - _rolling_mean(la, 52)
    target_week = weeks + np.timedelta64(7 * h, "D")
    doy = (target_week - target_week.astype("datetime64[Y]")).astype(int)
    ang = 2 * np.pi * doy / 365.25
    f["woy_sin"] = np.broadcast_to(np.sin(ang), (S, W)).astype(float)
    f["woy_cos"] = np.broadcast_to(np.cos(ang), (S, W)).astype(float)
    f["msp_gap"] = L - msp_log
    f["state_gap"] = L - state_L
    f["n_obs52"] = _window_sums(L, 52)[2]
    f["crop"] = np.broadcast_to(crop_codes[:, None].astype(float), (S, W))
    return f


def baselines_for(L: np.ndarray, f: dict[str, np.ndarray]) -> dict[str, np.ndarray]:
    """Each baseline's forecast change in log price, [series, week]."""
    return {"last": np.zeros_like(L),
            "seasonal": f["seasonal_gap"],
            "mean": f["mean_gap"]}


def stack(f: dict[str, np.ndarray], idx) -> np.ndarray:
    return np.column_stack([f[n][idx] for n in FEATURE_NAMES]).astype(np.float32)


# ------------------------------------------------------------------------ serving


class PriceModel:
    """Released artifact: per-horizon models, crop codes, and per crop x horizon cells
    {"method": "model"|baseline, "err_lo", "err_hi", "mape", "baseline_mape"}."""

    def __init__(self, artifact: dict[str, Any]):
        self.a = artifact
        self.version = artifact["version"]
        self.crops: list[str] = artifact["crops"]
        self.cells: dict[tuple[str, int], dict[str, Any]] = artifact["cells"]

    def forecast(self, series: dict[str, Any]) -> dict[str, Any] | None:
        """series: {"crop_id", "weeks" (datetime64[D]), "price" (rupees/kg, NaN gaps),
        "arrivals", "state_price", "msp"} on a weekly grid ending at the origin week."""
        crop = series["crop_id"]
        if crop not in self.crops:
            return None
        P = np.asarray(series["price"], dtype=float)
        if len(P) == 0 or np.isnan(P[-1]):
            return None
        L = np.log(P)[None, :]
        A = np.asarray(series["arrivals"], dtype=float)[None, :]
        SL = np.log(np.asarray(series["state_price"], dtype=float))[None, :]
        M = np.log(np.asarray(series["msp"], dtype=float))[None, :]
        weeks = np.asarray(series["weeks"], dtype="datetime64[D]")
        code = np.array([self.crops.index(crop)])
        t = L.shape[1] - 1
        out = []
        for h in HORIZONS:
            cell = self.cells.get((crop, h))
            if cell is None:
                continue
            f = features_for(L, A, SL, M, weeks, code, h)
            method = cell["method"]
            if method == "model":
                gap = float(self.a["models"][h].predict(stack(f, (np.array([0]), np.array([t]))))[0])
            else:
                gap = float(baselines_for(L, f)[method][0, t])
                if np.isnan(gap):
                    method, gap = "last", 0.0
                    cell = self.cells.get((crop, h, "last"), cell)
            p0 = float(P[-1])
            out.append({
                "horizon_weeks": h,
                "week": str(weeks[-1] + np.timedelta64(7 * h, "D")),
                "price_inr_kg": round(p0 * math.exp(gap), 2),
                "low_inr_kg": round(p0 * math.exp(gap + cell["err_lo"]), 2),
                "high_inr_kg": round(p0 * math.exp(gap + cell["err_hi"]), 2),
                "method": method,
                "label": ("model forecast" if method == "model" else
                          {"seasonal": "typical for this time of year (last year's pattern)",
                           "mean": "typical for this time of year (long-run average)",
                           "last": "no expected change (latest price)"}[method]),
                "backtest_mape": cell["mape"],
            })
        return {"crop_id": crop, "origin_week": str(weeks[-1]), "latest_price_inr_kg": round(float(P[-1]), 2),
                "horizons": out, "model_version": self.version,
                "range_basis": "80% of backtest errors for this crop and horizon"}


SERIES_WEEKS = MEAN_WEEKS + 1


def series_from_store(district_id: str, crop_id: str, weeks: int = SERIES_WEEKS) -> dict[str, Any] | None:
    """The last ``weeks`` weeks of a district-crop series on a weekly grid, from the
    serving store, with its state's mean price and MSP: what ``PriceModel.forecast``
    needs. None when the district has no price for the crop."""
    from utils import store

    rows = store.query("SELECT week, price_paise_kg, arrivals_t FROM price_district_weekly "
                       "WHERE district_id = ? AND crop_id = ? ORDER BY week", (district_id, crop_id))
    if not rows:
        return None
    last = np.datetime64(rows[-1]["week"], "D")
    grid = last - np.arange(weeks - 1, -1, -1) * np.timedelta64(7, "D")
    pos = {str(w): i for i, w in enumerate(grid)}
    price = np.full(weeks, np.nan)
    arr = np.full(weeks, np.nan)
    for r in rows:
        i = pos.get(r["week"])
        if i is not None:
            price[i] = r["price_inr_kg"]
            arr[i] = r["arrivals_t"] if r["arrivals_t"] is not None else np.nan
    state = district_id.split("-")[0]
    # The state's mean log price per week (geometric mean, as in training). Computed
    # here, not in SQL: SQLite's LN() exists only in some builds.
    srows = store.query(
        "SELECT week, price_paise_kg FROM price_district_weekly "
        "WHERE district_id LIKE ? AND crop_id = ? AND week >= ? AND price_paise_kg > 0",
        (f"{state}-%", crop_id, str(grid[0])))
    sums = np.zeros(weeks)
    counts = np.zeros(weeks)
    for r in srows:
        i = pos.get(r["week"])
        if i is not None:
            sums[i] += math.log(r["price_inr_kg"])
            counts[i] += 1
    state_price = np.where(counts > 0, np.exp(sums / np.maximum(counts, 1)), np.nan)
    msp_rows = store.query("SELECT year, AVG(msp_inr_per_kg) AS m FROM msp WHERE crop_id = ? GROUP BY year",
                           (crop_id,))
    by_year = {r["year"]: r["m"] for r in msp_rows}
    years = grid.astype("datetime64[Y]").astype(int) + 1970
    msp = np.array([by_year.get(y, by_year.get(y - 1, np.nan)) for y in years], dtype=float)
    return {"crop_id": crop_id, "district_id": district_id, "weeks": grid, "price": price,
            "arrivals": arr, "state_price": state_price, "msp": msp}


def sell_advice(fc: dict[str, Any], quantity_kg: float, storage_inr_kg_month: float,
                interest_pct_year: float) -> dict[str, Any]:
    """Hold only when the median expected gain beats storage and interest, with the
    downside (the low end of the range) shown beside it."""
    p0 = fc["latest_price_inr_kg"]
    options = [{"action": "sell_now", "weeks": 0, "price_inr_kg": p0, "net_inr": round(p0 * quantity_kg, 2),
                "low_net_inr": round(p0 * quantity_kg, 2), "high_net_inr": round(p0 * quantity_kg, 2)}]
    for h in fc["horizons"]:
        months = h["horizon_weeks"] * 7 / 30.4
        carry = storage_inr_kg_month * months + p0 * interest_pct_year / 100 * months / 12
        net = lambda price: round((price - carry) * quantity_kg, 2)  # noqa: E731
        options.append({"action": f"hold_{h['horizon_weeks']}_weeks", "weeks": h["horizon_weeks"],
                        "price_inr_kg": h["price_inr_kg"], "carry_cost_inr_kg": round(carry, 2),
                        "net_inr": net(h["price_inr_kg"]), "low_net_inr": net(h["low_inr_kg"]),
                        "high_net_inr": net(h["high_inr_kg"]), "method": h["method"], "label": h["label"]})
    best = max(options, key=lambda o: o["net_inr"])
    hold = best["action"] != "sell_now"
    return {
        "recommendation": best["action"] if hold else "sell_now",
        "reason": (f"Median expected net after storage and interest is higher by "
                   f"Rs {best['net_inr'] - options[0]['net_inr']:,.0f}; the low end of the range would be "
                   f"Rs {best['low_net_inr'] - options[0]['net_inr']:,.0f} against selling now."
                   if hold else "No horizon's median price beats today's after storage and interest."),
        "options": options, "origin_week": fc["origin_week"], "model_version": fc["model_version"],
    }


_artifact: LazyArtifact[PriceModel] = LazyArtifact("price model", PriceModel)


def load(path: Path = RELEASED) -> PriceModel | None:
    return _artifact.get(path)


def reset() -> None:
    _artifact.reset()
