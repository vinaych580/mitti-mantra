# Guided Decision Flow Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add `frontend/decide.html`, a 5-step guided wizard (location → season/budget → answer → tweak → handoff) that gets a first-time farmer to one ranked, explained crop recommendation without navigating the 22-tool dashboard.

**Architecture:** A new, standalone, zero-build static page reusing existing backend endpoints (`/api/crop`, `/api/simulate`, `/api/soil`, `/api/weather`, `/api/regions`) exactly as they exist today. No backend changes. The page reuses existing frontend conventions verbatim: the `HttpError`/`api()` honest-error pattern from `dashboard.js`, the `.output[data-out]`/`mm-enhance.js` explainability decorator, the `MM.profile` Farm Profile store, the farm-boundary.js geolocation copy pattern, and the auto-translating `i18n.js`/`i18n-data.js` catalog.

**Tech Stack:** Vanilla JS (no framework, no bundler, no TypeScript — `<script defer>` only), FastAPI backend (unchanged), existing "clay" design system in `style.css`.

**Spec:** [`docs/superpowers/specs/2026-08-31-guided-decision-flow-design.md`](../specs/2026-08-31-guided-decision-flow-design.md)

## Global Constraints

- Zero-build vanilla JS only — no bundler, no TypeScript, no framework (`README.md`, `PRODUCT.md` binding constraint #1).
- No backend or API changes — every task reuses an existing, already-shipped endpoint.
- EN/HI/TE/KN must all work from the first commit — not retrofitted (`PRODUCT.md` binding constraint #3; the real catalog already covers Kannada too, see Task 6).
- Offline/PWA capability must keep working — every new file added to `sw.js`'s precache with a `VERSION` bump (`PRODUCT.md` binding constraint #4).
- No fabricated numbers — every figure shown comes from a real endpoint response; a failed call shows an honest error, never an invented fallback value (`PRODUCT.md` principle 4), except where the codebase's own existing offline-simulator fallback already applies (Task 1).
- No JS test runner exists in this repository — verification is manual, via a browser, exactly as the rest of this codebase is verified (confirmed in `AUDIT_REPORT.md`'s remediation notes). Each task's "test" steps are concrete browser checks, not `pytest` invocations.

---

## Task 1: Page shell, shared plumbing, region data, and Step 1 (location)

**Files:**
- Create: `frontend/region-geo.js`
- Create: `frontend/decide.html`
- Create: `frontend/decide.js`

**Interfaces:**
- Produces (`region-geo.js`): `window.MM_REGION_GEO` — array of `{region_id, lat, lon}`, one entry per the 30 region_ids in `dataset/soil.csv`. `window.MM_REGION_GEO_UTIL.haversineKm(lat1, lon1, lat2, lon2) → number`. `window.MM_REGION_GEO_UTIL.nearestRegion(lat, lon) → {region_id, distanceKm} | null`.
- Produces (`decide.js`): a `state` object (`{region_id, region_name, season, area_acres, budget_per_acre, irrigation_level, recommendation}`, all `null`/`undefined` until set by later tasks), `showStep(n)`, `goNext()`, `goBack()`, `api(url, opts)` (returns a Promise, throws `HttpError` on real HTTP 4xx/5xx, falls back to `window.AgriSimOffline` for `/api/crop` and `/api/simulate` on genuine network failure — mirrors `dashboard.js:150-217`), `regionLabel(region_id)` (looks up the pretty name from the loaded `/api/regions` list). Tasks 2–5 read and write `state` and call `api()`/`showStep()`/`goNext()`/`goBack()`; they do not redefine any of these.
- Consumes: `window.MM_REGION_GEO_UTIL` (from this task's own `region-geo.js`), `window.AgriSimOffline` (existing file `frontend/offline-simulator.js`, unmodified).

### Background for the implementer

`dashboard.js` already has the exact honest-error pattern this page needs (read it before writing `decide.js`):

```js
// dashboard.js:150-204 — copy this pattern verbatim into decide.js
class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.name = 'HttpError';
    this.status = status;
  }
}

async function api(url, opts = {}) {
  try {
    const res = await fetch(url, { headers: { 'Content-Type': 'application/json' }, ...opts });
    if (!res.ok) {
      let msg;
      try {
        const errData = await res.json();
        const d = errData && errData.detail;
        if (typeof d === 'string') msg = d;
        else if (Array.isArray(d)) msg = d.map(e => (e && (e.msg || e.message)) || JSON.stringify(e)).join('; ');
        else if (d && typeof d === 'object') msg = JSON.stringify(d);
        else msg = res.statusText;
      } catch { msg = res.statusText; }
      throw new HttpError(res.status, `${res.status} · ${msg}`);
    }
    return await res.json();
  } catch (err) {
    if (err instanceof HttpError) throw err;
    const offline = window.AgriSimOffline;
    const body = opts.body ? tryParseJSON(opts.body) : null;
    if (offline) {
      if (url === '/api/crop' && body) { flashOfflineBanner(); return offline.recommend(body); }
      if (url.includes('/api/simulate') && body) { flashOfflineBanner(); return offline.simulate(body); }
    }
    throw err;
  }
}
function tryParseJSON(s) { try { return JSON.parse(s); } catch { return null; } }
```

Region geolocation copy comes from `farm-boundary.js:461-487` — reuse the three status messages (device unsupported / permission denied / timeout) verbatim except swapping "village" for "region" (this page's fallback is a region picker, not a village search, so that one substitution is a real adaptation, not drift). The exact source strings, confirmed by direct read, are:
- Unsupported: `'This device cannot share its location. Search for your village instead.'`
- Permission denied: `'Location permission denied. Allow it in your browser, or search for your village.'` (no "instead")
- Timeout: `'Could not get a GPS fix in time. Try again outdoors, or search for your village.'` (has "outdoors", no "instead")

The 30 `region_id`s (from `dataset/soil.csv`) and their real district-headquarters centroid coordinates — sourced from public geographic records, cross-checked against three ground-truth points already embedded in this repo's own training-data filenames (`dataset/training/features_30.9_75.85_wheat.json` → `punjab_ludhiana`; `features_23.2_77.08_soybean.json` → `mp_sehore`; `features_17.61_78.26_rice.json` → `telangana_medak`) — are listed in Step 1 of this task below. These are approximate town centroids for "nearest of 30" routing, not survey coordinates; that's sufficient given Step 1's 150km sanity threshold.

- [ ] **Step 1: Create `frontend/region-geo.js`**

```js
/* AgriSim — static region centroid table for geolocation-to-region matching.
   Coordinates are real district-headquarters centroids (public geographic
   data), used only to pick the nearest of the app's 30 known regions from a
   GPS reading — not survey-precision figures. Three entries are corroborated
   directly by this repo's own training-data filenames (see dataset/training/). */
(() => {
  'use strict';

  const REGIONS = [
    { region_id: 'ap_guntur',           lat: 16.30, lon: 80.44 },
    { region_id: 'assam_nagaon',        lat: 26.35, lon: 92.68 },
    { region_id: 'bihar_patna',         lat: 25.59, lon: 85.14 },
    { region_id: 'chhattisgarh_raipur', lat: 21.25, lon: 81.63 },
    { region_id: 'goa_north',           lat: 15.50, lon: 73.83 },
    { region_id: 'guj_anand',           lat: 22.56, lon: 72.95 },
    { region_id: 'guj_rajkot',          lat: 22.30, lon: 70.80 },
    { region_id: 'haryana_karnal',      lat: 29.69, lon: 76.98 },
    { region_id: 'hp_shimla',           lat: 31.10, lon: 77.17 },
    { region_id: 'jharkhand_ranchi',    lat: 23.34, lon: 85.31 },
    { region_id: 'jk_pulwama',          lat: 33.87, lon: 74.90 },
    { region_id: 'kar_belagavi',        lat: 15.85, lon: 74.50 },
    { region_id: 'kar_mysuru',          lat: 12.30, lon: 76.64 },
    { region_id: 'kerala_palakkad',     lat: 10.78, lon: 76.65 },
    { region_id: 'mh_nashik',           lat: 20.00, lon: 73.79 },
    { region_id: 'mh_pune',             lat: 18.52, lon: 73.86 },
    { region_id: 'mh_yavatmal',         lat: 20.39, lon: 78.13 },
    { region_id: 'mp_indore',           lat: 22.72, lon: 75.86 },
    { region_id: 'mp_sehore',           lat: 23.20, lon: 77.08 },
    { region_id: 'odisha_cuttack',      lat: 20.47, lon: 85.88 },
    { region_id: 'punjab_ludhiana',     lat: 30.90, lon: 75.85 },
    { region_id: 'rajasthan_jaipur',    lat: 26.91, lon: 75.79 },
    { region_id: 'telangana_medak',     lat: 17.61, lon: 78.26 },
    { region_id: 'tn_coimbatore',       lat: 11.02, lon: 76.96 },
    { region_id: 'tn_thanjavur',        lat: 10.79, lon: 79.14 },
    { region_id: 'tripura_west',        lat: 23.83, lon: 91.29 },
    { region_id: 'uk_udhamsinghnagar',  lat: 28.98, lon: 79.40 },
    { region_id: 'up_lucknow',          lat: 26.85, lon: 80.95 },
    { region_id: 'up_varanasi',         lat: 25.32, lon: 82.97 },
    { region_id: 'wb_bardhaman',        lat: 23.24, lon: 87.86 }
  ];

  const R_KM = 6371;
  const toRad = d => d * Math.PI / 180;
  function haversineKm(lat1, lon1, lat2, lon2) {
    const dLat = toRad(lat2 - lat1);
    const dLon = toRad(lon2 - lon1);
    const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) * Math.sin(dLon / 2);
    return 2 * R_KM * Math.asin(Math.min(1, Math.sqrt(a)));
  }
  function nearestRegion(lat, lon) {
    let best = null;
    for (const r of REGIONS) {
      const d = haversineKm(lat, lon, r.lat, r.lon);
      if (!best || d < best.distanceKm) best = { region_id: r.region_id, distanceKm: d };
    }
    return best;
  }

  window.MM_REGION_GEO = REGIONS;
  window.MM_REGION_GEO_UTIL = { haversineKm, nearestRegion };
})();
```

- [ ] **Step 2: Verify the data file loads and computes correctly**

Open a browser console on any existing page, paste the file's contents (or once Step 3 wires it into `decide.html`, just load that page), then run:

```js
MM_REGION_GEO.length
// Expected: 30
MM_REGION_GEO_UTIL.nearestRegion(30.9, 75.85)
// Expected: { region_id: 'punjab_ludhiana', distanceKm: <a number under 1> }
MM_REGION_GEO_UTIL.nearestRegion(19.0, 72.8)  // Mumbai — not one of the 30 regions
// Expected: nearest is mh_pune or mh_nashik, distanceKm roughly 100-150
```

- [ ] **Step 3: Create `frontend/decide.html`**

```html
<!DOCTYPE html>
<html lang="en">

<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Get your answer · Mitti Mantra</title>
  <meta name="description"
    content="Tell us your farm's location, season, and budget — get one ranked crop recommendation with reasoning, in under a minute.">

  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link
    href="https://fonts.googleapis.com/css2?family=Fraunces:ital,wght@0,400;0,500;0,600;1,400&family=Inter:wght@300;400;500;600;700&display=swap"
    rel="stylesheet">
  <link rel="stylesheet" href="style.css">
  <link rel="icon" href="assets/logo-192.png" type="image/png">
  <link rel="apple-touch-icon" href="assets/logo-192.png">

  <style>
    .decide-main { max-width: 640px; margin: 0 auto; padding: 100px 20px 80px; }
    .decide-progress { display: flex; gap: 8px; justify-content: center; margin-bottom: 24px; }
    .decide-progress__dot { width: 9px; height: 9px; border-radius: 999px; background: var(--ink-faint); opacity: .35; }
    .decide-progress__dot.is-active { background: var(--brand); opacity: 1; }
    .decide-progress__dot.is-done { background: var(--brand); opacity: .6; }
    .decide-step { display: none; }
    .decide-step.is-active { display: block; }
    .decide-actions { display: flex; justify-content: space-between; gap: 12px; margin-top: 24px; }
    .decide-status { margin-top: 10px; font-size: .88rem; color: var(--ink-soft); min-height: 1.4em; }
    .decide-status--busy { color: var(--ink-faint); }
    .decide-status--warn { color: var(--accent-deep); }
    .decide-status--error { color: var(--danger); }
    .decide-status--ok { color: var(--brand-deep); }
    .decide-inline-btn { background: none; border: none; color: var(--brand); text-decoration: underline; cursor: pointer; font: inherit; padding: 0; }
    .decide-badge { display: inline-block; margin-left: 8px; padding: 2px 8px; border-radius: 999px; background: var(--accent-soft); color: var(--accent-deep); font-size: .72rem; font-weight: 600; letter-spacing: .04em; }
    .decide-runnerups { margin-top: 16px; }
    .decide-slider-row { margin-bottom: 18px; }
    .decide-slider-row label { display: flex; justify-content: space-between; font-size: .85rem; font-weight: 600; margin-bottom: 6px; }
    .decide-handoff { display: grid; gap: 12px; margin-top: 8px; }
  </style>
</head>

<body>

  <nav class="nav scrolled" id="nav">
    <div class="nav__wrap">
      <a href="index.html" class="logo" aria-label="Mitti Mantra home">
        <img src="assets/logo-128.png" alt="Mitti Mantra — Growing the future" class="logo__img" width="128" height="128">
      </a>
      <ul class="nav__links">
        <li><a href="index.html">Home</a></li>
        <li><a href="dashboard.html">Full dashboard</a></li>
      </ul>
      <div class="nav__cta">
        <a href="index.html" class="btn btn-ghost">Back to site</a>
      </div>
    </div>
  </nav>

  <main class="decide-main">
    <div class="decide-progress" id="decideProgress" aria-hidden="true">
      <span class="decide-progress__dot" data-dot="1"></span>
      <span class="decide-progress__dot" data-dot="2"></span>
      <span class="decide-progress__dot" data-dot="3"></span>
      <span class="decide-progress__dot" data-dot="4"></span>
      <span class="decide-progress__dot" data-dot="5"></span>
    </div>

    <!-- STEP 1: Location -->
    <section class="decide-step is-active" data-step="1">
      <div class="tool__head">
        <div class="tool__ico"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/></svg></div>
        <div>
          <h2>Where's your farm?</h2>
          <p>Pick your region, or let us find it.</p>
        </div>
      </div>
      <div class="field">
        <label>Region</label>
        <select name="region_id" id="decideRegionSelect" data-regions></select>
      </div>
      <button type="button" class="btn btn-ghost" id="decideLocate">📍 Use my location</button>
      <div class="decide-status" id="decideLocateStatus" role="status"></div>
      <div class="decide-actions">
        <span></span>
        <button type="button" class="btn btn-primary" id="decideStep1Next" disabled>Next</button>
      </div>
    </section>

    <!-- STEP 2: filled in Task 2 -->
    <section class="decide-step" data-step="2"></section>

    <!-- STEP 3: filled in Task 3 -->
    <section class="decide-step" data-step="3"></section>

    <!-- STEP 4: filled in Task 4 -->
    <section class="decide-step" data-step="4"></section>

    <!-- STEP 5: filled in Task 5 -->
    <section class="decide-step" data-step="5"></section>
  </main>

  <script src="mm-core.js" defer></script>
  <script src="site-ui.js" defer></script>
  <script src="offline-simulator.js" defer></script>
  <script src="region-geo.js" defer></script>
  <script src="decide.js" defer></script>
  <script src="mm-enhance.js" defer></script>
  <script src="i18n-data.js" defer></script>
  <script src="i18n.js" defer></script>
  <script src="toolbar.js" defer></script>
  <script src="chatbot.js" defer></script>
</body>

</html>
```

- [ ] **Step 4: Create `frontend/decide.js`**

```js
(() => {
  'use strict';
  const $ = (sel, root) => (root || document).querySelector(sel);
  const $$ = (sel, root) => Array.from((root || document).querySelectorAll(sel));

  /* ---------- shared plumbing (mirrors dashboard.js:150-217) ---------- */
  class HttpError extends Error {
    constructor(status, message) {
      super(message);
      this.name = 'HttpError';
      this.status = status;
    }
  }

  function tryParseJSON(s) { try { return JSON.parse(s); } catch { return null; } }

  let offlineBannerShown = false;
  function flashOfflineBanner() {
    if (offlineBannerShown) return;
    offlineBannerShown = true;
    const el = document.createElement('div');
    el.className = 'offline-banner';
    el.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M1 1l22 22"/><path d="M16.72 11.06A10.94 10.94 0 0 1 19 12.55"/><path d="M5 12.55a10.94 10.94 0 0 1 5.17-2.39"/><path d="M10.71 5.05A16 16 0 0 1 22.58 9"/><path d="M1.42 9a15.91 15.91 0 0 1 4.7-2.88"/><path d="M8.53 16.11a6 6 0 0 1 6.95 0"/><line x1="12" y1="20" x2="12.01" y2="20"/></svg>
      <span><strong>Running in offline mode.</strong> Backend unreachable — using on-device simulator.</span>`;
    document.body.appendChild(el);
    setTimeout(() => el.classList.add('offline-banner--hide'), 8000);
    setTimeout(() => el.remove(), 8600);
  }

  async function api(url, opts = {}) {
    try {
      const res = await fetch(url, { headers: { 'Content-Type': 'application/json' }, ...opts });
      if (!res.ok) {
        let msg;
        try {
          const errData = await res.json();
          const d = errData && errData.detail;
          if (typeof d === 'string') msg = d;
          else if (Array.isArray(d)) msg = d.map(e => (e && (e.msg || e.message)) || JSON.stringify(e)).join('; ');
          else if (d && typeof d === 'object') msg = JSON.stringify(d);
          else msg = res.statusText;
        } catch { msg = res.statusText; }
        throw new HttpError(res.status, `${res.status} · ${msg}`);
      }
      return await res.json();
    } catch (err) {
      if (err instanceof HttpError) throw err;
      const offline = window.AgriSimOffline;
      const body = opts.body ? tryParseJSON(opts.body) : null;
      if (offline) {
        if (url === '/api/crop' && body) { flashOfflineBanner(); return offline.recommend(body); }
        if (url.includes('/api/simulate') && body) { flashOfflineBanner(); return offline.simulate(body); }
      }
      throw err;
    }
  }

  /* ---------- wizard state + step navigation ---------- */
  const state = {
    region_id: null, region_name: null,
    season: null, area_acres: null, budget_per_acre: null,
    irrigation_level: 0.5,
    recommendation: null
  };
  const TOTAL_STEPS = 5;
  let currentStep = 1;
  const regionsById = {};

  function showStep(n) {
    currentStep = n;
    $$('.decide-step').forEach(sec => {
      sec.classList.toggle('is-active', Number(sec.dataset.step) === n);
    });
    $$('.decide-progress__dot').forEach(dot => {
      const i = Number(dot.dataset.dot);
      dot.classList.toggle('is-active', i === n);
      dot.classList.toggle('is-done', i < n);
    });
    window.scrollTo({ top: 0, behavior: 'smooth' });
    document.dispatchEvent(new CustomEvent('decide:step-shown', { detail: { step: n } }));
  }
  const goNext = () => { if (currentStep < TOTAL_STEPS) showStep(currentStep + 1); };
  const goBack = () => { if (currentStep > 1) showStep(currentStep - 1); };

  const regionLabel = region_id => (regionsById[region_id] ? regionsById[region_id].name : region_id);

  /* ---------- Step 1: location ---------- */
  async function populateRegions() {
    const select = $('#decideRegionSelect');
    try {
      const regions = await api('/api/regions');
      regions.forEach(r => { regionsById[r.id] = r; });
      select.innerHTML = '<option value="">Select a region…</option>' +
        regions.map(r => `<option value="${r.id}">${r.name}</option>`).join('');
    } catch {
      select.innerHTML = '<option value="">Could not load regions</option>';
    }
  }

  function selectRegion(region_id) {
    $('#decideRegionSelect').value = region_id;
    state.region_id = region_id;
    state.region_name = regionLabel(region_id);
    $('#decideStep1Next').disabled = !region_id;
  }

  function setLocateStatus(html, kind) {
    const el = $('#decideLocateStatus');
    el.innerHTML = html;
    el.className = 'decide-status' + (kind ? ` decide-status--${kind}` : '');
  }

  function wireStep1() {
    populateRegions();

    $('#decideRegionSelect').addEventListener('change', e => {
      selectRegion(e.target.value);
      if (e.target.value) setLocateStatus('', '');
    });

    const locateBtn = $('#decideLocate');
    locateBtn.addEventListener('click', () => {
      if (!navigator.geolocation) {
        setLocateStatus('This device cannot share its location. Search for your region instead.', 'error');
        return;
      }
      locateBtn.disabled = true;
      setLocateStatus('Finding your location…', 'busy');

      navigator.geolocation.getCurrentPosition(
        (pos) => {
          locateBtn.disabled = false;
          const { latitude: lat, longitude: lon } = pos.coords;
          const match = window.MM_REGION_GEO_UTIL.nearestRegion(lat, lon);

          if (!match || match.distanceKm > 150) {
            if (!match) {
              setLocateStatus('Location unavailable. Search for your region instead.', 'error');
              return;
            }
            const label = regionLabel(match.region_id);
            setLocateStatus(
              `Closest match: <strong>${label}</strong> (${Math.round(match.distanceKm)} km away — is this right?) <button type="button" class="decide-inline-btn" id="decideAcceptMatch">Use this</button> or pick below.`,
              'warn'
            );
            $('#decideAcceptMatch')?.addEventListener('click', () => {
              selectRegion(match.region_id);
              setLocateStatus(`Using ${label}.`, 'ok');
            }, { once: true });
            return;
          }

          selectRegion(match.region_id);
          setLocateStatus(`Using ${regionLabel(match.region_id)}.`, 'ok');
        },
        (err) => {
          locateBtn.disabled = false;
          const msg = err.code === err.PERMISSION_DENIED
            ? 'Location permission denied. Allow it in your browser, or search for your region.'
            : err.code === err.TIMEOUT
            ? 'Could not get a GPS fix in time. Try again outdoors, or search for your region.'
            : 'Location unavailable. Search for your region instead.';
          setLocateStatus(msg, 'error');
        },
        { enableHighAccuracy: true, timeout: 10000, maximumAge: 60000 }
      );
    });

    $('#decideStep1Next').addEventListener('click', goNext);
  }

  /* ---------- boot ---------- */
  document.addEventListener('DOMContentLoaded', () => {
    wireStep1();
  });

  // Exposed for later tasks (2-5) to extend without redefining shared plumbing.
  window.MMDecide = { api, HttpError, state, showStep, goNext, goBack, regionLabel, $, $$ };
})();
```

- [ ] **Step 5: Verify Step 1 in the browser**

Start the backend (`uvicorn backend.main:app --reload --port 8000`) and open `http://localhost:8000/decide.html`.

Expected:
- Region dropdown populates with 30 options (e.g. "Telangana · Medak").
- "Next" stays disabled until a region is chosen.
- Picking a region from the dropdown enables "Next".
- Clicking "Use my location" and denying the browser's permission prompt shows: "Location permission denied. Allow it in your browser, or search for your region." — and the dropdown remains usable.
- In the browser console, `MMDecide.state.region_id` reflects the chosen region after selection.

- [ ] **Step 6: Commit**

```bash
git add frontend/region-geo.js frontend/decide.html frontend/decide.js
git commit -m "feat: add guided decision flow page shell and location step"
```

---

## Task 2: Step 2 (season, budget, area) and Farm Profile integration

**Files:**
- Modify: `frontend/decide.html` (Step 2 section)
- Modify: `frontend/decide.js` (Step 2 logic)

**Interfaces:**
- Consumes: `state`, `showStep`/`goNext`/`goBack`, `api()` (all from Task 1's `window.MMDecide`, but this task edits `decide.js` directly in place — it is the same closure, not a separate module).
- Produces: `state.season`, `state.area_acres`, `state.budget_per_acre` set on advance; calls `window.MM.profile.set({ region_id, season, area_acres, budget_per_acre })` (from `mm-core.js`, already loaded).

- [ ] **Step 1: Fill in Step 2's markup in `frontend/decide.html`**

Replace `<section class="decide-step" data-step="2"></section>` with:

```html
    <section class="decide-step" data-step="2">
      <div class="tool__head">
        <div class="tool__ico"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/></svg></div>
        <div>
          <h2>When and how much?</h2>
          <p>Tell us your season, budget, and land.</p>
        </div>
      </div>
      <form id="decideStep2Form">
        <div class="form-row">
          <div class="field"><label>Season</label>
            <select name="season">
              <option value="kharif">Kharif</option>
              <option value="rabi">Rabi</option>
            </select>
          </div>
          <div class="field"><label>Area (acres)</label>
            <input name="area_acres" type="number" step="any" min="0.1" value="4" required>
          </div>
          <div class="field"><label>Budget / acre (₹)</label>
            <input name="budget_per_acre" type="number" step="any" min="1" value="15000" required>
          </div>
        </div>
      </form>
      <div class="decide-actions">
        <button type="button" class="btn btn-ghost" data-step2-back>Back</button>
        <button type="button" class="btn btn-primary" id="decideStep2Next">Run recommendation</button>
      </div>
    </section>
```

- [ ] **Step 2: Wire Step 2 in `frontend/decide.js`**

Add this function, and call `wireStep2()` alongside `wireStep1()` in the `DOMContentLoaded` handler:

```js
  function wireStep2() {
    const form = $('#decideStep2Form');

    document.addEventListener('decide:step-shown', (e) => {
      if (e.detail.step !== 2) return;
      const profile = (window.MM && window.MM.profile && window.MM.profile.get()) || {};
      if (profile.season) form.season.value = profile.season;
      if (profile.area_acres) form.area_acres.value = profile.area_acres;
      if (profile.budget_per_acre) form.budget_per_acre.value = profile.budget_per_acre;
    });

    $('[data-step2-back]').addEventListener('click', goBack);

    $('#decideStep2Next').addEventListener('click', () => {
      if (!form.reportValidity()) return;
      state.season = form.season.value;
      state.area_acres = parseFloat(form.area_acres.value);
      state.budget_per_acre = parseFloat(form.budget_per_acre.value);
      if (window.MM && window.MM.profile) {
        window.MM.profile.set({
          region_id: state.region_id,
          season: state.season,
          area_acres: state.area_acres,
          budget_per_acre: state.budget_per_acre
        });
      }
      goNext();
    });
  }
```

Update the boot block:

```js
  document.addEventListener('DOMContentLoaded', () => {
    wireStep1();
    wireStep2();
  });
```

- [ ] **Step 3: Verify in the browser**

Reload `decide.html`, complete Step 1, click "Next". Expected:
- Step 2 shows Season/Area/Budget fields, pre-filled with defaults (4 acres, ₹15,000).
- Leaving Area blank and clicking "Run recommendation" shows the browser's native "fill out this field" validation and does not advance.
- With valid values, clicking "Run recommendation" advances to (currently empty) Step 3.
- In the browser console: `localStorage.getItem('mm_farm_profile')` now contains the chosen `region_id`, `season`, `area_acres`, `budget_per_acre`.

- [ ] **Step 4: Commit**

```bash
git add frontend/decide.html frontend/decide.js
git commit -m "feat: add season/budget/area step to guided decision flow"
```

---

## Task 3: Step 3 (the answer) — `/api/crop` and explainability reuse

**Files:**
- Modify: `frontend/decide.html` (Step 3 section)
- Modify: `frontend/decide.js` (Step 3 logic)

**Interfaces:**
- Consumes: `state.region_id/season/area_acres/budget_per_acre`, `api()`.
- Produces: `state.recommendation = { top: <crop object>, runnerUps: [<crop object>, ...] }` for Task 4 to read the top crop's `crop_id`.

`mm-enhance.js` only attaches its "Why this crop?" drawer when the output container's `data-out` is the literal string `"recommend"` (`mm-enhance.js:177`: `if (kind === "recommend") decorateRecommend(out);`) — the container **must** be `<div class="output" data-out="recommend">`, not any other name. The drawer also parses these exact regex patterns out of visible text (`mm-enhance.js:104-118`), so the rendered markup must match `dashboard.js`'s own recommend-tool output format exactly:
- `.list-row__name small` must contain text matching `Yield\s+(\d+)\s*kg`, `Risk\s+(\d+)`, `Score\s+([\d.]+)`.
- `.list-row__val` must contain text matching `ROI\s*([\d.\-]+%)` and a comma-grouped number for profit.

- [ ] **Step 1: Fill in Step 3's markup in `frontend/decide.html`**

Replace `<section class="decide-step" data-step="3"></section>` with:

```html
    <section class="decide-step" data-step="3">
      <div class="tool__head">
        <div class="tool__ico"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2 C9 8 7 12 7 15 a5 5 0 0 0 10 0 c0-3-2-7-5-13z"/></svg></div>
        <div>
          <h2>Your answer</h2>
        </div>
      </div>
      <div class="output" data-out="recommend" id="decideAnswerOut"></div>
      <div class="decide-actions">
        <button type="button" class="btn btn-ghost" data-step3-back>Back</button>
        <button type="button" class="btn btn-primary" id="decideStep3Next" disabled>Next</button>
      </div>
    </section>
```

"Next" starts disabled — a fast double-click can't skip past a failed recommendation call. `renderAnswer()` (Step 2 below) re-enables it once a real result renders; if the call fails, the catch block never calls `renderAnswer()`, so it stays disabled.

- [ ] **Step 2: Wire Step 3 in `frontend/decide.js`**

Add the formatting helpers (module scope, near the top, alongside the other shared plumbing) and the step logic:

```js
  const INR = n => '₹' + Math.round(Number(n) || 0).toLocaleString('en-IN');
  const FIX = (n, d = 1) => (Number(n) || 0).toFixed(d);
  const PCT = n => FIX(n, 1) + '%';
```

The "Full ranking" list below always includes `top` itself, not just `runnerUps` — this is required, not decorative. `mm-enhance.js`'s "Why this crop?" drawer and risk gauge only attach to `.list-row` elements (`mm-enhance.js:101`); the top pick's `.kpi-grid` card is not a `.list-row` and would never get decorated on its own. Including `top` as the first row of the ranked list is what makes the decoration actually appear on the crop that matters most — the same pattern `dashboard.js`'s own "Ranked alternatives" list already uses (it lists all ranks, including #1, for the identical reason).

```js
  function renderAnswer(top, runnerUps) {
    const out = $('#decideAnswerOut');
    const reasonsList = (top.reasons && top.reasons.length)
      ? `<div class="alert alert--green" style="margin-top:16px;border:1px solid color-mix(in srgb, var(--brand) 35%, transparent);background:var(--brand-soft);">
          <div class="alert__body" style="color:var(--brand-deep);"><strong>Why this crop:</strong>
            <ul style="margin:8px 0 0 16px;padding:0;">
              ${top.reasons.map(r => `<li style="margin-bottom:4px;font-size:.88rem;list-style-type:disc;">${r}</li>`).join('')}
            </ul>
          </div>
        </div>` : '';

    out.innerHTML = `
      <div class="kpi-grid">
        <div class="kpi kpi--good"><div class="kpi__lbl">Top pick</div>
          <div class="kpi__val" style="font-size:1.3rem;">${top.crop_name}</div>
          <div class="kpi__sub">Smart score ${FIX(top.smart_score, 1)} / 100</div></div>
        <div class="kpi"><div class="kpi__lbl">Predicted yield</div>
          <div class="kpi__val">${Math.round(top.predicted_yield_kg_per_acre)} <span style="font-size:.5em;color:var(--ink-faint)">kg/ac</span></div></div>
        <div class="kpi kpi--good"><div class="kpi__lbl">Profit (${state.area_acres} ac)</div>
          <div class="kpi__val">${INR(top.expected_profit)}</div>
          <div class="kpi__sub">ROI ${PCT(top.roi_percent)}</div></div>
        <div class="kpi"><div class="kpi__lbl">Risk</div>
          <div class="kpi__val">${Math.round(top.risk_score)}/100</div></div>
      </div>
      ${reasonsList}
      <h4 style="font-size:.85rem;font-weight:600;letter-spacing:.12em;text-transform:uppercase;color:var(--ink-faint);margin:16px 0 12px;">Full ranking</h4>
      <div class="decide-runnerups">
        ${[top, ...runnerUps].map(r => `
          <div class="list-row">
            <div class="list-row__name">${r.crop_name}
              <small>Yield ${Math.round(r.predicted_yield_kg_per_acre)} kg/ac · Risk ${Math.round(r.risk_score)}/100 · Score ${FIX(r.smart_score, 1)}</small>
              ${r.reasons && r.reasons[0] ? `<div style="font-size:.76rem;color:var(--brand-deep);margin-top:4px;">• ${r.reasons[0]}</div>` : ''}
            </div>
            <div class="list-row__val">${INR(r.expected_profit)}<small>ROI ${PCT(r.roi_percent)}</small></div>
          </div>`).join('')}
      </div>`;

    $('#decideStep3Next').disabled = false;
  }

  async function runRecommendation() {
    const out = $('#decideAnswerOut');
    out.innerHTML = '<div class="loading"><div class="spinner"></div><span>Ranking crops for your farm…</span></div>';
    try {
      const body = {
        region_id: state.region_id, season: state.season,
        area_acres: state.area_acres, budget_per_acre: state.budget_per_acre
      };
      const recs = await api('/api/crop', { method: 'POST', body: JSON.stringify(body) });
      if (!Array.isArray(recs) || !recs.length) {
        out.innerHTML = '<div class="alert"><div class="alert__body"><strong>No recommendations returned.</strong></div></div>';
        return;
      }
      state.recommendation = { top: recs[0], runnerUps: recs.slice(1, 3) };
      renderAnswer(state.recommendation.top, state.recommendation.runnerUps);
    } catch (err) {
      out.innerHTML = `<div class="alert alert--red"><div class="alert__body"><strong>Could not get a recommendation.</strong><p>${err && err.message ? err.message : 'Please try again.'}</p></div></div>`;
    }
  }

  function wireStep3() {
    document.addEventListener('decide:step-shown', (e) => {
      if (e.detail.step === 3 && !state.recommendation) runRecommendation();
    });
    $('[data-step3-back]').addEventListener('click', goBack);
    $('#decideStep3Next').addEventListener('click', () => {
      if (!state.recommendation) return;
      goNext();
    });
  }
```

Update the boot block:

```js
  document.addEventListener('DOMContentLoaded', () => {
    wireStep1();
    wireStep2();
    wireStep3();
  });
```

- [ ] **Step 3: Verify in the browser**

Complete Steps 1–2 with a real region (e.g. Telangana · Medak, kharif, 4 acres, ₹15,000/acre). On Step 3, expected:
- A loading spinner, then a KPI grid with a top crop, predicted yield, profit, ROI, and risk.
- A "Why this crop" reasons block with real sentences (not placeholder text) — confirms `/api/crop`'s `reasons` field is flowing through.
- Two runner-up crops listed below.
- Open the browser's element inspector on the top-pick's rendered row and confirm a `<details class="mm-why">` element was injected by `mm-enhance.js` — click it and confirm the "Why this crop?" bar chart renders with real numbers, not all "—". This is the concrete proof the `data-out="recommend"` + exact-text-format reuse actually works, not just that it looks plausible.
- "Next" is disabled until the answer finishes loading.

- [ ] **Step 4: Commit**

```bash
git add frontend/decide.html frontend/decide.js
git commit -m "feat: add recommendation answer step to guided decision flow"
```

---

## Task 4: Step 4 (tweak it) — inline `/api/simulate`

**Files:**
- Modify: `frontend/decide.html` (Step 4 section)
- Modify: `frontend/decide.js` (Step 4 logic)

**Interfaces:**
- Consumes: `state.recommendation.top.crop_id`, `state.region_id/season/area_acres/budget_per_acre`, `api()`, `regionLabel()`.
- Produces: nothing later tasks depend on — this step's simulate result is display-only.

Reuses two patterns from `dashboard.js` that exist separately today (per the design spec §6.3): the soil/weather auto-fetch (`dashboard.js:2335-2340`) and the budget-to-category-cost split — seed 12%, fertilizer 30%, labour 25%, other 33% (`dashboard.js:2303-2308`).

`SimulationRequest.mandi_price_per_kg` (`backend/models.py:3-13`) is a **required** `float`, not optional — omitting it fails every call with a 422. `dashboard.js`'s own simulate tool doesn't auto-fill it either; it's a plain text field the advisor persona types into by hand (`dashboard.js:1183`, reading `f.mandi_price_per_kg` straight from the form). That's the wrong pattern to copy here — Step 4 is sliders-only by design, so this task instead fetches a real observed price via `GET /api/price-analytics/{region_id}/{crop_id}`, whose `current_price` field is the most recent real row from `dataset/mandi_prices.csv` (`ml/predict.py:548-620`, specifically line 607: `"current_price": price_vals[-1]`) — a genuine figure, not a guess, and a better fit for a zero-typing step than the dashboard's manual-entry convention.

- [ ] **Step 1: Fill in Step 4's markup in `frontend/decide.html`**

Replace `<section class="decide-step" data-step="4"></section>` with:

```html
    <section class="decide-step" data-step="4">
      <div class="tool__head">
        <div class="tool__ico"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 3v18h18"/><path d="M7 14l4-4 3 3 5-6"/></svg></div>
        <div>
          <h2>Tweak it</h2>
          <p>See how budget and irrigation change the outcome.</p>
        </div>
      </div>
      <div class="decide-slider-row">
        <label><span>Budget / acre</span><span id="decideBudgetVal"></span></label>
        <input type="range" id="decideTweakBudget" min="5000" max="40000" step="500">
      </div>
      <div class="decide-slider-row">
        <label><span>Area (acres)</span><span id="decideAreaVal"></span></label>
        <input type="range" id="decideTweakArea" min="0.5" max="20" step="0.5">
      </div>
      <div class="decide-slider-row">
        <label><span>Irrigation level</span><span id="decideIrrigationVal"></span></label>
        <input type="range" id="decideTweakIrrigation" min="0" max="1" step="0.1">
      </div>
      <div class="output" data-out="simulate" id="decideTweakOut"></div>
      <div class="decide-actions">
        <button type="button" class="btn btn-ghost" data-step4-back>Back</button>
        <button type="button" class="btn btn-primary" id="decideStep4Next">Next</button>
      </div>
    </section>
```

- [ ] **Step 2: Wire Step 4 in `frontend/decide.js`**

```js
  const budgetSplit = budget_per_acre => ({
    seed_cost_per_acre: Math.round(budget_per_acre * 0.12),
    fertilizer_cost_per_acre: Math.round(budget_per_acre * 0.30),
    labour_cost_per_acre: Math.round(budget_per_acre * 0.25),
    other_costs_per_acre: Math.round(budget_per_acre * 0.33)
  });

  const coerceNumeric = obj => Object.fromEntries(Object.entries(obj || {}).map(([k, v]) =>
    [k, (typeof v === 'string' && v.trim() !== '' && !isNaN(Number(v))) ? Number(v) : v]));

  async function runTweakSimulation() {
    const out = $('#decideTweakOut');
    out.innerHTML = '<div class="loading"><div class="spinner"></div><span>Simulating…</span></div>';
    try {
      const budget = parseFloat($('#decideTweakBudget').value);
      const area = parseFloat($('#decideTweakArea').value);
      const irrigation = parseFloat($('#decideTweakIrrigation').value);
      const cropId = state.recommendation.top.crop_id;

      const [soilRaw, weatherRaw] = await Promise.all([
        api(`/api/soil/${state.region_id}`).catch(() => ({})),
        api(`/api/weather/${state.region_id}?season=${state.season}`).catch(() => ({}))
      ]);
      // Required by SimulationRequest (backend/models.py:7, no default) — sourced
      // from the same real mandi observations dashboard.js's own price tools use,
      // not typed by hand like the dashboard's simulate form does (that pattern
      // doesn't fit a sliders-only step). A genuine failure here (no price data
      // for this crop/region) is allowed to fall through to the catch block below
      // rather than silently substituting a guessed price.
      const priceInfo = await api(`/api/price-analytics/${state.region_id}/${cropId}`);

      const body = {
        crop_id: cropId,
        region_id: state.region_id,
        area_acres: area,
        mandi_price_per_kg: priceInfo.current_price,
        irrigation_level: irrigation,
        soil: coerceNumeric(soilRaw),
        weather: coerceNumeric(weatherRaw),
        input_plan: budgetSplit(budget)
      };

      const res = await api('/api/simulate', { method: 'POST', body: JSON.stringify(body) });
      out.innerHTML = `
        <div class="kpi-grid">
          <div class="kpi kpi--good"><div class="kpi__lbl">Profit</div><div class="kpi__val">${INR(res.profit)}</div>
            <div class="kpi__sub">ROI ${PCT(res.roi_percent)}</div></div>
          <div class="kpi"><div class="kpi__lbl">Yield</div><div class="kpi__val">${Math.round(res.yield_kg_per_acre)} <span style="font-size:.5em;color:var(--ink-faint)">kg/ac</span></div></div>
          <div class="kpi"><div class="kpi__lbl">Risk</div><div class="kpi__val">${Math.round(res.risk_score)}/100</div></div>
        </div>
        <div style="font-size:.76rem;color:var(--ink-faint);margin-top:8px;">Priced at ${INR(priceInfo.current_price)}/kg — latest mandi observation for ${regionLabel(state.region_id)}.</div>`;
    } catch (err) {
      out.innerHTML = `<div class="alert alert--red"><div class="alert__body"><strong>Could not simulate.</strong><p>${err && err.message ? err.message : 'Please try again.'}</p></div></div>`;
    }
  }

  let tweakDebounce = null;
  function scheduleTweakSimulation() {
    $('#decideBudgetVal').textContent = INR($('#decideTweakBudget').value);
    $('#decideAreaVal').textContent = `${$('#decideTweakArea').value} ac`;
    $('#decideIrrigationVal').textContent = PCT(parseFloat($('#decideTweakIrrigation').value) * 100);
    clearTimeout(tweakDebounce);
    tweakDebounce = setTimeout(runTweakSimulation, 400);
  }

  function wireStep4() {
    document.addEventListener('decide:step-shown', (e) => {
      if (e.detail.step !== 4) return;
      $('#decideTweakBudget').value = state.budget_per_acre;
      $('#decideTweakArea').value = state.area_acres;
      $('#decideTweakIrrigation').value = state.irrigation_level;
      scheduleTweakSimulation();
    });
    ['decideTweakBudget', 'decideTweakArea', 'decideTweakIrrigation'].forEach((id) => {
      $(`#${id}`).addEventListener('input', () => {
        state.irrigation_level = parseFloat($('#decideTweakIrrigation').value);
        scheduleTweakSimulation();
      });
    });
    $('[data-step4-back]').addEventListener('click', goBack);
    $('#decideStep4Next').addEventListener('click', goNext);
  }
