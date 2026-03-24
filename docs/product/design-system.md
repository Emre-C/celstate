# Celstate Design System

## Identity

- **Product**: AI transparent-background image generator
- **Audience**: Creatives, designers — users with refined visual taste
- **Aesthetic**: Warm editorial / studio-quality. Light-mode only.
- **Tone**: Premium, confident, designed — NOT dark-mode dev-tool, NOT AI-generated-looking

## Color Tokens

Defined in `src/app.css` via Tailwind `@theme` and `:root`.

```typescript
interface ColorTokens {
  bg:     "#F5F3ED";  // warm parchment cream — NEVER pure white
  text:   "#1C1917";  // warm near-black (stone-900) — NEVER pure black
  dim:    "#78716C";  // warm stone (stone-500) — secondary text
  accent: "#C2410C";  // burnt terracotta — primary brand color
  border: "#E2DED6";  // warm subtle border
}
```

### Checkerboard Pattern (Transparency Indicator)

Used in `CheckerboardPreview`, `ZoomInspector`, `HeroShowcase`.

```typescript
interface CheckerboardColors {
  squareColor: "#d6d3cb";  // warm gray squares
  baseColor:   "#e8e5dd";  // warm off-white base
}
```

```css
/* Canonical checkerboard CSS — replicate exactly when creating new transparency containers */
background-image:
  linear-gradient(45deg, #d6d3cb 25%, transparent 25%),
  linear-gradient(-45deg, #d6d3cb 25%, transparent 25%),
  linear-gradient(45deg, transparent 75%, #d6d3cb 75%),
  linear-gradient(-45deg, transparent 75%, #d6d3cb 75%);
background-size: 24px 24px;
background-position: 0 0, 0 12px, 12px -12px, -12px 0;
background-color: #e8e5dd;
```

### Invariants

- `bg-black`, `#000`, `#0a0a0a`, `#111` → NEVER use. All dark fills replaced with checkerboard or `bg-bg`.
- `#10b981` (emerald), cyan, neon green → NEVER use. Old brand color. Use `accent` token.
- `#fff` / pure white → avoid as page background. Use `bg` token. White is acceptable in showcase demo backgrounds.
- Gray text (`#666`) on colored backgrounds → use `text-dim` token which is warm-tinted stone.
- Error states: `border-red-300 bg-red-50 text-red-700` (light-mode friendly). NEVER `red-900/40`, `red-950/10`, `red-400/80`.
- Success states: `border-green-300 bg-green-50 text-green-700`. NEVER `accent`-colored success messages.
- On accent-colored backgrounds, use `text-white`. NEVER `text-bg`.

## Typography

Loaded in `src/app.html` via Google Fonts.

```typescript
interface FontStack {
  sans:    '"DM Sans", ui-sans-serif, system-ui, sans-serif';    // --font-sans — body, UI
  display: '"Instrument Serif", Georgia, serif';                  // --font-display — headings
}

interface FontWeights {
  sans:    [300, 400, 500, 600];  // light, regular, medium, semibold
  display: [400];                 // regular only; ital@0;1 loaded
}
```

### Tailwind Class Mapping

| Role | Tailwind Classes | Used For |
|---|---|---|
| Page headings (h1, h2) | `font-display italic` | All section headings on marketing + app pages |
| Price amounts | `font-display italic text-3xl` | Pricing cards |
| Wordmark "celstate" | `font-display italic tracking-tight` | NavBar brand text |
| Body text | (default, no class needed) | Paragraphs, descriptions |
| Feature titles | `text-sm font-semibold text-text` | Feature list h3 |
| Section labels | `text-[11px] font-medium uppercase tracking-[0.08em] text-accent` | SectionLabel component |
| Metadata labels | `text-[10px] font-medium uppercase tracking-[0.06em] text-dim` | MonoLabel, stats, badges |
| UI controls | `text-[10px] font-medium tracking-wide uppercase` | Buttons in showcase, selectors |

### Invariants

- `font-mono` → NEVER use anywhere in the UI. Removed during reskin. Was the #1 AI-slop tell.
- `Inter` → NEVER use. Removed. Replaced with DM Sans.
- Monospace labels → replaced with `font-medium` body font at small sizes.
- `font-light` on headings → NEVER. Use `font-display italic` instead.
- `tracking-[0.15em]` or `tracking-[0.2em]` → too wide (old monospace values). Use `tracking-[0.06em]` to `tracking-[0.08em]`.

## Component Inventory

### Primitives (`src/lib/components/ui/`)

