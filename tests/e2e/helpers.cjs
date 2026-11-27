'use strict';

const PHONE = { width: 375, height: 812 };
const DESKTOP = { width: 1280, height: 900 };

// Every dashboard tool and the rail section it lives in (Phase 4.1). The spec
// counted 22 tools; the rail has 24 since IoT and the model page joined.
const TOOLS = {
  home: ['home'],
  plan: ['recommend', 'compare', 'simulate', 'mix', 'rotation', 'templates'],
  grow: ['calendar', 'irrigation', 'fertilizer', 'pest', 'disease', 'ndvi', 'iot'],
  sell: ['forecast', 'sell', 'msp', 'arbitrage'],
  money: ['loan', 'expense', 'schemes', 'carbon', 'score'],
  about: ['ml'],
};

// Which bottom tab opens each section on a phone (Money and the model page
// sit under More).
const TAB_FOR = { home: 'home', plan: 'plan', grow: 'grow', sell: 'sell', money: 'more', about: 'more' };

/** A first visit in English: no saved farm, no language choice. */
async function freshVisit(page) {
  await page.addInitScript(() => {
    if (sessionStorage.getItem('e2e-seeded')) return;
    sessionStorage.setItem('e2e-seeded', '1');
    localStorage.clear();
    localStorage.setItem('agrisim_lang', 'en');
  });
}

/** Wait until the dashboard's tool buttons and form selects are filled. */
async function dashboardReady(page) {
  // On a phone the rail is hidden until a tab opens its sheet.
  await page.locator('.sidebar__btn[data-tool]').first().waitFor({ state: 'attached' });
  await page.waitForFunction(() => {
    const sel = document.querySelector('form[data-form="msp"] select[name="region_id"]');
    return sel && sel.options.length > 1;
  });
}

module.exports = { PHONE, DESKTOP, TOOLS, TAB_FOR, freshVisit, dashboardReady };
