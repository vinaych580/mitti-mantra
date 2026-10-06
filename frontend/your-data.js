/* =========================================================
   your-data.js — back up, restore and delete what Mitti Mantra
   keeps on this device.

   Every page saves to localStorage under one of three prefixes
   (mittimantra_, mm_, agrisim_). There is no server copy, so a lost or
   replaced phone used to mean a lost farm: plots, committed crops,
   bookings, listings, screenings, expenses. A backup is those keys
   written to a JSON file; a restore writes them back.

   Left out of a backup: caches that rebuild themselves and things that
   belong to one device's screen (the chat button's position, local
   usage counters). The device id IS included, so a seller's own
   marketplace listings are still recognised as theirs after a move.
   ========================================================= */
(() => {
  'use strict';

  const APP = 'mitti-mantra';
  const FORMAT = 1;
  const PREFIX = /^(mittimantra_|mm_|agrisim_)/;
  const NOT_BACKED_UP = new Set([
    'mm_freshness_cache_v1', 'mm_chat_fab_pos', 'mm_chat_fab_edge',
    'mm_usage_counts_v1', 'mm_usage_prefs_v1',
  ]);
  const MAX_FILE_BYTES = 10 * 1024 * 1024;

  // What a farmer would call each thing, in the order they care about it.
  const GROUPS = [
    { label: 'Farm, plots and crop choice', test: k => /^(mittimantra_plots|mittimantra_selectedFarm|agrisim_farm|mm_farm_profile|mm_region_id)/.test(k) },
    { label: 'Money: expenses and harvest sales', test: k => /^mm_(expenses|harvests)/.test(k) },
    { label: 'Crop screenings', test: k => k === 'mittimantra_disease_logs' },
    { label: 'Tractor bookings and listings', test: k => /^mittimantra_(bookings|owner_tractor|tractor_)/.test(k) },
    { label: 'Expert consultations', test: k => /^mittimantra_gyanseva_/.test(k) },
    { label: 'Marketplace: listings, cart and orders', test: k => /^mittimantra_marketplace_/.test(k) },
    { label: 'Settings and assistant memory', test: () => true },
  ];

  const $ = (id) => document.getElementById(id);
  const t = (s) => (window.AgriSimI18n && window.AgriSimI18n.t ? window.AgriSimI18n.t(s) : s);
  const toast = (msg, ms) => (window.MM && window.MM.toast ? window.MM.toast(t(msg), ms || 3500) : alert(t(msg)));
  const esc = (s) => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  /* ---------- Reading what is stored ---------- */
  function appKeys(includeAll) {
    const keys = [];
    try {
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (k && PREFIX.test(k) && (includeAll || !NOT_BACKED_UP.has(k))) keys.push(k);
      }
    } catch (_) { }
    return keys.sort();
  }

  function snapshot() {
    const data = {};
    appKeys(false).forEach(k => {
      try { const v = localStorage.getItem(k); if (v != null) data[k] = v; } catch (_) { }
    });
    return data;
  }

  // How many things a stored value holds: entries of a list, or of the
  // first list inside an object ({plots:[…]}), otherwise one.
  function countOf(raw) {
    try {
      const v = JSON.parse(raw);
      if (Array.isArray(v)) return v.length;
      if (v && typeof v === 'object') {
        const list = Object.values(v).find(Array.isArray);
        if (list) return list.length;
        return Object.keys(v).length ? 1 : 0;
      }
      return raw ? 1 : 0;
    } catch (_) { return raw ? 1 : 0; }
  }

  function summarise(data) {
    const rows = GROUPS.map(g => ({ label: g.label, items: 0, keys: 0 }));
    Object.entries(data).forEach(([k, v]) => {
      const i = GROUPS.findIndex(g => g.test(k));
      rows[i].keys++;
      rows[i].items += countOf(v);
    });
    const bytes = Object.entries(data).reduce((n, [k, v]) => n + k.length + v.length, 0) * 2;
    return { rows: rows.filter(r => r.keys), bytes };
  }

  const kb = (bytes) => bytes < 1024 ? '< 1 KB' : bytes < 1024 * 1024
    ? Math.round(bytes / 1024) + ' KB' : (bytes / 1048576).toFixed(1) + ' MB';

  function summaryHtml(sum) {
    return sum.rows.map(r => `
      <li class="data-summary__row">
        <span>${esc(t(r.label))}</span>
        <b>${r.items}</b>
      </li>`).join('');
  }

  function renderSummary() {
    const sum = summarise(snapshot());
    $('dataSummary').innerHTML = summaryHtml(sum);
    $('dataEmpty').hidden = sum.rows.length > 0;
    $('dataDownload').disabled = !sum.rows.length;
    $('dataShare').disabled = !sum.rows.length;
    $('dataDelete').disabled = !appKeys(true).length;
    $('dataSize').textContent = sum.rows.length ? '· ' + kb(sum.bytes) : '';
  }

  /* ---------- Backup ---------- */
  function backupFile() {
    const payload = { app: APP, format: FORMAT, exportedAt: new Date().toISOString(), data: snapshot() };
    const name = `mitti-mantra-backup-${new Date().toISOString().slice(0, 10)}.json`;
    return new File([JSON.stringify(payload)], name, { type: 'application/json' });
  }

  $('dataDownload').addEventListener('click', () => {
    const file = backupFile();
    const url = URL.createObjectURL(file);
    const a = Object.assign(document.createElement('a'), { href: url, download: file.name });
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    toast('Backup saved. Keep the file somewhere safe.');
  });

  // On Android this opens the share sheet, so the file can go straight to
  // WhatsApp or email, the way most farmers would move it to a new phone.
  const shareBtn = $('dataShare');
  try {
    const probe = new File(['{}'], 'probe.json', { type: 'application/json' });
    if (navigator.canShare && navigator.canShare({ files: [probe] })) shareBtn.hidden = false;
  } catch (_) { }
  shareBtn.addEventListener('click', async () => {
    try {
      await navigator.share({ files: [backupFile()], title: 'Mitti Mantra backup' });
    } catch (err) {
      if (err && err.name !== 'AbortError') toast("This phone couldn't share the file. Use Download backup instead.");
    }
  });

  /* ---------- Restore ---------- */
  function parseBackup(text) {
    let obj;
    try { obj = JSON.parse(text); } catch (_) { return null; }
    if (!obj || obj.app !== APP || typeof obj.data !== 'object' || !obj.data) return null;
    const data = {};
    Object.entries(obj.data).forEach(([k, v]) => {
      if (PREFIX.test(k) && !NOT_BACKED_UP.has(k) && typeof v === 'string') data[k] = v;
    });
    return Object.keys(data).length ? { exportedAt: obj.exportedAt, data } : null;
  }

  let pending = null;
  const preview = $('dataPreview');

  $('dataFile').addEventListener('change', (e) => {
    const file = e.target.files && e.target.files[0];
    e.target.value = '';
    if (!file) return;
    if (file.size > MAX_FILE_BYTES) { toast("That file is too large to be a Mitti Mantra backup."); return; }
    const reader = new FileReader();
    reader.onload = () => {
      pending = parseBackup(String(reader.result || ''));
      if (!pending) {
        preview.hidden = true;
        toast("That isn't a Mitti Mantra backup file.", 4000);
        return;
      }
      const when = Date.parse(pending.exportedAt)
        ? new Date(pending.exportedAt).toLocaleString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit' })
        : '';
      preview.innerHTML = `
        <p class="data-preview__head">${esc(t('This backup contains'))}${when ? ` <span>· ${esc(when)}</span>` : ''}</p>
        <ul class="data-summary">${summaryHtml(summarise(pending.data))}</ul>
        <p class="data-preview__warn">${esc(t('Restoring replaces what is saved on this phone now.'))}</p>
        <div class="data-actions">
          <button type="button" class="btn btn-primary" id="dataRestoreGo">${esc(t('Restore this backup'))}</button>
          <button type="button" class="btn btn-ghost" id="dataRestoreCancel">${esc(t('Cancel'))}</button>
        </div>`;
      preview.hidden = false;
      $('dataRestoreGo').focus();
    };
    reader.onerror = () => toast("That file couldn't be read. Try choosing it again.");
    reader.readAsText(file);
  });

  preview.addEventListener('click', (e) => {
    if (e.target.id === 'dataRestoreCancel') { pending = null; preview.hidden = true; return; }
    if (e.target.id !== 'dataRestoreGo' || !pending) return;
    // Keep the current data until the new data is known to fit, so a full
    // phone never ends up with half of each.
    const before = snapshot();
    try {
      appKeys(false).forEach(k => localStorage.removeItem(k));
      Object.entries(pending.data).forEach(([k, v]) => localStorage.setItem(k, v));
    } catch (_) {
      try {
        appKeys(false).forEach(k => localStorage.removeItem(k));
        Object.entries(before).forEach(([k, v]) => localStorage.setItem(k, v));
      } catch (__) { }
      toast("This phone is out of storage space, so nothing was changed. Free some space and try again.", 5000);
      return;
    }
    pending = null;
    preview.hidden = true;
    renderSummary();
    toast('Backup restored. Your farm is back on this phone.', 4000);
  });

  /* ---------- Delete ---------- */
  $('dataDelete').addEventListener('click', () => {
    if (!confirm(t('Delete everything Mitti Mantra has saved on this phone? This cannot be undone.'))) return;
    appKeys(true).forEach(k => { try { localStorage.removeItem(k); } catch (_) { } });
    renderSummary();
    toast('All Mitti Mantra data on this phone has been deleted.');
  });

  renderSummary();
  // Another tab changing data, or a language change relabelling the rows.
  window.addEventListener('storage', renderSummary);
  document.addEventListener('mm:lang-changed', renderSummary);
})();
