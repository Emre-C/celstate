# PostHog Product Analytics — Implementation Plan

## 1. System Context

### 1.1 Stack Invariants

| Layer | Technology | Version Constraint |
|---|---|---|
| Frontend | SvelteKit (Svelte 5, runes) | `^5.51.0` |
| Backend | Convex (serverless functions) | `^1.33.1` |
| Auth | better-auth + convex-better-auth-svelte | `1.5.5` |
| Hosting | Vercel (adapter-vercel) | SSR enabled |
| Package Manager | pnpm | `^10.32.0` |
| Error Monitoring | Sentry (existing) | — |
| Analytics | PostHog (this document) | — |

### 1.2 Application Domain

Celstate is a transparent background image generation app. Users submit text prompts, the system generates images via Gemini, and outputs PNG images with transparent backgrounds using a difference-matte pipeline.

### 1.3 Convex Schema (Source of Truth)

```typescript
// src/convex/schema.ts — abbreviated
interface User {
  _id: Id<"users">;
  tokenIdentifier?: string;
  name?: string;
  image?: string;
  email?: string;
  emailVerificationTime?: number;
  credits?: number;
}

interface Generation {
  _id: Id<"generations">;
  userId: Id<"users">;
  prompt: string;
  status: "generating" | "complete" | "failed";
  statusMessage?: string;
  creditsCost: number;
  aspectRatio: string;
  createdAt: number;
  completedAt?: number;
  error?: string;
  generationTimeMs?: number;
  retryCount?: number;
  dimensionMismatch?: boolean;
}

interface CreditGrant {
  _id: Id<"creditGrants">;
  userId: Id<"users">;
  amount: number;
  reason: "signup_bonus" | "weekly_drip" | "purchase" | "admin_grant";
  stripePaymentIntentId?: string;
  createdAt: number;
}
```

### 1.4 Route Structure

```
src/routes/
├── (marketing)/+page.svelte          # Landing page (public)
├── (app)/
│   ├── +layout.svelte                # Auth guard, user sync
│   ├── +layout.ts                    # ssr = true
│   ├── app/
│   │   ├── +page.svelte              # Main generation UI
│   │   ├── +layout.svelte            # App chrome
│   │   └── credits/                  # Credit purchase flow
├── auth/                             # Auth routes
├── api/                              # API routes
└── +layout.svelte                    # Root layout (CSS, head)
```

---

## 2. Package Installation

```bash
pnpm add posthog-js posthog-node
```

### 2.1 Environment Variables

```
# .env / Vercel Environment Variables
PUBLIC_POSTHOG_KEY=phc_<project_token>
PUBLIC_POSTHOG_HOST=https://us.i.posthog.com
POSTHOG_PERSONAL_API_KEY=phx_<personal_api_key>
```

- `PUBLIC_POSTHOG_KEY` — project API token (safe for client)
- `PUBLIC_POSTHOG_HOST` — ingestion endpoint (US Cloud)
- `POSTHOG_PERSONAL_API_KEY` — private key for server-side SDK and API queries (never expose to client)

---

## 3. Client-Side SDK Integration

### 3.1 PostHog Client Module

Create `src/lib/posthog.ts`:

```typescript
import posthog from 'posthog-js';
import { browser } from '$app/environment';
import { PUBLIC_POSTHOG_KEY, PUBLIC_POSTHOG_HOST } from '$env/static/public';

export function initPostHog(): void {
  if (!browser) return;

  posthog.init(PUBLIC_POSTHOG_KEY, {
    api_host: PUBLIC_POSTHOG_HOST,
    defaults: '2026-01-30',
    person_profiles: 'identified_only',
    capture_pageview: 'history_change',
    capture_pageleave: true,
    autocapture: true,
    persistence: 'localStorage+cookie',
    enable_heatmaps: true,
    enable_recording_console_log: true,
    session_recording: {
      maskAllInputs: false,
      maskInputOptions: {
        password: true,
      },
    },
  });
}

export { posthog };
```

#### Configuration Rationale

