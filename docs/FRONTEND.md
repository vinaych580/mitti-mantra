# Frontend Guide

The frontend is a **zero-build** static site. Every `.js` file is loaded
as a `<script defer>`. There is no bundler, no TypeScript, no npm.

Styling is a **hand-written design system** in `frontend/style.css`
(~110 KB of plain CSS custom properties and component classes). There is
no Tailwind, no CSS framework, and no CSS build step — the only remote
stylesheet is the Google Fonts link for Fraunces + Inter.

## Pages

| File | Role |
|---|---|
| `index.html` | Landing page — hero, features, 3D India globe, on-page demo recommender |
| `dashboard.html` | 22-tool dashboard — the main application |
| `marketplace.html` | Buy/sell produce, pool orders, nearby demand, farmer credit profile |
| `gyan-seva.html` | Expert consultation — consultant directory, ranking, booking, AI pre-screening, second opinions |
| `book-a-tractor.html` | Tractor catalogue, spec comparison, nearby-tractor map, bookings, owner listings, demand intelligence |
| `farm-boundary.html` | Draw-a-polygon tool backed by Leaflet + SoilGrids |
| `login.html` | Sign-in shell. **Authentication is removed** — `auth.js` is a no-op stub, so this page cannot actually sign anyone in |

FastAPI also serves extensionless aliases for these
(`/dashboard`, `/marketplace`, `/gyan-seva`, `/book-a-tractor`,
`/farm-boundary`, `/login`, plus `/book-consultation` and
`/book-a-consultation`), so links can omit the `.html`.

## Script layering (load order)

All scripts use `defer`, so they execute after HTML parsing in declaration
order. The ordering rules that matter:

- `mm-core.js` must load **before** `dashboard.js` — it bootstraps the
  Farm Profile bar that the tools auto-fill from.
- `mm-analytics.js`, `mm-freshness.js` and `mm-plots.js` must load
  **after** `mm-core.js` — they extend the `window.MM` namespace.
- `mm-plots.js` also needs `farm-state.js` loaded first.
- `mm-enhance.js` loads **after** `dashboard.js` so it can observe its
  rendered output.
- `i18n-data.js` must load **before** `i18n.js` — it supplies the catalog.
- The `Data/*.js` catalogs must load **before** the page module that reads
  them (`marketplace.js`, `gyan-seva.js`, `book-a-tractor.js`).

Load order is now per-page rather than one global chain:

| Page | CDN | Local scripts, in order |
|---|---|---|
| `index.html` | three.js | `mm-core` · `mm-analytics` · `mm-freshness` · `site-ui` · `state-data` · `india-globe` · `demo-recommender` · `i18n-data` · `i18n` · `toolbar` · `chatbot` |
| `dashboard.html` | leaflet, chart.js | `mm-core` · `mm-analytics` · `mm-freshness` · `site-ui` · `offline-simulator` · `farm-state` · `mm-plots` · `dashboard` · `mm-enhance` · `i18n-data` · `i18n` · `toolbar` · `chatbot` |
| `marketplace.html` | chart.js, leaflet | `mm-core` · `site-ui` · `farm-state` · `toolbar` · `Data/marketplace-listings` · `marketplace` |
| `gyan-seva.html` | — | `mm-core` · `site-ui` · `state-data` · `farm-state` · `Data/consultants` · `i18n-data` · `i18n` · `gyan-seva` |
| `book-a-tractor.html` | leaflet | `mm-core` · `site-ui` · `farm-state` · `Data/tractors` · `i18n-data` · `i18n` · `book-a-tractor` · `map-tractors` |
| `farm-boundary.html` | leaflet, leaflet-draw, turf | `site-ui` · `farm-state` · `farm-boundary` · `i18n-data` · `i18n` · `toolbar` |
| `login.html` | firebase-app-compat, firebase-auth-compat | `firebase-config` · `auth` |

Note that `farm-boundary.html` deliberately does **not** load `mm-core.js`,
and only `index.html` / `dashboard.html` load the chatbot. `marketplace.html`
is now the only page besides `login.html` without the i18n pair.

## Module responsibilities

### `mm-core.js` — the cross-page utility layer

Exposes a single `window.MM` namespace
(`{ fmt, profile, units, a11y, share, toast, escapeHtml }`):

