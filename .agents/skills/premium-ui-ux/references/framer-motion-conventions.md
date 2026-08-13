# Framer Motion Conventions & Reusable Variants

Standardized easing, durations, and Motion variants to maintain fluid, high-end animation across Next.js and React applications.

---

## Standard Timing & Easing Defaults

- **Entrance Duration**: `0.4s` - `0.6s`
- **Micro-interactions (Hover / Tap)**: `0.15s` - `0.2s`
- **Smooth Ease-Out Curve**: `[0.21, 0.47, 0.32, 0.98]`
- **Spring Transition (Bounce)**: `{ type: "spring", stiffness: 300, damping: 25 }`

---

## Reusable Motion Variants

```tsx
import { Variants } from "framer-motion";

// Smooth Fade In with slight upward movement
export const fadeInUp: Variants = {
  hidden: { opacity: 0, y: 20 },
  visible: {
    opacity: 1,
    y: 0,
    transition: {
      duration: 0.5,
      ease: [0.21, 0.47, 0.32, 0.98],
    },
  },
};

// Container for staggered child animations
export const staggerContainer: Variants = {
  hidden: { opacity: 0 },
  visible: {
    opacity: 1,
    transition: {
      staggerChildren: 0.1,
      delayChildren: 0.05,
    },
  },
};

// Scale up pop-in variant
export const scaleUp: Variants = {
  hidden: { opacity: 0, scale: 0.95 },
  visible: {
    opacity: 1,
    scale: 1,
    transition: {
      duration: 0.4,
      ease: [0.21, 0.47, 0.32, 0.98],
    },
  },
};

// Card hover effect properties
export const hoverCardProps = {
  whileHover: { y: -4, scale: 1.01 },
  whileTap: { scale: 0.98 },
  transition: { type: "spring", stiffness: 400, damping: 25 },
};
```

---

## Usage Patterns

### Hero Section Staggered Entrance
```tsx
<motion.div
  initial="hidden"
  animate="visible"
  variants={staggerContainer}
  className="space-y-6"
>
  <motion.h1 variants={fadeInUp} className="text-5xl font-bold tracking-tight">
    Build Faster with Intelligence
  </motion.h1>
  <motion.p variants={fadeInUp} className="text-xl text-muted-foreground">
    High-performance simulation & decision support.
  </motion.p>
  <motion.div variants={fadeInUp}>
    <Button size="lg">Get Started</Button>
  </motion.div>
</motion.div>
```

### Scroll-Triggered Feature Card Grid
```tsx
<motion.div
  initial="hidden"
  whileInView="visible"
  viewport={{ once: true, margin: "-100px" }}
  variants={staggerContainer}
  className="grid grid-cols-1 md:grid-cols-3 gap-6"
>
  {features.map((feature) => (
    <motion.div key={feature.id} variants={scaleUp} {...hoverCardProps}>
      <Card>{/* Feature Content */}</Card>
    </motion.div>
  ))}
</motion.div>
```
