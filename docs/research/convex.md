# Convex Backend Implementation Plan for Celstate (AI Agents)

## 0. Current Codebase Reality (Celstate)
- JobStore in `src/celstate/job_store.py` writes `jobs/{job_id}/job.json` and creates `studio/`, `outputs/`, and `trace/` subfolders.
- Orchestrator in `src/celstate/orchestrator.py` updates JobRecord fields, generates white/black passes, runs `MediaProcessor`, and finalizes trace output.
- `MediaProcessor` (`src/celstate/processor.py`) returns a `component` manifest with an assets map where filenames map to `null` placeholders.
- Interface contract (`docs/interface_contract.md`) requires the API to be a thin adapter and forbids exposing internal `asset_type`.
- Strict failure is expected: if the backend cannot persist outputs, the job should fail.

This plan keeps compute in Python and adds Convex for durable metadata + asset hosting.

## 1. Goals / Non-Goals
Goals:
- Persist JobRecord.v1 and component output in Convex.
- Store final assets (PNG, mask, debug, trace) in Convex Storage with URLs.
- Keep local disk artifacts for studio/debug analysis.

Non-goals:
- Moving generation into Convex Actions.
- Exposing internal asset types or raw debug artifacts through public APIs.

## 2. Target Architecture (Hybrid)
```
Python pipeline (JobStore + Orchestrator)
  -> Convex DB (jobs, job_assets, job_events)
  -> Convex Storage (output/mask/debug/trace)

External API (future) -> Convex queries -> component with asset URLs
```

## 3. Phase 0 - Verify API docs (required)
Before writing any Convex API calls, use `web_search` to verify the current Convex docs and Python client API.

## 4. Phase 1 - Convex project bootstrap
1. `npm install convex` (repo root).
2. `npx convex dev` to create `convex/` and obtain the deployment URL.
3. Add environment variables:
   - `CONVEX_URL=...` (Python ConvexClient)
   - `CONVEX_DEPLOYMENT=...` (if needed for server configuration)

## 5. Phase 2 - Schema design (Convex)
Create `convex/schema.ts` with tables that mirror JobRecord + assets.

Recommended tables:
- `jobs`
  - `jobId` (string)
  - `status`, `progressStage`, `prompt`, `styleContext`, `name`, `layoutIntent`
  - `renderSizeHint` (optional number)
  - `internalAssetType` (string, internal only)
  - `component` (optional `v.any()`), `telemetry` (optional `v.any()`)
  - `error` (optional string), `retryAfter` (optional number)
  - `createdAt`, `updatedAt` (numbers)
- `jobAssets`
  - `jobId`, `role`, `filename`, `storageId`, `contentType`, `bytes`, `createdAt`
- `jobEvents` (optional)
  - `jobId`, `kind`, `payload`, `createdAt`

Example schema:
```typescript
import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

export default defineSchema({
  jobs: defineTable({
    jobId: v.string(),
    status: v.string(),
    progressStage: v.string(),
    prompt: v.string(),
    styleContext: v.string(),
    name: v.string(),
    layoutIntent: v.string(),
    renderSizeHint: v.optional(v.number()),
    internalAssetType: v.string(),
    component: v.optional(v.any()),
    telemetry: v.optional(v.any()),
    error: v.optional(v.string()),
    retryAfter: v.optional(v.number()),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_job_id", ["jobId"])
    .index("by_status", ["status"])
    .index("by_created", ["createdAt"]),

  jobAssets: defineTable({
    jobId: v.string(),
    role: v.string(),
    filename: v.string(),
    storageId: v.id("_storage"),
    contentType: v.string(),
    bytes: v.number(),
    createdAt: v.number(),
  })
    .index("by_job", ["jobId"])
    .index("by_job_role", ["jobId", "role"]),

  jobEvents: defineTable({
    jobId: v.string(),
    kind: v.string(),
    payload: v.any(),
    createdAt: v.number(),
  }).index("by_job", ["jobId"]),
});
```

## 6. Phase 3 - Convex functions (TypeScript)
Create `convex/jobs.ts` and `convex/assets.ts` with the following responsibilities:

- `jobs:upsert` mutation
  - Upsert by `jobId` with all JobRecord fields.
- `jobs:getPublic` query
  - Fetch job by `jobId`.
  - Resolve assets via `jobAssets` + `ctx.storage.getUrl`.
  - Return `component` with URLs and omit `internalAssetType`.
- `assets:generateUploadUrl` mutation
  - Return `ctx.storage.generateUploadUrl()`.
- `assets:save` mutation
  - Persist metadata (`jobId`, `role`, `filename`, `storageId`, `contentType`, `bytes`).

