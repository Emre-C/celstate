# Celstate Growth & Observability — Agent Specification

```yaml
document_id: "growth-observability-agent-spec"
version: "1.1.0"
supersedes:
  - "docs/implementation/OBSERVABILITY-AND-ALERTING.md"
  - "docs/implementation/OWNER-DASHBOARD-ANALYTICS.md"
  - "docs/implementation/POSTHOG-ANALYTICS-IMPLEMENTATION.md"
status: "authoritative"
audience: ["llm", "autonomous_coding_agent"]
human_readability: "not_required"
changelog:
  - version: "1.1.0"
    date: "2026-03-21"
    summary: |
      - Discord alerts expanded to include generation_failed and generation_stalled (early-stage, low-volume product; personalized operator attention required)
      - credits_purchase_completed redesigned: server-side authoritative via @posthog/convex in Stripe webhook handler; client-side event renamed to credits_checkout_returned
      - Server-side PostHog capture uses @posthog/convex (official Convex component), NOT posthog-node — non-blocking via ctx.scheduler.runAfter, no flush/shutdown needed
      - Fixed POSTHOG_PERSONAL_API_KEY spec bug: server-side event capture uses project API key (phc_*) via POSTHOG_API_KEY Convex env var, not personal API key (phx_*)
      - Added signed_up server-side event: captured in upsertUserRecord on new user insert, closes landing→signup→activation funnel gap
      - first_generation_completed moved to DEFERRED status: derivable via PostHog HogQL until proven inadequate
      - generation_failed properties normalized: raw error strings replaced with structured failure_kind/failure_stage/retry_count
      - Execution order revised: @posthog/convex setup as step 0, server-side purchase instrumentation as step 1, sign-up tracking as step 2
      - Added invariants: exact-once side effects for purchase events, client-event lossiness acknowledgement, no-prompts-in-analytics, identity-consistency
      - Environment variables section fully restructured: maps each var to its source (.env vs Convex env), includes mise-en-place checklist
      - All posthog-node references replaced with @posthog/convex throughout
```

---

## 1. Objective Facts

```yaml
product:
  name: "Celstate"
  core_value: "text-to-image with fully transparent backgrounds (PNG output via difference-matte pipeline)"
  external_api: "Gemini image generation (wrapped; not first-party model)"

constraints:
  lean_operation: true
  avoid_bloat: true
  minimize_maintenance_surface: true
  avoid_human_noise: true
```

---

## 2. Architectural Partition (Non-Negotiable)

| Channel | Consumer | Purpose | Forbidden |
|---------|----------|---------|-----------|
| `HUMAN_DISCORD` | Human operator | **Actionable** real-time signals: purchases, errors, generation failures/stalls | Funnels, DAU, marketing trivia, non-blocking product analytics |
| `LLM_ANALYTICS` | LLM / agent via PostHog MCP, API, UI | Growth strategy, funnel analysis, cohorts, attribution, experimentation | Paging human for non-critical events |
| `SENTRY` | Human (dashboard) + LLM (optional MCP) | **Exception** and crash correlation | Treating Sentry as product analytics DB |

```pseudo
IF signal.requires_immediate_human_action AND (
  signal.type == "new_purchase"
  OR signal.type == "user_impacting_error"
  OR signal.type == "generation_failed"
  OR signal.type == "generation_stalled"
) THEN
  route_to(HUMAN_DISCORD)
ELSE IF signal.supports_growth_or_product_analysis THEN
  route_to(LLM_ANALYTICS) // PostHog primary
ELSE IF signal.is_exception THEN
  route_to(SENTRY)
ELSE
  discard_or_log_only
```

```yaml
# EARLY-STAGE POLICY NOTE:
# With ~5 active users, every signal warrants personalized operator attention.
# generation_failed and generation_stalled are routed to HUMAN_DISCORD intentionally.
# REVISIT WHEN: user count exceeds ~50 OR alert volume becomes noisy.
# AT THAT POINT: reclassify generation_failed/stalled as analytics-only (PostHog)
# and rely on Sentry for exception-level error alerting to Discord.
```

---

## 3. Stack Invariants

