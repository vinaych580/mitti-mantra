# Phase 1 — Implementation Notes

**Date:** 2026-11-19 · **Branch:** `phase1-data-foundation` · **Spec:** `../specs/2026-11-11-phase1-data-foundation-design.md`

What was built, the acceptance results, and every place it departs from the spec, with the reason.

## Built

| Spec item | Where |
|---|---|
| 1.1 Layout: `data/raw` → `data/staged` → `data/curated` (Parquet, gitignored) → `dataset/serving.sqlite` + pilot CSVs | `pipelines/`, `.gitignore`, `.vercelignore` |
| One command: `python -m pipelines.run download` / `build` / `refresh` | `pipelines/run.py` |
| 1.2 Canonical keys: `district_id` = `"<state LGD>-<district LGD>"`; the 30 `region_id`s map one-to-one and keep working | `pipelines/districts.py`, `reference/pilot_regions.csv` |
| Crop aliases per source (APY, both APMC feeds, cost survey, MSP, irrigation) | `reference/crop_aliases.csv` |
| A1 district yields (DES APY), 1997–2022 | `sources/apy.py` |
| A3 weekly district prices (Agmarknet, two feeds, aggregated on the portal) | `sources/apmc.py` |
| A5 daily weather per district point (NASA POWER), season totals | `sources/nasa_power.py` |
| `weather_stage` (rain, heat, dry spells, GDD per growth stage) and monsoon onset | `pipelines/weather_stage.py` |
| A7 cost of cultivation, state × crop × year, per acre | `sources/costs.py` |
| A8 MSP 1998–2025, sugarcane FRP | `sources/msp.py`, `reference/sugarcane_frp.csv` |
| A11 Soil Health Card: share of tested samples per rating class (replaces the random-valued fetcher, AUDIT D-3) | `sources/soil_health.py` |
| A12 irrigated share of each crop's sown area | `sources/irrigation.py`, `build_curated.py` |
| C1 live daily mandi prices (needs `DATAGOV_API_KEY`; no-op without it) | `sources/agmarknet_live.py` |
| 1.4 Validation gates, including "no synthetic rows" and "rows may not shrink >5%" | `pipelines/validate.py` |
| 1.5 Serving store and reader; provenance from the store | `pipelines/build_serving.py`, `utils/store.py`, `utils/provenance.py` |
| 1.6 Scheduled refresh (daily); store published as a release asset and fetched at deploy | `.github/workflows/data-refresh.yml`, `scripts/fetch_serving_store.cjs`, `vercel.json` |
| 1.8 `GET /api/v1/districts` and `/{id}/yields`, `/prices`, `/weather`, `/soil`, `/irrigation`, `/costs` | `backend/routers/data.py` |
| Retired: `etl_pipeline.py`, `feature_pipeline.py`, `soil_health_card.py`, `refresh_data.py`, `refresh_weather_seed.py`, `dataset/_seed_extra.py` and its generated JSON (AUDIT D-3, D-4) | deleted |
| Tests on recorded fixtures for every source, the gates and the reader (AUDIT D-12) | `tests/test_pipelines.py` (21 tests) |

## Acceptance

| Criterion | Result |
|---|---|
| `build_curated` + `validate` pass from raw | Pass |
| `yield_dcy` ≥ 150,000 rows, ≥ 500 districts, ≥ 25 years | 269,821 rows, 740 districts, 26 years (1997–2022) |
| `price_district_weekly` ≥ 20 crops for ≥ 5 years | 33 crops, all ≥ 5 years (Dec 2020 – May 2026) |
| No `random` in any data-writing module | Pass (the one hit is a cache-sweep timer in `data_ingestion/cache.py`) |
| Served data under 40 MB | `serving.sqlite` 39.4 MB (37.6 MiB) |
| `/api/data-freshness` reports mandi prices under 7 days old | **Not met yet.** Needs `DATAGOV_API_KEY` as a repo secret; see "Still open" |

Curated store at build time: 765 districts (714 with a weather point), 963k district-weeks of prices,
7.7M daily weather rows, 922k growth-stage rows, 18.8k monsoon onsets, 16k soil rows, 107k irrigation
rows, 3.5k cost rows, 504 MSP rows.

## Departures from the spec

1. **Prices come from an India Data Portal mirror of Agmarknet, aggregated on the portal's server**
   to district × week, instead of downloading 4+ GB of daily rows. The weekly price is arrival-weighted,
   falling back to the median where arrivals are missing. The mirror ends in May 2026, so freshness
   depends on the live feed (item 7).
2. **The two Agmarknet feeds spell commodities differently** (`Paddy(Dhan)(Common)` vs `Paddy(Common)`).
   `apmc_commodity_new` in the alias table holds the newer spelling; without it rice and six pulses and
   grains stopped in Oct 2025.
3. **District points.** No LGD centroid table was at hand, so a district's weather point is, in order:
   the app's pilot HQ coordinates, the median of its geocoded mandis, the median of its schools (UDISE+).
   Where both mandi and school points exist they are 13 km apart at the median (61 km at the 95th
   percentile). 51 districts, mostly created since 2019, have no point and no weather.
4. **Soil is reported as shares, not values.** The Soil Health Card mirror publishes counts of samples
   per rating class (Low/Medium/High N, Acidic/Neutral/Alkaline pH...), not lab values, so the table
   holds the share of samples in each class. `dataset/soil.csv` (hand-entered soil types for the pilots)
   is unchanged; SoilGrids (A10) is still to do.
