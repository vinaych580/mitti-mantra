# Design Checklist (Final Polish Pass)

Before presenting or shipping any user-facing frontend, run through this checklist to ensure a high-end, production-grade presentation.

---

## 1. Visual & Contrast Audit
- [ ] **Contrast Ratios**: Body text has at least 4.5:1 contrast against its background. Muted text is legible.
- [ ] **Color Palette Discipline**: Maximum of 1 accent color used for CTAs/highlights; background/card colors stick strictly to neutrals (e.g. Zinc, Slate, Neutral).
- [ ] **Dark Mode Integrity**: Dark mode background is deep dark (e.g. `#09090b` / `zinc-950`), cards use clear surface separation (`zinc-900`/`zinc-800`), borders use subtle opacity (`border-white/10` or `border-zinc-800`).

---

## 2. Typography & Layout Hierarchy
- [ ] **Font Pairing**: No more than 2 font families (Display font for headings, clean sans-serif like Inter for body/UI).
- [ ] **Type Scale**: Distinct size and weight scale between `h1`, `h2`, `h3`, body text, and small label captions.
- [ ] **Spacing Consistency**: All padding and margin values use Tailwind standard spacing steps (`p-2`, `p-4`, `p-6`, `gap-4`, etc.). No arbitrary values unless strictly necessary for custom math.

---

## 3. Responsive Breakpoints
- [ ] **Mobile (375px)**: Navigation collapses into mobile menu; grid columns stack to single column (`grid-cols-1`); hero headline wraps gracefully without overflow.
- [ ] **Tablet (768px)**: 2-column layouts adjust cleanly; padding scales up (`md:p-8`).
- [ ] **Desktop (1440px+)**: Content max-width constrained (`max-w-7xl mx-auto`), avoiding stretched wide-screen layouts.

---

## 4. Interaction & Motion Polish
- [ ] **Hover & Active States**: All clickable elements (buttons, cards, links) have subtle hover transitions (`transition-all duration-200 hover:scale-[1.02]` or color change).
- [ ] **Focus Rings**: Keyboard focus visible and stylized (`focus-visible:ring-2 focus-visible:ring-accent`).
- [ ] **Motion Restraint**: Page entrance animations are subtle (fade + 10-20px y-translate); non-intrusive scroll animations.

---

## 5. Micro-States & Edge Cases
- [ ] **Loading States**: Skeletons or sleek spinners implemented for asynchronous data fetching.
- [ ] **Empty States**: Helpful messaging and primary action button when list/data sets are empty.
- [ ] **Error States**: Clear, styled inline error toasts or alerts instead of raw browser alerts.
