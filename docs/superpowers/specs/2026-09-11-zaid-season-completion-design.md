# Zaid Season Completion — Design Spec

## 1. Summary

Indian farming has three cropping seasons: kharif (monsoon), rabi (winter),
and zaid (summer, roughly March-May, between rabi harvest and kharif
sowing). Zaid is recognized in some parts of this app (chatbot intent
parsing, the shared farm-context season selector, all i18n tables) but
missing or actively wrong in others: zero zaid rows exist in any dataset,
the ML season encoder doesn't know the word, and several UI surfaces only
offer Kharif/Rabi. This spec completes zaid support: a real, if small,
zaid crop catalog; real zaid weather data for every region; and fixes to
the specific places that either hard-crash or silently substitute kharif
when asked about zaid.

## 2. Why

A user selecting "Zaid" in the shared farm-context selector (`mm-core.js`)
today gets a season the rest of the app can't actually serve:
`get_crop_calendar()` and `location_based_insights()` raise `ValueError`
for it, `ml/predict.py`'s ML path silently maps it to kharif instead of
telling the user, and most of the season dropdowns in `dashboard.html`
don't even offer it as a choice. The gap is inconsistent in a way that's
worse than not supporting zaid at all: it's advertised in some places and
broken in others.

## 3. Scope

**In scope:**
- Three new zaid crops in `dataset/crop_parameters.csv` (watermelon,
  cucumber, muskmelon), each with a matching `CROP_CALENDAR` entry.
- Real zaid weather data (Open-Meteo archive, same method as this
  session's earlier kharif/rabi refresh) for all 30 regions.
- `zaid` added to `ml/train_models.py`'s `ALL_SEASONS` (see §6 for why
  not `ml/dataset_builders.py`, this spec's original target).
- Frontend: zaid option added to every season `<select>` currently
  missing it; zaid recognized by the mini-chatbot's text parser; the two
  new crops added to the offline/demo season maps.

**Explicitly out of scope (see §7):**
- `yield_history.csv`, `msp_prices.csv`, `mandi_prices.csv` zaid data.
- Retraining `ml/recommend_model.joblib` / `ml/yield_model.joblib` — a
  separate session is mid-retrain on these same models in a different
  worktree for an unrelated accuracy-fix plan; retraining here would be
  duplicate work once that branch merges and retrains again anyway.
- Adding more than 3 zaid crops, or covering every existing crop's
  possible zaid variant.

## 4. Design — Crop Catalog

Add to `dataset/crop_parameters.csv`, matching the existing column order
and the value scale of comparable rows (potato/onion/tomato for yield
scale, moong for the existing zaid-tagged row):

| crop_id | crop_name | season | base_yield_kg_per_acre | water_requirement_mm | npk_n | npk_p | npk_k | temp_min_c | temp_max_c | gdd | avg_input_cost_inr_per_acre | mandi_min | mandi_max |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| watermelon | Watermelon | Zaid | 14000 | 480 | 60 | 30 | 60 | 24 | 42 | 1500 | 28000 | 8 | 15 |
| cucumber | Cucumber | Zaid | 10000 | 400 | 50 | 25 | 50 | 22 | 38 | 1200 | 24000 | 10 | 20 |
| muskmelon | Muskmelon | Zaid | 9000 | 420 | 55 | 28 | 55 | 24 | 40 | 1400 | 26000 | 15 | 25 |

These are typical reference values in the same spirit as the dataset's
existing rows (a seed/reference dataset, not a claim of measured
precision) — high heat tolerance and moderate-to-high water demand
reflect that zaid crops are grown under full irrigation through the hot
summer, not rainfed.

`moong` already carries `Kharif/Zaid` and needs no change — `_season_match`
already matches it via substring for a zaid request.

Add matching entries to `engine/features.py`'s `CROP_CALENDAR` dict (one
`"zaid"` sub-dict per new crop, same 9-field shape every other entry
uses: `land_prep`, `sowing_transplant`, `first_fertilizer`,
`second_fertilizer`, `third_fertilizer`, `critical_irrigation`,
`pest_watch`, `harvest_window`, `duration_days`), sown late January/early
February and harvested by mid-to-late May, consistent with the zaid
weather window defined below.

## 5. Design — Weather Data

Extend `data_ingestion/refresh_weather_seed.py`:
- Add `"zaid": (date(year, 3, 1), date(year, 5, 31))` to `_season_range`
  (a March-May window — the standard summer zaid season, distinct from
  kharif's June-October and rabi's November-March).
- `_completed_seasons` already generalizes over whatever seasons
  `_season_range` knows, so no change needed there beyond adding the
  zaid case.
- Run it once. Because zaid's window falls entirely within each calendar
  year (unlike rabi, which crosses a year boundary), zaid 2022 through
  2026 are all already complete as of today — expect roughly 30 regions
  x 5 years = 150 new rows, more than kharif/rabi's most recent backfill.

This directly fixes `ml/predict.py`'s `location_based_insights` crash for
zaid, since that crash is caused by zaid rows being entirely absent from
`weather.csv`, not by any logic bug.

## 6. Design — ML Season Vocabulary

