# Guided Decision Flow — Design Spec

**Date:** 2026-08-31
**Status:** Approved for planning
**Author:** Claude (session with support.vr7@gmail.com)

## 1. Summary

Add a new standalone page, `decide.html`, that walks a farmer through three
inputs (location, season/budget, then a tweak step) to a single ranked crop
recommendation with reasoning — instead of requiring them to first
understand and navigate the 22-tool dashboard. The existing dashboard is
untouched; this is a second, narrower entry point that hands off into it.

This is the first of two sub-projects identified in this session (the
second, a **Climate Stress-Test** scenario comparison, is deliberately
deferred — see §9). It was also independently flagged as a planned next
build in `AUDIT_REPORT.md`'s closing remediation note.

## 2. Why

`PRODUCT.md` states two product principles this directly serves:

- **"Decisions, not dashboards"** — the unit of value is a committed
  choice, not a screen of metrics. Today, reaching a decision requires
  first understanding which of 22 tools to use.
- **Two personas, unequal patience.** The primary persona (Ramesh Yadav —
  38, 3 acres, deciding what to sow before the season commits his money)
  needs one defensible answer fast. The advisor persona needs
  side-by-side comparison and already has that in the dashboard. Today
  both are served by the same 22-tool surface, which is tuned for the
  advisor's density, not the farmer's urgency.

## 3. Users & Success Criteria

- **Primary:** a farmer who has never used the product before, on a phone,
  possibly on a weak connection, who wants to know what to plant.
- **Secondary:** the same farmer returning to sanity-check a decision
  before committing budget.
- **Out of scope for this flow:** the advisor persona — they continue
  using the dashboard directly, unaffected by this work.

Success is a farmer reaching the answer screen (§5, step 3) with a
reasoning they can read, in under five inputs, without needing to know
what "ROI" or "risk score" mean in advance (the existing "Why this crop?"
drawer already carries that explanatory weight — see §6.4).

## 4. Scope

**In scope:**
- New page `decide.html` + `decide.js` + a new `frontend/region-geo.js`
  data file.
- Geolocation-to-region matching against a small, real district-centroid
  table, with a dropdown fallback.
- Reuse of `/api/crop` and `/api/simulate` exactly as they exist
  today — no backend changes.
- Entry-point links from `index.html` (hero CTA) and `dashboard.html`
  (sidebar).
- i18n (EN/HI/TE) and offline-shell precaching from day one.

**Out of scope (this spec):**
- Any backend or API change.
- The Climate Stress-Test feature itself — only a reserved hook for it
  (§9).
- Voice-first interaction — a separate, already-flagged future build;
  not integrated here beyond not conflicting with it.
- Changing or removing any existing dashboard tool.

## 5. Experience Design

Single page, JS-driven step transitions — the same show/hide-section
pattern `dashboard.html` already uses for its tool tabs, so there's no new
UI paradigm to learn from the existing codebase.

1. **Where's your farm?** Region dropdown/search (existing ~30-region
   list), or a "Use my location" button. GPS coordinates are matched to
   the nearest entry in `region-geo.js`'s centroid table. If the nearest
   match is farther than ~150km, or geolocation fails/is denied, the flow
   falls back to the dropdown with an honest status message — it never
   silently assigns the wrong region.
2. **When and how much?** Season, budget/acre, area/acres — the same
   three fields the Farm Profile already tracks everywhere else in the
   app.
3. **Your answer.** Top crop from `/api/crop` (POST), rendered through the
   existing `.output[data-out]` convention so `mm-enhance.js` attaches its
   "Why this crop?" reasoning drawer and risk gauge automatically (§6.4),
   plus the plain-language `reasons` array that endpoint attaches per crop
   (soil/weather/budget fit, in farmer-readable sentences — not just the
   numeric-factor bar chart `mm-enhance.js` adds). Two runner-up crops are
   shown collapsed beneath the headline answer — `/api/crop` already
   returns them in one call, ranked.
