# Defect Register — Pass 4

**Date:** 2026-11-11
**Method:** every API route exercised in-process with edge-case inputs (FastAPI `TestClient`),
model behaviour probed across budget / rainfall / irrigation ranges, seed generators and
in-flight season-planner code read in full, frontend asset and translation checks scripted,
app viewed at 375 px and desktop. Nothing was fixed in this pass.

**Not covered:** marketplace, tractor booking and Gyan Seva flows were not re-tested;
the chatbot was only smoke-tested; no screen-reader or real-device testing; the live
data.gov.in path could not be exercised (no API key in this environment).

Each defect names the phase spec that fixes it.

---

## Critical

| ID | Defect | Evidence | Where | Fix in |
|---|---|---|---|---|
| N-1 | **The season planner's rainfall control does nothing.** Rice in Medak yields 2,544.54 kg/acre at 0× rainfall and 2,538.80 at 1× — no rain scores slightly higher than normal rain. The "dry scenario" column equals the selected scenario. | `POST /api/season/compare` with `rainfall_factor` 0, 0.5, 1, 1.5, 2 → 2544.54, 2544.54, 2538.80, 2523.14, 2530.97 | `engine/season_planning.py:33-41`; yield model weather importances all < 0.003 | Phase 0 (honest labelling), Phase 2 (real fix) |
| N-2 | **The irrigation control does nothing.** Irrigation 0, 0.5 and 1 all return 2,538.80 kg/acre. | same endpoint, `irrigation_level` 0 / 0.5 / 1 | same; `irrigation` importance 0.0 | Phase 0, Phase 2 |
| N-3 | **Zaid recommendations are all losses.** In Medak, Lucknow and Ludhiana the top crop is moong at 6–16 kg/acre (about −₹55,000 on a ₹60,000 spend); the others yield 0 and lose everything. They are still presented as "top crops". | `POST /api/recommend` season `zaid` | `ml/predict.py` yield path for zaid; budget floor | Phase 0 (guard), Phase 2 |
| N-4 | **Loss-making crops are returned as recommendations.** West Bengal · Bardhaman kharif: #2 is jowar at 9 kg/acre and −₹58,794; #3 is rice at −₹4,152. | `POST /api/recommend` `wb_bardhaman`/`kharif` | `ml/predict.py::rank_recommendations` | Phase 0 |
| N-5 | **Seed yield and weather rows are random numbers.** For 22 of 30 regions, yield = base × `uniform(0.82, 1.12)` and weather = profile × `uniform(0.8, 1.15)`, drawn independently. Yield therefore has no relationship to weather in the training data, which is why N-1 and N-2 exist. It also breaks PRODUCT.md constraint 2. | `dataset/_seed_extra.py:87-140` | `dataset/yield_history.csv`, `weather.csv`, `mandi_prices.csv` | Phase 1 |

## High

