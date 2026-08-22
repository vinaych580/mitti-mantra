/*
 * mm-enhance.js — non-invasive dashboard augmentations.
 *  - "Why this crop?" expandable panel on each ranked recommendation row
 *  - Risk gauge next to risk scores
 *  - "Data as of" footer with source attribution on every output card
 *  - Friendly empty states
 *
 * Uses a MutationObserver on .output[data-out=…] containers so we never touch
 * dashboard.js internals.
 */
(function () {
  if (window.__mmEnhanceLoaded) return;
  window.__mmEnhanceLoaded = true;

  // --- styles ---
  // Colors route through the DESIGN.md token set instead of a separate
  // hand-picked palette, so this panel matches the rest of the dashboard and
  // (via the dark-mode block below) actually works in dark mode -- the raw
  // hex version had neither.
  const css = `
  .mm-why{margin-top:6px;}
  .mm-why summary{cursor:pointer;font-size:.75rem;color:var(--brand);font-weight:600;
    list-style:none;display:inline-flex;align-items:center;gap:4px;
    background:var(--brand-soft);padding:3px 10px;border-radius:999px;}
  .mm-why summary::-webkit-details-marker{display:none;}
  .mm-why[open] summary{background:var(--brand);color:#fff;}
  .mm-why__body{margin-top:8px;padding:10px 12px;background:var(--brand-soft);border-radius:10px;
    border:1px solid rgba(47,107,58,.15);font-size:.82rem;line-height:1.5;color:var(--ink);}
  .mm-factor{display:flex;align-items:center;gap:8px;margin:4px 0;}
  .mm-factor__lbl{flex:0 0 110px;font-weight:600;color:var(--ink-soft);}
  .mm-factor__bar{flex:1;height:6px;background:var(--bg-soft);border-radius:3px;overflow:hidden;}
  .mm-factor__bar > div{height:100%;background:linear-gradient(90deg,var(--brand),var(--brand-deep));border-radius:3px;}
  .mm-factor__val{width:40px;text-align:right;font-variant-numeric:tabular-nums;color:var(--brand-deep);font-weight:600;}

  .mm-source{margin-top:14px;padding-top:10px;border-top:1px dashed rgba(29,26,21,.15);
    font-size:.68rem;color:var(--ink-soft);display:flex;gap:10px;flex-wrap:wrap;}
  .mm-source b{color:var(--ink);}

  .mm-gauge{display:inline-flex;align-items:center;gap:6px;margin-left:6px;vertical-align:middle;}
  .mm-gauge__track{width:54px;height:6px;background:var(--bg-soft);border-radius:3px;overflow:hidden;}
  .mm-gauge__fill{height:100%;border-radius:3px;}
  .mm-gauge--low .mm-gauge__fill{background:var(--brand);}
  .mm-gauge--med .mm-gauge__fill{background:var(--accent);}
  .mm-gauge--high .mm-gauge__fill{background:var(--danger);}
  .mm-gauge__tag{font-size:.7rem;font-weight:700;}
  .mm-gauge--low .mm-gauge__tag{color:var(--brand-deep);}
  .mm-gauge--med .mm-gauge__tag{color:var(--clay);}
  .mm-gauge--high .mm-gauge__tag{color:var(--danger);}

  /* --brand / --brand-deep / --clay have no dark remap (only their -soft
     washes do -- see toolbar.js), so text set in them collapses to ~2:1 on
     a dark wash or dark surface. Reuse the same lighter substitutes already
     proven elsewhere in the app (toolbar.js's .kpi--good/.kpi--warn, and
     gyan-seva.html's --brand-deep remap) rather than inventing new ones. */
  html[data-theme="dark"] .mm-why summary,
  html[data-theme="dark"] .mm-factor__val,
  html[data-theme="dark"] .mm-gauge--low .mm-gauge__tag{color:#9ed2a7;}
  html[data-theme="dark"] .mm-gauge--med .mm-gauge__tag{color:#e4b87c;}
  html[data-theme="dark"] .mm-factor__bar > div{background:linear-gradient(90deg,#7fc68f,#9ed2a7);}
  `;
  const styleEl = document.createElement("style");
  styleEl.textContent = css;
  document.head.appendChild(styleEl);

  // --- helpers ---
  const SOURCES = {
    recommend: { label: "Crop recommendations", src: "Crop parameters, soil, weather, mandi prices (Mitti Mantra dataset) + trained ML model" },
    simulate:  { label: "Yield & profit simulation", src: "Physics-based yield model + cost breakdown (engine.simulator)" },
    forecast:  { label: "Price forecast",          src: "Historical mandi prices (agmarknet-compatible CSV) + ML forecast" },
    rotation:  { label: "Rotation plan",           src: "Soil health projection + regional ML recommendations" },
    optimal:   { label: "Optimal crop mix",        src: "Smart-score weighted allocation across ML-ranked crops" },
    sell:      { label: "Sell advisor",            src: "Historical + forecasted mandi prices vs MSP" },
    msp:       { label: "MSP data",                src: "Government-notified MSPs (CACP / Ministry of Agriculture)" },
    pest:      { label: "Pest & disease alerts",   src: "Weather triggers × crop-specific pest rules" },
    irrigate:  { label: "Irrigation schedule",     src: "Crop water-demand model × seasonal rainfall" },
    arbitrage: { label: "Cross-mandi arbitrage",   src: "Mandi price gaps across markets" },
    benchmark: { label: "Region benchmark",        src: "Regional yield history vs your inputs" },
    loan:      { label: "Loan calculator",         src: "Standard EMI formula (reducing balance)" },
    schemes:   { label: "Government schemes",      src: "Central + state scheme catalogue" },
    ml:        { label: "ML model status",         src: "Local models in ml/models" },
  };

  function asOfLine(kind) {
    const s = SOURCES[kind] || { label: kind, src: "Mitti Mantra data" };
    const now = new Date();
    const stamp = now.toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });
    return `<div class="mm-source"><span><b>${s.label}</b> · updated ${stamp}</span><span><b>Source:</b> ${s.src}</span></div>`;
  }

  function riskGauge(score0to100) {
    const s = Math.max(0, Math.min(100, Number(score0to100) || 0));
    const cls = s < 34 ? "low" : s < 67 ? "med" : "high";
    const label = s < 34 ? "Low" : s < 67 ? "Moderate" : "High";
    return `<span class="mm-gauge mm-gauge--${cls}" title="Risk score ${Math.round(s)}/100">
      <span class="mm-gauge__track"><span class="mm-gauge__fill" style="width:${s}%"></span></span>
      <span class="mm-gauge__tag">${label}</span></span>`;
  }

  function decorateRecommend(out) {
    // Add risk gauges to the bulleted list (`list-row__name > small`)
    out.querySelectorAll(".list-row").forEach((row) => {
      if (row.dataset.mmDecorated) return;
      const smallEl = row.querySelector(".list-row__name small");
      if (smallEl && /Risk\s+(\d+)\s*\/\s*100/.test(smallEl.textContent)) {
        const m = smallEl.textContent.match(/Risk\s+(\d+)\s*\/\s*100/);
        const gauge = document.createElement("span");
        gauge.innerHTML = riskGauge(m[1]);
        smallEl.appendChild(gauge);
      }
      // Add a "Why this crop?" drawer that re-uses the small metadata already present.
      const name = row.querySelector(".list-row__name");
      const val  = row.querySelector(".list-row__val");
      if (name && val && !row.querySelector(".mm-why")) {
        const profit = (val.textContent.match(/[\d,]+(?:\.\d+)?/) || ["—"])[0];
        const roi    = (val.textContent.match(/ROI\s*([\d.\-]+%)/) || [,"—"])[1];
        const yieldS = (name.textContent.match(/Yield\s+(\d+)\s*kg/) || [,"—"])[1];
        const score  = (name.textContent.match(/Score\s+([\d.]+)/) || [,"—"])[1];
        const risk   = (name.textContent.match(/Risk\s+(\d+)/) || [,"—"])[1];
        const factors = [
          ["Smart score", score, 100],
          ["Expected yield", yieldS, Math.max(5000, Number(yieldS) * 1.4 || 5000)],
          ["ROI %", roi.replace("%",""), Math.max(60, Number(roi) * 1.4 || 60)],
          ["Low risk", 100 - (Number(risk) || 0), 100],
        ];
        const bars = factors.map(([lbl, v, max]) => {
          const num = Number(v) || 0;
          const pct = Math.min(100, Math.max(0, (num / max) * 100));
          return `<div class="mm-factor"><span class="mm-factor__lbl">${lbl}</span>
            <span class="mm-factor__bar"><div style="width:${pct.toFixed(0)}%"></div></span>
            <span class="mm-factor__val">${v}</span></div>`;
        }).join("");
        const d = document.createElement("details");
        d.className = "mm-why";
        d.innerHTML = `<summary>Why this crop? ▾</summary>
          <div class="mm-why__body">${bars}
            <div style="margin-top:6px;font-size:.72rem;color:#78877a;">
              Ranked by the ML model using soil fit, rainfall match, expected profit
              (₹${profit}) and risk. Confidence shown in the KPI card above.
            </div>
          </div>`;
        name.appendChild(d);
      }
      row.dataset.mmDecorated = "1";
    });
  }

  function decorateRiskKPI(out) {
    // Replace the bare "XX /100" risk kpi__val with a gauge tag.
    out.querySelectorAll(".kpi").forEach((k) => {
      if (k.dataset.mmDecorated) return;
      const lbl = k.querySelector(".kpi__lbl");
      if (!lbl || !/risk/i.test(lbl.textContent)) return;
      const val = k.querySelector(".kpi__val");
      if (!val) return;
      const m = val.textContent.match(/(\d+)/);
      if (!m) return;
      val.insertAdjacentHTML("beforeend", " " + riskGauge(m[1]));
      k.dataset.mmDecorated = "1";
    });
  }

  function addSourceFooter(out, kind) {
    if (out.dataset.mmSourced) return;
    if (!out.innerHTML.trim()) return;
    out.insertAdjacentHTML("beforeend", asOfLine(kind));
    out.dataset.mmSourced = "1";
  }

  // --- observe every .output container ---
  const outs = document.querySelectorAll(".output[data-out]");
  outs.forEach((out) => {
    const kind = out.dataset.out;
    const obs = new MutationObserver(() => {
      // clear the decorated flag if the entire output was replaced
      if (!out.querySelector(".mm-source")) out.dataset.mmSourced = "";
      decorateRiskKPI(out);
      if (kind === "recommend") decorateRecommend(out);
      // Only add source footer once per render
      if (out.innerHTML.trim() && !out.querySelector(".loading") && !out.dataset.mmSourced) {
        addSourceFooter(out, kind);
      }
    });
    obs.observe(out, { childList: true, subtree: true });
  });
})();