```js
MM.fmt.inr(120000)        // "₹1.20 L"
MM.fmt.weight(3400)       // "3,400 kg" (or "34 q" if unit = quintal)
MM.profile.get()          // { region_id, season, area_acres, budget_per_acre, crop_id }
MM.profile.set({ ... })   // persists + fires 'mm:profile-changed' + auto-fills forms
MM.share.whatsapp(text)
MM.share.print()
MM.toast("Saved")
```

Also owns:

- **Farm Profile bar** — auto-injected on the dashboard (`.dashx__wrap`).
  Fills every form field named like a profile key (`region_id`, `season`,
  `area_acres`, `budget_per_acre`, `crop_id`).
- **Deep-linking** — `/dashboard.html?tool=simulate&region_id=mh_pune&crop_id=cotton`
  activates that tool and applies the profile.
- **Tools menu** (bottom-left ⋮) — WhatsApp share, print/PDF, copy link,
  high-contrast, large-text, PWA install prompt.
- **Unit toggle** — acre/hectare and kg/quintal, persisted in `localStorage`.
- **Print stylesheet** — hides nav, sidebar, chat, tools menu, form
  submit buttons.

### `dashboard.js` — the 22 tools

Each tool is a section in `dashboard.html` with:

- `<form data-form="tool-name">` — user inputs.
- `<div class="output" data-out="tool-name"></div>` — result target.

Tool groups (the left sidebar in `dashboard.html`):

| Group | Tools |
|---|---|
| Overview | My farm · Farm score |
| Plan | Smart recommend · Compare crops · Yield & profit simulate · Optimal mix · Rotation planner · Strategy templates |
| Market | Price forecast · Sell advisor · MSP comparison · Cross-mandi arbitrage |
| Field | Crop calendar · Irrigation · Smart IoT pump · Fertilizer |
| Crop health | Pest alerts · Disease screening · Satellite NDVI |
| Finance | Loan feasibility · Season ledger · Govt. schemes · Carbon credits |
| System | ML status |

ML status reads `/api/ml/status`, which returns `manifest.json` (models in
use), `audit_metrics.json` (holdout metrics, including the crop-recommendation
confusion matrix and per-crop precision/recall written by
`ml/audit_models.py`) and `validation_report.json` (end-to-end scenario checks).

Expense tracker (`data-tool="expense"`) is the one tool with no backend
call at all: entries are stored in `localStorage` (`mm_expenses`), scoped
to the browser. `/api/expense/*` is disabled server-side (see
`docs/API.md`) because the old shared-file store had no tenant isolation.

### `mm-enhance.js` — non-invasive UX layer

Uses a `MutationObserver` on every `.output[data-out]` container. When
`dashboard.js` renders results it:

- Adds a **"Why this crop?"** `<details>` drawer to each recommendation row with a bar chart of factors (smart score, yield, ROI, inverse risk).
- Converts the bare `XX/100` risk number into a coloured **gauge** with Low/Moderate/High tag.
- Appends a **"Data as of · Source"** footer disclosing provenance (crop parameters, mandi prices from agmarknet-compatible CSV, MSP from CACP, etc.).

### `mm-analytics.js` — local-first usage counters

Privacy-respecting instrumentation so the team can tell which of the 22
tools people actually open. By construction it records **no** user ids,
session ids, fingerprints, cookies, free text, form values, region/crop/farm
data, URLs or referrers — only integer counters keyed by a lowercase
snake_case event name, stored in `localStorage` on the user's device.

```js
MM.track('tool_open_recommend')
MM.analytics.summary()      // { total, events: [{event, count}], since }
MM.analytics.isEnabled()    // local counting, default ON
MM.analytics.isSharing()    // upload opt-in, default OFF
MM.analytics.reset()
```

Counts are shown back to the user ("your most used tools") and are only
uploaded to `POST /api/usage/collect` if the user opts in **and** the server
has `ENABLE_USAGE_COLLECTION=true`. Load after `mm-core.js`.

### `mm-freshness.js` — data provenance badge

Reads `GET /api/data-freshness` and renders a compact pill —
**Live data / Aging data / Stale data** — that expands into a per-source
breakdown. This exists because without a `DATAGOV_API_KEY` the mandi prices
silently fall back to a seed CSV that can be a year old, and the UI used to
present that exactly like a live quote.

Mounts into any `[data-mm-freshness]` element, otherwise auto-injects on
dashboard pages left of the Tools FAB. The report is cached in
`sessionStorage` for 5 minutes. Public API: `MM.freshness.get()` and
`MM.freshness.render(el)`. Load after `mm-core.js`.

