# Regional Saturation-Aware Recommendations — Design Spec

**Date:** 2026-09-02
**Status:** Approved for planning
**Author:** Claude (session with support.vr7@gmail.com)

## 1. Summary

Today the crop recommender (`recommend_crops` in `ml/predict.py`) scores each
farmer's request in isolation — soil, budget, ROI, risk, ML confidence — with
no visibility into what everyone else in the same region has already been
told this season. Because farmers in one `region_id` share similar soil and
weather inputs, the recommender can independently steer many of them toward
the same crop, and if they all plant it the resulting oversupply crashes the
mandi price for everyone — the exact outcome the app is trying to help
farmers avoid.

This adds a **regional saturation signal**: a lightweight commit log of
farmers who declare intent to plant a specific crop, compared against that
region/crop/season's historical planted acreage (`yield_history.csv`), fed
back into the smart-score as a capped penalty and shown to the farmer as a
transparent badge before they commit.

## 2. Why

- The app's stated design principle (`docs/ARCHITECTURE.md`) is
  "deterministic simulation first, ML on top, never ML alone" — this adds a
  third input, regional market reality, without replacing the first two.
- The recommender already optimizes cost/ROI/risk per farmer; without this
  feature it structurally cannot see the fallacy-of-composition failure mode
  where every farmer's individually-optimal choice is collectively harmful.
- Every other data-driven advisory in this app (irrigation, pest, price
  forecast) is grounded in real historical CSV data, not a synthetic
  heuristic — this feature follows the same pattern, using
  `yield_history.csv`'s existing `area_acres` column as the capacity
  baseline instead of inventing a new one.

## 3. Users & Success Criteria

- **Primary:** a farmer running `/api/recommend` (via the "Smart recommend"
  dashboard tool) who would otherwise receive the same top-ranked crop as
  many of their neighbors, with no way to know that.
- **Out of scope:** the guided `decide.html` flow, rotation planner, and
  crop-mix tools are not touched by this spec — they can adopt the same
  scoring change later if desired, but this spec scopes to `/api/recommend`
  / `/api/crop` and the "Smart recommend" dashboard card only.

