# Independent Code Audit — Mitti Mantra / AgriSim (Pass 2)

**Scope:** full repository, re-audited after two fix commits (`618100a`, `1dd2bdd`) addressed Pass 1's findings, plus one new feature commit (`7b83908` — regional benchmark panel, mandi arbitrage globe, spoken daily briefing) that had not been audited at all.
**Method:** five independent parallel audits (backend/ML, chatbot/i18n, frontend dashboard/state, marketplace/booking/Gyan Seva, data-ingestion/deployment/security/tests), each doing full deep-reads of its files — not grep-sampling — and empirically verifying claims by executing real code against real data/models wherever possible, cross-checked against `git diff`/`git show` on the actual fix commits rather than trusting commit messages. The full test suite was run fresh: **49/49 passing**.
**Posture:** same as Pass 1 — every claim below was checked against the code that actually runs, including the fixes themselves.

---

## 1. Executive Summary

The two fix commits did real, verifiable work. Of Pass 1's ~40 numbered findings, roughly **30 are cleanly fixed** — including the two most damning ones: the crop-recommendation model now covers all 32 crops (was 12), and the audit pipeline's train/test leakage is now empirically **0.0%** row-hash overlap (was 83.6%). Several fixes are traceable in-code, with the finding ID cited directly in a comment next to the change — a good practice worth continuing.

But three patterns recur across the five reports that are worth naming before the individual findings:

1. **Some fixes patched the instance, not the class of bug.** C-4 removed "mandi"/"kisan" from the Hindi false-positive word list; the audit found "hum" and "aap" — ordinary English words — still in the same list, causing the identical failure mode (an English message about a borewell "hum" gets answered entirely in Hindi). H-11's `prediction_source` honesty fix reached three endpoints but not its sibling `/api/yield`, which still hardcodes an algorithm name even when it silently used the heuristic fallback.
2. **One fix from today doesn't actually run.** Commit `1dd2bdd` (today) added a new MSP-vs-market comparison handler to the chatbot, but an earlier, unconditional branch intercepts the message first — the new code is dead. `/mspvsmarket` and "msp vs market for rice" both still return a raw JSON dump instead of the intended comparison.
3. **A partial fix can still ship the core defect.** Tractor booking now has a same-device date-conflict check, but it checks a different data structure than the one (`.availability`) the UI actually reads to show "Available" — so cards still show availability that isn't enforced, and cross-device double-booking is completely open, same as Pass 1.

The newest feature work (`7b83908`, one day old, not yet audited before now) came back clean on the "did it fabricate anything" question — it reuses real endpoints, fails gracefully, and doesn't invent numbers. It did introduce one real bug (a spoken-briefing double-click race) and had one side effect nobody was watching for: fixing the crop-recommendation model to cover all 32 crops nearly doubled the deployed model bundle (60MB → 112.7MB) against an unchanged 1024MB Vercel memory cap.

**The single most important finding is C-23** (below): it's not a subtle edge case, it's the bot's own UI leading a first-class-supported-language user into an unrecoverable loop.

---

## 2. Findings — Backend & ML (`B-`)

*Scope: `backend/main.py`, `backend/models.py`, `ml/predict.py`, `ml/train_models.py`, `ml/evaluate_models.py`, `ml/audit_models.py`, `utils/calculations.py`, `utils/csv_cache.py`, `engine/simulator.py`, `engine/features.py`.*

