# Pre‑Rendered Interactive Cinematics (PRIC)
## An Agent‑First Platform for AAA‑Quality Interactivity on Mobile via Generative Video Sprites

**Version:** v0.1 (distilled)  
**Core idea:** Replace real‑time rendering with *unlimited pre‑rendering*, then ship those renders as **state-machine-driven video sprites** with **mathematically correct alpha**—so AI agents can author living, cinematic UI components in one call.

---

## 1) Executive Summary

AI agents can now write most application code, but they cannot reliably create *emotionally legible*, *high‑fidelity*, *alive* UI motion. Today, an agent that wants “a nervous button” outputs rigid SVG/CSS/tweened animations.

**We are building the missing actuator for agents:** an API + runtime that turns **intent → interactive component**.

- **Input (agent intent):**
  ```json
  { "intent": "A nervous button", "interaction": "Click to calm down" }
  ```
- **Output (drop‑in component cartridge):**
  - `manifest.json` (state machine + layout + events + a11y)
  - video sprite assets with perfect alpha (loops + transitions)
  - consumable via:
    ```tsx
    <GenerativeActor source={require("./nervous_button_manifest.json")} />
    ```

This enables cinematic-quality interactivity on mobile without GPU-heavy real-time 3D, and without designers hand-authoring motion systems.

---

## 2) The Problem

### 2.1 Agents can build apps, but UI “acting” is missing
Agents can generate screens, layout, and business logic. But when they need *expressive motion* (“nervous,” “proud,” “gentle,” “ominous”), they hit a wall:

- Real-time 3D is too expensive for battery and dev complexity.
- Lottie/Rive require human-designed assets and authoring workflows.
- CSS/SVG animations are rigid and rarely feel cinematic.

### 2.2 Video compositing fails on real UI backgrounds
Generated motion (video) typically breaks when composited over arbitrary UI:

- white halos
- broken soft shadows
- glass/smoke/hair edges look wrong
- background removers fail on partial transparency

So even if we can generate beautiful motion, it doesn’t reliably *integrate* into UI.

---

## 3) The Insight: “Unlimited Pre‑Rendering”

Mobile devices can **play** high-fidelity content far more efficiently than they can **render** it.

**We replace “runtime rendering” with “runtime playback of pre-rendered states.”**

- UI is treated as a **state machine video player**
- each state is a short loop (or one-shot transition clip)
- interactivity is handled by deterministic state transitions
- the runtime is lightweight; the compute moves to generation time

This is the modern equivalent of:
- pre-rendered sprites (Donkey Kong Country)
- pre-rendered backgrounds (Resident Evil era)
- FMV branching (but without the “on-rails” limitation)

The difference now: generation makes “asset explosion” cheap, and our alpha workflow makes compositing correct.

---

## 4) The Key Technical Unlock: Mathematical Alpha Extraction (Difference Matting)

We solve the hardest compositing problem: **partial transparency** (glass, smoke, soft shadows).

### Workflow
1. **Generate on White** (`#FFFFFF`)
2. **Edit to Black** (`#000000`) while keeping the subject identical
3. **Compute alpha mathematically** from the pixel differences

This yields **true alpha**, including soft edges and translucency, enabling the same asset to look correct over *any* UI theme/background.

**This is the catalytic moat**: other approaches rely on segmentation/background removal that collapses partial transparency.

---

## 5) What We’re Building: A Two‑Part System (Cartridge + Console)

> You cannot sell “discs” if users don’t have the “player.”

### Part A — The Cartridge Factory (API)
Generates:
- video sprite assets (loops + transitions)
- `manifest.json` describing:
  - state graph
  - clip metadata
  - event bindings
  - layout + hit regions
  - accessibility
  - fallbacks and performance variants

### Part B — The Console Player (Client Runtime)
A React Native library (`@ai-media/client`) that:
- loads a manifest (“cartridge”)
- preloads likely next clips for zero-latency swaps
- plays loops/transitions with deterministic boundaries
- exposes a standard event surface (`onPress`, `onHover`/`onFocus`, etc.)
- degrades gracefully (reduced motion, low-memory, unsupported codecs)

---

## 6) Current Implementation Status

### Built: Media EngineFactory (asset pipeline foundation)
- **`media_engine.py`**: auto-bootstrapping orchestrator intended as a single tool call for agents
- **Generator**: dual-pass generation (white/black), proper SDK byte protocol (`types.Part.from_bytes`)
- **Processor**:
  - Difference Matting math (`alpha = 1 - diff/255`)
  - mobile optimizations (density scaling, 512px loops, etc.)
- **Proof**: “Forest Spirit” asset demonstrating breathing/float with clean compositing

### Next: Move from “asset factory” to “interactive component API”
- manifest generator
- runtime component
- agent-facing tooling and templates

