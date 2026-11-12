(() => {
  'use strict';
  const U=window.MMSeasonUI, S=window.MMSeason, F=window.FarmState;
  const $=id=>document.getElementById(id);
  const read=key=>{try{const value=JSON.parse(localStorage.getItem(key)||'[]');return Array.isArray(value)?value:[];}catch(_){return [];}};
  let key='', version=null, evidence=null;
  const taskNames={land_prep:'Land preparation',nursery:'Nursery',sowing_transplant:'Sowing',first_fertilizer:'First fertilizer',second_fertilizer:'Second fertilizer',third_fertilizer:'Third fertilizer',critical_irrigation:'Critical irrigation',pest_watch:'Pest watch',harvest_window:'Harvest window',harvest:'Harvest window'};
  function tasks(plan,crop){
    if(!crop.calendar)return `<p>${U.text('No calendar is available for this crop. Review timing with a local advisor.')}</p>`;
    const done=read('mm_season_tasks_v1');
    const now=new Date();now.setHours(0,0,0,0);
    const rows=Object.entries(crop.calendar).filter(([id])=>taskNames[id]).map(([id,description])=>{
      // Only day-after-sowing values are converted. Regional month windows
      // remain reference text, never invented farm-specific due dates.
      const match=String(description).match(/^(\d+)(?:-\d+)?\s+DAS\b/);
      let due=null;
      if(match && plan.sowing_date){due=new Date(plan.sowing_date+'T12:00:00');due.setDate(due.getDate()+Number(match[1]));}
      const completed=done.includes(plan.id+':'+id);
      return {id,description,due,completed};
    });
    rows.sort((a,b)=>Number(a.completed)-Number(b.completed)||(a.due?.getTime()||Infinity)-(b.due?.getTime()||Infinity));
    return `<p class="season-note">${U.text('Reference calendar. Confirm local timing; checking a task only records your progress.')}</p><ul class="season-list">${rows.map(r=>`<li><label><input type="checkbox" data-task="${U.esc(plan.id+':'+r.id)}" ${r.completed?'checked':''}> <b>${U.text(taskNames[r.id])}</b></label><p>${U.esc(r.description)}</p>${r.due?`<small>${U.text(r.due<now && !r.completed?'Review timing':'Planned date')}: ${U.date(r.due)}</small>`:''}</li>`).join('')}</ul>`;
  }
  function refreshSelectors(){
    const plot=F.load();
    $('seasonPlot').innerHTML=F.list().map(p=>`<option value="${U.esc(p.id)}">${U.esc(p.name)}</option>`).join('');
    $('seasonPlot').value=plot?.id||'';
    const current=S.scope(window.MM.profile.get().season||'kharif');
    const keys=[...new Set([current,...(plot?.seasonPlans||[]).map(p=>p.season_key)])].sort().reverse();
    if(!keys.includes(key))key=current;
    $('seasonKey').innerHTML=keys.map(k=>`<option value="${U.esc(k)}">${U.esc(k)}</option>`).join('');$('seasonKey').value=key;
  }
  function render(){
    refreshSelectors();
    const plot=F.load();
    const plans=(plot?.seasonPlans||[]).filter(p=>p.season_key===key);
    const plan=plans.find(p=>p.id===version)||plans.at(-1);
    if(!plan){
      $('seasonContent').innerHTML=`<section class="season-panel"><h2>${U.text('Start with a season plan')}</h2><p>${U.text('Compare crops and save the estimate you want to follow. Existing crop choices without a snapshot cannot be reconstructed as an original plan.')}</p><div class="season-actions"><a class="btn btn-primary" href="decide.html">${U.text('Plan your season')}</a><a class="btn btn-ghost" href="farm-boundary.html">${U.text('Draw farm')}</a></div></section>`;
    }else{
      const crop=plan.comparison.crops.find(c=>c.crop_id===plan.crop_id);
      const expenses=read('mm_expenses').filter(e=>e.plot_id===plot.id && e.season_key===key);
      const sales=read('mm_harvests').filter(e=>e.plot_id===plot.id && e.season_key===key);
      const spent=expenses.reduce((n,e)=>n+(+e.amount||0),0);
      const revenue=sales.reduce((n,e)=>n+(+e.qty_kg||0)*(+e.price_per_kg||0),0);
      const net=revenue-spent;
      $('seasonContent').innerHTML=`<section class="season-panel"><div class="season-grid"><div><p class="season-step-label">${U.text('Your saved crop choice')}</p><h2>${U.esc(plan.crop_name)}</h2><p>${U.esc(key)} · ${plan.inputs.area_acres} acres · ${U.text('Saved')} ${U.date(plan.saved_at)}</p></div><div class="field"><label for="planVersion">${U.text('Plan version')}</label><select id="planVersion">${plans.map(p=>`<option value="${U.esc(p.id)}" ${p.id===plan.id?'selected':''}>${p.version} · ${U.date(p.saved_at)} · ${U.esc(p.crop_name)}</option>`).join('')}</select></div></div>
      <div class="season-stats"><div>${U.text('Original expected profit')}<strong>${U.money(plan.prediction.expected_profit)}</strong></div><div>${U.text('Spent so far')}<strong>${U.money(spent)}</strong></div><div>${U.text('Sales minus spend so far')}<strong>${sales.length?U.money(net):'—'}</strong></div></div>
      <p>${U.text('Recorded harvest sales')}: ${sales.length} · ${U.text('Total sales')}: ${U.money(revenue)}</p>
      ${sales.length?`<p>${U.text('Difference from saved estimate')}: ${U.money(net-plan.prediction.expected_profit)}</p><p class="season-note">${U.text('This is an in-progress comparison until all harvest sales and expenses are recorded.')}</p>`:''}
      <div class="season-actions"><a class="btn btn-primary" href="dashboard.html?tool=expense&amp;ledger_season=${U.esc(key)}">${U.text('Record expenses or harvest')}</a><a class="btn btn-ghost" href="decide.html">${U.text('Revise my plan')}</a><button class="btn btn-ghost" id="printPlan">${U.text('Print plan')}</button></div>
      ${U.evidence(plan.comparison,evidence?.model_version===plan.model_version?evidence:null)}</section>
      <div class="season-grid"><section class="season-panel"><h2>${U.text('Next field tasks')}</h2>${tasks(plan,crop)}<a class="btn btn-ghost" href="dashboard.html?tool=calendar">${U.text('Crop calendar')}</a></section>
      <section class="season-panel"><h2>${U.text('Risks to review')}</h2><p class="season-note">${U.text('Rules evaluated using reference weather at planning time. These are not live warnings.')}</p>
      <ul class="season-list">${(crop.alerts||[]).filter(a=>a.risk_level!=='LOW').map(a=>`<li><b>${U.esc(a.pest_disease||'')}</b> · ${U.esc(a.risk_level)}<p>${U.esc(a.description||'')}</p></li>`).join('')||`<li>${U.text('No elevated risks in the saved rule assessment. This does not rule out field problems.')}</li>`}</ul><a class="btn btn-ghost" href="dashboard.html?tool=pest">${U.text('Review pest alerts')}</a>
      <h3>${U.text('Water and budget')}</h3><p>${U.text('Irrigation availability')}: ${plan.inputs.irrigation_level}</p><p>${U.text('Budget / acre (₹)')}: ${U.money(plan.inputs.budget_per_acre)}</p><p>${U.text('Dry scenario profit')}: ${U.money(crop.dry.expected_profit)}</p><a class="btn btn-ghost" href="dashboard.html?tool=irrigation">${U.text('Irrigation plan')}</a></section></div>`;
      $('planVersion').addEventListener('change',e=>{version=e.target.value;render();});
      $('printPlan').addEventListener('click',()=>window.print());
      document.querySelectorAll('[data-task]').forEach(box=>box.addEventListener('change',()=>{
        try{const done=new Set(read('mm_season_tasks_v1'));box.checked?done.add(box.dataset.task):done.delete(box.dataset.task);localStorage.setItem('mm_season_tasks_v1',JSON.stringify([...done]));}
        catch(_){box.checked=!box.checked;$('seasonStatus').textContent=U.t('Could not save on this device. Free storage and try again.');}
      }));
    }
    const saved=read('mm_saved_comparisons_v1').filter(r=>r.plot_id===(plot?.id||null));
    $('savedComparisons').innerHTML=saved.length?saved.slice().reverse().map(r=>`<details><summary>${U.date(r.saved_at)} · ${U.esc(r.comparison.inputs.season)} · ${r.comparison.inputs.area_acres} acres</summary>${U.comparison(r.comparison,null,false)}</details>`).join(''):`<p>${U.text('Save a comparison in the planner to return to it here.')}</p>`;
    U.translate();
  }
  $('seasonPlot').addEventListener('change',e=>{version=null;key='';F.setActive(e.target.value);render();});
  $('seasonKey').addEventListener('change',e=>{key=e.target.value;version=null;window.MM.profile.set({season:key.split('-')[0]});render();});
  window.addEventListener('storage',render);
  render();
  U.request('/api/season/evidence').then(r=>{evidence=r.data;render();}).catch(()=>{});
})();
