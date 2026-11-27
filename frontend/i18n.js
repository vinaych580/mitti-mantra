/* =========================================================
   AgriSim — lightweight i18n
   Supports English (en), Hindi (hi), Telugu (te), Kannada (kn), Tamil (ta).

   Strategy:
     • Walk all visible text nodes + translatable attributes.
     • Look each trimmed string up in a hand-written catalog. The catalog
       used to be machine translation via a free API at runtime, which got
       agronomy terms wrong ("Kharif" transliterated at random, "MSP"
       expanded incorrectly) and needed a round trip per string. A static
       dictionary translated once by hand is both correct and instant.
     • Each language's catalog lives in its own file (i18n/hi.js, …) and is
       fetched only when that language is chosen. The catalogs used to ship
       together in one 170 KB file loaded on every page, so an English reader
       paid for four languages they never saw; now they pay for none, and a
       Telugu reader pays for Telugu alone.
     • Glossary terms (brand name, acronyms like MSP/PMFBY, units) are never
       altered, even mid-sentence.
     • A string with no catalog entry is left in English rather than guessed
       — a visible gap is safer than a wrong agronomy term.
     • A floating language-switcher pill is auto-injected.
   ========================================================= */

(() => {
  const LANGS = [
    { code: 'en', label: 'EN',  name: 'English' },
    { code: 'hi', label: 'हिं', name: 'हिन्दी' },
    { code: 'te', label: 'తె',  name: 'తెలుగు' },
    { code: 'kn', label: 'ಕ',  name: 'ಕನ್ನಡ' },
    { code: 'ta', label: 'த',  name: 'தமிழ்' }
  ];

  const LANG_KEY = 'agrisim_lang';

  const SKIP_TAGS = new Set(['SCRIPT', 'STYLE', 'CODE', 'PRE', 'NOSCRIPT', 'SVG', 'CANVAS']);
  const TRANSLATABLE_ATTRS = ['placeholder', 'title', 'alt', 'aria-label'];

  // Filled in one language at a time by i18n/<code>.js as each is loaded.
  const CATALOG = (window.MM_I18N_CATALOG = window.MM_I18N_CATALOG || {});

  // Brand names, acronyms and units that must never be translated even
  // inside an otherwise-translated sentence: translating these creates a
  // term a farmer won't recognise from the scheme's own paperwork or the
  // mandi board.
  const GLOSSARY_TERMS = [
    'Mitti Mantra', 'AgriSim', 'Gyan Seva',
    'MSP', 'PM-KISAN', 'PMFBY', 'KCC', 'NPK', 'NDVI', 'GPS', 'API', 'PDF',
    'IoT', 'ML', 'ROI', 'EMI', 'DSCR', 'DAP', 'MOP', 'KVK', 'ICAR',
    'SoilGrids', 'Open-Meteo', 'WhatsApp',
    'kg', 'kg/ha', 'kg/acre', 'INR', '₹',
  ];
  window.MM_I18N_GLOSSARY = GLOSSARY_TERMS;
  const GLOSSARY = new Set(GLOSSARY_TERMS.map((g) => g.toLowerCase()));

  /* ---------- On-demand catalog loading ---------- */
  // Resolved relative to this script rather than the page, so a page served
  // from a rewritten path (/dashboard → dashboard.html) still finds i18n/.
  const BASE = (document.currentScript && document.currentScript.src)
    ? document.currentScript.src.replace(/[^/]*$/, '')
    : '';
  const loading = {};
  function loadCatalog(lang) {
    if (lang === 'en' || CATALOG[lang]) return Promise.resolve(true);
    if (!LANGS.some(l => l.code === lang)) return Promise.resolve(false);
    if (!loading[lang]) {
      loading[lang] = new Promise((resolve) => {
        const s = document.createElement('script');
        s.src = BASE + 'i18n/' + lang + '.js';
        s.onload = () => resolve(!!CATALOG[lang]);
        // Offline with an empty cache: stay in English rather than half-switch.
        s.onerror = () => { delete loading[lang]; resolve(false); };
        document.head.appendChild(s);
      });
    }
    return loading[lang];
  }

  // Store originals so we can restore English or re-translate.
  const nodeOriginals = new WeakMap();   // textNode -> original string
  const attrOriginals = new WeakMap();   // element  -> { attr: originalValue }

  /* ---------- DOM collection ---------- */
  function collectTextNodes(root) {
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
      acceptNode(n) {
        const v = n.nodeValue;
        if (!v || !v.trim()) return NodeFilter.FILTER_REJECT;
        let p = n.parentElement;
        while (p) {
          if (SKIP_TAGS.has(p.tagName)) return NodeFilter.FILTER_REJECT;
          if (p.hasAttribute && p.hasAttribute('data-no-translate')) return NodeFilter.FILTER_REJECT;
          p = p.parentElement;
        }
        return NodeFilter.FILTER_ACCEPT;
      }
    });
    const nodes = [];
    while (walker.nextNode()) nodes.push(walker.currentNode);
    return nodes;
  }

  function collectAttrTargets(root) {
    const out = [];
    const all = root.querySelectorAll('[placeholder],[title],[alt],[aria-label]');
    all.forEach(el => {
      if (el.closest('[data-no-translate]')) return;
      if (SKIP_TAGS.has(el.tagName)) return;
      TRANSLATABLE_ATTRS.forEach(a => {
        const v = el.getAttribute(a);
        if (v && v.trim()) out.push({ el, attr: a });
      });
    });
    return out;
  }

  /* ---------- Catalog lookup ---------- */

  /**
   * Translate one string via the static catalog. Glossary terms are matched
   * whole (case-insensitively) and passed through unchanged; anything not in
   * the catalog is returned as-is rather than guessed.
   */
  function lookup(text, lang) {
    if (lang === 'en') return text;
    const trimmed = text.trim();
    if (!trimmed) return text;
    if (GLOSSARY.has(trimmed.toLowerCase())) return text;
    const dict = CATALOG[lang];
    if (!dict) return text;
    // HTML source wraps long sentences across lines, so a text node can hold
    // a line break and indentation where the catalog key has one space.
    // Exact match first, then the whitespace-collapsed form;
    // without the fallback every wrapped sentence stayed in English.
    const hit = dict[trimmed] || dict[trimmed.replace(/\s+/g, ' ')];
    if (!hit) return text;
    return text.replace(trimmed, hit);
  }

  /* ---------- Apply a language ---------- */
  let currentLang = (() => { try { return localStorage.getItem(LANG_KEY) || 'en'; } catch (_) { return 'en'; } })();

  function applyLanguage(lang) {
    // Not downloaded yet: fetch it, then come back. The page stays in its
    // current language for the moment the file takes to arrive.
    if (lang !== 'en' && !CATALOG[lang]) {
      setPending(lang);
      loadCatalog(lang).then((ok) => {
        setPending(null);
        if (ok) applyLanguage(lang);
        else if (window.MM && window.MM.toast) window.MM.toast("That language couldn't be loaded. Check your connection and try again.", 4000);
      });
      return;
    }
    const textNodes = collectTextNodes(document.body);
    const attrTargets = collectAttrTargets(document.body);

    // Snapshot originals once.
    textNodes.forEach(n => { if (!nodeOriginals.has(n)) nodeOriginals.set(n, n.nodeValue); });
    attrTargets.forEach(({ el, attr }) => {
      if (!attrOriginals.has(el)) attrOriginals.set(el, {});
      const bag = attrOriginals.get(el);
      if (!(attr in bag)) bag[attr] = el.getAttribute(attr);
    });

    if (lang === 'en') {
      textNodes.forEach(n => {
        const orig = nodeOriginals.get(n);
        if (orig != null) n.nodeValue = orig;
      });
      attrTargets.forEach(({ el, attr }) => {
        const bag = attrOriginals.get(el) || {};
        if (bag[attr] != null) el.setAttribute(attr, bag[attr]);
      });
    } else {
      textNodes.forEach(n => {
        const orig = nodeOriginals.get(n);
        n.nodeValue = lookup(orig, lang);
      });
      attrTargets.forEach(({ el, attr }) => {
        const bag = attrOriginals.get(el) || {};
        const orig = bag[attr];
        if (orig == null) return;
        el.setAttribute(attr, lookup(orig, lang));
      });
    }

    currentLang = lang;
    try { localStorage.setItem(LANG_KEY, lang); } catch (_) {}
    document.documentElement.setAttribute('lang', lang);
    updateSwitcher();
    try {
      document.dispatchEvent(new CustomEvent('mm:lang-changed', { detail: { lang } }));
    } catch (_) {}
  }

  /* ---------- UI: floating switcher pill ---------- */
  let switcherEl = null;

  function injectStyles() {
    if (document.getElementById('i18n-styles')) return;
    const s = document.createElement('style');
    s.id = 'i18n-styles';
    s.textContent = `
      .i18n-switcher {
        position: fixed; right: 18px; bottom: 18px; z-index: 9999;
        display: flex; gap: 4px; padding: 6px;
        background: rgba(255,255,255,0.96); backdrop-filter: blur(10px);
        border: 1px solid rgba(0,0,0,0.08); border-radius: 999px;
        box-shadow: 0 8px 24px rgba(0,0,0,0.12);
        font-family: var(--font-body, 'Inter', system-ui, sans-serif);
      }
      /* System font on purpose: each label is written in its own script
         (हिं, తె, ಕ, த), and in the brand stack every one of those glyphs
         would make the browser download that script's Noto file -- on every
         page, for every visitor, English readers included. The phone's own
         fonts draw five short labels perfectly well. */
      .i18n-switcher button {
        font-family: system-ui, -apple-system, 'Segoe UI', sans-serif;
        appearance: none; border: none; background: transparent; cursor: pointer;
        padding: 8px 14px; border-radius: 999px;
        font-size: 0.85rem; font-weight: 600; color: #4a4a4a;
        transition: background .2s, color .2s, transform .15s;
      }
      .i18n-switcher button:hover { background: rgba(200,138,58,0.12); }
      .i18n-switcher button.active {
        background: #2f6b3a; color: #fff;
      }
      .i18n-switcher button.is-loading { animation: i18nPulse 1s ease-in-out infinite; }
      @keyframes i18nPulse { 50% { background: rgba(47,107,58,0.18); } }
      @media (max-width: 640px) {
        .i18n-switcher { right: 10px; bottom: 10px; padding: 4px; }
        .i18n-switcher button { padding: 6px 10px; font-size: 0.8rem; }
      }
    `;
    document.head.appendChild(s);
  }

  function buildSwitcher() {
    injectStyles();
    switcherEl = document.createElement('div');
    switcherEl.className = 'i18n-switcher';
    switcherEl.setAttribute('data-no-translate', '');
    LANGS.forEach(l => {
      const b = document.createElement('button');
      b.type = 'button';
      b.dataset.lang = l.code;
      b.textContent = l.label;
      b.title = l.name;
      b.addEventListener('click', () => {
        if (currentLang === l.code) return;
        applyLanguage(l.code);
      });
      switcherEl.appendChild(b);
    });
    document.body.appendChild(switcherEl);
    updateSwitcher();
  }

  function updateSwitcher() {
    if (!switcherEl) return;
    switcherEl.querySelectorAll('button').forEach(b => {
      b.classList.toggle('active', b.dataset.lang === currentLang);
      b.setAttribute('aria-pressed', b.dataset.lang === currentLang ? 'true' : 'false');
    });
  }

  // While a catalog downloads, the chosen pill pulses so the tap visibly
  // registered on a slow connection.
  function setPending(lang) {
    if (!switcherEl) return;
    switcherEl.querySelectorAll('button').forEach(b => {
      b.classList.toggle('is-loading', b.dataset.lang === lang);
    });
  }

  /* ---------- Init ---------- */
  // Start fetching a returning reader's language straight away, in parallel
  // with the rest of the page, rather than after DOMContentLoaded.
  if (currentLang !== 'en') loadCatalog(currentLang);

  function init() {
    buildSwitcher();
    if (currentLang && currentLang !== 'en') {
      // Defer so any late-rendered content (e.g. chart labels) is included.
      setTimeout(() => applyLanguage(currentLang), 400);
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  // Expose for manual re-translation after dynamic DOM changes (e.g. a tool
  // panel that just rendered new results while a non-English language is
  // active). Synchronous now, so callers can invoke it right after mutating
  // the DOM with no debounce needed.
  window.AgriSimI18n = {
    setLanguage: applyLanguage,
    getLanguage: () => currentLang,
    retranslate: () => applyLanguage(currentLang),
    // For script-built text that never sits in the DOM as English first
    // (chat greetings, map tooltips): the catalog entry, or the source.
    t: (text) => lookup(text, currentLang),
    ready: () => loadCatalog(currentLang)
  };
})();
