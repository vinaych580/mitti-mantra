/* AgriSim — Service Worker
   Strategy:
     • Precache the core shell (HTML/CSS/JS) on install.
     • Runtime cache-first for same-origin static assets.
     • Stale-while-revalidate for cross-origin CDN libs & tiles.
     • Network-only for API calls to the backend.
*/

// v51: farm-boundary.html stopped loading Turf via a <script> tag and
// farm-boundary.js started loading it on demand instead. HTML is network-first
// but JS is stale-while-revalidate, so without a VERSION bump a returning
// visitor would pair the new markup with the previous farm-boundary.js -- whose
// startup guard aborts when window.turf is absent -- and lose plot drawing for
// a load. Bumping drops the old cache on activate so both refresh together.
// v52: code-quality pass touched most shell scripts (dashboard, mm-core,
// toolbar, chatbot, farm-boundary, marketplace, book-a-tractor, gyan-seva)
// and book-a-tractor.html; same reasoning -- ship them as one set.
// v57: decide.html and the two scripts only it loads (decide.js,
// region-geo.js) join the precache. They were cached only once visited, so
// offline a first-time visitor to the guided flow got index.html instead.
// v58: all-round upgrade. i18n-data.js split into i18n/<lang>.js (loaded on
// demand); login.html + auth.js replaced by your-data.html/.js; new
// mm-palette.js on every page; Data/*.js re-encoded column by column;
// farm-boundary.js no longer loads Turf. Shipped as one set so no visitor
// pairs new markup with an old script.
// v60: site-ui.js (wheel scrolling stalled once a page grew), decide.js
// (ranking rows) and india-globe.js (textures pinned past a redirect that
// broke them in Firefox). Stale-while-revalidate would otherwise serve the
// broken copies for one more load.
// v62: Phase 0 -- season pages on the shared nav, mic buttons with a
// listening state, capped offline cache, typical-budget defaults, and the
// kn/ta season strings. Every precached season file changed.
// v63: Phase 1 -- region-geo.js points at the pipeline's pilot table; the nav
// logo no longer collapses at 375px under long (Tamil) button labels, and the
// your-data file button wraps instead of widening the page.
const VERSION = 'mittimantra-v78';
const CORE = [
  './',
  './index.html',
  './dashboard.html',
  './farm-boundary.html',
  './marketplace.html',
  './gyan-seva.html',
  './book-a-tractor.html',
  './your-data.html',
  './decide.html',
  './season.html',
  './season.css',
  './season-plan.js',
  './season-ui.js',
  './season-home.js',
  './season-voice.js',
  './style.css',
  './assets/logo-128.png',
  './assets/logo-192.png',
  './assets/logo-512.png',
  './site-ui.js',
  './mm-palette.js',
  './vendor/lenis.min.js',
  './state-data.js',
  './india-globe.js',
  './scene3d-loader.js',
  './demo-recommender.js',
  './dashboard.js',
  './mm-estimate.js',
  './decide.js',
  './region-geo.js',
  './offline-simulator.js',
  './farm-boundary.js',
  './farm-state.js',
  './i18n/hi.js',
  './i18n/te.js',
  './i18n/kn.js',
  './i18n/ta.js',
  './i18n.js',
  './toolbar.js',
  './mm-core.js',
  './mm-analytics.js',
  './mm-freshness.js',
  './mm-plots.js',
  './mm-enhance.js',
  './chatbot.js',
  './marketplace.js',
  './gyan-seva.js',
  './book-a-tractor.js',
  './tractor-waitlist.js',
  './map-tractors.js',
  './hero-title.js',
  './your-data.js',
  './Data/marketplace-listings.js',
  './Data/india-states.geo.json',
  './assets/marketplace/rice.webp',
  './assets/marketplace/paddy_basmati.webp',
  './assets/marketplace/wheat.webp',
  './assets/marketplace/cotton.webp',
  './assets/marketplace/maize.webp',
  './assets/marketplace/soybean.webp',
  './assets/marketplace/groundnut.webp',
  './assets/marketplace/mustard.webp',
  './assets/marketplace/tomato.webp',
  './assets/marketplace/onion.webp',
  './assets/marketplace/potato.webp',
  './assets/marketplace/chilli.webp',
  './assets/marketplace/turmeric.webp',
  './assets/marketplace/sugarcane.webp',
  './assets/marketplace/arhar.webp',
  './assets/marketplace/pulses.webp',
  './assets/marketplace/moong.webp',
  './assets/marketplace/banana.webp',
  './assets/marketplace/mango.webp',
  './assets/marketplace/jute.webp',
  './assets/marketplace/bajra.webp',
  './assets/marketplace/jowar.webp',
  './assets/marketplace/coconut.webp',
  './assets/marketplace/sunflower.webp',
  './assets/marketplace/ragi.webp',
  './manifest.webmanifest',
];

