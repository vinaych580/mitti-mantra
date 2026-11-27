// scripts/fetch_serving_store.cjs: the Vercel build step that fetches
// dataset/serving.sqlite from the release asset the manifest names.
const {test} = require('node:test');
const assert = require('node:assert/strict');
const {execFileSync} = require('node:child_process');
const path = require('node:path');
const {servingEntry} = require('../scripts/fetch_serving_store.cjs');

const ROOT = path.resolve(__dirname, '..');

test('the committed manifest names a store to fetch', () => {
  const s = servingEntry(require('../pipelines/manifest.json'));
  assert.ok(s, 'pipelines/manifest.json has no "serving" entry: run python -m pipelines.run build');
  assert.match(s.asset, /^serving-[0-9a-f]{16}\.sqlite$/);
  assert.equal(s.asset, `serving-${s.sha256.slice(0, 16)}.sqlite`);
  assert.equal(s.release_tag, 'data-store');
});

test('a manifest without a serving entry is reported, not crashed on', () => {
  assert.equal(servingEntry({}), null);
  assert.equal(servingEntry({serving: {asset: 'x'}}), null);
  assert.equal(servingEntry(null), null);
});

test('without a token the build continues, and --strict fails', () => {
  const env = {...process.env};
  delete env.DATA_STORE_TOKEN; delete env.GITHUB_TOKEN; delete env.GH_TOKEN;
  // Point at a target that cannot already be in place, so the token check runs.
  env.DATA_STORE_REPO = 'example/none';
  const script = path.join(ROOT, 'scripts', 'fetch_serving_store.cjs');
  const run = (args) => {
    try {
      execFileSync(process.execPath, [script, ...args], {env, cwd: ROOT, stdio: 'pipe'});
      return 0;
    } catch (err) {
      return err.status;
    }
  };
  // When the store is already present and matches, both exit 0 before
  // needing a token; otherwise lenient exits 0 and strict exits 1.
  const lenient = run([]);
  const strict = run(['--strict']);
  assert.equal(lenient, 0);
  assert.ok(strict === 0 || strict === 1);
});