Success is: a farmer sees a specific, data-grounded reason ("68% of this
region's typical Cotton acreage already committed this season") when their
top pick is trending toward oversupply, and the ranking reflects it — without
ever suppressing a crop that's genuinely their best fit, and without
penalizing crops that lack sufficient regional history to judge.

## 4. Scope

**In scope:**
- New commit log: `dataset/dynamic/commitments.csv` + `utils/commitment_log.py`
  (append/read-all, reusing `utils/csv_cache.py` for cached reads).
- New endpoint `POST /api/commit-crop` (`backend/main.py`, `backend/models.py`).
- Saturation ratio + capped score penalty inside `_score_single_crop`
  (`ml/predict.py`).
- Two new response fields per crop from `recommend_crops()`:
  `saturation_ratio`, `saturation_label`.
- UI: badge + "I'm planting this →" commit button on the top-ranked result
  in the "Smart recommend" card (`frontend/dashboard.js` ~line 1090).

**Out of scope (explicitly deferred, not part of this build):**
- Any change to `/api/crop-recommendations` (the separate explain-focused
  endpoint), rotation planner, or crop-mix tools.
- Cross-region aggregation, forecasting future saturation, or any
  contract-farming / marketplace integration — future work the commit log
  happens to make easier, not something this spec builds.
- Authentication — `device_id` continues to be the existing per-browser
  localStorage id; no real accounts are introduced.

## 5. Data Model

### 5.1 Commit log — `dataset/dynamic/commitments.csv`

```
commitment_id,region_id,crop_id,season,year,area_acres,device_id,timestamp
c_a1b2c3,telangana_medak,cotton,kharif,2026,4.5,dev_9f8e...,2026-06-14T09:22:00Z
```

- Columns are chosen to match `yield_history.csv` (`region_id`, `crop_id`,
  `season`, `year`, `area_acres`) exactly, so the two are directly
  comparable without unit conversion.
- `device_id`: the existing per-browser id already used for the localStorage
  farm profile. Used only to identify a farmer's own prior commitment for
  update-in-place — not for tracking or identity beyond that.
- **Upsert semantics:** a new commit from the same `device_id` for the same
  `region_id`+`season`+`year` overwrites the existing row (latest
  `crop_id`/`area_acres`/`timestamp` wins) rather than appending a duplicate.
  This prevents one farmer re-committing or changing their mind from
  inflating the region's saturation count.
- Writer: `utils/commitment_log.py` — plain `csv.writer` in append/rewrite
  mode (rewrite-whole-file on upsert, consistent with the small expected row
  count — a few hundred rows per season across 30 regions). No pruning or
  archiving in this build (YAGNI; revisit if row count becomes a real
  problem).

### 5.2 Historical baseline

For a given `region_id` × `crop_id` × `season`: take up to the 3
most-recent years present in `yield_history.csv` for that exact key (sorted
by `year` descending; fewer than 3 years is fine, gaps in between are simply
skipped) and average their `area_acres`. If **zero** years exist for that
region/crop/season combination, there is **no baseline** — see §6 for how
that's handled.

## 6. Scoring Integration

In `_score_single_crop` (`ml/predict.py:1055`):

```python
if historical_avg_acres is not None and historical_avg_acres > 0:
    saturation_ratio = clamp(committed_acres / historical_avg_acres, 0.0, 2.0)
    saturation_penalty = clamp(saturation_ratio * 40.0, 0.0, 40.0)
else:
    saturation_ratio = None
    saturation_penalty = 0.0

smart_score = clamp(
    0.35 * roi_normalized
    + 0.20 * risk["confidence_score"]
    + 0.15 * budget_fit
    + 0.15 * soil_health
    + 0.15 * ml_term
    - saturation_penalty * 0.25,   # capped at -10 points
    0.0, 100.0,
)
```

- **Capped subtractive term, not a reweight:** saturation can shift rank
  order among close candidates but can never override a crop that's clearly
  the farmer's best fit, even under maximum saturation. This is a nudge, not
  a lockout — consistent with the app's advisory (not prescriptive) stance
  everywhere else.
- **No baseline → zero penalty.** A crop/region pair with insufficient
  history must never be suppressed for lack of data — that would
  incorrectly punish emerging or newly-viable crops.
- `saturation_ratio` (0–2, or `None`) and a human-readable `saturation_label`
  (e.g. `"68% of typical Cotton acreage already committed this season"`,
  `None` when there's no baseline) are attached to each crop dict returned
  by `recommend_crops()`, computed once per call — not just folded silently
  into the score, so the frontend can explain the nudge rather than just
  applying it.

## 7. API

### 7.1 New endpoint

`backend/models.py`:
```python
class CommitmentRequest(BaseModel):
    region_id: str
    crop_id: str
    season: str
    area_acres: float  # Field(gt=0)
    device_id: str
```

`backend/main.py`:
```python
@app.post("/api/commit-crop")
def commit_crop(req: CommitmentRequest):
    commitment_log.upsert(req)
    return {"status": "recorded"}
```

### 7.2 Existing endpoint response change

`recommend_crops()` (called from `/api/recommend` and `/api/crop`) gains
`saturation_ratio` and `saturation_label` on each returned crop dict.
Additive-only change — no existing field is removed or renamed, so no
frontend code outside the new UI needs to change to keep working.

## 8. Frontend UX

In the "Smart recommend" result card (`frontend/dashboard.js` ~line 1090),
for the top-ranked crop (`recs[0]`) only — not every candidate in the list:

- If `top.saturation_label` is present, show it as a badge styled like the
  existing budget-warning alert (`alert--gold`) — informational weight, not
  alarming red, since this is a nudge.
- A new **"I'm planting this →"** button, placed alongside (not replacing)
  the existing "Sell this produce →" marketplace CTA. On click, POSTs to
  `/api/commit-crop` with `region_id`/`season`/`area_acres` already in scope
  from the form plus the existing per-browser `device_id`.
- On success, the button swaps to a confirmation state: "✓ Recorded —
  thanks, this helps other farmers nearby."
- No `frontend/i18n-data.js` entries: that catalog explicitly scopes itself
  to static site chrome and documents the free-form JSON the ML tools
  render as out of scope (the existing "Sell this produce →" CTA in this
  same card is not translated either) — the badge and button follow that
  established precedent and stay English-only, consistent with the rest of
  this card's dynamic output.

## 9. Edge Cases

- **No historical baseline** (new crop/region pairing, or <1 year of
  `yield_history.csv` data): `saturation_penalty = 0`, `saturation_label =
  None`, badge not rendered.
- **Farmer re-commits** (same `device_id` + `region_id` + `season` + `year`):
  upsert overwrites the prior row rather than duplicating (§5.1).
- **Concurrent writes:** FastAPI's default single-process serial request
  handling is sufficient at this scale (a few hundred rows/season across 30
  regions) — no locking or queueing added.
- **Data growth:** no pruning/partitioning in this build; revisit only if
  `commitments.csv` actually becomes large enough to matter.

## 10. Testing

- Unit tests (`ml/` test suite) for `_score_single_crop`: saturation penalty
  at ratio 0 / 1 / 2, and the no-baseline case, confirming the -10-point cap
  holds in all cases.
- Unit test for the 3-year historical baseline calc, including the
  missing-data/no-baseline path.
- Endpoint tests for `/api/commit-crop`: happy path, upsert-overwrite
  behavior, and validation (`area_acres` must be > 0).
- Manual check: commit a crop via the dashboard, re-run "Smart recommend"
  for the same region/season, confirm the badge and score shift both appear
  as expected.

## 11. Explicitly Deferred (not this build)

- A cross-region or cross-season view of saturation trends.
- Any marketplace/contract-farming integration built on top of the commit
  log (the log is designed to make this easier later, but nothing here
  builds it).
- Applying the same saturation signal to the rotation planner or crop-mix
  tools.
