# Observability stack — Celstate (agent artifact)

## 0. Metadata

```yaml
document_id: "observability-generation-product"
audience: ["llm", "autonomous_coding_agent"]
human_readability: "not_required"
canonical_spec: "docs/implementation/GROWTH-OBSERVABILITY-AGENT-SPEC.md"
scope:
  in: ["PostHog client+server", "Convex generationOpsEvents", "OPS ops webhooks", "Sentry boundary", "Stripe purchase→analytics+Discord"]
  out: ["Vertex pipeline details", "GENERATION_CONFIG", "difference matting internals"]
  see_also: "docs/product/image-generation.md"
```

---

## 1. Channel partition (non-negotiable)

```typescript
type SignalChannel =
  | "HUMAN_OPS_WEBHOOK"   // OPS_ALERT_WEBHOOK_URL — Slack | Discord | generic JSON
  | "LLM_ANALYTICS"       // PostHog (browser + @posthog/convex server)
  | "SENTRY";             // @sentry/sveltekit — exceptions, not product analytics DB
```

```pseudo
ROUTE(signal):
  IF signal.requires_immediate_human_action AND signal.type IN (
    "purchase_settled",
    "generation_failed",
    "generation_stalled"
  ) THEN HUMAN_OPS_WEBHOOK  // early-stage: low volume; revisit ~50+ users
  ELIF signal.supports_growth_or_product_analysis THEN LLM_ANALYTICS
  ELIF signal.is_exception THEN SENTRY
  ELSE log_only_or_discard
```

```yaml
invariant_convex_sentry:
  statement: "Convex mutations/actions/http handlers do NOT import Sentry."
  consequence: "generationOpsEvents and PostHog are separate from Sentry traces."
```

---

## 2. Environment variables

```yaml
# SvelteKit / Vercel — repo .env; PUBLIC_* bundled to browser
PUBLIC_POSTHOG_KEY:
  pattern: "phc_*"
  used_by: ["posthog-js", "Convex POSTHOG_API_KEY (same value)"]
PUBLIC_POSTHOG_HOST:
  example: "https://us.i.posthog.com"
  used_by: ["posthog-js", "Convex POSTHOG_HOST (same value)"]

# Convex deployment — `pnpm exec convex env set` (NOT .env)
POSTHOG_API_KEY:
  equals: "PUBLIC_POSTHOG_KEY"
  used_by: "@posthog/convex server capture"
  prerequisite: "Unset → server-side PostHog capture does not fire (no runtime fallback)"
POSTHOG_HOST:
  equals: "PUBLIC_POSTHOG_HOST"
  used_by: "@posthog/convex server capture"
OPS_ALERT_WEBHOOK_URL:
  semantics: "trimmed; empty → no outbound ops HTTP"
OPS_ALERT_WEBHOOK_KIND:
  type: '"slack" | "discord" | "generic" | undefined'
  inference: "if unset, derive from URL hostname (readOpsAlertRuntimeConfig)"

# PostHog MCP / API reads — never Convex env for event capture
POSTHOG_PERSONAL_API_KEY:
  pattern: "phx_*"
  forbidden_for: ["event ingestion", "client bundle", "Convex env for capture"]
```

---

## 3. PostHog component (Convex)

```typescript
// src/convex/convex.config.ts (excerpt — also uses betterAuth, stripe)
import { defineApp } from "convex/server";
import posthog from "@posthog/convex/convex.config.js";

const app = defineApp();
app.use(posthog);

// src/convex/posthog.ts
import { PostHog } from "@posthog/convex";
import { components } from "./_generated/api";

const posthogComponent = (components as Record<string, unknown>).posthog as ConstructorParameters<typeof PostHog>[0];

export const posthog = new PostHog(posthogComponent);
```

```yaml
implementation_facts:
  library: "@posthog/convex"
  posthog_node: "Not imported by app code; @posthog/convex lists posthog-node as a transitive dependency."
  scheduling: "capture uses ctx.scheduler.runAfter(0, …) — no explicit flush/shutdown in app code"
```

---

## 4. PostHog client (`src/lib/posthog.ts`)

