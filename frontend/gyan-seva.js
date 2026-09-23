/* =========================================================================
   Gyan Seva — Interactive logic
   -------------------------------------------------------------------------
   Handles:
     1. All 28 Indian States & Dynamic District population
     2. Browser HTML5 Geolocation API with closest-district auto-fill
     3. Topic-to-specialization intelligent matching
     4. Weighted ranking algorithm ranking consultants
     5. Dynamic template rendering of consultant cards & profile modal
     6. Booking workflow & summary calculation
     7. FAQ accordion collapse/expand triggers
   ========================================================================= */

(function () {
  'use strict';

  // Constants
  const CONSULTANTS = window.CONSULTANTS_DATA || [];

  /* ---------- Modal accessibility (dialog focus trap + Escape-to-close) ----------
     Shared by the expert-profile modal and the compare-experts modal: moves
     focus into the modal on open, traps Tab inside it, closes on Escape, and
     restores focus to whatever triggered it on close. */
  const modalA11yState = new WeakMap(); // modalContentEl -> { trigger, keydown }
  function gsFocusableIn(container) {
    return Array.from(container.querySelectorAll(
      'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
    ));
  }
  function openModalA11y(modalContentEl, closeFn) {
    if (!modalContentEl) return;
    const trigger = document.activeElement;
    const focusables = gsFocusableIn(modalContentEl);
    (focusables[0] || modalContentEl).focus();
    const keydown = (e) => {
      if (e.key === 'Escape') { e.preventDefault(); closeFn(); return; }
      if (e.key !== 'Tab') return;
      const items = gsFocusableIn(modalContentEl);
      if (!items.length) return;
      const first = items[0], last = items[items.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    };
    document.addEventListener('keydown', keydown);
    modalA11yState.set(modalContentEl, { trigger, keydown });
  }
  function closeModalA11y(modalContentEl) {
    if (!modalContentEl) return;
    const s = modalA11yState.get(modalContentEl);
    if (!s) return;
    document.removeEventListener('keydown', s.keydown);
    if (s.trigger && document.body.contains(s.trigger)) s.trigger.focus();
    modalA11yState.delete(modalContentEl);
  }

  /* ---------- Avatars ----------
     Every consultant record carries a ui-avatars.com URL. With 2,292 records
     that is 2,292 cross-origin image requests, and the service rate-limits well
     before the first screen finishes: most cards rendered a broken-image icon.
     The avatars are only tinted initials, so draw them locally instead -- no
     network, no rate limit, works offline in the PWA, and identical output for
     the same name every time. */
  const AVATAR_COLORS = [
    '#2f6b3a', '#a5562a', '#c88a3a', '#4a7db8', '#6b8e23',
    '#8a5a83', '#3f7d7d', '#9c4f4f', '#5b6bbf', '#7a6a3a',
  ];

  function initialsOf(name) {
    const words = String(name || '')
      .replace(/\b(dr|mr|mrs|ms|er|prof)\.?\s+/gi, '')
      .trim().split(/\s+/).filter(Boolean);
    if (!words.length) return '?';
    return (words[0][0] + (words.length > 1 ? words[words.length - 1][0] : '')).toUpperCase();
  }

  function avatarFor(name) {
    const label = initialsOf(name);
    let hash = 0;
    const key = String(name || '');
    for (let i = 0; i < key.length; i++) hash = (hash * 31 + key.charCodeAt(i)) >>> 0;
    const bg = AVATAR_COLORS[hash % AVATAR_COLORS.length];
    const svg =
      `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 96 96">` +
      `<rect width="96" height="96" rx="48" fill="${bg}"/>` +
      `<text x="48" y="49" text-anchor="middle" dominant-baseline="central" ` +
      `font-family="Inter, Segoe UI, sans-serif" font-size="38" font-weight="600" ` +
      `fill="#ffffff">${label}</text></svg>`;
    return 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
  }
  
  // State Capitals Coordinates (Fallback for dynamic reverse-geocoding/closest matching)
  const STATE_CAPITALS = {
    "Andhra Pradesh": { lat: 16.5062, lng: 80.6480 },
    "Arunachal Pradesh": { lat: 27.0844, lng: 93.6053 },
    "Assam": { lat: 26.1445, lng: 91.7362 },
    "Bihar": { lat: 25.5941, lng: 85.1376 },
    "Chhattisgarh": { lat: 21.2787, lng: 81.8661 },
    "Goa": { lat: 15.4909, lng: 73.8278 },
    "Gujarat": { lat: 23.2156, lng: 72.6369 },
    "Haryana": { lat: 30.7333, lng: 76.7794 },
    "Himachal Pradesh": { lat: 31.1048, lng: 77.1734 },
    "Jharkhand": { lat: 23.3441, lng: 85.3096 },
    "Karnataka": { lat: 12.9716, lng: 77.5946 },
    "Kerala": { lat: 8.5241, lng: 76.9366 },
    "Madhya Pradesh": { lat: 23.2599, lng: 77.4126 },
    "Maharashtra": { lat: 18.9750, lng: 72.8258 },
    "Manipur": { lat: 24.8170, lng: 93.9368 },
    "Meghalaya": { lat: 25.5788, lng: 91.8831 },
    "Mizoram": { lat: 23.7307, lng: 92.7179 },
    "Nagaland": { lat: 25.6751, lng: 94.1086 },
    "Odisha": { lat: 20.2961, lng: 85.8245 },
    "Punjab": { lat: 30.7333, lng: 76.7794 },
    "Rajasthan": { lat: 26.9124, lng: 75.7873 },
    "Sikkim": { lat: 27.3314, lng: 88.6138 },
    "Tamil Nadu": { lat: 13.0827, lng: 80.2707 },
    "Telangana": { lat: 17.3850, lng: 78.4867 },
    "Tripura": { lat: 23.8315, lng: 91.2868 },
    "Uttar Pradesh": { lat: 26.8467, lng: 80.9462 },
    "Uttarakhand": { lat: 30.3165, lng: 78.0322 },
    "West Bengal": { lat: 22.5726, lng: 88.3639 }
  };

  // Base District Coordinates list
  const DISTRICT_COORDS = {
    "Madhya Pradesh": {
      "Sehore": { lat: 23.2032, lng: 77.0844 },
      "Bhopal": { lat: 23.2599, lng: 77.4126 },
      "Indore": { lat: 22.7196, lng: 75.8577 },
      "Dewas": { lat: 22.9622, lng: 76.0508 },
      "Vidisha": { lat: 23.5231, lng: 77.8133 }
    },
    "Maharashtra": {
      "Pune": { lat: 18.5204, lng: 73.8567 },
      "Satara": { lat: 17.6805, lng: 73.9918 },
      "Solapur": { lat: 17.6599, lng: 75.9064 },
      "Baramati": { lat: 18.1560, lng: 74.5771 },
      "Ahmednagar": { lat: 19.0948, lng: 74.7480 }
    },
    "Uttar Pradesh": {
      "Lucknow": { lat: 26.8467, lng: 80.9462 },
      "Kanpur": { lat: 26.4499, lng: 80.3319 },
      "Prayagraj": { lat: 25.4358, lng: 81.8463 },
      "Varanasi": { lat: 25.3176, lng: 82.9739 },
      "Bareilly": { lat: 28.3640, lng: 79.4150 }
    },
    "Punjab": {
      "Ludhiana": { lat: 30.9010, lng: 75.8573 },
      "Amritsar": { lat: 31.6340, lng: 74.8723 },
      "Patiala": { lat: 30.3398, lng: 76.3869 }
    },
    "Haryana": {
      "Karnal": { lat: 29.6857, lng: 76.9905 },
      "Hisar": { lat: 29.1492, lng: 75.7217 }
    },
    "Gujarat": {
      "Ahmedabad": { lat: 23.0225, lng: 72.5714 },
      "Rajkot": { lat: 22.3039, lng: 70.8022 },
      "Anand": { lat: 22.5645, lng: 72.9289 }
    },
    "Karnataka": {
      "Bengaluru": { lat: 12.9716, lng: 77.5946 },
      "Mysuru": { lat: 12.2958, lng: 76.6394 },
      "Mandya": { lat: 12.5218, lng: 76.8951 }
    },
    "Rajasthan": {
      "Jaipur": { lat: 26.9124, lng: 75.7873 },
      "Udaipur": { lat: 24.5854, lng: 73.7125 },
      "Ganganagar": { lat: 29.9141, lng: 73.8756 }
    },
    "Tamil Nadu": {
      "Coimbatore": { lat: 11.0168, lng: 76.9558 },
      "Madurai": { lat: 9.9252, lng: 78.1198 },
      "Thanjavur": { lat: 10.7870, lng: 79.1378 }
    },
    "Andhra Pradesh": {
      "Vijayawada": { lat: 16.5062, lng: 80.6480 },
      "Guntur": { lat: 16.3067, lng: 80.4365 }
    },
    "West Bengal": {
      "Burdwan": { lat: 23.2324, lng: 87.8630 },
      "Murshidabad": { lat: 24.1750, lng: 88.2804 }
    },
    "Bihar": {
      "Patna": { lat: 25.5941, lng: 85.1376 },
      "Gaya": { lat: 24.7914, lng: 85.0002 }
    }
  };

  // SVGs
  const starSVG = `<svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 2l2.9 6.6 7.1.6-5.4 4.7 1.7 7-6.3-3.9L5.7 21l1.7-7-5.4-4.7 7.1-.6L12 2z"/></svg>`;
  const checkSVG = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>`;
  
  const distanceIcon = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2a8 8 0 0 0-8 8c0 5.25 8 12 8 12s8-6.75 8-12a8 8 0 0 0-8-8z"/><circle cx="12" cy="10" r="3"/></svg>`;
  const langIcon = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>`;
  const visitsIcon = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>`;
  const clockIcon = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>`;

  // Shared HTML-escaping helper (mm-core.js), matching the pattern used
  // elsewhere in this app for any string that can contain user input.
  const esc = (window.MM && window.MM.escapeHtml) || function (s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
    }[c]));
  };

  // i18n.js does a one-shot DOM walk when the language changes; content
  // rendered afterwards (every dynamic re-render on this page) needs to
  // trigger it again, same as Marketplace's language-following voice input.
  function retranslate() {
    if (window.AgriSimI18n) window.AgriSimI18n.retranslate();
  }

  /* =========================================================================
     WOW-FACTOR DATA LAYER
     -------------------------------------------------------------------------
     There is no real backend for bookings/outcomes here (same architecture
     as the rest of MittiMantra — see Marketplace's self-reported sales):
     everything a farmer books or logs is scoped to this browser via a
     per-device id and stored in localStorage. A small set of DEMO_* records
     ships as seed data (clearly labeled "Demo" wherever shown) so the
     Verified Outcomes / testimonials features aren't empty on first visit —
     mirroring the DEMO_LISTINGS / DEMO_POOLS pattern already used in the
     Marketplace feature.
     ========================================================================= */
  const LS = {
    bookings: 'mittimantra_gyanseva_bookings',
    outcomes: 'mittimantra_gyanseva_outcomes',
    testimonials: 'mittimantra_gyanseva_testimonials',
  };

  function readLS(key, fallback) {
    try {
      const raw = localStorage.getItem(key);
      if (raw == null) return fallback;
      const parsed = JSON.parse(raw);
      return parsed == null ? fallback : parsed;
    } catch (_) { return fallback; }
  }
  function writeLS(key, val) {
    try { localStorage.setItem(key, JSON.stringify(val)); return true; }
    catch (_) { return false; }
  }

  function newId(prefix) {
    return prefix + '_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 8);
  }

  const getMyBookings = () => readLS(LS.bookings, []);
  const saveMyBookings = (v) => writeLS(LS.bookings, v);
  const getMyOutcomes = () => readLS(LS.outcomes, []);
  const saveMyOutcomes = (v) => writeLS(LS.outcomes, v);
  const getMyTestimonials = () => readLS(LS.testimonials, []);
  const saveMyTestimonials = (v) => writeLS(LS.testimonials, v);

  // Categories where advice commonly leads to spending on chemicals,
  // infrastructure, or other hard-to-reverse decisions — the Second-Opinion
  // Safety Net nudges toward comparing two experts specifically for these.
  const HIGH_STAKES_CATEGORIES = new Set([
    'Pest attack', 'Leaf diseases', 'Fertilizer recommendation',
    'Irrigation planning', 'Soil does not retain water',
  ]);

  // ---- Demo seed data for Verified Outcomes / Farmer-Voice Proof --------
  // Picked from the real (synthetic) CONSULTANTS_DATA pool by specialization
  // so the seed testimonials reference an expert that actually exists in
  // the directory, rather than an invented name.
  let DEMO_OUTCOMES = [];
  let DEMO_TESTIMONIALS = [];

  function buildDemoSeed() {
    const wanted = [
      { spec: 'Pest attack', crop: 'Cotton', problem: 'Whitefly infestation', worked: 'yes',
        quote: 'Followed the neem-oil spray schedule exactly as advised. The whitefly count dropped within a week and the crop recovered.' },
      { spec: 'Leaf diseases', crop: 'Tomato', problem: 'Leaf curl', worked: 'yes',
        quote: 'The advice matched what I was seeing. Two rounds of treatment and the new leaves came back healthy.' },
      { spec: 'Soil testing', crop: 'Soybean', problem: 'Low yield, suspected nutrient gap', worked: 'partial',
        quote: 'Soil test recommendations helped, yield improved some — but not as much as I hoped this season.' },
      { spec: 'Water & Irrigation', crop: 'Sugarcane', problem: 'High water usage', worked: 'yes',
        quote: 'Switched to the drip schedule that was suggested. Water bill and usage both went down noticeably.' },
      { spec: 'Fertilizer recommendation', crop: 'Wheat', problem: 'Fertilizer timing', worked: 'yes',
        quote: 'Split-dose timing advice was easy to follow and the crop looked visibly greener within 2 weeks.' },
      { spec: 'Organic farming', crop: 'Pulses', problem: 'Transition to organic', worked: 'partial',
        quote: 'Still learning the organic routine. It is working, just slower than the expert first estimated.' },
      { spec: 'Machinery guidance', crop: 'Rice', problem: 'Choosing a transplanter', worked: 'yes',
        quote: 'Helped me pick the right machine size for my plot instead of overspending on a bigger one.' },
      { spec: 'Government schemes', crop: 'Maize', problem: 'Subsidy eligibility', worked: 'yes',
        quote: 'Pointed me to a scheme I did not know I qualified for. Application went through.' },
    ];

    const outcomes = [];
    const testimonials = [];
    wanted.forEach((w, i) => {
      const expert = CONSULTANTS.find((c) => c.specialization === w.spec);
      if (!expert) return;
      const loggedAt = new Date(Date.now() - (i + 3) * 86400000).toISOString();
      const outcomeId = 'demo_out_' + expert.id + '_' + i;
      outcomes.push({
        id: outcomeId, bookingId: null, expertId: expert.id,
        worked: w.worked, note: '', cropName: w.crop, loggedAt, source: 'demo',
      });
      testimonials.push({
        id: 'demo_test_' + expert.id + '_' + i, outcomeId, expertId: expert.id,
        farmerLabel: `A farmer in ${expert.district}, ${expert.state}`,
        quote: w.quote, crop: w.crop, problem: w.problem,
        outcome: w.worked === 'yes' ? 'Advice worked' : w.worked === 'partial' ? 'Partially helped' : "Didn't help",
        loggedAt, source: 'demo',
      });
    });
    DEMO_OUTCOMES = outcomes;
    DEMO_TESTIMONIALS = testimonials;
  }
  buildDemoSeed();

  function getOutcomesFor(expertId) {
    return DEMO_OUTCOMES.filter((o) => o.expertId == expertId)
      .concat(getMyOutcomes().filter((o) => o.expertId == expertId));
  }

  function computeOutcomeStats(expertId) {
    const list = getOutcomesFor(expertId);
    if (!list.length) return null;
    const worked = list.filter((o) => o.worked === 'yes').length;
    const partial = list.filter((o) => o.worked === 'partial').length;
    const pct = Math.round(((worked + partial * 0.5) / list.length) * 100);
    return { total: list.length, pct };
  }

  function getTestimonialsFor(expertId) {
    return DEMO_TESTIMONIALS.filter((t) => t.expertId == expertId)
      .concat(getMyTestimonials().filter((t) => t.expertId == expertId))
      .sort((a, b) => new Date(b.loggedAt) - new Date(a.loggedAt));
  }

  // Haversine Distance Formula
  function getDistanceKm(lat1, lon1, lat2, lon2) {
    const R = 6371; // Earth radius in km
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLon = (lon2 - lon1) * Math.PI / 180;
    const a = 
      Math.sin(dLat/2) * Math.sin(dLat/2) +
      Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * 
      Math.sin(dLon/2) * Math.sin(dLon/2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
    return R * c;
  }

  // Get status class for availability
  function getAvailabilityClass(status) {
    if (status === "Online") return "status-online";
    if (status === "Available Tomorrow") return "status-tomorrow";
    return "status-offline";
  }

  // State Management
  const state = {
    selectedState: "",
    selectedDistrict: "",
    preferredLanguage: "Hindi",
    problemCategory: "",
    consultationTopic: "",
    districtCoords: null,
    currentCoords: null, // Live GPS Coordinates
    visibleCount: 15,    // Paginate list to prevent browser lag
    compareIds: []        // Second-Opinion Safety Net — up to 2 expert ids
  };

  // Consultation Prep Sheet — the most recent real Field Health / AI Scan
  // results seen this session, so a prep sheet can be assembled from data
  // that's already been fetched rather than re-querying on demand.
  let lastFieldHealth = null;
  let lastFarm = null;
  let lastScanResult = null;

  // DOM Elements
  const stateSelect = document.getElementById("farmerState");
  const districtSelect = document.getElementById("farmerDistrict");
  const languageSelect = document.getElementById("farmerLanguage");
  const categorySelect = document.getElementById("problemCategory");
  const topicSelect = document.getElementById("consultationFocus");
  const problemDescText = document.getElementById("problemDescription");
  const btnGeolocation = document.getElementById("btnGeolocation");
  const expertsContainer = document.getElementById("expertsContainer");
  const resultsCount = document.getElementById("resultsCount");

  // Modal Elements
  const modal = document.getElementById("profileModal");
  const modalBody = document.getElementById("modalBody");
  const modalClose = document.getElementById("modalClose");
  const modalBackdrop = document.getElementById("modalBackdrop");

  // Booking summary container
  const bookingSummaryPlaceholder = document.getElementById("bookingSummaryPlaceholder");

  // Wow-factor feature DOM elements
  const gsFieldHealthBanner = document.getElementById("gsFieldHealthBanner");
  const gsMyBookingsPanel = document.getElementById("gsMyBookingsPanel");
  const gsHighStakesBanner = document.getElementById("gsHighStakesBanner");
  const gsVerifiedSection = document.getElementById("gsVerifiedSection");
  const gsVerifiedTestimonials = document.getElementById("gsVerifiedTestimonials");
  const gsCompareBar = document.getElementById("gsCompareBar");
  const compareModal = document.getElementById("compareModal");
  const compareModalBody = document.getElementById("compareModalBody");

  // Populate dynamic district list for selected state (pre-defined or auto-generated)
  function populateDistricts(stateName) {
    districtSelect.innerHTML = '<option value="">Select District</option>';
    
    if (!stateName) {
      districtSelect.disabled = true;
      districtSelect.innerHTML = '<option value="">Select State first</option>';
      return;
    }

    districtSelect.disabled = false;

    // Dynamically retrieve all unique districts for this state from our massive CONSULTANTS pool!
    const poolDistricts = [...new Set(CONSULTANTS.filter(c => c.state === stateName).map(c => c.district))].sort();
    if (poolDistricts.length > 0) {
      poolDistricts.forEach(dist => {
        const opt = document.createElement("option");
        opt.value = dist;
        opt.textContent = dist;
        districtSelect.appendChild(opt);
      });
      // Also cache coords dynamically
      if (!DISTRICT_COORDS[stateName]) {
        DISTRICT_COORDS[stateName] = {};
      }
      CONSULTANTS.filter(c => c.state === stateName).forEach(c => {
        if (!DISTRICT_COORDS[stateName][c.district]) {
          DISTRICT_COORDS[stateName][c.district] = { lat: c.latitude, lng: c.longitude };
        }
      });
    } else if (DISTRICT_COORDS[stateName]) {
      Object.keys(DISTRICT_COORDS[stateName]).forEach(dist => {
        const opt = document.createElement("option");
        opt.value = dist;
        opt.textContent = dist;
        districtSelect.appendChild(opt);
      });
    } else {
      // Self-healing: generate dynamic fallback districts for the selected state
      const capital = STATE_CAPITALS[stateName] || { lat: 21.0, lng: 78.0 };
      const fallbacks = ["Central District", "Northern District", "Southern District"];
      const offsets = [
        { dLat: 0, dLng: 0 },
        { dLat: 0.35, dLng: 0.35 },
        { dLat: -0.35, dLng: -0.35 }
      ];

      DISTRICT_COORDS[stateName] = {};
      fallbacks.forEach((dist, idx) => {
        const name = `${stateName} ${dist}`;
        const opt = document.createElement("option");
        opt.value = name;
        opt.textContent = name;
        districtSelect.appendChild(opt);
        
        // Cache coordinates
        DISTRICT_COORDS[stateName][name] = {
          lat: capital.lat + offsets[idx].dLat,
          lng: capital.lng + offsets[idx].dLng
        };
      });
    }
  }

  // Populate all states dynamically from global state-data
  function initializeStatesDropdown() {
    if (!stateSelect) return;
    
    // Clear hardcoded list
    stateSelect.innerHTML = '<option value="">Select State</option>';

    const allStates = window.AgriSimStateData ? Object.keys(window.AgriSimStateData.all).sort() : Object.keys(STATE_CAPITALS).sort();
    
    allStates.forEach(sName => {
      const opt = document.createElement("option");
      opt.value = sName;
      opt.textContent = sName;
      stateSelect.appendChild(opt);
    });
  }

  // Find nearest district from any coordinates using all consultants in the pool
  function findNearestDistrict(lat, lng) {
    let minDistance = Infinity;
    let nearestState = "";
    let nearestDistrict = "";
    
    // Search in the active CONSULTANTS pool first for maximum accuracy
    if (CONSULTANTS.length > 0) {
      CONSULTANTS.forEach(expert => {
        if (expert.latitude && expert.longitude) {
          const dist = getDistanceKm(lat, lng, expert.latitude, expert.longitude);
          if (dist < minDistance) {
            minDistance = dist;
            nearestState = expert.state;
            nearestDistrict = expert.district;
          }
        }
      });
    }
    
    // Fallback to DISTRICT_COORDS if pool was empty
    if (!nearestState && Object.keys(DISTRICT_COORDS).length > 0) {
      Object.keys(DISTRICT_COORDS).forEach(sName => {
        Object.keys(DISTRICT_COORDS[sName]).forEach(dName => {
          const coords = DISTRICT_COORDS[sName][dName];
          const dist = getDistanceKm(lat, lng, coords.lat, coords.lng);
          if (dist < minDistance) {
            minDistance = dist;
            nearestState = sName;
            nearestDistrict = dName;
          }
        });
      });
    }

    return { state: nearestState, district: nearestDistrict };
  }

  // Geolocation button event listener
  if (btnGeolocation) {
    btnGeolocation.addEventListener("click", () => {
      btnGeolocation.textContent = "⌛ Accessing Location...";
      btnGeolocation.style.background = "var(--gs-green-soft)";
      btnGeolocation.style.color = "var(--brand-deep)";

      if (!navigator.geolocation) {
        (window.MM && window.MM.toast ? window.MM.toast : alert)("This device can't share its location. Pick your state and district instead.", 4000);
        resetGeoButton();
        return;
      }

      navigator.geolocation.getCurrentPosition(
        (position) => {
          const lat = position.coords.latitude;
          const lng = position.coords.longitude;
          state.currentCoords = { lat, lng };

          // Find the nearest district in our coords dictionary
          const match = findNearestDistrict(lat, lng);
          if (match.state && match.district) {
            // Update dropdown values
            stateSelect.value = match.state;
            state.selectedState = match.state;
            
            populateDistricts(match.state);
            districtSelect.value = match.district;
            state.selectedDistrict = match.district;
            
            // Set coordinates to exact user coordinates for calculation
            state.districtCoords = state.currentCoords;

            // Change button visual to checkmark
            btnGeolocation.innerHTML = "✓ Location Active";
            btnGeolocation.style.background = "var(--brand)";
            btnGeolocation.style.color = "#fff";
            btnGeolocation.style.borderColor = "var(--brand)";
            
            state.visibleCount = 15;
            updateResults();
          } else {
            (window.MM && window.MM.toast ? window.MM.toast : alert)("We couldn't match your location to a district. Pick it from the list instead.", 4000);
            resetGeoButton();
          }
        },
        (error) => {
          console.error("Location error:", error);
          btnGeolocation.textContent = "❌ Location Blocked";
          btnGeolocation.style.background = "#fee2e2";
          btnGeolocation.style.color = "#991b1b";
          btnGeolocation.style.borderColor = "#f87171";
          
          setTimeout(resetGeoButton, 2500);
        },
        { enableHighAccuracy: true, timeout: 7000 }
      );
    });
  }

  function resetGeoButton() {
    if (btnGeolocation) {
      btnGeolocation.innerHTML = "📍 Use Current Location";
      btnGeolocation.style.background = "transparent";
      btnGeolocation.style.color = "var(--brand)";
      btnGeolocation.style.borderColor = "var(--brand)";
    }
  }

  // Dropdown change listeners
  stateSelect?.addEventListener("change", function () {
    const sName = this.value;
    state.selectedState = sName;
    state.selectedDistrict = "";
    state.districtCoords = null;
    state.currentCoords = null; // Clear live coordinates on manual selection
    resetGeoButton();

    populateDistricts(sName);
    state.visibleCount = 15;
    updateResults();
  });

  districtSelect?.addEventListener("change", function () {
    state.selectedDistrict = this.value;
    state.currentCoords = null; // Clear live coordinates on manual selection
    resetGeoButton();
    if (state.selectedState && state.selectedDistrict) {
      state.districtCoords = DISTRICT_COORDS[state.selectedState][state.selectedDistrict];
    } else {
      state.districtCoords = null;
    }
    state.visibleCount = 15;
    updateResults();
  });

  [languageSelect, categorySelect, topicSelect].forEach(el => {
    el?.addEventListener("change", function () {
      state.preferredLanguage = languageSelect.value;
      state.problemCategory = categorySelect.value;
      state.consultationTopic = topicSelect.value;
      state.visibleCount = 15;
      updateResults();
    });
  });

  // Intelligent categorization matching
  function isSpecializationMatch(expertSpec, selectedTopic) {
    if (!selectedTopic) return false;
    const spec = expertSpec.toLowerCase();
    const topic = selectedTopic.toLowerCase();

    if (spec === topic) return true;
    
    // Group mappings
    if (topic === "soil health" && (spec.includes("soil") || spec.includes("water chemistry"))) return true;
    if (topic === "water & irrigation" && spec.includes("irrigation")) return true;
    if (topic === "organic farming" && spec.includes("organic")) return true;
    if (topic === "machinery guidance" && spec.includes("machinery")) return true;
    if (topic === "government schemes" && spec.includes("scheme")) return true;
    if (topic === "pest attack" && (spec.includes("pest") || spec.includes("pathology") || spec.includes("entomology"))) return true;
    if (topic === "leaf diseases" && (spec.includes("disease") || spec.includes("pathology"))) return true;
    
    return false;
  }

  // Weighted Matching & Ranking Algorithm
  // Strategy:
  //  - GPS active  → Filter to vicinity (distance <= 150 km). Sort by distance ASC.
  //  - Dropdown State + District selected → Filter strictly to that state and district.
  //  - Dropdown State selected → Filter strictly to that state.
  //  - Landing state (no location selected) → Show all, sort by rating and experience.
  function rankConsultants() {
    const gpsActive = !!(state.districtCoords && state.currentCoords);
    const districtSelected = !!(state.selectedState && state.selectedDistrict && !gpsActive);
    const stateSelected = !!(state.selectedState && !state.selectedDistrict && !gpsActive);

    // 1. Calculate distance and scores for all experts
    const scored = CONSULTANTS.map(expert => {
      let distance = 9999;
      let relevanceScore = 0;

      if (state.districtCoords && expert.latitude && expert.longitude) {
        // Use exact GPS coords when geolocation is active; else district centroid
        const refLat = gpsActive ? state.currentCoords.lat : state.districtCoords.lat;
        const refLng = gpsActive ? state.currentCoords.lng : state.districtCoords.lng;
        distance = getDistanceKm(refLat, refLng, expert.latitude, expert.longitude);
      } else {
        // Dropdown-only fallback: estimate from state/district string match
        if (state.selectedState === expert.state) {
          distance = state.selectedDistrict === expert.district ? 15 : 90;
        } else {
          distance = 420;
        }
      }

      // Relevance Scoring (used for sorting and matching quality)
      if (state.consultationTopic && isSpecializationMatch(expert.specialization, state.consultationTopic)) {
        relevanceScore += 50;
      } else if (state.problemCategory && expert.specialization.toLowerCase() === state.problemCategory.toLowerCase()) {
        relevanceScore += 50;
      }

      if (state.selectedDistrict && expert.district.toLowerCase() === state.selectedDistrict.toLowerCase()) {
        relevanceScore += 30;
      }

      if (state.selectedState && expert.state.toLowerCase() === state.selectedState.toLowerCase()) {
        relevanceScore += 15;
      }

      if (state.preferredLanguage && expert.languages.includes(state.preferredLanguage)) {
        relevanceScore += 20;
      }

      if (expert.availability === "Online") {
        relevanceScore += 25;
      } else if (expert.availability === "Available Tomorrow") {
        relevanceScore += 15;
      }

      relevanceScore += Math.min(20, expert.experience);
      relevanceScore += expert.rating * 6.0;

      return { ...expert, distance, relevanceScore: Math.round(relevanceScore) };
    });

    // 2. Filter out based on location vicinity
    let filtered = scored;

    if (gpsActive) {
      // Filter out experts not in vicinity (max 150 km)
      filtered = scored.filter(e => e.distance <= 150);
      
      // Self-healing fallback: if no expert is within 150 km, try 300 km
      if (filtered.length === 0) {
        filtered = scored.filter(e => e.distance <= 300);
      }
      // If still empty, show all experts in the nearest state
      if (filtered.length === 0 && stateSelect.value) {
        filtered = scored.filter(e => e.state.toLowerCase() === stateSelect.value.toLowerCase());
      }
    } else if (districtSelected) {
      // Filter strictly to that state + district
      filtered = scored.filter(e => 
        e.state.toLowerCase() === state.selectedState.toLowerCase() &&
        e.district.toLowerCase() === state.selectedDistrict.toLowerCase()
      );
    } else if (stateSelected) {
      // Filter strictly to that state
      filtered = scored.filter(e => 
        e.state.toLowerCase() === state.selectedState.toLowerCase()
      );
    }

    // 3. Sort the results
    if (gpsActive) {
      // GPS mode: sort primarily by distance (closest first), secondary by relevance score
      return filtered.sort((a, b) => {
        const distDiff = a.distance - b.distance;
        if (Math.abs(distDiff) > 5) return distDiff;
        return b.relevanceScore - a.relevanceScore;
      });
    } else {
      // Dropdown/Landing mode: sort by relevanceScore
      return filtered.sort((a, b) => b.relevanceScore - a.relevanceScore);
    }
  }

  // Render Consultant Cards
  function updateResults() {
    if (!expertsContainer) return;

    const ranked = rankConsultants();
    const totalCount = ranked.length;

    // Dynamically update section header based on active filter vicinity
    const resultsHeader = document.querySelector(".gs-results-header h2");
    if (resultsHeader) {
      if (state.currentCoords) {
        resultsHeader.textContent = "Local Experts (Within 150 km)";
      } else if (state.selectedDistrict) {
        resultsHeader.textContent = `Experts in ${state.selectedDistrict}`;
      } else if (state.selectedState) {
        resultsHeader.textContent = `Experts in ${state.selectedState}`;
      } else {
        resultsHeader.textContent = "All Onboarded Experts";
      }
    }

    resultsCount.textContent = `${totalCount} Expert${totalCount === 1 ? "" : "s"} Available`;

    // Paginate results to keep DOM operations lightweight and prevent page freezes
    const sliced = ranked.slice(0, state.visibleCount);

    if (sliced.length === 0) {
      expertsContainer.innerHTML = `
        <div class="gs-no-results" style="grid-column: 1 / -1; text-align: center; padding: 60px 24px; background: var(--surface); border-radius: var(--r-md); border: 1px dashed rgba(47,107,58,0.2);">
          <span style="font-size: 3.5rem;">🌾</span>
          <h3 style="margin-top: 16px; color: var(--brand-deep); font-size: 1.25rem;">No Experts Found in this Vicinity</h3>
          <p style="color: var(--ink-soft); margin-top: 8px; max-width: 440px; margin-left: auto; margin-right: auto; font-size: 0.95rem; line-height:1.5;">
            We couldn't find any onboarded experts within this immediate location. Try picking a different state/district or resetting the filters.
          </p>
        </div>
      `;
      return;
    }

    let cardsHtml = sliced.map((expert, idx) => {
      const distanceDisplay = expert.distance < 9000
        ? `${expert.distance.toFixed(1)} km away`
        : "Remote consultation available";

      const oStats = computeOutcomeStats(expert.id);
      const outcomeChip = oStats
        ? `<span class="gs-outcome-chip ${oStats.pct < 60 ? 'gs-outcome-chip--low' : ''}">🔁 ${oStats.pct}% of ${oStats.total} verified outcome${oStats.total === 1 ? '' : 's'} said it worked</span>`
        : '';
      const isComparing = state.compareIds.includes(String(expert.id));

      return `
        <article class="gs-card" style="animation-delay:${Math.min(idx, 8) * 45}ms;">
          <div class="gs-card__photo-container">
            <img src="${avatarFor(expert.name)}" alt="" class="gs-card__photo" loading="lazy">
            <span class="gs-card__badge-status ${getAvailabilityClass(expert.availability)}">
              ${expert.availability}
            </span>
          </div>

          <div class="gs-card__info">
            <div class="gs-card__rating">
              ${starSVG} ${expert.rating.toFixed(1)}
              <span class="gs-card__rating-text">(${expert.reviews} Reviews)</span>
            </div>
            <h3 class="gs-card__name">${esc(expert.name)}</h3>
            <span class="gs-card__qual">${esc(expert.qualification)}</span>
            ${outcomeChip}

            <div class="gs-card__meta-grid">
              <div class="gs-card__meta-item">
                ${distanceIcon}
                <span>${esc(expert.district)}, ${esc(expert.state)} (${distanceDisplay})</span>
              </div>
              <div class="gs-card__meta-item">
                ${langIcon}
                <span>Speaks: ${esc(expert.languages.join(", "))}</span>
              </div>
              <div class="gs-card__meta-item">
                ${visitsIcon}
                <span>${expert.visits.toLocaleString()} farm visits</span>
              </div>
              <div class="gs-card__meta-item">
                ${clockIcon}
                <span>Response time: ${esc(expert.responseTime)}</span>
              </div>
            </div>
          </div>

          <div class="gs-card__actions">
            <div class="gs-card__fee">
              <span class="gs-card__fee-val">₹${expert.consultationFee}</span>
              <div class="gs-card__fee-label">Consultation Fee</div>
            </div>
            <button class="btn-gs-primary btn-book" data-id="${expert.id}">Book Consultation</button>
            <button class="btn-gs-outline btn-view-profile" data-id="${expert.id}">View Profile</button>
            <button class="gs-compare-toggle btn-compare ${isComparing ? 'selected' : ''}" data-id="${expert.id}">⚖️ ${isComparing ? 'Comparing' : 'Compare'}</button>
          </div>
        </article>
      `;
    }).join("");

    // Append dynamic "Load More" controls if results exceed the current page size
    if (totalCount > state.visibleCount) {
      cardsHtml += `
        <div class="gs-load-more-container" style="grid-column: 1 / -1; text-align: center; margin-top: 40px; width: 100%; display: flex; justify-content: center;">
          <button id="btnLoadMore" class="btn-gs-outline" style="padding: 12px 36px; font-size: 0.9rem; font-weight: 600; border-radius: 999px; transition: all 0.3s ease;">
            Show More Experts (${totalCount - state.visibleCount} remaining)
          </button>
        </div>
      `;
    }

    expertsContainer.innerHTML = cardsHtml;

    // Re-bind click handlers for dynamically created buttons
    expertsContainer.querySelectorAll(".btn-view-profile").forEach(btn => {
      btn.addEventListener("click", () => openProfileModal(btn.dataset.id));
    });

    expertsContainer.querySelectorAll(".btn-book").forEach(btn => {
      btn.addEventListener("click", () => bookConsultation(btn.dataset.id));
    });

    expertsContainer.querySelectorAll(".btn-compare").forEach(btn => {
      btn.addEventListener("click", () => toggleCompare(btn.dataset.id));
    });

    const btnLoadMore = document.getElementById("btnLoadMore");
    if (btnLoadMore) {
      btnLoadMore.addEventListener("click", () => {
        state.visibleCount += 15;
        updateResults();
      });
    }

    renderHighStakesBanner();
    retranslate();
  }

  /* =========================================================================
     FEATURE 5 — Second-Opinion Safety Net
     -------------------------------------------------------------------------
     High-stakes categories (pesticide/chemical/infrastructure decisions) get
     a nudge toward comparing two independently-matched experts side by side
     before booking either — the same "don't rely on a single opinion for a
     costly, hard-to-reverse decision" principle telemedicine second-opinion
     programmes are built on, adapted here as a credential/track-record
     comparison rather than fabricated conflicting "advice text" (this app
     has no real two-way consultant chat to generate that from honestly).
     ========================================================================= */
  function renderHighStakesBanner() {
    if (!gsHighStakesBanner) return;
    const isHighStakes = HIGH_STAKES_CATEGORIES.has(state.problemCategory) || HIGH_STAKES_CATEGORIES.has(state.consultationTopic);
    if (!isHighStakes) { gsHighStakesBanner.innerHTML = ''; return; }
    gsHighStakesBanner.innerHTML = `
      <div class="gs-highstakes-banner">
        <span>⚠️ <strong>This looks like a high-stakes decision</strong> — advice here may lead to chemical use or a costly investment. Many farmers find it worth comparing two independent experts before committing.</span>
        <button type="button" class="gs-compare-toggle" id="gsHighStakesCompareCta">⚖️ Pick 2 to compare</button>
      </div>`;
    const cta = document.getElementById('gsHighStakesCompareCta');
    if (cta) cta.addEventListener('click', () => {
      expertsContainer.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
  }

  function toggleCompare(id) {
    const sid = String(id);
    const i = state.compareIds.indexOf(sid);
    if (i >= 0) {
      state.compareIds.splice(i, 1);
    } else {
      if (state.compareIds.length >= 2) state.compareIds.shift();
      state.compareIds.push(sid);
    }
    renderCompareBar();
    updateResults();
  }

  function renderCompareBar() {
    if (!gsCompareBar) return;
    const n = state.compareIds.length;
    const textEl = document.getElementById('gsCompareBarText');
    if (textEl) textEl.textContent = `Comparing ${n} expert${n === 1 ? '' : 's'}`;
    const viewBtn = document.getElementById('gsCompareViewBtn');
    if (viewBtn) viewBtn.disabled = n < 2;
    gsCompareBar.classList.toggle('open', n > 0);
  }

  function openCompareModal() {
    if (state.compareIds.length < 2 || !compareModal || !compareModalBody) return;
    const experts = state.compareIds.map((id) => CONSULTANTS.find((c) => c.id == id)).filter(Boolean);
    if (experts.length < 2) return;

    const rows = [
      ['Photo', (e) => `<div class="gs-compare-table__photo"><img src="${avatarFor(e.name)}" alt=""><strong>${esc(e.name)}</strong></div>`],
      ['Qualification', (e) => esc(e.qualification)],
      ['Specialization', (e) => esc(e.specialization)],
      ['Experience', (e) => `${e.experience} years`],
      ['Rating', (e) => `${e.rating.toFixed(1)} ★ (${e.reviews} reviews)`],
      ['Verified outcomes', (e) => { const s = computeOutcomeStats(e.id); return s ? `${s.pct}% of ${s.total} said it worked` : 'No outcomes logged yet'; }],
      ['Consultation fee', (e) => `₹${e.consultationFee}`],
      ['Availability', (e) => esc(e.availability)],
      ['Response time', (e) => esc(e.responseTime)],
      ['Languages', (e) => esc(e.languages.join(', '))],
      ['Serving', (e) => `${esc(e.district)}, ${esc(e.state)}`],
    ];

    compareModalBody.innerHTML = `
      <p style="font-size:.85rem;color:var(--ink-soft);margin-bottom:12px;">Comparing credentials and track record side by side — useful before committing to advice on a costly or irreversible decision.</p>
      <div style="overflow-x:auto;">
        <table class="gs-compare-table">
          ${rows.map(([label, fn]) => `<tr><th>${esc(label)}</th>${experts.map((e) => `<td>${fn(e)}</td>`).join('')}</tr>`).join('')}
          <tr><th></th>${experts.map((e) => `<td><button class="btn-gs-primary btn-compare-book" data-id="${e.id}" style="width:100%;">Book This One</button></td>`).join('')}</tr>
        </table>
      </div>
      <button type="button" class="btn-gs-outline" id="gsBookBothBtn" style="width:100%;margin-top:14px;">⚖️ Book Both as a Second Opinion</button>`;

    compareModalBody.querySelectorAll('.btn-compare-book').forEach((btn) => {
      btn.addEventListener('click', () => { closeCompareModal(); bookConsultation(btn.dataset.id); });
    });
    document.getElementById('gsBookBothBtn')?.addEventListener('click', () => {
      closeCompareModal();
      bookBothForSecondOpinion();
    });

    compareModal.classList.add('open');
    document.body.style.overflow = 'hidden';
    retranslate();
    openModalA11y(compareModal.querySelector('.gs-modal__content'), closeCompareModal);
  }

  function closeCompareModal() {
    if (compareModal) {
      compareModal.classList.remove('open');
      document.body.style.overflow = '';
      closeModalA11y(compareModal.querySelector('.gs-modal__content'));
    }
  }

  // Profile Modal Renderer
  function openProfileModal(id) {
    const expert = CONSULTANTS.find(e => e.id == id);
    if (!expert || !modal || !modalBody) return;
    const titleEl = modal.querySelector('.gs-modal__header h2');
    if (titleEl) titleEl.textContent = 'Expert Profile';

    const star5 = Math.round(expert.reviews * 0.75);
    const star4 = Math.round(expert.reviews * 0.18);
    const star3 = Math.round(expert.reviews * 0.05);
    const star2 = Math.round(expert.reviews * 0.01);
    const star1 = expert.reviews - (star5 + star4 + star3 + star2);

    const getPercent = (val) => Math.round((val / expert.reviews) * 100);

    const oStats = computeOutcomeStats(expert.id);
    const testimonials = getTestimonialsFor(expert.id).slice(0, 4);
    // Outcome tone comes from a tinted ground plus a hairline in the same hue,
    // the convention the rest of the app uses -- not the 4px left bar this
    // carried, which the design system bans as decoration rather than signal.
    // The old amber/red were hardcoded literals off the palette; --danger takes
    // the same fallback used everywhere else, since it is only defined for the
    // dark theme. All three tints invert with the theme on their own.
    const OUTCOME_TONE = {
      'Advice worked':    { bg: 'var(--brand-soft)',            line: 'var(--brand)' },
      'Partially helped': { bg: 'var(--accent-soft)',           line: 'var(--accent)' },
    };
    const toneFor = (outcome) => OUTCOME_TONE[outcome] ||
      { bg: 'var(--danger-soft, #fce4e4)', line: 'var(--danger, #d14444)' };

    const outcomesHtml = testimonials.length
      ? testimonials.map((t) => `
        <div style="background: ${toneFor(t.outcome).bg}; border: 1px solid ${toneFor(t.outcome).line}; border-color: color-mix(in srgb, ${toneFor(t.outcome).line} 35%, transparent); padding: 12px 16px; border-radius: var(--r-sm); margin-bottom:10px;">
          <div style="display:flex;justify-content:space-between;gap:8px;font-size:.78rem;color:var(--ink-soft);margin-bottom:4px;">
            <span>${esc(t.farmerLabel)}${t.source === 'demo' ? ' · <em>demo example</em>' : ' · self-reported on this device'}</span>
            <strong style="color:var(--brand-deep);">${esc(t.outcome)}</strong>
          </div>
          <p style="font-size:0.9rem;color:var(--ink-soft);font-style:italic;">"${esc(t.quote)}"</p>
          <div style="font-size:.76rem;color:var(--ink-soft);margin-top:4px;">${esc(t.crop)} · ${esc(t.problem)}</div>
        </div>`).join('')
      : `<p style="font-size:0.88rem;color:var(--ink-soft);font-style:italic;">No outcomes logged for this expert yet — book a consultation and be the first to report how it went.</p>`;

    modalBody.innerHTML = `
      <div class="gs-modal-profile">
        <img src="${avatarFor(expert.name)}" alt="" class="gs-modal-profile__photo">
        <div class="gs-modal-profile__info">
          <h3>${esc(expert.name)}</h3>
          <p><strong>${esc(expert.qualification)}</strong></p>
          <p>${expert.experience} Years of Field Experience · ${expert.visits.toLocaleString()} Visits</p>
          <div class="gs-card__rating" style="margin-top:8px;">
            ${starSVG} ${expert.rating.toFixed(1)}
            <span class="gs-card__rating-text">(${expert.reviews} Reviews)</span>
          </div>
        </div>
      </div>

      <div class="gs-modal-section-title">Biography</div>
      <p style="font-size:0.92rem; color:var(--ink-soft); line-height:1.6;">${esc(expert.bio)}</p>

      <div class="gs-modal-section-title">Education & Credentials</div>
      <p style="font-size:0.92rem; color:var(--ink-soft); margin-bottom:8px;">🎓 <strong>${esc(expert.education)}</strong></p>

      <div class="gs-modal-section-title">Certifications</div>
      <div class="gs-tag-container">
        ${expert.certifications.map(c => `<span class="gs-tag">✓ ${esc(c)}</span>`).join("")}
      </div>

      <div class="gs-modal-section-title">Specialization & Coverage</div>
      <p style="font-size:0.92rem; color:var(--ink-soft); margin-bottom:4px;">📍 <strong>Serving districts:</strong> ${esc(expert.district)}, and surrounding locations in ${esc(expert.state)}.</p>
      <p style="font-size:0.92rem; color:var(--ink-soft);">🌾 <strong>Primary Focus:</strong> ${esc(expert.specialization)}</p>

      <div class="gs-modal-section-title">Languages Spoken</div>
      <div class="gs-tag-container">
        ${expert.languages.map(l => `<span class="gs-tag" style="background:var(--accent-soft); color:var(--accent);">${esc(l)}</span>`).join("")}
      </div>

      <div class="gs-modal-section-title">🔁 Verified Outcomes</div>
      ${oStats ? `<p style="font-size:0.88rem;color:var(--ink-soft);margin-bottom:10px;"><strong style="color:var(--brand-deep);">${oStats.pct}%</strong> of ${oStats.total} logged outcome${oStats.total === 1 ? '' : 's'} said this expert's advice worked. These are self-reported by farmers after their consultation — not a rating given at booking time.</p>` : ''}
      ${outcomesHtml}

      <div class="gs-modal-section-title">Rating Distribution</div>
      <div class="gs-rating-dist">
        <div class="gs-dist-bar">
          <span class="gs-dist-bar__lbl">5 stars</span>
          <div class="gs-dist-bar__track"><div class="gs-dist-bar__fill" style="width: ${getPercent(star5)}%"></div></div>
          <span class="gs-dist-bar__val">${getPercent(star5)}%</span>
        </div>
        <div class="gs-dist-bar">
          <span class="gs-dist-bar__lbl">4 stars</span>
          <div class="gs-dist-bar__track"><div class="gs-dist-bar__fill" style="width: ${getPercent(star4)}%"></div></div>
          <span class="gs-dist-bar__val">${getPercent(star4)}%</span>
        </div>
        <div class="gs-dist-bar">
          <span class="gs-dist-bar__lbl">3 stars</span>
          <div class="gs-dist-bar__track"><div class="gs-dist-bar__fill" style="width: ${getPercent(star3)}%"></div></div>
          <span class="gs-dist-bar__val">${getPercent(star3)}%</span>
        </div>
        <div class="gs-dist-bar">
          <span class="gs-dist-bar__lbl">2 stars</span>
          <div class="gs-dist-bar__track"><div class="gs-dist-bar__fill" style="width: ${getPercent(star2)}%"></div></div>
          <span class="gs-dist-bar__val">${getPercent(star2)}%</span>
        </div>
        <div class="gs-dist-bar">
          <span class="gs-dist-bar__lbl">1 star</span>
          <div class="gs-dist-bar__track"><div class="gs-dist-bar__fill" style="width: ${getPercent(star1)}%"></div></div>
          <span class="gs-dist-bar__val">${getPercent(star1)}%</span>
        </div>
      </div>
    `;

    modal.classList.add("open");
    document.body.style.overflow = "hidden";
    retranslate();
    openModalA11y(modal.querySelector('.gs-modal__content'), closeModal);
  }

  function closeModal() {
    if (modal) {
      modal.classList.remove("open");
      document.body.style.overflow = "";
      closeModalA11y(modal.querySelector('.gs-modal__content'));
    }
  }

  [modalClose, modalBackdrop].forEach(el => {
    el?.addEventListener("click", closeModal);
  });

  document.getElementById('gsCompareViewBtn')?.addEventListener('click', openCompareModal);
  document.getElementById('gsCompareClearBtn')?.addEventListener('click', () => {
    state.compareIds = [];
    renderCompareBar();
    updateResults();
  });
  document.getElementById('compareModalClose')?.addEventListener('click', closeCompareModal);
  document.getElementById('compareModalBackdrop')?.addEventListener('click', closeCompareModal);

  // Booking Flow & Estimation Summary
  function computeBookingEstimate(expert) {
    let arrivalDate = "Tomorrow";
    let arrivalTime = "10:30 AM";
    let estDuration = "1 hour 15 minutes";
    let estDistance = 18.5;

    if (state.districtCoords && expert.latitude && expert.longitude) {
      estDistance = getDistanceKm(state.districtCoords.lat, state.districtCoords.lng, expert.latitude, expert.longitude);
    }

    if (expert.availability === "Online") {
      arrivalDate = "Today (Instant)";
      arrivalTime = "Expected within 15 mins";
      estDuration = "30-45 minutes (Video/Call)";
      estDistance = 0.0;
    } else {
      const travelHrs = estDistance / 40;
      if (travelHrs > 4) arrivalTime = "03:30 PM";
      else if (travelHrs > 2) arrivalTime = "01:00 PM";
      else arrivalTime = "10:30 AM";
    }
    return { arrivalDate, arrivalTime, estDuration, estDistance };
  }

  // Second-Opinion Safety Net — bookings created together carry the same
  // secondOpinionGroupId so "My Consultations" can pair them up and, once
  // both outcomes are logged, show what each expert's advice actually led to.
  function createBooking(expert, groupId) {
    const stateVal = stateSelect.value || "Not specified";
    const districtVal = districtSelect.value || "Not specified";
    const villageVal = document.getElementById("farmerVillage")?.value || "";
    const focusVal = topicSelect?.value || "General Guidance";
    const farmSizeVal = document.getElementById("farmSize")?.value || "2.0";
    const probCategoryVal = categorySelect?.value || "General Query";
    const problemDescVal = problemDescText?.value.trim() || "";
    const highStakes = HIGH_STAKES_CATEGORIES.has(probCategoryVal) || HIGH_STAKES_CATEGORIES.has(focusVal);

    const booking = {
      id: newId('bkg'), expertId: expert.id, expertName: expert.name,
      topic: focusVal, problemCategory: probCategoryVal, farmSize: farmSizeVal,
      state: stateVal, district: districtVal, village: villageVal,
      fee: expert.consultationFee, bookedAt: new Date().toISOString(),
      problemDescription: problemDescVal,
      highStakes, outcomeLogged: false,
      secondOpinionGroupId: groupId || null,
    };
    const bookings = getMyBookings();
    bookings.unshift(booking);
    saveMyBookings(bookings);
    return booking;
  }

  function bookConsultation(id) {
    const expert = CONSULTANTS.find(e => e.id == id);
    if (!expert || !bookingSummaryPlaceholder) return;

    const booking = createBooking(expert, null);
    const { arrivalDate, arrivalTime, estDuration, estDistance } = computeBookingEstimate(expert);
    const focusVal = booking.topic;
    const probCategoryVal = booking.problemCategory;
    const farmSizeVal = booking.farmSize;
    const districtVal = booking.district;
    const stateVal = booking.state;
    const villageVal = booking.village;
    const problemDescVal = booking.problemDescription;
    const highStakes = booking.highStakes;

    bookingSummaryPlaceholder.innerHTML = `
      <div class="gs-booking-card">
        <div class="gs-success-banner">
          ${checkSVG}
          <span>Your consultation request has been received. The expert will confirm shortly.</span>
        </div>
        ${highStakes ? `
        <div class="gs-highstakes-banner" style="margin-bottom:16px;">
          <span>⚠️ This touches a high-stakes category (chemical use / costly investment). Consider a <strong>second opinion</strong> from an independently-matched expert before you commit.</span>
          <button type="button" class="gs-compare-toggle" id="gsBookingSecondOpinionCta">⚖️ Find a second opinion</button>
        </div>` : ''}

        <h3 style="color:var(--brand-deep); margin-bottom:16px; border-bottom:1px solid rgba(47,107,58,0.1); padding-bottom:8px;">
          📝 Consultation Booking Summary
        </h3>

        <div class="gs-booking-details">
          <div class="gs-booking-item">
            <span class="gs-booking-label">Farmer Profile</span>
            <span class="gs-booking-value">Kisan (Land size: ${farmSizeVal} acres)</span>
          </div>
          <div class="gs-booking-item">
            <span class="gs-booking-label">Location</span>
            <span class="gs-booking-value">
              ${villageVal ? esc(villageVal) + ", " : ""}${esc(districtVal)}, ${esc(stateVal)}
            </span>
          </div>
          <div class="gs-booking-item">
            <span class="gs-booking-label">Selected Expert</span>
            <span class="gs-booking-value">${esc(expert.name)} (${esc(expert.qualification)})</span>
          </div>
          <div class="gs-booking-item">
            <span class="gs-booking-label">Farming Focus / Selected Issue</span>
            <span class="gs-booking-value">${focusVal} · ${probCategoryVal}</span>
          </div>
          ${problemDescVal ? `
          <div class="gs-booking-item" style="grid-column: span 2;">
            <span class="gs-booking-label">Your Description</span>
            <span class="gs-booking-value" style="font-weight:500;font-size:.85rem;">${esc(problemDescVal)}</span>
          </div>` : ''}
          <div class="gs-booking-item">
            <span class="gs-booking-label">Consultation Fee</span>
            <span class="gs-booking-value" style="color:var(--brand); font-size:1.1rem;">
              ₹${expert.consultationFee}
            </span>
          </div>
          <div class="gs-booking-item">
            <span class="gs-booking-label">Travel Distance</span>
            <span class="gs-booking-value">${estDistance > 0 ? estDistance.toFixed(1) + ' km' : '0 km (Remote)'}</span>
          </div>
        </div>

        <div class="gs-booking-estimate-grid">
          <div class="gs-booking-item">
            <span class="gs-booking-label">📅 Estimated Visit Date</span>
            <span class="gs-booking-value" style="color:var(--brand-deep);">${arrivalDate}</span>
          </div>
          <div class="gs-booking-item">
            <span class="gs-booking-label">⏰ Expected Arrival Time</span>
            <span class="gs-booking-value" style="color:var(--brand-deep);">${arrivalTime}</span>
          </div>
          <div class="gs-booking-item" style="grid-column: span 2; border-top:1px dashed rgba(47,107,58,0.1); padding-top:8px; margin-top:4px;">
            <span class="gs-booking-label">Estimated Consultation Duration</span>
            <span class="gs-booking-value">${estDuration}</span>
          </div>
        </div>
      </div>
    `;

    bookingSummaryPlaceholder.scrollIntoView({ behavior: "smooth", block: "start" });

    document.getElementById('gsBookingSecondOpinionCta')?.addEventListener('click', () => {
      state.compareIds = [String(expert.id)];
      renderCompareBar();
      expertsContainer.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });

    renderMyBookingsPanel();
    updateResults();
  }

  function bookBothForSecondOpinion() {
    if (state.compareIds.length < 2 || !bookingSummaryPlaceholder) return;
    const experts = state.compareIds.slice(0, 2).map((id) => CONSULTANTS.find((c) => c.id == id)).filter(Boolean);
    if (experts.length < 2) return;

    const groupId = newId('sog');
    const booked = experts.map((e) => ({ expert: e, booking: createBooking(e, groupId), est: computeBookingEstimate(e) }));

    bookingSummaryPlaceholder.innerHTML = `
      <div class="gs-booking-card">
        <div class="gs-success-banner">
          ${checkSVG}
          <span>Both consultation requests have been received — tracked together as a second-opinion pair.</span>
        </div>
        <h3 style="color:var(--brand-deep); margin-bottom:16px; border-bottom:1px solid rgba(47,107,58,0.1); padding-bottom:8px;">
          ⚖️ Second Opinion — 2 Experts Booked
        </h3>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px;">
          ${booked.map(({ expert: e, est }) => `
            <div style="background:var(--gs-green-light);border-radius:var(--r-md);padding:14px;">
              <div class="gs-booking-item"><span class="gs-booking-label">Expert</span><span class="gs-booking-value">${esc(e.name)}</span></div>
              <div class="gs-booking-item" style="margin-top:8px;"><span class="gs-booking-label">Fee</span><span class="gs-booking-value">₹${e.consultationFee}</span></div>
              <div class="gs-booking-item" style="margin-top:8px;"><span class="gs-booking-label">Expected</span><span class="gs-booking-value">${esc(est.arrivalDate)} · ${esc(est.arrivalTime)}</span></div>
            </div>`).join('')}
        </div>
        <p style="font-size:.82rem;color:var(--ink-soft);margin-top:14px;">Once you log an outcome for both under "My Consultations", you'll see a side-by-side result of what each expert's advice actually led to.</p>
      </div>`;
    bookingSummaryPlaceholder.scrollIntoView({ behavior: "smooth", block: "start" });

    state.compareIds = [];
    renderCompareBar();
    renderMyBookingsPanel();
    updateResults();
  }

  /* =========================================================================
     FEATURE 1 — Verified Outcomes ("My Consultations" panel)
     -------------------------------------------------------------------------
     Every booking made on this device is listed here with a self-report
     "how did it go?" action. There is no real backend to notify a farmer
     days later, so — same as Marketplace's "Simulate (Demo)" actions — the
     outcome can be logged any time right after booking; it is always
     labeled as self-reported, never presented as an independently verified
     fact.
     ========================================================================= */
  function outcomeLabel(v) {
    return v === 'yes' ? 'Advice worked' : v === 'partial' ? 'Partially helped' : "Didn't help";
  }

  /* =========================================================================
     FEATURE — Consultation Prep Sheet
     -------------------------------------------------------------------------
     Bundles whatever real data this session already has — saved farm
     boundary, the last real /api/field/ndvi read, the last real AI leaf
     scan — with the booking's own problem description into one summary the
     farmer can send an expert before the call, instead of re-explaining
     symptoms verbally. Missing pieces are stated as missing, never guessed.
     ========================================================================= */
  function buildPrepSheetText(booking) {
    const lines = [];
    lines.push('MittiMantra — Consultation Prep Sheet');
    lines.push('');
    lines.push(`For: ${booking.expertName}`);
    lines.push(`Topic: ${booking.topic} · ${booking.problemCategory}`);
    if (booking.problemDescription) lines.push(`Farmer's description: ${booking.problemDescription}`);
    const loc = [booking.village, booking.district, booking.state].filter(Boolean).join(', ');
    if (loc) lines.push(`Location: ${loc}`);
    lines.push(`Farm size: ${booking.farmSize} acres`);
    lines.push('');

    if (lastFieldHealth && lastFarm) {
      lines.push(`Field Health (satellite estimate, "${lastFarm.name || 'saved farm'}"): ${lastFieldHealth.health_status}`);
      lines.push(`  NDVI ${Number(lastFieldHealth.mean_ndvi).toFixed(2)} · canopy cover ${Math.round(lastFieldHealth.canopy_cover_pct)}%`);
    } else {
      lines.push('Field Health: not available (no farm boundary saved yet, or not checked this session)');
    }
    lines.push('');

    if (lastScanResult) {
      lines.push(`AI Leaf Scan (preliminary screen, not a diagnosis): ${lastScanResult.disease}`);
      lines.push(`  Confidence ${Math.round((lastScanResult.confidence || 0) * 100)}% · Severity ${lastScanResult.severity || '—'}`);
    } else {
      lines.push('AI Leaf Scan: not run this session');
    }
    lines.push('');
    lines.push('Generated with MittiMantra.');
    return lines.join('\n');
  }

  function openPrepSheetModal(bookingId) {
    const booking = getMyBookings().find((b) => b.id === bookingId);
    if (!booking || !modal || !modalBody) return;
    const text = buildPrepSheetText(booking);
    const titleEl = modal.querySelector('.gs-modal__header h2');
    if (titleEl) titleEl.textContent = '📄 Consultation Prep Sheet';

    modalBody.innerHTML = `
      <p style="font-size:.85rem;color:var(--ink-soft);margin-bottom:14px;">Send this to <strong>${esc(booking.expertName)}</strong> before your consultation so it starts with real context instead of you re-explaining everything on the call.</p>
      <pre style="white-space:pre-wrap;background:var(--gs-green-light);border-radius:var(--r-md);padding:16px;font-family:inherit;font-size:.85rem;color:var(--ink);line-height:1.6;">${esc(text)}</pre>
      <div style="display:flex;gap:10px;margin-top:16px;flex-wrap:wrap;">
        <button type="button" class="btn-gs-primary" id="gsPrepShareBtn" style="flex:1;">💬 Share via WhatsApp</button>
        <button type="button" class="btn-gs-outline" id="gsPrepCopyBtn" style="flex:1;">📋 Copy Text</button>
      </div>`;

    document.getElementById('gsPrepShareBtn')?.addEventListener('click', () => {
      if (window.MM && window.MM.share) window.MM.share.whatsapp(text);
    });
    document.getElementById('gsPrepCopyBtn')?.addEventListener('click', () => {
      if (navigator.clipboard) {
        navigator.clipboard.writeText(text).then(() => { if (window.MM && window.MM.toast) window.MM.toast('Copied to clipboard'); });
      }
    });

    modal.classList.add('open');
    document.body.style.overflow = 'hidden';
    retranslate();
    openModalA11y(modal.querySelector('.gs-modal__content'), closeModal);
  }

  /* =========================================================================
     FEATURE — Voice-first outcome logging
     -------------------------------------------------------------------------
     Same Web Speech API pattern already proven in Marketplace's voice-first
     listing creation: optional, Chrome-family only, follows whatever
     language the rest of the site is set to, and always leaves the typed
     path as the fallback. Speaking auto-fills the note and best-guesses
     which outcome chip to select — the farmer can always correct it before
     submitting.
     ========================================================================= */
  function speechLocaleFor(lang) {
    return { en: 'en-IN', hi: 'hi-IN', te: 'te-IN', kn: 'kn-IN', ta: 'ta-IN' }[lang] || 'en-IN';
  }

  function parseOutcomeTranscript(transcript) {
    const s = String(transcript || '').toLowerCase();
    if (/\b(didn'?t|did not|no help|not work|failed|useless|nahi|nahin|kaam nahi)\b/.test(s)) return 'no';
    if (/\b(partial|some|a little|thoda|kuch had tak|somewhat|not fully)\b/.test(s)) return 'partial';
    if (/\b(worked|helped|great|good|solved|fixed|recovered|sahi|theek|accha|kaam kiya)\b/.test(s)) return 'yes';
    return null;
  }

  function bookingRowHtml(b) {
    return `
      <div class="gs-booking-row" data-booking-id="${esc(b.id)}">
        <div class="gs-booking-row__info">
          <div class="gs-booking-row__expert">${esc(b.expertName)}</div>
          <div class="gs-booking-row__meta">${esc(b.topic)} · ${esc(b.problemCategory)} · booked ${new Date(b.bookedAt).toLocaleDateString('en-IN')}</div>
        </div>
        ${b.highStakes ? '<span class="gs-booking-row__tag gs-booking-row__tag--stakes">High-stakes</span>' : ''}
        <button type="button" class="btn-gs-outline btn-prep-sheet" data-booking-id="${esc(b.id)}" style="padding:6px 14px;font-size:.78rem;">📄 Prep Sheet</button>
        ${b.outcomeLogged
          ? '<span class="gs-booking-row__tag gs-booking-row__tag--done">✓ Outcome logged</span>'
          : `<button type="button" class="btn-gs-outline btn-log-outcome" data-booking-id="${esc(b.id)}" style="padding:6px 14px;font-size:.78rem;">📋 Log the Outcome</button>`}
        <div class="gs-outcome-inline" id="gsOutcomeForm_${esc(b.id)}">
          <div class="gs-outcome-inline__choices">
            <button type="button" class="gs-outcome-choice" data-val="yes" aria-pressed="false">✅ Worked</button>
            <button type="button" class="gs-outcome-choice" data-val="partial" aria-pressed="false">🟡 Partially helped</button>
            <button type="button" class="gs-outcome-choice" data-val="no" aria-pressed="false">❌ Didn't help</button>
          </div>
          <button type="button" class="gs-outcome-mic" id="gsVoiceOutcome_${esc(b.id)}" title="Speak your outcome instead of typing" style="display:none;"></button>
          <textarea class="gs-textarea" placeholder="Optional — what happened? (helps other farmers)" rows="2" style="min-height:60px;"></textarea>
          <button type="button" class="btn-gs-primary btn-submit-outcome" data-booking-id="${esc(b.id)}" style="margin-top:10px;" disabled>Submit Outcome</button>
        </div>
      </div>`;
  }

  function secondOpinionComparisonHtml(pair) {
    if (pair.length < 2 || !pair.every((b) => b.outcomeLogged)) return '';
    const outcomes = getMyOutcomes();
    const rows = pair.map((b) => ({ booking: b, outcome: outcomes.find((o) => o.bookingId === b.id) }));
    if (rows.some((r) => !r.outcome)) return '';
    return `
      <div style="background:var(--gs-green-light);border-radius:var(--r-md);padding:12px 14px;margin-top:4px;">
        <div style="font-weight:700;color:var(--brand-deep);font-size:.82rem;margin-bottom:6px;">🔁 Your Second Opinion Result</div>
        ${rows.map(({ booking, outcome }) => `
          <div style="font-size:.82rem;color:var(--ink-soft);padding:3px 0;">
            <strong style="color:var(--ink);">${esc(booking.expertName)}</strong>: ${esc(outcomeLabel(outcome.worked))}${outcome.note ? ` — "${esc(outcome.note)}"` : ''}
          </div>`).join('')}
      </div>`;
  }

  function renderMyBookingsPanel() {
    if (!gsMyBookingsPanel) return;
    const bookings = getMyBookings();
    if (!bookings.length) { gsMyBookingsPanel.innerHTML = ''; return; }

    // Group on the FULL list first (not a sliced window) so a second-opinion
    // pair is never split across the display cap below — a pair created a
    // while ago must stay paired even once other bookings push it deeper.
    const seenGroups = new Set();
    const items = [];
    bookings.forEach((b) => {
      if (b.secondOpinionGroupId) {
        if (seenGroups.has(b.secondOpinionGroupId)) return;
        seenGroups.add(b.secondOpinionGroupId);
        items.push({ type: 'pair', bookings: bookings.filter((x) => x.secondOpinionGroupId === b.secondOpinionGroupId) });
      } else {
        items.push({ type: 'solo', booking: b });
      }
    });
    const shownItems = items.slice(0, 8);

    gsMyBookingsPanel.innerHTML = `
      <div class="gs-bookings-panel">
        <div class="gs-bookings-panel__head">📂 My Consultations <span class="gs-results-count">${bookings.length}</span></div>
        ${shownItems.map((item) => item.type === 'solo' ? bookingRowHtml(item.booking) : `
          <div style="border:1.5px dashed rgba(47,107,58,0.3);border-radius:var(--r-md);padding:4px 14px 12px;margin:10px 0;">
            <div style="font-size:.7rem;font-weight:700;text-transform:uppercase;letter-spacing:.04em;color:var(--brand);padding-top:8px;">⚖️ Second Opinion Pair</div>
            ${item.bookings.map(bookingRowHtml).join('')}
            ${secondOpinionComparisonHtml(item.bookings)}
          </div>`).join('')}
      </div>`;

    gsMyBookingsPanel.querySelectorAll('.btn-log-outcome').forEach((btn) => {
      btn.addEventListener('click', () => {
        document.getElementById(`gsOutcomeForm_${btn.dataset.bookingId}`)?.classList.toggle('open');
      });
    });

    gsMyBookingsPanel.querySelectorAll('.btn-prep-sheet').forEach((btn) => {
      btn.addEventListener('click', () => openPrepSheetModal(btn.dataset.bookingId));
    });

    gsMyBookingsPanel.querySelectorAll('.gs-booking-row').forEach((row) => {
      let selected = null;
      const submitBtn = row.querySelector('.btn-submit-outcome');
      row.querySelectorAll('.gs-outcome-choice').forEach((chip) => {
        chip.addEventListener('click', () => {
          row.querySelectorAll('.gs-outcome-choice').forEach((c) => { c.classList.remove('selected'); c.setAttribute('aria-pressed', 'false'); });
          chip.classList.add('selected');
          chip.setAttribute('aria-pressed', 'true');
          selected = chip.dataset.val;
          if (submitBtn) submitBtn.disabled = false;
        });
      });

      const micBtn = row.querySelector('.gs-outcome-mic');
      const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
      if (micBtn && SR) {
        micBtn.style.display = '';
        micBtn.textContent = '🎤';
        micBtn.title = 'Speak your outcome instead of typing';
        micBtn.addEventListener('click', () => {
          const recognition = new SR();
          recognition.lang = speechLocaleFor(window.AgriSimI18n ? window.AgriSimI18n.getLanguage() : 'en');
          recognition.interimResults = false;
          recognition.maxAlternatives = 1;
          recognition.onstart = () => { micBtn.classList.add('listening'); micBtn.textContent = '🔴'; };
          recognition.onresult = (ev) => {
            const transcript = ev.results[0][0].transcript;
            const textarea = row.querySelector('textarea');
            if (textarea) textarea.value = transcript;
            const guess = parseOutcomeTranscript(transcript);
            if (guess) row.querySelector(`.gs-outcome-choice[data-val="${guess}"]`)?.click();
          };
          recognition.onend = () => { micBtn.classList.remove('listening'); micBtn.textContent = '🎤'; };
          try { recognition.start(); } catch (_) { micBtn.classList.remove('listening'); }
        });
      }

      if (submitBtn) {
        submitBtn.addEventListener('click', () => {
          if (!selected) return;
          const bookingId = submitBtn.dataset.bookingId;
          const booking = getMyBookings().find((b) => b.id === bookingId);
          if (!booking) return;
          const note = row.querySelector('textarea')?.value.trim() || '';

          const outcome = {
            id: newId('out'), bookingId, expertId: booking.expertId,
            worked: selected, note, cropName: booking.topic, loggedAt: new Date().toISOString(), source: 'device',
          };
          const outcomes = getMyOutcomes();
          outcomes.unshift(outcome);
          saveMyOutcomes(outcomes);

          if (note) {
            const testimonials = getMyTestimonials();
            testimonials.unshift({
              id: newId('test'), outcomeId: outcome.id, expertId: booking.expertId,
              farmerLabel: `A farmer in ${booking.district || booking.state || 'your area'}`,
              quote: note, crop: booking.topic, problem: booking.problemCategory,
              outcome: outcomeLabel(selected), loggedAt: outcome.loggedAt, source: 'device',
            });
            saveMyTestimonials(testimonials);
          }

          const bookings = getMyBookings().map((b) => (b.id === bookingId ? { ...b, outcomeLogged: true } : b));
          saveMyBookings(bookings);

          renderMyBookingsPanel();
          renderVerifiedTestimonials();
          updateResults();
        });
      }
    });

    retranslate();
  }

  function renderVerifiedTestimonials() {
    if (!gsVerifiedTestimonials || !gsVerifiedSection) return;
    const all = DEMO_TESTIMONIALS.concat(getMyTestimonials())
      .sort((a, b) => new Date(b.loggedAt) - new Date(a.loggedAt))
      .slice(0, 6);
    if (!all.length) { gsVerifiedSection.style.display = 'none'; return; }
    gsVerifiedSection.style.display = '';
    gsVerifiedTestimonials.innerHTML = all.map((t) => {
      const expert = CONSULTANTS.find((c) => c.id == t.expertId);
      return `
      <article class="gs-testimonial-card gs-testimonial-card--verified">
        <span class="gs-testimonial-ribbon ${t.source === 'demo' ? 'gs-testimonial-ribbon--demo' : ''}">${t.source === 'demo' ? 'Demo example' : 'Verified · self-reported'}</span>
        <div class="gs-testimonial-card__header">
          <img src="${avatarFor(expert ? expert.name : '')}" alt="" class="gs-testimonial-card__img">
          <div class="gs-testimonial-card__meta">
            <strong>${esc(t.farmerLabel)}</strong>
            <span>Consulted ${esc(expert ? expert.name : 'an expert')}</span>
          </div>
        </div>
        <p class="gs-testimonial-card__quote">"${esc(t.quote)}"</p>
        <div class="gs-testimonial-card__details">
          <div class="gs-testimonial-card__detail-row"><span>Crop</span><strong>${esc(t.crop)}</strong></div>
          <div class="gs-testimonial-card__detail-row"><span>Problem</span><strong>${esc(t.problem)}</strong></div>
          <div class="gs-testimonial-card__detail-row"><span>Outcome</span><strong>${esc(t.outcome)}</strong></div>
        </div>
      </article>`;
    }).join('');
    retranslate();
  }

  /* =========================================================================
     FEATURE 3 — Proactive Field-Health Alert
     -------------------------------------------------------------------------
     Reuses the same real /api/field/ndvi satellite-vegetation endpoint the
     Marketplace's Verified Field Health feature already calls, keyed off
     the farmer's own saved farm boundary (window.FarmState). This flips
     Gyan Seva from purely reactive (farmer has to think to ask) to
     proactive — the research gap this feature set was built to close.
     ========================================================================= */
  async function fetchFieldHealth(lat, lon, cropId, areaAcres) {
    if (typeof lat !== 'number' || typeof lon !== 'number') return null;
    try {
      const res = await fetch('/api/field/ndvi', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ lat, lon, crop_id: cropId || 'wheat', area_acres: areaAcres || 4 }),
      });
      return res.ok ? await res.json() : null;
    } catch (_) { return null; }
  }

  function renderFieldHealthBanner(fh, farm) {
    if (!gsFieldHealthBanner) return;

    if (!farm) {
      gsFieldHealthBanner.innerHTML = `
        <div class="gs-alert-banner gs-alert-banner--info">
          <div class="gs-alert-banner__icon">🛰️</div>
          <div class="gs-alert-banner__body">
            <div class="gs-alert-banner__title">Unlock Proactive Field Health Alerts</div>
            <div class="gs-alert-banner__text">Draw your farm boundary once and this page will watch your field's satellite health automatically — instead of waiting for you to notice something's wrong.</div>
          </div>
          <div class="gs-alert-banner__actions">
            <a href="farm-boundary.html" class="btn-gs-primary">Draw My Farm</a>
          </div>
        </div>`;
      retranslate();
      return;
    }

    if (!fh) {
      gsFieldHealthBanner.innerHTML = `
        <div class="gs-alert-banner gs-alert-banner--info">
          <div class="gs-alert-banner__icon">🛰️</div>
          <div class="gs-alert-banner__body">
            <div class="gs-alert-banner__title">Field Health check unavailable right now</div>
            <div class="gs-alert-banner__text">Couldn't reach the field-health service for "${esc(farm.name || 'your farm')}" — this is usually temporary. Try refreshing the page in a moment.</div>
          </div>
        </div>`;
      retranslate();
      return;
    }

    lastFieldHealth = fh;
    lastFarm = farm;

    const s = String(fh.health_status || '');
    const tier = /high stress/i.test(s) ? 'poor' : /moderate/i.test(s) ? 'moderate' : /vibrant|healthy/i.test(s) ? 'good' : 'moderate';
    const catFor = { poor: 'Pest attack', moderate: 'Soil testing' };
    const farmName = farm.name || 'Your farm';

    if (tier === 'good') {
      gsFieldHealthBanner.innerHTML = `
        <div class="gs-alert-banner gs-alert-banner--good">
          <div class="gs-alert-banner__icon">🌱</div>
          <div class="gs-alert-banner__body">
            <div class="gs-alert-banner__title">Field Health Alert · "${esc(farmName)}" looks healthy</div>
            <div class="gs-alert-banner__text">Satellite vegetation read: <strong>${esc(fh.health_status)}</strong> · NDVI ${Number(fh.mean_ndvi).toFixed(2)} · canopy cover ${Math.round(fh.canopy_cover_pct)}%. No action needed right now — we'll keep watching.</div>
          </div>
        </div>`;
      retranslate();
      return;
    }

    gsFieldHealthBanner.innerHTML = `
      <div class="gs-alert-banner gs-alert-banner--${tier}">
        <div class="gs-alert-banner__icon">${tier === 'poor' ? '🚨' : '⚠️'}</div>
        <div class="gs-alert-banner__body">
          <div class="gs-alert-banner__title">Field Health Alert · "${esc(farmName)}" shows ${esc(fh.health_status)}</div>
          <div class="gs-alert-banner__text">Satellite vegetation read: NDVI ${Number(fh.mean_ndvi).toFixed(2)} · canopy cover ${Math.round(fh.canopy_cover_pct)}%. This may indicate ${tier === 'poor' ? 'a pest, disease, or acute stress event' : 'a soil, nutrient, or water issue'} — worth a second look before it spreads.</div>
        </div>
        <div class="gs-alert-banner__actions">
          <button type="button" class="btn-gs-primary" id="gsFieldHealthCta">🔍 Find a Specialist</button>
        </div>
      </div>`;

    document.getElementById('gsFieldHealthCta')?.addEventListener('click', () => {
      const match = findNearestDistrict(farm.lat, farm.lon);
      if (match.state && match.district) {
        stateSelect.value = match.state;
        state.selectedState = match.state;
        populateDistricts(match.state);
        districtSelect.value = match.district;
        state.selectedDistrict = match.district;
        state.currentCoords = { lat: farm.lat, lng: farm.lon };
        state.districtCoords = state.currentCoords;
        resetGeoButton();
        btnGeolocation.innerHTML = '✓ Location Active';
      }
      if (categorySelect) { categorySelect.value = catFor[tier]; state.problemCategory = catFor[tier]; }
      if (topicSelect) { topicSelect.value = ''; state.consultationTopic = ''; }
      state.visibleCount = 15;
      updateResults();
      document.querySelector('.gs-layout')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });

    retranslate();
  }

  async function checkFieldHealthAlert() {
    if (!window.FarmState || typeof window.FarmState.load !== 'function') return;
    const farm = window.FarmState.load();
    if (!farm || typeof farm.lat !== 'number' || typeof farm.lon !== 'number') {
      renderFieldHealthBanner(null, null);
      return;
    }
    const fh = await fetchFieldHealth(farm.lat, farm.lon, farm.crop_id, farm.acres);
    renderFieldHealthBanner(fh, farm);
  }

  /* =========================================================================
     FEATURE 4 — AI Photo Pre-Screening
     -------------------------------------------------------------------------
     Reuses the real /api/disease/predict heuristic screening endpoint (the
     same one dashboard.js's Crop Symptom Screening tool calls) — never a
     separate/fabricated model. Result routes the farmer to the matching
     specialist category, same auto-fill pattern as the Field Health CTA.
     ========================================================================= */
  function initScanCard() {
    const card = document.getElementById('gsScanCard');
    const head = document.getElementById('gsScanCardHead');
    const input = document.getElementById('gsScanInput');
    const prompt = document.getElementById('gsScanPrompt');
    const preview = document.getElementById('gsScanPreview');
    const canvas = document.getElementById('gsScanCanvas');
    const runBtn = document.getElementById('gsScanRunBtn');
    const cropSelect = document.getElementById('gsScanCrop');
    const resultBox = document.getElementById('gsScanResult');
    if (!card || !head || !input || !canvas || !runBtn) return;
    const ctx = canvas.getContext('2d');

    function toggleScanCard() {
      const isOpen = card.classList.toggle('open');
      head.setAttribute('aria-expanded', String(isOpen));
    }
    head.addEventListener('click', toggleScanCard);
    head.addEventListener('keydown', (e) => {
      if (e.key !== 'Enter' && e.key !== ' ') return;
      e.preventDefault();
      toggleScanCard();
    });

    input.addEventListener('change', (e) => {
      const file = e.target.files[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = (evt) => {
        preview.src = evt.target.result;
        prompt.style.display = 'none';
        preview.style.display = 'block';
        preview.onload = () => {
          ctx.drawImage(preview, 0, 0, 224, 224);
          runBtn.disabled = false;
        };
      };
      reader.readAsDataURL(file);
    });

    runBtn.addEventListener('click', async () => {
      if (cropSelect && !cropSelect.value) {
        resultBox.innerHTML = '<p class="gs-scan-disclaimer">Choose the crop in the photo first. Screening covers maize, potato, soybean and tomato leaves.</p>';
        cropSelect.focus();
        return;
      }
      runBtn.disabled = true;
      runBtn.textContent = '⌛ Screening...';
      resultBox.innerHTML = '<div class="gs-shimmer"></div>';

      let regionId = null;
      try {
        if (window.FarmState && state.districtCoords) {
          regionId = window.FarmState.getNearestRegionId([state.districtCoords.lng, state.districtCoords.lat], state.selectedState || null);
        }
      } catch (_) { /* region_id is optional */ }

      const payload = {
        image_b64: canvas.toDataURL('image/jpeg'),
        crop_id: cropSelect.value || null,
        region_id: regionId,
        area_acres: +(document.getElementById('farmSize')?.value) || 1,
      };

      try {
        const res = await fetch('/api/disease/predict', {
          method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload),
        });
        if (!res.ok) throw new Error('scan failed');
        const r = await res.json();
        lastScanResult = r;

        const diseaseLower = String(r.disease || '').toLowerCase();
        const isPest = /mite|pest|infestation/.test(diseaseLower);
        const isHealthy = /healthy/.test(diseaseLower);
        const matchedCategory = isHealthy ? '' : isPest ? 'Pest attack' : 'Leaf diseases';
        const cropTopicMap = { maize: 'Maize', tomato: 'Horticulture', potato: 'Horticulture', soybean: 'Soybean' };
        const matchedTopic = cropTopicMap[r.crop_matched] || '';

        resultBox.innerHTML = `
          <div class="gs-scan-result">
            <div class="gs-scan-result__row"><span class="gs-scan-result__label">Screening result</span><span class="gs-scan-result__val">${esc(r.disease)}</span></div>
            <div class="gs-scan-result__row"><span class="gs-scan-result__label">Heuristic confidence</span><span class="gs-scan-result__val">${Math.round((r.confidence || 0) * 100)}%</span></div>
            <div class="gs-scan-result__row"><span class="gs-scan-result__label">Severity</span><span class="gs-scan-result__val">${esc(r.severity || '—')}</span></div>
            <div class="gs-scan-result__row"><span class="gs-scan-result__label">Crop matched</span><span class="gs-scan-result__val">${esc(r.crop_matched || '—')}</span></div>
            <p class="gs-scan-disclaimer">${esc(r.disclaimer || 'This is not a diagnosis. Confirm symptoms with a qualified agronomist before treatment.')}</p>
            ${!isHealthy ? `<button type="button" class="btn-gs-primary" id="gsScanFindExpertBtn" style="width:100%;margin-top:12px;">🔍 Find an Expert for This</button>` : ''}
          </div>`;

        document.getElementById('gsScanFindExpertBtn')?.addEventListener('click', () => {
          if (matchedCategory && categorySelect) { categorySelect.value = matchedCategory; state.problemCategory = matchedCategory; }
          if (matchedTopic && topicSelect) { topicSelect.value = matchedTopic; state.consultationTopic = matchedTopic; }
          state.visibleCount = 15;
          updateResults();
          document.querySelector('.gs-layout')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
        });
      } catch (_) {
        resultBox.innerHTML = `<p class="gs-scan-disclaimer">Screening is unavailable right now — the backend may be offline. You can still book an expert directly below.</p>`;
      } finally {
        runBtn.disabled = false;
        runBtn.textContent = '🔬 Run Preliminary Screen';
        retranslate();
      }
    });
  }

  // FAQ Accordion Functions
  const faqHeaders = document.querySelectorAll(".gs-faq-header");
  function toggleFaqHeader(header) {
    const item = header.parentElement;
    const isOpen = item.classList.contains("open");

    // Height comes from the grid-template-rows transition in CSS now, so
    // there is nothing to measure or reset here.
    document.querySelectorAll(".gs-faq-item").forEach(other => {
      other.classList.remove("open");
      const otherHeader = other.querySelector(".gs-faq-header");
      if (otherHeader) otherHeader.setAttribute("aria-expanded", "false");
    });

    if (!isOpen) {
      item.classList.add("open");
      header.setAttribute("aria-expanded", "true");
    }
  }
  faqHeaders.forEach(header => {
    header.addEventListener("click", function () { toggleFaqHeader(this); });
    header.addEventListener("keydown", function (e) {
      if (e.key !== "Enter" && e.key !== " ") return;
      e.preventDefault();
      toggleFaqHeader(this);
    });
  });

  // Run initialization on load (guard against DOMContentLoaded having
  // already fired when loaded via `defer`)
  function init() {
    initializeStatesDropdown();

    // Fill initial values from form to trigger update
    state.selectedState = stateSelect?.value || "";
    state.selectedDistrict = districtSelect?.value || "";
    state.preferredLanguage = languageSelect?.value || "Hindi";
    state.problemCategory = categorySelect?.value || "";
    state.consultationTopic = topicSelect?.value || "";

    updateResults();

    // Wow-factor features
    renderMyBookingsPanel();
    renderVerifiedTestimonials();
    renderCompareBar();
    initScanCard();
    checkFieldHealthAlert();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

})();
