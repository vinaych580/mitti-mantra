# Model card: weekly district price forecast

**Version** `78385d86ffba` · **Data** Agmarknet weekly district prices 2020-12-28 to 2026-05-25,
8,187 district-crop series, 33 crops · **Code** `604339c6a3`

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
  least 5% below the best baseline's, on ≥ 100 backtest rows. Elsewhere the best
  baseline serves and the app says "typical for this time of year".
- Ranges: the 10th and 90th percentiles of the served method's own backtest errors for
  that crop and horizon. (The spec asked for quantile models; backtest errors give the
  same 80% interval and are calibrated by construction.)

## Backtest

Rolling origin over the last 156 weeks, refitting every 13 weeks on data whose
outcome was known before the refit. Mean absolute percentage error:

| Horizon | Backtest rows | Model | Last value | Same weeks last year | Historical mean | Cells served by model | 80% range coverage (last year) |
|---|---:|---:|---:|---:|---:|---:|---:|
| 1 wk | 491,769 | 7.1% | 7.3% | 10.2% | 23.5% | 11/33 | 79.4% |
| 4 wk | 464,602 | 13.8% | 14.8% | 19.3% | 24.3% | 8/33 | 80.5% |
| 8 wk | 435,064 | 18.5% | 22.1% | 27.6% | 25.2% | 7/33 | 80.0% |
| 12 wk | 411,089 | 21.5% | 26.7% | 31.7% | 25.8% | 7/33 | 78.3% |
| 26 wk | 354,437 | 28.5% | 35.8% | 40.6% | 26.9% | 5/33 | 65.2% |

## What serves, per crop and horizon

| Crop | 1 wk | 4 wk | 8 wk | 12 wk | 26 wk |
|---|---|---|---|---|---|
| arhar | last | last | last | last | last |
| bajra | **model** | last | last | last | mean |
| banana | last | last | last | last | mean |
| barley | last | last | last | last | last |
| cashew | last | last | last | last | last |
| chilli | last | last | last | last | last |
| coffee | last | last | last | last | last |
| cotton | last | last | last | last | last |
| cucumber | last | **model** | **model** | **model** | **model** |
| ginger | last | last | last | last | last |
| groundnut | last | last | last | last | last |
| jowar | **model** | last | last | last | mean |
| jute | last | last | last | last | seasonal |
| maize | last | last | last | last | last |
| mango | **model** | **model** | **model** | **model** | mean |
| moong | **model** | last | last | last | last |
| muskmelon | **model** | **model** | **model** | **model** | **model** |
| mustard | **model** | last | last | last | last |
| onion | last | last | **model** | **model** | mean |
| paddy_basmati | last | last | last | last | last |
| potato | last | last | **model** | **model** | mean |
| pulses | **model** | last | last | last | last |
| ragi | **model** | **model** | last | last | last |
| rice | last | last | **model** | **model** | **model** |
| soybean | last | last | last | last | last |
| sugarcane | last | last | last | last | last |
| sunflower | **model** | **model** | last | last | last |
| tobacco | last | last | mean | mean | last |
| tomato | last | **model** | mean | mean | **model** |
| turmeric | last | last | last | last | last |
| urad | **model** | last | last | last | last |
| watermelon | **model** | **model** | **model** | **model** | **model** |
| wheat | last | **model** | last | last | last |

## Known limits

- Prices are policy-driven (export bans, stock limits, MSP procurement); no model sees
  those coming. Expect baselines to serve for onion and tomato beyond a few weeks.
- The mirror's weekly series ends in May 2026; until the live feed (`DATAGOV_API_KEY`)
  runs, every forecast starts from that week and says so.
- District prices aggregate a few mandis; a farmer's own mandi can differ.

## Must not be used for

Trading or hedging decisions, or any promise of a sale price.