```typescript
interface StackInvariants {
  frontend: {
    framework: "SvelteKit";
    svelte: "^5.x";
    adapter: "@sveltejs/adapter-vercel";
  };
  backend: {
    baaS: "Convex";
    convex: "^1.33.x";
  };
  auth: {
    provider: "better-auth";
    convex_integration: "convex-better-auth-svelte";
  };
  hosting: "Vercel";
  packageManager: "pnpm";
  error_monitoring: "Sentry @sentry/sveltekit";
  product_analytics: {
    client: "PostHog posthog-js (browser)";
    server: "@posthog/convex (official Convex component; non-blocking via ctx.scheduler.runAfter)";
    // NOTE: posthog-node is NOT used. The @posthog/convex component is the correct
    // Convex-native approach. It works in both mutations and actions, requires no
    // flush/shutdown lifecycle management, and follows the same Convex component
    // pattern already used by @convex-dev/better-auth and @convex-dev/stripe.
  };
}
```

---

## 4. Human Discord Channel — Contract

### 4.1 Allowed Events

```typescript
type HumanDiscordEventType =
  | "purchase_new"          // every successful credit purchase; one notification per unique stripePaymentIntentId
  | "error_user_impacting"  // aggregated or thresholded; see §4.3
  | "generation_failed"     // EARLY-STAGE: every generation failure alerts operator for personalized follow-up
  | "generation_stalled";   // EARLY-STAGE: every stalled generation alerts operator for personalized follow-up
```

```yaml
# EARLY-STAGE DISCORD POLICY:
# generation_failed and generation_stalled are allowed on Discord because:
#   - user base is ~5; each failure likely needs personalized operator response
#   - volume is low enough that these do not cause alert fatigue
# This policy is time-boxed. See §2 EARLY-STAGE POLICY NOTE for graduation criteria.
```

### 4.2 Forbidden on Human Discord

```typescript
type ForbiddenOnHumanDiscord =
  | "dashboard_daily_summary"
  | "marketing_metrics"
  | "any_non_actionable_telemetry";

// NOTE: generation_stalled and generation_failed were previously forbidden here.
// They are now ALLOWED under early-stage policy (see §4.1).
// When the product graduates past ~50 users, re-evaluate and potentially
// move them back to this forbidden list, routing to PostHog analytics only.
```

### 4.3 Error → Discord Routing

```pseudo
PRECONDITION: Sentry project configured for celstate frontend + server.

ON error_captured:
  IF error.level IN ("fatal", "error") AND error.user_impact == true THEN
    IF discord_error_integration_enabled THEN
      forward_toDiscord(error_summary)
    ELSE IF custom_webhook_bridge THEN
      POST OPS_ALERT_WEBHOOK_URL with normalized_payload
    ELSE
      Sentry_only // acceptable fallback; human must open Sentry
```

```typescript
interface NormalizedErrorDiscordPayload {
  source: "sentry" | "convex_ops" | "app";
  title: string;
  environment: "production" | "development" | string;
  userId?: string;
  fingerprint?: string;
  url?: string;
  timestamp_iso: string;
}
```

### 4.4 Purchase → Discord Routing

```pseudo
PRECONDITION: Stripe webhook handler in src/convex/http.ts grants credits after checkout.session.completed.

ON payment_settled AND credits_granted (inside Stripe webhook handler):
  POST discord_webhook with { credits_added, currency, amount_usd, user_ref, stripe_payment_intent_id }

INVARIANT: notify_every_purchase = true
  # At ~5 users, every purchase is a signal worth celebrating and monitoring.
  # No windowing, no dedup-by-user. Dedup is by stripePaymentIntentId only
  # (same gate as credit grant idempotency).

INVARIANT: exact_once_purchase_side_effects
  # The Stripe webhook handler already gates credit grants by stripePaymentIntentId.
  # Discord notification AND PostHog server-side capture MUST share the same idempotency gate.
  # If credits were already granted for a paymentIntentId, do NOT re-emit Discord or PostHog events.
```

```typescript
interface PurchaseDiscordPayload {
  event: "purchase_new";
  credits_added: number;
  currency: string;
  amount_usd: number;                   // session.amount_total / 100 (Stripe uses minor units)
  stripe_payment_intent_id: string;     // required, not optional — always present on checkout.session.completed
  user_id: string;                      // Convex Id<"users"> as string
  user_email?: string;                  // for operator context; do NOT include prompts or image data
}
```

### 4.5 Environment Variables (Discord / Ops)

