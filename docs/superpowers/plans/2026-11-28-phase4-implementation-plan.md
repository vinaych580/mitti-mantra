# Phase 4 (UI / UX): Implementation Plan

**Date:** 2026-11-28 · **Spec:** `../specs/2026-11-11-phase4-uiux-design.md` · **Roadmap:** `2026-11-11-improvement-roadmap.md`, Phase 4
**Base:** `master` at `ba721eb` (Phases 0–3 merged, `sw.js` `mittimantra-v68`)

Phase 4 reshapes the dashboard around the farmer's season (Plan → Grow → Sell → Money), makes it work on a
375 px Android phone, and shows uncertainty a farmer can act on. The "clay" system in `DESIGN.md` stays.
PRODUCT.md's rules hold for every piece: farmer and advisor are served equally, no new fabricated social proof,
no engagement tricks, EN/HI/TE first-class, zero-build, offline keeps working.

## Rules for every piece

- One branch and one PR per piece, off `master`. A piece that builds on another unmerged piece says so in its
  PR and is rebased after the first one merges.
- **Nothing merges without the owner saying so in chat.** The owner presents on 2026-11-28; production
  (https://mitti-mantra-drab.vercel.app) must not change before then unless they ask.
- Every frontend asset change bumps `VERSION` in `frontend/sw.js`. Each PR takes the next free number at the
  time it is opened; the second of two PRs to merge rebases and takes the next one.
- New user-facing strings get `hi` and `te` entries (`node scripts/ci/check_i18n.cjs origin/master`). `kn`/`ta`
  gaps are warnings (N-12) and are filled where a string is short and unambiguous.
- No inline `<script>` and no `on*=` handlers (`tests/test_security_headers.py`). New inline `style=` attributes
  are avoided: they are what keeps `style-src 'unsafe-inline'` in the CSP.
- Checked in the browser at 375 px and desktop, in English and Hindi, light and dark, on a local server and on
  the Vercel preview (`npx vercel@latest curl <deployment-url>`).

## Order

Spec order, with the small, low-risk pieces moved forward so they can land in the first batch, and the pieces
that need research or owner decisions moved back.

| # | Piece | Spec | Size | Risk | Needs from owner | Status |
|---|---|---|---|---|---|---|
| 0 | This plan | – | S | none | – | [#18](https://github.com/vinaych580/mitti-mantra/pull/18) |
| 1 | Sidebar regrouped into Plan / Grow / Sell / Money; "tools have moved" note | 4.1 (nav part) | S | low | tab labels per language reviewed by a native speaker | [#19](https://github.com/vinaych580/mitti-mantra/pull/19) |
| 2 | One demo banner on Marketplace, Book a Tractor, Gyan Seva; booking stops implying live availability | 4.11 | S | low | – | [#20](https://github.com/vinaych580/mitti-mantra/pull/20) |
| 3 | Buttons disabled during their own request; skeletons instead of spinners | 4.7 (part) | S | low | – | [#21](https://github.com/vinaych580/mitti-mantra/pull/21) |
| 4 | Mobile shell: bottom tab bar, tool list as a sheet, one-line farm bar, 44 px targets, chat/language buttons out of the content | 4.2 | M | medium | – | after 1 (uses its sections) |
| 5 | Popover/sheet focus handling (F-11), reduced motion for globe, Lenis and reveals | 4.8 (part) | S | low | – | after 4 (the sheet is the main new popover) |
| 6 | "My season" home: timeline, current stage, one primary action; planner entry before a plan exists | 4.1 (home part) | M | medium | confirm "My season" replaces "My Farm" as the first screen | after 4 |
| 7 | Offline: last result per tool kept with its date; offline/partial-coverage wording; nearest covered district as a labelled reference | 4.7 (rest) | M | low | – | any time |
| 8 | One shared setup component (state → district type-ahead, "use my location" on device, coverage line, typical-cost helper) used by landing, planner and dashboard | 4.3 | M | medium | – | after 6 |
| 9 | `<mm-estimate>`: range headline, Strong/Fair/Weak word, Why, Source footer, stale-data words | 4.4 | M | medium | thresholds for the confidence word; research sessions | after 8 |
| 10 | Language: chatbot greeting, aria-labels, errors and injected DOM re-translate on switch (C-18/19/20); Marketplace i18n; keyed strings with parameters, page by page | 4.9 | L | medium | agronomic glossary reviewed by native speakers | can start any time, page by page |
| 11 | Performance: `style.css` split, Chart.js/Leaflet/Three.js loaded on open and self-hosted, local hero images, script fonts only for the active language | 4.10 | M | medium | self-hosting Latin fonts (OFL, allowed); budgets enforced in CI need Lighthouse CI (a new dev dependency) | after 4 |
| 12 | Playwright suite: five states per tool, axe on core journeys, old deep links | 4.7, 4.8 acceptance | M | none to prod | adding Playwright + a CI job (dev dependency, ~1 min CI) | any time |
| 13 | Low-literacy path: voice on every setup/planner field with read-back, "listen" on every answer card, icon-led crop cards, WhatsApp plan card | 4.5 | L | low | research sessions | after 9 |
| 14 | Advisor workspace: on-device farmer roster, comparison board (4 scenarios, PDF/CSV), palette "switch farmer"/"new scenario", dense mode | 4.6 | L | low | sync waits for 3.1 (Postgres) | after 9 |
| 15 | `/about` page and a two-minute scripted demo path | 4.12 | S | low | – | any time; useful for reviewers |

### Owner decisions and outside inputs

1. **Research sessions.** The spec asks for five short walk-throughs with people who farm or advise, on a phone in
   Telugu or Hindi, before 4.1, 4.4 and 4.5 are treated as settled. Pieces 1, 4 and 6 are built as hypotheses
   and are easy to revert; 9 and 13 should wait for at least a few sessions.
2. **Native-speaker review** of the new section and tab names (piece 1, 4) and of the agronomic glossary (10).
   The Hindi and Telugu names used in piece 1 are plain, common words; they still need a check.
3. **"My season" as the first screen** (piece 6). Today "My Farm" opens first.
4. **Confidence-word thresholds** (piece 9): which range widths and coverage levels map to Strong / Fair / Weak.
5. **Dev dependencies in CI**: Playwright with axe (12) and Lighthouse CI (11). Neither ships to users.
6. **When to merge.** Not before the 2026-11-28 presentation unless the owner asks.

## Piece details

### 1. Sidebar regrouped (4.1, navigation part)

Today the rail has seven type-based groups: Overview, Plan, Market, Field, Crop health, Finance, System. They
become the spec's four season sections plus the home and the model page:

| Group | Tools (`data-tool`) |
|---|---|
| (top) | My Farm `home` · "New here? Get one answer" link to the guided planner |
| **Plan** (What should I sow?) | `recommend`, `compare`, `simulate`, `mix`, `rotation`, `templates` |
| **Grow** (What do I do this week?) | `calendar`, `irrigation`, `fertilizer`, `pest`, `disease`, `ndvi`, `iot` |
| **Sell** (When and where do I sell?) | `forecast`, `sell`, `msp`, `arbitrage` |
| **Money** (Can I afford it?) | `loan`, `expense`, `schemes`, `carbon`, `score` |
| **About the models** | `ml` |

- Only the markup order and the group labels change. Every `data-tool` stays, so every deep link
  (`?tool=…`, the palette, chatbot actions, `data-goto-tool` cross-links) keeps opening the same tool.
- Each section label carries its question as a subtitle, so the regrouping explains itself.
- A one-time "Tools have moved" note above the rail (dismissed for good with a click, stored in `localStorage`)
  names the four sections, per the spec's risk note. The palette search keeps working unchanged.
- The mobile disclosure groups keep working: they are built from `.sidebar__group` at run time.

### 2. Demo banners (4.11)

- One `frontend/mm-demo-banner.js` + styles: a short bar under the nav saying the page is a demo with demo data
  and that nothing is sent. Same wording on all three pages; each page says what is real (Marketplace: mandi
  prices are real).
- Book a Tractor: the "Available" status and filter become "Listed" wording that does not claim live
  availability; the reservation confirmation says it is a demo and nothing was booked.
- No further investment in these pages until a real backend is decided.

### 3. States, first part (4.7)

- A form's submit button is disabled and marked `aria-busy` while its own request runs, and re-enabled when the
  result, error or empty state replaces the loading state (F-10). Done once in `showLoading`, not per tool.
- The loading state becomes a skeleton in the shape of a result (clay tokens, reduced-motion aware) with the
  same text for screen readers (`role="status"`).

### 4. Mobile shell (4.2)

Below 860 px: a fixed bottom tab bar (Home, Plan, Grow, Sell, More) with 44 px targets and safe-area padding;
tapping a section opens its tools in a bottom sheet; the rail no longer sits above the active tool. The farm bar
collapses to one line (district · crop · acres, tap to edit). The chat and language buttons move above the tab
bar so they never cover content. Desktop keeps the sidebar.

### 7. Offline and coverage (4.7, rest)

Last result per tool in `localStorage` (size-capped) with its date, shown when offline; tools that compute
offline (simulator, recommender) say so, others say what they need. When a district lacks a dataset, the tool
names the gap and offers the nearest covered district (from the district centroids already shipped) as a
labelled reference.

### 12. Playwright suite

Spec acceptance needs it: all tools reachable from the new sections, old deep links, five states per tool, axe
with no serious/critical issues on the three core journeys. Runs against the local uvicorn server in CI.

## Built, measured, left

Updated as each piece lands.

| # | PR | Built | Measured | Left |
|---|---|---|---|---|
| 0 | [#18](https://github.com/vinaych580/mitti-mantra/pull/18) | this plan | – | – |
| 1 | [#19](https://github.com/vinaych580/mitti-mantra/pull/19) `phase4-ia`, `sw.js` v69 | Rail regrouped: My Farm on top; Plan, Grow, Sell, Money (each with its question); "About the models" for ML status. Every `data-tool` unchanged. One-time "Tools have moved" note for returning visitors. Home reachable by arrow keys on mobile. | 375 px and 1280 px, EN/HI, light/dark; old deep links (`pests`, `prices`, `score`, `ml`) open the right tool. `--ink-faint` measured 3.9:1 on the rail, so the section question uses `--ink-soft`. Preview serves the new rail and v69. | Native-speaker check of section names. "My season" home is piece 6. |
| 2 | [#20](https://github.com/vinaych580/mitti-mantra/pull/20) `phase4-demo-banner`, v70 | `.mm-demo-banner` on Marketplace, Book a Tractor, Gyan Seva. Sample tractors: no operator phone shown or stored, no `tel:` link, success says nothing was booked. Demand box and fleet stats call the statuses sample data; the "book ahead" urgency is gone. | **Found:** the 528 generated listings carry realistic 10-digit mobile numbers (could be real people's), and the booking screen told users to call them. Full sample booking walked at 375 px EN/HI/dark. Preview serves banners, v70, `Data/tractors.js` 200. | Card badges (Available/Limited/Booked) stay as labelled sample data. The generator (`Data/generate_tractors.js`) still makes the numbers; regenerating without them is a follow-up. |
| 3 | [#21](https://github.com/vinaych580/mitti-mantra/pull/21) `phase4-states`, v71 | Skeleton loading (heading, three figures, two lines) with the step in words; run buttons disabled + `aria-busy` until the loading state is replaced (F-10); hi/te for 14 loading phrases. | Second click during a request starts no second request; error path (forced 500) releases the button; skeleton in light and dark. Preview serves v71. | Offline last result, offline/partial-coverage wording (piece 7). |

All three bump `sw.js` from v68; they conflict on that one line. Merge in any order and rebase the next onto
`master`, taking the next free number. None is merged; production stays at v68 until the owner says so.
