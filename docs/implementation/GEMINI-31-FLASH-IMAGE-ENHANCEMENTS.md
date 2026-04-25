# Gemini 3.1 Flash Image Pipeline Enhancements

## Status Review (2026-04-15)

This document remains in `docs/implementation` because the enhancement bundle described here is only **partially implemented** in the current codebase.

Already shipped in the current product:
- Multi-reference uploads and generation requests using `referenceStorageIds` (up to 14 images).
- Full 14-ratio aspect-ratio support, including `1:4`, `4:1`, `1:8`, and `8:1`.
- Vertex-backed chat sessions that already pass a fixed `imageSize` of `1K` by default.
- A fixed low-thinking configuration (`ThinkingLevel.LOW`, `includeThoughts: false`).

Still not shipped:
- No user-selectable resolution tiers (`Web` / `Full` / `Ultra HD`) in the request flow or download UI.
- No `imageSize`, `thinkingLevel`, `searchGrounded`, or `groundingMetadata` fields on `generations`.
- No Google Search or Google Image Search grounding, and no attribution component/UI.
- No user-facing thinking-level toggle.
- No credit or pricing differentiation tied to higher-resolution output.
- Retry repair still uses the local validation-driven repair prompt builder, not a second LLM pass.

Source-of-truth implementation references:
- `src/convex/lib/config.ts`
- `src/convex/lib/gemini.ts`
- `src/convex/generation.ts`
- `src/convex/generations.ts`
- `src/lib/components/PromptInput.svelte`
- `src/lib/components/GenerationCard.svelte`

New: Enhancement from Tommy
- Changes to previously generated images

New: Enhancement
- When something fails (like generating the black background) lets put another LLM in the loop to improve the prompt based on the failure for the retry

