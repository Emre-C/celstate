# Image Generation — Difference Matting

## Facts (decision record)

```text
INVARIANT: Active generation path does NOT read GEMINI_API_KEY.
INVARIANT: Image model calls use Vertex AI (Generative AI on Vertex), not Gemini Developer API HTTP key flow.
FACT:    Migration driver: Gemini Developer API returned HTTP 503 (capacity / demand); Vertex chosen as production target.
FACT:    Client: @google/genai, GoogleGenAI({ vertexai: true, project, location }), Node actions only ("use node").
FACT:    Module path src/convex/lib/gemini.ts is historical naming; runtime config via readGeminiRuntimeConfigFromEnv().
FACT:    referenceMaxSizeBytes = 7 MiB aligns with Vertex inline image payload limits (was 10 MiB pre-Vertex).
FACT:    Chat thinkingConfig: ThinkingLevel.LOW, includeThoughts: false (reduces latency vs prior HIGH).
```

## Vertex env resolution (`readGeminiRuntimeConfigFromEnv`)

Authoritative duplicate: [`docs/runbooks/VERTEX-AI-CONVEX-SETUP.md`](../runbooks/VERTEX-AI-CONVEX-SETUP.md).

```typescript
// src/convex/lib/gemini.ts — project + location + auth (paraphrase; keep in sync with source)

credentials := readServiceAccountCredentialsFromEnv(env):
  IF trim(VERTEX_AI_SERVICE_ACCOUNT_JSON) → parseServiceAccountJson → return
  ELSE IF VERTEX_AI_CLIENT_EMAIL AND VERTEX_AI_PRIVATE_KEY →
    { client_email, private_key, project_id: VERTEX_AI_PROJECT_ID || GOOGLE_CLOUD_PROJECT || GCLOUD_PROJECT, ... }
  ELSE → undefined

project :=
  VERTEX_AI_PROJECT_ID || GOOGLE_CLOUD_PROJECT || GCLOUD_PROJECT || credentials?.project_id || ""
IF project === "" → throw Error("VERTEX_AI_PROJECT_ID or GOOGLE_CLOUD_PROJECT environment variable not set")

location := VERTEX_AI_LOCATION || GOOGLE_CLOUD_LOCATION || "global"

googleAuthOptions :=
  IF credentials → { credentials, projectId: project }
  ELSE IF GOOGLE_APPLICATION_CREDENTIALS → { keyFilename, projectId: project }
  ELSE → undefined
```

## `createChatSession` model config (not in GENERATION_CONFIG)

```typescript
// src/convex/lib/gemini.ts — fixed for image task
ai.chats.create({
  model: GENERATION_CONFIG.model,
  config: {
    responseModalities: ["IMAGE"],
    imageConfig: { aspectRatio, imageSize },
    thinkingConfig: {
      thinkingLevel: ThinkingLevel.LOW,
      includeThoughts: false,
    },
  },
});
```

## Overview

Celstate generates transparent-background images using **difference matting** — a mathematically exact technique that recovers perfect alpha channels without ML post-processing. This is Celstate's core technical differentiation.

Raster passes use **Vertex AI** (Generative AI on Vertex), not the Gemini Developer API (`GEMINI_API_KEY`). Convex Node actions call `@google/genai` with `vertexai: true` and service-account auth; configuration is documented in [`docs/runbooks/VERTEX-AI-CONVEX-SETUP.md`](../runbooks/VERTEX-AI-CONVEX-SETUP.md). Implementation module: `src/convex/lib/gemini.ts` (historical filename; client is Vertex-backed).

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

| Mode | Input | Pass 1 behavior | Trigger |
|------|-------|-----------------|---------|
| **Text-only** | `prompt` | `sendMessage(whiteBgPrompt)` | `referenceStorageIds` absent or empty |
| **Style reference** | `prompt` + `referenceStorageIds[]` | `sendMessageWithImages` / multi-image path | one or more reference `Id<'_storage'>` |

In style-reference mode, the user uploads image(s) before generating. References steer the Vertex-hosted image model toward style, palette, and aesthetic; the prompt controls subject and composition. The matte pipeline is identical in both modes — only Pass 1 prompt construction and model calls differ.

### Reference image upload flow

```
Client: file → generateUploadUrl() → POST to upload URL → storageId
Client: requestGeneration(prompt, referenceStorageIds?: Id<'_storage'>[])
Worker: load each id via ctx.storage.get → base64 → GeminiImageResult[]   // TS type in gemini.ts; requests go to Vertex
```

