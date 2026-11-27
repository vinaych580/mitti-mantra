/* =========================================================
   mm-setup.js — Phase 4.3: one place to say where the farm is.

   MMSetup.enhance(select) turns a page's region <select> (landing ask
   form, planner step 1, dashboard farm bar and My Farm setup) into the
   same picker everywhere:

     State ▾   District [type to search]   ⌖ Use my location
     ✓ Yields · ✓ Weather · ✗ Mandi prices
     Plans use Medak, Telangana: the nearest district with full planning
     data (35 km away).

   - Districts: all 765 the server's district store knows (/api/v1/districts:
     name, state, point, which datasets cover it). Fetched once, when the
     page is idle or the picker is touched.
   - "Use my location" asks the browser for a position and finds the nearest
     district point on this phone. The coordinates are never sent anywhere.
   - The planning tools work on 30 pilot regions. A district that is one of
     them is used directly; any other district is mapped to the nearest pilot
     district, and the picker says so in words. The original <select> stays
     in the form, hidden, as the value every existing script reads, and gets
     a normal `change` event, so nothing downstream changes.
   - The district the farmer picked is remembered on this phone
     (mm_district) only while it still maps to the selected region.
   - If the district store is unavailable (503, offline with nothing cached),
     the original <select> is left exactly as it was.

   Typical-cost helper: MMSetup.typicalCost(budgetInput, getRegion, getSeason)
   adds the "Typical cost here: ₹…/acre" line under a budget field, the same
   figure decide.js and the landing page already show (MM.defaultBudget,
   /api/budget-default, dataset/crop_parameters.csv).
   ========================================================= */
