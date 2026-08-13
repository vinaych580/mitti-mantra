/*
 * mm-analytics.js — local-first, privacy-respecting usage counters.
 *
 * Why: the dashboard ships fourteen tools and nothing recorded which ones
 * anyone opens, so there was no way to tell where effort was worth spending.
 *
 * What this does NOT do, by construction:
 *   • no user ids, session ids, device fingerprints or cookies
 *   • no free text, no form values, no region/crop/farm data
 *   • no page URLs, referrers or IP-linked data
 *   • no third-party requests of any kind
 *
 * Events are counters keyed by a lowercase snake_case name, kept in
 * localStorage on the user's own device. They are shown back to the user
 * ("your most used tools") and are never transmitted unless the user turns on
 * sharing AND the server has ENABLE_USAGE_COLLECTION=true. Even then, only the
 * name->count map is sent.
 *
 * Public API:
 *   MM.track(name)                  record one event
 *   MM.analytics.summary()          {total, events:[{event,count}], since}
 *   MM.analytics.isEnabled()        local counting on/off (default on)
 *   MM.analytics.setEnabled(bool)
 *   MM.analytics.isSharing()        upload opt-in (default OFF)
 *   MM.analytics.setSharing(bool)
 *   MM.analytics.reset()            wipe all local counters
 *
 * Load AFTER mm-core.js.
 */
(function () {
  'use strict';

  var LS_COUNTS = 'mm_usage_counts_v1';
  var LS_PREFS = 'mm_usage_prefs_v1';
  var FLUSH_DELAY_MS = 4000;

  var EVENT_RE = /^[a-z][a-z0-9_]{0,48}$/;

  var prefs = readPrefs();
  var counts = readCounts();
  var dirty = false;
  var flushTimer = null;
  var serverAcceptsUploads = null;   // unknown until /api/usage/config answers

  /* ---------- storage ---------- */

  function readPrefs() {
    var defaults = { enabled: true, sharing: false, since: new Date().toISOString().slice(0, 10) };
    try {
      return Object.assign(defaults, JSON.parse(localStorage.getItem(LS_PREFS) || '{}'));
    } catch (_) {
      return defaults;
    }
  }

  function writePrefs() {
    try { localStorage.setItem(LS_PREFS, JSON.stringify(prefs)); } catch (_) {}
  }

  function readCounts() {
    try {
      var raw = JSON.parse(localStorage.getItem(LS_COUNTS) || '{}');
      return (raw && typeof raw === 'object') ? raw : {};
    } catch (_) {
      return {};
    }
  }

  function writeCounts() {
    try { localStorage.setItem(LS_COUNTS, JSON.stringify(counts)); } catch (_) {}
  }

  /* ---------- recording ---------- */

  function track(name) {
    if (!prefs.enabled) return;
    if (typeof name !== 'string' || !EVENT_RE.test(name)) return;
    counts[name] = (counts[name] || 0) + 1;
    dirty = true;
    writeCounts();
    scheduleFlush();
  }

  function summary() {
    var ranked = Object.keys(counts)
      .map(function (k) { return { event: k, count: counts[k] }; })
      .sort(function (a, b) { return b.count - a.count; });
    var total = ranked.reduce(function (sum, e) { return sum + e.count; }, 0);
    return { total: total, events: ranked, since: prefs.since };
  }

  function reset() {
    counts = {};
    writeCounts();
  }

  /* ---------- optional sharing ---------- */

  function serverConfig() {
    if (serverAcceptsUploads !== null) return Promise.resolve(serverAcceptsUploads);
    return fetch('/api/usage/config', { headers: { Accept: 'application/json' } })
      .then(function (r) { return r.ok ? r.json() : { collection_enabled: false }; })
      .then(function (cfg) {
        serverAcceptsUploads = !!cfg.collection_enabled;
        return serverAcceptsUploads;
      })
      .catch(function () {
        serverAcceptsUploads = false;
        return false;
      });
  }

  function scheduleFlush() {
    if (!prefs.sharing || flushTimer) return;
    flushTimer = setTimeout(function () {
      flushTimer = null;
      flush();
    }, FLUSH_DELAY_MS);
  }

  function flush() {
    if (!prefs.sharing || !dirty) return Promise.resolve(false);
    return serverConfig().then(function (ok) {
      if (!ok) return false;
      var payload = { counts: counts };
      return fetch('/api/usage/collect', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        keepalive: true
      }).then(function (res) {
        if (!res.ok) return false;
        // Counts are cumulative on the client and additive on the server, so
        // clear after a confirmed upload to avoid double-counting.
        counts = {};
        writeCounts();
        dirty = false;
        return true;
      }).catch(function () { return false; });
    });
  }

  /* ---------- auto-instrumentation ---------- */

  function slug(text) {
    return String(text || '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '_')
      .replace(/^_+|_+$/g, '')
      .slice(0, 32);
  }

  function instrument() {
    // Dashboard tool opens. Tool panels are addressed by ?tool=<name> deep
    // links and by nav elements carrying data-tool.
    document.addEventListener('click', function (e) {
      var el = e.target && e.target.closest ? e.target.closest('[data-tool]') : null;
      if (!el) return;
      var name = slug(el.getAttribute('data-tool'));
      if (name) track('tool_open_' + name);
    }, true);

    // Deep-linked tool on first paint.
    try {
      var tool = slug(new URLSearchParams(location.search).get('tool'));
      if (tool) track('tool_open_' + tool);
    } catch (_) {}

    // Successful tool runs, via the event dashboard.js already dispatches.
    window.addEventListener('mitti-api-success', function (e) {
      var url = (e.detail && e.detail.url) || '';
      var match = /\/api\/([a-z0-9\-\/]+)/i.exec(url);
      if (!match) return;
      var name = slug(match[1].split('/')[0]);
      if (name) track('api_' + name);
    });

    // Language switches — which languages actually get used.
    document.addEventListener('mm:lang-changed', function (e) {
      var lang = slug(e.detail && e.detail.lang);
      if (lang) track('lang_' + lang);
    });

    // Plot switches, for whether multi-plot is worth extending.
    document.addEventListener('mm:plot-changed', function () { track('plot_switch'); });

    // Best-effort final flush without blocking navigation.
    window.addEventListener('pagehide', function () { flush(); });
  }

  /* ---------- public ---------- */

  var api = {
    track: track,
    summary: summary,
    reset: reset,
    isEnabled: function () { return !!prefs.enabled; },
    setEnabled: function (on) {
      prefs.enabled = !!on;
      writePrefs();
      if (!on) reset();
    },
    isSharing: function () { return !!prefs.sharing; },
    setSharing: function (on) {
      prefs.sharing = !!on;
      writePrefs();
      if (on) flush();
    },
    serverAcceptsUploads: serverConfig,
    flush: flush
  };

  // mm-core.js bails on `if (window.MM) return;`, so never create MM here.
  if (window.MM) {
    window.MM.analytics = api;
    window.MM.track = track;
  } else {
    window.MMAnalytics = api;
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', instrument);
  } else {
    instrument();
  }
})();
