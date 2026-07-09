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

   Public API (window.FarmState)
   ──────────────────────────────
     FarmState.load()                → farm | null
     FarmState.save(farm)            → void
     FarmState.clear()               → void
     FarmState.isActive()            → boolean
     FarmState.getNearestRegionId(centroid[lon,lat]) → string
     FarmState.reverseGeocode(lat, lon)              → Promise<{state,district,village}>
     FarmState.REGION_CENTROIDS      → [{region_id, lat, lon, state, displayName}, …]

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
   }
   ========================================================= */

;(function (global) {
  'use strict';

  /* ── Storage key ─────────────────────────────────────── */
  const STORAGE_KEY    = 'mittimantra_selectedFarm';
  const LEGACY_KEY     = 'agrisim_farm';

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
        headers: { 'Accept-Language': 'en', 'User-Agent': 'MittiMantra/1.0' },
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

  function load() {
    try {
      // Try new key first
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) return JSON.parse(raw);
      // Migrate from legacy key
      const legacy = localStorage.getItem(LEGACY_KEY);
      if (legacy) {
        const farm = JSON.parse(legacy);
        // Enrich legacy farm with region_id if missing
        if (!farm.region_id && farm.centroid) {
          farm.region_id = getNearestRegionId(farm.centroid);
        }
        // Flatten centroid to lat/lon
        if (farm.centroid && !farm.lat) {
          farm.lon = farm.centroid[0];
          farm.lat  = farm.centroid[1];
        }
        save(farm);
        return farm;
      }
    } catch { /* corrupt storage — ignore */ }
    return null;
  }

  function save(farm) {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(farm));
    } catch { /* storage full — ignore */ }
  }

  function clear() {
    try {
      localStorage.removeItem(STORAGE_KEY);
      localStorage.removeItem(LEGACY_KEY);
    } catch {}
  }

  function isActive() {
    return load() !== null;
  }

  /* ── Export ─────────────────────────────────────── */
  global.FarmState = {
    STORAGE_KEY,
    REGION_CENTROIDS,
    load,
    save,
    clear,
    isActive,
    getNearestRegionId,
    getRegionRecord,
    reverseGeocode,
  };

})(window);
