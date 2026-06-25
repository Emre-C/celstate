# Audit 06: Remove Unnecessary Try/Catch and Defensive Programming

**Date:** 2026-06-24  
**Scope:** `src/`  
**Tools:** grep, manual code review

---

## Summary

The codebase has ~35 `try/catch` blocks. Most are legitimate — they handle external API calls, JSON parsing, URL construction, and user-facing mutation errors. A small number are unnecessary or hide errors.

---

## Findings

### Category 1: Legitimate — external API/network calls (12 locations)

These wrap `fetch()` calls to external services (Discord webhooks, Stripe, Convex actions). Failure is expected and must be handled.

- `src/convex/ops.ts:123-158` — generation alert webhook
- `src/convex/ops.ts:180-196` — secret rotation reminder webhook
- `src/convex/ops.ts:244-262` — signup alert webhook
- `src/convex/http.ts:339-358` — purchase alert webhook
- `src/lib/server/auth-alerts.ts:76-95` — auth alert webhook
- `src/lib/server/mcp-proxy.ts:293-331` — upstream MCP proxy request
- `src/lib/server/mcp-proxy.ts:215-251` — retry loop with fetch
- `src/routes/api/auth/convex-ready/+server.ts:17-20` — Convex query for auth readiness
- `src/convex/mcp/handler.ts:248-258` — MCP server connect/handle
- `src/convex/mcp/tools/generate.ts:42` — MCP tool generation
- `src/convex/mcp/tools/getImage.ts:30` — MCP tool query
- `src/convex/mcp/tools/listImages.ts:40` — MCP tool query

**Verdict:** Correct. These handle network failures, timeouts, and external service errors. No change needed.

### Category 2: Legitimate — JSON/URL parsing of untrusted input (8 locations)

- `src/convex/ops.ts:213-225` — `JSON.parse` of GCP service account env var
- `src/convex/ops.ts:456-468` — `JSON.parse` of webhook payload
- `src/convex/lib/gemini.ts:77-81` — `JSON.parse` of service account JSON
- `src/lib/server/convex-site-url.ts:16-20` — `new URL()` for Convex URL parsing
- `src/lib/server/canonical-site.ts:8-12` — `new URL()` for site URL
- `src/lib/mcp/clientConfig.ts:5-8` — `new URL()` for MCP URL
- `src/convex/mcp/handler.ts:43-52` — `new URL()` for origin check
- `src/hooks.server.ts:43-50` — `new URL()` for auth callback location

**Verdict:** Correct. URL/JSON parsing can throw on malformed input, and the catch returns a safe default. No change needed.

### Category 3: Legitimate — user-facing mutation errors (6 locations)

- `src/routes/(app)/app/+page.svelte:113` — generation request
- `src/routes/(app)/app/animations/+page.svelte:53` — Lottie generation request
- `src/routes/(app)/app/credits/+page.svelte:49` — checkout request
- `src/routes/(app)/+layout.svelte:69` — user sync
- `src/lib/components/ApiKeyDialog.svelte:121-128` — API key creation
- `src/lib/components/ApiKeyDialog.svelte:136-142` — API key revocation

**Verdict:** Correct. These catch Convex mutation errors and display them to the user. No change needed.

### Category 4: Legitimate — image processing pipeline (5 locations)

- `src/convex/generation.ts:98-115` — sharp image decode
- `src/convex/generation.ts:464-501` — white background generation stage
- `src/convex/generation.ts:532-565` — black background generation stage
- `src/convex/generation.ts:596-653` — finalize generation stage
- `src/convex/lottieGeneration.ts:73-93` — Lottie response parse and validate

**Verdict:** Correct. These wrap multi-step pipeline operations where any step can fail, and the catch triggers stage failure handling (credit refund, status update). No change needed.

### Category 5: Questionable — error hiding (3 locations)

#### 5a. Empty catch in clipboard

`src/lib/components/ApiKeyDialog.svelte:155` — `catch {}`

