/* =========================================================
   AgriSim — Quick-win toolbar
   Auto-injects a floating action column with:
     • Dark mode toggle
     • Voice input (Web Speech API, follows i18n language)
     • Read aloud (SpeechSynthesis)
     • Share on WhatsApp
     • Download the page as PDF
   No frameworks. All CDN dependencies are lazy-loaded.
   ========================================================= */

(() => {
  /* ---------- Preferences ---------- */
  const THEME_KEY = 'agrisim_theme';
  const savedTheme = localStorage.getItem(THEME_KEY);
  if (savedTheme === 'dark') document.documentElement.setAttribute('data-theme', 'dark');

  // Captured from beforeinstallprompt; used by the panel's Install app button.
  let deferredInstallPrompt = null;

  // Track the last focused input field so voice input can target it even after focus shifts to the toolbar.
  let lastActiveInput = null;
  document.addEventListener('focusin', (e) => {
    const el = e.target;
    if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA')) {
      lastActiveInput = el;
    }
  });

  /* ---------- UI styles ---------- */
  function injectStyles() {
    if (document.getElementById('qw-styles')) return;
    const s = document.createElement('style');
    s.id = 'qw-styles';
    s.textContent = `
      /* ---------- FAB trigger ----------
         Was a green hamburger the same size and colour as the chat button
         right above it -- and on phones, a second hamburger under the nav's
         own. It opens language + settings, so it now says so ("अA") and sits
         a step quieter than the chat button: a small paper disc, centred on
         the same vertical axis so the two read as one column. */
      .qw-fab {
        position: fixed; right: 24px; bottom: 20px; z-index: 9999;
        width: 44px; height: 44px; border-radius: 50%;
        background: var(--surface, #fff); color: var(--brand-deep, #1f4d28);
        border: 1px solid rgba(29,26,21,0.12); cursor: pointer;
        box-shadow: 0 6px 18px rgba(29,26,21,0.14);
        display: grid; place-items: center;
        transition: transform .3s cubic-bezier(.2,.7,.3,1.2), background .25s, color .25s;
      }
      .qw-fab:hover { background: var(--brand, #2f6b3a); color: #fff; transform: scale(1.06); }
      .qw-fab.open  { background: var(--brand-deep, #1f4d28); color: #fff; }
      .qw-fab__glyph {
        font: 600 15px/1 system-ui, -apple-system, 'Segoe UI', sans-serif; letter-spacing: 0;
      }
      .qw-fab__close { display: none; width: 18px; height: 18px; }
      .qw-fab.open .qw-fab__glyph { display: none; }
      .qw-fab.open .qw-fab__close { display: block; }

      /* ---------- Popover panel ---------- */
      .qw-panel {
        position: fixed; right: 20px; bottom: 86px; z-index: 9998;
        width: 268px; padding: 14px;
        background: rgba(255,255,255,0.98); backdrop-filter: blur(14px);
        border: 1px solid rgba(29,26,21,0.06);
        border-radius: 18px;
        box-shadow: 0 20px 50px rgba(29,26,21,0.18);
        opacity: 0; transform: translateY(12px) scale(.94);
        transform-origin: bottom right;
        pointer-events: none;
        transition: opacity .25s ease, transform .3s cubic-bezier(.2,.7,.3,1.2);
        font-family: var(--font-body, 'Inter', system-ui, sans-serif);
      }
      .qw-panel.open { opacity: 1; transform: translateY(0) scale(1); pointer-events: auto; }
      .qw-panel__label {
        font-size: 0.7rem; font-weight: 600; letter-spacing: .1em; text-transform: uppercase;
        color: #857b6e; margin: 4px 6px 8px;
      }
      .qw-panel__lang {
        display: flex; gap: 6px; margin-bottom: 12px;
      }
      /* reparented i18n switcher strips its own fixed positioning inside the panel */
      .qw-panel .i18n-switcher {
        position: static; padding: 0; background: transparent; box-shadow: none;
        border: none; backdrop-filter: none;
        display: flex; gap: 6px; flex: 1;
      }
      .qw-panel .i18n-switcher button {
        font-family: system-ui, -apple-system, 'Segoe UI', sans-serif;  /* see i18n.js */
        flex: 1; padding: 8px 10px; border-radius: 10px;
        background: #f4efe3; color: #4a4339; font-weight: 600; font-size: 0.85rem;
      }
      .qw-panel .i18n-switcher button.active { background: #2f6b3a; color: #fff; }
      .qw-panel__sep {
        height: 1px; background: rgba(29,26,21,0.06); margin: 4px 0 10px;
      }
      .qw-panel__grid {
        display: grid; grid-template-columns: 1fr 1fr; gap: 6px;
      }

      .qw-btn {
        display: flex; align-items: center; gap: 10px;
        padding: 10px 12px; border-radius: 12px;
        background: #f7f4ec; border: 1px solid transparent;
        color: #1d1a15; cursor: pointer;
        font: 600 0.85rem var(--font-body, 'Inter', sans-serif);
        opacity: 0; transform: translateY(6px);
        transition: background .2s, color .2s, transform .3s ease, opacity .3s ease;
      }
      .qw-panel.open .qw-btn { opacity: 1; transform: translateY(0); }
      /* stagger the button reveal */
      .qw-panel.open .qw-btn:nth-child(1) { transition-delay: .05s; }
      .qw-panel.open .qw-btn:nth-child(2) { transition-delay: .09s; }
      .qw-panel.open .qw-btn:nth-child(3) { transition-delay: .13s; }
      .qw-panel.open .qw-btn:nth-child(4) { transition-delay: .17s; }
      .qw-panel.open .qw-btn:nth-child(5) { transition-delay: .21s; }
      .qw-btn:hover { background: #2f6b3a; color: #fff; }
      .qw-btn.active { background: #2f6b3a; color: #fff; }
      .qw-btn svg { width: 18px; height: 18px; flex-shrink: 0; }
      .qw-btn[disabled] { opacity: 0.45; cursor: not-allowed; }
      .qw-btn__lbl { flex: 1; text-align: left; }
      /* hide old hover tip (popover now uses full labels) */
      .qw-tip { display: none; }

      /* Hide the standalone i18n switcher once it's been moved into the panel. */
      body > .i18n-switcher { display: none !important; }

      @media (max-width: 500px) {
        .qw-fab { right: 18px; bottom: 14px; }
        .qw-panel { right: 14px; bottom: 78px; width: calc(100vw - 28px); max-width: 320px; }
      }

      .qw-modal {
        position: fixed; inset: 0; z-index: 10000;
        background: rgba(20,18,14,0.55); backdrop-filter: blur(6px);
        display: grid; place-items: center; padding: 20px;
        opacity: 0; pointer-events: none; transition: opacity .2s;
      }
      .qw-modal.show { opacity: 1; pointer-events: auto; }
      .qw-modal__card {
        background: #fff; border-radius: 22px; padding: 26px;
        max-width: 440px; width: 100%;
        box-shadow: 0 24px 60px rgba(29,26,21,0.25);
        font-family: var(--font-body, 'Inter', system-ui, sans-serif);
      }
      .qw-modal__h { font-family: var(--font-display, 'Fraunces', Georgia, serif); font-size: 1.3rem; margin: 0 0 10px; color: #1d1a15; }
      .qw-modal__text { color: #4a4339; min-height: 80px; font-size: 1rem; line-height: 1.5; }
      .qw-modal__row { display: flex; gap: 8px; justify-content: flex-end; margin-top: 16px; }
      .qw-modal__btn {
        padding: 8px 16px; border-radius: 999px; font: 600 0.85rem var(--font-body, 'Inter', sans-serif);
        border: none; cursor: pointer;
      }
      .qw-modal__btn--primary { background: #2f6b3a; color: #fff; }
      .qw-modal__btn--ghost { background: transparent; color: #4a4339; }
      .qw-pulse {
        display: inline-block; width: 10px; height: 10px; border-radius: 50%;
        background: #d45c4a; margin-right: 8px; animation: qw-pulse 1s infinite;
      }
      @keyframes qw-pulse { 0%,100% { opacity: 1; } 50% { opacity: 0.3; } }

      /* =========== Dark mode =========== */
      html[data-theme="dark"] {
        --bg:            #141110;
        --bg-soft:       #1d1815;
        --surface:       #23201c;
        --surface-alpha: rgba(35,32,28,0.92);
        --ink:           #f3ece0;
        --ink-soft:      #c9bfb0;
        --ink-faint:     #8a8070;
        --brand-soft:    #1f3a24;
        --accent-soft:   #3a2c18;
        --border:        rgba(255,255,255,0.08);
        --danger:        #e06060;
        --danger-soft:   rgba(180,60,60,0.18);
        --info:          #8ec2de;
        --info-soft:     rgba(110,167,199,0.18);
        color-scheme: dark;
      }
      html[data-theme="dark"] body { background: var(--bg); color: var(--ink); }

      /* Section backgrounds already use CSS vars — this just makes hardcoded whites sane. */
      html[data-theme="dark"] .nav,
      html[data-theme="dark"] .nav.scrolled { background: rgba(20,17,16,0.88); backdrop-filter: blur(12px); }
      html[data-theme="dark"] .nav__links a { color: var(--ink-soft); }
      html[data-theme="dark"] .nav__links a:hover { color: var(--ink); }

      /* Nav goes dark in this theme, but the logo's wordmark is baked into
         the raster too dark to read on it -- give it the same light card
         the footer logo already uses. */
      html[data-theme="dark"] .nav .logo__img {
        padding: 6px 10px;
        background: #faf6ef;
        border-radius: var(--r-md);
        box-shadow: var(--shadow-sm);
        filter: none;
      }

      /* Surfaces */
      html[data-theme="dark"] .surface,
      html[data-theme="dark"] .card,
      html[data-theme="dark"] .feature,
      html[data-theme="dark"] .hero-card,
      html[data-theme="dark"] .quote,
      html[data-theme="dark"] .panel,
      html[data-theme="dark"] .tool,
      html[data-theme="dark"] .sidebar,
      html[data-theme="dark"] .mobile-panel,
      html[data-theme="dark"] .mobile-panel__close,
      html[data-theme="dark"] .nav__burger,
      html[data-theme="dark"] .step__num,
      html[data-theme="dark"] .farmmap__panel,
      html[data-theme="dark"] .farmmap__summary,
      html[data-theme="dark"] .scene3d__hud,
      html[data-theme="dark"] .scene3d__label,
      html[data-theme="dark"] .scene3d__live,
      html[data-theme="dark"] .scene3d-panel,
      html[data-theme="dark"] .livedemo,
      html[data-theme="dark"] .livedemo__card,
      html[data-theme="dark"] .showcase__badge {
        background: var(--surface) !important;
        color: var(--ink);
        border-color: rgba(255,255,255,0.06);
      }

      /* Inset tiles / subtle blocks */
      html[data-theme="dark"] .result__card,
      html[data-theme="dark"] .crop-row,
      html[data-theme="dark"] .kpi,
      html[data-theme="dark"] .chip,
      html[data-theme="dark"] .list-row,
      html[data-theme="dark"] .chart,
      html[data-theme="dark"] .chart-box,
      html[data-theme="dark"] .feature__preview,
      html[data-theme="dark"] .farmmap__grid > div,
      html[data-theme="dark"] .livedemo__summary > div,
      html[data-theme="dark"] .scene3d-stats > div {
        background: var(--bg-soft) !important;
        color: var(--ink);
      }

      /* Pastel KPIs — retune for dark */
      html[data-theme="dark"] .kpi--good  { background: rgba(47,107,58,0.18) !important; }
      html[data-theme="dark"] .kpi--good .kpi__val { color: #7fc68f; }
      html[data-theme="dark"] .kpi--warn  { background: rgba(200,138,58,0.18) !important; }
      html[data-theme="dark"] .kpi--warn .kpi__val { color: #e4b87c; }
      html[data-theme="dark"] .kpi--info  { background: rgba(110,167,199,0.18) !important; }
      html[data-theme="dark"] .kpi--info .kpi__val { color: #8ec2de; }
      /* Sidebar group labels are Deep Leaf at 75% opacity -- on the dark
         rail that's dark green on near-black and the groups disappeared. */
      html[data-theme="dark"] .sidebar__label { color: #9ed2a7; }
      html[data-theme="dark"] .chip--green { background: rgba(47,107,58,0.22) !important; color: #9ed2a7; }
      html[data-theme="dark"] .chip--gold  { background: rgba(200,138,58,0.22) !important; color: #e4b87c; }

      /* Marketplace notes. --brand-deep on --brand-soft is 8.6:1 on paper but
         both tokens go dark under this theme, collapsing to 1.3:1 — these
         carry the prototype's honesty disclaimers, so they must stay legible. */
      html[data-theme="dark"] .mkt-alert--info { color: #9ed2a7; }

      /* Same collapse as above: --clay (#a5562a) is never remapped for dark,
         so on the dark --accent-soft ground it drops to ~2.55:1. Reuse the
         same lighter gold already proven for .kpi--warn .kpi__val below. */
      html[data-theme="dark"] .tractor-weather-banner--moderate { color: #e4b87c; }

      /* Features bento — the preview widgets use light-mode hairlines
         and pastels that vanish or glare on dark. */
      html[data-theme="dark"] .features__badges li {
        background: rgba(255,255,255,0.05);
        border-color: rgba(255,255,255,0.08);
        color: var(--ink-soft);
      }
      html[data-theme="dark"] .feature__preview,
      html[data-theme="dark"] .chip { border-color: rgba(255,255,255,0.08); }
      html[data-theme="dark"] .rankbars__track,
      html[data-theme="dark"] .stages li::before { background: rgba(255,255,255,0.1); }
      html[data-theme="dark"] .feature--sky  .feature__ico { background: rgba(110,167,199,0.18); }
      html[data-theme="dark"] .feature--clay .feature__ico { background: rgba(165,86,42,0.24); }
      /* --brand on --brand-soft is dark-green-on-dark-green once the
         tokens flip; lift both to the dark-mode green. */
      html[data-theme="dark"] .chip--leaf,
      html[data-theme="dark"] .metric__delta {
        background: rgba(47,107,58,0.22) !important;
        color: #9ed2a7;
        border-color: rgba(47,107,58,0.35);
      }
      html[data-theme="dark"] .feature--cta {
        background: linear-gradient(135deg, var(--brand-soft), var(--surface) 70%) !important;
      }
      /* Farm pickup card (dashboard.js): same brand-on-brand-soft collapse as
         .chip--leaf/.mkt-alert--info above -- .fp-chip, .fp-meta__item--region,
         .fp-stat__val, and .fp-note all render --brand/--brand-deep text,
         which goes dark-green-on-dark-green now that .farm-pickup's own
         background inverts to the dark brand tokens too. */
      html[data-theme="dark"] .fp-chip {
        background: rgba(47,107,58,0.22) !important;
        border-color: rgba(47,107,58,0.35);
        color: #9ed2a7;
      }
      html[data-theme="dark"] .fp-meta__item--region,
      html[data-theme="dark"] .fp-stat__val,
      html[data-theme="dark"] .fp-note {
        color: #9ed2a7;
      }
      html[data-theme="dark"] .features__ambient { opacity: 0.45; }

      /* Landing "Is baar kya boyein?" answer, farm bar, "Using your farm"
         line and My Farm links: same --brand-deep-on-dark collapse as above,
         lifted to the same dark-mode green / gold. */
      html[data-theme="dark"] .answer__row:first-child .answer__crop b,
      html[data-theme="dark"] .answer__row:first-child .answer__rank,
      html[data-theme="dark"] .answer__risk.is-low,
      html[data-theme="dark"] .answer__cta,
      html[data-theme="dark"] .mm-farm-bar__lbl,
      html[data-theme="dark"] .mm-farm-bar__edit,
      html[data-theme="dark"] .mm-farm-bar__cancel,
      html[data-theme="dark"] .mm-usefarm__btn,
      html[data-theme="dark"] .farm-pests__more,
      html[data-theme="dark"] .farm-next a { color: #9ed2a7; }
      html[data-theme="dark"] .answer__risk.is-mid { color: #e4b87c; }
      /* The global dark input rule sets a solid background with !important,
         which also wiped the hero fields' ruled-line look and the chevron. */
      html[data-theme="dark"] .ask__field input { background: transparent !important; }
      html[data-theme="dark"] .ask__field select {
        background: transparent no-repeat right 2px center / 12px url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 12 8'><path d='M1 1l5 5 5-5' fill='none' stroke='%23c9bfb0' stroke-width='1.6' stroke-linecap='round'/></svg>") !important;
      }
      html[data-theme="dark"] .ask__field select option { background: #23201c; color: #f3ece0; }

      /* Dashboard empty states — dark-ink hairlines vanish on dark. */
      html[data-theme="dark"] .tool__empty { border-color: rgba(255,255,255,0.14); }
      html[data-theme="dark"] .tool__empty__ico { border-color: rgba(255,255,255,0.08); }

      /* Livedemo ranked cards had gradients ending in #fff — override */
      html[data-theme="dark"] .livedemo__card--1 {
        background: linear-gradient(160deg, rgba(47,107,58,0.28), var(--surface) 90%) !important;
        border-color: var(--brand);
      }
      html[data-theme="dark"] .livedemo__card--2 {
        background: linear-gradient(160deg, rgba(200,138,58,0.22), var(--surface) 90%) !important;
      }

      /* Form controls */
      html[data-theme="dark"] input,
      html[data-theme="dark"] select,
      html[data-theme="dark"] textarea {
        background: #1a1613 !important;
        color: var(--ink) !important;
        border-color: rgba(255,255,255,0.1) !important;
      }
      html[data-theme="dark"] input::placeholder,
      html[data-theme="dark"] textarea::placeholder { color: rgba(243,236,224,0.45); }
      html[data-theme="dark"] .field select:focus,
      html[data-theme="dark"] .field input:focus {
        background: #1a1613 !important;
        border-color: var(--brand) !important;
      }

      /* Buttons */
      html[data-theme="dark"] .btn-light { background: var(--surface) !important; color: var(--ink); }
      html[data-theme="dark"] .btn-ghost { color: var(--ink); border-color: rgba(255,255,255,0.2); }
      html[data-theme="dark"] .btn-ghost:hover { background: var(--ink); color: var(--bg); border-color: var(--ink); }

      /* Borders that were dark-ink on light bg become invisible on dark bg */
      html[data-theme="dark"] .feature,
      html[data-theme="dark"] .quote,
      html[data-theme="dark"] .panel,
      html[data-theme="dark"] .tool,
      html[data-theme="dark"] .sidebar,
      html[data-theme="dark"] .hero-card {
        border: 1px solid rgba(255,255,255,0.06);
      }
      html[data-theme="dark"] .marquee { border-color: rgba(255,255,255,0.08); background: var(--bg-soft); }

      /* Demo play circle (leftover in case anything still references it) */
      html[data-theme="dark"] .demo__play { background: rgba(35,32,28,0.92); color: #e4b87c; }

      /* Scene3D overlays */
      html[data-theme="dark"] .scene3d__label,
      html[data-theme="dark"] .scene3d__live { background: rgba(35,32,28,0.92) !important; color: var(--ink); }
      html[data-theme="dark"] .scene3d__hud,
      html[data-theme="dark"] .scene3d-panel { background: rgba(35,32,28,0.92) !important; color: var(--ink); }
      html[data-theme="dark"] .scene3d__live { border-color: rgba(255,255,255,0.08); }
      html[data-theme="dark"] .scene3d-panel__close { color: var(--ink-soft); }
      html[data-theme="dark"] .scene3d-panel__close:hover { background: var(--bg-soft); color: var(--ink); }
      html[data-theme="dark"] .scene3d-crop__bar { background: rgba(255,255,255,0.08); }

      /* Hero / headings / eyebrows inherit var(--ink) — ensure forcing. */
      html[data-theme="dark"] h1, html[data-theme="dark"] h2,
      html[data-theme="dark"] h3, html[data-theme="dark"] h4 { color: var(--ink); }
      html[data-theme="dark"] p, html[data-theme="dark"] li,
      html[data-theme="dark"] label, html[data-theme="dark"] small { color: var(--ink-soft); }
      html[data-theme="dark"] .eyebrow { color: var(--accent); }

      /* Quick-wins popover in dark mode */
      html[data-theme="dark"] .qw-fab { color: #9fd3a9; border-color: rgba(255,255,255,0.12); }
      html[data-theme="dark"] .qw-fab:hover,
      html[data-theme="dark"] .qw-fab.open { color: #fff; }
      html[data-theme="dark"] .qw-panel {
        background: rgba(35,32,28,0.98) !important;
        border-color: rgba(255,255,255,0.08);
        box-shadow: 0 20px 50px rgba(29,26,21,0.55);
      }
      html[data-theme="dark"] .qw-panel__label { color: #9e9384; }
      html[data-theme="dark"] .qw-panel__sep   { background: rgba(255,255,255,0.08); }
      html[data-theme="dark"] .qw-btn {
        background: rgba(255,255,255,0.06); color: #f3ece0;
      }
      html[data-theme="dark"] .qw-btn:hover,
      html[data-theme="dark"] .qw-btn.active { background: #2f6b3a; color: #fff; }
      html[data-theme="dark"] .qw-panel .i18n-switcher button {
        background: rgba(255,255,255,0.06); color: #f3ece0;
      }
      html[data-theme="dark"] .qw-panel .i18n-switcher button.active { background: #2f6b3a; color: #fff; }
      html[data-theme="dark"] .qw-modal__card { background: var(--surface); color: var(--ink); }
      html[data-theme="dark"] .qw-modal__h { color: var(--ink); }
      html[data-theme="dark"] .qw-modal__text { color: var(--ink-soft); }
      html[data-theme="dark"] .qw-modal__btn--ghost { color: var(--ink-soft); }

      /* Hero overlay adapts to dark bg. The hero ghost button keeps the
         white pill (set in style.css with !important dark text) so it
         stays readable in both themes. */
      html[data-theme="dark"] .hero__bg::after {
        background:
          linear-gradient(105deg, rgba(20,17,16,0.96) 0%, rgba(20,17,16,0.90) 48%, rgba(20,17,16,0.70) 70%, rgba(20,17,16,0.30) 100%),
          linear-gradient(180deg, rgba(20,17,16,0) 55%, rgba(20,17,16,0.55) 100%) !important;
      }
      /* Hero headline / sub in dark mode — the overlay is dark now, so
         force the text light for contrast. */
      html[data-theme="dark"] .hero__title,
      html[data-theme="dark"] .hero__sub,
      html[data-theme="dark"] .hero__trust-text,
      html[data-theme="dark"] .hero__trust-text strong { color: var(--ink) !important; }

      /* Hero CTA ghost — match dark surface instead of a bright white pill */
      html[data-theme="dark"] .hero__cta .btn-ghost {
        background: rgba(35, 32, 28, 0.88);
        color: var(--ink) !important;
        border-color: rgba(255, 255, 255, 0.12);
        box-shadow: 0 4px 14px rgba(29, 26, 21, 0.22);
      }
      html[data-theme="dark"] .hero__cta .btn-ghost svg { color: var(--ink); }
      html[data-theme="dark"] .hero__cta .btn-ghost:hover {
        background: var(--brand);
        color: #fff !important;
        border-color: var(--brand);
        box-shadow: 0 8px 22px rgba(47, 107, 58, 0.4);
      }
      html[data-theme="dark"] .hero__cta .btn-ghost:hover svg { color: #fff; }

      /* Footer — use same tokens as the rest of the page in dark mode */
      html[data-theme="dark"] .footer {
        background: var(--bg-soft);
        color: var(--ink-soft);
      }
      html[data-theme="dark"] .footer .logo { color: var(--ink); }
      html[data-theme="dark"] .footer__about p { color: var(--ink-faint); }
      html[data-theme="dark"] .footer__col h4 { color: var(--ink); }
      html[data-theme="dark"] .footer__col a { color: var(--ink-soft); }
      html[data-theme="dark"] .footer__bottom { border-color: var(--border); color: var(--ink-faint); }
      html[data-theme="dark"] .footer__social a {
        background: rgba(255, 255, 255, 0.06);
        color: var(--ink-soft);
      }
      html[data-theme="dark"] .footer__social a:hover { color: #fff; }

      /* Floating chat widget — match dark surfaces */
      html[data-theme="dark"] .mm-chat-panel {
        background: var(--surface) !important;
        border-color: rgba(255, 255, 255, 0.08) !important;
      }
      html[data-theme="dark"] .mm-chat-body,
      html[data-theme="dark"] .mm-sug {
        background: var(--bg-soft) !important;
      }
      html[data-theme="dark"] .mm-msg.bot {
        background: var(--surface) !important;
        border-color: rgba(255, 255, 255, 0.1) !important;
        color: var(--ink) !important;
      }
      html[data-theme="dark"] .mm-msg code {
        background: rgba(255, 255, 255, 0.08) !important;
        color: var(--ink-soft) !important;
      }
      html[data-theme="dark"] .mm-sug button {
        background: var(--surface) !important;
        border-color: rgba(255, 255, 255, 0.12) !important;
        color: #9ed2a7 !important;
      }
      html[data-theme="dark"] .mm-sug button:hover {
        background: #2f6b3a !important;
        color: #fff !important;
      }
      html[data-theme="dark"] .mm-chat-form {
        background: var(--surface) !important;
        border-color: rgba(255, 255, 255, 0.08) !important;
      }
      html[data-theme="dark"] .mm-chat-form input {
        background: #1a1613 !important;
        color: var(--ink) !important;
        border-color: rgba(255, 255, 255, 0.12) !important;
      }
      html[data-theme="dark"] .mm-chat-form .mm-mic {
        background: var(--surface) !important;
        color: #9ed2a7 !important;
        border-color: rgba(255, 255, 255, 0.12) !important;
      }
      html[data-theme="dark"] .mm-msg th {
        background: rgba(47, 107, 58, 0.2) !important;
        color: var(--ink) !important;
      }
      html[data-theme="dark"] .mm-msg td {
        border-color: rgba(255, 255, 255, 0.1) !important;
      }

      /* Leaflet + leaflet-draw toolbar in dark mode.
         The draw plugin ships a black-on-white sprite sheet for its icons,
         which disappears if we tint the toolbar background dark. Instead,
         invert the whole control so the default white bg + black glyphs
         flip to a dark bg + white glyphs. hue-rotate preserves any colored
         accents (e.g. the active-state blue). */
      html[data-theme="dark"] .leaflet-bar a,
      html[data-theme="dark"] .leaflet-draw-toolbar a,
      html[data-theme="dark"] .leaflet-draw-actions a,
      html[data-theme="dark"] .leaflet-control-zoom a {
        filter: invert(1) hue-rotate(180deg);
      }
      /* The attribution / scale overlay uses text, not sprites — style it
         directly instead of inverting. */
      html[data-theme="dark"] .leaflet-control-attribution {
        background: rgba(35,32,28,0.85) !important; color: #c9bfae !important;
      }
      html[data-theme="dark"] .leaflet-control-attribution a { color: #e4b87c !important; }
    `;
    document.head.appendChild(s);
  }

  /* ---------- Icons ---------- */
  const ICONS = {
    theme: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z"/></svg>',
    mic:   '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="3" width="6" height="12" rx="3"/><path d="M5 11a7 7 0 0 0 14 0"/><path d="M12 18v3"/></svg>',
    speak: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 10v4a1 1 0 0 0 1 1h3l5 4V5L7 9H4a1 1 0 0 0-1 1z"/><path d="M16 8a5 5 0 0 1 0 8"/><path d="M19 5a9 9 0 0 1 0 14"/></svg>',
    briefing: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/></svg>',
    wa:    '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M20.52 3.48A11.94 11.94 0 0 0 12 0C5.37 0 0 5.37 0 12c0 2.11.55 4.16 1.6 5.97L0 24l6.2-1.63A11.96 11.96 0 0 0 12 24c6.63 0 12-5.37 12-12 0-3.19-1.24-6.2-3.48-8.52zM12 21.8c-1.86 0-3.68-.5-5.27-1.45l-.38-.22-3.68.96.98-3.59-.25-.37A9.79 9.79 0 0 1 2.2 12C2.2 6.6 6.6 2.2 12 2.2S21.8 6.6 21.8 12 17.4 21.8 12 21.8zm5.53-7.33c-.3-.15-1.79-.88-2.07-.98-.28-.1-.48-.15-.68.15-.2.3-.78.98-.96 1.18-.18.2-.36.22-.66.07-.3-.15-1.27-.47-2.41-1.49-.89-.8-1.5-1.78-1.68-2.08-.18-.3-.02-.47.13-.62.13-.13.3-.36.45-.53.15-.18.2-.3.3-.5.1-.2.05-.37-.02-.52-.07-.15-.68-1.63-.93-2.23-.25-.6-.5-.52-.68-.52h-.58c-.2 0-.52.07-.8.37-.28.3-1.07 1.04-1.07 2.53 0 1.49 1.1 2.93 1.25 3.13.15.2 2.16 3.3 5.24 4.63.73.31 1.3.5 1.74.64.73.23 1.39.2 1.91.12.58-.09 1.79-.73 2.04-1.43.25-.7.25-1.3.18-1.43-.07-.13-.27-.2-.57-.35z"/></svg>',
    pdf:   '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><path d="M12 18v-6"/><path d="M9 15l3 3 3-3"/></svg>',
    link:  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></svg>',
    text:  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 7V4h16v3"/><path d="M9 20h6"/><path d="M12 4v16"/></svg>',
    contrast: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="M12 2a10 10 0 0 1 0 20z" fill="currentColor" stroke="none"/></svg>',
    install: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3v12"/><path d="M7 10l5 5 5-5"/><path d="M5 21h14"/></svg>',
    motion: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 12h4"/><path d="M3 7h7"/><path d="M3 17h7"/><circle cx="16" cy="12" r="5"/><path d="M14.5 12h3"/></svg>',
    privacy: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2l8 4v6c0 5-3.5 8.5-8 10-4.5-1.5-8-5-8-10V6z"/></svg>',
  };

  /* ---------- Build trigger + popover ----------
     A single hamburger FAB in the corner. Clicking it opens a popover
     containing the language pills and every action button, each of which
     staggers in with a smooth translate+fade animation.
  */
  function build() {
    injectStyles();

    // The popover panel. Its labels (Language, Tools, Dark mode, Voice, Read
    // aloud, WhatsApp, Save PDF) are hand-translated in i18n/<lang>.js, so this
    // no longer opts out of translation the way it did when i18n.js machine-
    // translated arbitrary text and risked mangling short button labels.
    const panel = document.createElement('div');
    panel.className = 'qw-panel';
    panel.id = 'qwPanel';
    // A dialog, not a menu: it holds the language pills and switches as
    // well as actions. Focus moves in, Tab stays in, Esc returns it (F-11).
    panel.setAttribute('role', 'dialog');
    panel.setAttribute('aria-label', 'Language and tools');

    // Language section — the i18n switcher is reparented here (if present).
    const langLabel = document.createElement('div');
    langLabel.className = 'qw-panel__label';
    langLabel.textContent = 'Language';
    panel.appendChild(langLabel);

    const langRow = document.createElement('div');
    langRow.className = 'qw-panel__lang';
    panel.appendChild(langRow);

    // Try to adopt the existing i18n switcher. If it hasn't been built yet,
    // poll briefly so we catch it as soon as i18n.js mounts it.
    function adoptI18n() {
      const sw = document.querySelector('body > .i18n-switcher');
      if (sw) { langRow.appendChild(sw); return true; }
      return false;
    }
    if (!adoptI18n()) {
      let tries = 0;
      const iv = setInterval(() => {
        if (adoptI18n() || ++tries > 20) clearInterval(iv);
      }, 150);
    }

    const sep = document.createElement('div');
    sep.className = 'qw-panel__sep';
    panel.appendChild(sep);

    const actionsLabel = document.createElement('div');
    actionsLabel.className = 'qw-panel__label';
    actionsLabel.textContent = 'Tools';
    panel.appendChild(actionsLabel);

    const grid = document.createElement('div');
    grid.className = 'qw-panel__grid';
    panel.appendChild(grid);

    function mkBtn(icon, label, onClick, id) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'qw-btn';
      b.innerHTML = `${icon}<span class="qw-btn__lbl">${label}</span>`;
      if (id) b.id = id;
      b.addEventListener('click', onClick);
      grid.appendChild(b);
      return b;
    }

    const themeBtn = mkBtn(ICONS.theme, 'Dark mode',     toggleTheme,   'qw-theme');
    if (document.documentElement.getAttribute('data-theme') === 'dark') themeBtn.classList.add('active');
    mkBtn(ICONS.mic,   'Voice',      startVoice);
    mkBtn(ICONS.speak, 'Read aloud', toggleSpeak,   'qw-speak');
    mkBtn(ICONS.briefing, "Today's briefing", playBriefing, 'qw-briefing');
    mkBtn(ICONS.wa,    'WhatsApp',   shareWhatsApp);
    mkBtn(ICONS.pdf,   'Save PDF',   exportPdf,     'qw-pdf');
    mkBtn(ICONS.link,  'Copy link',  copyLink);

    // Accessibility — folded in from what used to be a second floating
    // button (mm-core.js's Tools fab) so there is one settings surface, not two.
    // Gated on mm-core.js actually being on the page (farm-boundary.html loads
    // this file without it) so these never appear as dead, throwing buttons.
    if (window.MM && window.MM.a11y) {
      const textBtn = mkBtn(ICONS.text, 'Large text', () => {
        window.MM.a11y.toggle('largeText');
        textBtn.classList.toggle('active', !!window.MM.a11y.get().largeText);
      });
      textBtn.classList.toggle('active', !!window.MM.a11y.get().largeText);
      textBtn.setAttribute('aria-pressed', String(!!window.MM.a11y.get().largeText));
      textBtn.addEventListener('click', () => textBtn.setAttribute('aria-pressed', String(!!window.MM.a11y.get().largeText)));
      const contrastBtn = mkBtn(ICONS.contrast, 'High contrast', () => {
        window.MM.a11y.toggle('highContrast');
        contrastBtn.classList.toggle('active', !!window.MM.a11y.get().highContrast);
      });
      contrastBtn.classList.toggle('active', !!window.MM.a11y.get().highContrast);
      contrastBtn.setAttribute('aria-pressed', String(!!window.MM.a11y.get().highContrast));
      contrastBtn.addEventListener('click', () => contrastBtn.setAttribute('aria-pressed', String(!!window.MM.a11y.get().highContrast)));
      // Reduce motion: the OS setting already applies everywhere; this is for
      // a phone whose owner cannot find it.
      const motionOn = () => !!window.MM.a11y.get().reduceMotion;
      const motionBtn = mkBtn(ICONS.motion, 'Reduce motion', () => {
        window.MM.a11y.toggle('reduceMotion');
        motionBtn.classList.toggle('active', motionOn());
        motionBtn.setAttribute('aria-pressed', String(motionOn()));
      }, 'qw-motion');
      motionBtn.classList.toggle('active', motionOn());
      motionBtn.setAttribute('aria-pressed', String(motionOn()));
    }

    // Install (PWA) — stays hidden until the browser offers it.
    const installBtn = mkBtn(ICONS.install, 'Install app', async () => {
      if (!deferredInstallPrompt) return;
      deferredInstallPrompt.prompt();
      const { outcome } = await deferredInstallPrompt.userChoice;
      deferredInstallPrompt = null;
      if (outcome === 'accepted' && window.MM && window.MM.toast) window.MM.toast('Installing Mitti Mantra…');
    });
    installBtn.style.display = 'none';
    window.addEventListener('beforeinstallprompt', (e) => {
      e.preventDefault();
      deferredInstallPrompt = e;
      installBtn.style.display = '';
    });

    // Usage & privacy — local-only tool-usage counting, opt-in sharing.
    // Only appears once mm-analytics.js has actually installed the API.
    if (window.MM && window.MM.analytics) {
      mkBtn(ICONS.privacy, 'Usage & privacy', openPrivacyModal);
    }

    document.body.appendChild(panel);

    // The hamburger trigger
    const fab = document.createElement('button');
    fab.type = 'button';
    fab.className = 'qw-fab';
    fab.setAttribute('aria-label', 'Language and tools');
    fab.setAttribute('aria-expanded', 'false');
    fab.setAttribute('aria-haspopup', 'dialog');
    fab.setAttribute('aria-controls', 'qwPanel');
    fab.setAttribute('data-no-translate', '');
    fab.innerHTML = `<span class="qw-fab__glyph" aria-hidden="true">अA</span><svg class="qw-fab__close" aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><path d="M18 6L6 18M6 6l12 12"/></svg>`;
    document.body.appendChild(fab);

    let releasePanel = null;
    function togglePanel(open, { restoreFocus = false } = {}) {
      const willOpen = typeof open === 'boolean' ? open : !panel.classList.contains('open');
      panel.classList.toggle('open', willOpen);
      fab.classList.toggle('open', willOpen);
      fab.setAttribute('aria-expanded', willOpen ? 'true' : 'false');
      fab.setAttribute('aria-label', willOpen ? 'Close language and tools' : 'Language and tools');
      if (willOpen) {
        // Focus once the panel is visible to the browser. The trap (site-ui.js)
        // keeps Tab inside and closes on Esc; a click on the FAB still closes.
        setTimeout(() => {
          if (!panel.classList.contains('open')) return;
          if (window.mmFocus) releasePanel = window.mmFocus.trap(panel, { onEscape: () => togglePanel(false, { restoreFocus: true }), returnTo: fab });
          else { const first = panel.querySelector('button:not([disabled]), select, [tabindex="0"]'); if (first) first.focus(); }
        }, 0);
      } else {
        const restore = restoreFocus || panel.contains(document.activeElement);
        if (releasePanel) { releasePanel({ restore }); releasePanel = null; }
        else if (restore) fab.focus();
      }
    }
    fab.addEventListener('click', (e) => { e.stopPropagation(); togglePanel(); });
    // Close when clicking outside or on Escape
    document.addEventListener('click', (e) => {
      if (!panel.classList.contains('open')) return;
      if (panel.contains(e.target) || fab.contains(e.target)) return;
      togglePanel(false);
    });
    // Without site-ui.js's trap: Esc still closes and returns focus.
    document.addEventListener('keydown', (e) => {
      if (!window.mmFocus && e.key === 'Escape' && panel.classList.contains('open')) togglePanel(false, { restoreFocus: true });
    });
  }

  /* ---------- Theme ---------- */
  function toggleTheme() {
    const cur = document.documentElement.getAttribute('data-theme');
    const next = cur === 'dark' ? 'light' : 'dark';
    if (next === 'dark') document.documentElement.setAttribute('data-theme', 'dark');
    else document.documentElement.removeAttribute('data-theme');
    try { localStorage.setItem(THEME_KEY, next); } catch (_) { /* still applied for this page */ }
    const btn = document.getElementById('qw-theme');
    if (btn) btn.classList.toggle('active', next === 'dark');
  }

  /* ---------- Modal helper ---------- */
  let modalEl = null;
  let modalReturnFocus = null;
  let releaseModal = null;
  function showModal(title, bodyHtml, actions = []) {
    if (!modalEl) {
      modalEl = document.createElement('div');
      modalEl.className = 'qw-modal';
      modalEl.setAttribute('role', 'dialog');
      modalEl.setAttribute('aria-modal', 'true');
      modalEl.setAttribute('data-no-translate', '');
      modalEl.addEventListener('keydown', e => { if (!window.mmFocus && e.key === 'Escape') hideModal(); });
      modalEl.innerHTML = `
        <div class="qw-modal__card">
          <h3 class="qw-modal__h"></h3>
          <div class="qw-modal__text"></div>
          <div class="qw-modal__row"></div>
        </div>`;
      modalEl.addEventListener('click', e => { if (e.target === modalEl) hideModal(); });
      document.body.appendChild(modalEl);
    }
    modalEl.querySelector('.qw-modal__h').textContent = title;
    modalEl.setAttribute('aria-label', title);
    modalEl.querySelector('.qw-modal__text').innerHTML = bodyHtml;
    const row = modalEl.querySelector('.qw-modal__row');
    row.innerHTML = '';
    (actions.length ? actions : [{ label: 'Close', primary: false, onClick: hideModal }]).forEach(a => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'qw-modal__btn ' + (a.primary ? 'qw-modal__btn--primary' : 'qw-modal__btn--ghost');
      b.textContent = a.label;
      b.addEventListener('click', () => a.onClick());
      row.appendChild(b);
    });
    if (!modalEl.classList.contains('show')) modalReturnFocus = document.activeElement;
    modalEl.classList.add('show');
    const primary = row.querySelector('.qw-modal__btn--primary') || row.querySelector('button');
    // Tab stays inside the card while it is up (F-11). A second showModal
    // re-traps and keeps the original return target.
    if (window.mmFocus) setTimeout(() => {
      if (!modalEl.classList.contains('show')) return;
      releaseModal = window.mmFocus.trap(modalEl, { onEscape: hideModal, initial: primary, returnTo: modalReturnFocus });
    }, 0);
    else if (primary) setTimeout(() => primary.focus(), 0);
    return modalEl;
  }
  function hideModal() {
    if (!modalEl || !modalEl.classList.contains('show')) return;
    modalEl.classList.remove('show');
    if (releaseModal) { releaseModal(); releaseModal = null; }
    else if (modalReturnFocus && document.contains(modalReturnFocus)) modalReturnFocus.focus();
    modalReturnFocus = null;
  }
  function escapeHtml(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, c => (
      { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }
  function updateModalBody(html) {
    if (modalEl) modalEl.querySelector('.qw-modal__text').innerHTML = html;
  }

  /* ---------- Voice input ---------- */
  function currentLangBCP47() {
    const lang = (window.AgriSimI18n && window.AgriSimI18n.getLanguage && window.AgriSimI18n.getLanguage())
                 || localStorage.getItem('agrisim_lang') || 'en';
    return { en: 'en-IN', hi: 'hi-IN', te: 'te-IN', kn: 'kn-IN', ta: 'ta-IN' }[lang] || 'en-IN';
  }

  /* ---------- Voice command parsing ----------
     Recognises simple intents like:
       "simulate rice in Punjab for 5 acres"
       "recommend crops for kharif"
       "rotation planner"
       "open pest alerts"
     Matches are keyword-based (English + basic Hindi transliteration).
     Returns true if a command was understood and executed.
  */
  const TOOL_KEYWORDS = {
    recommend: ['recommend', 'suggest', 'suggestion', 'kya ugau', 'kya lagau'],
    simulate : ['simulate', 'simulation', 'profit', 'yield', 'munafa'],
    rotation : ['rotation', 'rotate crop', 'fasal chakra'],
    compare  : ['compare'],
    market   : ['market', 'mandi', 'bhav', 'price'],
    irrigation: ['irrigation', 'water', 'pani', 'sinchai'],
    pest     : ['pest', 'disease', 'keet', 'bimari'],
    finance  : ['loan', 'finance', 'karz', 'budget'],
    schemes  : ['scheme', 'sarkar', 'subsidy', 'pm kisan'],
    soil     : ['soil health', 'mitti'],
    calendar : ['calendar', 'sowing', 'bijai'],
  };

  const CROP_KEYWORDS = {
    rice: ['rice', 'dhaan', 'paddy'],
    wheat: ['wheat', 'gehun'],
    maize: ['maize', 'makka', 'corn'],
    cotton: ['cotton', 'kapas'],
    soybean: ['soybean', 'soya'],
    sugarcane: ['sugarcane', 'ganna'],
    groundnut: ['groundnut', 'mungfali', 'peanut'],
    pulses: ['pulses', 'dal', 'tur'],
    mustard: ['mustard', 'sarson'],
  };

  function matchFromMap(text, map) {
    for (const [key, words] of Object.entries(map)) {
      if (words.some(w => text.includes(w))) return key;
    }
    return null;
  }

  function applyVoiceCommand(raw) {
    const text = raw.toLowerCase();

    // Only meaningful on the dashboard.
    const toolBtns = document.querySelectorAll('.sidebar__btn[data-tool]');
    if (!toolBtns.length) return false;

    const tool = matchFromMap(text, TOOL_KEYWORDS);
    if (!tool) return false;

    const target = Array.from(toolBtns).find(b => b.dataset.tool === tool);
    if (!target) return false;
    target.click();

    // Give the tool a tick to render, then fill inputs.
    setTimeout(() => {
      const activeForm = document.querySelector(`[data-tool="${tool}"] form`);
      if (!activeForm) return;

      const crop = matchFromMap(text, CROP_KEYWORDS);
      if (crop && activeForm.crop_id) {
        const opt = Array.from(activeForm.crop_id.options).find(o => o.value === crop);
        if (opt) activeForm.crop_id.value = crop;
      }

      const season = /zaid/.test(text) ? 'zaid' : /rabi/.test(text) ? 'rabi' : /kharif/.test(text) ? 'kharif' : null;
      if (season && activeForm.season) activeForm.season.value = season;

      const acres = text.match(/(\d+(?:\.\d+)?)\s*(acre|acres|ac|bigha)/);
      if (acres && activeForm.area_acres) {
        const n = parseFloat(acres[1]);
        activeForm.area_acres.value = /bigha/.test(acres[2]) ? (n * 0.4).toFixed(2) : n;
      }

      const budget = text.match(/(\d+(?:[,\.]\d+)?)\s*(?:thousand|k|hazaar|lakh|lac|crore)?/);
      if (budget && /budget|kharch|cost/.test(text) && activeForm.budget_per_acre) {
        let n = parseFloat(budget[1].replace(/,/g, ''));
        if (/lakh|lac/.test(text)) n *= 100000;
        else if (/crore/.test(text)) n *= 10000000;
        else if (/thousand|k|hazaar/.test(text)) n *= 1000;
        activeForm.budget_per_acre.value = Math.round(n);
      }

      // If the user said "run" / "go" / "chalao", auto-submit.
      if (/\b(run|go|chalao|start|simulate now|show)\b/.test(text)) {
        activeForm.requestSubmit?.() || activeForm.submit();
      } else {
        window.mmScroll.intoView(activeForm, 'center');
      }
    }, 250);

    return true;
  }

  function startVoice() {
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR) {
      showModal('Voice input', 'Your browser does not support Web Speech recognition. Try Chrome or Edge.');
      return;
    }
    const rec = new SR();
    rec.lang = currentLangBCP47();
    rec.interimResults = true;
    rec.continuous = false;

    const active = lastActiveInput || document.activeElement;
    const canFillInput = active && (active.tagName === 'INPUT' || active.tagName === 'TEXTAREA');

    showModal('Listening…', `<p><span class="qw-pulse"></span>Speak now (${rec.lang}). Your words will appear here.</p><div id="qw-voice-out" style="font-weight:500;margin-top:8px;">—</div>`, [
      { label: 'Stop', primary: false, onClick: () => { rec.stop(); } }
    ]);
    const out = () => document.getElementById('qw-voice-out');

    let finalText = '';
    let lastRecognized = '';
    rec.onresult = (ev) => {
      let interim = '';
      for (let i = ev.resultIndex; i < ev.results.length; i++) {
        const t = ev.results[i][0].transcript;
        if (ev.results[i].isFinal) finalText += t;
        else interim += t;
      }
      lastRecognized = finalText + interim;
      if (out()) out().textContent = lastRecognized || '—';
    };
    rec.onerror = (e) => {
      const msg = {
        'not-allowed': 'Microphone access was blocked. Allow it in your browser settings and try again.',
        'no-speech': "We didn't hear anything. Try again and speak close to the phone.",
        'audio-capture': 'No microphone was found on this device.',
        'network': 'Voice input needs an internet connection.',
      }[e.error] || 'Voice input stopped unexpectedly. Please try again.';
      updateModalBody(`<p>${msg}</p>`);
    };
    rec.onend = () => {
      const txt = (finalText || lastRecognized).trim();
      if (!txt) { hideModal(); return; }
      if (canFillInput) {
        active.value = (active.value ? active.value + ' ' : '') + txt;
        active.dispatchEvent(new Event('input', { bubbles: true }));
        hideModal();
        return;
      }
      // Try to understand a dashboard command before falling back to
      // "you said:". Returns true if a command was recognised and executed.
      if (applyVoiceCommand(txt)) {
        hideModal();
        return;
      }
      showModal('You said:', `<p style="font-weight:500;">${escapeHtml(txt)}</p>
        <p style="font-size:.85rem;margin-top:8px;">Tip: try <em>"simulate rice in Punjab for 5 acres"</em> or <em>"recommend crops for kharif"</em>.</p>`, [
        { label: 'Copy', primary: false, onClick: () => { navigator.clipboard?.writeText(txt); hideModal(); } },
        { label: 'OK', primary: true, onClick: hideModal }
      ]);
    };
    try { rec.start(); }
    catch (e) { updateModalBody('<p>Voice input could not start. Close other apps using the microphone and try again.</p>'); }
  }

  /* ---------- Read aloud ---------- */
  let speaking = false;
  function gatherReadableText() {
    // Prefer recently-rendered dashboard output; else hero / first section.
    const candidates = [
      ...document.querySelectorAll('.tool.active .output'),
      ...document.querySelectorAll('.scene3d-panel.open .scene3d-panel__body'),
      document.querySelector('.farmmap__summary'),
      document.querySelector('h1'),
      document.querySelector('.hero'),
      document.querySelector('main') || document.body
    ].filter(Boolean);
    for (const el of candidates) {
      const txt = (el.innerText || '').trim();
      if (txt && txt.length > 20) return txt.slice(0, 1500);
    }
    return document.title;
  }
  function toggleSpeak() {
    const btn = document.getElementById('qw-speak');
    if (!('speechSynthesis' in window)) {
      showModal('Read aloud', 'This browser does not support speech synthesis.');
      return;
    }
    if (speaking) {
      window.speechSynthesis.cancel();
      speaking = false;
      btn?.classList.remove('active');
      return;
    }
    const text = gatherReadableText();
    const u = new SpeechSynthesisUtterance(text);
    u.lang = currentLangBCP47();
    const voices = window.speechSynthesis.getVoices();
    const match = voices.find(v => v.lang && v.lang.toLowerCase().startsWith(u.lang.toLowerCase().slice(0, 2)));
    if (match) u.voice = match;
    u.onend = () => { speaking = false; btn?.classList.remove('active'); };
    u.onerror = u.onend;
    window.speechSynthesis.speak(u);
    speaking = true;
    btn?.classList.add('active');
  }

  /* ---------- Spoken daily briefing ----------
     Unlike "Read aloud" (which reads whatever text happens to be on
     screen), this composes one short sentence from the farmer's actual
     Farm Profile: the top-ranked crop recommendation (crop, expected
     profit, risk score) plus this season's expected rainfall. Two light
     fetches against endpoints that already exist — no new backend code. */
  let speakingBriefing = false;

  function briefingSentence(lang, d) {
    const rainClause = d.rainfall == null ? { en: '', hi: '', te: '' } : {
      en: ` Expected rainfall this season is around ${d.rainfall} millimetres.`,
      hi: ` इस सीज़न में लगभग ${d.rainfall} मिलीमीटर बारिश की उम्मीद है।`,
      te: ` ఈ సీజన్‌లో సుమారు ${d.rainfall} మిల్లీమీటర్ల వర్షం అంచనా.`
    };
    const profitStr = '₹' + Math.round(d.profit).toLocaleString('en-IN');
    const t = {
      en: `Today's advice: sow ${d.crop}. Expected profit is about ${profitStr} per acre, with a risk score of ${d.risk} out of 100.${rainClause.en}`,
      hi: `आज की सलाह: ${d.crop} बोइए। अनुमानित मुनाफ़ा लगभग ${profitStr} प्रति एकड़ है, और जोखिम स्कोर 100 में से ${d.risk} है।${rainClause.hi}`,
      te: `ఈరోజు సలహా: ${d.crop} విత్తండి. ఎకరాకు అంచనా లాభం సుమారు ${profitStr}, రిస్క్ స్కోరు 100కి ${d.risk}.${rainClause.te}`
    };
    return t[lang] ? { text: t[lang], lang } : { text: t.en, lang: 'en' };
  }

  async function composeBriefing(profile) {
    const season = profile.season || 'kharif';
    const qs = new URLSearchParams({
      region_id: profile.region_id,
      season,
      budget_per_acre: profile.budget_per_acre || 15000,
      area_acres: profile.area_acres || 1
    });
    const [recs, weather] = await Promise.all([
      fetch(`/api/crop?${qs}`).then(r => (r.ok ? r.json() : null)).catch(() => null),
      fetch(`/api/weather/${encodeURIComponent(profile.region_id)}?season=${encodeURIComponent(season)}`).then(r => (r.ok ? r.json() : null)).catch(() => null)
    ]);
    const committed = window.FarmState?.getActiveCrop?.()?.crop_id;
    const list = Array.isArray(recs) ? recs : [];
    const top = (committed && list.find(r => r.crop_id === committed)) || list[0] || null;
    if (!top) return null;
    const lang = (window.AgriSimI18n && window.AgriSimI18n.getLanguage && window.AgriSimI18n.getLanguage()) || 'en';
    const rainfall = weather && weather.rainfall_mm != null ? Math.round(Number(weather.rainfall_mm)) : null;
    // expected_profit from /api/crop is the TOTAL for area_acres, not per-acre.
    const area = Number(profile.area_acres) || 1;
    return briefingSentence(lang, {
      crop: top.crop_name || top.crop_id,
      profit: (top.expected_profit || 0) / area,
      risk: Math.round(top.risk_score || 0),
      rainfall
    });
  }

  async function playBriefing() {
    const btn = document.getElementById('qw-briefing');
    if (!('speechSynthesis' in window)) {
      showModal("Today's briefing", 'This browser does not support speech synthesis.');
      return;
    }
    if (speakingBriefing) {
      window.speechSynthesis.cancel();
      speakingBriefing = false;
      btn?.classList.remove('active');
      return;
    }
    const profile = (window.MM && window.MM.profile && window.MM.profile.get()) || {};
    if (!profile.region_id) {
      showModal("Today's briefing", '<p>Set up your farm (region &amp; season) first on the dashboard, then come back for a spoken daily briefing.</p>');
      return;
    }
    // Arm the guard synchronously — before the async compose step — so a
    // second click while this fetch is in flight hits the branch above
    // (stop / no-op) instead of racing it into a duplicate speak() call.
    speakingBriefing = true;
    btn?.classList.add('active');
    const briefing = await composeBriefing(profile).catch(() => null);
    if (!speakingBriefing) {
      // Stop-clicked while composing: that click already reset the flag
      // and button state, so treat this stale resolve as a no-op.
      return;
    }
    if (!briefing) {
      speakingBriefing = false;
      btn?.classList.remove('active');
      showModal("Today's briefing", '<p>Could not put together a briefing right now — try again in a moment.</p>');
      return;
    }
    const u = new SpeechSynthesisUtterance(briefing.text);
    u.lang = briefing.lang === 'en' ? 'en-IN' : currentLangBCP47();
    const voices = window.speechSynthesis.getVoices();
    const match = voices.find(v => v.lang && v.lang.toLowerCase().startsWith(u.lang.toLowerCase().slice(0, 2)));
    if (match) u.voice = match;
    u.onend = () => { speakingBriefing = false; btn?.classList.remove('active'); };
    u.onerror = u.onend;
    window.speechSynthesis.speak(u);
  }

  /* ---------- Copy link ---------- */
  function copyLink() {
    const url = location.href;
    const done = () => { if (window.MM && window.MM.toast) window.MM.toast('Link copied'); };
    const fail = () => showModal('Copy link', `<p>Copy this link:</p><p style="word-break:break-all;font-weight:500;">${escapeHtml(url)}</p>`);
    if (navigator.clipboard) navigator.clipboard.writeText(url).then(done, fail);
    else fail();
  }

  /* ---------- Usage & privacy modal ----------
     Folded in from mm-core.js's old Tools button. Reuses this file's own
     modal instead of a row-based popover, since the panel here is a grid. */
  function openPrivacyModal() {
    const a = window.MM.analytics;
    const row = (label, checked) => `
      <label style="display:flex;align-items:center;gap:10px;padding:8px 2px;cursor:pointer;">
        <input type="checkbox" data-qw-toggle="${label}" ${checked ? 'checked' : ''} style="width:16px;height:16px;">
        ${label}
      </label>`;
    const stats = a.summary();
    const statsLine = stats.total
      ? `${stats.total} actions since ${stats.since}`
      : 'No usage recorded yet on this device.';
    const body = `
      <p style="margin:0 0 10px;">Usage counting is local to this device by default. Sharing anonymous counts is off unless you turn it on.</p>
      ${row('Count my tool usage', a.isEnabled())}
      ${row('Share anonymous counts', a.isSharing())}
      <p style="margin:10px 0 0;color:var(--ink-faint,#8a8376);">${statsLine}</p>`;
    const modal = showModal('Usage & privacy', body, [{ label: 'Done', primary: true, onClick: hideModal }]);

    const boxes = modal.querySelectorAll('input[data-qw-toggle]');
    boxes[0].addEventListener('change', (e) => {
      a.setEnabled(e.target.checked);
      if (window.MM.toast) window.MM.toast(e.target.checked ? 'Counting tool usage on this device' : 'Usage counting off — history cleared');
    });
    boxes[1].addEventListener('change', (e) => {
      a.setSharing(e.target.checked);
      if (window.MM.toast) window.MM.toast(e.target.checked ? 'Sharing anonymous tool counts' : 'Sharing off');
    });
    // The share toggle only makes sense once the server actually accepts uploads.
    boxes[1].closest('label').style.display = 'none';
    a.serverAcceptsUploads().then((ok) => { boxes[1].closest('label').style.display = ok ? '' : 'none'; });
  }

  /* ---------- WhatsApp share ---------- */
  function shareWhatsApp() {
    const title = document.title;
    const url = location.href;
    let summary = '';
    const sel = window.getSelection && window.getSelection().toString();
    if (sel && sel.length > 5) summary = sel;
    else summary = gatherReadableText().slice(0, 300);

    const text = `*${title}*\n\n${summary}\n\n${url}`;
    window.open('https://wa.me/?text=' + encodeURIComponent(text), '_blank', 'noopener');
  }

  /* ---------- PDF export ---------- */
  let pdfLibsLoading = null;
  function loadScript(src) {
    return new Promise((res, rej) => {
      const s = document.createElement('script');
      s.src = src; s.async = true;
      s.onload = () => res();
      s.onerror = () => rej(new Error('failed ' + src));
      document.head.appendChild(s);
    });
  }
  function loadPdfLibs() {
    if (pdfLibsLoading) return pdfLibsLoading;
    pdfLibsLoading = Promise.all([
      window.html2canvas ? null : loadScript('https://cdn.jsdelivr.net/npm/html2canvas@1.4.1/dist/html2canvas.min.js'),
      window.jspdf ? null : loadScript('https://cdn.jsdelivr.net/npm/jspdf@2.5.1/dist/jspdf.umd.min.js')
    ]).catch((err) => { pdfLibsLoading = null; throw err; });
    return pdfLibsLoading;
  }
  async function exportPdf() {
    const btn = document.getElementById('qw-pdf');
    if (btn) btn.disabled = true;
    try {
      await loadPdfLibs();
      // Prefer the most relevant main content to capture
      const target = document.querySelector('.tool.active')
                  || document.querySelector('.farmmap__panel')
                  || document.querySelector('main')
                  || document.body;
      // Tool panels fade/slide in via a CSS entrance animation (see .tool.active
      // in style.css). html2canvas reads computed style synchronously, so a
      // capture that lands mid-animation -- e.g. right after switching tabs --
      // freezes at whatever opacity the animation was at, producing a blank or
      // washed-out page. Snap any in-flight animation/transition on the target
      // to its end state first, then force a synchronous style flush (the same
      // reflow trick dashboard.js uses for .tool--leaving) so html2canvas is
      // guaranteed to read the settled, post-animation styles.
      target.getAnimations({ subtree: true }).forEach(a => a.finish());
      void target.offsetHeight;
      const canvas = await window.html2canvas(target, {
        backgroundColor: getComputedStyle(document.body).backgroundColor || '#fff',
        scale: Math.min(2, window.devicePixelRatio || 1),
        useCORS: true
      });
      const { jsPDF } = window.jspdf;
      const pdf = new jsPDF({ unit: 'pt', format: 'a4' });
      const pageW = pdf.internal.pageSize.getWidth();
      const pageH = pdf.internal.pageSize.getHeight();
      const imgW = pageW - 40;
      const imgH = (canvas.height * imgW) / canvas.width;
      const img = canvas.toDataURL('image/png');
      let y = 20;
      if (imgH <= pageH - 40) {
        pdf.addImage(img, 'PNG', 20, y, imgW, imgH);
      } else {
        // Slice across multiple pages
        const pageImgH = pageH - 40;
        let remaining = imgH;
        let sY = 0;
        const scale = imgW / canvas.width;
        while (remaining > 0) {
          const sliceH = Math.min(pageImgH / scale, canvas.height - sY);
          const slice = document.createElement('canvas');
          slice.width = canvas.width;
          slice.height = sliceH;
          slice.getContext('2d').drawImage(canvas, 0, sY, canvas.width, sliceH, 0, 0, canvas.width, sliceH);
          pdf.addImage(slice.toDataURL('image/png'), 'PNG', 20, 20, imgW, sliceH * scale);
          sY += sliceH;
          remaining -= pageImgH;
          if (remaining > 0) pdf.addPage();
        }
      }
      pdf.save('agrisim-' + Date.now() + '.pdf');
    } catch (e) {
      console.error('[toolbar] PDF export failed', e);
      showModal('PDF export failed', navigator.onLine
        ? '<p>The page could not be saved as a PDF. Please try again, or use your browser\u2019s Print \u2192 Save as PDF.</p>'
        : '<p>Saving a PDF needs an internet connection the first time. Reconnect and try again.</p>');
    } finally {
      if (btn) btn.disabled = false;
    }
  }

  /* ---------- Init ---------- */
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', build);
  } else {
    build();
  }
})();
