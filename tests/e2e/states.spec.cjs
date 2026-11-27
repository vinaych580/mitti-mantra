'use strict';
// Acceptance (spec 4.7/4.8): one tool shown in each of its five states --
// empty, loading, result, error, offline. "MSP vs market" is the example: one
// form, one GET, and no offline simulator standing in for the server, so the
// offline state is the saved-result view (mm-results.js).
const { test, expect } = require('@playwright/test');
const { DESKTOP, freshVisit, dashboardReady } = require('./helpers.cjs');

const API = '**/api/msp-vs-market/**';

test.beforeEach(async ({ page }) => {
  await freshVisit(page);
  await page.setViewportSize(DESKTOP);
  await page.goto('/dashboard.html?tool=msp');
  await dashboardReady(page);
});

const out = (page) => page.locator('[data-out="msp"]');
const run = (page) => page.locator('form[data-form="msp"] button[type="submit"]');

test('empty: says what the tool will give before it is run', async ({ page }) => {
  await expect(out(page).locator('.tool__empty')).toBeVisible();
  await expect(out(page)).toContainText("What you'll get");
});

test('loading: skeleton, busy output, run button held', async ({ page }) => {
  let release;
  const held = new Promise(r => { release = r; });
  await page.route(API, async (route) => { await held; await route.continue(); });
  await run(page).click();
  await expect(out(page).locator('.loading--skel')).toBeVisible();
  await expect(out(page)).toHaveAttribute('aria-busy', 'true');
  await expect(run(page)).toBeDisabled();
  release();
  await expect(out(page).locator('.kpi-grid')).toBeVisible();
  await expect(run(page)).toBeEnabled();
  await expect(out(page)).not.toHaveAttribute('aria-busy', 'true');
});

test('result: MSP and mandi figures with a recommendation', async ({ page }) => {
  await run(page).click();
  await expect(out(page).locator('.kpi-grid')).toBeVisible();
  await expect(out(page)).toContainText('MSP');
  await expect(out(page)).toContainText('Current mandi');
  await expect(out(page)).toContainText('Recommendation');
});

test('error: a server failure reads as plain words and frees the button', async ({ page }) => {
  await page.route(API, route => route.fulfill({ status: 500, contentType: 'application/json', body: '{"detail":"boom"}' }));
  await run(page).click();
  const alert = out(page).locator('.alert--red');
  await expect(alert).toBeVisible();
  await expect(alert).toContainText('Request failed');
  await expect(alert).not.toContainText('boom');
  await expect(run(page)).toBeEnabled();
});

test('offline: the last result saved on this phone, with its date', async ({ page, context }) => {
  await run(page).click();
  await expect(out(page).locator('.kpi-grid')).toBeVisible();
  // mm-results.js copies a result shortly after it settles.
  await page.waitForFunction(() => {
    try { return /kpi-grid/.test(JSON.parse(localStorage.getItem('mm_last_results') || '{}').msp.html); } catch (_) { return false; }
  });
  // A repeat of the same request is answered from the page's own memo, so
  // ask for another crop: that one has to reach the network.
  const crop = page.locator('form[data-form="msp"] select[name="crop_id"]');
  const other = await crop.evaluate(sel => Array.from(sel.options).map(o => o.value).find(v => v && v !== sel.value));
  await context.setOffline(true);
  await crop.selectOption(other);
  await run(page).click();
  const view = out(page).locator('.mm-offline');
  await expect(view).toBeVisible();
  await expect(view).toContainText('Last result saved on this phone');
  await expect(view.locator('.kpi-grid')).toBeVisible();
  await context.setOffline(false);
});

// Known defect, found by this suite: mm-results.js saves a tool's empty state
// ("What you'll get") as its last result, so offline before any real run the
// farmer is shown "Last result saved on this phone" holding only that hint.
// isResult() needs to skip `.tool__empty`. Marked as expected to fail so the
// suite stays readable; Playwright reports it when the fix lands.
test('an empty state is never saved as a last result', async ({ page }) => {
  test.fail(true, 'mm-results.js isResult() accepts .tool__empty (found 2026-11-27)');
  await page.waitForTimeout(2500);
  const saved = await page.evaluate(() => {
    try { return Object.values(JSON.parse(localStorage.getItem('mm_last_results') || '{}')).map(e => e.html); } catch (_) { return []; }
  });
  expect(saved.filter(h => /tool__empty/.test(h))).toEqual([]);
});
