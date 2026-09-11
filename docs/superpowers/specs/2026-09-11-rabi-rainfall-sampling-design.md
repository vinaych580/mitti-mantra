# Recommendation-model training weather sampling

**Status:** Approved
**Scope:** `ml/dataset_builders.py::_build_recommendation_dataset()` only

## Problem

`_build_recommendation_dataset()` samples rainfall from `U(200, 2500)mm` and
avg_temp from `U(15, 40)C` for every region and both seasons, regardless of
what that region+season's weather actually looks like. `dataset/weather.csv`
is loaded into a `weather_data` dict but never consulted for the sampling
range -- it was dead code.

Real kharif rainfall (505-2910mm across 30 regions x 3 years) happens to
fall inside the old range, but real rabi rainfall is 10.6-461.8mm -- 26 of
30 regions are below the 200mm training floor in every observed year.
Rainfall is the model's top permutation-importance feature (0.444) and
strongest label correlate (-0.4279), so the RandomForest cannot extrapolate
below its lowest split: real rabi requests collapse into one low-rainfall
leaf, and `ml_confidence` for every rabi crop sits near zero (confirmed:
wheat never exceeds 0.0013 across a 150-region x budget sweep).

## Decision: mostly-realistic + a minority tail, not a pure widen

Naive fix -- sample `rain`/`temp` from each region+season's own observed
`[min, max]` (from `dataset/weather.csv`'s 3 years per region), widened by
a small margin -- was prototyped first and rejected. It over-corrects:
wheat, maize, barley, and moong drop to **zero** training wins (18 of 32
crops labeled, down from 23), because `compute_smart_score` ranks crops
substantially on ROI (mustard: Rs14k cost, Rs52-80/kg vs wheat: Rs22k cost,
Rs20-32/kg), and `calculate_climate_factor` compares `rainfall_mm` directly
against each crop's `water_requirement_mm` with no irrigation credit. Under
real rabi rainfall, wheat's climate_factor never approaches its optimum, so
it never overcomes its ROI disadvantage anywhere in the sampling grid --
the old bug's unrealistically wide range was, paradoxically, the only thing
that ever gave wheat a rare win (a sample landing close to its 500mm ideal
purely by chance). This is a real characteristic of `compute_smart_score` /
`calculate_climate_factor`, not something `dataset_builders.py`'s sampling
range can or should paper over -- fixed by changing dataset sampling
*alone*, it just removes the training data's only occasional match for
wheat's water need.

**Chosen distribution: a two-component mixture per (region, season):**

- **65% of samples** -- drawn from that region+season's own observed
  `[min, max]` (across its 3 recorded years), widened: rainfall +/-25%
  relative (ratio-scale; floored at 0mm), avg_temp +/-3C absolute
  (interval-scale). This is the primary fix: it makes the bulk of training
  data reflect what a real production query actually looks like, so the
  classifier gets real splits in the region the real query falls in
  instead of extrapolating from a single degenerate leaf.
- **35% of samples** -- drawn from the *original* `U(200, 2500)mm` /
  `U(15, 40)C` range, unchanged. This tail represents years/conditions the
  3-year record didn't happen to capture (a wetter-than-observed winter is
  a real possibility, not just noise), and empirically it's what restores
  wheat/maize's rare-but-real representation without renormalizing the
  whole distribution back to "typically unrealistic."

Calibration (offline prototype against the real `dataset/*.csv`, not
committed): the original bug's exact range reproduces its own known label
rate almost exactly when used 100% of the time (wheat 0.150% vs. the
reported 0.157% -- confirms the mechanism). At 35% tail weight, wheat
recovers to ~0.057% (order-of-magnitude of the original 0.157%), maize to
~0.04%, and 22 of the original 23 labeled crops remain represented, while
the realistic component still dominates two-thirds of training mass.

**Known, accepted gap:** barley stays at 0 training wins at every tail
fraction tested up to 55% -- it was already vanishingly rare pre-fix
(8/60,000 = 0.013%), it is not one of the four staples the existing
regression test (`test_build_recommendation_dataset_staples_are_recommendable`)
requires (rice, wheat, maize, soybean), and forcing it further would mean
diluting the realistic majority far more than its marginal benefit
justifies. This is a pre-existing characteristic of barley's economics in
`compute_smart_score`, not a regression introduced here.

## What's out of scope

Whether `calculate_climate_factor` should credit `irrigation_level` against
`rainfall_gap` for irrigation-fed rabi crops (the deeper reason wheat needs
help at all) is a real, separate question -- it touches production scoring
used well beyond this training pipeline. Not addressed here.

## Acceptance criteria

- Full test suite green (`venv/Scripts/python.exe -m pytest -q tests`),
  including `test_build_recommendation_dataset_staples_are_recommendable`.
- `ml/models/audit_metrics.json`: `zero_f1_crops` stays `[]`, `f1_macro`
  does not regress below 0.6778.
- 150-combination rabi sweep (30 regions x 5 budgets): wheat/mustard's
  `ml_confidence` rises off the ~0.001 floor to a non-trivial value.

## Result (after implementation)

All hard criteria met: 156/156 tests pass after golden-fixture
regeneration, `zero_f1_crops` is still `[]`, and `f1_macro` improved
0.6778 -> 0.691 (not just "no regression"). Per-class F1 for the crops
that were structurally missing under pure realistic sampling: wheat
0.4235 -> 0.4762, maize 0.1622 -> 0.4211, moong newly present at 0.9091.
mustard's `ml_confidence` is robustly non-trivial everywhere (mean 0.457,
never zero across 255 real region x budget rabi combinations).

**wheat's improvement is real but uneven, not a fix to the typical case.**
Across the same 255-combination sweep: mean `ml_confidence` 0.00108,
median 0.0, exactly zero in 230/255 (90.2%) of combinations -- including
all three of the original spot-check regions (punjab_ludhiana,
haryana_karnal, up_lucknow), which are still exactly 0.0. The peak rose
14.6x (0.0013 -> 0.0190) and 14/255 (5.5%) combinations now exceed 0.01,
concentrated in regions/budgets the training tail happened to favor. This
is a real, honest artifact of a real trained model, not a degenerate
collapse: RandomForest gives exactly 0.0 when no tree's leaf at that query
point ever contained a wheat-labeled training row, and different regions
now land in genuinely different leaves (the structural fix working as
intended) rather than the pre-fix single shared low-rainfall leaf -- but
wheat's underlying ROI disadvantage in `compute_smart_score` still means
it rarely wins the leaves that wheat-belt regions' real conditions fall
into. Closing this fully would mean revisiting `calculate_climate_factor`'s
irrigation crediting (see "What's out of scope" above), not further tuning
of the sampling mixture.

barley did not measurably improve: 99.2% zero, max 0.0050 (was already
near-zero pre-fix, and is not one of the four crops the regression test
requires). Consistent with the "known, accepted gap" above.
