# Phase 3 — Architecture Completion (on Vercel)

**Date:** 2026-11-11 · **Status:** Draft for owner review · **Size:** about 2 weeks
**Fixes:** N-11, N-14, N-15, N-21, N-23, N-24, N-28, N-32; AUDIT B-9, B-16, B-17, D-13, F-5, F-7, F-8, F-9
**Depends on:** Phase 0. Items 3.1 and 3.2 may start alongside Phase 1.

## Intent

The system works as a demo but is missing the parts that make it a complete product:
user data that survives, a backend a newcomer can navigate, protection for public
endpoints, a view of what is happening in production, and a frontend that can be tested.
The owner has chosen to stay on Vercel, so every choice here fits serverless functions.

## Goals

1. Commitments, plans, sensor readings, expenses and outcomes persist across deploys.
2. No source file over ~600 lines in `backend/`; one router per domain.
3. Every public endpoint is validated, rate-limited and documented.
4. Errors and slow requests in production are visible within minutes.
5. Frontend logic is split into modules with tests, still with no build step.

## Non-goals

- Leaving Vercel. Microservices. A frontend framework or bundler. Mandatory accounts.

## Anti-goals

- A rewrite. Each step is a move-and-test refactor with behaviour unchanged.
- Collecting personal data the product does not need.

## Target picture

```
Browser (PWA, ES modules, IndexedDB outbox)
   │
Vercel edge: static frontend + security headers
   │  /api/v1/*
Vercel Python function (FastAPI)
   ├─ routers/  core · planning · market · advisory · field · season · chat · system
   ├─ services/ recommend · simulate · forecast · advisory   (no HTTP, no SQL)
   ├─ ml/       inference only (load, predict, explain)
   ├─ store/    read-only serving.sqlite (bundled)  +  Postgres client (user data)
   └─ platform/ config · rate limit · logging · errors
   │
Hosted Postgres (user data)      Vercel Blob (serving data, model artifacts)
   ▲
GitHub Actions: CI · data refresh · model training · release
```

## Design

### 3.1 Persistent storage (N-15, F-5)

- Hosted serverless Postgres through the Vercel Marketplace (Neon is the default pick;
  its free tier fits a portfolio project). `utils/db.py` becomes `store/userdb.py`
  with the same functions; SQLite remains for local development and tests.
- Tables: `devices`, `plots`, `season_plans`, `commitments`, `sensor_readings`,
  `expenses`, `outcomes`, `disease_reports`, `prediction_log`, `waitlist`.
- Every row is scoped by `device_id`; every query filters on it.
- Migrations as numbered SQL files applied by a small script in CI.
- Client sync: an IndexedDB outbox in `mm-core.js`; writes queue offline and flush when
  online; the server is last-write-wins per record with an `updated_at` check.
- Re-enable `/api/expense/*` and add the disease-report sync the queue has been waiting for.
- `your-data.html` gains "delete my data from the server" beside the on-device controls.

### 3.2 Backend structure (N-11, F-7)

- Move routes out of `main.py` into routers by domain, one pull request per router,
  with the OpenAPI document diffed before and after to prove nothing changed.
- `main.py` ends as app creation, middleware and router includes (under 150 lines).
- Split `ml/predict.py`: `ml/inference.py` (load and predict), `services/recommend.py`
  (scoring and ranking), `services/economics.py` (budget, profit), `store/reference.py`
  (data access). `engine/` stops importing underscore-prefixed functions.
- Either mount `routers/data.py` under `/api/v1/reference` or delete it. Decision: delete;
  its routes duplicate `/api/crop`, `/api/soil`, `/api/weather`.

### 3.3 API contract (N-23, N-24)

- All routes under `/api/v1`. Old paths stay as aliases for one release, with a
  `Deprecation` header.
- Advisory routes take `region_id` (and optional `season`) and look up soil and weather
  themselves; explicit values still override. Responses state which inputs were supplied
  and which were looked up (`inputs_resolved`).
- No silent crop defaults: missing `crop_id` → 422.
- One error shape: `{code, message, field?}`. Messages are translatable keys.
- Contract tests generated from the OpenAPI schema run in CI (schemathesis or equivalent).
- `docs/API.md` generated from OpenAPI, not hand-written.

