/*
 * mm-freshness.js — data provenance badge.
 *
 * Every figure on the dashboard is either live from an upstream API or read
 * from the seed CSVs in dataset/. That difference used to be invisible: with no
 * DATAGOV_API_KEY the mandi prices silently fall back to a CSV that can be a
 * year old, and the UI presented it exactly like a live quote.
 *
 * This module reads GET /api/data-freshness and renders a compact pill that
 * expands into a per-source breakdown. Mount points:
 *   • any element with [data-mm-freshness] — inline pill
 *   • otherwise auto-injected on dashboard pages, left of the Tools FAB
 *
 * Public API: window.MM.freshness.get() -> Promise<report>
 *             window.MM.freshness.render(el) -> mounts a pill into el
 *
 * Load AFTER mm-core.js.
 */
(function () {
  'use strict';

  var CACHE_KEY = 'mm_freshness_cache_v1';
  var CACHE_MS = 5 * 60 * 1000;   // the report is cheap but changes rarely

  var LABELS = {
    fresh:   { text: 'Live data',   dot: 'var(--brand)',  tone: 'ok'   },
    aging:   { text: 'Aging data',  dot: 'var(--accent)', tone: 'warn' },
    stale:   { text: 'Stale data',  dot: 'var(--clay)',   tone: 'bad'  },
    unknown: { text: 'Data status', dot: 'var(--ink-faint)', tone: 'na' }
  };

  var inflight = null;

  /* ---------- data ---------- */

  function readCache() {
    try {
      var raw = JSON.parse(sessionStorage.getItem(CACHE_KEY) || 'null');
      if (raw && (Date.now() - raw.at) < CACHE_MS) return raw.report;
    } catch (_) {}
    return null;
  }

  function writeCache(report) {
    try {
      sessionStorage.setItem(CACHE_KEY, JSON.stringify({ at: Date.now(), report: report }));
    } catch (_) {}
  }

  function get() {
    var cached = readCache();
    if (cached) return Promise.resolve(cached);
    if (inflight) return inflight;

    inflight = fetch('/api/data-freshness', { headers: { Accept: 'application/json' } })
      .then(function (res) {
        if (!res.ok) throw new Error('HTTP ' + res.status);
        return res.json();
      })
      .then(function (report) {
        writeCache(report);
        inflight = null;
        return report;
      })
      .catch(function () {
        inflight = null;
        // Offline or the endpoint is missing — say so rather than implying freshness.
        return {
          generated_at: null,
          overall: 'unknown',
          any_live: false,
          offline: true,
          sources: []
        };
      });
    return inflight;
  }

  /* ---------- formatting ---------- */

  function humanAge(days) {
    if (days === null || days === undefined) return 'no date recorded';
    if (days < 1) return 'today';
    if (days < 2) return 'yesterday';
    if (days < 45) return Math.round(days) + ' days old';
    if (days < 400) return Math.round(days / 30) + ' months old';
    var years = days / 365;
    return (years < 2 ? '1 year' : Math.round(years) + ' years') + ' old';
  }

  /* "Stale data" alone didn't say *what* was stale or how stale, so the pill
     now names the worst source and its age ("Mandi prices: 10 months old").
     The panel still lists every source. */
  var RANK = { stale: 3, aging: 2, fresh: 1, unknown: 0 };
  function pillText(report, conf) {
    if (report.offline) return 'Data status';
    if (report.overall === 'fresh') return conf.text;
    var worst = (report.sources || [])
      .filter(function (src) { return src.staleness === report.overall && src.age_days != null; })
      .sort(function (a, b) { return (RANK[b.staleness] - RANK[a.staleness]) || (b.age_days - a.age_days); })[0];
    return worst ? worst.label + ': ' + humanAge(worst.age_days) : conf.text;
  }

  function modeLabel(mode) {
    if (mode === 'live') return 'live';
    if (mode === 'seed') return 'seed data';
    return mode || 'unknown';
  }

  /* ---------- styles ---------- */

  function injectStyles() {
    if (document.getElementById('mm-freshness-styles')) return;
    var s = document.createElement('style');
    s.id = 'mm-freshness-styles';
    s.textContent = [
      '.mm-fresh{position:relative;display:inline-flex;align-items:center;gap:7px;',
      'padding:6px 12px;border-radius:999px;background:var(--surface);',
      'border:1px solid rgba(29,26,21,.10);box-shadow:var(--shadow-sm);',
      'font:600 .76rem/1 var(--font-body, Inter, system-ui, sans-serif);color:var(--ink-soft);cursor:pointer;}',
      '.mm-fresh:hover{border-color:rgba(29,26,21,.2);}',
      '.mm-fresh__dot{width:8px;height:8px;border-radius:50%;flex:0 0 auto;}',
      '.mm-fresh--warn{color:var(--clay);}',
      '.mm-fresh--bad{color:var(--clay);}',
      '.mm-fresh__panel{position:absolute;bottom:calc(100% + 10px);right:0;z-index:9998;',
      'width:min(340px,calc(100vw - 32px));padding:14px;border-radius:var(--r-md);',
      'background:var(--surface);border:1px solid rgba(29,26,21,.10);box-shadow:var(--shadow-lg);',
      'font:400 .78rem/1.5 var(--font-body, Inter, system-ui, sans-serif);color:var(--ink);',
      'display:none;text-align:left;cursor:default;}',
      '.mm-fresh__panel.open{display:block;}',
      '.mm-fresh__panel h4{margin:0 0 4px;font-size:.82rem;font-weight:700;color:var(--ink);}',
      '.mm-fresh__intro{margin:0 0 10px;color:var(--ink-faint);font-size:.74rem;}',
      '.mm-fresh__row{display:flex;gap:8px;padding:7px 0;border-top:1px solid rgba(29,26,21,.07);}',
      '.mm-fresh__row:first-of-type{border-top:0;}',
      '.mm-fresh__rdot{width:7px;height:7px;border-radius:50%;margin-top:6px;flex:0 0 auto;}',
      '.mm-fresh__rname{font-weight:600;color:var(--ink);}',
      '.mm-fresh__rmeta{color:var(--ink-faint);font-size:.73rem;}',
      '.mm-fresh__rdetail{color:var(--ink-soft);font-size:.73rem;margin-top:2px;}',
      '.mm-fresh--float{position:fixed;right:88px;bottom:24px;z-index:9997;}',
      // Phones: the bottom-right corner holds the chat + language buttons, so
      // the pill takes the empty bottom-left corner instead of sitting on them.
      '@media(max-width:640px){.mm-fresh--float{right:auto;left:12px;bottom:18px;}',
      '.mm-fresh__panel{right:auto;left:0;}}',
      '@media print{.mm-fresh--float{display:none;}}',
      // In the farm bar (top of the page) the panel opens downward.
      '.mm-fresh--inbar .mm-fresh__panel{bottom:auto;top:calc(100% + 10px);}'
    ].join('');
    document.head.appendChild(s);
  }

  /* ---------- rendering ---------- */

  function buildPanel(report) {
    var panel = document.createElement('div');
    panel.className = 'mm-fresh__panel';
    panel.setAttribute('data-no-translate', '');

    var title = document.createElement('h4');
    title.textContent = 'Where these numbers come from';
    panel.appendChild(title);

    var intro = document.createElement('p');
    intro.className = 'mm-fresh__intro';
    intro.textContent = report.offline
      ? 'Could not reach the server, so the age of this data is unknown.'
      : 'Live sources are fetched on demand. Seed data ships with the app and only changes when the dataset is updated.';
    panel.appendChild(intro);

    (report.sources || []).forEach(function (src) {
      var conf = LABELS[src.staleness] || LABELS.unknown;

      var row = document.createElement('div');
      row.className = 'mm-fresh__row';

      var dot = document.createElement('span');
      dot.className = 'mm-fresh__rdot';
      dot.style.background = conf.dot;
      row.appendChild(dot);

      var body = document.createElement('div');

      var name = document.createElement('div');
      name.className = 'mm-fresh__rname';
      name.textContent = src.label + ' · ' + modeLabel(src.mode);
      body.appendChild(name);

      var meta = document.createElement('div');
      meta.className = 'mm-fresh__rmeta';
      meta.textContent = humanAge(src.age_days) + ' · ' + src.upstream;
      body.appendChild(meta);

      if (src.detail) {
        var detail = document.createElement('div');
        detail.className = 'mm-fresh__rdetail';
        detail.textContent = src.detail;
        body.appendChild(detail);
      }

      row.appendChild(body);
      panel.appendChild(row);
    });

    return panel;
  }

  function render(host, report, opts) {
    opts = opts || {};
    injectStyles();

    var conf = LABELS[report.overall] || LABELS.unknown;

    var pill = document.createElement('button');
    pill.type = 'button';
    pill.className = 'mm-fresh mm-fresh--' + conf.tone + (opts.floating ? ' mm-fresh--float' : '') + (opts.inBar ? ' mm-fresh--inbar' : '');
    pill.setAttribute('data-no-translate', '');
    pill.setAttribute('aria-expanded', 'false');
    pill.title = 'Where these numbers come from — tap for every source';

    var dot = document.createElement('span');
    dot.className = 'mm-fresh__dot';
    dot.style.background = conf.dot;
    pill.appendChild(dot);

    var label = document.createElement('span');
    label.textContent = pillText(report, conf);
    pill.appendChild(label);

    var panel = buildPanel(report);
    pill.appendChild(panel);

    pill.addEventListener('click', function (e) {
      e.stopPropagation();
      var open = panel.classList.toggle('open');
      pill.setAttribute('aria-expanded', String(open));
    });
    panel.addEventListener('click', function (e) { e.stopPropagation(); });
    document.addEventListener('click', function () {
      panel.classList.remove('open');
      pill.setAttribute('aria-expanded', 'false');
    });

    host.appendChild(pill);
    return pill;
  }

  function mount(el) {
    return get().then(function (report) { return render(el, report, {}); });
  }

  /* ---------- boot ---------- */

  function boot() {
    var hosts = Array.prototype.slice.call(document.querySelectorAll('[data-mm-freshness]'));
    if (hosts.length) {
      get().then(function (report) {
        hosts.forEach(function (h) { render(h, report, {}); });
      });
      return;
    }
    // No explicit mount point. On the dashboard it belongs in the farm bar,
    // next to the farm those numbers describe -- floating, it sat on top of
    // the crop list. The bar is built after an async /api/regions call, so
    // wait for its slot and only float the pill if the bar never appears.
    if (!document.querySelector('.dashx__wrap')) return;
    var started = Date.now();
    (function waitForBar() {
      var slot = document.querySelector('[data-mm-freshness-slot]');
      if (slot || Date.now() - started > 6000) {
        get().then(function (report) {
          if (slot) render(slot, report, { inBar: true });
          else render(document.body, report, { floating: true });
        });
        return;
      }
      setTimeout(waitForBar, 120);
    })();
  }

  // mm-core.js short-circuits on `if (window.MM) return;`, so creating window.MM
  // here would silently disable it if this file ever loads first. Attach only
  // when it already exists; otherwise expose a standalone global.
  var publicApi = { get: get, render: mount };
  if (window.MM) window.MM.freshness = publicApi;
  else window.MMFreshness = publicApi;

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();