```yaml
# Existing Convex ops pattern
OPS_ALERT_WEBHOOK_URL: "string | undefined"
OPS_ALERT_WEBHOOK_KIND: "discord | slack | generic | undefined"

# Usage: purchase notifications + error/generation alerts (early-stage policy)
# generation_failed and generation_stalled alerts use this same webhook via existing sendGenerationAlert action
```

---

## 5. LLM Analytics Channel — PostHog Contract

### 5.1 Rationale (Compressed)

```yaml
why_posthog:
  query_without_deploy: true
  hogql: true
  mcp_agent_access: true
  funnel_retention: true
why_not_convex_for_growth_queries: "Convex queries require deploy; ad-hoc owner analytics in Convex was rejected as bloat"
```

### 5.2 Client Configuration (Implemented Baseline)

```typescript
// src/lib/posthog.ts — target shape
interface PostHogClientInit {
  api_host: string; // PUBLIC_POSTHOG_HOST, e.g. https://us.i.posthog.com
  key: string; // PUBLIC_POSTHOG_KEY phc_*
  options: {
    defaults: "2026-01-30";
    person_profiles: "identified_only";
    autocapture: boolean; // true
    capture_pageleave: boolean; // true
  };
}
```

```yaml
sveltekit_kit_paths:
  relative: false # REQUIRED for PostHog session replay if enabled later
```

### 5.3 Identity Lifecycle

```pseudo
ON browser AND PUBLIC_POSTHOG_KEY present:
  initPostHog()

ON authenticated AND Convex user document loaded:
  posthog.identify(String(user._id), { email, name, credits })

ON sign_out:
  posthog.reset()
```

### 5.4 Custom Events — Current & Target

```typescript
// ── Client-side events (posthog-js, captured in browser) ──────────────────────

const ClientGrowthEventNames = [
  "generation_started",
  "generation_completed",
  "generation_failed",
  "credits_purchase_initiated",
  "credits_checkout_returned",    // RENAMED from "credits_purchase_completed"
] as const;

type ClientGrowthEventName = (typeof ClientGrowthEventNames)[number];

interface GenerationStartedProps {
  aspect_ratio: string;
  reference_count: number;
}

interface GenerationCompletedProps {
  generation_id: string;
  aspect_ratio: string;
  generation_time_ms?: number;
}

// UPDATED: raw error strings MUST NOT be sent to PostHog.
// Raw error/stack detail belongs in Sentry. PostHog receives structured failure metadata only.
interface GenerationFailedProps {
  generation_id: string;
  failure_kind: "timeout" | "provider_error" | "processing_error" | "unknown";
  failure_stage?: "white_background" | "black_background" | "finalizing" | undefined;
  retry_count?: number;
}

interface CreditsPurchaseInitiatedProps {
  price_id: string;
}

// RENAMED from credits_purchase_completed → credits_checkout_returned.
// This event fires client-side when Stripe redirects back to /app?success=true.
// It is NOT the authoritative revenue event. It only indicates the user returned
// to the app after checkout. The authoritative revenue event is
// credits_purchase_completed (server-side, see §5.4.1).
interface CreditsCheckoutReturnedProps {
  // No properties needed. The redirect itself is the signal.
  // Do NOT attach revenue amounts here — they are not verified at this point.
}

// ── Server-side events (posthog-node, captured in Convex actions) ─────────────

const ServerGrowthEventNames = [
  "credits_purchase_completed",   // AUTHORITATIVE revenue event; server-side only
] as const;

type ServerGrowthEventName = (typeof ServerGrowthEventNames)[number];
```

#### 5.4.1 Server-Side Revenue Event — `credits_purchase_completed`

