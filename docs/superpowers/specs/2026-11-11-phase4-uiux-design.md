# Phase 4 — UI / UX

**Date:** 2026-11-11 · **Status:** Draft for owner review · **Size:** 2–3 weeks
**Fixes:** AUDIT C-18, C-19, C-20, F-6, F-10, F-11, T-1, T-2 (surface parts)
**Depends on:** Phase 0. Items 4.1–4.3 can run in parallel with Phase 1. 4.4 needs Phase 2.

## Intent

The interface is carefully made but shaped like a toolbox: 22 tools grouped by type. A
farmer thinks in the order of the season — what to sow, how to grow it, when to sell, how
to pay for it. This phase reshapes the product around that order, makes it comfortable on
a small Android phone, and shows uncertainty in a way a farmer can act on. PRODUCT.md's
rule holds throughout: farmer and advisor are served equally.

## Goals

1. A first-time farmer reaches a ranked answer in under 60 seconds on a phone.
2. A returning farmer sees their one next action without navigating.
3. An advisor can compare scenarios for several farmers without re-entering data.
4. Every number shows its range, source and date in the same place on every screen.
5. WCAG 2.2 AA on the core journeys.
6. Dashboard first load under 200 KB compressed on a throttled 3G profile.

## Non-goals

- A new visual identity. The "clay" system in `DESIGN.md` stays; this phase extends it.
- Native apps.

## Anti-goals

- Hiding depth from advisors to make the farmer view simple.
- Engagement tricks: streaks, fake scarcity, nagging notifications.
- New fabricated social proof (PRODUCT.md already rules this out).

## Design

### 4.1 Information architecture

Four sections replace the current type-based groups. Every existing tool keeps its deep
link.

| Section | Question it answers | Tools |
|---|---|---|
| **Plan** | What should I sow? | Guided planner, Smart recommend, Compare crops, Yield & profit, Optimal mix, Rotation, Templates |
| **Grow** | What do I do this week? | Calendar, Irrigation, Fertilizer, Pest alerts, Disease screen, Field health, Sensors |
| **Sell** | When and where do I sell? | Price outlook, Sell advisor, MSP vs market, Mandi comparison |
| **Money** | Can I afford it? | Loan, Expenses, Schemes, Carbon, Farm score |

"My season" is home. Before a plan exists it shows the guided planner entry. After, it
shows a season timeline with the stage the farmer is in and one primary action.

### 4.2 Mobile shell

- Bottom tab bar: Home, Plan, Grow, Sell, More. The tool list becomes a sheet opened from
  the tab, so the active tool is the first thing on screen (today the list fills it).
- Farm bar collapses to one line: district · crop · acres, tap to edit.
- Touch targets at least 44 px; chat and language buttons move out of the content's way.
- Desktop keeps the sidebar, regrouped to the four sections.

### 4.3 Location and setup

- District picker: state then district with type-ahead in the active language, plus "use
  my location" (browser geolocation → nearest district centroid, on device; coordinates
  are not sent to the server).
- Each district shows what is covered ("yields ✓ weather ✓ mandi prices ✗").
- One shared setup component used by landing, planner and dashboard, so defaults never
  disagree (today Sehore vs Medak).
- Budget field shows the typical cost for the chosen crop as helper text (Phase 0.3).

### 4.4 Showing trust and uncertainty

One component, `<mm-estimate>`, used for every predicted number:

- Headline as a range: "₹62,000 – ₹94,000", with the most likely value smaller beneath.
- A three-step confidence word (Strong / Fair / Weak) derived from range width and data
  coverage, never from a raw probability.
- "Why" opens the drivers: rainfall outlook, price outlook, your budget against typical cost.
- "Source" footer: model or heuristic, data date, link to the model card.
- "How often were we right" line once field outcomes exist; until then the holdout figure
  with the existing disclaimer.
- Stale data is stated in words next to the number, not only in a badge.

### 4.5 Low-literacy and voice path

- Voice input on every field of the setup and planner, with the recognised value read
  back for confirmation before it is accepted.
