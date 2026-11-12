#!/usr/bin/env node
/*
 * Fails when a file the service worker precaches changed but sw.js VERSION
 * did not. Without the bump, returning visitors keep the old cached copy
 * (CSS and HTML are cache-first, JS stale-while-revalidate).
 *
 * Usage: node scripts/ci/check_sw_version.cjs [base-ref]   (default origin/master)
 */
'use strict';
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');

const base = process.argv[2] || process.env.BASE_REF || 'origin/master';
const git = (...args) => execFileSync('git', args, { encoding: 'utf8' });

function versionOf(source) {
  const m = source.match(/const VERSION\s*=\s*['"]([^'"]+)['"]/);
  return m ? m[1] : null;
}

function precached(source) {
  const block = source.match(/const CORE\s*=\s*\[([\s\S]*?)\];/);
  if (!block) throw new Error('sw.js: CORE precache list not found');
  return [...block[1].matchAll(/['"]\.\/([^'"]*)['"]/g)]
    .map(m => m[1])
    .filter(Boolean)
    .map(p => 'frontend/' + p);
}

let changed;
try {
  changed = git('diff', '--name-only', `${base}...HEAD`).split('\n').filter(Boolean);
  // Uncommitted work counts too when run locally.
  changed.push(...git('diff', '--name-only', 'HEAD').split('\n').filter(Boolean));
} catch (e) {
  console.error(`check_sw_version: cannot diff against ${base}: ${e.message}`);
  process.exit(2);
}

const current = fs.readFileSync('frontend/sw.js', 'utf8');
let previous = '';
try { previous = git('show', `${base}:frontend/sw.js`); } catch (_) { /* new file */ }

const cached = new Set(precached(current));
cached.add('frontend/index.html'); // './' resolves to it
const touched = [...new Set(changed)].filter(f => cached.has(f));

if (!touched.length) {
  console.log('check_sw_version: no precached asset changed.');
  process.exit(0);
}
if (versionOf(current) && versionOf(current) !== versionOf(previous)) {
  console.log(`check_sw_version: VERSION ${versionOf(previous)} -> ${versionOf(current)} covers ${touched.length} changed asset(s).`);
  process.exit(0);
}
console.error('check_sw_version: precached assets changed but frontend/sw.js VERSION did not:');
touched.forEach(f => console.error('  ' + f));
console.error(`Bump VERSION (currently ${versionOf(current)}) so returning visitors get the new files.`);
process.exit(1);
