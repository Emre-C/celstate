# Assisted Mode — Frontend Design Specification

> Companion to `ASSISTED-MODE-SPEC.md`. This document defines the visual design, interaction patterns, motion choreography, and component-level specifications for the Assisted Mode UI. It is the authoritative source for how this feature looks and feels.

## 1. Design Direction

**Tone**: Warm editorial — the assisted flow should feel like a thoughtful creative collaborator, not a wizard or chatbot. The UI replaces the prompt input inline, as if the interface itself is asking a question. No modal, no overlay, no step counter, no progress bar.

**Alive principle**: The assisted flow is the single highest-touch interaction in the app. Every phase transition should feel deliberate and smooth. Loading states should feel like the system is *thinking*, not *broken*.

**Differentiation**: The 3 option buttons are the hero element. They should feel like editorial choices — weighted, considered, worth selecting — not generic radio buttons or checkboxes.

## 2. Toggle Component

### Placement
Renders below `AspectRatioSelector`, above the helper text row. Same horizontal alignment as the aspect ratio buttons.

### Visual Specification

```
┌─────────────────────────────────────────────────────────────┐
│ [Aspect ratio selector row]                                 │
│                                                             │
│ mt-3                                                        │
│                                                             │
│ ┌──────────────────┐                                        │
│ │ ✦  Assisted       │  ← toggle button                     │
│ └──────────────────┘                                        │
│                                                             │
│ mt-2                                                        │
│                                                             │
│ [Helper text row: credits / Enter ↵]                        │
└─────────────────────────────────────────────────────────────┘
```

### Toggle States

| State | Classes | Icon |
|-------|---------|------|
| **Inactive** | `border border-border text-dim hover:border-accent/30 hover:text-text` | `✦` (4-point star) in `text-dim`, transitions to `text-text` on hover |
| **Active** | `border border-accent/60 bg-accent/10 text-accent` | `✦` in `text-accent` |
| **Disabled** | `border border-border text-dim/40 cursor-not-allowed opacity-40` | `✦` in `text-dim/40` |

### Toggle Button Markup

```svelte
<button
  type="button"
  onclick={toggleAssisted}
  disabled={hasReferences || disabled}
  title={hasReferences ? 'Assisted mode is not available with reference images' : assistedEnabled ? 'Disable assisted mode' : 'Get help refining your prompt'}
  class="group flex items-center gap-1.5 border px-2 py-1.5 transition-all duration-150
    {assistedEnabled
      ? 'border-accent/60 bg-accent/10 text-accent'
      : 'border-border text-dim hover:border-accent/30 hover:text-text'}
    disabled:opacity-40 disabled:cursor-not-allowed"
>
```

### Icon: 4-Point Star (✦)

SVG inline, 10×10 viewBox. Matches the aesthetic of the `→` terminal indicator — a small symbolic glyph, not an emoji or illustration.

```svg
<svg class="h-2.5 w-2.5" viewBox="0 0 10 10" fill="currentColor">
  <path d="M5 0C5 0 5.8 3.2 7 4.2C8.2 5 10 5 10 5C10 5 8.2 5 7 5.8C5.8 6.8 5 10 5 10C5 10 4.2 6.8 3 5.8C1.8 5 0 5 0 5C0 5 1.8 5 3 4.2C4.2 3.2 5 0 5 0Z" />
</svg>
```

### Typography
- Label text: `text-[10px] font-medium leading-none tracking-[0.04em]` — matches AspectRatioSelector button labels exactly.
- Label content: `Assisted`

## 3. Phase Transitions — Motion Choreography

All transitions use the design system's canonical easing: `cubic-bezier(0.25, 1, 0.5, 1)` (ease-out-quart).

### input → loading_question (300ms)

The prompt input area crossfades to the loading state. Uses CSS `grid-template-rows` for height animation (no layout thrashing).

```css
/* Container uses CSS grid for smooth height transitions */
.assisted-panel-container {
  display: grid;
  grid-template-rows: 0fr;
  transition: grid-template-rows 300ms cubic-bezier(0.25, 1, 0.5, 1);
}
.assisted-panel-container.open {
  grid-template-rows: 1fr;
}
.assisted-panel-container > .inner {
  overflow: hidden;
}
```

