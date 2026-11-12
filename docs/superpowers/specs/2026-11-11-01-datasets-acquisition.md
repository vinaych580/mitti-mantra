# Datasets — What Is Needed and What To Download

**Date:** 2026-11-11
**Feeds:** Phase 1 (data foundation) and Phase 2 (models).

**How to read the "Checked" column.** "Yes" means a web search on 2026-11-11 confirmed the
source exists and roughly what it contains. "No" means the entry comes from prior
knowledge and must be confirmed before anyone depends on it. No licence has been read in
full; read each one before redistributing data in the repo.

**Rule for the repo.** Raw downloads are never committed. They live in `data/raw/`
(gitignored). Only the small curated tables the app serves are committed or bundled.

---

## A. Download once (bulk history)

| # | Dataset | Why it is needed | Where to get it | Checked | Licence note | Rough size | Priority |
|---|---|---|---|---|---|---|---|
| A1 | **DES Area, Production, Yield (APY), district level** | Real yield history, 1997-98 onward, every district, crop and season. Replaces the random yield rows (N-5). | Primary: `data.desagri.gov.in/website/crops-apy-report-web` (also `aps.dac.gov.in/APY/Public_Report1.aspx`). Easier mirrors: India Data Portal "Area, Production, Yield (APY)"; Dataful. | Yes | Government open data; confirm on the mirror used | ~50–150 MB CSV | **P0** |
| A2 | **ICRISAT District Level Database (DLD)** | Longer history (1966 onward), consistent district boundaries ("apportioned"), plus irrigated area, fertiliser use and rainfall per district. Cross-check for A1. | ICRISAT DLD portal (`data.icrisat.org/dld`); registration may be required | Yes (existence, coverage ~571–592 districts in 20 states) | Research use; read terms | ~100 MB | **P0** |
| A3 | **Agmarknet daily prices and arrivals, history** | Daily modal/min/max price and arrivals per mandi. Makes a price model possible; today there is only a monthly seed. | CEDA Ashoka Agmarknet portal (`agmarknet.ceda.ashoka.edu.in`) raw downloads; India Data Portal "APMC arrivals and prices" (2019–2025, about 3.9 GB) | Yes | CEDA has its own API terms; India Data Portal lists ODC Attribution | 4–10 GB raw; < 100 MB after filtering to our crops and weekly aggregation | **P0** |
| A4 | **IMD gridded daily rainfall 0.25°, and temperature 1°/0.5°** | Official daily rain since 1901. Needed for stage-wise rainfall, dry spells, monsoon onset. | Python package `imdlib` (`imd.get_data('rain', start_yr, end_yr)`) | Yes | IMD data policy; non-commercial research use is the usual condition | ~20 MB per year of rain | **P0** |
| A5 | **NASA POWER daily, per district centroid** | Solar radiation, humidity, wind, temperature for evapotranspiration and heat stress. Fetcher already exists. | `power.larc.nasa.gov/api/temporal/daily/point` with `community=AG` | Yes (endpoint shape; max 20 parameters per call) | Open | ~2 MB per district for 25 years | **P0** |
| A6 | **CHIRPS daily rainfall** | Independent rainfall source to cross-check IMD in gaps. | UCSB Climate Hazards Center (`chc.ucsb.edu/data/chirps`) | No | Believed open | Large; subset to India | P2 |
| A7 | **Cost of Cultivation (DES / CACP)** | State-by-crop input cost and its breakdown. Replaces hand-set `avg_input_cost_inr_per_acre` and fixes the budget default (N-7). | DES site cost-of-cultivation section; India Data Portal "Cost of Cultivation"; Dataful dataset 484 (state level, five major states per crop) | Yes (mirrors); the DES archive page showed no files when checked | Government open data | < 20 MB | **P0** |
| A8 | **MSP history (CACP)** | Full MSP series per crop and year; current file holds two years. | CACP price-policy reports; PIB releases | No | Government | < 1 MB, hand-curated | P1 |
| A9 | **District boundaries and LGD codes** | One canonical district key so every source joins; boundaries for "use my location" and map layers. | Local Government Directory (`lgdirectory.gov.in`) for codes; DataMeet `maps` repo for shapes | No | LGD government; DataMeet believed CC-BY | ~30 MB shapes, simplified to < 2 MB | **P0** |
| A10 | **SoilGrids v2 at district centroids and on a grid** | Soil pH, organic carbon, texture, nitrogen for every district, not just 30. Fetcher exists. | ISRIC SoilGrids REST / WCS | No (fetcher works per README) | CC-BY 4.0 believed | < 10 MB tabular | P1 |
| A11 | **Soil Health Card district summaries** | Measured N-P-K and micronutrient status. Replaces the fabricated values in `soil_health_card.py` (AUDIT D-3). | `soilhealth.dac.gov.in`; no bulk API confirmed | No | Government | small | P2 |
| A12 | **Crop-wise irrigated area (Land Use Statistics)** | Share of each crop that is irrigated per district; turns "irrigation level" into a real feature. | India Data Portal "Land Use Statistics → Crop Wise Irrigated Area" | Yes (listing) | Government open data | < 50 MB | P1 |
| A13 | **NDVI time series (MODIS MOD13Q1 250 m, 16-day)** | In-season crop condition per district; the strongest yield predictor after rainfall. | Google Earth Engine (stub fetcher exists) or NASA AppEEARS | No | Open | district means: < 50 MB | P1 |
| A14 | **Crop calendars by state** | Sowing and harvest windows per state and crop; needed to cut weather into growth stages. | State agriculture departments, ICAR, NFSM publications | No | Government | hand-curated, < 1 MB | P1 |
| A15 | **Mandi directory with coordinates** | Distance from a farm to each mandi for the net-of-transport comparison. | Agmarknet market directory; CEDA includes market metadata | No | — | < 1 MB | P2 |

