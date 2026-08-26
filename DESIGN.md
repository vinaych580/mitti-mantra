---
name: Mitti Mantra
description: Warm-earth farm intelligence for Indian agriculture — a field journal that computes.
colors:
  bg: "#faf6ef"
  bg-soft: "#f4ede0"
  surface: "#ffffff"
  ink: "#1d1a15"
  ink-soft: "#4a4339"
  ink-faint: "#8a8376"
  brand: "#2f6b3a"
  brand-deep: "#1f4d28"
  brand-soft: "#e8f3ea"
  accent: "#c88a3a"
  accent-soft: "#f7ecd7"
  clay: "#a5562a"
  sky: "#6ea7c7"
  info: "#2a5a7a"
  info-soft: "#e3f0f8"
  danger: "#8b2f2f"
  danger-soft: "#fce4e4"
  accent-deep: "#8a5a1e"
  viz-blue: "#4a7db8"
  viz-olive: "#6b8e23"
  dark-bg: "#141110"
  dark-bg-soft: "#1d1815"
  dark-surface: "#23201c"
  dark-ink: "#f3ece0"
  dark-ink-soft: "#c9bfb0"
  dark-ink-faint: "#8a8070"
typography:
  display:
    fontFamily: "Fraunces, 'Playfair Display', Georgia, serif"
    fontSize: "clamp(2.4rem, 5.8vw, 5.2rem)"
    fontWeight: 500
    lineHeight: 1.08
    letterSpacing: "-0.02em"
  headline:
    fontFamily: "Fraunces, 'Playfair Display', Georgia, serif"
    fontSize: "clamp(2rem, 4vw, 3.4rem)"
    fontWeight: 500
    lineHeight: 1.08
    letterSpacing: "-0.02em"
  title:
    fontFamily: "Fraunces, 'Playfair Display', Georgia, serif"
    fontSize: "clamp(1.25rem, 1.8vw, 1.6rem)"
    fontWeight: 600
    lineHeight: 1.08
    letterSpacing: "-0.02em"
  body:
    fontFamily: "Inter, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif"
    fontSize: "16px"
    fontWeight: 400
    lineHeight: 1.6
    letterSpacing: "normal"
  label:
    fontFamily: "Inter, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif"
    fontSize: "0.72rem"
    fontWeight: 600
    lineHeight: 1.4
    letterSpacing: "0.1em"
  eyebrow:
    fontFamily: "Inter, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif"
    fontSize: "0.78rem"
    fontWeight: 600
    lineHeight: 1.4
    letterSpacing: "0.18em"
rounded:
  sm: "8px"
  icon: "10px"
  md: "14px"
  lg: "22px"
  xl: "36px"
  pill: "999px"
utilityFontSizes:
  3xs: "0.68rem"
  2xs: "0.82rem"
  xs: "0.92rem"
  sm: "1.08rem"
  2xl: "1.4rem"
  xl: "1.8rem"
borders:
  hairline: "rgba(29, 26, 21, .06)"
  strong: "rgba(29, 26, 21, .1)"
spacing:
  xs: "6px"
  sm: "10px"
  md: "16px"
  lg: "24px"
  xl: "28px"
  section: "clamp(72px, 10vw, 140px)"
components:
  button-primary:
    backgroundColor: "{colors.brand}"
    textColor: "{colors.surface}"
    rounded: "{rounded.pill}"
    padding: "14px 26px"
    typography: "{typography.body}"
  button-primary-hover:
    backgroundColor: "{colors.brand-deep}"
    textColor: "{colors.surface}"
  button-ghost:
    backgroundColor: "transparent"
    textColor: "{colors.ink}"
    rounded: "{rounded.pill}"
    padding: "14px 26px"
  button-ghost-hover:
    backgroundColor: "{colors.ink}"
    textColor: "{colors.surface}"
  button-light:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink}"
    rounded: "{rounded.pill}"
    padding: "14px 26px"
  card:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink}"
    rounded: "{rounded.lg}"
    padding: "28px"
  input:
    backgroundColor: "{colors.bg}"
    textColor: "{colors.ink}"
    rounded: "{rounded.sm}"
    padding: "12px 14px"
  input-focus:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink}"
  chip:
    backgroundColor: "{colors.bg-soft}"
    textColor: "{colors.ink-soft}"
    rounded: "{rounded.pill}"
    padding: "5px 12px"
  kpi:
    backgroundColor: "{colors.bg-soft}"
    textColor: "{colors.ink}"
    rounded: "{rounded.md}"
    padding: "16px"
---

# Design System: Mitti Mantra

## Overview