- `generateUploadUrl` — authenticated mutation; returns a Convex storage upload URL. Also rate-limits upload URL issuance per user (rolling window).
- Upload via `POST` with `Content-Type` matching file MIME type
- Collect `storageId`(s) into `referenceStorageIds` (max count and bytes: `GENERATION_CONFIG.maxReferenceImages`, `referenceMaxSizeBytes`)
- Reference images are validated against storage metadata (type, size, dedup) in `requestGeneration` before credits are deducted

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

## Pipeline architecture

### `generations` row — workflow fields (`src/convex/schema.ts`)

```typescript
interface GenerationWorkflowFields {
  status: "generating" | "complete" | "failed";
  stage?: "white_background" | "black_background" | "finalizing";
  lastProgressAt?: number;
  stageStartedAt?: number;
  stalledAlertedAt?: number;
  retryCount?: number;
  whiteBgRetryCount?: number;
  blackBgRetryCount?: number;
  finalizeRetryCount?: number;
  creditRefundedAt?: number;
  creditsCost: number;
  // ... storage ids, prompt, timestamps: see schema
}
```

### Durable scheduling invariants

```text
INVARIANT: requestGeneration mutation atomically: deduct credits, insert row, schedule first internal action.
INVARIANT: Next stage scheduled from mutation after prior stage success (not long single action for whole pipeline).
INVARIANT: Retries scheduled from mutations (scheduleStageRetry); maxRetriesPerPass/maxRetriesTotal/maxFinalizeRetries bound fan-out.
INVARIANT: creditRefundedAt set once on refund; failGeneration paths check before refund.
```

### Step 1: Credit check and deduction

- Atomic check + deduct in `requestGeneration` mutation
- Enforces `maxConcurrentGenerations` (index-based lookup via `by_user_status`) and credit balance

### Step 2: Create generation record

- Insert row `status: "generating"`, initial `stage: "white_background"`
- `referenceStorageIds` stored when non-empty
- Visible immediately to reactive queries

### Step 3: Schedule stage workers (scheduler)

- `requestGeneration` schedules `internal.generation.generateWhiteBackground`
- Each stage completion schedules the next: `white_background` → `black_background` → `finalizing`
- Implementation: `src/convex/generations.ts` (`scheduleGenerationStage`), `src/convex/lib/generationWorkflow.ts`, actions in `src/convex/generation.ts` (`"use node"`)

### Step 4: Dual-pass Vertex inference (stages `white_background` / `black_background`)

**`white_background`**

- Text-only or multi-reference prompts (`src/convex/lib/prompts.ts`)
- `createChatSession` + `readGeminiRuntimeConfigFromEnv()` → `GoogleGenAI` with `vertexai: true`
- Corner purity validation (`whiteBgMinMean`, `bgMaxStdDev`, `cornerPatchSize`)
- On validation/model failure: `scheduleStageRetry` with exponential backoff (`retryBaseDelayMs`, `maxRetriesPerPass`) until exhausted, then terminal failure

**`black_background`**

- Same chat session (multi-turn); black-bg prompt + white image as input
- Corner purity (`blackBgMaxMean`, `bgMaxStdDev`)
- Same retry policy as white pass

### Step 5: Finalize (`finalizing`)

- Loads white + black from storage; optional resize when dimensions mismatch; aspect ratio guard may throw
- Difference matte (`src/convex/lib/matte.ts`)
- Deterministic transparent QA (`src/convex/lib/transparentQa.ts`) runs before finalization using:
  - conservative coverage gates on `alphaPresence` and `borderTransparencyRatio`, tuned from persisted live dev QA samples so grossly opaque or edge-cropped outputs rerender before shipping
  - white/black recomposition residuals
  - multithreshold topology persistence for cutouts and holes
  - shell-based halo / spill analysis around the silhouette
- QA outcomes are `pass`, `retry_black`, `retry_white_and_black`, or `review`
- Only `pass` proceeds to PNG encoding, optimization (`optimizeForWeb`), and `completeGeneration`
- QA-triggered retries target the upstream source-pass stage instead of re-running finalization alone

### Step 6: Storage and completion

- Stores result, optimized variant, intermediate passes as in schema
- Record → `status: "complete"`

## Execution lifecycle (stages, timing, progress)

### Stage graph

```text
requestGeneration → schedule generateWhiteBackground
  → recordWhiteBackgroundSuccess → schedule generateBlackBackground
    → recordBlackBackgroundSuccess → schedule finalizeGeneration
      → completeGeneration | failGeneration
```