| ID | Severity | Status | Finding | file:line | Evidence |
|---|---|---|---|---|---|
| B-1 | Critical | FIXED | `/api/ml/status` reads the manifest for the model actually loaded, not an orphaned eval script's manifest | main.py:711-748 | live manifest.json mtime current; orphaned evaluation_manifest.json ~92hr stale and unread elsewhere |
| B-2 | Critical | FIXED | Train/test leakage in the audit pipeline eliminated | train_models.py:94-123, audit_models.py:36-113 | rebuilt split + row-hash overlap: **0/12000 (0.0%)**, was 83.6% |
| B-3 | High | FIXED | numpy pin matches installed/tested version | requirements.txt:11 | `numpy==2.5.1` pinned and installed, exact match |
| B-4 / B-15 | Medium | PARTIALLY-FIXED | `prediction_source` honesty fix didn't reach `/api/yield` — it still hardcodes `"RandomForestRegressor (Tuned)"` even when the heuristic silently fired | ml/predict.py:372-437 (fixed) vs backend/main.py:1398 (not) | forced an unseen region → `used_ml_for_yield=False`, but the endpoint discards that flag and always claims the ML algorithm |
| B-5 | Medium | FIXED | `/api/crop-comparison` rejects non-positive budget/area | main.py:278-279 | validation guard present |
| B-6 | Medium | FIXED | All 4 previously-unwired Pydantic query models now wired via `Depends()` | main.py:1298,1348,1434,1455 | confirmed on all 4 endpoints |
| B-7 | Medium | FIXED | NDVI docstring and payload both disclose it's not satellite imagery | main.py:324-333 | explicit "NOT real Sentinel-2" docstring + `is_estimate:true` payload field |
| B-8 | Medium | FIXED | CSV cache write is now compare-and-swap, can't be clobbered by a stale slow parse | csv_cache.py:62-74 | mtime guard added around the write |
| B-9 | Medium | PARTIALLY-FIXED | Disease-outbreak risk now genuinely scoped by `crop_id`; `region_id` is still accepted but never used to fetch regional weather | features.py:852-951 | two climatically opposite regions still produce byte-identical risk output |
| B-10 | Medium | FIXED | Fabricated rainfall/12 humidity proxy replaced with a documented constant | features.py:874-883 | `DEFAULT_HUMIDITY_PCT = 65.0` with IMD-climatology rationale |
| B-11 | Medium | FIXED | Audit manifest now auto-regenerates every training run | train_models.py:706-749 | manifest + audit_metrics.json mtimes 0.14s apart |
| B-12, B-13 | Medium | FIXED | `catboost` and `pandas` moved to requirements-dev.txt, out of the production bundle | requirements*.txt | confirmed via `pip show` in venv |
| B-14 | Medium (potential) | STILL-PRESENT, WORSE | Joblib bundle nearly doubled (60MB→112.7MB) fixing B-1's sibling (32-crop retrain), same unchanged 1024MB Vercel cap | vercel.json:5,7 | recommend_model.joblib alone: 30.7MB → 82.5MB |
| B-16 | Low | NEW | Two dev-only holdout joblib files (920KB combined) get bundled into the production Lambda by the `*.joblib` glob | vercel.json:5 | only read by dev-only audit script, never on the live request path |
| B-17 | Low | NEW | `audit_models.py` unconditionally imports pandas; a strict `requirements.txt`-only install would silently stop the audit-manifest refresh (swallowed exception) rather than error loudly | audit_models.py:8; train_models.py:712-718 | masked today only because pandas happens to be present in the dev venv |
| B-18 | Medium | NEW | `/api/yield`'s "95% confidence interval" is statistically correct but practically useless — routinely 3-6x the predicted value, always clamped to 0 on the low end | main.py:1384-1398 | wheat/UP: predicted 1471.5 → CI [0, 6190.1] (421% width) |

## 3. Findings — Chatbot & i18n (`C-`)

*Scope: `backend/chatbot.py`, `engine/chatbot_i18n.py`, `frontend/chatbot.js`, `tests/test_chatbot.py`. All verified by executing real code against realistic EN/HI/TE/KN input.*

