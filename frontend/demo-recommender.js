/* =========================================================
   Mitti Mantra — landing-page hero: "Is baar kya boyein?"

   Answers the headline question for the visitor's own district with the
   same call the dashboard's My Farm tab makes
   (/api/crop-comparison/{region}/{season}), so the landing page and the
   dashboard can never disagree about the top crop.

   This file used to rank crops with an on-page heuristic that charged every
   crop the visitor's budget as its whole cost. Sugarcane on ₹15,000/acre came
   out at 1,140% ROI -- the most visible number on the page, and wrong. There
   is no heuristic any more: the answer is the live model's, or a copy of it
   saved on this phone, or an honest "connect once" message.

   Also fills the stats paragraph's model figures from /api/ml/status.
   ========================================================= */

(() => {
  'use strict';

  const form = document.getElementById('askForm');
  const rowsEl = document.getElementById('askRows');
  if (!form || !rowsEl) return;

  const regionSel = document.getElementById('askRegion');
  const seasonSel = document.getElementById('askSeason');
  const areaInp = document.getElementById('askArea');
  const budgetInp = document.getElementById('askBudget');
  const whereEl = document.getElementById('askWhere');
  const srcEl = document.getElementById('askSrc');
  const ctaEl = document.getElementById('askCta');

  // Fallback only: MM.defaultRegion() is the one default every page shares
  // (profile, else Sehore -- the district the feature previews further down use).
  const DEFAULT_REGION = 'mp_sehore';
  const SAVED_KEY = 'mm_ask_saved_v1';

  const esc = (s) => (window.MM && window.MM.escapeHtml)
    ? window.MM.escapeHtml(s)
    : String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const inr = (n) => '₹' + Math.round(Number(n) || 0).toLocaleString('en-IN');
  const seasonName = (s) => ({ kharif: 'Kharif', rabi: 'Rabi', zaid: 'Zaid' }[s] || s);

  // Same thresholds as My Farm's risk tile (dashboard.js riskInfo, which reads
  // resilience = 100 - risk_score), so one crop never gets two risk words.
  function riskWord(score) {
    const v = Number(score) || 0;
    if (v <= 30) return { text: 'Low risk', cls: 'is-low' };
    if (v <= 60) return { text: 'Medium risk', cls: 'is-mid' };
    return { text: 'High risk', cls: 'is-high' };
  }

  function retranslate() {
    const i18n = window.AgriSimI18n;
    if (i18n && i18n.getLanguage && i18n.getLanguage() !== 'en') i18n.retranslate();
  }

  /* ---------- Saved answers (offline) ---------- */
  function readSaved() {
    try { return JSON.parse(localStorage.getItem(SAVED_KEY) || '{}') || {}; } catch (_) { return {}; }
  }
  function saveAnswer(key, recs) {
    try {
      const all = readSaved();
      all[key] = { at: Date.now(), recs };
      // Keep the six most recent questions -- enough for a farmer comparing a
      // few budgets, small enough to never matter for storage.
      const keys = Object.keys(all).sort((a, b) => all[b].at - all[a].at);
      keys.slice(6).forEach((k) => delete all[k]);
      localStorage.setItem(SAVED_KEY, JSON.stringify(all));
    } catch (_) { /* private mode: the live answer still shows */ }
  }

  /* ---------- Regions ---------- */
  async function loadRegions() {
    let regions = [];
    try {
      const get = () => fetch('/api/regions').then((r) => { if (!r.ok) throw new Error(r.status); return r.json(); });
      regions = (window.MM && window.MM.memoGet)
        ? await window.MM.memoGet('/api/regions', 5 * 60 * 1000, get)
        : await get();
      regions = (regions || []).map((r) => ({ id: r.id || r.region_id, name: r.name || r.region_name || r.id }));
    } catch (_) {
      // Offline: farm-state.js ships the same 30 districts with their names.
      const table = (window.FarmState && window.FarmState.REGION_CENTROIDS) || [];
      regions = table.map((r) => ({ id: r.region_id, name: r.displayName }));
    }
    regionSel.innerHTML = regions.map((r) =>
      `<option value="${esc(r.id)}">${esc(r.name)}</option>`).join('');
  }

  // A returning visitor sees their own farm, not the demo district.
  function applyProfile() {
    const p = window.MM && window.MM.profile ? window.MM.profile.get() : null;
    const want = (window.MM && window.MM.defaultRegion) ? window.MM.defaultRegion() : ((p && p.region_id) || DEFAULT_REGION);
    if (Array.from(regionSel.options).some((o) => o.value === want)) regionSel.value = want;
    if (p) {
      if (p.season) seasonSel.value = p.season;
      if (Number(p.area_acres) > 0) areaInp.value = p.area_acres;
      if (Number(p.budget_per_acre) > 0) budgetInp.value = p.budget_per_acre;
    }
  }

  /* ---------- Rendering ---------- */
  function setBusy(busy) {
    rowsEl.setAttribute('aria-busy', busy ? 'true' : 'false');
    form.querySelector('.ask__go').disabled = busy;
  }

  function note(html) {
    rowsEl.innerHTML = `<li class="answer__note">${html}</li>`;
  }

  function whyLine(r) {
    // A crop nobody in the district has a harvest record for can still be the
    // best answer on paper; say so, since there will be no neighbours, seed
    // dealers or buyers who know it.
    const local = r.grown_locally === false ? ' · <span class="answer__new">Not grown in this district before</span>' : '';
    if (r.budget_adequate !== false) return '<span>Fits your budget</span>' + local;
    const m = /(\d+)%/.exec(r.reason || '');
    return (m
      ? `<span>Usual cost covered</span>: <b>${m[1]}%</b> · <span>yield scaled to match</span>`
      : '<span>Budget below this crop&rsquo;s usual cost</span>') + local;
  }

  function render(q, recs, source) {
    // Same rule as My Farm: never offer a loss-maker as a top pick while
    // profitable crops exist.
    const profitable = recs.filter((r) => r.expected_profit > 0);
    const top = (profitable.length ? profitable : recs).slice(0, 3);
    if (!top.length) {
      note('No crops could be ranked for this district and season yet. Try another season.');
      return;
    }
    rowsEl.innerHTML = top.map((r, i) => {
      const risk = riskWord(r.risk_score);
      const loss = r.expected_profit < 0;
      return `
        <li class="answer__row" style="--i:${i}">
          <span class="answer__rank">${i + 1}</span>
          <div class="answer__crop">
            <b data-no-translate>${esc(r.crop_name || r.crop_id)}</b>
            <small>ROI ${Math.round(r.roi_percent)}% · <span class="answer__risk ${risk.cls}">${risk.text}</span></small>
          </div>
          <div class="answer__money${loss ? ' is-loss' : ''}">
            <b>${inr(r.expected_profit)}</b>
            <small><span>${loss ? 'Expected loss' : 'Profit'}</span> · ${esc(q.area_acres)} ac</small>
          </div>
          <p class="answer__why">${whyLine(r)}</p>
        </li>`;
    }).join('');

    // Phase 2 rows rest on the district's own yield record (district_record,
    // yield_model); ml_model is the older model; heuristic is the formula.
    const record = top.some((r) => r.prediction_source === 'district_record' || r.prediction_source === 'yield_model');
    const model = top.some((r) => r.prediction_source === 'ml_model');
    if (source === 'live') {
      srcEl.innerHTML = record ? '<span>Ranked on this district\'s yield records</span>'
        : model ? '<span>Ranked by the live model</span>' : '<span>Ranked by the rule-based engine</span>';
    } else {
      const d = new Date(source.at).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
      srcEl.innerHTML = `<span>You're offline — saved answer from</span> ${esc(d)}`;
    }
    retranslate();
  }

  function queryFromForm() {
    return {
      region_id: regionSel.value,
      season: seasonSel.value,
      area_acres: Math.max(0.1, parseFloat(areaInp.value) || 4),
      budget_per_acre: Math.max(1000, parseFloat(budgetInp.value) || 15000),
    };
  }

  let seq = 0;
  async function run() {
    const q = queryFromForm();
    if (!q.region_id) return;
    const mySeq = ++seq;
    const regionLabel = regionSel.options[regionSel.selectedIndex]?.text || q.region_id;
    whereEl.textContent = `${regionLabel} · ${seasonName(q.season)} · ${q.area_acres} ac · ${inr(q.budget_per_acre)}/ac`;

    // "Plan this" opens the full recommender with these inputs. mm-core's
    // deep-link handler only seeds profile fields that are still empty, so a
    // visitor with a saved farm keeps it.
    const link = new URLSearchParams({ tool: 'recommend', ...q });
    ctaEl.href = 'dashboard.html?' + link.toString();

    const key = [q.region_id, q.season, q.area_acres, q.budget_per_acre].join('|');
    setBusy(true);
    srcEl.textContent = '';
    note('Ranking crops for your district…');
    retranslate();
    try {
      const qs = new URLSearchParams({ budget_per_acre: q.budget_per_acre, area_acres: q.area_acres });
      const res = await fetch(`/api/crop-comparison/${encodeURIComponent(q.region_id)}/${encodeURIComponent(q.season)}?${qs}`);
      if (!res.ok) throw Object.assign(new Error('http'), { status: res.status });
      const recs = await res.json();
      if (mySeq !== seq) return;
      if (!Array.isArray(recs)) throw new Error('shape');
      saveAnswer(key, recs);
      render(q, recs, 'live');
    } catch (err) {
      if (mySeq !== seq) return;
      const saved = readSaved()[key];
      if (saved && Array.isArray(saved.recs)) { render(q, saved.recs, saved); return; }
      note(err && err.status
        ? 'Couldn&rsquo;t rank crops just now. Try again in a moment, or open the dashboard.'
        : 'You&rsquo;re offline, and this question hasn&rsquo;t been asked on this phone before. Connect once and the answer is saved for next time.');
      retranslate();
    } finally {
      if (mySeq === seq) setBusy(false);
    }
  }

  form.addEventListener('submit', (e) => { e.preventDefault(); run(); });
  // A new region or season re-reads its typical budget before ranking.
  [regionSel, seasonSel].forEach((el) => el.addEventListener('change', () => { applyTypicalBudget().then(run); }));

  /* ---------- Model figures in the stats section ---------- */
  async function fillModelStats() {
    const yieldEl = document.querySelector('[data-ml="yield"]');
    const recEl = document.querySelector('[data-ml="recommend"]');
    if (!yieldEl && !recEl) return;
    try {
      const r = await fetch('/api/ml/status');
      if (!r.ok) return;
      const models = ((await r.json()).training_report || {}).models || [];
      const find = (name) => models.find((m) => m.model === name);
      const y = find('yield_prediction');
      const c = find('crop_recommendation');
      if (yieldEl && y && y.metrics && isFinite(y.metrics.r2)) {
        yieldEl.textContent = `R² ${Number(y.metrics.r2).toFixed(2)}`;
      }
      if (recEl && c && c.metrics && isFinite(c.metrics.accuracy)) {
        const n = c.metrics.num_classes;
        recEl.textContent = `${Math.round(c.metrics.accuracy * 100)}% top-1 accuracy${n ? ` across ${n} crops` : ''}`;
      }
    } catch (_) { /* keep the printed fallback */ }
  }

  // Budget follows the typical input cost for the chosen region and season
  // until the visitor types their own (defect N-7: a flat ₹15,000 sat below
  // the cost of rice and cotton, so the default ranking underfunded both).
  const hintEl = document.getElementById('askBudgetHint');
  let budgetTyped = false;
  budgetInp.addEventListener('input', () => { budgetTyped = true; });
  async function applyTypicalBudget() {
    if (!window.MM || !window.MM.defaultBudget || !regionSel.value) return;
    try {
      const typical = await window.MM.defaultBudget(regionSel.value, seasonSel.value);
      if (!budgetTyped) budgetInp.value = typical;
      if (hintEl) {
        hintEl.innerHTML = `<span>Typical cost here</span>: ${esc(inr(typical))}/acre`;
        retranslate();
      }
    } catch (_) { /* offline: keep the field as it is */ }
  }

  (async () => {
    await loadRegions();
    applyProfile();
    const p = window.MM && window.MM.profile ? window.MM.profile.get() : null;
    if (p && Number(p.budget_per_acre) > 0) budgetTyped = true;
    await applyTypicalBudget();
    run();
    fillModelStats();
  })();
})();