### `GenerationStage` and row fields

- `stage`: `white_background` | `black_background` | `finalizing` while `status === "generating"`; cleared on terminal states
- `lastProgressAt`: updated on meaningful progress (stage transitions, status text updates, attempt start)
- `stageStartedAt`: set when a stage **action** begins (`markStageAttemptStarted`); cleared when leaving the stage or on completion/failure
- Per-stage retry counters: `whiteBgRetryCount`, `blackBgRetryCount`, `finalizeRetryCount`; aggregate `retryCount` increments on `scheduleStageRetry`

### Attempt start

At the start of each of `generateWhiteBackground`, `generateBlackBackground`, `finalizeGeneration`:

```text
RUN internal.generations.markStageAttemptStarted({ generationId, stage })
  PRECONDITION: status === "generating" AND stage matches current row
  POST: lastProgressAt = now, stageStartedAt = now
```

### Duration definitions (used by ops telemetry)

```typescript
// Wall-clock since generation row created
generationDurationMs = max(0, now - createdAt)

// Wall-clock since start of current attempt (stage)
attemptDurationMs = max(0, now - (stageStartedAt ?? lastProgressAt ?? createdAt))
```

### User-facing status text

- `updateStatusMessage` sets `statusMessage`, `lastProgressAt = now`, and **`stalledAlertedAt = undefined`** (re-enables stall warning if a long sub-step updates message)

## Progress, stall, and hard timeout

Crons:

- `crons.interval("cleanup stale generations", { minutes: 1 }, internal.generations.cleanupStaleGenerations)`
- `crons.interval("cleanup expired upload url issues", { hours: 1 }, ...)` — garbage-collects rate-limit tracking table for upload URL issuance
- `crons.interval("cleanup orphaned reference uploads", { hours: 1 }, ...)` — deletes unreferenced image uploads older than 1 hour

Constants (`GENERATION_CONFIG`): `stalledGenerationWarningMs` (5 min), `staleGenerationTimeoutMs` (15 min).

Progress clock: `lastProgressAt = lastProgressAt ?? createdAt` for comparisons.

```text
FOR each row with status == "generating"
  lastProgress = lastProgressAt ?? createdAt

  IF lastProgress < now - staleGenerationTimeoutMs
    → failGenerationRecord with user timeout copy + internal reason including timeout ms
    → credit refund if not already refunded

  ELSE IF NOT stalledAlertedAt AND lastProgress < now - stalledGenerationWarningMs
    → PATCH stalledAlertedAt = now
    → emit generation_stalled ops event + schedule stall alert (see observability doc)
```

Single cron iteration: timeout branch runs before stall branch for the same row. Across ticks, a generation may emit one stall warning then later fail on hard timeout if progress never advances.

## Failure handling and refunds

### Terminal failure path

`failGeneration` / `failGenerationRecord`:

```text
PRECONDITION: current row exists AND status === "generating" (else no-op)
POST: status = "failed", error, completedAt, stage cleared, credit refund if not creditRefundedAt
```

### User-visible vs internal error

```text
generations.error           ← user-facing string (stable product copy)
ops events + alerts error   ← internalError ?? user-facing string
```

Pipeline uses `failGeneration({ error: USER_FACING, internalError?: RAW })` so support and webhooks see the underlying reason without exposing it in the UI row.

## Error handling (product)

| Failure | Detection | Recovery |
|---------|-----------|----------|
| Vertex response has no image inline data | `extractImageFromResponse` in `gemini.ts` | Retry per stage policy |
| Impure background | Corner validation | Retry per `maxRetriesPerPass` / `maxFinalizeRetries`, then fail |
| Dimension / aspect issues | Decode + `validateDimensionMatch` / resize path | Resize or fail with internal error |
| Stage exhausted retries | `handleStageFailure` | `failGeneration` with generic user message + internal error |
| No progress (hard timeout) | Cron vs `staleGenerationTimeoutMs` | Fail + refund + internal timeout reason |
| Stall (warning only) | Cron vs `stalledGenerationWarningMs` | Ops event + optional webhook; generation may still complete |

On terminal failure: credits refunded (unless already refunded), `status → failed`, `error` stores user-facing text.

## Observability (cross-reference)