Add `"zaid"` to `ml/train_models.py`'s `ALL_SEASONS` (currently
`{"kharif", "rabi", "annual", "perennial", "perenn"}`) — **not**
`ml/dataset_builders.py`, which was assumed to already exist when this
spec was drafted but turns out to only exist on a different, unmerged
branch another session is using for an unrelated plan. `ALL_SEASONS`'s
duplicate copy in `ml/evaluate_models.py` (a comparison-only script,
already slated for consolidation by that other plan) is deliberately
left untouched — see the implementation plan's Task 3 for the full
reasoning.

**What this does and doesn't fix:** `ALL_SEASONS` only affects the season
encoder built the *next time* `ml/train_models.py` runs. The currently
*deployed* `recommend_model.joblib`/`yield_model.joblib` were trained
before this change and their saved encoders still don't have "zaid" in
`classes_` — so `ml/predict.py`'s existing fallback logic
(`_encoded_season`, `_ml_recommend_crop`, both already coded to default
to kharif for anything the encoder doesn't recognize) keeps silently
substituting kharif for zaid on the ML path until the next retrain. This
spec does not trigger that retrain (see §3's scope note) — it only makes
the vocabulary correct so the *next* retrain (whenever it happens, likely
right after the concurrent accuracy-fix plan's own retrain lands) picks
up zaid automatically, without a second code change.

The deterministic heuristic paths (`calculate_yield_kg_per_acre`,
`smart_risk_score`, `compute_smart_score`) have no season vocabulary of
their own — they take a season string and use it for lookups against
`weather.csv`/`crop_parameters.csv`, which per §4-5 now have zaid data.
Those paths get correct zaid behavior immediately, without waiting for a
retrain.

## 7. Design — Frontend

- Add `<option value="zaid">Zaid</option>` to the 7 inline season selects
  in `dashboard.html` (currently Kharif/Rabi only) and to the landing-page
  selector in `index.html`, matching the existing option markup/labels
  used in `mm-core.js`'s shared selector (which already has all three).
- `toolbar.js`'s mini-chatbot season parser
  (`/rabi/.test(text) ? 'rabi' : /kharif/.test(text) ? 'kharif' : null`)
  gets a third branch for `/zaid/`.
- `offline-simulator.js`'s hardcoded per-crop `CROPS` table gets entries
  for watermelon/cucumber/muskmelon tagged `'zaid'`, so the dashboard's
  no-backend offline Simulate/recommend path can recommend them too.
  `demo-recommender.js` (the landing-page live-demo widget) turns out
  *not* to be fixable the same way once checked at implementation time:
  its `CROP_SEASON` map only supplies a season-fit multiplier for crop
  names that already appear in a given state's `topCrops` array inside
  `frontend/state-data.js`, and populating that file's ~30 per-state
  crop lists with 3 new crops is a much larger, unscoped
  content-authoring task. Left untouched — see the implementation plan's
  File Structure section for the full reasoning.

## 8. Explicitly Deferred (not this build)

- **`yield_history.csv`, `msp_prices.csv` zaid rows.** Fabricating
  historical yield/price series for three brand-new crops is a bigger,
  more consequential content decision than the crop-catalog/weather work
  above — real historical data doesn't exist to backfill from, unlike
  weather (Open-Meteo has real archives) or agronomic parameters
  (published reference ranges exist). Left as a known, documented gap:
  the ML yield model simply has no zaid training rows and won't produce
  ML-path yield predictions for these crops until this is addressed; the
  deterministic heuristic path (`calculate_yield_kg_per_acre`) still
  works since it doesn't depend on `yield_history.csv`.
- **`mandi_prices.csv` zaid rows** — moot for now since that file has no
  season column at all; adding one is a separate, larger schema change
  this spec doesn't take on.
- **Retraining the ML models** — see §3 and §6.
- **Expanding the zaid crop catalog beyond 3 crops**, or auditing every
  other crop for a possible zaid variant beyond the existing
  `moong = Kharif/Zaid` tag.

## 9. Testing

- `ml/predict.py`: request `recommend_crops(region_id, "zaid", ...)` for
  a region with zaid weather now on file and confirm watermelon/cucumber/
  muskmelon appear as candidates (heuristic path — the ML path is exempt
  per §6).
- `engine/features.py`: `get_crop_calendar("watermelon", "zaid")` and
  `get_crop_calendar("cucumber", "zaid")`/`"muskmelon"` return calendars
  instead of raising.
- `ml/predict.py`: `location_based_insights(region_id, "zaid")` for every
  region returns a result instead of raising, now that `weather.csv` has
  zaid rows for all 30 regions.
- Frontend: manually verify a "Zaid" option renders and is selectable in
  `dashboard.html`'s season selects and `index.html`'s landing selector.
- Full `pytest` suite stays green throughout (no existing test asserts
  zaid's absence, so no test should need updating for these additions —
  if one does, that's worth a second look before proceeding).

## 10. Known Limitations (accepted, not fixed in this build)

- Zaid ML-path predictions silently resolve as kharif until the next
  model retrain (§6) — a real, temporary, and now clearly-documented
  limitation, not a new regression (the fallback behavior itself already
  existed and is unchanged; only its trigger condition for zaid is
  newly-understood and left as-is deliberately).
- The zaid crop catalog (3 crops) is intentionally thin compared to
  kharif/rabi's much larger catalog — a starting point, not full parity.