**Creative North Star: "The Field Journal"**

A working notebook kept at the edge of a field — warm paper, a serif hand for the things that matter, and margins filled with numbers earned rather than assumed. The palette is taken from the subject itself: leaf, wheat, soil, monsoon. Nothing here is borrowed from the sterile blue-and-grey vocabulary of B2B SaaS, and that departure is deliberate.

The register is **warm but confident and alive**. The grounded palette and paper background do the reassuring; motion, scale, and a disciplined accent do the rest. Surfaces respond when touched — cards lift, buttons rise two pixels, arrows slide forward — so the product reads as something modern and responsive rather than a form that happens to be beige. A farmer making a season-defining decision should feel steadied, not hurried; the interface earns trust by being legible and specific, never by shouting.

The system serves two very different sessions on the same tokens: a farmer's short, high-stakes visit and an advisor's long comparative one. The resolution is that warmth lives in the shell — paper, radii, serif headings — while the interior stays exact. Numbers are tabular, labels are uppercase and small, and colour carries meaning rather than decoration.

**Key Characteristics:**
- Warm paper ground (`#faf6ef`), never pure white as the page
- Fraunces serif for headings, Inter for everything operational
- Fully-round pill buttons and generous 22px card radii
- Depth from tonal layering and hairline borders first, shadow as a response to state
- A four-colour agricultural accent set, one accent per context
- Contrast reasoning documented inline in the stylesheet, not improvised

## Colors

An agricultural palette named for what it depicts: the ground is paper, the ink is near-black soil, and four accents stand in for leaf, wheat, clay, and monsoon.

### Primary
- **Leaf Green** (`#2f6b3a`): The brand voice. Primary buttons, eyebrow rules, active states, focus rings, and the "good" reading on any metric. This is the colour of a correct decision.
- **Deep Leaf** (`#1f4d28`): Primary button hover and the value text inside a positive KPI. Never a resting surface colour — it exists to show that the green just got more committed.
- **Leaf Wash** (`#e8f3ea`): The tinted background for positive KPI tiles and success surfaces.

### Secondary
- **Wheat Gold** (`#c88a3a`): The harvest/market accent. Cautionary KPI tiles, market and price contexts, and the second bento accent.
- **Wheat Wash** (`#f7ecd7`): Tinted background for warning-tier tiles.

### Tertiary
- **Soil Clay** (`#a5562a`): The earth accent. Carries warning KPI values, soil and land contexts, and diagnostic focus rings.
- **Monsoon Blue** (`#6ea7c7`): The water accent. Irrigation, rainfall, and informational contexts. The one accent that must never carry small text on paper — see the Legibility Over Palette Rule.

### Neutral
- **Paper** (`#faf6ef`): The page. The default ground everywhere; white is a raised surface, not a background.
- **Soft Paper** (`#f4ede0`): The second tonal step — KPI tiles, chips, and inset regions that need to read as recessed without a border.
- **Surface White** (`#ffffff`): Raised cards, panels, and focused inputs. Its job is to sit *above* paper.
- **Soil Ink** (`#1d1a15`): Primary text. A warm near-black, never `#000`.
- **Soft Ink** (`#4a4339`): Body copy, secondary text, and any small supporting label.
- **Faint Ink** (`#8a8376`): Reserved for large or decorative text only.

### Utility Extensions

- **Deep Gold** (`--accent-deep`, `#8a5a1e`): a darkened Wheat Gold used only for text sitting on a Wheat Wash chip, where Wheat Gold itself fails contrast. Follows the same "-deep" pattern as Deep Leaf.
- **Data-viz spectrum** (`--viz-blue` `#4a7db8`, `--viz-olive` `#6b8e23`): a two-color extension to the Wheat Gold → Soil Clay pair, used only in the 3D scene legend bar's continuous low-to-high scale. Deliberately distinct from the four brand accents — a chart spectrum needs perceptual range a semantic palette doesn't provide — and not for use in UI chrome.

### Named Rules

**The Legibility Over Palette Rule.** When an accent cannot carry text at the required contrast, the text goes high-contrast and the accent moves to a dot, bar, or border instead. The stylesheet already enforces this in two places and says so in comments: `--ink-faint` is rejected for small supporting text because it only reaches 3.5:1 on paper, and diagnosis confidence numbers stay `--ink` because Monsoon Blue on paper is 2.4:1. Colour signals category; it does not get to cost legibility.

**The Paper Ground Rule.** `--bg` is the page and `--surface` is what sits on it. A full-bleed white background is a bug, not a style choice — it collapses the tonal stack that this system uses instead of heavy shadows.