| Option | Value | Reason |
|---|---|---|
| `defaults` | `'2026-01-30'` | Latest recommended defaults. Sets `capture_pageview` to `history_change`, enables `strictMinimumDuration` for session recording, injects scripts in `<head>` to avoid SSR hydration errors. |
| `person_profiles` | `'identified_only'` | Do not create person profiles for anonymous visitors. Reduces event volume. Profiles created only upon `identify()`. |
| `capture_pageview` | `'history_change'` | SvelteKit is an SPA. Must detect route changes via History API, not page loads. Redundant with `defaults: '2026-01-30'` but explicit for clarity. |
| `persistence` | `'localStorage+cookie'` | Persist identity across sessions. Cookie provides cross-subdomain support. |
| `enable_heatmaps` | `true` | Track click positions for UX analysis. |
| `enable_recording_console_log` | `true` | Capture console output in session replays for debugging. |

### 3.2 SvelteKit SSR Configuration

Modify `svelte.config.js` — required for session replay to work with SSR:

```javascript
// svelte.config.js
import adapter from '@sveltejs/adapter-vercel';

const config = {
  kit: {
    adapter: adapter(),
    alias: {
      $convex: './src/convex',
    },
    paths: {
      relative: false,
    },
  },
};

export default config;
```

**Critical**: `paths.relative: false` is mandatory. PostHog session replay fails with relative asset paths in SSR contexts.

### 3.3 Root Layout Initialization

Modify `src/routes/+layout.svelte`:

```svelte
<script lang="ts">
  import '../app.css';
  import { onMount } from 'svelte';
  import { initPostHog } from '$lib/posthog';

  let { children } = $props();

  onMount(() => {
    initPostHog();
  });
</script>

<svelte:head>
  <link rel="icon" href="/favicon.svg" type="image/svg+xml" />
  <title>Celstate — Transparent Background Images</title>
</svelte:head>

{@render children()}
```

### 3.4 User Identification

In `src/routes/(app)/+layout.svelte`, after auth state resolves and user sync completes, call `posthog.identify()`.

```typescript
// Add to existing $effect block that handles auth.isAuthenticated
import { posthog } from '$lib/posthog';
import { browser } from '$app/environment';

// After storeUser mutation succeeds:
$effect(() => {
  if (!browser || !auth.isAuthenticated || !user.data) return;

  posthog.identify(user.data._id, {
    email: user.data.email,
    name: user.data.name,
    credits: user.data.credits,
  });
});
```

#### Identification Contract

| Condition | Action |
|---|---|
| User authenticates successfully AND `user.data` available | `posthog.identify(user._id, { email, name, credits })` |
| User signs out | `posthog.reset()` |
| Anonymous visitor on marketing page | No identification; anonymous events captured without person profile |

### 3.5 User Reset on Sign-Out

Wherever sign-out is triggered, call `posthog.reset()` before or after the sign-out completes:

```typescript
import { posthog } from '$lib/posthog';

// In sign-out handler:
posthog.reset();
```

---

## 4. Event Taxonomy

### 4.1 Naming Convention

Format: `<object>_<verb>` (snake_case). Object = entity, Verb = action past tense.

### 4.2 Custom Events

#### Core Product Events

| Event Name | Trigger Location | Properties |
|---|---|---|
| `generation_started` | `app/+page.svelte` — after successful `startGeneration` mutation call | `{ prompt_length: number, aspect_ratio: string, has_reference: boolean, credits_cost: number, credits_remaining: number }` |
| `generation_completed` | `app/+page.svelte` — when generation status transitions to `complete` | `{ generation_id: string, generation_time_ms: number, retry_count: number, dimension_mismatch: boolean, aspect_ratio: string }` |
| `generation_failed` | `app/+page.svelte` — when generation status transitions to `failed` | `{ generation_id: string, error: string, retry_count: number }` |
| `image_downloaded` | `GenerationCard.svelte` — download button click | `{ generation_id: string, format: string }` |

#### Monetization Events

| Event Name | Trigger Location | Properties |
|---|---|---|
| `credits_purchase_initiated` | `credits/` — Stripe checkout redirect | `{ package_credits: number, package_price_usd: number }` |
| `credits_purchase_completed` | `app/+page.svelte` — Stripe success redirect detected | `{ credits_added: number }` |
| `credits_purchase_canceled` | `app/+page.svelte` — Stripe cancel redirect detected | `{}` |
| `credit_nudge_shown` | `app/+page.svelte` — low credit nudge displayed | `{ credits_remaining: number }` |

#### Engagement Events

