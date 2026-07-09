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
  if (typeof window.turf === 'undefined') {
    console.error('[farm-boundary] Turf.js not loaded.');
    return;
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

  /* ── Drawing controls ──────────────────────────────── */
  const drawnItems = new L.FeatureGroup().addTo(map);
  const STROKE = '#2f6b3a'; // MittiMantra brand green

  const drawControl = new L.Control.Draw({
    position: 'topleft',
    draw: {
      polygon: {
        allowIntersection: false,
        showArea: true,
        shapeOptions: { color: STROKE, weight: 2.5, fillColor: STROKE, fillOpacity: 0.18 }
      },
      rectangle: {
        shapeOptions: { color: STROKE, weight: 2.5, fillColor: STROKE, fillOpacity: 0.18 }
      },
      polyline: false, circle: false, circlemarker: false, marker: false
    },
    edit: { featureGroup: drawnItems, remove: true }
  });
  map.addControl(drawControl);

  /* ── State ─────────────────────────────────────────── */
  const summaryEl  = document.getElementById('farmSummary');
  const actionsEl  = document.getElementById('farmActions');
  let currentLayer = null;
  let currentData  = null;

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
  }

  /* ── Summary card ──────────────────────────────────── */
  function renderSummary(d, soilState, geoState) {
    /* Soil section */
    const soilHtml = soilState === 'loading'
      ? '<div class="farmmap__muted">Fetching soil data…</div>'
      : soilState === 'error'
      ? '<div class="farmmap__muted">Soil lookup unavailable offline. Coordinates saved.</div>'
      : d.soil
        ? `
          <div class="farmmap__grid">
            <div><span>pH</span><b>${d.soil.phh2o != null ? (d.soil.phh2o).toFixed(1) : '—'}</b></div>
            <div><span>Nitrogen</span><b>${d.soil.nitrogen != null ? d.soil.nitrogen.toFixed(0) : '—'} <small>cg/kg</small></b></div>
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
      ${geoHtml}
      <h4 class="farmmap__h">Soil at centroid <small>(SoilGrids v2, 0–5 cm)</small></h4>
      ${soilHtml}
    `;
    actionsEl.style.display = '';
  }

  /**
   * Build the location chip row for the summary card.
   * Shows state · district · village (where available) and matched region.
   */
  function buildLocationHtml(d) {
    if (!d.region_id) return '';

    const regionRec = FarmState.getRegionRecord(d.region_id);
    const regionDisplay = regionRec ? regionRec.displayName : d.region_id;

    const chips = [d.state, d.district, d.village]
      .filter(Boolean)
      .map(t => `<span class="fb-chip">${t}</span>`)
      .join('');

    return `
      <div class="farmmap__stat farmmap__stat--location">
        <span>Location</span>
        <div class="fb-chips">${chips || '<span class="farmmap__muted">India</span>'}</div>
        <em class="fb-region">Matched region: <strong>${regionDisplay}</strong></em>
      </div>`;
  }

  /* ── Core compute ──────────────────────────────────── */
  async function computeAndShow(layer) {
    const gj      = layer.toGeoJSON();
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
  async function fetchSoil(lat, lon) {
    const props = ['phh2o', 'nitrogen', 'clay', 'sand', 'soc', 'cec'];
    const qs    = props.map(p => `property=${p}`).join('&');
    const url   = `https://rest.isric.org/soilgrids/v2.0/properties/query?lon=${lon}&lat=${lat}&${qs}&depth=0-5cm&value=mean`;
    const res   = await fetch(url);
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
  }

  /* ── Place search (Nominatim) ──────────────────────── */
  const searchInput = document.getElementById('farmSearch');
  const searchBtn   = document.getElementById('farmSearchBtn');

  async function doSearch() {
    const q = (searchInput.value || '').trim();
    if (!q) return;
    try {
      const url  = `https://nominatim.openstreetmap.org/search?format=json&countrycodes=in&limit=1&q=${encodeURIComponent(q)}`;
      const res  = await fetch(url, { headers: { 'Accept-Language': 'en' } });
      const data = await res.json();
      if (data && data[0]) {
        map.setView([+data[0].lat, +data[0].lon], 15);
      } else {
        alert('Place not found.');
      }
    } catch (e) {
      alert('Search failed: ' + e.message);
    }
  }

  searchBtn.addEventListener('click', doSearch);
  searchInput.addEventListener('keydown', e => { if (e.key === 'Enter') doSearch(); });

  /* ── Clear ─────────────────────────────────────────── */
  document.getElementById('farmClear').addEventListener('click', () => {
    drawnItems.clearLayers();
    currentLayer = null;
    currentData  = null;
    renderEmpty();
  });

  /* ── "Use in dashboard" ────────────────────────────── */
  document.getElementById('farmUse').addEventListener('click', () => {
    if (!currentData) return;
    try {
      // Ensure region_id is set (may have been skipped on very fast clicks)
      if (!currentData.region_id && currentData.centroid) {
        currentData.region_id = FarmState.getNearestRegionId(currentData.centroid);
      }
      FarmState.save(currentData);
      window.location.href = 'dashboard.html?fromMap=1';
    } catch (e) {
      alert('Could not save farm locally: ' + e.message);
    }
  });

  /* ── Boot ──────────────────────────────────────────── */
  renderEmpty();

  // If there is already a saved farm, show its region on the map
  const existing = FarmState.load();
  if (existing && existing.geojson) {
    try {
      const layer = L.geoJSON(existing.geojson, {
        style: { color: STROKE, weight: 2, fillColor: STROKE, fillOpacity: 0.15, dashArray: '5 5' }
      });
      map.fitBounds(layer.getBounds(), { padding: [40, 40] });
      layer.addTo(map);
    } catch (_) {}
  }
})();
