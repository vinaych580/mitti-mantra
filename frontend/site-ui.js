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

  /* ---------- Motion preference (Phase 4.8) ----------
     One answer to "should this move?": the OS reduced-motion setting, or
     the in-app "Reduce motion" switch in the tools panel (stored by
     mm-core.js under mm_a11y). Read from storage rather than from the
     <html> class because this file can run before mm-core.js applies it.
     Scripts that animate from JS -- the globe, Lenis, parallax, count-up --
     ask here, and subscribe so that turning it on stops motion that is
     already running instead of waiting for the next page. */
  const motionMq = window.matchMedia ? window.matchMedia('(prefers-reduced-motion: reduce)') : null;
  const appReducedMotion = () => {
    try { return !!JSON.parse(localStorage.getItem('mm_a11y') || '{}').reduceMotion; } catch (_) { return false; }
  };
  const motionSubs = [];
  window.mmMotion = {
    reduced: () => !!(motionMq && motionMq.matches) || appReducedMotion(),
    onChange(fn) { if (typeof fn === 'function') motionSubs.push(fn); },
    notify() {
      const r = this.reduced();
      motionSubs.forEach(fn => { try { fn(r); } catch (_) { /* one listener must not stop the rest */ } });
    },
  };
  if (motionMq && motionMq.addEventListener) motionMq.addEventListener('change', () => window.mmMotion.notify());

  /* ---------- Focus handling for popovers, sheets and modals (F-11) ----------
     trap(root, opts) moves focus in, keeps Tab and Shift+Tab inside root,
     closes on Escape (opts.onEscape) and hands back a release() that returns
     focus to whatever had it before. `modal: false` is for a floating panel
     the page stays usable behind (the chat): Tab only wraps while focus is
     already inside, and a click on the page is not pulled back. */
  const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"]), [contenteditable="true"]';
  const focusablesIn = (root) => [...root.querySelectorAll(FOCUSABLE)]
    .filter(el => !el.closest('[hidden], [inert]') && el.getClientRects().length);
  const traps = [];
  document.addEventListener('keydown', (e) => {
    const top = traps[traps.length - 1];
    if (!top || !document.contains(top.root)) return;
    if (e.key === 'Escape' && top.onEscape) {
      // An open <select> or a field's own Escape (clearing a search) wins.
      if (e.defaultPrevented) return;
      e.preventDefault();
      top.onEscape(e);
      return;
    }
    if (e.key !== 'Tab') return;
    const inside = top.root.contains(document.activeElement);
    if (!top.modal && !inside) return;
    const list = focusablesIn(top.root);
    if (!list.length) { e.preventDefault(); top.root.focus(); return; }
    const first = list[0], last = list[list.length - 1];
    if (!inside) { e.preventDefault(); first.focus(); }
    else if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  });
  window.mmFocus = {
    focusables: focusablesIn,
    trap(root, { onEscape = null, initial = null, returnTo = null, modal = true } = {}) {
      if (!root) return () => {};
      const entry = { root, onEscape, modal, returnTo: returnTo || document.activeElement };
      // Re-trapping the same root (re-rendered content) replaces its entry.
      const prev = traps.findIndex(t => t.root === root);
      if (prev >= 0) { entry.returnTo = traps[prev].returnTo; traps.splice(prev, 1); }
      traps.push(entry);
      const target = (typeof initial === 'string' ? root.querySelector(initial) : initial) || focusablesIn(root)[0];
      if (target) target.focus({ preventScroll: true });
      else { if (!root.hasAttribute('tabindex')) root.tabIndex = -1; root.focus({ preventScroll: true }); }
      return ({ restore = true } = {}) => {
        const i = traps.indexOf(entry);
        if (i < 0) return;
        traps.splice(i, 1);
        const back = entry.returnTo;
        if (restore && back && document.contains(back) && back.getClientRects().length) back.focus({ preventScroll: true });
      };
    },
  };

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
  let releaseMenu = null;
  const closeMenu = ({ restore = true } = {}) => {
    mPanel?.classList.remove('open'); mBackdrop?.classList.remove('open'); document.body.classList.remove('mm-menu-open'); document.body.style.overflow = '';
    burger?.setAttribute('aria-expanded', 'false');
    if (releaseMenu) { releaseMenu({ restore }); releaseMenu = null; }
  };
  const openMenu = () => {
    mPanel?.classList.add('open'); mBackdrop?.classList.add('open'); document.body.classList.add('mm-menu-open'); document.body.style.overflow = 'hidden';
    burger?.setAttribute('aria-expanded', 'true');
    if (mPanel && !releaseMenu) releaseMenu = window.mmFocus.trap(mPanel, { onEscape: () => closeMenu(), returnTo: burger });
  };
  burger?.setAttribute('aria-expanded', 'false');
  burger?.addEventListener('click', openMenu);
  mClose?.addEventListener('click', closeMenu);
  mBackdrop?.addEventListener('click', closeMenu);
  // Following a link leaves focus where the link took it.
  mPanel?.querySelectorAll('a').forEach(a => a.addEventListener('click', () => closeMenu({ restore: false })));

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
  let noMotion = window.mmMotion.reduced();

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
      // Reduced motion: the final figure at once, no count.
      const duration = noMotion ? 0 : 1600;
      const start = performance.now();
      const from = 0;
      const step = (now) => {
        const p = duration ? Math.min((now - start) / duration, 1) : 1;
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
      // <html> is pinned too, and it is the box Lenis watches to notice the
      // page growing: held at viewport height it never resizes, so content
      // rendered later (a decide answer, a dashboard result) left Lenis with
      // the old scroll limit and the wheel stopped dead above it.
      // This is the same height:auto that lenis.css ships for both.
      document.documentElement.style.height = 'auto';
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
        if (!lenis) return; // dropped for reduced motion
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

  /* ---------- Reduced motion switched on mid-page ----------
     Everything above reads the preference once, at load. When it changes
     to "reduce" while the page is open (OS setting, or the tools panel's
     Reduce motion), stop what is already moving: hand the page back to
     native scrolling, settle every reveal, park the parallax layers.
     Turning it off again takes effect on the next page. */
  window.mmMotion.onChange((reduced) => {
    noMotion = reduced;
    if (!reduced) return;
    document.querySelectorAll('.reveal-scrub').forEach(el => {
      el.classList.remove('reveal-scrub');
      el.style.removeProperty('--rp');
    });
    revealEls.forEach(el => el.classList.add('in-view'));
    if (typeof dropNativeParallax === 'function') dropNativeParallax();
    if (lenis) {
      lenis.destroy();
      lenis = null;
      window.mmLenis = null;
      document.documentElement.style.scrollBehavior = '';
      document.documentElement.style.height = '';
      document.body.style.height = '';
    }
    const heroImg = document.querySelector('.hero__bg img');
    if (heroImg) heroImg.style.transform = '';
    const heroWrap = document.querySelector('.hero__wrap');
    if (heroWrap) heroWrap.style.translate = '';
    const showImg = document.querySelector('.showcase__media img');
    if (showImg) { showImg.style.scale = ''; showImg.style.translate = ''; }
  });

  /* ---------- Programmatic scrolling ----------
     One place for "bring this into view" so every jump on the site shares an
     easing. It matters beyond looks: a native smooth scroll started while
     Lenis is still easing a wheel gesture loses to Lenis's next frame and the
     page never arrives. Through Lenis the jump simply replaces the gesture.
     Falls back to the browser's own scrolling when Lenis isn't running
     (touch devices, reduced motion, page locked behind a modal). */
  const scrollPadTop = () => parseFloat(getComputedStyle(document.documentElement).scrollPaddingTop) || 0;
  window.mmScroll = {
    // `instant` skips the easing: for a jump that something else is already
    // animating over (a view transition), where a second motion underneath
    // would only fight it.
    to(top, { instant = false } = {}) {
      top = Math.max(top, 0);
      if (lenis && !lenis.isStopped) {
        // Lenis re-measures the page on a debounce. A jump made right after
        // content grew (a dashboard result rendering) would be clamped to
        // the old, shorter page and stop short of its target.
        lenis.resize();
        lenis.scrollTo(top, instant ? { immediate: true } : { duration: 1.1 });
      } else {
        // 'instant', not 'auto': auto defers to the stylesheet's
        // scroll-behavior: smooth.
        window.scrollTo({ top, behavior: instant ? 'instant' : noMotion ? 'auto' : 'smooth' });
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

  /* ---------- Instant page loads (Speculation Rules) ----------
     Fetches a page's HTML the moment a visitor shows they are about to open
     it -- a short hover on desktop, the start of a tap on touch -- so the
     click lands on a document that is already here, and the cross-fade above
     plays without a wait. Prefetch rather than prerender: a prerender runs
     the page's scripts and API calls (and its local usage counters) for a
     page that may never be opened. Skipped entirely under Data Saver.
     Browsers without support ignore all of this. */
  const saveData = navigator.connection && navigator.connection.saveData;
  if (!saveData && window.HTMLScriptElement && HTMLScriptElement.supports &&
      HTMLScriptElement.supports('speculationrules')) {
    const rules = document.createElement('script');
    rules.type = 'speculationrules';
    rules.textContent = JSON.stringify({
      prefetch: [{
        where: {
          and: [
            { href_matches: '/*' },
            { not: { href_matches: '/api/*' } },
            { not: { href_matches: '/docs*' } },
            { not: { selector_matches: '[target="_blank"], [download], [rel~="nofollow"]' } },
          ],
        },
        eagerness: fineHover ? 'moderate' : 'conservative',
      }],
    });
    document.head.appendChild(rules);
  }

  /* ---------- Skipped page transitions ----------
     A cross-page view transition is skipped when the tab is hidden or a
     second navigation interrupts the first. Nothing is wrong when that
     happens, but the browser rejects the transition's promises, and with no
     handler it reports each one as an uncaught error. */
  const quietTransition = (e) => {
    const vt = e.viewTransition;
    if (!vt) return;
    vt.ready?.catch(() => {});
    vt.updateCallbackDone?.catch(() => {});
    vt.finished?.catch(() => {});
  };
  window.addEventListener('pageswap', quietTransition);
  window.addEventListener('pagereveal', quietTransition);

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
