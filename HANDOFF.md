# HANDOFF — Mitti Mantra (read this first)

Written 2026-11-27 by the original owner's Claude session, for the next developer **and their coding agent**.
If you are an AI agent: read this file, then `README.md`, `docs/ARCHITECTURE.md`, `docs/DEVELOPMENT.md`, and the
Phase 4 plan (`docs/superpowers/plans/2026-11-28-phase4-implementation-plan.md`) before changing anything.

## What the project is

Mitti Mantra: crop-planning / farm-advice web app for Indian farmers (district-level data, recommendations,
price forecasts, sell advice, season planner, chatbot, multilingual EN/HI/TE/KN/TA).

- **Backend:** Python (FastAPI-style API in `api/`, logic in `engine/`, models in `ml/`, data ingestion in
  `data_ingestion/`, `pipelines/`). Serving data is `dataset/serving.sqlite`, fetched at build time from the
  `data-store` GitHub release.
- **Frontend:** static HTML/JS/CSS in `frontend/` (service worker `frontend/sw.js` is versioned — every PR that
  changes frontend files bumps the `sw.js` version; CI checks it with `check_sw_version`).
- **Deploy:** Vercel. Production URL: **https://mitti-mantra-drab.vercel.app** (NOT mitti-mantra.vercel.app,
  that is someone else's). See `vercel.json` — `installCommand: ""` is deliberate (avoids the 500 MB limit).
- **Tests:** `pytest -m "not slow"` (~512 pass), Node `season-plan` tests, `node --check` on frontend JS,
  `check_i18n` (must show 0 missing). CI runs these plus pip-audit.

## Workflow conventions

- One branch + one PR per piece; never commit straight to features on `master`. PR titles name the phase piece
  (e.g. "Phase 4.4: ...").
- Each PR body says what was built, what was measured (375 px + 1280 px, EN/HI, light/dark), and what is left.
- Record progress in the "Built, measured, left" table of the Phase 4 plan doc.
- Specs for every phase live in `docs/superpowers/specs/2026-11-11-phase*-design.md`; defect register is
  `2026-11-11-00-defect-register.md`.

## Done (merged to master)

| Phase | What | PRs |
|---|---|---|
| Audit | Performance / correctness / honesty / a11y pass | #1 |
| 0 | Season planner landed, honest outputs, CI | #2 |
| 1 | Measured data foundation, serving store, district API | #3 |
| 2 | Models on measured data (yield, ranking, price); dashboard: weekly forecast, sell advice, evidence | #4, #5 |
| 3 | Security headers + report-only CSP, inline scripts moved out, body limits, pip-audit, health/version endpoints, JSON logs, daily prod check, satellite import fix, `frontend/Data` deploy fix | #6–#12, #15 |
| Fixes | Sell advice respects perishability; good-farm profit beside district average; chatbot budget parsing | #13, #14, #16, #17 |
| 4.0 | Phase 4 UI/UX plan | #18 |
| 4.1 | Rail regrouped Plan / Grow / Sell / Money; "My season" card on My Farm | #19, #26 |
| 4.2 | Mobile shell: bottom tab bar, tool sheet, one-line farm bar | #22, #25 |
| 4.7 | Skeleton loading, buttons held during requests; offline last result per tool, nearest-district reference | #21, #24 |
| 4.8 (part) | Focus handling for popovers/modals, reduced motion | #23 |
| 4.11 | Demo banners on Marketplace / Book a Tractor / Gyan Seva; no callable sample phone numbers | #20 |
| Data | Failed live-price fetch no longer fails the refresh job | #28 |

## In flight — finish these FIRST (priority order)

1. **PR #31 `final-polish`** — pre-presentation polish (consistent numbers, chatbot covers 23 common questions,
   demo honesty, i18n, charts at 375 px). Open, tests reported passing. Review → rebase on master if needed
   (bump `sw.js` to the next free version) → merge. It supersedes closed PR #30 (`fix-chart-width`).
2. **PR #27 `phase4-setup`** — Phase 4.3: one shared district picker (state → district type-ahead, use my
   location, coverage line). Open. Merge before #29.
