# Phase 5 — New Features

**Date:** 2026-11-11 · **Status:** Draft for owner review · **Size:** each feature 3–8 days
**Depends on:** noted per feature. Build in the order listed unless the owner re-ranks.

## Intent

With real data, honest models, durable storage and a season-shaped interface in place,
the product can do what no static dashboard can: stay with a farmer from sowing to sale,
and learn from what actually happened. These features are chosen because each resolves to
a decision (PRODUCT.md principle 2) and because several of them produce data that makes
the models better.

## Shared rules

- Every feature ships in EN, HI and TE, works offline for reading, and labels its sources.
- Nothing is sent on the farmer's behalf without an explicit tap.
- Each feature has a model or data dependency listed; if that is missing in a district,
  the feature says so and does not guess.

---

## 5.1 Season companion (weekly plan) — needs Phases 1, 3, 4

**What.** After a plan is saved, "My season" shows this week's tasks: sowing window,
irrigation due, fertiliser split due, pest risks to scout for, each generated from the
crop calendar, the 16-day forecast and the existing rule sets.

**How.**
- `services/season_tasks.py` turns (crop, sowing date, district, forecast, soil) into
  dated tasks with a reason and a source. Pure function; fully tested.
- Tasks have states: due, done, skipped (with reason). Stored per plan.
- Irrigation tasks use forecast rain and reference evapotranspiration, replacing the
  fixed 800 mm assumption.
- Pest tasks use forecast temperature and humidity (fixes AUDIT B-9 and C-25).

**Done when.** A saved cotton plan in Medak shows correct dated tasks for the next two
weeks, and they change when the forecast changes.

## 5.2 Harvest outcome logging — needs Phase 3

**What.** At harvest the app asks three things: how much was harvested, what price it
sold for, and when. Optional: what went wrong.

**How.**
- Form in "My season", voice-enabled; stored in `outcomes` with the plan's
  `model_version` and original prediction (already captured in the plan).
- Feeds `ml/season_evidence.py --observations`, which already validates that predictions
  preceded observations.
- The farmer sees "we estimated X–Y, you got Z" and a district comparison.
- Aggregates appear on model cards once a group has ≥ 30 outcomes.

**Done when.** A logged outcome appears in the evidence report under field evaluation.

## 5.3 Sowing-window advice — needs Phases 1, 2

**What.** "Sow now, wait, or switch": monsoon onset for the district this year against
its normal, soil-moisture proxy, the next 16 days, and the latest safe date per crop.

**How.** Onset detection on `weather_daily` (a standard rainfall-threshold rule, named in
the UI); late-sowing yield penalty from `yield_at_sowing`; short-duration alternatives
offered when the window is closing.

**Done when.** Backtest on the last ten years flags late-onset years for five districts
and the advice is consistent with what was sown.

## 5.4 Price alerts and mandi comparison — needs Phases 1, 2, 3

**What.** For the farmer's crop: today's price at nearby mandis, net of transport, the
outlook range, and an optional alert when a price crosses a level the farmer sets.

**How.**
- Net price = modal price − (distance × per-km cost the farmer can edit).
- Alerts evaluated by the daily price job; delivered by web push (5.7), with an in-app
  list as the fallback.
- Replaces the arbitrage globe's data source with real mandi coordinates.

**Done when.** Three mandis within 100 km are ranked by net price for a test district, and
an alert fires in a preview environment.

## 5.5 My soil — needs Phase 3

**What.** The farmer enters values from their Soil Health Card (typed, or read from a
photo and confirmed field by field). Fertiliser and crop-fit advice then use their soil
instead of the district average.

**How.** Stored per plot; overrides `soil_district`; every result says whose soil values
were used and their date. Photo reading runs on device and never auto-accepts a value.

**Done when.** Fertiliser advice changes when a plot's soil values are edited, and the
source line says "your Soil Health Card, 2025".

## 5.6 Insurance and credit helper — no new dependency

**What.** PMFBY premium and sum insured for the chosen crop and district, enrolment
cut-off date, and KCC limit estimate, beside the existing loan tool and scheme matcher.

**How.** Rates and cut-offs curated in a dated table with a staleness test; the
calculation shown step by step. Links go to the official portals; the app does not submit.

**Done when.** Premium for three crop-district pairs matches the official calculator.

## 5.7 Reminders (web push) — needs Phase 3

**What.** Opt-in notifications for due tasks, price alerts, and scheme deadlines.

**How.** Standard Web Push with VAPID keys; subscriptions stored per device; a daily
GitHub Action or Vercel Cron sends at most one digest per day per device; quiet hours;
one-tap unsubscribe. iOS limitations stated in the opt-in sheet.

**Done when.** A due task produces one notification on Android Chrome in a preview build.

## 5.8 Field health from satellite — needs Phase 1 (NDVI), 3

**What.** Replace the estimated NDVI endpoint (labelled "not real Sentinel-2" today) with
a real 16-day NDVI series for the drawn plot or district, against the same period in
prior years.

**How.** Earth Engine query by plot polygon, cached per plot per composite; cloud-masked;
shown as "greener / same / less green than usual for this week". Falls back to district
mean when a plot is under one pixel.

**Done when.** A drawn two-acre plot shows a real series with dates and source.

## 5.9 Advisor reports — needs Phase 4.6

**What.** One-page plan per farmer (crop, ranges, calendar, risks, sources) as PDF and a
WhatsApp image, in the farmer's language, with the advisor's name.

**Done when.** A report for a Telugu-profile farmer renders correctly in print preview.

## 5.10 Chat understanding with a language model — optional, needs Phase 3

**What.** Keep the grounded intent engine as the only source of numbers; add a language
model in front of it solely to understand free-form Telugu, Hindi and mixed-language
questions and to choose which engine function to call.

**How.** Tool-calling against the existing service functions; the model never writes a
figure itself — replies are assembled from tool results by the current formatters. Off
by default, behind a key and a spending cap; falls back to the regex router. This
reverses the recorded "intent chatbot, not LLM" decision, so it needs the owner's
explicit yes and a decision record.

**Done when.** A 100-question multilingual test set shows higher intent accuracy than the
regex router with zero ungrounded numbers.

## 5.11 Community yield benchmark — needs 5.2 and enough data

**What.** "Farmers near you growing cotton averaged X this season", only when at least
ten outcomes exist in a group, with nothing that identifies a person.

**Done when.** The panel stays hidden below the threshold and shows aggregates above it.

---

## Order and reasons

1. 5.1 and 5.2 together: they create the return visit and the data flywheel.
2. 5.4: most direct money value.
3. 5.3: the most-asked decision.
4. 5.7: makes 5.1 and 5.4 useful between visits.
5. 5.5, 5.6, 5.8, 5.9.
6. 5.10 and 5.11 last.

## Explicitly not planned

- A real marketplace, payments, tractor dispatch or paid consultations. Each needs
  operations and trust-and-safety work beyond a portfolio project. They remain demos.
- Automated pump control. The current endpoint recommends only; it stays that way.
