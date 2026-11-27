'use strict';
// Acceptance (spec 4.8): every tool is reachable from the new sections, on the
// desktop rail and from the phone tab bar's sheets.
const { test, expect } = require('@playwright/test');
const { PHONE, DESKTOP, TOOLS, TAB_FOR, freshVisit, dashboardReady } = require('./helpers.cjs');

const ALL = Object.values(TOOLS).flat();

test.beforeEach(async ({ page }) => { await freshVisit(page); });

test('the rail lists exactly the expected tools, each in its section', async ({ page }) => {
  await page.setViewportSize(DESKTOP);
  await page.goto('/dashboard.html');
  await dashboardReady(page);
  const found = await page.$$eval('.sidebar__group[data-section]', groups =>
    Object.fromEntries(groups.map(g => [g.dataset.section,
      Array.from(g.querySelectorAll('.sidebar__btn[data-tool]')).map(b => b.dataset.tool)])));
  expect(found).toEqual(TOOLS);
  expect(new Set(ALL).size).toBe(24);
});

test('desktop: every tool opens from the rail', async ({ page }) => {
  await page.setViewportSize(DESKTOP);
  await page.goto('/dashboard.html');
  await dashboardReady(page);
  for (const tool of ALL) {
    await page.locator(`.sidebar__btn[data-tool="${tool}"]`).click();
    const panel = page.locator(`section.tool[data-tool="${tool}"]`);
    await expect(panel, tool).toHaveClass(/\bactive\b/);
    await expect(panel, tool).toBeVisible();
  }
});

test('phone: every tool opens from its tab', async ({ page }) => {
  await page.setViewportSize(PHONE);
  await page.goto('/dashboard.html');
  await dashboardReady(page);
  const sheet = page.locator('#dashTools');
  for (const [section, tools] of Object.entries(TOOLS)) {
    for (const tool of tools) {
      const tab = page.locator(`.mm-tabbar__btn[data-tab="${TAB_FOR[section]}"]`);
      if (section === 'home') {
        await tab.click();
      } else {
        await tab.click();
        await expect(sheet, `${section} sheet`).toHaveClass(/is-sheet-open/);
        await sheet.locator(`.sidebar__btn[data-tool="${tool}"]`).click();
        await expect(sheet).not.toHaveClass(/is-sheet-open/);
      }
      const panel = page.locator(`section.tool[data-tool="${tool}"]`);
      await expect(panel, tool).toHaveClass(/\bactive\b/);
      await expect(panel, tool).toBeVisible();
      await expect(tab, `${tool} marks its tab current`).toHaveClass(/is-current/);
    }
  }
});
