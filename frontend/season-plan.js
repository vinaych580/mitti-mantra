/* Versioned plans live with their plot, so backup/restore includes them. */
(() => {
  'use strict';
  const copy = value => JSON.parse(JSON.stringify(value));
  const newId = () => window.MMSeasonUI?.uuid?.() || ('id_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 10));
  function scope(season, date = new Date()) {
    const year = season === 'rabi' && date.getMonth() < 5 ? date.getFullYear() - 1 : date.getFullYear();
    return `${season}-${year}`;
  }
  function latest(plot, seasonKey) {
    return copy((plot?.seasonPlans || []).filter(p => p.season_key === seasonKey).at(-1) || null);
  }
  function save(comparison, cropId, sowingDate, expectedPlotId) {
    const fs = window.FarmState;
    const plot = fs.load();
    if ((plot?.id || null) !== (expectedPlotId || null)) throw new Error('Your active plot changed. Review the comparison again.');
    const crop = comparison.crops.find(c => c.crop_id === cropId);
    if (!crop || !Number.isFinite(crop.selected.expected_profit)) throw new Error('Run a comparison before saving.');
    const inputs = comparison.inputs;
    // A measured boundary is authoritative. A scenario can vary assumptions,
    // but it cannot silently replace the real plot's region or acreage.
    if (plot && (plot.region_id !== inputs.region_id || (plot.geojson && Math.abs(plot.acres - inputs.area_acres) > .01))) {
      throw new Error('The comparison does not match your active plot. Review its region and area.');
    }
    const key = scope(inputs.season);
    const previous = (plot?.seasonPlans || []).filter(p => p.season_key === key);
    const plan = copy({ id: newId(), version: previous.length + 1,
      season_key: key, saved_at: new Date().toISOString(), sowing_date: sowingDate || null,
      crop_id: cropId, crop_name: crop.crop_name, inputs,
      prediction: crop.selected, comparison, evidence_date: comparison.generated_at,
      model_version: comparison.model_version });
    const saved = fs.save({ region_id: inputs.region_id, acres: inputs.area_acres,
      season: inputs.season, crop_id: cropId, crop_name: crop.crop_name,
      committedAt: plan.saved_at, seasonPlans: [...(plot?.seasonPlans || []), plan] });
    if (!saved) throw new Error('Could not save on this device. Free storage and try again.');
    window.MM?.profile?.set({ region_id: inputs.region_id, area_acres: inputs.area_acres,
      season: inputs.season, budget_per_acre: inputs.budget_per_acre });
    document.dispatchEvent(new CustomEvent('mm:plan-saved', { detail: plan }));
    return plan;
  }
  function archive(comparison) {
    const key = 'mm_saved_comparisons_v1';
    // A corrupt value must not stop a new comparison being saved (N-30).
    let rows;
    try { rows = JSON.parse(localStorage.getItem(key) || '[]'); } catch (_) { rows = []; }
    if (!Array.isArray(rows)) rows = [];
    const record = { id: newId(), plot_id: window.FarmState?.getActiveId() || null,
      saved_at: new Date().toISOString(), comparison: copy(comparison) };
    localStorage.setItem(key, JSON.stringify([...rows, record].slice(-20)));
    return record;
  }
  function saveRecommendation(rec, inputs, expectedPlotId) {
    const selected = {expected_profit:rec.expected_profit, prediction_source:rec.prediction_source,
      achievable_yield_kg_per_acre:rec.predicted_yield_kg_per_acre, budget_coverage:rec.budget_coverage};
    const comparison = {inputs:{...inputs,crop_ids:[rec.crop_id],irrigation_level:.5,rainfall_factor:1},
      ...(rec.planning_evidence || {generated_at:null,model_version:'unknown',sources:[]}),
      crops:[{crop_id:rec.crop_id,crop_name:rec.crop_name,selected,baseline:selected,
        dry:{expected_profit:null},profit_change:0,planned_cost:inputs.budget_per_acre*inputs.area_acres,
        water_requirement_mm:rec.water_requirement_mm??null,price_per_kg:rec.price_per_kg??null,
        price_source:'Recommendation reference price',price_as_of:null,calendar:null,alerts:[]}]};
    return save(comparison, rec.crop_id, null, expectedPlotId);
  }
  window.MMSeason = { scope, latest, save, archive, saveRecommendation };
})();