```typescript
interface PostHogBrowserInit {
  api_host: string; // PUBLIC_POSTHOG_HOST || default us.i.posthog.com
  key: string;      // PUBLIC_POSTHOG_KEY
  options: {
    defaults: "2026-01-30";
    person_profiles: "identified_only";
    autocapture: true;
    capture_pageleave: true;
  };
}
```

```pseudo
initPostHog():
  IF NOT browser OR initialized THEN return
  IF NOT PUBLIC_POSTHOG_KEY THEN return false
  posthog.init(...)
  initialized = true
```

---

## 5. Identity lifecycle (browser)

```pseudo
ON root +layout onMount:
  initPostHog()
  captureSessionAttributionOnce(...)  // §8

ON app/+layout $effect AND user.data loaded:
  initPostHog()
  posthog.identify(String(user._id), { email, name, credits })

ON sign_out:
  initPostHog()
  posthog.reset()
```

```yaml
distinct_id_rule: "String(Convex users._id)"
fragmentation_note: "mergeDuplicateUsers repairs DB; PostHog alias not auto-applied on merge"
```

---

## 6. Event inventory — PostHog

### 6.1 Client events

```typescript
type ClientPostHogEvent =
  | "generation_started"
  | "generation_completed"
  | "generation_failed"
  | "credits_purchase_initiated"
  | "credits_checkout_returned"
  | "session_attribution_registered";

interface GenerationStartedProps {
  aspect_ratio: string;
  reference_count: number;
}

interface GenerationCompletedProps {
  generation_id: string;
  aspect_ratio: string;
  generation_time_ms?: number;
}

interface GenerationFailedProps {
  generation_id: string;
  failure_kind: "timeout" | "provider_error" | "processing_error" | "unknown";
  failure_stage?: "white_background" | "black_background" | "finalizing";
  retry_count?: number;
}

interface CreditsPurchaseInitiatedProps {
  price_id: string;
}

// credits_checkout_returned: zero properties (redirect-only signal)
type CreditsCheckoutReturnedProps = Record<string, never>;

interface SessionAttributionRegisteredProps {
  landing_path: string;
  referrer?: string;
  utm_campaign?: string;
  utm_medium?: string;
  utm_source?: string;
}
```

### 6.2 Server events (`@posthog/convex`)

```typescript
type ServerPostHogEvent =
  | "credits_purchase_completed"
  | "signed_up";

interface CreditsPurchaseCompletedProps {
  credits_added: number;
  amount_usd: number;
  currency: string;
  stripe_payment_intent_id: string;
  user_id: string; // String(Id<"users">)
}

interface SignedUpProps {
  user_id: string;
  auth_provider: "google" | "apple" | "unknown";
  initial_credits: number;
}
```

### 6.3 Deferred (explicit event NOT implemented)

```typescript
interface DeferredExplicitEvent {
  name: "first_generation_completed";
  substitute: "HogQL: min(timestamp) WHERE event = 'generation_completed' GROUP BY distinct_id";
}
```

---

## 7. Purchase + revenue semantics

```pseudo
# Stripe webhook: checkout.session.completed → src/convex/http.ts

PRE: paymentIntentId from session
PRE: priceId → CREDIT_PACKS maps to credits
PRE: userId from session.metadata
IF getByPaymentIntentId(existing grant) THEN
  RETURN  // gate: no PostHog, no Discord, no second grant
ENDIF

recordGrant(...)
amountUsd = (session.amount_total ?? 0) / 100
currency = session.currency ?? "usd"

posthog.capture(distinctId: String(userId), event: "credits_purchase_completed", properties: {...})

IF readOpsAlertRuntimeConfig().webhookUrl THEN
  request = buildPurchaseAlertRequest(config, PurchaseAlertContext)
  fetch(request) // errors logged; do not rollback grant
ENDIF
```

```yaml
invariant_exact_once_purchase_side_effects:
  shared_gate: "stripePaymentIntentId idempotency before grant"
  emits_at_most_one_each: ["credit grant", "credits_purchase_completed", "ops webhook POST"]

client_event_credits_checkout_returned:
  fires: "/app?success=true redirect handler in app/+page.svelte"
  guarantees: "user returned to SPA"
  does_not_guarantee: ["payment settled", "credits granted"]
  properties: "none"
```

