# Phase 2 — Implementation Notes

**Date:** 2026-11-27 · **Branch:** `phase2-models` · **Spec:** `../specs/2026-11-11-phase2-models-design.md`

What was built, the measured results, every departure from the spec, and what is left.
Everything here trains from the Phase 1 curated store (`data/curated/`); nothing trains in a request.

## Built

| Spec item | Where |
|---|---|
| 2.1 Yield: departure-from-trend target, weather/water/soil features, monotonic constraints, three splits, baselines, conformal ranges, behaviour tests | `ml/yield_anomaly.py`, `ml/train.py` |
| 2.2 Price: per-horizon model (1/4/8/12/26 weeks), three baselines, rolling-origin backtest, per crop × horizon gate, ranges, sell advisor on the ranges | `ml/price_model.py`, `ml/train.py`, `GET /api/v1/districts/{id}/price-forecast`, `/sell-advice` |
| 2.3 Recommendation: measured yield with yield and profit ranges, measured revenue risk, adoption share, agronomic acceptance set; classifier and `ml_confidence` retired | `ml/predict.py`, `ml/district_evidence.py`, `tests/test_agronomic_acceptance.py` |
| 2.5 `python -m ml.train --model yield\|price`, versioned runs (`ml/runs/`, gitignored), `python -m ml.release`, `model_version` on predictions; `POST /api/ml/train` now answers 410 | `ml/train.py`, `ml/release.py`, `backend/main.py` |
| 2.6 Model cards generated from each run's metrics | `ml/model_card.py`, `ml/models/<name>/model_card.md` |

## Yield (2.1)

Gate: beat the district 5-year mean by ≥ 10% MAE (on the departure from trend) on the time and space splits.

| Split | Model | 5-year mean | Trend only | Random forest | vs 5-year mean |
|---|---:|---:|---:|---:|---:|
| Last five years held out | 0.2178 | 0.2265 | 0.2395 | 0.2200 | +3.8% |
| 20% of districts held out | 0.2201 | 0.2461 | 0.2656 | | +10.6% |
| Both | 0.2221 | 0.2296 | 0.2460 | | +3.3% |

**The gate fails on unseen years, so the app serves the baseline**, as the spec directs: each district's 5-year
mean for the crop, with a range calibrated per crop group (84.4% of 2021–22 seasons inside the 80% range).
The model is better than that mean on every split; weather known at harvest adds skill, but not 10% on new
years. Behaviour tests pass on the shipped artifact (less rain lowers yield in every district for rice, cotton,
maize and wheat, and by less when irrigated). Cotton and tobacco were worse than the 5-year mean on the time split.

Measured: 177,714 district-crop-season-years, 1997–2022. Artifact 7.7 MB; loads in ~2.5 s cold (once per
instance, in the warm-up thread); a ranking request takes ~28 ms warm.

## Price (2.2)

Rolling-origin backtest over the last 156 weeks (refit every 13 weeks, no lookahead), 8,187 district-crop
series, Dec 2020 – May 2026. Mean absolute percentage error:

| Horizon | Model | Last value | Same weeks last year | Two-year mean | Cells served by model | 80% range coverage (last year) |
|---|---:|---:|---:|---:|---:|---:|
| 1 wk | 7.1% | 7.3% | 10.2% | 23.5% | 11/33 | 79.4% |
| 4 wk | 13.8% | 14.8% | 19.3% | 24.3% | 8/33 | 80.5% |
| 8 wk | 18.5% | 22.2% | 27.6% | 25.2% | 7/33 | 80.0% |
| 12 wk | 21.5% | 26.7% | 31.7% | 25.8% | 7/33 | 78.3% |
| 26 wk | 28.5% | 35.7% | 40.6% | 26.9% | 5/33 | 65.2% |

The model beats every baseline overall at 1–12 weeks; at 26 weeks the two-year mean is better. Per cell, the
model serves only where it is ≥ 5% better than the best baseline (38 of 165 cells); elsewhere the best baseline
serves and the API labels it "typical for this time of year". **26-week ranges under-cover (65%)**: the last
year was more volatile than the two before it. The previous app forecast (the historical mean) was the worst
method at every horizon up to 12 weeks.