The prompt input row fades out (`opacity 1→0`, 150ms), then the assisted panel fades in (`opacity 0→1`, 200ms, 100ms delay). Total perceived transition: ~300ms.

### loading_question → answering (300ms)

The loading indicator (thinking dots) crossfades to the question + options. The 3 option buttons enter with a subtle stagger:
- Option 1: 0ms delay
- Option 2: 60ms delay
- Option 3: 120ms delay
- Other row: 180ms delay
- Skip link: 240ms delay

Each element: `opacity 0→1, translateY(6px)→translateY(0)`, 300ms, ease-out-quart.

Total stagger cap: 240ms + 300ms = 540ms. Under the 500ms "entrance animation" guideline but acceptable since the user is actively watching and the stagger creates a reading cadence.

### answering → loading_rewrite (200ms)

The selected option briefly pulses (`scale(1.02)` → `scale(1)`, 150ms) to confirm selection, then the entire answering panel crossfades to the rewriting loader. Faster than entrance because user has committed — don't make them wait.

### loading_rewrite → done (immediate)

On completion, the enhanced prompt is passed to `handleGenerate`. The assisted panel exits with a reverse of the entrance: fade out (150ms) and grid-rows collapse (200ms). The prompt input reappears in its normal state.

### Failure fallback (any → done)

On failure, show a brief inline message before auto-proceeding:
- Message fades in (200ms)
- Visible for 3 seconds
- Message fades out (200ms)
- Auto-proceeds to generation with original prompt

### Reduced Motion

```css
@media (prefers-reduced-motion: reduce) {
  .assisted-panel-container {
    transition: none;
  }
  .option-button, .assisted-panel {
    animation: none;
    opacity: 1;
    transform: none;
  }
}
```

## 4. Loading States

### Thinking Indicator (loading_question & loading_rewrite)

Three pulsing dots in a row — NOT a spinner, NOT a skeleton. The dots suggest *thinking* rather than *loading*. Matches the editorial tone.

```
┌─────────────────────────────────────────────────────────────┐
│                                                             │
│     ●  ●  ●                                                 │
│     Refining your prompt…                                   │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

#### Dots Specification
- 3 circles, `w-1.5 h-1.5` (6px), `bg-accent/60`
- Gap: `gap-1` (4px)
- Animation: sequential pulse (`opacity 0.3→1→0.3`), 1.4s cycle, 200ms stagger between dots
- Easing: `ease-in-out`

#### Status Text
- `text-[10px] font-medium uppercase tracking-[0.06em] text-dim` — MonoLabel style
- Phase-specific copy:
  - `loading_question`: `Thinking…`
  - `loading_rewrite`: `Refining your prompt…`

#### Container
- Same border styling as the prompt input: `border border-border`
- Same vertical padding: `py-3.5`
- Horizontally centered content
- Min-height matches prompt input row to prevent layout shift

## 5. Answering Phase — The Hero Interaction

### Layout

```
┌─────────────────────────────────────────────────────────────┐
│ border border-border                                        │
│                                                             │
│  px-4 pt-4                                                  │
│                                                             │
│  [Question text — text-sm text-text leading-relaxed]        │
│                                                             │
│  mt-3                                                       │
│                                                             │
│  ┌─────────────┐ ┌─────────────┐ ┌────────────┐            │
│  │  Option 1   │ │  Option 2   │ │  Option 3  │            │
│  └─────────────┘ └─────────────┘ └────────────┘            │
│  gap-2, flex-wrap                                           │
│                                                             │
│  mt-2                                                       │
│                                                             │
│  ┌─ Other: ─────────────────────────────────────────────┐   │
│  │ [freeform input__________________________________]   │   │
│  └──────────────────────────────────────────────────────┘   │
│                                                             │
│  mt-3 pb-3                                                  │
│                                                             │
│  Skip — use my prompt as-is                                 │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

### Question Text
- `text-sm text-text leading-relaxed`
- No heading treatment — it's a question, not a section title
- Max width: natural flow within the container

### Option Buttons (×3)

The 3 preset options are the primary interaction. They should feel like editorial choices — weighted toggles, not generic buttons.