### 3.4 Protection (N-14, N-21, N-28)

- Security headers set in `vercel.json` for static files and by middleware for the API:
  a Content-Security-Policy that allows only self plus the specific tile and font hosts
  still in use, `X-Content-Type-Options: nosniff`, `Referrer-Policy`, `frame-ancestors
  'none'`, HSTS. Inline scripts that block the CSP are moved to files.
- Rate limiting backed by the database or Vercel KV, keyed by IP and device, with
  per-route budgets (image upload strictest).
- `/api/_cache/stats` and model-status internals move behind the admin key and stop
  returning file paths.
- Upload limits on every write route; sensor and expense payloads schema-checked.
- Dependency audit (`pip-audit`) and secret scanning in CI.

### 3.5 Identity

- Device id stays the default; no sign-up to use anything.
- Optional "link a phone number" so plans follow the farmer to a new phone: OTP by SMS
  through a provider chosen later. Spec'd as an interface now (`/api/v1/identity/*`
  returning 501) so the data model has an `owner_id` column from day one.

### 3.6 Observability

- Structured JSON logs with request id, route, status, duration, model version, and data
  manifest hash. No request bodies.
- Error tracking (Sentry free tier or equivalent) for backend and frontend.
- `GET /api/v1/system/health` checks the serving store, the database, and that each
  model loads; `GET /api/v1/system/version` returns commit, data hash and model versions.
- A scheduled GitHub Action calls health and the eight ranking cases from the defect
  register against production daily and opens an issue on failure.
- Privacy-respecting usage counts (the existing `usage_store`) moved to Postgres and
  switched on, with the public notice already drafted.

### 3.7 Frontend structure (F-8, F-9)

- `dashboard.js` (257 KB) becomes `tools/<tool>.js` ES modules loaded with `import()` when
  a tool opens. `dashboard.js` keeps the shell and a registry. Still no bundler:
  `<script type="module">`.
- One `html` tagged-template helper that escapes by default; all 79 `innerHTML` sites
  move to it. URLs go through a `safeUrl()` check.
- Shared `api.js` client: base URL, timeout, offline detection, error mapping, outbox.
- Tests with `node --test` and a minimal DOM shim for pure logic (formatting, state,
  planners); Playwright smoke tests for five core journeys run in CI against a preview
  deployment.
- Service worker precache list generated by a script from the files on disk, so it
  cannot drift; `VERSION` derived from a content hash.

### 3.8 Deployment and environments

- Preview deployment per pull request (Vercel default) with its own database branch.
- `vercel.json`: exclude dev-only artifacts from the bundle (B-16); record measured
  bundle size and cold-start time in CI output, fail above set limits.
- Vercel Cron only for light tasks (cache warm, health); heavy work stays in Actions.
- Environment variables documented in `.env.example` and validated at startup by a
  settings class; the app refuses to start with a half-configured feature.

### 3.9 Documentation (N-32)

- Rewrite `docs/ARCHITECTURE.md` to match reality, with the diagram above.
- Add `docs/DECISIONS/` with short records for: Vercel, Postgres, no framework, intent
  chatbot, model gates.
- README: accurate counts, a "how it works" figure, CI badge, link to model cards.

## Work order

3.4 headers and limits → 3.1 storage → 3.2 routers → 3.3 contract → 3.6 observability →
3.7 frontend modules → 3.8 → 3.9.

## Acceptance

- A commitment made on the deployed site is still returned after a redeploy.
- `backend/main.py` under 150 lines; no backend file over 600.
- OpenAPI diff between before and after the router move shows only the `/api/v1` prefix.
- Security headers present on HTML and API responses; an external header scan grades A.
- A deliberately thrown test error appears in error tracking within five minutes.
- Dashboard first load transfers no tool code until a tool is opened.
- Playwright journeys green on a preview deployment.

## Left to the builder

Postgres driver (psycopg vs an HTTP driver suited to serverless), migration tool, error
tracking vendor, exact CSP after inventorying inline scripts.

## Risks

- Database connections from serverless functions exhaust pools; use the provider's
  pooled or HTTP endpoint.
- A strict CSP can break Leaflet, Three.js or Chart.js. Roll out in report-only mode first.
- The frontend split touches the largest file in the repo; do it tool by tool with the
  Playwright journeys in place first.
