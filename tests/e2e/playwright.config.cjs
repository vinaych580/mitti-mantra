// Phase 4 browser suite (spec 4.7/4.8 acceptance): sections, old deep links,
// the five states of one tool, and axe on the three core pages.
//
// Runs against the real app on a local uvicorn server, the same process the
// Python tests import. Locally:
//   npm install --no-package-lock && npx playwright install chromium
//   PYTHON=venv/Scripts/python.exe npx playwright test -c tests/e2e
// (PYTHON defaults to `python`; E2E_PORT to 8866.)
'use strict';
const path = require('node:path');
const { defineConfig } = require('@playwright/test');

const PORT = Number(process.env.E2E_PORT || 8866);
const PYTHON = process.env.PYTHON || 'python';

module.exports = defineConfig({
  testDir: __dirname,
  timeout: 60_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never', outputFolder: path.join(__dirname, '..', '..', 'playwright-report') }]] : 'list',
  outputDir: path.join(__dirname, '..', '..', 'test-results'),
  use: {
    baseURL: `http://127.0.0.1:${PORT}`,
    // The service worker caches the shell; a test must see the files on disk.
    serviceWorkers: 'block',
    trace: 'retain-on-failure',
  },
  projects: [{ name: 'chromium', use: { browserName: 'chromium' } }],
  webServer: {
    command: `"${PYTHON}" -m uvicorn backend.main:app --host 127.0.0.1 --port ${PORT}`,
    cwd: path.join(__dirname, '..', '..'),
    url: `http://127.0.0.1:${PORT}/api/health`,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
