# Model card: district crop yield

**Version** `13898ae6d977` · **Data** 2002–2022, 177,714 district-crop-season-years,
666 districts, 27 crops · **Code** `319dd5b5e5` ·
**Data manifest** `01c436b9e452`

**Gate failed, so the app serves the baseline:** each district's 5-year mean yield for the crop, with a calibrated 80% range. The model is better than that mean on every split, but not by the 10% the gate asks for on unseen years. Weather scenarios (the season planner) keep the rule-based yield, because a mean cannot respond to rain.

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
- Normals are 1997–2017, so a test season is never part of its own normal.

## Data

DES Area, Production and Yield (district, via India Data Portal), NASA POWER daily weather
at one point per district, DES crop-wise irrigated area, and Soil Health Card summaries,
all from the Phase 1 curated store. No synthetic rows.

## Accuracy

Mean absolute error of the departure from trend (≈ relative error: 0.10 ≈ 10%), on rows
the model never saw.

| Split | Test rows | Model | 5-year mean | Trend only | Random forest | vs 5-year mean |
|---|---:|---:|---:|---:|---:|---:|
| Last five years held out | 51,253 | 0.2178 | 0.2265 | 0.2395 | 0.2175 | +3.8% |
| 20% of districts held out | 33,479 | 0.2201 | 0.2461 | 0.2656 |  | +10.6% |
| Both at once | 9,890 | 0.2221 | 0.2296 | 0.2460 |  | +3.3% |

In kg per acre on the time split: model 450,
5-year mean 471,
trend 512.

### Gate

Ship only if the model beats the 5-year mean by ≥ 10% on the
time and space splits, and no crop with ≥ 200 test rows is worse.

- Time split: fail · Space split: pass
- Crops worse than the 5-year mean: time: cotton, tobacco

### Per crop (time split)

| Crop | Test rows | Model MAE | 5-year mean MAE | Better? |
|---|---:|---:|---:|---|
| maize | 4,835 | 0.2020 | 0.2175 | yes |
| rice | 4,175 | 0.1459 | 0.1584 | yes |
| moong | 3,575 | 0.2488 | 0.2566 | yes |
| urad | 3,469 | 0.2245 | 0.2294 | yes |
| groundnut | 2,933 | 0.1956 | 0.2095 | yes |
| mustard | 2,444 | 0.1970 | 0.2046 | yes |
| wheat | 2,442 | 0.1402 | 0.1413 | yes |
| onion | 2,418 | 0.2021 | 0.2024 | yes |
| arhar | 2,408 | 0.2384 | 0.2434 | yes |
| pulses | 2,296 | 0.1963 | 0.2115 | yes |
| potato | 2,283 | 0.2236 | 0.2332 | yes |
| sugarcane | 2,264 | 0.3155 | 0.3284 | yes |
| jowar | 2,035 | 0.2652 | 0.2732 | yes |
| bajra | 1,793 | 0.2091 | 0.2155 | yes |
| chilli | 1,473 | 0.2406 | 0.2452 | yes |
| cotton | 1,473 | 0.4054 | 0.3777 | **no** |
| sunflower | 1,192 | 0.2651 | 0.2705 | yes |
| ragi | 1,187 | 0.1744 | 0.1790 | yes |
| barley | 1,165 | 0.1605 | 0.1779 | yes |
| soybean | 1,145 | 0.2657 | 0.2695 | yes |
| turmeric | 1,077 | 0.1758 | 0.2086 | yes |
| ginger | 975 | 0.2211 | 0.2569 | yes |
| banana | 898 | 0.1805 | 0.1845 | yes |
| tobacco | 547 | 0.2033 | 0.1962 | **no** |
| jute | 376 | 0.2558 | 0.2619 | yes |
| cashew | 371 | 0.3113 | 0.3418 | yes |

## Ranges

80% ranges are conformalised on 2018–2020 and checked on
2021–2022, per crop group. "In season" uses the season's real weather;
"at sowing" uses normal weather, so its range also has to cover the weather to come.
Overall coverage: in season 83.1%, at sowing
83.9%, 5-year-mean baseline 84.4% (target 80%).
MAE on the checked years: model at sowing 0.2005, 5-year mean 0.2037.
Groups with too few calibration rows borrow the overall width: none.

| Crop | Rows | In season | At sowing |
|---|---:|---:|---:|
| maize | 2,020 | 84.5% | 83.4% |
| rice | 1,705 | 78.1% | 86.3% |
| moong | 1,476 | 84.7% | 84.7% |
| urad | 1,464 | 87.6% | 88.7% |
| groundnut | 1,230 | 86.6% | 88.5% |
| wheat | 993 | 85.2% | 93.0% |
| arhar | 989 | 83.1% | 84.5% |
| mustard | 966 | 87.7% | 88.9% |
| onion | 958 | 81.1% | 80.3% |
| pulses | 929 | 89.7% | 90.9% |
| potato | 907 | 75.6% | 76.0% |
| sugarcane | 890 | 74.7% | 79.6% |
| jowar | 826 | 78.1% | 71.7% |
| bajra | 722 | 83.5% | 84.1% |
| cotton | 613 | 79.1% | 68.8% |
| chilli | 523 | 84.3% | 73.0% |
| sunflower | 497 | 80.5% | 81.5% |
| ragi | 486 | 86.6% | 83.1% |
| soybean | 483 | 85.7% | 85.1% |
| barley | 444 | 84.5% | 88.3% |
| turmeric | 413 | 82.8% | 82.6% |
| ginger | 342 | 86.8% | 88.6% |
| banana | 339 | 83.5% | 84.7% |
| tobacco | 227 | 86.8% | 88.5% |
| jute | 152 | 76.3% | 83.6% |
| cashew | 128 | 75.8% | 67.2% |

## Behaviour tests

Rain cut from 100% to 50% of normal, for every district on record:

| Crop | Districts | Yield drop at 50% rain, rainfed | Same, fully irrigated | Never rises | Pass |
|---|---:|---:|---:|---:|---|
| rice | 967 | 6.7% | 2.4% | 100.0% | yes |
| cotton | 356 | 11.2% | 6.8% | 100.0% | yes |
| maize | 1171 | 4.5% | 2.9% | 100.0% | yes |
| wheat | 541 | 2.2% | 0.8% | 100.0% | yes |

## Known limits

- District yields are administrative averages; they smooth away plot-level variation.
- One weather point per district; a large district's rain varies more than one point shows.
- Growth stages use one national sowing date per crop (Phase 1 departure 5).
- Crops without growth-stage weather (most pulses, vegetables, spices) rely on season totals.
- The irrigated share comes from a separately compiled DES series; 5.6% of its rows were
  rejected as inconsistent in Phase 1.

## Must not be used for

Insurance claims, credit decisions, or any statement about a specific farm's yield.