- Results readable aloud in the active language; a "listen" control on every answer card.
- Crop cards lead with a photo or icon and three facts: likely profit range, risk word,
  water need shown as a 1–5 scale.
- Numerals follow the language setting; ₹ amounts use lakh/thousand words in speech.
- A shareable plan card (image) for WhatsApp with crop, range, sowing window, sources line.

### 4.6 Advisor workspace

- A farmer roster stored on device (and synced after Phase 3): name or label, district,
  plots. Switching farmer swaps the whole Farm Profile.
- Comparison board: up to four scenarios side by side, any input varied, differences
  highlighted, exportable to PDF and CSV.
- Keyboard-first: the existing Ctrl/⌘+K palette gains "switch farmer" and "new scenario".
- Dense table mode toggle for long sessions.

### 4.7 States and resilience

Every tool gets five designed states: empty, loading (skeleton, not spinner), result,
error (what went wrong, what to do), offline (what is still available).

- Offline: the last result per tool is kept and shown with its date. Tools that can
  compute offline (simulator, recommender today) say so; others say what they need.
- Buttons disable during their own request (F-10).
- Partial coverage: when a district lacks a dataset, the tool explains and offers the
  nearest covered district as a labelled reference.

### 4.8 Accessibility

- Target: WCAG 2.2 AA. Recorded in `PRODUCT.md`.
- Popovers and sheets: focus moves in on open, returns on close, `Esc` closes, focus is
  trapped while open (F-11).
- Contrast check across clay tokens in light, dark and high-contrast themes.
- Charts get a text summary and a data table alternative.
- Reduced-motion setting respected by the globe, Lenis scrolling and reveals.
- Tested with TalkBack in Hindi and NVDA in English on the three core journeys.
- Automated axe checks in the Playwright suite.

### 4.9 Language

- Chatbot greeting, aria-labels, error strings and injected DOM follow the site language
  and re-translate on switch (C-18, C-19, C-20).
- i18n moves from whole-string matching to keyed strings with parameters, so a sentence
  containing a crop name or number can be translated. Migration is mechanical and
  per-page.
- Marketplace gets i18n (the only page without it).
- Script fonts load only for the active language; Latin fonts are self-hosted.
- A glossary for agronomic terms per language, reviewed by a native speaker before release.

### 4.10 Performance

- Budgets enforced in CI with Lighthouse on a throttled profile: dashboard JS ≤ 120 KB
  compressed on first load, CSS ≤ 40 KB, LCP ≤ 2.5 s, no layout shift from late fonts.
- `style.css` (170 KB) split into base plus per-page sheets.
- Chart.js, Leaflet and Three.js loaded only when the feature is opened; self-hosted so
  they work offline.
- Hero images served locally as WebP/AVIF with sizes; no remote Unsplash calls.

### 4.11 Demo surfaces

Marketplace, tractor booking and Gyan Seva stay as labelled demos. Each gets the same
short "demo data, nothing is sent" banner component, and booking stops implying live
availability (T-1, T-5 pattern). No further investment until a real backend is decided.

### 4.12 Portfolio presentation

- A `/about` page: the problem, the approach, an architecture figure, links to model
  cards, the defect register and how each was fixed.
- A two-minute scripted demo path (deep links with a prepared profile) for reviewers.

## Research before building

Five short sessions with people who farm or advise (even informal ones), walking the
current planner on a phone in Telugu or Hindi. Record where they stop. This phase's
choices in 4.1, 4.4 and 4.5 are informed guesses until then; treat them as hypotheses.

## Acceptance

- The 60-second first-answer test passes on a mid-range Android at 375 px in TE and HI.
- Axe reports no serious or critical issues on the core journeys.
- Lighthouse budgets pass in CI.
- All 22 tools reachable from the new sections; all old deep links still open the right tool.
- Each tool demonstrates its five states in a Playwright test.

## Left to the builder

Icon set, exact tab labels per language, sheet and skeleton styling within the clay tokens.

## Risks

- Regrouping navigation can disorient current users; keep the palette search and add a
  one-time "tools have moved" note.
- Keyed i18n is a large mechanical change; land it page by page behind the old lookup.
