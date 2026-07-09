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
    visibleCount: 15     // Paginate list to prevent browser lag
  };

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
        alert("Geolocation is not supported by your browser.");
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
            alert("Could not identify closest district. Falling back to manual selection.");
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
        resultsHeader.textContent = "Verified Local Experts (Within 150 km)";
      } else if (state.selectedDistrict) {
        resultsHeader.textContent = `Verified Experts in ${state.selectedDistrict}`;
      } else if (state.selectedState) {
        resultsHeader.textContent = `Verified Experts in ${state.selectedState}`;
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

    let cardsHtml = sliced.map(expert => {
      const distanceDisplay = expert.distance < 9000 
        ? `${expert.distance.toFixed(1)} km away` 
        : "Remote consultation available";

      return `
        <article class="gs-card">
          <div class="gs-card__photo-container">
            <img src="${expert.photo}" alt="${expert.name}" class="gs-card__photo" loading="lazy">
            <span class="gs-card__badge-status ${getAvailabilityClass(expert.availability)}">
              ${expert.availability}
            </span>
          </div>

          <div class="gs-card__info">
            <div class="gs-card__rating">
              ${starSVG} ${expert.rating.toFixed(1)}
              <span class="gs-card__rating-text">(${expert.reviews} Reviews)</span>
            </div>
            <h3 class="gs-card__name">${expert.name}</h3>
            <span class="gs-card__qual">${expert.qualification}</span>
            
            <div class="gs-card__meta-grid">
              <div class="gs-card__meta-item">
                ${distanceIcon}
                <span>${expert.district}, ${expert.state} (${distanceDisplay})</span>
              </div>
              <div class="gs-card__meta-item">
                ${langIcon}
                <span>Speaks: ${expert.languages.join(", ")}</span>
              </div>
              <div class="gs-card__meta-item">
                ${visitsIcon}
                <span>${expert.visits.toLocaleString()} farm visits</span>
              </div>
              <div class="gs-card__meta-item">
                ${clockIcon}
                <span>Response time: ${expert.responseTime}</span>
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

    const btnLoadMore = document.getElementById("btnLoadMore");
    if (btnLoadMore) {
      btnLoadMore.addEventListener("click", () => {
        state.visibleCount += 15;
        updateResults();
      });
    }
  }

  // Profile Modal Renderer
  function openProfileModal(id) {
    const expert = CONSULTANTS.find(e => e.id == id);
    if (!expert || !modal || !modalBody) return;

    const star5 = Math.round(expert.reviews * 0.75);
    const star4 = Math.round(expert.reviews * 0.18);
    const star3 = Math.round(expert.reviews * 0.05);
    const star2 = Math.round(expert.reviews * 0.01);
    const star1 = expert.reviews - (star5 + star4 + star3 + star2);

    const getPercent = (val) => Math.round((val / expert.reviews) * 100);

    let successStory = "";
    if (expert.specialization.includes("Soil")) {
      successStory = "Helped restore 4 acres of soybean farm in Sehore, increasing organic carbon content from 0.3% to 0.65% in 6 months.";
    } else if (expert.specialization.includes("Pest") || expert.specialization.includes("diseases")) {
      successStory = "Successfully controlled a devastating whitefly outbreak in Wardha, saving 12 acres of cotton crop from absolute ruin.";
    } else if (expert.specialization.includes("Irrigation")) {
      successStory = "Implemented automated drip systems on sugarcane fields, which resulted in saving 45% water and boosting brix scores.";
    } else {
      successStory = "Advised local cooperative on transitioning 18 farmers to profitable organic systems, securing premium market rates.";
    }

    modalBody.innerHTML = `
      <div class="gs-modal-profile">
        <img src="${expert.photo}" alt="${expert.name}" class="gs-modal-profile__photo">
        <div class="gs-modal-profile__info">
          <h3>${expert.name}</h3>
          <p><strong>${expert.qualification}</strong></p>
          <p>${expert.experience} Years of Field Experience · ${expert.visits.toLocaleString()} Visits</p>
          <div class="gs-card__rating" style="margin-top:8px;">
            ${starSVG} ${expert.rating.toFixed(1)}
            <span class="gs-card__rating-text">(${expert.reviews} Reviews)</span>
          </div>
        </div>
      </div>

      <div class="gs-modal-section-title">Biography</div>
      <p style="font-size:0.92rem; color:var(--ink-soft); line-height:1.6;">${expert.bio}</p>

      <div class="gs-modal-section-title">Education & Credentials</div>
      <p style="font-size:0.92rem; color:var(--ink-soft); margin-bottom:8px;">🎓 <strong>${expert.education}</strong></p>
      
      <div class="gs-modal-section-title">Certifications</div>
      <div class="gs-tag-container">
        ${expert.certifications.map(c => `<span class="gs-tag">✓ ${c}</span>`).join("")}
      </div>

      <div class="gs-modal-section-title">Specialization & Coverage</div>
      <p style="font-size:0.92rem; color:var(--ink-soft); margin-bottom:4px;">📍 <strong>Serving districts:</strong> ${expert.district}, and surrounding locations in ${expert.state}.</p>
      <p style="font-size:0.92rem; color:var(--ink-soft);">🌾 <strong>Primary Focus:</strong> ${expert.specialization}</p>

      <div class="gs-modal-section-title">Languages Spoken</div>
      <div class="gs-tag-container">
        ${expert.languages.map(l => `<span class="gs-tag" style="background:var(--accent-soft); color:var(--accent);">${l}</span>`).join("")}
      </div>

      <div class="gs-modal-section-title">Success Story Case Study</div>
      <div style="background: var(--gs-green-light); border-left: 4px solid var(--brand); padding: 12px 16px; border-radius: 0 var(--r-sm) var(--r-sm) 0; font-size: 0.9rem; font-style: italic; color: var(--brand-deep);">
        "${successStory}"
      </div>

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
  }

  function closeModal() {
    if (modal) {
      modal.classList.remove("open");
      document.body.style.overflow = "";
    }
  }

  [modalClose, modalBackdrop].forEach(el => {
    el?.addEventListener("click", closeModal);
  });

  // Booking Flow & Estimation Summary
  function bookConsultation(id) {
    const expert = CONSULTANTS.find(e => e.id == id);
    if (!expert || !bookingSummaryPlaceholder) return;

    const stateVal = stateSelect.value || "Not specified";
    const districtVal = districtSelect.value || "Not specified";
    const villageVal = document.getElementById("farmerVillage").value || "";
    const focusVal = topicSelect.value || "General Guidance";
    const farmSizeVal = document.getElementById("farmSize").value || "2.0";
    const probCategoryVal = categorySelect.value || "General Query";

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
      if (travelHrs > 4) {
        arrivalTime = "03:30 PM";
      } else if (travelHrs > 2) {
        arrivalTime = "01:00 PM";
      } else {
        arrivalTime = "10:30 AM";
      }
    }

    bookingSummaryPlaceholder.innerHTML = `
      <div class="gs-booking-card">
        <div class="gs-success-banner">
          ${checkSVG}
          <span>Your consultation request has been received. The expert will confirm shortly.</span>
        </div>
        
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
              ${villageVal ? villageVal + ", " : ""}${districtVal}, ${stateVal}
            </span>
          </div>
          <div class="gs-booking-item">
            <span class="gs-booking-label">Selected Expert</span>
            <span class="gs-booking-value">${expert.name} (${expert.qualification})</span>
          </div>
          <div class="gs-booking-item">
            <span class="gs-booking-label">Farming Focus / Selected Issue</span>
            <span class="gs-booking-value">${focusVal} · ${probCategoryVal}</span>
          </div>
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
  }

  // FAQ Accordion Functions
  const faqHeaders = document.querySelectorAll(".gs-faq-header");
  faqHeaders.forEach(header => {
    header.addEventListener("click", function () {
      const item = this.parentElement;
      const body = item.querySelector(".gs-faq-body");
      
      const isOpen = item.classList.contains("open");

      document.querySelectorAll(".gs-faq-item").forEach(other => {
        other.classList.remove("open");
        other.querySelector(".gs-faq-body").style.maxHeight = null;
      });

      if (!isOpen) {
        item.classList.add("open");
        body.style.maxHeight = body.scrollHeight + "px";
      } else {
        item.classList.remove("open");
        body.style.maxHeight = null;
      }
    });
  });

  // Run initialization on load
  document.addEventListener("DOMContentLoaded", () => {
    initializeStatesDropdown();
    
    // Fill initial values from form to trigger update
    state.selectedState = stateSelect?.value || "";
    state.selectedDistrict = districtSelect?.value || "";
    state.preferredLanguage = languageSelect?.value || "Hindi";
    state.problemCategory = categorySelect?.value || "";
    state.consultationTopic = topicSelect?.value || "";
    
    updateResults();
  });

})();
