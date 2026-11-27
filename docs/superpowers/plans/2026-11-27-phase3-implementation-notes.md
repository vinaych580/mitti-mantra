# Phase 3 — Implementation Notes

**Date:** 2026-11-27 · **Branch:** `phase3-protection` · **Spec:** `../specs/2026-11-11-phase3-architecture-design.md`

Phase 3 is about two weeks of work. This first slice follows the spec's work order and starts with 3.4
(headers and protection), chosen because it can ship without new infrastructure and without changing what any
page does. The other items need decisions or accounts only the owner can make; they are listed at the end.

## Built (3.4, first part)

| Spec item | Where |
|---|---|
| Security headers on every response: `X-Content-Type-Options: nosniff`, `Referrer-Policy: strict-origin-when-cross-origin`, `X-Frame-Options: DENY`, a `Permissions-Policy` that keeps camera, microphone and location for the site itself and switches off payment, USB, serial, Bluetooth, HID and topics | `backend/security.py` (one source), `vercel.json` `headers` for static files, `SecurityHeaders` middleware for the API |
| API responses carry an enforced `Content-Security-Policy: default-src 'none'; frame-ancestors 'none'` (JSON loads nothing). `/docs`, `/redoc`, `/openapi.json` get the page policy because Swagger UI loads from a CDN | `backend/security.py` |
| Page Content-Security-Policy in **report-only** mode, with violation reports sent to `POST /api/v1/csp-report`, which logs one line per report (directive, blocked URL, page; query strings stripped, no body kept) and always answers 204 | `backend/security.py`, `backend/routers/system.py` |
| `/api/_cache/stats` behind `ADMIN_API_KEY` (401 without it, 503 when the key is not configured); the usage summary uses the same check | `backend/main.py` `_require_admin_key` |
| Tests: API and page headers, `vercel.json` matches the module, every external script host in the pages is allowed, reports are logged without query strings, bad reports never fail, admin gate | `tests/test_security_headers.py` |

HSTS is not set: Vercel already sends it for its domains, and a custom domain should set it with that domain's
own decision on `includeSubDomains` and preload.

`/api/ml/status` stays public. It feeds a dashboard panel and returns only relative paths (`ml/models`), not
file-system paths.

## Measured: what the page policy reports

All nine pages were loaded on a local server with the policy in place and a fresh service worker.

- **Fixed in the policy:** the service worker re-fetches fonts, photos and map tiles to cache them, and a
  worker's fetch counts as `connect-src`, so those hosts were added. `site-ui.js` injects speculation rules
  (prefetch on hover) as an inline script, so `'inline-speculation-rules'` was added.
- **Still reported, needs code moved before the policy can be enforced:**
  - inline `<script>` blocks: `index.html:92` (headline animation) and `book-a-tractor.html:1172`;
  - inline event handlers (`script-src-attr`): one each in `marketplace.html`, `gyan-seva.html` and
    `book-a-tractor.html`, plus handlers built in JS at `marketplace.js:649`, `book-a-tractor.js:514`,
    `map-tractors.js:141`, and the "See an optimal multi-crop mix" link in `dashboard.js` (TOOL 1);
  - `style-src` keeps `'unsafe-inline'`: inline `style=` attributes are everywhere and moving them is a
    Phase 4 (UI) job, not this one.
- A service worker keeps the policy it was installed with. Returning visitors pick the new one up when `sw.js`
  next changes; that does not matter while the policy is report-only.

## Not done in this slice, and why

| Spec item | Status |
|---|---|
| 3.4 rate limiting backed by a database or Vercel KV | Needs the 3.1 database or a KV store, which needs an account. The per-IP in-process limits on commit-crop and disease scan stay. |
| 3.4 enforce the page CSP | After the inline scripts and handlers above are moved to files, and a few days of clean reports from production. |
| 3.4 `pip-audit` and secret scanning in CI | Next slice; `pip-audit` will likely report existing pins, so it should land as a non-blocking job first. |
| 3.1 persistent storage (Postgres) | **Owner decision:** create the Neon (or other) database through the Vercel Marketplace; I cannot create accounts. The driver choice (psycopg vs an HTTP driver) follows from the provider. |
| 3.2 routers, 3.3 `/api/v1` contract | Move-and-test refactors of `backend/main.py` (~2,700 lines). Safe to do after the demo, one router per pull request with the OpenAPI diff, as the spec says. Not started the night before a presentation. |
| 3.5 identity, 3.6 error tracking | **Owner decisions:** SMS provider, error-tracking vendor (Sentry free tier is the spec's default). |
| 3.6 health/version endpoints, structured logs | No outside dependency; a good next slice. |
| 3.7 frontend modules, 3.8, 3.9 | Later, in the spec's order. |

## Found in passing

- `/api/satellite` answered 500 once on a cold local server and 200 every time after; the same request is 200 on
  production. It looks like the concurrent-import race fixed for the model loaders in the `phase2-dashboard`
  branch (`ml/_artifact.py`), here in `data_ingestion.fetchers.google_earth_engine`'s import, which sits
  outside the route's try block. Not fixed here.
