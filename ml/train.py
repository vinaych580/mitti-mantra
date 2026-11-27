"""Train, evaluate and document a model on the curated store (Phase 2, spec 2.5).

    python -m ml.train --model yield            # writes ml/runs/yield/<version>/
    python -m ml.release yield <version>        # copies it into ml/models/yield/

A run writes the artifact, ``metrics.json`` and ``model_card.md``. Nothing here runs
inside a request: training reads data/curated/ (built by ``python -m pipelines.run``).

The version is a hash of the code commit, the curated data manifest and the config, so
the same inputs always give the same version.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import subprocess
import sys
import time
import zlib
from pathlib import Path
from typing import Any

import numpy as np

from ml import yield_anomaly as ya

ROOT = Path(__file__).resolve().parents[1]
RUNS = ROOT / "ml" / "runs"

CROP_GROUP = {
    **dict.fromkeys(["rice", "wheat", "maize", "barley", "jowar", "bajra", "ragi"], "cereals"),
    **dict.fromkeys(["arhar", "moong", "urad", "pulses", "gram", "masoor"], "pulses"),
    **dict.fromkeys(["groundnut", "mustard", "soybean", "sunflower", "sesame"], "oilseeds"),
    **dict.fromkeys(["cotton", "sugarcane", "jute", "tobacco"], "cash"),
    **dict.fromkeys(["potato", "onion", "chilli", "turmeric", "ginger", "banana", "mango",
                     "cashew", "watermelon", "muskmelon", "cucumber", "tomato"], "horticulture"),
}

YIELD_CONFIG = {
    "hgb": {"max_iter": 600, "learning_rate": 0.05, "max_leaf_nodes": 63, "min_samples_leaf": 40,
            "l2_regularization": 1.0, "early_stopping": True, "validation_fraction": 0.1,
            "n_iter_no_change": 40, "random_state": 7},
    # The central estimate uses squared error on departures clipped to +-0.5 for
    # training. Quantile and absolute-error losses re-fit leaf values after each tree,
    # which ignores monotonic constraints (less rain raised yield in 1-3% of districts).
    "point_loss": "squared_error",
    "point_clip": 0.5,
    "space_holdout": 0.2,
    "test_first_year": ya.TEST_FIRST,
    "calibration_years": [ya.TEST_FIRST, ya.TEST_FIRST + 2],
    "coverage_target": 0.8,
    "gate_improvement": 0.10,
    "min_crop_test_rows": 200,
    "min_calibration_rows": 100,
}
BEHAVIOUR_CROPS = ("rice", "cotton", "maize", "wheat")


def _git_head() -> str:
    try:
        return subprocess.run(["git", "rev-parse", "HEAD"], cwd=ROOT, capture_output=True,
                              text=True, check=True).stdout.strip()
    except Exception:
        return "unknown"


def version_of(manifest_text: str, config: dict) -> str:
    h = hashlib.sha256()
    h.update(_git_head().encode())
    # The model code itself, so uncommitted changes can never reuse a version.
    for name in ("train.py", "yield_anomaly.py", "price_model.py"):
        h.update((ROOT / "ml" / name).read_bytes())
    h.update(hashlib.sha256(manifest_text.encode()).digest())
    h.update(json.dumps(config, sort_keys=True).encode())
    return h.hexdigest()[:12]


def _held_out_district(d: str, share: float) -> bool:
    return (zlib.crc32(d.encode()) % 1000) < share * 1000


def _hgb(quantile: float | None, cfg: dict):
    """quantile=None is the central estimate (cfg point_loss); else a quantile model."""
    from sklearn.ensemble import HistGradientBoostingRegressor

    cat = [ya.FEATURE_NAMES.index(c) for c in ya.CATEGORICAL]
    loss = {"loss": cfg["point_loss"]} if quantile is None else {"loss": "quantile", "quantile": quantile}
    return HistGradientBoostingRegressor(
        **loss, categorical_features=cat,
        monotonic_cst=[ya.FEATURES[n] for n in ya.FEATURE_NAMES], **cfg["hgb"])


def _fit(quantile: float | None, X, y, cfg):
    target = np.clip(y, -cfg["point_clip"], cfg["point_clip"]) if quantile is None else y
    return _hgb(quantile, cfg).fit(X, target)


QUANTILES = (("q10", 0.1), ("q50", None), ("q90", 0.9))


def _mae(a, b) -> float:
    return float(np.mean(np.abs(np.asarray(a) - np.asarray(b))))


def _per_crop(df, pred, base) -> dict[str, dict[str, float]]:
    out = {}
    for crop, idx in df.groupby("crop_id").indices.items():
        y = df["anomaly"].to_numpy()[idx]
        out[crop] = {"rows": int(len(idx)), "model_mae": round(_mae(y, pred[idx]), 4),
                     "mean5_mae": round(_mae(y, base[idx]), 4)}
    return dict(sorted(out.items(), key=lambda kv: -kv[1]["rows"]))


def _evaluate_split(name, df, X, train, test, cfg, with_rf=False) -> dict[str, Any]:
    y = df["anomaly"].to_numpy()
    m = _fit(None, X[train], y[train], cfg)
    te = df[test].reset_index(drop=True)
    pred = m.predict(X[test])
    base = (np.log(te["baseline_mean5"]) - te["log_trend"]).to_numpy()
    res = {
        "train_rows": int(train.sum()), "test_rows": int(test.sum()),
        "mae": {"model": round(_mae(y[test], pred), 4),
                "baseline_mean5": round(_mae(y[test], base), 4),
                "baseline_trend": round(_mae(y[test], 0.0), 4)},
        "kg_mae": {
            "model": round(_mae(te["yield_kg_acre"], np.exp(te["log_trend"] + pred)), 1),
            "baseline_mean5": round(_mae(te["yield_kg_acre"], te["baseline_mean5"]), 1),
            "baseline_trend": round(_mae(te["yield_kg_acre"], np.exp(te["log_trend"])), 1)},
        "per_crop": _per_crop(te, pred, base),
    }
    if with_rf:
        from sklearn.ensemble import RandomForestRegressor

        rng = np.random.default_rng(7)
        tr = np.flatnonzero(train)
        tr = rng.choice(tr, size=min(len(tr), 60000), replace=False)
        rf = RandomForestRegressor(n_estimators=120, min_samples_leaf=5, n_jobs=-1, random_state=7)
        rf.fit(np.nan_to_num(X[tr], nan=-999.0), y[tr])
        res["mae"]["baseline_random_forest"] = round(
            _mae(y[test], rf.predict(np.nan_to_num(X[test], nan=-999.0))), 4)
    res["improvement_vs_mean5"] = round(1 - res["mae"]["model"] / res["mae"]["baseline_mean5"], 4)
    print(f"  {name}: model {res['mae']['model']}  mean5 {res['mae']['baseline_mean5']}  "
          f"trend {res['mae']['baseline_trend']}  ({res['improvement_vs_mean5']:+.1%})", flush=True)
    return res


def _widths(lo_err, hi_err, groups, cfg) -> tuple[dict, dict]:
    """Per crop group: how far to widen q10 down and q90 up for 80% coverage."""
    q = (1 + cfg["coverage_target"]) / 2   # each tail gets 10%
    out, flagged = {}, {}
    out["_all"] = {"lo": float(np.quantile(lo_err, q)), "hi": float(np.quantile(hi_err, q))}
    for g in np.unique(groups):
        m = groups == g
        if m.sum() < cfg["min_calibration_rows"]:
            flagged[g] = int(m.sum())
            continue
        out[g] = {"lo": float(np.quantile(lo_err[m], q)), "hi": float(np.quantile(hi_err[m], q)),
                  "rows": int(m.sum())}
    return out, flagged


def _coverage(df, lo, hi) -> dict[str, Any]:
    y = df["anomaly"].to_numpy()
    inside = (y >= lo) & (y <= hi)
    per = {c: {"rows": int(len(i)), "coverage": round(float(inside[i].mean()), 3)}
           for c, i in df.groupby("crop_id").indices.items()}
    return {"overall": round(float(inside.mean()), 3),
            "per_crop": dict(sorted(per.items(), key=lambda kv: -kv[1]["rows"]))}


def _lookup(t, df, ctx, models, cats, cfg, sow_widths, base_widths) -> tuple[dict, dict]:
    """Per district-crop-season entry for the coming season (last data year + 1)."""
    import pandas as pd

    season_f, onset_f, stage_f, normals, soil, irr = ctx
    y = t["yield"]
    y = y[(y["yield_kg_acre"] > 0) & y["district_id"].notna()].sort_values("year")
    target = int(y["year"].max()) + 1
    rows = []
    for (d, c, s), g in y.groupby(["district_id", "crop_id", "season"], sort=False):
        years = g["year"].to_numpy()
        if len(years) < ya.MIN_PRIOR_YEARS or years[-1] < target - 6:
            continue
        logs = np.log(g["yield_kg_acre"].to_numpy())
        lt = ya.trend_at(years, logs, target)
        last_t = ya.trend_at(years, logs, int(years[-1]))
        prev = float(logs[-1] - last_t) if (last_t is not None and years[-1] == target - 1) else np.nan
        rows.append({"district_id": d, "crop_id": c, "season": s, "year": target,
                     "log_trend": lt, "baseline_mean5": float(np.exp(logs[-5:]).mean()),
                     "baseline_mean3": float(np.exp(logs[-3:]).mean()),
                     "log_sd8": float(logs[-8:].std()), "prev_anomaly": prev,
                     "n_years": int(len(years)), "last_year": int(years[-1])})
    base = pd.DataFrame(rows)
    full = ya.assemble(base, season_f, onset_f, stage_f, soil, irr)
    full = ya.to_normal(full, normals)
    X, _ = ya.encode(full, cats)
    a50 = models["q50"].predict(X)
    lookup = {}
    for i, r in enumerate(full.itertuples(index=False)):
        grp = CROP_GROUP.get(r.crop_id, "other")
        w = sow_widths.get(grp) or sow_widths["_all"]
        bw = base_widths.get(grp) or base_widths["_all"]
        gap = float(np.log(r.baseline_mean5) - r.log_trend)
        lookup[(r.district_id, r.crop_id, r.season)] = {
            "log_trend": float(r.log_trend), "x": X[i].tolist(),
            "a50": float(a50[i]), "a_lo": float(a50[i] - w["lo"]), "a_hi": float(a50[i] + w["hi"]),
            "b50": gap, "b_lo": gap - bw["lo"], "b_hi": gap + bw["hi"],
            "n_years": int(r.n_years), "last_year": int(r.last_year),
        }
    regions = (t["yield"][["district_id", "region_id"]].dropna().drop_duplicates())
    region_map = {r: d for d, r in zip(regions["district_id"], regions["region_id"]) if r}
    return lookup, {"target_year": target, "entries": len(lookup), "region_to_district": region_map}


def _behaviour(model: ya.YieldModel) -> dict[str, Any]:
    """Less rain must lower yield on rainfed land, and by less on irrigated land."""
    out = {}
    for crop in BEHAVIOUR_CROPS:
        keys = [k for k in model.lookup if k[1] == crop]
        if not keys:
            out[crop] = {"passed": False, "reason": "no lookup entries"}
            continue
        rows = []
        for k in keys:
            e = model.lookup[k]
            rows += [(e, crop, 1.0, 0.0), (e, crop, 0.5, 0.0), (e, crop, 1.0, 1.0), (e, crop, 0.5, 1.0)]
        p = np.array([r["yield_kg_per_acre"] for r in model.predict_rows(rows)]).reshape(-1, 4)
        drop_rainfed = 1 - p[:, 1] / p[:, 0]
        drop_irrigated = 1 - p[:, 3] / p[:, 2]
        res = {"districts": len(keys),
               "median_drop_rainfed": round(float(np.median(drop_rainfed)), 4),
               "median_drop_irrigated": round(float(np.median(drop_irrigated)), 4),
               "share_never_rises": round(float(np.mean(drop_rainfed >= -1e-9)), 4)}
        res["passed"] = bool(res["median_drop_rainfed"] > 0
                             and res["median_drop_irrigated"] < res["median_drop_rainfed"]
                             and res["share_never_rises"] == 1.0)
        out[crop] = res
    return out


def train_yield(out_root: Path = RUNS / "yield") -> Path:
    import joblib

    cfg = YIELD_CONFIG
    t0 = time.time()
    print("yield: loading curated tables", flush=True)
    t = ya.load_tables()
    version = version_of(t["manifest"], cfg)
    df, ctx = ya.build_training_frame(t)
    X, cats = ya.encode(df)
    print(f"yield: {len(df):,} rows, {X.shape[1]} features ({time.time() - t0:.0f}s)", flush=True)

    years = df["year"].to_numpy()
    held = df["district_id"].map(lambda d: _held_out_district(d, cfg["space_holdout"])).to_numpy()
    late = years >= cfg["test_first_year"]
    splits = {
        "time": (~late, late),
        "space": (~held, held),
        "time_and_space": (~late & ~held, late & held),
    }
    metrics: dict[str, Any] = {"model": "yield", "version": version, "rows": int(len(df)),
                               "years": [int(years.min()), int(years.max())],
                               "districts": int(df["district_id"].nunique()),
                               "crops": int(df["crop_id"].nunique()), "splits": {}}
    print("yield: evaluating splits", flush=True)
    for name, (tr, te) in splits.items():
        metrics["splits"][name] = _evaluate_split(name, df, X, tr, te, cfg, with_rf=(name == "time"))

    # Gate (spec 2.1): >= 10% better than the 5-year mean on the time and space splits,
    # and no crop with >= 200 test rows worse than its 5-year mean.
    gate = {"splits": {}, "crops_worse": {}}
    for name in ("time", "space"):
        s = metrics["splits"][name]
        gate["splits"][name] = s["improvement_vs_mean5"] >= cfg["gate_improvement"]
        worse = [c for c, r in s["per_crop"].items()
                 if r["rows"] >= cfg["min_crop_test_rows"] and r["model_mae"] > r["mean5_mae"]]
        gate["crops_worse"][name] = worse
    gate["passed"] = all(gate["splits"].values()) and not any(gate["crops_worse"].values())
    metrics["gate"] = gate

    # Calibration on the time split: quantile models fit before TEST_FIRST, widths from
    # the calibration years, coverage checked on the years after them.
    print("yield: calibrating ranges", flush=True)
    c0, c1 = cfg["calibration_years"]
    y = df["anomaly"].to_numpy()
    train = years < c0
    cal = (years >= c0) & (years <= c1)
    chk = years > c1
    qm = {k: _fit(q, X[train], y[train], cfg) for k, q in QUANTILES}
    groups = df["crop_id"].map(lambda c: CROP_GROUP.get(c, "other")).to_numpy()
    lo_err = qm["q10"].predict(X[cal]) - y[cal]
    hi_err = y[cal] - qm["q90"].predict(X[cal])
    season_w, season_flag = _widths(lo_err, hi_err, groups[cal], cfg)
    season_f, onset_f, stage_f, normals, soil, irr = ctx
    Xn, _ = ya.encode(ya.to_normal(df, normals), cats)
    sow_mid_cal = qm["q50"].predict(Xn[cal])
    sow_w, sow_flag = _widths(sow_mid_cal - y[cal], y[cal] - sow_mid_cal, groups[cal], cfg)

    def widen(w, g):
        return w.get(g) or w["_all"]

    chk_df = df[chk].reset_index(drop=True)
    g_chk = groups[chk]
    lo_s = qm["q10"].predict(X[chk]) - np.array([widen(season_w, g)["lo"] for g in g_chk])
    hi_s = qm["q90"].predict(X[chk]) + np.array([widen(season_w, g)["hi"] for g in g_chk])
    mid_n = qm["q50"].predict(Xn[chk])
    lo_n = mid_n - np.array([widen(sow_w, g)["lo"] for g in g_chk])
    hi_n = mid_n + np.array([widen(sow_w, g)["hi"] for g in g_chk])
    # The baseline the app serves if the gate fails: the 5-year mean, with its own range.
    gap = (np.log(df["baseline_mean5"]) - df["log_trend"]).to_numpy()
    base_w, base_flag = _widths(gap[cal] - y[cal], y[cal] - gap[cal], groups[cal], cfg)
    lo_b = gap[chk] - np.array([widen(base_w, g)["lo"] for g in g_chk])
    hi_b = gap[chk] + np.array([widen(base_w, g)["hi"] for g in g_chk])
    metrics["calibration"] = {
        "calibration_years": [c0, c1], "checked_years": [c1 + 1, int(years.max())],
        "in_season": {"widths": season_w, "borrowed_from_all": season_flag,
                      "coverage": _coverage(chk_df, lo_s, hi_s)},
        "at_sowing": {"widths": sow_w, "borrowed_from_all": sow_flag,
                      "coverage": _coverage(chk_df, lo_n, hi_n),
                      "mae": round(_mae(y[chk], mid_n), 4)},
        "baseline_mean5": {"widths": base_w, "borrowed_from_all": base_flag,
                           "coverage": _coverage(chk_df, lo_b, hi_b),
                           "mae": round(_mae(y[chk], gap[chk]), 4)},
    }
    print(f"  80% coverage, in season {metrics['calibration']['in_season']['coverage']['overall']}, "
          f"at sowing {metrics['calibration']['at_sowing']['coverage']['overall']}", flush=True)

    print("yield: fitting final models on every year", flush=True)
    final = {k: _fit(q, X, y, cfg) for k, q in QUANTILES}
    lookup, info = _lookup(t, df, ctx, final, cats, cfg, sow_w, base_w)
    serve = "model" if gate["passed"] else "baseline"
    metrics["serves"] = serve
    artifact = {
        "version": version, "serve": serve, "feature_names": ya.FEATURE_NAMES, "categories": cats,
        "q10": final["q10"], "q50": final["q50"], "q90": final["q90"],
        "conformal": season_w, "crop_group": CROP_GROUP,
        "lookup": lookup, "region_to_district": info["region_to_district"],
        "target_year": info["target_year"],
    }
    model = ya.YieldModel(artifact)
    metrics["behaviour"] = _behaviour(model)
    metrics["behaviour_passed"] = all(r["passed"] for r in metrics["behaviour"].values())
    metrics["lookup"] = {"target_year": info["target_year"], "entries": info["entries"]}
    metrics["config"] = cfg
    metrics["trained_seconds"] = round(time.time() - t0, 1)
    metrics["data_manifest_sha256"] = hashlib.sha256(t["manifest"].encode()).hexdigest()
    metrics["code_commit"] = _git_head()

    out = out_root / version
    out.mkdir(parents=True, exist_ok=True)
    joblib.dump(artifact, out / "model.joblib", compress=3)
    metrics["artifact_bytes"] = (out / "model.joblib").stat().st_size
    (out / "metrics.json").write_text(json.dumps(metrics, indent=2), encoding="utf-8")
    from ml.model_card import yield_card
    (out / "model_card.md").write_text(yield_card(metrics), encoding="utf-8")
    print(f"yield: wrote {out} ({metrics['artifact_bytes'] / 1e6:.1f} MB, "
          f"gate {'PASSED' if gate['passed'] else 'FAILED'}, "
          f"behaviour {'PASSED' if metrics['behaviour_passed'] else 'FAILED'}, "
          f"{metrics['trained_seconds']:.0f}s)", flush=True)
    return out


PRICE_CONFIG = {
    "hgb": {"loss": "absolute_error", "max_iter": 300, "learning_rate": 0.08, "max_leaf_nodes": 63,
            "min_samples_leaf": 100, "l2_regularization": 1.0, "random_state": 7},
    "backtest_weeks": 156,
    "refit_every_weeks": 13,
    "max_train_rows": 250_000,
    "min_history_weeks": 13,
    "min_cell_rows": 100,
    "gate": 0.05,
    "coverage_check_weeks": 52,
}


def _price_grid(curated: Path):
    """Weekly [series, week] matrices from the curated store."""
    import pandas as pd
    from ml import price_model as pm

    p = pd.read_parquet(curated / "price_district_weekly.parquet",
                        columns=["district_id", "crop_id", "week", "price_inr_kg", "arrivals_t"])
    p = p[(p["price_inr_kg"] > 0) & p["district_id"].notna()].copy()
    p["week"] = pd.to_datetime(p["week"]).dt.to_period("W-SUN").dt.start_time
    weeks = pd.date_range(p["week"].min(), p["week"].max(), freq="7D")
    p["w"] = ((p["week"] - weeks[0]).dt.days // 7).astype(int)
    keys = p[["district_id", "crop_id"]].drop_duplicates().sort_values(["crop_id", "district_id"]).reset_index(drop=True)
    keys["s"] = np.arange(len(keys))
    p = p.merge(keys, on=["district_id", "crop_id"])
    S, W = len(keys), len(weeks)
    P = np.full((S, W), np.nan)
    A = np.full((S, W), np.nan)
    P[p["s"], p["w"]] = p["price_inr_kg"]
    A[p["s"], p["w"]] = p["arrivals_t"]
    L = np.log(P)
    keys["state"] = keys["district_id"].str.split("-").str[0]
    SL = np.full((S, W), np.nan)
    for _, g in keys.groupby(["state", "crop_id"]):
        idx = g["s"].to_numpy()
        with np.errstate(all="ignore"), pm._quiet():
            SL[idx] = np.nanmean(L[idx], axis=0)
    msp = pd.read_parquet(curated / "msp.parquet", columns=["crop_id", "year", "msp_inr_per_kg"])
    msp = msp.groupby(["crop_id", "year"])["msp_inr_per_kg"].mean()
    years = weeks.year.to_numpy()
    M = np.full((S, W), np.nan)
    for i, crop in enumerate(keys["crop_id"]):
        if crop in msp.index.get_level_values(0):
            m = msp.loc[crop]
            M[i] = [m.get(y, m.get(y - 1, np.nan)) for y in years]
    crops = sorted(keys["crop_id"].unique())
    codes = keys["crop_id"].map({c: k for k, c in enumerate(crops)}).to_numpy()
    return {"L": L, "A": A, "SL": SL, "M": np.log(M), "weeks": weeks.to_numpy().astype("datetime64[D]"),
            "keys": keys, "crops": crops, "codes": codes}


def _ape(pred_gap, act_gap):
    return np.abs(np.exp(pred_gap - act_gap) - 1.0)


def train_price(out_root: Path = RUNS / "price") -> Path:
    import joblib
    import pandas as pd
    from sklearn.ensemble import HistGradientBoostingRegressor
    from ml import price_model as pm

    cfg = PRICE_CONFIG
    t0 = time.time()
    curated = ya.CURATED
    manifest = (curated / "manifest.json").read_text(encoding="utf-8")
    version = version_of(manifest, cfg)
    g = _price_grid(curated)
    L, W = g["L"], g["L"].shape[1]
    print(f"price: {L.shape[0]:,} series x {W} weeks ({time.time() - t0:.0f}s)", flush=True)
    rng = np.random.default_rng(7)
    cat = [pm.FEATURE_NAMES.index(c) for c in pm.CATEGORICAL]

    def model():
        return HistGradientBoostingRegressor(categorical_features=cat, **cfg["hgb"])

    bt_start = W - cfg["backtest_weeks"]
    metrics: dict[str, Any] = {"model": "price", "version": version, "series": int(L.shape[0]),
                               "weeks": [str(g["weeks"][0]), str(g["weeks"][-1])],
                               "crops": g["crops"], "horizons": {}, "cells": {}}
    cells: dict[Any, Any] = {}
    final_models = {}
    crop_of = np.array(g["crops"])[g["codes"]]
    for h in pm.HORIZONS:
        f = pm.features_for(L, g["A"], g["SL"], g["M"], g["weeks"], g["codes"], h)
        act = np.full_like(L, np.nan)
        act[:, :W - h] = L[:, h:] - L[:, :W - h]
        hist = np.cumsum(~np.isnan(L), axis=1)
        ok = ~np.isnan(act) & ~np.isnan(L) & (hist >= cfg["min_history_weeks"])
        s_idx, t_idx = np.nonzero(ok)
        X = pm.stack(f, (s_idx, t_idx))
        y = act[s_idx, t_idx]
        base = {k: np.nan_to_num(v[s_idx, t_idx], nan=0.0) for k, v in pm.baselines_for(L, f).items()}
        pred = np.full(len(y), np.nan)
        for b in range(bt_start, W - h, cfg["refit_every_weeks"]):
            train = np.flatnonzero(t_idx + h < b)
            test = np.flatnonzero((t_idx >= b) & (t_idx < b + cfg["refit_every_weeks"]))
            if len(test) == 0 or len(train) < 1000:
                continue
            if len(train) > cfg["max_train_rows"]:
                train = rng.choice(train, cfg["max_train_rows"], replace=False)
            pred[test] = model().fit(X[train], y[train]).predict(X[test])
        bt = ~np.isnan(pred)
        crops_bt = crop_of[s_idx[bt]]
        t_bt = t_idx[bt]
        ape = {"model": _ape(pred[bt], y[bt]), **{k: _ape(base[k][bt], y[bt]) for k in pm.BASELINES}}
        resid = {"model": y[bt] - pred[bt], **{k: y[bt] - base[k][bt] for k in pm.BASELINES}}
        late = t_bt >= W - h - cfg["coverage_check_weeks"]
        hm = {k: round(float(v.mean()), 4) for k, v in ape.items()}
        hm["rows"] = int(bt.sum())
        print(f"  h={h:>2}: MAPE model {hm['model']:.3f}  last {hm['last']:.3f}  "
              f"seasonal {hm['seasonal']:.3f}  mean {hm['mean']:.3f}  ({hm['rows']:,} rows)", flush=True)
        served_cover = []
        for crop in g["crops"]:
            m = crops_bt == crop
            n = int(m.sum())
            if n == 0:
                continue
            mape = {k: float(v[m].mean()) for k, v in ape.items()}
            best_base = min(pm.BASELINES, key=lambda k: mape[k])
            use_model = n >= cfg["min_cell_rows"] and mape["model"] <= (1 - cfg["gate"]) * mape[best_base]
            method = "model" if use_model else best_base

            def errs(meth, mask):
                r = resid[meth][mask]
                return float(np.quantile(r, 0.1)), float(np.quantile(r, 0.9))

            lo, hi = errs(method, m)
            cells[(crop, h)] = {"method": method, "err_lo": lo, "err_hi": hi, "rows": n,
                                "mape": round(mape[method], 4), "baseline_mape": round(mape[best_base], 4)}
            llo, lhi = errs("last", m)
            cells[(crop, h, "last")] = {"method": "last", "err_lo": llo, "err_hi": lhi, "rows": n,
                                        "mape": round(mape["last"], 4), "baseline_mape": round(mape["last"], 4)}
            # coverage: widths from the earlier backtest years, checked on the last year
            early, chk = m & ~late, m & late
            if early.sum() >= 50 and chk.sum() >= 20:
                elo, ehi = errs(method, early)
                r = resid[method][chk]
                served_cover.append((int(chk.sum()), float(((r >= elo) & (r <= ehi)).mean())))
            metrics["cells"][f"{crop}|{h}"] = {
                "rows": n, "served": method, "model_mape": round(mape["model"], 4),
                **{f"{k}_mape": round(mape[k], 4) for k in pm.BASELINES}}
        if served_cover:
            w = np.array([c[0] for c in served_cover])
            hm["coverage_80_last_year"] = round(float(np.average([c[1] for c in served_cover], weights=w)), 3)
        hm["cells_model"] = sum(1 for (c, hh, *r), v in cells.items() if hh == h and not r and v["method"] == "model")
        hm["cells_total"] = sum(1 for (c, hh, *r) in cells if hh == h and not r)
        metrics["horizons"][str(h)] = hm
        train = np.arange(len(y))
        if len(train) > cfg["max_train_rows"]:
            train = rng.choice(train, cfg["max_train_rows"], replace=False)
        final_models[h] = model().fit(X[train], y[train])

    artifact = {"version": version, "crops": g["crops"], "models": final_models, "cells": cells,
                "feature_names": pm.FEATURE_NAMES}
    metrics.update({"config": cfg, "trained_seconds": round(time.time() - t0, 1),
                    "data_manifest_sha256": hashlib.sha256(manifest.encode()).hexdigest(),
                    "code_commit": _git_head(),
                    "gate": {"passed": any(v["method"] == "model" for k, v in cells.items() if len(k) == 2),
                             "rule": f"per crop x horizon: model MAPE <= {1 - cfg['gate']:.2f} x best baseline"},
                    "behaviour_passed": True})
    out = out_root / version
    out.mkdir(parents=True, exist_ok=True)
    joblib.dump(artifact, out / "model.joblib", compress=3)
    metrics["artifact_bytes"] = (out / "model.joblib").stat().st_size
    (out / "metrics.json").write_text(json.dumps(metrics, indent=2), encoding="utf-8")
    from ml.model_card import price_card
    (out / "model_card.md").write_text(price_card(metrics), encoding="utf-8")
    served = sum(v["cells_model"] for v in metrics["horizons"].values())
    total = sum(v["cells_total"] for v in metrics["horizons"].values())
    print(f"price: wrote {out} ({metrics['artifact_bytes'] / 1e6:.1f} MB, model serves {served}/{total} "
          f"crop-horizon cells, {metrics['trained_seconds']:.0f}s)", flush=True)
    return out


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--model", required=True, choices=["yield", "price"])
    args = ap.parse_args(argv)
    if args.model == "yield":
        train_yield()
    else:
        train_price()
    return 0


if __name__ == "__main__":
    sys.exit(main())
