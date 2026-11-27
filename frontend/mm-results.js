/* =========================================================
   mm-results.js — Phase 4.7: offline and partial-coverage states
   for the dashboard's tools.

   1. Last result per tool. When a tool's output panel settles on a result
      (not a loading state, not an error), a copy of it is kept in
      localStorage with the time and the inputs it was for. Charts are
      canvases and cannot be copied; they are replaced by a line saying so.
      Size-capped: one entry ≤ 60 000 characters, all entries ≤ 400 000,
      at most 16 tools, oldest dropped first.

   2. Offline state. When a tool cannot reach the server, its panel says
      so, says what the tool needs, and shows the saved copy with its date
      (dashboard.js showError calls offlineView). The planners that compute
      on the device (simulate, recommend) say they still work. Opening the
      dashboard while offline fills empty panels the same way.

   3. Partial coverage. nearestWithPrices() finds the nearest district that
      has mandi prices for a crop, from the district list the server
      already publishes (/api/v1/districts: point and coverage flags), so a
      price tool can offer it as a labelled reference instead of a dead end.

   Nothing here invents a figure: the saved copy is the tool's own earlier
   output, and the reference district's numbers come from the same
   endpoints, labelled as another district's.
   ========================================================= */
(function () {
  'use strict';

  var KEY = 'mm_last_results';
  var MAX_ENTRY = 60000;
  var MAX_TOTAL = 400000;
  var MAX_TOOLS = 16;
  // apiRequest in dashboard.js falls back to offline-simulator.js for these.
  var OFFLINE_OK = { simulate: true, recommend: true };
  // Work from localStorage alone and never need the server.
  var LOCAL_ONLY = { expense: true };
  var PRICE_TOOLS = { forecast: true, sell: true, msp: true, arbitrage: true };

  var esc = function (s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  };
  // Marked for the i18n pass, same convention as dashboard.js text().
  var text = function (s) { return '<span>' + esc(s) + '</span>'; };
  var NUM = function (s) { return '<span data-no-translate>' + s + '</span>'; };

  var WIFI_OFF = '<svg class="alert__ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M1 1l22 22"/><path d="M16.72 11.06A10.94 10.94 0 0 1 19 12.55"/><path d="M5 12.55a10.94 10.94 0 0 1 5.17-2.39"/><path d="M10.71 5.05A16 16 0 0 1 22.58 9"/><path d="M1.42 9a15.91 15.91 0 0 1 4.7-2.88"/><path d="M8.53 16.11a6 6 0 0 1 6.95 0"/><line x1="12" y1="20" x2="12.01" y2="20"/></svg>';

  function lang() {
    try { return (window.AgriSimI18n && window.AgriSimI18n.getLanguage && window.AgriSimI18n.getLanguage()) || 'en'; }
    catch (_) { return 'en'; }
  }
  function fmtWhen(ts) {
    var tag = { en: 'en-IN', hi: 'hi-IN', te: 'te-IN', kn: 'kn-IN', ta: 'ta-IN' }[lang()] || 'en-IN';
    try {
      return new Date(ts).toLocaleString(tag, { day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit' });
    } catch (_) { return new Date(ts).toISOString().slice(0, 16).replace('T', ' '); }
  }

  /* ---------- storage ---------- */
  function readAll() {
    try {
      var v = JSON.parse(localStorage.getItem(KEY) || '{}');
      return v && typeof v === 'object' ? v : {};
    } catch (_) { return {}; }
  }
  function writeAll(all) {
    var keys = Object.keys(all).sort(function (a, b) { return all[b].at - all[a].at; });
    while (keys.length > MAX_TOOLS) delete all[keys.pop()];
    var json = JSON.stringify(all);
    while (json.length > MAX_TOTAL && keys.length > 1) { delete all[keys.pop()]; json = JSON.stringify(all); }
    try { localStorage.setItem(KEY, json); }
    catch (_) {
      // Storage full: keep only the newest entry rather than nothing.
      try { var one = {}; one[keys[0]] = all[keys[0]]; localStorage.setItem(KEY, JSON.stringify(one)); } catch (__) { /* give up quietly */ }
    }
  }
  function get(tool) {
    var e = readAll()[tool];
    return e && typeof e.html === 'string' && e.at ? e : null;
  }

  /* ---------- what counts as a result ---------- */
  function isResult(out) {
    var first = out.firstElementChild;
    if (!first) return false;
    if (first.classList.contains('loading') || out.getAttribute('aria-busy') === 'true') return false;
    if (out.querySelector('.mm-offline')) return false;           // our own offline view
    if (out.querySelector('[data-form="home-setup"]')) return false; // My Farm's setup form
    // A single alert on its own is an error or a "nothing here" answer.
    if (out.children.length === 1 && first.classList.contains('alert')) return false;
    return true;
  }
  // The inputs the result was for: the tool form's chosen options.
  function captionFor(out) {
    var tool = out.closest('.tool');
    var form = tool && tool.querySelector('form[data-form]');
    if (!form) return '';
    var parts = [];
    ['region_id', 'crop_id', 'season'].forEach(function (name) {
      var el = form.elements[name];
      if (el && el.tagName === 'SELECT' && el.selectedIndex >= 0 && el.value) parts.push(el.options[el.selectedIndex].text.trim());
    });
    return parts.join(' · ');
  }
  function snapshot(out) {
    var copy = out.cloneNode(true);
    // Store English: the copy may be shown later in another language.
    var I = window.AgriSimI18n;
    if (I && I.sourceText && lang() !== 'en') {
      var wa = document.createTreeWalker(out, NodeFilter.SHOW_TEXT);
      var wb = document.createTreeWalker(copy, NodeFilter.SHOW_TEXT);
      var a, b;
      while ((a = wa.nextNode()) && (b = wb.nextNode())) {
        var o = I.sourceText(a);
        if (o != null) b.nodeValue = o;
      }
      var ea = out.querySelectorAll('[title], [aria-label], [placeholder], [alt]');
      var eb = copy.querySelectorAll('[title], [aria-label], [placeholder], [alt]');
      for (var i = 0; i < ea.length && i < eb.length; i++) {
        ['title', 'aria-label', 'placeholder', 'alt'].forEach(function (attr) {
          var src = I.sourceAttr(ea[i], attr);
          if (src != null) eb[i].setAttribute(attr, src);
        });
      }
    }
    copy.querySelectorAll('canvas').forEach(function (c) {
      var p = document.createElement('p');
      p.className = 'mm-saved__chart';
      p.innerHTML = text('Chart not kept offline.');
      c.replaceWith(p);
    });
    copy.querySelectorAll('script, iframe, .leaflet-container').forEach(function (n) { n.remove(); });
    return copy.innerHTML;
  }

  function save(out) {
    var tool = out.getAttribute('data-out');
    if (!tool || LOCAL_ONLY[tool] || !isResult(out)) return;
    var html = snapshot(out);
    if (html.length > MAX_ENTRY) return;
    var all = readAll();
    all[tool] = { at: Date.now(), html: html, caption: captionFor(out) };
    writeAll(all);
  }

  /* ---------- the offline view ---------- */
  function needsLine(tool) {
    if (OFFLINE_OK[tool]) return text('Still works offline: run it and a simpler estimate is made on this phone.');
    if (PRICE_TOOLS[tool]) return text('It needs a connection to read district mandi prices.');
    return text('It needs a connection: this tool is worked out on the Mitti Mantra server.');
  }
  function offlineView(tool, opts) {
    opts = opts || {};
    var saved = tool ? get(tool) : null;
    var head = opts.backOnline
      ? '<strong>' + text('You are back online') + '</strong><p>' + text('Run the tool again for a fresh result.') + '</p>'
      : '<strong>' + text('You are offline') + '</strong><p>' + needsLine(tool) + '</p>';
    var html = '<div class="mm-offline" data-offline-tool="' + esc(tool || '') + '">' +
      '<div class="alert ' + (opts.backOnline ? 'alert--green' : 'alert--gold') + '" role="status">' + WIFI_OFF +
      '<div class="alert__body">' + head + '</div></div>';
    if (saved) {
      html += '<section class="mm-saved" aria-label="' + esc(window.AgriSimI18n && window.AgriSimI18n.t ? window.AgriSimI18n.t('Last result saved on this phone') : 'Last result saved on this phone') + '">' +
        '<p class="mm-saved__head">' + text('Last result saved on this phone') + ' · ' + NUM(esc(fmtWhen(saved.at))) +
        (saved.caption ? ' · ' + NUM(esc(saved.caption)) : '') + '</p>' +
        '<div class="mm-saved__copy">' + saved.html + '</div></section>';
    } else if (!OFFLINE_OK[tool] && tool) {
      html += '<p class="mm-saved__none">' + text('No earlier result is saved on this phone for this tool.') + '</p>';
    }
    return html + '</div>';
  }
  // The copy is a picture of an earlier answer: its buttons belonged to
  // listeners that no longer exist, so they are switched off, not left dead.
  function quiet(out) {
    out.querySelectorAll('.mm-saved__copy button, .mm-saved__copy input, .mm-saved__copy select, .mm-saved__copy textarea')
      .forEach(function (el) { el.disabled = true; });
    out.querySelectorAll('.mm-saved__copy [id]').forEach(function (el) { el.removeAttribute('id'); });
  }
  function showOffline(out, opts) {
    out.innerHTML = offlineView(out.getAttribute('data-out'), opts);
    quiet(out);
  }

  /* ---------- watching the panels ---------- */
  function watch() {
    var outputs = document.querySelectorAll('.output[data-out]');
    if (!outputs.length) return;
    var timers = new WeakMap();
    var obs = new MutationObserver(function (records) {
      var seen = new Set();
      records.forEach(function (r) {
        var out = r.target.closest ? r.target.closest('.output[data-out]') : null;
        if (!out || seen.has(out)) return;
        seen.add(out);
        clearTimeout(timers.get(out));
        // Let the tool finish (charts, follow-up fetches) before copying.
        timers.set(out, setTimeout(function () { save(out); }, 800));
      });
    });
    outputs.forEach(function (out) { obs.observe(out, { childList: true, subtree: true }); });

    var fillEmpty = function () {
      outputs.forEach(function (out) {
        var tool = out.getAttribute('data-out');
        if (out.firstElementChild || LOCAL_ONLY[tool] || tool === 'home') return;
        showOffline(out);
      });
    };
    if (navigator.onLine === false) fillEmpty();
    window.addEventListener('offline', fillEmpty);
    window.addEventListener('online', function () {
      outputs.forEach(function (out) {
        if (out.querySelector('.mm-offline')) showOffline(out, { backOnline: true });
      });
    });
  }

  /* ---------- nearest district with prices for a crop ---------- */
  var districtsP = null;
  var cropsByDistrict = {};   // district_id -> promise of its priced crops, per page
  function districts() {
    if (!districtsP) {
      districtsP = fetch('/api/v1/districts').then(function (r) {
        if (!r.ok) throw new Error('districts ' + r.status);
        return r.json();
      }).then(function (d) { return (d && d.districts) || []; });
      districtsP.catch(function () { districtsP = null; });
    }
    return districtsP;
  }
  function km(a, b) {
    var R = 6371, rad = Math.PI / 180;
    var dLat = (b.lat - a.lat) * rad, dLon = (b.lon - a.lon) * rad;
    var h = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLon / 2) * Math.sin(dLon / 2);
    return 2 * R * Math.asin(Math.sqrt(h));
  }
  // Up to `tries` nearest districts that report prices are asked whether
  // they price this crop (the same endpoint the crop chips use).
  function nearestWithPrices(regionId, cropId, tries) {
    tries = tries || 5;
    return districts().then(function (list) {
      var self = list.find(function (d) { return d.region_id === regionId || d.district_id === regionId; });
      if (!self || typeof self.lat !== 'number') return null;
      var near = list.filter(function (d) {
        return d.has_prices && d.district_id !== self.district_id && typeof d.lat === 'number';
      }).map(function (d) { return { d: d, km: km(self, d) }; })
        .sort(function (a, b) { return a.km - b.km; }).slice(0, tries);
      var step = function (i) {
        if (i >= near.length) return null;
        var c = near[i];
        var id = c.d.district_id;
        if (!cropsByDistrict[id]) {
          cropsByDistrict[id] = fetch('/api/v1/districts/' + encodeURIComponent(id) + '/price-forecast/crops')
            .then(function (r) { return r.ok ? r.json() : null; });
          cropsByDistrict[id].catch(function () { delete cropsByDistrict[id]; });
        }
        return cropsByDistrict[id]
          .then(function (r) {
            var has = r && (r.crops || []).some(function (x) { return x.crop_id === cropId; });
            return has ? { district: c.d, km: Math.round(c.km) } : step(i + 1);
          }, function () { return step(i + 1); });
      };
      return step(0);
    });
  }

  window.MMResults = { get: get, save: save, offlineView: offlineView, showOffline: showOffline, nearestWithPrices: nearestWithPrices };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', watch);
  else watch();
})();
