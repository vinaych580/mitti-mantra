'use strict';
// Acceptance (spec 4.8): axe reports no serious or critical issues on the
// core journeys -- landing, dashboard and the guided planner -- at phone width
// and on a desktop. Moderate and minor findings are listed, not failed.
const { test, expect } = require('@playwright/test');
const AxeBuilder = require('@axe-core/playwright').default;
const { PHONE, DESKTOP, freshVisit } = require('./helpers.cjs');

const PAGES = { landing: '/', dashboard: '/dashboard.html', planner: '/decide.html' };
const BLOCKING = new Set(['serious', 'critical']);

function summary(violations) {
  return violations.map(v => `${v.impact} ${v.id} (${v.nodes.length}): ${v.help}\n    ` +
    v.nodes.slice(0, 5).map(n => n.target.join(' ')).join('\n    ')).join('\n');
}

test.beforeEach(async ({ page }) => { await freshVisit(page); });

for (const [size, viewport] of Object.entries({ phone: PHONE, desktop: DESKTOP })) {
  for (const [name, url] of Object.entries(PAGES)) {
    test(`${name} at ${size}: no serious or critical axe issues`, async ({ page }, info) => {
      await page.setViewportSize(viewport);
      await page.goto(url, { waitUntil: 'load' });
      // Let deferred scripts render (catalogs, farm bar, empty states).
      await page.waitForTimeout(2500);
      const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze();
      await info.attach('axe.json', { body: JSON.stringify(results.violations, null, 2), contentType: 'application/json' });
      const blocking = results.violations.filter(v => BLOCKING.has(v.impact));
      const other = results.violations.filter(v => !BLOCKING.has(v.impact));
      if (other.length) console.log(`[${name} ${size}] not failing:\n${summary(other)}`);
      expect(blocking, summary(blocking)).toEqual([]);
    });
  }
}
