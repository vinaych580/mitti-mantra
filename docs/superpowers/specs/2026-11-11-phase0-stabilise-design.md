# Phase 0 — Stabilise: honest outputs, landed work, CI

**Date:** 2026-11-11 · **Status:** Draft for owner review · **Size:** about 1 week
**Fixes:** N-1 to N-4 (interim), N-6 to N-9 (interim), N-12, N-13, N-16 to N-20, N-22, N-29 to N-31, N-33, N-34

## Intent

The app currently shows results that are wrong in ways a visitor can see: scenario
sliders that change nothing, a zaid season where every crop loses money, loss-making
crops ranked as recommendations. For a long-term portfolio project those are the first
things a reviewer finds. This phase makes every screen honest with the data and models
that exist today, lands the uncommitted season planner, and adds CI so later phases are
safe. It does not improve model quality; Phase 2 does.

## Goals

1. No screen offers a control that has no effect.
2. No recommendation list contains a crop expected to lose money unless every option does,
   and then the screen says so plainly.
3. The season planner is committed, on the design system, in EN, HI, TE, KN and TA.
4. Every push runs tests automatically.

## Non-goals

- Better predictions (Phase 2). New data (Phase 1). Navigation redesign (Phase 4).

## Anti-goals

- Hiding a defect by removing its evidence. If rainfall cannot move the estimate, the UI
  says the model cannot yet respond to rainfall; it does not fake a response.
- Tuning constants until the five validation cases look right.

## Constraints

Zero-build frontend. EN/HI/TE first-class. Offline keeps working; bump `VERSION` in
`sw.js`. Vercel serverless stays.

## Design

### 0.1 Scenario controls (N-1, N-2)

Decision: until Phase 2 delivers a weather-responsive model, the season planner computes
its rainfall and irrigation scenarios with the **deterministic simulator**
(`utils/calculations.py` climate and water factors), which does respond to both, and
labels the row "Heuristic estimate". The model estimate stays for the reference row only.

- `engine/season_planning.py::compare_plan`: `scenario()` takes a `force_heuristic` flag;
  `selected` and `dry` use it whenever `rainfall_factor != 1` or `irrigation_level != 0.5`.
- New regression test in `tests/test_season_planning.py`: yield at `rainfall_factor=0.5`
  is strictly below yield at `1.0` for rice, cotton and maize in three regions; yield at
  `irrigation_level=1` is not below `irrigation_level=0` under low rainfall.
- The assumptions list gains one line saying which rows are heuristic and why.

### 0.2 Ranking guards (N-3, N-4, N-6)

- `rank_recommendations`: crops with `expected_profit <= 0` sort after all profitable
  crops regardless of score. If no crop is profitable, the response carries
  `all_options_lose: true` and a `reason` (budget too low, season unsupported).
- Zaid: find the root cause of 6–16 kg/acre moong (suspect: climate guard or encoder
  fallback for a season with almost no training rows). Until fixed, the zaid yield path
  uses the heuristic and `prediction_source` says so.
- `write_validation_report` gains real assertions per case: an expected crop must appear
  in the top three (rice for Thanjavur kharif and Ludhiana kharif; wheat for Ludhiana and
  Lucknow rabi; cotton or groundnut for Anand kharif), and no top-three crop may have
  negative profit. Cases that fail are reported as FAIL. They are expected to fail until
  Phase 2; the report must say so instead of "all_pass: true".

### 0.3 Budget default and overspend (N-7)

- Default budget on landing, planner and dashboard becomes "typical cost for this crop
  and region" when a crop is known, else the median `avg_input_cost_inr_per_acre` of the
  crops in season for that region. The field shows the typical figure as helper text.
- `profit_estimator`: cost is `min(budget, typical_cost × 1.15)`; money above that is
  reported as `unspent_budget`, not as a loss.
- Tests: profit is non-decreasing in budget up to typical cost and flat after it.

### 0.4 Input bounds and errors (N-8, N-17, N-18, N-19, N-20, N-22)

- `backend/models.py`: `area_acres <= 100000`, `budget_per_acre <= 10000000` on every
  request model (same as `season_routes.py`).
- Season input lower-cased and validated before lookup; error names the bad field.
- `sowing_date` parsed as a date; invalid → 422. Default = the crop's calendar sowing
  date for the current or next season, not a literal.
- `location-insights` de-duplicates by crop, keeping the latest price.
- Unknown crop or region on forecast routes → 404 with the field name.
- All timestamps `datetime.now(timezone.utc).isoformat()`.

### 0.5 Stale price forecast (N-9)

- Forecast response adds `data_through` and `stale: true` when the newest price is older
  than 90 days; forecast months are generated from today, and months already past are
  dropped. Confidence is capped at "low" when stale. The UI shows the date.

### 0.6 Season planner UI (N-12, N-13, N-29, N-30, N-31)

- `decide.html` and `season.html` use the shared nav markup and `.field` / `.btn`
  classes from `style.css`; `season.css` keeps only layout that is truly page-specific.
- Voice buttons: mic icon, `aria-label`, `aria-pressed`, visible "listening" state.
- Voice-language select moves into the existing language switcher.
- Dates formatted with the active language's locale.
- `kn.js` and `ta.js` receive the 151 strings.
- `mm_season_cache:` capped at 20 entries, oldest evicted; `archive()` guarded;
  UUID helper falls back to `crypto.getRandomValues` when `randomUUID` is absent.

### 0.7 CI and repo hygiene (N-16, N-33)

- `.github/workflows/ci.yml`: Python 3.13, `pip install -r requirements-dev.txt`,
  `pytest -q tests`; Node 20, `node --test tests/*.cjs`; `node --check` over
  `frontend/**/*.js`; a script that fails when a precached asset changed without a
  `VERSION` bump; a script that fails when a `data-i18n` string in the changed HTML/JS is
  missing from `hi.js` or `te.js` (warns for `kn`, `ta`).
- Branch protection on `master`; work lands by pull request.
- Delete the untracked clutter from the working folder after confirming no import uses it.
- **First task of Phase 0 (N-34):** the suite is red on the current working tree.
  `pytest -q tests -x` on 2026-11-11 gave 1 failed, 89 passed in 8 min 3 s;
  `test_recommend_crops_unchanged_on_ml_path` fails because `ml/predict.py` gained three
  response fields and the golden files were not regenerated. Review the diff, regenerate
  both golden files deliberately, then run the suite without `-x` to see whether anything
  after that test also fails.
- The suite went from 176 s to about 8 minutes. Find the slow tests
  (`pytest --durations=20`) and mark the model-loading ones so CI can run a fast set on
  every push and the full set on pull requests.

## Acceptance

- Regression tests for 0.1–0.5 exist and pass.
- `POST /api/recommend` for the eight region/season pairs in the defect register returns
  no negative-profit crop above a positive-profit one.
- Planner checked at 375 px in five languages; no English strings in HI or TE.
- CI green on the pull request that lands the season planner.

## Left to the builder

Exact helper names, the wording of new UI strings (follow PRODUCT.md voice), and the
choice of icons.

## Risks

- Guarding the ranker may leave some region/season pairs with fewer than three crops.
  Show what remains; do not pad.
- Switching scenario rows to the heuristic changes numbers users may have saved. Saved
  plans keep their original figures and model version; only new comparisons change.