```typescript
// This event is the SINGLE SOURCE OF TRUTH for revenue analytics.
// It is captured server-side via the @posthog/convex component inside the
// Stripe webhook handler (src/convex/http.ts) immediately after the idempotent
// credit grant succeeds.
//
// The client-side "credits_checkout_returned" event is NOT a substitute.
// It fires on redirect and is subject to:
//   - user never returning to the page
//   - ad blockers suppressing posthog-js
//   - browser tab closure before JS executes
//
// This server-side event guarantees:
//   - payment was actually settled (checkout.session.completed)
//   - credits were actually granted (idempotent mutation succeeded)
//   - exact-once emission (gated by same stripePaymentIntentId idempotency check)

interface CreditsPurchaseCompletedProps {
  credits_added: number;
  amount_usd: number;                   // session.amount_total / 100
  currency: string;                     // session.currency, e.g. "usd"
  stripe_payment_intent_id: string;
  user_id: string;                      // Convex Id<"users"> as string
}

// ── Implementation Details ────────────────────────────────────────────────────
//
// LIBRARY: @posthog/convex (official PostHog Convex component)
//   - npm: https://www.npmjs.com/package/@posthog/convex
//   - Works in BOTH mutations and actions (unlike posthog-node which only works in Node actions)
//   - Uses ctx.scheduler.runAfter internally — non-blocking, no flush/shutdown needed
//   - Follows the same Convex component pattern as @convex-dev/better-auth and @convex-dev/stripe
//
// SETUP (one-time):
//   1. pnpm add @posthog/convex
//   2. Register in src/convex/convex.config.ts:
//        import posthog from "@posthog/convex/convex.config.js";
//        app.use(posthog);
//   3. Create src/convex/posthog.ts:
//        import { PostHog } from "@posthog/convex";
//        import { components } from "./_generated/api";
//        export const posthog = new PostHog(components.posthog);
//   4. Set env vars in Convex:
//        npx convex env set POSTHOG_API_KEY <value of PUBLIC_POSTHOG_KEY from .env>
//        npx convex env set POSTHOG_HOST https://us.i.posthog.com
//
// CAPTURE (in src/convex/http.ts, after credit grant):
//   import { posthog } from "./posthog";
//   await posthog.capture(ctx, {
//     distinctId: String(userId),
//     event: "credits_purchase_completed",
//     properties: { credits_added, amount_usd, currency, stripe_payment_intent_id, user_id }
//   });
//
// NOTE: The @posthog/convex capture call schedules the HTTP POST asynchronously
// via ctx.scheduler.runAfter, so it returns immediately. No flush/shutdown call
// is needed — this is a major advantage over posthog-node in the Convex runtime.
```

```yaml
# CLIENT vs SERVER EVENT DISAMBIGUATION:
#
# credits_checkout_returned (CLIENT):
#   - Fires when: user lands on /app?success=true after Stripe redirect
#   - Guarantees: user returned to the app
#   - Does NOT guarantee: payment settled, credits granted
#   - Use for: UX funnel analysis (did user complete the redirect loop?)
#
# credits_purchase_completed (SERVER):
#   - Fires when: Stripe webhook confirms payment AND credits are granted
#   - Guarantees: payment settled, credits granted, exact-once
#   - Does NOT depend on: user returning to app, browser JS execution, ad blockers
#   - Use for: revenue analytics, LTV, purchase funnels, growth agent decisions
```

### 5.5 Custom Events — Planned (Growth Agent — Not Yet Implemented)

```typescript
// Phase GROWTH — agent must implement when executing growth roadmap

interface PlannedGrowthEvents {
  sign_up: {
    event: "signed_up";
    status: "NOT_IMPLEMENTED";
    properties: {
      user_id: string;                // Convex Id<"users"> as string
      auth_provider: string;          // "google" | "apple" (from Better Auth social provider)
      initial_credits: number;        // GENERATION_CONFIG.initialCredits granted at sign-up
    };
    capture_location: "server-side via @posthog/convex, inside upsertUserRecord (src/convex/users.ts)";
    notes: "Captured when a NEW user record is inserted (the ctx.db.insert branch of " +
           "upsertUserRecord, line ~93). NOT captured when an existing user signs in " +
           "(the ctx.db.patch branches). This is the authoritative sign-up event — " +
           "it fires exactly once per new user, server-side, regardless of client state. " +
           "Without this event, there is no way to measure sign-up conversion rate " +
           "(landing → auth → new account) or time-to-activation (sign-up → first generation).";
    implementation_hint: "The upsertUserRecord helper already differentiates new vs existing: " +
                         "new users hit the ctx.db.insert path (line ~93), existing users hit " +
                         "ctx.db.patch (lines ~64 or ~82). Add posthog.capture(ctx, {...}) " +
                         "immediately after the insert call, before the return.";
  };

  acquisition_attribution: {
    event: "session_attribution_registered";
    status: "NOT_IMPLEMENTED";
    properties: {
      utm_source?: string;
      utm_medium?: string;
      utm_campaign?: string;
      referrer?: string;
      landing_path: string;
    };
    capture_location: "client-side, on first pageview or session start";
    notes: "Captures acquisition context for attribution analysis. PostHog autocapture " +
           "already records $referrer and UTM params on pageview events, but this explicit " +
           "event provides a clean, queryable attribution record per session.";
  };
}
```

