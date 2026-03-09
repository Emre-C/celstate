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
// src/convex/generation.ts - generateWorker
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
- Minimal compared to Gemini API calls (7-17s)

## Intermediate Images

White and black background passes are also stored (`whiteBgStorageId`, `blackBgStorageId`). These enable:
- Quality analysis when matte looks wrong
- Prompt tuning (inspect Gemini output vs. prompt)
- Future matte algorithm improvements without re-generation

All images follow the same 30-day retention policy.
