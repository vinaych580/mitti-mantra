/* Manufacturer image hosts (tractorjunction, mahindratractor, deere.co.in, ...)
   are hotlinked, have no CORS/hotlink guarantee, and there was no error path:
   a blocked or moved image left a broken-image icon in the middle of a card.
   Swap in a drawn placeholder instead: images carry data-img-fallback="tractor"
   and the error listener below swaps the source once, so a failing placeholder
   can't loop. (It was an inline onerror, which an enforced
   Content-Security-Policy blocks.) Image errors don't bubble, so the listener
   captures. map-tractors.js renders the same attribute on this page. */
window.MM_TRACTOR_FALLBACK = window.MM_TRACTOR_FALLBACK || (function () {
  var svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 160 110">' +
    '<rect width="160" height="110" fill="#f4ede0"/>' +
    '<g fill="none" stroke="#a5562a" stroke-width="4" stroke-linecap="round" stroke-linejoin="round">' +
    '<circle cx="46" cy="76" r="20"/><circle cx="112" cy="82" r="14"/>' +
    '<path d="M30 60h26l10-20h22l6 20h20v22"/></g>' +
    '<text x="80" y="105" text-anchor="middle" font-family="Inter, sans-serif" ' +
    'font-size="11" fill="#8a8376">Photo unavailable</text></svg>';
  return 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
})();
if (!window.MM_TRACTOR_FALLBACK_BOUND) {
  window.MM_TRACTOR_FALLBACK_BOUND = true;
  document.addEventListener('error', function (e) {
    var img = e.target;
    if (!img || img.tagName !== 'IMG' || img.getAttribute('data-img-fallback') !== 'tractor') return;
    if (img.getAttribute('data-img-fallback-done')) return;
    img.setAttribute('data-img-fallback-done', '1');
    img.src = window.MM_TRACTOR_FALLBACK;
    img.classList.add('is-fallback');
  }, true);
}

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
  const esc = (window.MM && window.MM.escapeHtml) ? window.MM.escapeHtml : (s) => String(s == null ? '' : s);
  const retranslate = () => { if (window.AgriSimI18n) window.AgriSimI18n.retranslate(); };

  const starSVG =
    '<svg viewBox="0 0 24 24" fill="currentColor" width="12" height="12"><path d="M12 2l2.9 6.6 7.1.6-5.4 4.7 1.7 7-6.3-3.9L5.7 21l1.7-7-5.4-4.7 7.1-.6L12 2z"/></svg>';

  const availClass = (status) => {
    if (status === 'Limited') return 'tractor-card__avail--limited';
    if (status === 'Booked')  return 'tractor-card__avail--booked';
    return '';
  };

  /* ─── My Bookings (localStorage) ─── */
  const BOOKINGS_KEY = 'mittimantra_bookings';
  function getMyBookings() {
    try { return JSON.parse(localStorage.getItem(BOOKINGS_KEY) || '[]'); }
    catch (_) { return []; }
  }
  function saveMyBookings(list) {
    try { localStorage.setItem(BOOKINGS_KEY, JSON.stringify(list)); } catch (_) {}
  }

  /* ─── Booking-conflict checking (H-8) ───
     There's no real backend to enforce exclusivity, but we can at least prevent
     this device from double-booking the same tractor for overlapping dates by
     checking this device's own booking history in localStorage before saving
     a new one. A booking "occupies" [date, date + spanDays - 1] — day-rate
     bookings span multiple calendar days, hour-rate bookings are treated as
     occupying just the one day. */
  // YYYY-MM-DD in the device's own timezone (toISOString() would give UTC).
  function localISODate(d) {
    const pad = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  }

  function computeSpanDays(rateType, hoursOrDays) {
    return rateType === 'day' ? Math.max(1, Number(hoursOrDays) || 1) : 1;
  }
  function bookingDateRange(dateStr, spanDays) {
    const start = new Date(dateStr + 'T00:00:00');
    const end = new Date(start);
    end.setDate(start.getDate() + Math.max(1, spanDays) - 1);
    return { start, end };
  }
  function findTractorBookingConflict(tractorId, dateStr, spanDays) {
    if (!dateStr) return null;
    const { start, end } = bookingDateRange(dateStr, spanDays);
    const existing = getMyBookings().filter((b) => b.tractorId === tractorId && b.date);
    return existing.find((b) => {
      const bRange = bookingDateRange(b.date, b.spanDays || 1);
      return start <= bRange.end && bRange.start <= end;
    }) || null;
  }

  /* ─── Modal accessibility (dialog semantics, focus trap, Escape-to-close) ───
     #bookingModalCard is shared by all three modal render paths (list-tractor
     form, booking form, booking success/unavailable screens); this keeps the
     dialog behavior in one place instead of duplicating it per render path. */
  let mmModalTrigger = null;
  let mmModalKeydown = null;
  function mmFocusableIn(container) {
    return Array.from(container.querySelectorAll(
      'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
    ));
  }
  function openModalA11y(overlay, card) {
    mmModalTrigger = document.activeElement;
    const focusables = mmFocusableIn(card);
    (focusables[0] || card).focus();
    mmModalKeydown = (e) => {
      if (e.key === 'Escape') { e.preventDefault(); closeModalA11y(overlay); return; }
      if (e.key !== 'Tab') return;
      const items = mmFocusableIn(card);
      if (!items.length) return;
      const first = items[0], last = items[items.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    };
    document.addEventListener('keydown', mmModalKeydown);
  }
  function closeModalA11y(overlay) {
    overlay.classList.remove('open');
    if (mmModalKeydown) { document.removeEventListener('keydown', mmModalKeydown); mmModalKeydown = null; }
    if (mmModalTrigger && document.body.contains(mmModalTrigger)) mmModalTrigger.focus();
    mmModalTrigger = null;
  }

  /* ─── Trust loop: post-job verification + reliability score ───
     Real bookings on this device are logged after their date passes and feed
     into a tractor's reliability chip. There is no fleet-wide booking history,
     so a tractor nobody has logged a job for says exactly that. (This used to
     blend in a hash-generated "illustrative" baseline -- invented job counts
     and on-time rates shown as a trust signal, disclosed only in a hover
     tooltip phones never show, and NaN for community listings whose ids are
     strings.) */
  const OUTCOMES_KEY = 'mittimantra_tractor_outcomes';
  function getTractorOutcomes() {
    try { return JSON.parse(localStorage.getItem(OUTCOMES_KEY) || '[]'); }
    catch (_) { return []; }
  }
  function saveTractorOutcomes(list) {
    try { localStorage.setItem(OUTCOMES_KEY, JSON.stringify(list)); } catch (_) {}
  }

  function computeReliability(tractorId) {
    const real = getTractorOutcomes().filter((o) => o.tractorId === tractorId);
    const onTime = real.filter((o) => o.onTime).length;
    return {
      jobs: real.length,
      onTimePct: real.length ? Math.round((onTime / real.length) * 100) : null,
    };
  }

  function reliabilityChipHtml(tractorId) {
    const r = computeReliability(tractorId);
    if (!r.jobs) {
      return '<span class="tractor-card__reliability" title="Jobs you confirm after a booking date passes are counted here.">🔁 No logged jobs yet</span>';
    }
    const tier = r.onTimePct >= 90 ? 'tractor-card__reliability--good' : r.onTimePct >= 80 ? '' : 'tractor-card__reliability--low';
    return `<span class="tractor-card__reliability ${tier}" title="From jobs confirmed on this device.">🔁 ${r.jobs} logged ${r.jobs === 1 ? 'job' : 'jobs'} · ${r.onTimePct}% on-time</span>`;
  }

  /* ─── List Your Tractor (owner side) ─── */
  const OWNER_LISTINGS_KEY = 'mittimantra_owner_tractor_listings';
  function getOwnerListings() {
    try { return JSON.parse(localStorage.getItem(OWNER_LISTINGS_KEY) || '[]'); }
    catch (_) { return []; }
  }
  function saveOwnerListings(list) {
    try { localStorage.setItem(OWNER_LISTINGS_KEY, JSON.stringify(list)); } catch (_) {}
  }
  function findTractorById(id) {
    return TRACTORS.find((tr) => tr.id === id) || getOwnerListings().find((tr) => tr.id === id);
  }

  /* ─── T-1: reflect a real reservation in the availability badge ───
     `.availability` is a single fleet-wide status string, not date-scoped
     anywhere it's read (cards, owner listings, demand panels) — so a hard
     flip to "Booked" would fully lock the tractor out of the booking modal
     (see the `Booked` short-circuit in openBookingModal below), blocking even
     a different, non-conflicting date that findTractorBookingConflict would
     otherwise allow. Downgrading Available -> Limited instead makes the badge
     honest (this device really does hold a reservation against it) without
     re-blocking dates the per-date conflict check already permits.
     Built-in fleet tractors live in the shared TRACTORS array reference, so
     mutating in place is enough for every render in this file to pick it up;
     it resets on reload since Data/tractors.js rebuilds window.TRACTORS_DATA
     fresh each load. Owner-listed tractors are re-parsed from localStorage on
     every read, so those need an explicit save to persist. */
  function markTractorReservedOnThisDevice(tractorId) {
    const fleetTractor = TRACTORS.find((tr) => tr.id === tractorId);
    if (fleetTractor) {
      if (fleetTractor.availability === 'Available') fleetTractor.availability = 'Limited';
      return;
    }
    const listings = getOwnerListings();
    const listing = listings.find((tr) => tr.id === tractorId);
    if (listing && listing.availability === 'Available') {
      listing.availability = 'Limited';
      saveOwnerListings(listings);
    }
  }

  function ownerCardHtml(t) {
    return `
      <article class="tractor-card">
        <div class="tractor-card__media">
          <div class="tractor-card__owner-ribbon">🧑‍🌾 Community Listed</div>
          <span class="tractor-card__avail ${availClass(t.availability)}">${esc(t.availability)}</span>
        </div>
        <div class="tractor-card__body">
          <div class="tractor-card__head">
            <h3>${esc(t.name)}</h3>
          </div>
          <p class="tractor-card__desc">Listed by ${esc(t.operatorName)} · ${esc(t.district)}, ${esc(t.state)}</p>
          <div class="tractor-card__specs">
            <div class="tractor-spec">
              <span class="tractor-spec__lbl">Horsepower</span>
              <span class="tractor-spec__val">${t.hp} HP</span>
            </div>
            <div class="tractor-spec">
              <span class="tractor-spec__lbl">Listed by</span>
              <span class="tractor-spec__val">${esc(t.operatorName)}</span>
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
          <button class="tractor-card__cta${t.availability === 'Booked' ? ' tractor-card__cta--disabled' : ''}" data-id="${t.id}"${t.availability === 'Booked' ? ' disabled' : ''}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="15" height="15"><circle cx="12" cy="12" r="10"/><path d="M12 8v4l3 3"/></svg>
            ${t.availability === 'Booked' ? 'Currently Booked' : 'Book Tractor'}
          </button>
        </div>
      </article>
    `;
  }

  function renderOwnerListings() {
    const section = document.getElementById('tractorOwnerListingsSection');
    const grid = document.getElementById('tractorOwnerListingsGrid');
    if (!section || !grid) return;
    const listings = getOwnerListings();
    if (!listings.length) { section.style.display = 'none'; return; }
    section.style.display = '';
    grid.innerHTML = listings.map(ownerCardHtml).join('');
    grid.querySelectorAll('.tractor-card__cta').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const tid = btn.dataset.id;
        if (window.openBookingModal) window.openBookingModal(tid);
      });
    });
    retranslate();
  }

  window.openListTractorModal = function () {
    const overlay = document.getElementById('bookingModalOverlay');
    const card = document.getElementById('bookingModalCard');
    if (!overlay || !card) return;

    card.innerHTML = `
      <button class="mm-modal-close" id="btnModalClose" aria-label="Close">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><path d="M18 6L6 18M6 6l12 12"/></svg>
      </button>
      <div class="mm-modal-header">
        <h3>List Your Tractor</h3>
        <p>Free to list — you control the price and availability.</p>
      </div>
      <form class="mm-modal-body" id="listTractorForm">
        <div class="mm-form-row">
          <div class="mm-form-group">
            <label for="ownerName">Your Name</label>
            <input type="text" id="ownerName" class="mm-form-input" placeholder="e.g. Ram Singh" required>
          </div>
          <div class="mm-form-group">
            <label for="ownerPhone">Mobile Number</label>
            <input type="tel" id="ownerPhone" class="mm-form-input" placeholder="10-digit mobile" pattern="[6-9][0-9]{9}" required>
          </div>
        </div>
        <div class="mm-form-row">
          <div class="mm-form-group">
            <label for="ownerTractorName">Tractor Model</label>
            <input type="text" id="ownerTractorName" class="mm-form-input" placeholder="e.g. Mahindra 575 DI" required>
          </div>
          <div class="mm-form-group">
            <label for="ownerHp">Horsepower</label>
            <input type="number" id="ownerHp" class="mm-form-input" min="15" max="120" value="45" required>
          </div>
        </div>
        <div class="mm-form-row">
          <div class="mm-form-group">
            <label for="ownerState">State</label>
            <input type="text" id="ownerState" class="mm-form-input" placeholder="e.g. Punjab" required>
          </div>
          <div class="mm-form-group">
            <label for="ownerDistrict">District</label>
            <input type="text" id="ownerDistrict" class="mm-form-input" placeholder="e.g. Ludhiana" required>
          </div>
        </div>
        <div class="mm-form-row">
          <div class="mm-form-group">
            <label for="ownerPriceHour">Price per Hour (₹)</label>
            <input type="number" id="ownerPriceHour" class="mm-form-input" min="100" step="10" value="450" required>
          </div>
          <div class="mm-form-group">
            <label for="ownerPriceDay">Price per Day (₹)</label>
            <input type="number" id="ownerPriceDay" class="mm-form-input" min="500" step="50" value="2800" required>
          </div>
        </div>
        <button type="submit" class="mm-form-submit">List My Tractor</button>
      </form>
    `;

    document.getElementById('btnModalClose').addEventListener('click', () => closeModalA11y(overlay));

    document.getElementById('listTractorForm').addEventListener('submit', (ev) => {
      ev.preventDefault();
      const listing = {
        id: 'owner_' + Date.now(),
        name: document.getElementById('ownerTractorName').value.trim() || 'Listed Tractor',
        image: '',
        hp: Math.max(15, Number(document.getElementById('ownerHp').value) || 45),
        district: document.getElementById('ownerDistrict').value.trim(),
        state: document.getElementById('ownerState').value.trim(),
        suitableLand: '—', bestFor: '—', bestCrop: '—', fuelType: 'Diesel', fuelEfficiency: '—', transmission: '—',
        pricePerHour: Math.max(100, Number(document.getElementById('ownerPriceHour').value) || 450),
        pricePerDay: Math.max(500, Number(document.getElementById('ownerPriceDay').value) || 2800),
        rating: 0,
        availability: 'Available',
        description: 'Listed directly by the owner.',
        performance: { power: 0, fuelEfficiency: 0, loadCapacity: 0, comfort: 0 },
        maintenanceCost: '—',
        operatorName: document.getElementById('ownerName').value.trim() || 'Owner',
        operatorPhone: document.getElementById('ownerPhone').value.trim(),
        isOwnerListing: true,
      };
      const listings = getOwnerListings();
      listings.unshift(listing);
      saveOwnerListings(listings);
      renderOwnerListings();
      renderDemandIntelligence();
      closeModalA11y(overlay);
      if (window.MM && window.MM.toast) window.MM.toast('Your tractor is now listed!');
    });

    retranslate();
    overlay.classList.add('open');
    openModalA11y(overlay, card);
  };

  function bookingRowHtml(b) {
    const isPast = b.date && new Date(b.date) < new Date(new Date().toDateString());
    const phoneDigits = (b.operatorPhone || '').replace(/\D/g, '');
    return `
      <article class="tractor-booking-row" data-booking-id="${esc(b.bookingId)}">
        ${b.tractorImage ? `<img src="${esc(b.tractorImage)}" alt="${esc(b.tractorName || '')}" loading="lazy" referrerpolicy="no-referrer" data-img-fallback="tractor">` : `<div class="tractor-booking-row__noimg">🚜</div>`}
        <div class="tractor-booking-row__body">
          <div class="tractor-booking-row__head">
            <div>
              <h4>${esc(b.tractorName || 'Tractor')}</h4>
              <div class="tractor-booking-row__id">${esc(b.bookingId)}${b.bookedBy ? ` · Booked by ${esc(b.bookedBy.name)}` : ''}</div>
            </div>
            <span class="tractor-booking-row__tag${isPast ? ' tractor-booking-row__tag--past' : ''}">${isPast ? 'Past' : 'Upcoming'}</span>
          </div>
          <div class="tractor-booking-row__meta">
            <span>📅 <b>${esc(b.date || '—')}</b></span>
            <span>⏱ <b>${esc(b.duration || '—')}</b></span>
            <span>📍 <b>${esc(b.district || '')}${b.district && b.state ? ', ' : ''}${esc(b.state || '')}</b></span>
            ${(b.distanceKm != null && !isPast) ? `<span>🚜 <b>${b.distanceKm} km · ~${b.etaMinutes} min away</b></span>` : ''}
            ${b.splitWith ? `<span>🤝 <b>Split with ${esc(b.splitWith.name)}</b></span>` : ''}
          </div>
          <div class="tractor-booking-row__foot">
            <span class="tractor-booking-row__cost">₹${(b.myShare != null ? b.myShare : (b.cost || 0)).toLocaleString('en-IN')}${b.splitWith ? ` <small style="font-weight:400;color:var(--ink-soft);">of ₹${(b.cost || 0).toLocaleString('en-IN')} total</small>` : ''}</span>
            ${phoneDigits ? `<a class="tractor-booking-row__call" href="tel:+91${phoneDigits}">📞 Call ${esc(b.operatorName || 'operator')}</a>` : `<span class="tractor-booking-row__call" style="opacity:.6;cursor:default;">Operator phone not listed</span>`}
          </div>
          ${isPast ? (b.outcomeLogged
            ? `<div class="tractor-verify tractor-verify--done">✓ Thanks — your report helps other farmers trust this operator.</div>`
            : `<div class="tractor-verify">
                <span class="tractor-verify__prompt">How did this booking go?</span>
                <div class="tractor-verify__choices">
                  <button class="tractor-verify__choice" data-choice="yes">✓ On time &amp; as promised</button>
                  <button class="tractor-verify__choice" data-choice="partial">🤔 Partially</button>
                  <button class="tractor-verify__choice" data-choice="no">✕ No-show / issues</button>
                </div>
              </div>`
          ) : ''}
        </div>
      </article>
    `;
  }

  function renderMyBookingsPanel() {
    const section = document.getElementById('tractorMyBookingsSection');
    const panel = document.getElementById('tractorMyBookingsPanel');
    if (!section || !panel) return;

    const bookings = getMyBookings();
    if (!bookings.length) {
      section.style.display = 'none';
      return;
    }
    section.style.display = '';
    panel.innerHTML = bookings.slice(0, 8).map(bookingRowHtml).join('');

    panel.querySelectorAll('.tractor-verify__choice').forEach((btn) => {
      btn.addEventListener('click', () => {
        const row = btn.closest('.tractor-booking-row');
        const bookingId = row && row.dataset.bookingId;
        if (!bookingId) return;

        const all = getMyBookings();
        const booking = all.find((x) => x.bookingId === bookingId);
        if (!booking || booking.outcomeLogged) return;

        const choice = btn.dataset.choice; // 'yes' | 'partial' | 'no'
        const outcomes = getTractorOutcomes();
        outcomes.push({
          id: 'out_' + Date.now() + '_' + Math.floor(Math.random() * 1000),
          tractorId: booking.tractorId,
          bookingId: booking.bookingId,
          onTime: choice === 'yes',
          completed: choice,
          loggedAt: new Date().toISOString(),
        });
        saveTractorOutcomes(outcomes);

        booking.outcomeLogged = true;
        saveMyBookings(all);

        renderMyBookingsPanel();
        renderCards();
        if (window.MM && window.MM.toast) window.MM.toast('Thanks for the report!');
      });
    });

    retranslate();
  }

  let visibleCount = 12;

  /* ─── 1. Tractor cards ─── */
  function renderCards() {
    const grid = document.getElementById('tractorGrid');
    if (!grid || !TRACTORS.length) return;

    const sliced = TRACTORS.slice(0, visibleCount);
    let cardsHtml = sliced.map((t) => {
      const isBooked = t.availability === 'Booked';
      return `
      <article class="tractor-card">
        <div class="tractor-card__media">
          <img src="${esc(t.image)}" alt="${esc(t.name)}" loading="lazy" referrerpolicy="no-referrer" data-img-fallback="tractor">
          <span class="tractor-card__avail ${availClass(t.availability)}">${esc(t.availability)}</span>
        </div>
        <div class="tractor-card__body">
          <div class="tractor-card__head">
            <h3>${esc(t.name)}</h3>
            <span class="tractor-card__rating">${starSVG} ${t.rating.toFixed(1)}</span>
          </div>
          <p class="tractor-card__desc">${esc(t.description)}</p>
          ${reliabilityChipHtml(t.id)}

          <div class="tractor-card__specs">
            <div class="tractor-spec">
              <span class="tractor-spec__lbl">Horsepower</span>
              <span class="tractor-spec__val">${t.hp} HP</span>
            </div>
            <div class="tractor-spec">
              <span class="tractor-spec__lbl">Suitable land</span>
              <span class="tractor-spec__val">${esc(t.suitableLand)}</span>
            </div>
            <div class="tractor-spec">
              <span class="tractor-spec__lbl">Best for</span>
              <span class="tractor-spec__val">${esc(t.bestFor)}</span>
            </div>
            <div class="tractor-spec">
              <span class="tractor-spec__lbl">Fuel type</span>
              <span class="tractor-spec__val">${esc(t.fuelType)}</span>
            </div>
            <div class="tractor-spec">
              <span class="tractor-spec__lbl">Transmission</span>
              <span class="tractor-spec__val">${esc(t.transmission)}</span>
            </div>
            <div class="tractor-spec">
              <span class="tractor-spec__lbl">Maintenance</span>
              <span class="tractor-spec__val">${esc(t.maintenanceCost)}</span>
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

          <button class="tractor-card__cta${isBooked ? ' tractor-card__cta--disabled' : ''}" data-id="${t.id}"${isBooked ? ' disabled' : ''}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="15" height="15"><circle cx="12" cy="12" r="10"/><path d="M12 8v4l3 3"/></svg>
            ${isBooked ? 'Currently Booked' : 'Book Tractor'}
          </button>
        </div>
      </article>
    `;
    }).join('');

    if (TRACTORS.length > visibleCount) {
      cardsHtml += `
        <div class="tractor-load-more" style="grid-column: 1 / -1; text-align: center; margin-top: 40px; width: 100%; display: flex; justify-content: center;">
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

    retranslate();
  }

  /* ─── 2. Comparison table ─── */
  function renderCompareTable() {
    const body = document.getElementById('compareTableBody');
    if (!body || !TRACTORS.length) return;

    // Sort by rating desc, slice top 10
    const topTractors = [...TRACTORS].sort((a, b) => b.rating - a.rating).slice(0, 10);

    body.innerHTML = topTractors.map((t) => `
      <tr>
        <td class="tc-name">${esc(t.name)}</td>
        <td>${t.hp} HP</td>
        <td>${esc(t.fuelEfficiency)}</td>
        <td>${esc(t.bestCrop)}</td>
        <td>₹${t.pricePerHour.toLocaleString('en-IN')}</td>
        <td>₹${t.pricePerDay.toLocaleString('en-IN')}</td>
        <td>${esc(t.suitableLand)}</td>
        <td><strong>${t.rating.toFixed(1)} / 5</strong></td>
      </tr>
    `).join('');

    retranslate();
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
        const pct = Math.max(0, Math.min(100, Number(el.dataset.target) || 0));
        el.style.transform = `scaleX(${pct / 100})`;
      });
    }));
  }

  /* ─── Weather-aware booking window ─── */
  function getCurrentSeason() {
    const m = new Date().getMonth() + 1; // 1-12
    if (m >= 6 && m <= 10) return 'kharif';
    if (m === 4 || m === 5) return 'zaid';
    return 'rabi';
  }

  async function fetchWeatherAdvisory(regionId, season) {
    const res = await fetch(`/api/weather?region_id=${encodeURIComponent(regionId)}&season=${encodeURIComponent(season)}`);
    if (!res.ok) throw new Error('weather fetch failed');
    return res.json();
  }

  function renderWeatherBanner(state) {
    const el = document.getElementById('tractorWeatherBanner');
    if (!el) return;

    if (state === 'no-farm') {
      el.className = 'tractor-weather-banner tractor-weather-banner--info';
      el.innerHTML = `
        <div class="tractor-weather-banner__text"><strong>📍 Get weather-aware booking alerts</strong>Draw your farm boundary and we'll tell you when it's a good — or risky — window to book fieldwork.</div>
        <a href="farm-boundary.html" class="tractor-weather-banner__cta">Draw My Farm</a>
      `;
      el.style.display = '';
      retranslate();
      return;
    }

    if (state === 'error') {
      el.className = 'tractor-weather-banner tractor-weather-banner--info';
      el.innerHTML = `<div class="tractor-weather-banner__text"><strong>🌦 Weather advisory unavailable</strong>Couldn't reach the weather service right now — try refreshing.</div>`;
      el.style.display = '';
      return;
    }

    // The backend never fabricates a live severe-weather feed — imd_alert is
    // always "Unavailable" (no IMD/CAP integration configured) — so we use the
    // real season-average rainfall to give honest, still-useful guidance
    // instead of pretending we have a live storm alert.
    const w = state; // weather API response
    const rain = w.rainfall_mm;
    let tier, headline, body, showCta;

    if (rain != null && rain >= 500) {
      tier = 'moderate';
      headline = '🌧 Wet season in your area';
      body = `${esc(w.season.charAt(0).toUpperCase() + w.season.slice(1))} here historically brings ~${rain} mm of rain (avg ${w.avg_temp_c}°C) — plan tilling or harvesting around dry stretches. Live storm alerts aren't available for your district yet, so check today's local forecast before you head out.`;
      showCta = true;
    } else if (rain != null && rain < 150) {
      tier = 'good';
      headline = '☀️ Historically dry season here';
      body = `${esc(w.season.charAt(0).toUpperCase() + w.season.slice(1))} typically sees only ~${rain} mm of rain in your area (avg ${w.avg_temp_c}°C) — a generally good window for fieldwork. Live storm alerts aren't available for your district yet.`;
      showCta = true;
    } else {
      tier = 'info';
      headline = '🌦 Seasonal outlook for your area';
      body = `${esc(w.season.charAt(0).toUpperCase() + w.season.slice(1))} averages ~${rain ?? '—'} mm rain and ${w.avg_temp_c ?? '—'}°C here. Live storm alerts aren't available for your district yet — check today's local forecast before booking.`;
      showCta = true;
    }

    el.className = `tractor-weather-banner tractor-weather-banner--${tier}`;
    el.innerHTML = `
      <div class="tractor-weather-banner__text"><strong>${headline}</strong>${body}</div>
      ${showCta ? `<a href="#tractorGrid" class="tractor-weather-banner__cta">🚜 Browse Tractors</a>` : ''}
    `;
    el.style.display = '';
    retranslate();
  }

  async function checkWeatherAdvisory() {
    const farm = window.FarmState && window.FarmState.load ? window.FarmState.load() : null;
    if (!farm || farm.lat == null || farm.lon == null) {
      renderWeatherBanner('no-farm');
      return;
    }
    try {
      const regionId = farm.region_id || (window.FarmState.getNearestRegionId
        ? window.FarmState.getNearestRegionId([farm.lon, farm.lat], farm.state)
        : null);
      if (!regionId) { renderWeatherBanner('no-farm'); return; }
      const weather = await fetchWeatherAdvisory(regionId, getCurrentSeason());
      renderWeatherBanner(weather);
    } catch (_) {
      renderWeatherBanner('error');
    }
  }

  /* ─── My Crop Plan → real crop-calendar booking suggestions ─── */
  const CROP_PLAN_KEY = 'mittimantra_tractor_crop';
  const CROP_LABELS = { rice: 'rice', wheat: 'wheat', maize: 'maize', sugarcane: 'sugarcane', cotton: 'cotton', pulses: 'pulses', groundnut: 'groundnut', soybean: 'soybean' };

  function parseMonDay(str, year) {
    const d = new Date(`${str.trim()} ${year} 00:00:00`);
    return isNaN(d.getTime()) ? null : d;
  }

  function nearestWindow(rangeStr) {
    const [startStr, endStr] = (rangeStr || '').split('-').map((s) => s.trim());
    if (!startStr || !endStr) return null;
    const now = new Date();
    const build = (year) => {
      const start = parseMonDay(startStr, year);
      let end = parseMonDay(endStr, year);
      if (!start || !end) return null;
      if (end < start) end = parseMonDay(endStr, year + 1);
      return { start, end };
    };
    let w = build(now.getFullYear());
    if (w && w.end < now) w = build(now.getFullYear() + 1);
    return w;
  }

  function daysUntil(date) {
    return Math.ceil((date - new Date()) / 86400000);
  }

  async function fetchCropCalendar(cropId) {
    const res = await fetch(`/api/crop-calendar/${encodeURIComponent(cropId)}`);
    if (!res.ok) throw new Error('crop calendar fetch failed');
    return res.json();
  }

  function cropWindowMessage(activityLabel, ctaText, window) {
    const untilStart = daysUntil(window.start);
    const now = new Date();
    if (now >= window.start && now <= window.end) {
      return `You're inside your <strong>${activityLabel}</strong> window right now. ${ctaText}<a href="#tractorGrid">🚜 Browse Tractors</a>`;
    }
    if (untilStart > 0 && untilStart <= 21) {
      return `Your <strong>${activityLabel}</strong> window opens in about <strong>${untilStart} day${untilStart === 1 ? '' : 's'}</strong>. ${ctaText}<a href="#tractorGrid">🚜 Book ahead</a>`;
    }
    return null;
  }

  async function renderCropSuggestion(cropId) {
    const box = document.getElementById('tractorCropSuggestion');
    if (!box) return;
    if (!cropId) { box.style.display = 'none'; return; }

    box.style.display = '';
    box.innerHTML = 'Checking the crop calendar…';
    try {
      const data = await fetchCropCalendar(cropId);
      const seasons = data.seasons || {};
      // Pick whichever season's land-prep window is soonest (or currently active).
      let best = null;
      Object.values(seasons).forEach((cal) => {
        // Rice's calendar has no land_prep field (nursery-transplant model) — fall back to it.
        const prepStr = cal.land_prep || cal.nursery;
        const w = nearestWindow(prepStr);
        if (!w) return;
        const rank = Math.max(0, daysUntil(w.start));
        if (!best || rank < best.rank) best = { rank, cal, w, prepLabel: cal.land_prep ? 'land prep / tilling' : 'nursery prep' };
      });

      if (!best) {
        box.innerHTML = `No clean calendar dates available for ${esc(CROP_LABELS[cropId] || cropId)} right now — check the Dashboard's crop planner for details.`;
        return;
      }

      const harvestWindow = nearestWindow(best.cal.harvest_window);
      const prepMsg = cropWindowMessage(best.prepLabel, "That's usually the tightest booking window for tillage tractors — ", best.w);
      const harvestMsg = harvestWindow ? cropWindowMessage('harvest', 'Harvesters get booked out fast in this window — ', harvestWindow) : null;

      const parts = [prepMsg, harvestMsg].filter(Boolean);
      if (parts.length) {
        box.innerHTML = parts.join('<br><br>');
      } else {
        const prepDates = best.cal.land_prep || best.cal.nursery;
        box.innerHTML = `Next up for ${esc(CROP_LABELS[cropId] || cropId)}: ${esc(best.prepLabel)} around <strong>${esc(prepDates)}</strong>, harvest around <strong>${esc(best.cal.harvest_window)}</strong>. No urgent booking window right now — check back closer to the date.`;
      }
      retranslate();
    } catch (_) {
      box.innerHTML = 'Could not load the crop calendar right now — try again shortly.';
    }
  }

  function initCropPlan() {
    const select = document.getElementById('tractorCropSelect');
    if (!select) return;
    let saved = '';
    try { saved = localStorage.getItem(CROP_PLAN_KEY) || ''; } catch (_) {}
    if (saved) select.value = saved;
    if (select.value) renderCropSuggestion(select.value);

    select.addEventListener('change', () => {
      try { localStorage.setItem(CROP_PLAN_KEY, select.value); } catch (_) {}
      renderCropSuggestion(select.value);
    });
  }

  /* ─── Demand Near You — real aggregate of fleet availability + your own bookings by district ─── */
  const DEMAND_DISTRICT_KEY = 'mittimantra_tractor_demand_district';

  function districtKey(district, state) { return `${district}|${state}`; }

  function renderDemandForDistrict(key) {
    const box = document.getElementById('tractorDemandResult');
    if (!box) return;
    if (!key) { box.style.display = 'none'; return; }

    const [district, state] = key.split('|');
    const inDistrict = TRACTORS.filter((t) => t.district === district && t.state === state);
    const available = inDistrict.filter((t) => t.availability === 'Available').length;
    const limited = inDistrict.filter((t) => t.availability === 'Limited').length;
    const booked = inDistrict.filter((t) => t.availability === 'Booked').length;
    const total = inDistrict.length;
    const pressurePct = total ? Math.round(((limited + booked) / total) * 100) : 0;

    const ownerInDistrict = getOwnerListings().filter((t) => t.district === district && t.state === state).length;
    const myBookingsInDistrict = getMyBookings().filter((b) => b.district === district && b.state === state && b.date && new Date(b.date) >= new Date(new Date().toDateString())).length;

    let pressureMsg;
    if (total === 0) {
      pressureMsg = `No listed tractors in ${esc(district)} yet — be the first to <a href="#" id="demandListLink">list one</a>.`;
    } else if (pressurePct >= 60) {
      pressureMsg = `<strong>${pressurePct}% of tractors in ${esc(district)} are Limited or Booked right now.</strong> This is a high-demand window — book ahead, or use "split with a neighbor" to make sure you get a slot.`;
    } else if (pressurePct >= 30) {
      pressureMsg = `${pressurePct}% of tractors in ${esc(district)} are Limited or Booked. Moderate demand — booking a few days ahead is a good idea.`;
    } else {
      pressureMsg = `Only ${pressurePct}% of tractors in ${esc(district)} are Limited or Booked — plenty of availability right now.`;
    }

    box.style.display = '';
    box.innerHTML = `
      ${pressureMsg}<br><br>
      📍 <strong>${total}</strong> tractors tracked in ${esc(district)} (${available} available, ${limited} limited, ${booked} booked)${ownerInDistrict ? `, plus <strong>${ownerInDistrict}</strong> community-listed` : ''}.
      ${myBookingsInDistrict ? `<br>You have <strong>${myBookingsInDistrict}</strong> upcoming booking${myBookingsInDistrict === 1 ? '' : 's'} in this district.` : ''}
    `;
    const listLink = document.getElementById('demandListLink');
    if (listLink) listLink.addEventListener('click', (e) => { e.preventDefault(); window.openListTractorModal(); });
    retranslate();
  }

  function initDemandPanel() {
    const select = document.getElementById('tractorDemandDistrict');
    if (!select) return;

    // Group by state so the native list is scannable instead of one flat
    // alphabetical wall of 264 districts.
    const byState = {};
    TRACTORS.forEach((t) => {
      if (!byState[t.state]) byState[t.state] = new Set();
      byState[t.state].add(t.district);
    });
    const districts = [];
    Object.keys(byState).sort().forEach((state) => {
      const group = document.createElement('optgroup');
      group.label = state;
      [...byState[state]].sort().forEach((district) => {
        const key = districtKey(district, state);
        districts.push(key);
        const opt = document.createElement('option');
        opt.value = key;
        opt.textContent = district;
        group.appendChild(opt);
      });
      select.appendChild(group);
    });

    let saved = '';
    try { saved = localStorage.getItem(DEMAND_DISTRICT_KEY) || ''; } catch (_) {}
    const farm = window.FarmState && window.FarmState.load ? window.FarmState.load() : null;
    if (!saved && farm && farm.district && farm.state) {
      const match = districts.find((k) => k === districtKey(farm.district, farm.state));
      if (match) saved = match;
    }
    if (saved) { select.value = saved; renderDemandForDistrict(saved); }

    select.addEventListener('change', () => {
      try { localStorage.setItem(DEMAND_DISTRICT_KEY, select.value); } catch (_) {}
      renderDemandForDistrict(select.value);
    });
  }

  /* ─── Mechanization Demand Intelligence — platform-wide aggregate ─── */
  function renderDemandIntelligence() {
    const statsEl = document.getElementById('tractorIntelStats');
    const barsEl = document.getElementById('tractorIntelBars');
    if (!statsEl || !barsEl || !TRACTORS.length) return;

    const byDistrict = {};
    TRACTORS.forEach((t) => {
      const key = districtKey(t.district, t.state);
      if (!byDistrict[key]) byDistrict[key] = { district: t.district, state: t.state, total: 0, pressured: 0 };
      byDistrict[key].total += 1;
      if (t.availability === 'Limited' || t.availability === 'Booked') byDistrict[key].pressured += 1;
    });

    const districtStats = Object.values(byDistrict).map((d) => ({ ...d, pct: Math.round((d.pressured / d.total) * 100) }));
    const totalPressured = TRACTORS.filter((t) => t.availability !== 'Available').length;
    const overallPct = Math.round((totalPressured / TRACTORS.length) * 100);
    const ownerCount = getOwnerListings().length;

    statsEl.innerHTML = `
      <div class="tractor-intel__stat">
        <div class="tractor-intel__stat-val">${overallPct}%</div>
        <div class="tractor-intel__stat-label">Fleet-wide booking pressure (Limited + Booked)</div>
      </div>
      <div class="tractor-intel__stat">
        <div class="tractor-intel__stat-val">${districtStats.length}</div>
        <div class="tractor-intel__stat-label">Districts with tracked demand signal</div>
      </div>
      <div class="tractor-intel__stat">
        <div class="tractor-intel__stat-val">${ownerCount}</div>
        <div class="tractor-intel__stat-label">Owner-listed tractors from this device</div>
      </div>
    `;

    // Most districts only carry 2 tractors, so a district-level percentage can
    // only ever land on 0/50/100 — ranking by district floods the "highest
    // pressure" list with meaningless 100%s. Aggregate by state instead, where
    // sample sizes are large enough for the percentage to mean something.
    const byState = {};
    TRACTORS.forEach((t) => {
      if (!byState[t.state]) byState[t.state] = { state: t.state, total: 0, pressured: 0 };
      byState[t.state].total += 1;
      if (t.availability === 'Limited' || t.availability === 'Booked') byState[t.state].pressured += 1;
    });
    const stateStats = Object.values(byState).map((s) => ({ ...s, pct: Math.round((s.pressured / s.total) * 100) }));
    const top = [...stateStats].sort((a, b) => b.pct - a.pct).slice(0, 8);
    barsEl.innerHTML = top.map((d) => `
      <div class="tractor-intel__row">
        <div class="tractor-intel__row-label"><span>${esc(d.state)} <small style="color:var(--ink-soft);font-weight:400;">(${d.total} tractors)</small></span><b>${d.pct}%</b></div>
        <div class="tractor-intel__row-track"><div class="tractor-intel__row-fill" data-target="${d.pct}"></div></div>
      </div>
    `).join('');

    requestAnimationFrame(() => requestAnimationFrame(() => {
      barsEl.querySelectorAll('.tractor-intel__row-fill').forEach((el) => { el.style.setProperty('--v', (parseFloat(el.dataset.target) || 0) / 100); });
    }));
    retranslate();
  }

  renderCards();
  renderCompareTable();
  renderPerformance();
  renderMyBookingsPanel();
  renderOwnerListings();
  checkWeatherAdvisory();
  initCropPlan();
  initDemandPanel();
  renderDemandIntelligence();

  const btnOpenListTractor = document.getElementById('btnOpenListTractor');
  if (btnOpenListTractor) {
    btnOpenListTractor.addEventListener('click', () => window.openListTractorModal());
  }

  /* ─── 4. Interactive Booking Modal (Hardening) ─── */
  window.openBookingModal = function (tractorId) {
    const t = findTractorById(tractorId);
    if (!t) return;

    const overlay = document.getElementById('bookingModalOverlay');
    const card = document.getElementById('bookingModalCard');
    if (!overlay || !card) return;

    if (t.availability === 'Booked') {
      card.innerHTML = `
        <button class="mm-modal-close" id="btnModalClose" aria-label="Close">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><path d="M18 6L6 18M6 6l12 12"/></svg>
        </button>
        <div class="mm-success-screen">
          <div class="mm-success-icon" style="background:var(--ink-faint,#9a958a);">✕</div>
          <h3>This tractor is currently booked</h3>
          <p><strong>${esc(t.name)}</strong> isn't available right now. Try another tractor nearby, or check back once its current booking ends.</p>
          <button class="mm-form-submit" id="btnCloseSuccess" style="margin-top: 10px;">Close</button>
        </div>
      `;
      document.getElementById('btnModalClose').addEventListener('click', () => closeModalA11y(overlay));
      document.getElementById('btnCloseSuccess').addEventListener('click', () => closeModalA11y(overlay));
      overlay.classList.add('open');
      openModalA11y(overlay, card);
      retranslate();
      return;
    }

    // Retrieve drawn farm (area + location for the ETA estimate) if available
    const savedFarm = window.FarmState && window.FarmState.load ? window.FarmState.load() : null;
    let savedArea = (savedFarm && savedFarm.acres) ? savedFarm.acres : 4.0;

    // Real distance from the farmer's saved plot to this tractor (Haversine, km)
    function distanceKm(lat1, lng1, lat2, lng2) {
      const R = 6371;
      const dLat = ((lat2 - lat1) * Math.PI) / 180;
      const dLng = ((lng2 - lng1) * Math.PI) / 180;
      const a = Math.sin(dLat / 2) ** 2 + Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;
      return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    }
    const farmDistanceKm = (savedFarm && savedFarm.lat != null && savedFarm.lon != null && t.lat != null && t.lng != null)
      ? distanceKm(savedFarm.lat, savedFarm.lon, t.lat, t.lng)
      : null;
    const etaMinutes = farmDistanceKm != null ? Math.max(6, Math.round((farmDistanceKm / 25) * 60)) : null; // ~25 km/h rural road speed

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
        const safeName = esc(name);
        const safeDate = esc(date);

        // Proxy-booking details, if someone else is booking on the farmer's behalf
        const proxyToggleEl = document.getElementById('proxyToggle');
        let bookedBy = null;
        if (proxyToggleEl && proxyToggleEl.checked) {
          const bookerName = (document.getElementById('proxyBookerName').value || '').trim();
          const bookerPhone = (document.getElementById('proxyBookerPhone').value || '').trim();
          if (bookerName) bookedBy = { name: bookerName, phone: bookerPhone };
        }

        // Split-booking details, if the farmer opted to pool with a neighbor
        const splitToggleEl = document.getElementById('splitToggle');
        const isSplit = !!(splitToggleEl && splitToggleEl.checked);
        let splitWith = null;
        let myShare = totalEstimate;
        if (isSplit) {
          const splitName = (document.getElementById('splitName').value || '').trim() || 'Neighbor';
          const myArea = Math.max(0.1, Number(document.getElementById('bookingArea').value) || 0.1);
          const theirArea = Math.max(0.1, Number(document.getElementById('splitArea').value) || 0.1);
          myShare = Math.round(totalEstimate * (myArea / (myArea + theirArea)));
          splitWith = { name: splitName, myArea, theirArea, myShare, theirShare: totalEstimate - myShare };
        }

        // Save booking record + refresh the My Bookings panel
        const bookings = getMyBookings();
        bookings.unshift({
          bookingId,
          tractorId: t.id,
          tractorName: t.name,
          tractorImage: t.image,
          tractorHp: t.hp,
          district: t.district,
          state: t.state,
          lat: t.lat,
          lng: t.lng,
          operatorName: t.operatorName || 'Partner Farmer',
          operatorPhone: t.operatorPhone || null,
          name,
          phone,
          date,
          duration: durationStr,
          rateType,
          spanDays: computeSpanDays(rateType, rateType === 'hour' ? hours : days),
          cost: totalEstimate,
          splitWith,
          myShare,
          bookedBy,
          outcomeLogged: false,
          distanceKm: farmDistanceKm != null ? +farmDistanceKm.toFixed(1) : null,
          etaMinutes,
          createdAt: new Date().toISOString()
        });
        saveMyBookings(bookings);
        renderMyBookingsPanel();

        // T-1: make the fleet/owner-listing badge agree with the booking we
        // just recorded, instead of leaving it permanently stale (see
        // markTractorReservedOnThisDevice for why this downgrades rather than
        // hard-locks the tractor).
        markTractorReservedOnThisDevice(t.id);
        renderCards();
        renderOwnerListings();
        renderDemandIntelligence();

        const etaHtml = farmDistanceKm != null
          ? `<div class="mm-eta-box">
               <div class="mm-eta-box__head">
                 <span>📍 ${farmDistanceKm.toFixed(1)} km from your saved farm</span>
                 <span class="mm-eta-box__badge">Estimated arrival</span>
               </div>
               <div class="mm-eta-box__val" id="mmEtaCountdown">~${etaMinutes} min</div>
               <p class="mm-eta-box__note">Based on straight-line distance and typical rural road speed — not live GPS or a confirmed pickup time.</p>
             </div>`
          : `<div class="mm-eta-box mm-eta-box--empty">
               <span>📍 Draw your farm boundary to see the real distance and estimated arrival time for every booking.</span>
               <a href="farm-boundary.html" class="btn btn-ghost" style="margin-top:8px;">Draw My Farm</a>
             </div>`;

        card.innerHTML = `
          <div class="mm-success-screen">
            <div class="mm-success-icon">✓</div>
            <h3>Booking saved — call to confirm</h3>
            <p>${bookedBy ? `<strong>${esc(bookedBy.name)}</strong> booked this for` : 'Namaste'} <strong>${safeName}</strong>, ${bookedBy ? 'their' : 'your'} request for the <strong>${esc(t.name)}</strong> is saved on this phone. It is confirmed only once the operator agrees on a call.</p>

            ${etaHtml}

            <div class="mm-success-details">
              <div class="mm-success-row"><span>Booking ID</span><strong>${bookingId}</strong></div>
              <div class="mm-success-row"><span>Tractor</span><strong>${esc(t.name)}</strong></div>
              <div class="mm-success-row"><span>Duration</span><strong>${durationStr}</strong></div>
              <div class="mm-success-row"><span>Total Cost</span><strong>₹${totalEstimate.toLocaleString('en-IN')}</strong></div>
              ${splitWith ? `<div class="mm-success-row"><span>Your Share</span><strong>₹${myShare.toLocaleString('en-IN')} (split with ${esc(splitWith.name)})</strong></div>` : ''}
              <div class="mm-success-row"><span>Date</span><strong>${safeDate}</strong></div>
              ${bookedBy ? `<div class="mm-success-row"><span>Booked By</span><strong>${esc(bookedBy.name)}${bookedBy.phone ? ` (+91 ${esc(bookedBy.phone)})` : ''}</strong></div>` : ''}
              <div class="mm-success-row"><span>Operator</span><strong>${esc(t.operatorName || 'Partner Farmer')}</strong></div>
              <div class="mm-success-row"><span>Operator Phone</span><strong>${t.operatorPhone ? '+91 ' + esc(t.operatorPhone) : 'Not listed yet'}</strong></div>
            </div>
            <p class="mm-split-note">Demo: this app has no live backend, so the operator isn't notified automatically. Call them with the number above to confirm your booking.</p>
            ${splitWith ? `<p class="mm-split-note">🤝 Let ${esc(splitWith.name)} know they owe ₹${splitWith.theirShare.toLocaleString('en-IN')} for their share — settle it between yourselves, MittiMantra doesn't handle payments.</p>` : ''}

            <button class="mm-form-submit" id="btnCloseSuccess" style="margin-top: 10px;">Close Window</button>
          </div>
        `;

        document.getElementById('btnCloseSuccess').addEventListener('click', () => {
          closeModalA11y(overlay);
        });
        document.getElementById('btnCloseSuccess').focus();

        // Purely cosmetic client-side countdown of the estimate above — not a live position feed.
        if (etaMinutes != null) {
          let remaining = etaMinutes;
          const countdownEl = document.getElementById('mmEtaCountdown');
          const timer = setInterval(() => {
            remaining -= 1;
            if (!countdownEl || !document.body.contains(countdownEl) || remaining <= 0) {
              clearInterval(timer);
              return;
            }
            countdownEl.textContent = `~${remaining} min`;
          }, 60000);
        }

        retranslate();
        return;
      }

      // Default Form screen
      card.innerHTML = `
        <button class="mm-modal-close" id="btnModalClose" aria-label="Close">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><path d="M18 6L6 18M6 6l12 12"/></svg>
        </button>
        <div class="mm-modal-header">
          <h3>Request Renting</h3>
          <p>${esc(t.name)} · ${t.hp} HP · ${esc(t.availability)} Status</p>
        </div>
        <form class="mm-modal-body" id="modalBookingForm">
          <div class="mm-proxy-toggle">
            <label>
              <input type="checkbox" id="proxyToggle">
              📞 Booking for someone else? (neighbor, family member, CSC operator)
            </label>
          </div>

          <div class="mm-form-row">
            <div class="mm-form-group">
              <label for="bookingName" id="bookingNameLabel">Your Full Name</label>
              <input type="text" id="bookingName" class="mm-form-input" placeholder="e.g. Ramesh Patel" required>
            </div>
            <div class="mm-form-group">
              <label for="bookingPhone" id="bookingPhoneLabel">Mobile Number</label>
              <input type="tel" id="bookingPhone" class="mm-form-input" placeholder="10-digit mobile" pattern="[6-9][0-9]{9}" required>
            </div>
          </div>

          <div class="mm-proxy-fields" id="proxyFields" style="display:none;">
            <div class="mm-form-row">
              <div class="mm-form-group">
                <label for="proxyBookerName">Your Name (booking on their behalf)</label>
                <input type="text" id="proxyBookerName" class="mm-form-input" placeholder="e.g. Suresh Kumar">
              </div>
              <div class="mm-form-group">
                <label for="proxyBookerPhone">Your Mobile Number</label>
                <input type="tel" id="proxyBookerPhone" class="mm-form-input" placeholder="10-digit mobile" pattern="[6-9][0-9]{9}">
              </div>
            </div>
            <p class="mm-split-note">There's no live backend to call the operator for you — you or the farmer will need to reach them directly once the booking is confirmed. We'll keep your details on this booking so the farmer knows who arranged it.</p>
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

          <div class="mm-split-toggle">
            <label>
              <input type="checkbox" id="splitToggle">
              🤝 Split this booking with a neighboring farm
            </label>
          </div>
          <div class="mm-split-fields" id="splitFields" style="display:none;">
            <div class="mm-form-row">
              <div class="mm-form-group">
                <label for="splitName">Neighbor's Name</label>
                <input type="text" id="splitName" class="mm-form-input" placeholder="e.g. Suresh Kumar">
              </div>
              <div class="mm-form-group">
                <label for="splitArea">Their Farm Area (Acres)</label>
                <input type="number" id="splitArea" class="mm-form-input" min="0.1" step="0.1" value="2.0">
              </div>
            </div>
            <p class="mm-split-note">Costs split by relative farm area. Both households should be on the field when the tractor arrives — one booking, shared machine time.</p>
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
            <div class="mm-calc-row mm-calc-row--split" id="splitCalcRow" style="display:none;">
              <span>Your share</span>
              <span id="calcMyShareVal">—</span>
            </div>
          </div>

          <div class="mm-form-error" id="bookingFormError" role="alert" style="display:none;color:var(--danger, #8b2f2f);font-size:0.78rem;font-weight:600;margin-top:-6px;"></div>

          <button type="submit" class="mm-form-submit">Confirm Booking Request</button>
        </form>
      `;

      // Set default date to tomorrow, and disallow picking anything earlier (M-11).
      const tomorrow = new Date();
      tomorrow.setDate(tomorrow.getDate() + 1);
      const tomorrowStr = localISODate(tomorrow);
      const bookingDateInput = document.getElementById('bookingDate');
      bookingDateInput.value = tomorrowStr;
      bookingDateInput.min = tomorrowStr;

      // Form bindings
      document.getElementById('btnModalClose').addEventListener('click', () => {
        closeModalA11y(overlay);
      });

      const rateTypeSelect = document.getElementById('rateTypeSelect');
      const durationInput = document.getElementById('durationInput');
      const durationLabel = document.getElementById('durationLabel');
      const calcDurationVal = document.getElementById('calcDurationVal');
      const calcTotalVal = document.getElementById('calcTotalVal');
      const splitToggle = document.getElementById('splitToggle');
      const splitFields = document.getElementById('splitFields');
      const splitAreaInput = document.getElementById('splitArea');
      const bookingAreaInput = document.getElementById('bookingArea');
      const splitCalcRow = document.getElementById('splitCalcRow');
      const calcMyShareVal = document.getElementById('calcMyShareVal');

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

        if (splitToggle.checked) {
          const myArea = Math.max(0.1, Number(bookingAreaInput.value) || 0.1);
          const theirArea = Math.max(0.1, Number(splitAreaInput.value) || 0.1);
          const myShare = Math.round(totalEstimate * (myArea / (myArea + theirArea)));
          calcMyShareVal.textContent = `₹${myShare.toLocaleString('en-IN')} (of ₹${totalEstimate.toLocaleString('en-IN')})`;
        }
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
      bookingAreaInput.addEventListener('input', updateCalculation);

      splitToggle.addEventListener('change', () => {
        splitFields.style.display = splitToggle.checked ? '' : 'none';
        splitCalcRow.style.display = splitToggle.checked ? '' : 'none';
        updateCalculation();
      });
      splitAreaInput.addEventListener('input', updateCalculation);

      const proxyToggle = document.getElementById('proxyToggle');
      const proxyFields = document.getElementById('proxyFields');
      const bookingNameLabel = document.getElementById('bookingNameLabel');
      const bookingPhoneLabel = document.getElementById('bookingPhoneLabel');
      proxyToggle.addEventListener('change', () => {
        const isProxy = proxyToggle.checked;
        proxyFields.style.display = isProxy ? '' : 'none';
        bookingNameLabel.textContent = isProxy ? "Farmer's Full Name (who needs the tractor)" : 'Your Full Name';
        bookingPhoneLabel.textContent = isProxy ? "Farmer's Mobile Number" : 'Mobile Number';
        document.getElementById('proxyBookerName').required = isProxy;
        document.getElementById('proxyBookerPhone').required = isProxy;
      });

      const form = document.getElementById('modalBookingForm');
      const formErrorEl = document.getElementById('bookingFormError');
      function showFormError(msg) {
        if (!formErrorEl) return;
        formErrorEl.textContent = msg;
        formErrorEl.style.display = '';
      }
      function clearFormError() {
        if (!formErrorEl) return;
        formErrorEl.style.display = 'none';
        formErrorEl.textContent = '';
      }

      form.addEventListener('submit', (ev) => {
        ev.preventDefault();
        clearFormError();

        // M-11: reject a past (or same-day/before-min) booking date even if the
        // native date picker's min got bypassed somehow.
        const dateVal = bookingDateInput.value;
        const minVal = bookingDateInput.min;
        if (!dateVal || (minVal && dateVal < minVal)) {
          showFormError('Please choose a valid date — bookings must start tomorrow or later.');
          bookingDateInput.focus();
          return;
        }

        // H-8: block/warn on a conflicting booking for this tractor on this device.
        const spanDays = computeSpanDays(rateType, rateType === 'hour' ? hours : days);
        const conflict = findTractorBookingConflict(t.id, dateVal, spanDays);
        if (conflict) {
          const conflictRange = bookingDateRange(conflict.date, conflict.spanDays || 1);
          const rangeLabel = conflictRange.start.getTime() === conflictRange.end.getTime()
            ? conflict.date
            : `${conflict.date} to ${localISODate(conflictRange.end)}`;
          // textContent, so no HTML escaping (it showed "&amp;" literally).
          showFormError(`You already have ${t.name} booked for ${rangeLabel} (${conflict.bookingId}). Pick a different date or tractor to avoid a scheduling conflict.`);
          return;
        }

        renderModalContent('success');
      });

      retranslate();
    }

    renderModalContent('form');
    overlay.classList.add('open');
    openModalA11y(overlay, card);
  };
})();