---

## 7) Product Definition

### 7.1 The Primitive We Sell: “GenerativeActor”
A **living UI primitive** authored by an agent and rendered as video sprites.

- looks alive in idle
- transitions on interaction
- consistent identity across states
- composited correctly on any background
- drop-in for mobile apps

### 7.2 “Intent → Component” Contract (non-negotiable)
Users/agents should never stitch files manually.

**Success definition:** one call produces a component that “just works” with:
- correct sizing + anchor
- tap behavior + hit regions
- accessibility labels/roles
- deterministic state transitions
- zero-flicker swaps on real devices

---

## 8) Architecture Overview

```mermaid
flowchart LR
  A[Agent / LLM] -->|Intent + Constraints| B[Cartridge Factory API]
  B --> C[Dual-pass Generation: White + Black]
  C --> D[Difference Matting + Encoding + Optimization]
  D --> E[manifest.json + assets]
  E -->|CDN / bundle| F[@ai-media/client Runtime]
  F --> G[<GenerativeActor /> in React Native]
  G --> H[User Interaction Events]
  H --> F
```

---

## 9) Manifest v0 (Strict, Boring, Lintable)

A good manifest turns “generative video” into “a component primitive.”

### 9.1 Goals for v0
- deterministic playback
- minimal fields to ship real components
- validated via JSON schema
- stable across platforms

### 9.2 Suggested Schema (conceptual)
```json
{
  "version": "0.1",
  "id": "nervous_button_v1",
  "intrinsics": {
    "size": { "width": 256, "height": 96 },
    "anchor": { "x": 0.5, "y": 0.5 },
    "safePadding": { "top": 8, "right": 12, "bottom": 8, "left": 12 }
  },
  "hitRegions": [
    { "type": "roundedRect", "x": 0, "y": 0, "w": 256, "h": 96, "r": 18 }
  ],
  "states": {
    "idle": {
      "clip": "idle_loop.webp",
      "loop": true,
      "fps": 24,
      "loopStartFrame": 0,
      "loopEndFrame": 47
    },
    "calm": {
      "clip": "calm_loop.webp",
      "loop": true,
      "fps": 24
    }
  },
  "transitions": [
    {
      "from": "idle",
      "to": "calm",
      "on": "press",
      "clip": "idle_to_calm.webp",
      "play": "once",
      "exitAt": { "type": "end" }
    },
    {
      "from": "calm",
      "to": "idle",
      "on": "longPress",
      "clip": "calm_to_idle.webp",
      "play": "once",
      "exitAt": { "type": "end" }
    }
  ],
  "preload": {
    "idle": ["idle_to_calm.webp", "calm_loop.webp"],
    "calm": ["calm_to_idle.webp", "idle_loop.webp"]
  },
  "accessibility": {
    "role": "button",
    "label": "Continue",
    "reducedMotion": {
      "states": {
        "idle": { "clip": "idle_static.png" },
        "calm": { "clip": "calm_static.png" }
      }
    }
  },
  "fallbacks": {
    "static": "idle_static.png",
    "lowEnd": {
      "states": { "idle": { "clip": "idle_loop_256.webp" } }
    }
  }
}
```

### 9.3 v0 simplifications (recommended)
- allow transitions to cut only at **end-of-clip** initially (frame-accurate cuts later)
- constrain to a small set of events: `press`, `release`, `longPress`, `focus`, `blur`, `disabled`

---

## 10) The `<GenerativeActor />` Runtime (React Native “Console”)

### Responsibilities
1. Parse + validate manifest
2. Resolve platform-specific asset formats
3. Preload “next likely” clips (double-buffering)
4. Manage state machine transitions deterministically
5. Expose a consistent RN interface (Pressable-like)
6. Enforce budgets + graceful degradation

### Runtime requirements (MVP)
- **Zero-latency swap** (preload + instant source switch)
- **No flicker** and no “black frame” between clips
- **Predictable loop behavior**
- **Reduced motion support**
- **Telemetry hooks**: decode time, dropped frames, memory

### Platform format strategy (pragmatic)
- iOS: HEVC with alpha if viable; otherwise animated WebP
- Android: animated WebP alpha; fallback to alternate encoding or static assets
- universal fallback: PNG static

---

## 11) Generation Strategy: Templates Before Arbitrary Graphs

To avoid combinatorial explosion and unreliable LLM-invented topologies, generation should be **template-driven** in early phases.

### ButtonTemplate v0 (example topology)
- `idle_loop` (required)
- `press_down` (one-shot)
- `release_up` (one-shot)
- `pressed_loop` (optional)
- `disabled_loop` (optional)
- `error_shake` (optional)

**The generator fills visuals; the structure stays fixed** so the runtime is stable, testable, and lintable.

---

