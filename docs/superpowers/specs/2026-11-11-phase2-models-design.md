# Phase 2 — Models Rebuilt on Real Data

**Date:** 2026-11-11 · **Status:** Draft for owner review · **Size:** 2–3 weeks
**Fixes:** N-1, N-2, N-3, N-6 (properly), N-25, N-26, N-27; AUDIT B-18
**Depends on:** Phase 1 curated store.

## Intent

Today the yield model is a crop lookup with noise, the price model is a mean, the
recommender imitates a formula, and the disease model has seen 432 lab photos. With real
data from Phase 1, each can be rebuilt to do the one thing a farmer needs from it, and be
measured honestly. As a portfolio piece, the evaluation is as important as the model: a
reader should see exactly how each model was tested and where it fails.

## Goals

1. A yield model that responds correctly to rainfall, heat and irrigation, and beats the
   district-crop five-year mean on unseen years and unseen districts.
2. A price forecast that beats seasonal-naive at stated horizons, or says it cannot.
3. Recommendations whose top three match what a local agronomist would call sensible.
4. A disease screen tested on field photos, able to say "not sure".
5. Calibrated ranges on every number shown.
6. A reproducible training run with a model card per model.

## Non-goals

- Deep learning for tabular data. Plot-level prediction. Satellite image models.

## Anti-goals

- Shipping a model because its headline metric is high. R² across crops is banned as a
  headline: it was 0.99 for a model that learned nothing.
- Evaluating on rows the model saw, or on synthetic rows.

## Constraints

- Inference inside a Vercel function: models load lazily, total artifacts under 60 MB,
  single prediction under 100 ms warm.
- scikit-learn stays pinned; LightGBM may be added only if its wheel fits the bundle
  (otherwise `HistGradientBoostingRegressor`).
- A heuristic fallback remains behind every model, and `prediction_source` stays.

## Design

### 2.1 Yield

**Target.** `yield_anomaly = log(yield) − log(trend)`, where trend is a robust linear fit
per district-crop over the prior years only. Prediction = trend × exp(anomaly).

**Features** (all from Phase 1 tables, known by harvest; a second variant uses only what
is known at sowing):

| Group | Features |
|---|---|
| Rain | total and by growth stage, as % of the district normal; longest dry spell; onset delay in days; count of days > 50 mm |
| Heat | days above crop `temp_max_c` by stage; growing degree days; night-temperature mean at flowering |
| Water | irrigated share for the crop in the district; rain × (1 − irrigated share) interaction |
| Vegetation | NDVI at mid-season and its departure from the district norm (harvest-time variant only) |
| Soil | pH, organic carbon, texture class |
| Context | crop, season, state (categorical); previous year's anomaly |

**Two models.** `yield_at_sowing` (for recommendations: uses climate normals and the
seasonal outlook) and `yield_in_season` (for the season companion: uses observed weather
and NDVI so far).

**Validation.** Three splits, all reported:
1. Last five years held out (time).
2. 20% of districts held out entirely (space).
3. Both at once.

**Baselines.** District-crop five-year mean; trend only; the current RandomForest.

**Gate.** Ship when MAE on anomaly improves ≥ 10% over the five-year mean on splits 1 and
2, and per-crop MAE is not worse for any crop with ≥ 200 test rows.

**Behaviour tests** (fail the build):
- Rice, cotton, maize, wheat: predicted yield falls when rain drops from 100% to 50% of
  normal at zero irrigation.
- The same drop is smaller at full irrigation.
- Monotonic constraints set on rain-deficit and heat-stress features where the library
  supports them.

**Uncertainty.** Conformalised quantile regression per crop group; report 80% ranges.
Coverage is checked per crop; a crop with fewer than 100 calibration rows borrows from
its group and is flagged.

### 2.2 Price

- Series: `price_district_weekly`, log prices.
- Horizons: 1, 4, 8, 12, 26 weeks.
- Baselines: last value; same week last year; historical mean (the current "model").
- Features: lags 1–8 and 52; rolling mean and volatility; week-of-year terms; arrivals
  and arrival anomaly; MSP and price-to-MSP ratio; weeks since the harvest window opened;
  neighbouring-district price; rainfall anomaly in the main producing districts.
- Model: one gradient-boosted model per horizon across all crops with crop as a
  category, quantile loss at 10/50/90.
