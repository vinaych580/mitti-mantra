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

  let visibleCount = 12;

  /* ─── 1. Tractor cards ─── */
  function renderCards() {
    const grid = document.getElementById('tractorGrid');
    if (!grid || !TRACTORS.length) return;

    const sliced = TRACTORS.slice(0, visibleCount);
    let cardsHtml = sliced.map((t) => `
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

          <button class="tractor-card__cta" data-id="${t.id}">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="15" height="15"><circle cx="12" cy="12" r="10"/><path d="M12 8v4l3 3"/></svg>
            Book Tractor
          </button>
        </div>
      </article>
    `).join('');

    if (TRACTORS.length > visibleCount) {
      cardsHtml += `
        <div class="gs-load-more-container" style="grid-column: 1 / -1; text-align: center; margin-top: 40px; width: 100%; display: flex; justify-content: center;">
          <button id="btnLoadMoreTractors" class="btn btn-ghost" style="padding: 12px 36px; font-size: 0.9rem; font-weight: 600; border-radius: 999px; transition: all 0.3s ease;">
            Show More Tractors (${TRACTORS.length - visibleCount} remaining)
          </button>
        </div>
      `;
    }

    grid.innerHTML = cardsHtml;

    grid.querySelectorAll('.tractor-card__cta').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const tid = Number(btn.dataset.id);
        if (window.openBookingModal) window.openBookingModal(tid);
      });
    });

    const btnLoadMore = document.getElementById('btnLoadMoreTractors');
    if (btnLoadMore) {
      btnLoadMore.addEventListener('click', () => {
        visibleCount += 12;
        renderCards();
      });
    }
  }

  /* ─── 2. Comparison table ─── */
  function renderCompareTable() {
    const body = document.getElementById('compareTableBody');
    if (!body || !TRACTORS.length) return;

    // Sort by rating desc, slice top 10
    const topTractors = [...TRACTORS].sort((a, b) => b.rating - a.rating).slice(0, 10);

    body.innerHTML = topTractors.map((t) => `
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

  /* ─── 4. Interactive Booking Modal (Hardening) ─── */
  window.openBookingModal = function (tractorId) {
    const t = TRACTORS.find(tr => tr.id === tractorId);
    if (!t) return;

    const overlay = document.getElementById('bookingModalOverlay');
    const card = document.getElementById('bookingModalCard');
    if (!overlay || !card) return;

    // Retrieve drawn farm area if available
    let savedArea = 4.0;
    try {
      const savedFarm = JSON.parse(localStorage.getItem('mittimantra_selectedFarm') || '{}');
      if (savedFarm && savedFarm.acres) {
        savedArea = savedFarm.acres;
      }
    } catch (_) {}

    // Initial estimation values
    let hours = 8;
    let days = 1;
    let rateType = 'hour'; // 'hour' or 'day'
    let totalEstimate = t.pricePerHour * hours;

    function renderModalContent(screen = 'form') {
      if (screen === 'success') {
        const bookingId = 'MM-TR-' + Math.floor(100000 + Math.random() * 900000);
        const name = document.getElementById('bookingName').value.trim() || 'Valued Farmer';
        const phone = document.getElementById('bookingPhone').value.trim();
        const date = document.getElementById('bookingDate').value;
        const durationStr = rateType === 'hour' ? `${hours} hours` : `${days} days`;

        // Save booking records to localStorage
        try {
          const bookings = JSON.parse(localStorage.getItem('mittimantra_bookings') || '[]');
          bookings.push({
            bookingId,
            tractorId: t.id,
            tractorName: t.name,
            name,
            phone,
            date,
            duration: durationStr,
            rateType,
            cost: totalEstimate,
            createdAt: new Date().toISOString()
          });
          localStorage.setItem('mittimantra_bookings', JSON.stringify(bookings));
        } catch (_) {}

        card.innerHTML = `
          <div class="mm-success-screen">
            <div class="mm-success-icon">✓</div>
            <h3>Booking Request Placed!</h3>
            <p>Namaste <strong>${name}</strong>, your request for renting the <strong>${t.name}</strong> has been successfully registered.</p>
            
            <div class="mm-success-details">
              <div class="mm-success-row"><span>Booking ID</span><strong>${bookingId}</strong></div>
              <div class="mm-success-row"><span>Tractor</span><strong>${t.name}</strong></div>
              <div class="mm-success-row"><span>Duration</span><strong>${durationStr}</strong></div>
              <div class="mm-success-row"><span>Estimated Cost</span><strong>₹${totalEstimate.toLocaleString('en-IN')}</strong></div>
              <div class="mm-success-row"><span>Date</span><strong>${date}</strong></div>
              <div class="mm-success-row"><span>Operator</span><strong>${t.operatorName || 'Partner Farmer'}</strong></div>
              <div class="mm-success-row"><span>Operator Phone</span><strong>+91 ${t.operatorPhone || '98765 43210'}</strong></div>
            </div>
            
            <button class="mm-form-submit" id="btnCloseSuccess" style="margin-top: 10px;">Close Window</button>
          </div>
        `;

        document.getElementById('btnCloseSuccess').addEventListener('click', () => {
          overlay.classList.remove('open');
        });
        return;
      }

      // Default Form screen
      card.innerHTML = `
        <button class="mm-modal-close" id="btnModalClose" aria-label="Close">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><path d="M18 6L6 18M6 6l12 12"/></svg>
        </button>
        <div class="mm-modal-header">
          <h3>Request Renting</h3>
          <p>${t.name} · ${t.hp} HP · ${t.availability} Status</p>
        </div>
        <form class="mm-modal-body" id="modalBookingForm">
          <div class="mm-form-row">
            <div class="mm-form-group">
              <label for="bookingName">Your Full Name</label>
              <input type="text" id="bookingName" class="mm-form-input" placeholder="e.g. Ramesh Patel" required>
            </div>
            <div class="mm-form-group">
              <label for="bookingPhone">Mobile Number</label>
              <input type="tel" id="bookingPhone" class="mm-form-input" placeholder="10-digit mobile" pattern="[6-9][0-9]{9}" required>
            </div>
          </div>

          <div class="mm-form-row">
            <div class="mm-form-group">
              <label for="bookingDate">Expected Date</label>
              <input type="date" id="bookingDate" class="mm-form-input" required>
            </div>
            <div class="mm-form-group">
              <label for="bookingArea">Farm Area (Acres)</label>
              <input type="number" id="bookingArea" class="mm-form-input" min="0.1" step="0.1" value="${savedArea.toFixed(1)}" required>
            </div>
          </div>

          <div class="mm-form-row" style="align-items: flex-end;">
            <div class="mm-form-group">
              <label for="rateTypeSelect">Rate Type</label>
              <select id="rateTypeSelect" class="mm-form-input" style="padding: 10px 14px;">
                <option value="hour" ${rateType === 'hour' ? 'selected' : ''}>Per Hour (₹${t.pricePerHour}/hr)</option>
                <option value="day" ${rateType === 'day' ? 'selected' : ''}>Per Day (₹${t.pricePerDay}/day)</option>
              </select>
            </div>
            <div class="mm-form-group">
              <label for="durationInput" id="durationLabel">Duration (${rateType === 'hour' ? 'Hours' : 'Days'})</label>
              <input type="number" id="durationInput" class="mm-form-input" min="1" max="${rateType === 'hour' ? 24 : 30}" value="${rateType === 'hour' ? hours : days}" required>
            </div>
          </div>

          <div class="mm-calc-box">
            <div class="mm-calc-row">
              <span>Rental Rate (${rateType === 'hour' ? 'Hourly' : 'Daily'})</span>
              <span>₹${(rateType === 'hour' ? t.pricePerHour : t.pricePerDay).toLocaleString('en-IN')}</span>
            </div>
            <div class="mm-calc-row">
              <span>Duration</span>
              <span id="calcDurationVal">${rateType === 'hour' ? hours + ' hrs' : days + ' days'}</span>
            </div>
            <div class="mm-calc-row total">
              <span>Total Estimated Cost</span>
              <span id="calcTotalVal">₹${totalEstimate.toLocaleString('en-IN')}</span>
            </div>
          </div>

          <button type="submit" class="mm-form-submit">Confirm Booking Request</button>
        </form>
      `;

      // Set default date to tomorrow
      const tomorrow = new Date();
      tomorrow.setDate(tomorrow.getDate() + 1);
      document.getElementById('bookingDate').value = tomorrow.toISOString().split('T')[0];

      // Form bindings
      document.getElementById('btnModalClose').addEventListener('click', () => {
        overlay.classList.remove('open');
      });

      const rateTypeSelect = document.getElementById('rateTypeSelect');
      const durationInput = document.getElementById('durationInput');
      const durationLabel = document.getElementById('durationLabel');
      const calcDurationVal = document.getElementById('calcDurationVal');
      const calcTotalVal = document.getElementById('calcTotalVal');

      function updateCalculation() {
        rateType = rateTypeSelect.value;
        const val = Math.max(1, Number(durationInput.value) || 1);
        if (rateType === 'hour') {
          hours = val;
          totalEstimate = t.pricePerHour * hours;
          durationLabel.textContent = 'Duration (Hours)';
          calcDurationVal.textContent = `${hours} hrs`;
        } else {
          days = val;
          totalEstimate = t.pricePerDay * days;
          durationLabel.textContent = 'Duration (Days)';
          calcDurationVal.textContent = `${days} days`;
        }
        calcTotalVal.textContent = `₹${totalEstimate.toLocaleString('en-IN')}`;
      }

      rateTypeSelect.addEventListener('change', () => {
        if (rateTypeSelect.value === 'hour') {
          durationInput.max = 24;
          durationInput.value = 8;
        } else {
          durationInput.max = 30;
          durationInput.value = 1;
        }
        updateCalculation();
      });

      durationInput.addEventListener('input', updateCalculation);
      durationInput.addEventListener('change', updateCalculation);

      const form = document.getElementById('modalBookingForm');
      form.addEventListener('submit', (ev) => {
        ev.preventDefault();
        renderModalContent('success');
      });
    }

    renderModalContent('form');
    overlay.classList.add('open');
  };
})();