### `farm-state.js` — the drawn-farm store

`window.FarmState` is the single source of truth for the user's plots,
persisted in `localStorage`.

```js
FarmState.load() / .save(farm) / .clear()
FarmState.list() / .add(farm, name) / .remove(id) / .rename(id, name)
FarmState.setActive(id) / .getActiveId() / .count() / .isActive()
FarmState.getNearestRegionId([lon, lat])   // offline Euclidean match, always resolves
FarmState.reverseGeocode(lat, lon)          // Nominatim; best-effort, nulls on failure
FarmState.REGION_CENTROIDS                  // [{region_id, lat, lon, state, displayName}, …]
```

Two details worth knowing:

- **Multi-plot.** Most farmers work several scattered plots with different
  soil, so the store holds `{ activeId, plots: [...] }`. `load()`/`save()`
  read and write the *active* plot, so older single-farm callers keep
  working unchanged. A legacy single farm — and the legacy `agrisim_farm`
  key — are migrated into plot #1 on first load.
- **`getNearestRegionId` is pure math** against all 30 backend `region_id`
  centroids. It never needs the network.

### `mm-plots.js` — plot switcher

Injects a plot selector into the `.mm-farm-bar` so switching plots
re-points every tool at once: picking a plot makes it active in
`FarmState` and pushes its region and area into `MM.profile`, which the
tools already auto-fill from. Polls for the farm bar (built after an async
`/api/regions` call) for up to 6 s. Load after `mm-core.js` and
`farm-state.js`.

### `offline-simulator.js`

A stripped-down JavaScript port of `engine/simulator.py` so the dashboard's
Simulate tool keeps working when the FastAPI backend is unreachable (demo
mode, poor connectivity). Exposes `window.AgriSimOffline` with
`simulate(body)` — same response shape as `POST /api/simulate` — and
`recommend(body)` for a simple top-3. It carries its own hard-coded table
of 10 representative crops tuned to roughly match
`dataset/crop_parameters.csv`; numbers are close-enough, not identical, and
the server model stays authoritative.

### `marketplace.js` — the marketplace app

The largest page module. Renders eight views selected by `data-view`:
**browse, sell, my-listings, my-requests, cart, demand, pools,
credit-profile**.

Architecture constraints, stated up front in the file header:

- There is no real backend auth or multi-tenant database, so this follows
  the pattern already set by Book a Tractor and Gyan Seva: demo catalog
  data from `Data/marketplace-listings.js` rendered client-side, with
  anything the user creates (listings, buy requests, reviews) persisted to
  `localStorage` scoped to a per-browser device id — **not** a real
  server-side account.
- One browser therefore can't see another's listings. Ownership checks are
  enforced against the local device id: this demonstrates the intended
  access-control shape but is **not** a security boundary.
- **Market Insight pricing reuses the real backend** — `/api/mandi-prices`
  and `/api/msp-vs-market`. No invented market data.
- **Verified Field Health** calls the real `/api/field/ndvi`.
- With no live counterparty, the buyer → seller order lifecycle
  (REQUESTED → ACCEPTED → … → COMPLETED) advances via explicit
  "Simulate (demo)" actions rather than pretending a seller responded.

Other notable pieces: unit normalisation across kg/quintal/tonne, forward
booking for listings with a future harvest date, collective-selling pool
orders, a post-harvest credit simulator, voice-first listing creation, and
a deep-link hook from the dashboard's "Sell this produce" button.

### `gyan-seva.js` — expert consultation

Reads `window.CONSULTANTS_DATA` (2,292 consultants) and handles: all 28
states with dynamic district population, HTML5 geolocation with
closest-district auto-fill (falling back to a state-capital coordinate
table), topic-to-specialization matching, a weighted consultant ranking,
card + profile-modal rendering, the booking workflow and summary, and the
FAQ accordion.

Beyond the directory it also carries:

- **Verified outcomes** — bookings logged on this device are followed up and
  turned into outcome stats and testimonials per consultant
  (`computeOutcomeStats`, `renderVerifiedTestimonials`), rather than
  presenting unbacked ratings.
- **AI pre-screening** — the scan card posts a leaf photo to the real
  `POST /api/disease/predict` so the farmer arrives at the consultation with
  a first-pass reading and a generated prep sheet.
