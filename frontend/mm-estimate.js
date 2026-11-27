/* =========================================================
   mm-estimate.js — Phase 4.4: one way to show a predicted number.

     PROFIT, 3 ACRES                                   ● Fair
     ₹31,800 – ₹1,21,988
     Most likely ₹61,806 · ROI 82%
     Yield records end in 2022: 4 years old.
     ▸ Why this range
     Source: District yield record · data to 2022 · How this is worked out

   - The headline is the range (8 seasons in 10), the most likely value
     smaller beneath it.
   - The confidence word (Strong / Fair / Weak) comes from the range width
     and how much data is behind it, never from a probability. Width is the
     80% profit range divided by the most likely profit. The thresholds
     below are PROVISIONAL, set from what the ranking returns for eight
     pilot districts in kharif and rabi (160 ranges): 110 of them dip into a
     loss; of the 50 that do not, width runs 1.15 (10th percentile), 1.44
     (25th), 1.73 (median), 1.99 (75th). Records hold 5–10 seasons and end
     2017–2022. Choosing them is an owner decision (plan, piece 9).
   - A range whose low end is a loss says so in words, whatever the word.
   - "Why" lists the drivers the response actually carries: the yield
     record, the range, the price used, the budget against the crop's
     typical cost, and that weather is the district's usual season, not a
     forecast.
   - Old data is said in words next to the number, not only in a badge.

   The markup is built as a string (dashboard.js renders results that way)
   inside an <mm-estimate> element; text() spans are translated by i18n.js.
   ========================================================= */