#### 5.5.1 Deferred Events

```typescript
// These events are NOT planned for immediate implementation.
// They are derivable from existing events and should only be promoted to
// explicit instrumentation if the derived approach proves inadequate.

interface DeferredGrowthEvents {
  activation: {
    event: "first_generation_completed";
    status: "DEFERRED";
    reason: "Derivable from existing generation_completed events via PostHog HogQL. " +
            "Query: SELECT distinct_id, min(timestamp) FROM events " +
            "WHERE event = 'generation_completed' GROUP BY distinct_id. " +
            "Only promote to explicit event if: (a) the HogQL query is too slow or awkward, " +
            "(b) identity fragmentation makes per-user first-event unreliable, or " +
            "(c) activation metric is needed for A/B experiment bucketing.";
    properties_if_promoted: { generation_id: string };
  };
}

// NOTE: credits_purchase_completed_server has been REMOVED from planned events.
// It was promoted to §5.4.1 as the authoritative "credits_purchase_completed" server-side event.
// The old client-side "credits_purchase_completed" was renamed to "credits_checkout_returned" (§5.4).
// Server-side capture uses @posthog/convex (not posthog-node). See §5.4.1 for setup details.
```

### 5.6 PostHog MCP (Agent Tooling)

```yaml
mcp:
  url_us: "https://mcp.posthog.com/mcp"
  url_eu: "https://mcp-eu.posthog.com/mcp"
auth:
  oauth: "preferred"
  bearer_personal_api_key: "phx_* MCP preset; scope to project"
pin_headers:
  x-posthog-project-id: "optional"
tool_examples:
  - "execute-sql"
  - "query-run"
  - "read-data-schema"
```

---

## 6. Sentry — Scope

```yaml
primary_role: "exception and crash correlation"
human_daily_driver: false
discord:
  integrate_via: "Sentry native Discord integration OR webhook bridge to same Discord channel as §4"
overlap_with_posthog:
  posthog_error_tracking: "avoid duplicating Sentry; keep Sentry as SoT for exceptions"
```

---

## 7. Convex — Scope

```sql
-- Convex remains SoT for: users, generations, creditGrants, ops audit tables
-- NOT required for: growth dashboards, funnels, marketing attribution
```

```typescript
// Internal ops queries — DEPRECATION SCHEDULE:
//
// getGenerationActivityReport (src/convex/ops.ts):
//   STATUS: DEPRECATE
//   REASON: (1) returns gen.prompt.slice(0, 80) — violates no_prompts_in_analytics invariant (§9)
//           (2) Convex-native analytics was rejected as primary; PostHog HogQL replaces this
//   REPLACE WITH: PostHog HogQL queries over generation_started/generation_completed events
//   WHEN: after session_attribution_registered and credits_purchase_completed (server) are live
//
// getGenerationOpsSummary, getRecentGenerationOpsFeed (src/convex/ops.ts):
//   STATUS: KEEP (for now)
//   REASON: supports existing generation alert system which is actively used (early-stage policy)
//
// mergeDuplicateUsers, getDuplicateUsers (src/convex/ops.ts):
//   STATUS: KEEP permanently
//   REASON: data repair mutations, not analytics
```

---

## 8. State Machine — Signal Lifecycle

```pseudo
STATE machine_signal := { raw, classified, routed }

CLASSIFY(raw):
  SWITCH raw.source
    CASE "stripe_webhook": RETURN "purchase_new" IF payment_succeeded
    CASE "sentry": RETURN "error_user_impacting" IF matches_policy
    CASE "convex_generation_ops":
      IF raw.eventType == "generation_failed" THEN RETURN "generation_failed"
      IF raw.eventType == "generation_stalled" THEN RETURN "generation_stalled"
    CASE "posthog_ingest": RETURN "analytics_only" // never HUMAN_DISCORD unless misconfigured
    DEFAULT: RETURN "discard_or_sentry"

ROUTE(classified):
  IF classified IN ("purchase_new", "error_user_impacting", "generation_failed", "generation_stalled") THEN
    HUMAN_DISCORD  // EARLY-STAGE: all four signal types go to human operator
  ELIF classified == "analytics_only" THEN LLM_ANALYTICS
  ELIF error THEN SENTRY

// NOTE: When graduating past early-stage (~50 users), remove "generation_failed"
// and "generation_stalled" from the HUMAN_DISCORD route and reclassify as "analytics_only".
```

