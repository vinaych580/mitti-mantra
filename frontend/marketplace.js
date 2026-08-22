/* =========================================================================
   MittiMantra Marketplace — page logic
   -------------------------------------------------------------------------
   Architecture notes (see docs / final report for the full rationale):

   • This app has no real backend authentication or multi-tenant database
     (see frontend/auth.js — a stub — and the 503s on /api/expense/*). The
     existing "Book a Tractor" and "Gyan Seva" features already establish the
     pattern this file follows: demo catalog data (Data/marketplace-listings.js)
     rendered client-side, with anything the user creates (listings, buy
     requests, reviews) persisted to localStorage, scoped to a per-browser
     device id — NOT a real server-side account.
   • Because there is no shared backend, one browser can't see another
     browser's listings or requests. Ownership checks (a seller can't edit
     someone else's listing) are enforced against the local device id, which
     demonstrates the intended access-control shape but is not a real
     security boundary — documented as a production requirement.
   • "Market Insight" pricing reuses the existing, real /api/mandi-prices and
     /api/msp-vs-market endpoints — no invented market data.
   • Because there is no live counterparty, the buyer → seller order
     lifecycle (REQUESTED → ACCEPTED → … → COMPLETED) is progressed with
     explicit "Simulate (demo)" actions rather than pretending a real seller
     responded.
   ========================================================================= */