| ID | Severity | Status | Finding | file:line | Evidence |
|---|---|---|---|---|---|
| C-4 | Critical | FIXED (see C-21) | "mandi"/"kisan" removed from Hindi-trigger word list | chatbot_i18n.py:55-61 | `detect_lang("mandi price of wheat")→"en"` |
| C-5 | High | FIXED | Generic direction words no longer silently resolve to a wrong specific region | chatbot.py:174-220 | `_find_region("west")→None` (honest fallback, not fake district data) |
| C-6 | High | FIXED | `/pest`, `/irrigate`, `/calendar`, `/sell` all now have a "which crop?" branch | chatbot.py:1216-1284 | all 4 bare commands prompt for a crop instead of falling through |
| C-7 | High | FIXED | Budget/area extraction now bound by nearest keyword, immune to sentence reordering | chatbot.py:256-327 | both phrasing orders produce identical, correct values |
| C-13 | Medium | FIXED | `context.region_id`/`season` validated before reaching engine calls | chatbot.py:1170-1180 | forged values → clean reply, no raw `ValueError` leak |
| C-14 | Medium | PARTIALLY-FIXED | English "suggest(ion)" trigger now requires a crop/grow/plant/sow word; the Hindi equivalent (सुझाव) was never given the same restriction | chatbot.py:1201-1209 (fixed) vs chatbot_i18n.py:283 (not) | Hindi "suggestion for pest in rice" still misroutes to "which region?" |
| C-15 | Medium | FIXED | Greeting only short-circuits on a whole-message match | chatbot.py:1142-1153 | "hey what is msp" returns real MSP data, not a canned greeting |
| C-16 | Medium | FIXED | "paddy"/"basmati"/"sarson" now resolve to their real crops | chatbot.py:140-144 | confirmed for all three |
| C-17 | Medium | FIXED | Pest/irrigation replies now use real per-region weather instead of a fixed 28°C/800mm default | chatbot.py:81-105 | two regions produce genuinely different, dataset-derived numbers |
| C-18 | Low | STILL-PRESENT | Chatbot's first-open greeting hardcoded in English regardless of site language | chatbot.js:399-405 | never reads the page's `lang` attribute, unlike its own TTS/speech code two lines away |
| C-19 | Low | PARTIALLY-FIXED | i18n catalog now covers 4 chatbot strings; ~6 more still missing (aria-labels, TTS button, error strings) | i18n-data.js:288-292 | |
| C-20 | Low | STILL-PRESENT | Dynamically-injected chat DOM is never re-translated on a language switch | chatbot.js (whole file) | unlike 4 sibling files that all call `retranslate()` after mutating DOM |
| **C-21** | **High** | **NEW — same bug class as C-4** | `_HINGLISH_WORDS` still contains real English words ("hum", "aap") that force an entire English reply into Hindi | chatbot_i18n.py:55-61 | `"I hear a hum from the borewell motor"→"hi"`; bare `"Namaste"` (also a valid EN greeting) → full Hindi wall of text |
| **C-22** | **High** | **NEW — today's own fix is dead code** | The MSP-vs-market comparison handler added *today* (`1dd2bdd`) never executes — an earlier unconditional "plain MSP" branch intercepts first | chatbot.py:1196-1199 (blocks) vs 1221-1229 (new, unreachable) | `/mspvsmarket` and "msp vs market for rice" both return a raw JSON dump, not a comparison |
| **C-23** | **Critical** | **NEW — self-inflicted, unrecoverable in-product** | `STATE_SYNONYMS` is missing several states per language; Kannada is missing **Telangana** — the flagship demo region used in every language's own greeting/suggestion chips | chatbot_i18n.py:219-239 | KN user clicks the bot's own suggested chip ("recommend for Telangana Medak") → identical unresolved "which region?" reply with the identical chip again. **Infinite loop, self-triggered by the product's own UI.** |
| C-24 | Medium | NEW | The crop/grow/plant/sow gate added for C-14 is exact-word only, doesn't match "-ing" forms | chatbot.py:1207 | "suggestions for growing rice" dead-ends despite naming a real crop |
| C-25 | Medium | NEW | When no season is stated (the common case), weather is averaged across kharif+rabi even though the irrigation schedule is hardcoded to a kharif sowing date | chatbot.py:81-105 vs 726 | ~50% rainfall understatement for an implicitly-kharif schedule |
| C-26 | Low | NEW | Zero regression-test coverage for any of the 9 previously-fixed bugs | test_chatbot.py | 7 tests are all "reply is non-empty" smoke checks — exactly the kind of test that would have caught C-21/C-22 as regressions and didn't exist to do so |