---

## 8. Session attribution (client)

```typescript
const SESSION_ATTRIBUTION_STORAGE_KEY = "celstate:session_attribution_registered";
```

```pseudo
captureSessionAttributionOnce({ capture, storage, url, referrer }):
  IF storage.getItem(KEY) === "1" THEN return false
  capture("session_attribution_registered", buildSessionAttributionProps(url, referrer))
  storage.setItem(KEY, "1")
  return true

buildSessionAttributionProps(url, referrer):
  landing_path = url.pathname
  optional: utm_source, utm_medium, utm_campaign from url.searchParams
  optional: referrer from document.referrer (trimmed)
```

```yaml
call_site: "src/routes/+layout.svelte onMount after initPostHog"
storage: "window.sessionStorage"
frequency: "once per browser tab session"
```

---

## 9. Sign-up analytics (server)

```pseudo
upsertUserRecord(ctx, profile):
  IF existing user by tokenIdentifier THEN patch; RETURN user  // NO signed_up
  IF existing user by email THEN patch; RETURN user             // NO signed_up
  userId = insert new user with initialCredits
  posthog.capture(event: "signed_up", distinctId: String(userId), properties: {
    user_id, auth_provider: profile.authProvider ?? "unknown", initial_credits
  })
  RETURN user

getAuthProviderForBetterAuthUser:
  query components.betterAuth.adapter account by userId → providerId
  IF providerId IN ("google","apple") THEN return else "unknown"
```

---

## 10. Generation failure — DB, classification, PostHog

### 10.1 `generations` table (analytics-relevant)

```typescript
interface GenerationsAnalyticsFailureFields {
  failureKind?: "timeout" | "provider_error" | "processing_error" | "unknown";
  failureStage?: "white_background" | "black_background" | "finalizing";
  retryCount?: number;
  error?: string; // user-facing on terminal failed
}
```

### 10.2 Classification (`src/lib/analytics/generation.ts`)

```typescript
// Single implementation imported by:
// - src/convex/generations.ts (failGenerationRecord)
// - src/routes/(app)/app/+page.svelte (buildGenerationFailedAnalyticsProps)

function classifyGenerationFailureKind(input: {
  error?: string | null;
  stage?: string | null;
  statusMessage?: string | null;
}): GenerationFailureKind;

function normalizeGenerationFailureStage(value: unknown): GenerationFailureStage | undefined;
```

```pseudo
joinFailureContext = concat non-empty(error, statusMessage, stage)

IF joinFailureContext empty THEN return "unknown"
IF ANY TIMEOUT_PATTERN.test(context) THEN "timeout"
ELSE IF ANY PROVIDER_PATTERN.test(context) THEN "provider_error"
ELSE IF ANY PROCESSING_PATTERN.test(context) THEN "processing_error"
ELSE "unknown"
```

### 10.3 `failGenerationRecord` (Convex)

```pseudo
PRE: row exists AND status === "generating" ELSE return

failureKind = classifyGenerationFailureKind({ error: internal??userFacing, stage, statusMessage })
failureStage = normalizeGenerationFailureStage(generation.stage)
PATCH generations → failed + failureKind + failureStage + clear stage fields + user error string
insertGenerationOpsEvent(generation_failed, error = internal??userFacing for ops)
scheduleGenerationAlert(generation_failed)
IF NOT creditRefundedAt THEN refund credits + set creditRefundedAt
```

### 10.4 Client `generation_failed` capture

```pseudo
ON subscription transition prev===generating AND status===failed:
  posthog.capture("generation_failed", buildGenerationFailedAnalyticsProps({
    generationId,
    failureKind from Convex row OR re-classify from error/statusMessage/stage,
    failureStage,
    retryCount
  }))
```

```yaml
invariant_no_raw_errors_posthog:
  rule: "PostHog generation_failed MUST NOT include raw error strings"
  allowed_properties: ["generation_id", "failure_kind", "failure_stage", "retry_count"]
```

---

## 11. Convex ops — `generationOpsEvents`

### 11.1 Table shape