**The One Accent Per Context Rule.** A card, tile, or section commits to a single accent from the four (leaf / wheat / clay / monsoon) and expresses it through the `--f-accent` / `--f-soft` pair. Mixing two accents inside one component reads as decoration and drops the semantic link between colour and meaning.

### Dark theme

A genuine second palette exists and is normative: paper inverts to `#141110`, surfaces to `#23201c`, ink to `#f3ece0`. Accent hues are unchanged; only their wash variants are re-tuned (`--brand-soft` → `#1f3a24`, `--accent-soft` → `#3a2c18`).

**Note the split source of truth.** These tokens do **not** live in `frontend/style.css`. They are in a ~200-line stylesheet injected at runtime by `frontend/toolbar.js` under `html[data-theme="dark"]`. Any change to a light token needs a matching decision in `toolbar.js`, and a new component styled only in `style.css` will be untreated in dark mode. Check both files.

## Typography

**Display Font:** Fraunces (with Playfair Display, Georgia, serif)
**Body Font:** Inter (with system sans-serif stack)

**Character:** Fraunces is a soft, slightly wobbly serif with real warmth in its curves — it gives headings the feel of something printed and considered rather than rendered. Inter underneath is neutral and operational, and carries every number, label, and control. The pairing is the whole thesis in miniature: a warm voice introducing exact information.

### Hierarchy
- **Display** (Fraunces 500, `clamp(2.4rem, 5.8vw, 5.2rem)`, 1.08, `-0.02em`): Page-owning h1. One per page, in the hero.
- **Headline** (Fraunces 500, `clamp(2rem, 4vw, 3.4rem)`, 1.08, `-0.02em`): Section openers. Carries the narrative spine of a long page.
- **Title** (Fraunces 600, `clamp(1.25rem, 1.8vw, 1.6rem)`, 1.08): Card and tool headings. Note the weight step to 600 — small Fraunces needs it.
- **Body** (Inter 400, 16px, 1.6): All prose, set in Soft Ink rather than full Ink.
- **Label** (Inter 600, `0.72rem`, `0.1em`, uppercase): KPI labels and preview captions. Small, wide-tracked, and always in Soft Ink or darker.
- **Eyebrow** (Inter 600, `0.78rem`, `0.18em`, uppercase, Leaf Green): Section kickers, prefixed by a 24px leaf-green rule via `::before`.

### Utility Scale

The six hierarchy steps above are semantic (one job each). Everything smaller and denser — chip text, meta lines, form hints, table cells, card sub-labels — draws from a six-step utility scale instead, consolidated from what had drifted into ~40 near-duplicate one-off sizes:

- **`--fs-3xs`** (`0.68rem`): micro labels — stat units, small badges.
- **`--fs-2xs`** (`0.82rem`): meta and support text — card sub-lines, footer text, hints.
- **`--fs-xs`** (`0.92rem`): compact UI text — nav links, form inputs, button-adjacent copy.
- **`--fs-sm`** (`1.08rem`): emphasized small text — logo mark, promo sub-heads.
- **`--fs-2xl`** (`1.4rem`): prominent inline numbers — hero-card values.
- **`--fs-xl`** (`1.8rem`): large result/stat numbers below Title weight.

A handful of genuinely one-off display numbers (dashboard `h1` at `3rem`, a hero stat at `3.8rem`, scattered KPI values between `1.2rem` and `1.65rem`) stay literal — each is a single, distinct hierarchy step, not drift, and doesn't clear the 3-use bar for tokenizing.

### Named Rules

**The Serif Stops at the Data Rule.** Fraunces is for headings and hero statements only. Every number, form control, label, table cell, and chip is Inter. A serif quintal figure is a category error — the serif is the voice, not the instrument.

**The Tightened Display Rule.** All Fraunces headings run at `1.08` line-height with `-0.02em` tracking. Large serif set at default spacing drifts apart and loses the printed quality the North Star depends on.

## Layout

A centred 1200px container (`--maxw`) with 24px gutters, over a fixed 72px navigation (`--nav-h`).

Vertical rhythm is fluid: sections breathe at `clamp(72px, 10vw, 140px)`, so the landing page opens up on desktop and compresses honestly on a phone without a separate mobile scale. Feature regions use a **6-column bento grid** with 20px gaps, where cards claim `span 2` by default and hero cards claim more — the asymmetry is the point, and a uniform 3-across grid would flatten it.

Density is deliberately dual. Marketing surfaces run airy with large type and generous section padding; the dashboard runs dense, with 16px KPI tiles in a 2-column result grid and 16px gaps. Same tokens, different settings — this is how one system serves both the farmer and the advisor.

