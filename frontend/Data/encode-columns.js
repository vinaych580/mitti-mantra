/* =============================================================================
   encode-columns.js — compact encoding for the generated Data/*.js files
   -----------------------------------------------------------------------------
   Used by generate_consultants.js and generate_tractors.js (Node, dev-time).

   The generated files used to be pretty-printed object literals: every one of
   ~2,300 consultants and ~530 tractors repeated every key name, and tractors
   repeated the same 18 models' image URLs, descriptions and specs hundreds of
   times. A phone parses all of that before the page can use it.

   This writes the same records column by column instead. A column with few
   distinct values (a tractor's model description, a consultant's state) is
   stored once as a dictionary plus small integer indexes. A ten-line decoder
   at the top of the output rebuilds exactly the objects the old format
   produced, so the pages that read window.<NAME> need no changes.
   ============================================================================= */

'use strict';

// Dictionary-encode a column when its distinct values are at most this
// fraction of the rows; otherwise store the values as-is.
const DICT_RATIO = 0.25;

function encodeColumns(records) {
  const keys = [];
  records.forEach((r) => Object.keys(r).forEach((k) => { if (!keys.includes(k)) keys.push(k); }));
  records.forEach((r, i) => keys.forEach((k) => {
    if (!(k in r)) throw new Error(`record ${i} is missing "${k}"; every record must have every key`);
  }));
  return keys.map((k) => {
    const values = records.map((r) => r[k]);
    const seen = new Map();
    const dict = [];
    const idx = values.map((v) => {
      const sig = JSON.stringify(v);
      if (!seen.has(sig)) { seen.set(sig, dict.length); dict.push(v); }
      return seen.get(sig);
    });
    return dict.length <= values.length * DICT_RATIO ? [k, dict, idx] : [k, values];
  });
}

// Runs in the browser. Arrays are copied per record so that two records which
// shared a dictionary entry never share one mutable array.
const DECODER = `(function (n, cols) {
  var out = [];
  for (var i = 0; i < n; i++) out.push({});
  cols.forEach(function (c) {
    for (var i = 0; i < n; i++) {
      var v = c.length === 3 ? c[1][c[2][i]] : c[1][i];
      out[i][c[0]] = Array.isArray(v) ? v.slice() : v;
    }
  });
  return out;
})`;

/**
 * The full text of a generated data file.
 * @param {string} globalName  window property to assign, e.g. 'TRACTORS_DATA'
 * @param {object[]} records
 * @param {string} banner      comment text for the header
 */
function renderDataFile(globalName, records, banner) {
  const cols = encodeColumns(records);
  const body = cols.map((c) => '  ' + JSON.stringify(c)).join(',\n');
  return `/* =========================================================================
${banner.split('\n').map((l) => '   ' + l).join('\n')}
   -------------------------------------------------------------------------
   Encoded column by column (see encode-columns.js): each entry below is
   [key, values] or [key, distinctValues, indexPerRecord]. The function at
   the top rebuilds the plain array of objects the pages read.
   ========================================================================= */

window.${globalName} = ${DECODER}(${records.length}, [
${body}
]);
`;
}

module.exports = { encodeColumns, renderDataFile };