```

Update the boot block:

```js
  document.addEventListener('DOMContentLoaded', () => {
    wireStep1();
    wireStep2();
    wireStep3();
    wireStep4();
  });
```

- [ ] **Step 3: Verify in the browser**

Reach Step 4 via Steps 1–3. Expected:
- Sliders initialize to the values chosen in Step 2, and irrigation defaults to 0.5 (50%).
- A simulate result renders automatically on arrival.
- Dragging the budget slider updates the displayed ₹ value immediately and, after a brief pause (debounced), re-runs the simulation and updates profit/ROI/risk.
- In the Network tab (or `read_network_requests` if verifying via the browser tool), confirm requests to `/api/soil/{region_id}`, `/api/weather/{region_id}`, `/api/price-analytics/{region_id}/{crop_id}`, and `/api/simulate` fire on each slider change, not on every intermediate drag tick.
- Confirm the small "Priced at ₹X/kg — latest mandi observation for…" line under the KPI grid shows a real, non-zero number — concrete proof `mandi_price_per_kg` is coming from `/api/price-analytics`, not silently defaulting or failing validation.

- [ ] **Step 4: Commit**

```bash
git add frontend/decide.html frontend/decide.js
git commit -m "feat: add inline tweak-and-resimulate step to guided decision flow"
```

---

## Task 5: Step 5 (handoff) and entry points from `index.html` / `dashboard.html`

**Files:**
- Modify: `frontend/decide.html` (Step 5 section)
- Modify: `frontend/decide.js` (Step 5 logic)
- Modify: `frontend/index.html` (hero CTA)
- Modify: `frontend/dashboard.html` (sidebar entry link)

**Interfaces:**
- Consumes: `state` (all fields), `regionLabel()`.
- Produces: nothing — this is the flow's terminal step.

- [ ] **Step 1: Fill in Step 5's markup in `frontend/decide.html`**

Replace `<section class="decide-step" data-step="5"></section>` with:

```html
    <section class="decide-step" data-step="5">
      <div class="tool__head">
        <div class="tool__ico"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 18l6-6-6-6"/></svg></div>
        <div>
          <h2>What's next?</h2>
        </div>
      </div>
      <div class="decide-handoff">
        <button type="button" class="btn btn-ghost" disabled title="Reserved for a future feature: run this strategy under +1°C / +2°C / -20% rainfall scenarios.">
          How does this hold up in a bad year? <span class="decide-badge">Upcoming</span>
        </button>
        <a class="btn btn-primary" id="decideOpenDashboard" href="dashboard.html">Open full dashboard</a>
        <button type="button" class="btn btn-ghost" id="decideAskChat">Ask the chatbot</button>
      </div>
      <div class="decide-actions">
        <button type="button" class="btn btn-ghost" data-step5-back>Back</button>
        <span></span>
      </div>
    </section>
