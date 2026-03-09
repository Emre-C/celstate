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
  creditsCost: v.number(),
  aspectRatio: v.string(),
  createdAt: v.number(),
  completedAt: v.optional(v.number()),
  error: v.optional(v.string()),
  generationTimeMs: v.optional(v.number()),
  retryCount: v.optional(v.number()),
  dimensionMismatch: v.optional(v.boolean()),
}).index("by_user", ["userId", "createdAt"])
```

## Storage Files

Each generation stores up to 4 files:

| File | Purpose | Retention |
|------|---------|-----------|
| `resultStorageId` | Higher resolution PNG | 30 days |
| `optimizedStorageId` | Web-optimized PNG | 30 days |
| `whiteBgStorageId` | Debug: white-bg pass | 30 days |
| `blackBgStorageId` | Debug: black-bg pass | 30 days |

## UI Components

### GenerationCard

Three-state card component:

```svelte
{#if status === 'generating'}
  <GeneratingIndicator {prompt} {statusMessage} {createdAt} />
{:else if status === 'complete' && resultUrl}
  <CheckerboardPreview src={resultUrl} alt={prompt} />
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

Per VISION.md: Images stored for minimum 30 days.

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
