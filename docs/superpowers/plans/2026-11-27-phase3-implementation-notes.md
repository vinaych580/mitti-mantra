# Phase 3 — Implementation Notes

**Date:** 2026-11-27 · **Branches:** `phase3-protection` (merged, #6), then the second slice below · **Spec:** `../specs/2026-11-11-phase3-architecture-design.md`

Phase 3 is about two weeks of work. This first slice follows the spec's work order and starts with 3.4
(headers and protection), chosen because it can ship without new infrastructure and without changing what any
page does. The other items need decisions or accounts only the owner can make; they are listed at the end.

## Built (3.4, first part)

| Spec item | Where |
|---|---|
| Security headers on every response: `X-Content-Type-Options: nosniff`, `Referrer-Policy: strict-origin-when-cross-origin`, `X-Frame-Options: DENY`, a `Permissions-Policy` that keeps camera, microphone and location for the site itself and switches off payment, USB, serial, Bluetooth, HID and topics | `backend/security.py` (one source), `vercel.json` `headers` for static files, `SecurityHeaders` middleware for the API |
| API responses carry an enforced `Content-Security-Policy: default-src 'none'; frame-ancestors 'none'` (JSON loads nothing). `/docs`, `/redoc`, `/openapi.json` get the page policy because Swagger UI loads from a CDN | `backend/security.py` |
| Page Content-Security-Policy in **report-only** mode, with violation reports sent to `POST /api/v1/csp-report`, which logs one line per report (directive, blocked URL, page; query strings stripped, no body kept) and always answers 204 | `backend/security.py`, `backend/routers/system.py` |
| `/api/_cache/stats` behind `ADMIN_API_KEY` (401 without it, 503 when the key is not configured); the usage summary uses the same check | `backend/main.py` `_require_admin_key` |
| Tests: API and page headers, `vercel.json` matches the module, every external script host in the pages is allowed, reports are logged without query strings, bad reports never fail, admin gate | `tests/test_security_headers.py` |

HSTS is not set: Vercel already sends it for its domains, and a custom domain should set it with that domain's
own decision on `includeSubDomains` and preload.

`/api/ml/status` stays public. It feeds a dashboard panel and returns only relative paths (`ml/models`), not
file-system paths.

## Measured: what the page policy reports

All nine pages were loaded on a local server with the policy in place and a fresh service worker.

- **Fixed in the policy:** the service worker re-fetches fonts, photos and map tiles to cache them, and a
  worker's fetch counts as `connect-src`, so those hosts were added. `site-ui.js` injects speculation rules
  (prefetch on hover) as an inline script, so `'inline-speculation-rules'` was added.
- **Reported in the first slice; moved to files in the second (#7, below):**
  - inline `<script>` blocks: `index.html:92` (headline animation) and `book-a-tractor.html:1172`;
  - inline event handlers (`script-src-attr`): one each in `marketplace.html`, `gyan-seva.html` and
    `book-a-tractor.html`, plus handlers built in JS at `marketplace.js:649`, `book-a-tractor.js:514`,
    `map-tractors.js:141`, and the "See an optimal multi-crop mix" link in `dashboard.js` (TOOL 1);
  - `style-src` keeps `'unsafe-inline'`: inline `style=` attributes are everywhere and moving them is a
    Phase 4 (UI) job, not this one.
- A service worker keeps the policy it was installed with. Returning visitors pick the new one up when `sw.js`
  next changes; that does not matter while the policy is report-only.

## Second slice (2026-11-27): one pull request per piece, all off `master`

| PR | Branch | What |
|---|---|---|
| [#7](https://github.com/vinaych580/mitti-mantra/pull/7) | `phase3-csp-inline` | Inline scripts and handlers moved out of the pages (CSP prep) |
| [#8](https://github.com/vinaych580/mitti-mantra/pull/8) | `phase3-observability` | 3.6 without vendors: `/api/v1/system/health`, `/api/v1/system/version`, JSON request logs |
| [#9](https://github.com/vinaych580/mitti-mantra/pull/9) | `phase3-limits` | 3.4 rest: request body limits, bounded request models, `pip-audit` CI job |
| [#10](https://github.com/vinaych580/mitti-mantra/pull/10) | `phase3-satellite-import` | Fix: the cold-start import deadlock behind `/api/satellite`'s 500 |

All five were tested together first (merged locally on one branch: full suite including slow tests, 488
passed), then merged on the owner's go-ahead in the order #7, #10, #8, #9, #11, checking production after each.

### #7 Inline code out of the pages

- `index.html` headline animation → `frontend/hero-title.js`, still a plain synchronous `<script src>` right after
  the headline, so the words are split before first paint (the reason it was inline).
- `book-a-tractor.html` waitlist script and `onsubmit` → `frontend/tractor-waitlist.js`, synchronous, same place.
- `gyan-seva.html` `onsubmit="return false;"` → a submit listener in `gyan-seva.js`.
- `marketplace.html` hero Search `onclick` → a click listener in `marketplace.js`.
- Image `onerror` fallbacks built in `book-a-tractor.js`, `map-tractors.js`, `marketplace.js` →
  `data-img-fallback="tractor"`/`"icon"` and one capturing `error` listener per page (image errors don't bubble).
- `map-tractors.js` "Book Now" in popups and the nearby list → `data-book-tractor` + delegated listeners; the list
  button still stops the click from panning the map.
- `dashboard.js` links to the Mix and Irrigation tools (two, not one: the irrigation-schedule link in the crop
  calendar's "no data" notice had the same pattern) → `data-goto-tool` + one delegated listener.
- `sw.js` → `mittimantra-v66`. New tests fail on any inline `<script>`, `on*=` handler (also inside JS template
  strings) or `javascript:` URL in `frontend/`.
- **Measured:** all nine pages on a local server with a fresh service worker: **zero** CSP reports. A deliberately
  injected inline handler did produce a report, so the reporting path works. Each moved handler was exercised; the
  Vercel preview serves the new files, `sw.js` v66 and the report-only header.
- **The policy stays report-only.** Enforcing it is the owner's call after a few days of clean production reports
  (`vercel logs`, search for `csp-violation`). To enforce: rename the header to `Content-Security-Policy` in
  `backend/security.py` and `vercel.json` (a test keeps them equal). `style-src 'unsafe-inline'` stays until the
  inline `style=` attributes move (Phase 4).

### #8 Health, version, request logs (3.6 without vendors)

- `GET /api/v1/system/health`: the serving store opens, has districts and matches the size in
  `pipelines/manifest.json`; `ml.yield_anomaly.load()` and `ml.price_model.load()` return models. 200 `ok` / 503
  `degraded`, timing per check, `no-store`. No database check until 3.1.
- `GET /api/v1/system/version`: commit (`VERCEL_GIT_COMMIT_SHA`), `VERCEL_ENV`, sha256 of `pipelines/manifest.json`
  (line endings normalised) and the serving store it names, and per-model version / code commit / training-data
  hash from `ml/models/*/metrics.json`.
- `backend/observability.py` `RequestLog`: a pure ASGI middleware, outermost, writing one JSON line per request to
  stdout: `request_id` (Vercel's `x-vercel-id`, or a safe `X-Request-ID`, else generated; echoed back), `method`,
  `route` template, `status`, `duration_ms`, `commit`, `data`, `models`. Never bodies, query strings or other headers.
- **Measured on the preview:** version shows the deploy's commit and the same data hash as locally; health 200 with
  765 districts and both models loaded; `vercel logs --json` shows one JSON line per request.
- Found: FastAPI 0.139 keeps an included router's routes un-prefixed in `scope["route"]`, so the middleware rebuilds
  the prefix from the path. And Vercel rejects a deployment outright, before building, when a function's
  `includeFiles` is over 256 characters; the first push hit that. `pipelines/manifest.json` ships anyway
  (`.vercelignore` un-ignores it), and a test keeps the globs under the cap.

### #9 Body limits, bounded models, pip-audit (3.4 rest)

- `BodySizeLimit` (ASGI, inside `SecurityHeaders`): 413 over 256 KiB; `/api/disease/predict` 11 MiB and
  `/api/sensors/upload` 5 MiB, matching what their models allow (Vercel caps at 4.5 MB anyway). Chunked bodies are
  read up to the limit and replayed.
- Request models: ids ≤ 100 characters, soil/weather/input dicts ≤ 100 keys, compare-strategies ≤ 20, batch-simulate
  ≤ 100 crops, chat message ≤ 2,000 characters and context ≤ 50 keys. **`/api/soil-projection` `years` is now 1–50
  and `rotation` ≤ 20 steps**: an unbounded `years` kept a function busy until its 30 s timeout.
- `pip-audit` CI job, report-only (job summary + warning; make it blocking by changing its final `exit 0`).
  **Measured:** no known vulnerabilities in `requirements.txt` on 2026-11-27.

### #10 `/api/satellite` 500 on a cold server

- Cause, reproduced: `data_ingestion/__init__` imports every fetcher; two request threads importing fetcher
  submodules at once each hold one module lock and wait for the other's → `_DeadlockError`. Three threads in a fresh
  process: **30 failures in 30 runs**. `/api/satellite` imported outside its try, so it answered 500; the IMD import
  in `/api/weather/{region_id}` and the provenance panel's mandi import had the same exposure.
- Fix: `utils/lazy_import.fetcher()` serialises those imports (an eager import at startup would add ~185 ms to every
  cold start; `backend.main` imports in ~610 ms). After: **30 clean runs in 30**. `/api/satellite` imports inside
  its try and is a plain `def`, so its blocking Earth Engine calls leave the event loop.

### Found after merging #7: `frontend/Data/` missing from production since Phase 1 (#12)

Checking production after the first merge showed `Data/tractors.js` 404, and with it `Data/consultants.js`,
`Data/marketplace-listings.js` and `Data/india-states.geo.json`. Book a Tractor showed no tractors, Gyan Seva no
consultants, Marketplace no demo listings, and the service worker (which precaches two of them) could not install.
Cause: Phase 1 added an unanchored `data/` to `.vercelignore` for the root pipeline folder, and Vercel matches
ignore patterns case-insensitively. Deploys: 200 before Phase 1 (4c78fe3), 404 from the Phase 1 merge (319dd5b)
on. [#12](https://github.com/vinaych580/mitti-mantra/pull/12) anchors it as `/data/` and adds
`tests/test_vercelignore.py`, which applies the ignore rules to every tracked frontend file. Checked on its preview:
all four files 200, API unaffected.

## Still not done, and why

| Spec item | Status |
|---|---|
| 3.4 enforce the page CSP | **Owner decision**, after a few days of clean `csp-violation` logs in production once #7 is live. |
| 3.4 rate limiting backed by a database or Vercel KV | Needs the 3.1 database or a KV store (an account). The per-IP in-process limits on commit-crop and disease scan stay. |
| 3.4 secret scanning | **Owner:** a GitHub repository setting (Settings → Code security → secret scanning and push protection). |
| 3.1 persistent storage (Postgres) | **Owner decision:** create the Neon (or other) database through the Vercel Marketplace. The driver (psycopg vs an HTTP driver) follows from the provider. |
| 3.5 identity (SMS), 3.6 error tracking | **Owner decisions:** SMS provider; error-tracking vendor (the spec defaults to Sentry's free tier). |
| 3.6 daily production check (a scheduled Action calling health + the eight ranking cases) | Next, now that `/api/v1/system/health` exists; it needs only a workflow file. |
| 3.6 usage counts moved to Postgres | Waits for 3.1. |
| 3.2 routers, 3.3 `/api/v1` contract | Plan below; **not started**, needs the owner's go-ahead. |
| 3.7 frontend modules, 3.8, 3.9 | Later, in the spec's order. |

## Proposed plan for 3.2 and 3.3 (not started)

`backend/main.py` is 2,075 lines with 55 routes; request models live in `backend/models.py`, plus
`routers/data.py` (Phase 1 district store and legacy reference data), `routers/system.py` and `season_routes.py`.

**3.2: move routes out of `main.py`, nothing else changes.**

1. First PR: a snapshot test. Dump `app.openapi()` to `tests/fixtures/openapi.json` and assert it is unchanged
   (paths, methods, parameters, schemas), plus a list of the routes OpenAPI does not show (frontend file routes,
   the static mount). Every later 3.2 PR must leave the snapshot equal.
2. One PR per router, smallest first, each a pure move with imports updated:
   `system` (health, cache stats, usage, ml status/train) → `chat` → `field` (ndvi, farm-score, climate, carbon,
   iot, sensors) → `market` (mandi, msp, price forecast/analytics, arbitrage, sell advisor) → `advisory`
   (fertilizer, irrigation, pest, calendar, schemes, disease) → `planning` (recommend, crop, profit, simulate,
   compare, batch, optimal mix, rotation, loan, soil projection, benchmark, commit-crop, expense).
   Shared helpers (`_require_admin_key`, the rate limiter) move to `backend/deps.py` in the first PR that needs them.
3. Last 3.2 PR: `main.py` keeps app creation, middleware, router includes and the frontend mount (< 150 lines).
4. The `ml/predict.py` split (`ml/inference.py`, `services/recommend.py`, `services/economics.py`,
   `store/reference.py`) is a separate series after the routers, pinned by the existing ranking tests and the
   snapshot.
5. **Spec correction:** the spec says to delete `routers/data.py`. Since Phase 1 it also holds the
   `/api/v1/districts/*` routes the dashboard uses; only its legacy duplicates (`/api/crops`, `/api/soil`,
   `/api/weather`, …) are candidates, and only after checking the frontend no longer calls them.

**3.3: the `/api/v1` contract, after 3.2.**

1. Mount every router under `/api/v1` as well; old paths stay as aliases for one release with a `Deprecation`
   header and a `Link` to the new path. The snapshot then diffs to exactly "same operations, new prefix".
2. Move the frontend to `/api/v1` one page per PR (the `api()` helpers in `dashboard.js` and `decide.js` first),
   with `sw.js` bumps.
3. Then the behavioural changes, each its own PR with tests: one error shape `{code, message, field?}`;
   `inputs_resolved` on advisory routes; a missing `crop_id` → 422 instead of a silent default.
4. Contract tests generated from OpenAPI (schemathesis) in CI, report-only first; `docs/API.md` generated from
   OpenAPI.

Each step is a few hours and can be reverted on its own; none should land in the week of a demo.

## Fixes after Phase 3 (2026-11-27, owner's go-ahead)

The owner asked for: sell advice perishability, turmeric input cost, the daily production check, both profit
figures (district average and good farm; the shortlist rule stays), and a sweep for bugs not yet reported.
The CSP stays report-only for now.

| PR | What |
|---|---|
| [#13](https://github.com/vinaych580/mitti-mantra/pull/13) | Sell advice never holds a crop longer than it keeps (`engine/storability.py`): Sehore tomato was "hold 26 weeks", now "sell now"; the chatbot drops the "best month" for a crop that cannot wait for it |
| [#14](https://github.com/vinaych580/mitti-mantra/pull/14) | `good_farm` profit beside the district average (Medak rice ₹85,869 typical vs ₹1,36,932 good farm); the dashboard no longer shows a total loss as "TOP PICK" |
| [#15](https://github.com/vinaych580/mitti-mantra/pull/15) | Daily production check (health, version, pages, `frontend/Data/`, the eight defect-register ranking cases); opens an issue on failure |
| [#16](https://github.com/vinaych580/mitti-mantra/pull/16) | Chatbot: typical budget when none is given (was a flat ₹15,000); "3 acres 20000 budget" no longer swaps the numbers |

#13 and #14 both bump `sw.js` to v67 and append to the hi/te catalogs: the second to merge needs a rebase and v68.

### Turmeric input cost: the cost is not the problem

The Phase 2 notes suspected turmeric's ₹68,000/acre (342% ROI in Medak). No cost survey in the store covers
turmeric (CACP covers principal crops only), so the check used a published farm survey:

- Guntur, Andhra Pradesh, 2017–18, 120 farms (Kumar et al., *J. Pharmacognosy and Phytochemistry* 7(3):
  2596–2599, Tables 4.1–4.3): total cost of cultivation (Cost C) ₹1,39,095/ha = **₹56,290/acre**; Cost A2 +
  family labour ₹1,29,095/ha = ₹52,240/acre; cured yield 53 q/ha (2,148 kg/acre); price ₹65/kg.
- The other crops' costs in `crop_parameters.csv` sit at the CACP 2020–21 level (rice ₹27,000 against AP's 2021
  A2+FL ₹29,258). Four years of cost growth from 2017–18 puts turmeric at roughly ₹63,000–68,000 on that basis:
  **₹68,000 is consistent.**
- The 342% comes from Medak's recorded yield (2,914 kg/acre, 36% above the Guntur survey) at the recent mandi
  price (₹106/kg, against ₹65 in 2017–18).

So nothing was changed for turmeric. The real issue is general: **costs are on a 2021 basis and prices on a
2025–26 basis for every crop**, which flatters every ROI a little and turmeric (whose price rose most) a lot.
Re-basing all costs (for example by CACP's latest cost index, when it is in the store) is an owner decision and a
model change; not done the night before a presentation. Farmer-reported figures quoted in the press (₹85,000 to
₹1.2 lakh/acre) include costs the CACP basis leaves out.

### Bug sweep

Probed on production: every GET route in OpenAPI (60 of 62 return 200; the other two are the intentionally
disabled expense and usage routes), the main POST routes with realistic bodies, all nine pages for failed
requests and console errors, horizontal overflow at 375 px, and the open defect-register items.

Found and fixed:
- **`frontend/Data/` 404 on production since Phase 1** (#12, merged): tractors, consultants, marketplace
  listings and the India map; the service worker could not install.
- **Dashboard showed a total loss as "TOP PICK"** (Medak zaid, banana −₹1,00,000, with "I'm planting this"
  and a sell link), ignoring `all_options_lose` (#14).
- **Chatbot sell advice** kept "best month 7, +153%" for tomato (#13).
- **Chatbot default budget** ₹15,000/acre and **"3 acres 20000 budget" parsed as ₹3 on 20,000 acres** (#16).

Checked and fine: no page scrolls horizontally at 375 px; no failed requests on any page; N-13, N-18, N-19,
N-20, N-30, N-31 fixed earlier. Still open from the register: N-23 (climate alerts and carbon credits default
the crop to wheat, and the dashboard itself sends wheat as its fallback: a 3.3 contract item), N-12 (Kannada and
Tamil lack 70-odd newer strings; CI warns, hi/te are complete), N-22 (a few naive `datetime.now()` calls, all at
date resolution).

## Owner checklist (from all sessions)

- Before the repo goes private: add `DATA_STORE_TOKEN` in Vercel; revoke the Vercel protection-bypass secrets that
  `vercel curl` added (Deployment Protection settings).
- Enforce the page CSP after clean production reports (see #7).
- Choose: Postgres provider (3.1), SMS provider (3.5), error-tracking vendor (3.6); turn on GitHub secret scanning.
- Phase 2 product questions, settled 2026-11-27: both profit figures shown (#14); the shortlist rule stays;
  turmeric's cost is consistent with a published survey (above); sell advice respects perishability (#13).
- New: costs (2021 basis) and prices (2025–26) are on different years for every crop; decide whether to re-base
  costs. Review the storage weeks in `engine/storability.py`.