---

## 9. Invariants

```pseudo
INVARIANT no_prompts_in_discord:
  purchase AND error payloads MUST NOT include raw user prompts or image bytes

INVARIANT no_prompts_in_analytics:
  PostHog events MUST NOT include raw user prompts, image URLs, or image bytes.
  This also applies to Convex internal analytics queries.
  VIOLATION: getGenerationActivityReport currently includes gen.prompt.slice(0, 80).
  This query is marked for DEPRECATION (see §7).

INVARIANT no_raw_errors_in_posthog:
  PostHog events MUST NOT include raw error messages or stack traces.
  Raw error/exception detail belongs in Sentry.
  PostHog receives structured failure metadata only: failure_kind, failure_stage, retry_count.
  RATIONALE: raw error strings are high-cardinality, potentially sensitive (may contain user input
  or internal paths), and not suitable for product analytics aggregation.

INVARIANT posthog_keys:
  phc_* (project API key) MAY ship in client bundle (used by posthog-js)
  phc_* (project API key) is ALSO used server-side by posthog-node for event capture
  phx_* (personal API key) MUST NEVER ship to client
  phx_* is used ONLY for PostHog API queries and MCP access (read operations, not event capture)

INVARIANT discord_rate_limit:
  error stream MUST dedupe by fingerprint OR throttle per window

INVARIANT exact_once_purchase_side_effects:
  One stripePaymentIntentId MUST produce AT MOST:
    - one credit grant (existing idempotency check in src/convex/http.ts)
    - one PostHog credits_purchase_completed event
    - one Discord purchase_new notification
  All three side effects MUST share the same idempotency gate:
    IF existing credit grant found for paymentIntentId THEN skip ALL side effects.
  This prevents double-counting revenue in PostHog and double-notifying the operator.

INVARIANT client_events_are_lossy:
  Client-side PostHog events (generation_completed, generation_failed, credits_checkout_returned)
  are captured via posthog-js in the browser. They are inherently lossy because:
    - user may leave the page before the event fires
    - ad blockers may suppress posthog-js
    - generation status transitions may occur while the tab is inactive or closed
    - browser may be closed before JS executes
  These events are ACCEPTABLE for lightweight product telemetry and funnel analysis.
  They are NOT AUTHORITATIVE for business-critical decisions (revenue, SLA, reliability).
  For authoritative signals, use server-side capture (see §5.4.1).

INVARIANT identity_consistency:
  PostHog identify uses String(user._id) as distinctId.
  Duplicate user records (same human, multiple Convex user docs) fragment analytics.
  mergeDuplicateUsers (§7) is the data repair mechanism.
  PostHog does NOT automatically merge identities when Convex users are merged.
  If identity fragmentation becomes a growth analytics problem, implement PostHog alias()
  calls during the merge process.
```

---

## 10. Research Obligations (2026)

```yaml
# Agent MUST verify current docs before implementing; training data may be stale

posthog_client:
  - "https://posthog.com/docs/libraries/svelte"
  - "https://posthog.com/docs/libraries/js/config"

posthog_server:
  - "https://www.npmjs.com/package/@posthog/convex"
  - "https://github.com/PostHog/posthog-convex"
  - "@posthog/convex: official Convex component for server-side PostHog capture"
  - "Works in both mutations and actions via ctx.scheduler.runAfter (non-blocking)"
  - "Requires: convex.config.ts registration, POSTHOG_API_KEY + POSTHOG_HOST env vars in Convex"
  - "Project API key (phc_*) is used for server-side capture, NOT personal API key (phx_*)"
  - "NOTE: posthog-node is NOT used. @posthog/convex is the Convex-native solution."

posthog_mcp:
  - "https://posthog.com/docs/model-context-protocol"

sentry:
  - "@sentry/sveltekit latest SDK: error boundaries, handleError, server/client hooks"

stripe:
  - "Webhook idempotency; checkout.session.completed payload shape"
  - "session.amount_total is in minor units (cents); divide by 100 for amount_usd"
  - "session.currency is lowercase ISO string (e.g. 'usd')"

vercel:
  - "PUBLIC_* env vars; edge vs server for PostHog proxy if added later"
```

