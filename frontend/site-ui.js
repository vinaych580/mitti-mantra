/* =========================================================
   AgriSim — Global interactions
   Scroll reveal, nav behavior, count-up, mobile menu, video demo
   ========================================================= */

(() => {
  'use strict';

  /* ---------- Nav: scrolled state ---------- */
  const nav = document.getElementById('nav');
  if (nav) {
    const onScroll = () => nav.classList.toggle('scrolled', window.scrollY > 20);
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
  }

  /* ---------- Mobile menu ---------- */
  const burger = document.getElementById('burger');
  const mPanel = document.getElementById('mPanel');
  const mBackdrop = document.getElementById('mBackdrop');
  const mClose = document.getElementById('mClose');
  // The chat and quick-tools FABs float at z-index 9998/9999 -- above the
  // mobile-panel's 200 -- so without this they stay visible and tappable
  // on top of the open nav menu, reading as two unrelated buttons stuck to
  // someone else's panel. Hiding them for the duration keeps the open menu
  // the one thing on screen.
  const openMenu = () => { mPanel?.classList.add('open'); mBackdrop?.classList.add('open'); document.body.classList.add('mm-menu-open'); document.body.style.overflow = 'hidden'; };
  const closeMenu = () => { mPanel?.classList.remove('open'); mBackdrop?.classList.remove('open'); document.body.classList.remove('mm-menu-open'); document.body.style.overflow = ''; };
  burger?.addEventListener('click', openMenu);
  mClose?.addEventListener('click', closeMenu);
  mBackdrop?.addEventListener('click', closeMenu);
  mPanel?.querySelectorAll('a').forEach(a => a.addEventListener('click', closeMenu));

  /* ---------- Scroll reveal via IntersectionObserver ---------- */
  const revealEls = document.querySelectorAll('.reveal, .reveal-stagger');
  if ('IntersectionObserver' in window && revealEls.length) {
    const io = new IntersectionObserver((entries) => {
      entries.forEach(e => {
        if (e.isIntersecting) {
          e.target.classList.add('in-view');
          io.unobserve(e.target);
        }
      });
    }, { threshold: 0.12, rootMargin: '0px 0px -60px 0px' });
    revealEls.forEach(el => io.observe(el));
  } else {
    revealEls.forEach(el => el.classList.add('in-view'));
  }

  /* ---------- Feature cards: pointer-tracked spotlight ----------
     One delegated listener for the whole grid, rAF-coalesced, and only
     wired up on real hover devices with motion allowed. Writes two CSS
     custom properties; all the painting is done by the stylesheet. */
  const bento = document.getElementById('featuresBento');
  const fineHover = window.matchMedia('(hover: hover) and (pointer: fine)').matches;
  const noMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  if (bento && fineHover && !noMotion) {
    let frame = 0;
    let pending = null;

    bento.addEventListener('pointermove', (e) => {
      const card = e.target.closest('.feature');
      if (!card) return;
      pending = { card, x: e.clientX, y: e.clientY };
      if (frame) return;
      frame = requestAnimationFrame(() => {
        frame = 0;
        if (!pending) return;
        const { card: c, x, y } = pending;
        const r = c.getBoundingClientRect();
        c.style.setProperty('--mx', (x - r.left) + 'px');
        c.style.setProperty('--my', (y - r.top) + 'px');
      });
    }, { passive: true });

    bento.addEventListener('pointerleave', () => {
      if (frame) { cancelAnimationFrame(frame); frame = 0; }
      pending = null;
    }, { passive: true });
  }

  /* ---------- Count-up numbers ---------- */
  const counters = document.querySelectorAll('[data-count]');
  if (counters.length) {
    const formatNumber = (n) => {
      if (n >= 1000) return Math.round(n / 1000) + 'K';
      return Math.round(n).toString();
    };
    const animateCount = (el) => {
      const target = parseFloat(el.dataset.count);
      const suffix = el.querySelector('small')?.outerHTML || '';
      const duration = 1600;
      const start = performance.now();
      const from = 0;
      const step = (now) => {
        const p = Math.min((now - start) / duration, 1);
        const eased = 1 - Math.pow(1 - p, 3); // easeOutCubic
        const val = from + (target - from) * eased;
        let display;
        if (target >= 1000) {
          display = (val / 1000).toFixed(val < 10000 ? 1 : 0).replace(/\.0$/, '') + 'K';
        } else {
          display = Math.round(val).toString();
        }
        el.innerHTML = display + suffix;
        if (p < 1) requestAnimationFrame(step);
      };
      requestAnimationFrame(step);
    };
    const countIO = new IntersectionObserver((entries) => {
      entries.forEach(e => {
        if (e.isIntersecting) {
          animateCount(e.target);
          countIO.unobserve(e.target);
        }
      });
    }, { threshold: 0.4 });
    counters.forEach(c => countIO.observe(c));
  }

  /* ---------- Smooth anchor scroll (progressive enhancement) ---------- */
  document.querySelectorAll('a[href^="#"]').forEach(a => {
    a.addEventListener('click', (e) => {
      const id = a.getAttribute('href');
      if (id === '#' || id.length < 2) return;
      let el = null;
      try {
        el = document.querySelector(id);
      } catch (_) {
        return;
      }
      if (!el) return;
      e.preventDefault();
      const navH = 72;
      window.scrollTo({ top: el.getBoundingClientRect().top + window.scrollY - navH + 1, behavior: 'smooth' });
    });
  });


  /* ---------- PWA: manifest + service worker registration ---------- */
  if (!document.querySelector('link[rel="manifest"]')) {
    const m = document.createElement('link');
    m.rel = 'manifest';
    m.href = 'manifest.webmanifest';
    document.head.appendChild(m);
  }
  if (!document.querySelector('meta[name="theme-color"]')) {
    const tc = document.createElement('meta');
    tc.name = 'theme-color';
    tc.content = '#2f6b3a';
    document.head.appendChild(tc);
  }
  if ('serviceWorker' in navigator && /^https?:/.test(location.protocol)) {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('sw.js').catch((e) => {
        console.warn('[pwa] SW registration failed:', e.message);
      });
    });
  }

  /* ---------- Subtle parallax on hero image ---------- */
  const heroBgImg = document.querySelector('.hero__bg img');
  if (heroBgImg && window.matchMedia('(prefers-reduced-motion: no-preference)').matches) {
    // Scroll fires far more often than the display repaints -- writing the
    // style straight from the handler (as this used to) forces a style
    // recalc on every one of those events instead of once per frame, which
    // is what made scrolling anywhere on the page feel like it was
    // stuttering on mobile. Coalescing through rAF, the same pattern the
    // pointermove handler above uses, caps the writes at one per frame.
    let parallaxFrame = 0;
    window.addEventListener('scroll', () => {
      if (parallaxFrame) return;
      parallaxFrame = requestAnimationFrame(() => {
        parallaxFrame = 0;
        const y = window.scrollY;
        if (y < 900) heroBgImg.style.transform = `translateY(${y * 0.2}px) scale(${1 + y * 0.0002})`;
      });
    }, { passive: true });
  }

})();
