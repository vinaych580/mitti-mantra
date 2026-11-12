/* =========================================================
   mm-palette.js — quick jump to any page, dashboard tool or action.

   Ctrl/⌘ + K, or "/" when not typing, opens a search box over the page.
   It finds the 24 dashboard tools, the site's pages and a few actions
   (theme, language, assistant, backup) by English name, by the name in the
   current language, or by the words a farmer would actually type —
   "bhav", "khad", "keet", "paani" — and opens them. The advisor persona works
   in long sessions across many tools; this is their fast path. A search
   button in the nav does the same for touch.

   Built lazily on first open: a page that never uses it pays for one
   keydown listener and a button.
   ========================================================= */
(() => {
  'use strict';

  const onDashboard = !!document.querySelector('.sidebar__btn[data-tool]');
  const t = (s) => (window.AgriSimI18n && window.AgriSimI18n.t ? window.AgriSimI18n.t(s) : s);
  const RECENT_KEY = 'mm_palette_recent';

  /* ---------- What can be found ---------- */
  const tool = (id, label, words) => ({ id: 'tool:' + id, group: 'Dashboard tools', label, words, run: () => openTool(id) });
  const page = (href, label, words) => ({ id: 'page:' + href, group: 'Pages', label, words, run: () => go(href) });

  const ITEMS = [
    tool('home', 'My Farm', 'overview farm khet summary'),
    tool('score', 'Farm Score', 'health score rating'),
    tool('recommend', 'Smart recommend', 'which crop recommend suggest best fasal kya ugaye beej'),
    tool('compare', 'Compare crops', 'versus vs side by side tulna'),
    tool('simulate', 'Yield & profit', 'profit yield income simulate munafa paidavar'),
    tool('mix', 'Optimal mix', 'split acres combination portfolio'),
    tool('rotation', 'Rotation planner', 'rabi kharif next season fasal chakra'),
    tool('templates', 'Strategy templates', 'plan presets'),
    tool('forecast', 'Price forecast', 'price mandi bhav rate future daam'),
    tool('sell', 'Best time to sell', 'sell when hold store bechna'),
    tool('msp', 'MSP vs market', 'msp support price government'),
    tool('arbitrage', 'Arbitrage', 'other mandi better price nearby'),
    tool('calendar', 'Crop calendar', 'sowing harvest dates schedule buvai katai'),
    tool('irrigation', 'Irrigation plan', 'water paani sinchai'),
    tool('iot', 'Smart IoT Pump', 'pump motor sensor borewell'),
    tool('fertilizer', 'Fertilizer mix', 'urea dap npk khad'),
    tool('pest', 'Pest alerts', 'insect bug keet keeda'),
    tool('disease', 'Disease scan', 'leaf photo camera rog bimari'),
    tool('ndvi', 'Satellite NDVI', 'satellite greenness field health'),
    tool('loan', 'Loan feasibility', 'kcc credit loan karz emi'),
    tool('expense', 'Season ledger', 'expenses spending kharcha hisab ledger'),
    tool('schemes', 'Govt. schemes', 'pm-kisan pmfby subsidy yojana sarkari'),
    tool('carbon', 'Carbon credits', 'carbon credit'),
    tool('ml', 'ML status', 'model accuracy machine learning'),
    page('index.html', 'Home', 'landing start'),
    page('dashboard.html', 'Dashboard', 'tools'),
    page('season.html', 'My season', 'saved plan harvest tasks spending'),
    page('decide.html', 'What should I sow?', 'guided decide step by step help me choose'),
    page('farm-boundary.html', 'Draw farm', 'map boundary plot area measure naksha'),
    page('marketplace.html', 'Marketplace', 'buy sell produce bazaar market'),
    page('book-a-tractor.html', 'Book a Tractor', 'tractor rent hire machine'),
    page('gyan-seva.html', 'Gyan Seva', 'expert advice consult agronomist salah'),
    page('your-data.html', 'Your data', 'backup restore export delete privacy'),
    { id: 'act:theme', group: 'Actions', label: 'Switch light / dark mode', words: 'theme dark night light', run: toggleTheme },
    { id: 'act:chat', group: 'Actions', label: 'Ask the assistant', words: 'chat bot help question sahayak', run: openChat, when: () => !!document.querySelector('.mm-chat-fab') },
    { id: 'act:backup', group: 'Actions', label: 'Back up my data', words: 'backup save export new phone', run: () => go('your-data.html') },
  ];
  [['en', 'English'], ['hi', 'हिन्दी'], ['te', 'తెలుగు'], ['kn', 'ಕನ್ನಡ'], ['ta', 'தமிழ்']].forEach(([code, name]) => {
    ITEMS.push({
      id: 'lang:' + code, group: 'Actions', label: name, raw: true,
      words: 'language bhasha ' + { en: 'english', hi: 'hindi', te: 'telugu', kn: 'kannada', ta: 'tamil' }[code],
      when: () => !!window.AgriSimI18n && window.AgriSimI18n.getLanguage() !== code,
      run: () => window.AgriSimI18n.setLanguage(code),
    });
  });

  /* ---------- Doing it ---------- */
  function go(href) {
    const here = location.pathname.split('/').pop() || 'index.html';
    if (here === href) { close(); return; }
    location.href = href;
  }
  function openTool(id) {
    const btn = onDashboard && document.querySelector(`.sidebar__btn[data-tool="${id}"]`);
    if (btn) btn.click();
    else location.href = 'dashboard.html?tool=' + encodeURIComponent(id);
  }
  // Mirrors toolbar.js's toggle, which isn't exposed: same attribute, same key.
  function toggleTheme() {
    const html = document.documentElement;
    const next = html.getAttribute('data-theme') === 'dark' ? 'light' : 'dark';
    if (next === 'dark') html.setAttribute('data-theme', 'dark');
    else html.removeAttribute('data-theme');
    try { localStorage.setItem('agrisim_theme', next); } catch (_) { }
    document.getElementById('qw-theme')?.classList.toggle('active', next === 'dark');
  }
  function openChat() {
    const fab = document.querySelector('.mm-chat-fab');
    const panel = document.querySelector('.mm-chat-panel');
    if (fab && !(panel && panel.classList.contains('open'))) fab.click();
  }

  /* ---------- Matching ---------- */
  const norm = (s) => String(s).toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '');

  // Higher is better; 0 is no match. Whole-word prefixes beat substrings,
  // which beat letters-in-order ("rcmd" → Smart recommend).
  function score(item, q) {
    const label = norm(item.raw ? item.label : t(item.label));
    const en = norm(item.label);
    const words = norm(item.words || '');
    let best = 0;
    for (const [hay, weight] of [[label, 3], [en, 3], [words, 2]]) {
      if (!hay) continue;
      if (hay.startsWith(q)) best = Math.max(best, 100 * weight);
      else if (new RegExp('(^|[\\s/&-])' + q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).test(hay)) best = Math.max(best, 80 * weight);
      else if (hay.includes(q)) best = Math.max(best, 50 * weight);
      else {
        let i = 0, gaps = 0, last = -1;
        for (const ch of q) {
          const at = hay.indexOf(ch, i);
          if (at === -1) { i = -1; break; }
          if (last !== -1) gaps += at - last - 1;
          last = at; i = at + 1;
        }
        if (i !== -1) best = Math.max(best, Math.max(1, 30 - gaps) * weight / 3);
      }
    }
    return best;
  }

  function recent() {
    try { return JSON.parse(localStorage.getItem(RECENT_KEY) || '[]'); } catch (_) { return []; }
  }
  function remember(id) {
    try { localStorage.setItem(RECENT_KEY, JSON.stringify([id].concat(recent().filter(x => x !== id)).slice(0, 5))); } catch (_) { }
  }

  function results(q) {
    const usable = ITEMS.filter(it => !it.when || it.when());
    q = norm(q.trim());
    if (!q) {
      const rec = recent().map(id => usable.find(it => it.id === id)).filter(Boolean)
        .map(it => Object.assign({}, it, { group: 'Recent' }));
      const seen = new Set(rec.map(r => r.id));
      return rec.concat(usable.filter(it => it.group !== 'Actions' && !seen.has(it.id)).slice(0, 8));
    }
    const scored = usable.map(it => ({ it, s: score(it, q) })).filter(x => x.s > 0);
    // Letters-in-order matches are a fallback for typos; once anything
    // matches as a word or substring, they are only noise.
    const strong = scored.some(x => x.s >= 100);
    return scored.filter(x => !strong || x.s >= 100)
      .sort((a, b) => b.s - a.s).slice(0, 12).map(x => x.it);
  }

  /* ---------- The box ---------- */
  let root = null, input = null, list = null, items = [], active = 0, returnFocus = null;

  function build() {
    root = document.createElement('div');
    root.className = 'mm-palette';
    root.hidden = true;
    root.innerHTML = `
      <div class="mm-palette__backdrop" data-close></div>
      <div class="mm-palette__panel" role="dialog" aria-modal="true" aria-label="${t('Search pages, tools and actions')}">
        <div class="mm-palette__field">
          <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg>
          <input type="text" class="mm-palette__input" role="combobox" aria-expanded="true" aria-controls="mmPaletteList"
            aria-autocomplete="list" autocomplete="off" spellcheck="false" placeholder="${t('Search pages, tools and actions')}">
          <kbd class="mm-palette__esc" data-close>Esc</kbd>
        </div>
        <ul class="mm-palette__list" id="mmPaletteList" role="listbox"></ul>
      </div>`;
    document.body.appendChild(root);
    input = root.querySelector('input');
    list = root.querySelector('ul');

    input.addEventListener('input', render);
    input.addEventListener('keydown', (e) => {
      if (e.key === 'ArrowDown') { e.preventDefault(); move(1); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); move(-1); }
      else if (e.key === 'Enter') { e.preventDefault(); choose(items[active]); }
      else if (e.key === 'Escape') { e.preventDefault(); close(); }
      else if (e.key === 'Tab') e.preventDefault(); // focus stays in the box
    });
    root.addEventListener('click', (e) => {
      if (e.target.closest('[data-close]')) { close(); return; }
      const li = e.target.closest('[data-i]');
      if (li) choose(items[+li.dataset.i]);
    });
    list.addEventListener('pointermove', (e) => {
      const li = e.target.closest('[data-i]');
      if (li && +li.dataset.i !== active) { active = +li.dataset.i; paintActive(); }
    });
  }

  const esc = (s) => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const ICON = { 'Dashboard tools': '▦', Pages: '↗', Actions: '⚡', Recent: '↺' };

  function render() {
    items = results(input.value);
    active = 0;
    if (!items.length) {
      list.innerHTML = `<li class="mm-palette__empty" role="presentation">${esc(t('No matches. Try another word.'))}</li>`;
      input.removeAttribute('aria-activedescendant');
      return;
    }
    // Headings only for the suggestions shown before typing. Search results
    // are ordered by how well they match, and each row says what it is.
    const grouped = !input.value.trim();
    let lastGroup = null;
    list.innerHTML = items.map((it, i) => {
      const head = grouped && it.group !== lastGroup ? `<li class="mm-palette__group" role="presentation">${esc(t(it.group))}</li>` : '';
      lastGroup = it.group;
      return `${head}<li class="mm-palette__item" role="option" id="mmPal${i}" data-i="${i}" aria-selected="false">
          <span class="mm-palette__ico" aria-hidden="true">${ICON[it.group] || '•'}</span>
          <span class="mm-palette__label">${esc(it.raw ? it.label : t(it.label))}</span>
          <span class="mm-palette__kind">${esc(t(it.id.startsWith('tool:') ? 'Tool' : it.id.startsWith('page:') ? 'Page' : 'Action'))}</span>
        </li>`;
    }).join('');
    paintActive();
  }

  function paintActive() {
    list.querySelectorAll('[data-i]').forEach(li => {
      const on = +li.dataset.i === active;
      li.classList.toggle('is-active', on);
      li.setAttribute('aria-selected', on ? 'true' : 'false');
      if (on) { input.setAttribute('aria-activedescendant', li.id); li.scrollIntoView({ block: 'nearest' }); }
    });
  }
  function move(d) {
    if (!items.length) return;
    active = (active + d + items.length) % items.length;
    paintActive();
  }
  function choose(it) {
    if (!it) return;
    remember(it.id);
    close();
    it.run();
    if (window.MM && window.MM.track) window.MM.track('palette_' + it.id.split(':')[0]);
  }

  function open() {
    if (!root) build();
    if (!root.hidden) return;
    returnFocus = document.activeElement;
    root.hidden = false;
    document.documentElement.classList.add('mm-palette-open');
    input.value = '';
    // Re-read each time: the language may have changed since the box was built.
    const label = t('Search pages, tools and actions');
    input.placeholder = label;
    root.querySelector('[role="dialog"]').setAttribute('aria-label', label);
    render();
    input.focus();
    window.mmLenis?.stop();
  }
  function close() {
    if (!root || root.hidden) return;
    root.hidden = true;
    document.documentElement.classList.remove('mm-palette-open');
    // A modal or the mobile menu may still hold the page (site-ui.js stops
    // Lenis while <body> is overflow:hidden); don't scroll under it.
    if (getComputedStyle(document.body).overflowY !== 'hidden') window.mmLenis?.start();
    if (returnFocus && document.contains(returnFocus)) returnFocus.focus();
  }

  /* ---------- Ways in ---------- */
  const typing = (el) => el && (el.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName));
  document.addEventListener('keydown', (e) => {
    if ((e.key === 'k' || e.key === 'K') && (e.ctrlKey || e.metaKey) && !e.altKey) {
      e.preventDefault();
      root && !root.hidden ? close() : open();
    } else if (e.key === '/' && !e.ctrlKey && !e.metaKey && !e.altKey && !typing(document.activeElement)) {
      e.preventDefault();
      open();
    }
  });

  // A search button in the nav, before the menu button, for touch and for
  // anyone who doesn't know the shortcut.
  const cta = document.querySelector('.nav .nav__cta');
  if (cta) {
    const mac = /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'mm-palette-trigger';
    btn.setAttribute('aria-label', t('Search pages, tools and actions'));
    btn.title = t('Search') + ' (' + (mac ? '⌘K' : 'Ctrl K') + ')';
    btn.innerHTML = `<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg><kbd>${mac ? '⌘K' : 'Ctrl K'}</kbd>`;
    btn.addEventListener('click', open);
    cta.insertBefore(btn, cta.firstChild);
  }

  window.mmPalette = { open, close };
})();
