/* =========================================================
   MittiMantra — Farm boundary drawing
   Leaflet + leaflet-draw + Turf.js + FarmState

   Changes from original
   ─────────────────────
   1. After polygon is created, run reverse-geocode via Nominatim
      to detect state / district / village at the centroid.
   2. Call FarmState.getNearestRegionId(centroid) to find the
      closest backend region_id (pure math, works offline).
   3. Store all enriched fields in currentData before saving.
   4. Summary card shows location chips (state · district · village)
      and the matched region_id.
   5. "Use in dashboard" saves via FarmState.save() (migrates the
      legacy agrisim_farm key automatically).
   6. Draws on satellite imagery with a labelled centroid marker.
   ========================================================= */

(() => {
  const mapEl = document.getElementById('farmMap');
  if (!mapEl || typeof L === 'undefined') return;

  /* ── Dependency guard ──────────────────────────────── */
  if (typeof window.FarmState === 'undefined') {
    console.error('[farm-boundary] FarmState not loaded. Did you include farm-state.js before farm-boundary.js?');
    return;
  }
  /* ── Turf: loaded on demand, not at page load ──────────
     Turf is only used to measure a plot the user has drawn (see
     computeAndShow), but at 543 KB / ~190 ms of parse it was previously the
     single most expensive thing on this page's critical path -- paid by
     everyone who opened the map, including those who never drew anything.
     It is fetched in the background as soon as the map is up, so by the time
     a plot is finished it is almost always already resident; computeAndShow
     awaits it either way. */
  const TURF_URL = 'https://unpkg.com/@turf/turf@7.1.0/turf.min.js';
  const TURF_SRI = 'sha256-xFr0VRlS+kHwSTz0jDU5sYAHdPKr/AMexq9yrM8Yvp8=';
  let turfPromise = null;

  function loadTurf() {
    if (window.turf) return Promise.resolve(window.turf);
    // Memoised: two quick draws must not start two downloads.
    if (turfPromise) return turfPromise;
    turfPromise = new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = TURF_URL;
      s.integrity = TURF_SRI;
      s.crossOrigin = 'anonymous';
      s.async = true;
      s.onload = () => window.turf
        ? resolve(window.turf)
        : reject(new Error('Turf loaded but exposed no global'));
      s.onerror = () => {
        // Let a later attempt retry rather than caching the failure forever.
        turfPromise = null;
        reject(new Error('Turf failed to load'));
      };
      document.head.appendChild(s);
    });
    return turfPromise;
  }

  /* ── Map initialisation ────────────────────────────── */
  const map = L.map(mapEl, { zoomControl: true }).setView([22.5, 79], 5);

  // Satellite base + label overlay
  L.tileLayer(
    'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
    { attribution: 'Imagery © Esri', maxZoom: 19 }
  ).addTo(map);
  L.tileLayer(
    'https://{s}.basemaps.cartocdn.com/rastertiles/voyager_only_labels/{z}/{x}/{y}.png',
    { attribution: '© OSM © CartoDB', maxZoom: 19, opacity: 0.85 }
  ).addTo(map);

  /* ── Drawing hints ─────────────────────────────────── */
  // leaflet-draw ships its own English strings, and i18n.js only walks the DOM,
  // so the live hint tooltip that follows the cursor while drawing — the most
  // important text on this page — would stay English in hi/te/kn. L.drawLocal
  // is read when the polygon handler starts, so re-applying it on every
  // language change is enough. The wording is also touch-first ("tap"), since
  // that is how this page is actually used. (The Finish / Delete last point /
  // Cancel actions below live in the .fb-drawbar buttons instead, which are
  // plain DOM text and pick up translations the same way the rest of the
  // page's copy does.)
  const DRAW_STRINGS = {
    start: 'Tap each corner of your plot.',
    cont:  'Keep tapping to add corners.',
    end:   'Tap the first corner again to finish.',
  };

  function localiseDrawTooltips() {
    const lang = window.AgriSimI18n ? window.AgriSimI18n.getLanguage() : 'en';
    const cat = (window.MM_I18N_CATALOG || {})[lang] || {};
    const t = (s) => cat[s] || s;

    const poly = L.drawLocal.draw.handlers.polygon.tooltip;
    poly.start = t(DRAW_STRINGS.start);
    poly.cont  = t(DRAW_STRINGS.cont);
    poly.end   = t(DRAW_STRINGS.end);
  }

  // i18n-data.js loads after this file, so wait for the document to finish.
  document.addEventListener('DOMContentLoaded', localiseDrawTooltips);
  document.addEventListener('mm:lang-changed', localiseDrawTooltips);
  localiseDrawTooltips();

  /* ── Drawing controls ──────────────────────────────── */
  const drawnItems = new L.FeatureGroup().addTo(map);
  const STROKE = '#2f6b3a'; // MittiMantra brand green
  const SKY    = '#6ea7c7'; // design-system sky — GPS accuracy halo, distinct from the plot

  const POLYGON_OPTIONS = {
    allowIntersection: false,
    showArea: true,
    shapeOptions: { color: STROKE, weight: 2.5, fillColor: STROKE, fillOpacity: 0.18 }
  };

  // Editing an existing shape's vertices still uses leaflet-draw's own icon —
  // it's the one tool that genuinely has no other affordance. Drawing itself
  // no longer goes through this toolbar (see fb-drawbar below): the rectangle
  // tool is dropped (it was undocumented and redundant with polygon), and
  // "delete" is dropped since the "Clear" button in the results panel already
  // removes the one shape a farmer can have on the map at a time.
  const drawControl = new L.Control.Draw({
    position: 'topleft',
    draw: { polygon: false, rectangle: false, polyline: false, circle: false, circlemarker: false, marker: false },
    edit: { featureGroup: drawnItems, remove: false }
  });
  map.addControl(drawControl);

  // Map is up and interactive — start pulling Turf down now, in the
  // background, so the seconds the user spends placing vertices hide the
  // download. A rejection here is not an error yet: computeAndShow retries
  // and reports it only if a measurement is actually needed.
  loadTurf().catch(() => {});

  /* ── Primary "Draw plot boundary" control ──────────────────────────
     A single labelled button that starts the same polygon handler
     leaflet-draw's toolbar would have, plus a full-size Undo / Finish /
     Cancel row while drawing — see the .fb-drawbar rule in style.css for
     why this exists instead of the stock icon toolbar. */
  const polygonDrawer = new L.Draw.Polygon(map, POLYGON_OPTIONS);

  const DrawBar = L.Control.extend({
    options: { position: 'topleft' },
    onAdd() {
      const bar = L.DomUtil.create('div', 'fb-drawbar');

      this.startBtn = L.DomUtil.create('button', 'btn btn-primary fb-drawbar__start', bar);
      this.startBtn.type = 'button';
      this.startBtn.innerHTML =
        '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" ' +
        'stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
        '<path d="M4 19 10 6 16 15 20 9 20 19Z"/></svg> Draw plot boundary';

      this.activeRow = L.DomUtil.create('div', 'fb-drawbar__active', bar);
      this.activeRow.hidden = true;

      this.undoBtn = L.DomUtil.create('button', 'btn btn-ghost fb-drawbar__undo', this.activeRow);
      this.undoBtn.type = 'button';
      this.undoBtn.textContent = 'Delete last point';

      this.finishBtn = L.DomUtil.create('button', 'btn btn-primary fb-drawbar__finish', this.activeRow);
      this.finishBtn.type = 'button';
      this.finishBtn.textContent = 'Finish';
      this.finishBtn.disabled = true;

      this.cancelBtn = L.DomUtil.create('button', 'fb-drawbar__cancel', this.activeRow);
      this.cancelBtn.type = 'button';
      this.cancelBtn.textContent = 'Cancel';

      L.DomEvent.disableClickPropagation(bar);
      L.DomEvent.disableScrollPropagation(bar);

      L.DomEvent.on(this.startBtn, 'click', () => {
        if (currentLayer) { drawnItems.removeLayer(currentLayer); currentLayer = null; }
        polygonDrawer.enable();
      });
      L.DomEvent.on(this.undoBtn, 'click', () => polygonDrawer.deleteLastVertex());
      L.DomEvent.on(this.finishBtn, 'click', () => {
        // leaflet-draw has no public "finish now" method; _finishShape is the
        // long-standing, widely-used way to close the shape programmatically
        // (the alternative is tapping the first vertex again, which stays
        // available too). Guarded so a future leaflet-draw upgrade that drops
        // it fails safe — the button just does nothing instead of throwing.
        if (this.finishBtn.disabled) return;
        if (typeof polygonDrawer._finishShape === 'function') polygonDrawer._finishShape();
      });
      L.DomEvent.on(this.cancelBtn, 'click', () => polygonDrawer.disable());

      return bar;
    }
  });
  const drawBar = new DrawBar();
  map.addControl(drawBar);

  map.on(L.Draw.Event.DRAWSTART, (e) => {
    if (e.layerType !== 'polygon') return;
    drawBar.startBtn.hidden = true;
    drawBar.activeRow.hidden = false;
    drawBar.finishBtn.disabled = true;
  });
  map.on(L.Draw.Event.DRAWVERTEX, (e) => {
    const count = e.layers.getLayers().length;
    drawBar.finishBtn.disabled = count < 3;
  });
  map.on(L.Draw.Event.DRAWSTOP, (e) => {
    if (e.layerType && e.layerType !== 'polygon') return;
    drawBar.startBtn.hidden = false;
    drawBar.activeRow.hidden = true;
  });

  /* ── State ─────────────────────────────────────────── */
  const summaryEl  = document.getElementById('farmSummary');
  const actionsEl  = document.getElementById('farmActions');
  const resultEl   = document.getElementById('farmResult');
  const peekEl     = document.getElementById('fbPeek');
  const sheetToggle = document.getElementById('fbSheetToggle');
  const quickSaveBtn = document.getElementById('fbQuickSave');
  const statusEl   = document.getElementById('farmStatus');
  let currentLayer = null;
  let currentData  = null;

  /* ── Status line (replaces alert() — never blocks the map) ─── */
  let statusTimer = null;
  function setStatus(msg, kind) {
    clearTimeout(statusTimer);
    if (!msg) { statusEl.hidden = true; statusEl.textContent = ''; return; }
    statusEl.hidden = false;
    statusEl.textContent = msg;
    statusEl.classList.toggle('farmmap__status--error', kind === 'error');
    if (kind !== 'busy') statusTimer = setTimeout(() => { statusEl.hidden = true; }, 6000);
  }

  /* ── Mobile result sheet ───────────────────────────── */
  // On desktop the sheet styles are inert, so these calls are harmless there.
  function setSheetOpen(open) {
    resultEl.classList.toggle('is-open', open);
    // Mirrored onto <body> so the global tools FAB (added outside this
    // page's own DOM by toolbar.js) can hide itself while the sheet
    // covers the screen — see body.page-farm-boundary.fb-sheet-open in
    // style.css.
    document.body.classList.toggle('fb-sheet-open', open);
    sheetToggle.setAttribute('aria-expanded', open ? 'true' : 'false');
  }

  function setPeek(text, canSave) {
    peekEl.textContent = text;
    quickSaveBtn.hidden = !canSave;
  }

  /** Re-run the catalog over freshly injected text; no-op in English. */
  function retranslate() {
    if (window.AgriSimI18n && window.AgriSimI18n.getLanguage() !== 'en') {
      window.AgriSimI18n.retranslate();
    }
  }

  sheetToggle.addEventListener('click', () => {
    setSheetOpen(!resultEl.classList.contains('is-open'));
  });

  /* ── Event handlers ────────────────────────────────── */
  map.on(L.Draw.Event.CREATED, (e) => onShapeCreated(e.layer));
  map.on(L.Draw.Event.EDITED, (e) => {
    e.layers.eachLayer(l => { if (l === currentLayer) computeAndShow(l); });
  });
  map.on(L.Draw.Event.DELETED, () => {
    currentLayer = null;
    currentData  = null;
    renderEmpty();
  });

  function onShapeCreated(layer) {
    if (currentLayer) drawnItems.removeLayer(currentLayer);
    currentLayer = layer;
    drawnItems.addLayer(layer);
    computeAndShow(layer);
  }

  /* ── Empty state ───────────────────────────────────── */
  function renderEmpty() {
    summaryEl.innerHTML = '<div class="farmmap__empty">No farm drawn yet.</div>';
    actionsEl.style.display = 'none';
    setPeek('Draw your plot to see its area', false);
    setSheetOpen(false);
    retranslate();
  }

  /* ── Summary card ──────────────────────────────────── */
  function renderSummary(d, soilState, geoState) {
    /* Soil section */
    const soilHtml = soilState === 'loading'
      ? '<div class="farmmap__muted">Fetching soil data…</div>'
      : soilState === 'error'
      ? '<div class="farmmap__muted">Soil lookup unavailable right now. Coordinates saved.</div>'
      : d.soil
        ? `
          <div class="farmmap__grid">
            <div><span>pH</span><b>${d.soil.phh2o != null ? (d.soil.phh2o).toFixed(1) : '—'}</b></div>
            <div><span>Nitrogen</span><b>${d.soil.nitrogen != null ? d.soil.nitrogen.toFixed(1) : '—'} <small>g/kg</small></b></div>
            <div><span>Clay</span><b>${d.soil.clay != null ? d.soil.clay.toFixed(1) : '—'} <small>%</small></b></div>
            <div><span>Sand</span><b>${d.soil.sand != null ? d.soil.sand.toFixed(1) : '—'} <small>%</small></b></div>
            <div><span>Organic C</span><b>${d.soil.soc != null ? d.soil.soc.toFixed(0) : '—'} <small>g/kg</small></b></div>
            <div><span>CEC</span><b>${d.soil.cec != null ? d.soil.cec.toFixed(0) : '—'}</b></div>
          </div>`
        : '';

    /* Location / region geocoding section */
    const geoHtml = geoState === 'geocoding'
      ? '<div class="farmmap__muted farmmap__muted--anim">🌐 Detecting location…</div>'
      : buildLocationHtml(d);

    /* Vegetation index planning estimate — deterministic from coordinates,
       NOT a satellite reading. Mirrors utils/calculations.py's
       calculate_ndvi_and_field_health(), which documents the same caveat. */
    const seed = Math.abs(Math.round((d.lat * 1000 + d.lon * 100))) % 1000;
    const estNdvi = (0.52 + (seed % 35) / 100.0).toFixed(2);
    const ndviStatus = estNdvi >= 0.70 ? "Vibrant Healthy Canopy" : (estNdvi >= 0.50 ? "Normal Growth" : "Moisture Deficit");
    const ndviBadgeColor = estNdvi >= 0.70 ? "#2e7d32" : (estNdvi >= 0.50 ? "#f57c00" : "#d32f2f");

    summaryEl.innerHTML = `
      <div class="farmmap__stat">
        <span>Area</span>
        <b>${d.acres.toFixed(2)} <small>acres</small></b>
        <em>${d.hectares.toFixed(2)} ha · ${(d.sqm).toLocaleString()} m²</em>
      </div>
      <div class="farmmap__stat">
        <span>Perimeter</span>
        <b>${(d.perimeterM).toFixed(0)} <small>m</small></b>
      </div>
      <div class="farmmap__stat">
        <span>Centroid</span>
        <b>${d.lat.toFixed(5)}°N, ${d.lon.toFixed(5)}°E</b>
      </div>
      <div class="farmmap__stat">
        <span>Vegetation index (estimate)</span>
        <b>${estNdvi} <small>index</small></b>
        <em style="color:${ndviBadgeColor};font-weight:600;">${ndviStatus} · not satellite imagery</em>
      </div>
      ${geoHtml}
      <h4 class="farmmap__h">Soil at centroid <small>${d.soil && d.soil.estimated ? '(placeholder estimate — not measured)' : '(SoilGrids v2, 0–5 cm)'}</small></h4>
      ${soilHtml}
    `;
    actionsEl.style.display = '';

    // Keep the sheet's peek row current — on a phone this is the only part of
    // the result the user sees until they choose to expand it.
    const where = [d.village, d.district, d.state].filter(Boolean)[0];
    setPeek(`${d.acres.toFixed(2)} acres${where ? ' · ' + where : ''}`, true);
    // Auto-expand on the first render for a shape, then leave it to the user.
    if (geoState === 'geocoding') setSheetOpen(true);
    retranslate();
  }


  /**
   * Build the location chip row for the summary card.
   * Shows state · district · village (where available) and matched region.
   */
  function buildLocationHtml(d) {
    if (!d.region_id) return '';

    const regionRec = FarmState.getRegionRecord(d.region_id);
    const regionDisplay = regionRec ? regionRec.displayName : d.region_id;

    // Nominatim strings are third-party input — escape before injecting.
    const chips = [d.state, d.district, d.village]
      .filter(Boolean)
      .map(t => `<span class="fb-chip">${escapeHtml(t)}</span>`)
      .join('');

    return `
      <div class="farmmap__stat farmmap__stat--location">
        <span>Location</span>
        <div class="fb-chips">${chips || '<span class="farmmap__muted">India</span>'}</div>
        <em class="fb-region">Matched region: <strong>${escapeHtml(regionDisplay)}</strong></em>
      </div>`;
  }

  /* ── Core compute ──────────────────────────────────── */
  async function computeAndShow(layer) {
    const gj      = layer.toGeoJSON();

    // Normally already resolved from the warm-up kicked off at map init.
    let turf;
    try {
      turf = await loadTurf();
    } catch (_) {
      summaryEl.innerHTML =
        '<div class="farmmap__empty">Could not load the measurement library. ' +
        'Check your connection and draw the plot again.</div>';
      actionsEl.style.display = 'none';
      setPeek('Measurement unavailable — check your connection', false);
      setSheetOpen(true);
      retranslate();
      return;
    }

    const sqm     = turf.area(gj);                          // m²
    const hectares = sqm / 10000;
    const acres   = sqm / 4046.8564224;
    const centroid = turf.centroid(gj).geometry.coordinates; // [lon, lat]
    const lon = centroid[0];
    const lat  = centroid[1];

    let perimeterM = 0;
    try {
      perimeterM = turf.length(turf.polygonToLine(gj), { units: 'meters' });
    } catch (_) {}

    // Nearest backend region (always succeeds — pure math)
    const region_id = FarmState.getNearestRegionId(centroid);

    // Initialise currentData with what we know synchronously
    currentData = {
      geojson: gj,
      sqm, hectares, acres, centroid, perimeterM,
      lat, lon,
      region_id,
      state: '', district: '', village: '',
      nearestState: null,
      soil: null,
      savedAt: new Date().toISOString(),
    };

    // Show immediately with placeholder for geocoding + soil
    renderSummary(currentData, 'loading', 'geocoding');

    // Run geocoding + soil fetch in parallel
    const [geoResult, soilResult] = await Promise.allSettled([
      FarmState.reverseGeocode(lat, lon),
      fetchSoil(lat, lon),
    ]);

    // Apply geocoding result
    if (geoResult.status === 'fulfilled') {
      const geo = geoResult.value;
      currentData.state    = geo.state    || '';
      currentData.district = geo.district || '';
      currentData.village  = geo.village  || '';
      currentData.nearestState = geo.state || null;
      if (geo.state) {
        currentData.region_id = FarmState.getNearestRegionId(centroid, geo.state);
      }
    }

    // Apply soil result
    const soilState = soilResult.status === 'fulfilled' ? 'done' : 'error';
    if (soilResult.status === 'fulfilled') {
      currentData.soil = soilResult.value;
    } else {
      console.warn('[farm-boundary] soil fetch failed:', soilResult.reason);
    }

    renderSummary(currentData, soilState, 'done');
  }

  /* ── SoilGrids fetch ───────────────────────────────── */
  // TEMPORARY (demo stopgap): the real ISRIC endpoint below measured ~34s
  // response time in testing -- an 8s timeout aborted it before it could
  // succeed, and there's no timeout long enough to be both reliable and not
  // look broken in a live demo. Faking a deterministic, lat/lon-seeded
  // estimate instead, same approach renderSummary() already uses for the
  // vegetation-index number. Restore the real fetch (kept below, commented
  // out) once ISRIC's latency has an actual fix -- e.g. a server-side
  // proxy that caches by region so repeat lookups don't pay the same wait.
  async function fetchSoil(lat, lon) {
    const seed = Math.abs(Math.round(lat * 1000 + lon * 137));
    const rand = (min, max, salt) => {
      const x = Math.sin(seed + salt) * 10000;
      return min + (x - Math.floor(x)) * (max - min);
    };
    // `estimated` travels with the saved plot: the dashboard shows these as a
    // placeholder and keeps using the region's surveyed soil for every
    // calculation, rather than letting invented numbers drive fertilizer
    // doses and yield simulations.
    return {
      phh2o: rand(5.8, 7.8, 1),
      nitrogen: rand(0.8, 2.6, 2),
      clay: rand(15, 42, 3),
      sand: rand(22, 58, 4),
      soc: rand(6, 22, 5),
      cec: rand(11, 27, 6),
      estimated: true,
    };

    /* Real implementation -- restore once ISRIC's latency is actually fixed:
    const props = ['phh2o', 'nitrogen', 'clay', 'sand', 'soc', 'cec'];
    const qs    = props.map(p => `property=${p}`).join('&');
    const url   = `https://rest.isric.org/soilgrids/v2.0/properties/query?lon=${lon}&lat=${lat}&${qs}&depth=0-5cm&value=mean`;
    const res = await fetch(url, {
      signal: AbortSignal.timeout ? AbortSignal.timeout(45000) : undefined,
    });
    if (!res.ok) throw new Error('http ' + res.status);
    const data  = await res.json();
    const out   = {};
    const layers = (data && data.properties && data.properties.layers) || [];
    layers.forEach(layer => {
      const name    = layer.name;
      const dfactor = (layer.unit_measure && layer.unit_measure.d_factor) || 1;
      const d       = (layer.depths || [])[0];
      const mean    = d && d.values && d.values.mean;
      if (mean != null) out[name] = mean / dfactor;
    });
    return out;
    */
  }

  /* ── Place search (Nominatim) ──────────────────────── */
  const searchInput = document.getElementById('farmSearch');
  const searchBtn   = document.getElementById('farmSearchBtn');

  async function doSearch() {
    const q = (searchInput.value || '').trim();
    if (!q) return;
    setStatus('Searching…', 'busy');
    try {
      const url  = `https://nominatim.openstreetmap.org/search?format=json&countrycodes=in&limit=1&q=${encodeURIComponent(q)}`;
      const res  = await fetch(url, { headers: { 'Accept-Language': 'en' } });
      if (!res.ok) throw new Error('http ' + res.status);
      const data = await res.json();
      if (data && data[0]) {
        map.setView([+data[0].lat, +data[0].lon], 15);
        setStatus(`Showing ${data[0].display_name.split(',').slice(0, 2).join(',')}. Zoom in, then draw your plot.`);
      } else {
        setStatus('No place found by that name. Try the nearest town, or use your location.', 'error');
      }
    } catch (e) {
      setStatus('Search needs a connection. Pan the map to your area instead.', 'error');
    }
  }

  searchBtn.addEventListener('click', doSearch);
  searchInput.addEventListener('keydown', e => { if (e.key === 'Enter') doSearch(); });

  /* ── "Use my location" ─────────────────────────────── */
  // Standing in the field is the common case, so GPS beats searching by name.
  const locateBtn = document.getElementById('farmLocate');
  let accuracyLayer = null;

  locateBtn.addEventListener('click', () => {
    if (!navigator.geolocation) {
      setStatus('This device cannot share its location. Search for your village instead.', 'error');
      return;
    }
    locateBtn.disabled = true;
    setStatus('Finding your location…', 'busy');

    navigator.geolocation.getCurrentPosition(
      (pos) => {
        locateBtn.disabled = false;
        const { latitude, longitude, accuracy } = pos.coords;
        map.setView([latitude, longitude], 18);

        if (accuracyLayer) map.removeLayer(accuracyLayer);
        accuracyLayer = L.circle([latitude, longitude], {
          radius: Math.max(accuracy || 0, 8),
          color: SKY, weight: 1, fillColor: SKY, fillOpacity: 0.15,
        }).addTo(map);

        setStatus(`You are here (±${Math.round(accuracy || 0)} m). Now tap the polygon tool and trace your plot.`);
      },
      (err) => {
        locateBtn.disabled = false;
        const msg = err.code === err.PERMISSION_DENIED
          ? 'Location permission denied. Allow it in your browser, or search for your village.'
          : err.code === err.TIMEOUT
          ? 'Could not get a GPS fix in time. Try again outdoors, or search for your village.'
          : 'Location unavailable. Search for your village instead.';
        setStatus(msg, 'error');
      },
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 60000 }
    );
  });

  /* ── Clear ─────────────────────────────────────────── */
  document.getElementById('farmClear').addEventListener('click', () => {
    drawnItems.clearLayers();
    currentLayer = null;
    currentData  = null;
    renderEmpty();
  });

  /* ── Saving ────────────────────────────────────────── */

  /** region_id may have been skipped on very fast clicks — backfill it. */
  function ensureRegion() {
    if (!currentData.region_id && currentData.centroid) {
      currentData.region_id = FarmState.getNearestRegionId(currentData.centroid);
    }
  }

  // "Use in dashboard" replaces the active plot; "Save as new plot" appends.
  // With no plots saved yet the two are identical, so the second button stays
  // hidden until there is something to distinguish it from.
  function saveAndGo() {
    if (!currentData) return;
    try {
      ensureRegion();
      // M-7: FarmState.save() now returns null (rather than the saved plot)
      // when the localStorage write didn't actually persist — e.g. quota
      // exceeded — so this no longer redirects to a dashboard showing a
      // "saved" boundary that isn't really there.
      const saved = FarmState.save(currentData);
      if (!saved) {
        setStatus('Could not save on this device — storage is full. Free up space (or remove a saved plot) and try again.', 'error');
        return;
      }
      window.location.href = 'dashboard.html?fromMap=1';
    } catch (e) {
      setStatus('Could not save on this device: ' + e.message, 'error');
    }
  }

  // Two entry points, one action: the panel button on desktop, the sheet's
  // always-visible button on mobile.
  document.getElementById('farmUse').addEventListener('click', saveAndGo);
  quickSaveBtn.addEventListener('click', saveAndGo);

  const addPlotBtn = document.getElementById('farmAddPlot');
  addPlotBtn.addEventListener('click', () => {
    if (!currentData) return;
    try {
      ensureRegion();
      const suggested = currentData.village || currentData.district || 'New plot';
      const name = prompt('Name this plot:', suggested);
      if (name === null) return;          // cancelled
      const added = FarmState.add(currentData, name.trim() || suggested);
      if (!added) {
        setStatus('Could not save on this device — storage is full. Free up space (or remove a saved plot) and try again.', 'error');
        return;
      }
      window.location.href = 'dashboard.html?fromMap=1';
    } catch (e) {
      setStatus(e.message, 'error');
    }
  });

  /* ── Saved plots list ──────────────────────────────── */
  const plotsEl = document.getElementById('farmPlots');

  function renderPlots() {
    const plots = FarmState.list();
    addPlotBtn.style.display = plots.length ? '' : 'none';

    if (!plots.length) {
      plotsEl.style.display = 'none';
      plotsEl.innerHTML = '';
      return;
    }

    const activeId = FarmState.getActiveId();
    plotsEl.style.display = '';
    plotsEl.innerHTML = `
      <h4 class="farmmap__h">Your plots <small>(${plots.length})</small></h4>
      <div class="fb-plotlist">
        ${plots.map(p => `
          <div class="fb-plot${p.id === activeId ? ' fb-plot--active' : ''}" data-plot-id="${p.id}">
            <button type="button" class="fb-plot__pick" data-act="pick" title="Show on map">
              <b>${escapeHtml(p.name)}</b>
              <em>${p.acres ? Number(p.acres).toFixed(2) + ' ac' : '—'}${p.district ? ' · ' + escapeHtml(p.district) : ''}</em>
            </button>
            <button type="button" class="fb-plot__x" data-act="remove" title="Remove plot" aria-label="Remove ${escapeHtml(p.name)}">×</button>
          </div>`).join('')}
      </div>`;
  }

  function escapeHtml(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, c => (
      { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
    ));
  }

  // Only one saved plot is previewed at a time — the previous preview layer is
  // dropped first, otherwise browsing the list stacks polygons that can never
  // be removed (they don't belong to drawnItems, so the delete tool can't see them).
  let previewLayer = null;

  function showPlotOnMap(plot) {
    if (previewLayer) { map.removeLayer(previewLayer); previewLayer = null; }
    if (!plot || !plot.geojson) return;
    try {
      const layer = L.geoJSON(plot.geojson, {
        style: { color: STROKE, weight: 2, fillColor: STROKE, fillOpacity: 0.15, dashArray: '5 5' }
      });
      map.fitBounds(layer.getBounds(), { padding: [40, 40] });
      layer.addTo(map);
      previewLayer = layer;
    } catch (_) {}
  }

  plotsEl.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-act]');
    if (!btn) return;
    const id = btn.closest('[data-plot-id]').dataset.plotId;

    if (btn.dataset.act === 'pick') {
      const plot = FarmState.setActive(id);
      showPlotOnMap(plot);
    } else if (btn.dataset.act === 'remove') {
      const plot = FarmState.list().find(p => p.id === id);
      if (plot && confirm(`Remove "${plot.name}"? This cannot be undone.`)) {
        FarmState.remove(id);
      }
    }
  });

  document.addEventListener('mm:plot-changed', renderPlots);

  /* ── Boot ──────────────────────────────────────────── */
  // The steps are open on desktop, where the panel has room, and collapsed on
  // phones -- and on short-height laptop windows (the panel matches the map's
  // full height via grid stretch, so on common 768px-tall screens the open
  // steps used to push Search/Use my location past the fold) -- so they never
  // push the rest of the panel out of view.
  const howEl = document.getElementById('farmHow');
  if (howEl && window.matchMedia('(max-width: 860px), (max-height: 800px)').matches) howEl.open = false;

  renderEmpty();
  renderPlots();

  // If there is already a saved farm, show its region on the map
  showPlotOnMap(FarmState.load());
})();
