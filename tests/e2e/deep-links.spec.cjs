'use strict';
// Acceptance (spec 4.8): links written before the sections were regrouped
// still open the right tool. `pests` and `prices` are names older links used
// that never matched a rail button (mm-core.js TOOL_ALIASES).
const { test, expect } = require('@playwright/test');
const { PHONE, DESKTOP, freshVisit } = require('./helpers.cjs');

const LINKS = { pests: 'pest', prices: 'forecast', score: 'score', ml: 'ml' };

test.beforeEach(async ({ page }) => { await freshVisit(page); });

for (const [size, viewport] of Object.entries({ desktop: DESKTOP, phone: PHONE })) {
  for (const [link, tool] of Object.entries(LINKS)) {
    test(`${size}: ?tool=${link} opens ${tool}`, async ({ page }) => {
      await page.setViewportSize(viewport);
      await page.goto(`/dashboard.html?tool=${link}`);
      const panel = page.locator(`section.tool[data-tool="${tool}"]`);
      await expect(panel).toHaveClass(/\bactive\b/);
      await expect(panel).toBeInViewport();
      await expect(page.locator(`.sidebar__btn[data-tool="${tool}"]`)).toHaveClass(/\bactive\b/);
    });
  }
}

test('a deep link with a farm fills the linked tool', async ({ page }) => {
  await page.setViewportSize(DESKTOP);
  await page.goto('/dashboard.html?tool=recommend&region_id=telangana_medak&season=kharif&area_acres=3&budget_per_acre=25000');
  const form = page.locator('form[data-form="recommend"]');
  await expect(page.locator('section.tool[data-tool="recommend"]')).toHaveClass(/\bactive\b/);
  await expect(form.locator('[name="region_id"]')).toHaveValue('telangana_medak');
  await expect(form.locator('[name="area_acres"]')).toHaveValue('3');
  await expect(form.locator('[name="budget_per_acre"]')).toHaveValue('25000');
});