| ID | Defect | Evidence | Where | Fix in |
|---|---|---|---|---|
| N-6 | **Implausible rankings on the default inputs.** Punjab kharif: soybean first, rice absent. Punjab rabi: wheat third at 1,026 kg/acre. Thanjavur kharif: rice absent. Anand kharif: jute still first, after commit `e021096` said this was fixed. `validation_report.json` marks all five cases "PASS" because the check only requires a non-empty answer. | `POST /api/recommend` at ₹15,000/acre, 4 acres | `ml/predict.py`, `ml/train_models.py::write_validation_report` | Phase 0 (assertions), Phase 2 |
| N-7 | **The default budget is below the cost of most major crops.** ₹15,000/acre against rice ₹27,000 and cotton ₹32,000. With the establishment-floor curve, cotton yields 176 kg/acre at ₹15,000 and 872 at ₹30,000. Any budget above need is counted wholly as cost: ₹100,000/acre on cotton shows −₹177,491. This default drives N-6. | `POST /api/season/compare` budgets 1k–1M | `ml/predict.py:781-811`, `profit_estimator`; defaults in `index.html`, `decide.html` | Phase 0 |
| N-8 | **No upper bounds on `/api/recommend`.** 1e9 acres × ₹1e12 returns 200 with profit −1e21. The season route has bounds; the main request models do not. | probe | `backend/models.py` | Phase 0 |
| N-9 | **Price forecast is anchored to the last data month, not today.** On 2026-11-11 it returns forecasts for 2026-01 onward marked "confidence: high", from data ending 2025-12. The sell advisor combines today's month with a year-old price. | `GET /api/price-forecast/telangana_medak/rice` | `engine/forecast.py`, `engine/features.py::best_time_to_sell` | Phase 0 (label), Phase 1 |
| N-10 | **Live mandi prices are not on any request path.** `get_mandi_price` is exported but never called. It also maps only 8 of 35 crops, its CSV fallback returns the first (oldest) row, and it averages up to 50 unfiltered records. The data.gov.in page for the resource id in `agmarknet.py` currently says no API exists for it; this needs checking with a real key. | grep; `data_ingestion/fetchers/mandi.py:48-128` | `data_ingestion/fetchers/` | Phase 1 |
| N-11 | **`backend/routers/data.py` is never mounted.** Its nine routes (`/crops`, `/regions`, `/weather/{id}`, `/soil/{id}`, …) all return 404. | `app.routes` contains none of them | `backend/main.py` | Phase 3 |
| N-12 | **Kannada and Tamil have none of the season-planner strings.** 0 of the sampled keys in `kn.js` and `ta.js`; hi and te have them. | grep | `frontend/i18n/kn.js`, `ta.js` | Phase 0 |
| N-13 | **`mm_season_cache:` grows without limit.** Each distinct slider position stores a full response in `localStorage` and nothing evicts it. When the quota fills, saving a draft or plan fails. | `frontend/season-ui.js:10,26` | same | Phase 0 |
| N-14 | **No security headers on any response.** No CSP, `X-Content-Type-Options`, frame protection, HSTS or referrer policy. | response headers of `/api/health` and `/dashboard.html` | `backend/main.py` middleware, `vercel.json` | Phase 3 |
| N-15 | **Runtime data is lost on Vercel.** Commitments and sensor readings are written to SQLite under `/tmp`, which does not survive a cold start. | `utils/db.py:28-42` | same | Phase 3 |
| N-34 | **The uncommitted season-planner work breaks the test suite.** `ml/predict.py` now adds `planned_cost`, `price_per_kg` and `water_requirement_mm` to each recommendation, but the golden files were not regenerated, so `test_recommend_crops_unchanged_on_ml_path` fails. The run stops at the first failure: 89 passed, 1 failed, in 8 min 3 s; tests after it did not run. | `pytest -q tests -x` on 2026-11-11 | `tests/fixtures/recommend_crops_golden*.json`, `ml/predict.py` | Phase 0 |
| N-16 | **No CI.** `.github/` does not exist; 24 changed files sit uncommitted on `master`. | repo | — | Phase 0 |

## Medium

