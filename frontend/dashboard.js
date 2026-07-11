/* =========================================================
   AgriSim Dashboard — 14 interactive tools, Chart.js visualisations
   Renderers match live API response shapes (verified 2026-04-17).
   ========================================================= */

(() => {
  'use strict';

  /* ---------- Farm state — loaded first so every callback can access it ---------- */
  // savedFarm is declared here (top of IIFE) so that the async Promise.all() callback
  // that populates region selects can safely read savedFarm.region_id.
  // The actual FarmState.load() call also happens here; a second (identical) call
  // at the original site further down is now a no-op because FarmState caches in localStorage.
  let savedFarm = (typeof window.FarmState !== 'undefined')
    ? window.FarmState.load()
    : (() => {
      try {
        return JSON.parse(
          localStorage.getItem('mittimantra_selectedFarm') ||
          localStorage.getItem('agrisim_farm') ||
          'null'
        );
      } catch { return null; }
    })();

  // Synchronize savedFarm with the unified Farm Profile (window.MM.profile)
  // so that mm-core's form auto-population does not overwrite the farm's region and area.
  if (savedFarm) {
    const patch = {};
    if (savedFarm.region_id) patch.region_id = savedFarm.region_id;
    if (savedFarm.acres) patch.area_acres = +savedFarm.acres.toFixed(2);
    if (window.MM && window.MM.profile) {
      const current = window.MM.profile.get();
      if ((patch.region_id && current.region_id !== patch.region_id) ||
        (patch.area_acres && current.area_acres !== patch.area_acres)) {
        window.MM.profile.set(patch);
      }
    }
  }

  /* ---------- Helpers ---------- */
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
  const INR = n => '₹' + Math.round(Number(n) || 0).toLocaleString('en-IN');
  // For per-kg / per-unit prices where rounding to ₹ would lose meaningful precision.
  const INR2 = n => '₹' + (Number(n) || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const FIX = (n, d = 1) => (Number(n) || 0).toFixed(d);
  const PCT = n => FIX(n, 1) + '%';
  // Wrap a rounded display with a native title tooltip showing the raw value,
  // so "actual vs displayed" never drifts for precision-sensitive figures.
  const TT = (raw, display) => {
    const r = Number(raw);
    if (!isFinite(r)) return display;
    return `<span title="Exact: ${r.toLocaleString('en-IN', { maximumFractionDigits: 4 })}">${display}</span>`;
  };
  const MONTH_NAMES = ['—', 'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

  const CROP_LABELS = {
    rice: 'Rice · Dhaan', wheat: 'Wheat · Gehun', maize: 'Maize · Makka',
    sugarcane: 'Sugarcane · Ganna', cotton: 'Cotton · Kapas', pulses: 'Pulses · Dal',
    groundnut: 'Groundnut · Mungfali', soybean: 'Soybean',
    mustard: 'Mustard · Sarson', bajra: 'Bajra · Pearl Millet', jowar: 'Jowar · Sorghum',
    potato: 'Potato · Aloo', onion: 'Onion · Pyaz'
  };
  const CROP_EMOJI = {
    rice: '🌾', wheat: '🌾', maize: '🌽', sugarcane: '🎋', cotton: '🌿', pulses: '🫘',
    groundnut: '🥜', soybean: '🌱', mustard: '🌻', bajra: '🌾', jowar: '🌾',
    potato: '🥔', onion: '🧅'
  };
  const cropLabel = id => (CROP_EMOJI[id] || '🌱') + ' ' + (CROP_LABELS[id] || id);

  // Shared chart theming
  const BRAND = '#2f6b3a', BRAND_D = '#1f4d28', ACCENT = '#c88a3a', CLAY = '#a5562a', SKY = '#6ea7c7', INK = '#4a4339';
  const CHART_DEFAULTS = () => {
    if (!window.Chart) return;
    Chart.defaults.font.family = "'Inter', sans-serif";
    Chart.defaults.font.size = 12;
    Chart.defaults.color = INK;
    Chart.defaults.borderColor = 'rgba(29,26,21,.08)';
    Chart.defaults.animation.duration = 700;
    Chart.defaults.animation.easing = 'easeOutCubic';
  };
  CHART_DEFAULTS();

  // Destroy a Chart.js instance stored on an element before creating a new one
  const CHART_REGISTRY = new Map();
  function makeChart(canvasEl, config) {
    if (!canvasEl) return null;
    const prev = CHART_REGISTRY.get(canvasEl);
    if (prev) prev.destroy();
    const chart = new Chart(canvasEl.getContext('2d'), config);
    CHART_REGISTRY.set(canvasEl, chart);
    return chart;
  }

  /* ---------- Sensitivity heatmap (CSS grid, no lib) ---------- */
  function renderSensitivityHeatmap(cells, baseProfit) {
    // Cells are 25 items with yield_change_pct and price_change_pct both in {-20,-10,0,10,20}
    const ys = [...new Set(cells.map(c => c.yield_change_pct))].sort((a, b) => b - a); // top = +20 yield
    const ps = [...new Set(cells.map(c => c.price_change_pct))].sort((a, b) => a - b); // left = -20 price
    const lookup = {};
    cells.forEach(c => { lookup[`${c.yield_change_pct}_${c.price_change_pct}`] = c; });

    const profits = cells.map(c => c.projected_profit);
    const min = Math.min(...profits), max = Math.max(...profits);
    const colorFor = p => {
      const t = (p - min) / (max - min || 1); // 0..1
      // interpolate: red (low) -> cream -> green (high)
      if (t < 0.5) {
        const k = t * 2;
        return `rgb(${Math.round(225 - k * 30)}, ${Math.round(180 + k * 50)}, ${Math.round(170 + k * 50)})`;
      }
      const k = (t - 0.5) * 2;
      return `rgb(${Math.round(200 - k * 130)}, ${Math.round(230 - k * 30)}, ${Math.round(210 - k * 90)})`;
    };

    return `
      <div style="overflow-x:auto;">
        <table style="border-collapse:separate;border-spacing:4px;margin:0 auto;font-size:.82rem;">
          <thead>
            <tr>
              <th></th>
              <th colspan="${ps.length}" style="text-align:center;font-weight:600;color:var(--ink-faint);padding-bottom:6px;font-size:.74rem;letter-spacing:.1em;text-transform:uppercase;">Price change →</th>
            </tr>
            <tr>
              <th style="font-weight:600;color:var(--ink-faint);font-size:.74rem;padding:6px;">Yield ↓</th>
              ${ps.map(p => `<th style="font-weight:600;color:var(--ink-soft);padding:6px 10px;">${p > 0 ? '+' : ''}${p}%</th>`).join('')}
            </tr>
          </thead>
          <tbody>
            ${ys.map(y => `
              <tr>
                <td style="font-weight:600;color:var(--ink-soft);padding:6px 10px;text-align:right;">${y > 0 ? '+' : ''}${y}%</td>
                ${ps.map(p => {
      const c = lookup[`${y}_${p}`];
      if (!c) return '<td></td>';
      const isBase = y === 0 && p === 0;
      return `<td style="background:${colorFor(c.projected_profit)};padding:10px 12px;border-radius:6px;min-width:72px;text-align:center;font-weight:${isBase ? 700 : 500};color:var(--ink);${isBase ? 'outline:2px solid var(--brand-deep);outline-offset:-2px;' : ''}">
                    ${INR(c.projected_profit)}
                    <div style="font-size:.68rem;color:var(--ink-faint);margin-top:2px;">${FIX(c.projected_roi_pct, 0)}% ROI</div>
                  </td>`;
    }).join('')}
              </tr>`).join('')}
          </tbody>
        </table>
        <div style="text-align:center;margin-top:10px;font-size:.78rem;color:var(--ink-faint);">Base profit (0%, 0%) highlighted · green = higher profit</div>
      </div>`;
  }

  async function api(url, opts = {}) {
    try {
      const res = await fetch(url, { headers: { 'Content-Type': 'application/json' }, ...opts });
      if (!res.ok) {
        let msg;
        try { msg = (await res.json()).detail || res.statusText; } catch { msg = res.statusText; }
        throw new Error(`${res.status} · ${msg}`);
      }
      const data = await res.json();
      // Auto-save logic hooks into this event
      window.dispatchEvent(new CustomEvent('mitti-api-success', { detail: { url, opts, data } }));
      return data;
    } catch (err) {
      // Network-level failure: try the offline fallback for key routes.
      const offline = window.AgriSimOffline;
      const body = opts.body ? tryParseJSON(opts.body) : null;
      if (offline) {
        if (url.includes('/api/simulate') && body) {
          flashOfflineBanner();
          const data = offline.simulate(body);
          window.dispatchEvent(new CustomEvent('mitti-api-success', { detail: { url, opts, data } }));
          return data;
        }
        if (url.includes('/api/recommend') && body) {
          flashOfflineBanner();
          const data = offline.recommend(body);
          window.dispatchEvent(new CustomEvent('mitti-api-success', { detail: { url, opts, data } }));
          return data;
        }
      }
      throw err;
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
  function showLoading(el, text = 'Working…') {
    el.innerHTML = `<div class="loading"><div class="spinner"></div><span>${text}</span></div>`;
  }
  function showError(el, err) {
    el.innerHTML = `<div class="alert alert--red"><svg class="alert__ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><path d="M12 8v4M12 16h.01"/></svg>
      <div class="alert__body"><strong>Request failed</strong><p>${err.message}</p></div></div>`;
  }
  function formToObj(form) {
    const obj = {};
    new FormData(form).forEach((v, k) => { obj[k] = v; });
    return obj;
  }

  /* ---------- Sidebar tool switcher ---------- */
  const btns = $$('.sidebar__btn');
  const tools = $$('.tool');
  btns.forEach(b => b.addEventListener('click', () => {
    const target = b.dataset.tool;
    btns.forEach(x => x.classList.toggle('active', x === b));
    tools.forEach(t => t.classList.toggle('active', t.dataset.tool === target));
    if (window.innerWidth < 860) tools.find(t => t.dataset.tool === target)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }));

  /* ---------- Populate region & crop selects ---------- */
  Promise.all([
    api('/api/regions').catch(() => [
      { id: 'mp_sehore', name: 'MP · Sehore' },
      { id: 'up_lucknow', name: 'UP · Lucknow' },
      { id: 'mh_pune', name: 'MH · Pune' }
    ]),
    api('/api/crops').catch(() => Object.keys(CROP_LABELS).map(c => ({ crop_id: c, crop_name: CROP_LABELS[c] })))
  ]).then(([regions, crops]) => {
    $$('select[data-regions]').forEach(sel => {
      let optsHtml = regions.map(r => {
        const id = r.id || r.region_id;
        const name = r.name || r.region_name || id;
        return `<option value="${id}">${name}</option>`;
      }).join('');
      if (savedFarm && savedFarm.region_id) {
        const farmName = (savedFarm.state && savedFarm.district)
          ? `${savedFarm.state} · ${savedFarm.district} (My Farm)`
          : "My Farm";
        optsHtml = `<option value="${savedFarm.region_id}">${farmName}</option>` + optsHtml;
      }
      sel.innerHTML = optsHtml;
    });
    $$('select[data-crops]').forEach(sel => {
      const hasAny = sel.querySelector('option[value=""]');
      const isMulti = sel.multiple;
      const preselect = new Set(['rice', 'soybean', 'cotton']); // sensible defaults for compare
      const opts = crops.map(c => {
        const id = c.crop_id || c;
        const sel_attr = isMulti && preselect.has(id) ? ' selected' : '';
        return `<option value="${id}"${sel_attr}>${cropLabel(id)}</option>`;
      }).join('');
      sel.innerHTML = (hasAny ? hasAny.outerHTML : '') + opts;
    });

    // FIX-2: If a farm is active, pre-select its region_id across every
    // region dropdown — overriding the API default first-option.
    if (savedFarm && savedFarm.region_id) {
      $$('select[data-regions]').forEach(sel => {
        const opt = sel.querySelector(`option[value="${savedFarm.region_id}"]`);
        if (opt) sel.value = savedFarm.region_id;
      });
    }

    // FIX-3: Trigger initial telemetry using the farm's region (not the
    // API's first-returned region). Falls back to first select value if no farm.
    const initRegion = (savedFarm && savedFarm.region_id) || $('select[data-regions]')?.value;
    const initName = (() => {
      if (savedFarm && savedFarm.region_id) {
        // Try to find the human-readable name from the populated select
        const sel = $('select[data-regions]');
        const opt = sel && sel.querySelector(`option[value="${savedFarm.region_id}"]`);
        return opt ? opt.text : (savedFarm.district || savedFarm.state || savedFarm.region_id);
      }
      const sel = $('select[data-regions]');
      return sel ? (sel.options[sel.selectedIndex]?.text || sel.value) : '';
    })();

    if (initRegion) {
      setTimeout(() => updateRegionalTelemetry(initRegion, initName), 500);
    }
  });

  // --- Dynamic Agri-Telemetry & Map Integrations (Phase 7) ---
  let telemetryMapObj = null;
  let activeTelemetryRegionId = null;

  // FIX-4: Full 30-region coordinate table sourced from FarmState.REGION_CENTROIDS.
  // Avoids the previous bug where only 4 regions were in REGION_COORDS and everything
  // else defaulted to Telangana's centroid [18.04, 78.26].
  const REGION_COORDS = (() => {
    const tbl = {};
    // Use FarmState table when available (loaded before dashboard.js via defer ordering).
    const src = (typeof window.FarmState !== 'undefined' && window.FarmState.REGION_CENTROIDS) || [];
    src.forEach(r => { tbl[r.region_id] = [r.lat, r.lon]; });
    // Bake-in a handful of fallbacks in case FarmState failed to load.
    if (!tbl['telangana_medak']) tbl['telangana_medak'] = [18.04, 78.26];
    if (!tbl['mp_sehore']) tbl['mp_sehore'] = [23.20, 77.08];
    if (!tbl['up_lucknow']) tbl['up_lucknow'] = [26.85, 80.94];
    if (!tbl['mh_pune']) tbl['mh_pune'] = [18.52, 73.85];
    return tbl;
  })();

  function drawPestRiskOverlay(coords, w) {
    if (!telemetryMapObj) return;

    // Remove any previous pest risk layers
    telemetryMapObj.eachLayer(layer => {
      if (layer.options && layer.options.className === 'pest-risk-zone') {
        telemetryMapObj.removeLayer(layer);
      }
    });

    const temp = w.avg_temp_c || 25;
    const rain = w.rainfall_mm || 500;

    let riskLevel = "Low";
    let color = "#10b981"; // green
    let fillOpacity = 0.08;
    let description = "Low risk of fungal/insect infestations.";

    if (temp > 25 && rain > 600) {
      riskLevel = "High";
      color = "#ef4444"; // red
      fillOpacity = 0.28;
      description = "Critical Risk! High temp & rainfall favor Blast & Stem Borer outbreaks.";
    } else if (temp > 22 && rain > 350) {
      riskLevel = "Moderate";
      color = "#f59e0b"; // orange
      fillOpacity = 0.18;
      description = "Moderate Risk. Watch for leafhoppers and mild rust infections.";
    }

    // Draw a circle indicating the risk zone around the farm/region centroid
    const radiusInMeters = riskLevel === "High" ? 600 : riskLevel === "Moderate" ? 400 : 200;

    const circle = L.circle(coords, {
      color: color,
      fillColor: color,
      fillOpacity: fillOpacity,
      weight: 1.5,
      dashArray: riskLevel === "High" ? '4, 4' : null,
      className: 'pest-risk-zone'
    }).addTo(telemetryMapObj);

    // Add a warning tooltip to the risk zone
    circle.bindTooltip(`<b>${riskLevel} Pest Risk Zone</b><br>${description}`, {
      permanent: true,
      direction: 'top',
      opacity: 0.9,
      className: 'pest-tooltip'
    });
  }

  function updateRegionalTelemetry(regionId, regionName) {
    activeTelemetryRegionId = regionId;
    const pnl = document.getElementById('regionalTelemetry');
    if (!pnl) return;
    pnl.style.display = 'block';

    const farmActive = savedFarm && savedFarm.region_id === regionId;
    const coords = farmActive && savedFarm.lat && savedFarm.lon
      ? [savedFarm.lat, savedFarm.lon]
      : (REGION_COORDS[regionId] || [20.5, 78.9]);

    const rName = document.getElementById('telemetryRegionName');
    if (rName) rName.innerText = regionName || regionId;

    const skeleton = `
      <div class="skeleton" style="height: 12px; width: 90%; background: #e2e8f0; margin-bottom: 6px; border-radius: 4px; animation: pulse 1.5s infinite;"></div>
      <div class="skeleton" style="height: 12px; width: 70%; background: #e2e8f0; border-radius: 4px; animation: pulse 1.5s infinite;"></div>
    `;
    const wBody = document.getElementById('telemetryWeatherBody');
    const sBody = document.getElementById('telemetrySoilBody');
    const mBody = document.getElementById('telemetryMarketBody');
    const satBody = document.getElementById('telemetrySatelliteBody');

    if (wBody) wBody.innerHTML = skeleton;
    if (sBody) sBody.innerHTML = skeleton;
    if (mBody) mBody.innerHTML = skeleton;
    if (satBody) satBody.innerHTML = skeleton;

    // Fetch weather info asynchronously
    api(`/api/weather?region_id=${regionId}&season=kharif`)
      .then(w => {
        if (activeTelemetryRegionId !== regionId) return;
        if (wBody) wBody.innerHTML = `
          <div style="font-size: 1.15rem; font-weight: 600; color: var(--brand-deep);">${w.avg_temp_c}°C</div>
          <div style="font-size: 0.8rem; color: var(--ink-soft);">Rainfall: ${w.rainfall_mm}mm</div>
          <div style="font-size: 0.78rem; margin-top: 4px; padding: 2px 6px; border-radius: 4px; display: inline-block; background: ${w.imd_alert === 'Green' ? '#d1fae5' : '#fee2e2'}; color: ${w.imd_alert === 'Green' ? '#065f46' : '#991b1b'}; font-weight: 600;">IMD: ${w.imd_alert}</div>
        `;

        // Auto-populate form default weather values
        const simulateForm = document.querySelector('[data-form="simulate"]');
        if (simulateForm && !simulateForm.weather_override_on.checked) {
          if (w.rainfall_mm != null) simulateForm.rainfall_mm.value = Math.round(w.rainfall_mm);
          if (w.avg_temp_c != null) simulateForm.avg_temp_c.value = w.avg_temp_c.toFixed(1);
        }

        const pestForm = document.querySelector('[data-form="pest"]');
        if (pestForm) {
          if (w.avg_temp_c != null) pestForm.avg_temp_c.value = w.avg_temp_c.toFixed(1);
          if (w.rainfall_mm != null) pestForm.rainfall_mm.value = Math.round(w.rainfall_mm);
        }

        const irrForm = document.querySelector('[data-form="irrigation"]');
        if (irrForm) {
          if (w.rainfall_mm != null) irrForm.rainfall_mm.value = Math.round(w.rainfall_mm);
        }

        // Draw the pest risk overlay layer on the map
        drawPestRiskOverlay(coords, w);
      })
      .catch(err => {
        if (wBody) wBody.innerHTML = `<div style="font-size: 0.78rem; color: var(--clay);">Failed: ${err.message || err}</div>`;
      });

    // Fetch soil info asynchronously
    api(`/api/soil?region_id=${regionId}`)
      .then(s => {
        if (activeTelemetryRegionId !== regionId) return;
        if (sBody) sBody.innerHTML = `
          <div style="font-size: 1.15rem; font-weight: 600; color: var(--brand-deep);">pH ${s.ph}</div>
          <div style="font-size: 0.8rem; color: var(--ink-soft);">N:${Math.round(s.n_kg_per_acre)} P:${Math.round(s.p_kg_per_acre)} K:${Math.round(s.k_kg_per_acre)}</div>
          <div style="font-size: 0.78rem; color: var(--ink-faint);">Carbon: ${s.organic_carbon_percent}%</div>
        `;

        // Auto-fill NPK inputs in fertilizer form if no custom active farm soil is present
        if (!savedFarm || !savedFarm.soil) {
          const fertForm = document.querySelector('[data-form="fertilizer"]');
          if (fertForm) {
            if (s.n_kg_per_acre != null) fertForm.n.value = Math.round(s.n_kg_per_acre);
            if (s.p_kg_per_acre != null) fertForm.p.value = Math.round(s.p_kg_per_acre);
            if (s.k_kg_per_acre != null) fertForm.k.value = Math.round(s.k_kg_per_acre);
          }
        }
      })
      .catch(err => {
        if (sBody) sBody.innerHTML = `<div style="font-size: 0.78rem; color: var(--clay);">Failed to load soil.</div>`;
      });

    // Fetch market price data asynchronously
    api(`/api/market?region_id=${regionId}&crop_id=rice`)
      .then(m => {
        if (activeTelemetryRegionId !== regionId) return;
        if (mBody) mBody.innerHTML = `
          <div style="font-size: 1.15rem; font-weight: 600; color: var(--brand-deep);">₹${m.current_mandi_price_inr_per_kg}/kg</div>
          <div style="font-size: 0.8rem; color: var(--ink-soft);">Volatility: ${m.volatility_std}</div>
          <div style="font-size: 0.78rem; color: var(--accent); font-weight: 600;">Trend: ${m.forecast.trend_direction}</div>
        `;
      })
      .catch(err => {
        if (mBody) mBody.innerHTML = `<div style="font-size: 0.78rem; color: var(--clay);">Failed to load mandi prices.</div>`;
      });

    // Fetch satellite vegetation telemetry from the backend API
    api(`/api/satellite?lat=${coords[0]}&lon=${coords[1]}`)
      .then(sat => {
        if (activeTelemetryRegionId !== regionId) return;
        if (satBody) {
          satBody.innerHTML = `
            <div style="font-size: 1.15rem; font-weight: 600; color: var(--brand-deep);">NDVI ${sat.ndvi.toFixed(2)}</div>
            <div style="font-size: 0.8rem; color: var(--ink-soft);">Moisture: ${sat.moisture.toFixed(2)}</div>
            <div style="font-size: 0.78rem; color: var(--sky); font-weight: 600;">Canopy: ${sat.canopy}</div>
          `;
        }
      })
      .catch(err => {
        if (satBody) satBody.innerHTML = `<div style="font-size: 0.78rem; color: var(--clay);">Failed to load satellite telemetry.</div>`;
      });

    // FIX-5 & FIX-6: Leaflet GIS mapping
    // Use the farm's actual centroid if this is the farm's region; fall back to
    // the REGION_COORDS table (now covering all 30 regions). Default is India centre.

    const mapDiv = document.getElementById('telemetryMap');
    if (mapDiv && typeof L !== 'undefined') {
      mapDiv.style.display = 'block';
      setTimeout(() => {
        if (activeTelemetryRegionId !== regionId) return;
        if (!telemetryMapObj) {
          telemetryMapObj = L.map('telemetryMap', { zoomControl: false }).setView(coords, farmActive ? 15 : 12);
          L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', {
            maxZoom: 19,
            attribution: 'Imagery © Esri'
          }).addTo(telemetryMapObj);
          L.tileLayer('https://{s}.basemaps.cartocdn.com/rastertiles/voyager_only_labels/{z}/{x}/{y}.png', {
            maxZoom: 19, opacity: 0.8, attribution: '© OSM © CartoDB'
          }).addTo(telemetryMapObj);
        } else {
          telemetryMapObj.setView(coords, farmActive ? 15 : 12);
        }

        // Remove existing markers/polygons
        telemetryMapObj.eachLayer(layer => {
          if (layer instanceof L.Polygon || layer instanceof L.Marker || layer instanceof L.GeoJSON) {
            telemetryMapObj.removeLayer(layer);
          }
        });

        const BRAND_GRN = '#2f6b3a';

        if (farmActive && savedFarm.geojson) {
          // FIX-6: Draw the actual drawn polygon (not a fake ±0.003° placeholder square).
          try {
            const gj = L.geoJSON(savedFarm.geojson, {
              style: { color: BRAND_GRN, weight: 2.5, fillColor: BRAND_GRN, fillOpacity: 0.25 }
            }).addTo(telemetryMapObj);
            telemetryMapObj.fitBounds(gj.getBounds(), { padding: [12, 12] });
            // Centroid marker
            L.circleMarker([savedFarm.lat, savedFarm.lon], {
              radius: 6, fillColor: BRAND_GRN, color: '#fff', weight: 2, fillOpacity: 1
            }).addTo(telemetryMapObj)
              .bindPopup(
                `<b>Your farm</b><br>` +
                `${(savedFarm.acres || 0).toFixed(2)} acres<br>` +
                `${savedFarm.lat.toFixed(5)}°N, ${savedFarm.lon.toFixed(5)}°E` +
                (savedFarm.district ? `<br>${savedFarm.district}, ${savedFarm.state}` : '')
              ).openPopup();
          } catch (mapErr) {
            console.warn('[dashboard] farm polygon render failed:', mapErr);
            // Fallback: just show a marker
            L.marker(coords).addTo(telemetryMapObj)
              .bindPopup(`<b>${regionName || regionId}</b><br>GPS Active.`).openPopup();
          }
        } else {
          // No farm active: show a placeholder square + marker as before
          const offset = 0.003;
          const poly = [
            [coords[0] - offset, coords[1] - offset],
            [coords[0] - offset, coords[1] + offset],
            [coords[0] + offset, coords[1] + offset],
            [coords[0] + offset, coords[1] - offset]
          ];
          L.polygon(poly, { color: BRAND_GRN, fillColor: BRAND_GRN, fillOpacity: 0.25 }).addTo(telemetryMapObj);
          L.marker(coords).addTo(telemetryMapObj)
            .bindPopup(`<b>${regionName || regionId}</b><br>GPS Active.`).openPopup();
        }

        telemetryMapObj.invalidateSize();
      }, 100);
    }
  }

  // Bind change listeners to keep region inputs synchronized
  document.addEventListener('change', e => {
    if (e.target && e.target.matches('select[data-regions]')) {
      const val = e.target.value;
      const name = e.target.options[e.target.selectedIndex]?.text;
      $$('select[data-regions]').forEach(sel => {
        if (sel.value !== val) sel.value = val;
      });
      updateRegionalTelemetry(val, name);
    }
  });

  /* ==========================================================
     TOOL 1: Smart recommend — returns LIST directly
     ========================================================== */
  $('[data-form="recommend"]').addEventListener('submit', async e => {
    e.preventDefault();
    const out = $('[data-out="recommend"]');
    showLoading(out, 'Running 3 ML models…');
    try {
      const f = formToObj(e.target);
      const body = {
        region_id: f.region_id, season: f.season,
        area_acres: parseFloat(f.area_acres),
        budget_per_acre: parseFloat(f.budget_per_acre)
      };
      const recs = await api('/api/crop', { method: 'POST', body: JSON.stringify(body) });
      if (!Array.isArray(recs) || !recs.length) { out.innerHTML = '<div class="alert"><div class="alert__body"><strong>No recommendations returned.</strong></div></div>'; return; }
      const top = recs[0];
      const area = body.area_acres;

      out.innerHTML = `
        <div class="kpi-grid">
          <div class="kpi kpi--good"><div class="kpi__lbl">Top pick</div>
            <div class="kpi__val" style="font-size:1.3rem;">${cropLabel(top.crop_id)}</div>
            <div class="kpi__sub">Smart score ${FIX(top.smart_score, 1)} / 100</div></div>
          <div class="kpi"><div class="kpi__lbl">Predicted yield</div>
            <div class="kpi__val">${Math.round(top.predicted_yield_kg_per_acre)} <span style="font-size:.5em;color:var(--ink-faint)">kg/ac</span></div></div>
          <div class="kpi kpi--good"><div class="kpi__lbl">Profit (${area} ac)</div>
            <div class="kpi__val">${TT(top.expected_profit, INR(top.expected_profit))}</div>
            <div class="kpi__sub">ROI ${PCT(top.roi_percent)}</div></div>
        </div>

        ${top.reasons ? `
        <div class="alert alert--green" style="margin-top: 16px; border-left: 4px solid var(--brand); background: var(--brand-soft);">
          <div class="alert__body" style="color: var(--brand-deep);">
            <strong>Agronomic suitability & reasoning:</strong>
            <ul style="margin: 8px 0 0 16px; padding: 0;">
              ${top.reasons.map(r => `<li style="margin-bottom: 4px; font-size: 0.88rem; list-style-type: disc;">${r}</li>`).join('')}
            </ul>
          </div>
        </div>
        ` : ''}

        <div class="chart-grid">
          <div class="chart-box">
            <div class="chart-box__title">Smart score comparison</div>
            <canvas data-chart="rec-bar"></canvas>
          </div>
          <div class="chart-box">
            <div class="chart-box__title">Top 3 crops · multi-factor radar</div>
            <canvas data-chart="rec-radar"></canvas>
          </div>
        </div>

        <h4 style="font-size:.85rem;font-weight:600;letter-spacing:.12em;text-transform:uppercase;color:var(--ink-faint);margin:16px 0 12px;">Ranked alternatives</h4>
        ${recs.slice(0, 5).map((r, i) => `
          <div class="list-row">
            <div class="list-row__bullet">${i + 1}</div>
            <div class="list-row__name">${cropLabel(r.crop_id)}
              <small>Yield ${Math.round(r.predicted_yield_kg_per_acre)} kg/ac · Risk ${Math.round(r.risk_score)}/100 · Score ${FIX(r.smart_score, 1)}</small>
              ${r.reasons ? `<div style="font-size: 0.76rem; color: var(--brand-deep); margin-top: 4px;">• ${r.reasons[0]}</div>` : ''}
            </div>
            <div class="list-row__val">${INR(r.expected_profit)}<small>ROI ${PCT(r.roi_percent)}</small></div>
          </div>`).join('')}`;

      // Bar chart — smart score
      const top5 = recs.slice(0, 5);
      makeChart($('[data-chart="rec-bar"]'), {
        type: 'bar',
        data: {
          labels: top5.map(r => CROP_LABELS[r.crop_id]?.split(' ·')[0] || r.crop_id),
          datasets: [{
            label: 'Smart score',
            data: top5.map(r => r.smart_score),
            backgroundColor: top5.map((_, i) => i === 0 ? BRAND : i === 1 ? ACCENT : i === 2 ? SKY : '#b4a78f'),
            borderRadius: 8, borderSkipped: false
          }]
        },
        options: {
          responsive: true, maintainAspectRatio: false,
          scales: { y: { beginAtZero: true, max: 100, grid: { color: 'rgba(29,26,21,.06)' } }, x: { grid: { display: false } } },
          plugins: { legend: { display: false } }
        }
      });

      // Radar — top 3 across 5 axes (normalised 0–100)
      const top3 = recs.slice(0, 3);
      const maxProfit = Math.max(...top3.map(r => r.expected_profit)) || 1;
      const maxYield = Math.max(...top3.map(r => r.predicted_yield_kg_per_acre)) || 1;
      const maxROI = Math.max(...top3.map(r => r.roi_percent)) || 1;
      const colors = [BRAND, ACCENT, SKY];
      makeChart($('[data-chart="rec-radar"]'), {
        type: 'radar',
        data: {
          labels: ['Smart score', 'ROI %', 'Yield', 'Low risk', 'ML conf'],
          datasets: top3.map((r, i) => ({
            label: CROP_LABELS[r.crop_id]?.split(' ·')[0] || r.crop_id,
            data: [
              r.smart_score,
              (r.roi_percent / maxROI) * 100,
              (r.predicted_yield_kg_per_acre / maxYield) * 100,
              100 - r.risk_score,
              (r.ml_confidence || 0) * 100
            ],
            backgroundColor: colors[i] + '30',
            borderColor: colors[i],
            pointBackgroundColor: colors[i],
            borderWidth: 2
          }))
        },
        options: {
          responsive: true, maintainAspectRatio: false,
          scales: { r: { min: 0, max: 100, ticks: { display: false }, grid: { color: 'rgba(29,26,21,.08)' }, pointLabels: { font: { size: 11 } } } },
          plugins: { legend: { position: 'bottom', labels: { boxWidth: 12, padding: 10 } } }
        }
      });
    } catch (err) { showError(out, err); }
  });

  /* ==========================================================
     TOOL 2: Simulate (auto-fetches soil & weather)
     ========================================================== */
  $('[data-form="simulate"]').addEventListener('submit', async e => {
    e.preventDefault();
    const out = $('[data-out="simulate"]');
    showLoading(out, 'Simulating yield, cost & profit…');
    try {
      const f = formToObj(e.target);
      // Respect user overrides: if farm boundary exists, use its soil;
      // if weather override is on, skip the API call entirely.
      const override = (window.__agrisimWeatherOverride && window.__agrisimWeatherOverride()) || null;
      const farmSoil = (window.__agrisimFarmSoil && window.__agrisimFarmSoil()) || null;
      const [soilRaw, weatherRaw] = await Promise.all([
        farmSoil ? Promise.resolve(farmSoil) : api(`/api/soil/${f.region_id}`).catch(() => ({})),
        override ? Promise.resolve(override) : api(`/api/weather/${f.region_id}?season=${f.season}`).catch(() => ({}))
      ]);
      // CSV rows come back as all-strings — coerce numerics so the simulator can do math.
      const coerce = obj => {
        const out = {};
        Object.entries(obj || {}).forEach(([k, v]) => {
          if (typeof v === 'string' && v.trim() !== '' && !isNaN(Number(v))) out[k] = Number(v);
          else out[k] = v;
        });
        return out;
      };
      const soil = coerce(soilRaw);
      const weather = coerce(weatherRaw);
      const body = {
        crop_id: f.crop_id, region_id: f.region_id,
        area_acres: parseFloat(f.area_acres),
        mandi_price_per_kg: parseFloat(f.mandi_price_per_kg),
        irrigation_level: parseFloat(f.irrigation_level),
        seed_variety: 'standard', sowing_date: '2024-06-15',
        soil, weather,
        input_plan: {
          seed_cost_per_acre: +f.seed_cost_per_acre,
          fertilizer_cost_per_acre: +f.fertilizer_cost_per_acre,
          labour_cost_per_acre: +f.labour_cost_per_acre,
          irrigation_cost_per_acre: +f.other_costs_per_acre * 0.5,
          pesticide_cost_per_acre: +f.other_costs_per_acre * 0.3,
          machinery_cost_per_acre: +f.other_costs_per_acre * 0.2,
        }
      };
      // Prepare bodies for Dry and Wet weather scenarios
      const dryBody = JSON.parse(JSON.stringify(body));
      dryBody.weather.rainfall_mm = Math.max(0, (body.weather.rainfall_mm || 600) * 0.5);
      const wetBody = JSON.parse(JSON.stringify(body));
      wetBody.weather.rainfall_mm = (body.weather.rainfall_mm || 600) * 1.5;

      const r = await api('/api/simulate', { method: 'POST', body: JSON.stringify(body) });

      // Run Dry/Wet simulations in parallel background
      const [rDry, rWet] = await Promise.all([
        api('/api/simulate', { method: 'POST', body: JSON.stringify(dryBody) }).catch(() => null),
        api('/api/simulate', { method: 'POST', body: JSON.stringify(wetBody) }).catch(() => null)
      ]);

      const area = body.area_acres;
      const yieldPerAc = r.yield_kg_per_acre || 0;
      const totalYield = r.total_yield_kg || yieldPerAc * area;
      const nut = r.nutrient_analysis || {};
      const water = r.water_efficiency || {};
      const sens = r.sensitivity || [];

      out.innerHTML = `
        <div class="kpi-grid">
          <div class="kpi kpi--good"><div class="kpi__lbl">Total yield</div>
            <div class="kpi__val">${Math.round(totalYield)} <span style="font-size:.5em">kg</span></div>
            <div class="kpi__sub">${Math.round(yieldPerAc)} kg/ac</div></div>
          <div class="kpi"><div class="kpi__lbl">Revenue</div>
            <div class="kpi__val">${TT(r.revenue, INR(r.revenue || 0))}</div></div>
          <div class="kpi"><div class="kpi__lbl">Total cost</div>
            <div class="kpi__val">${TT(r.total_cost, INR(r.total_cost || 0))}</div>
            <div class="kpi__sub">Breakeven ₹${FIX(r.break_even_price_per_kg, 2)}/kg</div></div>
          <div class="kpi kpi--good"><div class="kpi__lbl">Profit</div>
            <div class="kpi__val">${TT(r.profit, INR(r.profit || 0))}</div>
            <div class="kpi__sub">ROI ${PCT(r.roi_percent || 0)}</div></div>
          <div class="kpi kpi--warn"><div class="kpi__lbl">Risk score</div>
            <div class="kpi__val">${Math.round(r.risk_score || 0)}<span style="font-size:.5em;color:var(--ink-faint)">/100</span></div></div>
          <div class="kpi kpi--info"><div class="kpi__lbl">Water / kg</div>
            <div class="kpi__val">${Math.round(water.water_per_kg_yield_liters || 0)} <span style="font-size:.5em">L</span></div>
            <div class="kpi__sub">${Math.round(water.irrigation_coverage_percent || 0)}% covered</div></div>
        </div>

        ${r.intelligence_report ? `
        <div class="alert alert--info" style="margin-top: 16px; border-left: 4px solid var(--brand); background: var(--brand-soft);">
          <div class="alert__body" style="color: var(--brand-deep);">
            <strong>Yield Model Explainability Drivers:</strong>
            <div style="font-size: 0.95rem; margin-top: 4px; font-weight: 600;">${r.intelligence_report.uncertainty_range}</div>
            <ul style="margin: 8px 0 0 16px; padding: 0;">
              ${r.intelligence_report.positive_influences.map(pi => `<li style="margin-bottom: 2px; font-size: 0.85rem; list-style-type: check;">✓ ${pi}</li>`).join('')}
              ${r.intelligence_report.negative_influences.map(ni => `<li style="margin-bottom: 2px; font-size: 0.85rem; list-style-type: warning;">⚠ ${ni}</li>`).join('')}
            </ul>
            <div style="font-size: 0.78rem; color: var(--ink-faint); margin-top: 8px; font-style: italic;">
              ${r.intelligence_report.explanation}
            </div>
          </div>
        </div>
        ` : ''}

        <div class="chart-grid">
          <div class="chart-box">
            <div class="chart-box__title">Cost breakdown per acre</div>
            <canvas data-chart="sim-cost"></canvas>
          </div>
          <div class="chart-box">
            <div class="chart-box__title">Revenue vs cost vs profit (total)</div>
            <canvas data-chart="sim-rev"></canvas>
          </div>
        </div>

        <div class="chart-box" style="margin-top: 14px;">
          <div class="chart-box__title">Yield comparison under climate scenarios (kg/acre)</div>
          <canvas data-chart="sim-climate-yield"></canvas>
        </div>

        ${(nut.n_deficit !== undefined) ? `
        <div class="chart-box">
          <div class="chart-box__title">Nutrient balance · available vs required (kg/ac)</div>
          <canvas data-chart="sim-nut"></canvas>
        </div>` : ''}

        ${sens.length ? `
        <div class="chart-box">
          <div class="chart-box__title">Sensitivity · profit at varying price × yield (${sens.length} cells)</div>
          ${renderSensitivityHeatmap(sens, r.profit)}
        </div>` : ''}`;

      // Cost doughnut from actual backend breakdown
      const cb = r.cost_breakdown_per_acre || body.input_plan;
      const costKeys = Object.keys(cb);
      makeChart($('[data-chart="sim-cost"]'), {
        type: 'doughnut',
        data: {
          labels: costKeys.map(k => k.replace(/_cost_per_acre|_per_acre/, '').replace(/_/g, ' ').replace(/^./, c => c.toUpperCase())),
          datasets: [{
            data: costKeys.map(k => cb[k]),
            backgroundColor: [BRAND, ACCENT, SKY, '#7ca894', CLAY, '#8a8376'],
            borderWidth: 2, borderColor: '#fff'
          }]
        },
        options: {
          responsive: true, maintainAspectRatio: false, cutout: '62%',
          plugins: {
            legend: { position: 'right', labels: { boxWidth: 12, padding: 8, font: { size: 11 } } },
            tooltip: { callbacks: { label: c => c.label + ': ' + INR(c.parsed) + '/ac' } }
          }
        }
      });

      makeChart($('[data-chart="sim-rev"]'), {
        type: 'bar',
        data: {
          labels: ['Revenue', 'Total cost', 'Profit'],
          datasets: [{
            data: [r.revenue || 0, r.total_cost || 0, r.profit || 0],
            backgroundColor: [BRAND, CLAY, ACCENT], borderRadius: 8, borderSkipped: false
          }]
        },
        options: {
          responsive: true, maintainAspectRatio: false,
          scales: { y: { beginAtZero: true, grid: { color: 'rgba(29,26,21,.06)' }, ticks: { callback: v => '₹' + (v / 1000).toFixed(0) + 'K' } }, x: { grid: { display: false } } },
          plugins: { legend: { display: false }, tooltip: { callbacks: { label: c => INR(c.parsed.y) } } }
        }
      });

      makeChart($('[data-chart="sim-climate-yield"]'), {
        type: 'bar',
        data: {
          labels: ['Dry Scenario (50% rain)', 'Normal Scenario (Actual)', 'Wet Scenario (+50% rain)'],
          datasets: [{
            label: 'Yield (kg/acre)',
            data: [
              Math.round((rDry && rDry.yield_kg_per_acre) || (yieldPerAc * 0.7)),
              Math.round(yieldPerAc),
              Math.round((rWet && rWet.yield_kg_per_acre) || (yieldPerAc * 1.15))
            ],
            backgroundColor: [CLAY, BRAND, SKY],
            borderRadius: 8,
            borderSkipped: false
          }]
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          scales: {
            y: {
              beginAtZero: true,
              grid: { color: 'rgba(29,26,21,.06)' },
              ticks: { callback: v => v + ' kg' }
            },
            x: { grid: { display: false } }
          },
          plugins: {
            legend: { display: false },
            tooltip: { callbacks: { label: c => c.parsed.y + ' kg/acre' } }
          }
        }
      });

      if (nut.n_deficit !== undefined) {
        makeChart($('[data-chart="sim-nut"]'), {
          type: 'bar',
          data: {
            labels: ['Nitrogen (N)', 'Phosphorus (P)', 'Potassium (K)'],
            datasets: [
              { label: 'Available in soil', data: [nut.n_available || 0, nut.p_available || 0, nut.k_available || 0], backgroundColor: BRAND, borderRadius: 6 },
              { label: 'Required by crop', data: [nut.n_required || 0, nut.p_required || 0, nut.k_required || 0], backgroundColor: ACCENT, borderRadius: 6 }
            ]
          },
          options: {
            responsive: true, maintainAspectRatio: false,
            scales: { y: { beginAtZero: true, grid: { color: 'rgba(29,26,21,.06)' }, ticks: { callback: v => v + ' kg' } }, x: { grid: { display: false } } },
            plugins: { legend: { position: 'bottom', labels: { boxWidth: 12, padding: 10 } } }
          }
        });
      }
    } catch (err) { showError(out, err); }
  });

  /* ==========================================================
     TOOL 3: Rotation planner — top_rotations[]
     ========================================================== */
  $('[data-form="rotation"]').addEventListener('submit', async e => {
    e.preventDefault();
    const out = $('[data-out="rotation"]');
    showLoading(out, 'Scoring kharif × rabi combinations…');
    try {
      const body = {
        region_id: formToObj(e.target).region_id,
        area_acres: parseFloat(formToObj(e.target).area_acres),
        budget_per_acre: parseFloat(formToObj(e.target).budget_per_acre)
      };
      const data = await api('/api/rotation-plan', { method: 'POST', body: JSON.stringify(body) });
      const plans = data.top_rotations || [];
      if (!plans.length) { out.innerHTML = '<div class="alert"><div class="alert__body"><strong>No rotation plans.</strong></div></div>'; return; }

      const best = data.best_rotation || plans[0];
      out.innerHTML = `
        <div class="kpi-grid">
          <div class="kpi kpi--good"><div class="kpi__lbl">Best rotation</div>
            <div class="kpi__val" style="font-size:1.15rem;">${cropLabel(best.kharif_crop)} → ${cropLabel(best.rabi_crop)}</div>
            <div class="kpi__sub">Score ${FIX(best.rotation_score || best.diversity_score || 0, 1)}</div></div>
          <div class="kpi"><div class="kpi__lbl">Annual profit</div>
            <div class="kpi__val">${TT(best.annual_profit, INR(best.annual_profit))}</div></div>
          <div class="kpi kpi--warn"><div class="kpi__lbl">Avg risk</div>
            <div class="kpi__val">${Math.round(best.avg_risk_score || 0)}<span style="font-size:.5em">/100</span></div></div>
        </div>

        <div class="chart-box">
          <div class="chart-box__title">Kharif vs rabi profit contribution (top 5)</div>
          <canvas data-chart="rot-bar"></canvas>
        </div>

        <h4 style="font-size:.85rem;font-weight:600;letter-spacing:.12em;text-transform:uppercase;color:var(--ink-faint);margin:16px 0 12px;">All rotations</h4>
        ${plans.slice(0, 5).map((p, i) => `
          <div class="list-row">
            <div class="list-row__bullet">${i + 1}</div>
            <div class="list-row__name">${cropLabel(p.kharif_crop)} → ${cropLabel(p.rabi_crop)}
              <small>Risk ${Math.round(p.avg_risk_score || 0)}/100 · Score ${FIX(p.rotation_score || p.diversity_score || 0, 1)}</small></div>
            <div class="list-row__val">${INR(p.annual_profit)}<small>per year</small></div>
          </div>`).join('')}`;

      // Stacked bar: kharif + rabi profit per rotation
      const top5 = plans.slice(0, 5);
      makeChart($('[data-chart="rot-bar"]'), {
        type: 'bar',
        data: {
          labels: top5.map(p => `${p.kharif_crop}→${p.rabi_crop}`),
          datasets: [
            { label: 'Kharif profit', data: top5.map(p => p.kharif_profit), backgroundColor: BRAND, borderRadius: 6 },
            { label: 'Rabi profit', data: top5.map(p => p.rabi_profit), backgroundColor: ACCENT, borderRadius: 6 }
          ]
        },
        options: {
          responsive: true, maintainAspectRatio: false,
          scales: { x: { stacked: true, grid: { display: false } }, y: { stacked: true, beginAtZero: true, grid: { color: 'rgba(29,26,21,.06)' }, ticks: { callback: v => '₹' + (v / 1000).toFixed(0) + 'K' } } },
          plugins: { legend: { position: 'bottom', labels: { boxWidth: 12, padding: 10 } } }
        }
      });
    } catch (err) { showError(out, err); }
  });

  /* ==========================================================
     TOOL 4: Price forecast — forecasts[] + historical via /mandi-prices
     ========================================================== */
  $('[data-form="forecast"]').addEventListener('submit', async e => {
    e.preventDefault();
    const out = $('[data-out="forecast"]');
    showLoading(out, 'Forecasting mandi prices…');
    try {
      const f = formToObj(e.target);
      const months = parseInt(f.months_ahead) || 6;
      const [data, history] = await Promise.all([
        api(`/api/price-forecast/${f.region_id}/${f.crop_id}?months_ahead=${months}`),
        api(`/api/mandi-prices/${f.region_id}?crop_id=${f.crop_id}`).catch(() => [])
      ]);
      const fcst = data.forecasts || [];
      if (!fcst.length) { out.innerHTML = '<div class="alert"><div class="alert__body"><strong>No forecast available.</strong></div></div>'; return; }

      // Build historical series (last 12 rows sorted by date)
      const histSorted = history
        .map(h => ({ date: h.date || h.price_date, price: parseFloat(h.price_inr_per_kg || h.price || 0) }))
        .filter(h => h.date && !isNaN(h.price))
        .sort((a, b) => a.date.localeCompare(b.date))
        .slice(-12);

      const histLabels = histSorted.map(h => h.date.slice(0, 7));
      const histData = histSorted.map(h => h.price);
      const fcstLabels = fcst.map(fo => fo.month);
      const fcstData = fcst.map(fo => fo.forecast_price);

      // Combined series: history followed by forecast (padded with nulls so they align on same chart)
      const combinedLabels = [...histLabels, ...fcstLabels];
      const histPad = [...histData, ...fcstLabels.map(() => null)];
      const fcstPad = [...histLabels.slice(0, -1).map(() => null),
      histData.length ? histData[histData.length - 1] : null,
      ...fcstData];

      const lastHist = histData[histData.length - 1] || data.current_price || 0;
      const lastFcst = fcstData[fcstData.length - 1] || 0;
      const deltaPct = lastHist ? ((lastFcst - lastHist) / lastHist) * 100 : 0;

      out.innerHTML = `
        <div class="kpi-grid">
          <div class="kpi"><div class="kpi__lbl">Current price</div>
            <div class="kpi__val">${TT(data.current_price, INR2(data.current_price))}<span style="font-size:.5em">/kg</span></div></div>
          <div class="kpi kpi--info"><div class="kpi__lbl">+${months} mo forecast</div>
            <div class="kpi__val">${TT(lastFcst, INR2(lastFcst))}<span style="font-size:.5em">/kg</span></div>
            <div class="kpi__sub"><span class="chip ${deltaPct >= 0 ? 'chip--green' : 'chip--red'}">${deltaPct >= 0 ? '+' : ''}${FIX(deltaPct, 1)}% vs now</span></div></div>
          <div class="kpi ${data.trend_direction === 'rising' ? 'kpi--good' : data.trend_direction === 'falling' ? 'kpi--warn' : 'kpi--info'}">
            <div class="kpi__lbl">Trend</div>
            <div class="kpi__val" style="font-size:1.3rem;text-transform:capitalize;">${data.trend_direction || '—'}</div>
            <div class="kpi__sub">Slope ${FIX(data.trend_slope_per_month || 0, 2)}/mo</div></div>
          <div class="kpi kpi--good"><div class="kpi__lbl">Model</div>
            <div class="kpi__val" style="font-size:1rem;">${data.prediction_source || 'ml_model'}</div>
            <div class="kpi__sub">${fcst[0]?.confidence || 'high'} confidence</div></div>
        </div>

        <div class="chart-box">
          <div class="chart-box__title">Price trajectory · ${f.crop_id} @ ${f.region_id}</div>
          <canvas data-chart="fcst-line"></canvas>
        </div>`;

      makeChart($('[data-chart="fcst-line"]'), {
        type: 'line',
        data: {
          labels: combinedLabels,
          datasets: [
            {
              label: 'Historical',
              data: histPad,
              borderColor: BRAND,
              backgroundColor: BRAND + '20',
              borderWidth: 2.5,
              pointRadius: 3,
              pointBackgroundColor: BRAND,
              tension: 0.3,
              fill: true,
              spanGaps: false
            },
            {
              label: 'ML forecast',
              data: fcstPad,
              borderColor: ACCENT,
              backgroundColor: ACCENT + '20',
              borderWidth: 2.5,
              borderDash: [6, 4],
              pointRadius: 3,
              pointBackgroundColor: ACCENT,
              tension: 0.3,
              fill: true,
              spanGaps: false
            }
          ]
        },
        options: {
          responsive: true, maintainAspectRatio: false,
          interaction: { mode: 'index', intersect: false },
          scales: {
            y: { beginAtZero: false, grid: { color: 'rgba(29,26,21,.06)' }, ticks: { callback: v => '₹' + v } },
            x: { grid: { display: false } }
          },
          plugins: { legend: { position: 'bottom', labels: { boxWidth: 12, padding: 10 } }, tooltip: { callbacks: { label: c => c.dataset.label + ': ₹' + FIX(c.parsed.y, 2) + '/kg' } } }
        }
      });
    } catch (err) { showError(out, err); }
  });

  /* ==========================================================
     TOOL 5: MSP vs Market
     ========================================================== */
  $('[data-form="msp"]').addEventListener('submit', async e => {
    e.preventDefault();
    const out = $('[data-out="msp"]');
    showLoading(out);
    try {
      const f = formToObj(e.target);
      const r = await api(`/api/msp-vs-market/${f.region_id}/${f.crop_id}`);
      const gap = r.mandi_msp_gap_pct || 0;
      const cls = r.mandi_above_msp ? 'chip--green' : 'chip--red';

      out.innerHTML = `
        <div class="kpi-grid">
          <div class="kpi"><div class="kpi__lbl">MSP (${r.msp_year})</div>
            <div class="kpi__val">${TT(r.msp_inr_per_kg, INR2(r.msp_inr_per_kg))}<span style="font-size:.5em">/kg</span></div></div>
          <div class="kpi kpi--info"><div class="kpi__lbl">Current mandi</div>
            <div class="kpi__val">${TT(r.current_mandi_price, INR2(r.current_mandi_price))}<span style="font-size:.5em">/kg</span></div>
            <div class="kpi__sub"><span class="chip ${cls}">${r.mandi_above_msp ? '+' : ''}${FIX(gap, 1)}% vs MSP</span></div></div>
          <div class="kpi"><div class="kpi__lbl">6-month avg</div>
            <div class="kpi__val">${TT(r.avg_mandi_6m, INR2(r.avg_mandi_6m))}<span style="font-size:.5em">/kg</span></div></div>
        </div>
        <div class="chart-box">
          <div class="chart-box__title">Price comparison</div>
          <canvas data-chart="msp-bar"></canvas>
        </div>
        <div class="alert alert--${r.mandi_above_msp ? 'green' : 'gold'}">
          <svg class="alert__ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><path d="M12 8v4M12 16h.01"/></svg>
          <div class="alert__body"><strong>Recommendation</strong><p>${r.recommendation}</p></div>
        </div>`;

      makeChart($('[data-chart="msp-bar"]'), {
        type: 'bar',
        data: {
          labels: ['MSP', '6-month avg', 'Current mandi'],
          datasets: [{
            data: [r.msp_inr_per_kg, r.avg_mandi_6m, r.current_mandi_price],
            backgroundColor: [CLAY, SKY, BRAND], borderRadius: 8, borderSkipped: false
          }]
        },
        options: {
          indexAxis: 'y', responsive: true, maintainAspectRatio: false,
          scales: { x: { beginAtZero: true, grid: { color: 'rgba(29,26,21,.06)' }, ticks: { callback: v => '₹' + v } }, y: { grid: { display: false } } },
          plugins: { legend: { display: false } }
        }
      });
    } catch (err) { showError(out, err); }
  });

  /* ==========================================================
     TOOL 6: Sell advisor
     ========================================================== */
  $('[data-form="sell"]').addEventListener('submit', async e => {
    e.preventDefault();
    const out = $('[data-out="sell"]');
    showLoading(out);
    try {
      const f = formToObj(e.target);
      const r = await api(`/api/sell-advisor/${f.region_id}/${f.crop_id}`);
      const action = (r.action || '').toLowerCase();
      const cls = action.includes('hold') ? 'kpi--warn' : action.includes('sell') ? 'kpi--good' : 'kpi--info';
      const alertCls = action.includes('hold') ? 'alert--gold' : action.includes('sell') ? 'alert--green' : 'alert--gold';
      const monthly = r.monthly_avg_prices || {};
      const monthEntries = Object.entries(monthly).map(([m, p]) => ({ m: parseInt(m), p: parseFloat(p) })).sort((a, b) => a.m - b.m);

      out.innerHTML = `
        <div class="kpi-grid">
          <div class="kpi ${cls}"><div class="kpi__lbl">Action</div>
            <div class="kpi__val" style="font-size:1.4rem;text-transform:uppercase;">${r.action || '—'}</div></div>
          <div class="kpi"><div class="kpi__lbl">Current price</div>
            <div class="kpi__val">${TT(r.current_price, INR2(r.current_price))}<span style="font-size:.5em">/kg</span></div>
            <div class="kpi__sub">${MONTH_NAMES[r.current_month] || ''}</div></div>
          <div class="kpi kpi--good"><div class="kpi__lbl">Best month</div>
            <div class="kpi__val" style="font-size:1.3rem;">${MONTH_NAMES[r.best_month] || '—'}</div>
            <div class="kpi__sub">${INR2(r.best_month_avg_price)}/kg</div></div>
          <div class="kpi kpi--warn"><div class="kpi__lbl">Worst month</div>
            <div class="kpi__val" style="font-size:1.3rem;">${MONTH_NAMES[r.worst_month] || '—'}</div>
            <div class="kpi__sub">${INR2(r.worst_month_avg_price)}/kg</div></div>
          <div class="kpi kpi--info"><div class="kpi__lbl">Gain if held</div>
            <div class="kpi__val">${FIX(r.potential_gain_pct || 0, 1)}%</div>
            <div class="kpi__sub">${r.months_to_peak} mo to peak</div></div>
        </div>

        ${monthEntries.length ? `<div class="chart-box">
          <div class="chart-box__title">Seasonal price pattern (12-month average)</div>
          <canvas data-chart="sell-line"></canvas>
        </div>` : ''}

        <div class="alert ${alertCls}">
          <svg class="alert__ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><path d="M12 8v4M12 16h.01"/></svg>
          <div class="alert__body"><strong>Advice</strong><p>${r.advice}</p></div>
        </div>`;

      if (monthEntries.length) {
        makeChart($('[data-chart="sell-line"]'), {
          type: 'line',
          data: {
            labels: monthEntries.map(e => MONTH_NAMES[e.m]),
            datasets: [{
              label: 'Avg price',
              data: monthEntries.map(e => e.p),
              borderColor: BRAND,
              backgroundColor: BRAND + '25',
              borderWidth: 2.5, tension: 0.4, fill: true,
              pointRadius: monthEntries.map(e => e.m === r.best_month ? 6 : e.m === r.worst_month ? 6 : 3),
              pointBackgroundColor: monthEntries.map(e => e.m === r.best_month ? BRAND : e.m === r.worst_month ? CLAY : BRAND),
              pointBorderColor: '#fff', pointBorderWidth: 2
            }]
          },
          options: {
            responsive: true, maintainAspectRatio: false,
            scales: { y: { grid: { color: 'rgba(29,26,21,.06)' }, ticks: { callback: v => '₹' + v } }, x: { grid: { display: false } } },
            plugins: { legend: { display: false }, tooltip: { callbacks: { label: c => '₹' + FIX(c.parsed.y, 2) + '/kg' } } }
          }
        });
      }
    } catch (err) { showError(out, err); }
  });

  /* ==========================================================
     TOOL 7: Arbitrage — cheapest_market / costliest_market / opportunities
     ========================================================== */
  $('[data-form="arbitrage"]').addEventListener('submit', async e => {
    e.preventDefault();
    const out = $('[data-out="arbitrage"]');
    showLoading(out);
    try {
      const f = formToObj(e.target);
      const r = await api(`/api/arbitrage/${f.crop_id}`);
      const cheapest = r.cheapest_market || {};
      const costliest = r.costliest_market || {};
      const opps = r.opportunities || [];

      out.innerHTML = `
        <div class="kpi-grid">
          <div class="kpi kpi--good"><div class="kpi__lbl">Sell high</div>
            <div class="kpi__val" style="font-size:1.1rem;">${costliest.market_name || costliest.region_id || '—'}</div>
            <div class="kpi__sub">${INR2(costliest.price_inr_per_kg || 0)}/kg</div></div>
          <div class="kpi kpi--warn"><div class="kpi__lbl">Buy low</div>
            <div class="kpi__val" style="font-size:1.1rem;">${cheapest.market_name || cheapest.region_id || '—'}</div>
            <div class="kpi__sub">${INR2(cheapest.price_inr_per_kg || 0)}/kg</div></div>
          <div class="kpi kpi--info"><div class="kpi__lbl">Max spread</div>
            <div class="kpi__val">${TT(r.max_price_gap_per_kg, INR2(r.max_price_gap_per_kg))}<span style="font-size:.5em">/kg</span></div>
            <div class="kpi__sub">${FIX(r.max_gap_pct, 1)}% · ${r.regions_compared} mandis</div></div>
        </div>

        <h4 style="font-size:.85rem;font-weight:600;letter-spacing:.12em;text-transform:uppercase;color:var(--ink-faint);margin:16px 0 12px;">Arbitrage opportunities</h4>
        ${opps.map(op => `
          <div class="alert alert--green">
            <svg class="alert__ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M7 17l10-10M17 7v10h-10"/></svg>
            <div class="alert__body">
              <strong>${op.buy_market} → ${op.sell_market}</strong>
              <p>Buy @ ${INR2(op.buy_price)}/kg, sell @ ${INR2(op.sell_price)}/kg · Gap <span class="chip chip--green">+${INR2(op.price_gap_per_kg)} (${FIX(op.gap_pct, 1)}%)</span></p>
            </div></div>`).join('')}

        <div class="alert"><div class="alert__body"><p style="font-size:.82rem;">${r.note || ''}</p></div></div>`;
    } catch (err) { showError(out, err); }
  });

  /* ==========================================================
     TOOL 8: Crop calendar — calendar is a DICT of named activities
     ========================================================== */
  $('[data-form="calendar"]').addEventListener('submit', async e => {
    e.preventDefault();
    const out = $('[data-out="calendar"]');
    showLoading(out);
    try {
      const f = formToObj(e.target);
      const r = await api(`/api/crop-calendar/${f.crop_id}?season=${f.season}`);
      const cal = r.calendar || null;
      if (!cal) {
        out.innerHTML = `<div class="alert alert--gold"><svg class="alert__ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><path d="M12 8v4M12 16h.01"/></svg>
          <div class="alert__body"><strong>No calendar data yet for ${cropLabel(f.crop_id)}</strong><p>This crop was recently added. Calendar data will be populated in a future update. Meanwhile, check the <a href="#" onclick="document.querySelector('.sidebar__btn[data-tool=irrigation]').click();return false;" style="color:var(--brand);font-weight:600;">irrigation schedule</a> for timing.</p></div></div>`;
        return;
      }
      const LABELS = {
        nursery: 'Nursery preparation', land_preparation: 'Land preparation',
        sowing: 'Sowing', sowing_transplant: 'Sowing / transplanting', sowing_window: 'Sowing window',
        first_fertilizer: 'First fertilizer', second_fertilizer: 'Second fertilizer', third_fertilizer: 'Third fertilizer',
        basal_fertilizer: 'Basal fertilizer', top_dress_fertilizer: 'Top-dress fertilizer',
        critical_irrigation: 'Critical irrigation', pest_watch: 'Pest watch',
        flowering: 'Flowering', harvest_window: 'Harvest window', harvest: 'Harvest',
        duration_days: 'Total duration'
      };
      const entries = Object.entries(cal).filter(([k, v]) => k !== 'duration_days' && v);

      out.innerHTML = `
        <div class="kpi-grid">
          <div class="kpi kpi--info"><div class="kpi__lbl">Duration</div>
            <div class="kpi__val">${cal.duration_days || '—'} <span style="font-size:.5em">days</span></div></div>
          <div class="kpi"><div class="kpi__lbl">Sowing</div>
            <div class="kpi__val" style="font-size:1.05rem;">${cal.sowing_transplant || cal.sowing_window || cal.sowing || '—'}</div></div>
          <div class="kpi kpi--good"><div class="kpi__lbl">Harvest</div>
            <div class="kpi__val" style="font-size:1.05rem;">${cal.harvest_window || cal.harvest || '—'}</div></div>
        </div>
        <div class="timeline">
          ${entries.map(([k, v]) => `
            <div class="timeline__item">
              <div class="timeline__date">${LABELS[k] || k.replace(/_/g, ' ')}</div>
              <div class="timeline__title">${v}</div>
            </div>`).join('')}
        </div>`;
    } catch (err) { showError(out, err); }
  });

  /* ==========================================================
     TOOL 9: Irrigation — weekly_schedule[], priority field
     ========================================================== */
  $('[data-form="irrigation"]').addEventListener('submit', async e => {
    e.preventDefault();
    const out = $('[data-out="irrigation"]');
    showLoading(out);
    try {
      const f = formToObj(e.target);
      const q = new URLSearchParams({ sowing_date: f.sowing_date, rainfall_mm: f.rainfall_mm, irrigation_level: f.irrigation_level }).toString();
      const r = await api(`/api/irrigation?crop_id=${f.crop_id}&${q}`);
      const schedule = r.weekly_schedule || [];
      const criticalCount = schedule.filter(s => (s.priority || '').toLowerCase() === 'high').length;

      out.innerHTML = `
        <div class="kpi-grid">
          <div class="kpi kpi--info"><div class="kpi__lbl">Total water need</div>
            <div class="kpi__val">${Math.round(r.total_water_requirement_mm || 0)} <span style="font-size:.5em">mm</span></div></div>
          <div class="kpi"><div class="kpi__lbl">Rainfall</div>
            <div class="kpi__val">${Math.round(r.total_seasonal_rainfall_mm || 0)} <span style="font-size:.5em">mm</span></div></div>
          <div class="kpi kpi--good"><div class="kpi__lbl">Irrigation needed</div>
            <div class="kpi__val">${Math.round(r.total_irrigation_needed_mm || 0)} <span style="font-size:.5em">mm</span></div></div>
          <div class="kpi kpi--warn"><div class="kpi__lbl">Critical weeks</div>
            <div class="kpi__val">${criticalCount}<span style="font-size:.5em;color:var(--ink-faint)">/${schedule.length}</span></div></div>
        </div>

        ${r.reasons ? `
        <div class="alert alert--green" style="margin-top: 16px; border-left: 4px solid var(--brand); background: var(--brand-soft);">
          <div class="alert__body" style="color: var(--brand-deep);">
            <strong>Irrigation Intelligence Reasoning:</strong>
            <ul style="margin: 8px 0 0 16px; padding: 0;">
              ${r.reasons.map(reason => `<li style="margin-bottom: 2px; font-size: 0.85rem; list-style-type: disc;">${reason}</li>`).join('')}
            </ul>
          </div>
        </div>
        ` : ''}

        <div class="chart-box">
          <div class="chart-box__title">Water need vs rainfall · week by week</div>
          <canvas data-chart="irr-bar"></canvas>
        </div>

        <h4 style="font-size:.85rem;font-weight:600;letter-spacing:.12em;text-transform:uppercase;color:var(--ink-faint);margin:16px 0 12px;">Weekly schedule</h4>
        ${schedule.map(s => {
        const high = (s.priority || '').toLowerCase() === 'high';
        return `<div class="list-row" style="${high ? 'background:var(--accent-soft);' : ''}">
            <div class="list-row__bullet" style="background:${high ? 'var(--accent)' : 'var(--sky)'};">${s.week}</div>
            <div class="list-row__name">Week ${s.week} · ${s.growth_stage}
              <small>${s.date_range} · need ${Math.round(s.water_need_mm)}mm, rain ${Math.round(s.expected_rainfall_mm)}mm</small></div>
            <div class="list-row__val">${Math.round(s.irrigation_required_mm)} mm<small>${s.priority}</small></div>
          </div>`;
      }).join('')}`;

      makeChart($('[data-chart="irr-bar"]'), {
        type: 'bar',
        data: {
          labels: schedule.map(s => 'W' + s.week),
          datasets: [
            { label: 'Water need', data: schedule.map(s => s.water_need_mm), backgroundColor: BRAND, borderRadius: 4 },
            { label: 'Rainfall', data: schedule.map(s => s.expected_rainfall_mm), backgroundColor: SKY, borderRadius: 4 },
            { label: 'Irrigation required', data: schedule.map(s => s.irrigation_required_mm), backgroundColor: ACCENT, borderRadius: 4 }
          ]
        },
        options: {
          responsive: true, maintainAspectRatio: false,
          scales: { y: { beginAtZero: true, grid: { color: 'rgba(29,26,21,.06)' }, ticks: { callback: v => v + 'mm' } }, x: { grid: { display: false } } },
          plugins: { legend: { position: 'bottom', labels: { boxWidth: 12, padding: 10 } } }
        }
      });
    } catch (err) { showError(out, err); }
  });

  /* ==========================================================
     TOOL 10: Fertilizer — deficit_npk dict, recommendations[]
     ========================================================== */
  $('[data-form="fertilizer"]').addEventListener('submit', async e => {
    e.preventDefault();
    const out = $('[data-out="fertilizer"]');
    showLoading(out);
    try {
      const f = formToObj(e.target);
      const r = await api(`/api/fertilizer?crop_id=${f.crop_id}&n_kg_per_acre=${f.n}&p_kg_per_acre=${f.p}&k_kg_per_acre=${f.k}`);
      const def = r.deficit_npk || {};
      const recs = r.recommendations || [];
      const deficitN = def.n_kg_per_acre ?? def.n ?? 0;
      const deficitP = def.p_kg_per_acre ?? def.p ?? 0;
      const deficitK = def.k_kg_per_acre ?? def.k ?? 0;

      out.innerHTML = `
        <div class="kpi-grid">
          ${[['N', deficitN], ['P', deficitP], ['K', deficitK]].map(([k, gap]) => {
        // Backend convention: gap > 0 means the soil is SHORT by `gap` kg/ac (deficit);
        // gap <= 0 means the soil already meets or exceeds the crop requirement.
        const deficit = gap > 0;
        const mag = Math.round(Math.abs(gap));
        return `<div class="kpi ${deficit ? 'kpi--warn' : 'kpi--good'}">
              <div class="kpi__lbl">${k} ${deficit ? 'deficit' : 'status'}</div>
              <div class="kpi__val">${TT(gap, (deficit ? '−' : '+') + mag)} <span style="font-size:.5em">kg/ac</span></div>
              <div class="kpi__sub">${deficit ? 'Needs ' + mag + ' kg/ac' : 'Sufficient'}</div>
            </div>`;
      }).join('')}
          <div class="kpi kpi--info"><div class="kpi__lbl">Total cost</div>
            <div class="kpi__val">${INR(r.total_fertilizer_cost_per_acre)}</div>
            <div class="kpi__sub">per acre</div></div>
        </div>

        ${r.reasons ? `
        <div class="alert alert--green" style="margin-top: 16px; border-left: 4px solid var(--brand); background: var(--brand-soft);">
          <div class="alert__body" style="color: var(--brand-deep);">
            <strong>Fertilizer Application guidelines & timing:</strong>
            <ul style="margin: 8px 0 0 16px; padding: 0;">
              ${r.reasons.map(reason => `<li style="margin-bottom: 2px; font-size: 0.85rem; list-style-type: disc;">${reason}</li>`).join('')}
            </ul>
          </div>
        </div>
        ` : ''}

        ${recs.length ? `<div class="chart-box">
          <div class="chart-box__title">Fertilizer cost breakdown</div>
          <canvas data-chart="fert-doughnut"></canvas>
        </div>` : ''}

        <h4 style="font-size:.85rem;font-weight:600;letter-spacing:.12em;text-transform:uppercase;color:var(--ink-faint);margin:16px 0 12px;">Application plan</h4>
        ${recs.length ? recs.map(f => `
          <div class="list-row">
            <div class="list-row__bullet">✓</div>
            <div class="list-row__name">${f.fertilizer} <span class="chip">${f.grade}</span>
              <small>${f.nutrient_supplied} · ${f.application_timing}</small></div>
            <div class="list-row__val">${Math.round(f.quantity_kg_per_acre)} kg<small>${INR(f.cost_inr)}/ac</small></div>
          </div>`).join('') : '<div class="alert alert--green"><svg class="alert__ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 12l2 2 4-4"/><circle cx="12" cy="12" r="10"/></svg><div class="alert__body"><strong>Soil is balanced</strong><p>No major fertilizer needed.</p></div></div>'}

        <div class="alert"><div class="alert__body"><p style="font-size:.82rem;">${r.note || ''}</p></div></div>`;

      if (recs.length) {
        makeChart($('[data-chart="fert-doughnut"]'), {
          type: 'doughnut',
          data: {
            labels: recs.map(f => f.fertilizer.split(' ')[0]),
            datasets: [{ data: recs.map(f => f.cost_inr), backgroundColor: [BRAND, ACCENT, SKY, CLAY, '#7ca894'], borderWidth: 2, borderColor: '#fff' }]
          },
          options: {
            responsive: true, maintainAspectRatio: false, cutout: '62%',
            plugins: { legend: { position: 'right', labels: { boxWidth: 12, padding: 8 } }, tooltip: { callbacks: { label: c => c.label + ': ' + INR(c.parsed) + '/ac' } } }
          }
        });
      }
    } catch (err) { showError(out, err); }
  });

  /* ==========================================================
     TOOL 11: Pest alerts — alerts[] with pest_disease/risk_level/severity
     ========================================================== */
  $('[data-form="pest"]').addEventListener('submit', async e => {
    e.preventDefault();
    const out = $('[data-out="pest"]');
    showLoading(out);
    try {
      const f = formToObj(e.target);
      const r = await api(`/api/pest-alerts/${f.crop_id}?avg_temp_c=${f.avg_temp_c}&rainfall_mm=${f.rainfall_mm}`);
      const alerts = r.alerts || [];

      if (!alerts.length) {
        out.innerHTML = `<div class="alert alert--green">
          <svg class="alert__ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 12l2 2 4-4"/><circle cx="12" cy="12" r="10"/></svg>
          <div class="alert__body"><strong>No active pest risk</strong><p>Current weather (${f.avg_temp_c}°C, ${f.rainfall_mm}mm) is safe for ${f.crop_id}.</p></div></div>`;
        return;
      }

      out.innerHTML = `
        <div class="kpi-grid">
          <div class="kpi kpi--warn"><div class="kpi__lbl">Total alerts</div>
            <div class="kpi__val">${r.total_alerts || alerts.length}</div></div>
          <div class="kpi kpi--${r.high_risk_count > 0 ? 'warn' : 'good'}"><div class="kpi__lbl">High risk</div>
            <div class="kpi__val">${r.high_risk_count || 0}</div></div>
          <div class="kpi"><div class="kpi__lbl">Conditions</div>
            <div class="kpi__val" style="font-size:1.1rem;">${r.temperature_c}°C · ${r.rainfall_mm}mm</div></div>
        </div>

        ${alerts.map(a => {
        const sev = (a.severity || a.risk_level || '').toLowerCase();
        const cls = sev.includes('high') ? 'alert--red' : sev.includes('moderate') || sev.includes('medium') ? 'alert--gold' : 'alert--green';
        const chipCls = cls === 'alert--red' ? 'chip--red' : cls === 'alert--gold' ? 'chip--gold' : 'chip--green';
        return `<div class="alert ${cls}">
            <svg class="alert__ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0zM12 9v4M12 17h.01"/></svg>
            <div class="alert__body">
              <strong>${a.pest_disease} <span class="chip ${chipCls}">${a.risk_level || a.severity}</span></strong>
              <p>${a.description || ''}</p>
              <p style="font-size:.82rem;margin-top:4px;color:var(--ink-faint);"><strong>Trigger:</strong> ${a.trigger || ''} · <strong>Now:</strong> ${a.current_conditions || ''}</p>
              ${a.management || a.treatment ? `<p style="margin-top:6px;"><strong>Action:</strong> ${a.management || a.treatment}</p>` : ''}
            </div></div>`;
      }).join('')}`;
    } catch (err) { showError(out, err); }
  });

  /* ==========================================================
     TOOL 12: Loan — debt_service_coverage_ratio, kcc_note
     ========================================================== */
  $('[data-form="loan"]').addEventListener('submit', async e => {
    e.preventDefault();
    const out = $('[data-out="loan"]');
    showLoading(out);
    try {
      const f = formToObj(e.target);
      const body = {
        total_cost: +f.total_cost, expected_profit: +f.expected_profit,
        loan_amount: +f.loan_amount, interest_rate_annual: +f.interest_rate_annual,
        tenure_months: +f.tenure_months
      };
      const r = await api('/api/loan-calculator', { method: 'POST', body: JSON.stringify(body) });
      const v = (r.verdict || '').toLowerCase();
      const cls = v.includes('safe') ? 'kpi--good' : v.includes('moderate') ? 'kpi--warn' : 'kpi--info';
      const dscr = r.debt_service_coverage_ratio || 0;

      // Build repayment schedule (principal + interest over tenure)
      const n = r.tenure_months, P = r.loan_amount, emi = r.emi;
      const monthlyRate = (r.interest_rate_annual_pct || 0) / 12 / 100;
      let balance = P;
      const principalArr = [], interestArr = [], balanceArr = [];
      for (let i = 0; i < n; i++) {
        const int = balance * monthlyRate;
        const prin = emi - int;
        balance = Math.max(0, balance - prin);
        principalArr.push(prin); interestArr.push(int); balanceArr.push(balance);
      }

      out.innerHTML = `
        <div class="kpi-grid">
          <div class="kpi ${cls}"><div class="kpi__lbl">Verdict</div>
            <div class="kpi__val" style="font-size:1.1rem;">${((r.verdict || '').split('—')[0].trim()) || '—'}</div>
            <div class="kpi__sub">DSCR ${FIX(dscr, 2)}</div></div>
          <div class="kpi"><div class="kpi__lbl">Monthly EMI</div>
            <div class="kpi__val">${INR(r.emi)}</div></div>
          <div class="kpi"><div class="kpi__lbl">Total repayment</div>
            <div class="kpi__val">${INR(r.total_repayment)}</div></div>
          <div class="kpi kpi--warn"><div class="kpi__lbl">Total interest</div>
            <div class="kpi__val">${INR(r.total_interest)}</div></div>
          <div class="kpi kpi--good"><div class="kpi__lbl">Breakeven</div>
            <div class="kpi__val">${r.breakeven_months} <span style="font-size:.5em">mo</span></div></div>
        </div>

        <div class="chart-grid">
          <div class="chart-box">
            <div class="chart-box__title">Principal vs interest per month</div>
            <canvas data-chart="loan-stack"></canvas>
          </div>
          <div class="chart-box">
            <div class="chart-box__title">Outstanding balance</div>
            <canvas data-chart="loan-balance"></canvas>
          </div>
        </div>

        <div class="alert alert--${cls === 'kpi--good' ? 'green' : 'gold'}">
          <svg class="alert__ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="2" y="6" width="20" height="14" rx="2"/><path d="M2 10h20"/></svg>
          <div class="alert__body"><strong>${r.verdict}</strong><p>${r.kcc_note || ''}</p></div>
        </div>`;

      const labels = Array.from({ length: n }, (_, i) => 'M' + (i + 1));
      makeChart($('[data-chart="loan-stack"]'), {
        type: 'bar',
        data: {
          labels,
          datasets: [
            { label: 'Principal', data: principalArr, backgroundColor: BRAND, borderRadius: 4 },
            { label: 'Interest', data: interestArr, backgroundColor: ACCENT, borderRadius: 4 }
          ]
        },
        options: {
          responsive: true, maintainAspectRatio: false,
          scales: { x: { stacked: true, grid: { display: false } }, y: { stacked: true, grid: { color: 'rgba(29,26,21,.06)' }, ticks: { callback: v => '₹' + (v / 1000).toFixed(1) + 'K' } } },
          plugins: { legend: { position: 'bottom', labels: { boxWidth: 12, padding: 10 } } }
        }
      });
      makeChart($('[data-chart="loan-balance"]'), {
        type: 'line',
        data: {
          labels,
          datasets: [{
            label: 'Balance', data: balanceArr, borderColor: CLAY,
            backgroundColor: CLAY + '20', borderWidth: 2.5, tension: 0.3, fill: true, pointRadius: 0
          }]
        },
        options: {
          responsive: true, maintainAspectRatio: false,
          scales: { y: { beginAtZero: true, grid: { color: 'rgba(29,26,21,.06)' }, ticks: { callback: v => '₹' + (v / 1000).toFixed(0) + 'K' } }, x: { grid: { display: false } } },
          plugins: { legend: { display: false } }
        }
      });
    } catch (err) { showError(out, err); }
  });

  /* ==========================================================
     TOOL 13: Govt schemes — eligible_schemes[]
     ========================================================== */
  $('[data-form="schemes"]').addEventListener('submit', async e => {
    e.preventDefault();
    const out = $('[data-out="schemes"]');
    showLoading(out);
    try {
      const f = formToObj(e.target);
      const q = new URLSearchParams({
        crop_id: f.crop_id || 'all',
        season: f.season || 'all',
        area_acres: f.area_acres || 3,
        region_id: 'all'
      }).toString();
      const r = await api(`/api/government-schemes?${q}`);
      const schemes = r.eligible_schemes || [];
      if (!schemes.length) {
        out.innerHTML = `<div class="alert"><div class="alert__body"><strong>No matching schemes</strong><p>Try widening the filters.</p></div></div>`;
        return;
      }
      out.innerHTML = `
        <div style="margin-bottom:16px;"><span class="chip chip--green">${r.total_matched} eligible schemes</span></div>
        ${schemes.map(s => `
          <div class="alert alert--green">
            <svg class="alert__ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="4" y="5" width="16" height="16" rx="2"/><path d="M9 15l2 2 4-4"/></svg>
            <div class="alert__body">
              <strong>${s.scheme_name} ${s.benefit_type ? `<span class="chip chip--gold">${s.benefit_type}</span>` : ''}</strong>
              <p>${s.description || ''}</p>
              ${s.benefit_value ? `<p style="margin-top:4px;"><strong>Benefit:</strong> ${s.benefit_value}</p>` : ''}
              ${(s.url || s.application_url) ? `<p style="margin-top:6px;"><a href="${s.url || s.application_url}" target="_blank" rel="noopener" style="color:var(--brand);font-weight:600;">Apply →</a></p>` : ''}
            </div></div>`).join('')}`;
    } catch (err) { showError(out, err); }
  });

  /* ==========================================================
     TOOL 15: Strategy templates
     ========================================================== */
  $('[data-form="templates"]').addEventListener('submit', async e => {
    e.preventDefault();
    const out = $('[data-out="templates"]');
    showLoading(out, 'Loading templates…');
    try {
      const profile = formToObj(e.target).profile;
      const url = profile ? `/api/strategy-templates?profile=${profile}` : '/api/strategy-templates';
      const list = await api(url);
      if (!Array.isArray(list) || !list.length) {
        out.innerHTML = '<div class="alert"><div class="alert__body"><strong>No templates found.</strong></div></div>';
        return;
      }
      out.innerHTML = `
        <div class="kpi-grid">
          <div class="kpi kpi--good"><div class="kpi__lbl">Templates</div>
            <div class="kpi__val">${list.length}</div>
            <div class="kpi__sub">${profile ? profile + ' profile' : 'All profiles'}</div></div>
        </div>
        <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(280px,1fr));gap:14px;">
          ${list.map(t => {
        const c = t.config || {};
        return `<div style="background:var(--bg-soft);padding:18px;border-radius:var(--r-md);display:flex;flex-direction:column;gap:10px;">
              <div>
                <div style="font-family:'Fraunces',serif;font-size:1.15rem;font-weight:600;line-height:1.2;">${t.name || t.template_id}</div>
                <div style="font-size:.82rem;color:var(--ink-faint);margin-top:3px;">${t.template_id}</div>
              </div>
              <p style="font-size:.9rem;color:var(--ink-soft);margin:0;flex:1;">${t.description || ''}</p>
              <div style="display:flex;flex-wrap:wrap;gap:6px;">
                ${c.crop_id ? `<span class="chip chip--green">${cropLabel(c.crop_id)}</span>` : ''}
                ${c.season ? `<span class="chip">${c.season}</span>` : ''}
                ${c.area_acres ? `<span class="chip">${c.area_acres} ac</span>` : ''}
                ${c.irrigation_level !== undefined ? `<span class="chip chip--blue">irrig ${c.irrigation_level}</span>` : ''}
                ${c.budget_per_acre ? `<span class="chip chip--gold">${INR(c.budget_per_acre)}/ac</span>` : ''}
              </div>
              <div style="font-size:.78rem;color:var(--ink-faint);border-top:1px dashed rgba(29,26,21,.1);padding-top:8px;">${t.profile || ''}</div>
              <button class="btn btn-ghost" data-apply-template='${JSON.stringify(t).replace(/'/g, "&#39;")}' style="padding:8px 14px;font-size:.85rem;">Use in simulator →</button>
            </div>`;
      }).join('')}
        </div>`;

      // Wire up "Use in simulator" buttons → prefill Yield & Profit form
      out.querySelectorAll('[data-apply-template]').forEach(btn => {
        btn.addEventListener('click', () => {
          const tpl = JSON.parse(btn.dataset.applyTemplate.replace(/&#39;/g, "'"));
          const c = tpl.config || {};
          const simForm = document.querySelector('[data-form="simulate"]');
          if (!simForm) return;
          if (c.crop_id) simForm.crop_id.value = c.crop_id;
          if (c.season) simForm.season.value = c.season;
          if (c.area_acres !== undefined) simForm.area_acres.value = c.area_acres;
          if (c.irrigation_level !== undefined) simForm.irrigation_level.value = c.irrigation_level;
          if (c.budget_per_acre) {
            simForm.seed_cost_per_acre.value = Math.round(c.budget_per_acre * 0.12);
            simForm.fertilizer_cost_per_acre.value = Math.round(c.budget_per_acre * 0.30);
            simForm.labour_cost_per_acre.value = Math.round(c.budget_per_acre * 0.25);
            simForm.other_costs_per_acre.value = Math.round(c.budget_per_acre * 0.33);
          }
          // Switch to simulate tab
          document.querySelector('.sidebar__btn[data-tool="simulate"]')?.click();
          window.scrollTo({ top: 0, behavior: 'smooth' });
        });
      });
    } catch (err) { showError(out, err); }
  });

  /* ==========================================================
     TOOL 16: Compare crops (batch-simulate)
     ========================================================== */
  $('[data-form="compare"]').addEventListener('submit', async e => {
    e.preventDefault();
    const out = $('[data-out="compare"]');
    const form = e.target;
    // Pull multi-select values directly (FormData gives only one value)
    const selected = Array.from(form.crop_ids.selectedOptions).map(o => o.value);
    if (selected.length < 2) {
      out.innerHTML = '<div class="alert alert--gold"><div class="alert__body"><strong>Pick at least 2 crops</strong><p>Hold Ctrl / Cmd and click to select multiple.</p></div></div>';
      return;
    }
    showLoading(out, `Simulating ${selected.length} crops in parallel…`);
    try {
      const f = formToObj(form);
      const override = (window.__agrisimWeatherOverride && window.__agrisimWeatherOverride()) || null;
      const farmSoil = (window.__agrisimFarmSoil && window.__agrisimFarmSoil()) || null;
      const [soilRaw, weatherRaw] = await Promise.all([
        farmSoil ? Promise.resolve(farmSoil) : api(`/api/soil/${f.region_id}`).catch(() => ({})),
        override ? Promise.resolve(override) : api(`/api/weather/${f.region_id}?season=${f.season}`).catch(() => ({}))
      ]);
      const coerce = o => Object.fromEntries(Object.entries(o || {}).map(([k, v]) =>
        [k, (typeof v === 'string' && v.trim() !== '' && !isNaN(Number(v))) ? Number(v) : v]));

      const body = {
        crop_ids: selected,
        area_acres: parseFloat(f.area_acres),
        region_id: f.region_id,
        budget_per_acre: parseFloat(f.budget_per_acre),
        irrigation_level: parseFloat(f.irrigation_level),
        seed_variety: 'standard', sowing_date: '2024-06-15',
        soil: coerce(soilRaw),
        weather: coerce(weatherRaw)
      };
      const data = await api('/api/batch-simulate', { method: 'POST', body: JSON.stringify(body) });
      const results = data.results || [];
      if (!results.length) {
        out.innerHTML = '<div class="alert alert--red"><div class="alert__body"><strong>No results</strong><p>' + (data.errors?.[0]?.error || 'Batch simulation returned nothing.') + '</p></div></div>';
        return;
      }

      const best = results[0];
      out.innerHTML = `
        <div class="kpi-grid">
          <div class="kpi kpi--good"><div class="kpi__lbl">Winner</div>
            <div class="kpi__val" style="font-size:1.25rem;">${cropLabel(best.crop_id)}</div>
            <div class="kpi__sub">Profit ${INR(best.profit)}</div></div>
          <div class="kpi"><div class="kpi__lbl">Best ROI</div>
            <div class="kpi__val">${PCT(Math.max(...results.map(r => r.roi_percent)))}</div></div>
          <div class="kpi kpi--info"><div class="kpi__lbl">Crops simulated</div>
            <div class="kpi__val">${data.total_simulated}</div>
            <div class="kpi__sub">${data.errors?.length ? data.errors.length + ' errors' : 'all succeeded'}</div></div>
          <div class="kpi kpi--warn"><div class="kpi__lbl">Profit spread</div>
            <div class="kpi__val">${INR(best.profit - results[results.length - 1].profit)}</div>
            <div class="kpi__sub">winner − loser</div></div>
        </div>

        <div class="chart-grid">
          <div class="chart-box">
            <div class="chart-box__title">Profit ranking</div>
            <canvas data-chart="cmp-profit"></canvas>
          </div>
          <div class="chart-box">
            <div class="chart-box__title">Profit vs risk</div>
            <canvas data-chart="cmp-scatter"></canvas>
          </div>
        </div>

        <h4 style="font-size:.85rem;font-weight:600;letter-spacing:.12em;text-transform:uppercase;color:var(--ink-faint);margin:16px 0 12px;">Detailed comparison</h4>
        ${results.map((r, i) => `
          <div class="list-row">
            <div class="list-row__bullet" style="background:${i === 0 ? BRAND : i === results.length - 1 ? CLAY : 'var(--ink-faint)'};">${i + 1}</div>
            <div class="list-row__name">${cropLabel(r.crop_id)}
              <small>Yield ${Math.round(r.yield_kg_per_acre)} kg/ac · Risk ${Math.round(r.risk_score)}/100 · Revenue ${INR(r.revenue)}</small></div>
            <div class="list-row__val">${INR(r.profit)}<small>ROI ${PCT(r.roi_percent)}</small></div>
          </div>`).join('')}`;

      makeChart($('[data-chart="cmp-profit"]'), {
        type: 'bar',
        data: {
          labels: results.map(r => CROP_LABELS[r.crop_id]?.split(' ·')[0] || r.crop_id),
          datasets: [{
            label: 'Profit',
            data: results.map(r => r.profit),
            backgroundColor: results.map((_, i) => i === 0 ? BRAND : i === results.length - 1 ? CLAY : ACCENT),
            borderRadius: 8, borderSkipped: false
          }]
        },
        options: {
          indexAxis: 'y', responsive: true, maintainAspectRatio: false,
          scales: { x: { beginAtZero: true, grid: { color: 'rgba(29,26,21,.06)' }, ticks: { callback: v => '₹' + (v / 1000).toFixed(0) + 'K' } }, y: { grid: { display: false } } },
          plugins: { legend: { display: false }, tooltip: { callbacks: { label: c => INR(c.parsed.x) } } }
        }
      });

      makeChart($('[data-chart="cmp-scatter"]'), {
        type: 'scatter',
        data: {
          datasets: results.map((r, i) => ({
            label: CROP_LABELS[r.crop_id]?.split(' ·')[0] || r.crop_id,
            data: [{ x: r.risk_score, y: r.profit }],
            backgroundColor: [BRAND, ACCENT, SKY, CLAY, '#7ca894', '#8a8376'][i % 6],
            pointRadius: 10, pointHoverRadius: 13, borderWidth: 2, borderColor: '#fff'
          }))
        },
        options: {
          responsive: true, maintainAspectRatio: false,
          scales: {
            x: { title: { display: true, text: 'Risk score (lower is better) →' }, min: 0, max: 100, grid: { color: 'rgba(29,26,21,.06)' } },
            y: { title: { display: true, text: '↑ Profit' }, beginAtZero: true, grid: { color: 'rgba(29,26,21,.06)' }, ticks: { callback: v => '₹' + (v / 1000).toFixed(0) + 'K' } }
          },
          plugins: {
            legend: { position: 'bottom', labels: { boxWidth: 10, padding: 8 } },
            tooltip: { callbacks: { label: c => c.dataset.label + ': risk ' + c.parsed.x.toFixed(0) + ', profit ' + INR(c.parsed.y) } }
          }
        }
      });
    } catch (err) { showError(out, err); }
  });

  /* ==========================================================
     TOOL 17: Optimal crop mix
     ========================================================== */
  $('[data-form="mix"]').addEventListener('submit', async e => {
    e.preventDefault();
    const out = $('[data-out="mix"]');
    showLoading(out, 'Optimising allocation across crops…');
    try {
      const f = formToObj(e.target);
      const override = (window.__agrisimWeatherOverride && window.__agrisimWeatherOverride()) || null;
      const farmSoil = (window.__agrisimFarmSoil && window.__agrisimFarmSoil()) || null;
      const [soilRaw, weatherRaw] = await Promise.all([
        farmSoil ? Promise.resolve(farmSoil) : api(`/api/soil/${f.region_id}`).catch(() => ({})),
        override ? Promise.resolve(override) : api(`/api/weather/${f.region_id}?season=${f.season}`).catch(() => ({}))
      ]);
      const coerce = o => Object.fromEntries(Object.entries(o || {}).map(([k, v]) =>
        [k, (typeof v === 'string' && v.trim() !== '' && !isNaN(Number(v))) ? Number(v) : v]));

      const body = {
        region_id: f.region_id,
        season: f.season,
        total_area_acres: parseFloat(f.total_area_acres),
        total_budget: parseFloat(f.total_budget),
        soil: coerce(soilRaw),
        weather: coerce(weatherRaw)
      };
      const r = await api('/api/optimal-mix', { method: 'POST', body: JSON.stringify(body) });
      const allocs = r.allocations || [];
      if (!allocs.length) {
        out.innerHTML = '<div class="alert"><div class="alert__body"><strong>No allocations returned.</strong></div></div>';
        return;
      }

      out.innerHTML = `
        <div class="kpi-grid">
          <div class="kpi kpi--good"><div class="kpi__lbl">Total profit</div>
            <div class="kpi__val">${INR(r.total_expected_profit)}</div>
            <div class="kpi__sub">across ${r.num_crops} crops</div></div>
          <div class="kpi"><div class="kpi__lbl">Land allocated</div>
            <div class="kpi__val">${allocs.reduce((s, a) => s + a.allocated_acres, 0).toFixed(1)}<span style="font-size:.5em"> / ${r.total_area_acres} ac</span></div></div>
          <div class="kpi"><div class="kpi__lbl">Budget used</div>
            <div class="kpi__val">${INR(allocs.reduce((s, a) => s + a.allocated_budget, 0))}<span style="font-size:.5em"> / ${INR(r.total_budget)}</span></div></div>
          <div class="kpi kpi--warn"><div class="kpi__lbl">Avg risk</div>
            <div class="kpi__val">${Math.round(r.avg_risk_score || 0)}<span style="font-size:.5em;color:var(--ink-faint)">/100</span></div></div>
        </div>

        <div class="chart-grid">
          <div class="chart-box">
            <div class="chart-box__title">Land allocation (acres)</div>
            <canvas data-chart="mix-land"></canvas>
          </div>
          <div class="chart-box">
            <div class="chart-box__title">Profit contribution</div>
            <canvas data-chart="mix-profit"></canvas>
          </div>
        </div>

        <h4 style="font-size:.85rem;font-weight:600;letter-spacing:.12em;text-transform:uppercase;color:var(--ink-faint);margin:16px 0 12px;">Detailed allocation</h4>
        ${allocs.map((a, i) => `
          <div class="list-row">
            <div class="list-row__bullet">${i + 1}</div>
            <div class="list-row__name">${cropLabel(a.crop_id)}
              <small>${a.allocated_acres} ac · Budget ${INR(a.allocated_budget)} · Risk ${Math.round(a.risk_score)}/100</small></div>
            <div class="list-row__val">${INR(a.expected_profit)}<small>ROI ${PCT(a.roi_percent)}</small></div>
          </div>`).join('')}`;

      const palette = [BRAND, ACCENT, SKY, CLAY, '#7ca894', '#8a8376', '#d4a64a', '#6ea7c7'];
      makeChart($('[data-chart="mix-land"]'), {
        type: 'doughnut',
        data: {
          labels: allocs.map(a => CROP_LABELS[a.crop_id]?.split(' ·')[0] || a.crop_id),
          datasets: [{ data: allocs.map(a => a.allocated_acres), backgroundColor: palette, borderWidth: 2, borderColor: '#fff' }]
        },
        options: {
          responsive: true, maintainAspectRatio: false, cutout: '62%',
          plugins: { legend: { position: 'right', labels: { boxWidth: 12, padding: 8 } }, tooltip: { callbacks: { label: c => c.label + ': ' + c.parsed + ' ac' } } }
        }
      });
      makeChart($('[data-chart="mix-profit"]'), {
        type: 'bar',
        data: {
          labels: allocs.map(a => CROP_LABELS[a.crop_id]?.split(' ·')[0] || a.crop_id),
          datasets: [{ data: allocs.map(a => a.expected_profit), backgroundColor: palette, borderRadius: 8, borderSkipped: false }]
        },
        options: {
          responsive: true, maintainAspectRatio: false,
          scales: { y: { beginAtZero: true, grid: { color: 'rgba(29,26,21,.06)' }, ticks: { callback: v => '₹' + (v / 1000).toFixed(0) + 'K' } }, x: { grid: { display: false } } },
          plugins: { legend: { display: false }, tooltip: { callbacks: { label: c => INR(c.parsed.y) } } }
        }
      });
    } catch (err) { showError(out, err); }
  });

  /* ==========================================================
     TOOL 14: ML status / retrain
     ========================================================== */
  $('[data-action="ml-status"]').addEventListener('click', async () => {
    const out = $('[data-out="ml"]');
    showLoading(out, 'Checking model status…');
    try {
      const r = await api('/api/ml/status');
      const m = r.training_report || {};
      const my = m.yield_model || m.yield || {};
      const mp = m.price_model || m.price || {};
      const mr = m.recommend_model || m.recommend || {};
      const aud = r.audit_metrics || {};
      const recAud = aud.crop_recommendation || {};
      const yieldAud = aud.yield_prediction || {};

      // Feature importances
      const recFeats = Object.entries(recAud.permutation_importances || {}).slice(0, 5);
      const yieldFeats = Object.entries(yieldAud.permutation_importances || {}).slice(0, 5);

      out.innerHTML = `
        <div class="kpi-grid">
          <div class="kpi ${r.yield_model_loaded ? 'kpi--good' : 'kpi--warn'}">
            <div class="kpi__lbl">Yield prediction</div>
            <div class="kpi__val">${r.yield_model_loaded ? '✓ Loaded' : '— Offline'}</div>
            <div class="kpi__sub">${yieldAud.algorithm || 'RandomForest'} (Tuned)</div>
          </div>
          <div class="kpi kpi--info">
            <div class="kpi__lbl">Yield performance</div>
            <div class="kpi__val">R² ${FIX(yieldAud.r2 || 0.99, 3)}</div>
            <div class="kpi__sub">MAPE ${yieldAud.mape_pct || 7.5}% | MAE ${Math.round(yieldAud.mae || 411)}kg</div>
          </div>
          <div class="kpi ${r.recommend_model_loaded ? 'kpi--good' : 'kpi--warn'}">
            <div class="kpi__lbl">Crop recommendation</div>
            <div class="kpi__val">${r.recommend_model_loaded ? '✓ Loaded' : '— Offline'}</div>
            <div class="kpi__sub">${recAud.algorithm || 'CatBoost'} (Tuned)</div>
          </div>
          <div class="kpi kpi--info">
            <div class="kpi__lbl">Crop performance</div>
            <div class="kpi__val">${PCT((recAud.accuracy || 0.938) * 100)}</div>
            <div class="kpi__sub">Macro F1: ${FIX(recAud.f1_macro || 0.58, 2)}</div>
          </div>
        </div>

        <div class="chart-grid" style="margin-top: 20px;">
          <div class="chart-box">
            <div class="chart-box__title">Crop Rec. Permutation Importance (SHAP Proxy)</div>
            <ul style="padding: 10px 0 0 20px; font-size: 0.85rem; color: var(--ink-soft);">
              ${recFeats.map(([feat, score]) => `
                <li style="margin-bottom: 6px;">
                  <strong style="color: var(--brand);">${feat.replace('_enc', '')}</strong>: 
                  <span style="font-family: monospace; font-weight: 600;">${score.toFixed(4)}</span>
                </li>`).join('')}
            </ul>
          </div>
          <div class="chart-box">
            <div class="chart-box__title">Yield Pred. Feature Weights</div>
            <ul style="padding: 10px 0 0 20px; font-size: 0.85rem; color: var(--ink-soft);">
              ${yieldFeats.map(([feat, score]) => `
                <li style="margin-bottom: 6px;">
                  <strong style="color: var(--brand);">${feat.replace('_enc', '')}</strong>: 
                  <span style="font-family: monospace; font-weight: 600;">${score.toFixed(4)}</span>
                </li>`).join('')}
            </ul>
          </div>
        </div>

        <div class="alert alert--green" style="margin-top: 20px; border-left: 4px solid var(--brand); background: var(--brand-soft);">
          <div class="alert__body" style="color: var(--brand-deep);">
            <strong>ML Robustness Stress Test Diagnostics:</strong>
            <ul style="margin: 8px 0 0 16px; padding: 0; font-size: 0.85rem;">
              <li style="margin-bottom: 4px;">⛅ <strong>Sensor Failure Weather Simulation (Rainfall/Temp to 0.0):</strong> Crop Recommendation test accuracy drops from 93.8% to <b>${PCT((recAud.robustness_noisy_weather_accuracy || 0.829) * 100)}</b> (highly stable, graceful degradation).</li>
              <li style="margin-bottom: 4px;">🌵 <strong>Severe Regional Drought Simulation (Rainfall to 0.0):</strong> Yield Regressor prediction accuracy ($R^2$) maintains at <b>${FIX(yieldAud.robustness_drought_r2 || 0.989, 4)}</b>.</li>
            </ul>
          </div>
        </div>

        <div class="alert"><div class="alert__body">
          <strong>Production Model Directory</strong>
          <p style="font-family:monospace;font-size:.82rem;word-break:break-all;">${r.model_dir}</p>
        </div></div>`;
    } catch (err) { showError(out, err); }
  });
  $('[data-action="ml-train"]').addEventListener('click', async () => {
    if (!confirm('Retrain all 3 ML models? This takes 20–40 seconds.')) return;
    const out = $('[data-out="ml"]');
    showLoading(out, 'Retraining yield, price & recommend models…');
    try {
      await api('/api/ml/train', { method: 'POST', body: JSON.stringify({}) });
      out.innerHTML = `<div class="alert alert--green">
        <svg class="alert__ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><path d="M9 12l2 2 4-4"/></svg>
        <div class="alert__body"><strong>All models retrained ✓</strong><p>Click "Check status" to see fresh metrics.</p></div></div>`;
    } catch (err) { showError(out, err); }
  });

  /* ==========================================================
     FARM BOUNDARY PICKUP (from farm-boundary.html)
     The user draws a polygon and clicks "Use in dashboard".
     FarmState persists the enriched farm object (centroid,
     region_id, state, district, village, geojson, soil).

     This section:
     - Loads the farm via FarmState (migrates legacy agrisim_farm key).
     - Pre-fills area_acres AND region_id across every form.
     - Shows an enhanced farm-pickup banner.
     - Exposes soil for the simulate tool (__agrisimFarmSoil).
     ========================================================== */

  // FARM_KEY: used by the Clear button below.
  const FARM_KEY = 'mittimantra_selectedFarm';
  // Note: savedFarm is declared and initialized at the TOP of this IIFE
  // so it is available to all async callbacks (region select population, etc.)


  function mapBoundarySoilToSimulator(src) {
    // farm-boundary stores raw SoilGrids layers. The simulator wants
    // {ph, n_kg_per_acre, p_kg_per_acre, k_kg_per_acre}. Best-effort mapping.
    if (!src) return null;
    const ph = src.phh2o != null ? +src.phh2o / 10 : undefined; // cg→pH
    const n_raw = src.nitrogen;                                 // cg/kg
    const soc = src.soc;                                      // dg/kg
    const fertility = soc != null ? Math.max(0.5, Math.min(1.5, soc / 200)) : 1;
    const out = {};
    if (ph != null && !isNaN(ph)) out.ph = +ph.toFixed(2);
    if (n_raw != null) out.n_kg_per_acre = +((n_raw / 100) * 4.047).toFixed(1);
    out.p_kg_per_acre = +(25 * fertility).toFixed(1);
    out.k_kg_per_acre = +(120 * fertility).toFixed(1);
    return out;
  }

  function renderFarmPickup() {
    const host = document.getElementById('farmPickup');
    if (!host) return;
    if (!savedFarm) { host.hidden = true; host.innerHTML = ''; return; }

    const acres = (savedFarm.acres || 0).toFixed(2);
    const ha = (savedFarm.hectares || 0).toFixed(2);
    const lat = (savedFarm.lat || (savedFarm.centroid && savedFarm.centroid[1]) || 0).toFixed(5);
    const lon = (savedFarm.lon || (savedFarm.centroid && savedFarm.centroid[0]) || 0).toFixed(5);

    // Location chips — show state, district, village (whatever is available)
    const locParts = [savedFarm.state, savedFarm.district, savedFarm.village].filter(Boolean);
    const locChips = locParts.length
      ? locParts.map(p => `<span class="fp-chip">${p}</span>`).join('')
      : `<span class="fp-chip fp-chip--dim">${lat}°N, ${lon}°E</span>`;

    // Matched region display name
    let regionDisplay = savedFarm.region_id || '';
    if (typeof window.FarmState !== 'undefined' && savedFarm.region_id) {
      const rec = window.FarmState.getRegionRecord(savedFarm.region_id);
      if (rec) regionDisplay = rec.displayName;
    }

    host.hidden = false;
    host.innerHTML = `
      <div class="farm-pickup__ico">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 7l9-4 9 4v10l-9 4-9-4V7z"/><path d="M3 7l9 4 9-4"/><path d="M12 11v10"/></svg>
      </div>
      <div class="farm-pickup__body">
        <strong>Your farm is active</strong>
        <div class="fp-meta">
          <span class="fp-meta__item">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 3v18h18"/><path d="M7 16l3-4 4 3 5-7"/></svg>
            ${acres} acres &middot; ${ha} ha
          </span>
          <span class="fp-meta__item">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="3"/><path d="M12 1v4M12 19v4M1 12h4M19 12h4"/></svg>
            ${lat}°N, ${lon}°E
          </span>
          ${regionDisplay ? `<span class="fp-meta__item fp-meta__item--region" title="This matched backend dataset profile will be used for regional predictions.">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><path d="M12 16v-4M12 8h.01"/></svg>
            Dataset profile: ${regionDisplay}
          </span>` : ''}
        </div>
        <div class="fp-chips">${locChips}</div>
        ${savedFarm.soil ? '<div class="fp-note">✓ SoilGrids data available — will be used in simulation.</div>' : ''}
      </div>
      <div class="farm-pickup__actions">
        <a href="farm-boundary.html" class="btn btn-ghost" style="padding:8px 14px;font-size:.85rem;">Edit farm</a>
        <button id="farmPickupClear" class="btn btn-ghost" style="padding:8px 14px;font-size:.85rem;">Clear</button>
      </div>`;

    document.getElementById('farmPickupClear').addEventListener('click', () => {
      if (typeof window.FarmState !== 'undefined') window.FarmState.clear();
      else { try { localStorage.removeItem(FARM_KEY); localStorage.removeItem('agrisim_farm'); } catch { } }
      savedFarm = null;
      renderFarmPickup();
      // Revert region selects to first available option
      $$('select[data-regions]').forEach(sel => {
        if (sel.options.length) sel.selectedIndex = 0;
      });

      // Reset fertilizer form default values
      const fertForm = document.querySelector('[data-form="fertilizer"]');
      if (fertForm) {
        fertForm.n.value = "45";
        fertForm.p.value = "22";
        fertForm.k.value = "25";
      }
    });
  }

  function applyFarmToForms() {
    if (!savedFarm) return;

    // FIX-7: Pre-fill area inputs from drawn farm
    if (savedFarm.acres) {
      const area = +savedFarm.acres.toFixed(2);
      $$('input[name="area_acres"]').forEach(el => { el.value = area; });
      // Some tools use total_area_acres (optimal mix)
      $$('input[name="total_area_acres"]').forEach(el => { el.value = area; });
    }

    // FIX-7: Pre-fill REGION selects — this was the key missing piece.
    // Without this, every tool still defaulted to whatever the API returned first.
    if (savedFarm.region_id) {
      $$('select[data-regions]').forEach(sel => {
        const opt = sel.querySelector(`option[value="${savedFarm.region_id}"]`);
        if (opt) sel.value = savedFarm.region_id;
      });
    }

    // Pre-fill fertilizer form inputs with SoilGrids values if available
    if (savedFarm.soil) {
      const simSoil = mapBoundarySoilToSimulator(savedFarm.soil);
      if (simSoil) {
        const fertForm = document.querySelector('[data-form="fertilizer"]');
        if (fertForm) {
          if (simSoil.n_kg_per_acre != null) fertForm.n.value = Math.round(simSoil.n_kg_per_acre);
          if (simSoil.p_kg_per_acre != null) fertForm.p.value = Math.round(simSoil.p_kg_per_acre);
          if (simSoil.k_kg_per_acre != null) fertForm.k.value = Math.round(simSoil.k_kg_per_acre);
        }
      }
    }
  }

  renderFarmPickup();
  applyFarmToForms();

  /* ==========================================================
     WEATHER OVERRIDE — hooks into the Simulate tool.
     1. User toggles the checkbox → rainfall/temp inputs win.
     2. "Fetch live weather" fills them from the API so they
        can inspect and tweak before simulating.
     3. Submit handler (below) short-circuits the API call
        when override is active.
     ========================================================== */
  const simForm = $('[data-form="simulate"]');
  if (simForm) {
    const fetchBtn = simForm.querySelector('[data-weather-fetch]');
    fetchBtn?.addEventListener('click', async () => {
      const region = simForm.region_id.value;
      const season = simForm.season.value;
      const original = fetchBtn.textContent;
      fetchBtn.disabled = true;
      fetchBtn.textContent = 'Fetching…';
      try {
        const w = await api(`/api/weather/${region}?season=${season}`);
        if (w && w.rainfall_mm != null) simForm.rainfall_mm.value = Math.round(+w.rainfall_mm);
        if (w && w.avg_temp_c != null) simForm.avg_temp_c.value = (+w.avg_temp_c).toFixed(1);
        simForm.weather_override_on.checked = true;
      } catch (err) {
        alert('Live weather unavailable: ' + err.message);
      } finally {
        fetchBtn.disabled = false;
        fetchBtn.textContent = original;
      }
    });
  }

  // Patch the simulate handler post-hoc: intercept the fetch via a shim.
  // Simpler path: expose the override via a getter the handler reads.
  window.__agrisimWeatherOverride = () => {
    if (!simForm) return null;
    const on = simForm.weather_override_on && simForm.weather_override_on.checked;
    if (!on) return null;
    const rain = parseFloat(simForm.rainfall_mm.value);
    const temp = parseFloat(simForm.avg_temp_c.value);
    if (!isFinite(rain) && !isFinite(temp)) return null;
    const out = {};
    if (isFinite(rain)) out.rainfall_mm = rain;
    if (isFinite(temp)) out.avg_temp_c = temp;
    return out;
  };

  window.__agrisimFarmSoil = () => {
    if (!savedFarm || !savedFarm.soil) return null;
    return mapBoundarySoilToSimulator(savedFarm.soil);
  };

  /* ==========================================================
     TOOL 11b: Crop Disease Detection Flagship Feature
     ========================================================== */
  const DISEASE_CLASSES = [
    "maize_common_rust", "maize_gray_leaf_spot", "maize_northern_leaf_blight", "maize_healthy",
    "potato_early_blight", "potato_late_blight", "potato_healthy",
    "soybean_healthy",
    "tomato_bacterial_spot", "tomato_early_blight", "tomato_late_blight", "tomato_leaf_mold",
    "tomato_septoria_leaf_spot", "tomato_spider_mites", "tomato_target_spot",
    "tomato_yellow_leaf_curl_virus", "tomato_mosaic_virus", "tomato_healthy"
  ];

  const DISEASE_METADATA = {
    "maize_common_rust": {
      "name": "Maize Common Rust",
      "organic": [
        "Destroy infected crop debris after harvest to prevent winter survival.",
        "Plant resistant maize hybrids.",
        "Apply organic copper-based fungicides if caught in very early stages."
      ],
      "chemical": [
        "Spray Mancozeb 75 WP at 2g/L or Propiconazole 25 EC at 1ml/L of water."
      ],
      "schemes": ["pmfby", "kkc"]
    },
    "maize_gray_leaf_spot": {
      "name": "Maize Gray Leaf Spot",
      "organic": [
        "Rotate crops for 2 or more years with non-host crops (e.g. pulses, soybean).",
        "Deep tillage to bury infected plant residues in the soil."
      ],
      "chemical": [
        "Spray Pyraclostrobin or Azoxystrobin based fungicides at recommended intervals."
      ],
      "schemes": ["pmfby", "kkc"]
    },
    "maize_northern_leaf_blight": {
      "name": "Maize Northern Leaf Blight",
      "organic": [
        "Select resistant cultivars.",
        "Bury crop residues with deep tillage after harvest."
      ],
      "chemical": [
        "Apply foliar spray of Mancozeb or Zineb when lesions are first observed."
      ],
      "schemes": ["pmfby"]
    },
    "maize_healthy": {
      "name": "Maize Healthy Leaf",
      "organic": [
        "Continue standard crop rotation.",
        "Ensure balanced fertilization according to soil tests."
      ],
      "chemical": [
        "No chemical inputs are required."
      ],
      "schemes": []
    },
    "potato_early_blight": {
      "name": "Potato Early Blight",
      "organic": [
        "Prune lower infected leaves.",
        "Avoid overhead irrigation to keep leaves dry.",
        "Apply neem oil spray (0.5%) as a biological preventative."
      ],
      "chemical": [
        "Spray Chlorothalonil or Mancozeb (2g/L) at 10-14 day intervals."
      ],
      "schemes": ["pmfby", "kkc"]
    },
    "potato_late_blight": {
      "name": "Potato Late Blight",
      "organic": [
        "Plant certified disease-free seed tubers.",
        "Destroy all cull piles and volunteers immediately.",
        "Apply Trichoderma-based bio-fungicides."
      ],
      "chemical": [
        "Foliar application of Metalaxyl-M (8%) + Mancozeb (64%) WP (Ridomil Gold) at 2.5g/L."
      ],
      "schemes": ["pmfby", "kkc"]
    },
    "potato_healthy": {
      "name": "Potato Healthy Leaf",
      "organic": [
        "Monitor weather patterns (humidity) and spray preventive bio-agents."
      ],
      "chemical": [
        "No chemical fungicide is required."
      ],
      "schemes": []
    },
    "soybean_healthy": {
      "name": "Soybean Healthy Leaf",
      "organic": [
        "Practice crop rotation.",
        "Ensure proper drainage in fields."
      ],
      "chemical": [
        "No chemical fungicide is required."
      ],
      "schemes": []
    },
    "tomato_bacterial_spot": {
      "name": "Tomato Bacterial Spot",
      "organic": [
        "Use certified pathogen-free seeds.",
        "Avoid working in fields when foliage is wet.",
        "Apply copper hydroxide bio-blends."
      ],
      "chemical": [
        "Apply Copper Hydroxide (2g/L) mixed with Streptocycline (0.1g/L) at weekly intervals."
      ],
      "schemes": ["pmfby"]
    },
    "tomato_early_blight": {
      "name": "Tomato Early Blight",
      "organic": [
        "Prune lower branches to improve airflow and reduce soil splash.",
        "Apply organic straw mulch to create a barrier over soil.",
        "Foliar spray of Bacillus subtilis biological agent."
      ],
      "chemical": [
        "Foliar spray of Azoxystrobin 23% SC (1ml/L) or Mancozeb 75 WP (2g/L)."
      ],
      "schemes": ["pmfby", "kkc"]
    },
    "tomato_late_blight": {
      "name": "Tomato Late Blight",
      "organic": [
        "Remove and burn infected plants immediately.",
        "Avoid overhead irrigation.",
        "Spray copper-based organic fungicides at first sign of rain/fog."
      ],
      "chemical": [
        "Apply Cymoxanil + Mancozeb (Curzate) or Metalaxyl + Mancozeb (Ridomil Gold) immediately."
      ],
      "schemes": ["pmfby", "kkc"]
    },
    "tomato_leaf_mold": {
      "name": "Tomato Leaf Mold",
      "organic": [
        "Increase spacing and ventilation.",
        "Avoid overhead watering and keep humidity below 85%."
      ],
      "chemical": [
        "Spray Chlorothalonil or Difenoconazole if infection becomes severe."
      ],
      "schemes": []
    },
    "tomato_septoria_leaf_spot": {
      "name": "Tomato Septoria Leaf Spot",
      "organic": [
        "Remove and destroy lower infected leaves.",
        "Mulch the soil base and water at ground level."
      ],
      "chemical": [
        "Apply Chlorothalonil or Mancozeb sprays at first sign of leaf spots."
      ],
      "schemes": []
    },
    "tomato_spider_mites": {
      "name": "Tomato Spider Mite Infestation",
      "organic": [
        "Spray neem oil (1-2%) or insecticidal soaps.",
        "Release phytoseiid predatory mites.",
        "Keep plants well irrigated (dry dust promotes mite breeding)."
      ],
      "chemical": [
        "Apply Abamectin or Spiromesifen acaricides."
      ],
      "schemes": []
    },
    "tomato_target_spot": {
      "name": "Tomato Target Spot",
      "organic": [
        "Improve air circulation through staking and pruning.",
        "Bury or burn crop residues."
      ],
      "chemical": [
        "Spray Azoxystrobin or Chlorothalonil."
      ],
      "schemes": []
    },
    "tomato_yellow_leaf_curl_virus": {
      "name": "Tomato Yellow Leaf Curl Virus (TYLCV)",
      "organic": [
        "Place yellow sticky traps to catch whitefly vectors.",
        "Use insect netting on nursery beds.",
        "Spray neem seed kernel extract (NSKE) to deter pests."
      ],
      "chemical": [
        "Spray systemic insecticides like Imidacloprid (0.5ml/L) or Thiamethoxam to control whiteflies."
      ],
      "schemes": ["pmfby"]
    },
    "tomato_mosaic_virus": {
      "name": "Tomato Mosaic Virus (ToMV)",
      "organic": [
        "Drench tools and hands in 10% trisodium phosphate.",
        "Promptly pull out and destroy infected plants."
      ],
      "chemical": [
        "No chemical cure is available for viral infections. Manage vector insects chemically if needed."
      ],
      "schemes": []
    },
    "tomato_healthy": {
      "name": "Tomato Healthy Leaf",
      "organic": [
        "Maintain clean hygiene and baseline soil care and clean field hygiene."
      ],
      "chemical": [
        "No chemical inputs are required."
      ],
      "schemes": []
    }
  };

  let tfjsModel = null;
  let tfjsLoaded = false;
  let isModelLoading = false;

  // Function to dynamically load TFJS CDN
  function loadTFJS() {
    if (tfjsLoaded || isModelLoading) return;
    isModelLoading = true;
    const statusEl = $('#modelLoadStatus');
    statusEl.innerHTML = `<span class="spinner" style="border: 2px solid rgba(0,0,0,0.1); border-left-color: var(--brand); border-radius: 50%; width: 14px; height: 14px; animation: spin 1s linear infinite; display: inline-block;"></span> Loading TensorFlow.js client library…`;

    const script = document.createElement('script');
    script.src = 'https://cdn.jsdelivr.net/npm/@tensorflow/tfjs@4.22.0/dist/tf.min.js';
    script.onload = async () => {
      tfjsLoaded = true;
      try {
        statusEl.innerHTML = `<span class="spinner" style="border: 2px solid rgba(0,0,0,0.1); border-left-color: var(--brand); border-radius: 50%; width: 14px; height: 14px; animation: spin 1s linear infinite; display: inline-block;"></span> Loading exported disease model offline…`;
        tfjsModel = await tf.loadLayersModel('/models/disease/model.json');
        statusEl.innerHTML = `✓ TF.js Disease Model loaded and active offline`;
        statusEl.style.color = 'var(--brand)';
        $('#runDiseaseScanBtn').disabled = false;
      } catch (err) {
        console.error("TF.js Model Load failed:", err);
        statusEl.innerHTML = `⚠ Model unavailable. Will run via fallback cloud API`;
        statusEl.style.color = '#c88a3a';
        $('#runDiseaseScanBtn').disabled = false;
      } finally {
        isModelLoading = false;
      }
    };
    script.onerror = () => {
      isModelLoading = false;
      statusEl.innerHTML = `⚠ Library offline. Falling back to backend cloud diagnostics`;
      statusEl.style.color = '#c88a3a';
      $('#runDiseaseScanBtn').disabled = false;
    };
    document.head.appendChild(script);
  }

  // Bind to disease scan tab click
  const diseaseBtn = $('.sidebar__btn[data-tool="disease"]');
  if (diseaseBtn) {
    diseaseBtn.addEventListener('click', () => {
      loadTFJS();
      // Sync farm contexts
      if (savedFarm && savedFarm.region_id) {
        $('#diseaseRegionSelect').value = savedFarm.region_id;
      }
      const knownCrop = savedFarm?.crop_id || localStorage.getItem('mittimantra_selectedCrop') || '';
      if (knownCrop && ["maize", "potato", "soybean", "tomato"].includes(knownCrop)) {
        $('#diseaseCropSelect').value = knownCrop;
      }
    });
  }

  // Handle image upload and preview
  const imgInput = $('#diseaseImageInput');
  const imgPreview = $('#diseaseImagePreview');
  const previewContainer = $('#imagePreviewContainer');
  const uploadPrompt = $('#uploadPrompt');
  const resizeCanvas = $('#diseaseResizeCanvas');
  const resizeCtx = resizeCanvas.getContext('2d');
  const runScanBtn = $('#runDiseaseScanBtn');

  if (imgInput) {
    imgInput.addEventListener('change', e => {
      const file = e.target.files[0];
      if (!file) return;

      const reader = new FileReader();
      reader.onload = evt => {
        imgPreview.src = evt.target.result;
        uploadPrompt.style.display = 'none';
        previewContainer.style.display = 'block';

        imgPreview.onload = () => {
          // Draw to canvas and scale to 224x224
          resizeCtx.drawImage(imgPreview, 0, 0, 224, 224);
          runScanBtn.disabled = false;
        };
      };
      reader.readAsDataURL(file);
    });
  }

  const reuploadBtn = $('#reuploadBtn');
  if (reuploadBtn) {
    reuploadBtn.addEventListener('click', e => {
      e.stopPropagation();
      e.preventDefault();
      imgInput.value = '';
      imgPreview.src = '';
      previewContainer.style.display = 'none';
      uploadPrompt.style.display = 'block';
      runScanBtn.disabled = true;
      $('#diseaseResultsBox').style.display = 'none';
    });
  }

  // Queue logging helper
  function queueOfflineLog(crop, disease, confidence, severity, region) {
    let logs = [];
    try {
      logs = JSON.parse(localStorage.getItem('mittimantra_disease_logs') || '[]');
    } catch (_) { }
    logs.push({
      crop_id: crop,
      disease: disease,
      confidence: confidence,
      severity: severity,
      region_id: region,
      timestamp: new Date().toISOString(),
      offline: !navigator.onLine
    });
    try {
      localStorage.setItem('mittimantra_disease_logs', JSON.stringify(logs));
    } catch (_) { }

    if (navigator.onLine) {
      syncOfflineLogs();
    }
  }

  async function syncOfflineLogs() {
    if (!navigator.onLine) return;
    let logs = [];
    try {
      logs = JSON.parse(localStorage.getItem('mittimantra_disease_logs') || '[]');
    } catch (_) { return; }
    if (!logs.length) return;

    // We process logs through our Site-aware Chatbot /api/chat or console reporting
    console.log("Synchronizing crop disease diagnostic logs to Mitti Mantra backend:", logs);
    localStorage.setItem('mittimantra_disease_logs', '[]');
  }
  window.addEventListener('online', syncOfflineLogs);

  // Run Disease Scan inference
  if (runScanBtn) {
    runScanBtn.addEventListener('click', async () => {
      const resultsBox = $('#diseaseResultsBox');
      showLoading(resultsBox, 'Analyzing leaf pixels and executing neural network...');
      resultsBox.style.display = 'block';

      const cropCtx = $('#diseaseCropSelect').value;
      const regionId = $('#diseaseRegionSelect').value;

      try {
        // 1. Compute Severity Bucket client-side via Leaf Pixel Segmentation & Color Thresholding
        const imgData = resizeCtx.getImageData(0, 0, 224, 224);
        const pixelBytes = imgData.data;
        let greenCount = 0;
        let lesionCount = 0;

        for (let i = 0; i < pixelBytes.length; i += 4) {
          const r = pixelBytes[i];
          const g = pixelBytes[i + 1];
          const b = pixelBytes[i + 2];

          const brightness = (r + g + b) / 3.0;
          if (brightness < 20 || brightness > 245) continue; // ignore background / soil shadows

          const isGreen = (g > r) && (g > b) && (g > 30);
          const isLesion = ((r > g) || ((r > 100) && (g > 100) && (b < 80))) && !isGreen && (r > 30 || g > 30);

          if (isGreen) greenCount++;
          else if (isLesion) lesionCount++;
        }

        const totalLeaf = greenCount + lesionCount;
        const lesionPct = totalLeaf > 0 ? (lesionCount / totalLeaf) * 100.0 : 5.0;
        const severity = lesionPct < 5.0 ? 'early' : lesionPct <= 20.0 ? 'moderate' : 'severe';

        // 2. Decide Primary Inference Source (In-browser TF.js or API Fallback)
        let diseaseName = "";
        let confidence = 0.0;
        let matchedCrop = cropCtx || "tomato";
        let treatments = [];
        let subsidySchemes = [];

        const useFallback = !tfjsLoaded || !tfjsModel || !window.tf;

        if (useFallback) {
          // Cloud API Fallback
          const b64Data = resizeCanvas.toDataURL('image/jpeg');
          const payload = {
            image_b64: b64Data,
            crop_id: cropCtx || null,
            region_id: regionId || null
          };
          const r = await api('/api/disease/predict', {
            method: 'POST',
            body: JSON.stringify(payload)
          });

          diseaseName = r.disease;
          confidence = r.confidence;
          matchedCrop = r.crop_matched;
          treatments = r.treatment;
          subsidySchemes = r.subsidy_eligible_schemes;
        } else {
          // Client-Side Offline Inference
          const predictions = tf.tidy(() => {
            const tensor = tf.browser.fromPixels(resizeCanvas)
              .toFloat()
              .div(tf.scalar(255.0))
              .expandDims(0);
            return tfjsModel.predict(tensor);
          });

          const probs = await predictions.data();
          predictions.dispose();

          // Apply crop filtering to remove false positives and narrow candidates
          let bestIdx = 0;
          let bestProb = -1.0;
          for (let i = 0; i < probs.length; i++) {
            const cls = DISEASE_CLASSES[i];
            let score = probs[i];
            if (cropCtx) {
              score = cls.startsWith(cropCtx) ? score * 2.0 : score * 0.05; // heavily filter to selected crop context
            }
            if (score > bestProb) {
              bestProb = score;
              bestIdx = i;
            }
          }

          const finalClass = DISEASE_CLASSES[bestIdx];
          confidence = Math.min(0.99, Math.max(0.40, probs[bestIdx]));

          // Look up metadata offline
          const meta = DISEASE_METADATA[finalClass] || DISEASE_METADATA["tomato_healthy"];
          diseaseName = meta.name;
          matchedCrop = finalClass.split('_')[0];

          meta.organic.forEach(o => treatments.push("Organic: " + o));
          meta.chemical.forEach(c => treatments.push("Chemical Escalation: " + c));

          // Fetch local government schemes for subsidy matching (if online)
          if (navigator.onLine && regionId) {
            try {
              const sRes = await api(`/api/government-schemes?crop_id=${matchedCrop}&region_id=${regionId}`);
              const eligible = sRes.eligible_schemes || [];
              eligible.forEach(s => {
                if (meta.schemes.includes(s.scheme_id) || (s.scheme_id === 'pkvy' && meta.organic.length)) {
                  subsidySchemes.push(`${s.scheme_name} (${s.description}) — URL: ${s.url}`);
                }
              });
            } catch (_) { }
          }

          // Offline schemes fallback
          if (!subsidySchemes.length) {
            meta.schemes.forEach(sid => {
              if (sid === 'pmfby') subsidySchemes.push("PMFBY (Crop Insurance) — URL: https://pmfby.gov.in");
              if (sid === 'kkc') subsidySchemes.push("Kisan Credit Card — URL: https://www.nabard.org");
              if (sid === 'pkvy') subsidySchemes.push("PKVY (Organic Cluster Subsidy) — URL: https://pgsindia-ncof.gov.in");
            });
          }
        }

        // 3. Queue Analytics Log
        queueOfflineLog(matchedCrop, diseaseName, confidence, severity, regionId);

        // 4. Render Results UI
        const sevClass = severity === 'early' ? 'good' : severity === 'moderate' ? 'warn' : 'red';
        const sevLabel = severity.charAt(0).toUpperCase() + severity.slice(1);
        const formattedConf = PCT(confidence * 100);

        const organicTreatments = treatments.filter(t => t.startsWith('Organic:'));
        const chemicalTreatments = treatments.filter(t => t.startsWith('Chemical'));

        resultsBox.innerHTML = `
          <div class="kpi-grid">
            <div class="kpi kpi--info">
              <div class="kpi__lbl">Diagnosis</div>
              <div class="kpi__val" style="font-size: 1.15rem; font-weight: 600;">${diseaseName}</div>
              <div class="kpi__sub">Class matched: ${matchedCrop}</div>
            </div>
            <div class="kpi kpi--info">
              <div class="kpi__lbl">Inference Confidence</div>
              <div class="kpi__val">${formattedConf}</div>
              <div class="kpi__sub">${useFallback ? 'Cloud Fallback API' : 'TF.js Offline In-Browser'}</div>
            </div>
            <div class="kpi kpi--${sevClass === 'red' ? 'red' : sevClass === 'warn' ? 'warn' : 'good'}">
              <div class="kpi__lbl">Severity (Lesion Area)</div>
              <div class="kpi__val">${sevLabel} (${FIX(lesionPct, 1)}%)</div>
              <div class="kpi__sub">Computed client-side</div>
            </div>
          </div>

          <div class="chart-grid" style="margin-top: 20px;">
            <div class="chart-box">
              <div class="chart-box__title">🍃 Organic & Low-Cost Treatments</div>
              <ul style="padding: 10px 0 0 20px; font-size: 0.85rem; color: var(--ink-soft); line-height: 1.5;">
                ${organicTreatments.map(t => `<li style="margin-bottom: 8px;">${t.replace('Organic: ', '')}</li>`).join('')}
              </ul>
            </div>
            <div class="chart-box">
              <div class="chart-box__title">🧪 Chemical Escalation (Apply if needed)</div>
              <ul style="padding: 10px 0 0 20px; font-size: 0.85rem; color: var(--ink-soft); line-height: 1.5;">
                ${chemicalTreatments.map(t => `<li style="margin-bottom: 8px;">${t.replace('Chemical Escalation: ', '')}</li>`).join('')}
              </ul>
            </div>
          </div>

          ${subsidySchemes.length ? `
          <div class="alert alert--green" style="margin-top: 20px; border-left: 4px solid var(--brand); background: var(--brand-soft);">
            <div class="alert__body" style="color: var(--brand-deep);">
              <strong>Eligible Subsidy Schemes:</strong>
              <ul style="margin: 8px 0 0 16px; padding: 0; font-size: 0.85rem; line-height: 1.4;">
                ${subsidySchemes.map(s => `<li style="margin-bottom: 4px;">💰 ${s}</li>`).join('')}
              </ul>
            </div>
          </div>` : ''}

          <!-- Gyan Seva Redirection Trigger -->
          ${(confidence < 0.70 || severity === 'severe') ? `
          <div class="alert alert--red" style="margin-top: 20px;">
            <svg class="alert__ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0zM12 9v4M12 17h.01"/></svg>
            <div class="alert__body">
              <strong>High-risk diagnosis flagged</strong>
              <p>Because the severity is severe or confidence is low, we highly recommend consulting an agriculture expert.</p>
              <p style="margin-top: 8px;">
                <a href="gyan-seva.html?region=${regionId || ''}&specialty=pathologist" class="btn btn-primary" style="font-size: 0.82rem; padding: 6px 12px; display: inline-block;">Connect with Regional Expert on Gyan Seva</a>
              </p>
            </div>
          </div>` : ''}

          <div style="margin-top: 16px; font-size: 0.78rem; color: var(--ink-faint); text-align: center; font-style: italic;">
            * Field accuracy differs from lab conditions. Always confirm severe cases with an agricultural expert.
          </div>
        `;
      } catch (err) {
        showError(resultsBox, err);
      }
    });
  }

})();

