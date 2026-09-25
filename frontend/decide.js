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

  /* ---------- formatting helpers ---------- */
  const INR = n => '₹' + Math.round(Number(n) || 0).toLocaleString('en-IN');
  const FIX = (n, d = 1) => (Number(n) || 0).toFixed(d);
  const PCT = n => FIX(n, 1) + '%';

  /* ---------- wizard state + step navigation ---------- */
  const state = {
    region_id: null, region_name: null,
    season: null, area_acres: null, budget_per_acre: null,
    irrigation_level: 0.5,
    recommendation: null
  };
  // Steps 4-5 (tweak-and-resimulate, commit) are planned but not built yet
  // -- see docs/superpowers/plans/2026-08-31-guided-decision-flow.md. Until
  // they are, the answer is the last step rather than a way into a blank page.
  const TOTAL_STEPS = 3;
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

  /* ---------- Step 2: season, budget, area ---------- */
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
      // New inputs need a new answer -- step 3 only fetches when none is held.
      state.recommendation = null;
      goNext();
    });
  }

  /* ---------- Step 3: recommendation answer ---------- */
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

  /* ---------- boot ---------- */
  document.addEventListener('DOMContentLoaded', () => {
    wireStep1();
    wireStep2();
    wireStep3();
  });

  // Exposed for later tasks (2-5) to extend without redefining shared plumbing.
  window.MMDecide = { api, HttpError, state, showStep, goNext, goBack, regionLabel, $, $$ };
})();