```typescript
try {
    await navigator.clipboard.writeText(text);
    copied = which;
    clearTimeout(copiedTimer);
    copiedTimer = setTimeout(() => (copied = null), 2000);
} catch {}
```

**Issue:** Silently swallows clipboard errors. If `navigator.clipboard` is unavailable (e.g. insecure context), the user gets no feedback that copy failed.

**Status:** Fixed. The catch now sets `error` with a user-visible message explaining clipboard failure.

#### 5b. Silent catch in MCP handler cleanup

`src/convex/mcp/handler.ts:257-258`:
```typescript
await transport.close().catch(() => {});
await server.close().catch(() => {});
```

**Issue:** Swallows cleanup errors. If `close()` throws, the error is silently dropped.

**Verdict:** Acceptable for cleanup/teardown paths — the response has already been sent and there's nothing to do with a cleanup error. But a `console.error` would help debugging.

**Status:** Fixed. Both catch handlers now log to `console.error` with descriptive labels.

#### 5c. Catch-and-log in ops alert senders

`src/convex/ops.ts:194-196`:
```typescript
} catch (error) {
    console.error("Failed to post secret rotation reminder", error);
}
```

`src/convex/ops.ts:260-262`:
```typescript
} catch (error) {
    console.error("Failed to send signup Discord notification", error);
}
```

`src/convex/http.ts:356-358`:
```typescript
} catch (error) {
    console.error("Failed to send purchase Discord notification", error);
}
```

**Issue:** These catch webhook delivery failures and only log to console. The `sendGenerationAlert` handler at `ops.ts:152-158` is better — it records the failure to the `generationOpsEvents` table. The other three should do the same or at least send to Sentry.

**Recommendation:** For signup and purchase alerts, the failure is non-critical (the actual business operation succeeded). But silent console.error means failures are invisible in production. Consider sending to Sentry or recording to a lightweight ops events table.

**Status:** Fixed. Added `opsAlertEvents` table to the schema and `recordOpsAlertEvent` internal mutation. Changed `sendOpsWebhook` to return a result type (`{ ok: true } | { ok: false; error }`). All three call sites now record the webhook delivery outcome to the `opsAlertEvents` table, wrapped in try/catch so recording failures cannot cascade (especially important for the Stripe webhook path).

### Category 6: Legitimate — Lottie generation flow (4 locations)

- `src/convex/lottieGeneration.ts:178-200` — first generation attempt
- `src/convex/lottieGeneration.ts:217-241` — repair attempt
- `src/convex/lottieGeneration.ts:115-126` — storage failure during completion
- `src/lib/components/LottiePreview.svelte:29-35` — Lottie preview load

**Verdict:** Correct. Each catch triggers a specific recovery path (retry, fail generation, show error). No change needed.

### Category 7: Legitimate — auth proxy and hooks (3 locations)

- `src/hooks.server.ts:117-120` — response resolution with header stamping
- `src/lib/server/auth-alerts.ts:76-95` — auth webhook alert
- `src/lib/server/mcp-proxy.ts:129-134` — JSON-RPC method detection

**Verdict:** Correct. No change needed.

---

## Critical Assessment

The try/catch usage is disciplined. The codebase does not have a pervasive "wrap everything in try/catch" anti-pattern. The main issues are:

1. **Empty clipboard catch** — user gets no feedback on failure
2. **Silent cleanup catches** — acceptable but could log
3. **Console.error-only webhook catches** — failures invisible in production

None of these are severe. The generation pipeline's error handling is particularly well-structured — each stage catch triggers credit refunds and status updates.

---

## Implementation Priority

| Priority | Item | Risk if not fixed |
|----------|------|-------------------|
| ✅ Done | Empty clipboard catch in ApiKeyDialog | User confusion when copy silently fails |
| ✅ Done | Silent cleanup catches in MCP handler | Debugging difficulty |
| ✅ Done | Console.error-only webhook catches | Alert failures invisible in production |
| None | All other try/catch blocks | Correct usage — no action |