```

- [ ] **Step 2: Wire Step 5 in `frontend/decide.js`**

```js
  function wireStep5() {
    document.addEventListener('decide:step-shown', (e) => {
      if (e.detail.step !== 5) return;
      const top = state.recommendation && state.recommendation.top;
      const params = new URLSearchParams({
        tool: 'simulate',
        region_id: state.region_id || '',
        season: state.season || '',
        area_acres: state.area_acres || '',
        budget_per_acre: state.budget_per_acre || ''
      });
      if (top) params.set('crop_id', top.crop_id);
      $('#decideOpenDashboard').href = `dashboard.html?${params.toString()}`;
    });

    $('[data-step5-back]').addEventListener('click', goBack);

    $('#decideAskChat').addEventListener('click', () => {
      document.querySelector('.mm-chat-fab')?.click();
    });
  }
```

Update the boot block:

```js
  document.addEventListener('DOMContentLoaded', () => {
    wireStep1();
    wireStep2();
    wireStep3();
    wireStep4();
    wireStep5();
  });
```

- [ ] **Step 3: Point `index.html`'s primary hero CTA at the new flow**

In `frontend/index.html`, find (around line 92-96):

```html
        <div class="hero__cta">
          <a href="dashboard.html" class="btn btn-primary">
            Explore your land
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12h14M13 5l7 7-7 7"/></svg>
          </a>
