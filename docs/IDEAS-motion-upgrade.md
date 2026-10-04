# Idea: motion and polish upgrade (saved for later)

Status: pieces 1 and 2 built, piece 3 built in part (progress bar only), on branch `motion-upgrade`. Piece 4 is on hold, see "Review notes" at the end. Follow-up to the Lenis smooth-scroll work (commit 3fcdd96).

## Goal
Raise the perceived quality of the site with a few small additions that fit the no-build, vanilla-JS setup. Prefer native browser features first, then one vendored library.

## Planned pieces, in order

1. **Cross-page View Transitions (native, CSS only)**
   - Add `@view-transition { navigation: auto; }` to `frontend/style.css`, wrapped in a `prefers-reduced-motion: no-preference` guard.
   - Give the nav a `view-transition-name` so it stays put while the page content cross-fades.

2. **Same-document View Transitions in the guided decide flow**
   - In `frontend/decide.js`, `showStep(n)` toggles `.is-active` on the step sections.
   - Wrap that DOM change in `document.startViewTransition()` when the API exists, so steps slide or fade into each other. Fall back to the current behaviour otherwise.

3. **CSS scroll-driven animations (native)**
   - A scroll-progress bar using `animation-timeline: scroll()`.
   - Candidates to move off the JS reveal code: simple fades using `animation-timeline: view()`. Keep the existing Lenis-driven `scrubReveals` as the fallback where unsupported.

4. **GSAP + ScrollTrigger (vendored)**
   - Vendor workflow: `npm install gsap`, copy the min files into `frontend/vendor/`, commit, and add them to the `sw.js` precache list (and bump `VERSION`).
   - Load on demand like Lenis in `frontend/site-ui.js` (fine-pointer, no reduced motion).
   - Hook up with `lenis.on('scroll', ScrollTrigger.update)`.
   - Targets: word-by-word reveal of the hero headline on `index.html` (`h1.hero__title`), and one pinned or scrubbed section (the `.showcase` block).

5. **Later, lower priority**
   - D3 or Observable Plot for one or two signature dashboard charts.
   - Fuse.js for fuzzy crop search (works with the i18n data).
   - web-vitals for real-user performance numbers.

## Constraints to respect
- `prefers-reduced-motion` must disable all of it.
- Touch devices stay on native scrolling, as with Lenis today.
- Check on a throttled mobile profile and with the offline path before shipping.
- The working tree had uncommitted changes in many frontend files when this was written, so commit only the files this work touches.
- Verify on localhost (`frontend-static` in `.claude/launch.json`, port 8899) before pushing to master.

## Review notes (2026-10-02)

What was built differs from the list above in two places.

- **Piece 3, reveals left on the existing code.** `scrubReveals` latches: once something has faded in, scrolling back up never hides it again. A CSS `animation-timeline: view()` reveal runs both ways, so moving the fades over would bring back the un-revealing that the Lenis work deliberately removed. Only the scroll-progress bar was added (a hairline on the foot of the nav).
- **Piece 2, the jump to the top is instant.** The step swap and the scroll to the top both happen inside the view transition, so the slide covers the jump. `mmScroll.to` gained an `{ instant: true }` option for this.

Piece 4 (GSAP + ScrollTrigger) is not built. Open problems with it as written:

- **The hero headline is the wrong target for an on-demand library.** `h1.hero__title` is above the fold and is the largest paint on the page. GSAP would arrive after the headline is already visible, so the words would have to be hidden and replayed (a flash) or hidden from the start (a blank headline until the script lands, and for good if it fails).
- **i18n rewrites the headline.** Splitting it into word spans would be undone by a language switch unless the split is redone each time.
- **`.showcase` is already animated.** Its two halves are `.reveal` elements driven by `scrubReveals`, and its photo is moved by `driveParallax`. A pinned ScrollTrigger on the same block would fight both.
- **Weight.** About 115 KB of minified script for two effects, on a site that counts bytes for metered connections. Desktop only, but it also goes into the service-worker precache for everyone.

Decision: GSAP skipped. The word-by-word headline entrance was built without it: an inline script in `index.html` splits the headline before first paint and `style.css` staggers the words (`.hero__word`, `wordUp`). The full sentence stays in a hidden span so `i18n.js` translates it unchanged, and the words are redrawn from it on `mm:lang-changed`. If a pinned scroll-storytelling section is ever wanted, that is the one thing here GSAP is the right tool for.

## Follow-up (2026-10-04, branch `all-round-upgrade`)

- **Instant page loads, natively.** Speculation Rules in `site-ui.js` prefetch a page's HTML on a short hover (desktop) or the start of a tap (touch), so the cross-page view transition plays without a network wait. Prefetch, not prerender: prerender runs the target page's scripts, API calls and usage counters for pages that may never open. Off under Data Saver.
- **Quick jump palette** (`mm-palette.js`, Ctrl/⌘+K or `/`) enters with `@starting-style` on the system's `--ease`; no script animation.
- **Still no GSAP**, for the reasons above. A spring easing via CSS `linear()` was considered and left out: DESIGN.md asks for motion that steadies rather than bounces, and earlier bounce easings in this repo were flagged as exceptions.
- **Fuse.js** (piece 5) was not needed: the palette searches ~40 items with a small scorer (prefix > word > substring > letters-in-order) and matches Hinglish keywords.