**Breakpoints** cluster at **860px** (the primary desktop-to-stack transition, used a dozen times) and **640px** (small-phone adjustments), with situational stops at 500, 520, 620, 700, 720, 900, 960, 1080, and 1100px. 860px is the one to design against; the others are local repairs.

**Motion honors `prefers-reduced-motion`**: a global override collapses all animation and transition durations to `0.01ms` and disables smooth scrolling. Any new motion inherits this automatically — do not re-enable it locally.

## Elevation & Depth

**Tonal first, shadow on state.** Depth comes primarily from the three-step warm tonal stack — Paper (`--bg`) → Soft Paper (`--bg-soft`) → Surface White (`--surface`) — reinforced by 1px hairline borders at `rgba(29, 26, 21, .06)`. Cards rest at the lightest shadow tier and *earn* elevation through interaction: cards and KPI tiles lift on hover, buttons translate `-2px`, and the navigation gains its shadow only once scrolled.

This keeps the surface calm at rest while making the interface feel physically responsive — the "alive" half of the register — without the permanent puffiness that a fully claymorphic reading would produce.

### Shadow Vocabulary
- **Resting** (`box-shadow: 0 1px 2px rgba(29,26,21,.06), 0 2px 6px rgba(29,26,21,.04)`): The default for cards and light buttons. Barely there; it separates, it does not lift.
- **Raised** (`box-shadow: 0 4px 12px rgba(29,26,21,.08), 0 12px 30px rgba(29,26,21,.06)`): Hover state for cards and light buttons; resting state for genuinely floating panels.
- **Lifted** (`box-shadow: 0 10px 40px rgba(29,26,21,.14), 0 30px 80px rgba(29,26,21,.08)`): Modals, drawers, and the chat widget. Reserve it — this tier is what makes an overlay read as an overlay.
- **Brand glow** (`box-shadow: 0 10px 24px rgba(47,107,58,.28)`, hover `0 14px 32px rgba(47,107,58,.35)`): Primary buttons only. A coloured shadow, tinted to the button, not a neutral one.

### Named Rules

**The Earned Elevation Rule.** A surface at rest sits at Resting or flat. Raised and Lifted are responses — to hover, to focus, to genuinely floating above the page. A component that ships at Lifted while idle has taken the modal tier for itself.

**The Warm Shadow Rule.** Every shadow is `rgba(29, 26, 21, …)` — the ink colour, not black. A neutral grey-black shadow on this paper reads cold immediately and breaks the ground.

## Shapes

**Soft-edged and tactile.** The corner scale runs 8 / 14 / 22 / 36px plus a full 999px pill, and each step has a job: 8px for inputs and small inset elements, 14px for KPI tiles and preview panels, 22px for cards, 36px for large hero surfaces. A fifth step, **`--r-icon` (10px)**, sits between the input and KPI-tile steps for small square icon-badge containers (38–54px glyph tiles) — visually distinct from an input's corner but too small to read as a panel.

Thin decorative elements — progress fills, swatches, focus rings, scrollbar thumbs, skeleton-loader bars, chart-bar caps — are exempt from this scale. Their radius is proportional to their own thickness (a 3–4px bar gets a 2–4px radius to look like a rounded cap or pill), not a reference to the container scale.

Buttons are **always fully round** (`999px`) — this is the most recognisable shape signature in the system. Chips are round for the same reason, at 5×12px padding.

Borders are hairlines, not structure: 1px at `rgba(29, 26, 21, .06)` (token `--border`) on cards, stepping up to 1.5px at `rgba(29, 26, 21, .1)` (token `--border-strong`) on form controls, which need the extra definition to read as interactive. Cards carry `overflow: hidden` so accent bars and hover washes clip cleanly to the radius.

**The Pill and the Panel Rule.** Anything you press is a pill. Anything that holds content is a panel at 14–22px. A square-cornered button or a pill-shaped content card both break the system's most legible convention.

## Components

### Buttons
- **Shape:** Fully round pill (`999px`), `14px 26px` padding, Inter 600 at `0.95rem`, inline-flex with a 10px gap for an optional 16px icon.
- **Primary:** Leaf Green on white text, carrying its own tinted green glow. Hover deepens to Deep Leaf, lifts `-2px`, and intensifies the glow.
- **Ghost:** Transparent with a 1.5px `rgba(29,26,21,.14)` border. Hover inverts fully — the border and background both become Soil Ink with white text. A confident inversion, not a tint.
- **Light:** White on Soil Ink text at Resting shadow, for use over photography or dark sections. Hover lifts to Raised.
- **Icon behavior:** A contained arrow slides `translateX(4px)` on hover. Small, consistent, and part of the "alive" register.

