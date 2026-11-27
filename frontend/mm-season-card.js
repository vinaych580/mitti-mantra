/* =========================================================
   mm-season-card.js — Phase 4.1 (home part): "My season" at the top of
   My Farm.

   Before a plan exists: the planner entry, one button.
   After: the season as six steps (Plan, Prepare land, Sow, Grow, Harvest,
   Sell), the step the farmer is in, and one primary action for it.

   Where the farmer is comes from the saved plan (season-plan.js, kept with
   the plot by farm-state.js):
     - with a sowing date: days since sowing against the crop's duration;
     - without one: the crop's reference calendar windows for the season
       ("Jun 01 - Jun 30"), and the card says it is reading the calendar.
   No date is invented: a step with no window and no sowing date shows no
   date, and a crop with no calendar shows the steps without a position.

   Whether this replaces My Farm as the first screen is an owner decision
   (plan, piece 6). Until then it sits at the top of My Farm, which is
   already the first screen.
   ========================================================= */
(function () {
  'use strict';

  var host = document.querySelector('[data-season-card]');
  if (!host) return;

  var esc = function (s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  };
  var text = function (s) { return '<span>' + esc(s) + '</span>'; };
  var NUM = function (s) { return '<span data-no-translate>' + s + '</span>'; };
  var DAY = 86400000;

  var STEPS = ['Plan', 'Prepare land', 'Sow', 'Grow', 'Harvest', 'Sell'];
  // One primary action per step: a tool that answers that step's question.
  var ACTIONS = [
    { label: 'Check what to prepare', tool: 'calendar' },
    { label: 'Check what to prepare', tool: 'calendar' },
    { label: 'Sowing and first fertilizer', tool: 'fertilizer' },
    { label: "This week's field tasks", href: 'season.html' },
    { label: 'When to sell', tool: 'sell' },
    { label: 'Record harvest and sales', tool: 'expense' },
  ];
  var MONTHS = { jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5, jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11 };

  function lang() {
    try { return (window.AgriSimI18n && window.AgriSimI18n.getLanguage()) || 'en'; } catch (_) { return 'en'; }
  }
  function fmt(d) {
    var tag = { en: 'en-IN', hi: 'hi-IN', te: 'te-IN', kn: 'kn-IN', ta: 'ta-IN' }[lang()] || 'en-IN';
    try { return d.toLocaleDateString(tag, { day: 'numeric', month: 'short' }); } catch (_) { return d.toDateString(); }
  }
  function today() { var d = new Date(); d.setHours(12, 0, 0, 0); return d; }

  /* "May 15 - Jun 01", "Jun 01 - Jun 30 (after showers)", "Oct - Dec (...)"
     → { start, end } in the season's year. A rabi season that starts in
     October has its January–June months in the next year; so does a kharif
     harvest that runs into January. */
  function windowOf(str, season, year) {
    var m = String(str || '').match(/\b([A-Z][a-z]{2})[a-z]*\.?(?:\s+(\d{1,2}))?\s*[-–]\s*([A-Z][a-z]{2})[a-z]*\.?(?:\s+(\d{1,2}))?/);
    if (!m) return null;
    var m1 = MONTHS[m[1].toLowerCase()], m2 = MONTHS[m[3].toLowerCase()];
    if (m1 == null || m2 == null) return null;
    var yr = function (mon) {
      if (season === 'rabi') return mon < 7 ? year + 1 : year;
      if (season === 'kharif') return mon < 3 ? year + 1 : year;
      return year;
    };
    var start = new Date(yr(m1), m1, m[2] ? +m[2] : 1, 12);
    var end = m[4] ? new Date(yr(m2), m2, +m[4], 12) : new Date(yr(m2), m2 + 1, 0, 12);
    if (end < start) end = new Date(end.getFullYear() + 1, end.getMonth(), end.getDate(), 12);
    return { start: start, end: end };
  }

  function planNow() {
    var F = window.FarmState;
    var plot = F && F.load ? F.load() : null;
    var plans = (plot && plot.seasonPlans) || [];
    if (!plans.length) return null;
    var S = window.MMSeason;
    var season = (window.MM && window.MM.profile && window.MM.profile.get().season) || 'kharif';
    var key = S && S.scope ? S.scope(season) : null;
    // This season's latest plan, else the newest plan of any season.
    var mine = plans.filter(function (p) { return p.season_key === key; });
    return (mine.length ? mine : plans).slice(-1)[0];
  }

  var calCache = {};
  function calendarFor(plan) {
    var crop = (plan.comparison && plan.comparison.crops || []).find(function (c) { return c.crop_id === plan.crop_id; });
    if (crop && crop.calendar) return Promise.resolve(crop.calendar);
    var season = String(plan.season_key || '').split('-')[0] || (plan.inputs && plan.inputs.season);
    var id = plan.crop_id + ':' + season;
    if (!calCache[id]) {
      calCache[id] = fetch('/api/crop-calendar/' + encodeURIComponent(plan.crop_id))
        .then(function (r) { return r.ok ? r.json() : null; })
        .then(function (r) { return (r && r.seasons && r.seasons[season]) || null; })
        .catch(function () { delete calCache[id]; return null; });
    }
    return calCache[id];
  }

  /* Which of the six steps, and the dates to show under each. */
  function position(plan, cal) {
    var parts = String(plan.season_key || '').split('-');
    var season = parts[0], year = +parts[1] || new Date().getFullYear();
    var now = today();
    var dates = [new Date(plan.saved_at), null, null, null, null, null];
    var prep = cal && windowOf(cal.land_prep, season, year);
    var sow = cal && windowOf(cal.sowing_transplant, season, year);
    var harvest = cal && windowOf(cal.harvest_window, season, year);
    var duration = cal && +cal.duration_days > 0 ? +cal.duration_days : null;
    var sown = plan.sowing_date ? new Date(plan.sowing_date + 'T12:00:00') : null;
    if (sown && isNaN(sown)) sown = null;
    // A saved sowing date outranks the calendar; its land-prep window would
    // contradict a crop sown outside it.
    if (prep && !sown) dates[1] = prep;
    if (sown) dates[2] = { start: sown };
    else if (sow) dates[2] = sow;
    if (sown && duration) dates[4] = { start: new Date(sown.getTime() + (duration - 15) * DAY), end: new Date(sown.getTime() + (duration + 15) * DAY), about: true };
    else if (harvest) dates[4] = harvest;

    var step = 0, basis = 'calendar', das = null;
    if (sown) {
      basis = 'sowing';
      das = Math.floor((now - sown) / DAY);
      var hStart = dates[4] && dates[4].start, hEnd = dates[4] && dates[4].end;
      if (das < 0) step = -das <= 30 ? 1 : 0;
      else if (das < 10) step = 2;
      else if (hStart && now < hStart) step = 3;
      else if (hEnd && now <= hEnd) step = 4;
      else if (hEnd) step = 5;
      else step = 3;
    } else if (sow) {
      var prepStart = prep ? prep.start : new Date(sow.start.getTime() - 30 * DAY);
      if (now < prepStart) step = 0;
      else if (now < sow.start) step = 1;
      else if (now <= sow.end) step = 2;
      else if (harvest && now < harvest.start) step = 3;
      else if (harvest && now <= harvest.end) step = 4;
      else if (harvest) step = 5;
      else step = 3;
    } else {
      basis = 'none';
    }
    return { step: step, basis: basis, das: das, duration: duration, dates: dates };
  }

  function dateLine(d) {
    if (!d) return '';
    if (d instanceof Date) return NUM(esc(fmt(d)));
    var s = fmt(d.start);
    var e = d.end ? fmt(d.end) : '';
    return (d.about ? text('about') + ' ' : '') + NUM(esc(e && e !== s ? s + ' – ' + e : s));
  }

  function actionHtml(a, primary) {
    var cls = primary ? 'btn btn-primary' : 'btn btn-ghost';
    if (a.href) return '<a class="' + cls + '" href="' + esc(a.href) + '">' + text(a.label) + '</a>';
    return '<a class="' + cls + '" href="dashboard.html?tool=' + esc(a.tool) + '" data-goto-tool="' + esc(a.tool) + '">' + text(a.label) + '</a>';
  }

  function emptyHtml() {
    return '<div class="mm-season mm-season--empty">' +
      '<p class="mm-season__eyebrow">' + text('My season') + '</p>' +
      '<h3 class="mm-season__title">' + text('No season plan yet') + '</h3>' +
      '<p class="mm-season__lede">' + text('Compare crops for your field and save the one you choose. This card then follows it from sowing to sale.') + '</p>' +
      '<div class="mm-season__actions"><a class="btn btn-primary" href="decide.html">' + text('Plan your season') + '</a></div></div>';
  }

  function planHtml(plan, pos) {
    var acres = plan.inputs && plan.inputs.area_acres;
    var steps = STEPS.map(function (label, i) {
      var state = pos.basis === 'none' ? '' : i < pos.step ? ' is-done' : i === pos.step ? ' is-now' : '';
      return '<li class="mm-season__step' + state + '"' + (pos.basis !== 'none' && i === pos.step ? ' aria-current="step"' : '') + '>' +
        '<span class="mm-season__dot" aria-hidden="true"></span>' +
        '<span class="mm-season__name">' + text(label) + '</span>' +
        '<span class="mm-season__date">' + dateLine(pos.dates[i]) + '</span></li>';
    }).join('');

    var where;
    if (pos.basis === 'none') {
      where = text('No crop calendar is available for this crop, so the card cannot place you in the season.');
    } else {
      where = '<strong>' + text('Now:') + ' ' + text(STEPS[pos.step]) + '</strong>';
      if (pos.basis === 'sowing' && pos.das != null && pos.das >= 0 && pos.step === 3) {
        where += ' · ' + text('day') + ' ' + NUM(pos.das) + (pos.duration ? ' ' + text('of about') + ' ' + NUM(pos.duration) : '');
      } else if (pos.dates[pos.step] && pos.step > 0) {
        // The step's window, here as well as on the track (a phone hides
        // the track's dates).
        where += ' · ' + dateLine(pos.dates[pos.step]);
      }
      where += '<br><small>' + (pos.basis === 'sowing'
        ? text('Counted from the sowing date in your plan.')
        : text('Read from the crop’s reference calendar. Save a sowing date in the planner for exact days.')) + '</small>';
    }
    var act = ACTIONS[pos.basis === 'none' ? 0 : pos.step];
    return '<div class="mm-season">' +
      '<p class="mm-season__eyebrow">' + text('My season') + ' · ' + NUM(esc(plan.season_key || '')) + '</p>' +
      '<h3 class="mm-season__title">' + NUM(esc(plan.crop_name || plan.crop_id)) + (acres ? ' · ' + NUM(esc(acres)) + ' ' + text('acres') : '') + '</h3>' +
      '<ol class="mm-season__track">' + steps + '</ol>' +
      '<p class="mm-season__where" role="status">' + where + '</p>' +
      '<div class="mm-season__actions">' + actionHtml(act, true) +
      '<a class="mm-season__more" href="season.html">' + text('Open My season') + '</a></div></div>';
  }

  var seq = 0;
  var painting = false;   // retranslate() fires mm:lang-changed itself
  function render() {
    var mySeq = ++seq;
    var plan = planNow();
    if (!plan) { paint(emptyHtml()); return; }
    calendarFor(plan).then(function (cal) {
      if (mySeq !== seq) return;
      paint(planHtml(plan, position(plan, cal)));
    });
  }
  function paint(html) {
    host.innerHTML = html;
    if (window.AgriSimI18n && lang() !== 'en') {
      painting = true;
      try { window.AgriSimI18n.retranslate(); } finally { painting = false; }
    }
  }

  ['mm:plan-saved', 'mm:plot-changed', 'mm:profile-changed', 'mm:lang-changed'].forEach(function (ev) {
    document.addEventListener(ev, function () { if (!painting) render(); });
  });
  window.addEventListener('storage', function (e) { if (!e.key || /farm|plot|profile|season/i.test(e.key)) render(); });
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', render);
  else render();

  // Exposed for tests and the demo path (piece 15).
  window.MMSeasonCard = { render: render, position: position, windowOf: windowOf };
})();
