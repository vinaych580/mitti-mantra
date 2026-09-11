/* =========================================================
   MittiMantra — FarmState
   Single source of truth for the user's drawn farm.

   Responsibilities
   ─────────────────
   • Persist the selected farm in localStorage under STORAGE_KEY.
   • Provide getNearestRegionId(centroid) — pure-math offline match
     against all 30 backend region_ids using Euclidean distance on
     lat/lon. Always resolves; never needs network.
   • Provide reverseGeocode(lat, lon) — Nominatim lookup for human-
     readable state / district / village. Best-effort; silently falls
     back to null fields on failure.
   • Migrate legacy key 'agrisim_farm' automatically on first load.

   Multi-plot
   ───────────
   Most farmers work several scattered plots with different soil, so a single
   stored farm was the wrong shape. Plots live under PLOTS_KEY as
   { activeId, plots: [ {id, name, …farm} ] }; load()/save() continue to read
   and write the *active* plot, so every existing caller keeps working
   unchanged. A legacy single farm is migrated into plot #1 on first load.

   Public API (window.FarmState)
   ──────────────────────────────
     FarmState.load()                → farm | null     (active plot)
     FarmState.save(farm)            → farm            (updates active plot)
     FarmState.clear()               → void            (removes every plot)
     FarmState.isActive()            → boolean
     FarmState.list()                → [farm, …]
     FarmState.add(farm, name)       → farm            (added AND made active)
     FarmState.remove(id)            → boolean
     FarmState.rename(id, name)      → boolean
     FarmState.setActive(id)         → farm | null
     FarmState.getActiveId()         → string | null
     FarmState.count()               → number
     FarmState.getNearestRegionId(centroid[lon,lat]) → string
     FarmState.reverseGeocode(lat, lon)              → Promise<{state,district,village}>
     FarmState.REGION_CENTROIDS      → [{region_id, lat, lon, state, displayName}, …]
     FarmState.getActiveCrop()               → {crop_id, crop_name, committedAt} | null
     FarmState.setActiveCrop(cropId, cropName) → farm | null (active plot; null if no active plot)

   Every mutation dispatches `mm:plot-changed` on document with
   { detail: { plot, plots, activeId, reason } }.

   Farm object schema (stored in localStorage)
   ─────────────────────────────────────────────
   {
     region_id:   string,     // nearest backend region, e.g. "punjab_ludhiana"
     state:       string,     // e.g. "Punjab"
     district:    string,     // e.g. "Ludhiana"
     village:     string,     // e.g. "Sahnewal" (may be empty)
     lat:         number,     // centroid latitude
     lon:         number,     // centroid longitude
     centroid:    [lon, lat], // GeoJSON order — backward-compat
     acres:       number,
     hectares:    number,
     sqm:         number,
     perimeterM:  number,
     geojson:     object,     // full GeoJSON polygon
     soil:        object|null,// SoilGrids data at centroid
     nearestState:string|null,// deprecated alias kept for compat
     savedAt:     string,     // ISO timestamp
     crop_id:     string|undefined,  // crop the farmer has committed to planting on this plot
     crop_name:   string|undefined,  // display name for crop_id, captured at commit time
     committedAt: string|undefined,  // ISO timestamp of the last commit
   }
   ========================================================= */