[`observability.md`](./observability.md) — `generationOpsEvents` schema, event-type → producer matrix, `OPS_ALERT_*` webhooks, `scheduleGenerationAlert` → `sendGenerationAlert` / `recordAlertEvent`, `internal.ops.getGenerationOpsSummary` / `internal.ops.getRecentGenerationOpsFeed`, rollup helpers (`summarizeGenerationOpsEvents`). This file stays limited to **pipeline and lifecycle**; durable ops `error` column semantics and alert preconditions are specified there.

**PostHog** — client `posthog-js` captures `generation_started`, `generation_completed`, and `generation_failed` (subscription-driven on the app page); Convex uses `@posthog/convex` for purchase and sign-up server events, not per-stage generation worker events. Inventory and env vars: observability doc.

SvelteKit **Sentry** (client/server errors, not Convex workers): see observability doc **Scope boundary**.

## Configuration (`src/convex/lib/config.ts`)

Authoritative values live in `GENERATION_CONFIG`. Excerpt:

```typescript
model: "gemini-3.1-flash-image-preview",
defaultAspectRatio: "1:1",
defaultImageSize: "1K",
responseModalities: ["IMAGE"],

maxRetriesPerPass: 1,
maxRetriesTotal: 0,
maxFinalizeRetries: 1,
retryBaseDelayMs: 1500,
stalledGenerationWarningMs: 5 * 60 * 1000,
staleGenerationTimeoutMs: 15 * 60 * 1000,

cornerPatchSize: 32,
whiteBgMinMean: 245,
blackBgMaxMean: 10,
bgMaxStdDev: 5,

alphaFloorThreshold: 3,
alphaCeilThreshold: 252,

referenceMaxSizeBytes: 7 * 1024 * 1024,
maxReferenceImages: 14,
maxConcurrentGenerations: 3,
maxPromptLength: 20_000,
```

## Performance

| Step | Expected Latency |
|------|------------------|
| Credit check + deduction | < 50ms |
| Vertex inference — white-bg pass | 3–8s |
| Vertex inference — black-bg pass | 3–8s |
| Difference matte (1K×1K) | < 100ms |
| PNG encoding | < 200ms |
| Storage upload | < 200ms |
| **Total** | **7–17s** |

## Components

- `src/convex/lib/gemini.ts` — Vertex AI via `@google/genai` (`vertexai: true`); `createChatSession`, `readGeminiRuntimeConfigFromEnv`
- `src/convex/lib/generationWorkflow.ts` — Stage scheduling helpers, retry policy wiring
- `src/convex/lib/prompts.ts` — Prompt templates (white/black bg, text-only and reference variants)
- `src/convex/lib/validation.ts` — Background purity validation
- `src/convex/lib/matte.ts` — Difference matte engine
- `src/convex/generation.ts` — Node actions per stage (`referenceStorageIds`, Vertex chat session, matte, optimize)
- `src/convex/generations.ts` — Mutations (`requestGeneration`, `generateUploadUrl`), queries (`getByUserWithUrls`)
- `src/lib/components/PromptInput.svelte` — Terminal-style input with optional reference image upload
- `src/lib/components/GenerationCard.svelte` — Result display with reference badge
- `src/lib/components/GeneratingIndicator.svelte` — Animation during generation
- `src/lib/components/CheckerboardPreview.svelte` — Transparency preview


# Image Optimization & Dual-Resolution Downloads

## Overview

Every generated image is stored in two resolutions:
1. **Higher Resolution** — Original matte output (1024×1024, 2–8MB)
2. **Standard Resolution** — Optimized for web (≤1024px, 50–200KB)

## Why Optimization Matters

The difference matte pipeline produces high-fidelity 32-bit RGBA PNGs that are large (2–8MB for 1024×1024). This creates problems:

- **Landing page showcase**: Need images <500KB
- **User downloads**: Not everyone needs full-resolution originals for web use

## Optimization Approach

Using `sharp` (libvips) for resize + palette quantization:

```typescript
// src/convex/lib/optimize.ts
export async function optimizeForWeb(pngBuffer: Buffer): Promise<Buffer> {
  return sharp(pngBuffer)
    .resize(optimizedMaxDimension, optimizedMaxDimension, {
      fit: "inside",
      withoutEnlargement: true,
    })
    .png({
      palette: true,
      quality: optimizedPngQuality,
      effort: optimizedPngEffort,
      colours: optimizedPngColours,
      dither: optimizedPngDither,
    })
    .toBuffer();
}
```

### Technique

- **Resize**: Scale to fit within 1024×1024, preserve aspect ratio, never upscale
- **Quantize**: Convert to 8-bit indexed PNG (256 colors) with alpha support
- **Dither**: Floyd-Steinberg dithering (0.5) for smooth gradients
- **Metadata**: Stripped to reduce file size