```typescript
type GenerationOpsEventType =
  | "generation_requested"
  | "stage_succeeded"
  | "stage_retry_scheduled"
  | "generation_completed"
  | "generation_failed"
  | "generation_stalled"
  | "alert_sent"
  | "alert_failed";

interface GenerationOpsEventDoc {
  generationId: Id<"generations">;
  userId: Id<"users">;
  userEmail?: string;
  eventType: GenerationOpsEventType;
  severity?: "info" | "warning" | "critical";
  stage?: "white_background" | "black_background" | "finalizing";
  attemptDurationMs?: number;
  generationDurationMs?: number;
  retryCount?: number;
  totalRetryCount?: number;
  statusMessage?: string;
  error?: string;
  createdAt: number;
}
```

```yaml
indexes:
  - ["generationId", "createdAt"]  # by_generation
  - ["createdAt"]                  # by_createdAt
  - ["eventType", "createdAt"]     # by_eventType_createdAt
```

### 11.2 `error` field semantics by `eventType`

```pseudo
SWITCH eventType
  CASE generation_failed:  error = internalError ?? userFacing  // ops webhook payloads
  CASE generation_stalled: error = template with stalledGenerationWarningMs
  CASE alert_failed:      error = missing URL OR HTTP error string
  DEFAULT:                error omitted
```

### 11.3 Insert matrix

```text
| eventType               | insert_site                          | userEmail |
|-------------------------|--------------------------------------|-----------|
| generation_requested    | requestGeneration                    | yes       |
| stage_succeeded         | recordWhiteBackgroundSuccess; recordBlackBackgroundSuccess | no        |
| stage_retry_scheduled   | scheduleStageRetry                   | no        |
| generation_completed    | completeGeneration                   | yes       |
| generation_failed       | failGenerationRecord                 | yes       |
| generation_stalled      | cleanupStaleGenerations              | no        |
| alert_sent              | recordAlertEvent ← sendGenerationAlert success | yes |
| alert_failed            | recordAlertEvent ← fetch failure     | yes       |
```

```yaml
invariants:
  - "insertGenerationOpsEvent never writes alert_sent | alert_failed"
  - "recordAlertEvent writes only alert_sent | alert_failed"
```

### 11.4 Stall / cron

```pseudo
cleanupStaleGenerations (cron ~1min):
  FOR row WHERE status === "generating":
    lastProgress = getGenerationLastProgressAt(row)
    IF lastProgress < now - staleGenerationTimeoutMs
      → failGenerationRecord(...)
    ELIF NOT stalledAlertedAt AND lastProgress < now - stalledGenerationWarningMs
      → PATCH stalledAlertedAt
      → insertGenerationOpsEvent(generation_stalled)
      → scheduleGenerationAlert(generation_stalled)
```

---

## 12. Ops webhook routing

```pseudo
readOpsAlertRuntimeConfig():
  IF OPS_ALERT_WEBHOOK_KIND lowercased IN {slack,discord,generic} THEN use
  ELSE IF URL missing THEN webhookKind = "generic"
  ELSE hostname:
    slack.com → slack
    discord.com | discordapp.com → discord
    ELSE → generic
```

---

## 13. HTTP request builders (`src/convex/lib/ops.ts`)

### 13.1 Generation alert

```typescript
interface GenerationAlertContext {
  alertType: "generation_failed" | "generation_stalled";
  severity: "warning" | "critical";
  generationId: string;
  userId: string;
  userEmail?: string;
  stage?: GenerationStage;
  retryCount?: number;
  totalRetryCount?: number;
  statusMessage?: string;
  error?: string; // truncated for facts line
  createdAt: number;
  generationDurationMs?: number;
}
```

| `webhookKind` | body |
|---------------|------|
| `slack` | `{ text, blocks }` |
| `discord` | `{ content: string }` |
| `generic` | `{ title, severity, alertType, context }` |

### 13.2 Purchase alert

```typescript
interface PurchaseAlertContext {
  amountUsd: number;
  creditsAdded: number;
  currency: string;
  stripePaymentIntentId: string;
  userEmail?: string;
  userId: string;
}
```