(function () {
  'use strict';

  const DATA = window.MARKETPLACE_DATA || { source: 'DEMO_DATA', listings: [], demand: [], pools: [] };
  const DEMO_LISTINGS = DATA.listings || [];
  const DEMAND = DATA.demand || [];
  const DEMO_POOLS = DATA.pools || [];

  const esc = (window.MM && window.MM.escapeHtml) || function (s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  };
  const inr = (v) => (window.MM && window.MM.fmt) ? window.MM.fmt.inr(v, { compact: false }) : '₹' + Number(v || 0).toLocaleString('en-IN');
  const toast = (window.MM && window.MM.toast) || function (msg) { console.log(msg); };

  /* ----------------------------------------------------------------------
     On-demand script/style loading — Chart.js and Leaflet are only needed
     for the price-trend chart and the Nearby Demand map respectively, not
     on every page view, so they're fetched the first time either is
     actually used instead of unconditionally in <head>.
  ---------------------------------------------------------------------- */
  const scriptLoadPromises = new Map();
  function loadScriptOnce(src, attrs) {
    if (scriptLoadPromises.has(src)) return scriptLoadPromises.get(src);
    const p = new Promise((resolve, reject) => {
      const el = document.createElement('script');
      el.src = src;
      Object.entries(attrs || {}).forEach(([k, v]) => el.setAttribute(k, v));
      el.onload = resolve;
      el.onerror = () => reject(new Error('Failed to load ' + src));
      document.head.appendChild(el);
    });
    scriptLoadPromises.set(src, p);
    return p;
  }
  function loadStyleOnce(href) {
    if (document.querySelector(`link[href="${href}"]`)) return;
    const el = document.createElement('link');
    el.rel = 'stylesheet';
    el.href = href;
    document.head.appendChild(el);
  }
  function ensureChartJs() {
    if (window.Chart) return Promise.resolve();
    return loadScriptOnce('https://cdn.jsdelivr.net/npm/chart.js@4.4.0/dist/chart.umd.min.js');
  }
  function ensureLeaflet() {
    if (window.L) return Promise.resolve();
    loadStyleOnce('https://unpkg.com/leaflet@1.9.4/dist/leaflet.css');
    return loadScriptOnce('https://unpkg.com/leaflet@1.9.4/dist/leaflet.js', {
      integrity: 'sha256-20nQCchB9co0qIjJZRGuk2/Z9VM+kNiyxNV1lvTlZBo=',
      crossorigin: '',
    });
  }

  /* Same palette dashboard.js uses for its charts, kept in sync for visual consistency. */
  const BRAND = '#2f6b3a', ACCENT = '#c88a3a';
  const CHART_REGISTRY = new Map();
  async function makeMktChart(canvasEl, config) {
    if (!canvasEl) return null;
    await ensureChartJs();
    if (!window.Chart) return null;
    const prev = CHART_REGISTRY.get(canvasEl);
    if (prev) prev.destroy();
    const chart = new window.Chart(canvasEl.getContext('2d'), config);
    CHART_REGISTRY.set(canvasEl, chart);
    return chart;
  }

  /* ----------------------------------------------------------------------
     Storage keys — everything here is a per-browser demo store, mirroring
     the pattern already used by mittimantra_bookings (book-a-tractor.js).
  ---------------------------------------------------------------------- */
  const LS = {
    listings: 'mittimantra_marketplace_listings',
    orders:   'mittimantra_marketplace_orders',
    seller:   'mittimantra_marketplace_seller',
    reviews:  'mittimantra_marketplace_reviews',
    views:    'mittimantra_marketplace_views',
    device:   'mittimantra_device_id',
    cart:     'mittimantra_marketplace_cart',
    pools:    'mittimantra_marketplace_pools',
    sales:    'mittimantra_marketplace_selfsales',
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

  function deviceId() {
    let id = null;
    try { id = localStorage.getItem(LS.device); } catch (_) {}
    if (!id) {
      id = 'dev_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 8);
      try { localStorage.setItem(LS.device, id); } catch (_) {}
    }
    return id;
  }

  const getMyListings   = () => readLS(LS.listings, []);
  const saveMyListings  = (v) => writeLS(LS.listings, v);
  const getMyOrders     = () => readLS(LS.orders, []);
  const saveMyOrders    = (v) => writeLS(LS.orders, v);
  const getSellerProfile = () => readLS(LS.seller, null);
  const saveSellerProfile = (v) => writeLS(LS.seller, v);
  const getReviews      = () => readLS(LS.reviews, []);
  const saveReviews     = (v) => writeLS(LS.reviews, v);
  const getViews        = () => readLS(LS.views, {});
  function bumpView(id) { const v = getViews(); v[id] = (v[id] || 0) + 1; writeLS(LS.views, v); return v[id]; }
  /* Self-reported sales — see "Record a Sale" in My Listings. Orders in
     LS.orders only ever get created buyer-side (a device can't request to
     buy its own listing, so a listing's owner has no UI path to ever
     accumulate a "completed sale" against their own listing — with no
     shared backend, this device never learns about a real buyer's order on
     another device either). Self-reported sales close that gap honestly:
     the seller logs a sale that happened (in person, over phone, etc.),
     clearly labelled as self-reported rather than counterparty-verified. */
  const getSelfSales    = () => readLS(LS.sales, []);
  const saveSelfSales   = (v) => writeLS(LS.sales, v);

  /* ----------------------------------------------------------------------
     Cart — [{ listingId, quantity }], one browser, buyer side only.
  ---------------------------------------------------------------------- */
  const getCart = () => readLS(LS.cart, []);
  const saveCart = (v) => writeLS(LS.cart, v);

  function addToCart(listingId, qty) {
    const cart = getCart();
    const existing = cart.find((c) => c.listingId === listingId);
    if (existing) existing.quantity += qty;
    else cart.push({ listingId, quantity: qty });
    saveCart(cart);
    updateCartBadge(true);
  }

  function updateCartBadge(bump) {
    const badge = document.getElementById('mktCartBadge');
    if (!badge) return;
    const count = getCart().length;
    badge.textContent = String(count);
    badge.style.display = count > 0 ? '' : 'none';
    if (bump) {
      badge.classList.remove('bump');
      void badge.offsetWidth; // restart the animation on rapid successive adds
      badge.classList.add('bump');
    }
  }

  /* ----------------------------------------------------------------------
     Collective Selling / Pool Orders — small farmers with the same crop
     nearby can combine listings into one pooled offer, so together they can
     meet a bulk buyer's minimum order size. This is a real structural gap
     for fragmented small landholdings, but with no live backend there's no
     way to sync a binding commitment across devices — so a pool here is a
     device-local grouping the pool's creator opts into (using each
     listing's already-public lat/lon), and a buyer requesting "from the
     pool" simply sends one request per member through the existing
     cart/batch flow. It's honestly an aggregated view + a convenience for
     sending requests together, not a binding multi-party contract.
  ---------------------------------------------------------------------- */
  const getMyPools = () => readLS(LS.pools, []);
  const saveMyPools = (v) => writeLS(LS.pools, v);
  /** Demo pools (static reference data) + this device's own pools — mirrors
   *  how allListings() merges DEMO_LISTINGS with getMyListings(). Mutations
   *  (createPool/leavePool) only ever touch getMyPools()/saveMyPools() —
   *  the demo pools are frozen reference data, never written back to
   *  localStorage. */
  const getPools = () => DEMO_POOLS.concat(getMyPools());

  function poolForListing(listingId) {
    return getPools().find((p) => p.memberListingIds.includes(listingId)) || null;
  }
  function poolMembers(pool) {
    return pool.memberListingIds.map((id) => findListing(id)).filter(Boolean);
  }
  function poolCombinedQty(pool) {
    return poolMembers(pool).reduce((sum, l) => sum + quintalEquivalentQty(l), 0);
  }

  const POOL_RADIUS_KM = 150;
  function findPoolCandidates(listing, limit = 4) {
    if (typeof listing.lat !== 'number' || typeof listing.lon !== 'number') return [];
    return browsableListings().filter((o) =>
      o.id !== listing.id && o.cropId === listing.cropId && o.sellerId !== listing.sellerId &&
      typeof o.lat === 'number' && typeof o.lon === 'number' &&
      haversineKm(listing.lat, listing.lon, o.lat, o.lon) <= POOL_RADIUS_KM &&
      !poolForListing(o.id)
    ).slice(0, limit);
  }

  function createPool(listing, candidates) {
    const pools = getMyPools();
    const pool = {
      id: 'pool_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 6),
      cropId: listing.cropId, cropName: listing.name,
      memberListingIds: [listing.id, ...candidates.map((c) => c.id)],
      createdBy: deviceId(), createdAt: new Date().toISOString(),
    };
    pools.push(pool);
    saveMyPools(pools);
    return pool;
  }

  function leavePool(listingId) {
    // Only ever mutate this device's own pools — demo pools are static
    // reference data and a listingId of ours can never be a member of one.
    const pools = getMyPools()
      .map((p) => Object.assign({}, p, { memberListingIds: p.memberListingIds.filter((id) => id !== listingId) }))
      .filter((p) => p.memberListingIds.length > 1); // dissolve pools left with fewer than 2 members
    saveMyPools(pools);
  }

  function poolSectionHtml(pool, listing, mine) {
    const members = poolMembers(pool);
    const combined = Math.round(poolCombinedQty(pool));
    const isDemo = pool.createdBy === 'demo';
    return `<div class="mkt-pool-section">
      <h4>🧺 Pooled Listing <span class="mkt-insight__tag">${members.length} farmers</span>${isDemo ? '<span class="mkt-card__demo" style="position:static;">Demo pool</span>' : ''}</h4>
      <p class="mkt-note">These farmers ${isDemo ? '(illustrative demo sellers) ' : ''}combined their ${esc(listing.name)} into one pooled offer — ${combined.toLocaleString('en-IN')} quintal combined — so a buyer can meet a bulk minimum order in one go.</p>
      <div class="mkt-pool-members">${members.map((m) => `
        <div class="mkt-pool-member ${m.id === listing.id ? 'mkt-pool-member--this' : ''}">
          <span>${esc(m.sellerName)}${m.verified ? ' ✓' : ''}</span>
          <span>${Number(m.quantityAvailable).toLocaleString('en-IN')} ${esc(m.unit)}</span>
          <span>${inr(m.pricePerUnit)}/${esc(m.unit)}</span>
        </div>`).join('')}</div>
      ${mine ? '<p class="mkt-note">Manage this pool from <b>My Listings</b>.</p>' :
        `<button type="button" class="btn btn-primary mkt-btn-sm" id="mktPoolRequestBtn">Request from Pool (Bulk)</button>`}
      <p class="mkt-note">Device-local grouping opted into by its creator — not a binding multi-party contract, since this prototype has no shared backend to synchronize commitments across farmers' devices.</p>
    </div>`;
  }

  /* ----------------------------------------------------------------------
     Categories
  ---------------------------------------------------------------------- */
  const CATEGORIES = [
    { id: 'grains',     label: 'Grains',     icon: '🌾' },
    { id: 'pulses',     label: 'Pulses',     icon: '🫘' },
    { id: 'vegetables', label: 'Vegetables', icon: '🥦' },
    { id: 'fruits',     label: 'Fruits',     icon: '🍌' },
    { id: 'spices',     label: 'Spices',     icon: '🌶️' },
    { id: 'oilseeds',   label: 'Oilseeds',   icon: '🫒' },
    { id: 'cotton',     label: 'Cotton',     icon: '☁️' },
    { id: 'other',      label: 'Other',      icon: '🌿' },
  ];
  const CAT_MAP = Object.fromEntries(CATEGORIES.map((c) => [c.id, c]));
  const catIcon = (id) => (CAT_MAP[id] || CAT_MAP.other).icon;
  const catLabel = (id) => (CAT_MAP[id] || CAT_MAP.other).label;

  const GRADES = ['Premium', 'Grade A', 'Grade B', 'Standard'];

  /* ----------------------------------------------------------------------
     Images — demo listings carry a single curated `image` path; listings a
     user creates can carry `images` (an array of locally-compressed data
     URLs from the file picker below, device-local only — there is no
     upload server in this prototype). These two helpers let every render
     path treat both shapes the same way.
  ---------------------------------------------------------------------- */
  function allImages(l) {
    if (l.images && l.images.length) return l.images;
    if (l.image) return [l.image];
    return [];
  }
  function primaryImage(l) {
    return allImages(l)[0] || null;
  }

  const MAX_LISTING_PHOTOS = 4;
  function readAndCompressImage(file, maxDim = 640, quality = 0.72) {
    return new Promise((resolve, reject) => {
      if (!file.type || !file.type.startsWith('image/')) { reject(new Error('Not an image file')); return; }
      const reader = new FileReader();
      reader.onerror = () => reject(new Error('Could not read file'));
      reader.onload = () => {
        const img = new Image();
        img.onerror = () => reject(new Error('Could not decode image'));
        img.onload = () => {
          let width = img.naturalWidth, height = img.naturalHeight;
          if (width > height && width > maxDim) { height = Math.round(height * maxDim / width); width = maxDim; }
          else if (height >= width && height > maxDim) { width = Math.round(width * maxDim / height); height = maxDim; }
          const canvas = document.createElement('canvas');
          canvas.width = width; canvas.height = height;
          canvas.getContext('2d').drawImage(img, 0, 0, width, height);
          resolve(canvas.toDataURL('image/jpeg', quality));
        };
        img.src = reader.result;
      };
      reader.readAsDataURL(file);
    });
  }

  /* ----------------------------------------------------------------------
     Geo — buyer location resolution + distance
     Deliberately independent of map-tractors.js (tractor discovery) per
     the brief; reuses FarmState (the farmer's real drawn/saved plot) as the
     primary location source instead of re-deriving it.
  ---------------------------------------------------------------------- */
  let myLocation = null; // { lat, lon, source: 'farm' | 'geolocation' }

  function resolveMyLocation() {
    try {
      const farm = window.FarmState && window.FarmState.load();
      if (farm && typeof farm.lat === 'number' && typeof farm.lon === 'number') {
        myLocation = { lat: farm.lat, lon: farm.lon, source: 'farm' };
        return;
      }
    } catch (_) {}
    if (navigator.geolocation) {
      navigator.geolocation.getCurrentPosition(
        (pos) => {
          myLocation = { lat: pos.coords.latitude, lon: pos.coords.longitude, source: 'geolocation' };
          renderGrid();
        },
        () => { /* silently unavailable — distance simply won't show */ },
        { timeout: 6000 }
      );
    }
  }

  function haversineKm(lat1, lon1, lat2, lon2) {
    const R = 6371;
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLon = (lon2 - lon1) * Math.PI / 180;
    const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLon / 2) ** 2;
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  }

  function distanceTo(listing) {
    if (!myLocation || typeof listing.lat !== 'number' || typeof listing.lon !== 'number') return null;
    return Math.round(haversineKm(myLocation.lat, myLocation.lon, listing.lat, listing.lon));
  }

  /* ----------------------------------------------------------------------
     Listings: merge demo catalog + locally-created listings
  ---------------------------------------------------------------------- */
  function allListings() {
    const mine = getMyListings();
    return DEMO_LISTINGS.concat(mine);
  }

  /** Publicly browsable listings — excludes drafts and (soft) deleted rows. */
  function browsableListings() {
    return allListings().filter((l) => l.status !== 'draft' && l.status !== 'deleted');
  }

  function findListing(id) {
    return allListings().find((l) => l.id === id) || null;
  }

  function isMine(listing) {
    return !!listing && listing.sellerId === deviceId() && DEMO_LISTINGS.indexOf(listing) === -1;
  }

  function isDemoListing(listing) {
    return !!listing && DEMO_LISTINGS.indexOf(listing) !== -1;
  }

  /* ----------------------------------------------------------------------
     Unit normalization — listings can be priced per kg/quintal/tonne.
     Filtering and sorting compare a quintal-equivalent so a ₹/kg listing
     isn't wrongly excluded/included against a ₹/quintal filter bound.
     Display always stays in the listing's own unit — only comparisons
     are normalized.
  ---------------------------------------------------------------------- */
  const UNIT_TO_KG = { kg: 1, quintal: 100, tonne: 1000 };
  function perQuintalPrice(l) { return (l.pricePerUnit / (UNIT_TO_KG[l.unit] || 100)) * 100; }
  function quintalEquivalentQty(l) { return (l.quantityAvailable * (UNIT_TO_KG[l.unit] || 100)) / 100; }

  /* ----------------------------------------------------------------------
     Forward Booking — a listing with a harvestDate still in the future is
     treated as a pre-harvest / forward listing, the same mechanism NCDEX's
     exchange-traded forwards ("Agrim Sauda") and eNAM's FPO trading module
     already use for commodity forward contracts, brought down to an
     individual farm listing. Deliberately reuses the existing harvestDate
     field rather than adding a new one — a listing is a forward booking
     purely because its harvest hasn't happened yet, nothing more to model.
  ---------------------------------------------------------------------- */
  const FORWARD_DEPOSIT_PCT = 0.20; // matches the up-to-20%-of-estimated-harvest figure smallholder orgs already use for pre-harvest financing

  function isForwardListing(listing) {
    const today = new Date().toISOString().slice(0, 10);
    return !!listing.harvestDate && listing.harvestDate > today;
  }

  function availabilityLabel(listing) {
    if (listing.status === 'sold_out' || listing.quantityAvailable <= 0) return { text: 'Sold out', cls: 'sold' };
    if (listing.status === 'paused') return { text: 'Paused', cls: 'paused' };
    if (isForwardListing(listing)) return { text: 'Pre-Harvest Booking', cls: 'forward' };
    if (listing.status === 'limited' || listing.quantityAvailable <= listing.minOrderQty * 2) return { text: 'Limited stock', cls: 'limited' };
    return { text: 'Available now', cls: 'avail' };
  }

  /* ----------------------------------------------------------------------
     Filters / sort / pagination — Buyer view state
  ---------------------------------------------------------------------- */
  const state = {
    view: 'browse',       // browse | detail | sell | my-listings | my-requests | demand | pools | cart
    detailId: null,
    editListingId: null,
    justPublishedId: null,
    page: 1,
    pageSize: 9,
    filters: {
      q: '', category: '', priceMin: '', priceMax: '', qtyMin: '',
      state: '', grade: '', verifiedOnly: false, availability: '',
      sort: 'recent',
    },
  };

  function applyFilters(list) {
    const f = state.filters;
    let out = list.filter((l) => {
      if (f.q) {
        const hay = `${l.name} ${l.variety} ${l.cropId}`.toLowerCase();
        if (!hay.includes(f.q.toLowerCase())) return false;
      }
      if (f.category && l.category !== f.category) return false;
      if (f.priceMin && perQuintalPrice(l) < Number(f.priceMin)) return false;
      if (f.priceMax && perQuintalPrice(l) > Number(f.priceMax)) return false;
      if (f.qtyMin && quintalEquivalentQty(l) < Number(f.qtyMin)) return false;
      if (f.state && l.state !== f.state) return false;
      if (f.grade && l.grade !== f.grade) return false;
      if (f.verifiedOnly && !l.verified) return false;
      if (f.availability === 'available' && availabilityLabel(l).cls !== 'avail') return false;
      if (f.availability === 'limited' && availabilityLabel(l).cls !== 'limited') return false;
      return true;
    });

    switch (f.sort) {
      case 'price_asc': out.sort((a, b) => perQuintalPrice(a) - perQuintalPrice(b)); break;
      case 'price_desc': out.sort((a, b) => perQuintalPrice(b) - perQuintalPrice(a)); break;
      case 'qty_desc': out.sort((a, b) => quintalEquivalentQty(b) - quintalEquivalentQty(a)); break;
      case 'distance': {
        out.sort((a, b) => {
          const da = distanceTo(a), db = distanceTo(b);
          if (da == null && db == null) return 0;
          if (da == null) return 1;
          if (db == null) return -1;
          return da - db;
        });
        break;
      }
      default: out.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt)); // recent
    }
    return out;
  }

  /* ----------------------------------------------------------------------
     Rendering — shell / tabs
  ---------------------------------------------------------------------- */
  const $ = (sel, root) => (root || document).querySelector(sel);
  const $$ = (sel, root) => Array.from((root || document).querySelectorAll(sel));

  function switchView(view) {
    state.view = view;
    $$('.mkt-view').forEach((el) => el.classList.toggle('active', el.dataset.view === view));
    $$('.mkt-tab').forEach((el) => el.classList.toggle('active', el.dataset.view === view));
    window.scrollTo({ top: $('.mkt-tabs')?.offsetTop - 84 || 0, behavior: 'smooth' });
    if (view === 'browse') renderGrid();
    if (view === 'my-listings') renderMyListings();
    if (view === 'my-requests') renderMyRequests();
    if (view === 'demand') renderDemand();
    if (view === 'pools') renderPools();
    if (view === 'credit-profile') renderCreditProfile();
    if (view === 'sell') renderSellForm();
    if (view === 'cart') renderCart();
  }

  /* ----------------------------------------------------------------------
     Category chips + filters
  ---------------------------------------------------------------------- */
  function renderCategoryChips() {
    const host = $('#mktCategoryChips');
    if (!host) return;
    host.innerHTML = `<button type="button" class="mkt-chip ${!state.filters.category ? 'active' : ''}" data-cat="">🌐 All</button>` +
      CATEGORIES.map((c) => `<button type="button" class="mkt-chip ${state.filters.category === c.id ? 'active' : ''}" data-cat="${c.id}">${c.icon} ${c.label}</button>`).join('');
    host.querySelectorAll('.mkt-chip').forEach((btn) => {
      btn.addEventListener('click', () => {
        state.filters.category = btn.dataset.cat;
        state.page = 1;
        renderCategoryChips();
        renderGrid();
      });
    });
  }

  function populateStateFilter() {
    const sel = $('#fState');
    if (!sel || sel.options.length > 1) return;
    const states = Array.from(new Set(DEMO_LISTINGS.map((l) => l.state))).sort();
    sel.innerHTML = '<option value="">Any state</option>' + states.map((s) => `<option value="${esc(s)}">${esc(s)}</option>`).join('');
  }

  function bindFilters() {
    populateStateFilter();
    const map = {
      fPriceMin: 'priceMin', fPriceMax: 'priceMax', fQtyMin: 'qtyMin',
      fState: 'state', fGrade: 'grade', fAvailability: 'availability', fSort: 'sort',
    };
    Object.entries(map).forEach(([elId, key]) => {
      const el = document.getElementById(elId);
      if (!el) return;
      el.addEventListener('change', () => { state.filters[key] = el.value; state.page = 1; renderGrid(); });
    });
    const verified = document.getElementById('fVerified');
    if (verified) verified.addEventListener('change', () => { state.filters.verifiedOnly = verified.checked; state.page = 1; renderGrid(); });

    const search = document.getElementById('mktSearch');
    if (search) {
      let searchDebounce = null;
      search.addEventListener('input', () => {
        clearTimeout(searchDebounce);
        searchDebounce = setTimeout(() => {
          state.filters.q = search.value.trim();
          state.page = 1;
          renderGrid();
        }, 250);
      });
    }

    const clearBtn = document.getElementById('fClear');
    if (clearBtn) clearBtn.addEventListener('click', () => {
      state.filters = { q: search ? search.value : '', category: state.filters.category, priceMin: '', priceMax: '', qtyMin: '', state: '', grade: '', verifiedOnly: false, availability: '', sort: 'recent' };
      $$('#mktFilters select').forEach((s) => { if (s.id !== 'fSort') s.value = ''; });
      const v = document.getElementById('fVerified'); if (v) v.checked = false;
      state.page = 1;
      renderGrid();
    });

    const drawerToggle = document.getElementById('mktFilterToggle');
    const drawer = document.getElementById('mktFilters');
    if (drawerToggle && drawer) {
      drawerToggle.addEventListener('click', () => drawer.classList.toggle('open'));
    }
  }

  /* ----------------------------------------------------------------------
     Product grid
  ---------------------------------------------------------------------- */
  function cardHtml(l, i) {
    const avail = availabilityLabel(l);
    const dist = distanceTo(l);
    const mine = isMine(l);
    const img = primaryImage(l);
    const pool = poolForListing(l.id);
    const delay = Math.min(i || 0, 11) * 45;
    return `
    <article class="mkt-card" data-id="${esc(l.id)}" style="animation-delay:${delay}ms">
      <div class="mkt-card__media mkt-card__media--${esc(l.category)}">
        ${img
          ? `<img src="${esc(img)}" alt="${esc(l.name)}" loading="lazy" onerror="this.style.display='none';this.nextElementSibling.style.display='flex';">
             <span class="mkt-card__ico" style="display:none;">${catIcon(l.category)}</span>`
          : `<span class="mkt-card__ico">${catIcon(l.category)}</span>`}
        <span class="mkt-card__avail mkt-card__avail--${avail.cls}">${avail.text}</span>
        ${mine ? '<span class="mkt-card__mine">Your listing</span>' : ''}
        ${!mine && isDemoListing(l) ? '<span class="mkt-card__demo" title="Sample catalog data for this prototype">Demo listing</span>' : ''}
      </div>
      <div class="mkt-card__body">
        <div class="mkt-card__head">
          <h3>${esc(l.name)}<small>${esc(l.variety || '')}</small></h3>
          <span class="mkt-card__grade">${esc(l.grade)}</span>
        </div>
        <div class="mkt-card__price">${inr(l.pricePerUnit)}<small>/ ${esc(l.unit)}</small></div>
        <div class="mkt-card__meta">
          <span>📦 ${Number(l.quantityAvailable).toLocaleString('en-IN')} ${esc(l.unit)} available</span>
          <span>🧮 MOQ ${l.minOrderQty} ${esc(l.unit)}</span>
        </div>
        <div class="mkt-card__meta">
          <span>${isForwardListing(l) ? `🌱 Expected harvest ${esc(l.harvestDate)}` : `📅 Harvested ${esc(l.harvestDate)}`}</span>
        </div>
        <div class="mkt-card__seller">
          <span class="mkt-card__seller-name">${esc(l.sellerName)}${l.verified ? ' <b class="mkt-verified" title="Verified seller">✓</b>' : ''}</span>
          <span class="mkt-card__loc">📍 ${esc(l.district)}, ${esc(l.state)}${dist != null ? ` · ${dist} km away` : ''}</span>
        </div>
        ${pool ? `<div class="mkt-card__pool-tag">🧺 Pooled — ${poolMembers(pool).length} farmers, ${Math.round(poolCombinedQty(pool)).toLocaleString('en-IN')} quintal combined</div>` : ''}
        <div class="mkt-card__actions">
          <button type="button" class="btn btn-ghost mkt-btn-sm" data-detail="${esc(l.id)}">View Details</button>
          <button type="button" class="btn btn-primary mkt-btn-sm" data-detail="${esc(l.id)}">${mine ? 'Manage' : 'Contact Seller'}</button>
        </div>
      </div>
    </article>`;
  }

  function renderGrid() {
    const host = $('#mktGrid');
    if (!host) return;
    const filtered = applyFilters(browsableListings());
    const countEl = $('#mktResultCount');
    if (countEl) countEl.textContent = `${filtered.length} listing${filtered.length === 1 ? '' : 's'} found`;

    if (!filtered.length) {
      host.innerHTML = `<div class="mkt-empty">
        <div class="mkt-empty__ico">🌱</div>
        <h3>No products found</h3>
        <p>Try widening your filters, or check back soon — new listings are added often.</p>
      </div>`;
      renderPagination(0);
      return;
    }

    const start = 0, end = state.page * state.pageSize;
    const slice = filtered.slice(start, end);
    host.innerHTML = slice.map(cardHtml).join('');
    host.querySelectorAll('[data-detail]').forEach((btn) => {
      btn.addEventListener('click', () => openDetail(btn.dataset.detail));
    });
    host.querySelectorAll('.mkt-card').forEach((card) => {
      card.addEventListener('click', (e) => {
        if (e.target.closest('[data-detail]')) return;
        openDetail(card.dataset.id);
      });
    });
    renderPagination(filtered.length, end);
  }

  function renderPagination(total, shown) {
    const host = $('#mktLoadMore');
    if (!host) return;
    if (shown && shown < total) {
      host.innerHTML = `<button type="button" class="btn btn-ghost" id="mktLoadMoreBtn">Show more (${total - shown} remaining)</button>`;
      document.getElementById('mktLoadMoreBtn').addEventListener('click', () => { state.page += 1; renderGrid(); });
    } else {
      host.innerHTML = '';
    }
  }

  /* ----------------------------------------------------------------------
     Market Insight — reuses real backend endpoints, no invented prices.
     Combines /api/mandi-prices (reference range), /api/msp-vs-market (MSP
     comparison, where the crop has one — MSP doesn't apply to most fruit/
     vegetable/spice crops, which is real Indian policy, not a data gap),
     and /api/price-forecast (history + ML trend, for the chart).
  ---------------------------------------------------------------------- */
  async function fetchMarketInsight(regionId, cropId, listingPricePerQuintal) {
    if (!regionId || !cropId) {
      return { available: false, message: 'Market reference not available for this crop and region yet.' };
    }
    try {
      const [rows, msp, forecast] = await Promise.all([
        fetch(`/api/mandi-prices/${encodeURIComponent(regionId)}?crop_id=${encodeURIComponent(cropId)}`).then((r) => r.ok ? r.json() : []).catch(() => []),
        fetch(`/api/msp-vs-market/${encodeURIComponent(regionId)}/${encodeURIComponent(cropId)}`).then((r) => r.ok ? r.json() : null).catch(() => null),
        fetch(`/api/price-forecast/${encodeURIComponent(regionId)}/${encodeURIComponent(cropId)}?months_ahead=4`).then((r) => r.ok ? r.json() : null).catch(() => null),
      ]);
      if (!Array.isArray(rows) || !rows.length) {
        return { available: false, message: 'Market reference not available for this crop and region yet.' };
      }
      const sorted = rows.slice().sort((a, b) => new Date(a.date) - new Date(b.date));
      const recent = sorted.slice(-6);
      const perQuintal = recent.map((r) => Number(r.price_inr_per_kg) * 100);
      const lo = Math.round(Math.min(...perQuintal));
      const hi = Math.round(Math.max(...perQuintal));
      const avg = Math.round(perQuintal.reduce((a, b) => a + b, 0) / perQuintal.length);
      let verdict = 'within';
      if (listingPricePerQuintal > hi) verdict = 'above';
      else if (listingPricePerQuintal < lo) verdict = 'below';

      const history = sorted.slice(-12).map((r) => ({ label: String(r.date).slice(0, 7), price: Math.round(Number(r.price_inr_per_kg) * 100) }));
      const fcstList = (forecast && Array.isArray(forecast.forecasts)) ? forecast.forecasts : [];
      const forecastPoints = fcstList.map((f) => ({ label: f.month, price: Math.round(Number(f.forecast_price) * 100) }));

      return {
        available: true, lo, hi, avg, verdict,
        market: recent[recent.length - 1].market_name || '', asOf: recent[recent.length - 1].date,
        msp: msp || null,
        chart: { history, forecast: forecastPoints },
      };
    } catch (_) {
      return { available: false, message: 'Could not reach the market data service.' };
    }
  }

  function marketInsightHtml(insight, chartId, blockId) {
    if (!insight.available) {
      return `<div class="mkt-insight mkt-insight--empty"${blockId ? ` id="${esc(blockId)}"` : ''}>📊 <b>Market Insight:</b> ${esc(insight.message)}</div>`;
    }
    const verdictText = {
      within: 'within the current mandi reference range.',
      above: 'above the current mandi reference range.',
      below: 'below the current mandi reference range — a good deal for buyers.',
    }[insight.verdict];
    const msp = insight.msp;
    const hasChart = insight.chart && insight.chart.history && insight.chart.history.length >= 2;
    return `<div class="mkt-insight"${blockId ? ` id="${esc(blockId)}"` : ''}>
      <div class="mkt-insight__title">📊 Market Insight <span class="mkt-insight__tag">AI-assisted estimate</span></div>
      <div class="mkt-insight__body">Recent mandi reference (${esc(insight.market || 'nearby market')}, as of ${esc(insight.asOf)}): <b>${inr(insight.lo)}–${inr(insight.hi)} / quintal</b> (avg ${inr(insight.avg)}).
      This listing's price is <b>${verdictText}</b></div>
      ${msp ? `<div class="mkt-insight__msp">${msp.mandi_above_msp ? '✓' : '⚠'} Mandi price is <b>${msp.mandi_above_msp ? 'above' : 'below'} MSP</b> (₹${Math.round(msp.msp_inr_per_kg * 100).toLocaleString('en-IN')}/quintal, ${esc(msp.msp_year)}) by ${Math.abs(msp.mandi_msp_gap_pct)}%.</div>` : ''}
      ${hasChart ? `<div class="mkt-insight__chart-title">Price trend — actual &amp; ML forecast</div>
      <div class="mkt-insight__chart-wrap"><canvas id="${esc(chartId)}"></canvas></div>` : ''}
      <div class="mkt-insight__note">Reference only — not a guaranteed selling or buying price. ${msp ? 'MSP applies to government procurement, not open-market sales.' : ''}</div>
    </div>`;
  }

  /* ----------------------------------------------------------------------
     Sell Now vs. Hold — a seller-facing recommendation synthesized from the
     same real forecast data as Market Insight above, plus the Nearby Demand
     dataset. Shown only to the listing's own seller (in the Sell form and
     on their own listing's detail view) — a buyer has no use for it and it
     would read as odd advice out of context.
     Deliberately not a confident directive: forecast confidence erodes the
     further out it projects, so the copy stays hedged ("consider"), and a
     visible note names the underlying uncertainty rather than hiding it.
  ---------------------------------------------------------------------- */
  function demandMatchFor(cropId) {
    return DEMAND.find((d) => d.cropId === cropId) || null;
  }

  function sellHoldRecommendation(insight, cropId) {
    if (!insight.available || !insight.chart) return null;
    const hist = insight.chart.history, fcst = insight.chart.forecast;
    if (!hist.length || !fcst.length) return null;
    const last = hist[hist.length - 1].price;
    const future = fcst[fcst.length - 1].price;
    if (!last) return null;
    const pct = Math.round(((future - last) / last) * 1000) / 10;
    const demand = demandMatchFor(cropId);

    let verdict, headline, reason;
    if (pct >= 6) {
      verdict = 'hold'; headline = 'Consider Holding';
      reason = `Prices are forecast to rise ~${pct}% over the next ${fcst.length} month${fcst.length === 1 ? '' : 's'} — waiting may fetch a better price.`;
    } else if (pct <= -6) {
      verdict = 'sell_now'; headline = 'Sell Now';
      reason = `Prices are forecast to fall ~${Math.abs(pct)}% over the next ${fcst.length} month${fcst.length === 1 ? '' : 's'} — selling sooner may fetch a better price.`;
    } else {
      verdict = 'sell_now'; headline = 'Sell Now';
      reason = `Prices look broadly stable (${pct >= 0 ? '+' : ''}${pct}% forecast) — little reason to wait.`;
    }

    const demandNote = demand
      ? `🔥 ${demand.buyerCount} buyer${demand.buyerCount === 1 ? '' : 's'} nearby ${demand.buyerCount === 1 ? 'is' : 'are'} currently seeking ${esc(demand.name)} at ${inr(demand.priceRangeLow)}–${inr(demand.priceRangeHigh)}/quintal.`
      : null;

    return { verdict, headline, reason, pct, demandNote, monthsAhead: fcst.length };
  }

  function sellHoldHtml(rec, blockId) {
    if (!rec) return '';
    const ico = rec.verdict === 'hold' ? '⏳' : '✅';
    return `<div class="mkt-sellhold mkt-sellhold--${rec.verdict}"${blockId ? ` id="${esc(blockId)}"` : ''}>
      <div class="mkt-sellhold__badge">${ico} ${esc(rec.headline)}</div>
      <p>${esc(rec.reason)}</p>
      ${rec.demandNote ? `<p class="mkt-sellhold__demand">${rec.demandNote}</p>` : ''}
      <p class="mkt-note">AI trend estimate, ${rec.monthsAhead}-month outlook — confidence drops further into the forecast. Not a guarantee.</p>
    </div>`;
  }

  /* ----------------------------------------------------------------------
     Post-Harvest Credit Simulator — "don't sell in distress." Grounded in a
     real, currently-active Government of India scheme: the Credit Guarantee
     Scheme for e-NWR Based Pledge Financing (CGS-NPF, launched Dec 2024,
     run by NABARD/SFAC) — a farmer can pledge stored produce at a
     WDRA-registered warehouse and borrow up to 75% of its value at 7% p.a.
     subvented interest, instead of selling immediately at the documented
     15–25% harvest-time price trough. Deliberately does NOT invent specific
     warehouse names/addresses (WDRA publishes no public API, only static
     PDFs) — it links out to WDRA's own official locator instead, the same
     "don't fabricate what can't be verified" rule this app follows
     everywhere else. Only ever shown to a listing's own seller.
  ---------------------------------------------------------------------- */
  const CGS_NPF_LTV = 0.75;
  const CGS_NPF_RATE = 0.07;

  function creditSimulation(listing, rec) {
    const listingValue = Math.round((listing.quantityAvailable || 0) * (listing.pricePerUnit || 0));
    if (!listingValue) return null;
    const creditAmount = Math.round(listingValue * CGS_NPF_LTV);
    const monthsAhead = rec ? rec.monthsAhead : 3;
    const interestCost = Math.round(creditAmount * CGS_NPF_RATE * (monthsAhead / 12));
    const expectedGain = (rec && rec.verdict === 'hold' && rec.pct > 0) ? Math.round(listingValue * (rec.pct / 100)) : null;
    const netBenefit = expectedGain != null ? expectedGain - interestCost : null;
    return { listingValue, creditAmount, monthsAhead, interestCost, expectedGain, netBenefit };
  }

  function forwardBookingHtml(l) {
    const moqValue = Math.round((l.minOrderQty || 0) * (l.pricePerUnit || 0));
    const deposit = Math.round(moqValue * FORWARD_DEPOSIT_PCT);
    const balance = moqValue - deposit;
    return `<div class="mkt-forward-panel">
      <div class="mkt-forward-panel__badge">🌱 Forward Booking — Pre-Harvest Listing</div>
      <p>This produce hasn't been harvested yet (expected ${esc(l.harvestDate)}). A buyer can reserve it now with a ${Math.round(FORWARD_DEPOSIT_PCT * 100)}% deposit — for the ${l.minOrderQty} ${esc(l.unit)} minimum order that's about ${inr(deposit)} now, with the remaining ${inr(balance)} due at delivery.</p>
      <p class="mkt-note">The same forward-booking principle behind NCDEX's exchange-traded forwards ("Agrim Sauda") and eNAM's FPO trading module, applied to an individual listing. Deposits are illustrative in this prototype — no payment is actually collected.</p>
    </div>`;
  }

  function creditSimulatorHtml(sim, blockId) {
    if (!sim) return '';
    return `<div class="mkt-credit-sim"${blockId ? ` id="${esc(blockId)}"` : ''}>
      <div class="mkt-credit-sim__badge">💰 Post-Harvest Credit Option</div>
      <p>Instead of selling now, you could pledge this listing at a WDRA-registered warehouse and borrow up to <b>${inr(sim.creditAmount)}</b> (75% of its ${inr(sim.listingValue)} value) under the government's <b>e-NWR Pledge Financing scheme (CGS-NPF)</b>, at 7% p.a. subsidised interest — about ${inr(sim.interestCost)} over ${sim.monthsAhead} month${sim.monthsAhead === 1 ? '' : 's'}.</p>
      ${sim.netBenefit != null ? `<p class="mkt-credit-sim__net ${sim.netBenefit >= 0 ? 'mkt-credit-sim__net--pos' : 'mkt-credit-sim__net--neg'}">${sim.netBenefit >= 0 ? '✅' : '⚠️'} If prices move as forecast, waiting could net you about <b>${inr(Math.abs(sim.netBenefit))}</b> ${sim.netBenefit >= 0 ? 'more' : 'less'} than selling today, after loan interest.</p>` : ''}
      <a href="https://wdra.gov.in/registered-wh-public" target="_blank" rel="noopener noreferrer" class="btn btn-ghost mkt-btn-sm">Find a WDRA-registered warehouse ↗</a>
      <p class="mkt-note">Illustrative calculator based on the real Government of India CGS-NPF scheme (launched Dec 2024) — not a loan application and not affiliated with any lender. Actual eligibility, documentation, and warehouse charges apply; confirm with your nearest registered warehouse or bank. Government site URLs occasionally change — if this link 404s, search "WDRA registered warehouses" or start from <a href="https://wdra.gov.in" target="_blank" rel="noopener noreferrer">wdra.gov.in</a>.</p>
    </div>`;
  }

  async function renderPriceTrendChart(chartId, insight) {
    const canvas = document.getElementById(chartId);
    if (!canvas) return;
    const hist = (insight.chart && insight.chart.history) || [];
    const fcst = (insight.chart && insight.chart.forecast) || [];
    if (hist.length < 2) return;

    const histLabels = hist.map((h) => h.label);
    const fcstLabels = fcst.map((f) => f.label);
    const labels = histLabels.concat(fcstLabels);
    const histData = hist.map((h) => h.price).concat(fcstLabels.map(() => null));
    const fcstData = histLabels.slice(0, -1).map(() => null)
      .concat([hist[hist.length - 1].price])
      .concat(fcst.map((f) => f.price));

    await makeMktChart(canvas, {
      type: 'line',
      data: {
        labels,
        datasets: [
          { label: 'Historical', data: histData, borderColor: BRAND, backgroundColor: BRAND + '22', borderWidth: 2, pointRadius: 2, tension: 0.3, fill: true, spanGaps: false },
          { label: 'ML forecast', data: fcstData, borderColor: ACCENT, backgroundColor: ACCENT + '22', borderWidth: 2, borderDash: [6, 4], pointRadius: 2, tension: 0.3, fill: true, spanGaps: false },
        ],
      },
      options: {
        responsive: true, maintainAspectRatio: false,
        interaction: { mode: 'index', intersect: false },
        scales: {
          y: { grid: { color: 'rgba(29,26,21,.06)' }, ticks: { callback: (v) => '₹' + v, font: { size: 10 } } },
          x: { grid: { display: false }, ticks: { maxRotation: 0, autoSkip: true, font: { size: 10 } } },
        },
        plugins: {
          legend: { position: 'bottom', labels: { boxWidth: 10, padding: 8, font: { size: 10 } } },
          tooltip: { callbacks: { label: (c) => `${c.dataset.label}: ${inr(c.parsed.y)}/quintal` } },
        },
      },
    });
  }

  /* ----------------------------------------------------------------------
     Product detail modal — info, calculator, market insight, request-to-buy
  ---------------------------------------------------------------------- */
  const overlay = () => document.getElementById('mktDetailOverlay');
  const card = () => document.getElementById('mktDetailCard');

  function closeDetail() {
    const o = overlay();
    if (o) o.classList.remove('open');
    state.detailId = null;
  }

  function openDetail(id) {
    const l = findListing(id);
    if (!l) return;
    state.detailId = id;
    if (!isMine(l)) bumpView(id);
    renderDetail(l, 'info');
    overlay().classList.add('open');
  }

  function reviewsFor(listingId) {
    return getReviews().filter((r) => r.listingId === listingId);
  }

  function avgRating(listingId) {
    const rs = reviewsFor(listingId);
    if (!rs.length) return null;
    return (rs.reduce((a, b) => a + b.rating, 0) / rs.length).toFixed(1);
  }

  /* ----------------------------------------------------------------------
     Seller profile — a seller's other active listings + reviews across all
     of them. Opened from the "View all listings from …" link in the detail
     modal; closes the detail modal first since both share the same overlay
     layer conceptually (only one product-related modal open at a time).
  ---------------------------------------------------------------------- */
  /* ----------------------------------------------------------------------
     Verified Field Health — a real call to the existing /api/field/ndvi
     endpoint (satellite-style NDVI estimate), keyed off the seller's own
     listing location. Works identically for demo and real sellers since
     every listing already carries real lat/lon — no fabricated numbers,
     same disclaimer language the endpoint itself returns.
  ---------------------------------------------------------------------- */
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

  function fieldHealthHtml(fh) {
    if (!fh) return '<p class="mkt-note">Field health data isn\'t available for this location right now.</p>';
    const s = String(fh.health_status || '');
    const statusCls = /high stress/i.test(s) ? 'poor' : /moderate/i.test(s) ? 'moderate' : /vibrant|healthy/i.test(s) ? 'good' : 'moderate';
    return `<div class="mkt-fieldhealth mkt-fieldhealth--${esc(statusCls)}">
      <div class="mkt-fieldhealth__badge">🌱 Verified Field Health · <b>${esc(fh.health_status || '—')}</b></div>
      <div class="mkt-fieldhealth__stats">
        <span>NDVI index <b>${Number(fh.mean_ndvi).toFixed(2)}</b></span>
        <span>Canopy cover <b>${Math.round(fh.canopy_cover_pct)}%</b></span>
      </div>
      <p class="mkt-note">Satellite-style vegetation estimate for this farm's location, computed by the same field-health engine used elsewhere in MittiMantra — an estimate, not a live satellite pass or a seller's own claim.</p>
    </div>`;
  }

  function closeSellerProfile() {
    const o = document.getElementById('mktSellerOverlay');
    if (o) o.classList.remove('open');
  }

  function openSellerProfile(sellerId, sellerName) {
    closeDetail();
    const overlay2 = document.getElementById('mktSellerOverlay');
    const card2 = document.getElementById('mktSellerCard');
    if (!overlay2 || !card2) return;

    const listings = browsableListings().filter((l) => l.sellerId === sellerId);
    const allReviews = listings.flatMap((l) => reviewsFor(l.id));
    const avg = allReviews.length ? (allReviews.reduce((a, b) => a + b.rating, 0) / allReviews.length).toFixed(1) : null;
    const sample = listings[0];

    card2.innerHTML = `
      <button class="mm-modal-close" id="mktSellerClose" aria-label="Close">✕</button>
      <div class="mkt-seller-profile">
        <h2>${esc(sellerName)}</h2>
        <div class="mkt-detail__chips">
          ${sample?.verified ? '<span class="mkt-verified-badge">✓ Verified Farmer</span>' : '<span class="mkt-pending-badge">Verification pending</span>'}
          ${sample && isDemoListing(sample) ? '<span class="chip">Demo seller</span>' : ''}
        </div>
        <div class="mkt-detail__seller-stats" style="margin:10px 0 6px;">
          <span>⭐ ${avg || sample?.sellerRating || '—'} (${allReviews.length} review${allReviews.length === 1 ? '' : 's'})</span>
          <span>📦 ${listings.length} active listing${listings.length === 1 ? '' : 's'}</span>
          <span>🗓 Member since ${esc(sample?.sellerSince || '—')}</span>
        </div>
        ${sample && isDemoListing(sample) ? '<p class="mkt-note">Demo seller — profile stats are illustrative sample data.</p>' : ''}
        <div id="mktSellerFieldHealth" class="mkt-insight mkt-insight--loading">🌱 Checking field health…</div>
        <h4 class="mkt-seller-profile__h4">Listings</h4>
        <div class="mkt-grid mkt-seller-profile__grid">${listings.map(cardHtml).join('') || '<p class="mkt-note">No other active listings right now.</p>'}</div>
        ${allReviews.length ? `<h4 class="mkt-seller-profile__h4">Reviews</h4><div class="mkt-reviews">${allReviews.map((r) => `
          <div class="mkt-review"><div class="mkt-review__stars">${'⭐'.repeat(r.rating)}</div><p>${esc(r.comment)}</p><small>${esc(r.productName)} · ${esc(new Date(r.createdAt).toLocaleDateString('en-IN'))}</small></div>`).join('')}</div>` : ''}
      </div>`;

    document.getElementById('mktSellerClose').addEventListener('click', closeSellerProfile);
    card2.querySelectorAll('.mkt-card').forEach((c) => {
      c.addEventListener('click', () => { closeSellerProfile(); openDetail(c.dataset.id); });
    });
    overlay2.classList.add('open');

    if (sample && typeof sample.lat === 'number' && typeof sample.lon === 'number') {
      fetchFieldHealth(sample.lat, sample.lon, sample.cropId, 4).then((fh) => {
        const host = document.getElementById('mktSellerFieldHealth');
        if (host) host.outerHTML = fieldHealthHtml(fh);
      });
    } else {
      const host = document.getElementById('mktSellerFieldHealth');
      if (host) host.outerHTML = '';
    }
  }

  function renderDetail(l, screen, extra) {
    const mine = isMine(l);
    const avail = availabilityLabel(l);
    const forward = isForwardListing(l);
    const dist = distanceTo(l);
    const rating = avgRating(l.id);
    const rs = reviewsFor(l.id);

    if (screen === 'request-success') {
      card().innerHTML = `
        <button class="mm-modal-close" id="mktDetailClose" aria-label="Close">✕</button>
        <div class="mm-success-screen">
          <div class="mm-success-icon">✓</div>
          <h3>Request Sent</h3>
          <p>Your request for <strong>${esc(l.name)}</strong> has been recorded. Track it any time under <strong>My Requests</strong>.</p>
          <div class="mm-success-details">
            <div class="mm-success-row"><span>Request ID</span><strong>${esc(extra.order.id)}</strong></div>
            <div class="mm-success-row"><span>Quantity requested</span><strong>${extra.order.requestedQuantity} ${esc(l.unit)}</strong></div>
            <div class="mm-success-row"><span>Estimated total</span><strong>${inr(extra.order.requestedQuantity * l.pricePerUnit)}</strong></div>
            <div class="mm-success-row"><span>Status</span><strong>Requested</strong></div>
          </div>
          <p class="mkt-note">Demo: this app has no live backend, so the seller can't be notified automatically. Open <strong>My Requests</strong> to simulate the seller's response for demonstration.</p>
          <button class="mm-form-submit" id="mktGoRequests" style="margin-top:10px;">View My Requests</button>
        </div>`;
      document.getElementById('mktDetailClose').addEventListener('click', closeDetail);
      document.getElementById('mktGoRequests').addEventListener('click', () => { closeDetail(); switchView('my-requests'); });
      return;
    }

    if (screen === 'request-form') {
      const qty = extra && extra.qty ? extra.qty : l.minOrderQty;
      const bulk = qty > l.quantityAvailable;
      card().innerHTML = `
        <button class="mm-modal-close" id="mktDetailClose" aria-label="Close">✕</button>
        <div class="mm-modal-header">
          <h3>${forward ? '🌱 Pre-Book This Harvest' : bulk ? 'Request Bulk Supply' : 'Request to Buy'}</h3>
          <p>${esc(l.name)} · ${esc(l.variety || '')} · ${esc(l.sellerName)}</p>
        </div>
        <form class="mm-modal-body" id="mktRequestForm">
          ${forward ? `<div class="mkt-alert mkt-alert--info">This is a forward booking — the produce is expected to be harvested ${esc(l.harvestDate)}. A ${Math.round(FORWARD_DEPOSIT_PCT * 100)}% deposit reserves it now; the rest is due at delivery.</div>` : ''}
          ${bulk ? `<div class="mkt-alert">Your requested quantity (${qty} ${esc(l.unit)}) exceeds this seller's available stock (${l.quantityAvailable} ${esc(l.unit)}). You can still send the request — the seller may arrange additional supply — or <a href="#" id="mktSimilarSellers" style="color:var(--brand);font-weight:700;">view similar ${esc(l.name)} sellers</a>.</div>` : ''}
          <fieldset id="reqStep1" class="mkt-form-step">
            <div class="mkt-step-label">Step 1 of 2 · Your details</div>
            <div class="mm-form-row">
              <div class="mm-form-group"><label>Your Name</label><input type="text" id="reqName" class="mm-form-input" required placeholder="e.g. Anil Sharma"></div>
              <div class="mm-form-group"><label>Mobile Number</label><input type="tel" id="reqPhone" class="mm-form-input" pattern="[6-9][0-9]{9}" required placeholder="10-digit mobile"></div>
            </div>
            <div class="mm-form-row">
              <div class="mm-form-group"><label>Buyer Type</label>
                <select id="reqBuyerType" class="mm-form-input">
                  <option>Individual consumer</option><option>Retailer</option><option>Restaurant</option>
                  <option>Wholesaler</option><option>Food processor</option><option>Trader</option><option>Other business</option>
                </select>
              </div>
              <div class="mm-form-group"><label>Quantity (${esc(l.unit)})</label><input type="number" id="reqQty" class="mm-form-input" min="${l.minOrderQty}" step="1" value="${qty}" required></div>
            </div>
            <div class="mm-calc-box">
              <div class="mm-calc-row"><span>Listed price</span><span>${inr(l.pricePerUnit)} / ${esc(l.unit)}</span></div>
              <div class="mm-calc-row"><span>Quantity</span><span id="reqCalcQty">${qty} ${esc(l.unit)}</span></div>
              <div class="mm-calc-row total"><span>Estimated total</span><span id="reqCalcTotal">${inr(qty * l.pricePerUnit)}</span></div>
              ${forward ? `
              <div class="mm-calc-row"><span>Deposit due now (${Math.round(FORWARD_DEPOSIT_PCT * 100)}%)</span><span id="reqCalcDeposit">${inr(Math.round(qty * l.pricePerUnit * FORWARD_DEPOSIT_PCT))}</span></div>
              <div class="mm-calc-row"><span>Balance due at delivery</span><span id="reqCalcBalance">${inr(qty * l.pricePerUnit - Math.round(qty * l.pricePerUnit * FORWARD_DEPOSIT_PCT))}</span></div>` : ''}
            </div>
            <button type="button" class="mm-form-submit" id="reqNextBtn">Continue →</button>
          </fieldset>
          <fieldset id="reqStep2" class="mkt-form-step" style="display:none;">
            <div class="mkt-step-label">Step 2 of 2 · Delivery &amp; payment</div>
            <div class="mm-form-row">
              <div class="mm-form-group"><label>Delivery Responsibility</label>
                <select id="reqDelivery" class="mm-form-input">
                  <option value="farmer_pickup">Farmer pickup (buyer collects)</option>
                  <option value="buyer_transport">Buyer-arranged transport</option>
                  <option value="platform_assisted">Platform-assisted logistics (coming soon)</option>
                </select>
              </div>
              <div class="mm-form-group"><label>Payment Method</label>
                <select id="reqPayment" class="mm-form-input">
                  <option value="upi">UPI on pickup/delivery</option>
                  <option value="cod">Cash on pickup/delivery</option>
                  <option value="fpo_assisted">Assisted via local FPO/agent</option>
                </select>
              </div>
            </div>
            <p class="mkt-note">No platform or service fee is applied in this demo. Payment status stays <b>Pending</b> until the transaction is confirmed offline.</p>
            <div class="mkt-step-actions">
              <button type="button" class="btn btn-ghost" id="reqBackBtn">← Back</button>
              <button type="submit" class="mm-form-submit">${forward ? 'Pre-Book This Harvest' : bulk ? 'Send Bulk Supply Request' : 'Send Request'}</button>
            </div>
          </fieldset>
        </form>`;
      document.getElementById('mktDetailClose').addEventListener('click', closeDetail);
      document.getElementById('reqNextBtn').addEventListener('click', () => {
        const step1 = document.getElementById('reqStep1');
        if (!step1.reportValidity()) return;
        step1.style.display = 'none';
        document.getElementById('reqStep2').style.display = '';
      });
      document.getElementById('reqBackBtn').addEventListener('click', () => {
        document.getElementById('reqStep2').style.display = 'none';
        document.getElementById('reqStep1').style.display = '';
      });
      const similarBtn = document.getElementById('mktSimilarSellers');
      if (similarBtn) {
        similarBtn.addEventListener('click', (ev) => {
          ev.preventDefault();
          closeDetail();
          state.filters.q = l.name;
          const search = document.getElementById('mktSearch');
          if (search) search.value = l.name;
          switchView('browse');
        });
      }
      const qtyInput = document.getElementById('reqQty');
      const recalc = () => {
        const q = Math.max(1, Number(qtyInput.value) || 1);
        document.getElementById('reqCalcQty').textContent = `${q} ${l.unit}`;
        document.getElementById('reqCalcTotal').textContent = inr(q * l.pricePerUnit);
        if (forward) {
          const total = q * l.pricePerUnit;
          const dep = Math.round(total * FORWARD_DEPOSIT_PCT);
          document.getElementById('reqCalcDeposit').textContent = inr(dep);
          document.getElementById('reqCalcBalance').textContent = inr(total - dep);
        }
      };
      qtyInput.addEventListener('input', recalc);
      document.getElementById('mktRequestForm').addEventListener('submit', (ev) => {
        ev.preventDefault();
        const q = Math.max(1, Number(qtyInput.value) || 1);
        const total = q * l.pricePerUnit;
        const order = {
          id: 'REQ-' + Math.random().toString(36).slice(2, 8).toUpperCase(),
          listingId: l.id, sellerId: l.sellerId, sellerName: l.sellerName,
          buyerId: deviceId(),
          buyerName: document.getElementById('reqName').value.trim(),
          buyerPhone: document.getElementById('reqPhone').value.trim(),
          buyerType: document.getElementById('reqBuyerType').value,
          productName: l.name, unit: l.unit,
          requestedQuantity: q, offeredPrice: l.pricePerUnit, finalPrice: null,
          status: 'REQUESTED',
          bookingType: forward ? 'forward' : 'standard',
          depositAmount: forward ? Math.round(total * FORWARD_DEPOSIT_PCT) : null,
          balanceAmount: forward ? total - Math.round(total * FORWARD_DEPOSIT_PCT) : null,
          expectedHarvestDate: forward ? l.harvestDate : null,
          deliveryResponsibility: document.getElementById('reqDelivery').value,
          pickupLocation: `${l.village || ''}${l.village ? ', ' : ''}${l.district}, ${l.state}`,
          deliveryLocation: (myLocation && window.FarmState && window.FarmState.load()) ? (window.FarmState.load().district || 'Buyer location on file') : 'Not specified',
          paymentMethod: document.getElementById('reqPayment').value,
          paymentStatus: 'NOT_REQUIRED',
          createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
        };
        const orders = getMyOrders(); orders.unshift(order); saveMyOrders(orders);
        renderDetail(l, 'request-success', { order });
      });
      return;
    }

    // ---- default "info" screen ----
    const gallery = allImages(l);
    const insightHost = `<div id="mktInsightHost" class="mkt-insight mkt-insight--loading">📊 Loading market insight…</div>`;
    card().innerHTML = `
      <button class="mm-modal-close" id="mktDetailClose" aria-label="Close">✕</button>
      <div class="mkt-detail">
        <div class="mkt-detail__media mkt-card__media--${esc(l.category)}">
          ${gallery[0]
            ? `<img id="mktDetailMainImg" src="${esc(gallery[0])}" alt="${esc(l.name)}" loading="lazy" onerror="this.style.display='none';this.nextElementSibling.style.display='flex';">
               <span class="mkt-card__ico" style="font-size:64px;display:none;">${catIcon(l.category)}</span>`
            : `<span class="mkt-card__ico" style="font-size:64px;">${catIcon(l.category)}</span>`}
          <span class="mkt-card__avail mkt-card__avail--${avail.cls}">${avail.text}</span>
        </div>
        ${gallery.length > 1 ? `<div class="mkt-detail__thumbs">${gallery.map((src, i) => `<button type="button" class="mkt-detail__thumb ${i === 0 ? 'active' : ''}" data-src="${esc(src)}"><img src="${esc(src)}" alt="Photo ${i + 1}" loading="lazy"></button>`).join('')}</div>` : ''}
        <div class="mkt-detail__body">
          <h2>${esc(l.name)} <small>${esc(l.variety || '')}</small></h2>
          <div class="mkt-detail__chips">
            <span class="chip chip--green">${esc(l.grade)}</span>
            ${l.organic ? '<span class="chip chip--green">Organic</span>' : ''}
            <span class="chip">${catLabel(l.category)}</span>
          </div>
          <p class="mkt-detail__desc">${esc(l.description || '')}</p>

          <div class="mkt-detail__kpis">
            <div class="kpi"><div class="kpi__lbl">Price</div><div class="kpi__val" style="font-size:1.2rem;">${inr(l.pricePerUnit)}<small style="font-size:.55em;">/${esc(l.unit)}</small></div></div>
            <div class="kpi"><div class="kpi__lbl">Available</div><div class="kpi__val" style="font-size:1.2rem;">${Number(l.quantityAvailable).toLocaleString('en-IN')} <small style="font-size:.55em;">${esc(l.unit)}</small></div></div>
            <div class="kpi"><div class="kpi__lbl">Min. order</div><div class="kpi__val" style="font-size:1.2rem;">${l.minOrderQty} <small style="font-size:.55em;">${esc(l.unit)}</small></div></div>
          </div>

          <div class="mkt-detail__meta">
            <div>${forward ? `🌱 Expected harvest: <b>${esc(l.harvestDate)}</b>` : `📅 Harvested: <b>${esc(l.harvestDate)}</b>`}</div>
            <div>🚚 ${forward ? 'Delivery from' : 'Available from'}: <b>${esc(l.expectedAvailability)}</b></div>
            <div>📍 ${esc(l.village ? l.village + ', ' : '')}${esc(l.district)}, ${esc(l.state)}${dist != null ? ` · <b>${dist} km away</b>` : ''}</div>
          </div>

          ${forward ? forwardBookingHtml(l) : ''}

          ${insightHost}

          <div class="mkt-detail__seller">
            <div class="mkt-detail__seller-head">
              <strong>${esc(l.sellerName)}</strong>
              ${l.verified ? '<span class="mkt-verified-badge">✓ Verified Farmer</span>' : '<span class="mkt-pending-badge">Verification pending</span>'}
            </div>
            <div class="mkt-detail__seller-stats">
              <span>⭐ ${rating || l.sellerRating || '—'} (${rs.length} demo review${rs.length === 1 ? '' : 's'})</span>
              <span>📦 ${l.sellerOrders ?? 0} past orders</span>
              <span>💬 ${l.sellerResponseRate ?? '—'}% response rate</span>
              <span>🗓 Member since ${esc(l.sellerSince || '—')}</span>
            </div>
            ${isDemoListing(l) ? '<p class="mkt-note" style="margin-top:6px;">Demo seller — profile stats are illustrative sample data, not a live seller record.</p>' : ''}
            <div id="mktDetailFieldHealth" class="mkt-insight mkt-insight--loading" style="margin-top:8px;">🌱 Checking field health…</div>
            ${!mine ? `<button type="button" class="btn btn-ghost mkt-btn-sm" id="mktViewSeller" style="margin-top:8px;">View all listings from ${esc(l.sellerName)}</button>` : ''}
          </div>

          ${rs.length ? `<div class="mkt-reviews">${rs.map((r) => `
            <div class="mkt-review"><div class="mkt-review__stars">${'⭐'.repeat(r.rating)}</div><p>${esc(r.comment)}</p><small>${esc(r.productName)} · ${esc(new Date(r.createdAt).toLocaleDateString('en-IN'))}</small></div>`).join('')}</div>` : ''}

          ${(() => { const pool = poolForListing(l.id); return pool ? poolSectionHtml(pool, l, mine) : ''; })()}

          ${!mine ? `<div class="mkt-detail__calc">
            <h4>Order Calculator</h4>
            <label class="mkt-detail__calc-row"><span>Quantity (${esc(l.unit)})</span><input type="number" id="calcQty" min="${l.minOrderQty}" step="1" value="${l.minOrderQty}"></label>
            <div class="mm-calc-box">
              <div class="mm-calc-row"><span>${inr(l.pricePerUnit)} × <span id="calcQtyEcho">${l.minOrderQty}</span> ${esc(l.unit)}</span><span></span></div>
              <div class="mm-calc-row"><span>Platform / service fee</span><span>Not applicable (demo)</span></div>
              <div class="mm-calc-row total"><span>Estimated total</span><span id="calcTotal">${inr(l.minOrderQty * l.pricePerUnit)}</span></div>
            </div>
            <p class="mkt-note">Estimated. Final price is agreed with the seller directly.</p>
          </div>` : ''}

          ${mine ? `<div class="mkt-alert mkt-alert--info">This is your own listing — manage it from <b>My Listings</b>.</div>` :
            `<div class="mkt-detail__actions">
              <button type="button" class="btn btn-ghost" id="mktContactBtn">📞 Contact Seller</button>
              <button type="button" class="btn btn-ghost" id="mktAddToCartBtn">🧺 Add to Cart</button>
              <button type="button" class="btn btn-primary" id="mktRequestBtn">${forward ? '🌱 Pre-Book This Harvest' : 'Request to Buy'}</button>
            </div>`}
        </div>
      </div>`;

    document.getElementById('mktDetailClose').addEventListener('click', closeDetail);
    document.querySelectorAll('.mkt-detail__thumb').forEach((btn) => {
      btn.addEventListener('click', () => {
        const mainImg = document.getElementById('mktDetailMainImg');
        if (mainImg) mainImg.src = btn.dataset.src;
        document.querySelectorAll('.mkt-detail__thumb').forEach((b) => b.classList.toggle('active', b === btn));
      });
    });
    const qtyEl = document.getElementById('calcQty');
    if (qtyEl) {
      qtyEl.addEventListener('input', () => {
        const q = Math.max(1, Number(qtyEl.value) || 1);
        document.getElementById('calcQtyEcho').textContent = q;
        document.getElementById('calcTotal').textContent = inr(q * l.pricePerUnit);
      });
    }

    if (!mine) {
      document.getElementById('mktRequestBtn').addEventListener('click', () => {
        const q = Math.max(1, Number(qtyEl.value) || l.minOrderQty);
        renderDetail(l, 'request-form', { qty: q });
      });
      document.getElementById('mktContactBtn').addEventListener('click', () => {
        toast(`Demo contact: ${l.sellerName} would be reachable here once messaging is connected.`);
      });
      document.getElementById('mktAddToCartBtn').addEventListener('click', () => {
        const q = Math.max(l.minOrderQty, Number(qtyEl.value) || l.minOrderQty);
        addToCart(l.id, q);
        toast(`Added ${q} ${l.unit} of ${l.name} to cart`);
      });
      const viewSellerBtn = document.getElementById('mktViewSeller');
      if (viewSellerBtn) viewSellerBtn.addEventListener('click', () => openSellerProfile(l.sellerId, l.sellerName));

      const poolBtn = document.getElementById('mktPoolRequestBtn');
      if (poolBtn) {
        poolBtn.addEventListener('click', () => {
          const pool = poolForListing(l.id);
          if (!pool) return;
          const members = poolMembers(pool);
          members.forEach((m) => addToCart(m.id, m.minOrderQty));
          toast(`Added all ${members.length} pooled listings to cart`);
          closeDetail();
          switchView('cart');
        });
      }
    }

    // "You might also consider" — same crop from other sellers, always visible
    // (not just when the buyer's requested quantity exceeds stock).
    const alternates = browsableListings().filter((o) => o.cropId === l.cropId && o.id !== l.id).slice(0, 3);
    if (alternates.length) {
      const stripHost = document.createElement('div');
      stripHost.className = 'mkt-similar';
      stripHost.innerHTML = `<h4>Other ${esc(l.name)} listings</h4><div class="mkt-similar__row">${alternates.map((o) => `
        <button type="button" class="mkt-similar__card" data-similar="${esc(o.id)}">
          <strong>${inr(o.pricePerUnit)}/${esc(o.unit)}</strong>
          <span>${esc(o.sellerName)}${o.verified ? ' ✓' : ''}</span>
          <span>${esc(o.district)}, ${esc(o.state)}</span>
        </button>`).join('')}</div>`;
      card().querySelector('.mkt-detail__body')?.appendChild(stripHost);
      stripHost.querySelectorAll('[data-similar]').forEach((btn) => {
        btn.addEventListener('click', () => openDetail(btn.dataset.similar));
      });
    }

    fetchMarketInsight(l.regionId, l.cropId, l.pricePerUnit).then((insight) => {
      const host = document.getElementById('mktInsightHost');
      if (!host) return;
      host.outerHTML = marketInsightHtml(insight, 'mktInsightChart', 'mktInsightBlock');
      renderPriceTrendChart('mktInsightChart', insight);
      if (mine) {
        const rec = sellHoldRecommendation(insight, l.cropId);
        const blockEl = document.getElementById('mktInsightBlock');
        if (rec && blockEl) blockEl.insertAdjacentHTML('afterend', sellHoldHtml(rec, 'mktSellHoldBlock'));
        const sim = creditSimulation(l, rec);
        const afterEl = document.getElementById('mktSellHoldBlock') || blockEl;
        if (sim && afterEl) afterEl.insertAdjacentHTML('afterend', creditSimulatorHtml(sim));
      }
    });

    if (typeof l.lat === 'number' && typeof l.lon === 'number') {
      fetchFieldHealth(l.lat, l.lon, l.cropId, 4).then((fh) => {
        const fhHost = document.getElementById('mktDetailFieldHealth');
        if (fhHost) fhHost.outerHTML = fieldHealthHtml(fh);
      });
    } else {
      const fhHost = document.getElementById('mktDetailFieldHealth');
      if (fhHost) fhHost.remove();
    }
  }

  /* ----------------------------------------------------------------------
     Voice-first listing creation — speak a sentence like "20 quintals of
     onion, price 1800 rupees" and auto-fill the sell form. Uses the
     browser's built-in Web Speech API (no server-side transcription), and
     the recognition language follows whatever language the rest of the
     site is already set to (window.AgriSimI18n), so this isn't a separate
     language choice the farmer has to make. Chrome-family browsers only —
     the button disables itself with an explanation everywhere else, and
     recognition needs network access, so it's an optional enhancement on
     top of the typed form, never a replacement (this app also promises
     offline support, which speech recognition can't honor).
  ---------------------------------------------------------------------- */
  function speechLocaleFor(lang) {
    return { en: 'en-IN', hi: 'hi-IN', te: 'te-IN', kn: 'kn-IN' }[lang] || 'en-IN';
  }

  const UNIT_WORDS = { kg: 'kg', kgs: 'kg', kilo: 'kg', kilos: 'kg', kilogram: 'kg', kilograms: 'kg',
    quintal: 'quintal', quintals: 'quintal', tonne: 'tonne', tonnes: 'tonne', ton: 'tonne', tons: 'tonne' };

  function parseVoiceListing(transcript) {
    const lower = transcript.toLowerCase();
    const out = {};

    const cropNames = Array.from(new Set(DEMO_LISTINGS.map((l) => l.name)))
      .sort((a, b) => b.length - a.length); // longest name first so "basmati rice" beats "rice"
    for (const name of cropNames) {
      if (lower.includes(name.toLowerCase())) {
        const match = DEMO_LISTINGS.find((l) => l.name === name);
        out.name = name; out.cropId = match.cropId; out.category = match.category;
        break;
      }
    }

    const qtyMatch = lower.match(/(\d+(?:\.\d+)?)\s*(kgs?|kilo(?:gram)?s?|quintals?|tonnes?|tons?)\b/);
    if (qtyMatch) {
      out.quantity = Number(qtyMatch[1]);
      out.unit = UNIT_WORDS[qtyMatch[2]] || 'quintal';
    }

    const priceMatch = lower.match(/(?:₹|rs\.?|rupees?|price)\s*(\d+(?:\.\d+)?)/) ||
      lower.match(/(\d+(?:\.\d+)?)\s*(?:₹|rs\.?|rupees?)/);
    if (priceMatch) out.price = Number(priceMatch[1]);

    return out;
  }

  function applyVoiceListing(transcript) {
    const status = document.getElementById('mktVoiceStatus');
    const parsed = parseVoiceListing(transcript);
    const filled = [];

    if (parsed.name) {
      const nameEl = document.getElementById('selName');
      const catEl = document.getElementById('selCategory');
      if (nameEl) { nameEl.value = parsed.name; filled.push(parsed.name); }
      if (catEl && parsed.category) catEl.value = parsed.category;
    }
    if (parsed.quantity) {
      const qtyEl = document.getElementById('selQty');
      const unitEl = document.getElementById('selUnit');
      if (qtyEl) { qtyEl.value = parsed.quantity; filled.push(`${parsed.quantity} ${parsed.unit || ''}`.trim()); }
      if (unitEl && parsed.unit) unitEl.value = parsed.unit;
    }
    if (parsed.price) {
      const priceEl = document.getElementById('selPrice');
      if (priceEl) { priceEl.value = parsed.price; filled.push(`₹${parsed.price}`); }
    }

    if (status) {
      status.textContent = filled.length
        ? `Heard: "${transcript}" — filled ${filled.join(', ')}. Please review before publishing.`
        : `Heard: "${transcript}" — couldn't confidently match any fields, please fill in manually.`;
    }
    const priceEl = document.getElementById('selPrice');
    if (priceEl && parsed.price) priceEl.dispatchEvent(new Event('change'));
  }

  function initVoiceInput() {
    const btn = document.getElementById('mktVoiceBtn');
    const status = document.getElementById('mktVoiceStatus');
    if (!btn) return;
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR) {
      btn.disabled = true;
      btn.title = 'Voice input needs a browser with speech recognition support (e.g. Chrome)';
      if (status) status.textContent = 'Voice input isn\'t supported in this browser — type your listing below.';
      return;
    }
    let recognition = null;
    let listening = false;
    btn.addEventListener('click', () => {
      if (listening) { if (recognition) recognition.stop(); return; }
      recognition = new SR();
      recognition.lang = speechLocaleFor(window.AgriSimI18n ? window.AgriSimI18n.getLanguage() : 'en');
      recognition.interimResults = false;
      recognition.maxAlternatives = 1;
      recognition.onstart = () => {
        listening = true;
        btn.classList.add('listening');
        btn.textContent = '🔴 Listening… tap to stop';
        if (status) status.textContent = 'Speak now — crop, quantity, unit, and price.';
      };
      recognition.onresult = (ev) => applyVoiceListing(ev.results[0][0].transcript);
      recognition.onerror = () => { if (status) status.textContent = 'Could not hear that clearly — please try again or type below.'; };
      recognition.onend = () => {
        listening = false;
        btn.classList.remove('listening');
        btn.textContent = '🎤 Speak your listing';
      };
      try { recognition.start(); } catch (_) { listening = false; }
    });
  }

  /* ----------------------------------------------------------------------
     Sell Produce form
  ---------------------------------------------------------------------- */
  function renderSellForm() {
    const host = $('#mktSellHost');
    if (!host) return;
    const editing = state.editListingId ? getMyListings().find((l) => l.id === state.editListingId) : null;
    const seller = getSellerProfile() || {};
    const farm = (window.FarmState && window.FarmState.load()) || null;
    let uploadedImages = editing ? allImages(editing).slice() : [];

    host.innerHTML = `
      <form id="mktSellForm" class="mkt-sell-form" data-form>
        <h3>${editing ? 'Edit Listing' : 'Sell Your Produce'}</h3>
        <p class="mkt-sell-sub">${editing ? 'Update the details buyers see for this listing.' : "Tell us what you're harvesting — takes about a minute."}</p>

        <div class="mkt-voice-bar" id="mktVoiceBar">
          <button type="button" class="mkt-voice-btn" id="mktVoiceBtn">🎤 Speak your listing</button>
          <span class="mkt-voice-status" id="mktVoiceStatus">Try: "20 quintals of onion, price 1800 rupees"</span>
        </div>

        <div class="mkt-sell-section">
          <h4>Product</h4>
          <div class="mm-form-row">
            <div class="mm-form-group"><label>Category</label>
              <select id="selCategory" class="mm-form-input" required>
                ${CATEGORIES.map((c) => `<option value="${c.id}" ${editing?.category === c.id ? 'selected' : ''}>${c.icon} ${c.label}</option>`).join('')}
              </select>
            </div>
            <div class="mm-form-group"><label>Crop / Product name</label><input type="text" id="selName" class="mm-form-input" required placeholder="e.g. Rice, Tomato" value="${esc(editing?.name || '')}"></div>
          </div>
          <div class="mm-form-row">
            <div class="mm-form-group"><label>Variety</label><input type="text" id="selVariety" class="mm-form-input" placeholder="e.g. Sona Masuri" value="${esc(editing?.variety || '')}"></div>
            <div class="mm-form-group"><label>Grade</label>
              <select id="selGrade" class="mm-form-input">${GRADES.map((g) => `<option ${editing?.grade === g ? 'selected' : ''}>${g}</option>`).join('')}</select>
            </div>
          </div>
          <div class="mm-form-group"><label>Description</label><textarea id="selDesc" class="mm-form-input" rows="2" placeholder="Moisture, cleaning, storage, anything a buyer should know">${esc(editing?.description || '')}</textarea></div>
          <label class="mkt-check"><input type="checkbox" id="selOrganic" ${editing?.organic ? 'checked' : ''}> Grown organically</label>
          <div class="mm-form-group">
            <label>Product Photos (optional, up to ${MAX_LISTING_PHOTOS})</label>
            <input type="file" accept="image/*" multiple id="selPhotoInput" class="mm-form-input">
            <div class="mkt-photo-strip" id="selPhotoStrip"></div>
            <p class="mkt-note">Photos are resized and kept on this device only — there's no image upload server in this prototype, so they won't appear on other devices.</p>
          </div>
        </div>

        <div class="mkt-sell-section">
          <h4>Quantity</h4>
          <div class="mm-form-row">
            <div class="mm-form-group"><label>Available quantity</label><input type="number" id="selQty" class="mm-form-input" min="0.1" step="0.1" required value="${editing?.quantityAvailable ?? ''}"></div>
            <div class="mm-form-group"><label>Unit</label>
              <select id="selUnit" class="mm-form-input">
                <option value="kg" ${editing?.unit === 'kg' ? 'selected' : ''}>kg</option>
                <option value="quintal" ${!editing || editing.unit === 'quintal' ? 'selected' : ''}>quintal</option>
                <option value="tonne" ${editing?.unit === 'tonne' ? 'selected' : ''}>tonne</option>
              </select>
            </div>
            <div class="mm-form-group"><label>Minimum order quantity</label><input type="number" id="selMoq" class="mm-form-input" min="0.1" step="0.1" required value="${editing?.minOrderQty ?? ''}"></div>
          </div>
        </div>

        <div class="mkt-sell-section">
          <h4>Pricing</h4>
          <div class="mm-form-row">
            <div class="mm-form-group"><label>Price per unit (₹)</label><input type="number" id="selPrice" class="mm-form-input" min="1" step="1" required value="${editing?.pricePerUnit ?? ''}"></div>
            <div class="mm-form-group">
              <label>Pricing type</label>
              <select class="mm-form-input" disabled title="Negotiable pricing is planned for a future release">
                <option>Fixed price</option>
                <option disabled>Negotiable (coming soon)</option>
              </select>
            </div>
          </div>
          <div id="selPricingInsight"></div>
        </div>

        <div class="mkt-sell-section">
          <h4>Harvest</h4>
          <div class="mm-form-row">
            <div class="mm-form-group"><label>Harvest date</label><input type="date" id="selHarvest" class="mm-form-input" required value="${esc(editing?.harvestDate || '')}"></div>
            <div class="mm-form-group"><label>Available from</label><input type="date" id="selAvailFrom" class="mm-form-input" required value="${esc(editing?.expectedAvailability || '')}"></div>
          </div>
          <p class="mkt-note">Already harvested? Pick today or an earlier date. Not harvested yet? Pick a future date and this automatically becomes a <b>🌱 Forward Booking</b> listing — buyers can reserve it now with a deposit, before you've even harvested.</p>
        </div>

        <div class="mkt-sell-section">
          <h4>Location</h4>
          ${farm ? `<div class="mkt-alert mkt-alert--info">Using your saved farm location: ${esc(farm.district || '')}${farm.district ? ', ' : ''}${esc(farm.state || '')}. You can still edit it below.</div>` : ''}
          <div class="mm-form-row">
            <div class="mm-form-group"><label>State</label><input type="text" id="selState" class="mm-form-input" required value="${esc(editing?.state || farm?.state || '')}"></div>
            <div class="mm-form-group"><label>District</label><input type="text" id="selDistrict" class="mm-form-input" required value="${esc(editing?.district || farm?.district || '')}"></div>
            <div class="mm-form-group"><label>Village / locality</label><input type="text" id="selVillage" class="mm-form-input" value="${esc(editing?.village || farm?.village || '')}"></div>
          </div>
        </div>

        <div class="mkt-sell-section">
          <h4>Your details</h4>
          <div class="mm-form-row">
            <div class="mm-form-group"><label>Your name</label><input type="text" id="selSellerName" class="mm-form-input" required value="${esc(editing?.sellerName || seller.name || '')}"></div>
            <div class="mm-form-group"><label>Mobile number</label><input type="tel" id="selSellerPhone" class="mm-form-input" pattern="[6-9][0-9]{9}" required value="${esc(editing?.sellerPhone || seller.phone || '')}"></div>
          </div>
          <p class="mkt-note">Saved on this device so you won't need to re-enter it next time you list produce.</p>
        </div>

        <div class="mkt-sell-actions">
          ${editing ? '<button type="button" class="btn btn-ghost" id="selCancelEdit">Cancel</button>' : ''}
          <button type="submit" class="btn btn-ghost" data-action="draft">Save as Draft</button>
          <button type="submit" class="btn btn-primary" data-action="publish">${editing && editing.status !== 'draft' ? 'Save Changes' : 'Publish Listing'}</button>
        </div>
      </form>`;

    // Live pricing insight while filling the form
    async function refreshInsight() {
      const name = document.getElementById('selName').value.trim().toLowerCase();
      const price = Number(document.getElementById('selPrice').value) || 0;
      const region = farm?.region_id || (window.FarmState ? window.FarmState.getNearestRegionId([80, 20]) : 'mp_sehore');
      const guessCropId = DEMO_LISTINGS.find((l) => l.name.toLowerCase() === name)?.cropId || name;
      const host = document.getElementById('selPricingInsight');
      if (!price || !name) { if (host) host.innerHTML = ''; return; }
      if (host) host.innerHTML = `<div class="mkt-insight mkt-insight--loading">📊 Checking market reference…</div>`;
      const insight = await fetchMarketInsight(region, guessCropId, price);
      if (host) {
        host.innerHTML = marketInsightHtml(insight, 'mktSellInsightChart', 'mktSellInsightBlock');
        renderPriceTrendChart('mktSellInsightChart', insight);
        const rec = sellHoldRecommendation(insight, guessCropId);
        const blockEl = document.getElementById('mktSellInsightBlock');
        if (rec && blockEl) blockEl.insertAdjacentHTML('afterend', sellHoldHtml(rec, 'mktSellFormHoldBlock'));
        const qty = Number(document.getElementById('selQty')?.value) || 0;
        const sim = creditSimulation({ quantityAvailable: qty, pricePerUnit: price }, rec);
        const afterEl = document.getElementById('mktSellFormHoldBlock') || blockEl;
        if (sim && afterEl) afterEl.insertAdjacentHTML('afterend', creditSimulatorHtml(sim));
      }
    }
    document.getElementById('selPrice').addEventListener('change', refreshInsight);
    document.getElementById('selName').addEventListener('change', refreshInsight);
    document.getElementById('selQty').addEventListener('change', refreshInsight);

    // Photo upload — resize/compress client-side, store as data URLs (see the
    // note above: no upload server exists in this prototype).
    function renderPhotoStrip() {
      const strip = document.getElementById('selPhotoStrip');
      if (!strip) return;
      if (!uploadedImages.length) {
        strip.innerHTML = '<p class="mkt-note">No photos added yet — buyers will see a category icon instead.</p>';
        return;
      }
      strip.innerHTML = uploadedImages.map((src, i) => `
        <div class="mkt-photo-thumb">
          <img src="${src}" alt="Preview ${i + 1}">
          <button type="button" class="mkt-photo-remove" data-idx="${i}" aria-label="Remove photo">✕</button>
        </div>`).join('');
      strip.querySelectorAll('.mkt-photo-remove').forEach((btn) => {
        btn.addEventListener('click', () => {
          uploadedImages.splice(Number(btn.dataset.idx), 1);
          renderPhotoStrip();
        });
      });
    }
    renderPhotoStrip();
    document.getElementById('selPhotoInput').addEventListener('change', async (ev) => {
      const files = Array.from(ev.target.files || []);
      ev.target.value = '';
      for (const file of files) {
        if (uploadedImages.length >= MAX_LISTING_PHOTOS) { toast(`Up to ${MAX_LISTING_PHOTOS} photos per listing`); break; }
        try {
          uploadedImages.push(await readAndCompressImage(file));
        } catch (_) {
          toast(`Could not process ${file.name}`);
        }
      }
      renderPhotoStrip();
    });

    initVoiceInput();

    if (editing) {
      document.getElementById('selCancelEdit').addEventListener('click', () => { state.editListingId = null; switchView('my-listings'); });
    }

    document.getElementById('mktSellForm').addEventListener('submit', (ev) => {
      ev.preventDefault();
      const action = ev.submitter?.dataset?.action || 'publish';
      const sellerName = document.getElementById('selSellerName').value.trim();
      const sellerPhone = document.getElementById('selSellerPhone').value.trim();
      saveSellerProfile({ name: sellerName, phone: sellerPhone });

      const name = document.getElementById('selName').value.trim();
      const guessCropId = DEMO_LISTINGS.find((l) => l.name.toLowerCase() === name.toLowerCase())?.cropId || name.toLowerCase().replace(/\s+/g, '_');

      const payload = {
        id: editing ? editing.id : 'my_' + Date.now().toString(36),
        sellerId: deviceId(), sellerName, sellerPhone, sellerType: 'farmer',
        verified: false, sellerRating: null, sellerOrders: editing?.sellerOrders || 0,
        sellerSince: editing?.sellerSince || String(new Date().getFullYear()), sellerResponseRate: null,
        category: document.getElementById('selCategory').value,
        cropId: guessCropId, name, variety: document.getElementById('selVariety').value.trim(),
        grade: document.getElementById('selGrade').value,
        organic: document.getElementById('selOrganic').checked,
        images: uploadedImages.slice(),
        description: document.getElementById('selDesc').value.trim(),
        quantityAvailable: Number(document.getElementById('selQty').value),
        unit: document.getElementById('selUnit').value,
        minOrderQty: Number(document.getElementById('selMoq').value),
        pricePerUnit: Number(document.getElementById('selPrice').value),
        harvestDate: document.getElementById('selHarvest').value,
        expectedAvailability: document.getElementById('selAvailFrom').value,
        state: document.getElementById('selState').value.trim(),
        district: document.getElementById('selDistrict').value.trim(),
        village: document.getElementById('selVillage').value.trim(),
        // Without a saved farm boundary, fall back to the browser-geolocation
        // fix already resolved at page load (myLocation), then to the same
        // generic India-centroid fallback the live pricing preview above
        // already uses — a listing must always carry a real regionId/lat/lon
        // or Market Insight, Sell-Now-vs-Hold, and Pool matching all go
        // silently blank for it (no error, just nothing to show).
        regionId: farm?.region_id || editing?.regionId ||
          (window.FarmState ? window.FarmState.getNearestRegionId([myLocation?.lon ?? 80, myLocation?.lat ?? 20]) : 'mp_sehore'),
        lat: farm?.lat ?? editing?.lat ?? myLocation?.lat ?? 20,
        lon: farm?.lon ?? editing?.lon ?? myLocation?.lon ?? 80,
        status: action === 'draft' ? 'draft' : (editing && (editing.status === 'paused' || editing.status === 'sold_out') ? editing.status : 'active'),
        createdAt: editing?.createdAt || new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };

      const mine = getMyListings();
      if (editing) {
        const idx = mine.findIndex((l) => l.id === editing.id);
        if (idx >= 0) mine[idx] = payload;
      } else {
        mine.unshift(payload);
      }
      if (!saveMyListings(mine)) {
        toast('Could not save — this device is out of storage space. Try removing a photo or two and save again.');
        return;
      }
      state.editListingId = null;
      state.justPublishedId = action === 'draft' ? null : payload.id;
      toast(action === 'draft' ? 'Saved as draft — not visible to buyers yet' : (editing ? 'Listing updated' : 'Listing published to the Marketplace'));
      switchView('my-listings');
    });
  }

  /* ----------------------------------------------------------------------
     My Listings (seller side)
  ---------------------------------------------------------------------- */
  const STATUS_LABEL = { active: 'Active', paused: 'Paused', sold_out: 'Sold Out', draft: 'Draft', limited: 'Low Stock' };

  function renderMyListings() {
    const host = $('#mktMyListingsHost');
    if (!host) return;
    const mine = getMyListings();
    if (!mine.length) {
      host.innerHTML = `<div class="mkt-empty"><div class="mkt-empty__ico">📋</div><h3>No listings yet</h3><p>Publish your first listing to see it here.</p>
        <button type="button" class="btn btn-primary" id="mktGoSellEmpty">🌾 Sell Your Produce</button></div>`;
      document.getElementById('mktGoSellEmpty').addEventListener('click', () => switchView('sell'));
      return;
    }
    const orders = getMyOrders();
    const today = new Date().toISOString().slice(0, 10);
    const rows = mine.map((l) => {
      const views = getViews()[l.id] || 0;
      const requestsForListing = orders.filter((o) => o.listingId === l.id);
      const effStatus = l.status === 'draft' ? 'draft' : (l.quantityAvailable <= 0 ? 'sold_out' : l.status);
      const expired = effStatus === 'active' && l.expectedAvailability && l.expectedAvailability < today;
      const isDraft = effStatus === 'draft';
      const isSold = effStatus === 'sold_out';
      const dm = effStatus === 'active' ? demandMatchFor(l.cropId) : null;
      const pool = effStatus === 'active' ? poolForListing(l.id) : null;
      const poolCandidates = (effStatus === 'active' && !pool) ? findPoolCandidates(l) : [];
      const sim = effStatus === 'active' ? creditSimulation(l, null) : null;
      return `
      <div class="mkt-manage-row" data-id="${esc(l.id)}">
        <div class="mkt-manage-row__info">
          <strong>${esc(l.name)} <small>${esc(l.variety || '')}</small></strong>
          <span>${inr(l.pricePerUnit)}/${esc(l.unit)} · ${l.quantityAvailable} ${esc(l.unit)} available</span>
          <span class="mkt-status mkt-status--${esc(effStatus)}">${STATUS_LABEL[effStatus] || effStatus}</span>
          ${expired ? '<span class="mkt-expiry-warn">⚠ Availability date has passed — update or mark sold</span>' : ''}
          ${dm ? `<span class="mkt-demand-flare">🔥 ${dm.buyerCount} nearby buyer${dm.buyerCount === 1 ? '' : 's'} want ${esc(l.name)}</span>` : ''}
          ${pool ? `<span class="mkt-pool-flare">🧺 Pooled with ${poolMembers(pool).length - 1} other farmer${poolMembers(pool).length - 1 === 1 ? '' : 's'} — ${Math.round(poolCombinedQty(pool)).toLocaleString('en-IN')} quintal combined</span>` :
            poolCandidates.length ? `<span class="mkt-pool-flare mkt-pool-flare--suggest">👥 ${poolCandidates.length} nearby farmer${poolCandidates.length === 1 ? '' : 's'} also selling ${esc(l.name)} — pool together for bulk buyers</span>` : ''}
          ${sim ? `<span class="mkt-credit-flare">💰 ${inr(sim.creditAmount)} unlockable via post-harvest credit instead of selling now</span>` : ''}
        </div>
        <div class="mkt-manage-row__stats">
          <span>👁 ${views} views</span>
          <span>🙋 ${requestsForListing.length} interested buyer${requestsForListing.length === 1 ? '' : 's'}</span>
        </div>
        <div class="mkt-manage-row__actions">
          <button type="button" class="btn btn-ghost mkt-btn-sm" data-act="view">View</button>
          <button type="button" class="btn btn-ghost mkt-btn-sm" data-act="edit">Edit</button>
          ${isDraft ? '<button type="button" class="btn btn-ghost mkt-btn-sm" data-act="publish">Publish</button>' :
            !isSold ? `<button type="button" class="btn btn-ghost mkt-btn-sm" data-act="toggle">${l.status === 'paused' ? 'Resume' : 'Pause'}</button>` : ''}
          ${!isSold && !isDraft ? '<button type="button" class="btn btn-ghost mkt-btn-sm" data-act="sold">Mark Sold</button>' : ''}
          ${!isDraft && !isSold ? '<button type="button" class="btn btn-ghost mkt-btn-sm" data-act="record-sale">📝 Record a Sale</button>' : ''}
          ${pool ? '<button type="button" class="btn btn-ghost mkt-btn-sm" data-act="leave-pool">Leave Pool</button>' :
            poolCandidates.length ? '<button type="button" class="btn btn-primary mkt-btn-sm" data-act="pool">Create Pool</button>' : ''}
          <button type="button" class="btn btn-ghost mkt-btn-sm" data-act="duplicate">Duplicate</button>
          <button type="button" class="btn btn-ghost mkt-btn-sm mkt-btn-danger" data-act="delete">Delete</button>
        </div>
        <div class="mkt-manage-row__sale-host"></div>
      </div>`;
    }).join('');

    let matchBanner = '';
    if (state.justPublishedId) {
      const justPublished = mine.find((l) => l.id === state.justPublishedId);
      const dm = justPublished ? demandMatchFor(justPublished.cropId) : null;
      if (justPublished && dm) {
        matchBanner = `<div class="mkt-demand-banner">
          <div class="mkt-demand-banner__ico">🔥</div>
          <div>
            <strong>Demand Match!</strong>
            <p>${dm.buyerCount} buyer${dm.buyerCount === 1 ? '' : 's'} near you ${dm.buyerCount === 1 ? 'is' : 'are'} actively looking for ${esc(justPublished.name)} at ${inr(dm.priceRangeLow)}–${inr(dm.priceRangeHigh)}/quintal — your new listing is a good match.</p>
          </div>
        </div>`;
      }
      state.justPublishedId = null;
    }

    host.innerHTML = matchBanner + `<div class="mkt-alert mkt-alert--info">Views and interested buyers only count activity from this device — this prototype has no shared backend yet, so real buyer traffic from other devices isn't reflected here.</div>` + rows;

    host.querySelectorAll('.mkt-manage-row').forEach((row) => {
      const id = row.dataset.id;
      row.querySelectorAll('[data-act]').forEach((btn) => {
        btn.addEventListener('click', () => handleListingAction(id, btn.dataset.act, row));
      });
    });
  }

  /** Shared inventory-decrement logic (M-10) — used by both the seller-side
   *  "Record a Sale" report and the buyer-side "Simulate: Mark Completed"
   *  lifecycle transition, so the two pathways can't disagree about the same
   *  listing's quantityAvailable. Clamps at 0 and flips the listing to
   *  sold_out, mirroring the original record-sale behavior exactly. */
  function applySaleToListingQuantity(listingId, qty) {
    const amount = Math.max(0, Number(qty) || 0);
    if (!amount) return;

    const mine = getMyListings();
    const mineIdx = mine.findIndex((x) => x.id === listingId);
    if (mineIdx >= 0) {
      mine[mineIdx].quantityAvailable = Math.max(0, (mine[mineIdx].quantityAvailable || 0) - amount);
      if (mine[mineIdx].quantityAvailable === 0) mine[mineIdx].status = 'sold_out';
      saveMyListings(mine);
      return;
    }

    // Demo catalog listings are frozen reference data never written back to
    // localStorage (see allListings()) — mutate the in-memory copy so this
    // session's UI still reflects the completed purchase consistently.
    const demo = DEMO_LISTINGS.find((x) => x.id === listingId);
    if (demo) {
      demo.quantityAvailable = Math.max(0, (demo.quantityAvailable || 0) - amount);
      if (demo.quantityAvailable === 0) demo.status = 'sold_out';
    }
  }

  function handleListingAction(id, action, row) {
    const mine = getMyListings();
    const idx = mine.findIndex((l) => l.id === id);
    if (idx === -1) return;

    if (action === 'view') { openDetail(id); return; }
    if (action === 'record-sale') {
      const l = mine[idx];
      const saleHost = row && row.querySelector('.mkt-manage-row__sale-host');
      if (!saleHost) return;
      saleHost.innerHTML = `
        <form class="mkt-review-form" id="saleForm-${esc(id)}">
          <div class="mm-form-row">
            <div class="mm-form-group"><label>Quantity sold (${esc(l.unit)})</label><input type="number" id="saleQty-${esc(id)}" class="mm-form-input" min="0.1" step="0.1" max="${l.quantityAvailable}" value="${Math.min(l.minOrderQty, l.quantityAvailable)}" required></div>
            <div class="mm-form-group"><label>Price received (₹/${esc(l.unit)})</label><input type="number" id="salePrice-${esc(id)}" class="mm-form-input" min="1" step="1" value="${l.pricePerUnit}" required></div>
          </div>
          <div class="mm-form-group"><label>Buyer name (optional)</label><input type="text" id="saleBuyer-${esc(id)}" class="mm-form-input" placeholder="e.g. local mandi trader"></div>
          <button type="submit" class="btn btn-primary mkt-btn-sm">Save Sale</button>
        </form>
        <p class="mkt-note" style="margin-top:6px;">Self-reported — logs a real-world sale you made (in person, by phone, etc.) so it counts toward your Credit Profile. Not verified by the buyer, since this prototype has no shared backend to confirm both sides of a transaction.</p>`;
      saleHost.querySelector('form').addEventListener('submit', (ev) => {
        ev.preventDefault();
        const qty = Math.min(l.quantityAvailable, Math.max(0.1, Number(document.getElementById(`saleQty-${id}`).value) || 0));
        const pricePerUnit = Math.max(1, Number(document.getElementById(`salePrice-${id}`).value) || l.pricePerUnit);
        const buyerName = document.getElementById(`saleBuyer-${id}`).value.trim();
        const sales = getSelfSales();
        sales.unshift({
          id: 'sale_' + Date.now().toString(36), listingId: l.id, cropName: l.name,
          quantity: qty, unit: l.unit, pricePerUnit, buyerName: buyerName || null,
          sellerId: deviceId(), createdAt: new Date().toISOString(),
        });
        saveSelfSales(sales);

        applySaleToListingQuantity(l.id, qty);
        toast(`Sale of ${qty} ${l.unit} recorded`);
        renderMyListings();
      });
      return;
    }
    if (action === 'edit') { state.editListingId = id; switchView('sell'); return; }
    if (action === 'duplicate') {
      const clone = Object.assign({}, mine[idx], {
        id: 'my_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 6),
        status: 'draft',
        createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
      });
      mine.unshift(clone);
      saveMyListings(mine);
      state.editListingId = clone.id;
      toast('Duplicated as a new draft — review and publish when ready');
      switchView('sell');
      return;
    }
    if (action === 'pool') {
      const candidates = findPoolCandidates(mine[idx]);
      if (!candidates.length) { toast('No nearby same-crop sellers found to pool with right now'); return; }
      createPool(mine[idx], candidates);
      toast(`Pool created with ${candidates.length} nearby farmer${candidates.length === 1 ? '' : 's'} selling ${mine[idx].name}`);
      renderMyListings();
      return;
    }
    if (action === 'leave-pool') {
      leavePool(id);
      toast('Left the pool');
      renderMyListings();
      return;
    }
    if (action === 'publish') {
      mine[idx].status = 'active'; mine[idx].updatedAt = new Date().toISOString();
    } else if (action === 'toggle') {
      mine[idx].status = mine[idx].status === 'paused' ? 'active' : 'paused';
    } else if (action === 'sold') {
      // "Mark Sold" is a one-click way of saying the rest of this listing
      // moved — log it as a self-reported sale too, the same way "Record a
      // Sale" does, otherwise the Credit Profile's sales stats never learn
      // about it and a listing that sells out actually looks like *less*
      // seller activity, not more.
      const remaining = mine[idx].quantityAvailable;
      if (remaining > 0) {
        const sales = getSelfSales();
        sales.unshift({
          id: 'sale_' + Date.now().toString(36), listingId: mine[idx].id, cropName: mine[idx].name,
          quantity: remaining, unit: mine[idx].unit, pricePerUnit: mine[idx].pricePerUnit, buyerName: null,
          sellerId: deviceId(), createdAt: new Date().toISOString(),
        });
        saveSelfSales(sales);
      }
      mine[idx].status = 'sold_out'; mine[idx].quantityAvailable = 0;
    } else if (action === 'delete') {
      if (!confirm('Delete this listing? This cannot be undone.')) return;
      mine.splice(idx, 1);
    }
    saveMyListings(mine);
    renderMyListings();
  }

  /* ----------------------------------------------------------------------
     My Requests (buyer side) — simulated lifecycle, clearly labelled
  ---------------------------------------------------------------------- */
  const LIFECYCLE = ['REQUESTED', 'ACCEPTED', 'PICKUP_PENDING', 'IN_TRANSIT', 'DELIVERED', 'COMPLETED'];

  function renderMyRequests() {
    const host = $('#mktMyRequestsHost');
    if (!host) return;
    const orders = getMyOrders();
    if (!orders.length) {
      host.innerHTML = `<div class="mkt-empty"><div class="mkt-empty__ico">🧾</div><h3>No requests yet</h3><p>When you request produce from a seller, it'll show up here.</p></div>`;
      return;
    }
    host.innerHTML = orders.map((o) => {
      const l = findListing(o.listingId);
      const inNegotiation = o.status === 'CANCELLED' || o.status === 'COUNTER_OFFER';
      const stepIdx = LIFECYCLE.indexOf(inNegotiation ? 'REQUESTED' : o.status);
      const canReview = o.status === 'COMPLETED' && !getReviews().some((r) => r.orderId === o.id);
      const effectivePrice = o.finalPrice || o.offeredPrice;
      return `
      <div class="mkt-req-row" data-id="${esc(o.id)}">
        <div class="mkt-req-row__head">
          <strong>${o.bookingType === 'forward' ? '🌱 ' : ''}${esc(o.productName)} · ${o.requestedQuantity} ${esc(o.unit)}</strong>
          <span class="mkt-status mkt-status--${o.status === 'CANCELLED' ? 'sold_out' : o.status === 'COUNTER_OFFER' ? 'limited' : 'active'}">${o.status.replace(/_/g, ' ')}</span>
        </div>
        <div class="mkt-req-row__meta">
          <span>Seller: ${esc(o.sellerName)}</span>
          <span>Estimated total: ${inr(o.requestedQuantity * effectivePrice)}</span>
          <span>Payment: ${esc(o.paymentStatus)}</span>
          ${o.batchId ? `<span>🧺 Sent together with other cart requests</span>` : ''}
        </div>
        ${o.bookingType === 'forward' ? `<div class="mkt-alert mkt-alert--info">🌱 Forward booking — expected harvest ${esc(o.expectedHarvestDate)}. Deposit: ${inr(o.depositAmount)} · Balance at delivery: ${inr(o.balanceAmount)}</div>` : ''}
        ${o.status === 'COUNTER_OFFER' ? `<div class="mkt-alert">Seller countered at <b>${inr(o.finalPrice)}/${esc(o.unit)}</b> (originally requested at ${inr(o.offeredPrice)}/${esc(o.unit)}). This is a simulated response for demonstration — no real seller has been contacted.</div>` : ''}
        ${o.status !== 'CANCELLED' ? `<div class="mkt-lifecycle">
          ${LIFECYCLE.map((s, i) => `<span class="mkt-lifecycle__step ${i <= stepIdx ? 'done' : ''}">${s.replace(/_/g, ' ')}</span>`).join('<span class="mkt-lifecycle__sep">›</span>')}
        </div>` : ''}
        <div class="mkt-req-row__actions">
          ${o.status === 'REQUESTED' ? '<button type="button" class="btn btn-ghost mkt-btn-sm" data-act="cancel">Cancel Request</button><button type="button" class="btn btn-primary mkt-btn-sm" data-act="simulate-accept">Simulate: Seller Accepts (Demo)</button><button type="button" class="btn btn-ghost mkt-btn-sm" data-act="simulate-counter">Simulate: Seller Counters (Demo)</button>' : ''}
          ${o.status === 'COUNTER_OFFER' ? '<button type="button" class="btn btn-ghost mkt-btn-sm" data-act="reject-counter">Reject Counter-Offer</button><button type="button" class="btn btn-primary mkt-btn-sm" data-act="accept-counter">Accept Counter-Offer</button>' : ''}
          ${o.status === 'ACCEPTED' ? '<button type="button" class="btn btn-primary mkt-btn-sm" data-act="simulate-pickup">Simulate: Mark Picked Up (Demo)</button>' : ''}
          ${o.status === 'PICKUP_PENDING' ? '<button type="button" class="btn btn-primary mkt-btn-sm" data-act="simulate-transit">Simulate: Mark In Transit (Demo)</button>' : ''}
          ${o.status === 'IN_TRANSIT' ? '<button type="button" class="btn btn-primary mkt-btn-sm" data-act="simulate-delivered">Simulate: Mark Delivered (Demo)</button>' : ''}
          ${o.status === 'DELIVERED' ? '<button type="button" class="btn btn-primary mkt-btn-sm" data-act="simulate-complete">Simulate: Mark Completed (Demo)</button>' : ''}
          ${canReview ? '<button type="button" class="btn btn-ghost mkt-btn-sm" data-act="review">Leave a Review</button>' : ''}
        </div>
        <div class="mkt-req-row__review-host"></div>
      </div>`;
    }).join('');

    host.querySelectorAll('.mkt-req-row').forEach((row) => {
      const id = row.dataset.id;
      row.querySelectorAll('[data-act]').forEach((btn) => {
        btn.addEventListener('click', () => handleRequestAction(id, btn.dataset.act, row));
      });
    });
  }

  function handleRequestAction(id, action, row) {
    const orders = getMyOrders();
    const idx = orders.findIndex((o) => o.id === id);
    if (idx === -1) return;
    const o = orders[idx];

    const transitions = {
      cancel: () => { o.status = 'CANCELLED'; },
      'simulate-accept': () => { o.status = 'ACCEPTED'; o.finalPrice = o.offeredPrice; },
      // Demo counter-offer: a fixed +4% above the buyer's ask, clearly a
      // simulated stand-in for real seller negotiation, not a pricing model.
      'simulate-counter': () => { o.status = 'COUNTER_OFFER'; o.finalPrice = Math.round(o.offeredPrice * 1.04); },
      'accept-counter': () => { o.status = 'ACCEPTED'; },
      'reject-counter': () => { o.status = 'CANCELLED'; },
      'simulate-pickup': () => { o.status = 'PICKUP_PENDING'; },
      'simulate-transit': () => { o.status = 'IN_TRANSIT'; },
      'simulate-delivered': () => { o.status = 'DELIVERED'; },
      // M-10: mirror the seller-side "Record a Sale" inventory decrement here
      // too — otherwise a purchase can walk all the way to COMPLETED without
      // ever reducing the listing's quantityAvailable, disagreeing with the
      // seller-reported number for the same stock.
      'simulate-complete': () => {
        o.status = 'COMPLETED';
        o.paymentStatus = 'PAID';
        applySaleToListingQuantity(o.listingId, o.requestedQuantity);
      },
    };

    if (transitions[action]) {
      transitions[action]();
      o.updatedAt = new Date().toISOString();
      orders[idx] = o;
      saveMyOrders(orders);
      renderMyRequests();
      return;
    }

    if (action === 'review') {
      const host = row.querySelector('.mkt-req-row__review-host');
      host.innerHTML = `
        <form class="mkt-review-form">
          <label>Rating
            <select class="mm-form-input" id="revRating-${esc(id)}">
              <option value="5">⭐⭐⭐⭐⭐ Excellent</option>
              <option value="4">⭐⭐⭐⭐ Good</option>
              <option value="3">⭐⭐⭐ Okay</option>
              <option value="2">⭐⭐ Poor</option>
              <option value="1">⭐ Very poor</option>
            </select>
          </label>
          <textarea class="mm-form-input" id="revComment-${esc(id)}" rows="2" placeholder="Share how the order went…"></textarea>
          <button type="submit" class="btn btn-primary mkt-btn-sm">Submit Review</button>
        </form>`;
      host.querySelector('form').addEventListener('submit', (ev) => {
        ev.preventDefault();
        const rating = Number(document.getElementById(`revRating-${id}`).value);
        const comment = document.getElementById(`revComment-${id}`).value.trim() || 'No comment provided.';
        const reviews = getReviews();
        reviews.unshift({
          id: 'rev_' + Date.now().toString(36), orderId: o.id, listingId: o.listingId,
          reviewerId: deviceId(), sellerId: o.sellerId, rating, comment, productName: o.productName,
          createdAt: new Date().toISOString(),
        });
        saveReviews(reviews);
        toast('Review submitted');
        renderMyRequests();
      });
    }
  }

  /* ----------------------------------------------------------------------
     Cart — buyer builds up a multi-listing request, then checks out once.
     Each cart line still becomes its own order (the data model is
     per-listing, matching how a real marketplace would route each request
     to its own seller), tagged with a shared batchId so My Requests can
     show they were sent together. End-to-end this is still the same
     simulated lifecycle as a single request — no real seller is contacted.
  ---------------------------------------------------------------------- */
  function renderCart() {
    const host = $('#mktCartHost');
    if (!host) return;
    const cart = getCart();
    const lines = cart.map((c) => ({ listingId: c.listingId, quantity: c.quantity, listing: findListing(c.listingId) })).filter((c) => c.listing);

    if (lines.length !== cart.length) {
      saveCart(lines.map((l) => ({ listingId: l.listingId, quantity: l.quantity })));
    }

    if (!lines.length) {
      host.innerHTML = `<div class="mkt-empty"><div class="mkt-empty__ico">🧺</div><h3>Your cart is empty</h3><p>Add produce from the Browse tab to request from multiple sellers at once.</p>
        <button type="button" class="btn btn-primary" id="mktGoCartEmpty">🛒 Browse Products</button></div>`;
      document.getElementById('mktGoCartEmpty').addEventListener('click', () => switchView('browse'));
      return;
    }

    const grandTotal = () => lines.reduce((sum, c) => {
      const input = host.querySelector(`[data-qty-for="${c.listing.id}"]`);
      const q = input ? Math.max(1, Number(input.value) || c.quantity) : c.quantity;
      return sum + q * c.listing.pricePerUnit;
    }, 0);

    const rowsHtml = lines.map((c) => {
      const l = c.listing;
      const img = primaryImage(l);
      return `
      <div class="mkt-cart-row" data-listing="${esc(l.id)}">
        <div class="mkt-cart-row__media">${img ? `<img src="${esc(img)}" alt="${esc(l.name)}">` : catIcon(l.category)}</div>
        <div class="mkt-cart-row__info">
          <strong>${esc(l.name)} <small style="font-weight:500;color:var(--ink-soft);">${esc(l.variety || '')}</small></strong>
          <span>${esc(l.sellerName)} · ${inr(l.pricePerUnit)}/${esc(l.unit)}</span>
        </div>
        <div class="mkt-cart-row__qty">
          <input type="number" min="${l.minOrderQty}" step="1" value="${c.quantity}" data-qty-for="${esc(l.id)}" aria-label="Quantity of ${esc(l.name)} (${esc(l.unit)})">
          <span aria-hidden="true">${esc(l.unit)}</span>
        </div>
        <div class="mkt-cart-row__total" data-total-for="${esc(l.id)}">${inr(c.quantity * l.pricePerUnit)}</div>
        <button type="button" class="btn btn-ghost mkt-btn-sm mkt-btn-danger" data-remove="${esc(l.id)}">Remove</button>
      </div>`;
    }).join('');

    host.innerHTML = rowsHtml + `
      <div class="mkt-cart-summary">
        <div>
          <div class="mkt-cart-summary__total" id="mktCartGrandTotal">${inr(grandTotal())}</div>
          <p class="mkt-note">Estimated across ${lines.length} seller${lines.length === 1 ? '' : 's'}. No platform fee applied in this demo.</p>
        </div>
        <button type="button" class="btn btn-primary" id="mktCheckoutBtn">Proceed to Checkout →</button>
      </div>
      <div id="mktCheckoutHost"></div>`;

    function recalcRow(listingId) {
      const l = lines.find((c) => c.listing.id === listingId).listing;
      const input = host.querySelector(`[data-qty-for="${listingId}"]`);
      const q = Math.max(l.minOrderQty, Number(input.value) || l.minOrderQty);
      input.value = q;
      host.querySelector(`[data-total-for="${listingId}"]`).textContent = inr(q * l.pricePerUnit);
      const totalEl = document.getElementById('mktCartGrandTotal');
      if (totalEl) totalEl.textContent = inr(grandTotal());
      const cartNow = getCart();
      const entry = cartNow.find((c) => c.listingId === listingId);
      if (entry) { entry.quantity = q; saveCart(cartNow); }
      updateCartBadge();
    }

    host.querySelectorAll('[data-qty-for]').forEach((input) => {
      input.addEventListener('change', () => recalcRow(input.dataset.qtyFor));
    });
    host.querySelectorAll('[data-remove]').forEach((btn) => {
      btn.addEventListener('click', () => {
        saveCart(getCart().filter((c) => c.listingId !== btn.dataset.remove));
        updateCartBadge();
        renderCart();
      });
    });
    document.getElementById('mktCheckoutBtn').addEventListener('click', () => renderCheckoutForm(lines));
  }

  function renderCheckoutForm(lines) {
    const host = document.getElementById('mktCheckoutHost');
    if (!host) return;
    host.innerHTML = `
      <form class="mkt-checkout-form" id="mktCheckoutForm">
        <h3 style="margin:0;color:var(--brand-deep);">Checkout — one form for all ${lines.length} seller${lines.length === 1 ? '' : 's'}</h3>
        <div class="mm-form-row">
          <div class="mm-form-group"><label>Your Name</label><input type="text" id="coName" class="mm-form-input" required placeholder="e.g. Anil Sharma"></div>
          <div class="mm-form-group"><label>Mobile Number</label><input type="tel" id="coPhone" class="mm-form-input" pattern="[6-9][0-9]{9}" required placeholder="10-digit mobile"></div>
        </div>
        <div class="mm-form-row">
          <div class="mm-form-group"><label>Buyer Type</label>
            <select id="coBuyerType" class="mm-form-input">
              <option>Individual consumer</option><option>Retailer</option><option>Restaurant</option>
              <option>Wholesaler</option><option>Food processor</option><option>Trader</option><option>Other business</option>
            </select>
          </div>
          <div class="mm-form-group"><label>Payment Method</label>
            <select id="coPayment" class="mm-form-input">
              <option value="upi">UPI on pickup/delivery</option>
              <option value="cod">Cash on pickup/delivery</option>
              <option value="fpo_assisted">Assisted via local FPO/agent</option>
            </select>
          </div>
        </div>
        <div class="mm-form-group"><label>Delivery Responsibility</label>
          <select id="coDelivery" class="mm-form-input">
            <option value="farmer_pickup">Farmer pickup (buyer collects)</option>
            <option value="buyer_transport">Buyer-arranged transport</option>
            <option value="platform_assisted">Platform-assisted logistics (coming soon)</option>
          </select>
        </div>
        <p class="mkt-note">This sends ${lines.length} separate request${lines.length === 1 ? '' : 's'}, one per seller, so each can respond individually. No platform fee is applied in this demo.</p>
        <button type="submit" class="mm-form-submit">Send All Requests</button>
      </form>`;

    document.getElementById('mktCheckoutForm').addEventListener('submit', (ev) => {
      ev.preventDefault();
      const buyerName = document.getElementById('coName').value.trim();
      const buyerPhone = document.getElementById('coPhone').value.trim();
      const buyerType = document.getElementById('coBuyerType').value;
      const deliveryResponsibility = document.getElementById('coDelivery').value;
      const paymentMethod = document.getElementById('coPayment').value;
      const batchId = 'BATCH-' + Math.random().toString(36).slice(2, 8).toUpperCase();
      const orders = getMyOrders();
      const farmDistrict = (window.FarmState && window.FarmState.load()?.district) || 'Not specified';
      lines.forEach((c) => {
        const l = c.listing;
        const input = document.querySelector(`[data-qty-for="${l.id}"]`);
        const q = input ? Math.max(l.minOrderQty, Number(input.value) || c.quantity) : c.quantity;
        const forward = isForwardListing(l);
        const total = q * l.pricePerUnit;
        const deposit = forward ? Math.round(total * FORWARD_DEPOSIT_PCT) : null;
        orders.unshift({
          id: 'REQ-' + Math.random().toString(36).slice(2, 8).toUpperCase(),
          batchId,
          listingId: l.id, sellerId: l.sellerId, sellerName: l.sellerName,
          buyerId: deviceId(), buyerName, buyerPhone, buyerType,
          productName: l.name, unit: l.unit,
          requestedQuantity: q, offeredPrice: l.pricePerUnit, finalPrice: null,
          status: 'REQUESTED',
          bookingType: forward ? 'forward' : 'standard',
          depositAmount: deposit,
          balanceAmount: forward ? total - deposit : null,
          expectedHarvestDate: forward ? l.harvestDate : null,
          deliveryResponsibility,
          pickupLocation: `${l.village || ''}${l.village ? ', ' : ''}${l.district}, ${l.state}`,
          deliveryLocation: farmDistrict,
          paymentMethod, paymentStatus: 'NOT_REQUIRED',
          createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
        });
      });
      saveMyOrders(orders);
      saveCart([]);
      updateCartBadge();
      toast(`${lines.length} request${lines.length === 1 ? '' : 's'} sent`);
      switchView('my-requests');
    });
  }

  /* ----------------------------------------------------------------------
     Nearby Demand (demo signals)
  ---------------------------------------------------------------------- */
  let demandMapInstance = null;
  async function renderDemandMap() {
    const mapEl = document.getElementById('mktDemandMap');
    if (!mapEl) return;
    const withCoords = DEMAND.filter((d) => typeof d.lat === 'number' && typeof d.lon === 'number');
    if (!withCoords.length) { mapEl.style.display = 'none'; return; }
    await ensureLeaflet();
    if (!window.L) return;

    // Leaflet throws if you re-init a container that already has a map —
    // this view can be re-rendered (tab revisits), so tear down first.
    if (demandMapInstance) { demandMapInstance.remove(); demandMapInstance = null; }

    const center = myLocation ? [myLocation.lat, myLocation.lon] : [22.5, 79];
    const map = L.map(mapEl, { scrollWheelZoom: false }).setView(center, myLocation ? 6 : 5);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '&copy; OpenStreetMap contributors', maxZoom: 12,
    }).addTo(map);

    const maxBuyers = Math.max(...withCoords.map((d) => d.buyerCount));
    withCoords.forEach((d) => {
      const radius = 10 + (d.buyerCount / maxBuyers) * 16;
      L.circleMarker([d.lat, d.lon], {
        radius, color: BRAND, weight: 2, fillColor: ACCENT, fillOpacity: 0.55,
      }).addTo(map).bindPopup(`
        <div class="mkt-demand-popup">
          <strong>${catIcon((DEMO_LISTINGS.find((l) => l.cropId === d.cropId) || {}).category || 'other')} ${esc(d.name)} · ${esc(d.state || '')}</strong>
          ${d.buyerCount} buyers seeking ${inr(d.priceRangeLow)}–${inr(d.priceRangeHigh)}/quintal<br>
          ${d.totalRequestedQuintal} quintal total requested
        </div>`);
    });

    if (myLocation) {
      L.marker([myLocation.lat, myLocation.lon]).addTo(map).bindPopup('Your farm').openPopup();
    }

    demandMapInstance = map;
    // Leaflet sizes its canvas from the container's dimensions at init time;
    // the tab was hidden (display:none) until just now, so recompute once
    // the browser has actually laid it out.
    setTimeout(() => map.invalidateSize(), 80);
  }

  function renderDemand() {
    const host = $('#mktDemandHost');
    if (!host) return;
    renderDemandMap();
    if (!DEMAND.length) { host.innerHTML = '<div class="mkt-empty"><p>No demand signals available.</p></div>'; return; }
    host.innerHTML = `<div class="mkt-alert mkt-alert--info">Demo demand signals — illustrative, not live buyer data. In production this would aggregate real buyer requests.</div>` +
      `<div class="mkt-demand-grid">` + DEMAND.map((d) => `
        <div class="mkt-demand-card">
          <div class="mkt-demand-card__head">${catIcon((DEMO_LISTINGS.find((l) => l.cropId === d.cropId) || {}).category || 'other')} ${esc(d.name)}</div>
          <div class="mkt-demand-card__row"><span>Buyers interested</span><b>${d.buyerCount}</b></div>
          <div class="mkt-demand-card__row"><span>Price range sought</span><b>${inr(d.priceRangeLow)}–${inr(d.priceRangeHigh)}/quintal</b></div>
          <div class="mkt-demand-card__row"><span>Total requested</span><b>${d.totalRequestedQuintal} quintal</b></div>
          <div class="mkt-demand-card__row"><span>Nearest buyer</span><b>${d.nearestBuyerKm} km</b></div>
        </div>`).join('') + `</div>`;
  }

  /* ----------------------------------------------------------------------
     Pool Orders — dedicated browsing view, so pools are first-class,
     discoverable content rather than something only surfaced deep inside a
     product detail page or My Listings.
  ---------------------------------------------------------------------- */
  function renderPools() {
    const host = $('#mktPoolsHost');
    if (!host) return;
    const pools = getPools().filter((p) => poolMembers(p).length >= 2);

    if (!pools.length) {
      host.innerHTML = `<div class="mkt-empty">
        <div class="mkt-empty__ico">🧺</div>
        <h3>No active pools right now</h3>
        <p>Create one from any of your listings in <b>My Listings</b> when nearby farmers are selling the same crop.</p>
      </div>`;
      return;
    }

    host.innerHTML = `<div class="mkt-alert mkt-alert--info">Pools combine several farmers' listings into one bulk offer so a buyer can meet a large minimum-order requirement in a single request. This is a device-local grouping its creator opted into, not a binding multi-party contract — this prototype has no shared backend to synchronize commitments across farmers' devices.</div>
      <div class="mkt-pools-grid">` + pools.map((p) => {
        const members = poolMembers(p);
        const combined = Math.round(poolCombinedQty(p));
        const prices = members.map((m) => perQuintalPrice(m));
        const lo = Math.round(Math.min(...prices)), hi = Math.round(Math.max(...prices));
        const sample = members[0];
        const isDemo = p.createdBy === 'demo';
        return `<div class="mkt-pool-card" data-pool="${esc(p.id)}">
          <div class="mkt-pool-card__head">
            <span class="mkt-pool-card__ico">${catIcon(sample.category)}</span>
            <div class="mkt-pool-card__title">
              <strong>${esc(p.cropName)} Pool</strong>
              <span>${members.length} farmers · ${esc(sample.state)}</span>
            </div>
            ${isDemo ? '<span class="mkt-card__demo" style="position:static;flex-shrink:0;">Demo pool</span>' : ''}
          </div>
          <div class="mkt-pool-card__stats">
            <div><b>${combined.toLocaleString('en-IN')}</b><span>quintal combined</span></div>
            <div><b>${inr(lo)}–${inr(hi)}</b><span>per quintal</span></div>
          </div>
          <div class="mkt-pool-card__members">${members.map((m) => `<span>${esc(m.sellerName)}${m.verified ? ' ✓' : ''}</span>`).join('')}</div>
          <button type="button" class="btn btn-primary mkt-btn-sm" data-view-pool="${esc(sample.id)}">View Pool</button>
        </div>`;
      }).join('') + `</div>`;

    host.querySelectorAll('[data-view-pool]').forEach((btn) => {
      btn.addEventListener('click', () => openDetail(btn.dataset.viewPool));
    });
  }

  /* ----------------------------------------------------------------------
     Digital Farmer Credit Profile — synthesizes real Field Health (NDVI)
     with this device's own listing/sales/review history into one
     shareable profile, the way agri-fintechs like Samunnati and Jai Kisan
     (and NABARD's own satellite-data underwriting pilots) already combine
     alternative farm data for farmers with no formal credit file. Framed
     explicitly as an informational aid, never a score or decision — the
     research behind this is clear there's no proven causal link between
     yield/field-health signals and loan repayment, so claiming otherwise
     here would be dishonest in exactly the way this app avoids elsewhere.
     Sales/review counts are also explicitly caveated: with no shared
     backend, this device can only ever see transactions it was party to
     itself, the same limitation My Listings already discloses.
  ---------------------------------------------------------------------- */
  function renderCreditProfile() {
    const host = $('#mktCreditProfileHost');
    if (!host) return;
    const seller = getSellerProfile();
    const mine = getMyListings();

    if (!seller || !mine.length) {
      host.innerHTML = `<div class="mkt-empty">
        <div class="mkt-empty__ico">💳</div>
        <h3>No credit profile yet</h3>
        <p>Publish at least one listing in <b>Sell Produce</b> to build your Farmer Credit Profile.</p>
        <button type="button" class="btn btn-primary" id="mktGoSellForProfile">🌾 Sell Your Produce</button>
      </div>`;
      document.getElementById('mktGoSellForProfile').addEventListener('click', () => switchView('sell'));
      return;
    }

    const activeListings = mine.filter((l) => l.status === 'active' || l.status === 'limited');
    const totalQuintal = Math.round(activeListings.reduce((sum, l) => sum + quintalEquivalentQty(l), 0));
    const totalValue = Math.round(activeListings.reduce((sum, l) => sum + (l.quantityAvailable || 0) * (l.pricePerUnit || 0), 0));
    const myListingIds = new Set(mine.map((l) => l.id));
    const mySales = getSelfSales().filter((s) => myListingIds.has(s.listingId));
    const totalSoldValue = Math.round(mySales.reduce((sum, s) => sum + s.quantity * s.pricePerUnit, 0));
    const myReviews = getReviews().filter((r) => r.sellerId === deviceId());
    const avgRating = myReviews.length ? (myReviews.reduce((a, b) => a + b.rating, 0) / myReviews.length).toFixed(1) : null;
    const memberSince = mine.reduce((min, l) => (l.createdAt < min ? l.createdAt : min), mine[0].createdAt).slice(0, 4);
    const sample = activeListings[0] || mine[0];

    host.innerHTML = `
      <div class="mkt-credit-profile" id="mktCreditProfileCard">
        <div class="mkt-credit-profile__head">
          <div class="mkt-credit-profile__avatar">👨‍🌾</div>
          <div>
            <strong>${esc(seller.name || 'Farmer')}</strong>
            <span>${sample?.verified ? '✓ Verified Farmer' : 'Verification pending'} · Member since ${esc(memberSince)}</span>
          </div>
        </div>
        <div id="mktProfileFieldHealth" class="mkt-insight mkt-insight--loading">🌱 Checking field health…</div>
        <div class="mkt-credit-profile__stats">
          <div><b>${activeListings.length}</b><span>active listings</span></div>
          <div><b>${totalQuintal.toLocaleString('en-IN')}</b><span>quintal currently offered</span></div>
          <div><b>${inr(totalValue)}</b><span>total listed value</span></div>
          <div><b>${mySales.length}</b><span>sales logged</span></div>
          <div><b>${inr(totalSoldValue)}</b><span>total sold (self-reported)</span></div>
          <div><b>${avgRating || '—'}</b><span>avg. rating (${myReviews.length})</span></div>
        </div>
        ${!mySales.length ? `<div class="mkt-alert">No sales logged yet — open <b>My Listings</b> and use <b>📝 Record a Sale</b> on any published listing after you sell, in person or otherwise, so it counts toward this profile.</div>` : ''}
        <div class="mkt-alert mkt-alert--info">Sales are self-reported by you, and review counts only reflect activity visible to this device — this prototype has no shared backend, so a real deployment would verify sales with the buyer and aggregate reviews across everyone you've transacted with, not just this browser.</div>
        <p class="mkt-note">An informational profile you could show a lender to support a loan conversation — not a credit score, decision, or guarantee, and it isn't used by any bank in this prototype. Real alternative-credit programs (Samunnati, Jai Kisan, NABARD's satellite-data underwriting pilots) combine data like this with a lender's own assessment.</p>
        <button type="button" class="btn btn-ghost mkt-btn-sm" id="mktCopyProfile">📋 Copy Profile Summary</button>
      </div>`;

    if (sample && typeof sample.lat === 'number' && typeof sample.lon === 'number') {
      fetchFieldHealth(sample.lat, sample.lon, sample.cropId, 4).then((fh) => {
        const fhHost = document.getElementById('mktProfileFieldHealth');
        if (fhHost) fhHost.outerHTML = fieldHealthHtml(fh);
      });
    } else {
      const fhHost = document.getElementById('mktProfileFieldHealth');
      if (fhHost) fhHost.remove();
    }

    document.getElementById('mktCopyProfile').addEventListener('click', () => {
      const summary = `MittiMantra Farmer Credit Profile\n${seller.name || 'Farmer'}\nMember since ${memberSince}\nActive listings: ${activeListings.length}\nQuantity currently offered: ${totalQuintal} quintal\nTotal listed value: ${inr(totalValue)}\nSales logged: ${mySales.length} (${inr(totalSoldValue)} self-reported)\nAverage rating: ${avgRating || '—'} (${myReviews.length} reviews)\n\nInformational only — not an official credit score.`;
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(summary)
          .then(() => toast('Profile summary copied to clipboard'))
          .catch(() => toast('Could not copy — try selecting the text manually'));
      } else {
        toast('Clipboard not available in this browser');
      }
    });
  }

  /* ----------------------------------------------------------------------
     Deep-linking (from dashboard "Sell this produce" hook) + init
  ---------------------------------------------------------------------- */
  function handleDeepLink() {
    const q = new URLSearchParams(location.search);
    if (q.get('view') === 'sell') {
      switchView('sell');
      setTimeout(() => {
        const cropId = q.get('crop_id');
        if (cropId) {
          const nameEl = document.getElementById('selName');
          const catEl = document.getElementById('selCategory');
          const known = DEMO_LISTINGS.find((l) => l.cropId === cropId);
          if (nameEl && known) nameEl.value = known.name;
          else if (nameEl) nameEl.value = cropId;
          if (catEl && known) catEl.value = known.category;
        }
        const qty = q.get('qty');
        if (qty) { const el = document.getElementById('selQty'); if (el) el.value = qty; }
      }, 50);
    } else if (q.get('view') === 'browse' && q.get('crop_id')) {
      switchView('browse');
      const search = document.getElementById('mktSearch');
      if (search) { search.value = q.get('crop_id'); state.filters.q = q.get('crop_id'); renderGrid(); }
    }
  }

  function init() {
    resolveMyLocation();
    renderCategoryChips();
    bindFilters();
    renderGrid();
    updateCartBadge();

    $$('.mkt-tab').forEach((btn) => btn.addEventListener('click', () => switchView(btn.dataset.view)));
    const heroSell = document.getElementById('mktHeroSell');
    const heroBrowse = document.getElementById('mktHeroBrowse');
    if (heroSell) heroSell.addEventListener('click', () => switchView('sell'));
    if (heroBrowse) heroBrowse.addEventListener('click', () => switchView('browse'));

    const heroSearch = document.getElementById('mktHeroSearch');
    if (heroSearch) {
      heroSearch.addEventListener('keydown', (e) => {
        if (e.key !== 'Enter') return;
        e.preventDefault();
        state.filters.q = heroSearch.value.trim();
        const search = document.getElementById('mktSearch');
        if (search) search.value = heroSearch.value;
        switchView('browse');
      });
    }

    document.addEventListener('click', (e) => {
      if (e.target === overlay()) closeDetail();
      if (e.target.id === 'mktSellerOverlay') closeSellerProfile();
    });
    document.addEventListener('keydown', (e) => {
      if (e.key !== 'Escape') return;
      closeDetail();
      closeSellerProfile();
    });

    handleDeepLink();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