| ID | Defect | Where | Fix in |
|---|---|---|---|
| N-17 | `irrigation-schedule` accepts `sowing_date=2026-13-45`, echoes it back, silently uses the default, and returns a harvest date that contradicts the echoed sowing date. The default sowing date is hardcoded to 2025-06-15. | `backend/main.py` `get_irrigation_schedule`, `engine/features.py` | Phase 0 |
| N-18 | Season is case-sensitive. `KHARIF` returns "Unsupported region_id … or season", which does not say which input was wrong. | `ml/predict.py::_prepare_region_data` | Phase 0 |
| N-19 | `location-insights` lists the same crop twice in `best_priced_local_crops` (pulses, pulses). | `ml/predict.py::location_based_insights` | Phase 0 |
| N-20 | Unknown crop or region on `price-forecast` returns "Need at least 12 months of data" instead of not-found. | `engine/forecast.py` | Phase 0 |
| N-21 | `/api/_cache/stats` is public and returns absolute server file paths. | `backend/main.py` | Phase 3 |
| N-22 | Timestamps mix naive local time (`datetime.now().isoformat()` in `main.py` planning evidence and data-freshness) with UTC (`season_planning.py`). | `backend/main.py`, `utils/provenance.py` | Phase 0 |
| N-23 | `climate/alerts` and `carbon-credits` silently default the crop to wheat when none is sent. | `backend/models.py` | Phase 3 |
| N-24 | `fertilizer-recommendation`, `pest-alerts` and `irrigation-schedule` take no region. A caller that omits soil or weather values gets a generic answer (soil 40/20/20, 28 °C, 800 mm) with nothing marking it as generic. | `backend/main.py` | Phase 3 |
| N-25 | One yield interval of ±1,554 kg/acre is applied to every crop. It is meaningless for a 600 kg/acre pulse and too narrow for banana (coverage 0). Carries AUDIT B-18. | `ml/season_evidence.py` | Phase 2 |
| N-26 | Recommendation classifier covers 22 of 35 crops, barley has zero test support, and it is trained on the app's own formula. | `ml/dataset_builders.py` | Phase 2 |
| N-27 | Disease model classes and `disease_treatments.csv` do not line up: treatments exist for rice classes the model cannot predict. | `ml/models/disease_labels.json`, `dataset/disease_treatments.csv` | Phase 2 |
| N-28 | Rate limiting is per-instance memory and resets on every cold start. | `backend/main.py` | Phase 3 |
| N-29 | Season pages bypass the shared header and controls; voice buttons render unlabelled; dates are always formatted `en-IN` regardless of language. | `frontend/decide.html`, `season.html`, `season-ui.js:7` | Phase 0 |

## Low

| ID | Defect | Where | Fix in |
|---|---|---|---|
| N-30 | `archive()` parses `localStorage` without a guard; a corrupt value throws. | `frontend/season-plan.js:44` | Phase 0 |
| N-31 | `crypto.randomUUID()` needs a secure context; it throws when the app is opened over plain HTTP on a LAN address. | `frontend/season-plan.js`, 4 call sites | Phase 0 |
| N-32 | Docs drift. `ARCHITECTURE.md` describes the price model as gradient boosting and the recommender as a RandomForest; README says 50 endpoints (54 under `/api`); README lists docs that describe 14 tools (22 exist). | `docs/`, `README.md` | Phase 3 |
| N-33 | Working folder holds untracked clutter (`requests/`, `certifi/`, `urllib3/`, a `.pyd`, `frontend.zip`, `catboost_info/`, `bin/`). None is tracked by git, so this is local tidiness only. | repo root | Phase 0 |

## Still open from earlier audits (not re-verified in this pass)

B-9, B-16, B-17, C-18, C-19, C-20, C-24, C-25, D-3, D-4, D-5, D-12, D-13, F-5, F-6,
F-7, F-8, F-9 (79 `innerHTML` sites in `dashboard.js`), F-10, F-11, T-1, T-2.
See `AUDIT_REPORT.md`. Phase 3 and Phase 4 specs assign them.

## Checks that passed

- Node tests: 4 of 4.
- All `frontend/*.js` and `i18n/*.js` parse.
- All 77 service-worker precache entries exist on disk; no HTML page references a missing local asset.
- Every HTML page has `lang` and a viewport tag; no `<img>` lacks `alt`.
- Path traversal to `.env` returns 404; CORS does not echo an arbitrary origin.
- `/api/ml/train`, `/api/usage/*` and `/api/expense/*` are disabled as documented.
- Non-finite numbers are rejected; unknown regions return 400, not 500. No probe produced a 500.

## Checks that failed

- Python test suite: 1 failed, 89 passed with stop-on-first-failure (N-34). The suite
  also now takes about 8 minutes, up from 176 s in Pass 3.
