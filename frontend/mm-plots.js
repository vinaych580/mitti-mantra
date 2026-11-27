/*
 * mm-plots.js — plot switcher for the dashboard farm bar.
 *
 * FarmState now stores a collection of plots rather than one farm (most
 * farmers work several scattered plots with different soil). This injects a
 * selector into the farm bar so switching plots re-points every tool at once:
 * picking a plot makes it active in FarmState and pushes its region and area
 * into MM.profile, which the tools already auto-fill from.
 *
 * Load AFTER mm-core.js and farm-state.js.
 */
(function () {
  'use strict';

  var BAR_SELECTOR = '.mm-farm-bar';
  var WAIT_MS = 6000;   // the farm bar is built after an async /api/regions call

  function FS() { return window.FarmState; }

  function injectStyles() {
    if (document.getElementById('mm-plots-styles')) return;
    var s = document.createElement('style');
    s.id = 'mm-plots-styles';
    s.textContent = [
      '.mm-plotpick{display:flex;flex-direction:column;gap:2px;}',
      '.mm-plotpick small{font-size:.66rem;font-weight:700;letter-spacing:.06em;',
      'text-transform:uppercase;color:var(--ink-faint);}',
      '.mm-plotpick__row{display:flex;align-items:center;gap:4px;}',
      '.mm-plotpick select{min-width:150px;}',
      '.mm-plotpick__add{display:inline-flex;align-items:center;justify-content:center;',
      'width:26px;height:26px;border-radius:8px;text-decoration:none;flex:0 0 auto;',
      'border:1px dashed rgba(29,26,21,.25);color:var(--ink-soft);font-size:1rem;line-height:1;}',
      '.mm-plotpick__add:hover{border-color:var(--brand);color:var(--brand);}',
      /* 26px square is a comfortable cursor target and an uncomfortable thumb
         one; this is the entry point to drawing a farm, so it should not be
         the hardest thing on the row to hit. */
      // min-*, not fixed width/height: this control has two forms -- a 26px "+"
      // square when plots exist, and a wider "Draw your farm →" link when none
      // do (which sets width:auto inline just below). A min only raises the
      // small one to a thumb target and leaves the wide one alone.
      '@media (max-width:860px){.mm-plotpick__add{min-width:44px;min-height:44px;}}'
    ].join('');
    document.head.appendChild(s);
  }

  /** Poll for an element that is created asynchronously. */
  function waitFor(selector, timeoutMs) {
    return new Promise(function (resolve) {
      var found = document.querySelector(selector);
      if (found) return resolve(found);

      var observer = new MutationObserver(function () {
        var el = document.querySelector(selector);
        if (el) {
          observer.disconnect();
          clearTimeout(timer);
          resolve(el);
        }
      });
      observer.observe(document.body, { childList: true, subtree: true });

      var timer = setTimeout(function () {
        observer.disconnect();
        resolve(null);
      }, timeoutMs);
    });
  }

  function buildWidget() {
    injectStyles();
    var wrap = document.createElement('label');
    wrap.className = 'mm-farm-bar__field mm-plotpick';
    wrap.innerHTML =
      '<small>Plot</small>' +
      '<span class="mm-plotpick__row">' +
      '<select data-mm-plot aria-label="Active plot"></select>' +
      '<a class="mm-plotpick__add" href="farm-boundary.html" title="Draw another plot">+</a>' +
      '</span>';
    return wrap;
  }

  function refresh(wrap) {
    var fs = FS();
    if (!fs) return;

    var plots = fs.list();
    var activeId = fs.getActiveId();
    var select = wrap.querySelector('[data-mm-plot]');

    // Nothing saved yet — keep the "+" affordance but drop the empty dropdown.
    // The class lets the one-line phone farm bar leave this variant out.
    wrap.classList.toggle('mm-plotpick--empty', !plots.length);
    if (!plots.length) {
      select.style.display = 'none';
      wrap.querySelector('small').textContent = 'Plot';
      var add = wrap.querySelector('.mm-plotpick__add');
      add.textContent = 'Draw your farm →';
      add.style.width = 'auto';
      add.style.padding = '4px 10px';
      add.style.fontSize = '.78rem';
      return;
    }

    select.style.display = '';
    wrap.querySelector('small').textContent = 'Plot (' + plots.length + ')';
    select.innerHTML = plots.map(function (p) {
      var size = p.acres ? ' · ' + Number(p.acres).toFixed(1) + ' ac' : '';
      // Auto-generated names already carry the area they had when saved. Strip it
      // so an edited area doesn't render as "Nagar · 2.1 ac · 5.0 ac".
      var base = String(p.name || 'Plot').replace(/\s*·\s*[\d.]+\s*ac\s*$/i, '');
      var label = base + size;
      return '<option value="' + p.id + '"' + (p.id === activeId ? ' selected' : '') + '>' +
        window.MM.escapeHtml(label) + '</option>';
    }).join('');
  }

  /** Point the shared Farm Profile at the newly selected plot. */
  function applyPlotToProfile(plot) {
    if (!plot || !window.MM || !window.MM.profile) return;
    var patch = {};
    if (plot.region_id) patch.region_id = plot.region_id;
    if (plot.acres) patch.area_acres = +Number(plot.acres).toFixed(2);
    if (Object.keys(patch).length) window.MM.profile.set(patch);
  }

  function boot() {
    var fs = FS();
    if (!fs || typeof fs.list !== 'function') return;   // older farm-state.js
    if (!document.querySelector('.dashx__wrap')) return;

    waitFor(BAR_SELECTOR, WAIT_MS).then(function (bar) {
      if (!bar || bar.querySelector('.mm-plotpick')) return;

      var wrap = buildWidget();
      // Lives in the bar's always-visible summary row: switching plots is an
      // everyday action and shouldn't need the bar opened for editing first.
      var slot = bar.querySelector('.mm-farm-bar__plot-slot');
      var firstField = bar.querySelector('.mm-farm-bar__field');
      if (slot) slot.appendChild(wrap);
      else if (firstField) firstField.parentNode.insertBefore(wrap, firstField);
      else bar.appendChild(wrap);

      refresh(wrap);

      wrap.querySelector('[data-mm-plot]').addEventListener('change', function (e) {
        var plot = fs.setActive(e.target.value);
        if (!plot) return;
        applyPlotToProfile(plot);
        if (window.MM && window.MM.toast) {
          window.MM.toast('Switched to "' + (plot.name || 'plot') + '" — all tools updated');
        }
      });

      // Re-render on any plot mutation, including ones made on another page.
      document.addEventListener('mm:plot-changed', function () { refresh(wrap); });
      window.addEventListener('storage', function (e) {
        if (e.key === fs.PLOTS_KEY) refresh(wrap);
      });
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();