(function () {
  'use strict';

  var KEY = 'mm_district';
  var esc = function (s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  };
  var text = function (s) { return '<span>' + esc(s) + '</span>'; };
  var NUM = function (s) { return '<span data-no-translate>' + s + '</span>'; };
  var t = function (s) { return window.AgriSimI18n && window.AgriSimI18n.t ? window.AgriSimI18n.t(s) : s; };
  // retranslate() itself fires mm:lang-changed, which this file listens to:
  // the flag stops that from re-rendering and recursing.
  var translating = false;
  var retranslate = function () {
    if (translating) return;
    translating = true;
    try { if (window.AgriSimI18n && window.AgriSimI18n.getLanguage() !== 'en') window.AgriSimI18n.retranslate(); }
    catch (_) { /* ignore */ }
    finally { translating = false; }
  };
  var seq = 0;

  /* ---------- data ---------- */
  var listP = null;
  function districts() {
    if (!listP) {
      listP = fetch('/api/v1/districts').then(function (r) {
        if (!r.ok) throw new Error('districts ' + r.status);
        return r.json();
      }).then(function (d) {
        var rows = (d && d.districts) || [];
        if (!rows.length) throw new Error('no districts');
        return rows;
      });
      listP.catch(function () { listP = null; });
    }
    return listP;
  }
  var oneCache = {};
  function districtRecord(id) {
    if (!oneCache[id]) {
      oneCache[id] = fetch('/api/v1/districts/' + encodeURIComponent(id)).then(function (r) {
        if (!r.ok) throw new Error('district ' + r.status);
        return r.json();
      });
      oneCache[id].catch(function () { delete oneCache[id]; });
    }
    return oneCache[id];
  }
  function km(a, b) {
    var R = 6371, rad = Math.PI / 180;
    var dLat = (b.lat - a.lat) * rad, dLon = (b.lon - a.lon) * rad;
    var h = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLon / 2) * Math.sin(dLon / 2);
    return 2 * R * Math.asin(Math.sqrt(h));
  }
  function nearest(list, point, filter) {
    var best = null, bestKm = Infinity;
    list.forEach(function (d) {
      if (typeof d.lat !== 'number' || (filter && !filter(d))) return;
      var k = km(point, d);
      if (k < bestKm) { bestKm = k; best = d; }
    });
    return best ? { d: best, km: Math.round(bestKm) } : null;
  }
  // The pilot region a district plans with, and how far away it is.
  function pilotFor(list, d) {
    if (d.region_id) return { d: d, km: 0 };
    return nearest(list, d, function (x) { return !!x.region_id; });
  }
  function remembered() {
    try { return JSON.parse(localStorage.getItem(KEY) || 'null'); } catch (_) { return null; }
  }
  function remember(d, regionId) {
    try {
      localStorage.setItem(KEY, JSON.stringify({ district_id: d.district_id, district_name: d.district_name,
        state_name: d.state_name, region_id: regionId }));
    } catch (_) { /* this phone keeps no memory of it; the region still applies */ }
    document.dispatchEvent(new CustomEvent('mm:district-changed', { detail: { district_id: d.district_id, region_id: regionId } }));
  }
  function stateLabel(name) { return t(name); }
  function norm(s) { return String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, ''); }

  /* ---------- the picker ---------- */
  function enhance(select, opts) {
    opts = opts || {};
    if (!select || select.dataset.mmSetup) return null;
    select.dataset.mmSetup = '1';
    var id = 'mmw' + (++seq);
    var wrap = document.createElement('div');
    wrap.className = 'mm-where' + (opts.compact ? ' mm-where--compact' : '');
    wrap.hidden = true; // until the district store answers
    wrap.innerHTML =
      '<div class="mm-where__fields">' +
        '<label class="mm-where__f"><span class="mm-where__lbl">' + text('State') + '</span>' +
          '<select class="mm-where__state" id="' + id + 's"></select></label>' +
        '<div class="mm-where__f mm-where__dist">' +
          '<label class="mm-where__lbl" for="' + id + 'd">' + text('District') + '</label>' +
          '<input class="mm-where__input" id="' + id + 'd" type="text" role="combobox" autocomplete="off" spellcheck="false"' +
            ' aria-autocomplete="list" aria-expanded="false" aria-controls="' + id + 'l">' +
          '<ul class="mm-where__list" id="' + id + 'l" role="listbox" hidden></ul>' +
        '</div>' +
      '</div>' +
      '<div class="mm-where__row">' +
        '<button type="button" class="mm-where__locate"><svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><circle cx="12" cy="12" r="4"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3"/></svg>' + text('Use my location') + '</button>' +
        '<span class="mm-where__msg" role="status"></span>' +
      '</div>' +
      '<p class="mm-where__cover"></p>';

    // Where it goes: after the select, or after a <label> that wraps it (a
    // label must not contain a second set of controls).
    var anchor = select.parentElement && select.parentElement.tagName === 'LABEL' ? select.parentElement : select;
    anchor.insertAdjacentElement('afterend', wrap);
    // On the landing ask form the fields take that form's own field style
    // (ruled lines over the photo, and its dark-theme exceptions).
    if (anchor.classList && anchor.classList.contains('ask__field')) {
      wrap.querySelectorAll('.mm-where__f').forEach(function (f) { f.classList.add('ask__field'); });
    }

    var stateSel = wrap.querySelector('.mm-where__state');
    var input = wrap.querySelector('.mm-where__input');
    var listEl = wrap.querySelector('.mm-where__list');
    var msg = wrap.querySelector('.mm-where__msg');
    var cover = wrap.querySelector('.mm-where__cover');
    var all = null, current = null, matches = [], active = -1;

    function showPicker() {
      wrap.hidden = false;
      select.hidden = true;
      select.setAttribute('aria-hidden', 'true');
      select.tabIndex = -1;
      if (anchor !== select) anchor.hidden = true;
      var outer = select.id && document.querySelector('label[for="' + CSS.escape(select.id) + '"]');
      if (outer) outer.htmlFor = input.id;
    }

    function setCover(d) {
      if (!d) { cover.innerHTML = ''; return; }
      var item = function (on, label) {
        return '<span class="mm-cov ' + (on ? 'mm-cov--yes' : 'mm-cov--no') + '"><span aria-hidden="true">' + (on ? '✓' : '✗') + '</span> ' +
          text(label) + '<span class="mm-sr">' + text(on ? '(on record)' : '(none on record)') + '</span></span>';
      };
      var html = '<span class="mm-where__covlbl">' + text('District records:') + '</span> ' +
        item(d.has_yields, 'Yields') + item(d.has_weather, 'Weather') + item(d.has_prices, 'Mandi prices');
      if (current && current.pilot && current.pilot.d.district_id !== d.district_id) {
        html += '<br><span class="mm-where__pilot">' + text('Plans use') + ' <strong>' +
          NUM(esc(current.pilot.d.district_name + ', ' + current.pilot.d.state_name)) + '</strong>: ' +
          text('the nearest district with full planning data') +
          (current.pilot.km != null ? ' (' + NUM(current.pilot.km) + ' ' + text('km from your district') + ')' : '') + '.</span>';
      } else if (d.region_id) {
        html += '<br><span class="mm-where__pilot">' + text('Full planning data for this district.') + '</span>';
      }
      cover.innerHTML = html;
      retranslate();
    }

    function fillStates(selectedState) {
      if (!all) return;
      var states = [];
      all.forEach(function (d) { if (states.indexOf(d.state_name) < 0) states.push(d.state_name); });
      states.sort();
      stateSel.innerHTML = '<option value="">' + esc(t('All states')) + '</option>' + states.map(function (s) {
        return '<option value="' + esc(s) + '"' + (s === selectedState ? ' selected' : '') + '>' + esc(stateLabel(s)) + '</option>';
      }).join('');
    }

    // Show district d (and the pilot it plans with) without touching the select.
    function display(d, pilot) {
      current = { d: d, pilot: pilot };
      input.value = d.district_name;
      if (!all) stateSel.innerHTML = '<option value="' + esc(d.state_name) + '">' + esc(stateLabel(d.state_name)) + '</option>';
      else stateSel.value = d.state_name;
      setCover(d);
    }

    // A district chosen by the farmer: set the region select and say so.
    function choose(d) {
      if (!all) return;
      var pilot = pilotFor(all, d);
      if (!pilot) return;
      display(d, pilot);
      closeList();
      var rid = pilot.d.region_id;
      if (!select.querySelector('option[value="' + CSS.escape(rid) + '"]')) {
        var o = document.createElement('option');
        o.value = rid; o.textContent = pilot.d.district_name + ' (' + pilot.d.state_name + ')';
        select.appendChild(o);
      }
      if (select.value !== rid) {
        select.value = rid;
        select.dispatchEvent(new Event('input', { bubbles: true }));
        select.dispatchEvent(new Event('change', { bubbles: true }));
      }
      remember(d, rid);
    }

    // The select changed (initial fill, voice, another script): show it.
    function fromSelect() {
      var rid = select.value;
      if (!rid) return;
      if (current && current.pilot && current.pilot.d.region_id === rid) return;
      var mem = remembered();
      var wantId = mem && mem.region_id === rid ? mem.district_id : null;
      var finish = function (d, pilotRec) {
        if (select.value !== rid) return;
        var pilot = all ? pilotFor(all, d) : { d: pilotRec, km: pilotRec.district_id === d.district_id ? 0 : null };
        display(d, pilot);
      };
      districtRecord(rid).then(function (pilotRec) {
        if (!wantId || wantId === pilotRec.district_id) { finish(pilotRec, pilotRec); return; }
        var fromList = all && all.find(function (x) { return x.district_id === wantId; });
        (fromList ? Promise.resolve(fromList) : districtRecord(wantId))
          .then(function (d) { finish(d, pilotRec); }, function () { finish(pilotRec, pilotRec); });
      }).catch(function () { /* the select keeps working on its own */ });
    }

    function loadList() {
      return districts().then(function (rows) {
        all = rows;
        fillStates(current && current.d.state_name);
        if (current) display(current.d, pilotFor(all, current.d));
        return rows;
      });
    }

    /* ----- combobox ----- */
    function renderList() {
      var q = norm(input.value.trim());
      var st = stateSel.value;
      var pool = (all || []).filter(function (d) { return !st || d.state_name === st; });
      var starts = [], contains = [];
      pool.forEach(function (d) {
        var n = norm(d.district_name);
        if (!q || n.indexOf(q) === 0) starts.push(d);
        else if (n.indexOf(q) > 0 || (!st && norm(d.state_name).indexOf(q) === 0)) contains.push(d);
      });
      var byName = function (a, b) { return a.district_name.localeCompare(b.district_name); };
      matches = starts.sort(byName).concat(contains.sort(byName)).slice(0, 8);
      active = matches.length ? 0 : -1;
      if (!matches.length) {
        listEl.innerHTML = '<li class="mm-where__none" role="option" aria-disabled="true">' + esc(t('No district by that name')) + '</li>';
      } else {
        listEl.innerHTML = matches.map(function (d, i) {
          return '<li role="option" id="' + id + 'o' + i + '" data-i="' + i + '"' + (i === active ? ' aria-selected="true"' : '') + '>' +
            '<span>' + esc(d.district_name) + '</span><small>' + esc(stateLabel(d.state_name)) + '</small></li>';
        }).join('');
      }
      listEl.hidden = false;
      input.setAttribute('aria-expanded', 'true');
      input.setAttribute('aria-activedescendant', active >= 0 ? id + 'o' + active : '');
    }
    function move(step) {
      if (!matches.length) return;
      active = (active + step + matches.length) % matches.length;
      listEl.querySelectorAll('[role="option"]').forEach(function (li, i) { li.setAttribute('aria-selected', String(i === active)); });
      input.setAttribute('aria-activedescendant', id + 'o' + active);
      var li = listEl.querySelector('#' + id + 'o' + active);
      if (li && li.scrollIntoView) li.scrollIntoView({ block: 'nearest' });
    }
    function closeList() {
      listEl.hidden = true;
      input.setAttribute('aria-expanded', 'false');
      input.removeAttribute('aria-activedescendant');
    }
    input.addEventListener('focus', function () {
      loadList().then(function () { if (document.activeElement === input) { input.select(); renderList(); } }).catch(function () {});
    });
    input.addEventListener('input', function () { if (all) renderList(); });
    input.addEventListener('keydown', function (e) {
      if (e.key === 'ArrowDown') { e.preventDefault(); if (listEl.hidden) renderList(); else move(1); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); move(-1); }
      else if (e.key === 'Enter') {
        if (!listEl.hidden && matches[active]) { e.preventDefault(); choose(matches[active]); }
      } else if (e.key === 'Escape') {
        if (!listEl.hidden) { e.preventDefault(); e.stopPropagation(); closeList(); if (current) input.value = current.d.district_name; }
      }
    });
    // pointerdown, not click: it lands before the input's blur closes the list.
    listEl.addEventListener('pointerdown', function (e) {
      var li = e.target.closest('[data-i]');
      if (!li) return;
      e.preventDefault();
      choose(matches[+li.dataset.i]);
    });
    input.addEventListener('blur', function () {
      setTimeout(function () {
        if (wrap.contains(document.activeElement)) return;
        closeList();
        if (current) input.value = current.d.district_name;
      }, 120);
    });
    stateSel.addEventListener('focus', function () { loadList().catch(function () {}); });
    stateSel.addEventListener('pointerdown', function () { loadList().catch(function () {}); });
    stateSel.addEventListener('change', function () {
      // A new state: the district box is cleared and opened on that state.
      input.value = '';
      input.focus();
    });

    /* ----- use my location ----- */
    var locate = wrap.querySelector('.mm-where__locate');
    locate.addEventListener('click', function () {
      if (!navigator.geolocation) { msg.textContent = t('This browser cannot share a location. Pick your district above.'); return; }
      msg.textContent = t('Finding the nearest district on this phone…');
      locate.disabled = true;
      Promise.all([
        loadList(),
        new Promise(function (ok, fail) { navigator.geolocation.getCurrentPosition(ok, fail, { timeout: 10000, maximumAge: 600000 }); }),
      ]).then(function (r) {
        var pos = r[1].coords;
        var near = nearest(r[0], { lat: pos.latitude, lon: pos.longitude });
        if (!near) throw new Error('none');
        choose(near.d);
        msg.textContent = t('Found on this phone. Your location was not sent anywhere.');
      }).catch(function (err) {
        msg.textContent = err && err.code === 1
          ? t('Location is turned off for this site. Pick your district above.')
          : t('Could not find your location. Pick your district above.');
      }).then(function () { locate.disabled = false; retranslate(); });
    });

    /* ----- wiring ----- */
    select.addEventListener('change', fromSelect);
    // The region list arrives after this runs on most pages.
    new MutationObserver(function () { fromSelect(); }).observe(select, { childList: true });
    document.addEventListener('mm:lang-changed', function () {
      if (translating) return;
      if (all) fillStates(current && current.d.state_name);
      if (current) setCover(current.d);
    });

    // Show the picker once the store answers for the current region; if it
    // cannot, the original select stays.
    var first = select.value || (window.MM && window.MM.defaultRegion ? window.MM.defaultRegion() : '');
    districtRecord(first || 'telangana_medak').then(function () {
      showPicker();
      fromSelect();
      retranslate();
      var idle = window.requestIdleCallback || function (fn) { return setTimeout(fn, 2500); };
      idle(function () { loadList().catch(function () {}); });
    }).catch(function () { /* store unavailable: the plain select remains */ });

    return { choose: choose, refresh: fromSelect };
  }

  /* ---------- typical-cost helper ---------- */
  function typicalCost(input, getRegion, getSeason) {
    if (!input || input.dataset.mmTypical || !(window.MM && window.MM.defaultBudget)) return;
    input.dataset.mmTypical = '1';
    var hint = document.createElement('small');
    hint.className = 'mm-typical';
    hint.setAttribute('aria-live', 'polite');
    hint.id = 'mmTypical' + (++seq);
    input.setAttribute('aria-describedby', ((input.getAttribute('aria-describedby') || '') + ' ' + hint.id).trim());
    var host = input.parentElement && input.parentElement.tagName === 'LABEL' ? input.parentElement : input;
    host.insertAdjacentElement('afterend', hint);
    var update = function () {
      var region = getRegion(), season = getSeason();
      if (!region || !season) { hint.textContent = ''; return; }
      window.MM.defaultBudget(region, season).then(function (v) {
        if (!(v > 0)) { hint.textContent = ''; return; }
        hint.innerHTML = text('Typical cost here') + ': ' + NUM('₹' + Math.round(v).toLocaleString('en-IN') + '/acre');
        retranslate();
      }).catch(function () { hint.textContent = ''; });
    };
    update();
    return update;
  }

  // Opt-in markup: <select data-district-picker> is enhanced on load, and
  // scan(root) does the same for markup a script renders later.
  function scan(root) {
    (root || document).querySelectorAll('select[data-district-picker]').forEach(function (sel) { enhance(sel); });
  }

  window.MMSetup = { enhance: enhance, typicalCost: typicalCost, districts: districts, scan: scan };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', function () { scan(); });
  else scan();
})();
