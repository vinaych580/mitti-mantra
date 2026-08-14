/* =========================================================================
   Nearby Tractor Discovery — map + geolocation + filters (Leaflet)
   -------------------------------------------------------------------------
   Independent module from book-a-tractor.js. Owns:
     1. Requesting the user's location (Geolocation API) — with retry +
        manual "click the map to set your location" fallback.
     2. Rendering the Leaflet map + tractor markers
     3. Computing distance (Haversine) from the user to every tractor
     4. Filter controls (State, District, HP, price, availability, fuel type, distance)
     5. The "nearest first" list below the map

   All tractor data — including lat/lng — lives in Data/tractors.js.
   ========================================================================= */

(function () {
  const TRACTORS = window.TRACTORS_DATA || [];
  const esc = (window.MM && window.MM.escapeHtml) ? window.MM.escapeHtml : (s) => String(s == null ? '' : s);

  // Fallback map centre (geographic center/Bhopal) if the user denies/doesn't have geolocation.
  const FALLBACK_ORIGIN = { lat: 23.2599, lng: 77.4126, label: "Bhopal (default)" };

  let map, userMarker;
  let markers = [];              // { tractor, leafletMarker }
  let origin = FALLBACK_ORIGIN;

  const els = {};

  /* ---------- Haversine distance in km ---------- */
  function distanceKm(lat1, lng1, lat2, lng2) {
    const R = 6371;
    const dLat = ((lat2 - lat1) * Math.PI) / 180;
    const dLng = ((lng2 - lng1) * Math.PI) / 180;
    const a =
      Math.sin(dLat / 2) ** 2 +
      Math.cos((lat1 * Math.PI) / 180) *
        Math.cos((lat2 * Math.PI) / 180) *
        Math.sin(dLng / 2) ** 2;
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  }

  function recomputeDistances() {
    TRACTORS.forEach((t) => {
      t._distanceKm = distanceKm(origin.lat, origin.lng, t.lat, t.lng);
    });
  }

  /* ---------- Marker icon (colour-coded by availability) ---------- */
  function tractorIcon(status) {
    const color =
      status === "Limited" ? "#c88a3a" : status === "Booked" ? "#b91c1c" : "#2f6b3a";
    return L.divIcon({
      className: "tractor-marker",
      html: `<div class="tractor-marker__pin" style="background:${color}">🚜</div>`,
      iconSize: [34, 34],
      iconAnchor: [17, 17],
      popupAnchor: [0, -16]
    });
  }

  function userIcon() {
    return L.divIcon({
      className: "user-marker",
      html: `<div class="user-marker__dot"></div><div class="user-marker__pulse"></div>`,
      iconSize: [22, 22],
      iconAnchor: [11, 11]
    });
  }

  function popupHtml(t) {
    const isBooked = t.availability === 'Booked';
    return `
      <div class="map-popup">
        <strong>${esc(t.name)}</strong>
        <div class="map-popup__row">${t._distanceKm.toFixed(1)} km away</div>
        <div class="map-popup__row">Operator: ${esc(t.operatorName || 'Partner')}</div>
        <div class="map-popup__row">₹${t.pricePerHour.toLocaleString("en-IN")}/hr · <span class="map-popup__avail">${esc(t.availability)}</span></div>
        <button class="map-popup__btn"${isBooked ? ' disabled style="opacity:.6;cursor:not-allowed;"' : ''} onclick="window.openBookingModal(${t.id})">${isBooked ? 'Currently Booked' : 'Book Now'}</button>
      </div>
    `;
  }

  /* ---------- Filters ---------- */
  function readFilters() {
    return {
      state: els.state.value,
      district: els.district.value,
      hp: els.hp.value,
      price: els.price.value,
      availability: els.availability.value,
      fuel: els.fuel.value,
      distance: Number(els.distance.value)
    };
  }

  function passesFilters(t, f) {
    if (f.state && t.state !== f.state) return false;
    if (f.district && t.district !== f.district) return false;

    if (f.hp === "le40" && !(t.hp <= 40)) return false;
    if (f.hp === "40-50" && !(t.hp > 40 && t.hp <= 50)) return false;
    if (f.hp === "gt50" && !(t.hp > 50)) return false;

    if (f.price === "le400" && !(t.pricePerHour <= 400)) return false;
    if (f.price === "400-550" && !(t.pricePerHour > 400 && t.pricePerHour <= 550)) return false;
    if (f.price === "gt550" && !(t.pricePerHour > 550)) return false;

    if (f.availability !== "any" && t.availability !== f.availability) return false;
    if (f.fuel !== "any" && t.fuelType !== f.fuel) return false;
    if (t._distanceKm > f.distance) return false;

    return true;
  }

  /* ---------- Render markers (map) ---------- */
  function renderMarkers() {
    markers.forEach((m) => map.removeLayer(m.leafletMarker));
    markers = [];

    const f = readFilters();
    const visible = TRACTORS.filter((t) => passesFilters(t, f));

    visible.forEach((t) => {
      const marker = L.marker([t.lat, t.lng], { icon: tractorIcon(t.availability) })
        .addTo(map)
        .bindPopup(popupHtml(t));
      markers.push({ tractor: t, leafletMarker: marker });
    });

    return visible;
  }

  /* ---------- Render "nearest first" list below the map ---------- */
  function renderList(visible) {
    const sorted = [...visible].sort((a, b) => a._distanceKm - b._distanceKm);

    if (!sorted.length) {
      els.list.innerHTML = `<div class="nearby-empty">No tractors match those filters right now — try widening your distance or price range.</div>`;
      return;
    }

    els.list.innerHTML = sorted
      .map(
        (t) => {
          const isBooked = t.availability === 'Booked';
          return `
      <div class="nearby-item" data-id="${t.id}">
        <img src="${esc(t.image)}" alt="${esc(t.name)}" loading="lazy" referrerpolicy="no-referrer">
        <div class="nearby-item__body">
          <div class="nearby-item__head">
            <h4>${esc(t.name)}</h4>
            <span class="nearby-item__dist">${t._distanceKm.toFixed(1)} km</span>
          </div>
          <div class="nearby-item__meta">
            <span>${t.hp} HP</span>
            <span>${esc(t.fuelType)}</span>
            <span class="nearby-item__avail nearby-item__avail--${t.availability.toLowerCase()}">${esc(t.availability)}</span>
          </div>
          <div class="nearby-item__foot">
            <strong>₹${t.pricePerHour.toLocaleString("en-IN")}/hr</strong>
            <button class="nearby-item__btn"${isBooked ? ' disabled style="opacity:.6;cursor:not-allowed;"' : ''} onclick="event.stopPropagation(); window.openBookingModal(${t.id})">${isBooked ? 'Booked' : 'Book Now'}</button>
          </div>
        </div>
      </div>
    `;
        }
      )
      .join("");

    els.list.querySelectorAll(".nearby-item").forEach((el) => {
      el.addEventListener("click", () => {
        const id = Number(el.dataset.id);
        const found = markers.find((m) => m.tractor.id === id);
        if (found) {
          map.setView(found.leafletMarker.getLatLng(), 13, { animate: true });
          found.leafletMarker.openPopup();
        }
      });
    });
  }

  function refresh() {
    const visible = renderMarkers();
    renderList(visible);
  }

  /* ---------- Move the "you are here" marker + recompute everything ---------- */
  function setOrigin(lat, lng, label) {
    origin = { lat, lng, label };
    recomputeDistances();

    if (userMarker) map.removeLayer(userMarker);
    userMarker = L.marker([lat, lng], { icon: userIcon() }).addTo(map).bindPopup("You are here");

    refresh();
  }

  /* ---------- Populate Dropdowns ---------- */
  function populateStates() {
    if (!els.state) return;
    const states = [...new Set(TRACTORS.map(t => t.state))].sort();
    els.state.innerHTML = '<option value="">Select State</option>';
    states.forEach(s => {
      const opt = document.createElement("option");
      opt.value = s;
      opt.textContent = s;
      els.state.appendChild(opt);
    });
  }

  function populateDistricts(selectedState) {
    if (!els.district) return;
    els.district.innerHTML = '<option value="">Select District</option>';
    if (!selectedState) {
      els.district.disabled = true;
      return;
    }
    els.district.disabled = false;
    const districts = [...new Set(TRACTORS.filter(t => t.state === selectedState).map(t => t.district))].sort();
    districts.forEach(d => {
      const opt = document.createElement("option");
      opt.value = d;
      opt.textContent = d;
      els.district.appendChild(opt);
    });
  }

  /* ---------- Geolocation, with per-error messaging + retry + manual pin ---------- */
  function initLocation() {
    if (!("geolocation" in navigator)) {
      els.status.innerHTML = `📍 Location not supported by this browser — showing tractors near ${FALLBACK_ORIGIN.label}. Click the map to set your location manually.`;
      return;
    }

    els.status.textContent = "📍 Finding your location…";

    navigator.geolocation.getCurrentPosition(
      (pos) => {
        map.setView([pos.coords.latitude, pos.coords.longitude], 12);
        setOrigin(pos.coords.latitude, pos.coords.longitude, "your location");
        els.status.textContent = "📍 Showing tractors nearest to you.";
      },
      (err) => {
        let reason;
        if (err.code === 1) reason = "Location permission denied";
        else if (err.code === 2) reason = "Couldn't determine your location (no signal)";
        else reason = "Location lookup timed out";

        els.status.innerHTML =
          `📍 ${reason} — showing tractors near ${FALLBACK_ORIGIN.label}. ` +
          `<button id="locRetryBtn" type="button" class="map-status__link">Try again</button> ` +
          `or click the map to set your location manually.`;

        recomputeDistances();
        refresh();

        const retryBtn = document.getElementById("locRetryBtn");
        if (retryBtn) retryBtn.addEventListener("click", initLocation);
      },
      { enableHighAccuracy: false, timeout: 12000, maximumAge: 60000 }
    );
  }

  /* ---------- Boot ---------- */
  function init() {
    els.status = document.getElementById("mapStatus");
    els.state = document.getElementById("filterState");
    els.district = document.getElementById("filterDistrict");
    els.hp = document.getElementById("filterHp");
    els.price = document.getElementById("filterPrice");
    els.availability = document.getElementById("filterAvailability");
    els.fuel = document.getElementById("filterFuel");
    els.distance = document.getElementById("filterDistance");
    els.distanceVal = document.getElementById("filterDistanceVal");
    els.list = document.getElementById("nearbyList");

    const mapEl = document.getElementById("tractorMap");
    if (!mapEl || typeof L === "undefined" || !TRACTORS.length) return;

    map = L.map(mapEl, { scrollWheelZoom: false }).setView([FALLBACK_ORIGIN.lat, FALLBACK_ORIGIN.lng], 8);
    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      attribution: "&copy; OpenStreetMap contributors",
      maxZoom: 18
    }).addTo(map);

    // Manual fallback: click anywhere on the map to set your location.
    map.on("click", (e) => {
      setOrigin(e.latlng.lat, e.latlng.lng, "manually set location");
      els.status.textContent = "📍 Using the location you set on the map.";
    });

    populateStates();

    recomputeDistances();
    refresh();

    // Event bindings
    [els.hp, els.price, els.availability, els.fuel].forEach((el) =>
      el.addEventListener("change", refresh)
    );

    els.state.addEventListener("change", function () {
      const sName = this.value;
      populateDistricts(sName);
      if (sName) {
        const stateTractors = TRACTORS.filter(t => t.state === sName);
        if (stateTractors.length > 0) {
          const avgLat = stateTractors.reduce((sum, t) => sum + t.lat, 0) / stateTractors.length;
          const avgLng = stateTractors.reduce((sum, t) => sum + t.lng, 0) / stateTractors.length;
          setOrigin(avgLat, avgLng, sName);
          map.setView([avgLat, avgLng], 8);
        }
      } else {
        setOrigin(FALLBACK_ORIGIN.lat, FALLBACK_ORIGIN.lng, "Bhopal (default)");
        map.setView([FALLBACK_ORIGIN.lat, FALLBACK_ORIGIN.lng], 8);
      }
      refresh();
    });

    els.district.addEventListener("change", function () {
      const dName = this.value;
      const sName = els.state.value;
      if (sName && dName) {
        const distTractors = TRACTORS.filter(t => t.state === sName && t.district === dName);
        if (distTractors.length > 0) {
          const avgLat = distTractors.reduce((sum, t) => sum + t.lat, 0) / distTractors.length;
          const avgLng = distTractors.reduce((sum, t) => sum + t.lng, 0) / distTractors.length;
          setOrigin(avgLat, avgLng, dName);
          map.setView([avgLat, avgLng], 11);
        }
      } else if (sName) {
        const stateTractors = TRACTORS.filter(t => t.state === sName);
        if (stateTractors.length > 0) {
          const avgLat = stateTractors.reduce((sum, t) => sum + t.lat, 0) / stateTractors.length;
          const avgLng = stateTractors.reduce((sum, t) => sum + t.lng, 0) / stateTractors.length;
          setOrigin(avgLat, avgLng, sName);
          map.setView([avgLat, avgLng], 8);
        }
      }
      refresh();
    });

    els.distance.addEventListener("input", () => {
      els.distanceVal.textContent = `${els.distance.value} km`;
      refresh();
    });

    initLocation();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();