## 12) “Lost Techniques” as Modifiers (Not Product Scope)

Your “revived historical techniques” map cleanly into modifier buckets that can be layered onto archetypes.

### Modifier Buckets
- **Idle Life:** boiling line, micro-variation, secondary motion  
- **Continuity Transitions:** match cuts, smear frames, acting choices  
- **Environmental Integration:** smoke, soft shadows, glass, FX passes (enabled by difference matting)  
- **Scene Compositing (later):** multiplane stacks, ambient crowds, destructible layers  

This keeps the product surface area small while preserving the creative ceiling.

---

## 13) Component Archetypes (MVP Library Targets)

Start with primitives agents actually need:

1. **ButtonActor** (CTA)
2. **ToggleActor** (binary)
3. **ChipActor** (filters/tags)
4. **LoaderActor** (progress/ambient)
5. **ToastActor** (enter/exit)
6. **Mascot/AssistantActor** (demo magnet, onboarding)

Each archetype ships with:
- a fixed topology template
- generation constraints
- manifest schema guarantees
- runtime behaviors + accessibility defaults

---

## 14) Roadmap (Phased Execution)

### Phase 0 — Prove the Runtime Loop (not the art)
**Build**
- Manifest v0 + JSON schema + linter
- `<GenerativeActor />` basic playback + swapping
- preload strategy (likely-next)
- 1 archetype: ButtonActor

**Exit criteria**
- 3 different “button intents” generated and used in a RN demo app
- no manual fix-ups
- smooth on mid-tier Android

---

### Phase 1 — Minimum Useful Library
**Build**
- ToggleActor, LoaderActor, ToastActor
- caching (memory + disk), CDN/bundling conventions, versioning
- accessibility/reduced motion variants
- agent tool definitions + examples (structured prompts)

**Exit criteria**
- an agent can assemble onboarding + settings screen using only your components

---

### Phase 2 — Reliability + AAA Consistency
**Build**
- idle variants (anti-repetition)
- acting choices (multiple takes)
- stronger continuity constraints (silhouette/pose locks)
- automated QA: loop seam detection, alpha halo checks, shimmer checks

**Exit criteria**
- components look premium consistently, not occasionally

---

### Phase 3 — Composed Scenes (Cinematic UI)
**Build**
- `ActorStack` for layered compositing + parallax hooks
- branching micro-cinematics for key moments
- ambient crowds/extra packs

**Exit criteria**
- “cinematic home screen” without turning into a custom game engine

---

## 15) Moat and Defensibility

1. **Difference Matting workflow**  
   Portable partial transparency that survives arbitrary UI backgrounds (glass, smoke, shadows).
2. **Manifest standard**  
   First-mover advantage: “Lottie for generative cinematic components,” but stateful and agent-authored.
3. **Agent-first design**  
   Not a human animation tool; an actuator for autonomous builders.
4. **Taste + execution**  
   The real product is not just generation—it’s shipping *useful archetypes* with cinematic motion grammar.

---

## 16) Key Risks (and Mitigations)

- **Android alpha/video variability** → strict format negotiation + fallbacks + device test matrix
- **Frame-accurate cuts** → v0 uses end-of-clip boundaries; add frame-accurate sync later
- **Asset bloat** → enforce budgets (resolution/fps/duration), auto-downscale, caching/eviction
- **Generation inconsistency** → template topologies + reference frames + continuity constraints
- **Product creep (infinite states)** → finite templates, on-demand branch expansion later

---

## 17) North-Star Metrics

**Runtime quality**
- time-to-first-frame
- swap latency (must feel instant)
- dropped frames / stutter rate
- memory footprint per actor

**Asset quality**
- seam score (loop smoothness)
- alpha halo score (edge correctness)
- drift score (identity consistency across states)

**Developer/agent success**
- “one call → usable component” success rate
- % of components requiring manual intervention (target: ~0)

---

## 18) One-Paragraph Pitch (for the doc cover)

In 2025, AI agents can build entire apps, but they can’t make those apps feel alive. We’re building the missing actuator: an agent-first API and React Native runtime that turns intent like “a nervous button that calms when tapped” into a drop-in interactive component. We achieve AAA-quality motion on mobile by replacing real-time rendering with unlimited pre-rendered video sprites and by extracting mathematically correct alpha (including soft shadows, glass, and smoke) using a dual-pass difference-matting workflow. The result is cinematic, emotionally expressive UI—delivered as a manifest-defined state machine that plays with zero-latency swaps and full accessibility.

---

If you want, I can produce two additional artifacts derived from this “master doc” (so you can use them immediately):
1) **A strict Manifest v0 JSON Schema + example manifests** for ButtonActor/ToggleActor/LoaderActor.  
2) **A product/engineering PRD** with concrete milestones, acceptance tests, device matrix, and performance budgets.