// Phase 4.4: the confidence word on <mm-estimate> (frontend/mm-estimate.js).
// The thresholds are provisional (owner decision); these tests pin the rule's
// shape so a change to them is deliberate.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const E = require('../frontend/mm-estimate.js');

// Width = (high - low) / most likely profit.
const base = { low: 50000, high: 110000, mid: 70000, seasons: 10, lastYear: 2022, thisYear: 2026, source: 'district_record' };

test('a tight range above zero on a long, recent record is Strong', () => {
  assert.equal(E.confidence(base).word, 'strong');                       // 60k / 70k = 0.86
});

test('the middle of the observed spread is Fair', () => {
  assert.equal(E.confidence({ ...base, low: 20000, high: 130000 }).word, 'fair');   // 110k / 70k = 1.57
});

test('a range that dips into a loss is never Strong', () => {
  assert.equal(E.confidence({ ...base, low: -5000, high: 75000 }).word, 'fair');    // 80k / 70k = 1.14
});

test('a very wide range, few seasons, old data, no record or no profit are each Weak', () => {
  assert.equal(E.confidence({ ...base, low: -80000, high: 120000 }).word, 'weak');  // 200k / 70k = 2.86
  assert.equal(E.confidence({ ...base, seasons: 5 }).word, 'weak');
  assert.equal(E.confidence({ ...base, lastYear: 2017 }).word, 'weak');            // 9 years old
  assert.equal(E.confidence({ ...base, source: 'heuristic' }).word, 'weak');
  assert.equal(E.confidence({ ...base, mid: -1000, low: -20000, high: 15000 }).word, 'weak');
  assert.deepEqual(E.confidence({ ...base, seasons: 5, lastYear: 2017 }).why, ['few_seasons', 'old_data']);
});

test('no range at all is Weak, never a probability', () => {
  const c = E.confidence({ mid: 50000 });
  assert.equal(c.word, 'weak');
  assert.deepEqual(c.why, ['no_range']);
});

test('Strong needs every condition: a short or older record keeps it Fair', () => {
  assert.equal(E.confidence({ ...base, seasons: 7 }).word, 'fair');
  assert.equal(E.confidence({ ...base, lastYear: 2020 }).word, 'fair');            // 6 years old
});

test('a recommendation row maps to an estimate, with old data and a loss end in words', () => {
  const row = {
    expected_profit: 61806, planned_cost: 75000, roi_percent: 82.4, profit_range: [31800, 121988],
    yield_range_kg_per_acre: [1496, 2760], predicted_yield_kg_per_acre: 1917, price_per_kg: 23.79, budget_coverage: 0.93,
    prediction_source: 'district_record', yield_basis: { years_on_record: 26, last_year: 2022, model_version: '13898ae6d977' },
    risk_basis: { seasons_on_record: 10 },
  };
  // Medak rice from the ranking: 90.2k / 61.8k = 1.46.
  const o = E.fromRecommendation(row, { area: 3, thisYear: 2026 });
  assert.equal(o.conf.word, 'fair');
  assert.match(o.stale, /2022/);
  assert.ok(o.drivers.some(d => /not a rainfall forecast/.test(d)));
  assert.match(E.html({ ...o, label: 'Profit' }), /^<mm-estimate class="mm-est mm-est--fair">/);
  assert.doesNotMatch(E.html(o), /low end is a loss/);
  const lossy = E.fromRecommendation({ ...row, profit_range: [-12000, 121988] }, { thisYear: 2026 });
  assert.match(E.html(lossy), /low end is a loss/);
});
