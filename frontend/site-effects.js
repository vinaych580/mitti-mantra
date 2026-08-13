/* ==========================================================================
   AGRISIM / MITTI MANTRA - ADVANCED INTERACTION & MOTION ENGINE
   ========================================================================== */

document.addEventListener('DOMContentLoaded', () => {
  initSpotlightCards();
  initScrollObserver();
  initMetricCounters();
  initTabs();
  initButtonRipples();
});

/**
 * Dynamic Mouse Spotlight Tracker
 */
function initSpotlightCards() {
  const cards = document.querySelectorAll('.spotlight-card');
  cards.forEach(card => {
    card.addEventListener('mousemove', (e) => {
      const rect = card.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;
      card.style.setProperty('--mouse-x', `${x}px`);
      card.style.setProperty('--mouse-y', `${y}px`);
    });
  });
}


/**
 * Scroll Reveal Animations via IntersectionObserver
 */
function initScrollObserver() {
  const observerOptions = {
    threshold: 0.1,
    rootMargin: '0px 0px -40px 0px'
  };

  const observer = new IntersectionObserver((entries) => {
    entries.forEach(entry => {
      if (entry.isIntersecting) {
        entry.target.classList.add('visible-scroll');
        observer.unobserve(entry.target);
      }
    });
  }, observerOptions);

  document.querySelectorAll('.animate-on-scroll, [class*="rounded-3xl"]').forEach(el => {
    observer.observe(el);
  });
}

/**
 * Smooth Animated Number Counter for Metric Chips
 */
function initMetricCounters() {
  const counters = document.querySelectorAll('.metric-counter');
  
  const observer = new IntersectionObserver((entries) => {
    entries.forEach(entry => {
      if (entry.isIntersecting) {
        const target = entry.target;
        const finalVal = parseFloat(target.getAttribute('data-target') || '0');
        const prefix = target.getAttribute('data-prefix') || '';
        const suffix = target.getAttribute('data-suffix') || '';
        const decimals = parseInt(target.getAttribute('data-decimals') || '0');

        let startVal = 0;
        const duration = 1600;
        const startTime = performance.now();

        function update(now) {
          const elapsed = now - startTime;
          const progress = Math.min(elapsed / duration, 1);
          // Cubic ease-out
          const easeProgress = 1 - Math.pow(1 - progress, 3);
          const current = startVal + (finalVal - startVal) * easeProgress;

          target.innerText = `${prefix}${current.toFixed(decimals)}${suffix}`;

          if (progress < 1) {
            requestAnimationFrame(update);
          }
        }

        requestAnimationFrame(update);
        observer.unobserve(target);
      }
    });
  }, { threshold: 0.3 });

  counters.forEach(c => observer.observe(c));
}

/**
 * Smooth Tab Navigation with Entrance Animation
 */
function initTabs() {
  document.querySelectorAll('.tab-nav').forEach(nav => {
    const buttons = nav.querySelectorAll('.tab-btn');
    buttons.forEach(btn => {
      btn.addEventListener('click', () => {
        const targetId = btn.getAttribute('data-tab');
        if (!targetId) return;

        // Active State Styling
        buttons.forEach(b => {
          b.classList.remove('active', 'bg-emerald-400', 'text-emerald-950');
          b.classList.add('text-slate-300');
        });
        btn.classList.add('active', 'bg-emerald-400', 'text-emerald-950');
        btn.classList.remove('text-slate-300');

        // Pane Fade & Slide
        const container = nav.closest('.tab-wrapper') || document;
        container.querySelectorAll('.tab-content').forEach(content => {
          if (content.id === targetId) {
            content.classList.add('active');
          } else {
            content.classList.remove('active');
          }
        });
      });
    });
  });
}

/**
 * Button Click Ripple Effect
 */
function initButtonRipples() {
  document.querySelectorAll('button, a[class*="bg-gradient"]').forEach(btn => {
    btn.addEventListener('click', function(e) {
      const circle = document.createElement('span');
      const diameter = Math.max(btn.clientWidth, btn.clientHeight);
      const radius = diameter / 2;
      const rect = btn.getBoundingClientRect();

      circle.style.width = circle.style.height = `${diameter}px`;
      circle.style.left = `${e.clientX - rect.left - radius}px`;
      circle.style.top = `${e.clientY - rect.top - radius}px`;
      circle.classList.add('ripple-span');

      const ripple = btn.getElementsByClassName('ripple-span')[0];
      if (ripple) {
        ripple.remove();
      }

      btn.appendChild(circle);
    });
  });
}

/**
 * Global Toast Notification Helper
 */
window.showToast = function(message, type = 'success') {
  let container = document.querySelector('.toast-container');
  if (!container) {
    container = document.createElement('div');
    container.className = 'toast-container';
    document.body.appendChild(container);
  }

  const toast = document.createElement('div');
  toast.className = `toast toast-${type}`;
  toast.innerHTML = `
    <div style="font-size:1.2rem;">${type === 'success' ? '✓' : 'ℹ'}</div>
    <div>${message}</div>
  `;

  container.appendChild(toast);

  setTimeout(() => {
    toast.style.opacity = '0';
    toast.style.transform = 'translateX(100%) scale(0.9)';
    toast.style.transition = 'all 0.35s cubic-bezier(0.16, 1, 0.3, 1)';
    setTimeout(() => toast.remove(), 350);
  }, 4000);
};
