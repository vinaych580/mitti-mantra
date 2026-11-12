/*
 * mm-core.js — cross-page utilities:
 *  - window.MM.fmt       : Indian number / currency / units formatters
 *  - window.MM.profile   : unified Farm Profile (localStorage)
 *  - window.MM.units     : acre/ha, kg/quintal toggle
 *  - window.MM.share     : WhatsApp / print (PDF) / copy-link
 *  - Floating Tools menu : share, accessibility, install
 *  - Farm Profile bar    : auto-injected on /dashboard.html
 *  - Deep-link support   : ?tool=recommend&region_id=… opens the right tool and autofills
 *  - A11y toggles        : high-contrast, large-text
 *  - PWA install prompt  : uses beforeinstallprompt
 *
 * Include BEFORE dashboard.js on dashboard pages, anywhere on index.
 */
(function () {
  if (window.MM) return;
  const LS = {
    profile: "mm_farm_profile",
    units:   "mm_units",
    a11y:    "mm_a11y",
  };

  // ------------------------------------------------------------------
  // Formatter
  // ------------------------------------------------------------------
  const fmt = {
    inr(v, { compact = true } = {}) {
      const n = Number(v) || 0;
      if (compact && Math.abs(n) >= 1e7) return `₹${(n / 1e7).toFixed(2)} Cr`;
      if (compact && Math.abs(n) >= 1e5) return `₹${(n / 1e5).toFixed(2)} L`;
      return "₹" + n.toLocaleString("en-IN", { maximumFractionDigits: 0 });
    },
    num(v) { return Number(v || 0).toLocaleString("en-IN"); },
    pct(v, d = 1) { return `${(Number(v) || 0).toFixed(d)}%`; },
    weight(kg) {
      const u = units.get().weight;
      return u === "quintal"
        ? `${(kg / 100).toLocaleString("en-IN", { maximumFractionDigits: 2 })} q`
        : `${Number(kg).toLocaleString("en-IN", { maximumFractionDigits: 0 })} kg`;
    },
    area(ac) {
      const u = units.get().area;
      return u === "hectare"
        ? `${(ac * 0.4047).toFixed(2)} ha`
        : `${Number(ac).toFixed(2)} ac`;
    },
  };

  // ------------------------------------------------------------------
  // Farm Profile (shared across all tools + chatbot)
  // ------------------------------------------------------------------
  const DEFAULT_PROFILE = {
    region_id: "",
    season: "kharif",
    area_acres: 4,
    // 0 = not chosen yet: pages ask /api/budget-default for the typical
    // cost of the region and season instead of a flat figure.
    budget_per_acre: 0,
    crop_id: "",
  };
  /**
   * The drawn boundary is the single source of truth for region and area.
   * Before this, the profile kept its own copy (defaulting to 4 acres) and the
   * two silently diverged — the pickup banner could read "2.31 acres" while the
   * farm bar read 4, and saving the bar pushed 4 into every tool.
   * Returns null when farm-state.js is absent (index, marketplace, …).
   */
  function activePlot() {
    try {
      return (window.FarmState && typeof window.FarmState.load === "function")
        ? window.FarmState.load()
        : null;
    } catch (_) { return null; }
  }

  /** A plot whose acreage was measured from a drawn boundary. */
  function isMeasured(plot) {
    return !!(plot && plot.geojson && Number(plot.acres) > 0);
  }

  const profile = {
    get() {
      let stored = null;
      try { stored = JSON.parse(localStorage.getItem(LS.profile) || "null"); } catch (_) {}
      const p = Object.assign({}, DEFAULT_PROFILE, stored || {});
      const plot = activePlot();
      if (plot) {
        if (plot.region_id) p.region_id = plot.region_id;
        if (Number(plot.acres) > 0) p.area_acres = +Number(plot.acres).toFixed(2);
      }
      return p;
    },
    set(patch) {
      const next = Object.assign(this.get(), patch || {});

      // A measured area is never writable here — a typed acreage would
      // contradict the polygon it came from; the draw page owns it. Region is
      // metadata rather than geometry, so an override is legitimate and is
      // stored on the plot.
      const plot = activePlot();
      if (plot) {
        const plotPatch = {};
        if (isMeasured(plot)) next.area_acres = +Number(plot.acres).toFixed(2);
        else if (Number(next.area_acres) > 0 && Number(next.area_acres) !== Number(plot.acres)) {
          // No boundary behind this plot (it came from committing to a crop),
          // so its acreage is just a setting -- keep the plot in step.
          plotPatch.acres = Number(next.area_acres);
        }
        if (next.region_id && next.region_id !== plot.region_id) plotPatch.region_id = next.region_id;
        if (Object.keys(plotPatch).length) {
          try { window.FarmState.save(plotPatch); } catch (_) {}
        }
      }

      try { localStorage.setItem(LS.profile, JSON.stringify(next)); } catch (_) {}
      // Keep the chatbot's legacy key in sync so the bot always knows the region.
      try { if (next.region_id) localStorage.setItem("mm_region_id", next.region_id); } catch (_) {}
      document.dispatchEvent(new CustomEvent("mm:profile-changed", { detail: next }));
      this.applyToForms();
      return next;
    },
    /** Auto-fill every form field that matches a profile key. */
    applyToForms() {
      const p = this.get();
      document.querySelectorAll("form[data-form] [name]").forEach((el) => {
        const k = el.name;
        if (k in p && p[k] !== "" && p[k] !== undefined && p[k] !== null) {
          if (el.dataset.mmUserDirty === "1") return;
          // A budget of 0 means "not chosen": the field keeps its typical default.
          if (k === "budget_per_acre" && !(Number(p[k]) > 0)) return;
          // A <select> silently goes blank when handed a value it has no
          // <option> for -- which happens whenever the profile holds a region
          // the dropdown hasn't loaded (or can't represent). Leaving the
          // existing selection is always better than emptying the control.
          if (el.tagName === "SELECT" &&
              !Array.from(el.options).some((o) => o.value === String(p[k]))) return;
          if (el.value != String(p[k])) el.value = p[k];
        }
      });
      if (document.querySelector(".dashx__wrap")) refreshAllUseFarm();
    },
    /** Open the farm bar's fields (dashboard only; a no-op elsewhere). */
    openEditor() { openFarmEditor(); },
  };

  // ------------------------------------------------------------------
  // Units (read-only toggle used by formatters)
  // ------------------------------------------------------------------
  const units = {
    get() {
      try { return Object.assign({ area: "acre", weight: "kg" }, JSON.parse(localStorage.getItem(LS.units) || "{}")); }
      catch (_) { return { area: "acre", weight: "kg" }; }
    },
    set(patch) {
      const next = Object.assign(this.get(), patch || {});
      try { localStorage.setItem(LS.units, JSON.stringify(next)); } catch (_) {}
      document.dispatchEvent(new CustomEvent("mm:units-changed", { detail: next }));
    },
  };

  // ------------------------------------------------------------------
  // A11y (applied as <html> classes -- see the mm-lg font-size note below
  // for why this can't live on <body>)
  // ------------------------------------------------------------------
  const a11y = {
    get() { try { return JSON.parse(localStorage.getItem(LS.a11y) || "{}"); } catch (_) { return {}; } },
    set(patch) {
      const next = Object.assign(this.get(), patch || {});
      try { localStorage.setItem(LS.a11y, JSON.stringify(next)); } catch (_) {}
      apply();
    },
    toggle(key) { this.set({ [key]: !this.get()[key] }); },
  };
  function apply() {
    const a = a11y.get();
    document.documentElement.classList.toggle("mm-hc", !!a.highContrast);
    document.documentElement.classList.toggle("mm-lg", !!a.largeText);
  }

  // ------------------------------------------------------------------
  // Share helpers
  // ------------------------------------------------------------------
  const share = {
    whatsapp(text) {
      const url = "https://wa.me/?text=" + encodeURIComponent(text + "\n\n" + location.href);
      window.open(url, "_blank", "noopener");
    },
    print() { window.print(); },
    copyLink() {
      const u = location.href;
      navigator.clipboard ? navigator.clipboard.writeText(u).then(() => toast("Link copied"))
                          : prompt("Copy link:", u);
    },
  };

  // ------------------------------------------------------------------
  // Styles (injected once)
  // ------------------------------------------------------------------
  const css = `
  /* ---- Farm Profile bar ----
     Tokenized against DESIGN.md: brand/ink hues are constant across themes,
     so this needs no separate toolbar.js dark-mode block — it inherits.

     Three states (data-mode): "summary" -- one line, the normal state, which
     also covers "not set up yet" -- and "edit" (the fields). It used to show
     all four fields all the time: ~100px pinned under the nav, repeating the
     same questions each tool then asked again below it. */
  .mm-farm-bar{position:sticky;top:60px;z-index:40;
    background:linear-gradient(135deg,var(--brand-soft),var(--bg-soft));
    border:1px solid color-mix(in srgb, var(--brand) 20%, transparent);border-radius:14px;
    padding:8px 14px;margin:12px 0 16px;
    display:flex;gap:10px 14px;align-items:center;flex-wrap:wrap;box-shadow:var(--shadow-sm);
    font-family:var(--font-body, Inter, system-ui, sans-serif);grid-column:1 / -1;}
  .mm-farm-bar__lbl{font-size:.72rem;font-weight:700;color:var(--brand);letter-spacing:.1em;
    text-transform:uppercase;margin-right:4px;display:flex;align-items:center;gap:6px;}
  .mm-farm-bar__summary{display:flex;align-items:center;gap:10px 14px;flex-wrap:wrap;flex:1;min-width:0;}
  .mm-farm-bar__plot-slot:empty{display:none;}
  .mm-farm-bar__fresh{margin-left:auto;}
  .mm-farm-bar__fresh:empty{display:none;}
  .mm-farm-bar__fresh:not(:empty) + .mm-farm-bar__edit{margin-left:0;}
  .mm-farm-bar__plot-slot .mm-plotpick > small{display:none;}   /* the select has its own aria-label */
  .mm-farm-bar__text{font-size:var(--fs-xs);font-weight:600;color:var(--ink);font-variant-numeric:tabular-nums;}
  .mm-farm-bar__text.is-empty{font-weight:500;color:var(--ink-soft);}
  .mm-farm-bar__fields{display:none;gap:10px;align-items:flex-end;flex-wrap:wrap;flex:1 1 100%;}
  .mm-farm-bar[data-mode="edit"] .mm-farm-bar__fields{display:flex;}
  .mm-farm-bar[data-mode="edit"] .mm-farm-bar__text,
  .mm-farm-bar[data-mode="edit"] .mm-farm-bar__edit{display:none;}
  .mm-farm-bar__field{display:flex;flex-direction:column;gap:2px;min-width:130px;}
  .mm-farm-bar__field small{font-size:.65rem;color:var(--ink-soft);font-weight:600;text-transform:uppercase;letter-spacing:.08em;}
  .mm-farm-bar select,.mm-farm-bar input{border:1.5px solid rgba(29,26,21,.1);background:var(--bg);color:var(--ink);
    border-radius:8px;padding:6px 8px;font-size:13px;font-family:inherit;min-width:120px;}
  .mm-farm-bar__edit,.mm-farm-bar__cancel{margin-left:auto;background:transparent;color:var(--brand-deep);
    border:1.5px solid color-mix(in srgb, var(--brand) 35%, transparent);border-radius:999px;
    padding:6px 14px;font-weight:600;font-size:12.5px;cursor:pointer;}
  .mm-farm-bar__edit:hover,.mm-farm-bar__cancel:hover{background:var(--surface);}
  .mm-farm-bar__save{background:var(--brand);color:#fff;border:none;border-radius:999px;
    padding:7px 16px;font-weight:600;font-size:12.5px;cursor:pointer;}
  .mm-farm-bar__save:hover{background:var(--brand-deep);}
  .mm-farm-bar__hint{font-size:.7rem;color:var(--ink-soft);}
  .mm-farm-bar input[readonly]{background:var(--bg-soft);color:var(--ink-soft);cursor:default;}
  .mm-farm-bar__measured{font-size:.72rem;color:var(--ink-soft);text-decoration:underline;
    text-underline-offset:2px;margin-top:2px;}
  @media (max-width:860px){
    .mm-farm-bar{position:static;}
    /* Thumb-sized targets, and a 16px floor so iOS doesn't zoom on focus. */
    .mm-farm-bar select,.mm-farm-bar input{min-height:44px;padding:8px 10px;font-size:16px;}
    .mm-farm-bar__edit,.mm-farm-bar__cancel,.mm-farm-bar__save{min-height:44px;}
  }
  @media (max-width:620px){
    .mm-farm-bar{gap:8px;padding:10px 12px;}
    .mm-farm-bar__field{min-width:0;flex:1 1 calc(50% - 4px);}
    .mm-farm-bar select,.mm-farm-bar input{min-width:0;width:100%;}
    .mm-farm-bar__hint{display:none;}
    .mm-farm-bar__cancel,.mm-farm-bar__save{flex:1 1 calc(50% - 4px);font-size:14px;margin-left:0;}
    /* Label on its own line, then the farm in full, then the actions -- beside
       the label the summary was squeezed into four ragged lines. */
    .mm-farm-bar__summary{flex:1 1 100%;gap:8px;}
    .mm-farm-bar__text{flex:1 1 100%;}
    .mm-farm-bar__fresh{margin-left:0;}
    .mm-farm-bar__edit{margin-left:auto;}
  }

  /* ---- "Using your farm" line in tool forms ----
     Region, season, area and budget are set once in the farm bar; a tool
     shows them as one line instead of asking again. "Change for this tool"
     opens the fields for a one-off what-if without touching the saved farm. */
  .mm-usefarm{display:flex;align-items:center;flex-wrap:wrap;gap:6px 12px;margin:0 0 16px;
    padding:10px 14px;border-radius:var(--r-md);background:var(--bg-soft);font-size:var(--fs-xs);}
  .mm-usefarm__lbl{font-weight:600;color:var(--ink-soft);}
  .mm-usefarm__val{font-weight:600;color:var(--ink);font-variant-numeric:tabular-nums;}
  .mm-usefarm__btn{margin-left:auto;background:none;border:none;padding:4px 0;cursor:pointer;
    color:var(--brand-deep);font-weight:600;font-size:var(--fs-2xs);text-decoration:underline;text-underline-offset:3px;}
  form.mm-usefarm-on:not(.mm-usefarm-open) .mm-bound{display:none !important;}
  form.mm-usefarm-open .mm-usefarm{background:var(--accent-soft);}
  @media (max-width:860px){ .mm-usefarm__btn{min-height:44px;} }

  /* ---- Toast ---- */
  .mm-toast{position:fixed;left:50%;bottom:34px;transform:translateX(-50%);
    background:var(--brand-deep);color:#fff;padding:10px 16px;border-radius:999px;font-size:13px;
    box-shadow:0 8px 24px rgba(29,26,21,.25);z-index:10000;opacity:0;transition:opacity .25s, transform .25s;
    font-family:var(--font-body, 'Inter', system-ui, sans-serif);}
  .mm-toast.show{opacity:1;transform:translateX(-50%) translateY(-4px);}

  /* ---- A11y modes ----
     Applied on <html> rather than <body>: nearly every font-size in this
     codebase is set in rem, which is relative to the root element's
     font-size and ignores body's -- a body.mm-lg rule here was a near
     no-op for all of that text. */
  html.mm-lg{font-size:18px;}
  html.mm-lg .kpi__val{font-size:1.6rem;}
  html.mm-hc{filter:contrast(1.15) saturate(1.15);}
  /* var(--ink) rather than a fixed rgba so the outline stays visible against
     the KPI tile's own background in both themes — a black outline vanishes
     against the dark-mode tile it's meant to highlight. */
  html.mm-hc .kpi{outline:2px solid color-mix(in srgb, var(--ink) 35%, transparent);}
  html.mm-hc a,html.mm-hc .btn-primary{text-decoration:underline;}

  /* ---- Print / PDF ---- */
  @media print{
    .nav, .footer, .sidebar, .mobile-panel, .mobile-backdrop,
    .mm-chat-fab, .mm-chat-panel, .qw-fab, .qw-panel, .mm-farm-bar__save,
    .farm-pickup, #scene3d, .hero__scene, form[data-form] button[type=submit]
    { display:none !important; }
    body { background:#fff !important; }
    .tool { page-break-inside: avoid; }
    .kpi-grid, .chart-grid { break-inside: avoid; }
  }`;
  const styleEl = document.createElement("style");
  styleEl.textContent = css;
  document.head.appendChild(styleEl);

  // ------------------------------------------------------------------
  // Shared reference-data GET memo
  // ------------------------------------------------------------------
  /* dashboard.js caches its own reference GETs, but it loads after this file
     and only on dashboard.html, so /api/regions was still fetched twice on the
     page where it matters most: once by the farm bar below, once by
     dashboard.js. The store lives here because mm-core is the one script on
     every page, and it holds the in-flight promise rather than the settled
     value so concurrent callers collapse into one request instead of racing.

     The producer stays with the caller: dashboard.js's fetch wrapper has
     offline fallbacks and error shaping that a bare fetch here does not, and
     whichever caller arrives first should get to supply those. */
  const memoStore = new Map();

  function memoGet(key, ttlMs, producer) {
    const hit = memoStore.get(key);
    if (hit && Date.now() - hit.at < ttlMs) return hit.promise;
    const promise = producer();
    memoStore.set(key, { at: Date.now(), promise });
    // Never remember a failure as if it were a result.
    promise.catch(() => {
      const current = memoStore.get(key);
      if (current && current.promise === promise) memoStore.delete(key);
    });
    return promise;
  }

  // Reference tables come from CSVs that only change on a deploy, so nothing a
  // user does in a session invalidates them. Matches dashboard.js's TTL.
  const REFERENCE_TTL_MS = 5 * 60 * 1000;

  // ------------------------------------------------------------------
  // HTML escaping
  // ------------------------------------------------------------------
  function escapeHtml(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => (
      { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
    ));
  }

  // ------------------------------------------------------------------
  // Toast
  // ------------------------------------------------------------------
  function toast(msg, ms = 2000) {
    const t = document.createElement("div");
    t.className = "mm-toast";
    t.textContent = msg;
    document.body.appendChild(t);
    requestAnimationFrame(() => t.classList.add("show"));
    setTimeout(() => { t.classList.remove("show"); setTimeout(() => t.remove(), 300); }, ms);
  }

  const SEASON_NAMES = { kharif: "Kharif", rabi: "Rabi", zaid: "Zaid" };
  let openFarmEditor = () => {};      // set once the farm bar exists

  function retranslateIfNeeded() {
    try {
      const i18n = window.AgriSimI18n;
      if (i18n && i18n.getLanguage() !== "en") i18n.retranslate();
    } catch (_) {}
  }

  function regionLabel(id) {
    if (!id) return "";
    const rec = window.FarmState && window.FarmState.getRegionRecord
      ? window.FarmState.getRegionRecord(id) : null;
    return rec ? rec.displayName : id;
  }

  // ------------------------------------------------------------------
  // "Using your farm" — tool forms stop re-asking the farm-bar fields
  // ------------------------------------------------------------------
  /* Nearly every tool opened with the same Region / Season / Area / Budget
     fields the farm bar had just asked for. Once a farm is saved, those fields
     are folded into one line that reads the form's *own* values (so it always
     says exactly what will be submitted), with a way to open them for a
     one-off what-if. Before a farm is saved, forms show their fields as-is. */
  const BOUND_FIELDS = ["region_id", "season", "area_acres", "budget_per_acre"];
  const SKIP_FORMS = new Set(["home-setup"]);

  function boundEls(form) {
    return BOUND_FIELDS
      .map((n) => form.elements[n])
      .filter((el) => el && el.tagName && el.closest(".field"));
  }

  function formSummary(form) {
    const bits = [];
    const r = form.elements.region_id;
    if (r && r.tagName === "SELECT" && r.closest(".field")) {
      const opt = r.selectedOptions && r.selectedOptions[0];
      bits.push(opt ? opt.textContent : regionLabel(r.value));
    }
    const se = form.elements.season;
    if (se && se.tagName && se.closest(".field")) bits.push(SEASON_NAMES[se.value] || se.value);
    const a = form.elements.area_acres;
    if (a && a.tagName && a.closest(".field") && a.value) bits.push(`${+Number(a.value).toFixed(2)} ac`);
    const b = form.elements.budget_per_acre;
    if (b && b.tagName && b.closest(".field") && b.value) bits.push(`₹${Number(b.value).toLocaleString("en-IN")}/ac`);
    return bits.filter(Boolean).join(" · ");
  }

  function decorateForm(form) {
    if (form.dataset.mmUsefarm || SKIP_FORMS.has(form.dataset.form)) return;
    const els = boundEls(form);
    if (!els.length) return;
    form.dataset.mmUsefarm = "1";
    els.forEach((el) => el.closest(".field").classList.add("mm-bound"));
    // A row whose every field is bound would collapse to an empty gap.
    form.querySelectorAll(".form-row").forEach((row) => {
      const fields = row.querySelectorAll(":scope > .field");
      if (fields.length && Array.from(fields).every((f) => f.classList.contains("mm-bound"))) {
        row.classList.add("mm-bound");
      }
    });
    const line = document.createElement("div");
    line.className = "mm-usefarm";
    line.innerHTML = `
      <span class="mm-usefarm__lbl">Using your farm</span>
      <span class="mm-usefarm__val" data-no-translate></span>
      <button type="button" class="mm-usefarm__btn">Change for this tool</button>`;
    form.insertBefore(line, form.firstChild);
    line.querySelector(".mm-usefarm__btn").addEventListener("click", () => {
      if (form.classList.contains("mm-usefarm-open")) resetFormToFarm(form);
      else openUseFarm(form);
    });
    form.addEventListener("change", () => refreshUseFarm(form));
    // A hidden control the browser won't let through would otherwise block
    // the submit with an error bubble pointing at nothing.
    form.addEventListener("invalid", () => openUseFarm(form), true);
  }

  function openUseFarm(form, { focus = true } = {}) {
    form.classList.add("mm-usefarm-open");
    refreshUseFarm(form);
    const first = form.querySelector(".mm-bound select, .mm-bound input");
    if (focus && first) first.focus();
  }

  function resetFormToFarm(form) {
    boundEls(form).forEach((el) => { delete el.dataset.mmUserDirty; });
    form.classList.remove("mm-usefarm-open");
    profile.applyToForms();
  }

  function refreshUseFarm(form) {
    const line = form.querySelector(":scope > .mm-usefarm");
    if (!line) return;
    const on = !!profile.get().region_id;
    form.classList.toggle("mm-usefarm-on", on);
    line.hidden = !on;
    if (!on) return;
    const open = form.classList.contains("mm-usefarm-open");
    line.querySelector(".mm-usefarm__lbl").textContent = open ? "Just for this tool" : "Using your farm";
    line.querySelector(".mm-usefarm__val").textContent = formSummary(form);
    line.querySelector(".mm-usefarm__btn").textContent = open ? "Back to my farm" : "Change for this tool";
  }

  function refreshAllUseFarm() {
    document.querySelectorAll("form[data-form]").forEach((form) => {
      decorateForm(form);
      refreshUseFarm(form);
    });
    retranslateIfNeeded();
  }

  // ------------------------------------------------------------------
  // Farm Profile bar (dashboard only)
  // ------------------------------------------------------------------
  async function buildFarmBar() {
    const host = document.querySelector(".dashx__wrap");
    if (!host || document.querySelector(".mm-farm-bar")) return;
    // Wait for region dropdowns in dashboard.js to populate so we can mirror them.
    const bar = document.createElement("div");
    bar.className = "mm-farm-bar";
    bar.dataset.mode = "summary";
    bar.innerHTML = `
      <span class="mm-farm-bar__lbl">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M12 2 C9 8 7 12 7 15 a5 5 0 0 0 10 0 c0-3-2-7-5-13z"/></svg>
        My farm
      </span>
      <div class="mm-farm-bar__summary">
        <span class="mm-farm-bar__plot-slot"></span>
        <span class="mm-farm-bar__text" data-no-translate></span>
        <span class="mm-farm-bar__fresh" data-mm-freshness-slot></span>
        <button type="button" class="mm-farm-bar__edit">Change</button>
      </div>
      <div class="mm-farm-bar__fields">
        <label class="mm-farm-bar__field"><small>Region</small>
          <select data-mm="region_id" data-regions></select></label>
        <label class="mm-farm-bar__field"><small>Season</small>
          <select data-mm="season">
            <option value="kharif">Kharif</option><option value="rabi">Rabi</option><option value="zaid">Zaid</option>
          </select></label>
        <label class="mm-farm-bar__field"><small>Area (acres)</small>
          <input data-mm="area_acres" type="number" min="0.1" step="0.1">
          <a class="mm-farm-bar__measured" href="farm-boundary.html" hidden>measured — edit boundary</a></label>
        <label class="mm-farm-bar__field"><small>Budget / acre (₹)</small>
          <input data-mm="budget_per_acre" type="number" min="0" step="500"></label>
        <span class="mm-farm-bar__hint">Used by every tool & the chatbot</span>
        <button type="button" class="mm-farm-bar__cancel">Cancel</button>
        <button type="button" class="mm-farm-bar__save">Save</button>
      </div>`;
    host.insertBefore(bar, host.firstChild);

    // Populate regions from API (same endpoint dashboard.js uses)
    let regions = [];
    try {
      regions = await memoGet("/api/regions", REFERENCE_TTL_MS,
        () => fetch("/api/regions").then(r => r.json()));
    } catch (_) {}
    const regSel = bar.querySelector('[data-mm="region_id"]');
    // No extra "(My Farm)" duplicate: fillBar() below selects the plot's
    // region, and a duplicate option was never removed when the plot changed.
    if (Array.isArray(regions) && regions.length && !regSel.options.length) {
      regSel.innerHTML = regions.map(r => {
        const id = r.id || r.region_id;
        return `<option value="${escapeHtml(id)}">${escapeHtml(r.name || r.region_name || id)}</option>`;
      }).join("");
    }

    // Load current profile into bar
    function fillBar() {
      const p = profile.get();
      bar.querySelectorAll("[data-mm]").forEach((el) => {
        const k = el.dataset.mm;
        if (k === "budget_per_acre" && !(Number(p[k]) > 0)) return;
        if (p[k] !== undefined && p[k] !== "") el.value = p[k];
      });
      // With a boundary drawn, the area is a measurement, not a setting: show it
      // read-only and point at the page that can actually change it.
      const areaEl = bar.querySelector('[data-mm="area_acres"]');
      const measuredNote = bar.querySelector(".mm-farm-bar__measured");
      // Only a drawn boundary is a measurement; a plot created by committing
      // to a crop has no geometry, so its area stays editable.
      const measured = isMeasured(activePlot());
      if (areaEl) {
        areaEl.readOnly = measured;
        areaEl.title = measured
          ? "Measured from the boundary you drew — edit the boundary to change it."
          : "Area used by every tool.";
        if (measuredNote) measuredNote.hidden = !measured;
      }

      // The region list comes from /api/regions; a plot matched offline (or while
      // the API was unreachable) would otherwise select nothing and read as blank.
      if (p.region_id && regSel && !regSel.querySelector(`option[value="${p.region_id}"]`)) {
        const rec = window.FarmState && window.FarmState.getRegionRecord
          ? window.FarmState.getRegionRecord(p.region_id)
          : null;
        const label = rec ? rec.displayName : p.region_id;
        regSel.insertAdjacentHTML("afterbegin",
          `<option value="${escapeHtml(p.region_id)}">${escapeHtml(label)}</option>`);
        regSel.value = p.region_id;
      }
    }
    fillBar();

    const textEl = bar.querySelector(".mm-farm-bar__text");
    const editBtn = bar.querySelector(".mm-farm-bar__edit");
    function hasFarm() { return !!profile.get().region_id; }
    function summaryText() {
      const p = profile.get();
      const opt = regSel && regSel.selectedOptions && regSel.selectedOptions[0];
      const region = (opt && opt.value === p.region_id) ? opt.textContent : regionLabel(p.region_id);
      const season = SEASON_NAMES[p.season] || p.season;
      const bits = [region, season, `${+Number(p.area_acres || 0).toFixed(2)} ac`];
      if (Number(p.budget_per_acre) > 0) bits.push(`₹${Number(p.budget_per_acre).toLocaleString("en-IN")}/ac`);
      return bits.join(" · ");
    }
    function setMode(mode) {
      bar.dataset.mode = mode;
      if (mode === "edit") {
        fillBar();
        const first = bar.querySelector(".mm-farm-bar__fields select, .mm-farm-bar__fields input:not([readonly])");
        if (first) first.focus();
        return;
      }
      const set = hasFarm();
      textEl.textContent = set ? summaryText() : "Not set up yet";
      textEl.classList.toggle("is-empty", !set);
      editBtn.textContent = set ? "Change" : "Set up my farm";
      retranslateIfNeeded();
    }
    editBtn.addEventListener("click", () => setMode("edit"));
    bar.querySelector(".mm-farm-bar__cancel").addEventListener("click", () => { setMode("summary"); editBtn.focus(); });
    bar.addEventListener("keydown", (e) => {
      if (e.key === "Escape" && bar.dataset.mode === "edit") { setMode("summary"); editBtn.focus(); }
    });
    setMode("summary");
    document.addEventListener("mm:profile-changed", () => { if (bar.dataset.mode !== "edit") setMode("summary"); });
    openFarmEditor = () => {
      setMode("edit");
      bar.scrollIntoView({ behavior: "smooth", block: "nearest" });
    };

    // A plot drawn, switched, or removed on any page is the source of truth —
    // pull its values into the bar AND into the tool forms, so a switch is not
    // half-applied (bar updated, forms still showing the previous plot).
    document.addEventListener("mm:plot-changed", () => {
      fillBar();
      profile.applyToForms();
      if (bar.dataset.mode !== "edit") setMode("summary");
    });

    // M-6: the plot-name dropdown (mm-plots.js) listens for the cross-tab
    // 'storage' event and refreshes; this farm bar only reacted to the
    // same-tab 'mm:plot-changed' CustomEvent above, so two tabs open at once
    // would disagree about the active plot's region/season/budget after a
    // switch made in one of them. Mirror mm-plots.js's approach here too.
    window.addEventListener("storage", (e) => {
      const fs = window.FarmState;
      const relevantKeys = fs
        ? [fs.PLOTS_KEY, fs.STORAGE_KEY, fs.LEGACY_KEY].filter(Boolean)
        : ["mittimantra_plots_v1", "mittimantra_selectedFarm", "agrisim_farm"];
      if (e.key !== null && !relevantKeys.includes(e.key)) return;
      fillBar();
      profile.applyToForms();
      if (bar.dataset.mode !== "edit") setMode("summary");
    });

    // Save
    bar.querySelector(".mm-farm-bar__save").addEventListener("click", () => {
      const patch = {};
      let invalid = null;
      bar.querySelectorAll("[data-mm]").forEach((el) => {
        if (el.type !== "number") { patch[el.dataset.mm] = el.value; return; }
        if (el.readOnly) return;                 // measured area -- not ours to write
        const n = parseFloat(el.value);
        // A blank or zero area used to be saved as 0 acres and pushed into
        // every tool, which then failed validation one by one.
        const min = parseFloat(el.min) || 0;
        if (!isFinite(n) || n < min || (el.dataset.mm === "area_acres" && n <= 0)) {
          invalid = invalid || el;
          return;
        }
        patch[el.dataset.mm] = n;
      });
      if (invalid) {
        invalid.focus();
        toast(invalid.dataset.mm === "area_acres" ? "Enter an area above 0 acres" : "Enter a budget of ₹0 or more", 3000);
        return;
      }
      profile.set(patch);
      setMode("summary");
      editBtn.focus();
      toast("Farm profile saved — all tools updated");
    });

    // Live sync when user edits a form in a tool (remember their dirty edits)
    document.addEventListener("input", (e) => {
      if (!e.target.matches || !e.target.matches("form[data-form] [name]")) return;
      e.target.dataset.mmUserDirty = "1";
    }, true);

    // Apply profile to all tool forms whenever they're ready
    setTimeout(() => profile.applyToForms(), 400);
    setTimeout(() => profile.applyToForms(), 1200);

    // Deep-linking: ?tool=recommend&region_id=…&crop_id=…
    // Used by the chatbot's action buttons and by links from the landing page.
    const q = new URLSearchParams(location.search);
    const rawTool = (q.get("tool") || "").trim().toLowerCase();
    if (rawTool) {
      // Names older links use that never matched a sidebar button.
      const TOOL_ALIASES = { pests: "pest", prices: "forecast", price: "forecast" };
      const tool = TOOL_ALIASES[rawTool] || rawTool;
      const linked = {};
      for (const k of ["region_id", "season", "crop_id", "area_acres", "budget_per_acre"]) {
        if (q.get(k)) linked[k] = q.get(k);
      }

      // A link is a request to *look at* something, not to re-home the farm.
      // Persisting the whole patch meant that asking the chatbot about a
      // neighbouring mandi silently rewrote the saved farm for every tool. Only
      // fill profile keys that are still empty; the rest is applied to the
      // linked tool's own form below and forgotten on the next visit.
      const current = profile.get();
      const seed = {};
      for (const [k, v] of Object.entries(linked)) {
        if (current[k] === undefined || current[k] === "" || current[k] === null) seed[k] = v;
      }
      if (Object.keys(seed).length) profile.set(seed);

      // The tool panels exist at parse time but their <select> options are
      // filled from /api/regions and /api/crops, so a fixed timeout raced the
      // network on a slow connection and silently dropped the prefill. Wait for
      // the button, then for the options, with a hard cap.
      whenReady(`.sidebar__btn[data-tool="${tool}"]`, 6000, (btn) => {
        // The click scrolls to the tool itself (and keeps the rail button in
        // view). A second scrollIntoView on the rail button here used to win
        // that race -- on a phone the rail sits above the tools, so a deep
        // link opened the right tool but left the page on the tool list.
        btn.click();
        profile.applyToForms();
        const form = document.querySelector(`form[data-form="${tool}"]`);
        if (form) {
          for (const [k, v] of Object.entries(linked)) {
            const el = form.elements[k];
            if (!el || !el.tagName) continue;   // absent, or a radio/checkbox group
            // Assigning a value a <select> has no <option> for blanks it, and
            // the tool then submits an empty field.
            if (el.tagName === "SELECT" &&
                !Array.from(el.options).some((o) => o.value === v)) continue;
            el.value = v;
            el.dataset.mmUserDirty = "1";  // don't let a later applyToForms undo it
          }
          // The link brought its own region/season/area/budget: show them as
          // this tool's one-off values rather than hiding them behind a
          // "Using your farm" line that would no longer be true.
          if (Object.keys(linked).some((k) => BOUND_FIELDS.includes(k))) {
            decorateForm(form);
            openUseFarm(form, { focus: false });
          }
        }
        // Drop the one-off prefill so a reload or a shared URL doesn't replay
        // it. `tool` stays: the dashboard keeps ?tool= in step with the open
        // tool so a reload returns to the same view.
        ["region_id", "season", "crop_id", "area_acres", "budget_per_acre"]
          .forEach((k) => q.delete(k));
        const rest = q.toString();
        history.replaceState({}, "", location.pathname + (rest ? "?" + rest : "") + location.hash);
      }, `form[data-form="${tool}"]`);
    }
  }

  /** Poll for `selector` until it exists (and any <select> inside the matching
   *  tool has options), then run `fn`. Gives up after `timeoutMs`. */
  function whenReady(selector, timeoutMs, fn, formSelector) {
    const started = Date.now();
    (function tick() {
      const el = document.querySelector(selector);
      // The farm bar's own region select carries data-regions too and fills
      // first, so "any region select has options" fired before the linked
      // tool's selects did -- the link's region was then dropped as an
      // unknown option. Wait for the target form's own selects.
      const form = formSelector ? document.querySelector(formSelector) : null;
      const regionsFilled = form
        ? (!form.querySelector("select[data-regions]") || form.querySelector("select[data-regions] option"))
        : document.querySelector("select[data-regions] option");
      if (el && regionsFilled) return fn(el);
      if (Date.now() - started > timeoutMs) { if (el) fn(el); return; }
      setTimeout(tick, 80);
    })();
  }

  const DEVICE_ID_KEY = 'mittimantra_device_id';
  function deviceId() {
    let id = null;
    try { id = localStorage.getItem(DEVICE_ID_KEY); } catch (_) {}
    if (!id) {
      id = 'dev_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 8);
      try { localStorage.setItem(DEVICE_ID_KEY, id); } catch (_) {}
    }
    return id;
  }

  // ------------------------------------------------------------------
  // Public API
  // ------------------------------------------------------------------
  // ------------------------------------------------------------------
  // One default region for every page (landing, planner, dashboard): the
  // farm profile or active plot, else the nearest district when location
  // permission was already granted, else Sehore. Landing used to default to
  // MP · Sehore while the planner opened on Telangana · Medak.
  // ------------------------------------------------------------------
  const FALLBACK_REGION_ID = "mp_sehore";
  function defaultRegion() {
    return profile.get().region_id || FALLBACK_REGION_ID;
  }
  /** Resolves to the profile region, or a located one without prompting. */
  async function locateDefaultRegion() {
    const known = profile.get().region_id;
    if (known) return known;
    try {
      const fs = window.FarmState;
      if (!navigator.geolocation || !navigator.permissions || !fs || !fs.getNearestRegionId) return FALLBACK_REGION_ID;
      const state = await navigator.permissions.query({ name: "geolocation" });
      if (state.state !== "granted") return FALLBACK_REGION_ID;
      const pos = await new Promise((ok, fail) =>
        navigator.geolocation.getCurrentPosition(ok, fail, { maximumAge: 3600000, timeout: 4000 }));
      return fs.getNearestRegionId([pos.coords.longitude, pos.coords.latitude]) || FALLBACK_REGION_ID;
    } catch (_) {
      return FALLBACK_REGION_ID;
    }
  }

  // Typical input budget per acre for a region/season (/api/budget-default).
  // The old flat ₹15,000 was below the cost of rice and cotton (defect N-7).
  async function defaultBudget(regionId, season, cropId) {
    const qs = new URLSearchParams({ region_id: regionId, season: season || "kharif" });
    if (cropId) qs.set("crop_id", cropId);
    const res = await fetch("/api/budget-default?" + qs, { signal: AbortSignal.timeout(8000) });
    if (!res.ok) throw new Error("budget-default " + res.status);
    return (await res.json()).budget_per_acre;
  }

  window.MM = { fmt, profile, units, a11y, share, toast, escapeHtml, memoGet, deviceId,
    defaultRegion, locateDefaultRegion, defaultBudget, FALLBACK_REGION_ID };

  // ------------------------------------------------------------------
  // Boot
  // ------------------------------------------------------------------
  // The floating "extra tools" menu (share / accessibility / install) used to
  // live here as its own button, right next to toolbar.js's language/voice/
  // dark-mode button — two separate circular FABs in opposite corners with
  // overlapping items (WhatsApp share and PDF export existed in both). Its
  // items now live inside toolbar.js's single panel; see toolbar.js for
  // Copy link, Large text, High contrast, Install app, and Usage & privacy.
  function boot() {
    apply();                 // a11y classes
    if (document.querySelector(".dashx__wrap")) buildFarmBar();  // dashboard only
  }
  if (document.readyState === "loading")
    document.addEventListener("DOMContentLoaded", boot);
  else boot();
})();
