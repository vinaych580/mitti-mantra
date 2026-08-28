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
    budget_per_acre: 15000,
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

  const profile = {
    get() {
      let stored = null;
      try { stored = JSON.parse(localStorage.getItem(LS.profile) || "null"); } catch (_) {}
      const p = Object.assign({}, DEFAULT_PROFILE, stored || {});
      const plot = activePlot();
      if (plot) {
        if (plot.region_id) p.region_id = plot.region_id;
        if (plot.acres) p.area_acres = +Number(plot.acres).toFixed(2);
      }
      return p;
    },
    set(patch) {
      const next = Object.assign(this.get(), patch || {});

      // Area is measured from the boundary, so it is never writable here — a typed
      // acreage would contradict the polygon it came from, and nothing could
      // reconcile the two. The draw page owns it. Region is metadata rather than
      // geometry, so an override is legitimate and is stored on the plot.
      const plot = activePlot();
      if (plot) {
        next.area_acres = +Number(plot.acres).toFixed(2);
        if (next.region_id && next.region_id !== plot.region_id) {
          try { window.FarmState.save({ region_id: next.region_id }); } catch (_) {}
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
          // A <select> silently goes blank when handed a value it has no
          // <option> for -- which happens whenever the profile holds a region
          // the dropdown hasn't loaded (or can't represent). Leaving the
          // existing selection is always better than emptying the control.
          if (el.tagName === "SELECT" &&
              !Array.from(el.options).some((o) => o.value === String(p[k]))) return;
          if (el.value != String(p[k])) el.value = p[k];
        }
      });
    },
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
     so this needs no separate toolbar.js dark-mode block — it inherits. */
  .mm-farm-bar{position:sticky;top:60px;z-index:40;
    background:linear-gradient(135deg,var(--brand-soft),var(--bg-soft));
    border:1px solid color-mix(in srgb, var(--brand) 20%, transparent);border-radius:14px;
    padding:10px 14px;margin:12px 0 16px;
    display:flex;gap:10px;align-items:center;flex-wrap:wrap;box-shadow:var(--shadow-sm);
    font-family:Inter,system-ui,sans-serif;grid-column:1 / -1;}
  .mm-farm-bar__lbl{font-size:.72rem;font-weight:700;color:var(--brand);letter-spacing:.1em;
    text-transform:uppercase;margin-right:4px;display:flex;align-items:center;gap:6px;}
  .mm-farm-bar__field{display:flex;flex-direction:column;gap:2px;min-width:130px;}
  .mm-farm-bar__field small{font-size:.65rem;color:var(--ink-soft);font-weight:600;text-transform:uppercase;letter-spacing:.08em;}
  .mm-farm-bar select,.mm-farm-bar input{border:1.5px solid rgba(29,26,21,.1);background:var(--bg);color:var(--ink);
    border-radius:8px;padding:6px 8px;font-size:13px;font-family:inherit;min-width:120px;}
  .mm-farm-bar__save{margin-left:auto;background:var(--brand);color:#fff;border:none;border-radius:999px;
    padding:7px 14px;font-weight:600;font-size:12.5px;cursor:pointer;}
  .mm-farm-bar__save:hover{background:var(--brand-deep);}
  .mm-farm-bar__hint{font-size:.7rem;color:var(--ink-soft);margin-left:6px;}
  .mm-farm-bar input[readonly]{background:var(--bg-soft);color:var(--ink-soft);cursor:default;}
  .mm-farm-bar__measured{font-size:.72rem;color:var(--ink-soft);text-decoration:underline;
    text-underline-offset:2px;margin-top:2px;}
  /* On phones the four fields wrap to ~290px tall. Sticky, that plus the
     72px fixed nav held 45% of the viewport permanently — so unpin it and
     pack the fields two-up instead. */
  @media (max-width:860px){
    .mm-farm-bar{position:static;}
    /* Thumb-sized targets: the desktop 6px padding left these controls ~29px
       tall, under the 44px touch guidance and awkward to hit one-handed. The
       16px floor also keeps iOS from zooming the viewport on focus. Applied
       from 860px rather than 620px so tablets in portrait get it too --
       below 620 they were correct, but an iPad sat in the gap. */
    .mm-farm-bar select,.mm-farm-bar input{min-height:44px;padding:8px 10px;font-size:16px;}
  }
  @media (max-width:620px){
    .mm-farm-bar{gap:8px;padding:10px 12px;}
    .mm-farm-bar__field{min-width:0;flex:1 1 calc(50% - 4px);}
    .mm-farm-bar select,.mm-farm-bar input{min-width:0;width:100%;}
    .mm-farm-bar__hint{display:none;}
    .mm-farm-bar__save{margin-left:0;flex:1 1 100%;min-height:44px;font-size:14px;}
  }

  /* ---- Toast ---- */
  .mm-toast{position:fixed;left:50%;bottom:34px;transform:translateX(-50%);
    background:var(--brand-deep);color:#fff;padding:10px 16px;border-radius:999px;font-size:13px;
    box-shadow:0 8px 24px rgba(29,26,21,.25);z-index:10000;opacity:0;transition:opacity .25s, transform .25s;
    font-family:Inter,system-ui,sans-serif;}
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

  // ------------------------------------------------------------------
  // Farm Profile bar (dashboard only)
  // ------------------------------------------------------------------
  async function buildFarmBar() {
    const host = document.querySelector(".dashx__wrap");
    if (!host || document.querySelector(".mm-farm-bar")) return;
    // Wait for region dropdowns in dashboard.js to populate so we can mirror them.
    const bar = document.createElement("div");
    bar.className = "mm-farm-bar";
    bar.innerHTML = `
      <span class="mm-farm-bar__lbl">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M12 2 C9 8 7 12 7 15 a5 5 0 0 0 10 0 c0-3-2-7-5-13z"/></svg>
        My farm
      </span>
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
      <button type="button" class="mm-farm-bar__save">Save</button>`;
    host.insertBefore(bar, host.firstChild);

    // Populate regions from API (same endpoint dashboard.js uses)
    let regions = [];
    try { regions = await fetch("/api/regions").then(r => r.json()); } catch (_) {}
    const regSel = bar.querySelector('[data-mm="region_id"]');
    if (Array.isArray(regions) && regions.length) {
      let opts = regions.map(r => `<option value="${r.id || r.region_id}">${r.name || r.id}</option>`).join("");
      let savedFarm = null;
      try {
        savedFarm = JSON.parse(
          localStorage.getItem('mittimantra_selectedFarm') ||
          localStorage.getItem('agrisim_farm') ||
          'null'
        );
      } catch (_) {}
      if (savedFarm && savedFarm.region_id) {
        const farmName = (savedFarm.state && savedFarm.district)
          ? `${savedFarm.state} · ${savedFarm.district} (My Farm)`
          : "My Farm";
        opts = `<option value="${savedFarm.region_id}">${farmName}</option>` + opts;
      }
      regSel.innerHTML = opts;
    }

    // Load current profile into bar
    function fillBar() {
      const p = profile.get();
      bar.querySelectorAll("[data-mm]").forEach((el) => {
        const k = el.dataset.mm;
        if (p[k] !== undefined && p[k] !== "") el.value = p[k];
      });
      // With a boundary drawn, the area is a measurement, not a setting: show it
      // read-only and point at the page that can actually change it.
      const areaEl = bar.querySelector('[data-mm="area_acres"]');
      const measuredNote = bar.querySelector(".mm-farm-bar__measured");
      const plot = activePlot();
      if (areaEl) {
        areaEl.readOnly = !!plot;
        areaEl.title = plot
          ? "Measured from the boundary you drew — edit the boundary to change it."
          : "Area used by every tool.";
        if (measuredNote) measuredNote.hidden = !plot;
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

    // A plot drawn, switched, or removed on any page is the source of truth —
    // pull its values into the bar AND into the tool forms, so a switch is not
    // half-applied (bar updated, forms still showing the previous plot).
    document.addEventListener("mm:plot-changed", () => {
      fillBar();
      profile.applyToForms();
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
    });

    // Save
    bar.querySelector(".mm-farm-bar__save").addEventListener("click", () => {
      const patch = {};
      bar.querySelectorAll("[data-mm]").forEach((el) => {
        const v = el.value;
        patch[el.dataset.mm] = el.type === "number" ? parseFloat(v) || 0 : v;
      });
      profile.set(patch);
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
        btn.click();
        btn.scrollIntoView({ behavior: "smooth", block: "start" });
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
        }
        // Drop the parameters so a reload or a shared URL doesn't replay them.
        ["tool", "region_id", "season", "crop_id", "area_acres", "budget_per_acre"]
          .forEach((k) => q.delete(k));
        const rest = q.toString();
        history.replaceState({}, "", location.pathname + (rest ? "?" + rest : "") + location.hash);
      });
    }
  }

  /** Poll for `selector` until it exists (and any <select> inside the matching
   *  tool has options), then run `fn`. Gives up after `timeoutMs`. */
  function whenReady(selector, timeoutMs, fn) {
    const started = Date.now();
    (function tick() {
      const el = document.querySelector(selector);
      const regionsFilled = document.querySelector("select[data-regions] option");
      if (el && regionsFilled) return fn(el);
      if (Date.now() - started > timeoutMs) { if (el) fn(el); return; }
      setTimeout(tick, 80);
    })();
  }

  // ------------------------------------------------------------------
  // Public API
  // ------------------------------------------------------------------
  window.MM = { fmt, profile, units, a11y, share, toast, escapeHtml };

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