#### Default State
```
border border-border text-dim text-[13px] leading-snug
px-3 py-2.5
hover:border-accent/30 hover:text-text
transition-all duration-150
rounded-none (sharp corners — matches prompt input aesthetic)
```

#### Hover State
```
border-accent/30 text-text
```

#### Selected State (momentary — triggers submission)
```
border-accent/60 bg-accent/10 text-accent
scale(1.02) → scale(1) over 150ms
```

#### Layout
- `flex flex-wrap gap-2`
- Buttons grow to fill: `flex-1 min-w-[120px]`
- On narrow screens (<400px), buttons stack to `flex-col` with `w-full`

#### Typography
- `text-[13px] font-medium leading-snug`
- Slightly larger than the metadata labels but smaller than body text — these are *choices*, they need legibility but shouldn't dominate the question text.

### "Other" Freeform Row

A single row combining a label and input, visually quieter than the preset options.

```
┌─ border border-border ─────────────────────────────────────────┐
│  [Other:]  [freeform input_____________________________] [→]   │
│  text-dim   text-sm text-text                            accent │
│  px-3 py-2.5                                                   │
└────────────────────────────────────────────────────────────────┘
```

#### "Other" Label
- `text-[10px] font-medium uppercase tracking-[0.06em] text-dim` — MonoLabel style
- Sits inline-start of the input

#### Freeform Input
- `flex-1 bg-transparent text-sm text-text outline-none placeholder:text-dim/60`
- Placeholder: `Type your own answer…`
- Same styling as the main prompt input field

#### Submit Arrow
- Only visible when freeform input has content
- `text-accent` arrow icon (same SVG as Generate button arrow)
- `opacity 0→1` transition when input becomes non-empty

#### Submission
- Enter key in freeform input → submit with `selectedOptionIndex: 3`
- Click arrow → same

### Skip Link

```
text-[10px] font-medium uppercase tracking-[0.06em] text-dim
hover:text-accent
transition-colors duration-150
```

Copy: `Skip — use my prompt as-is`

No underline. No arrow. It's a quiet escape hatch, not a call to action. Left-aligned below the Other row.

## 6. Failure Message

Inline within the assisted panel container. Replaces the loading/answering content.

