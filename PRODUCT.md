# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

Two audiences, weighted **equally** — when a design decision forces a trade-off between them, neither automatically wins and the surface must be resolved for both.

**The farmer (primary persona: Ramesh Yadav, from `docs/01_discovery/persona_card.md`).** 38, semi-irrigated district in Telangana, 3 acres, weighing cotton / soybean / maize. Prefers Telugu and basic Hindi. Price-sensitive and risk-aware. His job: decide what to sow before the season commits his money. He is deciding under uncertainty about rainfall, input costs, and what the mandi will pay months from now. Decision triggers are expected profit and ROI, input affordability against his seed/fertilizer/irrigation budget, and a risk score he can actually interpret.

**The farm advisor / intermediary.** Serves many farmers, works in longer sessions, and needs fast side-by-side scenario comparison ("cotton vs soybean under lower rainfall") rather than a single guided answer. Density, comparison, and speed of iteration serve this user.

The two sessions look very different — a short, high-stakes, single-decision visit versus a long, comparative, multi-farm one. Surfaces are expected to serve both rather than optimizing for one and degrading the other.

## Product Purpose

Mitti Mantra (AgriSim) is a farm-strategy simulation and market-intelligence platform for Indian agriculture. It lets a farmer compare crop strategies *before* committing resources, estimating yield, total cost, revenue, profit, ROI, and a decomposed risk score from soil, climate, and market signals.

The problem it addresses (`docs/01_discovery/problem_statement.md`): small and medium Indian farmers make sowing and input decisions on fragmented information about soil, weather, input costs, and mandi prices, which produces avoidable yield loss, unstable profit, and higher financial risk.

Success is a farmer or advisor reaching a defensible sowing and selling decision — one they understand well enough to act on — rather than a prediction they must take on faith.

## Positioning

Three things a neighboring product could not truthfully copy:

1. **Deterministic simulation first, ML on top — never ML alone.** Every prediction path has an explainable heuristic fallback (`utils/calculations.py`, `engine/simulator.py`), and responses carry a `prediction_source` field declaring whether a number came from a trained model or the fallback. Explainability is a stated first-class outcome, not a feature.
2. **Whole-decision coverage, soil to sale.** Most tools stop at "which crop." This spans recommendation → simulation → rotation → irrigation/fertilizer/pest advisory → MSP and mandi analytics → sell timing → post-harvest credit → the marketplace transaction itself.
3. **Grounded in real Indian institutional reality.** MSP from CACP, mandi prices in an agmarknet-compatible shape, 12 named government schemes, and finance features built on actually-existing instruments (e.g. CGS-NPF pledge financing via WDRA-registered warehouses) rather than invented products.

## Operating Context

- **Zero-build, single-process deployment.** FastAPI serves both `/api/*` and the static `frontend/` from one URL. No bundler step stands between an edit and a running site.
- **Low-connectivity rural use is a design premise.** PWA with a service worker (`frontend/sw.js`), precached shell, and an `offline-simulator.js` fallback path.
- **Language.** UI ships English / Hindi / Telugu via `data-i18n` attributes and `i18n.js` + `i18n-data.js`.
- **Unified Farm Profile.** Region / season / area / budget are set once and auto-fill every tool; the chatbot inherits the same context. Deep links (`/dashboard.html?tool=…&region_id=…`) activate a specific tool with the profile applied.
- **Surfaces currently built:** landing (`index.html`), 14-tool dashboard (`dashboard.html`), marketplace (`marketplace.html`), Gyan Seva expert consultation (`gyan-seva.html`), Book a Tractor (`book-a-tractor.html`), farm boundary drawing (`farm-boundary.html`), login (`login.html`, currently orphaned — see below).

## Capabilities and Constraints

**Confirmed capabilities.** 35+ API endpoints across core data, simulation, market intelligence, farm advisory, and ML management. Three trained scikit-learn models (yield RandomForest, price GradientBoosting, recommendation RandomForestClassifier) plus a trained disease classifier and NDVI field-health endpoint. Site-aware chatbot with slash commands, voice input, session memory, and deep-link actions back into the dashboard. Three.js India globe with suitability overlays. Leaflet polygon draw with SoilGrids centroid fetch. Marketplace with buy/sell flows, cart, pooled collective selling, and a simulated order lifecycle.

**Data scale.** 32 crops and 30 regions in the current seed data — note that `docs/PROJECT_OVERVIEW.txt` still claims 8 crops and 3 regions and is stale on this and on the frontend file layout.

**Binding constraints — future work must not break these:**