### Chips
- **Style:** Soft Paper background, Soft Ink text, `999px`, `5px 12px`, Inter 600 at `0.76rem`, optional 1px hairline. Hover lifts `-1px` into Resting shadow.
- **Use:** Metadata and filters. Chips are not buttons — if it performs an action, it is a pill button.

### Cards / Containers
- **Corner Style:** 22px (`--r-lg`).
- **Background:** Surface White on the Paper ground.
- **Shadow Strategy:** Resting at idle, Raised on hover (see Elevation).
- **Border:** 1px hairline `rgba(29,26,21,.06)`.
- **Internal Padding:** 28px.
- **Accent behavior:** Each card carries a `--f-accent` / `--f-soft` pair (defaulting to leaf, with `--gold`, `--sky`, `--clay` modifiers) and a 3px top accent bar that scales in from the left on hover via `transform: scaleX()`. The accent is the card's category; the bar is how it announces itself.

### Inputs / Fields
- **Style:** Paper background (not white), 1.5px `rgba(29,26,21,.1)` border, 8px radius, `12px 14px` padding, `font: inherit`.
- **Focus:** Border shifts to Leaf Green, background rises to white, and a 3px `rgba(47,107,58,.15)` green glow appears. `outline: none` is only acceptable because this ring replaces it — never remove the ring without a replacement.
- **The Fill-On-Focus Rule.** An input at rest is Paper; a focused input is white. The field lifts out of the page as you enter it, which is the same earned-elevation logic applied to form controls.

### Navigation
- **Style:** Fixed, 72px, transparent at the top of the page. On scroll it gains `rgba(250,246,239,.85)` with `saturate(180%) blur(18px)` backdrop-filter and a 1px hairline underline — the paper colour, not white, so the blur stays warm.
- **Links:** Inter 500 at `0.92rem` in Soft Ink, transitioning to full Ink on hover.

### KPI Tile (signature component)
The dashboard's core readout and the clearest expression of colour-as-meaning. Soft Paper background, 14px radius, 16px padding, with a small uppercase wide-tracked label above a large value and an optional sub-line in Soft Ink. Semantic variants re-tint the whole tile: `--good` takes Leaf Wash with a Deep Leaf value, `--warn` takes Wheat Wash with a Soil Clay value, `--info` takes a blue wash with a Monsoon Blue value. Tiles lift on hover and stagger on entrance.

### Accessibility modes
Two body-level modes ship from `mm-core.js` and any new component inherits them: `body.mm-lg` raises base type to 17px and enlarges KPI values; `body.mm-hc` applies `contrast(1.15) saturate(1.15)`, outlines KPI tiles, and underlines all links and primary buttons. Do not fight these with `!important`.

## Do's and Don'ts

### Do:
- **Do** build on the Paper ground (`#faf6ef`) and treat white as a raised surface.
- **Do** set every heading in Fraunces at `1.08` line-height with `-0.02em` tracking, and everything operational in Inter.
- **Do** make buttons fully round (`999px`) and content containers 14–22px.
- **Do** give each card or tile exactly one accent via `--f-accent` / `--f-soft`.
- **Do** tint shadows with the ink colour `rgba(29,26,21, …)`, and tint the primary button's glow green.
- **Do** replace any removed `outline` with the 3px `rgba(47,107,58,.15)` focus ring.
- **Do** use `--ink-soft` for small supporting text; `--ink-faint` is for large or decorative text only.
- **Do** update `toolbar.js`'s dark block whenever you add a component with a hardcoded light surface.
- **Do** route new motion through `--ease` (`cubic-bezier(.22, 1, .36, 1)`) and `--dur` (`.5s`).

### Don't:
- **Don't** set small text in Monsoon Blue or `--ink-faint` on paper — 2.4:1 and 3.5:1 respectively. Move the colour to a dot, bar, or border and keep the text high-contrast.
- **Don't** use pure `#000` for text or `#fff` for the page background.
- **Don't** ship a component at the Lifted shadow tier while idle; that tier belongs to overlays.
- **Don't** set numbers, labels, form controls, or table cells in Fraunces.
- **Don't** mix two accents inside a single card or tile.
- **Don't** use neutral grey-black shadows — they read cold against the warm ground immediately.
- **Don't** introduce a new breakpoint when 860px or 640px will do.
- **Don't** re-enable animation inside `prefers-reduced-motion: reduce`.
- **Don't** reach for the sterile blue/grey SaaS palette; the agricultural accent set is the identity.