| Event Name | Trigger Location | Properties |
|---|---|---|
| `signup_completed` | `(app)/+layout.svelte` — first successful `storeUser` mutation | `{ method: string }` |
| `prompt_submitted` | `PromptInput.svelte` — form submit | `{ prompt_length: number, has_reference: boolean }` |

### 4.3 Autocaptured Events (No Custom Code Required)

PostHog autocapture handles:
- `$pageview` — all SPA route changes (via `history_change`)
- `$pageleave` — page/tab close
- `$autocapture` — clicks on `a`, `button`, `form`, `input`, `select`, `textarea`, `label`
- `$rageclick` — rapid clicks on non-responsive elements
- Session recording — mouse movement, DOM snapshots, console logs

### 4.4 Person Properties

Set via `posthog.identify()` or `$set`/`$set_once`:

```typescript
interface PostHogPersonProperties {
  email?: string;
  name?: string;
  credits: number;             // $set (mutable)
  signup_date: string;         // $set_once (immutable)
  total_generations: number;   // $set (mutable, update periodically)
  total_credits_purchased: number; // $set (mutable)
}
```

---

## 5. Server-Side SDK Integration

### 5.1 PostHog Node Singleton

Create `src/lib/server/posthog.ts`:

```typescript
import { PostHog } from 'posthog-node';
import { POSTHOG_PERSONAL_API_KEY } from '$env/static/private';
import { PUBLIC_POSTHOG_HOST } from '$env/static/public';

let client: PostHog | undefined;

export function getPostHogServer(): PostHog {
  if (!client) {
    client = new PostHog(POSTHOG_PERSONAL_API_KEY, {
      host: PUBLIC_POSTHOG_HOST,
    });
  }
  return client;
}
```

### 5.2 Server-Side Event Capture

Use in SvelteKit server load functions or API routes when backend-only events are needed:

```typescript
import { getPostHogServer } from '$lib/server/posthog';

// Example: track server-side event
const posthog = getPostHogServer();
posthog.capture({
  distinctId: userId,
  event: 'credits_granted',
  properties: {
    amount: 10,
    reason: 'weekly_drip',
  },
});
await posthog.flush();
```

**Invariant**: Always call `posthog.flush()` or `posthog.shutdown()` after capturing server-side events to ensure batch is sent before serverless function terminates.

---

## 6. Reverse Proxy (Ad-Blocker Bypass)

### 6.1 Rationale

Ad blockers intercept requests to `*.posthog.com`. A SvelteKit server hook reverse-proxies PostHog traffic through the app's own domain.

### 6.2 Implementation

Modify `src/hooks.server.ts` to add PostHog proxy handling using SvelteKit's `sequence` utility:

```typescript
import { sequence } from '@sveltejs/kit/hooks';
import type { Handle } from '@sveltejs/kit';

const posthogProxy: Handle = async ({ event, resolve }) => {
  const { pathname } = event.url;

  if (!pathname.startsWith('/ph')) {
    return resolve(event);
  }

  const hostname = pathname.startsWith('/ph/static/')
    ? 'us-assets.i.posthog.com'
    : 'us.i.posthog.com';

  const url = new URL(event.request.url);
  url.protocol = 'https:';
  url.hostname = hostname;
  url.port = '443';
  url.pathname = pathname.replace(/^\/ph/, '');

  const headers = new Headers(event.request.headers);
  headers.set('host', hostname);
  headers.set('accept-encoding', '');

  const clientIp =
    event.request.headers.get('x-forwarded-for') || event.getClientAddress();
  if (clientIp) {
    headers.set('x-forwarded-for', clientIp);
  }

  return fetch(url.toString(), {
    method: event.request.method,
    headers,
    body: event.request.body,
    // @ts-ignore — duplex required for streaming request bodies
    duplex: 'half',
  });
};

// Compose with existing handle
const existingHandle: Handle = async ({ event, resolve }) => {
  // ... existing handle logic from hooks.server.ts
};

export const handle = sequence(posthogProxy, existingHandle);
```

### 6.3 Client Configuration Update

When reverse proxy is active, update `src/lib/posthog.ts`:

```typescript
posthog.init(PUBLIC_POSTHOG_KEY, {
  api_host: '/ph',                           // Proxy path
  ui_host: 'https://us.posthog.com',         // Required for toolbar links
  // ... rest of config
});
```

