/* AgriSim — static region centroid table for geolocation-to-region matching.
   Coordinates are real district-headquarters centroids (public geographic
   data), used only to pick the nearest of the app's 30 known regions from a
   GPS reading — not survey-precision figures. The same points are recorded
   in pipelines/reference/pilot_regions.csv. */
(() => {
  'use strict';

  const REGIONS = [
    { region_id: 'ap_guntur',           lat: 16.30, lon: 80.44 },
    { region_id: 'assam_nagaon',        lat: 26.35, lon: 92.68 },
    { region_id: 'bihar_patna',         lat: 25.59, lon: 85.14 },
    { region_id: 'chhattisgarh_raipur', lat: 21.25, lon: 81.63 },
    { region_id: 'goa_north',           lat: 15.50, lon: 73.83 },
    { region_id: 'guj_anand',           lat: 22.56, lon: 72.95 },
    { region_id: 'guj_rajkot',          lat: 22.30, lon: 70.80 },
    { region_id: 'haryana_karnal',      lat: 29.69, lon: 76.98 },
    { region_id: 'hp_shimla',           lat: 31.10, lon: 77.17 },
    { region_id: 'jharkhand_ranchi',    lat: 23.34, lon: 85.31 },
    { region_id: 'jk_pulwama',          lat: 33.87, lon: 74.90 },
    { region_id: 'kar_belagavi',        lat: 15.85, lon: 74.50 },
    { region_id: 'kar_mysuru',          lat: 12.30, lon: 76.64 },
    { region_id: 'kerala_palakkad',     lat: 10.78, lon: 76.65 },
    { region_id: 'mh_nashik',           lat: 20.00, lon: 73.79 },
    { region_id: 'mh_pune',             lat: 18.52, lon: 73.86 },
    { region_id: 'mh_yavatmal',         lat: 20.39, lon: 78.13 },
    { region_id: 'mp_indore',           lat: 22.72, lon: 75.86 },
    { region_id: 'mp_sehore',           lat: 23.20, lon: 77.08 },
    { region_id: 'odisha_cuttack',      lat: 20.47, lon: 85.88 },
    { region_id: 'punjab_ludhiana',     lat: 30.90, lon: 75.85 },
    { region_id: 'rajasthan_jaipur',    lat: 26.91, lon: 75.79 },
    { region_id: 'telangana_medak',     lat: 17.61, lon: 78.26 },
    { region_id: 'tn_coimbatore',       lat: 11.02, lon: 76.96 },
    { region_id: 'tn_thanjavur',        lat: 10.79, lon: 79.14 },
    { region_id: 'tripura_west',        lat: 23.83, lon: 91.29 },
    { region_id: 'uk_udhamsinghnagar',  lat: 28.98, lon: 79.40 },
    { region_id: 'up_lucknow',          lat: 26.85, lon: 80.95 },
    { region_id: 'up_varanasi',         lat: 25.32, lon: 82.97 },
    { region_id: 'wb_bardhaman',        lat: 23.24, lon: 87.86 }
  ];

  const R_KM = 6371;
  const toRad = d => d * Math.PI / 180;
  function haversineKm(lat1, lon1, lat2, lon2) {
    const dLat = toRad(lat2 - lat1);
    const dLon = toRad(lon2 - lon1);
    const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) * Math.sin(dLon / 2);
    return 2 * R_KM * Math.asin(Math.min(1, Math.sqrt(a)));
  }
  function nearestRegion(lat, lon) {
    let best = null;
    for (const r of REGIONS) {
      const d = haversineKm(lat, lon, r.lat, r.lon);
      if (!best || d < best.distanceKm) best = { region_id: r.region_id, distanceKm: d };
    }
    return best;
  }

  window.MM_REGION_GEO = REGIONS;
  window.MM_REGION_GEO_UTIL = { haversineKm, nearestRegion };
})();
