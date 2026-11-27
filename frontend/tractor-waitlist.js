/* Waitlist form on book-a-tractor.html. Loaded by a plain synchronous
   <script src> placed after the form (it used to be an inline script and an
   onsubmit attribute, which the page Content-Security-Policy will block once
   it is enforced), so the handler is in place before the user can submit. */
(function () {
  function handleNotify(e) {
    e.preventDefault();
    const input = document.getElementById('notifyPhone');
    const val = input.value.trim();
    if (!/^[6-9][0-9]{9}$/.test(val)) {
      input.style.outline = '2px solid #e87070';
      return;
    }
    input.style.outline = '';

    // T-7: actually keep the number instead of validating then discarding it —
    // local-only-but-real, same pattern bookings/listings already use in
    // book-a-tractor.js (JSON array in localStorage).
    try {
      var WAITLIST_KEY = 'mittimantra_tractor_waitlist';
      var list = JSON.parse(localStorage.getItem(WAITLIST_KEY) || '[]');
      if (!list.some(function (x) { return x.phone === val; })) {
        list.push({ phone: val, requestedAt: new Date().toISOString() });
        localStorage.setItem(WAITLIST_KEY, JSON.stringify(list));
      }
    } catch (_) {}

    const btn = e.target.querySelector('.btn-notify');
    btn.textContent = '✓ Saved on this phone';
    btn.style.background = '#2f6b3a';
    input.disabled = true;
    btn.disabled = true;
  }

  var form = document.getElementById('notifyForm');
  if (form) form.addEventListener('submit', handleNotify);
})();