- **Proactive field-health alerts** — `fetchFieldHealth` calls the real
  `POST /api/field/ndvi` and raises a banner when the drawn farm looks
  stressed, turning the page from pull to push.
- **Second opinions** — `bookBothForSecondOpinion` plus a compare modal for
  booking two experts on one high-stakes problem, with a high-stakes banner
  that prompts it.

Like the marketplace, bookings are per-browser `localStorage` — there is no
server-side account behind them.

### `book-a-tractor.js`

Reads `window.TRACTORS_DATA` (528 tractors) and renders the tractor card
grid (paginated, 12 at a time), the spec comparison table, fleet
performance bars averaged across the whole fleet, and a hardened
interactive booking modal. It also owns:

- **My Bookings** — created bookings persist to `localStorage`
  (`mittimantra_bookings`), including split and proxy bookings.
- **Trust loop** — bookings whose date has passed are logged as outcomes
  (`mittimantra_tractor_outcomes`) and feed a per-tractor reliability chip.
  Because no fleet has real booking history yet, each tractor also gets a
  small *deterministic* illustrative baseline seeded from its id (not random
  per page load), clearly labelled and never presented as a verified claim.
- **Weather-aware booking window** and **My Crop Plan** — booking-date
  suggestions derived from the real crop-calendar data rather than a
  free-form date picker.
- **Demand Near You / Mechanization Demand Intelligence** — district-level
  and platform-wide aggregates over fleet availability and local bookings.

### `map-tractors.js`