;(function (global) {
  'use strict';

  /* ── Storage keys ────────────────────────────────────── */
  // STORAGE_KEY still mirrors the active plot so that code reading
  // localStorage directly (dashboard.js has a raw fallback read) keeps working.
  const STORAGE_KEY    = 'mittimantra_selectedFarm';
  const LEGACY_KEY     = 'agrisim_farm';
  const PLOTS_KEY      = 'mittimantra_plots_v1';
  const MAX_PLOTS      = 20;

  /* ── Region centroid table ────────────────────────────
     Approximate geographic centroids for every region_id
     in the backend's soil.csv / weather.csv datasets.
     Used for offline nearest-region matching.
  ─────────────────────────────────────────────────────── */
  const REGION_CENTROIDS = [
    { region_id: 'ap_guntur',            lat: 16.30, lon: 80.44, state: 'Andhra Pradesh',   displayName: 'AP · Guntur' },
    { region_id: 'assam_nagaon',         lat: 26.35, lon: 92.68, state: 'Assam',            displayName: 'Assam · Nagaon' },
    { region_id: 'bihar_patna',          lat: 25.59, lon: 85.14, state: 'Bihar',            displayName: 'Bihar · Patna' },
    { region_id: 'chhattisgarh_raipur',  lat: 21.25, lon: 81.63, state: 'Chhattisgarh',    displayName: 'CG · Raipur' },
    { region_id: 'goa_north',            lat: 15.56, lon: 73.83, state: 'Goa',             displayName: 'Goa · North' },
    { region_id: 'guj_anand',            lat: 22.56, lon: 72.95, state: 'Gujarat',         displayName: 'Guj · Anand' },
    { region_id: 'guj_rajkot',           lat: 22.30, lon: 70.80, state: 'Gujarat',         displayName: 'Guj · Rajkot' },
    { region_id: 'haryana_karnal',       lat: 29.69, lon: 76.99, state: 'Haryana',         displayName: 'Haryana · Karnal' },
    { region_id: 'hp_shimla',            lat: 31.10, lon: 77.17, state: 'Himachal Pradesh', displayName: 'HP · Shimla' },
    { region_id: 'jharkhand_ranchi',     lat: 23.36, lon: 85.33, state: 'Jharkhand',       displayName: 'Jharkhand · Ranchi' },
    { region_id: 'jk_pulwama',          lat: 33.87, lon: 74.90, state: 'Jammu & Kashmir', displayName: 'J&K · Pulwama' },
    { region_id: 'kar_belagavi',         lat: 15.85, lon: 74.50, state: 'Karnataka',       displayName: 'KAR · Belagavi' },
    { region_id: 'kar_mysuru',           lat: 12.30, lon: 76.64, state: 'Karnataka',       displayName: 'KAR · Mysuru' },
    { region_id: 'kerala_palakkad',      lat: 10.77, lon: 76.65, state: 'Kerala',          displayName: 'Kerala · Palakkad' },
    { region_id: 'mh_nashik',            lat: 19.99, lon: 73.79, state: 'Maharashtra',     displayName: 'MH · Nashik' },
    { region_id: 'mh_pune',             lat: 18.52, lon: 73.86, state: 'Maharashtra',     displayName: 'MH · Pune' },
    { region_id: 'mh_yavatmal',          lat: 20.38, lon: 78.12, state: 'Maharashtra',     displayName: 'MH · Yavatmal' },
    { region_id: 'mp_indore',            lat: 22.72, lon: 75.86, state: 'Madhya Pradesh',  displayName: 'MP · Indore' },
    { region_id: 'mp_sehore',            lat: 23.20, lon: 77.08, state: 'Madhya Pradesh',  displayName: 'MP · Sehore' },
    { region_id: 'odisha_cuttack',       lat: 20.46, lon: 85.88, state: 'Odisha',          displayName: 'Odisha · Cuttack' },
    { region_id: 'punjab_ludhiana',      lat: 30.90, lon: 75.85, state: 'Punjab',          displayName: 'Punjab · Ludhiana' },
    { region_id: 'rajasthan_jaipur',     lat: 26.91, lon: 75.79, state: 'Rajasthan',       displayName: 'Rajasthan · Jaipur' },
    { region_id: 'telangana_medak',      lat: 18.04, lon: 78.26, state: 'Telangana',       displayName: 'Telangana · Medak' },
    { region_id: 'tn_coimbatore',        lat: 11.01, lon: 76.97, state: 'Tamil Nadu',      displayName: 'TN · Coimbatore' },
    { region_id: 'tn_thanjavur',         lat: 10.79, lon: 79.14, state: 'Tamil Nadu',      displayName: 'TN · Thanjavur' },
    { region_id: 'tripura_west',         lat: 23.84, lon: 91.28, state: 'Tripura',         displayName: 'Tripura · West' },
    { region_id: 'uk_udhamsinghnagar',   lat: 28.97, lon: 79.49, state: 'Uttarakhand',     displayName: 'UK · Udhamsingh Nagar' },
    { region_id: 'up_lucknow',           lat: 26.85, lon: 80.94, state: 'Uttar Pradesh',   displayName: 'UP · Lucknow' },
    { region_id: 'up_varanasi',          lat: 25.32, lon: 83.01, state: 'Uttar Pradesh',   displayName: 'UP · Varanasi' },
    { region_id: 'wb_bardhaman',         lat: 23.23, lon: 87.86, state: 'West Bengal',     displayName: 'WB · Bardhaman' },
  ];

  /* ── Helpers ──────────────────────────────────────── */

  /**
   * Euclidean distance² in lat/lon space (sufficient for nearest-match;
   * no need for Haversine at this scale).
   */
  function _dist2(lat1, lon1, lat2, lon2) {
    const dLat = lat1 - lat2;
    const dLon = lon1 - lon2;
    return dLat * dLat + dLon * dLon;
  }

  /**
   * Return the region_id whose centroid is geographically closest to
   * the supplied centroid [lon, lat] (GeoJSON order).
   * Always returns a string — never throws.
   */
  function getNearestRegionId(centroid, stateName = null) {
    if (!centroid || centroid.length < 2) return 'telangana_medak'; // ultimate fallback
    const lon = centroid[0];
    const lat  = centroid[1];

    let filtered = REGION_CENTROIDS;
    if (stateName) {
      const normState = stateName.trim().toLowerCase();
      const sameStateRegions = REGION_CENTROIDS.filter(rc => {
        const rcState = rc.state.toLowerCase();
        if (normState.includes(rcState) || rcState.includes(normState)) return true;
        if ((normState.includes('jammu') || normState.includes('kashmir')) && rc.region_id === 'jk_pulwama') return true;
        if ((normState === 'uttarakhand' || normState === 'uk') && rc.region_id === 'uk_udhamsinghnagar') return true;
        return false;
      });
      if (sameStateRegions.length > 0) {
        filtered = sameStateRegions;
      }
    }

    let best = filtered[0];
    let bestD = Infinity;
    for (const rc of filtered) {
      const d = _dist2(lat, lon, rc.lat, rc.lon);
      if (d < bestD) { bestD = d; best = rc; }
    }
    return best.region_id;
  }

  /**
   * Return the full region record for a given region_id, or null.
   */
  function getRegionRecord(regionId) {
    return REGION_CENTROIDS.find(r => r.region_id === regionId) || null;
  }

  /**
   * Nominatim reverse geocode — best-effort, best-effort.
   * Returns { state, district, village } (any may be empty string).
   * Resolves (never rejects) to keep callers simple.
   */
  async function reverseGeocode(lat, lon) {
    const empty = { state: '', district: '', village: '' };
    try {
      const url = `https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lon}&zoom=14&addressdetails=1`;
      const res = await fetch(url, {
        headers: { 'Accept-Language': 'en' },
        signal: AbortSignal.timeout ? AbortSignal.timeout(6000) : undefined,
      });

      if (!res.ok) return empty;
      const data = await res.json();
      const a = data.address || {};
      return {
        state:    a.state    || a.state_district || '',
        district: a.county   || a.district       || a.city || a.town || '',
        village:  a.village  || a.suburb         || a.hamlet || a.neighbourhood || '',
      };
    } catch {
      return empty;
    }
  }

  /* ── Persistence ────────────────────────────────── */

  function _newId() {
    if (global.crypto && typeof global.crypto.randomUUID === 'function') {
      return global.crypto.randomUUID();
    }
    return 'plot_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 8);
  }

  /** Normalise a legacy single-farm object into a plot. */
  function _asPlot(farm, name) {
    const plot = Object.assign({}, farm);
    if (!plot.id) plot.id = _newId();
    if (!plot.name) plot.name = name || _defaultName(plot);
    if (!plot.region_id && plot.centroid) {
      plot.region_id = getNearestRegionId(plot.centroid, plot.state || null);
    }
    if (plot.centroid && plot.lat == null) {
      plot.lon = plot.centroid[0];
      plot.lat = plot.centroid[1];
    }
    if (!plot.savedAt) plot.savedAt = new Date().toISOString();
    return plot;
  }

  function _defaultName(farm) {
    const where = farm.village || farm.district || farm.state;
    const size = farm.acres ? `${Number(farm.acres).toFixed(1)} ac` : null;
    if (where && size) return `${where} · ${size}`;
    if (where) return where;
    if (size) return `Plot · ${size}`;
    return 'My plot';
  }

  /** Read the whole store, migrating a legacy single farm on first access. */
  function _readStore() {
    let store = null;
    try {
      const raw = localStorage.getItem(PLOTS_KEY);
      if (raw) store = JSON.parse(raw);
    } catch { /* corrupt — fall through to migration */ }

    if (store && Array.isArray(store.plots)) {
      if (!store.plots.length) return { activeId: null, plots: [] };
      const known = store.plots.some(p => p.id === store.activeId);
      if (!known) store.activeId = store.plots[0].id;
      return store;
    }

    // Migration: fold any single stored farm into a one-plot collection.
    let legacyFarm = null;
    try {
      const raw = localStorage.getItem(STORAGE_KEY) || localStorage.getItem(LEGACY_KEY);
      if (raw) legacyFarm = JSON.parse(raw);
    } catch { /* ignore */ }

    if (!legacyFarm) return { activeId: null, plots: [] };

    const plot = _asPlot(legacyFarm);
    const migrated = { activeId: plot.id, plots: [plot] };
    _writeStore(migrated, 'migrate');
    return migrated;
  }

  /**
   * M-7: this used to swallow localStorage.setItem quota-exceeded errors
   * silently and still dispatch 'mm:plot-changed' / let callers treat the
   * write as successful — a farmer could be told a boundary was saved when
   * it silently wasn't. Now returns whether the write actually persisted so
   * callers (save/add/remove/rename/setActive) can propagate the failure.
   */
  function _writeStore(store, reason) {
    let persisted = true;
    try {
      localStorage.setItem(PLOTS_KEY, JSON.stringify(store));
    } catch { persisted = false; /* storage full (or unavailable) */ }

    // Mirror the active plot to the legacy key so direct readers stay correct.
    // Best-effort only — it does not gate the overall success/failure signal.
    const active = _activeOf(store);
    try {
      if (active) localStorage.setItem(STORAGE_KEY, JSON.stringify(active));
      else localStorage.removeItem(STORAGE_KEY);
    } catch { /* ignore */ }

    try {
      document.dispatchEvent(new CustomEvent('mm:plot-changed', {
        detail: {
          plot: active,
          plots: store.plots.slice(),
          activeId: store.activeId,
          reason: reason || 'update',
          persisted,
        },
      }));
    } catch { /* pre-DOM call — nothing is listening yet anyway */ }

    return persisted;
  }

  function _activeOf(store) {
    if (!store || !store.plots.length) return null;
    return store.plots.find(p => p.id === store.activeId) || store.plots[0];
  }

  /* ── Single-farm API (unchanged semantics: operates on the active plot) ── */

  function load() {
    return _activeOf(_readStore());
  }

  function save(farm) {
    if (!farm) return null;
    const store = _readStore();
    const active = _activeOf(store);

    if (!active) return add(farm);

    // Preserve the plot's identity — callers pass raw farm objects that know
    // nothing about plots, so id/name must not be clobbered by the update.
    const merged = Object.assign({}, active, farm, {
      id: active.id,
      name: farm.name || active.name,
      savedAt: new Date().toISOString(),
    });
    store.plots = store.plots.map(p => (p.id === active.id ? merged : p));
    store.activeId = merged.id;
    const persisted = _writeStore(store, 'save');
    return persisted ? merged : null;
  }

  function clear() {
    try {
      localStorage.removeItem(PLOTS_KEY);
      localStorage.removeItem(STORAGE_KEY);
      localStorage.removeItem(LEGACY_KEY);
    } catch {}
    try {
      document.dispatchEvent(new CustomEvent('mm:plot-changed', {
        detail: { plot: null, plots: [], activeId: null, reason: 'clear' },
      }));
    } catch {}
  }

  function isActive() {
    return load() !== null;
  }

  /* ── Multi-plot API ─────────────────────────────── */

  function list() {
    return _readStore().plots.slice();
  }

  function count() {
    return _readStore().plots.length;
  }

  function getActiveId() {
    const store = _readStore();
    const active = _activeOf(store);
    return active ? active.id : null;
  }

  function add(farm, name) {
    if (!farm) return null;
    const store = _readStore();
    if (store.plots.length >= MAX_PLOTS) {
      throw new Error(`You can save up to ${MAX_PLOTS} plots. Remove one first.`);
    }
    const plot = _asPlot(farm, name);
    store.plots.push(plot);
    store.activeId = plot.id;
    const persisted = _writeStore(store, 'add');
    return persisted ? plot : null;
  }

  function remove(id) {
    const store = _readStore();
    const next = store.plots.filter(p => p.id !== id);
    if (next.length === store.plots.length) return false;
    store.plots = next;
    if (store.activeId === id) {
      store.activeId = next.length ? next[0].id : null;
    }
    return _writeStore(store, 'remove');
  }

  function rename(id, name) {
    const clean = String(name || '').trim().slice(0, 60);
    if (!clean) return false;
    const store = _readStore();
    const plot = store.plots.find(p => p.id === id);
    if (!plot) return false;
    plot.name = clean;
    return _writeStore(store, 'rename');
  }

  function setActive(id) {
    const store = _readStore();
    if (!store.plots.some(p => p.id === id)) return null;
    store.activeId = id;
    const persisted = _writeStore(store, 'activate');
    return persisted ? _activeOf(store) : null;
  }

  /* ── Committed crop (per active plot) ────────────── */

  /**
   * The crop the farmer has committed to planting on the active plot, or
   * null if no plot is active or none has been committed yet.
   */
  function getActiveCrop() {
    const active = load();
    if (!active || !active.crop_id) return null;
    return {
      crop_id: active.crop_id,
      crop_name: active.crop_name || active.crop_id,
      committedAt: active.committedAt || null,
    };
  }

  /**
   * Record which crop the farmer is planting on the active plot, so
   * fertilizer/irrigation/other tools can default to it instead of asking
   * the farmer to re-pick a crop every time. No-op (returns null) if there
   * is no active plot to attach the commitment to — there's nothing to
   * auto-fill from in that case anyway.
   */
  function setActiveCrop(cropId, cropName) {
    if (!cropId || !load()) return null;
    return save({ crop_id: cropId, crop_name: cropName || cropId, committedAt: new Date().toISOString() });
  }

  /* ── Export ─────────────────────────────────────── */
  global.FarmState = {
    STORAGE_KEY,
    PLOTS_KEY,
    MAX_PLOTS,
    REGION_CENTROIDS,
    load,
    save,
    clear,
    isActive,
    list,
    count,
    add,
    remove,
    rename,
    setActive,
    getActiveId,
    getNearestRegionId,
    getRegionRecord,
    reverseGeocode,
    getActiveCrop,
    setActiveCrop,
  };

})(window);
