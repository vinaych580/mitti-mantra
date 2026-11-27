/* =========================================================
   about.js — the "Use the demo farm" button on /about.

   The demo links on this page carry region/season/area/budget in the
   URL, and the dashboard applies those to the linked tool. The guided
   planner (decide.html) reads the saved farm profile instead, so this
   button writes the prepared farm into mm_farm_profile -- only when the
   visitor asks -- and keeps what was there so it can be put back.

   It writes localStorage directly rather than through MM.profile.set():
   that call also patches the active plot's region and acreage, and a
   demo must never edit a farmer's drawn plot.
   ========================================================= */
(() => {
  'use strict';

  const PROFILE_KEY = 'mm_farm_profile';
  const SAVED_KEY = 'mm_about_saved_profile';   // what the visitor had before
  const NONE = '__none__';                        // there was no profile at all
  const DEMO = { region_id: 'telangana_medak', season: 'kharif', area_acres: 3, budget_per_acre: 25000 };

  const $ = (id) => document.getElementById(id);
  const use = $('demoUse');
  const restore = $('demoRestore');
  if (!use || !restore) return;

  const read = (k) => { try { return localStorage.getItem(k); } catch (_) { return null; } };
  const write = (k, v) => { try { localStorage.setItem(k, v); return true; } catch (_) { return false; } };
  const drop = (k) => { try { localStorage.removeItem(k); } catch (_) {} };

  function parse(raw) {
    try { const v = JSON.parse(raw || 'null'); return v && typeof v === 'object' ? v : null; } catch (_) { return null; }
  }

  function demoActive() {
    const p = parse(read(PROFILE_KEY));
    return !!p && Object.keys(DEMO).every((k) => String(p[k]) === String(DEMO[k]));
  }

  function hasPlot() {
    try { return !!(window.FarmState && window.FarmState.load && window.FarmState.load()); } catch (_) { return false; }
  }

  function show(state) {
    $('demoOn').hidden = state !== 'on';
    $('demoOff').hidden = state !== 'off';
    $('demoPlot').hidden = !(state === 'on' && hasPlot());
    restore.hidden = !(demoActive() && read(SAVED_KEY) !== null);
  }

  use.addEventListener('click', () => {
    // Keep the visitor's own profile the first time only, so pressing the
    // button twice does not overwrite it with the demo farm.
    if (read(SAVED_KEY) === null) write(SAVED_KEY, read(PROFILE_KEY) ?? NONE);
    const next = Object.assign({}, parse(read(PROFILE_KEY)) || {}, DEMO);
    if (write(PROFILE_KEY, JSON.stringify(next))) {
      // The chatbot reads its region from this older key.
      write('mm_region_id', DEMO.region_id);
      show('on');
    }
  });

  restore.addEventListener('click', () => {
    const saved = read(SAVED_KEY);
    if (saved === null) return;
    if (saved === NONE) drop(PROFILE_KEY);
    else write(PROFILE_KEY, saved);
    const region = (parse(saved) || {}).region_id;
    if (region) write('mm_region_id', region);
    drop(SAVED_KEY);
    show('off');
    use.focus();
  });

  if (demoActive()) show('on');
  else restore.hidden = true;
})();