4. **Tweak it.** Budget, area, and irrigation-level controls re-run a real
   `/api/simulate` call inline, reusing the exact soil/weather auto-fetch
   and budget-split recipe `dashboard.js` already uses for its own
   simulate tool (§6.3) — not a new computation path.
5. **Handoff.** Three actions: "How does this hold up in a bad year?"
   (disabled/reserved — see §9), "Open full dashboard" (deep-links into
   `dashboard.html` with the same farm profile applied), and "Ask the
   chatbot" (the chatbot already reads the Farm Profile on open).

At every step, a quiet "Open full dashboard" link is available — the
advisor persona, or a farmer who wants dashboard-level depth immediately,
is never forced through the rest of the wizard.

Completing step 2 (and again after step 4's tweaks) calls
`MM.profile.set(...)`, so the dashboard and chatbot inherit the same
context immediately if the farmer navigates onward.

## 6. Technical Design

### 6.1 New files

| File | Purpose |
|---|---|
| `frontend/decide.html` | Page shell, one `<section data-step>` per wizard step |
| `frontend/decide.js` | Step transitions, form handling, API calls |
| `frontend/region-geo.js` | Static `{ region_id, lat, lon }` table for all ~30 regions, sourced from real published district-headquarters coordinates |

No backend files change. No new endpoints are added.

### 6.2 Reused endpoints

| Endpoint | Used for |
|---|---|
| `GET /api/regions` | Populating the location dropdown |
| `GET /api/soil/{region_id}` | Auto-fill for the inline simulate call |
| `GET /api/weather/{region_id}?season=` | Auto-fill for the inline simulate call |
| `POST /api/crop` | Step 3's headline answer + runner-ups + `reasons` text |
| `POST /api/simulate` | Step 4's tweak-and-re-run |

`/api/crop` (not the plainer `/api/recommend`, which exists but returns no
`reasons`) is what `dashboard.js`'s own "Smart crop recommendations" tool
actually calls (`dashboard.js:1041`) — it wraps the same `recommend_crops()`
call with `engine/intelligence_layer.py`'s `explain_crop_recommendation()`
to attach per-crop plain-language reasons, and server-side response caching
keyed on the request params (`backend/main.py:1377-1425`). `decide.js` calls
the same endpoint so the guided flow's answer is exactly as complete as the
dashboard's, not a stripped-down copy. Request body is identical either
way — both endpoints take `{region_id, season, budget_per_acre, area_acres}`
(`backend/models.py:185-189`).

### 6.3 Mini-simulation reuse recipe

Step 4 needs two things `dashboard.js` already does separately, not in one
place:

- **Soil/weather auto-fetch-and-coerce.** Its compare and optimal-mix
  tools (~line 2335–2462) both fetch `/api/soil/{region_id}` and
  `/api/weather/{region_id}?season=` in parallel and coerce numeric
  strings before building a request body. `decide.js` follows the same
  pattern.
- **Budget-to-category split.** A separate handler (~line 2300–2308)
  turns a single `budget_per_acre` into per-category costs — seed (12%),
  fertilizer (30%), labour (25%), other (33%) — when auto-filling the
  simulate tool's individual cost fields from a recommendation. `decide.js`
  reuses these same ratios so step 4's inline simulate call is built the
  same way the dashboard already builds it.

Neither pattern is currently factored into a shared function — each lives
inline where it's used today. `decide.js` re-implements both rather than
importing them (there's nothing to import yet); extracting a shared helper
is a candidate follow-up, not required for this feature.

### 6.4 Explainability reuse

`mm-enhance.js` attaches its "Why this crop?" drawer and risk gauge to any
element matching `.output[data-out]` via a `MutationObserver` — it doesn't
care which page it's running on. Loading `mm-enhance.js` on `decide.html`
and rendering the recommendation into a `.output[data-out]` element gets
this for free, keeping the answer screen consistent with the rest of the
product's explainability treatment without reimplementing it.

### 6.5 Geolocation fallback chain

Mirrors `farm-boundary.js`'s existing copy and control flow exactly:

1. `navigator.geolocation` unsupported → "This device cannot share its
   location. Search for your region instead." Dropdown shown.
2. Permission denied → "Location permission denied. Allow it in your
   browser, or search for your region instead." Dropdown shown.
3. Timeout → "Could not get a GPS fix in time. Try again, or search for
   your region instead." Dropdown shown.
4. Resolved, but nearest centroid >150km away → the match is shown as a
   suggestion ("Closest match: X — is this right?") with the dropdown
   still open and editable, not auto-committed.

### 6.6 Offline & PWA

`decide.html`, `decide.js`, and `region-geo.js` are added to `sw.js`'s
precache list, with `VERSION` bumped so existing installs pick them up.
API calls use the same error-classification convention `dashboard.js`
uses post-audit (F-1): a real HTTP error is shown honestly, never folded
into a generic offline message. A true network failure shows the same
"you're offline" treatment already used elsewhere in the app.

### 6.7 i18n

`FRONTEND.md`'s description of this ("`data-i18n` attributes") is stale —
the real mechanism in `frontend/i18n.js` needs no per-element markup at
all: it walks every text node and translatable attribute under
`<body>` automatically and looks each exact English string up in
`window.MM_I18N_CATALOG[lang]` (defined in `frontend/i18n-data.js`, which
already covers `hi`/`te`/`kn` — Kannada is first-class too, not just
Hindi/Telugu). Including `i18n-data.js` + `i18n.js` on `decide.html` gets
translation and the language-switcher pill automatically; the only work
needed is adding `hi`/`te`/`kn` entries to `MM_I18N_CATALOG`, keyed by the
exact English strings `decide.html`/`decide.js` introduce, alongside the
existing entries — done from the first commit, not retrofitted later.

### 6.8 Entry points

- `index.html`: primary hero CTA relabeled to point at `decide.html`
  ("Tell us what to plant →"); this is a copy/link change, not a redesign
  of the landing page.
- `dashboard.html`: a link at the top of the sidebar ("New here? Get one
  answer →") pointing at `decide.html`, for anyone who lands on the
  dashboard first.

## 7. Error Handling & Edge Cases

- Region resolves via geolocation to a state/district not in the ~30-region
  dataset at all: same ">150km" suggestion-not-auto-commit path as any
  other far match, since there's no separate "not covered" signal to
  distinguish it from an imprecise GPS fix.
- `/api/recommend` or `/api/simulate` returns an error (bad input, model
  unavailable): shown honestly in place of the answer, with a retry
  action — no fabricated fallback numbers, consistent with the product's
  "honest by construction" principle.
- Farmer abandons mid-flow and returns later: no persistence beyond what
  `MM.profile` already stores; the wizard restarts at step 1 but the
  location/season/budget fields pre-fill from the existing Farm Profile if
  one is already set.

## 8. Testing Plan

No JS test runner exists in this repository today (confirmed in
`AUDIT_REPORT.md`'s remediation notes — verification there was done by
code trace, not automated test). This feature follows the same practice:
manual verification through the browser preview, covering the golden path
plus geolocation-denied, offline, and region-outside-coverage cases. This
introduces zero backend surface, so no new pytest coverage is expected
unless implementation surfaces an actual backend edge case.

## 9. Deferred: Climate Stress-Test hook

The second sub-project from this session — running the existing simulator
under +1°C / +2°C / -20% rainfall scenarios — is not built as part of this
spec. Step 5 (§5) reserves a labeled action for it ("How does this hold up
in a bad year?") so the two features compose later without reworking the
answer screen. That feature gets its own brainstorming pass and spec when
picked up.

## 10. Open Questions

None blocking. The one implementation detail intentionally left for
planning rather than resolved here: the exact source for
`region-geo.js`'s district-centroid coordinates (a public, verifiable
list — not a design decision, a data-sourcing task).