**Decision**: Whether to use the reverse proxy is optional. Without it, PostHog still works but some events from users with ad blockers will be lost. Implement if analytics completeness is a priority.

---

## 7. Feature Flags

### 7.1 Client-Side Feature Flags

```typescript
import posthog from 'posthog-js';
import { browser } from '$app/environment';
import { onMount } from 'svelte';

let featureEnabled = $state(false);

onMount(() => {
  if (browser) {
    featureEnabled = posthog.isFeatureEnabled('feature-key') ?? false;
  }
});
```

### 7.2 Server-Side Feature Flags

```typescript
import { PostHog } from 'posthog-node';

const client = new PostHog(POSTHOG_PERSONAL_API_KEY, {
  host: PUBLIC_POSTHOG_HOST,
});

export async function load() {
  const enabled = await client.isFeatureEnabled('feature-key', distinctId);
  return { enabled };
}
```

---

## 8. Key Insights & Dashboards

### 8.1 Growth Dashboard

| Insight | Type | Query Description |
|---|---|---|
| DAU / MAU | Trends | `$pageview` unique users, daily + monthly, ratio = stickiness |
| Signup Rate | Trends | `signup_completed` count, daily |
| New User Retention (D1/D7/D30) | Retention | Cohort: `signup_completed` → returning event: `$pageview` |
| User Growth | Trends | `signup_completed` cumulative count |

### 8.2 Product Usage Dashboard

| Insight | Type | Query Description |
|---|---|---|
| Generations per User (avg) | Trends | `generation_started` property value average per unique user |
| Generation Success Rate | Formula | `generation_completed / generation_started * 100` |
| Generation Time Distribution | Trends | `generation_completed` → property median/p95 of `generation_time_ms` |
| Aspect Ratio Breakdown | Trends | `generation_started` breakdown by `aspect_ratio` |
| Downloads per Generation | Formula | `image_downloaded / generation_completed` |

### 8.3 Revenue Dashboard

| Insight | Type | Query Description |
|---|---|---|
| Purchase Conversion Funnel | Funnel | `credit_nudge_shown` → `credits_purchase_initiated` → `credits_purchase_completed` |
| Revenue per User | Trends | `credits_purchase_completed` property sum of `credits_added` per unique user |
| Purchase Frequency | Trends | `credits_purchase_completed` count, weekly |

### 8.4 UX Health Dashboard

| Insight | Type | Query Description |
|---|---|---|
| Error Rate | Trends | `generation_failed` count / `generation_started` count |
| Rage Clicks | Trends | `$rageclick` count, daily |
| Bounce Rate | Web Analytics | Session property `$is_bounce` |
| Session Duration | Trends | Session property median `$session_duration` |
| Drop-off Paths | Paths | `$pageview` paths, start: `/`, end: `/app` |

---

## 9. PostHog MCP Server Integration

### 9.1 MCP Server Setup

The PostHog MCP server enables AI agents to query analytics, manage feature flags, and run HogQL queries programmatically.

#### Installation for Amp / Claude Code

```bash
# Amp (this agent)
npx @posthog/wizard mcp add

# Or manual for Claude Code:
claude mcp add --transport http posthog https://mcp.posthog.com/mcp -s user
```

#### Installation for Cursor

Add to `.cursor/mcp.json`:

```json
{
  "mcpServers": {
    "posthog": {
      "url": "https://mcp.posthog.com/mcp"
    }
  }
}
```

#### Installation for VS Code

In VS Code command palette → `MCP: Open User Configuration`:

```json
{
  "servers": {
    "posthog": {
      "type": "http",
      "url": "https://mcp.posthog.com/mcp"
    }
  }
}
```

### 9.2 Available MCP Tools

| Category | Tool | Purpose |
|---|---|---|
| **Insights** | `query-run` | Run trends, funnels, paths, or HogQL queries |
| **Insights** | `query-generate-hogql-from-question` | Natural language → HogQL query |
| **Insights** | `insight-create-from-query` | Save a query as a persistent insight |
| **Insights** | `insights-get-all` | List all insights with optional filtering |
| **Feature Flags** | `create-feature-flag` | Create flag with rollout percentage |
| **Feature Flags** | `get-feature-flag` | Get flag details |
| **Feature Flags** | `update-feature-flag` | Modify flag configuration |
| **Experiments** | `experiment-create` | Create A/B test with metrics |
| **Experiments** | `experiment-results-get` | Get experiment results |
| **Errors** | `list-errors` | Fetch error groups sorted by occurrence |
| **Logs** | `logs-query` | Search logs by severity/service |
| **Annotations** | `annotation-create` | Mark deployments/releases on charts |
| **Annotations** | `annotations-list` | List existing annotations |
| **Activity** | `activity-logs-list` | Audit trail of PostHog changes |
| **SQL** | `execute-sql` | Execute arbitrary HogQL/SQL |
| **Search** | `entity-search` | Search entities by name |
| **Docs** | `docs-search` | Search PostHog documentation |

