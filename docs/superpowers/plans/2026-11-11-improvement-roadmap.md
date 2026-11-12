# Mitti Mantra / AgriSim — Improvement Roadmap

**Date:** 2026-11-11
**Status:** Draft for review. Nothing here is built or approved yet.
**Superseded in detail by the specs** in `docs/superpowers/specs/2026-11-11-*`: the defect
register (`-00-`), the dataset list (`-01-`) and one design per phase. Where this overview
and a spec disagree, the spec is right. Two corrections found while writing them: the
clutter in the repo root is untracked, not committed; and the seed yield and weather rows
for 22 regions are confirmed random (`dataset/_seed_extra.py`).
**Owner decisions recorded 2026-11-11:** stay on Vercel; long-term project and portfolio piece.
**Scope:** data, models, architecture, UI/UX and new features. This is a roadmap across six
independent projects; each phase needs its own spec and plan before code is written.

Durations are rough estimates for one developer working with an agent. External dataset
names are from prior knowledge: confirm current availability, API shape and licence before
committing to any of them.

---

## 1. What the project is today

**Product.** A farm-planning site for Indian farmers and advisors: pick region, season, area
and budget; get ranked crops, a yield/cost/profit simulation, rotation, mandi analytics,
advisories, schemes, a chatbot, plus demo marketplace, tractor booking and expert booking.

**Architecture.**

| Layer | Now |
|---|---|
| Backend | One FastAPI process. `backend/main.py` is 2,008 lines holding ~56 of 66 routes; two small routers exist (`routers/data.py`, `season_routes.py`). |
| Engine | `engine/` deterministic simulator and advisory features; `ml/predict.py` (1,496 lines) mixes model loading, scoring, ranking and data access. |
| Data | 9 CSVs in `dataset/` read through `utils/csv_cache.py`. Runtime writes go to SQLite (`utils/db.py`), which on Vercel lives in `/tmp` and is lost on cold start. |
| Ingestion | 11 fetchers and an ETL pipeline in `data_ingestion/`, labelled "not wired into production". |
| Frontend | Zero-build vanilla JS, 8 pages, PWA. `dashboard.js` is 257 KB, `style.css` 170 KB. EN/HI/TE/KN/TA catalogs. |
| Deploy | Vercel serverless (`api/index.py`), 30 s max duration. |
| Quality | 31 pytest files, one Node test. No CI (`.github/` does not exist). |

**Models (from `ml/models/manifest.json`, trained 2026-10-06).**

| Model | Reported | What it means |
|---|---|---|
| Yield (RandomForest) | MAE 402 kg/acre, R² 0.99 | Baseline "use the crop's base yield" scores MAE 445. The model is ~10% better than a lookup. Importances: `base_yield` 0.52 and `npk_p` 0.47 (both crop identity); every weather and soil feature is below 0.003. R² is high only because crops differ from each other. |
| Price | "DummyRegressor (historical mean)" | Gradient boosting lost to the historical mean (MAE 4.90 vs 4.63 ₹/kg), so the mean is what ships. There is no working price model. |
| Recommendation (HistGB) | Accuracy 0.96, macro-F1 0.82, 22 classes | Trained on ~45k synthetic scenarios labelled by the app's own scoring formula. It is excluded from ranking (see `docs/ARCHITECTURE.md` step 6), so it only supplies an `ml_confidence` figure. Barley has zero test support. |
| Disease (MobileNetV3-Small) | Accuracy 0.80, macro-F1 0.76 | 432 training images, 18 classes, lab photos from PlantVillage. Classes are maize/potato/tomato/soybean; rice, wheat and cotton are absent. |

**Datasets.**

| File | Size | Limitation |
|---|---|---|
| `yield_history.csv` | 565 rows, 30 districts, 2022–2024 | Three years cannot teach weather response. |
| `weather.csv` | 390 rows | One row per region-season-year: no in-season timing. |
| `mandi_prices.csv` | 2,868 rows, monthly, 2024–2025 | The dashboard already badges it "12 months old". |
| `soil.csv` | 51 rows | District averages. |
| `crop_parameters.csv` | 35 crops | Hand-curated constants drive most of the simulation. |