1. **Zero-build vanilla JS frontend.** No bundler, no TypeScript, no framework. Every script is a plain `<script defer>`. This is stated in the README contributing rules and is the hardest of the four.
2. **Every computed figure traces to a real dataset, a real endpoint, or a named institution.** Agronomic, market, risk, and finance numbers are never invented. Simulated actions are labelled as simulated (the marketplace's explicit "Simulate (Demo)" lifecycle transitions are the reference pattern). See the scope note under Evidence on Hand — this rule governs computed data, not the deliberately staged landing-page social proof.
3. **EN / HI / TE stay first-class.** New surfaces ship with `data-i18n` coverage, not English-only.
4. **Offline / PWA capability is preserved.** Service worker, precached shell, and the offline simulator keep working; bump `VERSION` in `sw.js` when shipping new assets.

*Recorded with a caveat: the user affirmed all four but flagged some uncertainty about 2–4. Zero-build is certain. Treat 2–4 as real rules, and raise it explicitly rather than silently trading one away.*

**Explicitly undecided / open:**

- **Authentication is removed.** `frontend/auth.js` is a deliberate no-op stub; `login.html` exists but no real auth backend does. Anything user-scoped persists to `localStorage` keyed by a per-browser device id. Whether real accounts ever arrive is undecided.
- **No database.** CSV flat files are the source of truth, read through a shared mtime-aware cache (`utils/csv_cache.py`). Expense logging is in-memory only. A future SQL migration is intended but unscheduled.
- **Project trajectory is genuinely mixed** — a judged hackathon/competition build, a portfolio showcase, *and* a build with real ambition toward a farmer pilot, all at once. Do not resolve this tension by quietly picking one. Work should hold up under a judge's scrutiny and stay honest enough to put in front of a real farmer.

## Brand Commitments

- **Name:** Mitti Mantra (also written MittiMantra in-product; the engine/repo is AgriSim).
- **Tagline:** *Mitti se judao, fasal se pao.*
- **Voice:** warm, plain-spoken, Hindi-inflected without being performative. Addresses the user as *kisan*. Explains rather than asserts.
- **Existing identity:** logo assets at `frontend/assets/logo.png`, `logo-192.png`, `logo-512.png`. Existing visual system is a warm-earth "clay" / earthy-claymorphism palette with Fraunces display type, documented in `frontend/style.css` as CSS custom properties, with dark mode via `html[data-theme="dark"]`. Recorded as the incumbent world, not as a commitment — `/impeccable document` or a redesign may revisit it.

## Evidence on Hand

**Real:**
- 9 seed CSV datasets covering 32 crops × 30 regions — crop parameters, mandi prices, MSP, soil, weather, yield history, government schemes, pest rules, disease treatments (`docs/DATASETS.md`, `dataset/data_dictionary.md`).
- Live API integrations requiring no key: SoilGrids v2, Open-Meteo. data.gov.in mandi prices behind an optional `DATAGOV_API_KEY`, falling back to seed CSV.
- Trained model artifacts with a metrics manifest (`ml/models/manifest.json`, `validation_report.json`).
- 25 product photos sourced from Wikimedia Commons, converted to WebP, offline-cacheable (`frontend/assets/marketplace/`).
- Real, currently-active institutional schemes underpinning the finance features — notably CGS-NPF (Government of India, launched 16 Dec 2024, NABARD/SFAC, ₹1,000 crore through FY 2030-31, pledge financing up to 75% of stored produce value at 7% p.a. subvented interest via WDRA-registered warehouses).

**Not real — and future work must not upgrade these into claims of traction:**
- **There are no real users, no pilot, and no adoption numbers.** The landing page's "Trusted by 12,000+ kisans across Madhya Pradesh, UP, Maharashtra," its three Hindi testimonials from named farmers, and its stock Unsplash avatars are **deliberate demo dressing** and are staying by explicit decision. They are known fiction, not evidence. Do not "fix" them, do not cite them as proof of traction, and do not extend the pattern into new fabricated metrics, case studies, press, or customer logos.
- Marketplace listings, pools, orders, and seller profiles are demo catalog data plus `localStorage` state — not a real two-sided market.

The line between these two lists is the point: *staged presentation furniture is allowed and already decided; fabricated agronomic, market, risk, or finance figures are not.*

## Product Principles

1. **Explain, don't just predict.** A number a farmer cannot interrogate is a number he cannot act on. Every recommendation carries its reasoning, its source, and its uncertainty — `prediction_source`, "Why this crop?", "Data as of · Source", confidence that visibly decays further into a forecast.
2. **Decisions, not dashboards.** The unit of value is a committed choice — what to sow, when to sell, whether to borrow — not a screen of metrics. Tools that display without resolving to a decision are unfinished.
3. **Two users, one surface.** Farmer and advisor are weighted equally. Depth for the advisor must not bury the farmer's decision; simplicity for the farmer must not amputate the advisor's comparison.
4. **Honest by construction.** Real data or a named fallback; simulated actions labelled as simulated; absent evidence left absent. Trust is the product's actual moat with a risk-averse user.
5. **Works where farming happens.** Low bandwidth, budget Android, patchy signal, Telugu or Hindi. Capability that only survives on a desktop with good connectivity has not shipped.

## Accessibility & Inclusion

- **Language access is a functional requirement, not a courtesy.** EN / HI / TE, with the primary persona preferring Telugu and basic Hindi over English.
- **Existing affordances:** high-contrast mode (`body.mm-hc`) and large-text mode (`body.mm-lg`) via `mm-core.js`; keyboard-navigable sidebar, forms, and tools menu; `aria-label` on icon buttons; voice input on the chatbot and the marketplace sell form; read-aloud TTS; print stylesheet for PDF export.
- **Low-literacy and voice-first interaction is a live consideration** — voice input already exists on two surfaces and the pattern should extend rather than regress.
- No specific conformance standard (WCAG level) has been established as a requirement.