> **Model**: `gemini-3.1-flash-image-preview` only. No other models are in scope.
>
> **Source**: [Gemini Image Generation Docs](https://ai.google.dev/gemini-api/docs/image-generation) (verified March 2026)

---

## Table of Contents

1. [Enhancement 1: Three-Tier Resolution System](#enhancement-1-three-tier-resolution-system)
2. [Enhancement 2: Expanded Aspect Ratio Support](#enhancement-2-expanded-aspect-ratio-support)
3. [Enhancement 3: Thinking Level Control](#enhancement-3-thinking-level-control)
4. [Enhancement 4: Google Search Grounding](#enhancement-4-google-search-grounding)
5. [Enhancement 5: Multi-Reference Image Support](#enhancement-5-multi-reference-image-support)
6. [Enhancement 6: Grounding with Google Image Search](#enhancement-6-grounding-with-google-image-search)
7. [Credit & Pricing Impact](#credit--pricing-impact)
8. [Schema & Storage Changes](#schema--storage-changes)
9. [Migration Strategy](#migration-strategy)

---

## Enhancement 1: Three-Tier Resolution System

### Problem

We currently have two download tiers:

| Current Tier | What it actually is |
|---|---|
| **Standard** | `optimizeForWeb()` — resized to max 1024px, palette-quantized via Sharp |
| **Hi-Res** | The raw 1K output from `imageSize: "1K"` (default) — ~1024×1024 |

"Hi-Res" is misleading. It's the same 1K image before optimization. Users get no real resolution upgrade. Gemini 3.1 Flash supports `512`, `1K`, `2K`, and `4K` native output via the `imageSize` config parameter.

### Proposed Tiers

| Tier | Label | `imageSize` | Post-Processing | Use Case | Output Tokens |
|---|---|---|---|---|---|
| **Web** | "Web" | `1K` | Sharp resize to max 1024px + palette quantization (current `optimizeForWeb`) | Social media, websites, fast load times | 1,120 |
| **Presentation** | "Full" | `2K` | None (raw output) | Presentations, documents, print-ready where size isn't critical | 1,120 |
| **Ultra HD** | "Ultra HD" | `4K` | None (raw output) | Photography replacements, large-format print, maximum definition | 2,000 |

### Key Detail — Token Cost Difference

`512` and `1K` both cost **1,120 output tokens** per image. `4K` costs **2,000 output tokens** — a ~79% increase. This is billed per-image and applies to both the white-bg and black-bg passes, meaning a single `4K` generation costs 4,000 output tokens total vs 2,240 for `1K`/`2K`.

### Implementation Plan

1. **`config.ts`**: Add `IMAGE_SIZE_TIERS` constant mapping tier names to `imageSize` values.
2. **`schema.ts`**: Add `imageSize` field to `generations` table (default `"1K"` for existing rows).
3. **`gemini.ts`**: `createChatSession` already accepts `imageSize` — pass it through from the generation request.
4. **`generation.ts`**: Generate at the requested `imageSize`. For the `"Web"` tier, generate at `1K` and still run `optimizeForWeb()`. For `"Full"` and `"Ultra HD"`, skip optimization — store the raw matte output directly.
5. **`GenerationCard.svelte`**: Replace the two-button `Standard | Hi-Res` layout with a dropdown or three-button download bar offering `Web`, `Full`, `Ultra HD`.
6. **Generation request mutation**: Accept `imageSize` from the client. Validate against allowed values.

### Important: Dual-Pass at High Resolution

The difference-matte pipeline generates **two** images per generation (white-bg + black-bg). At `4K`, each pass produces images up to **4096×4096** (for 1:1). Convex storage and Sharp processing must handle these sizes. Consider:

- Convex `_storage` blob limits (verify max blob size for 4K PNGs — likely 50+ MB uncompressed RGBA).
- Sharp memory consumption for 4K pixel buffers (~67 MB for 4096×4096 RGBA).
- The bilinear `resizeToMatch` fallback in `generation.ts` will be extremely slow at 4K — replace with Sharp resize for dimension-mismatch cases.

### Storage Strategy

For each generation, store:

| Stored Asset | Tier: Web | Tier: Full | Tier: Ultra HD |
|---|---|---|---|
| `resultStorageId` (full matte PNG) | 1K matte | 2K matte | 4K matte |
| `optimizedStorageId` (web-optimized) | Yes (quantized) | Yes (downscaled from 2K) | Yes (downscaled from 4K) |
| White/black BG intermediates | Optional (debug) | Optional (debug) | Optional (debug) |

Always generate `optimizedStorageId` regardless of tier — it serves as the preview/thumbnail and fast-download option.

---

## Enhancement 2: Expanded Aspect Ratio Support

### Current State

We already support all 14 aspect ratios that 3.1 Flash offers, including the exclusive `1:4`, `4:1`, `1:8`, `8:1` ratios. **No changes needed** — our `ASPECT_RATIOS` config in `config.ts` is already complete.

### Consideration for Higher Resolutions

At `4K`, extreme ratios produce very large images:

| Ratio | 4K Dimensions |
|---|---|
| `1:1` | 4096 × 4096 |
| `8:1` | 12288 × 1536 |
| `1:8` | 1536 × 12288 |
| `16:9` | 5504 × 3072 |

The `8:1` and `1:8` ratios at 4K produce **~75 MB uncompressed RGBA** — this may hit storage or memory limits. Consider restricting extreme ratios (`1:8`, `8:1`, `1:4`, `4:1`) to max `2K` in the UI.

---

## Enhancement 3: Thinking Level Control

### What's New

Gemini 3.1 Flash Image supports configurable thinking levels via `thinkingConfig`:

```typescript
thinkingConfig: {
  thinkingLevel: "minimal" | "High",  // default is "minimal"
  includeThoughts: boolean,
}
```

- **`minimal`** (default): Faster generation, less compositional reasoning.
- **`High`**: Model generates up to 2 interim "thought images" to refine composition before the final output. Better quality for complex prompts.

Thinking tokens are **always billed** regardless of `includeThoughts`. The cost is in latency and input/output token usage.

### Implementation Plan

1. **Expose as a UI toggle**: "Enhanced Quality" switch on the generation form.
   - Off = `minimal` (current behavior, fast)
   - On = `High` (better composition, slower)
2. **`gemini.ts`**: Add `thinkingConfig` to the chat session creation config.
3. **`config.ts`**: Add `defaultThinkingLevel: "minimal"` constant.
4. **`schema.ts`**: Add optional `thinkingLevel` field to `generations` for analytics.
5. **Always set `includeThoughts: false`** — we don't surface thought images to users and they're not needed for our pipeline.

### Thought Signatures

The docs describe a `thought_signature` field that must be circulated back in multi-turn conversations. Since we use the SDK's `chat` feature, **signatures are handled automatically**. No manual management needed — confirmed by docs: *"If you use the official Google Gen AI SDKs and use the chat feature, thought signatures are handled automatically."*

### Impact on Difference Matte Pipeline

Thinking mode may improve consistency between white-bg and black-bg passes since the model reasons more deeply about the composition. This could **reduce** dimension mismatches and validation failures.

---

## Enhancement 4: Google Search Grounding

### What's New

Gemini 3.1 Flash can use **Google Search as a tool** to verify facts and generate imagery based on real-time data (weather, events, recent people, etc.).

```typescript
tools: [{ googleSearch: {} }]
```

### Use Cases for Celstate

- Users prompting for recognizable real-world subjects (brand logos, landmarks, animals) get more accurate results.
- Prompts referencing current events or trends produce grounded, factual imagery.

### Implementation Plan

1. **Expose as optional toggle**: "Search-grounded" checkbox on the prompt form.
2. **`gemini.ts`**: Add `tools` to the chat session config when grounding is enabled.
3. **`schema.ts`**: Add optional `searchGrounded` boolean to `generations`.
4. **Attribution requirement**: When grounding is used, the response includes `groundingMetadata` with `searchEntryPoint` (required HTML/CSS to render search suggestions) and `groundingChunks` (top 3 web sources). We **must** display these to comply with Google's display requirements.
5. **Store grounding metadata**: Add `groundingMetadata` (optional JSON string) to the generation record.

### Important Limitations

- Grounding with Google Search **does not support using real-world images of people from web search** at this time.
- Image-based search results are excluded from the generation model's context when using standard web search grounding.
- Attribution UI must include a link to the source webpage, not just the image.

### Impact on Difference Matte Pipeline

Search grounding should be applied only to the **first pass** (white-bg). The second pass (black-bg) uses the same chat session and references the white-bg image for fidelity — it doesn't need grounding re-enabled.

---

## Enhancement 5: Multi-Reference Image Support

### What's New

Gemini 3.1 Flash supports up to **14 reference images** in a single request:
- Up to **10 images of objects** with high-fidelity inclusion
- Up to **4 images of characters** for character consistency

### Current State

We support **1 reference image** (`referenceStorageId` on the generation). The prompt builders (`buildWhiteBgPromptWithReference`) reference a single image.

### Implementation Plan

1. **`schema.ts`**: Change `referenceStorageId` from a single ID to a list — add `referenceStorageIds: v.optional(v.array(v.id("_storage")))` (keep old field for backward compat during migration).
2. **Upload UI**: Allow drag-and-drop of up to 10 reference images. Show thumbnails with remove buttons.
3. **`gemini.ts`**: Modify `sendMessageWithImage` to accept an array of images, or add a new `sendMessageWithImages` method.
4. **`prompts.ts`**: Update reference prompts to describe multi-image usage: *"Use the attached reference images as style and subject guides."*
5. **`generation.ts`**: Iterate over all reference images when constructing the first-pass message.

### UI Categorization (Future)

Consider letting users tag reference images as "object" or "character" to leverage the 10+4 split, but this can be deferred — sending all as generic references works fine initially.

---

## Enhancement 6: Grounding with Google Image Search

### What's New (3.1 Flash Exclusive)

A new search type alongside web search — **Image Search** — allows the model to use web images retrieved via Google Image Search as visual context for generation.

```typescript
tools: [{
  googleSearch: {
    searchTypes: {
      webSearch: {},
      imageSearch: {},
    }
  }
}]
```

### How It Differs from Standard Search Grounding

- Standard grounding (Enhancement 4) only searches web text for factual data.
- Image Search also retrieves **visual references** from Google Images, giving the model real visual context.

### Display Requirements (Mandatory)

When using Image Search, you **must**:
1. Provide a link to the **containing webpage** (not the image file itself) in a manner recognizable as a link.
2. If displaying source images, provide a **direct, single-click path** from the source image to its containing webpage. No intermediate viewers or multi-click paths.

### Response Metadata

The `groundingMetadata` includes:
- `imageSearchQueries`: The image search queries the model used.
- `groundingChunks`: Source info with `uri` (webpage URL for attribution) and `image_uri` (direct image URL).
- `groundingSupports`: Mappings linking generated content to citation sources.
- `searchEntryPoint`: Required "Google Search" chip HTML/CSS.

### Implementation Plan

1. **Combine with Enhancement 4**: Offer a single "Search-enhanced" toggle that enables both `webSearch` and `imageSearch`.
2. **Attribution component**: Build a `GroundingAttribution.svelte` component that renders the required search entry point and source links.
3. **Storage**: Store `groundingMetadata` JSON alongside the generation.

---

## Credit & Pricing Impact

### Token Cost Summary (per image, output only)

| Resolution | Output Tokens | Relative Cost |
|---|---|---|
| `512` | 747 | 0.67× |
| `1K` | 1,120 | 1× (baseline) |
| `2K` | 1,120 | 1× |
| `4K` | 2,000 | 1.79× |

### Celstate Credit Model Implications

Since our pipeline generates **2 images** per generation (white + black bg), total output token cost per generation:

| Tier | Total Output Tokens | Suggested Credit Cost |
|---|---|---|
| Web (1K) | 2,240 | 1 credit (current) |
| Full (2K) | 2,240 | 1 credit (same token cost) |
| Ultra HD (4K) | 4,000 | 2 credits |

**Key insight**: `2K` costs the same output tokens as `1K`. We can offer `2K` as the default "Full" tier at no additional credit cost, making the free tier genuinely useful.

### Thinking Level Cost

Thinking tokens are billed but the cost varies. `High` thinking will increase input/output token usage. Consider:
- No additional credit charge for thinking (absorb the cost for better quality)
- Or add 0.5 credit surcharge for "Enhanced Quality" mode

---

## Schema & Storage Changes

### `generations` Table Additions

```typescript
generations: defineTable({
  // ... existing fields ...
  
  // New fields
  imageSize: v.optional(v.string()),          // "512" | "1K" | "2K" | "4K"
  thinkingLevel: v.optional(v.string()),      // "minimal" | "High"
  searchGrounded: v.optional(v.boolean()),
  groundingMetadata: v.optional(v.string()),  // JSON string
  referenceStorageIds: v.optional(v.array(v.id("_storage"))),
})
```

All new fields are `v.optional()` for backward compatibility with existing rows.

### Storage Consideration

At `4K` with extreme ratios, a single RGBA PNG can exceed 100 MB uncompressed. Convex storage should handle this, but verify:
- Max blob size for `ctx.storage.store()`
- Download URL response time for large blobs
- Consider WebP output for non-transparency downloads to reduce file size

---

## Migration Strategy

### Phase 1: Resolution Tiers (Highest Impact, Lowest Risk)

1. Add `imageSize` to schema
2. Update `config.ts` with tier definitions
3. Wire `imageSize` through generation request → worker → chat session
4. Update `GenerationCard.svelte` download buttons
5. Start generating at `1K` (current behavior) with new tier labels
6. Enable `2K` and `4K` behind feature flag

### Phase 2: Thinking Level

1. Add `thinkingLevel` to schema
2. Add UI toggle
3. Wire through to chat session config
4. Monitor quality improvements and latency changes

### Phase 3: Search Grounding

1. Add grounding fields to schema
2. Build attribution component
3. Add toggle to generation form
4. Store and display grounding metadata

### Phase 4: Multi-Reference Images

1. Update schema for array of reference IDs
2. Build multi-upload UI
3. Update prompt builders and chat session message construction
4. Test with various reference image counts

### Phase 5: Image Search Grounding

1. Extend grounding config to include `imageSearch`
2. Update attribution component for image source display
3. Ensure compliance with display requirements

---

## Summary of Enhancements

| # | Enhancement | Complexity | Credit Impact | User Value |
|---|---|---|---|---|
| 1 | Three-tier resolution (512/1K/2K/4K) | Medium | 4K costs 2× | **Very High** — genuine HD output |
| 2 | Aspect ratio restrictions at 4K | Low | None | Medium — prevents OOM/storage issues |
| 3 | Thinking level control | Low | Minimal | High — better quality for complex prompts |
| 4 | Google Search grounding | Medium | None | High — real-world accuracy |
| 5 | Multi-reference images (up to 14) | Medium | None | **Very High** — composition flexibility |
| 6 | Google Image Search grounding | Medium | None | High — visual context from web |