### 9.3 AI Growth Analyst — Example MCP Prompts

These prompts can be used by an AI agent with MCP access to act as a growth analyst:

```
# Daily Growth Check
"Show me DAU and WAU trends for the last 30 days, broken down by week"

# Funnel Analysis
"What percentage of users who start a generation complete it? Show the funnel for generation_started → generation_completed for the last 7 days"

# Retention
"Show me week-over-week retention for users who signed up in the last 8 weeks"

# Revenue Analysis
"How many credits were purchased in the last 30 days? Break down by week."

# UX Issues
"What are the top 5 pages with the most rage clicks this week?"

# Error Investigation
"What are the most common generation_failed error messages in the last 7 days?"

# User Path Analysis
"What are the most common paths users take after landing on the homepage?"

# Feature Flag Audit
"List all feature flags and their rollout percentages"

# HogQL Custom Query
"Write a HogQL query to find users who completed more than 10 generations but never purchased credits"

# Annotation
"Create an annotation for today saying 'Deployed v1.2 with new aspect ratio support'"
```

---

## 10. HogQL Reference Queries

### 10.1 Power Users (>10 generations, no purchases)

```sql
SELECT
  person.properties.email AS email,
  count() AS generation_count
FROM events
WHERE event = 'generation_completed'
  AND timestamp > now() - INTERVAL 30 DAY
  AND person.id NOT IN (
    SELECT person.id FROM events
    WHERE event = 'credits_purchase_completed'
  )
GROUP BY email
HAVING generation_count > 10
ORDER BY generation_count DESC
```

### 10.2 Average Generation Time by Day

```sql
SELECT
  toDate(timestamp) AS day,
  avg(toFloat64(properties.generation_time_ms)) AS avg_ms,
  quantile(0.95)(toFloat64(properties.generation_time_ms)) AS p95_ms
FROM events
WHERE event = 'generation_completed'
  AND timestamp > now() - INTERVAL 30 DAY
GROUP BY day
ORDER BY day
```

### 10.3 Credit Economy Health

```sql
SELECT
  toStartOfWeek(timestamp) AS week,
  sumIf(toFloat64(properties.credits_cost), event = 'generation_started') AS credits_consumed,
  sumIf(toFloat64(properties.credits_added), event = 'credits_purchase_completed') AS credits_purchased,
  countDistinctIf(distinct_id, event = 'credits_purchase_completed') AS paying_users
FROM events
WHERE event IN ('generation_started', 'credits_purchase_completed')
  AND timestamp > now() - INTERVAL 90 DAY
GROUP BY week
ORDER BY week
```

---

## 11. Implementation Sequence

### Phase 1: Foundation (Day 1)

```
1. pnpm add posthog-js posthog-node
2. Add environment variables (PUBLIC_POSTHOG_KEY, PUBLIC_POSTHOG_HOST)
3. Create src/lib/posthog.ts (client module)
4. Modify svelte.config.js (paths.relative: false)
5. Modify src/routes/+layout.svelte (onMount → initPostHog)
6. Add posthog.identify() in (app)/+layout.svelte
7. Add posthog.reset() in sign-out handler
8. Verify: autocaptured pageviews appear in PostHog Live Events
```

### Phase 2: Custom Events (Day 2)

```
1. Instrument generation_started in app/+page.svelte
2. Instrument generation_completed in app/+page.svelte
3. Instrument generation_failed in app/+page.svelte
4. Instrument image_downloaded in GenerationCard.svelte
5. Instrument credits_purchase_initiated in credits flow
6. Instrument credits_purchase_completed/canceled in app/+page.svelte
7. Instrument signup_completed in (app)/+layout.svelte
8. Instrument credit_nudge_shown in app/+page.svelte
9. Verify: all custom events visible in PostHog Live Events with correct properties
```

