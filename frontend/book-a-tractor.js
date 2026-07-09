/* =========================================================================
   Book a Tractor — page renderer
   -------------------------------------------------------------------------
   Reads window.TRACTORS_DATA (Data/tractors.js) and renders:
     1. Tractor cards            -> #tractorGrid
     2. Comparison table rows    -> #compareTableBody
     3. Fleet performance bars   -> #perfGrid (averaged across all tractors)
   ========================================================================= */

(function () {
  const TRACTORS = window.TRACTORS_DATA || [];

  const starSVG =
    '<svg viewBox="0 0 24 24" fill="currentColor" width="12" height="12"><path d="M12 2l2.9 6.6 7.1.6-5.4 4.7 1.7 7-6.3-3.9L5.7 21l1.7-7-5.4-4.7 7.1-.6L12 2z"/></svg>';

  const availClass = (status) => {
    if (status === 'Limited') return 'tractor-card__avail--limited';
    if (status === 'Booked')  return 'tractor-card__avail--booked';
    return '';
  };

  /* ─── 1. Tractor cards ─── */
  function renderCards() {
    const grid = document.getElementById('tractorGrid');
    if (!grid || !TRACTORS.length) return;

    grid.innerHTML = TRACTORS.map((t) => `
      <article class="tractor-card">
        <div class="tractor-card__media">
          <img src="${t.image}" alt="${t.name}" loading="lazy">
          <span class="tractor-card__avail ${availClass(t.availability)}">${t.availability}</span>
        </div>
        <div class="tractor-card__body">
          <div class="tractor-card__head">
            <h3>${t.name}</h3>
            <span class="tractor-card__rating">${starSVG} ${t.rating.toFixed(1)}</span>
          </div>
          <p class="tractor-card__desc">${t.description}</p>

          <div class="tractor-card__specs">
            <div class="tractor-spec">
              <span class="tractor-spec__lbl">Horsepower</span>
              <span class="tractor-spec__val">${t.hp} HP</span>
            </div>
            <div class="tractor-spec">
              <span class="tractor-spec__lbl">Suitable land</span>
              <span class="tractor-spec__val">${t.suitableLand}</span>
            </div>
            <div class="tractor-spec">
              <span class="tractor-spec__lbl">Best for</span>
              <span class="tractor-spec__val">${t.bestFor}</span>
            </div>
            <div class="tractor-spec">
              <span class="tractor-spec__lbl">Fuel type</span>
              <span class="tractor-spec__val">${t.fuelType}</span>
            </div>
            <div class="tractor-spec">
              <span class="tractor-spec__lbl">Transmission</span>
              <span class="tractor-spec__val">${t.transmission}</span>
            </div>
            <div class="tractor-spec">
              <span class="tractor-spec__lbl">Maintenance</span>
              <span class="tractor-spec__val">${t.maintenanceCost}</span>
            </div>
          </div>

          <div class="tractor-card__price">
            <div class="tractor-card__price-item">
              <span>Per hour</span>
              <strong>₹${t.pricePerHour.toLocaleString('en-IN')}</strong>
            </div>
            <div class="tractor-card__price-item">
              <span>Per day</span>
              <strong>₹${t.pricePerDay.toLocaleString('en-IN')}</strong>
            </div>
          </div>

          <div class="tractor-card__cta">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="15" height="15"><circle cx="12" cy="12" r="10"/><path d="M12 8v4l3 3"/></svg>
            Booking opens soon
          </div>
        </div>
      </article>
    `).join('');
  }

  /* ─── 2. Comparison table ─── */
  function renderCompareTable() {
    const body = document.getElementById('compareTableBody');
    if (!body || !TRACTORS.length) return;

    body.innerHTML = TRACTORS.map((t) => `
      <tr>
        <td class="tc-name">${t.name}</td>
        <td>${t.hp} HP</td>
        <td>${t.fuelEfficiency}</td>
        <td>${t.bestCrop}</td>
        <td>₹${t.pricePerHour.toLocaleString('en-IN')}</td>
        <td>₹${t.pricePerDay.toLocaleString('en-IN')}</td>
        <td>${t.suitableLand}</td>
        <td><strong>${t.rating.toFixed(1)} / 5</strong></td>
      </tr>
    `).join('');
  }

  /* ─── 3. Fleet performance bars ─── */
  function average(key) {
    if (!TRACTORS.length) return 0;
    return Math.round(TRACTORS.reduce((s, t) => s + (t.performance[key] || 0), 0) / TRACTORS.length);
  }

  function mostCommonMaintenance() {
    const counts = {};
    TRACTORS.forEach((t) => { counts[t.maintenanceCost] = (counts[t.maintenanceCost] || 0) + 1; });
    return Object.entries(counts).sort((a, b) => b[1] - a[1])[0]?.[0] || '—';
  }

  function renderPerformance() {
    const grid   = document.getElementById('perfGrid');
    const maintEl = document.getElementById('perfMaintVal');
    if (!grid) return;

    const metrics = [
      { key: 'power',          label: 'Engine Power' },
      { key: 'fuelEfficiency', label: 'Fuel Efficiency' },
      { key: 'loadCapacity',   label: 'Load Capacity' },
      { key: 'comfort',        label: 'Operator Comfort' },
    ];

    grid.innerHTML = metrics.map((m) => {
      const val = average(m.key);
      return `
        <div>
          <div class="perf-bar__label"><span>${m.label}</span><span>${val}%</span></div>
          <div class="perf-bar__track">
            <div class="perf-bar__fill" data-target="${val}"></div>
          </div>
        </div>
      `;
    }).join('');

    if (maintEl) maintEl.textContent = mostCommonMaintenance();

    // Animate bars once the browser has painted them
    requestAnimationFrame(() => requestAnimationFrame(() => {
      grid.querySelectorAll('.perf-bar__fill').forEach((el) => {
        el.style.width = el.dataset.target + '%';
      });
    }));
  }

  renderCards();
  renderCompareTable();
  renderPerformance();
})();