```yaml
generic_json_payload_includes:
  keys: ["event: purchase_new", "credits_added", "currency", "amount_usd", "stripe_payment_intent_id", "user_id", "user_email", "title"]
slack_discord: "same structural pattern as generation alerts (header + facts)"
```

---

## 14. Action `internal.ops.sendGenerationAlert`

```pseudo
load generation, user email
readOpsAlertRuntimeConfig()
IF NOT webhookUrl THEN recordAlertEvent(alert_failed, "not configured"); RETURN
TRY fetch(buildGenerationAlertRequest(...))
  ok → recordAlertEvent(alert_sent)
CATCH → recordAlertEvent(alert_failed, message)
```

---

## 15. Internal queries (Convex)

```typescript
// ops.getGenerationOpsSummary
args: { hoursWindow?: number } // default 24, clamp [1,720]
returns: { summary, recentCriticalEvents, window }

// ops.getRecentGenerationOpsFeed
args: { limit?: number } // default 50, clamp [1,200]
complexity_note: "full collect on by_createdAt + sort — O(N) all ops rows"
```

```yaml
deprecation_gated:
  query: "getGenerationActivityReport"
  reason: "includes prompt slice — violates no_prompts_in_analytics"
  replace_with: "PostHog HogQL"
  gate: "AFTER server PostHog events + session_attribution live AND sufficient history"
```

---

## 16. Rollup `summarizeGenerationOpsEvents`

```pseudo
counts: requested, completed, failed, stalled, retries, alertFailures from eventType
IF requested > 0:
  successRate = (completed / requested) * 100
  failureRate = (failed / requested) * 100
percentiles: generation ms from generation_completed; attempt ms from any attemptDurationMs
avgRetriesPerCompletion: mean(totalRetryCount on generation_completed)
```

---

## 17. Invariants (cross-cutting)

```pseudo
INVARIANT no_prompts_in_analytics:
  PostHog events AND ops webhooks (generation + purchase) EXCLUDE raw prompts and image bytes

INVARIANT no_raw_errors_in_posthog:
  generation_failed analytics properties exclude free-text errors

INVARIANT client_events_are_lossy:
  browser posthog-js captures may be blocked or missed — not authoritative for revenue

INVARIANT phc_vs_phx:
  phc_* = ingest (client + Convex POSTHOG_API_KEY)
  phx_* = read APIs / MCP only
```

---

## 18. Code map

```yaml
convex:
  schema: "src/convex/schema.ts"
  generations_ops_inserts: "src/convex/generations.ts"
  merge_duplicate_users: "src/convex/ops.ts" # mergeDuplicateUsers
  ops_queries_actions: "src/convex/ops.ts"
  ops_pure: "src/convex/lib/ops.ts"
  stripe_webhook_posthog_discord: "src/convex/http.ts"
  posthog_component_wrapper: "src/convex/posthog.ts"
  app_config: "src/convex/convex.config.ts"
  signed_up: "src/convex/users.ts"
client:
  posthog_init: "src/lib/posthog.ts"
  failure_classification: "src/lib/analytics/generation.ts"
  session_attribution: "src/lib/analytics/session-attribution.ts"
  root_layout_capture: "src/routes/+layout.svelte"
  app_identify: "src/routes/(app)/app/+layout.svelte"
  generation_events: "src/routes/(app)/app/+page.svelte"
tests:
  - "src/lib/analytics/generation.test.ts"
  - "src/lib/analytics/session-attribution.test.ts"
  - "src/convex/lib/ops.test.ts"
sentry:
  - "src/instrumentation.server.ts"
  - "src/hooks.server.ts"
  - "src/hooks.client.ts"
```

---

## 19. Change checklist (agent)

```text
NEW PostHog event:
  - Add to §6 inventory; implement client OR server; validate env for server
  - If revenue-critical: MUST be server-side with idempotency gate

NEW generationOps eventType:
  - schema + GENERATION_OPS_EVENT_TYPES + insert sites + rollup row in summarizeGenerationOpsEvents

NEW ops alert field:
  - GenerationAlertContext + buildAlertFacts + recordAlertEvent args

Feed scale:
  - Replace full scan in getRecentGenerationOpsFeed if row count explodes
```