3. **PR #29 `phase4-estimate`** — Phase 4.4: `<mm-estimate>` component (range headline, Strong/Fair/Weak, why,
   source). Thresholds are **provisional** — owner decision still needed (see below).
4. **Branch `phase4-lang-chat`** (pushed, **no PR yet**) — Phase 4.9 part: chat and launcher labels re-translate
   on every language switch (C-19, C-20). Open a PR, rebase, bump `sw.js`.
5. **Branch `phase4-about`** (pushed, **no PR yet**) — Phase 4.12: `/about` page and two-minute demo path. Last
   commit is a WIP save of uncommitted tweaks; check it in the browser, then open a PR.

Merge rule: every code PR bumps `frontend/sw.js`; after one merges, rebase the next onto `master` and take the
next free version number. Check `check_sw_version` and `check_i18n` before merging.

## Still to do (Phase 4 plan pieces not started)

- **4.9 Language (rest):** chatbot greeting, aria-labels, errors and injected DOM re-translate on switch (C-18);
  Marketplace i18n; keyed strings with parameters. Kannada/Tamil gaps (N-12).
- **4.10 Performance:** split `style.css`; load Chart.js / Leaflet / Three.js on open and self-host; local hero
  images; script fonts only for the active language. Lighthouse CI needs owner OK (new dev dependency).
- **4.7/4.8 Playwright suite:** five states per tool, axe on core journeys, old deep links (needs owner OK for
  Playwright + CI job).
- **4.5 Low-literacy path:** voice on setup/planner fields, "listen" on answers, icon-led crop cards, WhatsApp
  plan card. Wait for research sessions.
- **4.6 Advisor workspace:** farmer roster, 4-scenario comparison board (PDF/CSV), dense mode. Sync waits on
  Postgres (3.1).
- **Phase 5** features: see `docs/superpowers/specs/2026-11-11-phase5-features-design.md`.
- **Open defects:** N-23 (climate alerts / carbon credits default the crop to wheat — a 3.3 contract item),
  N-22 (a few naive `datetime.now()` calls). Tractor generator `frontend/Data/generate_tractors.js` still makes
  realistic 10-digit phone numbers — regenerate without them.

## Owner decisions / outside inputs still pending

- Confidence-word thresholds for `<mm-estimate>` (Strong / Fair / Weak).
- Native-speaker review of new section/tab names (hi/te) and the agronomic glossary.
- Whether "My season" replaces "My Farm" as the first screen.
- Providers: Postgres (3.1), SMS (3.5), error tracking (3.6). Turn on GitHub secret scanning.
- Costs are on a 2021 basis while prices are 2025–26: decide whether to re-base. Review storage weeks in
  `engine/storability.py`.
- Enforce the page CSP (currently report-only) once production reports are clean (see #7).
- Five short research sessions with farmers/advisors (Telugu or Hindi, on a phone) before 4.4 and 4.5 are settled.

## Before the repo goes private again (important)

The repo was made public for the presentation. Before making it private:
1. Add `DATA_STORE_TOKEN` (fine-grained GitHub token, Contents: read) in Vercel env vars — otherwise the build
   cannot fetch `serving.sqlite` and `/api/v1/districts*` answers 503.
2. Revoke the Vercel "Protection Bypass for Automation" secrets added by `vercel curl`
   (Vercel → Settings → Deployment Protection).

## Gotchas

- Preview/team Vercel URLs are behind Vercel Authentication; use `vercel curl` or the production URL.
- `frontend/Data/` must be included in deploys (it was missing until #12 — check `.vercelignore`).
- CI fetches the data store too (Phase 2 ranking tests need it).
- Local git worktrees under `.claude/worktrees/` belong to the old machine; ignore them.

## Where the detail lives

- `docs/superpowers/plans/2026-11-28-phase4-implementation-plan.md` — Phase 4 order, status, merge order.
- `docs/superpowers/plans/2026-11-27-phase3-implementation-notes.md` — Phase 3 notes + full owner checklist.
- `docs/superpowers/plans/2026-11-11-improvement-roadmap.md` — the overall roadmap.
- `AUDIT_REPORT.md`, `PRODUCT.md`, `DESIGN.md` — audit findings, product and design direction.