```typescript
interface SectionLabel {
  props: { text: string };
  classes: "text-[11px] font-medium uppercase tracking-[0.08em] text-accent";
  // No dot indicator. No icon. Text only.
}

interface MonoLabel {
  props: { children: Snippet; class?: string };
  classes: "text-[10px] font-medium uppercase tracking-[0.06em] text-dim";
  // Name is legacy — no longer uses font-mono.
}

interface PageContainer {
  props: { children: Snippet; max?: "4xl" | "6xl"; class?: string };
  // max="6xl" → marketing pages (default)
  // max="4xl" → app pages
  // Always px-6 horizontal padding.
}

interface NavBar {
  props: { children?: Snippet; compact?: boolean; max?: "4xl" | "6xl" };
  // compact=false → marketing (py-4, larger logo)
  // compact=true  → app (py-3, smaller logo)
  // max must match corresponding PageContainer max for alignment.
  // Fixed position, z-50, border-b, bg-bg/90 backdrop-blur.
  // Wordmark uses font-display italic.
}

interface Logo {
  props: { class?: string };
  // SVG: 4 corner brackets + checkerboard pattern fill.
  // Uses currentColor — inherits text color.
}
```

### Domain Components (`src/lib/components/`)

```typescript
interface HeroShowcase {
  // Interactive background switcher demonstrating transparency.
  // Background options: Transparent (checker), White, Dark, Terracotta, Mesh.
  // Auto-cycles backgrounds on mount (1.8s delay, 1.4s intervals).
  // Stops auto-cycle on user interaction.
  backgrounds: ["Transparent", "White", "Dark", "Terracotta", "Mesh"];
  // INVARIANT: "Emerald" was removed. Use warm-palette options only.
}

interface ZoomInspector {
  props: {
    src: string;
    alt: string;
    label: string;
    zoomLevel?: number;   // default: 3
    loupeSize?: number;   // default: 150
    focusPoint?: { x: number; y: number }; // default: {0.5, 0.3}
    lazy?: boolean;       // default: false
  };
  // Container uses light checkerboard background (zoom-checker-bg class).
  // Loupe background-color: #e8e5dd (NOT #000).
  // Loupe shadow: subtle for light mode — rgba(0,0,0,0.15) ring, rgba(0,0,0,0.12) glow.
}

interface CheckerboardPreview {
  props: { src: string; alt: string; class?: string };
  // Light checkerboard + corner bracket SVGs (accent/40).
  // Image fade-in on load (opacity + scale-95 → scale-100, 500ms).
}

interface GenerationCard {
  // Three status states: generating | complete | failed.
  // Failed state: border-red-300 bg-red-50, text-red-600.
  // Download buttons: text-[10px] font-medium uppercase tracking-[0.06em].
}

interface GeneratingIndicator {
  // Scanner grid: 8×6 cells, pulse animation.
  // Pulse animation: NO box-shadow glow (removed for light mode).
  // Status text: font-medium (NOT font-mono).
}

interface PromptInput {
  // Terminal prompt indicator: "→" with font-semibold text-accent. NOT ">_".
  // Submit button: text-[11px] font-medium uppercase tracking-[0.06em].
  // Error text: text-red-600 (NOT text-red-400/70).
}

interface AspectRatioSelector {
  // Ratio labels: text-[10px] font-medium leading-none tracking-[0.04em].
  // Active state: border-accent/60 bg-accent/10 text-accent.
}
```

## Layout Patterns

### Section Spacing (Marketing Page)

```typescript
// Varied spacing prevents monotony — NEVER use uniform py-20 on all sections.
const SECTION_SPACING: Record<string, string> = {
  hero:     "pt-24 pb-16 sm:pt-28 sm:pb-20 lg:pt-32 lg:pb-24",
  edge:     "py-24",
  features: "py-16",
  pricing:  "py-24",
  footer:   "py-10",
};
```

### Section Header Pattern

All sections follow this structure with consistent gaps:

```
SectionLabel (mb-4)        ← accent-colored uppercase label
  ↓
Heading (mb-3 if desc)     ← font-display italic
  ↓
Description (optional)     ← text-sm text-dim
  ↓
(mb-10 container)          ← gap before section content
```

### Button Hierarchy

```typescript
type ButtonTier = "primary" | "secondary" | "ghost";

const BUTTON_CLASSES: Record<ButtonTier, string> = {
  primary:   "rounded-full bg-accent text-white hover:bg-accent/90",
  secondary: "rounded-full border border-border text-text hover:border-accent hover:text-accent",
  ghost:     "rounded-full border border-border text-dim hover:border-accent hover:text-text",
};

// INVARIANTS:
// - All buttons use rounded-full (pill shape). NEVER square/sharp corners.
// - Maximum 2 button styles per pricing row: ghost + primary.
// - On accent backgrounds: text-white. NEVER text-bg.
```

### Toggle/Tab Controls

```css
/* Active state */
border-accent/60 bg-accent/10 text-accent

/* Inactive state */
border-border text-dim hover:border-accent/30 hover:text-text
```

## Motion

### Hero Entrance (Marketing Page)

