/* =========================================================
   AgriSim — 3D landing scene
   Three.js Earth globe. Every Indian state is color-coded from
   a real GeoJSON boundary. Users can:
     • Switch view mode: Default / Rainfall / Soil-N / Profit /
       per-crop suitability heatmap.
     • Click a state -> camera zooms to it, info panel opens
       with top 3 recommended crops + indicative mandi prices.
   Drag to rotate, scroll to zoom.
   ========================================================= */

(() => {
  const host  = document.getElementById('scene3dCanvas');
  const label = document.getElementById('scene3dLabel');
  if (!host) return;

  // --- WebGL capability check. Older phones and corporate VDIs routinely
  // --- lack WebGL; draw a lightweight static India map so the section
  // --- still looks intentional instead of an empty box.
  function hasWebGL() {
    try {
      const c = document.createElement('canvas');
      return !!(window.WebGLRenderingContext &&
        (c.getContext('webgl') || c.getContext('experimental-webgl')));
    } catch { return false; }
  }
  if (typeof THREE === 'undefined' || !hasWebGL()) {
    console.warn('[india-globe] WebGL unavailable — rendering SVG fallback.');
    renderSvgFallback(host);
    return;
  }

  function renderSvgFallback(container) {
    container.innerHTML = `
      <div class="globe-fallback">
        <svg viewBox="0 0 400 440" xmlns="http://www.w3.org/2000/svg" aria-label="Map of India">
          <defs>
            <linearGradient id="gf" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stop-color="#c88a3a" stop-opacity="0.85"/>
              <stop offset="100%" stop-color="#2f6b3a" stop-opacity="0.9"/>
            </linearGradient>
          </defs>
          <!-- Highly stylised India silhouette -->
          <path d="M195 30 L240 50 L260 90 L290 120 L320 165 L335 215 L320 265 L290 315 L270 360 L240 395 L210 415 L180 405 L160 370 L140 330 L115 290 L95 245 L85 200 L95 155 L115 120 L140 85 L170 55 Z"
                fill="url(#gf)" stroke="#1f4d28" stroke-width="2" stroke-linejoin="round"/>
          <circle cx="200" cy="200" r="6" fill="#1f4d28"/>
          <text x="200" y="430" text-anchor="middle" font-family="Inter, sans-serif" font-size="14" fill="#4a4339" font-weight="600">
            India · 28 states · 8 UTs
          </text>
        </svg>
        <p class="globe-fallback__note">
          Interactive 3D map needs WebGL. Open this page on a modern browser
          (Chrome / Firefox / Edge / Safari) to explore every state.
        </p>
      </div>`;
  }

  const DATA = window.AgriSimStateData || null;

  /* ---------- Scene / camera / renderer ---------- */
  const scene = new THREE.Scene();
  scene.fog = new THREE.Fog(0xfaf6ef, 14, 34);

  const camera = new THREE.PerspectiveCamera(42, 1, 0.1, 100);
  camera.position.set(0, 2.4, 9.5);
  camera.lookAt(0, 0, 0);

  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setClearColor(0x000000, 0);
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  host.appendChild(renderer.domElement);

  /* ---------- Lighting ---------- */
  scene.add(new THREE.AmbientLight(0xffffff, 0.65));
  const sun = new THREE.DirectionalLight(0xfff1d4, 1.2);
  sun.position.set(6, 10, 6);
  sun.castShadow = true;
  scene.add(sun);
  const fill = new THREE.DirectionalLight(0xc88a3a, 0.35);
  fill.position.set(-5, 3, -4);
  scene.add(fill);

  /* ---------- World group ---------- */
  const world = new THREE.Group();
  scene.add(world);

  const GLOBE_R = 2.6;

  function latLonToVec3(lat, lon, r) {
    const phi = (90 - lat) * Math.PI / 180;
    const theta = (lon + 180) * Math.PI / 180;
    return new THREE.Vector3(
      -r * Math.sin(phi) * Math.cos(theta),
       r * Math.cos(phi),
       r * Math.sin(phi) * Math.sin(theta)
    );
  }

  /* ---------- Ocean + land base ---------- */
  const ocean = new THREE.Mesh(
    new THREE.SphereGeometry(GLOBE_R, 64, 64),
    new THREE.MeshStandardMaterial({ color: 0x2b506b, roughness: 0.85, metalness: 0.05 })
  );
  ocean.receiveShadow = true;
  world.add(ocean);

  const loader = new THREE.TextureLoader();
  loader.setCrossOrigin('anonymous');

  const landMat = new THREE.MeshStandardMaterial({
    color: 0x6b8a3e, roughness: 0.9, metalness: 0.03,
    transparent: true, alphaTest: 0.15, depthWrite: false
  });
  world.add(new THREE.Mesh(new THREE.SphereGeometry(GLOBE_R + 0.003, 96, 96), landMat));

  const TEX_URLS = [
    'https://unpkg.com/three-globe/example/img/earth-topology.png',
    'https://cdn.jsdelivr.net/npm/three-globe/example/img/earth-topology.png'
  ];
  (function tryLoad(i) {
    if (i >= TEX_URLS.length) return;
    loader.load(TEX_URLS[i],
      tex => { tex.colorSpace = THREE.SRGBColorSpace || tex.colorSpace;
               landMat.alphaMap = tex; landMat.needsUpdate = true; },
      undefined, () => tryLoad(i + 1));
  })(0);

  const bumpMat = new THREE.MeshBasicMaterial({
    color: 0xffffff, transparent: true, opacity: 0.22,
    depthWrite: false, blending: THREE.MultiplyBlending
  });
  world.add(new THREE.Mesh(new THREE.SphereGeometry(GLOBE_R + 0.004, 96, 96), bumpMat));
  const BUMP_URLS = [
    'https://unpkg.com/three-globe/example/img/earth-day.jpg',
    'https://cdn.jsdelivr.net/npm/three-globe/example/img/earth-day.jpg'
  ];
  (function tryLoad(i) {
    if (i >= BUMP_URLS.length) return;
    loader.load(BUMP_URLS[i],
      tex => { bumpMat.map = tex; bumpMat.needsUpdate = true; },
      undefined, () => tryLoad(i + 1));
  })(0);

  // Atmosphere
  world.add(new THREE.Mesh(
    new THREE.SphereGeometry(GLOBE_R * 1.06, 64, 64),
    new THREE.MeshBasicMaterial({ color: 0xc88a3a, transparent: true, opacity: 0.08,
      side: THREE.BackSide, depthWrite: false })
  ));

  /* ---------- India state polygons ---------- */
  const indiaStatesGroup = new THREE.Group();
  world.add(indiaStatesGroup);
  const stateMeshes = []; // for raycasting + recolor

  /* ---------- Mandi arbitrage arcs (added on top of the same globe) ---------- */
  const arbitrageGroup = new THREE.Group();
  world.add(arbitrageGroup);
  let arbitrageMeshes = []; // arcs + markers, for raycasting

  // Palette used for "Default" view
  const DEFAULT_PALETTE = [
    0xc88a3a, 0x8fb04a, 0xd45c4a, 0x6fa8c9, 0xe5b84b, 0x7a4ea8,
    0x4aa07b, 0xd07cb0, 0x9a6b3a, 0x3a7d7a, 0xb85c5c, 0x6b8e23,
    0xe07a2e, 0x5b7cb3, 0xa8c05a, 0xcc6699, 0x4a8f4a, 0xcf9f4f,
    0x7faacf, 0xa26c3f, 0xb84a8a, 0x5fa38a, 0xd9a84a, 0x8f5ab1,
    0xc77a4a, 0x6ba84a, 0xd05a5a, 0x4a9fc7, 0xa0884a, 0x7fb8a0,
    0xb89a4a, 0x8ab34a, 0xc74a6b, 0x4a7db8, 0xa84a8a, 0x4ab89a,
    0xb88a4a, 0x7a4a8a
  ];

  const NAME_KEYS = ['st_nm', 'ST_NM', 'NAME_1', 'NAME', 'name', 'state', 'STATE'];
  function stateNameOf(feature) {
    const p = feature.properties || {};
    for (const k of NAME_KEYS) if (p[k]) return p[k];
    return 'State';
  }

  // Compute centroid from polygon rings (for camera focus)
  function polygonCentroid(coordList) {
    let sx = 0, sy = 0, n = 0;
    coordList.forEach(poly => {
      poly[0].forEach(([lon, lat]) => { sx += lon; sy += lat; n++; });
    });
    return n ? [sx / n, sy / n] : [78, 22];
  }

  function buildStateMesh(feature, index) {
    const geom = feature.geometry;
    if (!geom) return;
    const polygons = geom.type === 'Polygon' ? [geom.coordinates]
                   : geom.type === 'MultiPolygon' ? geom.coordinates : [];
    const rawName = stateNameOf(feature);
    const name = (DATA && DATA.normalise) ? DATA.normalise(rawName) : rawName;
    const defaultColor = new THREE.Color(DEFAULT_PALETTE[index % DEFAULT_PALETTE.length]);
    const centroid = polygonCentroid(polygons); // [lon, lat]
    const stateMeshList = [];

    polygons.forEach(poly => {
      const outer = poly[0];
      if (!outer || outer.length < 3) return;
      const contour = outer.map(([lon, lat]) => new THREE.Vector2(lon, lat));
      const holes = poly.slice(1).map(h => h.map(([lon, lat]) => new THREE.Vector2(lon, lat)));
      if (contour.length > 1 &&
          contour[0].x === contour[contour.length - 1].x &&
          contour[0].y === contour[contour.length - 1].y) contour.pop();
      holes.forEach(h => {
        if (h.length > 1 &&
            h[0].x === h[h.length - 1].x &&
            h[0].y === h[h.length - 1].y) h.pop();
      });

      let tris;
      try { tris = THREE.ShapeUtils.triangulateShape(contour, holes); }
      catch (e) { return; }
      if (!tris || !tris.length) return;

      const allVerts = contour.concat(...holes);
      const positions = [];
      tris.forEach(tri => tri.forEach(idx => {
        const v = allVerts[idx];
        if (!v) return;
        const p = latLonToVec3(v.y, v.x, GLOBE_R + 0.012);
        positions.push(p.x, p.y, p.z);
      }));
      if (!positions.length) return;

      const bg = new THREE.BufferGeometry();
      bg.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
      bg.computeVertexNormals();

      const mat = new THREE.MeshStandardMaterial({
        color: defaultColor.clone(), roughness: 0.75, metalness: 0.05,
        side: THREE.DoubleSide,
        emissive: defaultColor.clone(), emissiveIntensity: 0.12
      });
      const mesh = new THREE.Mesh(bg, mat);
      mesh.userData = { state: name, defaultColor: defaultColor.clone(), centroid };
      mesh.renderOrder = 2;
      indiaStatesGroup.add(mesh);
      stateMeshes.push(mesh);
      stateMeshList.push(mesh);

      const outlinePts = outer.map(([lon, lat]) => latLonToVec3(lat, lon, GLOBE_R + 0.015));
      const line = new THREE.Line(
        new THREE.BufferGeometry().setFromPoints(outlinePts),
        new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.55 })
      );
      line.renderOrder = 3;
      line.userData = { state: name, isOutline: true };
      indiaStatesGroup.add(line);
    });
  }

  // Boundaries ship with the app (frontend/Data/india-states.geo.json, ~120 KB:
  // the upstream 23 MB survey file simplified to globe resolution). Same-origin
  // means it is fast, offline-capable via the service worker, and immune to the
  // upstream repos disappearing -- which they since have. The remote copy stays
  // only as a last resort if the bundled asset is ever missing.
  const GEOJSON_URLS = [
    'Data/india-states.geo.json',
    'https://raw.githubusercontent.com/geohacker/india/master/state/india_telengana.geojson'
  ];
  (async function loadStates() {
    for (const url of GEOJSON_URLS) {
      try {
        const res = await fetch(url, { mode: 'cors' });
        if (!res.ok) throw new Error('http ' + res.status);
        const gj = await res.json();
        const features = gj.features || (gj.type === 'Feature' ? [gj] : []);
        if (!features.length) throw new Error('no features');
        features.forEach((f, i) => buildStateMesh(f, i));
        populateCropDropdown();
        applyMode(currentMode, currentCrop);
        return;
      } catch (e) {
        console.warn('[scene3d] geojson failed:', url, e.message);
      }
    }
    // Every source failed: the globe would otherwise sit there as a bare sphere
    // with two dropdowns that quietly do nothing. Say so instead.
    onStatesUnavailable();
  })();

  function onStatesUnavailable() {
    const hud = document.querySelector('.scene3d__hud');
    if (hud) hud.style.display = 'none';
    const note = document.createElement('div');
    note.className = 'scene3d__notice';
    note.setAttribute('role', 'status');
    note.textContent = 'State boundaries could not be loaded, so the map is not interactive right now. Every state view is still available on the dashboard.';
    host.appendChild(note);
  }

  /* ---------- Mode / heatmap logic ---------- */
  let currentMode = 'default'; // default | rainfall | soilN | profit | crop | arbitrage
  let currentCrop = null;
  let currentArbitrageCropId = null;

  function lerpColor(a, b, t) {
    return new THREE.Color(a).lerp(new THREE.Color(b), t);
  }

  function heatColor(v) {
    // v in [0,1]. cool->warm gradient (earthy blue -> green -> gold -> clay)
    if (v < 0.33) return lerpColor(0x4a7db8, 0x6b8e23, v / 0.33);
    if (v < 0.66) return lerpColor(0x6b8e23, 0xc88a3a, (v - 0.33) / 0.33);
    return lerpColor(0xc88a3a, 0xa5562a, (v - 0.66) / 0.34);
  }

  function applyMode(mode, crop) {
    if (!DATA) return;
    const rng = DATA.ranges;
    stateMeshes.forEach(m => {
      const name = m.userData.state;
      const d = DATA.get(name);
      let col;
      if (mode === 'default' || !d) {
        col = m.userData.defaultColor;
      } else if (mode === 'rainfall') {
        const t = (d.rainfall - rng.rainfall[0]) / (rng.rainfall[1] - rng.rainfall[0] || 1);
        col = heatColor(t);
      } else if (mode === 'soilN') {
        const t = (d.soilN - rng.soilN[0]) / (rng.soilN[1] - rng.soilN[0] || 1);
        col = heatColor(t);
      } else if (mode === 'profit') {
        const t = (d.avgProfit - rng.avgProfit[0]) / (rng.avgProfit[1] - rng.avgProfit[0] || 1);
        col = heatColor(t);
      } else if (mode === 'crop' && crop) {
        const s = DATA.suitability(name, crop);
        if (s <= 0) col = new THREE.Color(0x444444);
        else col = heatColor(s);
      } else if (mode === 'arbitrage') {
        // Dim and desaturate the state fill so the arbitrage arcs read
        // clearly against the globe instead of competing with 38 hues.
        col = m.userData.defaultColor.clone().lerp(new THREE.Color(0x3a382f), 0.72);
      } else {
        col = m.userData.defaultColor;
      }
      m.material.color.copy(col);
      m.material.emissive.copy(col);
      m.material.emissiveIntensity = 0.12;
    });
  }

  function populateCropDropdown() {
    const sel = document.getElementById('scene3dCrop');
    if (!sel || !DATA) return;
    sel.innerHTML = '<option value="">Pick a crop…</option>' +
      DATA.crops.map(c => `<option value="${c}">${c}</option>`).join('');
  }

  /* ---------- Arbitrage mode: real cross-mandi price gaps as arcs ----------
     Reuses /api/arbitrage/{crop_id} (already computed server-side from
     mandi_prices.csv, same-month comparisons only) and FarmState's real
     lat/lon per region_id — no new backend endpoint needed. */
  let arbitrageCropsCache = null;

  async function populateArbitrageCropDropdown() {
    const sel = document.getElementById('scene3dCrop');
    if (!sel) return;
    if (!arbitrageCropsCache) {
      try {
        const res = await fetch('/api/crops');
        const rows = await res.json();
        arbitrageCropsCache = rows
          .map(r => ({ id: r.crop_id, name: r.crop_name }))
          .sort((a, b) => a.name.localeCompare(b.name));
      } catch (e) {
        arbitrageCropsCache = [];
      }
    }
    if (currentMode !== 'arbitrage') return; // user switched away while this was loading
    sel.innerHTML = '<option value="">Pick a crop…</option>' +
      arbitrageCropsCache.map(c => `<option value="${c.id}">${c.name}</option>`).join('');
  }

  function clearArbitrage() {
    arbitrageGroup.children.forEach(obj => {
      obj.geometry?.dispose();
      obj.material?.dispose();
    });
    arbitrageGroup.clear();
    arbitrageMeshes = [];
  }

  function buildArbitrageArc(buy, sell, opportunity, colorHex) {
    const start = latLonToVec3(buy.lat, buy.lon, GLOBE_R + 0.02);
    const end = latLonToVec3(sell.lat, sell.lon, GLOBE_R + 0.02);
    const mid = start.clone().add(end).multiplyScalar(0.5);
    mid.normalize().multiplyScalar(GLOBE_R + 0.18 + start.distanceTo(end) * 0.18);
    const curve = new THREE.QuadraticBezierCurve3(start, mid, end);
    const geom = new THREE.BufferGeometry().setFromPoints(curve.getPoints(40));
    const mat = new THREE.LineBasicMaterial({ color: colorHex, transparent: true, opacity: 0.85 });
    const line = new THREE.Line(geom, mat);
    line.renderOrder = 4;
    line.userData = { isArbitrage: true, kind: 'arc', opportunity };
    arbitrageGroup.add(line);
    arbitrageMeshes.push(line);
  }

  function buildArbitrageMarker(region, colorHex) {
    const geom = new THREE.SphereGeometry(0.035, 12, 12);
    const mat = new THREE.MeshBasicMaterial({ color: colorHex });
    const mesh = new THREE.Mesh(geom, mat);
    mesh.position.copy(latLonToVec3(region.lat, region.lon, GLOBE_R + 0.02));
    mesh.renderOrder = 5;
    mesh.userData = { isArbitrage: true, kind: 'marker', label: region.displayName };
    arbitrageGroup.add(mesh);
    arbitrageMeshes.push(mesh);
  }

  async function renderArbitrage(cropId) {
    clearArbitrage();
    if (!cropId || !window.FarmState) { updateLegend(); return; }
    if (legendEl) legendEl.innerHTML = '<span class="scene3d-legend__txt">Loading arbitrage data…</span>';
    let data;
    try {
      const res = await fetch(`/api/arbitrage/${encodeURIComponent(cropId)}`);
      data = await res.json();
    } catch (e) {
      if (legendEl) legendEl.innerHTML = '<span class="scene3d-legend__txt">Could not load arbitrage data.</span>';
      return;
    }
    if (currentMode !== 'arbitrage' || currentArbitrageCropId !== cropId) return; // stale by the time it landed

    const opportunities = (data.opportunities || []).slice(0, 8); // top gaps only — keeps the globe legible
    if (!opportunities.length) {
      if (legendEl) legendEl.innerHTML = `<span class="scene3d-legend__txt">${data.message || 'Not enough same-month mandi data for this crop yet.'}</span>`;
      return;
    }
    const maxGap = Math.max(...opportunities.map(o => o.price_gap_per_kg));
    const seenRegions = new Set();
    opportunities.forEach(op => {
      const buy = window.FarmState.getRegionRecord(op.buy_region);
      const sell = window.FarmState.getRegionRecord(op.sell_region);
      if (!buy || !sell) return;
      const t = maxGap > 0 ? op.price_gap_per_kg / maxGap : 0.5;
      buildArbitrageArc(buy, sell, op, lerpColor(0xf4c542, 0xd4432a, t).getHex());
      if (!seenRegions.has(op.buy_region)) { buildArbitrageMarker(buy, 0x4aa07b); seenRegions.add(op.buy_region); }
      if (!seenRegions.has(op.sell_region)) { buildArbitrageMarker(sell, 0xd45c4a); seenRegions.add(op.sell_region); }
    });
    updateLegend();
  }

  /* ---------- HUD controls ---------- */
  const modeSelect  = document.getElementById('scene3dMode');
  const cropSelect  = document.getElementById('scene3dCrop');
  const cropWrap    = document.getElementById('scene3dCropWrap');
  const legendEl    = document.getElementById('scene3dLegend');
  const panelEl     = document.getElementById('scene3dPanel');
  const panelClose  = document.getElementById('scene3dPanelClose');

  function updateLegend() {
    if (!legendEl) return;
    const rng = DATA ? DATA.ranges : null;
    let html = '';
    if (currentMode === 'default') {
      html = '<span class="scene3d-legend__txt">Each state coloured uniquely. Click to inspect.</span>';
    } else if (currentMode === 'rainfall' && rng) {
      html = legendGradient('Rainfall (mm/yr)', rng.rainfall[0], rng.rainfall[1]);
    } else if (currentMode === 'soilN' && rng) {
      html = legendGradient('Soil Nitrogen (kg/ha)', rng.soilN[0], rng.soilN[1]);
    } else if (currentMode === 'profit' && rng) {
      html = legendGradient('Avg profit (₹/acre)', rng.avgProfit[0], rng.avgProfit[1]);
    } else if (currentMode === 'crop') {
      html = currentCrop
        ? legendGradient('Suitability · ' + currentCrop, 'low', 'high')
        : '<span class="scene3d-legend__txt">Pick a crop from the dropdown.</span>';
    } else if (currentMode === 'arbitrage') {
      html = currentArbitrageCropId
        ? '<span class="scene3d-legend__txt">Arcs = price gap (gold small → red large). Green dot = cheaper mandi, red dot = costlier. Click an arc for details.</span>'
        : '<span class="scene3d-legend__txt">Pick a crop to see real cross-mandi price gaps.</span>';
    }
    legendEl.innerHTML = html;
  }
  function legendGradient(title, lo, hi) {
    return `<div class="scene3d-legend__title">${title}</div>
      <div class="scene3d-legend__bar"></div>
      <div class="scene3d-legend__scale"><span>${lo}</span><span>${hi}</span></div>`;
  }

  if (modeSelect) {
    modeSelect.addEventListener('change', () => {
      currentMode = modeSelect.value;
      if (cropWrap) cropWrap.style.display = (currentMode === 'crop' || currentMode === 'arbitrage') ? '' : 'none';
      if (currentMode === 'arbitrage') {
        clearArbitrage();
        currentArbitrageCropId = null;
        if (cropSelect) cropSelect.value = '';
        populateArbitrageCropDropdown();
      } else {
        clearArbitrage();
        if (currentMode === 'crop') {
          populateCropDropdown();
          if (cropSelect) cropSelect.value = currentCrop || '';
        }
      }
      applyMode(currentMode, currentCrop);
      updateLegend();
    });
  }
  if (cropSelect) {
    cropSelect.addEventListener('change', () => {
      if (currentMode === 'arbitrage') {
        currentArbitrageCropId = cropSelect.value || null;
        renderArbitrage(currentArbitrageCropId);
        return;
      }
      currentCrop = cropSelect.value || null;
      applyMode(currentMode, currentCrop);
      updateLegend();
    });
  }
  if (panelClose) {
    panelClose.addEventListener('click', () => {
      if (panelEl) panelEl.classList.remove('open');
      clearSelection();
    });
  }

  /* ---------- Selection / zoom ---------- */
  let selected = null;
  let selectedOriginal = null; // saved color for restore
  function clearSelection() {
    if (selected && selectedOriginal) {
      selected.material.emissiveIntensity = 0.12;
      selected.material.color.copy(selectedOriginal.color);
      selected.material.emissive.copy(selectedOriginal.emissive);
    }
    selected = null;
  }
  function selectState(mesh) {
    clearSelection();
    selected = mesh;
    selectedOriginal = {
      color: mesh.material.color.clone(),
      emissive: mesh.material.emissive.clone()
    };
    mesh.material.emissive = new THREE.Color(0xffffff);
    mesh.material.emissiveIntensity = 0.45;

    const name = mesh.userData.state;
    const d = DATA ? DATA.get(name) : null;
    renderPanel(name, d);
    if (panelEl) panelEl.classList.add('open');

    // Zoom: rotate world so centroid faces camera, pull camera a bit closer
    const [lon, lat] = mesh.userData.centroid;
    targetRotY = -(lon * Math.PI / 180);
    targetRotX = (lat * Math.PI / 180) * 0.6;
    targetZoom = 7.2;
    autoRotate = false;
  }

  function renderPanel(name, d) {
    if (!panelEl) return;
    const body = panelEl.querySelector('.scene3d-panel__body');
    const titleEl = panelEl.querySelector('.scene3d-panel__title');
    if (titleEl) titleEl.textContent = name;
    if (!body) return;
    if (!d) {
      body.innerHTML = '<p class="scene3d-panel__muted">No detailed data for this region yet.</p>';
      return;
    }
    const crops = d.topCrops.map(c => `
      <div class="scene3d-crop">
        <div class="scene3d-crop__name">${c.crop}</div>
        <div class="scene3d-crop__bar"><span style="width:${Math.round(c.score*100)}%"></span></div>
        <div class="scene3d-crop__meta">
          <span>score <b>${Math.round(c.score*100)}</b></span>
          <span>mandi <b>₹${c.mandi.toLocaleString('en-IN')}</b></span>
        </div>
      </div>`).join('');
    body.innerHTML = `
      <div class="scene3d-stats">
        <div><span>Rainfall</span><b>${d.rainfall} mm</b></div>
        <div><span>Soil N</span><b>${d.soilN} kg/ha</b></div>
        <div><span>Avg profit</span><b>₹${d.avgProfit.toLocaleString('en-IN')}</b></div>
      </div>
      <h4 class="scene3d-panel__h">Top 3 recommended crops</h4>
      ${crops}
      <a class="scene3d-panel__cta" href="dashboard.html">Plan on dashboard →</a>`;
  }

  /* ---------- Initial orientation: India facing camera ---------- */
  const INDIA_LON = 78, INDIA_LAT = 21;
  let targetRotY = -(INDIA_LON * Math.PI / 180);
  let targetRotX = (INDIA_LAT * Math.PI / 180) * 0.6;
  let rotY = targetRotY, rotX = targetRotX;

  /* ---------- Particles ---------- */
  const particleCount = 80;
  const particleGeo = new THREE.BufferGeometry();
  const positions = new Float32Array(particleCount * 3);
  for (let i = 0; i < particleCount; i++) {
    const theta = Math.random() * Math.PI * 2;
    const phi = Math.acos(2 * Math.random() - 1);
    const r = 3.2 + Math.random() * 1.8;
    positions[i * 3]     = r * Math.sin(phi) * Math.cos(theta);
    positions[i * 3 + 1] = r * Math.cos(phi);
    positions[i * 3 + 2] = r * Math.sin(phi) * Math.sin(theta);
  }
  particleGeo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  const particles = new THREE.Points(particleGeo, new THREE.PointsMaterial({
    color: 0xc88a3a, size: 0.055, transparent: true, opacity: 0.65, depthWrite: false
  }));
  scene.add(particles);

  /* ---------- Shadow plane ---------- */
  const shadowPlane = new THREE.Mesh(
    new THREE.CircleGeometry(5, 48),
    new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.08 })
  );
  shadowPlane.rotation.x = -Math.PI / 2;
  shadowPlane.position.y = -3.2;
  scene.add(shadowPlane);

  /* ---------- Interactivity ---------- */
  let isDragging = false, didDrag = false, lastX = 0, lastY = 0;
  let autoRotate = true;
  let zoom = 9.5;
  let targetZoom = zoom;

  const canvas = renderer.domElement;
  canvas.style.cursor = 'grab';

  canvas.addEventListener('pointerdown', e => {
    isDragging = true; didDrag = false; autoRotate = false;
    lastX = e.clientX; lastY = e.clientY;
    canvas.style.cursor = 'grabbing';
    canvas.setPointerCapture(e.pointerId);
  });
  canvas.addEventListener('pointerup', e => {
    isDragging = false;
    canvas.style.cursor = 'grab';
    canvas.releasePointerCapture?.(e.pointerId);
    if (!didDrag) onClick(e);
  });
  canvas.addEventListener('pointermove', e => {
    if (isDragging) {
      const dx = e.clientX - lastX, dy = e.clientY - lastY;
      if (Math.abs(dx) + Math.abs(dy) > 4) didDrag = true;
      targetRotY += dx * 0.008;
      targetRotX += dy * 0.008;
      targetRotX = Math.max(-1.2, Math.min(1.2, targetRotX));
      lastX = e.clientX; lastY = e.clientY;
    }
    onHover(e);
  });
  canvas.addEventListener('pointerleave', () => {
    isDragging = false; hideLabel();
    canvas.style.cursor = 'grab';
  });
  canvas.addEventListener('wheel', e => {
    e.preventDefault();
    targetZoom = Math.max(5.0, Math.min(14, targetZoom + e.deltaY * 0.008));
  }, { passive: false });

  /* ---------- Raycaster ---------- */
  const raycaster = new THREE.Raycaster();
  raycaster.params.Line = { threshold: 0.05 }; // arcs are thin lines; give them a comfortable hit area
  const pointer = new THREE.Vector2();

  function hitState(e) {
    const rect = canvas.getBoundingClientRect();
    pointer.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
    pointer.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
    raycaster.setFromCamera(pointer, camera);
    if (currentMode === 'arbitrage' && arbitrageMeshes.length) {
      const arbHit = raycaster.intersectObjects(arbitrageMeshes, false)[0];
      if (arbHit) return arbHit;
    }
    return raycaster.intersectObjects(stateMeshes, false)[0];
  }

  function onHover(e) {
    const hit = hitState(e);
    if (hit) {
      const info = hit.object.userData;
      const rect = canvas.getBoundingClientRect();
      label.style.display = 'block';
      label.style.left = (e.clientX - rect.left) + 'px';
      label.style.top  = (e.clientY - rect.top) + 'px';
      if (info.isArbitrage) {
        label.innerHTML = info.kind === 'arc'
          ? `<strong>₹${info.opportunity.price_gap_per_kg}/kg gap</strong><small>${info.opportunity.buy_market} → ${info.opportunity.sell_market}</small>`
          : `<strong>${info.label}</strong><small>click an arc for the price gap</small>`;
        canvas.style.cursor = 'pointer';
        return;
      }
      const d = DATA ? DATA.get(info.state) : null;
      let hint = 'India · click to inspect';
      if (d) {
        if (currentMode === 'rainfall')  hint = `${d.rainfall} mm/yr`;
        else if (currentMode === 'soilN')   hint = `Soil N ${d.soilN} kg/ha`;
        else if (currentMode === 'profit')  hint = `₹${d.avgProfit.toLocaleString('en-IN')}/acre`;
        else if (currentMode === 'crop' && currentCrop) {
          const s = DATA.suitability(info.state, currentCrop);
          hint = s > 0 ? `${currentCrop}: ${Math.round(s*100)}/100` : `${currentCrop}: not suited`;
        }
      }
      label.innerHTML = `<strong>${info.state}</strong><small>${hint}</small>`;
      canvas.style.cursor = 'pointer';
    } else {
      hideLabel();
      if (!isDragging) canvas.style.cursor = 'grab';
    }
  }
  function onClick(e) {
    const hit = hitState(e);
    if (!hit) return;
    const info = hit.object.userData;
    if (info.isArbitrage) {
      if (info.kind === 'arc') selectArbitrageArc(info.opportunity);
      return;
    }
    selectState(hit.object);
  }
  function hideLabel() { label.style.display = 'none'; }

  function selectArbitrageArc(op) {
    if (!panelEl) return;
    const body = panelEl.querySelector('.scene3d-panel__body');
    const titleEl = panelEl.querySelector('.scene3d-panel__title');
    if (titleEl) titleEl.textContent = `${op.buy_market} → ${op.sell_market}`;
    if (body) body.innerHTML = `
      <div class="scene3d-stats">
        <div><span>Buy at</span><b>₹${op.buy_price}/kg</b></div>
        <div><span>Sell at</span><b>₹${op.sell_price}/kg</b></div>
        <div><span>Gap</span><b>₹${op.price_gap_per_kg}/kg (${op.gap_pct}%)</b></div>
      </div>
      <a class="scene3d-panel__cta" href="dashboard.html">Plan on dashboard →</a>`;
    panelEl.classList.add('open');
  }

  /* ---------- Resize ---------- */
  function resize() {
    const rect = host.getBoundingClientRect();
    const size = Math.min(rect.width, rect.height);
    renderer.setSize(size, size, false);
    renderer.domElement.style.width = rect.width + 'px';
    renderer.domElement.style.height = rect.height + 'px';
    camera.aspect = 1;
    camera.updateProjectionMatrix();
  }
  resize();
  new ResizeObserver(resize).observe(host);

  /* ---------- Animation — pauses when the tab is hidden or the
     canvas scrolls off-screen, saving battery / CPU. ---------- */
  const clock = new THREE.Clock();
  let rafId = 0;
  let onScreen = true;
  let docVisible = !document.hidden;

  function tick() {
    const dt = clock.getDelta();
    if (autoRotate) targetRotY += dt * 0.1;
    rotY += (targetRotY - rotY) * 0.08;
    rotX += (targetRotX - rotX) * 0.08;
    zoom += (targetZoom - zoom) * 0.08;
    world.rotation.y = rotY;
    world.rotation.x = rotX;
    camera.position.z = zoom;
    particles.rotation.y += dt * 0.04;
    renderer.render(scene, camera);
    rafId = requestAnimationFrame(tick);
  }

  function startLoop() {
    if (rafId) return;
    clock.getDelta(); // reset dt so re-entry doesn't jump
    rafId = requestAnimationFrame(tick);
  }
  function stopLoop() {
    if (rafId) cancelAnimationFrame(rafId);
    rafId = 0;
  }
  function syncLoop() {
    (onScreen && docVisible) ? startLoop() : stopLoop();
  }

  document.addEventListener('visibilitychange', () => {
    docVisible = !document.hidden;
    syncLoop();
  });

  // Pause rendering when the canvas isn't on screen.
  if ('IntersectionObserver' in window) {
    new IntersectionObserver(entries => {
      onScreen = entries[0].isIntersecting;
      syncLoop();
    }, { threshold: 0.01 }).observe(host);
  }

  startLoop();

  let autoTimer;
  function resumeAuto() {
    clearTimeout(autoTimer);
    autoTimer = setTimeout(() => { if (!selected) autoRotate = true; }, 6000);
  }
  canvas.addEventListener('pointerdown', resumeAuto);
  canvas.addEventListener('wheel', resumeAuto);

  updateLegend();
})();
