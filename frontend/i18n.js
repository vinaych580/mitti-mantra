/* =========================================================
   AgriSim — lightweight i18n
   Supports English (en), Hindi (hi), Telugu (te), Kannada (kn), Tamil (ta).

   Strategy (rewritten — see i18n-data.js for the "why"):
     • Walk all visible text nodes + translatable attributes, exactly as
       before.
     • Look each trimmed string up in the hand-written catalog
       (window.MM_I18N_CATALOG) loaded from i18n-data.js. No network call,
       no rate limit, no waiting — the lookup is synchronous.
     • Glossary terms (window.MM_I18N_GLOSSARY — brand name, acronyms like
       MSP/PMFBY, units) are never altered, even mid-sentence.
     • A string with no catalog entry is left in English rather than guessed.
       Coverage is intentionally scoped to the site chrome a farmer sees
       every visit; see i18n-data.js for what's in and why.
     • A floating language-switcher pill is auto-injected, same as before.
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

  const CATALOG = window.MM_I18N_CATALOG || {};
  const GLOSSARY = new Set((window.MM_I18N_GLOSSARY || []).map((g) => g.toLowerCase()));

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
    const hit = dict[trimmed];
    if (!hit) return text;
    return text.replace(trimmed, hit);
  }

  /* ---------- Apply a language ---------- */
  let currentLang = localStorage.getItem(LANG_KEY) || 'en';

  function applyLanguage(lang) {
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
    localStorage.setItem(LANG_KEY, lang);
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
    });
  }

  /* ---------- Init ---------- */
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
    retranslate: () => applyLanguage(currentLang)
  };
})();
