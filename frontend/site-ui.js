/* =========================================================
   AgriSim — Global interactions
   Scroll reveal, nav behavior, count-up, mobile menu, video demo
   ========================================================= */

(() => {
  'use strict';

  /* ---------- Footer year ----------
     The copyright lines were typed by hand and had drifted (one page said
     2026, the rest 2025). The markup carries the current year as a fallback
     for no-JS; this keeps it from going stale again. */
  document.querySelectorAll('[data-year]').forEach(el => {
    el.textContent = String(new Date().getFullYear());
  });

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
  let revealIO = null;
  if ('IntersectionObserver' in window && revealEls.length) {
    revealIO = new IntersectionObserver((entries) => {
      entries.forEach(e => {
        if (e.isIntersecting) {
          e.target.classList.add('in-view');
          revealIO.unobserve(e.target);
        }
      });
    }, { threshold: 0.12, rootMargin: '0px 0px -60px 0px' });
    revealEls.forEach(el => revealIO.observe(el));
  } else {
    revealEls.forEach(el => el.classList.add('in-view'));
  }

  /* ---------- Scroll-linked reveals (once Lenis is running) ----------
     The observer above plays a fixed .9s fade the moment an element crosses
     its threshold. With Lenis supplying a per-frame scroll position, anything
     still below the fold is tied to the scroll instead: it rises and fades in
     over the last ~28% of the viewport as it is scrolled into place.

     Progress only ever goes up -- scrolling back never hides content that has
     been read -- and a finished element is handed back to the stylesheet's
     normal .in-view state, so hover transitions and the bento's bar
     animations behave exactly as they do without Lenis. */
  function scrubReveals(lenis) {
    const items = [];
    const take = (el, dist, group) => {
      el.classList.add('reveal-scrub');
      items.push({ el, dist, group, p: 0, done: false });
    };
    revealEls.forEach(el => {
      if (el.classList.contains('in-view')) return;
      const r = el.getBoundingClientRect();
      // Hidden (display:none tab) or already on screen: the observer's
      // one-shot fade is the right answer, leave it be.
      if ((!r.width && !r.height) || (r.top < window.innerHeight && r.bottom > 0)) return;
      revealIO?.unobserve(el);
      // A stagger group is tracked card by card, each by its own position,
      // so the second row of a grid reveals when *it* arrives rather than
      // riding in with the first.
      if (el.classList.contains('reveal-stagger')) [...el.children].forEach(c => take(c, 24, el));
      else take(el, 32, null);
    });
    if (!items.length) return;

    const finish = (it) => {
      it.done = true;
      it.el.classList.remove('reveal-scrub');
      it.el.style.removeProperty('--rp');
      (it.group || it.el).classList.add('in-view');
    };

    const frame = () => {
      const pending = items.filter(it => !it.done);
      if (!pending.length) { lenis.off('scroll', frame); return; }
      const vh = window.innerHeight;
      const vw = window.innerWidth;
      const span = vh * 0.28;
      // Nothing near the foot of the page can travel the full span.
      const atEnd = lenis.limit - window.scrollY < 2;
      // All reads, then all writes: one style recalc per frame.
      const next = pending.map((it) => {
        const r = it.el.getBoundingClientRect();
        if (atEnd || (!r.width && !r.height)) return 1;
        // The rect includes the offset this code applied last frame.
        const top = r.top - (1 - it.p) * it.dist;
        // Cards in the same row trail each other left to right.
        const lag = it.group ? (r.left / vw) * 0.3 : 0;
        const raw = Math.min(Math.max((vh - top) / span - lag, 0), 1);
        return Math.max(it.p, 1 - (1 - raw) * (1 - raw)); // easeOutQuad, latched
      });
      pending.forEach((it, i) => {
        const p = next[i];
        if (p >= 1) { finish(it); return; }
        if (p === it.p) return;
        it.p = p;
        it.el.style.setProperty('--rp', p.toFixed(3));
      });
    };
    lenis.on('scroll', frame);
    window.addEventListener('resize', frame, { passive: true });
    frame();
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

  /* ---------- Smooth wheel scrolling (Lenis) ----------
     Loaded on demand rather than from a <script> tag, and only where it can
     do anything: Lenis leaves touch scrolling native, so a phone would pay
     for the download and get nothing back. Reduced-motion users keep the
     browser's own scrolling too. Everything below falls back to native
     scrolling until (or unless) the script arrives. */
  let lenis = null;
  if (fineHover && !noMotion) {
    const s = document.createElement('script');
    s.src = 'vendor/lenis.min.js';
    s.onload = () => {
      if (typeof window.Lenis !== 'function') return;
      // style.css sets scroll-behavior: smooth on <html>, which would animate
      // every per-frame scrollTo Lenis makes and fight it. Overridden here
      // rather than in the stylesheet so a cached style.css can't be paired
      // with this script and miss the rule.
      document.documentElement.style.scrollBehavior = 'auto';
      // style.css also pins <body> to height:100% with overflow-x:hidden,
      // which computes to a box that overflows itself vertically -- exactly
      // what allowNestedScroll looks for, so Lenis would take <body> for a
      // nested scroller and hand every wheel event back to the browser.
      // This is the same height:auto that lenis.css ships.
      document.body.style.height = 'auto';
      lenis =new window.Lenis({
        autoRaf: true,
        lerp: 0.1,
        // Chat panel, modals, sidebars and tables keep their own scrolling.
        allowNestedScroll: true,
        // The India globe (and anything else that claims the wheel for
        // itself, e.g. to zoom) calls preventDefault before the event
        // bubbles up to Lenis -- don't scroll the page underneath it.
        virtualScroll: ({ event }) => !event.defaultPrevented,
      });
      window.mmLenis = lenis;

      // The mobile menu and the booking modals lock the page by setting
      // overflow:hidden on <body>. Lenis scrolls with scrollTo, which ignores
      // that, so mirror the lock instead of teaching each caller about Lenis.
      const syncLock = () => {
        if (getComputedStyle(document.body).overflowY === 'hidden') lenis.stop();
        else lenis.start();
      };
      new MutationObserver(syncLock).observe(document.body, { attributes: true, attributeFilter: ['style', 'class'] });
      syncLock();

      scrubReveals(lenis);
      driveParallax(lenis);
    };
    document.head.appendChild(s);
  }

  /* ---------- Programmatic scrolling ----------
     One place for "bring this into view" so every jump on the site shares an
     easing. It matters beyond looks: a native smooth scroll started while
     Lenis is still easing a wheel gesture loses to Lenis's next frame and the
     page never arrives. Through Lenis the jump simply replaces the gesture.
     Falls back to the browser's own scrolling when Lenis isn't running
     (touch devices, reduced motion, page locked behind a modal). */
  const scrollPadTop = () => parseFloat(getComputedStyle(document.documentElement).scrollPaddingTop) || 0;
  window.mmScroll = {
    to(top) {
      top = Math.max(top, 0);
      if (lenis && !lenis.isStopped) {
        // Lenis re-measures the page on a debounce. A jump made right after
        // content grew (a dashboard result rendering) would be clamped to
        // the old, shorter page and stop short of its target.
        lenis.resize();
        lenis.scrollTo(top, { duration: 1.1 });
      } else {
        window.scrollTo({ top, behavior: noMotion ? 'auto' : 'smooth' });
      }
    },
    // Same landing spot as el.scrollIntoView({ block }), for 'start' and
    // 'center': scroll-padding-top and scroll-margin-top are honoured.
    intoView(el, block = 'start') {
      if (!el) return;
      if (!lenis || lenis.isStopped) {
        el.scrollIntoView({ behavior: noMotion ? 'auto' : 'smooth', block });
        return;
      }
      const r = el.getBoundingClientRect();
      const pad = scrollPadTop();
      const inset = block === 'center'
        ? (window.innerHeight - pad - r.height) / 2
        : parseFloat(getComputedStyle(el).scrollMarginTop) || 0;
      this.to(r.top + window.scrollY - pad - inset);
    },
  };

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
      window.mmScroll.to(el.getBoundingClientRect().top + window.scrollY - navH + 1);
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
  let dropNativeParallax = null;
  if (heroBgImg && !noMotion) {
    // Scroll fires far more often than the display repaints -- writing the
    // style straight from the handler (as this used to) forces a style
    // recalc on every one of those events instead of once per frame, which
    // is what made scrolling anywhere on the page feel like it was
    // stuttering on mobile. Coalescing through rAF, the same pattern the
    // pointermove handler above uses, caps the writes at one per frame.
    let parallaxFrame = 0;
    const onScroll = () => {
      if (parallaxFrame) return;
      parallaxFrame = requestAnimationFrame(() => {
        parallaxFrame = 0;
        const y = window.scrollY;
        if (y < 900) heroBgImg.style.transform = `translateY(${y * 0.2}px) scale(${1 + y * 0.0002})`;
      });
    };
    window.addEventListener('scroll', onScroll, { passive: true });
    dropNativeParallax = () => {
      window.removeEventListener('scroll', onScroll);
      if (parallaxFrame) { cancelAnimationFrame(parallaxFrame); parallaxFrame = 0; }
    };
  }

  /* ---------- Parallax driven by Lenis ----------
     The listener above writes a frame *after* the scroll it reacts to, so the
     hero photo trails the page by a frame. Lenis emits from the same frame it
     moves the page in, which removes that lag, and its position is fractional
     so slow scrolling doesn't step a pixel at a time. With that in hand, two
     more layers get depth: the hero's foreground leads the photo slightly,
     and the showcase photo drifts inside its frame.

     These use the standalone `translate` / `scale` properties rather than
     `transform`, so they compose with the stylesheet's own transforms (the
     showcase image's hover zoom) instead of replacing them, and aren't
     dragged through those rules' transitions. */
  function driveParallax(lenis) {
    const heroWrap = document.querySelector('.hero__wrap');
    const media = document.querySelector('.showcase__media');
    const mediaImg = media?.querySelector('img');
    if (!heroBgImg && !heroWrap && !mediaImg) return;
    dropNativeParallax?.();
    // Oversize the photo so drifting it never exposes the frame behind it.
    if (mediaImg) mediaImg.style.scale = '1.12';

    const frame = () => {
      const y = Math.min(lenis.scroll, 900);
      if (heroBgImg) heroBgImg.style.transform = `translateY(${(y * 0.2).toFixed(2)}px) scale(${(1 + y * 0.0002).toFixed(4)})`;
      // Back to `none` at rest: any other value makes .hero__wrap a
      // containing block for fixed-position descendants.
      if (heroWrap) heroWrap.style.translate = y > 0 ? `0 ${(y * -0.06).toFixed(2)}px` : '';
      if (mediaImg) {
        const r = media.getBoundingClientRect();
        if (r.bottom > 0 && r.top < window.innerHeight) {
          // -1 (frame leaving the top) .. 1 (frame entering at the bottom)
          const t = Math.min(Math.max(((r.top + r.height / 2) / window.innerHeight - 0.5) * 2 / (1 + r.height / window.innerHeight), -1), 1);
          mediaImg.style.translate = `0 ${(-t * r.height * 0.05).toFixed(2)}px`;
        }
      }
    };
    lenis.on('scroll', frame);
    frame();
  }

})();
