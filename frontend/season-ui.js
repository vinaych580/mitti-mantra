(() => {
  'use strict';
  const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const t = s => window.AgriSimI18n?.t(s) || s;
  const text = s => `<span data-i18n>${esc(t(s))}</span>`;
  const money = n => n !== null && n !== undefined && Number.isFinite(Number(n)) ? '₹' + Math.round(n).toLocaleString('en-IN') : '—';
  // Dates follow the page language (N-29); digits stay Indian-grouped.
  const LOCALES = {en:'en-IN', hi:'hi-IN', te:'te-IN', kn:'kn-IN', ta:'ta-IN'};
  const locale = () => LOCALES[window.AgriSimI18n?.getLanguage?.() || 'en'] || 'en-IN';
  const date = d => {
    const parsed = d ? new Date(d) : null;
    return parsed && !Number.isNaN(parsed.getTime())
      ? parsed.toLocaleDateString(locale(), {day:'numeric', month:'short', year:'numeric'}) : t('Unknown date');
  };
  const translate = () => window.AgriSimI18n?.retranslate?.();
  // crypto.randomUUID needs a secure context; a LAN address over plain HTTP
  // has none, and the call used to throw there (N-31).
  function uuid() {
    if (globalThis.crypto?.randomUUID) {
      try { return globalThis.crypto.randomUUID(); } catch (_) { /* insecure context */ }
    }
    const b = new Uint8Array(16);
    if (globalThis.crypto?.getRandomValues) globalThis.crypto.getRandomValues(b);
    else for (let i = 0; i < 16; i++) b[i] = Math.floor(Math.random() * 256);
    b[6] = (b[6] & 0x0f) | 0x40; b[8] = (b[8] & 0x3f) | 0x80;
    const h = Array.from(b, x => x.toString(16).padStart(2, '0')).join('');
    return `${h.slice(0,8)}-${h.slice(8,12)}-${h.slice(12,16)}-${h.slice(16,20)}-${h.slice(20)}`;
  }
  // Offline copies of responses. Each slider position used to add a full
  // response that was never evicted, until the quota filled and saving a
  // plan failed (N-13). Keep the newest CACHE_LIMIT, oldest out first.
  const CACHE_PREFIX = 'mm_season_cache:';
  const CACHE_INDEX = 'mm_season_cache_index_v1';
  const CACHE_LIMIT = 20;
  function cacheIndex() {
    try { const v = JSON.parse(localStorage.getItem(CACHE_INDEX) || '[]'); return Array.isArray(v) ? v : []; }
    catch (_) { return []; }
  }
  function cachePut(key, data) {
    let index = cacheIndex().filter(k => k !== key);
    // Entries written before the index existed are adopted, then evicted in turn.
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && k.startsWith(CACHE_PREFIX) && k !== key && !index.includes(k)) index.unshift(k);
    }
    index.push(key);
    while (index.length > CACHE_LIMIT) { try { localStorage.removeItem(index.shift()); } catch (_) {} }
    try {
      localStorage.setItem(key, JSON.stringify(data));
      localStorage.setItem(CACHE_INDEX, JSON.stringify(index));
    } catch (_) {
      // Quota: drop the oldest half and give up quietly; the network answer stands.
      index.splice(0, Math.ceil(index.length / 2)).forEach(k => { try { localStorage.removeItem(k); } catch (_) {} });
      try { localStorage.setItem(CACHE_INDEX, JSON.stringify(index)); } catch (_) {}
    }
  }
  async function request(url, body) {
    const key = CACHE_PREFIX + url + ':' + JSON.stringify(body || null);
    let response;
    try {
      response = await fetch(url, { signal: AbortSignal.timeout(20000),
        ...(body ? {method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify(body)} : {}) });
    } catch (error) {
      let cached;
      try { cached = JSON.parse(localStorage.getItem(key) || 'null'); } catch (_) {}
      if (cached) return { data: cached, cached: true };
      throw new Error(t('Connect to load these estimates. Previously saved plans remain available offline.'));
    }
    if (!response.ok) {
      const error = await response.json().catch(() => ({}));
      throw new Error(typeof error.detail === 'string' ? error.detail : t('Could not load estimates. Check your inputs and try again.'));
    }
    const data = await response.json();
    cachePut(key, data);
    return {data, cached:false};
  }
  function evidence(c, report) {
    const sources = (c.sources || []).filter(s => ['soil','weather','mandi_prices','yield_history'].includes(s.id));
    return `<details><summary>${text('Sources and evidence')}</summary>
      <p>${text('Development estimates. Independent field validation has not been established.')}</p>
      <p>${text('Estimate generated')} <time>${esc(date(c.generated_at))}</time> · ${text('Model version')} <code>${esc(c.model_version)}</code></p>
      <ul class="season-list">${sources.map(s => `<li>${text(SOURCE_NAMES[s.id] || s.label || s.id)} · ${text(SOURCE_MODES[s.mode] || s.mode || 'Unknown source')} · ${s.as_of ? `<time>${esc(/^\d{4}$/.test(String(s.as_of)) ? s.as_of : date(s.as_of))}</time>` : text('Unknown date')} · ${text(STALENESS[s.staleness] || 'Freshness unknown')}</li>`).join('')}</ul>
      <p>${text('Prices are repository references, not live sale offers.')}</p>
      ${report?.status === 'repository_holdout' ? `<p>${text('Repository holdout evaluation')} · ${report.overall.samples} ${text('samples')} · ${text('Mean absolute yield error')} ${esc(report.overall.mae_kg_per_acre)} ${text('kg/acre')}</p>
      <p>${text('Experimental interval coverage')} ${Math.round(report.overall.coverage * 100)}% · ${text('Target')} 90%</p>
      <p>${text('Measured on a separate evaluation split. This does not validate profit estimates or weather scenarios.')}</p>
      <div class="season-table-wrap"><table class="season-table"><caption>${text('Evidence for this shortlist and region')}</caption><thead><tr><th>${text('Group')}</th><th>${text('Samples')}</th><th>${text('Yield error (kg/acre)')}</th><th>${text('Coverage')}</th></tr></thead><tbody>${[
        ...c.crops.map(x => [x.crop_name, report.by_crop?.[x.crop_id]]), [regionName(c.inputs.region_id), report.by_region?.[c.inputs.region_id]]
      ].map(([label, r]) => `<tr><th data-no-translate>${esc(label)}</th><td>${r?.samples ?? '—'}</td><td>${r?.mae_kg_per_acre ?? '—'}</td><td>${r ? Math.round(r.coverage * 100)+'%' : '—'}${r?.small_sample ? `<small>${text('Small sample; interpret cautiously')}</small>` : ''}</td></tr>`).join('')}</tbody></table></div>
      <p>${text(report.field_evaluation ? 'User-supplied field observations are available; provenance has not been independently verified.' : 'No independent field observations have been supplied.')}</p>` : `<p>${text('Matching model evaluation is unavailable. No accuracy claim is made.')}</p>`}
      </details>`;
  }
  const SOURCE_NAMES = {mandi_prices:'Mandi prices', weather:'Weather', soil:'Soil profile', yield_history:'Yield history'};
  const SOURCE_MODES = {seed:'Bundled dataset', live:'Live feed', fallback:'Bundled dataset (live feed unavailable)'};
  const STALENESS = {fresh:'Fresh', aging:'Ageing', stale:'Out of date', unknown:'Freshness unknown'};
  // Region ids are keys, not names: show the district as the region picker does.
  const regionName = id => (window.FarmState?.REGION_CENTROIDS || []).find(r => r.region_id === id)?.displayName || id;
  const PRICE_SOURCES = {'dataset/mandi_prices.csv':'Mandi price dataset', 'crop parameter price midpoint':'Middle of the crop reference price range', 'Recommendation reference price':'Recommendation reference price'};
  const SOURCE_LABELS = {ml_model:'Model estimate', ml_model_heuristic_response:'Model level, heuristic weather response', yield_model:'Yield model', yield_model_heuristic_response:'Yield model level, heuristic weather response', district_record:'District record', district_record_heuristic_response:'District record level, heuristic weather response', heuristic:'Heuristic estimate'};
  function comparison(c, selectedId, selectable = true) {
    return `<p class="season-note">${text('Ranked by expected profit within your shortlist. The original shortlist uses a broader suitability score.')}</p>
      <div class="season-table-wrap"><table class="season-table"><caption>${text('All money values cover your whole plot')}</caption><thead><tr><th>${text('Crop')}</th><th>${text('Expected profit')}</th><th>${text('Dry scenario profit')}</th><th>${text('Planned cost')}</th><th>${text('Water need (mm)')}</th></tr></thead>
      <tbody>${c.crops.map(row => `<tr><th>${selectable ? `<label><input type="radio" name="chosenCrop" value="${esc(row.crop_id)}" ${selectedId === row.crop_id ? 'checked' : ''}> ${esc(row.crop_name)}</label>` : esc(row.crop_name)}<small>${text(SOURCE_LABELS[row.selected.prediction_source] || 'Heuristic estimate')}</small></th>
      <td>${money(row.selected.expected_profit)}<small>${text('Change from reference')}: ${money(row.profit_change)}</small></td><td>${money(row.dry.expected_profit)}</td><td>${money(row.planned_cost)}<small>${text('Budget coverage')}: ${Math.round(row.selected.budget_coverage * 100)}%</small>${row.unspent_budget > 0 ? `<small>${text('Unspent')}: ${money(row.unspent_budget)}</small>` : ''}</td><td>${esc(row.water_requirement_mm)}</td></tr>`).join('')}</tbody></table></div>
      <p>${text('Dry scenario halves your selected rainfall. It is a stress test, not a forecast or confidence interval.')}</p>
      <p>${text('Reference uses regional rainfall and irrigation 0.5, at the same budget.')}</p>
      <p>${text('The yield model cannot yet respond to rainfall or irrigation, so each scenario scales its estimate by how the rule-based simulator responds.')}</p>
      ${c.crops.some(r => r.unspent_budget > 0) ? `<p>${text('Budget above what a crop typically uses is shown as unspent, not as cost.')}</p>` : ''}
      <p>${text('Water need is a crop reference, not a measured irrigation requirement.')}</p>
      ${c.crops.map(r => `<p><span data-no-translate>${esc(r.crop_name)}</span>: ${text('Reference price')} ${money(r.price_per_kg)}/kg · ${r.price_as_of ? `<time>${esc(date(r.price_as_of))}</time>` : text('Unknown date')} · ${text(PRICE_SOURCES[r.price_source] || r.price_source || 'Unknown source')}</p>`).join('')}`;
  }
  // Shown above a list in which every option is expected to lose money.
  const LOSS_REASONS = {
    budget_too_low: 'Your budget is below what these crops typically need, so each one is expected to lose money. Raise the budget or choose another season.',
    season_needs_irrigation: 'Every crop is expected to lose money here this season. Zaid crops need assured irrigation.',
    no_profitable_crop: 'Every crop is expected to lose money with these inputs. These are not recommendations.'
  };
  function lossBanner(recs) {
    const first = (recs || [])[0];
    if (!first?.all_options_lose) return '';
    return `<p class="season-banner" role="alert">${text(LOSS_REASONS[first.loss_reason] || LOSS_REASONS.no_profitable_crop)}</p>`;
  }
  window.MMSeasonUI = {esc, t, text, money, date, locale, uuid, translate, request, evidence, comparison, lossBanner, regionName};
})();