### Alpha Channel Preservation

Critical: Optimization must not degrade transparency quality. The palette quantization handles semi-transparent pixels correctly — this is the product promise.

## Configuration

```typescript
// src/convex/lib/config.ts
optimizedMaxDimension: 1024,
optimizedPngQuality: 80,
optimizedPngEffort: 7,
optimizedPngColours: 256,
optimizedPngDither: 0.5,
```

## Pipeline Integration

After difference matte produces `finalPng`:

```typescript
// src/convex/generation.ts — finalizeGeneration (after finalizePipeline)
const optimizedPng = await optimizeForWeb(result.finalPng);
const optimizedBlob = new Blob([new Uint8Array(optimizedPng)], { type: "image/png" });
const optimizedStorageId = await ctx.storage.store(optimizedBlob);

await ctx.runMutation(internal.generations.completeGeneration, {
  generationId: args.generationId,
  resultStorageId,        // Higher resolution
  optimizedStorageId,     // Standard resolution
  // ...
});
```

## Schema Extension

```typescript
// src/convex/schema.ts
generations: defineTable({
  resultStorageId: v.optional(v.id("_storage")),       // Original (higher res)
  optimizedStorageId: v.optional(v.id("_storage")),  // Optimized (web)
  whiteBgStorageId: v.optional(v.id("_storage")),     // Debug: white pass
  blackBgStorageId: v.optional(v.id("_storage")),     // Debug: black pass
  referenceStorageIds: v.optional(v.array(v.id("_storage"))),  // Style references (optional)
  referenceStorageId: v.optional(v.id("_storage")),            // Legacy single reference
  // ...
}),
```

`v.optional` ensures backward compatibility with generations created before Phase 2.

## User Interface

### Dual Download Buttons

```svelte
<!-- src/lib/components/GenerationCard.svelte -->
{#if optimizedUrl}
  <button onclick={() => handleDownload(optimizedUrl!, '')}>
    Standard
  </button>
  <button onclick={() => handleDownload(resultUrl!, '-hires')}>
    Hi-Res
  </button>
{:else}
  <button onclick={() => handleDownload(resultUrl!, '')}>
    Download
  </button>
{/if}
```

### Filename Convention

- Standard: `celstate-{slug}.png`
- Hi-Res: `celstate-{slug}-hires.png`

### Fallback for Legacy Generations

Older generations (pre-Phase 2) don't have `optimizedStorageId`. UI shows single "Download" button that downloads the original.

## File Size Results

| Subject | Original | Optimized | Reduction |
|---------|----------|-----------|-----------|
| Simple logo | 2MB | 50KB | 97.5% |
| Character | 4MB | 120KB | 97% |
| Complex scene | 8MB | 200KB | 97.5% |

Target: <500KB — consistently achieved.

## Performance Impact

- **Sharp resize + quantize**: ~200-400ms per image
- **Total generation increase**: <500ms
- Minimal compared to Vertex inference latency (7–17s)

## Intermediate Images

White and black background passes are also stored (`whiteBgStorageId`, `blackBgStorageId`). These enable:
- Quality analysis when matte looks wrong
- Prompt tuning (inspect model output vs. prompt)
- Future matte algorithm improvements without re-generation

All images follow the same 30-day retention policy.

# Generation History & Storage

## Overview

Every generated image is stored and accessible to the user. The system maintains a complete generation history with real-time updates.

## Real-Time Queries

Convex reactive queries power the generation workspace:

```typescript
// src/convex/generations.ts - getByUserWithUrls
export const getByUserWithUrls = query({
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) return [];
    
    const generations = await ctx.db
      .query("generations")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .order("desc")
      .collect();

    return Promise.all(
      generations.map(async (gen) => ({
        ...gen,
        resultUrl: gen.resultStorageId 
          ? await ctx.storage.getUrl(gen.resultStorageId) 
          : null,
        optimizedUrl: gen.optimizedStorageId 
          ? await ctx.storage.getUrl(gen.optimizedStorageId) 
          : null,
        referenceUrl: gen.referenceStorageId
          ? await ctx.storage.getUrl(gen.referenceStorageId)
          : null,
      }))
    );
  },
});
```

### Reactive Updates

Frontend subscribes to query:

```svelte
<!-- src/routes/(app)/app/+page.svelte -->
const generations = useQuery(api.generations.getByUserWithUrls, {});
```

- New generations appear immediately when requested
- Status updates in real-time as worker progresses
- Completion updates appear without page refresh

