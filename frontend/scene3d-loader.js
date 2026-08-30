/* ==========================================================
   Lazy-loads Three.js + india-globe.js only once the 3D scene
   section is about to scroll into view, instead of shipping
   ~160 KiB of JS (most of it unused above the fold) on every
   page load. india-globe.js already tolerates THREE being
   absent (renders an SVG map fallback), so this is safe even
   if the CDN fetch is slow or fails.
   ========================================================== */
(() => {
  const host = document.getElementById('scene3dCanvas');
  if (!host) return;

  let triggered = false;
  function loadScene3d() {
    if (triggered) return;
    triggered = true;
    const three = document.createElement('script');
    three.src = 'https://cdn.jsdelivr.net/npm/three@0.160.0/build/three.min.js';
    const loadGlobe = () => {
      const globe = document.createElement('script');
      globe.src = 'india-globe.js';
      document.body.appendChild(globe);
    };
    three.onload = loadGlobe;
    three.onerror = loadGlobe; // india-globe.js falls back to an SVG map when THREE is missing
    document.body.appendChild(three);
  }

  if ('IntersectionObserver' in window) {
    const io = new IntersectionObserver((entries) => {
      if (entries.some(e => e.isIntersecting)) {
        io.disconnect();
        loadScene3d();
      }
    }, { rootMargin: '800px 0px' });
    io.observe(host);
  } else {
    loadScene3d();
  }
})();