`dataset/_seed_extra.py` generates weather, yield and mandi rows for 22 of the 30 regions
from a seeded random generator. That sits uneasily with PRODUCT.md constraint 2 ("every
computed figure traces to a real dataset"). **Open question for the owner: which rows are
measured and which are generated?** The answer decides how urgent Phase 1 is.

**UI/UX observations (from running the app on 375 px and desktop).**

- Landing and dashboard are polished and on-system.
- The in-progress season planner (`decide.html`, uncommitted) has dropped out of the design
  system: its own header, native selects, voice buttons that render as unlabelled dark
  blobs, and a raw "Voice language" select.
- On mobile the dashboard's tool list fills the first screen; the active tool starts below
  the fold.
- 22 tools are grouped by type (Plan/Market/Field), not by where the farmer is in the season.
- Landing defaults to MP · Sehore, the planner to Telangana · Medak.
- Only 30 districts exist; a farmer elsewhere has no honest answer.
- Ten Google Font families load on every page regardless of language; Chart.js and hero
  photos come from CDNs, which weakens the offline claim.

**Work in flight.** 12 modified and 12 untracked files on `master` implement the season
planner (`/api/season/compare`, `/api/season/evidence`, conformal yield interval, five-step
planner). The hi and te catalogs gained 151 lines each; kn and ta did not.

---

## 2. Principles this roadmap keeps

Taken from PRODUCT.md and unchanged: zero-build frontend, every figure traceable,
EN/HI/TE first-class, offline works, heuristic fallback behind every model, and no model
ships unless it beats its named baseline on a held-out split.

---

## 3. Phases

### Phase 0 — Land what is in flight and add a safety net (about 1 week)

1. Finish the season planner: bring `decide.html` back onto the shared header, form
   controls and tokens in `style.css`; give voice buttons a mic icon, `aria-label` and a
   visible recording state; add the 151 new strings to `kn.js` and `ta.js`.
2. Commit it on a branch, not `master`.
3. Add GitHub Actions: `pytest -q tests`, `node --test tests/*.cjs`, a check that
   `sw.js` `VERSION` changed when precached assets changed, and a check that every
   `data-i18n` key exists in hi and te.
4. Remove dead artifacts from the repo root (vendored `requests/`, `certifi/`, `.pyd`,
   `frontend.zip`, `catboost_info/`) after confirming nothing imports them.
5. Make the landing and planner share one default region (the Farm Profile, else geolocation).

**Done when:** CI is green on a PR that contains the season planner, and the planner passes
a visual check at 375 px in EN, HI and TE.

### Phase 1 — Real data foundation (2–3 weeks)

The largest lever. Every model limit above is a data limit.

**Sources to bring in**

| Need | Source | Gives |
|---|---|---|
| Yield history | DES "Area, Production, Yield" district statistics (data.gov.in); ICRISAT District Level Database | 20+ years, ~600 districts, per crop and season |
| Daily prices | Agmarknet via the data.gov.in API (`fetchers/mandi.py` exists), e-NAM | Daily modal/min/max price and arrivals per mandi |
| Weather | NASA POWER daily (`fetchers/nasa_power.py` exists), IMD gridded rainfall, CHIRPS | Daily rain and temperature back to the 1980s |
| Soil | SoilGrids (`fetchers/soil_grids.py` exists), Soil Health Card district summaries | Point soil properties instead of district averages |
| Vegetation | MODIS/Sentinel-2 NDVI through Earth Engine (`fetchers/google_earth_engine.py` stub) | In-season crop condition |
| Costs | DES/CACP Cost of Cultivation reports | State-crop input costs to replace hand-set constants |
| Disease images | Full PlantVillage, PlantDoc (field photos), public rice, wheat and cotton leaf sets | 50k+ images including field conditions and the crops farmers here grow |
| Own outcomes | Commitment log plus harvest reports from users | The only data nobody else has |

**Pipeline**

1. Decide the fate of the dead ETL stack (AUDIT D-4): wire it or delete it. Recommendation:
   keep the fetchers, replace `etl_pipeline.py` with three plain stages.
2. `raw/` (as fetched, immutable, gitignored) → `staged/` (cleaned, canonical ids) →
   `curated/` (what the app and training read). Store curated tables as Parquet for
   training and as one read-only SQLite file for serving.
3. Canonical keys: LGD district codes and a crop alias table, so sources join cleanly.
4. Every curated row carries `source`, `fetched_at`, `licence` and `is_synthetic`.
   `utils/provenance.py` reads these instead of file mtimes.
5. Validation gates per table (ranges, unit checks, duplicates, year gaps); the build fails
   loudly on violation.
6. A dataset manifest with a content hash; models record the hash they were trained on.
7. Scheduled refresh by GitHub Actions cron: mandi daily, weather weekly, yields yearly.
8. Mark or remove `_seed_extra.py` rows once real rows exist for the same key.

**Done when:** the curated store has at least 15 years of district yields and 3 years of
daily prices for the crops in `crop_parameters.csv`, with zero unlabelled synthetic rows,
and the freshness badge reports mandi prices under 7 days old.

### Phase 2 — Models rebuilt on that data (2–3 weeks)

**Yield**
- Target: deviation from the district-crop trend, not absolute yield, so crop identity
  stops dominating.
- Features: rainfall by growth stage, dry-spell length, heat-stress days, growing degree
  days, sowing-time soil moisture proxy, NDVI at mid-season, irrigation share, soil.
- Validation: leave-years-out and leave-districts-out, reported separately.
- Models: gradient boosting first; compare with the current RandomForest and both baselines.
- Uncertainty: quantile or conformal intervals calibrated per crop. Today one radius of
  1,554 kg/acre applies to every crop (AUDIT B-18).
- Gate: ships only if it beats "district-crop 5-year mean" by 10%+ MAE on both splits.

**Price**
- Daily data aggregated to weekly; horizons of 1, 4, 8 and 12 weeks.
- Baselines: seasonal-naive and historical mean.
- Features: lags, same-week-last-year, arrivals, MSP, harvest-calendar position,
  neighbouring-mandi prices.
- Output: a range per horizon, evaluated by rolling-origin backtest.
- Gate: per crop and horizon. Where the model loses, the app keeps the baseline and says so.

**Recommendation**
- Keep the transparent score as the ranker.
- Retire the classifier that imitates it. Replace `ml_confidence` with a regional adoption
  signal from real area shares ("grown on 38% of sown area in your district").
- Feed real per-district yield variance into the risk term.
- Later, once commitments accumulate, learn score weights from what farmers chose and
  how it turned out.

**Disease**
- Retrain on the larger set with field-style augmentation; add rice, wheat and cotton.
- Hold out field photos as the test set; report lab and field accuracy separately.
- Add a "not a leaf / not sure" abstain path and temperature-scaled confidence.
- Align classes with `disease_treatments.csv` so every prediction has a treatment row.

**MLOps**
- Training moves out of the request path: `POST /api/ml/train` cannot finish inside a 30 s
  serverless call. Train in CI or locally, publish artifacts.
- One model card per model: data hash, split, metrics against baselines, known failure cases.
- CI gate that fails if a new artifact is worse than the deployed one.
- Log each prediction's inputs and model version so harvest outcomes can be joined later
  (`ml/season_evidence.py` already expects this shape).

### Phase 3 — Architecture completion (about 2 weeks)

1. **Persistent storage.** Move runtime writes (commitments, sensors, outcomes, usage) to a
   hosted database; `utils/db.py` is the single swap point. Re-enable `/api/expense/*`
   with per-device scoping.
2. **Backend structure.** Split `main.py` into routers by domain (core, simulate, market,
   advisory, field, ml, chat). Give `ml/predict.py` a public interface so `engine/` stops
   importing its underscore functions; separate data access, scoring and ranking.
3. **API hygiene.** One prefix (`/api/v1`), retire duplicate legacy routes (`/crops` vs
   `/api/crop`), shared error format, contract tests generated from OpenAPI.
4. **Identity.** Keep device ids; add optional phone-OTP later so a plan survives a lost
   phone. Owner decision, not assumed.
5. **Protection.** Shared rate limiting (the current limiter is per-instance memory),
   upload size limits on all write routes.
6. **Observability.** Structured logs with request ids, error tracking, a deep health check
   that reports model and data versions.
7. **Frontend structure.** Split `dashboard.js` into one native ES module per tool, loaded on
   demand with `import()`. Still zero-build. Extend the Node test runner to cover them.
   Route all dynamic HTML through one escaping helper (79 `innerHTML` sites today).
8. **Offline integrity.** Self-host fonts and Chart.js; load script fonts only for the
   active language.
9. Update `docs/ARCHITECTURE.md`, which still describes the price model as gradient
   boosting and the recommender as a RandomForest.

### Phase 4 — UI/UX (2–3 weeks)

1. **Season-shaped navigation.** Reorganise the 22 tools into Plan → Grow → Sell → Money.
   "My season" becomes a timeline showing the one next action.
2. **Mobile shell.** Bottom tab bar and a collapsed tool drawer so the active tool is the
   first thing on screen.
3. **Location.** State → district search covering every district Phase 1 adds, with a
   "use my location" shortcut.
4. **Trust display.** Ranges instead of single numbers, a plain-language "how often this was
   right" line fed by `/api/season/evidence`, and one consistent source-and-date footer.
5. **Low-literacy path.** Voice on every form field, read-aloud results, icon-led cards, a
   shareable WhatsApp plan card.
6. **Advisor mode.** A roster of farmers/plots, side-by-side comparison, printable plan.
7. **Accessibility.** Adopt WCAG 2.2 AA as the stated target; fix popover focus handling
   (AUDIT F-11); test with a screen reader in Hindi.
8. **Performance budget.** First load under 200 KB compressed on the dashboard, measured on
   a throttled budget-Android profile.
9. **States.** Every tool gets designed empty, loading, error and offline states; only 2 of
   22 tools compute offline today.

### Phase 5 — New features (pick by value)

| Feature | Depends on | Why |
|---|---|---|
| Season companion: weekly tasks from calendar, irrigation and pest rules using a live 16-day forecast | Phases 1, 3 | Turns a one-time visit into a season-long relationship |
| Harvest outcome logging feeding the evidence report | Phase 3 | Builds the dataset no competitor has |
| Price alerts and nearest-mandi comparison net of transport | Phases 1, 2 | Directly raises sale price |
| Sowing-window advice from monsoon onset and forecast | Phase 1 | The decision farmers ask about most |
| Soil Health Card entry (typed or photographed) | Phase 3 | Replaces district-average soil with the farmer's own |
| PMFBY premium and claim estimator | none | Extends the existing scheme matcher |
| Web push reminders | Phase 3 | Brings users back at the right moment |
| Optional language-model layer for chatbot understanding only, calling the same engine functions | Phase 3 | Handles free-form Telugu/Hindi better; numbers stay grounded. Reverses a recorded design decision, so owner's call. |

---

## 4. Recommended order

0 → 1 → 2 → 3 → 4 → 5, with Phase 3 items 1 and 2 pulled forward alongside Phase 1 if
outcome logging matters early. Phase 4 items 1–2 can run in parallel with Phase 1 because
they touch different files.

## 5. Decisions needed from the owner

1. Which seed rows are measured and which are generated?
2. Is a hosted database acceptable (cost, an external dependency)?
3. Stay on Vercel serverless, or move the API to a long-running host?
4. Do accounts ever arrive, or does device-only identity stay?
5. Is the goal this quarter a judged demo, a portfolio piece, or a farmer pilot? It changes
   whether Phase 1 or Phase 4 goes first.