A separate module from `book-a-tractor.js`, owning the discovery half of
the same page: requesting the user's location via the Geolocation API
(with per-error messaging, retry, and a "click the map to set your
location" manual pin, defaulting to Bhopal), the Leaflet map with markers
colour-coded by availability, Haversine distance from the user to every
tractor, the filter controls (state, district, HP, price, availability,
fuel type, distance), and the nearest-first list.

### `chatbot.js` — draggable floating assistant

- Draggable FAB, position saved to `localStorage`.
- Markdown rendering with support for **bold**, `code`, ` ```blocks``` `, bullet lists, headings, pipe tables, links.
- Renders chatbot `actions` array as green pill buttons → deep-link into the dashboard.
- **Voice input** via `webkitSpeechRecognition` (Chrome / Edge). Language follows `document.documentElement.lang`.
- **Session memory** — mirrors backend `context` into `localStorage` (`mm_chat_ctx`). Bootstraps region from the Farm Profile on first open.
- **Slash-command** placeholder in the input hints at `/recommend /msp /pest`.

See [`CHATBOT.md`](./CHATBOT.md) for server-side intent details.

### `india-globe.js`

Three.js scene of India with clickable states, multiple heat-map modes
(rainfall / soil N / avg profit / per-crop suitability). Data comes from
`state-data.js` (static reference data for all 36 states + UTs).

### `site-ui.js`

Nav, scroll animations, number counters, and **service-worker
registration** (`navigator.serviceWorker.register('/sw.js')` once the
document loads).

It also loads **Lenis** (`vendor/lenis.min.js`) for smooth wheel
scrolling — on demand, and only on fine-pointer devices with motion
allowed, since Lenis leaves touch scrolling native. The instance is
exposed as `window.mmLenis`. There is no build step: the file is copied
from `node_modules/lenis/dist/` (see the root `package.json`) and
committed; re-copy it after bumping the version.

With Lenis running, three things hang off its per-frame scroll position:

- **Scroll-linked reveals** — `.reveal` / `.reveal-stagger` content below
  the fold rises in with the scroll (`.reveal-scrub` + `--rp` in
  `style.css`) instead of playing the observer's one-shot fade. Latched:
  scrolling back never hides it again.
- **Parallax** — hero photo, hero foreground and the showcase photo.
- **`window.mmScroll.to(y)` / `.intoView(el, 'start' | 'center')`** — use
  these for any programmatic smooth scroll instead of `window.scrollTo` /
  `scrollIntoView({ behavior: 'smooth' })`. A native smooth scroll started
  while Lenis is easing a wheel gesture gets overridden; these don't, and
  they fall back to native scrolling when Lenis isn't running.

### `i18n-data.js` + `i18n.js`

`i18n.js` is the switcher for **English, Hindi, Telugu and Kannada**,
driven by `data-i18n="key"` attributes on static markup.

`i18n-data.js` is the catalog it reads, and it exists to fix a real
problem: `i18n.js` used to send every visible string to a free
machine-translation API at runtime. That needed a network round trip per
string, and it got agronomy terms wrong. The catalog is now a static
dictionary of the site's actual UI strings, translated once by hand and
looked up offline:

```js
window.MM_I18N_CATALOG = { hi: { "Source string": "…" }, te: { … }, kn: { … } }
window.MM_I18N_GLOSSARY = ["MSP", "PM-KISAN", …]   // never translated
```

Anything not in the catalog is left in English rather than guessed — a
visible gap is safer than a wrong agronomy term. Coverage is deliberately
scoped to the chrome a farmer sees on every visit: nav, dashboard sidebar,
tool headers, shared form labels, common buttons and the cross-page menus.
Long marketing prose and free-form ML JSON output are out of scope.

### `auth.js` — deliberate no-op stub

Authentication has been **removed** from the product. `auth.js` is kept
only so legacy references to `window.mmAuth` don't throw: every method is a
stub (`currentUser()` → `null`, `signInWithGoogle()` → rejected promise,
`onAuthStateChanged(cb)` → calls back with `null`). `login.html` and
`firebase-config.js` remain alongside it but sign nobody in. Anything that
looks account-scoped in the UI — marketplace listings, saved plots — is
actually per-browser `localStorage`.

### `toolbar.js`

Floating action toolbar with dark-mode toggle, command-aware voice input
(parses _"simulate rice in Punjab for 5 acres"_), read-aloud TTS,
WhatsApp share, PDF export. Independent of `mm-core.js`'s tools menu —
both can coexist. It also injects the dark-theme stylesheet (see below).

### `Data/` — static demo catalogs

| File | Contents |
|---|---|
| `Data/consultants.js` | `window.CONSULTANTS_DATA` — 2,292 consultants |
| `Data/tractors.js` | `window.TRACTORS_DATA` — 528 tractors, incl. lat/lng |
| `Data/marketplace-listings.js` | `window.MARKETPLACE_DATA` — 37 listings, 6 demand signals, 2 pool orders (`source: 'DEMO_DATA'`) |

`generate_consultants.js` and `generate_tractors.js` in the same folder are
the generators that produced those catalogs.

### `sw.js` — service worker

Three strategies baked in:

- **Precache the shell** on install (HTML, CSS, all `.js` above, marketplace images, manifest).
- **Network-first for HTML** — avoids stale HTML after a deploy.
- **Cache-first for same-origin static assets** (fonts, images).
- **Stale-while-revalidate for CDN libs** (Chart.js, Three.js, Leaflet, map tiles).
- **Network-only for `/api/*`** — never cache dynamic data.

Bump `VERSION` in `sw.js` whenever you ship new assets so old caches get
evicted on `activate`. It is currently `mittimantra-v41`.

## Design system

Warm-earth "clay" palette, hand-written — **no Tailwind or other CSS
framework**. Display font **Fraunces**, body **Inter**, both from Google
Fonts. All tokens are CSS custom properties on `:root` in `style.css`.

Dark mode is a theme flip via `html[data-theme="dark"]`; the toggle and the
dark token overrides are injected by `toolbar.js`, not `style.css`.
Accessibility toggles in `mm-core.js` add `body.mm-hc` (high contrast) and
`body.mm-lg` (large text).

## Accessibility

- Keyboard-navigable — sidebar buttons, form fields, tools menu.
- `aria-label` on every icon button.
- Voice input on the chatbot.
- Large-text + high-contrast body modes.
- Print stylesheet for PDF export of the current tool.

## Extending

- **A new dashboard tool:** add a `<section class="tool" data-tool="x">…</section>` with a form `data-form="x"` and an output `data-out="x"`. Wire a submit handler in `dashboard.js`. The Farm Profile bar will auto-fill fields named like profile keys, and `mm-enhance.js` will auto-add the "Data as of" footer.
- **A new chatbot intent:** add a handler in `backend/chatbot.py` and a regex branch in `answer()`. Include deep-link `actions` via `_build_actions()` so the reply drives the user back into the dashboard.
- **A new language:** add a `LANGS` entry in `i18n.js` and a catalog block in `i18n-data.js`; mark static strings with `data-i18n="key"`. Do not reintroduce runtime machine translation.
- **A new page:** register it in `CORE` in `sw.js` (and bump `VERSION`), and add the extensionless route in `backend/main.py` if you want a clean URL.