## B. Disease images (download once)

| # | Dataset | Why | Where | Checked | Licence note | Size | Priority |
|---|---|---|---|---|---|---|---|
| B1 | **PlantVillage (full, ~54,000 images, 38 classes)** | Current model uses a 432-image sample of it. | `github.com/spMohanty/PlantVillage-Dataset` | No (well known) | Believed CC0 / CC-BY-SA depending on mirror | ~2 GB | **P0** |
| B2 | **PlantDoc (2,598 field images, 13 species)** | Real field conditions; the honest test set. | `github.com/pratikkayal/PlantDoc-Dataset` | Yes | CC BY 4.0 | ~1 GB | **P0** |
| B3 | **Paddy Doctor (16,225 field images, 13 classes)** | Rice is the most-grown crop here and the model has no rice class. | `paddydoc.github.io`; IEEE DataPort | Yes | Unclear from search; confirm | ~1–3 GB | **P0** |
| B4 | **Rice Leaf Disease Image Samples (5,932 images, 4 classes)** | Extra rice coverage. | Mendeley Data `fwcj7stb8r` | Yes | Mendeley, usually CC BY 4.0; confirm | < 1 GB | P1 |
| B5 | **Wheat leaf disease set** | Wheat has no class today. | Not found in this search; candidates on Kaggle and Mendeley need checking | No | — | — | P1 |
| B6 | **Cotton leaf disease set** | Cotton is a headline crop for the Telangana persona. | Not found in this search; candidates need checking | No | — | — | P1 |
| B7 | **Negative set ("not a leaf")** | Lets the model abstain on photos of soil, hands, sky. | A few thousand open-licence everyday photos | No | — | < 1 GB | P1 |

## C. Fetch on a schedule (never bulk-stored in git)

| # | Feed | Cadence | Where | Checked | Note |
|---|---|---|---|---|---|
| C1 | **Daily mandi prices** | daily | data.gov.in "Variety-wise Daily Market Prices Data of Commodity"; Agmarknet 2.0 portal (relaunched November 2025) | Partly | The resource id hardcoded in `agmarknet.py` (`9ef84268-…`) showed "API does not exist" on its page. Confirm with a real key, and switch to the variety-wise resource or CEDA if it is gone. |
| C2 | **16-day weather forecast** | daily | Open-Meteo forecast API | Yes | Free for non-commercial use; about 10,000 calls a day |
| C3 | **Recent weather actuals** | weekly | Open-Meteo archive API (ERA5, ~5-day lag); already used by `refresh_weather_seed.py` | Yes | Same terms |
| C4 | **NDVI latest composite** | every 16 days | Earth Engine | No | Needs a service account |
| C5 | **MSP announcements** | twice a year | CACP / PIB | No | Manual update with a test that fails if the newest year is older than 14 months |
| C6 | **Scheme details and PMFBY premium rates** | twice a year | scheme portals | No | Manual; existing `test_schemes_data.py` guards shape |

## D. Data only this product can create

| # | Dataset | How it is collected | Why it matters |
|---|---|---|---|
| D1 | Recommendation shown, crop chosen, inputs used | already logged by `/api/commit-crop`; needs durable storage (Phase 3) | Shows what farmers pick over what was ranked first |
| D2 | Harvest outcome: actual yield, sale price, sale date | new form in "My season" (Phase 5) | The only way to validate predictions; format already defined by `ml/season_evidence.py` |
| D3 | Field leaf photos with a confirmed label | opt-in from the disease tool, reviewed before use | Field test set nobody else has |
| D4 | Expense entries | existing client-side ledger, synced once storage exists | Real input costs per crop and district |

## E. What to stop using

| File | Action |
|---|---|
| `dataset/_seed_extra.py` output rows | Mark `is_synthetic=true` immediately; delete each row once a measured row with the same key exists. |
| `data_ingestion/fetchers/soil_health_card.py` random nutrients | Remove the generator; return "not available" until A11 lands. |
| Monthly `mandi_prices.csv` | Keep as the offline fallback only, regenerated from A3 monthly means. |

## Target sizes after Phase 1

| Curated table | Today | Target |
|---|---|---|
| District-crop-year yields | 565 rows, 3 years, 30 districts | 150,000+ rows, 25+ years, 500+ districts |
| Weather | 390 season rows | daily series per district, 25+ years |
| Prices | 2,868 monthly rows | weekly series per mandi-crop, 5+ years |
| Disease images | 539 | 60,000+ train, field-only test set of 3,000+ |

## Download order

1. A9 district keys (everything joins on them).
2. A1 and A2 yields.
3. A4 and A5 weather.
4. A3 prices.
5. A7 costs.
6. B1–B3 images.
7. A10, A12, A13, A14.
8. The rest.

## Open risks

- A3 is large and its history may start around 2013, not 2010.
- IMD and Open-Meteo terms are non-commercial. That fits a portfolio project; it would
  need revisiting before any paid use.
- District boundaries changed many times; Telangana districts were split in 2016. Use
  ICRISAT's apportioned series or map new districts to their parents.
- Wheat and cotton image sets are unconfirmed. If none has a usable licence, those crops
  stay on the rule-based screen and the UI says so.
