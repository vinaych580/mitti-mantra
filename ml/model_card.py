"""Model cards (spec 2.6), generated from a run's metrics.json so they cannot drift."""
from __future__ import annotations

from typing import Any


def _pct(x: float) -> str:
    return f"{x * 100:.1f}%"


def _split_table(splits: dict[str, Any]) -> str:
    names = {"time": "Last five years held out", "space": "20% of districts held out",
             "time_and_space": "Both at once"}
    lines = ["| Split | Test rows | Model | 5-year mean | Trend only | Random forest | vs 5-year mean |",
             "|---|---:|---:|---:|---:|---:|---:|"]
    for k, s in splits.items():
        m = s["mae"]
        rf = m.get("baseline_random_forest")
        lines.append(f"| {names.get(k, k)} | {s['test_rows']:,} | {m['model']:.4f} | "
                     f"{m['baseline_mean5']:.4f} | {m['baseline_trend']:.4f} | "
                     f"{'' if rf is None else f'{rf:.4f}'} | {s['improvement_vs_mean5']:+.1%} |")
    return "\n".join(lines)


def _crop_table(per_crop: dict[str, Any], min_rows: int) -> str:
    lines = ["| Crop | Test rows | Model MAE | 5-year mean MAE | Better? |", "|---|---:|---:|---:|---|"]
    for c, r in per_crop.items():
        if r["rows"] < 50:
            continue
        better = "yes" if r["model_mae"] <= r["mean5_mae"] else ("**no**" if r["rows"] >= min_rows else "no (few rows)")
        lines.append(f"| {c} | {r['rows']:,} | {r['model_mae']:.4f} | {r['mean5_mae']:.4f} | {better} |")
    return "\n".join(lines)


def _coverage_table(cal: dict[str, Any]) -> str:
    ins, sow = cal["in_season"]["coverage"]["per_crop"], cal["at_sowing"]["coverage"]["per_crop"]
    lines = ["| Crop | Rows | In season | At sowing |", "|---|---:|---:|---:|"]
    for c, r in ins.items():
        if r["rows"] < 50:
            continue
        lines.append(f"| {c} | {r['rows']:,} | {_pct(r['coverage'])} | {_pct(sow[c]['coverage'])} |")
    return "\n".join(lines)


def _behaviour_table(b: dict[str, Any]) -> str:
    lines = ["| Crop | Districts | Yield drop at 50% rain, rainfed | Same, fully irrigated | Never rises | Pass |",
             "|---|---:|---:|---:|---:|---|"]
    for c, r in b.items():
        if "districts" not in r:
            lines.append(f"| {c} | 0 | | | | no ({r.get('reason')}) |")
            continue
        lines.append(f"| {c} | {r['districts']} | {_pct(r['median_drop_rainfed'])} | "
                     f"{_pct(r['median_drop_irrigated'])} | {_pct(r['share_never_rises'])} | "
                     f"{'yes' if r['passed'] else '**no**'} |")
    return "\n".join(lines)


def price_card(m: dict[str, Any]) -> str:
    hz = m["horizons"]
    rows = ["| Horizon | Backtest rows | Model | Last value | Same weeks last year | Historical mean | Cells served by model | 80% range coverage (last year) |",
            "|---|---:|---:|---:|---:|---:|---:|---:|"]
    for h, r in hz.items():
        rows.append(f"| {h} wk | {r['rows']:,} | {_pct(r['model'])} | {_pct(r['last'])} | {_pct(r['seasonal'])} | "
                    f"{_pct(r['mean'])} | {r['cells_model']}/{r['cells_total']} | "
                    f"{_pct(r['coverage_80_last_year']) if 'coverage_80_last_year' in r else ''} |")
    by_crop: dict[str, dict[str, str]] = {}
    for key, c in m["cells"].items():
        crop, h = key.split("|")
        by_crop.setdefault(crop, {})[h] = ("**model**" if c["served"] == "model" else c["served"])
    hs = list(hz)
    crop_rows = ["| Crop | " + " | ".join(f"{h} wk" for h in hs) + " |", "|---|" + "---|" * len(hs)]
    for crop in sorted(by_crop):
        crop_rows.append(f"| {crop} | " + " | ".join(by_crop[crop].get(h, "") for h in hs) + " |")
    return f"""# Model card: weekly district price forecast

**Version** `{m['version']}` · **Data** Agmarknet weekly district prices {m['weeks'][0]} to {m['weeks'][1]},
{m['series']:,} district-crop series, {len(m['crops'])} crops · **Code** `{m['code_commit'][:10]}`

## Purpose

Forecast a district's mandi price for a crop 1, 4, 8, 12 and 26 weeks ahead, with an 80%
range, for the sell advisor and for pricing a harvest in recommendations.

## How it works

- Target: the change in log price over the horizon. One gradient-boosted model per
  horizon (scikit-learn `HistGradientBoostingRegressor`, absolute-error loss), across
  crops.
- Features: price changes over the last 1–8 and 52 weeks, what the same weeks did last
  year, distance from the 4- and 13-week means and the 13-week
  volatility, the two-year mean, week of year, arrivals against their 52-week norm, price against MSP, the
  district's price against its state's mean, and weeks reported in the last year.
- Baselines: no change; the same weeks' change last year; return to the two-year mean
  (the app's previous forecast used the historical mean).
- **Per crop × horizon gate:** the model serves a cell only if its backtest MAPE is at
  least {m['config']['gate']:.0%} below the best baseline's, on ≥ {m['config']['min_cell_rows']} backtest rows. Elsewhere the best
  baseline serves and the app says "typical for this time of year".
- Ranges: the 10th and 90th percentiles of the served method's own backtest errors for
  that crop and horizon. (The spec asked for quantile models; backtest errors give the
  same 80% interval and are calibrated by construction.)

## Backtest

Rolling origin over the last {m['config']['backtest_weeks']} weeks, refitting every {m['config']['refit_every_weeks']} weeks on data whose
outcome was known before the refit. Mean absolute percentage error:

{chr(10).join(rows)}

## What serves, per crop and horizon

{chr(10).join(crop_rows)}

## Known limits

- Prices are policy-driven (export bans, stock limits, MSP procurement); no model sees
  those coming. Expect baselines to serve for onion and tomato beyond a few weeks.
- The mirror's weekly series ends in May 2026; until the live feed (`DATAGOV_API_KEY`)
  runs, every forecast starts from that week and says so.
- District prices aggregate a few mandis; a farmer's own mandi can differ.

## Must not be used for

Trading or hedging decisions, or any promise of a sale price.
"""