---

## 11. Execution Order (Agent)

```yaml
0. SETUP (one-time prerequisite — @posthog/convex component):
  - pnpm add @posthog/convex
  - Register component in src/convex/convex.config.ts:
      import posthog from "@posthog/convex/convex.config.js";
      app.use(posthog);
  - Create src/convex/posthog.ts:
      import { PostHog } from "@posthog/convex";
      import { components } from "./_generated/api";
      export const posthog = new PostHog(components.posthog);
  - Set Convex env vars (value of PUBLIC_POSTHOG_KEY from .env):
      npx convex env set POSTHOG_API_KEY <value of PUBLIC_POSTHOG_KEY from .env>
      npx convex env set POSTHOG_HOST https://us.i.posthog.com
  - Verify convex dev starts cleanly with the new component registered

1. IMPLEMENT (highest priority — fixes revenue truth):
  - In src/convex/http.ts checkout.session.completed handler, after idempotent credit grant:
    a. Capture "credits_purchase_completed" via @posthog/convex with:
       { credits_added, amount_usd, currency, stripe_payment_intent_id, user_id }
       Use: import { posthog } from "./posthog";
            await posthog.capture(ctx, { distinctId: String(userId), event: "credits_purchase_completed", properties: {...} });
    b. POST Discord purchase_new notification via OPS_ALERT_WEBHOOK_URL with:
       { event, credits_added, currency, amount_usd, stripe_payment_intent_id, user_id, user_email }
       Reuse existing ops webhook infrastructure (readOpsAlertRuntimeConfig, buildGenerationAlertRequest pattern)
    c. Both side effects MUST be inside the idempotency gate (skip if credit grant already exists)
  - NOTE: @posthog/convex uses ctx.scheduler.runAfter — no flush/shutdown needed

2. IMPLEMENT (sign-up tracking):
  - In src/convex/users.ts, inside upsertUserRecord, after the ctx.db.insert call (line ~93):
    await posthog.capture(ctx, {
      distinctId: String(userId),
      event: "signed_up",
      properties: { user_id: String(userId), auth_provider: <from profile>, initial_credits: GENERATION_CONFIG.initialCredits }
    });
  - Do NOT capture on the ctx.db.patch branches (those are sign-ins, not sign-ups)

3. RENAME (client-side event semantics):
  - In src/routes/(app)/app/+page.svelte:
    rename posthog.capture("credits_purchase_completed") → posthog.capture("credits_checkout_returned")
    remove any properties from the capture call (the redirect itself is the signal)

4. VERIFY:
  - PostHog live events + identify + minimal custom events are working correctly
  - Confirm generation_failed and generation_stalled Discord alerts are operational (keep as-is)
  - Confirm credits_purchase_completed appears in PostHog from server-side capture
  - Confirm signed_up appears in PostHog on new user registration

5. NORMALIZE (generation_failed properties):
  - In src/routes/(app)/app/+page.svelte, update generation_failed capture:
    replace { error: g.error ?? g.statusMessage ?? '', generation_id: id }
    with { generation_id: id, failure_kind: <classify>, failure_stage: <if available>, retry_count: <if available> }
  - Classification logic for failure_kind:
    - "timeout" if error contains timeout/stale indicators
    - "provider_error" if error relates to Gemini/API
    - "processing_error" if error relates to image processing pipeline
    - "unknown" as fallback

6. IMPLEMENT:
  - session_attribution_registered (UTM + referrer + landing_path)
  - Capture client-side on first pageview or session start
  - Note: PostHog autocapture already captures $referrer and UTM params,
    but this explicit event provides a clean queryable record

7. DEPRECATE:
  - getGenerationActivityReport in src/convex/ops.ts
    (violates no_prompts_in_analytics invariant; replaced by PostHog HogQL queries)
  - Only deprecate AFTER steps 1-6 are live and PostHog has sufficient event history

8. DEFERRED (do not implement now):
  - first_generation_completed — derive via PostHog HogQL until proven inadequate
  - PostHog reverse proxy (SvelteKit) — only if adblock data loss is measurable
```

---

## 12. Superseded Content Mapping