## 4. Findings — Frontend Dashboard & State (`F-`)

*Scope: `dashboard.js` (3043 lines, read in full), `dashboard.html`, `mm-core.js`, `mm-enhance.js`, `mm-plots.js`, `farm-state.js`, `toolbar.js`, `india-globe.js`, `sw.js`.*

| ID | Severity | Status | Finding | file:line | Evidence |
|---|---|---|---|---|---|
| F-1 | High | FIXED | `api()` no longer folds real HTTP errors into the fake-offline fallback path | dashboard.js:143-197 | `HttpError` explicitly excluded from the offline branch |
| F-2 | High | FIXED | Switching farm plots now refreshes all dependent dashboard state | dashboard.js:2579-2625 | `mm:plot-changed` listener added, re-renders farm context |
| F-3 | Medium | FIXED | Farm bar now reacts to cross-tab storage events like the plot dropdown already did | mm-core.js:368-381 | listener mirrors the pre-existing one |
| F-4 | Medium | FIXED | Farm-state writes report persistence failure instead of always claiming success | farm-state.js:258-292 | `_writeStore()` returns a real `persisted` boolean, propagated up |
| F-5 | Medium | PARTIALLY-FIXED | Disease-log queue no longer silently deleted; still isn't synced anywhere (no backend endpoint exists to sync to) | dashboard.js:2804-2830 | capped at 50 entries instead of deleted; still just `console.log`s |
| F-6 | Medium | PARTIALLY-FIXED | Every tool now shows an honest offline message; computed offline fallback still limited to 2 of 22 tools | dashboard.js:179-244 | by-design scope limit, not a bug, but still a real gap vs. the product's offline-resilience positioning |
| F-7 | Low | STILL-PRESENT, WORSE | Tool-count comment now contradicts itself in 3 places in the same file (14 / 22 / 21) | dashboard.js:2,287,425 | true count verified against markup: **22** |
| F-8 | Low | STILL-PRESENT | 2 of ~22 DOM lookups still skip the null-guard every other binding uses | dashboard.js:2337,2418 | works today, would throw and silently break later wiring on a future rename |
| F-9 | Low | STILL-PRESENT | Escaping helper now used twice instead of once, but dozens of `innerHTML` sites still interpolate raw API text, including one raw `href` interpolation | dashboard.js:1466,1528,1836-1837,1968-1969 | `s.url` written straight into an `href` attribute |
| F-10 | Low | STILL-PRESENT | Disease-scan "Run scan" still isn't disabled during its own in-flight request | dashboard.js:2897-3040 | repeated clicks fire concurrent predict calls |
| F-11 | Low | STILL-PRESENT | Floating popovers still don't manage focus on open/close | toolbar.js:623-687 | no `.focus()`/`aria-modal`/`role="dialog"` anywhere |
| **F-12** | **Medium** | **NEW** | Spoken daily briefing's stop-toggle doesn't cover its own fetch window — a second click mid-load queues a duplicate instead of stopping | toolbar.js:943-976 | stop-guard only arms *after* `await composeBriefing()` resolves; two quick clicks can queue overlapping audio |
| F-13 | Low | NEW | Arbitrage globe silently renders zero arcs if a region falls outside its centroid table, without adjusting the "arcs = price gap" legend | india-globe.js:415-478 | currently dormant — today's centroid table happens to cover every region |
| F-14 | Low | NEW | Arbitrage globe's fetch error handling doesn't distinguish offline vs. server error, unlike the rest of the app | india-globe.js:419-426 | consistency gap, not an honesty violation — never fabricates numbers |

**New-feature scrutiny (commit `7b83908`, audited for the first time here):** the regional benchmark panel and mandi arbitrage globe both reuse real, existing endpoints, fail gracefully (remove the card / show a generic error rather than fabricate), and the spoken briefing correctly omits rather than invents figures when data is missing. No regressions found in shared files (`mm-core.js`, `mm-plots.js`, `toolbar.js`) — diffed changes were dead CSS removal only. F-12 is the one real bug this commit introduced.