- Evaluation: rolling-origin backtest over the last three years, MAPE and pinball loss
  per crop × horizon.
- **Gate per crop × horizon.** Where the model does not beat the best baseline by 5%, the
  app serves the baseline and the UI says "typical for this time of year". The manifest
  lists which cells are model and which are baseline.
- Sell advisor is rebuilt on the quantiles: "hold" only when the median expected gain
  exceeds storage cost and interest, with the downside shown.

### 2.3 Recommendation

- The ranker stays a transparent score. No classifier in the loop.
- Inputs change: yield from `yield_at_sowing` with its range; price from the 26-week
  quantile at expected harvest; cost from `cost_state_crop`; risk from the district-crop
  historical yield variance and price variance (replaces hand-set risk terms).
- New signal: `adoption_share` = the crop's share of sown area in the district over the
  last five years. Shown as evidence ("grown on 38% of kharif area here") and used as a
  mild prior so crops never grown in a district need stronger economics to rank.
- Retire `recommend_model.joblib`, its encoders and holdout files. `ml_confidence` is
  removed from responses; `adoption_share` and `profit_range` replace it.
- **Agronomic acceptance set.** A file of 60 district × season cases with crops that must
  appear in the top three and crops that must not (rice in Thanjavur kharif; wheat in
  Ludhiana rabi; no jute in Anand). Source for each expectation: the district's top crops
  by area in A1. The gate is ≥ 90% of cases passing.
- Later, once D1 and D2 data exist: fit score weights to chosen-and-succeeded outcomes.

### 2.4 Disease

- Classes: every crop-disease pair with ≥ 300 training images after merging B1–B6, plus
  `healthy` per crop and one `not_a_leaf` class. Each class must have a row in
  `disease_treatments.csv` or it is not shipped (N-27).
- Backbone: stay on MobileNetV3-Small or move to EfficientNet-Lite0 if the ONNX stays
  under 20 MB; decide by field accuracy.
- Training: strong field-style augmentation (background replacement, blur, lighting,
  partial occlusion); class-balanced sampling.
- **Test set is field photos only** (PlantDoc and the field portions of B3), never
  PlantVillage. Report lab and field accuracy side by side.
- Calibration: temperature scaling; abstain below a per-class threshold chosen for ≥ 90%
  precision on the field set. Abstain shows "not sure — retake in daylight, one leaf".
- Optional: export a second copy for `onnxruntime-web` so screening works offline.

### 2.5 Training and release process

- `python -m ml.train --model yield|price|disease` reads `data/curated/`, writes
  artifacts plus `model_card.md` and `metrics.json` into `ml/models/<name>/<version>/`.
- Version = hash of (code commit, data manifest hash, config).
- Runs in GitHub Actions on manual dispatch (tabular) or locally (disease, needs a GPU);
  never inside a request. `POST /api/ml/train` is removed.
- A release script copies the chosen version into the bundle and updates `manifest.json`.
- CI gate: a pull request that changes an artifact must include a `metrics.json` that
  beats the deployed one on the gate metric, or carry an explicit override label.
- Every prediction response includes `model_version`; Phase 3 logs it with inputs.

### 2.6 Model cards (portfolio deliverable)

Each card: purpose, data and its dates, splits, metrics against every baseline, per-crop
table, calibration plot, the behaviour tests, known failure cases, what it must not be
used for. Published at `/models` on the site and linked from every result's source footer.

## Acceptance

- All gates in 2.1–2.4 met, or the baseline is what ships and the card says so.
- N-1, N-2 regression tests pass against the model path, and Phase 0's heuristic
  override is removed.
- The validation report's real assertions (Phase 0) pass.
- Artifacts total under 60 MB; cold-start import time measured and recorded.

## Left to the builder

Hyperparameters, exact feature windows, the crop grouping for calibration, the choice
between HistGradientBoosting and LightGBM after measuring bundle size.

## Risks

- District yields are administrative averages; they smooth away plot-level variation.
  Ranges must reflect that and the card must say it.
- Price data is noisy and policy-driven (export bans, stock limits). Expect the gate to
  fail for onions and tomatoes beyond four weeks; serving the baseline there is correct.
- Field disease accuracy will be far below lab accuracy. Publish it anyway.
