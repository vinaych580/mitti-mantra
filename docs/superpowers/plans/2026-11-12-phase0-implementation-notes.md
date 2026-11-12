# Phase 0 — Implementation Notes

**Date:** 2026-11-12 · **Branch:** `phase0-stabilise` · **Spec:** `../specs/2026-11-11-phase0-stabilise-design.md`

What was built, and every place it departs from the spec, with the reason.

## Built

| Spec item | Defects | Where |
|---|---|---|
| Red suite fixed; golden files regenerated deliberately (yields identical to the previous fixtures) | N-34 | `tests/fixtures/recommend_crops_golden*.json` |
| 0.1 Scenario rows respond to rainfall and irrigation | N-1, N-2 | `engine/season_planning.py`, `utils/calculations.py::water_response_factor` |
| 0.2 Losing crops never shown beside profitable ones; `all_options_lose` + `loss_reason` when every crop loses; zaid uses the heuristic with irrigation assumed; validation report asserts real answers | N-3, N-4, N-6 | `ml/predict.py::rank_recommendations`, `apply_loss_guard`, `IRRIGATED_SEASONS`; `ml/train_models.py::evaluate_validation_cases` |
| 0.3 Typical-cost budget default (`/api/budget-default`); spend capped at 1.15 × typical cost, rest reported as `unspent_budget` | N-7 | `ml/predict.py::typical_budget_per_acre`, `profit_estimator`; `frontend/mm-core.js`, `decide.js`, `demo-recommender.js`, `dashboard.js` |
| 0.4 Upper bounds on every request model; season case-insensitive with field-named errors; real sowing dates (422 otherwise) and a calendar default; location insights de-duplicated; unknown ids on forecast routes are 404; UTC timestamps | N-8, N-17 – N-20, N-22 | `backend/models.py`, `ml/predict.py::normalise_season`, `engine/features.py`, `backend/main.py`, `utils/provenance.py` |
| 0.5 Price forecast starts this month, reports `data_through` / `stale`, confidence capped at low when stale | N-9 | `engine/features.py::price_forecast`, `best_time_to_sell` |
| 0.6 Season pages on the shared nav and form classes; mic buttons with icon, label, `aria-pressed` listening state; voice language follows the site switcher; dates in the page language; 20-entry offline cache; guarded archive; UUID fallback; kn/ta strings | N-12, N-13, N-29 – N-31 | `frontend/decide.html`, `season.html`, `season.css`, `season-*.js`, `i18n/*.js` |
| 0.7 CI: Node tests, `node --check`, service-worker VERSION check, i18n check, fast Python set on push and full suite on PRs; slow tests marked | N-16 | `.github/workflows/ci.yml`, `scripts/ci/`, `tests/conftest.py` |
| Shared default region (profile, else located with existing permission, else Sehore) | roadmap 0.5 | `frontend/mm-core.js::defaultRegion` |

## Departures from the spec

1. **Scenario rows are "model level × heuristic water response", not pure heuristic.**
   The spec said to compute moved scenarios with the deterministic simulator. Doing that
   put the heuristic's numbers next to the model's reference and produced a "dry" profit
   higher than the normal one (the two estimators sit at different levels). Scenarios now
   keep the reference estimate and scale it by the FAO-33 relation
   `1 − Ky × (1 − supply/need)`, supply = effective rain + irrigation share of the shortfall,
   Ky per crop from FAO Paper 33. Rows are labelled "Model level, heuristic weather response".

2. **The global climate factor was not changed.** Scoring effective instead of raw rainfall
   everywhere fixed jowar at 9 kg/acre but made paddy rice (1,200 mm need) unable to score
   well anywhere, because effective rainfall tops out near 800 mm. Reverted; the FAO-33
   response is used only for scenarios. Jowar's 9 kg/acre in wet districts is now hidden by
   the loss guard and is left for Phase 2.

3. **ROI is return on the farmer's budget.** With spend capped, ROI on spend alone inflated
   cheap crops and pushed rice and wheat out of the top three. ROI = profit ÷ budget keeps
   every crop on the same capital. Validation cases: 4 of 5 pass (was 3 with ROI on spend).

4. **Training labels keep the uncapped cost** (`profit_estimator(cap_spend=False)` in
   `ml/dataset_builders.py`). Phase 0 does not change model training data, and the classifier
   those labels train is retired in Phase 2.

5. **The spend cap is 1.15 × typical cost, so profit falls slightly between typical cost and
   the cap** rather than being flat after typical cost, as the spec's test wording said. The
   test asserts the fall is at most the 15% headroom.

6. **CI uses Python 3.12** (the venv the committed models were tested in), not 3.13, and
   installs `requirements.txt` + pytest + httpx rather than `requirements-dev.txt`: tests never
   import torch.

## Still open

- **Thanjavur kharif:** rice is not in the top three, even with the typical budget (validation FAIL; Phase 2).
- **Crop names stay English** in every language across the app (Phase 4 language work).
- **Tamil nav at 375 px:** the long "Open dashboard" button collapses the logo on every page; this was already the case before Phase 0.
- **Repo-root clutter (N-33):** `requests/`, `certifi/`, `charset_normalizer/`, `idna/`, `urllib3/`, `dotenv/`, their `.dist-info`, `bin/`, `catboost_info/`, `frontend.zip` and a `.pyd`. All are untracked and gitignored, but not in `.vercelignore`, and they shadow venv packages when Python runs from the repo root. Deleting them needs the owner's OK.
- **Branch protection on `master`** is set in GitHub settings, not in the repo.