## 5. Findings — Marketplace, Booking & Gyan Seva (`T-`)

*Scope: `marketplace.js/html`, `book-a-tractor.js/html`, `gyan-seva.js/html`, `auth.js`, `login.html`.*

| ID | Severity | Status | Finding | file:line | Evidence |
|---|---|---|---|---|---|
| T-1 | High | PARTIALLY-FIXED | Tractor `.availability` still never mutated after booking — no real exclusivity. A same-device date-conflict check was added, but checks a separate list, never touching the field the UI actually reads | book-a-tractor.js (whole file) | 17 reads of `.availability`, zero writes; code comment admits cross-device double-booking is unguarded |
| T-2 | High | PARTIALLY-FIXED | Auth stub still rejects every login (by design — no real auth backend exists), but the raw `"Auth removed"` string no longer reaches the user | auth.js:9-11 (unchanged), login.html:147-151 (fixed) | error now maps to "Sign-in isn't available in this build yet."; page still has no nav link, still SW-precached |
| T-3 | Medium | FIXED | Marketplace buyer-complete and seller-sale paths now share one inventory-decrement function | marketplace.js:1717-1738 | single `applySaleToListingQuantity()` used by both paths |
| T-4 | Medium | FIXED | Tractor booking date now has both HTML `min` and JS re-validation | book-a-tractor.js:1191-1300 | past dates rejected at both layers |
| T-5 | Medium | PARTIALLY-FIXED | "No live backend" disclosure is strong on Marketplace/Gyan Seva, materially weaker on Book-a-Tractor — hero says "Live Now," booking confirmation has no equivalent caveat | book-a-tractor.html:879 vs marketplace.js:963 | direct inconsistency between three sibling surfaces |
| T-6 | Low | FIXED | Consultant photos now render from locally-generated initials, not a raw field into `innerHTML` | gyan-seva.js:40-53 | old `.photo` field no longer read anywhere in the file |
| **T-7** | **Medium** | **NEW — concrete broken promise** | Tractor waitlist form promises "we'll send one SMS" after collecting a phone number — the number is validated, then discarded. Nothing is stored, nothing is sent | book-a-tractor.html:1136-1182 | `handleNotify()` has no `localStorage` write and no `fetch`/XHR anywhere — unlike every other disclosed local-only limitation, this data isn't even kept |

## 6. Findings — Data Ingestion, Deployment, Security, Tests (`D-`)

*Scope: `data_ingestion/**`, `vercel.json`, `requirements.txt`, `tests/**`, general security posture.*