```css
/* Staggered fade-in on page load */
animation: hero-fade-in 0.7s cubic-bezier(0.25, 1, 0.5, 1) both;

/* Stagger delays: 100ms increments */
/* child 1: 0.1s, child 2: 0.2s, child 3: 0.3s, child 4: 0.4s */
/* Showcase (right column): 0.35s */

@keyframes hero-fade-in {
  from { opacity: 0; transform: translateY(12px); }
  to   { opacity: 1; transform: translateY(0); }
}
```

### Invariants

- All motion respects `@media (prefers-reduced-motion: reduce)` → `animation: none`.
- Easing: `cubic-bezier(0.25, 1, 0.5, 1)` (ease-out-quart). NEVER bounce or elastic.
- Background transitions: `duration-700 ease-[cubic-bezier(0.25,1,0.5,1)]`.
- Opacity transitions: `duration-300`.
- Image load-in: `duration-500` (opacity + scale).

## Anti-Patterns (Prohibited)

```typescript
const PROHIBITED = [
  "font-mono",                          // monospace labels
  "Inter",                              // generic AI font
  "bg-black", "#000", "#0a0a0a",        // dark backgrounds
  "#10b981", "emerald",                 // old brand color
  "font-light on headings",            // use font-display italic
  "tracking-[0.15em]",                 // too wide — old monospace spacing
  "tracking-[0.2em]",                  // too wide — old monospace spacing
  "border-red-900/40",                 // dark-mode error styling
  "bg-red-950/10",                     // dark-mode error styling
  "text-red-400",                      // dark-mode error text
  "text-bg on accent buttons",         // use text-white
  "bg-accent/10 on buttons",           // muddy tinted fill — use ghost or solid
  "rounded-full bg-accent dot indicators", // green dots removed
  "gap-px bg-border grid trick",       // dark-mode pricing pattern
  "gradient text",                     // decorative, not meaningful
  "glassmorphism / glow borders",      // AI-slop fingerprint
  "identical 3-col card grids",        // use 2-col text layout for features
  "neon accents on dark backgrounds",  // old palette
  "box-shadow glow on animations",     // removed for light mode
] as const;
```

## File Map

```
src/app.html                           ← Google Fonts, no dark class on <html>
src/app.css                            ← @theme tokens, :root vars, base styles
src/lib/components/ui/SectionLabel     ← section eyebrow label
src/lib/components/ui/MonoLabel        ← metadata label (misnamed, no mono)
src/lib/components/ui/NavBar           ← fixed nav, font-display wordmark
src/lib/components/ui/PageContainer    ← max-width container (4xl | 6xl)
src/lib/components/Logo                ← SVG logo (corner brackets + checker)
src/lib/components/HeroShowcase        ← interactive bg switcher
src/lib/components/ZoomInspector       ← loupe zoom on checkerboard
src/lib/components/CheckerboardPreview ← static checkerboard image display
src/lib/components/GenerationCard      ← generation result card (3 states)
src/lib/components/GeneratingIndicator ← in-progress scanner animation
src/lib/components/PromptInput         ← prompt input with ref upload
src/lib/components/AspectRatioSelector ← ratio picker with shape swatches
```

## Lessons Learned

1. **Checkerboard hardcoded colors are the #1 dark-mode remnant risk.** Three components define checkerboard patterns in `<style>` blocks with hardcoded hex values. When changing themes, these MUST be updated manually — they do not use CSS custom properties.

2. **`font-mono` was used as a crutch for "technical feel."** It was applied to 12+ distinct UI elements. The fix was systematic: replace every instance with `font-medium` at the same or similar size. No element actually needed monospace rendering.

3. **Emerald green (`#10b981`) was embedded in component data, not just CSS tokens.** The `HeroShowcase` background options array contained `from-emerald-900 to-emerald-600` as a hardcoded Tailwind class string. Token changes in `app.css` did not propagate to these inline values.

4. **Dark-mode error states (`red-950`, `red-900`) are invisible on light backgrounds.** Every error/failed state across 5+ files needed individual updates. Error color classes are not tokenized — they are inline Tailwind classes.

5. **`text-bg` for button text on accent backgrounds breaks when switching from dark to light mode.** In dark mode, `bg` is near-black, so `text-bg` produces dark text on a colored button (correct). In light mode, `bg` is cream, producing cream text on an orange button (invisible). Always use `text-white` on accent-filled buttons.

6. **Section spacing uniformity (`py-20` everywhere) creates visual monotony.** Varied spacing (`py-16`, `py-24`, `pt-32 pb-24`) creates rhythm. The spacing values must be intentionally different per section.

7. **The pricing button hierarchy should use at most 2 tiers.** Three different button styles in one row (ghost, tinted, solid) creates confusion. Correct: ghost for non-primary, solid for primary. No intermediate "tinted border" style.