5. **Growth stages use one national sowing date per crop**, the middle of its window in the app's own
   `CROP_CALENDAR`, with stage fractions from `CROP_WATER_STAGES` (read from `engine/features.py` so the
   two cannot drift). State calendars (A14) can replace this per district.
6. **Serving store layout.** To fit 40 MB, serving rows carry a `source_id` into a `provenance` table
   instead of repeating source, licence and fetch time; prices are stored as integer paise; keyed tables
   are `WITHOUT ROWID`. `utils/store.py` returns rupees and the API attaches `sources` to every response.
   The curated Parquet keeps the full columns. (145.6 MB → 39.4 MB.)
7. **The store ships as a GitHub release asset, not in git, and not via Vercel Blob.** Committing a
   37 MB binary that changes daily would add ~12 MB (compressed) to git history per update. Each build
   names the store after its checksum (`serving-<sha16>.sqlite`) and records it under `serving` in
   `pipelines/manifest.json`; the refresh job uploads it to the `data-store` release (last 30 kept) and
   proposes only the CSVs and manifest in one standing PR, `data-refresh/auto`. Vercel's build command,
   `scripts/fetch_serving_store.cjs`, downloads the asset the commit's manifest names and verifies its
   checksum. The repository is private, so the Vercel project needs a `DATA_STORE_TOKEN` environment
   variable (a fine-grained token with read access to this repository's contents). Without it the build
   still succeeds and only `/api/v1/districts` answers 503. Merging the PR deploys; there is no separate
   redeploy hook.
8. **MSP fix.** The old hand-typed `msp_prices.csv` was a year behind for several crops (paddy 2025 at
   ₹2,400; announced ₹2,369) and listed a basmati MSP that does not exist. It is now generated from the
   CACP series.
9. **Rejected, not corrected.** Rows outside physical limits go to `data/curated/rejected_*.parquet` with
   the reason: 831 yields above 3× the crop's base yield, 2,248 weekly prices outside 5× the reference
   band, and 6,281 irrigation rows (5.6%) where irrigated area exceeds sown area by more than 10% (the two
   DES series are compiled separately).

## What the measured data changed in the app

The pilot CSVs the app reads (`yield_history`, `weather`, `mandi_prices`, `msp_prices`) are now
measured. No ranking code changed, but four kinds of test had encoded the seed data:

- **Recommendation goldens** (64 cases) were regenerated deliberately. Yields moved because
  `yield_history` now records the crops each district really grows (the climate guard's "no recorded
  harvest" cap lands on different crops: Patna kharif moong went from 4 to 469 kg/acre, Karnal kharif
  sunflower from 667 to 29) and calibrates the heuristic against real district yields. The yield model
  is still the one trained on seed data; Phase 2 retrains it.
- **Seed-specific examples** (Indore had no rice prices; Medak's 3-year rice area) now use tea, which
  has no mandi series anywhere, and the saturation rule computed from the CSV.
- **Basis checks** now test for unit errors against the other crops instead of against `base_yield`
  directly, because measured district yields average **about half of `base_yield` for every crop**
  (median 0.53). That is a yield gap, not a unit error: `base_yield` is a good-farm potential.
- `weather.csv` `min_temp_c` / `max_temp_c` are now the season's lowest and highest daily values, as the
  data dictionary describes; the seed rows held values closer to typical daily lows and highs.

### Reference-data problems the measured data exposed (owner decision)

| Crop | `crop_parameters.csv` | Measured | Effect |
|---|---|---|---|
| Chilli | base 3,200 kg/acre (a green-chilli yield), price ₹60–140 (dry) | dry chilli 1,168 kg/acre | simulated chilli revenue ~3× too high |
| Mango | base 8,500 kg/acre; price ₹20–40 (farm-gate) | 2,903 kg/acre; mandi median ₹54 (wholesale) | yield far above any district |
| Tobacco | base 650 kg/acre; price ₹130–230 (FCV auction) | 783 kg/acre; mandi median ₹32 (non-FCV) | the reference describes a different product |

These are listed by name in `tests/test_ranking_profitability.py` (`KNOWN_*_BASIS_GAPS`); the tests fail
if a fix lands without removing the crop from the list. Separately, profits shown to farmers are computed
from `base_yield`, about twice the district average; whether to show a typical-farm figure is a Phase 2
and owner decision.

## Still open

- **Vercel token for the store:** while the repository is public, the build downloads the store from
  the public release URL and needs no token. Before making it private again, add `DATA_STORE_TOKEN` to
  the Vercel project (read access to this repository's contents). Either way, check a preview deploy:
  the build log should show the store fetched, and the function size should be well under Vercel's limit.

- **Live prices (acceptance item):** create a data.gov.in API key and add it as the `DATAGOV_API_KEY`
  repo secret (and Vercel env var). The daily job then saves each day's snapshot and the badge can say
  "fresh" within a day.
- **A2 ICRISAT DLD cross-check** (A1 vs A2 within 15%): needs registration on the ICRISAT portal.
- **A13 NDVI:** needs a Google Earth Engine account.
- **A4 IMD gridded rainfall:** the portal also has IMD district daily rainfall (2009 – Apr 2023,
  628 districts), usable as a cross-check on NASA POWER rain.
- **A10 SoilGrids** point values; **A14** state crop calendars.
- The app's models still train on the old pilot CSV shapes; using the full store is Phase 2.