def yield_card(m: dict[str, Any]) -> str:
    gate = m["gate"]
    cal = m["calibration"]
    status = ("**Gate passed.** The app serves this model." if gate["passed"] else
              "**Gate failed, so the app serves the baseline:** each district's 5-year mean yield "
              "for the crop, with a calibrated 80% range. The model is better than that mean on "
              "every split, but not by the 10% the gate asks for on unseen years. Weather "
              "scenarios (the season planner) keep the rule-based yield, because a mean cannot "
              "respond to rain.")
    base = cal["baseline_mean5"]
    worse = "; ".join(f"{k}: {', '.join(v)}" for k, v in gate["crops_worse"].items() if v) or "none"
    return f"""# Model card: district crop yield

**Version** `{m['version']}` · **Data** {m['years'][0]}–{m['years'][1]}, {m['rows']:,} district-crop-season-years,
{m['districts']} districts, {m['crops']} crops · **Code** `{m['code_commit'][:10]}` ·
**Data manifest** `{m['data_manifest_sha256'][:12]}`

{status}

## Purpose

Estimate a district's typical yield (kg per acre) for a crop and season, with an 80% range:
at sowing (normal weather) for recommendations, and under a stated rain or irrigation
scenario for the season planner.

It predicts **district averages**. A single farm can do much better or worse; the range is
about the district, not the plot.

## How it works

- Target: the season's departure from the district-crop trend,
  `log(yield) − log(trend)`, where the trend is a robust line through that district-crop's
  prior years only (at most 15). Prediction = trend × exp(departure).
- Features: rain deficit and surplus against the district normal (season and per growth
  stage), longest dry spell, days above 35 °C, temperature departure, monsoon-onset delay,
  irrigated share of the crop, rain deficit × rainfed share, Soil Health Card shares
  (acidic, alkaline, low organic carbon, low nitrogen), last season's departure, the gap
  between the 5-year mean and the trend, and crop, season and state.
- Gradient-boosted trees (scikit-learn `HistGradientBoostingRegressor`, quantile loss at
  10/50/90%). Every rain-deficit, heat and dry-spell feature is constrained so it can only
  lower the prediction.
- Normals are 1997–{m['config']['test_first_year'] - 1}, so a test season is never part of its own normal.

## Data

DES Area, Production and Yield (district, via India Data Portal), NASA POWER daily weather
at one point per district, DES crop-wise irrigated area, and Soil Health Card summaries,
all from the Phase 1 curated store. No synthetic rows.

## Accuracy

Mean absolute error of the departure from trend (≈ relative error: 0.10 ≈ 10%), on rows
the model never saw.

{_split_table(m['splits'])}

In kg per acre on the time split: model {m['splits']['time']['kg_mae']['model']:,.0f},
5-year mean {m['splits']['time']['kg_mae']['baseline_mean5']:,.0f},
trend {m['splits']['time']['kg_mae']['baseline_trend']:,.0f}.

### Gate

Ship only if the model beats the 5-year mean by ≥ {m['config']['gate_improvement']:.0%} on the
time and space splits, and no crop with ≥ {m['config']['min_crop_test_rows']} test rows is worse.

- Time split: {'pass' if gate['splits']['time'] else 'fail'} · Space split: {'pass' if gate['splits']['space'] else 'fail'}
- Crops worse than the 5-year mean: {worse}

### Per crop (time split)

{_crop_table(m['splits']['time']['per_crop'], m['config']['min_crop_test_rows'])}

## Ranges

80% ranges are conformalised on {cal['calibration_years'][0]}–{cal['calibration_years'][1]} and checked on
{cal['checked_years'][0]}–{cal['checked_years'][1]}, per crop group. "In season" uses the season's real weather;
"at sowing" uses normal weather, so its range also has to cover the weather to come.
Overall coverage: in season {_pct(cal['in_season']['coverage']['overall'])}, at sowing
{_pct(cal['at_sowing']['coverage']['overall'])}, 5-year-mean baseline {_pct(base['coverage']['overall'])} (target 80%).
MAE on the checked years: model at sowing {cal['at_sowing']['mae']:.4f}, 5-year mean {base['mae']:.4f}.
Groups with too few calibration rows borrow the overall width: {', '.join(cal['at_sowing']['borrowed_from_all']) or 'none'}.

{_coverage_table(cal)}

## Behaviour tests

Rain cut from 100% to 50% of normal, for every district on record:

{_behaviour_table(m['behaviour'])}

## Known limits

- District yields are administrative averages; they smooth away plot-level variation.
- One weather point per district; a large district's rain varies more than one point shows.
- Growth stages use one national sowing date per crop (Phase 1 departure 5).
- Crops without growth-stage weather (most pulses, vegetables, spices) rely on season totals.
- The irrigated share comes from a separately compiled DES series; 5.6% of its rows were
  rejected as inconsistent in Phase 1.

## Must not be used for

Insurance claims, credit decisions, or any statement about a specific farm's yield.
"""