```
┌─────────────────────────────────────────────────────────────┐
│ border border-border                                        │
│                                                             │
│  text-dim text-[10px] font-medium uppercase tracking-[0.06em]
│  Couldn't generate suggestions — using your prompt directly │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

- Uses `text-dim` — NOT error red. This is a graceful fallback, not an error state. The user still gets their generation.
- Visible for 3 seconds, then auto-proceeds.
- Fade in 200ms, visible 3s, fade out 200ms.

## 7. Prompt Input Integration

### When Assisted Panel Is Showing

The following elements are **hidden** (not removed from DOM — hidden via the grid-rows trick):
- The prompt text input row (the `<input>` with `→` indicator and Generate button)
- The file upload button is hidden as part of the input row

The following elements **remain visible**:
- Reference image previews (above — but assisted mode is disabled with references, so this is academic)
- Zero-credit purchase bridge (above — independent concern)
- AspectRatioSelector (below the assisted panel — user can still change ratio during the flow)
- Toggle button (below AspectRatioSelector — shows as active)
- Helper text row (below toggle)

### Structural Change to PromptInput.svelte

The prompt input row and the assisted panel are **mutually exclusive** within the same container position. They swap via the grid-rows animation.

```
<div class="prompt-input-wrapper">
  [reference previews — if any]
  [zero-credit bridge — if needed]

  {#if assistedPhase !== 'input'}
    <!-- Assisted panel (loading/answering/failure) -->
    <div class="assisted-panel-container open">...</div>
  {:else}
    <!-- Normal prompt input row -->
    <div class="flex items-center border ...">...</div>
  {/if}

  [AspectRatioSelector]
  [Assisted toggle]       ← NEW
  [Helper text row]
</div>
```

### Helper Text Updates

When assisted mode is active and a flow is in progress, the right-side helper text changes:

| Phase | Right helper text |
|-------|------------------|
| `input` (assisted on) | `Enter ↵ to start assisted flow` |
| `input` (assisted off) | `Enter ↵ to generate` (unchanged) |
| `loading_question` | *(hidden)* |
| `answering` | *(hidden)* |
| `loading_rewrite` | *(hidden)* |

The left-side credit text remains unchanged in all phases.

## 8. Responsive Behavior

### Breakpoints

| Viewport | Behavior |
|----------|----------|
| **≥640px (sm)** | Option buttons in a row (`flex-wrap`), 3 across if they fit |
| **<640px** | Option buttons stack vertically, full width |
| **<400px** | Same as <640px, slightly reduced padding (`px-3` → `px-2.5`) |

### Touch Targets
- Option buttons: min 44px height (ensured by `py-2.5` + `text-[13px]` + border = ~44px)
- Skip link: wrapped in sufficient padding for 44px tap target
- Toggle button: same dimensions as AspectRatioSelector buttons (already ≥44px)

## 9. Keyboard Navigation

### Tab Order (answering phase)
1. Option 1
2. Option 2
3. Option 3
4. "Other" freeform input
5. "Other" submit arrow (if visible)
6. Skip link

### Focus Indicators
All interactive elements use `:focus-visible` with `outline: 2px solid var(--color-accent); outline-offset: 2px;`.

### Keyboard Shortcuts
- **Enter** on any option button → select that option (submit)
- **Enter** in freeform input → submit with freeform answer
- **Escape** during answering phase → equivalent to Skip

## 10. PostHog Analytics Touchpoints

| User Action | Event | Properties |
|-------------|-------|------------|
| Toggle assisted on/off | `assisted_mode_toggled` | `{ enabled: boolean }` |
| Submit prompt with assisted on | `assisted_session_started` | `{ prompt_length: number }` |
| Question appears | `assisted_question_shown` | `{ session_id, question_length }` |
| Click option 1/2/3 | `assisted_option_selected` | `{ session_id, option_index: 0-2, is_freeform: false }` |
| Submit freeform answer | `assisted_option_selected` | `{ session_id, option_index: 3, is_freeform: true }` |
| Click Skip | `assisted_session_skipped` | `{ session_id }` |
| Failure fallback | `assisted_session_failed` | `{ session_id, error }` |
| Enhanced prompt used for generation | `assisted_prompt_used` | `{ session_id, original_length, enhanced_length }` |

## 11. CSS Custom Properties

No new CSS custom properties needed. All values use existing design tokens:
- `--color-bg`, `--color-text`, `--color-dim`, `--color-accent`, `--color-border`
- Font families via Tailwind: default sans (DM Sans)
- Easing: hardcoded `cubic-bezier(0.25, 1, 0.5, 1)` in component `<style>` blocks

## 12. Accessibility

- Toggle button has `aria-pressed` reflecting state
- Option buttons use `role="group"` wrapper with `aria-label="Answer options"`
- Loading states have `aria-live="polite"` on the status text
- Failure message has `role="status"`
- Skip link is a `<button>`, not an `<a>` (it doesn't navigate)
- Escape key during answering → skip (keyboard escape hatch)
- All animated elements respect `prefers-reduced-motion: reduce`

## 13. Visual Summary — All States

```
INACTIVE TOGGLE        ACTIVE TOGGLE          DISABLED TOGGLE
┌──────────────┐      ┌──────────────┐       ┌──────────────┐
│ ✦ Assisted   │      │ ✦ Assisted   │       │ ✦ Assisted   │
│ border-border│      │ bg-accent/10 │       │ opacity-40   │
│ text-dim     │      │ text-accent  │       │ text-dim/40  │
└──────────────┘      └──────────────┘       └──────────────┘

LOADING STATE                    ANSWERING STATE
┌─────────────────────┐         ┌──────────────────────────────┐
│                     │         │ What style are you going for?│
│    ●  ●  ●          │         │                              │
│    Thinking…        │         │ [Minimal] [Detailed] [Bold]  │
│                     │         │ Other: [_______________] [→] │
└─────────────────────┘         │                              │
                                │ Skip — use my prompt as-is   │
                                └──────────────────────────────┘

FAILURE STATE
┌──────────────────────────────────────────────────────────────┐
│ Couldn't generate suggestions — using your prompt directly   │
└──────────────────────────────────────────────────────────────┘
```