self.addEventListener('install', (event) => {
  // Deliberately not `addAll`: it is atomic, so a single 404 (a renamed asset,
  // a page not yet deployed) would silently discard the whole precache and
  // leave the app with no offline shell at all. Cache each entry on its own so
  // one bad URL costs one file.
  event.waitUntil(
    caches.open(VERSION).then((cache) =>
      Promise.all(CORE.map((url) => cache.add(url).catch(() => null)))
    )
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

function isApiCall(url) {
  // Adjust to match your backend origin if different
  return /\/(api|docs|openapi\.json)(\/|$)/.test(url.pathname);
}

function isHtmlNav(req, url) {
  // Treat explicit page navigations, or requests that accept HTML, as
  // navigation requests. These MUST be network-first, otherwise stale HTML
  // can outlive a CSS/JS update and cause markup/style drift.
  if (req.mode === 'navigate') return true;
  const accept = req.headers.get('accept') || '';
  if (accept.includes('text/html')) return true;
  return /\.html?$/i.test(url.pathname);
}

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);

  // Always hit the network for backend APIs
  if (url.origin === location.origin && isApiCall(url)) return;

  // Same-origin HTML: network-first, fall back to cache when offline.
  if (url.origin === location.origin && isHtmlNav(req, url)) {
    event.respondWith(
      fetch(req).then((res) => {
        const clone = res.clone();
        caches.open(VERSION).then((c) => c.put(req, clone)).catch(() => null);
        return res;
      }).catch(() => caches.match(req).then((c) => c || caches.match('./index.html')))
    );
    return;
  }

  // Generated data under Data/ is the exception to the rule below: these files
  // are large (consultants.js alone is ~1.8MB raw), they only ever change when a
  // deploy regenerates them, and VERSION is bumped on every such deploy. Under
  // stale-while-revalidate the network fetch is issued even on a cache hit, so a
  // visitor on a metered rural connection re-paid for them on every page load
  // without ever receiving different bytes. Cache-first; VERSION does the
  // invalidating, which is what VERSION is for.
  if (url.origin === location.origin && /\/Data\/[^/]+\.(js|json)$/i.test(url.pathname)) {
    event.respondWith(
      caches.match(req).then((cached) =>
        cached || fetch(req).then((res) => {
          if (res && res.ok) {
            const clone = res.clone();
            caches.open(VERSION).then((c) => c.put(req, clone)).catch(() => null);
          }
          return res;
        }).catch(() => cached)
      )
    );
    return;
  }

  // Same-origin code (JS/CSS): stale-while-revalidate. These URLs are stable
  // across deploys -- there is no build step to hash them -- so pure cache-first
  // would pin a visitor to an old bundle until VERSION happens to change. Serve
  // the cached copy instantly, then refresh it in the background for next load.
  if (url.origin === location.origin && /\.(js|css|json)$/i.test(url.pathname)) {
    event.respondWith(
      caches.match(req).then((cached) => {
        const network = fetch(req).then((res) => {
          if (res && res.ok) {
            const clone = res.clone();
            caches.open(VERSION).then((c) => c.put(req, clone)).catch(() => null);
          }
          return res;
        }).catch(() => cached);
        return cached || network;
      })
    );
    return;
  }

  // Same-origin immutable assets (images, fonts): cache-first
  if (url.origin === location.origin) {
    event.respondWith(
      caches.match(req).then((cached) =>
        cached || fetch(req).then((res) => {
          const clone = res.clone();
          caches.open(VERSION).then((c) => c.put(req, clone)).catch(() => null);
          return res;
        }).catch(() => cached)
      )
    );
    return;
  }

  // Cross-origin: stale-while-revalidate
  event.respondWith(
    caches.match(req).then((cached) => {
      const network = fetch(req).then((res) => {
        if (res && res.ok) {
          const clone = res.clone();
          caches.open(VERSION).then((c) => c.put(req, clone)).catch(() => null);
        }
        return res;
      }).catch(() => cached);
      return cached || network;
    })
  );
});
