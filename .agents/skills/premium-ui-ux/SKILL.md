---
name: premium-ui-ux
description: Use this skill whenever building or styling a frontend for a hackathon project, landing page, or any user-facing web UI in the Antigravity/Next.js boilerplate. Make sure to trigger this for ANY request involving "hero section," "landing page," "make it look premium/polished," "add animations," or general frontend styling — even if the user just says "build the UI" without asking for design explicitly. Covers component sourcing (21st.dev, Aceternity UI, Magic UI, shadcn/ui), animation conventions (Framer Motion), layout/spacing rules, and a fast workflow for making a project look high-end within hackathon time constraints.
---

# Premium UI/UX

A skill for making hackathon-speed frontends look like they took a design team weeks, not hours. Optimized for the Antigravity boilerplate (Next.js App Router + Tailwind + shadcn/ui).

## Workflow (fast path)

1. **Base components** — Use shadcn/ui as the primitive layer (buttons, cards, dialogs, inputs). Install via `npx shadcn@latest add <component>`. Never hand-roll a primitive shadcn already has.
2. **Hero/landing sections** — Don't design from scratch. Pull a hero, pricing, or feature section from **21st.dev** (browse, copy the code, adapt copy/colors). This is the single highest-leverage step for "looks premium" per minute spent.
3. **Animated components** — For anything that needs motion out of the box (marquees, spotlight cards, animated borders, text reveals), pull from **Aceternity UI** or **Magic UI** instead of writing custom Framer Motion. Both give copy-paste React + Tailwind + Framer Motion code.
4. **Custom animation** — For anything not covered by a library component, use **Framer Motion** directly. See `references/framer-motion-conventions.md` for the house style (easing, durations, patterns to reuse).
5. **Polish pass** — Once the layout is in place, run through `references/design-checklist.md` before calling it done.

## Sourcing rules

- **21st.dev**: best for full sections (hero, pricing, testimonials, CTA). Search by section type, not by aesthetic keyword.
- **Aceternity UI**: best for "wow" moments — one flashy animated component per page is usually enough (spotlight, background beams, hover effect cards). Don't stack more than 2-3 or the page feels busy.
- **Magic UI**: best for smaller polish components — marquees, animated lists, shimmer buttons, bento grids.
- **shadcn/ui**: everything structural/functional — forms, modals, dropdowns, tables. Never skip this layer for "custom" versions of things it already solves.

When in doubt about which library has the right component, describe the visual effect wanted (e.g. "grid of cards where one lights up on hover") rather than guessing a component name — check each site's component list before writing custom code.

## Design defaults (unless the user specifies otherwise)

- **Spacing**: use Tailwind's default scale consistently; don't mix arbitrary pixel values with the scale.
- **Type**: one display font for headings (via next/font), system/Inter-equivalent for body. Never more than 2 font families.
- **Color**: pick one accent color, use neutrals (zinc/slate) for everything else. Avoid rainbow palettes.
- **Motion**: entrance animations on scroll (fade+slight-y-translate) for sections; hover states on interactive elements; avoid animating on every element — reserve motion for what should draw the eye.
- **Dark mode**: default to dark-mode-first for hackathon/demo aesthetics unless the product is clearly a light-mode context (e.g. productivity/enterprise tool).

## Reference files

- `references/design-checklist.md` — final polish pass before demo (contrast, responsive breakpoints, loading states, empty states)
- `references/framer-motion-conventions.md` — reusable animation variants (fade-in-up, stagger children, hover-scale) with the exact easing/duration values to keep motion consistent across a project

## Anti-patterns to avoid

- Don't build a hero section from a blank `<div>` when 21st.dev has 20 you could adapt in 2 minutes.
- Don't install a heavy animation library (GSAP, Lottie) for something Framer Motion already does simply — reserve GSAP for scroll-driven/timeline-heavy sequences.
- Don't leave default shadcn theme colors untouched — always set at least one accent color so it doesn't look like a template.
- Don't skip mobile breakpoints — check at minimum 375px, 768px, 1440px widths before demoing.
