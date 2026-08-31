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