## Generation Statuses

| Status | Meaning | UI |
|--------|---------|-----|
| `generating` | Worker is running | Animated indicator |
| `complete` | Image ready | Checkerboard preview + download |
| `failed` | Error occurred | Error message + retry prompt |

## Schema

```typescript
// src/convex/schema.ts
generations: defineTable({
  userId: v.id("users"),
  prompt: v.string(),
  status: v.union(
    v.literal("generating"),
    v.literal("complete"),
    v.literal("failed")
  ),
  statusMessage: v.optional(v.string()),       // "Generating white background pass..."
  resultStorageId: v.optional(v.id("_storage")),
  whiteBgStorageId: v.optional(v.id("_storage")),
  blackBgStorageId: v.optional(v.id("_storage")),
  optimizedStorageId: v.optional(v.id("_storage")),
  referenceStorageId: v.optional(v.id("_storage")),
  referenceStorageIds: v.optional(v.array(v.id("_storage"))),
  creditsCost: v.number(),
  aspectRatio: v.string(),
  createdAt: v.number(),
  completedAt: v.optional(v.number()),
  error: v.optional(v.string()),
  generationTimeMs: v.optional(v.number()),
  retryCount: v.optional(v.number()),
  dimensionMismatch: v.optional(v.boolean()),
}).index("by_user", ["userId", "createdAt"])
  .index("by_user_status", ["userId", "status"])
```

## Storage Files

Each generation stores up to 5 files:

| File | Purpose | Retention |
|------|---------|-----------|
| `resultStorageId` | Higher resolution PNG | 30 days |
| `optimizedStorageId` | Web-optimized PNG | 30 days |
| `whiteBgStorageId` | Debug: white-bg pass | 30 days |
| `blackBgStorageId` | Debug: black-bg pass | 30 days |
| `referenceStorageId` | User-uploaded style reference (optional) | 30 days |

## UI Components

### GenerationCard

Three-state card component. Accepts optional `referenceUrl` prop.

```svelte
{#if status === 'generating'}
  <GeneratingIndicator {prompt} {statusMessage} {createdAt} />
{:else if status === 'complete' && resultUrl}
  <CheckerboardPreview src={resultUrl} alt={prompt} />
  <!-- Reference badge: shown when referenceUrl is present -->
  {#if referenceUrl}
    <img src={referenceUrl} alt="Ref" /> <MonoLabel>Ref</MonoLabel>
  {/if}
  <button onclick={() => handleDownload(optimizedUrl ?? resultUrl)}>
    Download
  </button>
{:else if status === 'failed'}
  <span>Generation failed</span>
  <p>{error}</p>
{/if}
```

### CheckerboardPreview

CSS-based checkerboard pattern reveals transparency:

```svelte
<!-- src/lib/components/CheckerboardPreview.svelte -->
<div class="checkerboard">
  <img src={src} alt={alt} class="fade-in" />
</div>

<style>
.checkerboard {
  background-image: 
    linear-gradient(45deg, #ccc 25%, transparent 25%),
    linear-gradient(-45deg, #ccc 25%, transparent 25%),
    linear-gradient(45deg, transparent 75%, #ccc 75%),
    linear-gradient(-45deg, transparent 75%, #ccc 75%);
  background-size: 16px 16px;
  background-position: 0 0, 0 8px, 8px -8px, -8px 0px;
}
</style>
```

### GeneratingIndicator

Animated "pixel scanner" during generation:

```svelte
<!-- src/lib/components/GeneratingIndicator.svelte -->
<div class="pixel-grid">
  {#each Array(64) as _, i}
    <div class="pixel" style="animation-delay: {i * 20}ms" />
  {/each}
</div>
```

## Retention Policy

Current product retention target: images are stored for a minimum of 30 days.

- Users can view history within retention window
- Users can re-download any image within retention window
- After 30 days: images purged (future: scheduled cleanup cron)

## Future: Cleanup Cron

Not yet implemented. Planned:

```typescript
// src/convex/crons.ts - future
export const purgeExpiredImages = internalCronJob(
  cron.schedule("0 0 * * *"), // Daily
  async (ctx) => {
    const threshold = Date.now() - 30 * 24 * 60 * 60 * 1000;
    const expired = await ctx.db
      .query("generations")
      .withIndex("by_created", (q) => q.lt("createdAt", threshold))
      .collect();
    
    for (const gen of expired) {
      // Delete storage files
      // Delete generation record
    }
  }
);
```
