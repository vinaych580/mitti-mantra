const {test}=require('node:test');
const assert=require('node:assert/strict');
const vm=require('node:vm');
const fs=require('node:fs');
const {webcrypto}=require('node:crypto');
function setup(){
  let plot={id:'p1',region_id:'telangana_medak',acres:3};
  let fail=false;
  const storage=new Map();
  const context={crypto:webcrypto,Date,CustomEvent:class{},document:{dispatchEvent(){},getElementById(){return null;}},
    localStorage:{getItem:k=>storage.get(k)||null,setItem(k,v){if(fail)throw new Error('quota');storage.set(k,v);}},
    MM:{profile:{set(){}}},FarmState:{load:()=>plot,getActiveId:()=>plot?.id,save(p){if(fail)return null;plot={...plot,...p};return plot;}}};
  context.window=context;
  vm.createContext(context);
  vm.runInContext(fs.readFileSync('frontend/season-plan.js','utf8'),context);
  vm.runInContext(fs.readFileSync('frontend/season-voice.js','utf8'),context);
  return {context,plot:()=>plot,fail:()=>{fail=true;}};
}
const comparison=()=>({inputs:{region_id:'telangana_medak',area_acres:3,season:'kharif',budget_per_acre:10000},
  crops:[{crop_id:'maize',crop_name:'Maize',selected:{expected_profit:12345}}],generated_at:'2026-10-07',model_version:'v1'});
test('revisions preserve original inputs, estimate and model version',()=>{
  const {context,plot}=setup();const c=comparison();
  context.MMSeason.save(c,'maize',null,'p1');c.crops[0].selected.expected_profit=9000;c.model_version='v2';
  context.MMSeason.save(c,'maize',null,'p1');
  assert.equal(plot().seasonPlans.length,2);assert.equal(plot().seasonPlans[0].prediction.expected_profit,12345);
  assert.equal(plot().seasonPlans[0].model_version,'v1');assert.equal(plot().seasonPlans[1].version,2);
  const latest=context.MMSeason.latest(plot(),context.MMSeason.scope('kharif'));latest.prediction.expected_profit=0;
  assert.equal(plot().seasonPlans[1].prediction.expected_profit,9000);
});
test('plot changes, region mismatches and failed storage never report a saved plan',()=>{
  const {context,plot,fail}=setup();
  assert.throws(()=>context.MMSeason.save(comparison(),'maize',null,'another'));
  const c=comparison();c.inputs.region_id='mh_pune';assert.throws(()=>context.MMSeason.save(c,'maize',null,'p1'));
  fail();assert.throws(()=>context.MMSeason.save(comparison(),'maize',null,'p1'));assert.equal(plot().seasonPlans,undefined);
});
test('rabi season is scoped to sowing year',()=>{
  const {context}=setup();assert.equal(context.MMSeason.scope('rabi',new Date(2027,1,1)),'rabi-2026');
  assert.equal(context.MMSeason.scope('kharif',new Date(2027,6,1)),'kharif-2027');
});
test('voice accepts explicit numeric Hindi and Telugu values and rejects ambiguity',()=>{
  const parse=setup().context.MMSeasonVoice.parseNumber;
  for(const [input,expected] of [['three acres',3],['पंद्रह हजार',15000],['మూడు ఎకరాలు',3],['౩.౫',3.5],['०.५',.5],['zero point five',.5]])assert.equal(parse(input),expected);
  for(const input of ['three or four','15 20','-4','maybe five'])assert.equal(parse(input),null);
});

// --- Phase 0 (N-13, N-29, N-30, N-31) ---
function uiContext({secure=true, lang='en'}={}){
  const storage=new Map();
  const localStorage={getItem:k=>storage.has(k)?storage.get(k):null,setItem(k,v){storage.set(k,String(v));},
    removeItem(k){storage.delete(k);},key:i=>[...storage.keys()][i]??null,get length(){return storage.size;}};
  const crypto=secure?webcrypto:{getRandomValues:a=>webcrypto.getRandomValues(a)};
  const context={crypto,localStorage,AbortSignal,Date,Uint8Array,Math,JSON,Number,Array,String,
    AgriSimI18n:{getLanguage:()=>lang,t:s=>s},
    fetch:async(url,opts)=>({ok:true,json:async()=>({url,body:opts?.body||null})})};
  context.globalThis=context;context.window=context;
  vm.createContext(context);
  vm.runInContext(fs.readFileSync('frontend/season-ui.js','utf8'),context);
  return {context,storage};
}
test('ids are UUIDs even without randomUUID (plain-HTTP LAN address)',()=>{
  const {context}=uiContext({secure:false});
  const id=context.MMSeasonUI.uuid();
  assert.match(id,/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  assert.notEqual(id,context.MMSeasonUI.uuid());
});
test('offline cache keeps only the newest 20 responses',async()=>{
  const {context,storage}=uiContext();
  for(let i=0;i<30;i++)await context.MMSeasonUI.request('/api/season/compare',{i});
  const cached=[...storage.keys()].filter(k=>k.startsWith('mm_season_cache:'));
  assert.equal(cached.length,20);
  assert.ok(cached.some(k=>k.includes('"i":29')));
  assert.ok(!cached.some(k=>k.includes('"i":0}')));
});
test('dates follow the page language',()=>{
  const en=uiContext({lang:'en'}).context.MMSeasonUI.date('2026-11-11');
  const hi=uiContext({lang:'hi'}).context.MMSeasonUI.date('2026-11-11');
  assert.notEqual(en,hi);
  assert.equal(uiContext().context.MMSeasonUI.date('not a date'),'Unknown date');
});
test('a corrupt saved-comparisons value does not block archiving',()=>{
  const {context}=setup();
  context.localStorage.setItem('mm_saved_comparisons_v1','{not json');
  const record=context.MMSeason.archive(comparison());
  assert.ok(record.id);
  assert.equal(JSON.parse(context.localStorage.getItem('mm_saved_comparisons_v1')).length,1);
});
test('voice language follows the site language',()=>{
  const {context}=setup();
  context.AgriSimI18n={getLanguage:()=>'te'};
  assert.equal(context.MMSeasonVoice.voiceLang(),'te-IN');
  context.AgriSimI18n={getLanguage:()=>'ta'};
  assert.equal(context.MMSeasonVoice.voiceLang(),'ta-IN');
});
