(() => {
  'use strict';
  const $ = s => document.querySelector(s);
  const U = window.MMSeasonUI;
  const DRAFT = 'mm_season_draft_v1';
  let step = 1, shortlist = [], comparison = null, evidence = null, chosen = '', input = null, busy = false;
  let expectedPlot = window.FarmState.getActiveId();
  let run = 0;
  const status = (s, error = false) => { $('#plannerStatus').textContent = U.t(s); $('#plannerStatus').className = error ? 'season-error' : 'season-note'; };
  function show(n) {
    step = n;
    document.querySelectorAll('[data-step]').forEach(el => { el.hidden = Number(el.dataset.step) !== n; });
    $('#stepLabel').textContent = `${n} / 5`;
    $(`[data-step="${n}"] h2`).focus();
    U.translate();
  }
  function draft() {
    try { localStorage.setItem(DRAFT, JSON.stringify({plot_id:expectedPlot, input, shortlist, comparison, chosen, evidence})); }
    catch (_) { status('Draft could not be saved. Keep this page open.', true); }
  }
  function lock(value) {
    busy = value;
    document.querySelectorAll('#planner button').forEach(b => { b.disabled = value; });
    if (!value) invalidateButtons();
  }
  function signature() {
    return JSON.stringify({...input, crop_ids:[...document.querySelectorAll('[name=shortCrop]:checked')].map(e=>e.value),
      budget_per_acre:+$('#scenarioBudget').value, irrigation_level:+$('#water').value, rainfall_factor:+$('#rain').value});
  }
  function validComparison() { return comparison && JSON.stringify(comparison.inputs) === signature(); }
  function invalidateButtons() {
    $('#reviewNext').disabled = $('#saveComparison').disabled = !validComparison();
  }
  function renderShortlist() {
    $('#shortlist').innerHTML = U.lossBanner(shortlist) + shortlist.map(r => `<label class="season-choice"><input type="checkbox" name="shortCrop" value="${U.esc(r.crop_id)}" checked> <strong>${U.esc(r.crop_name)}</strong><p>${U.text(r.expected_profit < 0 ? 'Expected loss' : 'Expected profit')}: ${U.money(Math.abs(r.expected_profit))}</p><p>${U.esc(r.reasons?.[0] || r.reason || '')}</p></label>`).join('');
    U.translate();
  }
  function renderComparison() {
    $('#comparison').innerHTML = U.comparison(comparison, chosen) + U.evidence(comparison, evidence);
    $('#comparison').querySelectorAll('[name=chosenCrop]').forEach(el => el.addEventListener('change', () => { chosen = el.value; draft(); }));
    invalidateButtons(); U.translate();
  }
  async function compare() {
    if (busy || !$('#scenarioForm').reportValidity()) return;
    const body = JSON.parse(signature());
    if (!body.crop_ids.length) { status('Select at least one crop.', true); return; }
    const seq = ++run;
    lock(true); status('Comparing your crop options…');
    try {
      const response = await U.request('/api/season/compare', body);
      if (seq !== run) return;
      comparison = response.data;
      // Preserve the request property order for exact draft/cache matching.
      comparison.inputs = body;
      if (!comparison.crops.some(c => c.crop_id === chosen)) chosen = comparison.crops[0].crop_id;
      evidence = (await U.request('/api/season/evidence').catch(() => ({data:null}))).data;
      if (seq !== run) return;
      if (evidence?.model_version !== comparison.model_version) evidence = null;
      renderComparison(); draft();
      status(response.cached ? 'Offline: showing a saved estimate. Check its original data date.' : 'Comparison updated. Select the crop you want to plan.');
    } catch (error) { if (seq === run) status(error.message, true); }
    finally { if (seq === run) lock(false); }
  }
  // The budget follows the typical input cost for the region and season until
  // the farmer types their own (N-7: a flat ₹15,000 underfunded rice and cotton).
  let budgetTyped = false;
  async function typicalBudget() {
    try {
      const typical = await window.MM.defaultBudget($('#region').value, $('#season').value);
      if (!budgetTyped) $('#budget').value = typical;
      $('#budgetHint').innerHTML = `${U.text('Typical cost here')}: ${U.esc(U.money(typical))}/acre`;
    } catch (_) {
      if (!$('#budget').value) $('#budget').value = 20000;
      $('#budgetHint').textContent = '';
    }
  }
  $('#budget').addEventListener('input', () => { budgetTyped = true; });
  ['#region', '#season'].forEach(sel => $(sel).addEventListener('change', typicalBudget));
  async function init() {
    const p = window.MM.profile.get();
    const plot = window.FarmState.load();
    let regions;
    try { regions = (await U.request('/api/regions')).data; }
    catch (_) { regions = window.FarmState.REGION_CENTROIDS.map(r => ({id:r.region_id,name:r.displayName})); }
    $('#region').innerHTML = regions.map(r => `<option value="${U.esc(r.id)}">${U.esc(r.name)}</option>`).join('');
    // One default region shared with the landing page (profile, else located, else Sehore).
    const wanted = plot?.region_id || await window.MM.locateDefaultRegion();
    $('#region').value = regions.some(r => r.id === wanted) ? wanted : regions[0].id;
    $('#season').value = p.season || 'kharif'; $('#area').value = plot?.acres || p.area_acres || 3;
    budgetTyped = Number(p.budget_per_acre) > 0;
    if (budgetTyped) $('#budget').value = p.budget_per_acre;
    await typicalBudget();
    if (plot) {
      $('#region').disabled = true;
      $('#area').readOnly = !!plot.geojson;
      $('#plotNote').textContent = U.t('Planning for your active plot. Switch plots in My season to plan another farm.');
    }
    let saved;
    try { saved = JSON.parse(localStorage.getItem(DRAFT) || 'null'); } catch (_) {}
    if (saved?.plot_id === expectedPlot && saved.comparison?.crops?.length && saved.input && (!plot || (saved.input.region_id === plot.region_id && Math.abs(saved.input.area_acres-plot.acres)<.01))) {
      input = saved.input; shortlist = saved.shortlist; comparison = saved.comparison; chosen = saved.chosen; evidence = saved.evidence;
      $('#region').value=input.region_id; $('#season').value=input.season; $('#area').value=input.area_acres; $('#budget').value=input.budget_per_acre;
      renderShortlist();
      document.querySelectorAll('[name=shortCrop]').forEach(el=>el.checked=comparison.inputs.crop_ids.includes(el.value));
      $('#scenarioBudget').value=comparison.inputs.budget_per_acre; $('#water').value=comparison.inputs.irrigation_level; $('#rain').value=comparison.inputs.rainfall_factor;
      renderComparison(); show(3); status('Restored your comparison. Review assumptions before saving.');
    } else show(1);
    U.translate();
  }
  $('#farmForm').addEventListener('submit', async e => {
    e.preventDefault(); if(busy) return;
    input = {region_id:$('#region').value,season:$('#season').value,area_acres:+$('#area').value,budget_per_acre:+$('#budget').value};
    expectedPlot = window.FarmState.getActiveId(); comparison = null;
    lock(true); status('Finding crops for your farm…');
    const seq=++run;
    try {
      const response = await U.request('/api/crop', input);
      if(seq!==run)return;
      shortlist=response.data.slice(0,3);
      if(!shortlist.length)throw new Error(U.t('No crops found for these inputs. Adjust your farm details.'));
      renderShortlist(); $('#scenarioBudget').value=input.budget_per_acre; show(2); draft();
      status(response.cached ? 'Offline: showing a saved estimate. Check its original data date.' : '');
    } catch(error) {status(error.message,true);} finally {lock(false);}
  });
  $('#compareNext').addEventListener('click', () => {if(!document.querySelector('[name=shortCrop]:checked'))return status('Select at least one crop.',true); show(3);compare();});
  $('#scenarioForm').addEventListener('submit',e=>{e.preventDefault();compare();});
  $('#scenarioForm').addEventListener('input',()=>{invalidateButtons();status('Inputs changed. Update the comparison before continuing.');});
  document.querySelectorAll('[data-back]').forEach(b=>b.addEventListener('click',()=>show(+b.dataset.back)));
  $('#saveComparison').addEventListener('click',()=>{try{if(!validComparison())return;window.MMSeason.archive(comparison);status('Comparison saved. Find it in My season.');}catch(_){status('Could not save on this device. Free storage and try again.',true);}});
  $('#reviewNext').addEventListener('click',()=>{
    if(!validComparison())return;
    const crop=comparison.crops.find(c=>c.crop_id===chosen);
    $('#planReview').innerHTML=`<h3>${U.esc(crop.crop_name)}</h3><p><span data-no-translate>${U.esc(U.regionName(input.region_id))}</span> · ${U.text({kharif:'Kharif',rabi:'Rabi',zaid:'Zaid'}[input.season] || input.season)} · ${U.esc(input.area_acres)} ${U.text('acres')}</p><div class="season-stats"><div>${U.text('Expected profit')}<strong>${U.money(crop.selected.expected_profit)}</strong></div><div>${U.text('Planned cost')}<strong>${U.money(crop.planned_cost)}</strong></div><div>${U.text('Dry scenario profit')}<strong>${U.money(crop.dry.expected_profit)}</strong></div></div>${U.evidence(comparison,evidence)}`;
    show(4);status('');
  });
  $('#commitPlan').addEventListener('click',()=>{
    if(busy || !validComparison())return;
    lock(true);
    try {
      window.MMSeason.save(comparison,chosen,$('#sowingDate').value,expectedPlot);
      try{localStorage.removeItem(DRAFT);}catch(_){}
      show(5);status('Saved on this device. Back up your data to keep a copy.');
    }catch(error){status(error.message,true);}finally{lock(false);}
  });
  $('#readPlan').addEventListener('click',()=>window.MMSeasonVoice?.read($('#planReview').innerText));
  window.addEventListener('storage',e=>{if(e.key===window.FarmState.PLOTS_KEY && window.FarmState.getActiveId()!==expectedPlot){++run;comparison=null;lock(false);show(1);status('Your active plot changed. Reload this page before continuing.',true);$('#farmForm').querySelector('button[type=submit]').disabled=true;}});
  init();
})();