(function (root) {
  'use strict';

  // PROVISIONAL — owner decision pending. See the header.
  var THRESHOLDS = {
    strongWidth: 1.2,    // range ÷ most likely profit at or below this can be Strong
    weakWidth: 2.5,      // above this (or no profit expected) is Weak
    strongSeasons: 8,    // seasons behind the range needed for Strong
    weakSeasons: 6,      // fewer than this is Weak
    strongAge: 5,        // yield data at most this many years old for Strong
    weakAge: 8,          // older than this is Weak
  };

  /* Pure: { low, high, mid, cost, seasons, lastYear, thisYear, source } →
     { word: 'strong'|'fair'|'weak', width, age, why: [reason keys] } */
  function confidence(x) {
    var T = THRESHOLDS;
    var low = Number(x.low), high = Number(x.high);
    if (!isFinite(low) || !isFinite(high) || high < low) return { word: 'weak', width: null, age: null, why: ['no_range'] };
    var mid = Number(x.mid) || 0;
    var width = mid > 0 ? (high - low) / mid : Infinity;
    var seasons = x.seasons == null ? null : Number(x.seasons);
    var age = x.lastYear ? (Number(x.thisYear) || new Date().getFullYear()) - Number(x.lastYear) : null;
    var why = [];
    if (x.source === 'heuristic') why.push('no_record');
    if (width > T.weakWidth) why.push('wide');
    if (seasons != null && seasons < T.weakSeasons) why.push('few_seasons');
    if (age != null && age > T.weakAge) why.push('old_data');
    if (why.length) return { word: 'weak', width: width, age: age, why: why };
    // A range that dips into a loss is at best Fair.
    var strong = low >= 0 && width <= T.strongWidth && seasons != null && seasons >= T.strongSeasons && age != null && age <= T.strongAge;
    return { word: strong ? 'strong' : 'fair', width: width, age: age, why: strong ? ['narrow', 'long_record'] : ['middle'] };
  }

  var esc = function (s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  };
  var text = function (s) { return '<span>' + esc(s) + '</span>'; };
  var NUM = function (s) { return '<span data-no-translate>' + s + '</span>'; };
  var INR = function (n) {
    var v = Math.round(Number(n) || 0);
    return (v < 0 ? '−₹' : '₹') + Math.abs(v).toLocaleString('en-IN');
  };
  var WORDS = { strong: 'Strong', fair: 'Fair', weak: 'Weak' };
  var WORD_NOTE = {
    strong: 'Steadier than most: a tighter range, with a long and recent record behind it.',
    fair: 'A usable estimate. Seasons here vary, so plan for the whole range.',
    weak: 'Treat as a rough guide: the range is very wide, or little or old data is behind it.',
  };
  var SOURCE = {
    district_record: 'District yield record',
    yield_model: 'Yield model on district record',
    ml_model: 'Older yield model',
    heuristic: 'Estimate: no yield record here',
  };

  /* opts: { label, low, high, mid, midNote, conf, stale, drivers: [html], source, version, dataTo, cardHref } */
  function html(o) {
    var c = o.conf || { word: 'weak' };
    var range = (o.low != null && o.high != null)
      ? NUM(esc(INR(o.low) + ' – ' + INR(o.high)))
      : NUM(esc(INR(o.mid)));
    var out = '<mm-estimate class="mm-est mm-est--' + c.word + '">' +
      '<div class="mm-est__top"><span class="mm-est__label">' + (o.label || '') + '</span>' +
      '<span class="mm-est__word"><span class="mm-est__dot" aria-hidden="true"></span>' + text('Confidence:') + ' <strong>' + text(WORDS[c.word]) + '</strong></span></div>' +
      '<p class="mm-est__range">' + range + '</p>' +
      (o.low != null ? '<p class="mm-est__mid">' + text('Most likely') + ' ' + NUM(esc(INR(o.mid))) + (o.midNote ? ' · ' + o.midNote : '') + '</p>' : '') +
      '<p class="mm-est__note">' + text(WORD_NOTE[c.word]) + '</p>' +
      (o.low != null && o.low < 0 ? '<p class="mm-est__stale" role="note">' + text('The low end is a loss: in a bad season this crop loses money.') + '</p>' : '') +
      (o.stale ? '<p class="mm-est__stale" role="note">' + o.stale + '</p>' : '');
    if (o.drivers && o.drivers.length) {
      out += '<details class="mm-est__why"><summary>' + text('Why this range') + '</summary><ul>' +
        o.drivers.map(function (d) { return '<li>' + d + '</li>'; }).join('') + '</ul></details>';
    }
    out += '<p class="mm-est__src">' + text('Source:') + ' ' + text(SOURCE[o.source] || SOURCE.heuristic) +
      (o.dataTo ? ' · ' + text('data to') + ' ' + NUM(esc(o.dataTo)) : '') +
      (o.version ? ' · ' + text('model') + ' ' + NUM(esc(String(o.version).slice(0, 8))) : '') +
      (o.cardHref ? ' · <a href="' + esc(o.cardHref) + '"' + (o.cardTool ? ' data-goto-tool="' + esc(o.cardTool) + '"' : '') + '>' + text('How this is worked out') + '</a>' : '') +
      '<br>' + text('The range is calibrated on past seasons. It has not yet been checked against harvests recorded in this app.') + '</p>';
    return out + '</mm-estimate>';
  }

  /* A /api/crop or /api/crop-comparison row → html() options. */
  function fromRecommendation(r, ctx) {
    ctx = ctx || {};
    var area = ctx.area || 1;
    var b = r.yield_basis || {};
    var risk = r.risk_basis || {};
    var p = Array.isArray(r.profit_range) && r.profit_range.length === 2 ? r.profit_range : null;
    var y = Array.isArray(r.yield_range_kg_per_acre) && r.yield_range_kg_per_acre.length === 2 ? r.yield_range_kg_per_acre : null;
    var thisYear = ctx.thisYear || new Date().getFullYear();
    var conf = confidence({ low: p && p[0], high: p && p[1], mid: r.expected_profit, cost: r.planned_cost,
      seasons: risk.seasons_on_record != null ? risk.seasons_on_record : b.years_on_record,
      lastYear: b.last_year, thisYear: thisYear, source: r.prediction_source });
    var kg = function (n) { return Math.round(n).toLocaleString('en-IN'); };
    var drivers = [];
    if (r.predicted_yield_kg_per_acre != null) {
      drivers.push(text('Yield:') + ' ' + NUM(kg(r.predicted_yield_kg_per_acre) + ' kg/acre') +
        (b.years_on_record ? ' · ' + NUM(b.years_on_record) + ' ' + text('seasons on record') : '') +
        (b.last_year ? ' (' + text('last recorded') + ' ' + NUM(b.last_year) + ')' : '') + '.');
    }
    if (y) drivers.push(text('Range: 8 seasons in 10 fell between') + ' ' + NUM(kg(y[0]) + '–' + kg(y[1]) + ' kg/acre') + '.');
    if (r.price_per_kg != null) drivers.push(text('Price used for the sale:') + ' ' + NUM('₹' + Number(r.price_per_kg).toFixed(2) + '/kg') + '.');
    if (r.budget_coverage != null) {
      drivers.push(r.budget_coverage < 0.995
        ? text('Your budget covers') + ' ' + NUM(Math.round(r.budget_coverage * 100) + '%') + ' ' + text("of this crop's typical input cost, so yield is scaled down.")
        : text("Your budget covers this crop's typical input cost."));
    }
    drivers.push(text("Weather: the district's usual season. This is not a rainfall forecast."));
    var age = conf.age;
    var stale = age != null && age >= 3
      ? text('Yield records end in') + ' ' + NUM(b.last_year) + ': ' + NUM(age) + ' ' + text('years old.')
      : '';
    return {
      label: ctx.label || '', low: p && p[0], high: p && p[1], mid: r.expected_profit,
      midNote: r.roi_percent != null ? 'ROI ' + NUM(Math.round(r.roi_percent) + '%') : '',
      conf: conf, stale: stale, drivers: drivers, source: r.prediction_source,
      dataTo: b.last_year, version: b.model_version, cardHref: ctx.cardHref, cardTool: ctx.cardTool,
    };
  }

  var api = { THRESHOLDS: THRESHOLDS, confidence: confidence, html: html, fromRecommendation: fromRecommendation };
  root.MMEstimate = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;

  // A known element (block, styleable), no shadow DOM: i18n.js must see its text.
  if (root.customElements && !root.customElements.get('mm-estimate')) {
    root.customElements.define('mm-estimate', class extends HTMLElement {});
  }
})(typeof window !== 'undefined' ? window : globalThis);
