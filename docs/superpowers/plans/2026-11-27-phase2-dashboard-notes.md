# Phase 2 dashboard — Implementation Notes

**Date:** 2026-11-27 · **Branch:** `phase2-dashboard` · **Builds on:** `2026-11-27-phase2-implementation-notes.md`

The Phase 2 API (weekly price forecast, sell advice, recommendation evidence) was live but the dashboard
still called the legacy monthly endpoints. This piece puts it on screen. Zero-build vanilla JS, as before.

## Built

| Item | Where |
|---|---|
| Price forecast tool on `GET /api/v1/districts/{id}/price-forecast`: KPI tiles at 4/12/26 weeks with the 80% range, a weekly chart (last 26 weeks of recorded prices, median line, shaded range), a week-by-week list where every horizon says what produced it ("Model forecast", "Typical for this time of year …", "No expected change") | `frontend/dashboard.js` TOOL 4, `frontend/dashboard.html` |
| Sell advice tool on `GET /api/v1/districts/{id}/sell-advice`: quantity, storage ₹/kg a month and interest % a year inputs; sell-now value, the hold option's middle estimate and its low end side by side, a floating-bar chart of every option's range, every option listed with its carrying cost | `frontend/dashboard.js` TOOL 6, `frontend/dashboard.html` |
| Old-data notice on both tools whenever `freshness.stale` is true: date of the newest price, its age, and that forecasts count from that week, not today | `staleNotice()` in `frontend/dashboard.js` |
| No-data answer instead of an error: a 404 lists, as one-tap retries, the crops this district has prices for; 503 says forecasts are unavailable | `priceUnavailable()`, new `GET /api/v1/districts/{id}/price-forecast/crops` in `backend/routers/data.py` |
| Recommendation cards: yield and profit ranges ("8 seasons in 10"), the record behind each row (source, seasons on record, last year), and its adoption share ("Grown on 1.7% of this season's area here"), with a warning tone for crops not grown in the district or state | `recYieldRange`, `recProfitRange`, `recBasisLine` in `frontend/dashboard.js` |
| Source footers, empty-state hints and the landing demo's source line describe the Phase 2 data instead of the retired models | `frontend/mm-enhance.js`, `frontend/demo-recommender.js` |
| hi/te catalog entries for every new string (kn/ta left as warnings, as the CI check allows) | `frontend/i18n/hi.js`, `frontend/i18n/te.js` |

`text('…')` in `dashboard.js` now marks a catalog string and wraps it in its own `<span>`, so
`check_i18n.cjs` sees it and the DOM pass can match it exactly even with a number or " · " beside it. `t('…')`
translates immediately and is used only for chart labels, which live on a canvas. Numbers, dates and crop names
sit in `data-no-translate` spans. Sentence fragments around numbers were translated so they read in order in
Hindi and Telugu (checked in the browser).

## Bug found and fixed: models silently not loaded after a cold start

On a fresh server the first request burst logged
`yield model not loaded: deadlock detected by _ModuleLock('sklearn.ensemble._forest')` and every recommendation
fell back to the legacy model, with no ranges, until the process restarted. The warm-up thread and request
threads unpickle sklearn estimators at the same time, Python's import-lock deadlock detection raises in one of
them, and `load()` cached that failure as "no artifact". Production could hit this on any cold start.

Fix (`ml/_artifact.py`): both Phase 2 artifacts load through one `LazyArtifact` helper that serialises artifact
loads on one lock, retries a failed load once at once, then again after 30 s; only a missing file is cached as
None. The warm-up thread now also loads the price model. Tests: `tests/test_artifact_loader.py`.

## Coverage, measured

Price forecasts exist for **417 of 1,050** region × crop pairs offered in the dashboard's dropdowns (30 regions ×
35 crops). Every one of them is stale today: the newest prices are from May 2026, about 190–200 days old, so the
old-data notice shows on every forecast. Two regions (`jk_pulwama`, `jharkhand_ranchi`) have no prices at all.

## Open items for the owner

- **Sell advice ignores perishability.** It recommends holding tomato, watermelon and muskmelon for 26 weeks in
  Sehore (and similar elsewhere) because their seasonal price rises; none of them keeps that long without cold
  storage. Options: a per-crop maximum storage time in `ml/price_model.sell_advice`, or a warning in the UI. Not
  decided here.
- The legacy `/api/price-forecast` and `/api/sell-advisor` endpoints are no longer called by the dashboard; the
  Marketplace (`frontend/marketplace.js`) still uses `/api/price-forecast` for its chart.
- The open items from the Phase 2 notes (district-average vs good-farm profit, the shortlist rule for crops no
  district in the state grows, turmeric's input cost) are unchanged.

## Verified

Browser preview at desktop width and 375 px, light and dark, English, Hindi and Telugu: Karnal wheat (sell now),
Sehore tomato and onion (hold), Karnal coffee (no prices → crop suggestions → forecast). No horizontal scroll at
375 px. `node scripts/ci/check_i18n.cjs origin/master` and `check_sw_version.cjs` pass (`sw.js` v64 → v65).
