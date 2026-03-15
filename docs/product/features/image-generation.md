# Image Generation — Difference Matting

## Overview

Celstate generates transparent-background images using **difference matting** — a mathematically exact technique that recovers perfect alpha channels without ML post-processing. This is Celstate's core technical differentiation.

## How It Works

### The Math

Given a foreground pixel `F` with alpha `α`, composited over background `B`:

```
C = F·α + B·(1 - α)
```

We generate the **same subject twice** — once on pure white (`B = 255`), once on pure black (`B = 0`):

- On white: `C_w = F·α + 255·(1 - α)`
- On black: `C_b = F·α`

Solving for alpha and foreground:

```
α = 1 - (C_w - C_b) / 255    // per-channel, take max for robustness
F = C_b / α                   // recover true foreground color (when α > 0)
```

This is exact — not approximate. It handles:
- **Fully opaque pixels**: `C_w ≈ C_b` → `α ≈ 1`
- **Fully transparent pixels**: `C_w ≈ 255, C_b ≈ 0` → `α ≈ 0`
- **Semi-transparent pixels** (glass, smoke, thin hair): fractional `α` recovered exactly

## Generation Modes

| Mode | Input | Pass 1 Behavior | Trigger |
|------|-------|------------------|---------|
| **Text-only** | `prompt` | `sendMessage(whiteBgPrompt)` | No `referenceStorageId` |
| **Style reference** | `prompt` + `referenceStorageId` | `sendMessageWithImage(whiteBgPromptWithReference, referenceImage)` | `referenceStorageId` present |

In style-reference mode, the user uploads an image before generating. The reference image guides Gemini's output toward the reference's visual style, color palette, and aesthetic while the prompt controls subject and composition. The matte pipeline is identical in both modes — only the Pass 1 prompt construction and Gemini call differ.

### Reference Image Upload Flow

```
Client: file → generateUploadUrl() → POST to upload URL → storageId
Client: requestGeneration(prompt, referenceStorageId)
Worker: ctx.storage.get(referenceStorageId) → base64 → GeminiImageResult
```

- `generateUploadUrl` — authenticated mutation, returns a Convex storage upload URL
- Upload via `POST` with `Content-Type` header matching the file MIME type
- Response JSON contains `storageId` passed to `requestGeneration`

### Reference Prompt Variants (`src/convex/lib/prompts.ts`)

| Function | Used When |
|----------|-----------|
| `buildWhiteBgPrompt(prompt)` | Text-only, first attempt |
| `buildWhiteBgRetryPrompt(prompt)` | Text-only, retry |
| `buildWhiteBgPromptWithReference(prompt)` | Style reference, first attempt |
| `buildWhiteBgRetryPromptWithReference(prompt)` | Style reference, retry |
| `buildBlackBgPrompt()` | Always (mode-independent) |
| `buildBlackBgRetryPrompt()` | Always (mode-independent) |

Reference prompts append: "Use the attached reference image as a style and subject guide. Match its visual style, color palette, and aesthetic while following the prompt description."

## Pipeline Architecture

### Step 1: Credit Check & Deduction
- Atomic check + deduct in single mutation
- Prevents double-spend under concurrency

### Step 2: Create Generation Record
- Insert row with status `generating`
- `referenceStorageId` stored if provided
- Immediately visible to reactive queries

### Step 3: Schedule Worker
- Convex scheduler runs `generateWorker` internal action
- Worker args: `{ generationId, prompt, referenceStorageId? }`
- If `referenceStorageId` present: load from `ctx.storage.get()`, decode to base64 `GeminiImageResult`

### Step 4: Dual-Pass Generation

**Pass 1 (White Background)**
- **Text-only**: `session.sendMessage(whiteBgPrompt)`
- **Style reference**: `session.sendMessageWithImage(whiteBgPromptWithReference, referenceImage)`
- Validate corner patches for purity (mean > 245, stddev < 5)
- Retry up to 2x with reinforced prompt if validation fails

**Pass 2 (Black Background)**
- Same Gemini chat session (preserves subject identity)
- Send black-bg prompt + white-bg image as reference
- Validate corner patches for purity (mean < 10, stddev < 5)
- Retry up to 2x if validation fails
- Mode-independent: identical in text-only and style-reference modes

### Step 5: Dimension Handling
- If dimensions differ: resize larger to match smaller (bilinear interpolation)
- If aspect ratios fundamentally differ: retry from Pass 1

### Step 6: Difference Matte
- Decode both PNGs to pixel buffers
- Apply per-pixel alpha solve
- Apply edge refinement (alpha < 3 → 0, alpha > 252 → 255)
- Encode final RGBA PNG

### Step 7: Storage & Completion
- Store final PNG to Convex storage
- Store intermediate white/black PNGs (for debugging)
- Update generation record to `complete`

### Step 8: Optimization (Phase 2)
- Generate optimized web variant
- Store both variants

## Error Handling

| Failure | Detection | Recovery |
|---------|-----------|----------|
| Gemini returns text | No inlineData in response | Retry |
| Impure background | Corner validation fails | Retry with reinforced prompt (max 2x) |
| Dimension mismatch | Post-decode comparison | Resize to match; log for telemetry |
| Rate limit (429) | HTTP status | Exponential backoff |
| Server error (5xx) | HTTP status | Retry up to 3x |
| Action timeout | 5+ minutes in `generating` | Cron marks failed + refunds credits |

On any failure:
- Credits refunded via mutation
- Status → `failed`
- Error message stored for diagnostics

## Configuration (`src/convex/lib/config.ts`)

```typescript
model: "gemini-3.1-flash-image-preview",
defaultAspectRatio: "1:1",
defaultImageSize: "1K",
responseModalities: ["IMAGE"],

maxRetriesPerPass: 2,
maxRetriesTotal: 3,
retryBaseDelayMs: 1000,

cornerPatchSize: 32,
whiteBgMinMean: 245,
blackBgMaxMean: 10,
bgMaxStdDev: 5,

alphaFloorThreshold: 3,
alphaCeilThreshold: 252,

referenceMaxSizeBytes: 10 * 1024 * 1024, // 10 MB
```

## Performance

| Step | Expected Latency |
|------|------------------|
| Credit check + deduction | < 50ms |
| Gemini Turn 1 (white-bg) | 3–8s |
| Gemini Turn 2 (black-bg) | 3–8s |
| Difference matte (1K×1K) | < 100ms |
| PNG encoding | < 200ms |
| Storage upload | < 200ms |
| **Total** | **7–17s** |

## Components

- `src/convex/lib/gemini.ts` — Gemini API client (`sendMessage`, `sendMessageWithImage`)
- `src/convex/lib/prompts.ts` — Prompt templates (white/black bg, text-only and reference variants)
- `src/convex/lib/validation.ts` — Background purity validation
- `src/convex/lib/matte.ts` — Difference matte engine
- `src/convex/generation.ts` — Orchestrator action (branches on `referenceStorageId`)
- `src/convex/generations.ts` — Mutations (`requestGeneration`, `generateUploadUrl`), queries (`getByUserWithUrls`)
- `src/lib/components/PromptInput.svelte` — Terminal-style input with optional reference image upload
- `src/lib/components/GenerationCard.svelte` — Result display with reference badge
- `src/lib/components/GeneratingIndicator.svelte` — Animation during generation
- `src/lib/components/CheckerboardPreview.svelte` — Transparency preview