Every forecast starts from the store's last week (May 2026 until the live feed runs) and returns its freshness.

## Ranking (2.3)

Agronomic acceptance set: 59 district × season cases built from DES area (top-two crops must include one in the
top three; no crop unknown to the state). **95% pass (gate 90%)**; the old ranking passed 58%.
Known misses: Belagavi rabi (maize and wheat out-earn jowar), Palakkad rabi (one-crop record), Nashik rabi (only
maize turns a profit).

What changed in a result row: `prediction_source` is `district_record` (or `yield_model` once the model clears
its gate) for crops on record, else `heuristic`; new `yield_range_kg_per_acre`, `profit_range`, `yield_basis`,
`adoption_share`, `grown_in_state`, `risk_basis`; `ml_confidence` is gone.

## Departures from the spec

1. **The central yield estimate uses squared error on departures clipped to ±0.5, not quantile loss.**
   scikit-learn re-fits leaf values after each tree for quantile and absolute-error losses, and that step
   ignores monotonic constraints: less rain raised yield in 1–3% of districts. Squared error keeps them, at a
   small accuracy cost (0.2178 vs 0.2146 MAE).
2. **One yield model, two input modes**, instead of separate `yield_at_sowing` and `yield_in_season` models:
   at sowing, the weather features are set to the district normal and the range is calibrated on that mode's
   own errors (it must cover the weather still to come). NDVI (A13) is not in the store yet.
3. **The 5-year mean's gap from trend and a 3-year mean are features.** They are known at sowing; without them
   the model could not combine the baseline's information with the weather.
4. **Price ranges come from each method's backtest errors per crop × horizon**, not from quantile models.
   The long-run mean is a fixed two-year window, because the serving store keeps two years; training and
   serving compute it identically.
5. **The recommender's 15-point "ML" term is now the adoption prior** (it duplicated the ROI term once the
   classifier stopped voting). It applies only to profitable crops.
6. **Measured risk.** Where the district has a record, risk is the log-spread of the crop's yield across seasons
   combined with its weekly price spread there. A crop with no record takes the riskiest recorded crop's risk:
   the hand-set drought/heat terms were far gentler than any measured record, so unproven crops looked safest.
   Confidence earns no points on a money-losing crop.
7. **Evidence rules on the shortlist (owner review).** A crop no district in the state records loses 10
   points, and is left off the default shortlist whenever a profitable crop the state does grow exists (as the
   loss guard leaves off losers). It stays available with `include_losses=True` and in comparisons. DES records
   basmati inside rice, so rice's record stands in for basmati only in the basmati GI states.
8. **Climate guard on the rule-based path.** It lived only inside the legacy forest's path, which Phase 2 skips.

## Owner decisions

- **Typical-farm vs good-farm figures.** Recommendations now use district-average yields for crops on record
  (about half of `base_yield`), so profits shown are lower and more realistic. Crops without a record still use
  the rule-based yield calibrated to the crop's measured average.
- **Turmeric cost.** Medak's measured turmeric (cured, ~2,900 kg/acre recently) against an input cost of
  ₹68,000/acre gives 342% ROI; the cost looks low against published figures (`KNOWN_COST_BASIS_GAPS`).
- **The shortlist evidence rule** (departure 7).
- Chilli, mango and tobacco reference values (Phase 1) are unchanged.

## Still open

- Run versions now hash the model source files too; the released yield and price artifacts were trained
  before that change.
- **2.4 Disease** (field photos, abstain path, more crops): needs the image datasets and a GPU. Not started.
- `/models` page on the site (cards are generated; not yet rendered by the frontend; `/api/ml/status` lists them).
- CI gate that compares a changed artifact's metrics with the deployed one.
- Season planner scenarios still use the rule-based water response; switch to the yield model's rain and
  irrigation inputs once it clears its gate (the behaviour tests already hold).
- Price inside recommendations (26-week quantile at harvest) and the frontend for the new forecast and sell advice.
- The legacy training code (`ml/train_models.py`, `ml/dataset_builders.py`, old `ml/models/*.joblib`) still
  exists for the no-artifact fallback; delete once the Phase 2 artifacts are the only path.
