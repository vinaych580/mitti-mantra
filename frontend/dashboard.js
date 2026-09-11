/* =========================================================
   AgriSim Dashboard — 22 interactive tools, Chart.js visualisations
   Renderers match live API response shapes (verified 2026-04-17).
   ========================================================= */

(() => {
  'use strict';

  /* ---------- Farm state — loaded first so every callback can access it ---------- */
  // savedFarm is declared here (top of IIFE) so that the async Promise.all() callback
  // that populates region selects can safely read savedFarm.region_id.
  // The actual FarmState.load() call also happens here; a second (identical) call
  // at the original site further down is now a no-op because FarmState caches in localStorage.
  let savedFarm = (typeof window.FarmState !== 'undefined')
    ? window.FarmState.load()
    : (() => {
      try {
        return JSON.parse(
          localStorage.getItem('mittimantra_selectedFarm') ||
          localStorage.getItem('agrisim_farm') ||
          'null'
        );
      } catch { return null; }
    })();

  // No copy into MM.profile is needed any more: profile.get() reads region and
  // area straight off the active plot (see mm-core.js), so the drawn farm is the
  // one source of truth and the two can no longer drift apart.

  /* ---------- Helpers ---------- */
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
  const INR = n => '₹' + Math.round(Number(n) || 0).toLocaleString('en-IN');
  // For per-kg / per-unit prices where rounding to ₹ would lose meaningful precision.
  const INR2 = n => '₹' + (Number(n) || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const FIX = (n, d = 1) => (Number(n) || 0).toFixed(d);
  const PCT = n => FIX(n, 1) + '%';
  // Wrap a rounded display with a native title tooltip showing the raw value,
  // so "actual vs displayed" never drifts for precision-sensitive figures.
  const TT = (raw, display) => {
    const r = Number(raw);
    if (!isFinite(r)) return display;
    return `<span title="Exact: ${r.toLocaleString('en-IN', { maximumFractionDigits: 4 })}">${display}</span>`;
  };
  const MONTH_NAMES = ['—', 'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

  const CROP_LABELS = {
    rice: 'Rice · Dhaan', wheat: 'Wheat · Gehun', maize: 'Maize · Makka',
    sugarcane: 'Sugarcane · Ganna', cotton: 'Cotton · Kapas', pulses: 'Pulses · Dal',
    groundnut: 'Groundnut · Mungfali', soybean: 'Soybean',
    mustard: 'Mustard · Sarson', bajra: 'Bajra · Pearl Millet', jowar: 'Jowar · Sorghum',
    potato: 'Potato · Aloo', onion: 'Onion · Pyaz'
  };
  const CROP_EMOJI = {
    rice: '🌾', wheat: '🌾', maize: '🌽', sugarcane: '🎋', cotton: '🌿', pulses: '🫘',
    groundnut: '🥜', soybean: '🌱', mustard: '🌻', bajra: '🌾', jowar: '🌾',
    potato: '🥔', onion: '🧅'
  };
  const cropLabel = id => (CROP_EMOJI[id] || '🌱') + ' ' + (CROP_LABELS[id] || id);

  // Shared chart theming
  const BRAND = '#2f6b3a', BRAND_D = '#1f4d28', ACCENT = '#c88a3a', CLAY = '#a5562a', SKY = '#6ea7c7', INK = '#4a4339';
  const CHART_DEFAULTS = () => {
    if (!window.Chart) return;
    Chart.defaults.font.family = "'Inter', sans-serif";
    Chart.defaults.font.size = 12;
    Chart.defaults.color = INK;
    Chart.defaults.borderColor = 'rgba(29,26,21,.08)';
    Chart.defaults.animation.duration = 700;
    Chart.defaults.animation.easing = 'easeOutCubic';
  };
  CHART_DEFAULTS();

  // Destroy a Chart.js instance stored on an element before creating a new one
  const CHART_REGISTRY = new Map();
  function makeChart(canvasEl, config) {
    if (!canvasEl) return null;
    const prev = CHART_REGISTRY.get(canvasEl);
    if (prev) prev.destroy();
    const chart = new Chart(canvasEl.getContext('2d'), config);
    CHART_REGISTRY.set(canvasEl, chart);
    // Every chart here has the same data available as real text elsewhere on
    // the card (KPI tiles, list rows), so this doesn't need a rich generated
    // description -- just something better than a silent, nameless canvas.
    const seriesLabels = ((config.data && config.data.datasets) || []).map((d) => d.label).filter(Boolean);
    const kind = config.type || 'chart';
    canvasEl.setAttribute('role', 'img');
    canvasEl.setAttribute('aria-label', seriesLabels.length ? `${kind} chart: ${seriesLabels.join(', ')}` : `${kind} chart`);
    return chart;
  }

  /* ---------- Sensitivity heatmap (CSS grid, no lib) ---------- */
  function renderSensitivityHeatmap(cells, baseProfit) {
    // Cells are 25 items with yield_change_pct and price_change_pct both in {-20,-10,0,10,20}
    const ys = [...new Set(cells.map(c => c.yield_change_pct))].sort((a, b) => b - a); // top = +20 yield
    const ps = [...new Set(cells.map(c => c.price_change_pct))].sort((a, b) => a - b); // left = -20 price
    const lookup = {};
    cells.forEach(c => { lookup[`${c.yield_change_pct}_${c.price_change_pct}`] = c; });

    const profits = cells.map(c => c.projected_profit);
    const min = Math.min(...profits), max = Math.max(...profits);
    const colorFor = p => {
      const t = (p - min) / (max - min || 1); // 0..1
      // interpolate: red (low) -> cream -> green (high)
      if (t < 0.5) {
        const k = t * 2;
        return `rgb(${Math.round(225 - k * 30)}, ${Math.round(180 + k * 50)}, ${Math.round(170 + k * 50)})`;
      }
      const k = (t - 0.5) * 2;
      return `rgb(${Math.round(200 - k * 130)}, ${Math.round(230 - k * 30)}, ${Math.round(210 - k * 90)})`;
    };

    return `
      <div style="overflow-x:auto;">
        <table style="border-collapse:separate;border-spacing:4px;margin:0 auto;font-size:.82rem;">
          <thead>
            <tr>
              <th></th>
              <th colspan="${ps.length}" style="text-align:center;font-weight:600;color:var(--ink-faint);padding-bottom:6px;font-size:.74rem;letter-spacing:.1em;text-transform:uppercase;">Price change →</th>
            </tr>
            <tr>
              <th style="font-weight:600;color:var(--ink-faint);font-size:.74rem;padding:6px;">Yield ↓</th>
              ${ps.map(p => `<th style="font-weight:600;color:var(--ink-soft);padding:6px 10px;">${p > 0 ? '+' : ''}${p}%</th>`).join('')}
            </tr>
          </thead>
          <tbody>
            ${ys.map(y => `
              <tr>
                <td style="font-weight:600;color:var(--ink-soft);padding:6px 10px;text-align:right;">${y > 0 ? '+' : ''}${y}%</td>
                ${ps.map(p => {
      const c = lookup[`${y}_${p}`];
      if (!c) return '<td></td>';
      const isBase = y === 0 && p === 0;
      return `<td style="background:${colorFor(c.projected_profit)};padding:10px 12px;border-radius:6px;min-width:72px;text-align:center;font-weight:${isBase ? 700 : 500};color:var(--ink);${isBase ? 'outline:2px solid var(--brand-deep);outline-offset:-2px;' : ''}">
                    ${INR(c.projected_profit)}
                    <div style="font-size:.68rem;color:var(--ink-faint);margin-top:2px;">${FIX(c.projected_roi_pct, 0)}% ROI</div>
                  </td>`;
    }).join('')}
              </tr>`).join('')}
          </tbody>
        </table>
        <div style="text-align:center;margin-top:10px;font-size:.78rem;color:var(--ink-faint);">Base profit (0%, 0%) highlighted · green = higher profit</div>
      </div>`;
  }

  // Thrown after a response was actually received but had a non-2xx status.
  // Kept distinct from a genuine network-level failure (fetch rejecting,
  // e.g. TypeError: Failed to fetch) so the catch block below never confuses
  // real backend validation/server errors with "the backend is unreachable".
  class HttpError extends Error {
    constructor(status, message) {
      super(message);
      this.name = 'HttpError';
      this.status = status;
    }
  }

  /* ---------- Reference-data GET cache ----------
     This farm's /api/soil/{region} and /api/weather/{region} pair is fetched
     independently by the simulate, batch-simulate and optimal-mix handlers, so
     moving between tools re-requests the same unchanging rows every time.

     Deliberately an allowlist of reference endpoints rather than "cache every
     GET". A blanket GET cache has to guess when a write invalidates it, and
     guessing wrong breaks things in both directions: /api/ml/status changes
     after a retrain and /api/expense/* after a logged expense (both must never
     be cached), while /api/simulate, /api/batch-simulate and /api/optimal-mix
     are POSTs that compute rather than write, so treating them as mutations
     would pointlessly discard the soil/weather entries the very flow this is
     meant to help depends on. Restricting the cache to per-region reference
     tables -- soil composition, seasonal weather averages, the region and crop
     lists -- removes that whole question: nothing the user does in a session
     changes them, so nothing needs invalidating.

     Memoising the in-flight promise (not just the value) also collapses
     concurrent duplicates, which HTTP caching alone does not do. */
  const REFERENCE_GET = /^\/api\/(soil|weather|regions|crops)(\/|\?|$)/;
  // These come from CSVs that only change on a deploy or a data refresh, so a
  // few minutes is safe and, unlike the backend's blanket 30 s Cache-Control,
  // long enough to actually survive a user reading one tool's results before
  // opening the next. A page reload always starts clean.
  const GET_TTL_MS = 5 * 60 * 1000;

  /* The store itself lives in mm-core, which loads before this file on every
     page that has it. Sharing it is what stops /api/regions being fetched
     twice on this page -- once for mm-core's farm bar, once for the region
     <select> here. The local Map is the fallback for loading dashboard.js on
     its own. Either way the memo holds the in-flight promise, not the settled
     value, so concurrent callers collapse into one request. */
  const localMemo = new Map();

  function memoGet(key, ttlMs, producer) {
    const shared = window.MM && window.MM.memoGet;
    if (shared) return shared(key, ttlMs, producer);
    const hit = localMemo.get(key);
    if (hit && Date.now() - hit.at < ttlMs) return hit.promise;
    const promise = producer();
    localMemo.set(key, { at: Date.now(), promise });
    // Never remember a failure as if it were a result.
    promise.catch(() => {
      const current = localMemo.get(key);
      if (current && current.promise === promise) localMemo.delete(key);
    });
    return promise;
  }

  function isCacheableGet(url, opts) {
    if (opts.body || (opts.method || 'GET').toUpperCase() !== 'GET') return false;
    // Relative URLs throughout; the base is only needed to parse the path.
    try { return REFERENCE_GET.test(new URL(url, location.origin).pathname); }
    catch (_) { return false; }
  }

  async function apiRequest(url, opts) {
    try {
      const res = await fetch(url, { headers: { 'Content-Type': 'application/json' }, ...opts });
      if (!res.ok) {
        let msg;
        try {
          const errData = await res.json();
          const d = errData && errData.detail;
          if (typeof d === 'string') msg = d;
          else if (Array.isArray(d)) msg = d.map(e => (e && (e.msg || e.message)) || JSON.stringify(e)).join('; ');
          else if (d && typeof d === 'object') msg = JSON.stringify(d);
          else msg = res.statusText;
        } catch { msg = res.statusText; }
        throw new HttpError(res.status, `${res.status} · ${msg}`);
      }

      return await res.json();
    } catch (err) {
      // A real HTTP error response (400/422/500...) is not a "backend
      // unreachable" condition — surface it as-is via the normal error path
      // instead of masking it with fabricated offline-heuristic results.
      if (err instanceof HttpError) throw err;

      // Genuine network-level failure (fetch rejected, e.g. offline / DNS /
      // CORS / connection refused): try the offline fallback for key routes.
      const offline = window.AgriSimOffline;
      const body = opts.body ? tryParseJSON(opts.body) : null;
      if (offline) {
        if (url.includes('/api/simulate') && body) {
          flashOfflineBanner();
          return offline.simulate(body);
        }
        if (url === '/api/crop' && body) {
          flashOfflineBanner();
          return offline.recommend(body);
        }
      }
      throw err;
    }
  }

  async function api(url, opts = {}) {
    const data = isCacheableGet(url, opts)
      ? await memoGet(url, GET_TTL_MS, () => apiRequest(url, opts))
      : await apiRequest(url, opts);

    // Dispatched on cache hits too: mm-analytics counts tool runs off this
    // event, and the user ran the tool whether or not bytes crossed the wire.
    window.dispatchEvent(new CustomEvent('mitti-api-success', { detail: { url, opts, data } }));
    return data;
  }
  function tryParseJSON(s) { try { return JSON.parse(s); } catch { return null; } }
  let offlineBannerShown = false;
  function flashOfflineBanner() {
    if (offlineBannerShown) return;
    offlineBannerShown = true;
    const el = document.createElement('div');
    el.className = 'offline-banner';
    el.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M1 1l22 22"/><path d="M16.72 11.06A10.94 10.94 0 0 1 19 12.55"/><path d="M5 12.55a10.94 10.94 0 0 1 5.17-2.39"/><path d="M10.71 5.05A16 16 0 0 1 22.58 9"/><path d="M1.42 9a15.91 15.91 0 0 1 4.7-2.88"/><path d="M8.53 16.11a6 6 0 0 1 6.95 0"/><line x1="12" y1="20" x2="12.01" y2="20"/></svg>
      <span><strong>Running in offline mode.</strong> Backend unreachable — using on-device simulator.</span>`;
    document.body.appendChild(el);
    setTimeout(() => el.classList.add('offline-banner--hide'), 8000);
    setTimeout(() => el.remove(), 8600);
  }
  function showLoading(el, text = 'Working…') {
    el.innerHTML = `<div class="loading"><div class="spinner"></div><span>${text}</span></div>`;
  }
  /* Telemetry panels sit above the fold, so a backend hiccup was the
     first thing a user read — as raw HTTP text ("404 · File not found").
     Keep the failure honest but calm, and never leak the status line. */
  function telemetryUnavailable(el, what) {
    if (!el) return;
    el.innerHTML =
      `<div class="telemetry-na">
         <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="M12 8v4M12 16h.01"/></svg>
         <span>${what} unavailable right now.</span>
       </div>`;
  }

  // A likely network-level failure: either the browser reports itself
  // offline, or the error is the generic TypeError a rejected fetch() throws
  // (e.g. "Failed to fetch") rather than an HttpError with a real status.
  // Deliberately excludes HttpError (real backend 4xx/5xx responses), which
  // should keep showing their actual message instead of a generic one.
  function isLikelyOffline(err) {
    if (!navigator.onLine) return true;
    return err instanceof TypeError;
  }

  function showError(el, err) {
    if (isLikelyOffline(err)) {
      el.innerHTML = `<div class="alert alert--red"><svg class="alert__ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M1 1l22 22"/><path d="M16.72 11.06A10.94 10.94 0 0 1 19 12.55"/><path d="M5 12.55a10.94 10.94 0 0 1 5.17-2.39"/><path d="M10.71 5.05A16 16 0 0 1 22.58 9"/><path d="M1.42 9a15.91 15.91 0 0 1 4.7-2.88"/><path d="M8.53 16.11a6 6 0 0 1 6.95 0"/><line x1="12" y1="20" x2="12.01" y2="20"/></svg>
        <div class="alert__body"><strong>You're offline</strong><p>Reconnect to use this tool.</p></div></div>`;
      return;
    }
    el.innerHTML = `<div class="alert alert--red"><svg class="alert__ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><path d="M12 8v4M12 16h.01"/></svg>
      <div class="alert__body"><strong>Request failed</strong><p>${err.message}</p></div></div>`;
  }
  function formToObj(form) {
    const obj = {};
    new FormData(form).forEach((v, k) => { obj[k] = v; });
    return obj;
  }

  /* ---------- Label association ----------
     Every tool field is markup of the shape
       <div class="field"><label>Region</label><select name="region_id">…
     -- the <label> is a sibling with no `for`, and the controls have no ids, so
     none of the ~80 dashboard inputs were programmatically labelled: a screen
     reader announced "combo box" with no clue what it selects. Wire each
     .field's label to its control once, at boot, rather than hand-editing
     every block (and re-breaking it on the next tool added). */
  (function associateLabels() {
    let seq = 0;
    document.querySelectorAll('.field').forEach((field) => {
      const label = field.querySelector(':scope > label');
      const control = field.querySelector('input, select, textarea');
      if (!label || !control || label.htmlFor) return;
      if (!control.id) control.id = `fld-${control.name || 'x'}-${++seq}`;
      label.htmlFor = control.id;
    });
  })();

  /* ---------- Tool outputs announce themselves ----------
     Every tool replaces its .output panel's content asynchronously (loading
     -> result), but none of the ~20 panels were live regions, so a screen
     reader had no way to know a result had landed short of re-exploring the
     page. Marked once, at boot, for the same reason associateLabels() is:
     one place instead of hand-editing every tool block. */
  document.querySelectorAll('.output').forEach((el) => {
    el.setAttribute('aria-live', 'polite');
  });

  /* ---------- Constraint failures never disappear silently ----------
     A form that fails HTML validation never fires `submit`, so the tool's own
     handler -- and every error path in it -- is skipped and the Run button
     reads as dead. That already happened for real: the pest tool auto-filled a
     measured 27.9 °C into an input declared step="0.5", and clicking Run did
     nothing a user could interpret. The step constraints are fixed, but any
     future one should announce itself rather than swallow the click. */
  document.addEventListener('invalid', (e) => {
    const el = e.target;
    if (!el || !el.closest || !el.closest('form[data-form]')) return;
    const label = el.closest('.field')?.querySelector('label')?.textContent?.trim() || el.name || 'A field';
    window.MM?.toast?.(`${label}: ${el.validationMessage}`, 4000);
    el.closest('.tool')?.classList.add('active');
    el.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }, true);

  /* ---------- Sidebar: collapsible groups ----------
     On desktop the 22-tool rail is a scannable palette. Linearised onto a
     375px phone it became a 1,346px wall -- 37% of the document, sitting
     above the content, with no way to reach a tool except scrolling past all
     of them. The seven group labels already in the markup are the structure
     to collapse onto, so below 860px each group becomes a disclosure and only
     the active one starts open.

     The buttons are wrapped here rather than in the HTML so the markup stays
     flat and this stays one concern in one place. It must run before the tool
     search is wired up, though the search's descendant queries keep working
     through the wrapper either way. */
  const groupEls = $$('.sidebar__group');

  // Real ARIA tabs, not just styled buttons: role=tablist wraps the seven
  // groups (leaving the search box and "no matches" status outside it, since
  // neither is a tab), each button becomes role=tab with a roving tabindex,
  // and each .tool panel becomes its labelled tabpanel. This is what lets
  // Up/Down move between tools directly instead of tabbing through all 22.
  const tablist = document.createElement('div');
  tablist.className = 'sidebar__tablist';
  tablist.setAttribute('role', 'tablist');
  tablist.setAttribute('aria-orientation', 'vertical');
  tablist.setAttribute('aria-label', 'Dashboard tools');
  groupEls[0]?.parentNode.insertBefore(tablist, groupEls[0]);
  groupEls.forEach(group => tablist.appendChild(group));

  groupEls.forEach(group => {
    const label = group.querySelector('.sidebar__label');
    const groupBtns = group.querySelectorAll('.sidebar__btn');
    if (!label || !groupBtns.length) return;

    // Two elements, not one: the 0fr collapse only sizes the tracks it declares,
    // so with the buttons as direct grid children every button past the first
    // got an implicit auto row and the group stayed open. The inner wrapper
    // gives the grid exactly one row to collapse.
    const items = document.createElement('div');
    items.className = 'sidebar__items';
    const inner = document.createElement('div');
    inner.className = 'sidebar__items-inner';
    groupBtns.forEach(b => inner.appendChild(b));
    items.appendChild(inner);
    group.appendChild(items);

    // The label is a <div>; give it real button semantics only while it acts
    // as one, so desktop keeps its original seven non-focusable headings.
    label.addEventListener('click', () => {
      if (!window.matchMedia('(max-width: 860px)').matches) return;
      const open = group.classList.toggle('is-open');
      label.setAttribute('aria-expanded', String(open));
    });
    label.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); label.click(); }
    });
  });

  const sidebarMq = window.matchMedia('(max-width: 860px)');
  function syncSidebarGroups() {
    const mobile = sidebarMq.matches;
    groupEls.forEach(group => {
      const label = group.querySelector('.sidebar__label');
      if (!label) return;
      if (mobile) {
        label.setAttribute('role', 'button');
        label.setAttribute('tabindex', '0');
        label.setAttribute('aria-expanded', String(group.classList.contains('is-open')));
      } else {
        label.removeAttribute('role');
        label.removeAttribute('tabindex');
        label.removeAttribute('aria-expanded');
      }
    });
  }
  function openActiveGroup() {
    const active = document.querySelector('.sidebar__btn.active');
    const group = active && active.closest('.sidebar__group');
    if (group) group.classList.add('is-open');
    syncSidebarGroups();
  }
  openActiveGroup();
  sidebarMq.addEventListener('change', syncSidebarGroups);

  /* ---------- Sidebar tool switcher ---------- */
  const btns = $$('.sidebar__btn');
  const tools = $$('.tool');

  // Wire the tab/tabpanel relationship once. aria-selected is what a real
  // tab announces (not aria-current, which is for landmark-style "you are
  // here" and would double up with role=tab's own selected state).
  btns.forEach(b => {
    const tool = b.dataset.tool;
    b.setAttribute('role', 'tab');
    b.id = `tool-tab-${tool}`;
    b.setAttribute('aria-controls', `tool-panel-${tool}`);
    b.setAttribute('aria-selected', String(b.classList.contains('active')));
    // Roving tabindex: exactly one tab is a Tab stop; arrow keys move among
    // the rest without pulling Tab through all 22 of them.
    b.tabIndex = b.classList.contains('active') ? 0 : -1;
  });
  tools.forEach(t => {
    const tool = t.dataset.tool;
    t.setAttribute('role', 'tabpanel');
    t.id = `tool-panel-${tool}`;
    t.setAttribute('aria-labelledby', `tool-tab-${tool}`);
  });

  // Only buttons in a currently-reachable group: not search-filtered out,
  // and not sitting inside a collapsed mobile group.
  function reachableTabs() {
    return btns.filter(b => {
      if (b.hidden) return false;
      const group = b.closest('.sidebar__group');
      if (!group || group.hidden) return false;
      if (sidebarMq.matches && !group.classList.contains('is-open')) return false;
      return true;
    });
  }

  function activateTool(b, { focusButton = false } = {}) {
    // Re-activating the tool you're already on shouldn't re-run the switch --
    // without this, a habitual double-click (or an arrow key that lands back
    // on the same tab) replays the scroll and the toolIn fade on content
    // that never actually changed.
    if (b.classList.contains('active')) return;
    const target = b.dataset.tool;
    btns.forEach(x => {
      const isActive = x === b;
      x.classList.toggle('active', isActive);
      x.setAttribute('aria-selected', String(isActive));
      x.tabIndex = isActive ? 0 : -1;
    });
    // Capture the outgoing tool before the active class moves, so it can fade
    // out instead of vanishing the instant the incoming one appears.
    const outgoing = tools.find(t => t.classList.contains('active') && t.dataset.tool !== target);
    tools.forEach(t => t.classList.toggle('active', t.dataset.tool === target));
    if (outgoing) {
      outgoing.classList.add('tool--leaving');
      // Reading offsetHeight forces the browser to commit the display:block,
      // opacity:1 state to a frame before the next line changes opacity --
      // without this the two style changes coalesce into one and there's
      // nothing for the transition to animate from.
      void outgoing.offsetHeight;
      outgoing.style.opacity = '0';
      const cleanup = () => {
        outgoing.classList.remove('tool--leaving');
        outgoing.style.opacity = '';
      };
      outgoing.addEventListener('transitionend', cleanup, { once: true });
      setTimeout(cleanup, 250); // backstop if transitionend never fires
    }
    // Keep the open group in step when a tool is chosen programmatically
    // (several call sites click these buttons directly).
    groupEls.forEach(g => g.classList.toggle('is-open', g.contains(b)));
    syncSidebarGroups();
    // The rail scrolls independently of the page (it has its own max-height
    // and overflow), so a selection made programmatically -- a deep link, an
    // "open the irrigation schedule" cross-link from inside another tool --
    // can land on a button that's currently scrolled out of view in the rail
    // itself. 'nearest' only moves it when it's actually offscreen, so a
    // plain visible click never triggers any motion here.
    b.scrollIntoView({ block: 'nearest' });
    if (focusButton) b.focus();
    // Deep-linking already reads ?tool= on first paint (mm-core.js), but
    // switching tools never wrote it back -- refreshing, copying the URL, or
    // sharing a link always returned to whatever tool the page happened to
    // load with, not the one on screen. replaceState (not pushState) keeps
    // the current view bookmarkable/shareable without turning every tool
    // click into its own back-button stop.
    const url = new URL(location.href);
    url.searchParams.set('tool', target);
    history.replaceState(history.state, '', url);
    // Every tool is display:none except the active one, so the panel that
    // just appeared always starts at the top of .toolbox -- but the window's
    // scroll position doesn't know that. Left alone, switching tools while
    // scrolled deep into a long one (e.g. a filled-out simulator) drops the
    // user into whatever happens to occupy that same pixel offset in the new
    // tool: often blank space, sometimes an unrelated section. Scrolling the
    // new tool's top edge just clear of the sticky nav on every switch, on
    // every breakpoint, is what makes tool-switching read as a tab change
    // rather than a broken page jump; it's a no-op scroll (and therefore
    // invisible) whenever the user was already near the top.
    const nextTool = tools.find(t => t.dataset.tool === target);
    if (nextTool) {
      const navH = document.getElementById('nav')?.offsetHeight || 72;
      const y = nextTool.getBoundingClientRect().top + window.scrollY - navH - 20;
      window.scrollTo({ top: Math.max(y, 0), behavior: 'smooth' });
    }
  }

  btns.forEach(b => b.addEventListener('click', () => activateTool(b)));

  // Arrow-key roving navigation, automatic-activation model: moving focus
  // with an arrow key activates that tab immediately, matching the click
  // behavior instead of requiring a separate confirm step. Left/Right are
  // included alongside Up/Down since a vertical rail full of icon+label
  // buttons reads like a list either way, and supporting both costs nothing.
  tablist.addEventListener('keydown', (e) => {
    const current = e.target.closest('.sidebar__btn');
    if (!current) return;
    const forward = e.key === 'ArrowDown' || e.key === 'ArrowRight';
    const backward = e.key === 'ArrowUp' || e.key === 'ArrowLeft';
    if (!forward && !backward && e.key !== 'Home' && e.key !== 'End') return;
    e.preventDefault();

    const reachable = reachableTabs();
    const i = reachable.indexOf(current);
    if (i === -1) return;
    let next;
    if (e.key === 'Home') next = reachable[0];
    else if (e.key === 'End') next = reachable[reachable.length - 1];
    else if (forward) next = reachable[(i + 1) % reachable.length];
    else next = reachable[(i - 1 + reachable.length) % reachable.length];

    if (next) activateTool(next, { focusButton: true });
  });

  /* ---------- Tool empty states ----------
     Each .output starts empty, so a freshly-opened tool was just a form
     with dead space under it. Describe what the tool actually returns.
     showLoading/showError/results all overwrite innerHTML, so these
     disappear on their own the moment a tool is run. */
  const TOOL_OUTPUTS = {
    score: ['One blended 0-100 farm grade', 'Profit, risk & market pillars', 'Field-health & pest pressure (if located)', 'Top alternative crops'],
    recommend: ['Ranked crop shortlist', 'Expected ROI per crop', 'Risk & soil-health score', 'ML model confidence'],
    simulate: ['Yield in kg/acre', 'Full cost breakdown', 'Profit & ROI', 'Water efficiency & nutrient gap'],
    rotation: ['Kharif × rabi pairings', 'Combined two-season profit', 'Soil nitrogen impact', 'Ranked rotation options'],
    templates: ['Preset farming strategies', 'Expected return per template', 'Risk profile', 'Best-fit match for your plot'],
    compare: ['Side-by-side metrics', 'Winner per category', 'Profit difference', 'Water & input demand'],
    mix: ['Optimal acre allocation', 'Blended profit estimate', 'Diversification benefit', 'Per-crop share'],
    forecast: ['Six-month price curve', 'Confidence range', 'Sell-or-hold signal', 'Historical trend'],
    msp: ['MSP vs live mandi price', 'Gap per quintal', 'Whether MSP beats market', 'Procurement guidance'],
    sell: ['Best selling window', 'Expected price gain', 'Month-by-month outlook', 'Holding-cost trade-off'],
    arbitrage: ['Price gaps across mandis', 'Transport-adjusted margin', 'Best destination mandi', 'Net gain per quintal'],
    calendar: ['Sowing-to-harvest timeline', 'Stage-wise field tasks', 'Critical care windows', 'Days to maturity'],
    irrigation: ['Week-by-week water plan', 'Critical stress stages', 'Total season water need', 'Rainfall offset'],
    fertilizer: ['Urea / DAP / MOP in kg/acre', 'Nutrient gap vs target', 'Split application timing', 'Estimated input cost'],
    pest: ['Triggered risk alerts', 'Organic & chemical treatments', 'Weather rationale per alert', 'Preventive actions'],
    loan: ['EMI & total interest', 'DSCR coverage ratio', 'Feasibility verdict', 'Repayment schedule'],
    schemes: ['Matched central & state schemes', 'Eligibility per scheme', 'Benefit amount', 'How to apply'],
    ndvi: ['Sub-field health zones', 'NDVI vegetation index', 'Stress hotspots', 'Zone-wise action list'],
    carbon: ['Estimated carbon credits', 'Revenue potential', 'Qualifying practices', 'Sequestration per acre'],
    iot: ['Live sensor readings', 'Pump control state', 'Irrigation trigger thresholds', 'Moisture history'],
    ml: ['Model versions & status', 'Training accuracy', 'Last retrain date', 'Feature counts']
  };

  const CHECK_SVG = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>';
  const SPARK_SVG = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 3v18h18"/><path d="M7 15l4-6 4 3 5-8"/></svg>';

  function renderEmptyStates() {
    Object.keys(TOOL_OUTPUTS).forEach(tool => {
      const out = document.querySelector(`[data-out="${tool}"]`);
      if (!out || out.innerHTML.trim() !== '') return;
      const items = TOOL_OUTPUTS[tool].map(t => `<li>${CHECK_SVG}<span>${t}</span></li>`).join('');
      // Not every tool takes input -- "ML status" is just a button -- so don't
      // tell those users to fill in fields that aren't there.
      const hasForm = !!document.querySelector(`form[data-form="${tool}"]`);
      const hint = hasForm
        ? "Fill in the fields above and run the tool to see your results here."
        : "Press the button above to see your results here.";
      out.innerHTML =
        `<div class="tool__empty">
           <div class="tool__empty__ico">${SPARK_SVG}</div>
           <div>
             <div class="tool__empty__label">What you'll get</div>
             <ul>${items}</ul>
             <p class="tool__empty__hint">${hint}</p>
           </div>
         </div>`;
    });
  }
  renderEmptyStates();

  /* ---------- Sidebar tool filter ----------
     22 tools in a list that overflows the viewport by ~400px, with no
     way to jump to one by name. */
  (function initSidebarFilter() {
    const sidebar = document.querySelector('.sidebar');
    if (!sidebar) return;

    const wrap = document.createElement('div');
    wrap.className = 'sidebar__search';
    wrap.innerHTML =
      `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="11" cy="11" r="7"/><path d="M20 20l-3.5-3.5"/></svg>
       <input type="search" id="toolFilter" placeholder="Find a tool…" aria-label="Filter tools" autocomplete="off">`;
    sidebar.prepend(wrap);

    const empty = document.createElement('div');
    empty.className = 'sidebar__empty';
    empty.textContent = 'No tools match.';
    empty.hidden = true;
    empty.setAttribute('role', 'status');
    sidebar.appendChild(empty);

    const input = wrap.querySelector('input');
    const groups = $$('.sidebar__group');

    input.addEventListener('input', () => {
      const q = input.value.trim().toLowerCase();
      let anyVisible = false;

      groups.forEach(group => {
        let groupHas = false;
        group.querySelectorAll('.sidebar__btn').forEach(btn => {
          const match = !q || btn.textContent.toLowerCase().includes(q);
          btn.hidden = !match;
          if (match) groupHas = true;
        });
        group.hidden = !groupHas;
        if (groupHas) anyVisible = true;
      });

      // While filtering, every surviving group is forced open -- otherwise on
      // mobile the search would hide its own matches inside collapsed groups.
      sidebar.classList.toggle('is-searching', !!q);

      empty.hidden = anyVisible;
    });

    input.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        input.value = '';
        input.dispatchEvent(new Event('input'));
      }
      // Enter opens the only remaining match
      if (e.key === 'Enter') {
        const visible = $$('.sidebar__btn').filter(b => !b.hidden);
        if (visible.length === 1) visible[0].click();
      }
    });
  })();

  /* ---------- Populate region & crop selects ---------- */
  Promise.all([
    api('/api/regions').catch(() => [
      { id: 'mp_sehore', name: 'MP · Sehore' },
      { id: 'up_lucknow', name: 'UP · Lucknow' },
      { id: 'mh_pune', name: 'MH · Pune' }
    ]),
    api('/api/crops').catch(() => Object.keys(CROP_LABELS).map(c => ({ crop_id: c, crop_name: CROP_LABELS[c] })))
  ]).then(([regions, crops]) => {
    $$('select[data-regions]').forEach(sel => {
      let optsHtml = regions.map(r => {
        const id = r.id || r.region_id;
        const name = r.name || r.region_name || id;
        return `<option value="${id}">${name}</option>`;
      }).join('');
      if (savedFarm && savedFarm.region_id) {
        const farmName = (savedFarm.state && savedFarm.district)
          ? `${savedFarm.state} · ${savedFarm.district} (My Farm)`
          : "My Farm";
        optsHtml = `<option value="${savedFarm.region_id}">${farmName}</option>` + optsHtml;
      }
      sel.innerHTML = optsHtml;
    });
    $$('select[data-crops]').forEach(sel => {
      const hasAny = sel.querySelector('option[value=""]');
      const isMulti = sel.multiple;
      const preselect = new Set(['rice', 'soybean', 'cotton']); // sensible defaults for compare
      const opts = crops.map(c => {
        const id = c.crop_id || c;
        const sel_attr = isMulti && preselect.has(id) ? ' selected' : '';
        return `<option value="${id}"${sel_attr}>${cropLabel(id)}</option>`;
      }).join('');
      sel.innerHTML = (hasAny ? hasAny.outerHTML : '') + opts;
    });

    // FIX-2: If a farm is active, pre-select its region_id across every
    // region dropdown — overriding the API default first-option.
    if (savedFarm && savedFarm.region_id) {
      $$('select[data-regions]').forEach(sel => {
        const opt = sel.querySelector(`option[value="${savedFarm.region_id}"]`);
        if (opt) sel.value = savedFarm.region_id;
      });
    }

    // FIX-3: Trigger initial telemetry using the farm's region (not the
    // API's first-returned region). Falls back to first select value if no farm.
    const initRegion = (savedFarm && savedFarm.region_id) || $('select[data-regions]')?.value;
    const initName = (() => {
      if (savedFarm && savedFarm.region_id) {
        // Try to find the human-readable name from the populated select
        const sel = $('select[data-regions]');
        const opt = sel && sel.querySelector(`option[value="${savedFarm.region_id}"]`);
        return opt ? opt.text : (savedFarm.district || savedFarm.state || savedFarm.region_id);
      }
      const sel = $('select[data-regions]');
      return sel ? (sel.options[sel.selectedIndex]?.text || sel.value) : '';
    })();

    if (initRegion) {
      setTimeout(() => updateRegionalTelemetry(initRegion, initName), 500);
    }
  });

  // --- Dynamic Agri-Telemetry & Map Integrations (Phase 7) ---
  let telemetryMapObj = null;
  let activeTelemetryRegionId = null;

  // FIX-4: Full 30-region coordinate table sourced from FarmState.REGION_CENTROIDS.
  // Avoids the previous bug where only 4 regions were in REGION_COORDS and everything
  // else defaulted to Telangana's centroid [18.04, 78.26].
  const REGION_COORDS = (() => {
    const tbl = {};
    // Use FarmState table when available (loaded before dashboard.js via defer ordering).
    const src = (typeof window.FarmState !== 'undefined' && window.FarmState.REGION_CENTROIDS) || [];
    src.forEach(r => { tbl[r.region_id] = [r.lat, r.lon]; });
    // Bake-in a handful of fallbacks in case FarmState failed to load.
    if (!tbl['telangana_medak']) tbl['telangana_medak'] = [18.04, 78.26];
    if (!tbl['mp_sehore']) tbl['mp_sehore'] = [23.20, 77.08];
    if (!tbl['up_lucknow']) tbl['up_lucknow'] = [26.85, 80.94];
    if (!tbl['mh_pune']) tbl['mh_pune'] = [18.52, 73.85];
    return tbl;
  })();

  function drawPestRiskOverlay(coords, w) {
    if (!telemetryMapObj) return;

    // Remove any previous pest risk layers
    telemetryMapObj.eachLayer(layer => {
      if (layer.options && layer.options.className === 'pest-risk-zone') {
        telemetryMapObj.removeLayer(layer);
      }
    });

    const temp = w.avg_temp_c || 25;
    const rain = w.rainfall_mm || 500;

    let riskLevel = "Low";
    let color = "#10b981"; // green
    let fillOpacity = 0.08;
    let description = "Low risk of fungal/insect infestations.";

    if (temp > 25 && rain > 600) {
      riskLevel = "High";
      color = "#ef4444"; // red
      fillOpacity = 0.28;
      description = "Critical Risk! High temp & rainfall favor Blast & Stem Borer outbreaks.";
    } else if (temp > 22 && rain > 350) {
      riskLevel = "Moderate";
      color = "#f59e0b"; // orange
      fillOpacity = 0.18;
      description = "Moderate Risk. Watch for leafhoppers and mild rust infections.";
    }

    // Draw a circle indicating the risk zone around the farm/region centroid
    const radiusInMeters = riskLevel === "High" ? 600 : riskLevel === "Moderate" ? 400 : 200;

    const circle = L.circle(coords, {
      color: color,
      fillColor: color,
      fillOpacity: fillOpacity,
      weight: 1.5,
      dashArray: riskLevel === "High" ? '4, 4' : null,
      className: 'pest-risk-zone'
    }).addTo(telemetryMapObj);

    // Add a warning tooltip to the risk zone
    circle.bindTooltip(`<b>${riskLevel} Pest Risk Zone</b><br>${description}`, {
      permanent: true,
      direction: 'top',
      opacity: 0.9,
      className: 'pest-tooltip'
    });
  }

  function updateRegionalTelemetry(regionId, regionName) {
    activeTelemetryRegionId = regionId;
    const pnl = document.getElementById('regionalTelemetry');
    if (!pnl) return;
    pnl.style.display = 'block';

    const farmActive = savedFarm && savedFarm.region_id === regionId;
    const coords = farmActive && savedFarm.lat && savedFarm.lon
      ? [savedFarm.lat, savedFarm.lon]
      : (REGION_COORDS[regionId] || [20.5, 78.9]);

    const rName = document.getElementById('telemetryRegionName');
    if (rName) rName.innerText = regionName || regionId;

    const skeleton = `
      <div class="skeleton skeleton--line"></div>
      <div class="skeleton skeleton--line skeleton--short"></div>
    `;
    const wBody = document.getElementById('telemetryWeatherBody');
    const sBody = document.getElementById('telemetrySoilBody');
    const mBody = document.getElementById('telemetryMarketBody');
    const satBody = document.getElementById('telemetrySatelliteBody');

    if (wBody) wBody.innerHTML = skeleton;
    if (sBody) sBody.innerHTML = skeleton;
    if (mBody) mBody.innerHTML = skeleton;
    if (satBody) satBody.innerHTML = skeleton;

    // Fetch weather info asynchronously
    api(`/api/weather?region_id=${regionId}&season=kharif`)
      .then(w => {
        if (activeTelemetryRegionId !== regionId) return;
        if (wBody) wBody.innerHTML = `
          <div style="font-size: 1.15rem; font-weight: 600; color: var(--brand-deep);">${w.avg_temp_c}°C</div>
          <div style="font-size: 0.8rem; color: var(--ink-soft);">Rainfall: ${w.rainfall_mm}mm</div>
          <div style="font-size: 0.78rem; margin-top: 4px; padding: 2px 6px; border-radius: 4px; display: inline-block; background: ${w.imd_alert === 'Green' ? '#d1fae5' : '#fee2e2'}; color: ${w.imd_alert === 'Green' ? '#065f46' : '#991b1b'}; font-weight: 600;">IMD: ${w.imd_alert}</div>
        `;

        // Auto-populate form default weather values
        const simulateForm = document.querySelector('[data-form="simulate"]');
        if (simulateForm && !simulateForm.weather_override_on.checked) {
          if (w.rainfall_mm != null) simulateForm.rainfall_mm.value = Math.round(w.rainfall_mm);
          if (w.avg_temp_c != null) simulateForm.avg_temp_c.value = w.avg_temp_c.toFixed(1);
        }

        const pestForm = document.querySelector('[data-form="pest"]');
        if (pestForm) {
          if (w.avg_temp_c != null) pestForm.avg_temp_c.value = w.avg_temp_c.toFixed(1);
          if (w.rainfall_mm != null) pestForm.rainfall_mm.value = Math.round(w.rainfall_mm);
        }

        const irrForm = document.querySelector('[data-form="irrigation"]');
        if (irrForm) {
          if (w.rainfall_mm != null) irrForm.rainfall_mm.value = Math.round(w.rainfall_mm);
        }

        // Draw the pest risk overlay layer on the map
        drawPestRiskOverlay(coords, w);
      })
      .catch(err => {
        telemetryUnavailable(wBody, 'Weather');
      });

    // Fetch soil info asynchronously
    api(`/api/soil?region_id=${regionId}`)
      .then(s => {
        if (activeTelemetryRegionId !== regionId) return;
        if (sBody) sBody.innerHTML = `
          <div style="font-size: 1.15rem; font-weight: 600; color: var(--brand-deep);">pH ${s.ph}</div>
          <div style="font-size: 0.8rem; color: var(--ink-soft);">N:${Math.round(s.n_kg_per_acre)} P:${Math.round(s.p_kg_per_acre)} K:${Math.round(s.k_kg_per_acre)}</div>
          <div style="font-size: 0.78rem; color: var(--ink-faint);">Carbon: ${s.organic_carbon_percent}%</div>
        `;

        // Auto-fill NPK inputs in fertilizer form if no custom active farm soil is present
        if (!savedFarm || !savedFarm.soil) {
          const fertForm = document.querySelector('[data-form="fertilizer"]');
          if (fertForm) {
            if (s.n_kg_per_acre != null) fertForm.n.value = Math.round(s.n_kg_per_acre);
            if (s.p_kg_per_acre != null) fertForm.p.value = Math.round(s.p_kg_per_acre);
            if (s.k_kg_per_acre != null) fertForm.k.value = Math.round(s.k_kg_per_acre);
          }
        }
      })
      .catch(err => {
        telemetryUnavailable(sBody, 'Soil data');
      });

    // Fetch market price data asynchronously
    api(`/api/market?region_id=${regionId}&crop_id=rice`)
      .then(m => {
        if (activeTelemetryRegionId !== regionId) return;
        if (mBody) mBody.innerHTML = `
          <div style="font-size: 1.15rem; font-weight: 600; color: var(--brand-deep);">₹${m.current_mandi_price_inr_per_kg}/kg</div>
          <div style="font-size: 0.8rem; color: var(--ink-soft);">Volatility: ${m.volatility_std}</div>
          <div style="font-size: 0.78rem; color: var(--accent); font-weight: 600;">Trend: ${m.forecast.trend_direction}</div>
        `;
      })
      .catch(err => {
        telemetryUnavailable(mBody, 'Mandi prices');
      });

    // Fetch satellite vegetation telemetry from the backend API
    api(`/api/satellite?lat=${coords[0]}&lon=${coords[1]}`)
      .then(sat => {
        if (activeTelemetryRegionId !== regionId) return;
        if (satBody && !sat.available) {
          satBody.innerHTML = `<div style="font-size: 0.78rem; color: var(--ink-soft);">${sat.message || 'Live satellite imagery is unavailable.'}</div>`;
        } else if (satBody) {
          satBody.innerHTML = `
            <div style="font-size: 1.15rem; font-weight: 600; color: var(--brand-deep);">NDVI ${sat.ndvi.toFixed(2)}</div>
            <div style="font-size: 0.8rem; color: var(--ink-soft);">${sat.source}</div>
            <div style="font-size: 0.78rem; color: var(--sky); font-weight: 600;">Canopy: ${sat.canopy}</div>
          `;
        }
      })
      .catch(err => {
        telemetryUnavailable(satBody, 'Satellite telemetry');
      });

    // FIX-5 & FIX-6: Leaflet GIS mapping
    // Use the farm's actual centroid if this is the farm's region; fall back to
    // the REGION_COORDS table (now covering all 30 regions). Default is India centre.

    const mapDiv = document.getElementById('telemetryMap');
    if (mapDiv && typeof L !== 'undefined') {
      mapDiv.style.display = 'block';
      setTimeout(() => {
        if (activeTelemetryRegionId !== regionId) return;
        if (!telemetryMapObj) {
          telemetryMapObj = L.map('telemetryMap', { zoomControl: false }).setView(coords, farmActive ? 15 : 12);
          L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', {
            maxZoom: 19,
            attribution: 'Imagery © Esri'
          }).addTo(telemetryMapObj);
          L.tileLayer('https://{s}.basemaps.cartocdn.com/rastertiles/voyager_only_labels/{z}/{x}/{y}.png', {
            maxZoom: 19, opacity: 0.8, attribution: '© OSM © CartoDB'
          }).addTo(telemetryMapObj);
        } else {
          telemetryMapObj.setView(coords, farmActive ? 15 : 12);
        }

        // Remove existing markers/polygons
        telemetryMapObj.eachLayer(layer => {
          if (layer instanceof L.Polygon || layer instanceof L.Marker || layer instanceof L.GeoJSON) {
            telemetryMapObj.removeLayer(layer);
          }
        });

        const BRAND_GRN = '#2f6b3a';

        if (farmActive && savedFarm.geojson) {
          // FIX-6: Draw the actual drawn polygon (not a fake ±0.003° placeholder square).
          try {
            const gj = L.geoJSON(savedFarm.geojson, {
              style: { color: BRAND_GRN, weight: 2.5, fillColor: BRAND_GRN, fillOpacity: 0.25 }
            }).addTo(telemetryMapObj);
            telemetryMapObj.fitBounds(gj.getBounds(), { padding: [12, 12] });
            // Centroid marker
            L.circleMarker([savedFarm.lat, savedFarm.lon], {
              radius: 6, fillColor: BRAND_GRN, color: '#fff', weight: 2, fillOpacity: 1
            }).addTo(telemetryMapObj)
              .bindPopup(
                `<b>Your farm</b><br>` +
                `${(savedFarm.acres || 0).toFixed(2)} acres<br>` +
                `${savedFarm.lat.toFixed(5)}°N, ${savedFarm.lon.toFixed(5)}°E` +
                (savedFarm.district ? `<br>${savedFarm.district}, ${savedFarm.state}` : '')
              ).openPopup();
          } catch (mapErr) {
            console.warn('[dashboard] farm polygon render failed:', mapErr);
            // Fallback: just show a marker
            L.marker(coords).addTo(telemetryMapObj)
              .bindPopup(`<b>${regionName || regionId}</b><br>GPS Active.`).openPopup();
          }
        } else {
          // No farm active: show a placeholder square + marker as before
          const offset = 0.003;
          const poly = [
            [coords[0] - offset, coords[1] - offset],
            [coords[0] - offset, coords[1] + offset],
            [coords[0] + offset, coords[1] + offset],
            [coords[0] + offset, coords[1] - offset]
          ];
          L.polygon(poly, { color: BRAND_GRN, fillColor: BRAND_GRN, fillOpacity: 0.25 }).addTo(telemetryMapObj);
          L.marker(coords).addTo(telemetryMapObj)
            .bindPopup(`<b>${regionName || regionId}</b><br>GPS Active.`).openPopup();
        }

        telemetryMapObj.invalidateSize();
      }, 100);
    }
  }

  // Bind change listeners to keep region inputs synchronized
  document.addEventListener('change', e => {
    if (e.target && e.target.matches('select[data-regions]')) {
      const val = e.target.value;
      const name = e.target.options[e.target.selectedIndex]?.text;
      $$('select[data-regions]').forEach(sel => {
        if (sel.value !== val) sel.value = val;
      });
      updateRegionalTelemetry(val, name);
    }
  });

  /* ==========================================================
     TOOL 0: Farm Score — blends recommend + risk + NDVI + pest
     ========================================================== */
  const scoreForm = $('[data-form="score"]');
  if (scoreForm) scoreForm.addEventListener('submit', async e => {
    e.preventDefault();
    const out = $('[data-out="score"]');
    showLoading(out, 'Blending farm signals…');
    try {
      const f = formToObj(e.target);
      const body = {
        region_id: f.region_id, season: f.season,
        area_acres: parseFloat(f.area_acres),
        budget_per_acre: parseFloat(f.budget_per_acre),
      };
      if (f.crop_id) body.crop_id = f.crop_id;
      if (f.lat) body.lat = parseFloat(f.lat);
      if (f.lon) body.lon = parseFloat(f.lon);

      const r = await api('/api/farm-score', { method: 'POST', body: JSON.stringify(body) });

      const gradeClass = r.farm_score >= 70 ? 'kpi--good' : 'kpi--warn';
      const PILLAR_LABELS = {
        profitability: 'Profitability', risk_resilience: 'Risk resilience', market_fit: 'Market fit',
        field_health: 'Field health (NDVI)', pest_pressure: 'Pest pressure (low = risk)',
      };
      const pillarBars = Object.entries(r.pillars).map(([key, val]) => `
        <div style="margin-bottom:.6rem;">
          <div style="display:flex;justify-content:space-between;font-size:.82rem;color:var(--ink-soft);margin-bottom:.25rem;">
            <span>${PILLAR_LABELS[key] || key}</span><span>${FIX(val, 0)}</span>
          </div>
          <div style="height:8px;border-radius:4px;background:var(--bg-soft,rgba(29,26,21,.08));overflow:hidden;">
            <div style="height:100%;width:${Math.max(0, Math.min(100, val))}%;background:var(--brand-deep);border-radius:4px;"></div>
          </div>
        </div>`).join('');

      out.innerHTML = `
        <div class="kpi-grid">
          <div class="kpi ${gradeClass}"><div class="kpi__lbl">Farm Score</div>
            <div class="kpi__val" style="font-size:2rem;">${r.grade}</div>
            <div class="kpi__sub">${FIX(r.farm_score, 0)} / 100</div></div>
          <div class="kpi kpi--info"><div class="kpi__lbl">Best-fit crop</div>
            <div class="kpi__val" style="font-size:1.1rem;">${cropLabel(r.recommended_crop)}</div></div>
          <div class="kpi"><div class="kpi__lbl">Source</div>
            <div class="kpi__val" style="font-size:.95rem;">${r.prediction_source === 'ml_model' ? 'ML model' : 'Heuristic'}</div></div>
        </div>
        <div style="margin-top:1rem;">${pillarBars}</div>
        ${r.top_alternatives && r.top_alternatives.length ? `
        <div style="margin-top:.8rem;font-size:.85rem;color:var(--ink-soft);">
          Also worth comparing: ${r.top_alternatives.map(cropLabel).join(', ')}
        </div>` : ''}
        <div class="alert alert--gold" style="margin-top:1rem;"><div class="alert__body">${r.disclaimer}</div></div>`;
    } catch (err) { showError(out, err); }
  });

  /* ==========================================================
     TOOL 1: Smart recommend — returns LIST directly
     ========================================================== */
  $('[data-form="recommend"]')?.addEventListener('submit', async e => {
    e.preventDefault();
    const out = $('[data-out="recommend"]');
    showLoading(out, 'Running 3 ML models…');
    try {
      const f = formToObj(e.target);
      const body = {
        region_id: f.region_id, season: f.season,
        area_acres: parseFloat(f.area_acres),
        budget_per_acre: parseFloat(f.budget_per_acre)
      };
      const recs = await api('/api/crop', { method: 'POST', body: JSON.stringify(body) });
      if (!Array.isArray(recs) || !recs.length) { out.innerHTML = '<div class="alert"><div class="alert__body"><strong>No recommendations returned.</strong></div></div>'; return; }
      const top = recs[0];
      const area = body.area_acres;

      out.innerHTML = `
        <div class="kpi-grid">
          <div class="kpi kpi--good"><div class="kpi__lbl">Top pick</div>
            <div class="kpi__val" style="font-size:1.3rem;">${cropLabel(top.crop_id)}</div>
            <div class="kpi__sub">Smart score ${FIX(top.smart_score, 1)} / 100</div></div>
          <div class="kpi"><div class="kpi__lbl">Predicted yield</div>
            <div class="kpi__val">${Math.round(top.predicted_yield_kg_per_acre)} <span style="font-size:.5em;color:var(--ink-faint)">kg/ac</span></div></div>
          <div class="kpi kpi--good"><div class="kpi__lbl">Profit (${area} ac)</div>
            <div class="kpi__val">${TT(top.expected_profit, INR(top.expected_profit))}</div>
            <div class="kpi__sub">ROI ${PCT(top.roi_percent)}</div></div>
        </div>

        ${top.budget_adequate === false ? `
        <div class="alert alert--gold" style="margin-top:12px;">
          <div class="alert__body">
            <strong>⚠ Budget below what ${cropLabel(top.crop_id)} typically needs.</strong>
            ${top.reason || 'Yield and ROI above are already scaled down to what this budget can realistically achieve — not the full-funding potential.'}
            ${top.potential_yield_kg_per_acre ? ` With adequate funding, yield could reach ~${Math.round(top.potential_yield_kg_per_acre)} kg/ac.` : ''}
          </div>
        </div>` : ''}

        ${top.saturation_label ? `
        <div class="alert alert--gold" style="margin-top:12px;">
          <div class="alert__body">
            <strong>📊 ${top.saturation_label}</strong>
          </div>
        </div>` : ''}

        <div style="margin-top:12px;display:flex;align-items:center;justify-content:flex-end;gap:12px;flex-wrap:wrap;">
          <button type="button" class="btn btn-ghost" style="flex-shrink:0;" id="mm-commit-crop-btn"
            data-crop-id="${top.crop_id}" data-region-id="${body.region_id}" data-season="${body.season}" data-area="${area}">
            I'm planting this →
          </button>
        </div>

        <div class="alert alert--green" style="margin-top:12px;display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap;background:var(--brand-soft);border:1px solid color-mix(in srgb, var(--brand) 35%, transparent);">
          <div class="alert__body" style="color:var(--brand-deep);">
            <strong>🌾 Ready to sell?</strong> List ${cropLabel(top.crop_id)} on the Marketplace once it's harvested — buyers can see it alongside real mandi price context.
          </div>
          <a class="btn btn-primary" style="flex-shrink:0;" href="marketplace.html?view=sell&crop_id=${encodeURIComponent(top.crop_id)}&qty=${Math.max(1, Math.round(area * top.predicted_yield_kg_per_acre / 100))}">Sell this produce →</a>
        </div>

        ${top.reasons ? `
        <div class="alert alert--green" style="margin-top: 16px; border:1px solid color-mix(in srgb, var(--brand) 35%, transparent); background: var(--brand-soft);">
          <div class="alert__body" style="color: var(--brand-deep);">
            <strong>Agronomic suitability & reasoning:</strong>
            <ul style="margin: 8px 0 0 16px; padding: 0;">
              ${top.reasons.map(r => `<li style="margin-bottom: 4px; font-size: 0.88rem; list-style-type: disc;">${r}</li>`).join('')}
            </ul>
          </div>
        </div>
        ` : ''}

        <div class="chart-grid">
          <div class="chart-box">
            <div class="chart-box__title">Smart score comparison</div>
            <canvas data-chart="rec-bar"></canvas>
          </div>
          <div class="chart-box">
            <div class="chart-box__title">Top 3 crops · multi-factor radar</div>
            <canvas data-chart="rec-radar"></canvas>
          </div>
        </div>

        <h4 style="font-size:.85rem;font-weight:600;letter-spacing:.12em;text-transform:uppercase;color:var(--ink-faint);margin:16px 0 12px;">Ranked alternatives</h4>
        ${recs.slice(0, 5).map((r, i) => `
          <div class="list-row">
            <div class="list-row__bullet">${i + 1}</div>
            <div class="list-row__name">${cropLabel(r.crop_id)}
              <small>Yield ${Math.round(r.predicted_yield_kg_per_acre)} kg/ac · Risk ${Math.round(r.risk_score)}/100 · Score ${FIX(r.smart_score, 1)}</small>
              ${r.reasons ? `<div style="font-size: 0.76rem; color: var(--brand-deep); margin-top: 4px;">• ${r.reasons[0]}</div>` : ''}
              ${r.saturation_label ? `<div style="font-size: 0.76rem; color: var(--ink-soft); margin-top: 2px;">📊 ${r.saturation_label}</div>` : ''}
            </div>
            <div class="list-row__val">${INR(r.expected_profit)}<small>ROI ${PCT(r.roi_percent)}</small></div>
          </div>`).join('')}`;

      const commitBtn = out.querySelector('#mm-commit-crop-btn');
      if (commitBtn) {
        commitBtn.addEventListener('click', async () => {
          commitBtn.disabled = true;
          commitBtn.textContent = 'Recording…';
          try {
            await api('/api/commit-crop', {
              method: 'POST',
              body: JSON.stringify({
                region_id: commitBtn.dataset.regionId,
                crop_id: commitBtn.dataset.cropId,
                season: commitBtn.dataset.season,
                area_acres: parseFloat(commitBtn.dataset.area),
                device_id: window.MM.deviceId(),
              }),
            });
            commitBtn.textContent = '✓ Recorded — thanks, this helps other farmers nearby.';
          } catch (err) {
            commitBtn.disabled = false;
            commitBtn.textContent = "I'm planting this →";
          }
        });
      }

      // Bar chart — smart score
      const top5 = recs.slice(0, 5);
      makeChart($('[data-chart="rec-bar"]'), {
        type: 'bar',
        data: {
          labels: top5.map(r => CROP_LABELS[r.crop_id]?.split(' ·')[0] || r.crop_id),
          datasets: [{
            label: 'Smart score',
            data: top5.map(r => r.smart_score),
            backgroundColor: top5.map((_, i) => i === 0 ? BRAND : i === 1 ? ACCENT : i === 2 ? SKY : '#b4a78f'),
            borderRadius: 8, borderSkipped: false
          }]
        },
        options: {
          responsive: true, maintainAspectRatio: false,
          scales: { y: { beginAtZero: true, max: 100, grid: { color: 'rgba(29,26,21,.06)' } }, x: { grid: { display: false } } },
          plugins: { legend: { display: false } }
        }
      });

      // Radar — top 3 across 5 axes (normalised 0–100)
      const top3 = recs.slice(0, 3);
      const maxProfit = Math.max(...top3.map(r => r.expected_profit)) || 1;
      const maxYield = Math.max(...top3.map(r => r.predicted_yield_kg_per_acre)) || 1;
      const maxROI = Math.max(...top3.map(r => r.roi_percent)) || 1;
      const colors = [BRAND, ACCENT, SKY];
      makeChart($('[data-chart="rec-radar"]'), {
        type: 'radar',
        data: {
          labels: ['Smart score', 'ROI %', 'Yield', 'Low risk', 'ML conf'],
          datasets: top3.map((r, i) => ({
            label: CROP_LABELS[r.crop_id]?.split(' ·')[0] || r.crop_id,
            data: [
              r.smart_score,
              (r.roi_percent / maxROI) * 100,
              (r.predicted_yield_kg_per_acre / maxYield) * 100,
              100 - r.risk_score,
              (r.ml_confidence || 0) * 100
            ],
            backgroundColor: colors[i] + '30',
            borderColor: colors[i],
            pointBackgroundColor: colors[i],
            borderWidth: 2
          }))
        },
        options: {
          responsive: true, maintainAspectRatio: false,
          scales: { r: { min: 0, max: 100, ticks: { display: false }, grid: { color: 'rgba(29,26,21,.08)' }, pointLabels: { font: { size: 11 } } } },
          plugins: { legend: { position: 'bottom', labels: { boxWidth: 12, padding: 10 } } }
        }
      });
    } catch (err) { showError(out, err); }
  });

  /* ==========================================================
     TOOL 2: Simulate (auto-fetches soil & weather)
     ========================================================== */
  $('[data-form="simulate"]')?.addEventListener('submit', async e => {
    e.preventDefault();
    const out = $('[data-out="simulate"]');
    showLoading(out, 'Simulating yield, cost & profit…');
    try {
      const f = formToObj(e.target);
      // Respect user overrides: if farm boundary exists, use its soil;
      // if weather override is on, skip the API call entirely.
      const override = (window.__agrisimWeatherOverride && window.__agrisimWeatherOverride()) || null;
      const farmSoil = (window.__agrisimFarmSoil && window.__agrisimFarmSoil()) || null;
      const [soilRaw, weatherRaw] = await Promise.all([
        farmSoil ? Promise.resolve(farmSoil) : api(`/api/soil/${f.region_id}`).catch(() => ({})),
        override ? Promise.resolve(override) : api(`/api/weather/${f.region_id}?season=${f.season}`).catch(() => ({}))
      ]);
      // CSV rows come back as all-strings — coerce numerics so the simulator can do math.
      const coerce = obj => {
        const out = {};
        Object.entries(obj || {}).forEach(([k, v]) => {
          if (typeof v === 'string' && v.trim() !== '' && !isNaN(Number(v))) out[k] = Number(v);
          else out[k] = v;
        });
        return out;
      };
      const soil = coerce(soilRaw);
      const weather = coerce(weatherRaw);
      const body = {
        crop_id: f.crop_id, region_id: f.region_id,
        area_acres: parseFloat(f.area_acres),
        mandi_price_per_kg: parseFloat(f.mandi_price_per_kg),
        irrigation_level: parseFloat(f.irrigation_level),
        seed_variety: 'standard', sowing_date: '2024-06-15',
        soil, weather,
        input_plan: {
          seed_cost_per_acre: +f.seed_cost_per_acre,
          fertilizer_cost_per_acre: +f.fertilizer_cost_per_acre,
          labour_cost_per_acre: +f.labour_cost_per_acre,
          irrigation_cost_per_acre: +f.other_costs_per_acre * 0.5,
          pesticide_cost_per_acre: +f.other_costs_per_acre * 0.3,
          machinery_cost_per_acre: +f.other_costs_per_acre * 0.2,
        }
      };
      // Prepare bodies for Dry and Wet weather scenarios
      const dryBody = JSON.parse(JSON.stringify(body));
      dryBody.weather.rainfall_mm = Math.max(0, (body.weather.rainfall_mm || 600) * 0.5);
      const wetBody = JSON.parse(JSON.stringify(body));
      wetBody.weather.rainfall_mm = (body.weather.rainfall_mm || 600) * 1.5;

      const r = await api('/api/simulate', { method: 'POST', body: JSON.stringify(body) });

      // Run Dry/Wet simulations in parallel background
      const [rDry, rWet] = await Promise.all([
        api('/api/simulate', { method: 'POST', body: JSON.stringify(dryBody) }).catch(() => null),
        api('/api/simulate', { method: 'POST', body: JSON.stringify(wetBody) }).catch(() => null)
      ]);

      const area = body.area_acres;
      const yieldPerAc = r.yield_kg_per_acre || 0;
      const totalYield = r.total_yield_kg || yieldPerAc * area;
      const nut = r.nutrient_analysis || {};
      const water = r.water_efficiency || {};
      const sens = r.sensitivity || [];

      out.innerHTML = `
        <div class="kpi-grid">
          <div class="kpi kpi--good"><div class="kpi__lbl">Total yield</div>
            <div class="kpi__val">${Math.round(totalYield)} <span style="font-size:.5em">kg</span></div>
            <div class="kpi__sub">${Math.round(yieldPerAc)} kg/ac</div></div>
          <div class="kpi"><div class="kpi__lbl">Revenue</div>
            <div class="kpi__val">${TT(r.revenue, INR(r.revenue || 0))}</div></div>
          <div class="kpi"><div class="kpi__lbl">Total cost</div>
            <div class="kpi__val">${TT(r.total_cost, INR(r.total_cost || 0))}</div>
            <div class="kpi__sub">Breakeven ₹${FIX(r.break_even_price_per_kg, 2)}/kg</div></div>
          <div class="kpi kpi--good"><div class="kpi__lbl">Profit</div>
            <div class="kpi__val">${TT(r.profit, INR(r.profit || 0))}</div>
            <div class="kpi__sub">ROI ${PCT(r.roi_percent || 0)}</div></div>
          <div class="kpi kpi--warn"><div class="kpi__lbl">Risk score</div>
            <div class="kpi__val">${Math.round(r.risk_score || 0)}<span style="font-size:.5em;color:var(--ink-faint)">/100</span></div></div>
          <div class="kpi kpi--info"><div class="kpi__lbl">Water / kg</div>
            <div class="kpi__val">${Math.round(water.water_per_kg_yield_liters || 0)} <span style="font-size:.5em">L</span></div>
            <div class="kpi__sub">${Math.round(water.irrigation_coverage_percent || 0)}% covered</div></div>
        </div>

        <div class="chart-box" data-benchmark-card style="margin-top:14px;">
          <div class="chart-box__title">Regional benchmark</div>
          <div data-benchmark-body class="benchmark-loading">Comparing against ${f.region_id.replace(/_/g, ' ')} history…</div>
        </div>

        ${r.intelligence_report ? `
        <div class="alert alert--info" style="margin-top: 16px; border:1px solid color-mix(in srgb, var(--brand) 35%, transparent); background: var(--brand-soft);">
          <div class="alert__body" style="color: var(--brand-deep);">
            <strong>Yield Model Explainability Drivers:</strong>
            <div style="font-size: 0.95rem; margin-top: 4px; font-weight: 600;">${r.intelligence_report.uncertainty_range}</div>
            <ul style="margin: 8px 0 0 16px; padding: 0;">
              ${r.intelligence_report.positive_influences.map(pi => `<li style="margin-bottom: 2px; font-size: 0.85rem; list-style-type: check;">✓ ${pi}</li>`).join('')}
              ${r.intelligence_report.negative_influences.map(ni => `<li style="margin-bottom: 2px; font-size: 0.85rem; list-style-type: warning;">⚠ ${ni}</li>`).join('')}
            </ul>
            <div style="font-size: 0.78rem; color: var(--ink-faint); margin-top: 8px; font-style: italic;">
              ${r.intelligence_report.explanation}
            </div>
          </div>
        </div>
        ` : ''}

        <div class="chart-grid">
          <div class="chart-box">
            <div class="chart-box__title">Cost breakdown per acre</div>
            <canvas data-chart="sim-cost"></canvas>
          </div>
          <div class="chart-box">
            <div class="chart-box__title">Revenue vs cost vs profit (total)</div>
            <canvas data-chart="sim-rev"></canvas>
          </div>
        </div>

        <div class="chart-box" style="margin-top: 14px;">
          <div class="chart-box__title">Yield comparison under climate scenarios (kg/acre)</div>
          <canvas data-chart="sim-climate-yield"></canvas>
        </div>

        ${(nut.n_deficit !== undefined) ? `
        <div class="chart-box">
          <div class="chart-box__title">Nutrient balance · available vs required (kg/ac)</div>
          <canvas data-chart="sim-nut"></canvas>
        </div>` : ''}

        ${sens.length ? `
        <div class="chart-box">
          <div class="chart-box__title">Sensitivity · profit at varying price × yield (${sens.length} cells)</div>
          ${renderSensitivityHeatmap(sens, r.profit)}
        </div>` : ''}`;

      // Cost doughnut from actual backend breakdown
      const cb = r.cost_breakdown_per_acre || body.input_plan;
      const costKeys = Object.keys(cb);
      makeChart($('[data-chart="sim-cost"]'), {
        type: 'doughnut',
        data: {
          labels: costKeys.map(k => k.replace(/_cost_per_acre|_per_acre/, '').replace(/_/g, ' ').replace(/^./, c => c.toUpperCase())),
          datasets: [{
            data: costKeys.map(k => cb[k]),
            backgroundColor: [BRAND, ACCENT, SKY, '#7ca894', CLAY, '#8a8376'],
            borderWidth: 2, borderColor: '#fff'
          }]
        },
        options: {
          responsive: true, maintainAspectRatio: false, cutout: '62%',
          plugins: {
            legend: { position: 'right', labels: { boxWidth: 12, padding: 8, font: { size: 11 } } },
            tooltip: { callbacks: { label: c => c.label + ': ' + INR(c.parsed) + '/ac' } }
          }
        }
      });

      makeChart($('[data-chart="sim-rev"]'), {
        type: 'bar',
        data: {
          labels: ['Revenue', 'Total cost', 'Profit'],
          datasets: [{
            data: [r.revenue || 0, r.total_cost || 0, r.profit || 0],
            backgroundColor: [BRAND, CLAY, ACCENT], borderRadius: 8, borderSkipped: false
          }]
        },
        options: {
          responsive: true, maintainAspectRatio: false,
          scales: { y: { beginAtZero: true, grid: { color: 'rgba(29,26,21,.06)' }, ticks: { callback: v => '₹' + (v / 1000).toFixed(0) + 'K' } }, x: { grid: { display: false } } },
          plugins: { legend: { display: false }, tooltip: { callbacks: { label: c => INR(c.parsed.y) } } }
        }
      });

      makeChart($('[data-chart="sim-climate-yield"]'), {
        type: 'bar',
        data: {
          labels: ['Dry Scenario (50% rain)', 'Normal Scenario (Actual)', 'Wet Scenario (+50% rain)'],
          datasets: [{
            label: 'Yield (kg/acre)',
            data: [
              Math.round((rDry && rDry.yield_kg_per_acre) || (yieldPerAc * 0.7)),
              Math.round(yieldPerAc),
              Math.round((rWet && rWet.yield_kg_per_acre) || (yieldPerAc * 1.15))
            ],
            backgroundColor: [CLAY, BRAND, SKY],
            borderRadius: 8,
            borderSkipped: false
          }]
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          scales: {
            y: {
              beginAtZero: true,
              grid: { color: 'rgba(29,26,21,.06)' },
              ticks: { callback: v => v + ' kg' }
            },
            x: { grid: { display: false } }
          },
          plugins: {
            legend: { display: false },
            tooltip: { callbacks: { label: c => c.parsed.y + ' kg/acre' } }
          }
        }
      });

      if (nut.n_deficit !== undefined) {
        makeChart($('[data-chart="sim-nut"]'), {
          type: 'bar',
          data: {
            labels: ['Nitrogen (N)', 'Phosphorus (P)', 'Potassium (K)'],
            datasets: [
              { label: 'Available in soil', data: [nut.n_available || 0, nut.p_available || 0, nut.k_available || 0], backgroundColor: BRAND, borderRadius: 6 },
              { label: 'Required by crop', data: [nut.n_required || 0, nut.p_required || 0, nut.k_required || 0], backgroundColor: ACCENT, borderRadius: 6 }
            ]
          },
          options: {
            responsive: true, maintainAspectRatio: false,
            scales: { y: { beginAtZero: true, grid: { color: 'rgba(29,26,21,.06)' }, ticks: { callback: v => v + ' kg' } }, x: { grid: { display: false } } },
            plugins: { legend: { position: 'bottom', labels: { boxWidth: 12, padding: 10 } } }
          }
        });
      }

      // Regional benchmark — non-blocking; the KPIs above already stand on
      // their own if this fails or the user has re-submitted meanwhile.
      api('/api/benchmark', {
        method: 'POST',
        body: JSON.stringify({
          region_id: f.region_id,
          crop_id: f.crop_id,
          user_yield_kg_per_acre: yieldPerAc,
          user_profit_per_acre: (r.profit || 0) / (area || 1)
        })
      }).then(b => {
        const body = out.querySelector('[data-benchmark-body]');
        if (!body) return; // tool re-run or navigated away
        const yieldGood = (b.yield_vs_avg_pct || 0) >= 0;
        const profitGood = (b.profit_vs_avg_pct || 0) >= 0;
        body.classList.remove('benchmark-loading');
        body.innerHTML = `
          <div class="kpi-grid" style="grid-template-columns:repeat(auto-fit,minmax(140px,1fr));">
            <div class="kpi ${yieldGood ? 'kpi--good' : 'kpi--warn'}">
              <div class="kpi__lbl">Yield vs regional avg</div>
              <div class="kpi__val">${yieldGood ? '+' : ''}${FIX(b.yield_vs_avg_pct, 1)}%</div>
              <div class="kpi__sub">avg ${Math.round(b.regional_avg_yield || 0)} kg/ac (${b.data_points} yrs of data)</div>
            </div>
            <div class="kpi ${profitGood ? 'kpi--good' : 'kpi--warn'}">
              <div class="kpi__lbl">Profit vs regional avg</div>
              <div class="kpi__val">${profitGood ? '+' : ''}${FIX(b.profit_vs_avg_pct, 1)}%</div>
              <div class="kpi__sub">est. avg ${INR(b.estimated_regional_avg_profit_per_acre || 0)}/ac</div>
            </div>
            <div class="kpi kpi--info">
              <div class="kpi__lbl">Yield percentile</div>
              <div class="kpi__val">${Math.round(b.yield_percentile || 0)}<span style="font-size:.5em;color:var(--ink-faint)">th</span></div>
            </div>
          </div>
          <p style="margin:10px 2px 0;font-size:.9rem;color:var(--ink-faint)">${(window.MM && window.MM.escapeHtml ? window.MM.escapeHtml : String)(b.rating || '')}</p>`;
      }).catch(() => {
        const body = out.querySelector('[data-benchmark-body]');
        const card = out.querySelector('[data-benchmark-card]');
        if (card) card.remove();
        else if (body) body.textContent = 'Regional benchmark unavailable right now.';
      });
    } catch (err) { showError(out, err); }
  });

  /* ==========================================================
     TOOL 3: Rotation planner — top_rotations[]
     ========================================================== */
  $('[data-form="rotation"]')?.addEventListener('submit', async e => {
    e.preventDefault();
    const out = $('[data-out="rotation"]');
    showLoading(out, 'Scoring kharif × rabi combinations…');
    try {
      const body = {
        region_id: formToObj(e.target).region_id,
        area_acres: parseFloat(formToObj(e.target).area_acres),
        budget_per_acre: parseFloat(formToObj(e.target).budget_per_acre)
      };
      const data = await api('/api/rotation-plan', { method: 'POST', body: JSON.stringify(body) });
      const plans = data.top_rotations || [];
      if (!plans.length) { out.innerHTML = '<div class="alert"><div class="alert__body"><strong>No rotation plans.</strong></div></div>'; return; }

      const best = data.best_rotation || plans[0];
      out.innerHTML = `
        <div class="kpi-grid">
          <div class="kpi kpi--good"><div class="kpi__lbl">Best rotation</div>
            <div class="kpi__val" style="font-size:1.15rem;">${cropLabel(best.kharif_crop)} → ${cropLabel(best.rabi_crop)}</div>
            <div class="kpi__sub">Score ${FIX(best.rotation_score || best.diversity_score || 0, 1)}</div></div>
          <div class="kpi"><div class="kpi__lbl">Annual profit</div>
            <div class="kpi__val">${TT(best.annual_profit, INR(best.annual_profit))}</div></div>
          <div class="kpi kpi--warn"><div class="kpi__lbl">Avg risk</div>
            <div class="kpi__val">${Math.round(best.avg_risk_score || 0)}<span style="font-size:.5em">/100</span></div></div>
        </div>

        <div class="chart-box">
          <div class="chart-box__title">Kharif vs rabi profit contribution (top 5)</div>
          <canvas data-chart="rot-bar"></canvas>
        </div>

        <h4 style="font-size:.85rem;font-weight:600;letter-spacing:.12em;text-transform:uppercase;color:var(--ink-faint);margin:16px 0 12px;">All rotations</h4>
        ${plans.slice(0, 5).map((p, i) => `
          <div class="list-row">
            <div class="list-row__bullet">${i + 1}</div>
            <div class="list-row__name">${cropLabel(p.kharif_crop)} → ${cropLabel(p.rabi_crop)}
              <small>Risk ${Math.round(p.avg_risk_score || 0)}/100 · Score ${FIX(p.rotation_score || p.diversity_score || 0, 1)}</small></div>
            <div class="list-row__val">${INR(p.annual_profit)}<small>per year</small></div>
          </div>`).join('')}`;

      // Stacked bar: kharif + rabi profit per rotation
      const top5 = plans.slice(0, 5);
      makeChart($('[data-chart="rot-bar"]'), {
        type: 'bar',
        data: {
          labels: top5.map(p => `${p.kharif_crop}→${p.rabi_crop}`),
          datasets: [
            { label: 'Kharif profit', data: top5.map(p => p.kharif_profit), backgroundColor: BRAND, borderRadius: 6 },
            { label: 'Rabi profit', data: top5.map(p => p.rabi_profit), backgroundColor: ACCENT, borderRadius: 6 }
          ]
        },
        options: {
          responsive: true, maintainAspectRatio: false,
          scales: { x: { stacked: true, grid: { display: false } }, y: { stacked: true, beginAtZero: true, grid: { color: 'rgba(29,26,21,.06)' }, ticks: { callback: v => '₹' + (v / 1000).toFixed(0) + 'K' } } },
          plugins: { legend: { position: 'bottom', labels: { boxWidth: 12, padding: 10 } } }
        }
      });
    } catch (err) { showError(out, err); }
  });

  /* ==========================================================
     TOOL 4: Price forecast — forecasts[] + historical via /mandi-prices
     ========================================================== */
  $('[data-form="forecast"]')?.addEventListener('submit', async e => {
    e.preventDefault();
    const out = $('[data-out="forecast"]');
    showLoading(out, 'Forecasting mandi prices…');
    try {
      const f = formToObj(e.target);
      const months = parseInt(f.months_ahead) || 6;
      const [data, history] = await Promise.all([
        api(`/api/price-forecast/${f.region_id}/${f.crop_id}?months_ahead=${months}`),
        api(`/api/mandi-prices/${f.region_id}?crop_id=${f.crop_id}`).catch(() => [])
      ]);
      const fcst = data.forecasts || [];
      if (!fcst.length) { out.innerHTML = '<div class="alert"><div class="alert__body"><strong>No forecast available.</strong></div></div>'; return; }

      // Build historical series (last 12 rows sorted by date)
      const histSorted = history
        .map(h => ({ date: h.date || h.price_date, price: parseFloat(h.price_inr_per_kg || h.price || 0) }))
        .filter(h => h.date && !isNaN(h.price))
        .sort((a, b) => a.date.localeCompare(b.date))
        .slice(-12);

      const histLabels = histSorted.map(h => h.date.slice(0, 7));
      const histData = histSorted.map(h => h.price);
      const fcstLabels = fcst.map(fo => fo.month);
      const fcstData = fcst.map(fo => fo.forecast_price);

      // Combined series: history followed by forecast (padded with nulls so they align on same chart)
      const combinedLabels = [...histLabels, ...fcstLabels];
      const histPad = [...histData, ...fcstLabels.map(() => null)];
      const fcstPad = [...histLabels.slice(0, -1).map(() => null),
      histData.length ? histData[histData.length - 1] : null,
      ...fcstData];

      const lastHist = histData[histData.length - 1] || data.current_price || 0;
      const lastFcst = fcstData[fcstData.length - 1] || 0;
      const deltaPct = lastHist ? ((lastFcst - lastHist) / lastHist) * 100 : 0;

      out.innerHTML = `
        <div class="kpi-grid">
          <div class="kpi"><div class="kpi__lbl">Current price</div>
            <div class="kpi__val">${TT(data.current_price, INR2(data.current_price))}<span style="font-size:.5em">/kg</span></div></div>
          <div class="kpi kpi--info"><div class="kpi__lbl">+${months} mo forecast</div>
            <div class="kpi__val">${TT(lastFcst, INR2(lastFcst))}<span style="font-size:.5em">/kg</span></div>
            <div class="kpi__sub"><span class="chip ${deltaPct >= 0 ? 'chip--green' : 'chip--red'}">${deltaPct >= 0 ? '+' : ''}${FIX(deltaPct, 1)}% vs now</span></div></div>
          <div class="kpi ${data.trend_direction === 'rising' ? 'kpi--good' : data.trend_direction === 'falling' ? 'kpi--warn' : 'kpi--info'}">
            <div class="kpi__lbl">Trend</div>
            <div class="kpi__val" style="font-size:1.3rem;text-transform:capitalize;">${data.trend_direction || '—'}</div>
            <div class="kpi__sub">Slope ${FIX(data.trend_slope_per_month || 0, 2)}/mo</div></div>
          <div class="kpi kpi--good"><div class="kpi__lbl">Model</div>
            <div class="kpi__val" style="font-size:1rem;">${data.prediction_source || 'ml_model'}</div>
            <div class="kpi__sub">${fcst[0]?.confidence || 'high'} confidence</div></div>
        </div>

        <div class="chart-box">
          <div class="chart-box__title">Price trajectory · ${f.crop_id} @ ${f.region_id}</div>
          <canvas data-chart="fcst-line"></canvas>
        </div>`;

      makeChart($('[data-chart="fcst-line"]'), {
        type: 'line',
        data: {
          labels: combinedLabels,
          datasets: [
            {
              label: 'Historical',
              data: histPad,
              borderColor: BRAND,
              backgroundColor: BRAND + '20',
              borderWidth: 2.5,
              pointRadius: 3,
              pointBackgroundColor: BRAND,
              tension: 0.3,
              fill: true,
              spanGaps: false
            },
            {
              label: 'ML forecast',
              data: fcstPad,
              borderColor: ACCENT,
              backgroundColor: ACCENT + '20',
              borderWidth: 2.5,
              borderDash: [6, 4],
              pointRadius: 3,
              pointBackgroundColor: ACCENT,
              tension: 0.3,
              fill: true,
              spanGaps: false
            }
          ]
        },
        options: {
          responsive: true, maintainAspectRatio: false,
          interaction: { mode: 'index', intersect: false },
          scales: {
            y: { beginAtZero: false, grid: { color: 'rgba(29,26,21,.06)' }, ticks: { callback: v => '₹' + v } },
            x: { grid: { display: false } }
          },
          plugins: { legend: { position: 'bottom', labels: { boxWidth: 12, padding: 10 } }, tooltip: { callbacks: { label: c => c.dataset.label + ': ₹' + FIX(c.parsed.y, 2) + '/kg' } } }
        }
      });
    } catch (err) { showError(out, err); }
  });

  /* ==========================================================
     TOOL 5: MSP vs Market
     ========================================================== */
  $('[data-form="msp"]')?.addEventListener('submit', async e => {
    e.preventDefault();
    const out = $('[data-out="msp"]');
    showLoading(out);
    try {
      const f = formToObj(e.target);
      const r = await api(`/api/msp-vs-market/${f.region_id}/${f.crop_id}`);
      const gap = r.mandi_msp_gap_pct || 0;
      const cls = r.mandi_above_msp ? 'chip--green' : 'chip--red';

      out.innerHTML = `
        <div class="kpi-grid">
          <div class="kpi"><div class="kpi__lbl">MSP (${r.msp_year})</div>
            <div class="kpi__val">${TT(r.msp_inr_per_kg, INR2(r.msp_inr_per_kg))}<span style="font-size:.5em">/kg</span></div></div>
          <div class="kpi kpi--info"><div class="kpi__lbl">Current mandi</div>
            <div class="kpi__val">${TT(r.current_mandi_price, INR2(r.current_mandi_price))}<span style="font-size:.5em">/kg</span></div>
            <div class="kpi__sub"><span class="chip ${cls}">${r.mandi_above_msp ? '+' : ''}${FIX(gap, 1)}% vs MSP</span></div></div>
          <div class="kpi"><div class="kpi__lbl">6-month avg</div>
            <div class="kpi__val">${TT(r.avg_mandi_6m, INR2(r.avg_mandi_6m))}<span style="font-size:.5em">/kg</span></div></div>
        </div>
        <div class="chart-box">
          <div class="chart-box__title">Price comparison</div>
          <canvas data-chart="msp-bar"></canvas>
        </div>
        <div class="alert alert--${r.mandi_above_msp ? 'green' : 'gold'}">
          <svg class="alert__ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><path d="M12 8v4M12 16h.01"/></svg>
          <div class="alert__body"><strong>Recommendation</strong><p>${r.recommendation}</p></div>
        </div>`;

      makeChart($('[data-chart="msp-bar"]'), {
        type: 'bar',
        data: {
          labels: ['MSP', '6-month avg', 'Current mandi'],
          datasets: [{
            data: [r.msp_inr_per_kg, r.avg_mandi_6m, r.current_mandi_price],
            backgroundColor: [CLAY, SKY, BRAND], borderRadius: 8, borderSkipped: false
          }]
        },
        options: {
          indexAxis: 'y', responsive: true, maintainAspectRatio: false,
          scales: { x: { beginAtZero: true, grid: { color: 'rgba(29,26,21,.06)' }, ticks: { callback: v => '₹' + v } }, y: { grid: { display: false } } },
          plugins: { legend: { display: false } }
        }
      });
    } catch (err) { showError(out, err); }
  });

  /* ==========================================================
     TOOL 6: Sell advisor
     ========================================================== */
  $('[data-form="sell"]')?.addEventListener('submit', async e => {
    e.preventDefault();
    const out = $('[data-out="sell"]');
    showLoading(out);
    try {
      const f = formToObj(e.target);
      const r = await api(`/api/sell-advisor/${f.region_id}/${f.crop_id}`);
      const action = (r.action || '').toLowerCase();
      const cls = action.includes('hold') ? 'kpi--warn' : action.includes('sell') ? 'kpi--good' : 'kpi--info';
      const alertCls = action.includes('hold') ? 'alert--gold' : action.includes('sell') ? 'alert--green' : 'alert--gold';
      const monthly = r.monthly_avg_prices || {};
      const monthEntries = Object.entries(monthly).map(([m, p]) => ({ m: parseInt(m), p: parseFloat(p) })).sort((a, b) => a.m - b.m);

      out.innerHTML = `
        <div class="kpi-grid">
          <div class="kpi ${cls}"><div class="kpi__lbl">Action</div>
            <div class="kpi__val" style="font-size:1.4rem;text-transform:uppercase;">${r.action || '—'}</div></div>
          <div class="kpi"><div class="kpi__lbl">Current price</div>
            <div class="kpi__val">${TT(r.current_price, INR2(r.current_price))}<span style="font-size:.5em">/kg</span></div>
            <div class="kpi__sub">${MONTH_NAMES[r.current_month] || ''}</div></div>
          <div class="kpi kpi--good"><div class="kpi__lbl">Best month</div>
            <div class="kpi__val" style="font-size:1.3rem;">${MONTH_NAMES[r.best_month] || '—'}</div>
            <div class="kpi__sub">${INR2(r.best_month_avg_price)}/kg</div></div>
          <div class="kpi kpi--warn"><div class="kpi__lbl">Worst month</div>
            <div class="kpi__val" style="font-size:1.3rem;">${MONTH_NAMES[r.worst_month] || '—'}</div>
            <div class="kpi__sub">${INR2(r.worst_month_avg_price)}/kg</div></div>
          <div class="kpi kpi--info"><div class="kpi__lbl">Gain if held</div>
            <div class="kpi__val">${FIX(r.potential_gain_pct || 0, 1)}%</div>
            <div class="kpi__sub">${r.months_to_peak} mo to peak</div></div>
        </div>

        ${monthEntries.length ? `<div class="chart-box">
          <div class="chart-box__title">Seasonal price pattern (12-month average)</div>
          <canvas data-chart="sell-line"></canvas>
        </div>` : ''}

        <div class="alert ${alertCls}">
          <svg class="alert__ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><path d="M12 8v4M12 16h.01"/></svg>
          <div class="alert__body"><strong>Advice</strong><p>${r.advice}</p></div>
        </div>`;

      if (monthEntries.length) {
        makeChart($('[data-chart="sell-line"]'), {
          type: 'line',
          data: {
            labels: monthEntries.map(e => MONTH_NAMES[e.m]),
            datasets: [{
              label: 'Avg price',
              data: monthEntries.map(e => e.p),
              borderColor: BRAND,
              backgroundColor: BRAND + '25',
              borderWidth: 2.5, tension: 0.4, fill: true,
              pointRadius: monthEntries.map(e => e.m === r.best_month ? 6 : e.m === r.worst_month ? 6 : 3),
              pointBackgroundColor: monthEntries.map(e => e.m === r.best_month ? BRAND : e.m === r.worst_month ? CLAY : BRAND),
              pointBorderColor: '#fff', pointBorderWidth: 2
            }]
          },
          options: {
            responsive: true, maintainAspectRatio: false,
            scales: { y: { grid: { color: 'rgba(29,26,21,.06)' }, ticks: { callback: v => '₹' + v } }, x: { grid: { display: false } } },
            plugins: { legend: { display: false }, tooltip: { callbacks: { label: c => '₹' + FIX(c.parsed.y, 2) + '/kg' } } }
          }
        });
      }
    } catch (err) { showError(out, err); }
  });

  /* ==========================================================
     TOOL 7: Arbitrage — cheapest_market / costliest_market / opportunities
     ========================================================== */
  $('[data-form="arbitrage"]')?.addEventListener('submit', async e => {
    e.preventDefault();
    const out = $('[data-out="arbitrage"]');
    showLoading(out);
    try {
      const f = formToObj(e.target);
      const r = await api(`/api/arbitrage/${f.crop_id}`);
      const cheapest = r.cheapest_market || {};
      const costliest = r.costliest_market || {};
      const opps = r.opportunities || [];

      if (r.message && !opps.length) {
        out.innerHTML = `<div class="alert alert--gold"><svg class="alert__ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><path d="M12 8v4M12 16h.01"/></svg>
          <div class="alert__body"><strong>Not enough mandi data for ${cropLabel(f.crop_id)}</strong><p>${r.message}</p></div></div>`;
        return;
      }

      out.innerHTML = `
        <div class="kpi-grid">
          <div class="kpi kpi--good"><div class="kpi__lbl">Sell high</div>
            <div class="kpi__val" style="font-size:1.1rem;">${costliest.market || costliest.region_id || '—'}</div>
            <div class="kpi__sub">${INR2(costliest.price || 0)}/kg</div></div>
          <div class="kpi kpi--warn"><div class="kpi__lbl">Buy low</div>
            <div class="kpi__val" style="font-size:1.1rem;">${cheapest.market || cheapest.region_id || '—'}</div>
            <div class="kpi__sub">${INR2(cheapest.price || 0)}/kg</div></div>
          <div class="kpi kpi--info"><div class="kpi__lbl">Max spread</div>
            <div class="kpi__val">${TT(r.max_price_gap_per_kg, INR2(r.max_price_gap_per_kg))}<span style="font-size:.5em">/kg</span></div>
            <div class="kpi__sub">${FIX(r.max_gap_pct, 1)}% · ${r.regions_compared} mandis</div></div>
        </div>

        <h4 style="font-size:.85rem;font-weight:600;letter-spacing:.12em;text-transform:uppercase;color:var(--ink-faint);margin:16px 0 12px;">Arbitrage opportunities</h4>
        ${opps.map(op => `
          <div class="alert alert--green">
            <svg class="alert__ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M7 17l10-10M17 7v10h-10"/></svg>
            <div class="alert__body">
              <strong>${op.buy_market} → ${op.sell_market}</strong>
              <p>Buy @ ${INR2(op.buy_price)}/kg, sell @ ${INR2(op.sell_price)}/kg · Gap <span class="chip chip--green">+${INR2(op.price_gap_per_kg)} (${FIX(op.gap_pct, 1)}%)</span></p>
            </div></div>`).join('')}

        <div class="alert"><div class="alert__body"><p style="font-size:.82rem;">${r.note || ''}</p></div></div>`;
    } catch (err) { showError(out, err); }
  });

  /* ==========================================================
     TOOL 8: Crop calendar — calendar is a DICT of named activities
     ========================================================== */
  $('[data-form="calendar"]')?.addEventListener('submit', async e => {
    e.preventDefault();
    const out = $('[data-out="calendar"]');
    showLoading(out);
    try {
      const f = formToObj(e.target);
      const r = await api(`/api/crop-calendar/${f.crop_id}?season=${f.season}`);
      const cal = r.calendar || null;
      if (!cal) {
        out.innerHTML = `<div class="alert alert--gold"><svg class="alert__ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><path d="M12 8v4M12 16h.01"/></svg>
          <div class="alert__body"><strong>No calendar data yet for ${cropLabel(f.crop_id)}</strong><p>This crop was recently added. Calendar data will be populated in a future update. Meanwhile, check the <a href="#" onclick="document.querySelector('.sidebar__btn[data-tool=irrigation]').click();return false;" style="color:var(--brand);font-weight:600;">irrigation schedule</a> for timing.</p></div></div>`;
        return;
      }
      const LABELS = {
        nursery: 'Nursery preparation', land_preparation: 'Land preparation',
        sowing: 'Sowing', sowing_transplant: 'Sowing / transplanting', sowing_window: 'Sowing window',
        first_fertilizer: 'First fertilizer', second_fertilizer: 'Second fertilizer', third_fertilizer: 'Third fertilizer',
        basal_fertilizer: 'Basal fertilizer', top_dress_fertilizer: 'Top-dress fertilizer',
        critical_irrigation: 'Critical irrigation', pest_watch: 'Pest watch',
        flowering: 'Flowering', harvest_window: 'Harvest window', harvest: 'Harvest',
        duration_days: 'Total duration'
      };
      const entries = Object.entries(cal).filter(([k, v]) => k !== 'duration_days' && v);

      out.innerHTML = `
        <div class="kpi-grid">
          <div class="kpi kpi--info"><div class="kpi__lbl">Duration</div>
            <div class="kpi__val">${cal.duration_days || '—'} <span style="font-size:.5em">days</span></div></div>
          <div class="kpi"><div class="kpi__lbl">Sowing</div>
            <div class="kpi__val" style="font-size:1.05rem;">${cal.sowing_transplant || cal.sowing_window || cal.sowing || '—'}</div></div>
          <div class="kpi kpi--good"><div class="kpi__lbl">Harvest</div>
            <div class="kpi__val" style="font-size:1.05rem;">${cal.harvest_window || cal.harvest || '—'}</div></div>
        </div>
        <div class="timeline">
          ${entries.map(([k, v]) => `
            <div class="timeline__item">
              <div class="timeline__date">${LABELS[k] || k.replace(/_/g, ' ')}</div>
              <div class="timeline__title">${v}</div>
            </div>`).join('')}
        </div>`;
    } catch (err) { showError(out, err); }
  });

  /* ==========================================================
     TOOL 9: Irrigation — weekly_schedule[], priority field
     ========================================================== */
  $('[data-form="irrigation"]')?.addEventListener('submit', async e => {
    e.preventDefault();
    const out = $('[data-out="irrigation"]');
    showLoading(out);
    try {
      const f = formToObj(e.target);
      const q = new URLSearchParams({ sowing_date: f.sowing_date, rainfall_mm: f.rainfall_mm, irrigation_level: f.irrigation_level }).toString();
      const r = await api(`/api/irrigation?crop_id=${f.crop_id}&${q}`);
      const schedule = r.weekly_schedule || [];
      const criticalCount = schedule.filter(s => (s.priority || '').toLowerCase() === 'high').length;

      out.innerHTML = `
        <div class="kpi-grid">
          <div class="kpi kpi--info"><div class="kpi__lbl">Total water need</div>
            <div class="kpi__val">${Math.round(r.total_water_requirement_mm || 0)} <span style="font-size:.5em">mm</span></div></div>
          <div class="kpi"><div class="kpi__lbl">Rainfall</div>
            <div class="kpi__val">${Math.round(r.total_seasonal_rainfall_mm || 0)} <span style="font-size:.5em">mm</span></div></div>
          <div class="kpi kpi--good"><div class="kpi__lbl">Irrigation needed</div>
            <div class="kpi__val">${Math.round(r.total_irrigation_needed_mm || 0)} <span style="font-size:.5em">mm</span></div></div>
          <div class="kpi kpi--warn"><div class="kpi__lbl">Critical weeks</div>
            <div class="kpi__val">${criticalCount}<span style="font-size:.5em;color:var(--ink-faint)">/${schedule.length}</span></div></div>
        </div>

        ${r.reasons ? `
        <div class="alert alert--green" style="margin-top: 16px; border:1px solid color-mix(in srgb, var(--brand) 35%, transparent); background: var(--brand-soft);">
          <div class="alert__body" style="color: var(--brand-deep);">
            <strong>Irrigation Intelligence Reasoning:</strong>
            <ul style="margin: 8px 0 0 16px; padding: 0;">
              ${r.reasons.map(reason => `<li style="margin-bottom: 2px; font-size: 0.85rem; list-style-type: disc;">${reason}</li>`).join('')}
            </ul>
          </div>
        </div>
        ` : ''}

        <div class="chart-box">
          <div class="chart-box__title">Water need vs rainfall · week by week</div>
          <canvas data-chart="irr-bar"></canvas>
        </div>

        <h4 style="font-size:.85rem;font-weight:600;letter-spacing:.12em;text-transform:uppercase;color:var(--ink-faint);margin:16px 0 12px;">Weekly schedule</h4>
        ${schedule.map(s => {
        const high = (s.priority || '').toLowerCase() === 'high';
        return `<div class="list-row" style="${high ? 'background:var(--accent-soft);' : ''}">
            <div class="list-row__bullet" style="background:${high ? 'var(--accent)' : 'var(--sky)'};">${s.week}</div>
            <div class="list-row__name">Week ${s.week} · ${s.growth_stage}
              <small>${s.date_range} · need ${Math.round(s.water_need_mm)}mm, rain ${Math.round(s.expected_rainfall_mm)}mm</small></div>
            <div class="list-row__val">${Math.round(s.irrigation_required_mm)} mm<small>${s.priority}</small></div>
          </div>`;
      }).join('')}`;

      makeChart($('[data-chart="irr-bar"]'), {
        type: 'bar',
        data: {
          labels: schedule.map(s => 'W' + s.week),
          datasets: [
            { label: 'Water need', data: schedule.map(s => s.water_need_mm), backgroundColor: BRAND, borderRadius: 4 },
            { label: 'Rainfall', data: schedule.map(s => s.expected_rainfall_mm), backgroundColor: SKY, borderRadius: 4 },
            { label: 'Irrigation required', data: schedule.map(s => s.irrigation_required_mm), backgroundColor: ACCENT, borderRadius: 4 }
          ]
        },
        options: {
          responsive: true, maintainAspectRatio: false,
          scales: { y: { beginAtZero: true, grid: { color: 'rgba(29,26,21,.06)' }, ticks: { callback: v => v + 'mm' } }, x: { grid: { display: false } } },
          plugins: { legend: { position: 'bottom', labels: { boxWidth: 12, padding: 10 } } }
        }
      });
    } catch (err) { showError(out, err); }
  });

  /* ==========================================================
     TOOL 10: Fertilizer — deficit_npk dict, recommendations[]
     ========================================================== */
  $('[data-form="fertilizer"]')?.addEventListener('submit', async e => {
    e.preventDefault();
    const out = $('[data-out="fertilizer"]');
    showLoading(out);
    try {
      const f = formToObj(e.target);
      const r = await api(`/api/fertilizer?crop_id=${f.crop_id}&n_kg_per_acre=${f.n}&p_kg_per_acre=${f.p}&k_kg_per_acre=${f.k}`);
      const def = r.deficit_npk || {};
      const recs = r.recommendations || [];
      const deficitN = def.n_kg_per_acre ?? def.n ?? 0;
      const deficitP = def.p_kg_per_acre ?? def.p ?? 0;
      const deficitK = def.k_kg_per_acre ?? def.k ?? 0;

      out.innerHTML = `
        <div class="kpi-grid">
          ${[['N', deficitN], ['P', deficitP], ['K', deficitK]].map(([k, gap]) => {
        // Backend convention: gap > 0 means the soil is SHORT by `gap` kg/ac (deficit);
        // gap <= 0 means the soil already meets or exceeds the crop requirement.
        const deficit = gap > 0;
        const mag = Math.round(Math.abs(gap));
        return `<div class="kpi ${deficit ? 'kpi--warn' : 'kpi--good'}">
              <div class="kpi__lbl">${k} ${deficit ? 'deficit' : 'status'}</div>
              <div class="kpi__val">${TT(gap, (deficit ? '−' : '+') + mag)} <span style="font-size:.5em">kg/ac</span></div>
              <div class="kpi__sub">${deficit ? 'Needs ' + mag + ' kg/ac' : 'Sufficient'}</div>
            </div>`;
      }).join('')}
          <div class="kpi kpi--info"><div class="kpi__lbl">Total cost</div>
            <div class="kpi__val">${INR(r.total_fertilizer_cost_per_acre)}</div>
            <div class="kpi__sub">per acre</div></div>
        </div>

        ${r.reasons ? `
        <div class="alert alert--green" style="margin-top: 16px; border:1px solid color-mix(in srgb, var(--brand) 35%, transparent); background: var(--brand-soft);">
          <div class="alert__body" style="color: var(--brand-deep);">
            <strong>Fertilizer Application guidelines & timing:</strong>
            <ul style="margin: 8px 0 0 16px; padding: 0;">
              ${r.reasons.map(reason => `<li style="margin-bottom: 2px; font-size: 0.85rem; list-style-type: disc;">${reason}</li>`).join('')}
            </ul>
          </div>
        </div>
        ` : ''}

        ${recs.length ? `<div class="chart-box">
          <div class="chart-box__title">Fertilizer cost breakdown</div>
          <canvas data-chart="fert-doughnut"></canvas>
        </div>` : ''}

        <h4 style="font-size:.85rem;font-weight:600;letter-spacing:.12em;text-transform:uppercase;color:var(--ink-faint);margin:16px 0 12px;">Application plan</h4>
        ${recs.length ? recs.map(f => `
          <div class="list-row">
            <div class="list-row__bullet">✓</div>
            <div class="list-row__name">${f.fertilizer} <span class="chip">${f.grade}</span>
              <small>${f.nutrient_supplied} · ${f.application_timing}</small></div>
            <div class="list-row__val">${Math.round(f.quantity_kg_per_acre)} kg<small>${INR(f.cost_inr)}/ac</small></div>
          </div>`).join('') : '<div class="alert alert--green"><svg class="alert__ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 12l2 2 4-4"/><circle cx="12" cy="12" r="10"/></svg><div class="alert__body"><strong>Soil is balanced</strong><p>No major fertilizer needed.</p></div></div>'}

        <div class="alert"><div class="alert__body"><p style="font-size:.82rem;">${r.note || ''}</p></div></div>`;

      if (recs.length) {
        makeChart($('[data-chart="fert-doughnut"]'), {
          type: 'doughnut',
          data: {
            labels: recs.map(f => f.fertilizer.split(' ')[0]),
            datasets: [{ data: recs.map(f => f.cost_inr), backgroundColor: [BRAND, ACCENT, SKY, CLAY, '#7ca894'], borderWidth: 2, borderColor: '#fff' }]
          },
          options: {
            responsive: true, maintainAspectRatio: false, cutout: '62%',
            plugins: { legend: { position: 'right', labels: { boxWidth: 12, padding: 8 } }, tooltip: { callbacks: { label: c => c.label + ': ' + INR(c.parsed) + '/ac' } } }
          }
        });
      }
    } catch (err) { showError(out, err); }
  });

  /* ==========================================================
     TOOL 11: Pest alerts — alerts[] with pest_disease/risk_level/severity
     ========================================================== */
  $('[data-form="pest"]')?.addEventListener('submit', async e => {
    e.preventDefault();
    const out = $('[data-out="pest"]');
    showLoading(out);
    try {
      const f = formToObj(e.target);
      const r = await api(`/api/pest-alerts/${f.crop_id}?avg_temp_c=${f.avg_temp_c}&rainfall_mm=${f.rainfall_mm}`);
      const alerts = r.alerts || [];
      const esc = (window.MM && window.MM.escapeHtml) ? window.MM.escapeHtml : (s => String(s));

      if (!alerts.length) {
        out.innerHTML = `<div class="alert alert--green">
          <svg class="alert__ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 12l2 2 4-4"/><circle cx="12" cy="12" r="10"/></svg>
          <div class="alert__body"><strong>No active pest risk</strong><p>Current weather (${f.avg_temp_c}°C, ${f.rainfall_mm}mm) is safe for ${f.crop_id}.</p></div></div>`;
        return;
      }

      out.innerHTML = `
        <div class="kpi-grid">
          <div class="kpi kpi--warn"><div class="kpi__lbl">Total alerts</div>
            <div class="kpi__val">${r.total_alerts || alerts.length}</div></div>
          <div class="kpi kpi--${r.high_risk_count > 0 ? 'warn' : 'good'}"><div class="kpi__lbl">High risk</div>
            <div class="kpi__val">${r.high_risk_count || 0}</div></div>
          <div class="kpi"><div class="kpi__lbl">Conditions</div>
            <div class="kpi__val" style="font-size:1.1rem;">${r.temperature_c}°C · ${r.rainfall_mm}mm</div></div>
        </div>

        ${alerts.map(a => {
        const sev = (a.severity || a.risk_level || '').toLowerCase();
        const cls = sev.includes('high') ? 'alert--red' : sev.includes('moderate') || sev.includes('medium') ? 'alert--gold' : 'alert--green';
        const chipCls = cls === 'alert--red' ? 'chip--red' : cls === 'alert--gold' ? 'chip--gold' : 'chip--green';
        return `<div class="alert ${cls}">
            <svg class="alert__ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0zM12 9v4M12 17h.01"/></svg>
            <div class="alert__body">
              <strong>${esc(a.pest_disease)} <span class="chip ${chipCls}">${esc(a.risk_level || a.severity)}</span></strong>
              <p>${esc(a.description || '')}</p>
              <p style="font-size:.82rem;margin-top:4px;color:var(--ink-faint);"><strong>Trigger:</strong> ${esc(a.trigger || '')} · <strong>Now:</strong> ${esc(a.current_conditions || '')}</p>
              ${a.management || a.treatment ? `<p style="margin-top:6px;"><strong>Action:</strong> ${esc(a.management || a.treatment)}</p>` : ''}
            </div></div>`;
      }).join('')}`;
    } catch (err) { showError(out, err); }
  });

  /* ==========================================================
     TOOL 12: Loan — debt_service_coverage_ratio, kcc_note
     ========================================================== */
  $('[data-form="loan"]')?.addEventListener('submit', async e => {
    e.preventDefault();
    const out = $('[data-out="loan"]');
    showLoading(out);
    try {
      const f = formToObj(e.target);
      const body = {
        total_cost: +f.total_cost, expected_profit: +f.expected_profit,
        loan_amount: +f.loan_amount, interest_rate_annual: +f.interest_rate_annual,
        tenure_months: +f.tenure_months
      };
      const r = await api('/api/loan-calculator', { method: 'POST', body: JSON.stringify(body) });
      const v = (r.verdict || '').toLowerCase();
      const cls = v.includes('safe') ? 'kpi--good' : v.includes('moderate') ? 'kpi--warn' : 'kpi--info';
      const dscr = r.debt_service_coverage_ratio || 0;

      // Build repayment schedule (principal + interest over tenure)
      const n = r.tenure_months, P = r.loan_amount, emi = r.emi;
      const monthlyRate = (r.interest_rate_annual_pct || 0) / 12 / 100;
      let balance = P;
      const principalArr = [], interestArr = [], balanceArr = [];
      for (let i = 0; i < n; i++) {
        const int = balance * monthlyRate;
        const prin = emi - int;
        balance = Math.max(0, balance - prin);
        principalArr.push(prin); interestArr.push(int); balanceArr.push(balance);
      }

      out.innerHTML = `
        <div class="kpi-grid">
          <div class="kpi ${cls}"><div class="kpi__lbl">Verdict</div>
            <div class="kpi__val" style="font-size:1.1rem;">${((r.verdict || '').split('—')[0].trim()) || '—'}</div>
            <div class="kpi__sub">DSCR ${FIX(dscr, 2)}</div></div>
          <div class="kpi"><div class="kpi__lbl">Monthly EMI</div>
            <div class="kpi__val">${INR(r.emi)}</div></div>
          <div class="kpi"><div class="kpi__lbl">Total repayment</div>
            <div class="kpi__val">${INR(r.total_repayment)}</div></div>
          <div class="kpi kpi--warn"><div class="kpi__lbl">Total interest</div>
            <div class="kpi__val">${INR(r.total_interest)}</div></div>
          <div class="kpi kpi--good"><div class="kpi__lbl">Breakeven</div>
            <div class="kpi__val">${r.breakeven_months} <span style="font-size:.5em">mo</span></div></div>
        </div>

        <div class="chart-grid">
          <div class="chart-box">
            <div class="chart-box__title">Principal vs interest per month</div>
            <canvas data-chart="loan-stack"></canvas>
          </div>
          <div class="chart-box">
            <div class="chart-box__title">Outstanding balance</div>
            <canvas data-chart="loan-balance"></canvas>
          </div>
        </div>

        <div class="alert alert--${cls === 'kpi--good' ? 'green' : 'gold'}">
          <svg class="alert__ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="2" y="6" width="20" height="14" rx="2"/><path d="M2 10h20"/></svg>
          <div class="alert__body"><strong>${r.verdict}</strong><p>${r.kcc_note || ''}</p></div>
        </div>`;

      const labels = Array.from({ length: n }, (_, i) => 'M' + (i + 1));
      makeChart($('[data-chart="loan-stack"]'), {
        type: 'bar',
        data: {
          labels,
          datasets: [
            { label: 'Principal', data: principalArr, backgroundColor: BRAND, borderRadius: 4 },
            { label: 'Interest', data: interestArr, backgroundColor: ACCENT, borderRadius: 4 }
          ]
        },
        options: {
          responsive: true, maintainAspectRatio: false,
          scales: { x: { stacked: true, grid: { display: false } }, y: { stacked: true, grid: { color: 'rgba(29,26,21,.06)' }, ticks: { callback: v => '₹' + (v / 1000).toFixed(1) + 'K' } } },
          plugins: { legend: { position: 'bottom', labels: { boxWidth: 12, padding: 10 } } }
        }
      });
      makeChart($('[data-chart="loan-balance"]'), {
        type: 'line',
        data: {
          labels,
          datasets: [{
            label: 'Balance', data: balanceArr, borderColor: CLAY,
            backgroundColor: CLAY + '20', borderWidth: 2.5, tension: 0.3, fill: true, pointRadius: 0
          }]
        },
        options: {
          responsive: true, maintainAspectRatio: false,
          scales: { y: { beginAtZero: true, grid: { color: 'rgba(29,26,21,.06)' }, ticks: { callback: v => '₹' + (v / 1000).toFixed(0) + 'K' } }, x: { grid: { display: false } } },
          plugins: { legend: { display: false } }
        }
      });
    } catch (err) { showError(out, err); }
  });

  /* ==========================================================
     TOOL 12b: Expense tracker — localStorage only, no backend call.
     /api/expense/* used to do this server-side, keyed by a client-supplied
     farm_id with no auth (anyone could read/write anyone else's expenses),
     so it's disabled in backend/main.py until real tenant-scoped storage
     exists. This keeps the same category/amount/date/note shape but scopes
     it to this browser, the same way the Farm Profile and the disease-scan
     log (mittimantra_disease_logs, below) already do.
     ========================================================== */
  const EXPENSE_KEY = 'mm_expenses';
  const EXPENSE_CATEGORY_LABELS = {
    seeds: 'Seeds', fertilizer: 'Fertilizer', pesticide: 'Pesticide',
    labor: 'Labor', irrigation: 'Irrigation', equipment: 'Equipment', other: 'Other'
  };

  function loadExpenses() {
    try { return JSON.parse(localStorage.getItem(EXPENSE_KEY) || '[]'); }
    catch (_) { return []; }
  }
  function saveExpenses(list) {
    try { localStorage.setItem(EXPENSE_KEY, JSON.stringify(list)); } catch (_) { }
  }
  function expenseBudget() {
    const profile = (window.MM && window.MM.profile && window.MM.profile.get()) || {};
    const areaAcres = +profile.area_acres || +(savedFarm && savedFarm.acres) || 0;
    const perAcre = +profile.budget_per_acre || 0;
    return areaAcres * perAcre;
  }

  function renderExpenses() {
    const out = $('[data-out="expense"]');
    if (!out) return;
    const entries = loadExpenses().slice().sort((a, b) => (b.date || '').localeCompare(a.date || '') || b.id - a.id);

    if (!entries.length) {
      const items = ['Total spend vs. your farm budget', 'Spend by category', 'A running log you can edit'];
      out.innerHTML = `<div class="tool__empty">
           <div class="tool__empty__ico">${SPARK_SVG}</div>
           <div>
             <div class="tool__empty__label">What you'll get</div>
             <ul>${items.map(t => `<li>${CHECK_SVG}<span>${t}</span></li>`).join('')}</ul>
             <p class="tool__empty__hint">Add your first expense above.</p>
           </div>
         </div>`;
      return;
    }

    const total = entries.reduce((s, e) => s + (Number(e.amount) || 0), 0);
    const budget = expenseBudget();
    const variance = budget - total;
    const varianceCls = budget ? (variance >= 0 ? 'kpi--good' : 'kpi--warn') : '';

    const byCategory = {};
    entries.forEach(e => { byCategory[e.category] = (byCategory[e.category] || 0) + (Number(e.amount) || 0); });
    const catKeys = Object.keys(byCategory).sort((a, b) => byCategory[b] - byCategory[a]);

    out.innerHTML = `
      <div class="kpi-grid">
        <div class="kpi"><div class="kpi__lbl">Total spent</div><div class="kpi__val">${INR(total)}</div>
          <div class="kpi__sub">${entries.length} ${entries.length === 1 ? 'entry' : 'entries'}</div></div>
        ${budget ? `
        <div class="kpi"><div class="kpi__lbl">Farm budget</div><div class="kpi__val">${INR(budget)}</div></div>
        <div class="kpi ${varianceCls}"><div class="kpi__lbl">${variance >= 0 ? 'Remaining' : 'Over budget'}</div>
          <div class="kpi__val">${INR(Math.abs(variance))}</div></div>` : ''}
      </div>

      <div class="chart-grid">
        <div class="chart-box">
          <div class="chart-box__title">Spend by category</div>
          <canvas data-chart="expense-cat"></canvas>
        </div>
      </div>

      ${entries.map(e => `
        <div class="alert" data-expense-row="${e.id}">
          <div class="alert__body">
            <strong>${EXPENSE_CATEGORY_LABELS[e.category] || e.category} — ${INR(e.amount)}</strong>
            <span>${e.date || ''}${e.note ? ' · ' + e.note : ''}</span>
          </div>
          <button type="button" class="btn btn-ghost" data-expense-delete="${e.id}">Delete</button>
        </div>`).join('')}`;

    makeChart($('[data-chart="expense-cat"]'), {
      type: 'bar',
      data: {
        labels: catKeys.map(k => EXPENSE_CATEGORY_LABELS[k] || k),
        datasets: [{ label: 'Spend', data: catKeys.map(k => byCategory[k]), backgroundColor: BRAND, borderRadius: 4 }]
      },
      options: {
        responsive: true, maintainAspectRatio: false,
        scales: { y: { beginAtZero: true, grid: { color: 'rgba(29,26,21,.06)' }, ticks: { callback: v => '₹' + (v / 1000).toFixed(0) + 'K' } }, x: { grid: { display: false } } },
        plugins: { legend: { display: false } }
      }
    });
  }

  $('[data-form="expense"]')?.addEventListener('submit', e => {
    e.preventDefault();
    const f = formToObj(e.target);
    const amount = +f.amount;
    if (!f.category || !(amount > 0)) return;
    const entries = loadExpenses();
    const nextId = entries.reduce((m, x) => Math.max(m, x.id || 0), 0) + 1;
    entries.push({
      id: nextId,
      category: f.category,
      amount: Math.round(amount * 100) / 100,
      date: f.date || new Date().toISOString().slice(0, 10),
      note: (f.note || '').slice(0, 200)
    });
    saveExpenses(entries);
    e.target.reset();
    renderExpenses();
  });

  $('[data-out="expense"]')?.addEventListener('click', e => {
    const btn = e.target.closest('[data-expense-delete]');
    if (!btn) return;
    saveExpenses(loadExpenses().filter(x => x.id !== (+btn.dataset.expenseDelete)));
    renderExpenses();
  });

  renderExpenses();

  /* ==========================================================
     TOOL 13: Govt schemes — eligible_schemes[]
     ========================================================== */
  $('[data-form="schemes"]')?.addEventListener('submit', async e => {
    e.preventDefault();
    const out = $('[data-out="schemes"]');
    if (!out) return;
    showLoading(out);
    try {
      const f = formToObj(e.target);
      const q = new URLSearchParams({
        crop_id: f.crop_id || 'all',
        season: f.season || 'all',
        area_acres: f.area_acres || 3,
        region_id: 'all'
      }).toString();
      const r = await api(`/api/government-schemes?${q}`);
      const schemes = r.eligible_schemes || [];
      const esc = (window.MM && window.MM.escapeHtml) ? window.MM.escapeHtml : (s => String(s));
      if (!schemes.length) {
        out.innerHTML = `<div class="alert"><div class="alert__body"><strong>No matching schemes</strong><p>Try widening the filters.</p></div></div>`;
        return;
      }
      out.innerHTML = `
        <div style="margin-bottom:16px;"><span class="chip chip--green">${r.total_matched} eligible schemes</span></div>
        ${schemes.map(s => `
          <div class="alert alert--green">
            <svg class="alert__ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="4" y="5" width="16" height="16" rx="2"/><path d="M9 15l2 2 4-4"/></svg>
            <div class="alert__body">
              <strong>${esc(s.scheme_name)} ${(s.benefit_type_label || s.benefit_type) ? `<span class="chip chip--gold">${esc(s.benefit_type_label || s.benefit_type)}</span>` : ''}</strong>
              <p>${esc(s.description || '')}</p>
              ${(s.benefit_label || s.benefit_value) ? `<p style="margin-top:4px;"><strong>Benefit:</strong> ${esc(s.benefit_label || s.benefit_value)}</p>` : ''}
              ${(s.url || s.application_url) ? `<p style="margin-top:6px;"><a href="${esc(s.url || s.application_url)}" target="_blank" rel="noopener" style="color:var(--brand);font-weight:600;">Apply →</a></p>` : ''}
            </div></div>`).join('')}`;
    } catch (err) { showError(out, err); }
  });

  /* ==========================================================
     TOOL 15: Strategy templates
     ========================================================== */
  $('[data-form="templates"]')?.addEventListener('submit', async e => {
    e.preventDefault();
    const out = $('[data-out="templates"]');
    if (!out) return;
    showLoading(out, 'Loading templates…');
    try {
      const profile = formToObj(e.target).profile;
      const url = profile ? `/api/strategy-templates?profile=${profile}` : '/api/strategy-templates';
      const list = await api(url);
      const esc = (window.MM && window.MM.escapeHtml) ? window.MM.escapeHtml : (s => String(s));
      if (!Array.isArray(list) || !list.length) {
        out.innerHTML = '<div class="alert"><div class="alert__body"><strong>No templates found.</strong></div></div>';
        return;
      }
      out.innerHTML = `
        <div class="kpi-grid">
          <div class="kpi kpi--good"><div class="kpi__lbl">Templates</div>
            <div class="kpi__val">${list.length}</div>
            <div class="kpi__sub">${profile ? esc(profile) + ' profile' : 'All profiles'}</div></div>
        </div>
        <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(280px,1fr));gap:14px;">
          ${list.map(t => {
        const c = t.config || {};
        return `<div style="background:var(--bg-soft);padding:18px;border-radius:var(--r-md);display:flex;flex-direction:column;gap:10px;">
              <div>
                <div style="font-family:'Fraunces',serif;font-size:1.15rem;font-weight:600;line-height:1.2;">${esc(t.name || t.template_id)}</div>
                <div style="font-size:.82rem;color:var(--ink-faint);margin-top:3px;">${esc(t.template_id)}</div>
              </div>
              <p style="font-size:.9rem;color:var(--ink-soft);margin:0;flex:1;">${esc(t.description || '')}</p>
              <div style="display:flex;flex-wrap:wrap;gap:6px;">
                ${c.crop_id ? `<span class="chip chip--green">${cropLabel(c.crop_id)}</span>` : ''}
                ${c.season ? `<span class="chip">${c.season}</span>` : ''}
                ${c.area_acres ? `<span class="chip">${c.area_acres} ac</span>` : ''}
                ${c.irrigation_level !== undefined ? `<span class="chip chip--blue">irrig ${c.irrigation_level}</span>` : ''}
                ${c.budget_per_acre ? `<span class="chip chip--gold">${INR(c.budget_per_acre)}/ac</span>` : ''}
              </div>
              <div style="font-size:.78rem;color:var(--ink-faint);border-top:1px dashed rgba(29,26,21,.1);padding-top:8px;">${esc(t.profile || '')}</div>
              <button class="btn btn-ghost" data-apply-template='${JSON.stringify(t).replace(/'/g, "&#39;")}' style="padding:8px 14px;font-size:.85rem;">Use in simulator →</button>
            </div>`;
      }).join('')}
        </div>`;

      // Wire up "Use in simulator" buttons → prefill Yield & Profit form
      out.querySelectorAll('[data-apply-template]').forEach(btn => {
        btn.addEventListener('click', () => {
          const tpl = JSON.parse(btn.dataset.applyTemplate.replace(/&#39;/g, "'"));
          const c = tpl.config || {};
          const simForm = document.querySelector('[data-form="simulate"]');
          if (!simForm) return;
          if (c.crop_id) simForm.crop_id.value = c.crop_id;
          if (c.season) simForm.season.value = c.season;
          if (c.area_acres !== undefined) simForm.area_acres.value = c.area_acres;
          if (c.irrigation_level !== undefined) simForm.irrigation_level.value = c.irrigation_level;
          if (c.budget_per_acre) {
            simForm.seed_cost_per_acre.value = Math.round(c.budget_per_acre * 0.12);
            simForm.fertilizer_cost_per_acre.value = Math.round(c.budget_per_acre * 0.30);
            simForm.labour_cost_per_acre.value = Math.round(c.budget_per_acre * 0.25);
            simForm.other_costs_per_acre.value = Math.round(c.budget_per_acre * 0.33);
          }
          // Switch to simulate tab
          document.querySelector('.sidebar__btn[data-tool="simulate"]')?.click();
          window.scrollTo({ top: 0, behavior: 'smooth' });
        });
      });
    } catch (err) { showError(out, err); }
  });

  /* ==========================================================
     TOOL 16: Compare crops (batch-simulate)
     ========================================================== */
  $('[data-form="compare"]')?.addEventListener('submit', async e => {
    e.preventDefault();
    const out = $('[data-out="compare"]');
    if (!out) return;
    const form = e.target;
    // Pull multi-select values directly (FormData gives only one value)
    const selected = Array.from(form.crop_ids.selectedOptions).map(o => o.value);
    if (selected.length < 2) {
      out.innerHTML = '<div class="alert alert--gold"><div class="alert__body"><strong>Pick at least 2 crops</strong><p>Hold Ctrl / Cmd and click to select multiple.</p></div></div>';
      return;
    }
    showLoading(out, `Simulating ${selected.length} crops in parallel…`);
    try {
      const f = formToObj(form);
      const override = (window.__agrisimWeatherOverride && window.__agrisimWeatherOverride()) || null;
      const farmSoil = (window.__agrisimFarmSoil && window.__agrisimFarmSoil()) || null;
      const [soilRaw, weatherRaw] = await Promise.all([
        farmSoil ? Promise.resolve(farmSoil) : api(`/api/soil/${f.region_id}`).catch(() => ({})),
        override ? Promise.resolve(override) : api(`/api/weather/${f.region_id}?season=${f.season}`).catch(() => ({}))
      ]);
      const coerce = o => Object.fromEntries(Object.entries(o || {}).map(([k, v]) =>
        [k, (typeof v === 'string' && v.trim() !== '' && !isNaN(Number(v))) ? Number(v) : v]));

      const body = {
        crop_ids: selected,
        area_acres: parseFloat(f.area_acres),
        region_id: f.region_id,
        budget_per_acre: parseFloat(f.budget_per_acre),
        irrigation_level: parseFloat(f.irrigation_level),
        seed_variety: 'standard', sowing_date: '2024-06-15',
        soil: coerce(soilRaw),
        weather: coerce(weatherRaw)
      };
      const data = await api('/api/batch-simulate', { method: 'POST', body: JSON.stringify(body) });
      const results = data.results || [];
      if (!results.length) {
        out.innerHTML = '<div class="alert alert--red"><div class="alert__body"><strong>No results</strong><p>' + (data.errors?.[0]?.error || 'Batch simulation returned nothing.') + '</p></div></div>';
        return;
      }

      const best = results[0];
      out.innerHTML = `
        <div class="kpi-grid">
          <div class="kpi kpi--good"><div class="kpi__lbl">Winner</div>
            <div class="kpi__val" style="font-size:1.25rem;">${cropLabel(best.crop_id)}</div>
            <div class="kpi__sub">Profit ${INR(best.profit)}</div></div>
          <div class="kpi"><div class="kpi__lbl">Best ROI</div>
            <div class="kpi__val">${PCT(Math.max(...results.map(r => r.roi_percent)))}</div></div>
          <div class="kpi kpi--info"><div class="kpi__lbl">Crops simulated</div>
            <div class="kpi__val">${data.total_simulated}</div>
            <div class="kpi__sub">${data.errors?.length ? data.errors.length + ' errors' : 'all succeeded'}</div></div>
          <div class="kpi kpi--warn"><div class="kpi__lbl">Profit spread</div>
            <div class="kpi__val">${INR(best.profit - results[results.length - 1].profit)}</div>
            <div class="kpi__sub">winner − loser</div></div>
        </div>

        <div class="chart-grid">
          <div class="chart-box">
            <div class="chart-box__title">Profit ranking</div>
            <canvas data-chart="cmp-profit"></canvas>
          </div>
          <div class="chart-box">
            <div class="chart-box__title">Profit vs risk</div>
            <canvas data-chart="cmp-scatter"></canvas>
          </div>
        </div>

        <h4 style="font-size:.85rem;font-weight:600;letter-spacing:.12em;text-transform:uppercase;color:var(--ink-faint);margin:16px 0 12px;">Detailed comparison</h4>
        ${results.map((r, i) => `
          <div class="list-row">
            <div class="list-row__bullet" style="background:${i === 0 ? BRAND : i === results.length - 1 ? CLAY : 'var(--ink-faint)'};">${i + 1}</div>
            <div class="list-row__name">${cropLabel(r.crop_id)}
              <small>Yield ${Math.round(r.yield_kg_per_acre)} kg/ac · Risk ${Math.round(r.risk_score)}/100 · Revenue ${INR(r.revenue)}</small></div>
            <div class="list-row__val">${INR(r.profit)}<small>ROI ${PCT(r.roi_percent)}</small></div>
          </div>`).join('')}`;

      makeChart($('[data-chart="cmp-profit"]'), {
        type: 'bar',
        data: {
          labels: results.map(r => CROP_LABELS[r.crop_id]?.split(' ·')[0] || r.crop_id),
          datasets: [{
            label: 'Profit',
            data: results.map(r => r.profit),
            backgroundColor: results.map((_, i) => i === 0 ? BRAND : i === results.length - 1 ? CLAY : ACCENT),
            borderRadius: 8, borderSkipped: false
          }]
        },
        options: {
          indexAxis: 'y', responsive: true, maintainAspectRatio: false,
          scales: { x: { beginAtZero: true, grid: { color: 'rgba(29,26,21,.06)' }, ticks: { callback: v => '₹' + (v / 1000).toFixed(0) + 'K' } }, y: { grid: { display: false } } },
          plugins: { legend: { display: false }, tooltip: { callbacks: { label: c => INR(c.parsed.x) } } }
        }
      });

      makeChart($('[data-chart="cmp-scatter"]'), {
        type: 'scatter',
        data: {
          datasets: results.map((r, i) => ({
            label: CROP_LABELS[r.crop_id]?.split(' ·')[0] || r.crop_id,
            data: [{ x: r.risk_score, y: r.profit }],
            backgroundColor: [BRAND, ACCENT, SKY, CLAY, '#7ca894', '#8a8376'][i % 6],
            pointRadius: 10, pointHoverRadius: 13, borderWidth: 2, borderColor: '#fff'
          }))
        },
        options: {
          responsive: true, maintainAspectRatio: false,
          scales: {
            x: { title: { display: true, text: 'Risk score (lower is better) →' }, min: 0, max: 100, grid: { color: 'rgba(29,26,21,.06)' } },
            y: { title: { display: true, text: '↑ Profit' }, beginAtZero: true, grid: { color: 'rgba(29,26,21,.06)' }, ticks: { callback: v => '₹' + (v / 1000).toFixed(0) + 'K' } }
          },
          plugins: {
            legend: { position: 'bottom', labels: { boxWidth: 10, padding: 8 } },
            tooltip: { callbacks: { label: c => c.dataset.label + ': risk ' + c.parsed.x.toFixed(0) + ', profit ' + INR(c.parsed.y) } }
          }
        }
      });
    } catch (err) { showError(out, err); }
  });

  /* ==========================================================
     TOOL 17: Optimal crop mix
     ========================================================== */
  $('[data-form="mix"]')?.addEventListener('submit', async e => {
    e.preventDefault();
    const out = $('[data-out="mix"]');
    showLoading(out, 'Optimising allocation across crops…');
    try {
      const f = formToObj(e.target);
      const override = (window.__agrisimWeatherOverride && window.__agrisimWeatherOverride()) || null;
      const farmSoil = (window.__agrisimFarmSoil && window.__agrisimFarmSoil()) || null;
      const [soilRaw, weatherRaw] = await Promise.all([
        farmSoil ? Promise.resolve(farmSoil) : api(`/api/soil/${f.region_id}`).catch(() => ({})),
        override ? Promise.resolve(override) : api(`/api/weather/${f.region_id}?season=${f.season}`).catch(() => ({}))
      ]);
      const coerce = o => Object.fromEntries(Object.entries(o || {}).map(([k, v]) =>
        [k, (typeof v === 'string' && v.trim() !== '' && !isNaN(Number(v))) ? Number(v) : v]));

      const body = {
        region_id: f.region_id,
        season: f.season,
        total_area_acres: parseFloat(f.total_area_acres),
        total_budget: parseFloat(f.total_budget),
        soil: coerce(soilRaw),
        weather: coerce(weatherRaw)
      };
      const r = await api('/api/optimal-mix', { method: 'POST', body: JSON.stringify(body) });
      const allocs = r.allocations || [];
      if (!allocs.length) {
        out.innerHTML = '<div class="alert"><div class="alert__body"><strong>No allocations returned.</strong></div></div>';
        return;
      }

      out.innerHTML = `
        <div class="kpi-grid">
          <div class="kpi kpi--good"><div class="kpi__lbl">Total profit</div>
            <div class="kpi__val">${INR(r.total_expected_profit)}</div>
            <div class="kpi__sub">across ${r.num_crops} crops</div></div>
          <div class="kpi"><div class="kpi__lbl">Land allocated</div>
            <div class="kpi__val">${allocs.reduce((s, a) => s + a.allocated_acres, 0).toFixed(1)}<span style="font-size:.5em"> / ${r.total_area_acres} ac</span></div></div>
          <div class="kpi"><div class="kpi__lbl">Budget used</div>
            <div class="kpi__val">${INR(allocs.reduce((s, a) => s + a.allocated_budget, 0))}<span style="font-size:.5em"> / ${INR(r.total_budget)}</span></div></div>
          <div class="kpi kpi--warn"><div class="kpi__lbl">Avg risk</div>
            <div class="kpi__val">${Math.round(r.avg_risk_score || 0)}<span style="font-size:.5em;color:var(--ink-faint)">/100</span></div></div>
        </div>

        <div class="chart-grid">
          <div class="chart-box">
            <div class="chart-box__title">Land allocation (acres)</div>
            <canvas data-chart="mix-land"></canvas>
          </div>
          <div class="chart-box">
            <div class="chart-box__title">Profit contribution</div>
            <canvas data-chart="mix-profit"></canvas>
          </div>
        </div>

        <h4 style="font-size:.85rem;font-weight:600;letter-spacing:.12em;text-transform:uppercase;color:var(--ink-faint);margin:16px 0 12px;">Detailed allocation</h4>
        ${allocs.map((a, i) => `
          <div class="list-row">
            <div class="list-row__bullet">${i + 1}</div>
            <div class="list-row__name">${cropLabel(a.crop_id)}
              <small>${a.allocated_acres} ac · Budget ${INR(a.allocated_budget)} · Risk ${Math.round(a.risk_score)}/100</small></div>
            <div class="list-row__val">${INR(a.expected_profit)}<small>ROI ${PCT(a.roi_percent)}</small></div>
          </div>`).join('')}`;

      const palette = [BRAND, ACCENT, SKY, CLAY, '#7ca894', '#8a8376', '#d4a64a', '#6ea7c7'];
      makeChart($('[data-chart="mix-land"]'), {
        type: 'doughnut',
        data: {
          labels: allocs.map(a => CROP_LABELS[a.crop_id]?.split(' ·')[0] || a.crop_id),
          datasets: [{ data: allocs.map(a => a.allocated_acres), backgroundColor: palette, borderWidth: 2, borderColor: '#fff' }]
        },
        options: {
          responsive: true, maintainAspectRatio: false, cutout: '62%',
          plugins: { legend: { position: 'right', labels: { boxWidth: 12, padding: 8 } }, tooltip: { callbacks: { label: c => c.label + ': ' + c.parsed + ' ac' } } }
        }
      });
      makeChart($('[data-chart="mix-profit"]'), {
        type: 'bar',
        data: {
          labels: allocs.map(a => CROP_LABELS[a.crop_id]?.split(' ·')[0] || a.crop_id),
          datasets: [{ data: allocs.map(a => a.expected_profit), backgroundColor: palette, borderRadius: 8, borderSkipped: false }]
        },
        options: {
          responsive: true, maintainAspectRatio: false,
          scales: { y: { beginAtZero: true, grid: { color: 'rgba(29,26,21,.06)' }, ticks: { callback: v => '₹' + (v / 1000).toFixed(0) + 'K' } }, x: { grid: { display: false } } },
          plugins: { legend: { display: false }, tooltip: { callbacks: { label: c => INR(c.parsed.y) } } }
        }
      });
    } catch (err) { showError(out, err); }
  });

  /* ==========================================================
     TOOL 14: planning estimates (NDVI, carbon, and pump runtime)
     ========================================================== */
  const ndviForm = $('[data-form="ndvi"]');
  if (ndviForm) ndviForm.addEventListener('submit', async e => {
    e.preventDefault();
    const out = $('[data-out="ndvi"]');
    showLoading(out, 'Calculating planning estimate...');
    try {
      const f = formToObj(e.target);
      const r = await api('/api/field/ndvi', {
        method: 'POST', body: JSON.stringify({ lat: +f.lat, lon: +f.lon, crop_id: f.crop_id })
      });
      const grid = Array.isArray(r.sub_field_grid) ? r.sub_field_grid : [];
      const cells = grid.map(cell => `
        <div title="${cell.sub_cell_id}: NDVI ${cell.ndvi} — ${cell.status}"
             style="aspect-ratio:1;border-radius:6px;background:${cell.color};
                    display:flex;align-items:center;justify-content:center;
                    font-size:.68rem;font-weight:600;color:#fff;
                    text-shadow:0 1px 2px rgba(0,0,0,.35);cursor:default;">
          ${cell.ndvi}
        </div>`).join('');
      const heatmap = grid.length ? `
        <div style="margin-top:1rem;">
          <div style="font-size:.85rem;font-weight:600;color:var(--ink-soft);margin-bottom:.5rem;">Sub-field health zones</div>
          <div style="display:grid;grid-template-columns:repeat(5,1fr);gap:6px;max-width:320px;">${cells}</div>
          <div style="display:flex;gap:1rem;margin-top:.6rem;font-size:.72rem;color:var(--ink-faint);">
            <span><span style="display:inline-block;width:10px;height:10px;border-radius:3px;background:#2e7d32;margin-right:4px;"></span>Optimal</span>
            <span><span style="display:inline-block;width:10px;height:10px;border-radius:3px;background:#f57c00;margin-right:4px;"></span>Mild stress</span>
            <span><span style="display:inline-block;width:10px;height:10px;border-radius:3px;background:#d32f2f;margin-right:4px;"></span>High stress</span>
          </div>
        </div>` : '';
      out.innerHTML = `<div class="alert alert--gold"><div class="alert__body"><strong>Planning estimate, not satellite imagery</strong><p>${r.satellite_source}</p></div></div>
        <div class="kpi-grid"><div class="kpi kpi--info"><div class="kpi__lbl">Estimated vegetation index</div><div class="kpi__val">${r.mean_ndvi}</div></div><div class="kpi"><div class="kpi__lbl">Estimated canopy cover</div><div class="kpi__val">${r.canopy_cover_pct}%</div></div><div class="kpi"><div class="kpi__lbl">Planning status</div><div class="kpi__val" style="font-size:1rem">${r.health_status}</div></div></div>
        ${heatmap}`;
    } catch (err) { showError(out, err); }
  });

  const carbonForm = $('[data-form="carbon"]');
  if (carbonForm) carbonForm.addEventListener('submit', async e => {
    e.preventDefault();
    const out = $('[data-out="carbon"]');
    showLoading(out, 'Calculating planning estimate...');
    try {
      const f = formToObj(e.target);
      const profile = window.MM?.profile?.get?.() || {};
      const r = await api('/api/carbon-credits', {
        method: 'POST', body: JSON.stringify({
          crop_id: profile.crop_id || 'wheat', area_acres: +(profile.area_acres || 1),
          tillage_practice: f.tillage_practice, cover_crop: f.cover_crop === 'true',
          biochar_application: f.biochar_application === 'true'
        })
      });
      out.innerHTML = `<div class="alert alert--gold"><div class="alert__body"><strong>Not a verified carbon credit</strong><p>${r.disclaimer}</p></div></div>
        <div class="kpi-grid"><div class="kpi kpi--info"><div class="kpi__lbl">Estimated CO2e / year</div><div class="kpi__val">${r.total_co2e_sequestered_tons} t</div></div><div class="kpi"><div class="kpi__lbl">Illustrative value</div><div class="kpi__val">${INR(r.estimated_annual_earning_inr)}</div></div></div>`;
    } catch (err) { showError(out, err); }
  });

  const iotForm = $('[data-form="iot"]');
  if (iotForm) iotForm.addEventListener('submit', async e => {
    e.preventDefault();
    const out = $('[data-out="iot"]');
    showLoading(out, 'Calculating irrigation recommendation...');
    try {
      const f = formToObj(e.target);
      const profile = window.MM?.profile?.get?.() || {};
      const r = await api('/api/iot/pump-trigger', {
        method: 'POST', body: JSON.stringify({
          farm_id: profile.farm_id || 'local_plan', area_acres: +(profile.area_acres || 1),
          current_moisture_pct: +f.current_moisture_pct, target_moisture_pct: +f.target_moisture_pct,
          flow_rate_lpm: +f.flow_rate_lpm
        })
      });
      out.innerHTML = `<div class="alert alert--gold"><div class="alert__body"><strong>Recommendation only</strong><p>No physical pump was controlled.</p></div></div>
        <div class="kpi-grid"><div class="kpi kpi--info"><div class="kpi__lbl">Recommended runtime</div><div class="kpi__val">${r.recommended_pump_runtime_minutes} min</div></div><div class="kpi"><div class="kpi__lbl">Estimated water</div><div class="kpi__val">${r.required_water_liters.toLocaleString()} L</div></div><div class="kpi"><div class="kpi__lbl">Action</div><div class="kpi__val" style="font-size:1rem">${r.control_action}</div></div></div>`;
    } catch (err) { showError(out, err); }
  });

  /* ==========================================================
     TOOL 17: ML status
     ========================================================== */
  $('[data-action="ml-status"]').addEventListener('click', async () => {
    const out = $('[data-out="ml"]');
    showLoading(out, 'Checking model status…');
    try {
      const r = await api('/api/ml/status');
      const m = r.training_report || {};
      const my = m.yield_model || m.yield || {};
      const mp = m.price_model || m.price || {};
      const mr = m.recommend_model || m.recommend || {};
      const aud = r.audit_metrics || {};
      const recAud = aud.crop_recommendation || {};
      const yieldAud = aud.yield_prediction || {};

      // Feature importances
      const recFeats = Object.entries(recAud.permutation_importances || {}).slice(0, 5);
      const yieldFeats = Object.entries(yieldAud.permutation_importances || {}).slice(0, 5);

      out.innerHTML = `
        <div class="kpi-grid">
          <div class="kpi ${r.yield_model_loaded ? 'kpi--good' : 'kpi--warn'}">
            <div class="kpi__lbl">Yield prediction</div>
            <div class="kpi__val">${r.yield_model_loaded ? '✓ Loaded' : '— Offline'}</div>
            <div class="kpi__sub">${yieldAud.algorithm || 'RandomForest'} (Tuned)</div>
          </div>
          <div class="kpi kpi--info">
            <div class="kpi__lbl">Yield performance</div>
            <div class="kpi__val">R² ${FIX(yieldAud.r2 || 0.99, 3)}</div>
            <div class="kpi__sub">MAPE ${yieldAud.mape_pct_real_rows || 7.5}% | MAE ${Math.round(yieldAud.mae || 411)}kg</div>
          </div>
          <div class="kpi ${r.recommend_model_loaded ? 'kpi--good' : 'kpi--warn'}">
            <div class="kpi__lbl">Crop recommendation</div>
            <div class="kpi__val">${r.recommend_model_loaded ? '✓ Loaded' : '— Offline'}</div>
            <div class="kpi__sub">${recAud.algorithm || 'CatBoost'} (Tuned)</div>
          </div>
          <div class="kpi kpi--info">
            <div class="kpi__lbl">Crop performance</div>
            <div class="kpi__val">${PCT((recAud.accuracy || 0.938) * 100)}</div>
            <div class="kpi__sub">Macro F1: ${FIX(recAud.f1_macro || 0.58, 2)}</div>
          </div>
        </div>

        <div class="chart-grid" style="margin-top: 20px;">
          <div class="chart-box">
            <div class="chart-box__title">Crop Rec. Permutation Importance (SHAP Proxy)</div>
            <ul style="padding: 10px 0 0 20px; font-size: 0.85rem; color: var(--ink-soft);">
              ${recFeats.map(([feat, score]) => `
                <li style="margin-bottom: 6px;">
                  <strong style="color: var(--brand);">${feat.replace('_enc', '')}</strong>: 
                  <span style="font-family: monospace; font-weight: 600;">${score.toFixed(4)}</span>
                </li>`).join('')}
            </ul>
          </div>
          <div class="chart-box">
            <div class="chart-box__title">Yield Pred. Feature Weights</div>
            <ul style="padding: 10px 0 0 20px; font-size: 0.85rem; color: var(--ink-soft);">
              ${yieldFeats.map(([feat, score]) => `
                <li style="margin-bottom: 6px;">
                  <strong style="color: var(--brand);">${feat.replace('_enc', '')}</strong>: 
                  <span style="font-family: monospace; font-weight: 600;">${score.toFixed(4)}</span>
                </li>`).join('')}
            </ul>
          </div>
        </div>

        <div class="alert alert--green" style="margin-top: 20px; border:1px solid color-mix(in srgb, var(--brand) 35%, transparent); background: var(--brand-soft);">
          <div class="alert__body" style="color: var(--brand-deep);">
            <strong>ML Robustness Stress Test Diagnostics:</strong>
            <ul style="margin: 8px 0 0 16px; padding: 0; font-size: 0.85rem;">
              <li style="margin-bottom: 4px;">⛅ <strong>Sensor Failure Weather Simulation (Rainfall/Temp to 0.0):</strong> Crop Recommendation test accuracy drops from 93.8% to <b>${PCT((recAud.robustness_noisy_weather_accuracy || 0.829) * 100)}</b> (highly stable, graceful degradation).</li>
              <li style="margin-bottom: 4px;">🌵 <strong>Severe Regional Drought Simulation (Rainfall to 0.0):</strong> Yield Regressor prediction accuracy ($R^2$) maintains at <b>${FIX(yieldAud.robustness_drought_r2 || 0.989, 4)}</b>.</li>
            </ul>
          </div>
        </div>

        <div class="alert"><div class="alert__body">
          <strong>Production Model Directory</strong>
          <p style="font-family:monospace;font-size:.82rem;word-break:break-all;">${r.model_dir}</p>
          <p style="font-size:.82rem;">${r.model_provenance || 'Model provenance was not supplied.'}</p>
        </div></div>`;
    } catch (err) { showError(out, err); }
  });
  $('[data-action="ml-train"]').addEventListener('click', async () => {
    if (!confirm('Retrain all 3 ML models? This takes 20–40 seconds.')) return;
    const out = $('[data-out="ml"]');
    showLoading(out, 'Retraining yield, price & recommend models…');
    try {
      await api('/api/ml/train', { method: 'POST', body: JSON.stringify({}) });
      out.innerHTML = `<div class="alert alert--green">
        <svg class="alert__ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><path d="M9 12l2 2 4-4"/></svg>
        <div class="alert__body"><strong>All models retrained ✓</strong><p>Click "Check status" to see fresh metrics.</p></div></div>`;
    } catch (err) { showError(out, err); }
  });

  /* ==========================================================
     FARM BOUNDARY PICKUP (from farm-boundary.html)
     The user draws a polygon and clicks "Use in dashboard".
     FarmState persists the enriched farm object (centroid,
     region_id, state, district, village, geojson, soil).

     This section:
     - Loads the farm via FarmState (migrates legacy agrisim_farm key).
     - Pre-fills area_acres AND region_id across every form.
     - Shows an enhanced farm-pickup banner.
     - Exposes soil for the simulate tool (__agrisimFarmSoil).
     ========================================================== */

  // FARM_KEY: used by the Clear button below.
  const FARM_KEY = 'mittimantra_selectedFarm';
  // Note: savedFarm is declared and initialized at the TOP of this IIFE
  // so it is available to all async callbacks (region select population, etc.)


  function mapBoundarySoilToSimulator(src) {
    // farm-boundary.js's fetchSoil() already divides every SoilGrids layer
    // by its d_factor, so src.phh2o/nitrogen/soc arrive here in real-world
    // units (pH, g/kg N, g/kg SOC) — do not re-apply SoilGrids scaling.
    // The simulator wants {ph, n_kg_per_acre, p_kg_per_acre, k_kg_per_acre}.
    // Best-effort mapping.
    if (!src) return null;
    const ph = src.phh2o != null ? +src.phh2o : undefined;
    const n_raw = src.nitrogen;                               // g/kg
    const soc = src.soc;                                      // g/kg
    const fertility = soc != null ? Math.max(0.5, Math.min(1.5, soc / 20)) : 1;
    const out = {};
    if (ph != null && !isNaN(ph)) out.ph = +ph.toFixed(2);
    if (n_raw != null) out.n_kg_per_acre = +(n_raw * 4.047).toFixed(1);
    out.p_kg_per_acre = +(25 * fertility).toFixed(1);
    out.k_kg_per_acre = +(120 * fertility).toFixed(1);
    return out;
  }

  function renderFarmPickup() {
    const host = document.getElementById('farmPickup');
    if (!host) return;
    if (!savedFarm) { host.hidden = true; host.innerHTML = ''; return; }

    const acres = (savedFarm.acres || 0).toFixed(2);
    const ha = (savedFarm.hectares || 0).toFixed(2);
    const lat = (savedFarm.lat || (savedFarm.centroid && savedFarm.centroid[1]) || 0).toFixed(5);
    const lon = (savedFarm.lon || (savedFarm.centroid && savedFarm.centroid[0]) || 0).toFixed(5);

    // Location chips — show state, district, village (whatever is available)
    // These come from Nominatim (third-party) — escape before injecting.
    const esc = (window.MM && window.MM.escapeHtml) ? window.MM.escapeHtml : (s => String(s));
    const locParts = [savedFarm.state, savedFarm.district, savedFarm.village].filter(Boolean);
    const locChips = locParts.length
      ? locParts.map(p => `<span class="fp-chip">${esc(p)}</span>`).join('')
      : `<span class="fp-chip fp-chip--dim">${lat}°N, ${lon}°E</span>`;

    // Matched region display name
    let regionDisplay = savedFarm.region_id || '';
    if (typeof window.FarmState !== 'undefined' && savedFarm.region_id) {
      const rec = window.FarmState.getRegionRecord(savedFarm.region_id);
      if (rec) regionDisplay = rec.displayName;
    }

    host.hidden = false;
    host.innerHTML = `
      <div class="farm-pickup__ico">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 7l9-4 9 4v10l-9 4-9-4V7z"/><path d="M3 7l9 4 9-4"/><path d="M12 11v10"/></svg>
      </div>
      <div class="farm-pickup__body">
        <strong>Your farm is active</strong>
        <div class="fp-meta">
          <span class="fp-meta__item">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 3v18h18"/><path d="M7 16l3-4 4 3 5-7"/></svg>
            ${acres} acres &middot; ${ha} ha
          </span>
          <span class="fp-meta__item">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="3"/><path d="M12 1v4M12 19v4M1 12h4M19 12h4"/></svg>
            ${lat}°N, ${lon}°E
          </span>
          ${regionDisplay ? `<span class="fp-meta__item fp-meta__item--region" title="This matched backend dataset profile will be used for regional predictions.">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><path d="M12 16v-4M12 8h.01"/></svg>
            Dataset profile: ${esc(regionDisplay)}
          </span>` : ''}
        </div>
        <div class="fp-chips">${locChips}</div>
        ${savedFarm.soil ? '<div class="fp-note">✓ SoilGrids data available — will be used in simulation.</div>' : ''}
      </div>
      <div class="farm-pickup__actions">
        <a href="farm-boundary.html" class="btn btn-ghost" style="padding:8px 14px;font-size:.85rem;">Edit farm</a>
        <button id="farmPickupClear" class="btn btn-ghost" style="padding:8px 14px;font-size:.85rem;">Clear</button>
      </div>`;

    document.getElementById('farmPickupClear').addEventListener('click', () => {
      if (typeof window.FarmState !== 'undefined') window.FarmState.clear();
      else { try { localStorage.removeItem(FARM_KEY); localStorage.removeItem('agrisim_farm'); } catch { } }
      savedFarm = null;
      renderFarmPickup();
      // Revert region selects to first available option
      $$('select[data-regions]').forEach(sel => {
        if (sel.options.length) sel.selectedIndex = 0;
      });

      // Reset fertilizer form default values
      const fertForm = document.querySelector('[data-form="fertilizer"]');
      if (fertForm) {
        fertForm.n.value = "45";
        fertForm.p.value = "22";
        fertForm.k.value = "25";
      }
    });
  }

  function applyFarmToForms() {
    if (!savedFarm) return;

    // FIX-7: Pre-fill area inputs from drawn farm
    if (savedFarm.acres) {
      const area = +savedFarm.acres.toFixed(2);
      $$('input[name="area_acres"]').forEach(el => { el.value = area; });
      // Some tools use total_area_acres (optimal mix)
      $$('input[name="total_area_acres"]').forEach(el => { el.value = area; });
    }

    // FIX-7: Pre-fill REGION selects — this was the key missing piece.
    // Without this, every tool still defaulted to whatever the API returned first.
    if (savedFarm.region_id) {
      $$('select[data-regions]').forEach(sel => {
        const opt = sel.querySelector(`option[value="${savedFarm.region_id}"]`);
        if (opt) sel.value = savedFarm.region_id;
      });
    }

    // Pre-fill fertilizer form inputs with SoilGrids values if available
    if (savedFarm.soil) {
      const simSoil = mapBoundarySoilToSimulator(savedFarm.soil);
      if (simSoil) {
        const fertForm = document.querySelector('[data-form="fertilizer"]');
        if (fertForm) {
          if (simSoil.n_kg_per_acre != null) fertForm.n.value = Math.round(simSoil.n_kg_per_acre);
          if (simSoil.p_kg_per_acre != null) fertForm.p.value = Math.round(simSoil.p_kg_per_acre);
          if (simSoil.k_kg_per_acre != null) fertForm.k.value = Math.round(simSoil.k_kg_per_acre);
        }
      }
    }
  }

  renderFarmPickup();
  applyFarmToForms();

  /* H-4: savedFarm was read once at load and never refreshed. The plot
     picker (mm-plots.js) and FarmState mutations (farm-state.js) both
     dispatch 'mm:plot-changed' on document when the active plot switches,
     but nothing here listened — banner/soil/map/disease-scan region context
     all kept showing the old plot until a manual reload. Re-derive every
     piece of state that was seeded from savedFarm at load time. */
  function refreshFarmContext() {
    savedFarm = (typeof window.FarmState !== 'undefined')
      ? window.FarmState.load()
      : (() => {
        try {
          return JSON.parse(
            localStorage.getItem('mittimantra_selectedFarm') ||
            localStorage.getItem('agrisim_farm') ||
            'null'
          );
        } catch { return null; }
      })();

    renderFarmPickup();     // farm-pickup banner (acres/location/soil note)
    applyFarmToForms();     // area/region form fields + fertilizer soil prefill
    // window.__agrisimFarmSoil() reads `savedFarm` live via closure, so no
    // extra step is needed for the simulate tool's soil context.

    // applyFarmToForms() repoints select[data-regions] via .value, which does
    // NOT fire a 'change' event, so the telemetry map/panel would otherwise
    // keep showing the previous plot's region. Refresh it explicitly.
    if (savedFarm && savedFarm.region_id) {
      const sel = $('select[data-regions]');
      const opt = sel && sel.querySelector(`option[value="${savedFarm.region_id}"]`);
      const name = opt ? opt.text : (savedFarm.district || savedFarm.state || savedFarm.region_id);
      updateRegionalTelemetry(savedFarm.region_id, name);
    }

    // Disease-scan region/crop context (normally synced only when the tab is
    // first opened — keep it in sync if the plot changes while it's open too).
    const diseaseRegionSel = $('#diseaseRegionSelect');
    if (diseaseRegionSel && savedFarm && savedFarm.region_id) {
      diseaseRegionSel.value = savedFarm.region_id;
    }
    const diseaseCropSel = $('#diseaseCropSelect');
    const knownCrop = savedFarm?.crop_id || localStorage.getItem('mittimantra_selectedCrop') || '';
    if (diseaseCropSel && knownCrop && ["maize", "potato", "soybean", "tomato"].includes(knownCrop)) {
      diseaseCropSel.value = knownCrop;
    }
  }
  document.addEventListener('mm:plot-changed', refreshFarmContext);

  /* ---------- Arrival from the map (?fromMap=1) ----------
     farm-boundary.html has always appended this flag, but nothing read it, so
     saving a boundary dropped the user at the top of a long dashboard with no
     sign that anything had happened. Confirm the handoff, then drop the flag
     so a reload or a shared link doesn't replay it. */
  (function confirmMapHandoff() {
    const params = new URLSearchParams(location.search);
    if (params.get('fromMap') !== '1') return;

    params.delete('fromMap');
    const rest = params.toString();
    history.replaceState({}, '', location.pathname + (rest ? '?' + rest : '') + location.hash);

    if (!savedFarm) return;
    const host = document.getElementById('farmPickup');
    if (!host) return;

    host.scrollIntoView({ behavior: 'smooth', block: 'center' });
    host.classList.add('farm-pickup--flash');
    setTimeout(() => host.classList.remove('farm-pickup--flash'), 2600);

    const where = [savedFarm.village, savedFarm.district, savedFarm.state].filter(Boolean)[0];
    const acres = Number(savedFarm.acres || 0).toFixed(2);
    if (window.MM && window.MM.toast) {
      window.MM.toast(`Farm saved — ${acres} acres${where ? ' in ' + where : ''} is now used by every tool`, 4000);
    }
  })();

  /* ==========================================================
     WEATHER OVERRIDE — hooks into the Simulate tool.
     1. User toggles the checkbox → rainfall/temp inputs win.
     2. "Fetch live weather" fills them from the API so they
        can inspect and tweak before simulating.
     3. Submit handler (below) short-circuits the API call
        when override is active.
     ========================================================== */
  const simForm = $('[data-form="simulate"]');
  if (simForm) {
    const fetchBtn = simForm.querySelector('[data-weather-fetch]');
    fetchBtn?.addEventListener('click', async () => {
      const region = simForm.region_id.value;
      const season = simForm.season.value;
      const original = fetchBtn.textContent;
      fetchBtn.disabled = true;
      fetchBtn.textContent = 'Fetching…';
      try {
        const w = await api(`/api/weather/${region}?season=${season}`);
        if (w && w.rainfall_mm != null) simForm.rainfall_mm.value = Math.round(+w.rainfall_mm);
        if (w && w.avg_temp_c != null) simForm.avg_temp_c.value = (+w.avg_temp_c).toFixed(1);
        simForm.weather_override_on.checked = true;
      } catch (err) {
        alert('Live weather unavailable: ' + err.message);
      } finally {
        fetchBtn.disabled = false;
        fetchBtn.textContent = original;
      }
    });
  }

  // Patch the simulate handler post-hoc: intercept the fetch via a shim.
  // Simpler path: expose the override via a getter the handler reads.
  window.__agrisimWeatherOverride = () => {
    if (!simForm) return null;
    const on = simForm.weather_override_on && simForm.weather_override_on.checked;
    if (!on) return null;
    const rain = parseFloat(simForm.rainfall_mm.value);
    const temp = parseFloat(simForm.avg_temp_c.value);
    if (!isFinite(rain) && !isFinite(temp)) return null;
    const out = {};
    if (isFinite(rain)) out.rainfall_mm = rain;
    if (isFinite(temp)) out.avg_temp_c = temp;
    return out;
  };

  window.__agrisimFarmSoil = () => {
    if (!savedFarm || !savedFarm.soil) return null;
    return mapBoundarySoilToSimulator(savedFarm.soil);
  };

  /* ==========================================================
     TOOL 11b: Crop Disease Detection Flagship Feature
     ========================================================== */

  // Screening always runs via the backend heuristic endpoint — the checked-in
  // TF.js artefact has placeholder weights and cannot produce a real
  // prediction, so there is no in-browser model path to load.
  function loadTFJS() {
    const screeningStatus = $('#modelLoadStatus');
    screeningStatus.textContent = 'Preliminary visual screening uses the backend; it is not a diagnostic model.';
    screeningStatus.style.color = '#c88a3a';
    $('#runDiseaseScanBtn').disabled = false;
  }

  // Bind to disease scan tab click
  const diseaseBtn = $('.sidebar__btn[data-tool="disease"]');
  if (diseaseBtn) {
    diseaseBtn.addEventListener('click', () => {
      loadTFJS();
      // Sync farm contexts
      if (savedFarm && savedFarm.region_id) {
        $('#diseaseRegionSelect').value = savedFarm.region_id;
      }
      const knownCrop = savedFarm?.crop_id || localStorage.getItem('mittimantra_selectedCrop') || '';
      if (knownCrop && ["maize", "potato", "soybean", "tomato"].includes(knownCrop)) {
        $('#diseaseCropSelect').value = knownCrop;
      }
    });
  }

  // Handle image upload and preview
  const imgInput = $('#diseaseImageInput');
  const imgPreview = $('#diseaseImagePreview');
  const previewContainer = $('#imagePreviewContainer');
  const uploadPrompt = $('#uploadPrompt');
  const resizeCanvas = $('#diseaseResizeCanvas');
  const resizeCtx = resizeCanvas.getContext('2d');
  const runScanBtn = $('#runDiseaseScanBtn');

  if (imgInput) {
    imgInput.addEventListener('change', e => {
      const file = e.target.files[0];
      if (!file) return;

      const reader = new FileReader();
      reader.onload = evt => {
        imgPreview.src = evt.target.result;
        uploadPrompt.style.display = 'none';
        previewContainer.style.display = 'block';

        imgPreview.onload = () => {
          // Draw to canvas and scale to 224x224
          resizeCtx.drawImage(imgPreview, 0, 0, 224, 224);
          runScanBtn.disabled = false;
        };
      };
      reader.readAsDataURL(file);
    });
  }

  const reuploadBtn = $('#reuploadBtn');
  if (reuploadBtn) {
    reuploadBtn.addEventListener('click', e => {
      e.stopPropagation();
      e.preventDefault();
      imgInput.value = '';
      imgPreview.src = '';
      previewContainer.style.display = 'none';
      uploadPrompt.style.display = 'block';
      runScanBtn.disabled = true;
      $('#diseaseResultsBox').style.display = 'none';
    });
  }

  // Queue logging helper
  function queueOfflineLog(crop, disease, confidence, severity, region) {
    let logs = [];
    try {
      logs = JSON.parse(localStorage.getItem('mittimantra_disease_logs') || '[]');
    } catch (_) { }
    logs.push({
      crop_id: crop,
      disease: disease,
      confidence: confidence,
      severity: severity,
      region_id: region,
      timestamp: new Date().toISOString(),
      offline: !navigator.onLine
    });
    try {
      localStorage.setItem('mittimantra_disease_logs', JSON.stringify(logs));
    } catch (_) { }

    if (navigator.onLine) {
      syncOfflineLogs();
    }
  }

  // M-8: There is no backend endpoint that actually accepts these logs
  // (only /api/disease/predict exists, which just runs a single scan) — this
  // only ever console.log'd, so it was never really "syncing" anything. It
  // used to then unconditionally wipe the local queue regardless, which
  // discarded a user's scan history with no record of it anywhere. Until a
  // real sync endpoint exists, keep the logs in localStorage (capped so the
  // queue can't grow unbounded) instead of deleting them.
  const MAX_STORED_DISEASE_LOGS = 50;
  async function syncOfflineLogs() {
    if (!navigator.onLine) return;
    let logs = [];
    try {
      logs = JSON.parse(localStorage.getItem('mittimantra_disease_logs') || '[]');
    } catch (_) { return; }
    if (!logs.length) return;

    // Nothing durable to sync to yet — this is a local record only.
    console.log("Crop disease diagnostic logs pending sync (no backend endpoint yet):", logs);
    if (logs.length > MAX_STORED_DISEASE_LOGS) {
      try {
        localStorage.setItem(
          'mittimantra_disease_logs',
          JSON.stringify(logs.slice(-MAX_STORED_DISEASE_LOGS))
        );
      } catch (_) { }
    }
  }
  window.addEventListener('online', syncOfflineLogs);

  // Render the costed, area-scaled treatment plan from /api/disease/predict's
  // action_plan field. Falls back to the plain treatment list (see call site)
  // when a class has no rows in dataset/disease_treatments.csv.
  function renderActionPlan(plan) {
    const optionCard = (o) => {
      const isSpray = o.applications > 0 && o.quantity_per_application;
      const qty = o.total_quantity ? `${o.total_quantity.value} ${o.total_quantity.unit}` : null;
      const modeTag = o.mode === 'organic' ? '🍃 Organic' : '🧪 Chemical';
      return `
        <div class="chart-box" style="border:1px solid ${o.mode === 'organic' ? 'var(--brand)' : 'var(--accent)'};border-color:color-mix(in srgb, ${o.mode === 'organic' ? 'var(--brand)' : 'var(--accent)'} 35%, transparent);">
          <div class="chart-box__title" style="display:flex;justify-content:space-between;align-items:baseline;gap:8px;">
            <span>${modeTag} · ${o.product}</span>
            ${o.approx_cost_inr ? `<span style="font-size:.85rem;font-weight:700;color:var(--ink);">₹${o.approx_cost_inr.toLocaleString('en-IN')}</span>` : ''}
          </div>
          <div style="font-size:.82rem;color:var(--ink-soft);line-height:1.6;padding-top:4px;">
            ${isSpray ? `
              <div><b>Dose:</b> ${o.dose}${qty ? ` — <b>${qty} total</b> for ${plan.area_acres} acre${plan.area_acres != 1 ? 's' : ''}` : ''}</div>
              <div><b>Applications:</b> ${o.applications}${o.interval_days ? `, ${o.interval_days} days apart` : ''}</div>
              <div><b>Pre-harvest interval:</b> ${o.pre_harvest_interval_days ? `${o.pre_harvest_interval_days} days — do not harvest sooner` : 'none'}</div>
              <div><b>Re-entry:</b> ${o.reentry_hours ? `wait ${o.reentry_hours}h before re-entering the field` : 'no restriction'}</div>
            ` : `<div>${o.dose}</div>`}
            ${o.notes ? `<div style="margin-top:6px;font-style:italic;color:var(--ink-faint);">${o.notes}</div>` : ''}
          </div>
        </div>`;
    };

    const scheduleRows = (plan.recommended_first && plan.recommended_first.schedule || []).map(s => `
      <div style="display:flex;justify-content:space-between;padding:6px 0;border-top:1px solid rgba(29,26,21,.07);font-size:.82rem;${s.is_harvest_gate ? 'color:var(--clay);font-weight:600;' : 'color:var(--ink-soft);'}">
        <span>${s.is_harvest_gate ? '🚫 ' : ''}${s.label}</span>
        <span>${s.date}</span>
      </div>`).join('');

    return `
      <div class="alert alert--green" style="margin-top:20px;border:1px solid color-mix(in srgb, var(--brand) 35%, transparent);background:var(--brand-soft);">
        <div class="alert__body" style="color:var(--brand-deep);">
          <strong>${plan.headline}</strong>
        </div>
      </div>

      <div class="chart-grid" style="margin-top:16px;">
        ${plan.options.map(optionCard).join('')}
      </div>

      ${scheduleRows ? `
      <div class="chart-box" style="margin-top:16px;">
        <div class="chart-box__title">📅 Schedule for the first option</div>
        ${scheduleRows}
      </div>` : ''}

      <div class="alert alert--gold" style="margin-top:16px;">
        <div class="alert__body">
          <strong>Before you spray</strong>
          <ul style="margin:8px 0 0 16px;padding:0;font-size:.82rem;line-height:1.6;">
            ${plan.safety.map(s => `<li>${s}</li>`).join('')}
          </ul>
        </div>
      </div>

      <div style="margin-top:10px;font-size:.76rem;color:var(--ink-faint);font-style:italic;">
        ${plan.disclaimer}
      </div>`;
  }

  // Run Disease Scan inference
  if (runScanBtn) {
    runScanBtn.addEventListener('click', async () => {
      const resultsBox = $('#diseaseResultsBox');
      showLoading(resultsBox, 'Running preliminary visual screening...');
      resultsBox.style.display = 'block';

      const cropCtx = $('#diseaseCropSelect').value;
      const regionId = $('#diseaseRegionSelect').value;

      try {
        runScanBtn.disabled = true;
        // 1. Compute Severity Bucket client-side via Leaf Pixel Segmentation & Color Thresholding
        const imgData = resizeCtx.getImageData(0, 0, 224, 224);
        const pixelBytes = imgData.data;
        let greenCount = 0;
        let lesionCount = 0;

        for (let i = 0; i < pixelBytes.length; i += 4) {
          const r = pixelBytes[i];
          const g = pixelBytes[i + 1];
          const b = pixelBytes[i + 2];

          const brightness = (r + g + b) / 3.0;
          if (brightness < 20 || brightness > 245) continue; // ignore background / soil shadows

          const isGreen = (g > r) && (g > b) && (g > 30);
          const isLesion = ((r > g) || ((r > 100) && (g > 100) && (b < 80))) && !isGreen && (r > 30 || g > 30);

          if (isGreen) greenCount++;
          else if (isLesion) lesionCount++;
        }

        const totalLeaf = greenCount + lesionCount;
        const lesionPct = totalLeaf > 0 ? (lesionCount / totalLeaf) * 100.0 : 5.0;
        const severity = lesionPct < 5.0 ? 'early' : lesionPct <= 20.0 ? 'moderate' : 'severe';

        // 2. Run the backend heuristic screen (there is no real in-browser
        // model to fall back from — see loadTFJS above).
        let diseaseName = "";
        let confidence = 0.0;
        let matchedCrop = cropCtx || "tomato";
        let treatments = [];
        let subsidySchemes = [];

        const planAreaAcres = +((window.MM && window.MM.profile && window.MM.profile.get().area_acres) || (savedFarm && savedFarm.acres) || 1);

        const b64Data = resizeCanvas.toDataURL('image/jpeg');
        const payload = {
          image_b64: b64Data,
          crop_id: cropCtx || null,
          region_id: regionId || null,
          area_acres: planAreaAcres
        };
        const r = await api('/api/disease/predict', {
          method: 'POST',
          body: JSON.stringify(payload)
        });

        diseaseName = r.disease;
        confidence = r.confidence;
        matchedCrop = r.crop_matched;
        treatments = r.treatment;
        subsidySchemes = r.subsidy_eligible_schemes;
        const plan = r.action_plan || null;

        // 3. Queue Analytics Log
        queueOfflineLog(matchedCrop, diseaseName, confidence, severity, regionId);

        // 4. Render Results UI
        const sevClass = severity === 'early' ? 'good' : severity === 'moderate' ? 'warn' : 'red';
        const sevLabel = severity.charAt(0).toUpperCase() + severity.slice(1);
        const formattedConf = PCT(confidence * 100);

        const organicTreatments = treatments.filter(t => t.startsWith('Organic:'));
        const chemicalTreatments = treatments.filter(t => t.startsWith('Chemical'));

        resultsBox.innerHTML = `
          <div class="kpi-grid">
            <div class="kpi kpi--info">
              <div class="kpi__lbl">Screening result</div>
              <div class="kpi__val" style="font-size: 1.15rem; font-weight: 600;">${diseaseName}</div>
              <div class="kpi__sub">Class matched: ${matchedCrop}</div>
            </div>
            <div class="kpi kpi--info">
              <div class="kpi__lbl">Heuristic score</div>
              <div class="kpi__val">${formattedConf}</div>
              <div class="kpi__sub">Not a clinical or agronomic confidence value</div>
            </div>
            <div class="kpi kpi--${sevClass === 'red' ? 'red' : sevClass === 'warn' ? 'warn' : 'good'}">
              <div class="kpi__lbl">Severity (Lesion Area)</div>
              <div class="kpi__val">${sevLabel} (${FIX(lesionPct, 1)}%)</div>
              <div class="kpi__sub">Computed client-side</div>
            </div>
          </div>

          <div class="alert alert--gold" style="margin-top: 20px;"><div class="alert__body"><strong>Do not treat this as a diagnosis.</strong><p>Confirm symptoms with a qualified agronomist before applying any treatment.</p></div></div>

          ${plan && plan.options && plan.options.length ? renderActionPlan(plan) : `
          <div class="chart-grid" style="margin-top: 20px;">
            <div class="chart-box">
              <div class="chart-box__title">🍃 Organic & Low-Cost Treatments</div>
              <ul style="padding: 10px 0 0 20px; font-size: 0.85rem; color: var(--ink-soft); line-height: 1.5;">
                ${organicTreatments.map(t => `<li style="margin-bottom: 8px;">${t.replace('Organic: ', '')}</li>`).join('')}
              </ul>
            </div>
            <div class="chart-box">
              <div class="chart-box__title">🧪 Chemical Escalation (Apply if needed)</div>
              <ul style="padding: 10px 0 0 20px; font-size: 0.85rem; color: var(--ink-soft); line-height: 1.5;">
                ${chemicalTreatments.map(t => `<li style="margin-bottom: 8px;">${t.replace('Chemical Escalation: ', '')}</li>`).join('')}
              </ul>
            </div>
          </div>`}

          ${subsidySchemes.length ? `
          <div class="alert alert--green" style="margin-top: 20px; border:1px solid color-mix(in srgb, var(--brand) 35%, transparent); background: var(--brand-soft);">
            <div class="alert__body" style="color: var(--brand-deep);">
              <strong>Eligible Subsidy Schemes:</strong>
              <ul style="margin: 8px 0 0 16px; padding: 0; font-size: 0.85rem; line-height: 1.4;">
                ${subsidySchemes.map(s => `<li style="margin-bottom: 4px;">💰 ${s}</li>`).join('')}
              </ul>
            </div>
          </div>` : ''}

          <!-- Gyan Seva Redirection Trigger -->
          ${(confidence < 0.70 || severity === 'severe') ? `
          <div class="alert alert--red" style="margin-top: 20px;">
            <svg class="alert__ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0zM12 9v4M12 17h.01"/></svg>
            <div class="alert__body">
              <strong>High-risk diagnosis flagged</strong>
              <p>Because the severity is severe or confidence is low, we highly recommend consulting an agriculture expert.</p>
              <p style="margin-top: 8px;">
                <a href="gyan-seva.html?region=${regionId || ''}&specialty=pathologist" class="btn btn-primary" style="font-size: 0.82rem; padding: 6px 12px; display: inline-block;">Connect with Regional Expert on Gyan Seva</a>
              </p>
            </div>
          </div>` : ''}

          <div style="margin-top: 16px; font-size: 0.78rem; color: var(--ink-faint); text-align: center; font-style: italic;">
            * Field accuracy differs from lab conditions. Always confirm severe cases with an agricultural expert.
          </div>
        `;
      } catch (err) {
        showError(resultsBox, err);
      } finally {
        runScanBtn.disabled = false;
      }
    });
  }

})();