| Legacy Doc | Disposition |
|------------|-------------|
| OBSERVABILITY-AND-ALERTING | Broad research backlog → **replaced** by §4–§6 + §11; generation-failure Discord alerts **kept** under early-stage policy (§4.1) |
| OWNER-DASHBOARD-ANALYTICS | Convex-native owner dashboard → **rejected** as primary; LLM + PostHog replaces |
| POSTHOG-ANALYTICS-IMPLEMENTATION | Verbose implementation + optional features → **replaced** by §5 minimal + §5.5 planned; credits_purchase_completed redesigned as server-side authoritative (§5.4.1) |

---

## 13. Schema — Route Topology (Reference)

```
src/routes/
├── (marketing)/+page.svelte
├── (app)
│   ├── +layout.svelte        # auth guard
│   └── app/
│       ├── +layout.svelte    # posthog identify, sign out reset
│       ├── +page.svelte      # generation events
│       └── credits/+page.svelte
└── +layout.svelte            # posthog init
```

---

## 14. Environment Variables (Complete Set)

```yaml
# ── SvelteKit / Vercel (.env file) ─────────────────────────────────────────────
# These are in the project .env file at the repo root.
# PUBLIC_ prefixed vars are shipped to the browser bundle via SvelteKit.

PUBLIC_POSTHOG_KEY:                     # phc_* project API key; safe for client bundle
  source: ".env"
  example: "phc_abc123..."
  used_by: "posthog-js (browser) AND @posthog/convex (server, as POSTHOG_API_KEY)"

PUBLIC_POSTHOG_HOST:                    # PostHog ingest endpoint
  source: ".env"
  value: "https://us.i.posthog.com"
  used_by: "posthog-js (browser) AND @posthog/convex (server, as POSTHOG_HOST)"

# ── Convex Environment Variables ───────────────────────────────────────────────
# Set via: npx convex env set <KEY> <VALUE>
# These are NOT in .env; they live in the Convex deployment environment.

POSTHOG_API_KEY:                        # SAME value as PUBLIC_POSTHOG_KEY from .env
  source: "Convex env (npx convex env set POSTHOG_API_KEY <value of PUBLIC_POSTHOG_KEY>)"
  used_by: "@posthog/convex component for server-side event capture"
  note: "This is the phc_* project API key. NOT a personal API key (phx_*)."

POSTHOG_HOST:                           # SAME value as PUBLIC_POSTHOG_HOST from .env
  source: "Convex env (npx convex env set POSTHOG_HOST https://us.i.posthog.com)"
  used_by: "@posthog/convex component for server-side event capture"

OPS_ALERT_WEBHOOK_URL:                  # Discord webhook URL for operator notifications
  source: "Convex env (already configured)"
  used_by: "sendGenerationAlert action + purchase_new Discord notification"

OPS_ALERT_WEBHOOK_KIND:                 # "discord" | "slack" | "generic"
  source: "Convex env (already configured)"
  value: "discord"

# ── PostHog MCP / API (read access — NOT for event capture) ────────────────────
# POSTHOG_PERSONAL_API_KEY:             # phx_* personal API key
#   source: "MCP client settings (NOT .env, NOT Convex env)"
#   used_by: "Growth agent via PostHog MCP for HogQL queries and read operations"
#   MUST NEVER: "be shipped to client or used for event ingestion"

# ── Sentry (existing) ─────────────────────────────────────────────────────────
# SENTRY_* per project conventions (already configured)
```

```yaml
# ── MISE-EN-PLACE: Environment Variable Checklist ──────────────────────────────
# Before handing this plan to an AI engineer, confirm each of these is set:

already_configured:
  - PUBLIC_POSTHOG_KEY:        "in .env ✓"
  - PUBLIC_POSTHOG_HOST:       "in .env ✓"
  - OPS_ALERT_WEBHOOK_URL:     "in Convex env ✓"
  - OPS_ALERT_WEBHOOK_KIND:    "in Convex env ✓"
  - SENTRY_*:                  "per project conventions ✓"

must_set_before_implementation:
  - POSTHOG_API_KEY:           "npx convex env set POSTHOG_API_KEY <value of PUBLIC_POSTHOG_KEY from .env>"
  - POSTHOG_HOST:              "npx convex env set POSTHOG_HOST https://us.i.posthog.com"
```