```

Replace with:

```html
        <div class="hero__cta">
          <a href="decide.html" class="btn btn-primary">
            Tell us what to plant
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12h14M13 5l7 7-7 7"/></svg>
          </a>
```

Leave the secondary "Try demo" link untouched — it still scrolls to the on-page demo.

- [ ] **Step 4: Add a sidebar entry link on `dashboard.html`**

In `frontend/dashboard.html`, immediately after `<aside class="sidebar">` (around line 76), insert:

```html
      <aside class="sidebar">
        <a href="decide.html" class="btn btn-primary" style="display:flex;justify-content:center;margin:0 0 16px;">New here? Get one answer →</a>
        <div class="sidebar__group">
```

(Only the new `<a>` line is added; the existing `<div class="sidebar__group">` that follows is unchanged, just now preceded by the link.)

- [ ] **Step 5: Verify in the browser**

- From `index.html`, click the hero's primary CTA — it should land on `decide.html`, not `dashboard.html`.
- From `dashboard.html`, confirm the new "New here? Get one answer →" link appears above the first sidebar group and navigates to `decide.html`.
- Complete the full 5-step flow. On Step 5: the disabled "bad year" button shows an "Upcoming" badge and a tooltip on hover; "Open full dashboard" navigates to `dashboard.html` with `tool=simulate` and the chosen region/season/crop pre-filled — confirm the simulate tool actually shows those values on arrival; "Ask the chatbot" opens the floating chat widget without navigating away.
- Click "Back" from Step 5 through to Step 1 and confirm every step still shows its previously-entered values (state was never cleared).

- [ ] **Step 6: Commit**

```bash
git add frontend/decide.html frontend/decide.js frontend/index.html frontend/dashboard.html
git commit -m "feat: add handoff step and wire guided decision flow entry points"
```

---

## Task 6: Offline precache and i18n catalog

**Files:**
- Modify: `frontend/sw.js`
- Modify: `frontend/i18n-data.js`

**Interfaces:**
- Consumes: nothing new — this task only registers files/strings that Tasks 1–5 already created.
- Produces: nothing later tasks depend on.

- [ ] **Step 1: Add the three new files to the service worker's precache list and bump `VERSION`**

In `frontend/sw.js`, change:

```js
const VERSION = 'mittimantra-v50';
```

to:

```js
const VERSION = 'mittimantra-v51';
```

And in the `CORE` array, add the three new files (placed near their related existing entries — `region-geo.js` next to the other data files, `decide.html`/`decide.js` next to the other page pairs):

```js
const CORE = [
  './',
  './index.html',
  './dashboard.html',
  './decide.html',
  './farm-boundary.html',
  './marketplace.html',
  './gyan-seva.html',
  './book-a-tractor.html',
  './login.html',
  './style.css',
  './assets/logo-128.png',
  './assets/logo-192.png',
  './assets/logo-512.png',
  './site-ui.js',
  './state-data.js',
  './region-geo.js',
  './india-globe.js',
  './scene3d-loader.js',
  './demo-recommender.js',
  './dashboard.js',
  './decide.js',
  './offline-simulator.js',
  './farm-boundary.js',
  './farm-state.js',
  './i18n-data.js',
  './i18n.js',
  './toolbar.js',
  './mm-core.js',
  './mm-analytics.js',
  './mm-freshness.js',
  './mm-plots.js',
  './mm-enhance.js',
  './chatbot.js',
  './marketplace.js',
  './gyan-seva.js',
  './book-a-tractor.js',
  './map-tractors.js',
  './auth.js',
  './Data/marketplace-listings.js',
  './Data/india-states.geo.json',
```

(The remaining entries below this point — the `.webp` marketplace images and anything after — are unchanged; only the three new lines and the bumped `VERSION` are new.)

- [ ] **Step 2: Add new-string translations to `frontend/i18n-data.js`**

`i18n.js` looks up each DOM text node by its exact trimmed string (`i18n.js:80-90`) — a button rendered as `Next →` will never match a catalog entry keyed `'Next'`. This is why Tasks 1-5's Next/Back/"Open full dashboard" buttons carry no arrow character: an arrow icon would need to be a separate element (the pattern `index.html`'s own buttons already use — an inline `<svg>`, never a literal `→`/`←` in the text), and plain text is the simpler fix here. Don't reintroduce arrow characters into these three labels — doing so silently breaks their translation with no error anywhere.

For each string below, check whether the exact English key already exists anywhere in `CATALOG.hi`/`.te`/`.kn` first (several form-field labels this page reuses — `'Region'`, `'Season'`, `'Area (acres)'`, `'Budget / acre (₹)'`, `'Kharif'`, `'Rabi'`, `'Run recommendation'`, `'Upcoming'` — already exist and need no new entry; `decide.html`/`decide.js` reuse those exact strings verbatim rather than inventing new wording). Add only the entries below, which are genuinely new, to the `hi`, `te`, and `kn` blocks of `CATALOG` (one key/value pair per language block, matching the file's existing structure). These are a first-pass translation of short, common UI phrases — worth a native-speaker review pass before this ships to real farmers, same bar the file's own header comment holds the rest of the catalog to.

```js
// Add to CATALOG.hi:
'Where\'s your farm?': 'आपका खेत कहाँ है?',
'Pick your region, or let us find it.': 'अपना क्षेत्र चुनें, या हमें ढूंढने दें।',
'Use my location': 'मेरा स्थान उपयोग करें',
'Finding your location…': 'आपका स्थान खोजा जा रहा है…',
'This device cannot share its location. Search for your region instead.': 'यह डिवाइस अपना स्थान साझा नहीं कर सकता। इसके बजाय अपना क्षेत्र खोजें।',
'Location permission denied. Allow it in your browser, or search for your region.': 'स्थान की अनुमति नहीं दी गई। इसे अपने ब्राउज़र में अनुमति दें, या अपना क्षेत्र खोजें।',
'Could not get a GPS fix in time. Try again outdoors, or search for your region.': 'समय पर GPS सिग्नल नहीं मिला। बाहर फिर से कोशिश करें, या अपना क्षेत्र खोजें।',
'Location unavailable. Search for your region instead.': 'स्थान उपलब्ध नहीं है। इसके बजाय अपना क्षेत्र खोजें।',
'Use this': 'इसे उपयोग करें',
'When and how much?': 'कब और कितना?',
'Tell us your season, budget, and land.': 'अपना मौसम, बजट और ज़मीन बताएं।',
'Your answer': 'आपका जवाब',
'Full ranking': 'पूरी रैंकिंग',
'Tweak it': 'इसे समायोजित करें',
'See how budget and irrigation change the outcome.': 'देखें कि बजट और सिंचाई परिणाम को कैसे बदलते हैं।',
'Irrigation level': 'सिंचाई स्तर',
'What\'s next?': 'आगे क्या?',
'How does this hold up in a bad year?': 'खराब साल में यह कैसा रहेगा?',
'Open full dashboard': 'पूरा डैशबोर्ड खोलें',
'Ask the chatbot': 'चैटबॉट से पूछें',
'Next': 'आगे',
'Back': 'पीछे',
'Tell us what to plant': 'बताएं क्या बोना है',
'New here? Get one answer': 'नए हैं? एक जवाब पाएं',

// Add to CATALOG.te:
'Where\'s your farm?': 'మీ పొలం ఎక్కడ ఉంది?',
'Pick your region, or let us find it.': 'మీ ప్రాంతాన్ని ఎంచుకోండి, లేదా మేము కనుగొననివ్వండి.',
'Use my location': 'నా లొకేషన్ ఉపయోగించండి',
'Finding your location…': 'మీ లొకేషన్ కనుగొంటోంది…',
'This device cannot share its location. Search for your region instead.': 'ఈ పరికరం తన లొకేషన్‌ను షేర్ చేయలేదు. బదులుగా మీ ప్రాంతాన్ని వెతకండి.',
'Location permission denied. Allow it in your browser, or search for your region.': 'లొకేషన్ అనుమతి తిరస్కరించబడింది. మీ బ్రౌజర్‌లో అనుమతించండి, లేదా మీ ప్రాంతాన్ని వెతకండి.',
'Could not get a GPS fix in time. Try again outdoors, or search for your region.': 'సమయానికి GPS సిగ్నల్ లభించలేదు. బయట మళ్ళీ ప్రయత్నించండి, లేదా మీ ప్రాంతాన్ని వెతకండి.',
'Location unavailable. Search for your region instead.': 'లొకేషన్ అందుబాటులో లేదు. బదులుగా మీ ప్రాంతాన్ని వెతకండి.',
'Use this': 'దీన్ని ఉపయోగించండి',
'When and how much?': 'ఎప్పుడు మరియు ఎంత?',
'Tell us your season, budget, and land.': 'మీ సీజన్, బడ్జెట్ మరియు భూమిని తెలియజేయండి.',
'Your answer': 'మీ సమాధానం',
'Full ranking': 'పూర్తి ర్యాంకింగ్',
'Tweak it': 'దీన్ని సర్దుబాటు చేయండి',
'See how budget and irrigation change the outcome.': 'బడ్జెట్ మరియు నీటిపారుదల ఫలితాన్ని ఎలా మారుస్తాయో చూడండి.',
'Irrigation level': 'నీటిపారుదల స్థాయి',
'What\'s next?': 'తర్వాత ఏమిటి?',
'How does this hold up in a bad year?': 'చెడు సంవత్సరంలో ఇది ఎలా ఉంటుంది?',
'Open full dashboard': 'పూర్తి డాష్‌బోర్డ్ తెరవండి',
'Ask the chatbot': 'చాట్‌బాట్‌ను అడగండి',
'Next': 'తదుపరి',
'Back': 'వెనుకకు',
'Tell us what to plant': 'ఏమి నాటాలో చెప్పండి',
'New here? Get one answer': 'కొత్తగా వచ్చారా? ఒక సమాధానం పొందండి',

// Add to CATALOG.kn:
'Where\'s your farm?': 'ನಿಮ್ಮ ಹೊಲ ಎಲ್ಲಿದೆ?',
'Pick your region, or let us find it.': 'ನಿಮ್ಮ ಪ್ರದೇಶವನ್ನು ಆಯ್ಕೆಮಾಡಿ, ಅಥವಾ ನಾವು ಕಂಡುಹಿಡಿಯಲು ಬಿಡಿ.',
'Use my location': 'ನನ್ನ ಸ್ಥಳ ಬಳಸಿ',
'Finding your location…': 'ನಿಮ್ಮ ಸ್ಥಳ ಹುಡುಕಲಾಗುತ್ತಿದೆ…',
'This device cannot share its location. Search for your region instead.': 'ಈ ಸಾಧನವು ತನ್ನ ಸ್ಥಳವನ್ನು ಹಂಚಿಕೊಳ್ಳಲು ಸಾಧ್ಯವಿಲ್ಲ. ಬದಲಿಗೆ ನಿಮ್ಮ ಪ್ರದೇಶವನ್ನು ಹುಡುಕಿ.',
'Location permission denied. Allow it in your browser, or search for your region.': 'ಸ್ಥಳದ ಅನುಮತಿ ನಿರಾಕರಿಸಲಾಗಿದೆ. ನಿಮ್ಮ ಬ್ರೌಸರ್‌ನಲ್ಲಿ ಅನುಮತಿಸಿ, ಅಥವಾ ನಿಮ್ಮ ಪ್ರದೇಶವನ್ನು ಹುಡುಕಿ.',
'Could not get a GPS fix in time. Try again outdoors, or search for your region.': 'ಸಮಯಕ್ಕೆ GPS ಸಿಗ್ನಲ್ ಸಿಗಲಿಲ್ಲ. ಹೊರಗೆ ಮತ್ತೆ ಪ್ರಯತ್ನಿಸಿ, ಅಥವಾ ನಿಮ್ಮ ಪ್ರದೇಶವನ್ನು ಹುಡುಕಿ.',
'Location unavailable. Search for your region instead.': 'ಸ್ಥಳ ಲಭ್ಯವಿಲ್ಲ. ಬದಲಿಗೆ ನಿಮ್ಮ ಪ್ರದೇಶವನ್ನು ಹುಡುಕಿ.',
'Use this': 'ಇದನ್ನು ಬಳಸಿ',
'When and how much?': 'ಯಾವಾಗ ಮತ್ತು ಎಷ್ಟು?',
'Tell us your season, budget, and land.': 'ನಿಮ್ಮ ಋತು, ಬಜೆಟ್ ಮತ್ತು ಭೂಮಿಯನ್ನು ತಿಳಿಸಿ.',
'Your answer': 'ನಿಮ್ಮ ಉತ್ತರ',
'Full ranking': 'ಪೂರ್ಣ ಶ್ರೇಣಿ',
'Tweak it': 'ಇದನ್ನು ಹೊಂದಿಸಿ',
'See how budget and irrigation change the outcome.': 'ಬಜೆಟ್ ಮತ್ತು ನೀರಾವರಿ ಫಲಿತಾಂಶವನ್ನು ಹೇಗೆ ಬದಲಾಯಿಸುತ್ತವೆ ಎಂದು ನೋಡಿ.',
'Irrigation level': 'ನೀರಾವರಿ ಮಟ್ಟ',
'What\'s next?': 'ಮುಂದೇನು?',
'How does this hold up in a bad year?': 'ಕೆಟ್ಟ ವರ್ಷದಲ್ಲಿ ಇದು ಹೇಗಿರುತ್ತದೆ?',
'Open full dashboard': 'ಪೂರ್ಣ ಡ್ಯಾಶ್‌ಬೋರ್ಡ್ ತೆರೆಯಿರಿ',
'Ask the chatbot': 'ಚಾಟ್‌ಬಾಟ್ ಅನ್ನು ಕೇಳಿ',
'Next': 'ಮುಂದೆ',
'Back': 'ಹಿಂದೆ',
'Tell us what to plant': 'ಏನು ನೆಡಬೇಕೆಂದು ಹೇಳಿ',
'New here? Get one answer': 'ಹೊಸಬರೇ? ಒಂದು ಉತ್ತರ ಪಡೆಯಿರಿ',
```

The "Closest match… km away — is this right?" status message (Task 1) is built from dynamic, per-request text (a region name and a live-computed distance) rather than one fixed sentence, so it is intentionally left out of the catalog — same pattern the codebase already accepts elsewhere (e.g. `mm-enhance.js`'s dynamically-rendered reasoning text is not translated either). It stays in English regardless of site language; that is a known, accepted limitation class in this codebase, not a regression this feature introduces.

- [ ] **Step 3: Verify in the browser**

- With the browser's dev tools set to offline (or airplane mode), reload a page you've already visited once, then navigate to `decide.html` — it should load from cache rather than showing the browser's offline error page.
- On `decide.html`, use the language switcher pill (bottom of screen, injected by `i18n.js`) to switch to Hindi. Confirm Step 1's heading changes to "आपका खेत कहाँ है?" and the "Next"/"Back" button labels translate. Switch to Telugu and Kannada and spot-check the same.
- Switch back to English and confirm everything reverts.

- [ ] **Step 4: Commit**

```bash
git add frontend/sw.js frontend/i18n-data.js
git commit -m "feat: precache guided decision flow and add its i18n translations"
```

---

## Self-Review Notes

**Spec coverage:** §5 steps 1-5 → Tasks 1-5. §6.1 new files → Task 1 (all three). §6.2 endpoints → Tasks 1 (`/api/regions`), 3 (`/api/crop`), 4 (`/api/soil`, `/api/weather`, `/api/simulate`, plus `/api/price-analytics` — added during plan-writing after discovering `SimulationRequest.mandi_price_per_kg` is required with no default and `dashboard.js`'s own simulate tool only sources it from manual text entry, which doesn't fit this step's sliders-only design; the spec's §6.2 table has been updated to match). §6.3 reuse recipe → Task 4. §6.4 explainability reuse → Task 3. §6.5 geolocation fallback → Task 1. §6.6 offline/PWA → Task 6 Step 1 (precache is deferred to a dedicated task rather than done per-file, since it only makes sense once every file that needs precaching exists — noted here since it's a deliberate deviation from strict per-task-does-everything). §6.7 i18n → Task 6 Step 2. §6.8 entry points → Task 5 Steps 3-4. §7 error handling → Tasks 1, 3, 4 (each API call's catch branch). §9 deferred stress-test hook → Task 5's disabled button.

**Type/name consistency check:** `state` object shape is defined once in Task 1 and only ever extended (never redefined) in Tasks 2-5. `api()`/`HttpError`/`showStep`/`goNext`/`goBack`/`regionLabel`/`$`/`$$` are defined once in Task 1 and reused by name in every later task without redefinition. `INR`/`FIX`/`PCT` are defined in Task 3 (first task that needs them) and reused as-is in Task 4. Verified the `.list-row`/`.kpi` class names and the `data-out="recommend"` value match `mm-enhance.js`'s actual matching logic (read directly from source, not assumed from `FRONTEND.md`, which was already found stale on two related points during spec-writing).

**Placeholder scan:** no TBD/TODO; every code block is complete, runnable code, not a description of code.