### Phase 3: Reverse Proxy (Day 2-3, Optional)

```
1. Modify hooks.server.ts — add posthogProxy handler via sequence()
2. Update posthog.init api_host to '/ph'
3. Add ui_host: 'https://us.posthog.com'
4. Verify: network tab shows requests to own domain, not posthog.com
5. Verify: PostHog still receives events
```

### Phase 4: Server-Side SDK (Day 3)

```
1. Add POSTHOG_PERSONAL_API_KEY to environment
2. Create src/lib/server/posthog.ts (node singleton)
3. Instrument server-side events where needed (optional for now)
4. Verify: server events appear in PostHog
```

### Phase 5: Dashboards & MCP (Day 3-4)

```
1. Create Growth Dashboard in PostHog UI
2. Create Product Usage Dashboard
3. Create Revenue Dashboard
4. Create UX Health Dashboard
5. Install PostHog MCP server
6. Verify: AI agent can query PostHog via MCP tools
```

---

## 12. Verification Checklist

| Check | Method | Expected |
|---|---|---|
| SDK loads | Browser DevTools → Network → filter `posthog` | 200 OK on `/decide` or `/ph/decide` |
| Autocapture active | Navigate between routes | `$pageview` events in Live Events |
| Identify works | Sign in → check PostHog Persons | Person created with `email`, `name` properties |
| Reset works | Sign out → new events | New anonymous distinct_id, no person linkage |
| Session replay | PostHog → Session Recordings | Replays available with console logs |
| Custom events | Trigger each event | Event appears in Live Events with correct properties |
| Feature flags | Create test flag in PostHog | `posthog.isFeatureEnabled('test')` returns expected value |
| Reverse proxy (if enabled) | Browser Network tab | Requests go to `/ph/*`, not `posthog.com` |
| MCP tools | Agent prompt: "How many pageviews in the last 24 hours?" | MCP returns query result |

---

## 13. Cost & Volume Estimation

### 13.1 Free Tier Limits (PostHog Cloud)

| Product | Free Allowance |
|---|---|
| Product Analytics | 1M events/month |
| Session Replay | 5K recordings/month |
| Feature Flags | 1M requests/month |
| Surveys | 250 responses/month |
| Data Warehouse | 1M synced rows/month |

### 13.2 Estimated Event Volume (Early Stage)

```
Assumptions:
- 100 DAU
- 5 pageviews/session avg
- 2 generations/session avg
- 1 session/day avg

Monthly estimate:
  Pageviews:     100 * 5 * 30    = 15,000
  Autocapture:   100 * 10 * 30   = 30,000
  Custom events: 100 * 4 * 30    = 12,000
  Total:                         ≈ 57,000 events/month

Conclusion: Well within 1M free tier at early stage.
```

---

## 14. Privacy & Compliance

### 14.1 Data Handling

- `person_profiles: 'identified_only'` — anonymous visitors do not generate person profiles
- Session recording masks password inputs by default
- PostHog processes data in US Cloud (`us.i.posthog.com`)
- No PII in event properties beyond email (which user consented to at signup)

### 14.2 Cookie Consent

IF cookie consent is required (GDPR):

```typescript
// Initialize with opt-out by default
posthog.init(PUBLIC_POSTHOG_KEY, {
  opt_out_capturing_by_default: true,
  // ...
});

// On consent granted:
posthog.opt_in_capturing();

// On consent denied or revoked:
posthog.opt_out_capturing();
```

---

## 15. Files Modified/Created Summary

| File | Action | Purpose |
|---|---|---|
| `src/lib/posthog.ts` | CREATE | Client SDK init + export |
| `src/lib/server/posthog.ts` | CREATE | Server SDK singleton |
| `src/routes/+layout.svelte` | MODIFY | Add `onMount → initPostHog()` |
| `src/routes/(app)/+layout.svelte` | MODIFY | Add `posthog.identify()` + `posthog.reset()` |
| `src/routes/(app)/app/+page.svelte` | MODIFY | Custom event captures |
| `src/hooks.server.ts` | MODIFY | Add reverse proxy handler (optional) |
| `svelte.config.js` | MODIFY | Add `paths.relative: false` |
| `.env` | MODIFY | Add PostHog env vars |
