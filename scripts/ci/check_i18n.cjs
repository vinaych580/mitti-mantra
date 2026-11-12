#!/usr/bin/env node
/*
 * Every translatable string in changed frontend files must exist in the
 * Hindi and Telugu catalogs (PRODUCT.md: EN/HI/TE are first-class). Kannada
 * and Tamil gaps are reported as warnings.
 *
 * Strings checked:
 *   - text of HTML elements carrying data-i18n
 *   - aria-label / title / placeholder on elements carrying data-i18n or
 *     data-voice (the switcher translates those attributes)
 *   - literal arguments of text('…'), t('…'), U.text('…'), U.t('…'),
 *     note('…') and status('…') in JS
 *
 * Usage: node scripts/ci/check_i18n.cjs [base-ref] [--all]
 *   --all checks every frontend file instead of only the changed ones.
 */
'use strict';
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const args = process.argv.slice(2);
const all = args.includes('--all');
const base = args.find(a => !a.startsWith('--')) || process.env.BASE_REF || 'origin/master';
const FRONT = 'frontend';
const REQUIRED = ['hi', 'te'];
const WARN = ['kn', 'ta'];

function catalogs() {
  const ctx = { window: {} };
  vm.createContext(ctx);
  for (const lang of [...REQUIRED, ...WARN]) {
    vm.runInContext(fs.readFileSync(path.join(FRONT, 'i18n', lang + '.js'), 'utf8'), ctx);
  }
  return ctx.window.MM_I18N_CATALOG;
}

function files() {
  if (all) {
    return fs.readdirSync(FRONT).filter(f => /\.(html|js)$/.test(f)).map(f => path.join(FRONT, f));
  }
  const git = (...a) => execFileSync('git', a, { encoding: 'utf8' }).split('\n').filter(Boolean);
  const changed = new Set([...git('diff', '--name-only', `${base}...HEAD`), ...git('diff', '--name-only', 'HEAD'),
    ...git('ls-files', '--others', '--exclude-standard', FRONT)]);
  return [...changed].filter(f => /^frontend\/[^/]+\.(html|js)$/.test(f) && fs.existsSync(f) && !f.endsWith('sw.js'));
}

const norm = s => s.replace(/\s+/g, ' ').trim();
const decode = s => s.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&rsquo;/g, '’');

function stringsIn(file, source) {
  const found = new Set();
  if (file.endsWith('.html')) {
    for (const m of source.matchAll(/<([a-z0-9]+)\b([^>]*\bdata-i18n\b[^>]*)>([^<]*)</gi)) {
      const text = norm(decode(m[3]));
      if (text && /[a-z]/i.test(text)) found.add(text);
    }
  }
  for (const m of source.matchAll(/<[a-z0-9]+\b[^>]*\b(?:data-i18n|data-voice)\b[^>]*>/gi)) {
    for (const a of m[0].matchAll(/\b(?:aria-label|title|placeholder)="([^"$]+)"/g)) found.add(norm(decode(a[1])));
  }
  if (file.endsWith('.js')) {
    for (const m of source.matchAll(/\b(?:U\.)?(?:text|t|note|status)\(\s*'((?:[^'\\]|\\.)+)'\s*[,)]/g)) {
      const text = norm(m[1].replace(/\\'/g, "'"));
      if (text && /[a-z]/i.test(text) && !text.includes('${')) found.add(text);
    }
  }
  return found;
}

const C = catalogs();
let failures = 0;
let warnings = 0;
let checked = 0;
for (const file of files()) {
  const strings = stringsIn(file, fs.readFileSync(file, 'utf8'));
  checked += strings.size;
  for (const s of strings) {
    const missing = REQUIRED.filter(l => !(s in C[l]));
    const soft = WARN.filter(l => !(s in C[l]));
    if (missing.length) { failures++; console.error(`MISSING ${missing.join(',')}  ${file}: ${JSON.stringify(s)}`); }
    else if (soft.length) { warnings++; console.warn(`warn ${soft.join(',')}  ${file}: ${JSON.stringify(s)}`); }
  }
}
console.log(`check_i18n: ${checked} strings checked, ${failures} missing in hi/te, ${warnings} warnings for kn/ta.`);
process.exit(failures ? 1 : 0);