| ID | Severity | Status | Finding | file:line | Evidence |
|---|---|---|---|---|---|
| D-1, D-2 | High | FIXED | `/marketplace` route and `ml/models/*.json` both now correctly present in `vercel.json` | vercel.json | confirmed |
| D-3 | Medium | PARTIALLY-FIXED | Soil Health Card fabrication (6/9 nutrients via unseeded random) unchanged, but now honestly disclosed in its own docstring instead of claiming real registry integration | soil_health_card.py:9-90 | still contained — only reachable via dead code (D-4) |
| D-4 | Medium | STILL-PRESENT | Entire ETL/feature-pipeline stack (10 files) remains fully disconnected — now explicitly labeled "NOT WIRED INTO PRODUCTION" in every file header rather than silently orphaned | data_ingestion/etl_pipeline.py etc. | zero references outside its own directory and tests |
| D-5 | Medium | PARTIALLY-FIXED | `/api/data-freshness` still can never report mandi "live" (root cause unchanged), but no longer silently misleads — explicitly always reports "seed" with a stated reason | provenance.py:131-163 | honest-by-construction fix, underlying gap unresolved |
| D-6 | Medium | FIXED | ETL field-name case-mismatch bug corrected (still only exercised in dead code) | etl_pipeline.py:142-157 | now matches the real API's capitalized keys |
| D-7 | Medium | FIXED | Disk cache now has TTL-based eviction | cache.py:36-142 | reviewed, no bugs found; itself untested (D-13) |
| D-8 | Medium | PARTIALLY-FIXED | Disease-predict endpoint now caps pixel dimensions (decompression-bomb fix); still fully unauthenticated with no rate limiting anywhere in the app | main.py:984-1080 | only size cap added, no auth/`Depends()`, no rate-limit library anywhere in the repo |
| D-9, D-10 | Medium | FIXED | `catboost`/`pandas` correctly isolated to dev-only requirements | requirements*.txt | confirmed via `pip show` |
| D-11 | Low | FIXED (re-confirmed) | Independent re-check found no new critical/exploitable security issues | main.py, repo-wide | CORS, secrets, injection, admin-gating all re-verified clean |
| D-12 | Medium | STILL-PRESENT | Test-coverage gap persists: zero direct tests for all 10 `data_ingestion/fetchers/*` files and the ML training/audit scripts | tests/ | 49/49 passing, but coverage shape unchanged from Pass 1 |
| D-13 | Low | NEW | The new disk-cache eviction logic (D-7's fix) itself has no test coverage | cache.py:102-142 vs test_cache.py | only hit/TTL/clear are tested, not sweep behavior |

**Test suite:** `venv/Scripts/python.exe -m pytest -q tests` → **49 passed, 0 failed, 6.04s.**

---

## 7. Prioritized Fix List

### P0 — Fix before anything else (small, surgical, demo-risk) — **ALL FIXED, see §8**

1. ~~**C-23**~~ **FIXED.** Missing states added to `STATE_SYNONYMS` for Telugu and Kannada (incl. Telangana). Bonus: a stray Telugu Unicode codepoint in Kannada's "recommend" intent pattern (visually identical, never matched) found and fixed while verifying the repro.
2. ~~**C-21**~~ **FIXED.** "hum"/"aap" removed, plus a full systematic re-audit removed "namaste"/"namaskar" (self-contradicted the bot's own English greeting) and "paani" (same Indian-English-loanword class as mandi/kisan).
3. ~~**C-22**~~ **FIXED.** Branch order consolidated; the MSP-vs-market comparison handler is reachable for both `/mspvsmarket` and natural comparison phrasing.
4. ~~**T-7**~~ **FIXED.** Waitlist phone number now persisted to `localStorage`; copy no longer promises an SMS mechanism that doesn't exist.
5. ~~**F-12**~~ **FIXED.** Stop-guard now arms synchronously before the async fetch, with a post-await staleness check and error-path reset.

### P1 — Real, worth doing given the runway — **5 of 6 code-fixed, 1 investigated (see §8)**

6. ~~**T-5**~~ **FIXED.** Book-a-Tractor's hero and booking-confirmation copy now disclose the no-live-backend reality, matching Marketplace/Gyan Seva. Bonus: two other instances of the same false "operator will be contacted automatically" promise found and fixed in the same flow.
7. ~~**T-1**~~ **PARTIALLY FIXED, deliberately scoped.** Booking now downgrades a tractor's badge to "Limited" (not "Booked", to avoid regressing the existing per-date conflict check). Honestly doesn't survive a page reload for the auto-generated fleet-data file, and cross-device double-booking remains architecturally open with no backend — both stated explicitly rather than overclaimed.
8. ~~**B-15**~~ **FIXED.** `/api/yield` now reports honest `algorithm`/`prediction_source` via the same low-level function its siblings already use.
9. **B-14** — **Investigated, not code-fixed (see §8).** The real lever may not be `vercel.json`'s `memory` field at all — flagged for the user to check the Vercel dashboard directly.
10. ~~**D-8**~~ **FIXED.** Dependency-free in-memory per-IP rate limit (15 req/60s) added ahead of the endpoint's exception handler.
11. ~~**C-14**~~ **FIXED.** Hindi सुझाव trigger now requires a nearby crop/grow/plant/sow word, mirroring the English gate.

### P2 — Worth doing if time allows

12. B-18 (yield CI is too wide to be useful), C-24/C-25 (chatbot matching edge cases), F-7 through F-11 (dashboard.js hygiene), C-18/C-19/C-20 (chatbot i18n polish), C-26 (regression tests for the 9 previously-fixed chatbot bugs — would have caught C-21/C-22 as regressions).

### P3 — Backlog, not judging-relevant

13. Dead ETL pipeline (D-4, already well-labeled), zero fetcher test coverage (D-12), dev-only artifacts bundled into production (B-16, B-17), arbitrage globe edge cases (F-13, F-14), disk-cache eviction test coverage (D-13).

---

---

## 8. Remediation — Pass 2 Fixes Applied

All P0 items and 5 of 6 P1 items were fixed same-day as this audit, verified, and merged. Full test suite: **62 passed, 0 failed** (baseline 49 → 52 after backend fixes → 62 after chatbot fixes; every increment added regression tests for the bug it fixed, directly addressing the C-26 finding that these bugs previously had zero coverage).

**Chatbot** (`backend/chatbot.py`, `engine/chatbot_i18n.py`, `tests/test_chatbot.py`) — C-23, C-21, C-22, C-14 fixed. Canonical region list pulled from `dataset/soil.csv` rather than assumed. 10 new tests added (`*_c23`, `*_c21`, `*_c22`, `*_c14` suffixes). Two bonus fixes found while verifying repros: a Kannada Unicode codepoint mismatch (U+0C41 Telugu vs. U+0CC1 Kannada vowel sign) that silently broke Kannada crop-recommendation matching, and a self-contradiction where "namaste"/"namaskar" forced Hindi-lock despite being the bot's own English greeting.

**Booking** (`frontend/book-a-tractor.html`, `frontend/book-a-tractor.js`) — T-7, T-5, T-1 fixed/addressed. T-1 deliberately scoped to avoid a regression (badge downgrades to "Limited," not "Booked," so the existing per-date conflict check isn't defeated); doesn't survive reload for auto-generated fleet data, cross-device booking remains open by architecture (no backend). While fixing T-5's disclosure gap, two more instances of the same false "operator will be contacted automatically" promise were found and fixed in the same confirmation flow.

**Toolbar** (`frontend/toolbar.js`) — F-12 fixed. Guard now arms synchronously before the async fetch; verified against single-click, double-click-during-fetch, and error-mid-flow scenarios by code trace (no JS test runner in this project).

**Backend** (`backend/main.py`, `tests/test_disease_api.py`, `tests/test_safety_guards.py`) — B-15 and D-8 fixed with new tests. B-14 investigated rather than blindly patched: `vercel.json`'s `memory: 1024` field may be entirely unenforced under Vercel's Fluid Compute (default for new projects since April 2025, dashboard-controlled, typical default tier 2GB); the actual constraint worth watching is the platform's 500MB Python bundle-size cap, estimated at ~340-350MB today with scipy/scikit-learn alone accounting for over half the headroom. **Action needed from you:** check Project Settings → Functions in the Vercel dashboard to confirm which regime is active before deciding whether `vercel.json`'s memory value needs touching.

**Design-lint housekeeping:** two pre-existing bounce-easing CSS values in `book-a-tractor.html` (predating this session by 6+ weeks) recorded as sanctioned exceptions in `.impeccable/config.json`, following this repo's own established precedent (commit `f048405`). A separate, larger batch (73 pre-existing font-size/color deviations in the same file, also predating this session) was left standing rather than bulk-ignored or fixed — flagged to the user as a real design-debt question rather than a mechanical exception, decision pending.

---

*End of Pass 2. All P0 items and 5 of 6 P1 items are fixed and merged as of this remediation pass. Remaining open item: B-14 needs a Vercel-dashboard check from the user, not more code. This clears the runway for the two planned feature builds (guided decision flow, voice-first interaction).*