TypeScript sketch:
```typescript
export const upsert = mutation({
  args: {
    jobId: v.string(),
    status: v.string(),
    progressStage: v.string(),
    prompt: v.string(),
    styleContext: v.string(),
    name: v.string(),
    layoutIntent: v.string(),
    renderSizeHint: v.optional(v.number()),
    internalAssetType: v.string(),
    component: v.optional(v.any()),
    telemetry: v.optional(v.any()),
    error: v.optional(v.string()),
    retryAfter: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("jobs")
      .withIndex("by_job_id", (q) => q.eq("jobId", args.jobId))
      .unique();
    const payload = { ...args, updatedAt: Date.now() };
    if (existing) {
      await ctx.db.patch(existing._id, payload);
    } else {
      await ctx.db.insert("jobs", { ...payload, createdAt: Date.now() });
    }
  },
});

export const getPublic = query({
  args: { jobId: v.string() },
  handler: async (ctx, args) => {
    const job = await ctx.db
      .query("jobs")
      .withIndex("by_job_id", (q) => q.eq("jobId", args.jobId))
      .unique();
    if (!job) return null;
    const assets = await ctx.db
      .query("jobAssets")
      .withIndex("by_job", (q) => q.eq("jobId", args.jobId))
      .collect();
    const assetUrls = Object.fromEntries(
      await Promise.all(
        assets.map(async (asset) => [
          asset.filename,
          await ctx.storage.getUrl(asset.storageId),
        ])
      )
    );
    return {
      jobId: job.jobId,
      status: job.status,
      retryAfter: job.retryAfter,
      error: job.error,
      component: job.component ? { ...job.component, assets: assetUrls } : null,
    };
  },
});
```

## 7. Phase 4 - Python Convex sync layer
Add a dedicated module (e.g., `src/celstate/convex_sync.py`) so `JobStore` and `Orchestrator` do not depend on Convex directly.

Responsibilities:
- `upsert_job(job: dict)` called by `JobStore.create_job` and `JobStore.save_job`.
- `upload_asset(job_id, path, role, content_type)` called after outputs are written.
- `record_event(job_id, kind, payload)` for trace events (optional).

Python sketch:
```python
import os
import time
import requests
from pathlib import Path
from convex import ConvexClient

class ConvexSync:
    def __init__(self, url: str | None = None) -> None:
        self.client = ConvexClient(url or os.environ["CONVEX_URL"])

    def upsert_job(self, job: dict) -> None:
        payload = {
            "jobId": job["id"],
            "status": job["status"],
            "progressStage": job["progress_stage"],
            "prompt": job["prompt"],
            "styleContext": job["style_context"],
            "name": job["name"],
            "layoutIntent": job["layout_intent"],
            "renderSizeHint": job.get("render_size_hint"),
            "internalAssetType": job["type"],
            "component": job.get("component"),
            "telemetry": job.get("telemetry"),
            "error": job.get("error"),
            "retryAfter": job.get("retry_after"),
            "updatedAt": int(time.time() * 1000),
        }
        self.client.mutation("jobs:upsert", payload)

    def upload_asset(self, job_id: str, path: Path, role: str, content_type: str) -> str:
        upload_url = self.client.mutation("assets:generateUploadUrl")
        response = requests.post(
            upload_url,
            data=path.read_bytes(),
            headers={"Content-Type": content_type},
        )
        response.raise_for_status()
        storage_id = response.json()["storageId"]
        self.client.mutation("assets:save", {
            "jobId": job_id,
            "role": role,
            "filename": path.name,
            "storageId": storage_id,
            "contentType": content_type,
            "bytes": path.stat().st_size,
        })
        return storage_id
```

Note: always send `Content-Type: image/png` to preserve transparency.

## 8. Phase 5 - Integration points in Celstate
- `JobStore.create_job` / `JobStore.save_job`: call `ConvexSync.upsert_job` after local write.
- `Orchestrator` after `MediaProcessor.process_image`:
  - Upload `outputs/{name}.png`, `outputs/{name}_mask.png` (if present), and `outputs/{name}_debug.png`.
- `Orchestrator` after `Tracer.finalize`:
  - Upload `trace/trace.json` with `contentType=application/json` (optional).
- Error policy: if Convex sync fails, mark the job failed and surface the error (strict failure).

## 9. Phase 6 - Verification (strict)
1. Run a single prompt and confirm:
   - Job record exists in Convex with matching fields.
   - Assets uploaded; URLs resolve; bytes match local file (hash check).
   - Returned component assets map contains URLs instead of nulls.
2. Validate API contract behavior:
   - No internal `asset_type` exposed.
   - `error` and `retry_after` behave exactly like JobStore.
3. Confirm local artifacts still exist under `jobs/{job_id}` for debug/studio.

## 10. References
- Convex Python quickstart: https://docs.convex.dev/quickstart/python
- File storage uploads: https://docs.convex.dev/file-storage/upload-files
- Schema definition: https://docs.convex.dev/database/schemas
- The Zen of Convex: https://docs.convex.dev/understanding/zen