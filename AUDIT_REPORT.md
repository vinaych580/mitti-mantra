# Independent Code Audit — Mitti Mantra / AgriSim

**Scope:** full repository (~30,700 lines of frontend JS, ~9,800 lines of backend/ML Python) — FastAPI backend, vanilla-JS multi-page frontend, sklearn ML pipeline, data-ingestion layer, intent-based chatbot with i18n.
**Method:** seven parallel deep-read audits (not grep-sampling) tracing real request/response/state flows, cross-checked against actual running code — several ML/chatbot findings were empirically reproduced by executing the real functions against the real dataset and models, not inferred from reading alone. The full test suite was run (49/49 passing).
**Posture:** the codebase was treated as untrusted regardless of comments, docstrings, or architecture-doc claims. Every claim below was checked against the code that actually runs.

---

## 1. Executive Summary

This is a substantially more honest codebase than the marketing-flavored commit history ("real fleet diversity", "AI pre-screening", "verified outcomes") suggests — most large feature areas (tractor booking, marketplace, Gyan Seva consultations, offline mode, synthetic NDVI) **disclose their own limitations in-code and in-UI**. That said, the audit surfaced three **critical, empirically-confirmed defects in the ML/chatbot core** that undermine the product's central value proposition, plus a cluster of high-severity bugs in state management, deployment configuration, and input handling.

**The three critical findings, in one sentence each:**

1. The crop-recommendation ML model **structurally never predicts rice, wheat, maize, cotton, soybean, sugarcane, potato, or tomato** — 20 of 32 crops are absent from its training labels, confirmed by loading the deployed model and inspecting `.classes_` (12 crops only). Every recommendation call for a staple crop is permanently handicapped by 15% of its smart-score for reasons that have nothing to do with soil or climate fit.
2. The chatbot's language auto-detection treats the platform's own English vocabulary word **"mandi"** as a Hindi trigger, and once triggered the session is **permanently locked into Hindi** — confirmed by executing `detect_lang()` and `answer()` against real messages, including the bot's own suggestion chips.
3. `/api/ml/status`, the public endpoint meant to report deployed-model quality, serves metrics from a **different model with a different algorithm** (CatBoost, from an unwired evaluation script) than what is actually loaded and serving predictions (RandomForest) — and the audit pipeline behind those numbers has **83.6% train/test leakage**, empirically measured by re-deriving both splits and hashing row overlap.

Beyond the ML core, high-severity issues include: a broken `/marketplace` route in the actual Vercel deployment (works locally, 404s in production), a frontend error handler that silently converts real backend validation errors into a fabricated "you're offline" message, a tractor-booking flow that never actually blocks double-booking, and 4 of 12 documented chatbot slash-commands that are dead on arrival. None of these are hypothetical — each was reproduced or directly evidenced in code.

**No critical security vulnerabilities** were found (no auth bypass, no injection, no exposed secrets, sensible CORS, admin-gated training/expense endpoints fail closed). Security findings are real but Medium/Low (an unauthenticated image-decoding endpoint with no dimension cap, inconsistent client-input trust between `crop_id` and `region_id/season` in the chatbot, an XSS-consistency gap on one static field).

**Test suite:** 49/49 tests pass, but coverage is concentrated almost entirely in the user-facing request path; roughly **57–60% of backend/engine/ML/data-ingestion modules have zero direct test coverage**, concentrated in the data-ingestion/fetcher layer and the ML training/audit scripts — which is exactly where two of the three critical findings live.

---

## 2. Architecture Assessment

The documented architecture (`docs/ARCHITECTURE.md`) is mostly accurate to the code — single FastAPI process, mtime-based CSV cache, three lazily-loaded sklearn models with heuristic fallbacks, intent-based (non-LLM) chatbot, zero-build vanilla-JS frontend, service-worker PWA shell. Verified true. Where it diverges from reality:

- **The ML "heuristic fallback" safety net is not as protective as documented.** The architecture doc frames `prediction_source` as an honest signal of ML-vs-heuristic provenance. In practice (§ Finding E-4) it reflects whether a model *object* is loaded in the process, not whether that specific prediction actually used it — so a caller cannot trust the field for what it's documented to mean.
- **A second, substantial subsystem — the entire `data_ingestion/etl_pipeline.py` / `feature_pipeline.py` stack and 7 of 10 fetchers — is dead code**, disconnected from every production request path and from the actual training pipeline (`ml/train_models.py` reads CSVs directly and never touches this pipeline's output). This isn't documented as deprecated anywhere; a maintainer would reasonably assume it's live.
- **Two independent, disagreeing "audit trails" exist for ML model quality** (`ml/evaluate_models.py`/`audit_models.py` vs. `ml/train_models.py`), and the public status endpoint reads from the wrong one (Finding E-2).
- **The frontend's "zero build" philosophy is real and consistently applied**, but it has a real cost: no shared error-handling layer, no shared HTML-escaping discipline (some files rigorously escape, others don't), and a 2,778-line "god file" (`dashboard.js`) with duplicated per-tool wiring patterns that have already begun to drift (4 of ~20 forms null-guard their DOM lookup, the rest don't).
- **State persistence is client-only (localStorage) for every major transactional feature** — tractor bookings, marketplace listings, consultation bookings. This is disclosed in-UI for most of these, but it means "Marketplace" and "Book a Tractor" are not yet multi-party systems; they're same-device simulations of one, which is the single most consequential fact for anyone evaluating those features as complete.

---

## 3. Complete Findings List (ranked by severity)

Severity legend: **Critical** (breaks a core value proposition or causes silent data/financial corruption) · **High** (broken user-facing flow, or a defect a user will hit in normal use) · **Medium** (real but narrower-impact defect) · **Low** (cosmetic, hygiene, or narrow-condition defect). Confidence is CONFIRMED (reproduced or read to certainty) unless marked POTENTIAL.

### CRITICAL

| # | Area | Finding |
|---|---|---|
| **C-1** | ML | Crop-recommendation model never predicts 20/32 crops incl. rice/wheat/maize/cotton/soybean/sugarcane — `ml/train_models.py:444-517`, `ml/predict.py:796-807`. **Empirically confirmed** by loading `recommend_model.joblib` and inspecting `.classes_` (only 12 crops present). |
| **C-2** | ML / API | `/api/ml/status` reports quality metrics for a different, unwired model (CatBoost) than the one actually loaded and serving (RandomForest) — `backend/main.py:672-705,678`. **Confirmed** via file mtimes and direct joblib loading. |
| **C-3** | ML | `ml/evaluate_models.py`/`audit_models.py`'s "test" data is 83.6% identical (by row hash) to the currently-deployed model's own training data — train/test leakage inflates every reported R²/accuracy figure. **Empirically confirmed** by reconstructing both splits. |
| **C-4** | Chatbot | `detect_lang()` treats the English word **"mandi"** — the platform's own vocabulary — as a Hindi trigger; once triggered, `context.lang` is sticky for the rest of the session, permanently flipping an English conversation to Hindi. `engine/chatbot_i18n.py:45-65`, `backend/chatbot.py:794,800`. **Empirically confirmed** by executing `detect_lang()`/`answer()`. |

### HIGH

| # | Area | Finding |
|---|---|---|
| **H-1** | Deployment | `/marketplace` route works locally but 404s on the actual Vercel deployment — missing from `vercel.json` rewrites while 6 sibling routes are present. `backend/main.py:1551-1553` vs `vercel.json`. |
| **H-2** | Deployment | `ml/models/*.json` (audit/manifest metadata) is not included in `vercel.json`'s `includeFiles` glob — provenance/ML-status endpoints silently degrade to generic fallback values in production with no visible signal. |
| **H-3** | Frontend/API contract | `dashboard.js`'s central `api()` wrapper catches HTTP error responses (400/422/500) in the *same* catch block as network failures, and for `/api/simulate` and `/api/crop` **silently replaces real backend errors with fabricated offline-heuristic numbers**, showing a "backend unreachable" banner that is false. `frontend/dashboard.js:139-179`. |
| **H-4** | Frontend/State | Switching the active farm plot mid-session leaves `dashboard.js` reading stale soil/region data — no listener for the `mm:plot-changed` event that the plot-picker itself dispatches — silently feeding wrong data into Simulate/Compare/Mix and the disease-scan region sync. `frontend/dashboard.js:14-24, 2266-2454`. |
| **H-5** | Chatbot | Generic English words ("north", "west") in a message silently resolve to an unrelated specific region (`goa_north`, `tripura_west`) via a district-suffix fallback match, returning confident, real-looking dataset numbers bound to the wrong place with no disclosure. `backend/chatbot.py:111-130`. **Confirmed** by execution. |
| **H-6** | Chatbot | 4 of 12 documented slash-commands (`/pest`, `/irrigate`, `/calendar`, `/sell`) are dead on arrival — their handlers are gated on a crop being extracted with no "missing crop" fallback branch, so they fall through to the generic "I didn't catch that" message, which itself recommends trying `/pest`. `backend/chatbot.py:718-731, 855-875`. **Confirmed** by execution. |
| **H-7** | Chatbot | Budget/area/cost/profit are extracted from free text purely by **position**, with no unit/keyword disambiguation — reordering a sentence naturally ("3 acres and 15000 budget" vs "15000 budget for 3 acres") silently swaps the values, producing outputs like "profit ₹882,457,500, ROI 1,961,016.67%" with no sanity check anywhere. `backend/chatbot.py:144-154, 340-353`. **Confirmed** by execution, exact reproduction included in source report. |
| **H-8** | Frontend/Booking | Tractor booking never actually enforces exclusivity — `t.availability` is read in 8 places to gate the UI but never mutated after a successful booking; the same tractor/date can be booked indefinitely. `frontend/book-a-tractor.js` (booking-save block, no write-site for `.availability` in the whole file). |
| **H-9** | Frontend/Auth | `login.html` is a fully-built sign-in UI wired to a **stub** `auth.js` (`Promise.reject(new Error('Auth removed'))`) with no matching entry in the error-message map — every login attempt displays the raw string **"Auth removed"** to the user. `frontend/auth.js`, `frontend/login.html:135-146`. Page is unreferenced from nav but still service-worker precached and reachable by URL. |
| **H-10** | Dependencies | Installed `numpy==2.5.1` violates the project's own `requirements.txt` pin (`&lt;2.5`); a clean install from the lockfile would not reproduce the environment the tests actually ran against, and 2,618 numpy/joblib `DeprecationWarning`s already fire during chatbot tests as a symptom. |
| **H-11** | ML | `prediction_source: "ml_model"` reflects whether a model *object* is loaded in the process, not whether ML was actually used for that specific prediction — `predict_yield_kg_per_acre` silently falls back to a heuristic on any unseen label, but the source tag doesn't follow. `ml/predict.py:809-819`. Contrast with the correct pattern already used in `engine/features.py:802-848`. |

### MEDIUM

| # | Area | Finding |
|---|---|---|
| **M-1** | API | `GET /api/crop-comparison/{region}/{season}` accepts negative/zero `budget_per_acre`/`area_acres` with no validation, unlike its `POST /api/recommend` sibling. `backend/main.py:245-251`. |
| **M-2** | API | Four fully-defined Pydantic query models (`CropRecQuery`, `YieldPredQuery`, `IrrigationQuery`, `FertilizerQuery`) are never wired to their endpoints — hand-rolled duplicate validation exists instead and has already drifted (fertilizer accepts negative-only, no upper bound). `backend/models.py:185-214` vs `backend/main.py:1243-1411`. |
| **M-3** | API/Docs | `/api/field/ndvi`'s docstring claims real Sentinel-2 satellite data; the implementation is a deterministic hash of lat/lon with no external call (the JSON payload itself is honest — `is_estimate: true` — but the docstring/Swagger surface is not). `backend/main.py:292-303` vs `utils/calculations.py:180-245`. |
| **M-4** | Data layer | CSV cache's mtime-capture happens outside the lock while the file re-read also happens outside the lock — a concurrent CSV rewrite during live traffic can transiently serve/store a stale row-set despite the module's "thread-safe" docstring claim. `utils/csv_cache.py:40-65`. Self-corrects on the next call; real but narrow. |
| **M-5** | Security | `/api/disease/predict` is unauthenticated and caps `image_b64` only by string length (~7.3MB decoded), not pixel dimensions — a compressed high-resolution image is a classic decompression-bomb / CPU-exhaustion vector against a 1024MB serverless function with no rate limiting anywhere in the app. `backend/main.py:941-1199`. |
| **M-6** | Frontend/State | Cross-tab sync is inconsistent: the plot-name dropdown listens for the `storage` event, but the adjacent farm-bar (region/season/budget fields, `mm-core.js`) does not — two open tabs disagree about the active farm's settings after a plot switch in one of them. |
| **M-7** | Frontend/State | `FarmState._writeStore()` swallows `localStorage.setItem` quota-exceeded failures and still dispatches a "changed" event and shows a success toast — a farmer can be told a boundary was saved when it silently wasn't. `frontend/farm-state.js:258-280`. |
| **M-8** | Frontend | Disease-scan's `syncOfflineLogs()` doesn't sync anything to any backend (only `console.log`s) and then **unconditionally deletes** the local queue the moment the device is next online — collected scan history is guaranteed to be discarded with no record kept anywhere. `frontend/dashboard.js:2554-2565`. |
| **M-9** | Frontend | Only 2 of ~20 dashboard tools (`/api/simulate`, `/api/crop`) have any offline/graceful-failure path; the other 18 surface a raw "Failed to fetch"-style error to the user, in an app whose stated differentiator is rural/offline resilience. |
| **M-10** | Frontend/Booking | Buyer-side "simulate complete" purchase lifecycle in the marketplace never decrements `listing.quantityAvailable`, while the seller-side "Record a Sale"/"Mark Sold" actions on the same listing do — the two pathways maintain inconsistent inventory state for the same listing. `frontend/marketplace.js:1732-1889`. |
| **M-11** | Booking | Tractor booking date field has no `min` attribute — a booking can be placed for a date in the past and is accepted with a normal success screen. `frontend/book-a-tractor.js:1081`. |
| **M-12** | Product framing | All transactional state (bookings, listings, consultation requests) lives only in per-device `localStorage`, with no shared backend — mostly disclosed in-UI, but is the single most consequential architectural fact for evaluating "Marketplace"/"Book a Tractor"/"Gyan Seva" as complete, multi-party products. |
| **M-13** | Chatbot | `context.region_id` and `context.season`, sent by the client and round-tripped via `localStorage`, are **not validated** server-side before reaching engine calls — unlike `context.crop_id`, which is checked against the real crop table first. A forged/stale value surfaces a raw internal `ValueError` string in the chat reply rather than a clean prompt. `backend/chatbot.py:829-837`. |
| **M-14** | Chatbot | The recommend-intent's bare "suggest(ion)" trigger fires on unrelated questions ("any suggestion for pest control on rice" gets routed to "which region?" instead of pest info). `backend/chatbot.py:850`. |
| **M-15** | Chatbot | Short greeting-word check doesn't require the greeting to be the whole message — "hey what is msp" returns only a canned greeting, dropping the real question. `backend/chatbot.py:808-814`. |
| **M-16** | Chatbot | Common real crop synonyms ("paddy", "basmati") aren't recognized despite being literally in the crop's own display name — combined with H-6's missing-crop fallback gaps, this produces dead-end fallback replies for very ordinary phrasing. `backend/chatbot.py:93-108`. |
| **M-17** | Chatbot | Pest-alert and irrigation-schedule chatbot replies ignore the region the user just supplied and always use fixed generic weather assumptions (28°C, 800mm) — climatically opposite regions get byte-identical advice. `backend/chatbot.py:459-463, 507-511`. |
| **M-18** | Engine | `calculate_disease_outbreak_risk` accepts `crop_id`/`region_id` parameters but never uses them in its computation — identical late-blight/rust/whitefly risk output for every crop regardless of relevance. `engine/features.py:852-913`. |
| **M-19** | Engine | Seasonal rainfall (mm) is divided by an unexplained constant (12) and used as a relative-humidity (%) proxy when `humidity_pct` isn't supplied — a unit conversion with no physical basis. `engine/features.py:861-863`. |
| **M-20** | ML | Audit/evaluation manifest JSON files are stale relative to the currently-loaded models (7.5 hours older than the last successful retrain) and nothing invalidates or re-derives them — compounds C-2/C-3. |
| **M-21** | Data ingestion | `SoilHealthCardClient.retrieve_card` fabricates 6 of 9 nutrient values via unseeded `random.random()` while its docstring claims integration with state registries — contained today because the whole pipeline is orphaned (see H/M dead-code findings below), but would be a serious data-integrity issue if ever wired live. `data_ingestion/fetchers/soil_health_card.py:29-44`. |
| **M-22** | Data ingestion | The entire ETL/feature-pipeline stack (`etl_pipeline.py`, `feature_pipeline.py`, `prepare_data.py`, `refresh_data.py`, 7 of 10 fetchers) is disconnected dead code — nothing in the live request path or in `ml/train_models.py` imports or reads its output; no cron/CI wires it in either. |
| **M-23** | Data ingestion | `/api/data-freshness` can never report mandi prices as "live" — the function that records a live-fetch timestamp (`get_mandi_price`) has no caller anywhere in the live app (all real lookups bypass it via the CSV cache), so the freshness badge is permanently stuck on "seed / not queried yet" regardless of configuration. `data_ingestion/fetchers/mandi.py:117-143`, `utils/provenance.py:131-163`. |
| **M-24** | Data ingestion | `etl_pipeline.clean_and_normalize()` looks up lowercase JSON field names (`"district"`, `"modal_price"`) against an API that actually returns capitalized keys (confirmed elsewhere in the same codebase, `mandi.py:102` uses `"Modal_Price"`) — the match is always empty and price silently falls back to a hardcoded ₹24.50/kg constant. Contained by M-22 today; a real bug if revived. |
| **M-25** | Data ingestion | `data_ingestion/cache.py`'s disk cache has no eviction — one file per unique call signature, forever, only cleared by an explicit (and itself-unreachable) admin script. |
| **M-26** | Deployment | `catboost` is imported by `ml/evaluate_models.py` but entirely absent from `requirements.txt` — a clean install followed by running that (documented dev-workflow) script fails with `ModuleNotFoundError`; currently masked only because the local venv happens to have it installed already. |
| **M-27** | Deployment | `pandas` ships into the production Vercel bundle via `requirements.txt` but is never imported by any code on the live request path (only by scripts already excluded via `.vercelignore` or never invoked) — pure deployment bloat given the ML endpoints are already memory-sensitive (see M-28). |
| **M-28** | Deployment (POTENTIAL) | `vercel.json`'s `memory: 1024`MB is plausibly tight for the first cold-start request that must import numpy/pandas/sklearn/Pillow **and** deserialize ~60MB of joblib model files simultaneously; not verified by an actual deploy, flagged as a capacity risk backed by concrete file sizes. |

### LOW

A representative selection (full detail in the per-area agent reports, condensed here to avoid repetition):

- **API:** in-memory route cache treats falsy results (e.g. an empty recommendation list) as a cache miss and recomputes every time (`if cached:` should be `if cached is not None:`); Swagger/OpenAPI docs are publicly reachable with no `docs_url=None`; `/api/ml/status` discloses internal file-layout details to unauthenticated callers; a blanket `except Exception → HTTPException(400, str(e))` pattern collapses genuinely different failure classes (bad input vs. server bug) into the same status code across nearly every route; usage-collection event-name cardinality is technically unbounded (requires an explicit opt-in, off by default).
- **Frontend:** `dashboard.js`'s own header comment says "14 tools," actual count is ~20 (stale docs, not a bug); inconsistent null-guarding on DOM lookups across ~20 form bindings (works today, brittle to future edits); dozens of `innerHTML` sites interpolate API-sourced text without the escaping helper that's already used in exactly one place elsewhere in the same file; disease-scan's "Run scan" button isn't disabled during the in-flight request, allowing duplicate concurrent submissions; committed `firebase-config.js` contains real (but non-secret-by-design) project identifiers for a completely dead auth feature; floating toolbar/freshness popovers don't manage focus on open/close (keyboard-reachable, just not guided); offline simulator's crop catalogue is missing 3 crops (`jowar`, `potato`, `onion`) that the dashboard itself offers, producing an unhandled "unknown crop" error if a network hiccup hits one of them; Gyan Seva has one inconsistent unescaped `innerHTML` interpolation (`e.photo`) against an otherwise-careful codebase, not currently exploitable (static seed data only).
- **ML/Engine:** synthetic-NDVI is honestly disclosed in its own response payload (not a bug, noted for completeness); the platform's `loan_calculator` DSCR formula is conceptually loose relative to a textbook debt-service-coverage ratio (not proven wrong, worth a second look); yield-model feature importances are dominated by a season-category encoding far more than crop identity or literal base yield (POTENTIAL — may just indicate legitimate collinearity, flagged for a permutation-importance follow-up, not confirmed as a defect).
- **Chatbot/i18n:** the chatbot's own first-open greeting is hardcoded English client-side and never reads the site's selected language, so a user who has switched the whole site to Hindi/Telugu/Kannada still gets an English greeting and English suggestion chips on first open; five chatbot-panel UI strings (header subtitle, drag hint, TTS button label, etc.) are absent from the i18n catalog; dynamically-injected chat DOM content is never passed through the app's own `retranslate()` helper (mostly moot since replies are already localized server-side); concurrent sends are correctly mutex-guarded but the dropped second message gives the user no feedback that it was ignored.
- **Data ingestion:** `data_ingestion/cache.py`'s disk read/write paths swallow all exceptions silently with no logging, hiding a persistent permissions/disk-full failure from any operator; zero test coverage exists for any of the 10 fetcher modules or the ETL/clean-and-normalize logic — exactly the layer where M-21/M-24 live undetected.
- **Deployment:** 528MB of unused `torch`/`torchvision` sitting in the dev venv (not shipped, but a sign the venv wasn't built cleanly from `requirements.txt`, undermining confidence that "installed" matches "declared" — see H-10); `docs/API.md` omits documentation for 7 of the newest, most heavily-tested endpoints (`/api/disease/predict`, `/api/farm-score`, `/api/field/ndvi`, `/api/climate/alerts`, `/api/carbon-credits`, `/api/iot/telemetry`, `/api/iot/pump-trigger`); `scripts/gen-firebase-config.js` documents itself as a Vercel build step that never actually runs (no `package.json`/`buildCommand` wires it in) — misleading to a future contributor, not a functional defect since the config file it would generate is hand-maintained instead.

---

## 4. UI/UX Findings

- **H-3** — the offline-mode banner lies about *why* the app fell back to heuristics; a validation error is not "backend unreachable," and showing the wrong message actively misdirects debugging and user trust.
- **H-4 / M-6** — plot-switching and cross-tab state produce silently stale UI (wrong soil/region shown in the farm banner, map, and disease-scan context) with zero user-visible indication that anything is wrong.
- **M-7** — a save can silently fail (quota exceeded) while the UI still shows a success toast — the worst kind of UX bug because it actively tells the user the opposite of what happened.
- **M-9** — 18 of ~20 dashboard tools show a raw technical error string on any network hiccup, inconsistent with the product's stated rural/offline-resilience positioning; only 2 tools have a considered fallback.
- **H-9** — a fully-built, professional-looking login form that always fails and displays the literal internal string "Auth removed" is the kind of broken flow that would immediately read as unfinished/buggy to any user who finds it, even though it isn't linked from navigation.
- **M-11** — booking a tractor for a date in the past succeeds with a normal-looking confirmation screen; a small but real trust-eroding data-integrity gap in a transactional flow.
- Chatbot UX (M-14, M-15, M-16, H-6, H-7): the cumulative effect of these findings is that a first-time user typing natural, unremarkable phrasing ("hey what is msp", "any suggestion for pest control", "/pest", "paddy") has a meaningfully worse-than-expected chance of hitting a dead-end or a wrong answer, despite the bot's design being fundamentally sound (grounded in real engine data, no hallucination once an intent correctly routes).
- Accessibility: interactive custom elements (toolbar FAB, chat panel, popovers) use real buttons with `aria-expanded`/`aria-label` — a genuinely better baseline than "div soup" — but none of them manage focus on open/close, a specific, fixable gap rather than a systemic accessibility failure.

---

## 5. Backend/API Findings

See **H-1, H-2, H-10, H-11, M-1 through M-5, M-20, M-26 through M-28**, and the Low-severity API items in §3. Summary: input validation is *inconsistent* rather than *absent* — the codebase clearly knows the right pattern (`RecommendationRequest`, `ProfitEstRequest`, the crop-id validation in the chatbot) and simply didn't apply it uniformly to every sibling endpoint. The admin/training/expense-storage gating is genuinely well-built (fails closed, `secrets.compare_digest`, explicit 503 rather than silent unscoped writes) and should be held up as the pattern the rest of the codebase should match, not an area needing rework.

---

## 6. Database/Data-Integrity Findings

There is no database — the "source of truth" is CSV files behind `utils/csv_cache.py`, a deliberate MVP choice documented and largely sound (M-4 is its only real defect, and it's narrow/self-correcting). The actual data-integrity risks are elsewhere:

- **C-1, C-2, C-3** — the ML artifacts themselves are the "data" that's corrupted/misrepresented here, and it's the most serious integrity problem in the whole system.
- **M-21, M-24** — the (currently dead) data-ingestion pipeline would silently fabricate or mis-parse real-world agricultural data if it were ever wired back into the live app; flag this explicitly before anyone does that reconnection work.
- **M-10** — the marketplace's two inventory-mutation pathways (buyer-lifecycle vs. seller-report) disagree about the same number, a genuine "two writers, no reconciliation" data-integrity pattern, currently low-stakes only because both live in the same localStorage blob rather than a shared store.

---

## 7. Security Findings

No critical/exploitable vulnerabilities found. Specifically verified and ruled out: no auth bypass, no SQL/command injection (no SQL, no `eval`/`exec`/`subprocess`/`pickle` on any user-reachable path), no `allow_origins=["*"]` + credentials CORS misconfiguration, no secrets committed to git, no path-disclosure/stack-trace leakage in exception responses, no `.env` tracked, admin-gated endpoints fail closed. Real findings, all Medium or below:

- **M-5** — unauthenticated, unbounded-pixel-dimension image decoding (`/api/disease/predict`) is a legitimate CPU/memory-exhaustion vector against an unthrottled endpoint; the only genuinely actionable security finding in the audit.
- **M-13** — inconsistent trust of client-supplied chatbot context (`crop_id` validated, `region_id`/`season` not) is not exploitable beyond surfacing an internal error string, but is worth fixing for consistency and to stop leaking raw `ValueError` text to end users.
- **Low** — Swagger UI/OpenAPI publicly reachable (recon-surface only, all sensitive routes remain properly gated behind it); `/api/ml/status` discloses internal directory layout to anonymous callers (low-impact info disclosure).
- One inconsistently-unescaped `innerHTML` interpolation in `gyan-seva.js` (static seed data today, would become exploitable the moment that field becomes user- or backend-editable) and a broader pattern in `dashboard.js` of API-sourced text reaching `innerHTML` without the escaping helper that exists and is used exactly once elsewhere in the same file — not proven exploitable today (no current backend endpoint echoes attacker-controlled text into a response), but there is no systemic escaping discipline standing between the app and the next backend change that does.

---

## 8. Concurrency/Reliability Findings

- **M-4** — CSV cache mtime-check-then-read race (narrow, self-correcting, but the "thread-safe" docstring overclaims).
- **M-7** — unhandled `localStorage` quota exceptions cause silent data loss.
- **Low** — disease-scan "Run scan" has no in-flight guard, allowing duplicate concurrent submissions where the later response silently wins.
- **Low (confirmed clean)** — the chatbot frontend's concurrent-send handling is actually correct (mutex-guarded, no stale-response-overwrite bug), a case where the audit's hypothesis was disproven by reading the code — noted so it isn't mistakenly re-flagged elsewhere.
- **M-25** — unbounded disk-cache growth in the (currently dead) data-ingestion layer.

---

## 9. Performance Findings

- **M-27, M-28** — unused `pandas` in the production bundle and a plausible (unverified) memory-pressure risk from ~60MB of joblib models plus a full numpy/pandas/sklearn/Pillow import stack on cold start, against a 1024MB serverless cap.
- **M-9** — not a performance defect per se, but the near-total absence of graceful-degradation paths means any latency/network hiccup reads to the user as a hard failure rather than a soft one, which matters more in this app's stated rural/low-connectivity target context than in a typical web app.
- No N+1 query problems (no database), no unindexed-scan issues found — the CSV-index-by-region pattern in `utils/csv_cache.py` is a reasonable, correctly-applied O(1)-after-first-access design.

---

## 10. Testing Gaps

- Full suite run: **49/49 passing**, no errors. Test *quality* varies meaningfully by file — `test_disease_api.py`, `test_ml_predict.py`, `test_optimal_mix.py`, and `test_safety_guards.py` are genuinely strong (real assertions on computed values, deliberate edge-case/regression coverage, honest-failure-mode testing). `test_chatbot.py` and parts of `test_engine_features.py` are shallow (existence/non-null checks rather than content verification) — notably, **none of the chatbot tests would have caught C-4, H-5, H-6, or H-7**, all of which were found only by actually executing realistic user phrasing against the live function.
- **Coverage gap, concretely:** of ~46 non-`__init__` modules, roughly 26–28 (57–60%) have zero direct test coverage — concentrated almost entirely in `data_ingestion/fetchers/*` (all 10 files, 0 tests) and the ML training/audit scripts (`train_models.py`, `evaluate_models.py`, `audit_models.py` — exactly where C-1, C-2, and C-3 live). This is not a coincidence: the two areas with the least test coverage are the two areas with the most serious confirmed defects.
- `backend/routers/data.py`'s CRUD-style read endpoints (`/api/crops`, `/api/regions`, `/api/soil/{id}`, etc.) have no test coverage at all beyond the satellite endpoint in the same file.
- `utils/provenance.py` (powers `/api/data-freshness`) and `utils/usage_store.py` (powers 3 `/api/usage/*` endpoints) are entirely untested — the M-23 defect (mandi "live" status permanently unreachable) would have been caught by a single integration test asserting the freshness endpoint's mode field under a realistic scenario.

**Recommended new tests, prioritized:**
1. `assert set(all_crop_ids) &lt;= set(recommend_model.classes_ via label encoder)` — a CI gate that would have caught C-1 outright and prevent regression.
2. A leakage-detection test: zero row-hash overlap between whatever `audit_models.py` calls "test" and the actual training rows used by the currently-saved model (catches C-3).
3. `detect_lang()` parametrized over every English string in the app's own suggestion chips/help text, asserting `"en"` (catches C-4).
4. Table-driven test running every `_SLASH_ALIASES` entry bare through `answer()`, asserting the reply isn't the generic fallback (catches H-6).
5. An integration test hitting `/api/ml/status` and asserting the reported algorithm/accuracy matches `type(loaded_model).__name__` and the on-disk model's own hash/mtime (catches C-2).
6. A mocked-`fetch` test asserting a 400/422 response from `/api/simulate` triggers the real error path, not the offline-fallback path (catches H-3).

---

## 11. Architecture/Maintainability Issues

- **Two disagreeing sources of truth for ML model quality** (train_models.py's manifest vs. evaluate_models.py's manifest) is the kind of divergence that will keep re-manifesting as new bugs every time either script is touched independently — they should be unified into one pipeline before anything else is built on top of `/api/ml/status`.
- **`dashboard.js` at 2,778 lines** is already showing early signs of the maintenance cost of a "no bundler, no framework" choice: inconsistent null-guarding, duplicated per-tool boilerplate, and only 2 of ~20 tools sharing a common error-handling path. The zero-build philosophy is a reasonable tradeoff for this project's constraints, but the file would benefit from extracting a shared "tool wiring" helper (bind form → call `api()` → render `output` → handle error) that all ~20 tools go through identically, which would also make H-3/M-9 trivial to fix once, everywhere.
- **Orphaned subsystems left in the tree with no deprecation marker** (the entire `data_ingestion/etl_pipeline.py` stack, `login.html`/`auth.js`, `scripts/gen-firebase-config.js`) are a real cost to a future maintainer or auditor who has to independently rediscover that they're dead, exactly as this audit had to. Recommend either deleting them or adding an explicit `# DEPRECATED / not wired into production` marker at the top of each.
- **`requirements.txt` doesn't match the actual dev environment** (H-10, M-26) undermines the basic guarantee that a fresh `pip install -r requirements.txt` reproduces what's running — worth fixing before it causes a harder-to-diagnose production incident.

---

## 12. Features That Are Incomplete or Improperly Implemented

- **Crop recommendation ML** (C-1) — the flagship "smart" feature is structurally biased against staple crops; effectively improperly implemented despite looking complete end-to-end.
- **ML status/audit reporting** (C-2, C-3, M-20) — the entire "here's how good our model is" surface is unreliable.
- **Chatbot language handling** (C-4, M-14 through M-17) — multilingual support, a headline feature, has a session-breaking auto-detection bug plus several intent-routing gaps that make it materially less reliable than the "grounded, no-hallucination" framing implies.
- **Tractor booking exclusivity** (H-8) — the booking flow doesn't book anything in the sense of reserving a resource; it only logs a request.
- **Marketplace inventory tracking** (M-10) — the two halves of the buy/sell lifecycle don't agree on stock levels.
- **Disease-scan offline sync** (M-8) — a feature that visibly presents itself as "syncing" data actually only logs and discards it; effectively a fake feature.
- **Login/auth** (H-9) — present in the UI, entirely non-functional under the hood; should either be finished or removed.
- **Data-ingestion pipeline** (M-21 through M-25) — an entire, sizeable subsystem (10 fetchers, ETL, feature pipeline) that appears designed to be the platform's "real data" layer is disconnected and, where checked, contains its own bugs (fabricated nutrient data, wrong field-name lookups) that would surface immediately if it were ever reconnected.

---

## 13. Prioritized Fix List

### P0 — Critical / release blockers
1. **C-1** — Fix the crop-recommendation training label generation so all 32 crops can appear (multi-label/ranked targets or per-crop profit regression instead of winner-take-all classification); until fixed, do not present `smart_score`/ML confidence as trustworthy for staple crops.
2. **C-4** — Remove "mandi" (and audit the rest of `_HINGLISH_WORDS` for other English-adopted loanwords) from the Hindi-detection trigger list; stop making `context.lang` permanently sticky once set from a single ambiguous message.
3. **C-2** — Point `/api/ml/status` at `manifest.json` (the file that actually corresponds to the loaded models), not `evaluation_manifest.json`.
4. **C-3** — Fix the train/test leakage in `evaluate_models.py`/`audit_models.py` by sharing one canonical dataset-builder and persisted split with the actual training pipeline.
5. **H-1** — Add `/marketplace` to `vercel.json`'s rewrites (one-line fix, currently 404s in production).
6. **H-2** — Add `ml/models/*.json` to `vercel.json`'s `includeFiles`.

### P1 — High priority
7. **H-3** — Split `dashboard.js`'s `api()` error handling: only fall back to offline heuristics on a true network-level failure, never on an HTTP error response.
8. **H-4** — Wire `dashboard.js` to listen for `mm:plot-changed` and refresh cached farm data.
9. **H-5, H-6, H-7** — Chatbot: restrict the district-suffix region-matching fallback, add missing-crop fallback branches to `/pest`/`/irrigate`/`/calendar`/`/sell`, bind extracted numbers to roles via nearby keywords instead of position, and add basic sanity bounds before calling into the recommendation/loan engines.
10. **H-8** — Add booking-conflict checking (even client-side/localStorage) before confirming a tractor booking.
11. **H-9** — Either restore a real login flow or remove `login.html`/`auth.js`/the Firebase remnants and drop `login.html` from the service-worker precache list.
12. **H-10, M-26** — Re-pin `requirements.txt` to match what's actually tested against; add `catboost`; rebuild the dev venv from the lockfile to confirm reproducibility.
13. **H-11** — Make `prediction_source` reflect whether ML actually fired for that specific call, not whether the model object is loaded.

### P2 — Important improvements
14. **M-1 through M-3, M-5** — Add the missing input-validation guard on `/api/crop-comparison`, wire the unused Pydantic query models to their endpoints, correct or fix the `/api/field/ndvi` docstring, add an image-dimension cap to `/api/disease/predict`.
15. **M-6, M-7** — Add a shared `storage`-event listener for cross-tab farm state; detect and surface localStorage quota failures instead of showing a false success toast.
16. **M-8** — Either implement the real backend sync for disease-scan logs or stop calling the no-op "sync" and stop deleting the local queue.
17. **M-9** — Extend graceful offline/error handling to the other ~18 dashboard tools (ideally via the shared-helper refactor noted in §11).
18. **M-10, M-11** — Decrement marketplace stock on the buyer-completion path too; add a `min` date to the tractor booking date field.
19. **M-13 through M-17** — Validate `context.region_id`/`season` server-side in the chatbot; narrow the "suggest(ion)" trigger; require greeting-only messages for the greeting short-circuit; add common crop synonyms; pass the extracted region into pest/irrigation engine calls instead of fixed defaults.
20. **M-18, M-19** — Scope disease-outbreak risk by crop, or rename it honestly as a generic weather index; stop deriving humidity from rainfall via an unexplained divisor.
21. **M-20, M-22 through M-25** — Either delete the orphaned data-ingestion pipeline or reconnect and fix it (field-name bug, fabricated nutrient data, cache eviction) before relying on it; keep audit manifests fresh/invalidated.
22. **M-27, M-28** — Move `pandas`/dev-only dependencies out of the production bundle; verify actual cold-start memory behavior against a real Vercel deploy.

### P3 — Nice-to-have / technical debt
23. Add the missing chatbot-panel i18n keys; localize the client-side chatbot greeting; wire `retranslate()` into dynamically-injected chat content.
24. Systematize `innerHTML`-interpolation escaping across `dashboard.js`/`gyan-seva.js` rather than the current one-off usage.
25. Add focus management to the floating toolbar/freshness popovers.
26. Clean up stale doc comments (`dashboard.js` "14 tools", `docs/API.md`'s missing endpoint sections, the dead `gen-firebase-config.js` build script), and mark orphaned modules as deprecated rather than leaving them ambiguous.
27. Extract a shared "tool wiring" helper in `dashboard.js` to stop the null-guard/error-handling drift from getting worse as more tools are added.
28. Backfill test coverage for the two most under-tested layers: `data_ingestion/fetchers/*` and the ML training/audit scripts — precisely where this audit's three Critical findings were hiding.

---

*End of report. All findings above were traced to specific files/functions and, where marked CONFIRMED, reproduced by executing the actual code against the real dataset/models rather than inferred from reading alone.*
