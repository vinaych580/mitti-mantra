#!/usr/bin/env node
/* Fetch dataset/serving.sqlite from the GitHub release named in
 * pipelines/manifest.json, and verify its checksum.
 *
 * The store (~37 MB, rebuilt by the daily data refresh) is not committed to
 * git: each build uploads it as a release asset named after its checksum, and
 * the committed manifest records that name. So a deploy always gets the exact
 * store its own commit describes.
 *
 * Runs as the Vercel build command, and locally:
 *     node scripts/fetch_serving_store.cjs
 * If DATA_STORE_TOKEN, else GITHUB_TOKEN, else GH_TOKEN is set, it downloads
 * through the API (needed while the repository is private). Without a token it
 * tries the public release download URL. If the download fails, the script
 * warns and exits 0: the app runs without
 * the store (the /api/v1/districts routes answer 503 and everything else uses
 * the pilot CSVs). Pass --strict to fail instead.
 */
'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const MANIFEST = path.join(ROOT, 'pipelines', 'manifest.json');
const TARGET = path.join(ROOT, 'dataset', 'serving.sqlite');
const REPO = process.env.DATA_STORE_REPO || 'vinaych580/mitti-mantra';
const STRICT = process.argv.includes('--strict');

function sha256File(file) {
  const h = crypto.createHash('sha256');
  h.update(fs.readFileSync(file));
  return h.digest('hex');
}

function servingEntry(manifest) {
  const s = manifest && manifest.serving;
  if (!s || !s.asset || !s.sha256 || !s.release_tag) return null;
  return s;
}

function giveUp(message) {
  if (STRICT) {
    console.error(`fetch_serving_store: ${message}`);
    process.exit(1);
  }
  console.warn(`fetch_serving_store: ${message}; continuing without the store.`);
  process.exit(0);
}

async function main() {
  let manifest;
  try {
    manifest = JSON.parse(fs.readFileSync(MANIFEST, 'utf8'));
  } catch (err) {
    return giveUp(`cannot read ${path.relative(ROOT, MANIFEST)} (${err.message})`);
  }
  const want = servingEntry(manifest);
  if (!want) return giveUp('the manifest names no serving store');

  if (fs.existsSync(TARGET) && sha256File(TARGET) === want.sha256) {
    console.log(`fetch_serving_store: ${want.asset} already in place`);
    return;
  }

  const token = process.env.DATA_STORE_TOKEN || process.env.GITHUB_TOKEN || process.env.GH_TOKEN;
  if (!token) {
    // A public repository serves release assets without a token.
    const url = `https://github.com/${REPO}/releases/download/${want.release_tag}/${want.asset}`;
    const res = await fetch(url, { headers: { 'User-Agent': 'mitti-mantra-build' } });
    if (!res.ok) {
      return giveUp(`no DATA_STORE_TOKEN / GITHUB_TOKEN set and the public download failed (HTTP ${res.status}; the repository may be private)`);
    }
    return save(want, Buffer.from(await res.arrayBuffer()));
  }
  const api = {
    Authorization: `Bearer ${token}`,
    'X-GitHub-Api-Version': '2022-11-28',
    'User-Agent': 'mitti-mantra-build',
  };

  const rel = await fetch(`https://api.github.com/repos/${REPO}/releases/tags/${want.release_tag}`,
    { headers: { ...api, Accept: 'application/vnd.github+json' } });
  if (!rel.ok) return giveUp(`release ${want.release_tag}: HTTP ${rel.status}`);
  const asset = (await rel.json()).assets.find((a) => a.name === want.asset);
  if (!asset) return giveUp(`release ${want.release_tag} has no asset ${want.asset}`);

  // The asset endpoint redirects to storage; fetch drops the Authorization
  // header on that cross-origin redirect, as it should.
  const res = await fetch(asset.url, { headers: { ...api, Accept: 'application/octet-stream' } });
  if (!res.ok) return giveUp(`download ${want.asset}: HTTP ${res.status}`);
  return save(want, Buffer.from(await res.arrayBuffer()));
}

function save(want, body) {
  const got = crypto.createHash('sha256').update(body).digest('hex');
  if (got !== want.sha256) return giveUp(`${want.asset} checksum mismatch (got ${got.slice(0, 16)})`);

  const tmp = `${TARGET}.part`;
  fs.writeFileSync(tmp, body);
  fs.renameSync(tmp, TARGET);
  console.log(`fetch_serving_store: ${want.asset} (${(body.length / 1e6).toFixed(1)} MB) -> dataset/serving.sqlite`);
}

if (require.main === module) {
  main().catch((err) => giveUp(err.message));
}

module.exports = { servingEntry };
