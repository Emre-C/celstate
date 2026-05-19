# Production Confidence

This is the product reference for Celstate's shipped production-verification system. The formal model remains useful because the runner, gate logic, evidence persistence, and canary flows are implemented and intentionally specified as strict contracts.

## 1. Document role

```text
DOCUMENT_ROLE
  machine_readable_contract_for_downstream_llm_tasks
  INCLUDES verified_current_facts, enduring_knowledge, target_verification_contract,
           total_state_machines, nondeterministic_tla_modules, temporal_obligations,
           acceptance_predicates, rejection_predicates
  EXCLUDES ui_markup, user_visible_copy, html_bodies, prompt_text, image_bytes,
           screenshot_diffs, payment_processor_internal_implementation_not_observable_by_repo
```

**Status (2026-04):** The system is end-to-end operational. The contract library, gate evaluation, JSON Schema, unit tests, webhook settlement ledger, Convex persistence (`verificationRuns`, `verificationEvidence`, `canaryPrincipals`), production runner (`scripts/production-verification.ts`), auth/generation/checkout/settlement canaries, deploy-triggered verification via `deployment_status`, automated canary principal provisioning, and Stripe refund automation (`src/convex/creditPackPurchaseActions.ts`) are all in-repo. The deploy gate fires automatically on Vercel production deployments (via GitHub `deployment_status` events), with the runner exiting non-zero on DENY. Protected-route auth proof is required by default for `POST_DEPLOY` and `SCHEDULED` triggers. **Remaining external configuration:** Vercel deployment protection rules referencing the verification check status (not in-repo).

---

## 2. Scope and bounded abstraction

### 2.1 Objectives

```text
O1  Prove deploy safety for core feature domains {AUTH, GENERATION, CHECKOUT_SESSION, LIVE_SETTLEMENT}.
O2  Replace human-only post-deploy checking with machine-evaluable evidence.
O3  Separate non-destructive deploy canaries from destructive settlement canaries.
O4  Define release admissibility as a total decision function over domain verdicts.
```

### 2.2 In-scope system boundary

```text
B1  In scope: GitHub Actions CI, scheduled production canaries, deploy-scoped production canaries,
    Convex generation workflow, Stripe checkout-session creation, Stripe webhook settlement,
    credit-grant idempotency, auth health endpoints, verdict aggregation, release gating.
B2  Out of scope: marketing UX assertions, copy correctness, screenshot matching,
    unbounded user populations, arbitrary provider internals, browser-only analytics as release evidence.
B3  Abstraction discards payload text, rendered HTML content, image artifacts, provider-specific response bodies,
    and all identifiers except symbolic deployment, principal, and payment-intent keys.
```

### 2.3 Bounded model constants

```text
MAX_DOMAINS = 4
MAX_GENERATION_STAGES = 3
MAX_WEBHOOK_DELIVERIES = 3
MAX_REQUIRED_DEPLOY_DOMAINS = 3
```

---

## 3. Verified current facts

### 3.1 CI and repository-local verification

```text
CF1  .github/workflows/ci.yml executes pnpm test:auth and pnpm verify against repository code and preview infrastructure.
CF2  Current browser E2E coverage verifies marketing landing hydration and hero visibility only.
CF3  Current CI does not execute production-hosted authenticated auth, generation, checkout-session,
     or live-settlement probes.
```

### 3.2 Existing production auth evidence

```text
CF4  .github/workflows/auth-canary.yml executes scripts/check-auth-health.mjs on a 15-minute schedule and on manual dispatch.
CF5  scripts/check-auth-health.mjs probes /auth and `/api/auth/session` only.
CF6  scripts/auth-canary-probe.mjs and scripts/auth-canary-probe.test.ts define final acceptable session-probe statuses {200, 401};
     final 308 is rejected.
CF7  docs/product/authentication.md and docs/runbooks/CI-AND-CANARIES.md characterize auth-canary.yml as a smoke check (not full OAuth).
     They also point to production verification for protected-route reachability and deploy-scoped AUTH evidence; full OAuth E2E remains out of scope for that smoke workflow.
```

### 3.3 Existing checkout and settlement mechanisms

```text
CF8   src/convex/creditPackPurchase.ts inserts checkout requests with status = pending and schedules internal.creditPackPurchaseActions.processCheckout.
CF9   src/convex/creditPackPurchase.ts exposes owner-visible checkout states {pending, ready, failed}.
CF10  src/convex/creditPackPurchaseActions.ts creates Stripe checkout sessions server-side with mode = payment,
      successUrl = ${siteUrl}/app?success=true, cancelUrl = ${siteUrl}/app?canceled=true,
      and metadata carrying {priceId, userId}.
CF11  src/convex/creditPackPurchase.ts patches pending checkouts to ready with checkoutUrl = result.url ?? "" or to failed with an error string.
CF12  src/convex/lib/creditPackPurchase/lifecycle.ts grants settlement eligibility only when session.mode = payment and session.payment_status = paid.
CF13  src/convex/http.ts handles Stripe webhook events {checkout.session.completed, checkout.session.async_payment_succeeded}
      through one shared credit-pack settlement path.
CF14  src/convex/http.ts grants credits through internal.creditPackPurchase.onStripeCheckoutCompleted keyed by stripe payment intent,
      then emits server-side event credits_purchase_completed.
CF15  src/convex/lib/creditPackPurchase/lifecycle.ts enforces payment-intent deduplication before credit mutation and audit insert.
CF16  src/convex/lib/creditPackPurchase/lifecycle.ts implements recordPurchaseSettlementHelper
      (credit grant + purchaseSettlements row + revenue timestamp + pending refund reconciliation);
      src/convex/http.ts invokes creditPackPurchase.onStripeCheckoutCompleted on eligible checkout.session webhook events.
CF16a src/convex/creditPackPurchase.ts exposes getSettlementByPaymentIntentId and getSettlementByPendingCheckoutId for audit-style reads.
```

### 3.4 Existing generation mechanisms

```text
CF17  src/convex/generations.ts represents active generation work with status = generating and stage ∈ {white_background, black_background, finalizing}.
CF18  src/convex/generations.ts transitions terminal generation status to complete or failed.
CF19  src/convex/generations.ts refunds credits on terminal failure when creditRefundedAt is absent and a user row is present.
CF20  src/convex/generations.ts distinguishes stalled-generation warning from timeout failure inside cleanupStaleGenerations.
CF21  cleanupStaleGenerations emits a warning path before timeout and a failure-plus-refund path after timeout.
```

### 3.5 Production verification runner and persistence

```text
CF25  scripts/production-verification.ts exercises AUTH, GENERATION, CHECKOUT_SESSION, and LIVE_SETTLEMENT (scheduled only)
      canaries against a live production deployment, collecting typed evidence and ingesting results to Convex.
CF26  .github/workflows/production-verification.yml triggers on deployment_status (production success), workflow_call,
      workflow_dispatch, and weekly schedule; the runner exits non-zero on DENY.
CF27  src/convex/verification.ts implements ingestVerificationRun (writing to verificationRuns and verificationEvidence)
      and upsertCanaryPrincipal (provisioning canary principal bindings from canonical app users).
CF28  src/convex/http.ts exposes HTTP routes for all canary operations: /verification/ingest,
      /verification/canary/{start-generation, generation-status, start-checkout, checkout-status,
      settlement-by-checkout, refund-settlement, upsert-principal, start-settlement-checkout, settlement-checkout-status}.
CF29  scripts/production-verification.ts auto-provisions required canary principals (CANARY_GENERATION, CANARY_CHECKOUT,
      and CANARY_SETTLEMENT for scheduled triggers) before running probes via /verification/canary/upsert-principal.
CF30  Protected-route auth proof (AuthCanaryEvidence.protectedRouteReachable) is required by default for POST_DEPLOY
      and SCHEDULED triggers; opt-out requires explicit AUTH_CANARY_REQUIRE_PROTECTED_ROUTE=false.
CF31  src/convex/creditPackPurchaseActions.ts provides automated Stripe refund for destructive settlement canaries,
      invoked by the runner via /verification/canary/refund-settlement.
```

### 3.6 Evidence-class partition

```text
CF32  docs/product/observability.md defines credits_purchase_completed as a server-side authoritative revenue signal.
CF33  docs/product/observability.md defines generation_completed and generation_failed as client-captured analytics signals.
CF34  Browser-captured analytics are explicitly non-authoritative for revenue correctness.
```

---

## 4. Enduring knowledge

```text
EK1   Auth endpoint availability is necessary but not sufficient for authenticated product-path correctness.
EK2   Final 401 from `/api/auth/session` is an admissible healthy unauthenticated result.
EK3   Canonical-origin correctness is part of auth correctness because redirect and cookie semantics depend on origin consistency.
EK4   Checkout-session creation and payment settlement are separate obligations and must not be collapsed into one probe.
EK5   Checkout-session creation can be proven without spending money.
EK6   Live settlement cannot be proven conclusively by preview, sandbox, or test-mode-only execution.
EK7   Stripe webhook delivery is at-least-once; duplicate delivery must not imply duplicate grant.
EK8   Credits are granted only from webhook-confirmed paid sessions, not from browser redirects.
EK9   Generation correctness is asynchronous, stageful, and admits both stall and timeout.
EK10  Generation failure handling includes a compensating credit action.
EK11  A production generation canary can avoid live payment by using a dedicated pre-funded principal.
EK12  Client-observed signals are admissible for product analytics and inadmissible for authoritative deploy verdicts.
EK13  Deploy confidence is a composition over domain verdicts, not a scalar derived from one probe.
EK14  If live-settlement proof depends on persisted local evidence, a first-class settlement ledger must exist on the authoritative path.
```

---

## 5. Target verification contract

### 5.1 TypeScript: domain vocabulary

```typescript
export type FeatureDomain =
  | 'AUTH'
  | 'GENERATION'
  | 'CHECKOUT_SESSION'
  | 'LIVE_SETTLEMENT';

export type VerificationTrigger =
  | 'PRE_MERGE_CI'
  | 'POST_DEPLOY'
  | 'SCHEDULED';

export type Verdict =
  | 'PENDING'
  | 'RUNNING'
  | 'PASSED'
  | 'FAILED'
  | 'TIMEOUT'
  | 'SKIPPED';

export type TerminalVerdict = Exclude<Verdict, 'PENDING' | 'RUNNING'>;

export type RequirementClass =
  | 'REQUIRED_ON_DEPLOY'
  | 'REQUIRED_ON_SCHEDULE'
  | 'OPTIONAL';

export type CanaryPrincipalId =
  | 'CANARY_AUTH'
  | 'CANARY_GENERATION'
  | 'CANARY_CHECKOUT'
  | 'CANARY_SETTLEMENT';

export type CanaryFundingClass =
  | 'NONE'
  | 'PRE_FUNDED_CREDITS'
  | 'LIVE_PAYMENT';
```

### 5.2 TypeScript: target-state verification records

```typescript
export type VerdictByDomain = Readonly<Record<FeatureDomain, Verdict>>;

export interface CanaryPrincipal {
  readonly id: CanaryPrincipalId;
  readonly proves: FeatureDomain;
  readonly destructive: boolean;
  readonly fundingClass: CanaryFundingClass;
}

export interface DomainVerdictRecord {
  readonly domain: FeatureDomain;
  readonly trigger: VerificationTrigger;
  readonly requirement: RequirementClass;
  readonly verdict: Verdict;
  readonly evidenceRef: string;
  readonly startedAt: number;
  readonly finishedAt?: number;
  /** Optional human-readable diagnostic note (e.g. why a verdict is SKIPPED or which probe stage failed). */
  readonly note?: string;
  /** Populated only for LIVE_SETTLEMENT verdicts; absent for other domains. */
  readonly settlementOutcome?: SettlementOutcome;
}

export interface DeploymentVerificationRun {
  readonly deploymentId: string;
  readonly trigger: 'POST_DEPLOY';
  readonly verdictByDomain: VerdictByDomain;
  readonly releaseDecision: 'ALLOW' | 'DENY';
  readonly startedAt: number;
  readonly finishedAt?: number;
}
```

### 5.3 TypeScript: target-state evidence contracts

```typescript
export interface AuthCanaryEvidence {
  readonly authPageHealthy: boolean;
  readonly sessionEndpointHealthy: boolean;
  readonly protectedRouteReachable: boolean;
}

export interface GenerationCanaryEvidence {
  readonly requestAccepted: boolean;
  readonly terminalVerdict: 'COMPLETE' | 'FAILED' | 'TIMEOUT';
  readonly artifactPresent: boolean;
  readonly refundObserved: boolean;
}

export interface CheckoutSessionCanaryEvidence {
  readonly requestAccepted: boolean;
  readonly pendingObserved: boolean;
  readonly readyObserved: boolean;
  readonly hostedCheckoutUrlPresent: boolean;
}

export interface LiveSettlementCanaryEvidence {
  readonly checkoutCommitted: boolean;
  readonly paidWebhookObserved: boolean;
  readonly creditGrantCount: 0 | 1;
  readonly authoritativeRevenueCount: 0 | 1;
  readonly refundObserved: boolean;
}
```

### 5.4 TypeScript: current-runtime abstractions referenced by the contract

```typescript
export type ExistingPendingCheckoutState = 'pending' | 'ready' | 'failed';

export type ExistingGenerationStage =
  | 'white_background'
  | 'black_background'
  | 'finalizing';

export type ExistingGenerationStatus =
  | 'generating'
  | 'complete'
  | 'failed';

export interface ExistingPendingCheckoutModel {
  readonly status: ExistingPendingCheckoutState;
  readonly checkoutUrl?: string;
  readonly error?: string;
}

export interface ExistingGenerationModel {
  readonly status: ExistingGenerationStatus;
  readonly stage?: ExistingGenerationStage;
  readonly creditRefundedAt?: number;
  readonly resultStorageId?: string;
}
```

### 5.5 JSON Schema: gate configuration

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "$id": "urn:celstate:production-confidence:GateConfig",
  "type": "object",
  "required": ["requiredOnDeploy", "requiredOnSchedule"],
  "properties": {
    "requiredOnDeploy": {
      "type": "array",
      "items": {
        "type": "string",
        "enum": ["AUTH", "GENERATION", "CHECKOUT_SESSION", "LIVE_SETTLEMENT"]
      },
      "uniqueItems": true,
      "minItems": 1,
      "maxItems": 3
    },
    "requiredOnSchedule": {
      "type": "array",
      "items": {
        "type": "string",
        "enum": ["AUTH", "GENERATION", "CHECKOUT_SESSION", "LIVE_SETTLEMENT"]
      },
      "uniqueItems": true,
      "minItems": 1,
      "maxItems": 4
    }
  },
  "additionalProperties": false
}
```

---

## 6. Exhaustive state machines

### 6.1 Deploy verification coordinator

```text
MODULE DeployVerificationCoordinator

CoordinatorState ::= { IDLE, RUNNING, PASSED, FAILED }
DomainVerdict     ::= { ABSENT, PENDING, RUNNING, PASSED, FAILED, TIMEOUT, SKIPPED }
Domain            ::= { AUTH, GENERATION, CHECKOUT_SESSION, LIVE_SETTLEMENT }

CoordinatorEvent ::= {
  E_START,
  E_FINALIZE_PASS,
  E_FINALIZE_FAIL,
  E_NOOP
}

DomainEvent ::= {
  E_REQUIRE,
  E_BEGIN,
  E_PASS,
  E_FAIL,
  E_TIMEOUT,
  E_SKIP,
  E_NOOP
}

δc(state, event, verdictByDomain) =
  case
    state = IDLE
      ∧ event = E_START                                   -> RUNNING

    state = RUNNING
      ∧ event = E_FINALIZE_PASS
      ∧ ∀ d ∈ requiredOnDeploy : verdictByDomain[d] = PASSED
                                                          -> PASSED

    state = RUNNING
      ∧ event = E_FINALIZE_FAIL
      ∧ ∃ d ∈ requiredOnDeploy : verdictByDomain[d] ∈ { FAILED, TIMEOUT, SKIPPED }
                                                          -> FAILED

    state ∈ { PASSED, FAILED }                            -> state
    OTHER                                                 -> state
  end

δd(verdict, event) =
  case
    verdict = ABSENT  ∧ event = E_REQUIRE                 -> PENDING
    verdict = PENDING ∧ event = E_BEGIN                   -> RUNNING
    verdict = RUNNING ∧ event = E_PASS                    -> PASSED
    verdict ∈ { PENDING, RUNNING } ∧ event = E_FAIL       -> FAILED
    verdict ∈ { PENDING, RUNNING } ∧ event = E_TIMEOUT    -> TIMEOUT
    verdict = PENDING ∧ event = E_SKIP                    -> SKIPPED
    verdict ∈ { PASSED, FAILED, TIMEOUT, SKIPPED }        -> verdict
    OTHER                                                 -> verdict
  end

Totality condition:
  δc is total over CoordinatorState × CoordinatorEvent.
  δd is total over DomainVerdict × DomainEvent.
```

### 6.2 Generation canary lifecycle

```text
MODULE GenerationCanaryLifecycle

State ::= {
  IDLE,
  REQUESTED,
  WHITE_BACKGROUND,
  BLACK_BACKGROUND,
  FINALIZING,
  COMPLETE,
  FAILED,
  REFUNDED,
  TIMEOUT
}

Event ::= {
  E_REQUEST_ACCEPTED,
  E_ENTER_WHITE_BACKGROUND,
  E_ENTER_BLACK_BACKGROUND,
  E_ENTER_FINALIZING,
  E_COMPLETE,
  E_FAIL,
  E_TIMEOUT,
  E_REFUND,
  E_NOOP
}

δ(state, event) =
  case
    state = IDLE               ∧ event = E_REQUEST_ACCEPTED       -> REQUESTED
    state = REQUESTED          ∧ event = E_ENTER_WHITE_BACKGROUND -> WHITE_BACKGROUND
    state = WHITE_BACKGROUND   ∧ event = E_ENTER_BLACK_BACKGROUND -> BLACK_BACKGROUND
    state = BLACK_BACKGROUND   ∧ event = E_ENTER_FINALIZING       -> FINALIZING
    state = FINALIZING         ∧ event = E_COMPLETE               -> COMPLETE

    state ∈ { REQUESTED, WHITE_BACKGROUND, BLACK_BACKGROUND, FINALIZING }
      ∧ event = E_FAIL                                          -> FAILED

    state ∈ { REQUESTED, WHITE_BACKGROUND, BLACK_BACKGROUND, FINALIZING }
      ∧ event = E_TIMEOUT                                       -> TIMEOUT

    state ∈ { FAILED, TIMEOUT } ∧ event = E_REFUND              -> REFUNDED
    state ∈ { COMPLETE, REFUNDED }                              -> state
    OTHER                                                       -> state
  end

Totality condition:
  δ is total over State × Event.
```

### 6.3 Checkout-session canary lifecycle

```text
MODULE CheckoutSessionCanaryLifecycle

State ::= { IDLE, REQUESTED, PENDING, READY, FAILED, TIMEOUT }

Event ::= {
  E_REQUEST_ACCEPTED,
  E_PENDING_OBSERVED,
  E_READY_OBSERVED,
  E_FAIL_OBSERVED,
  E_TIMEOUT,
  E_NOOP
}

δ(state, event) =
  case
    state = IDLE      ∧ event = E_REQUEST_ACCEPTED   -> REQUESTED
    state = REQUESTED ∧ event = E_PENDING_OBSERVED   -> PENDING
    state = REQUESTED ∧ event = E_READY_OBSERVED     -> READY
    state = REQUESTED ∧ event = E_FAIL_OBSERVED      -> FAILED
    state = REQUESTED ∧ event = E_TIMEOUT            -> TIMEOUT
    state = PENDING   ∧ event = E_READY_OBSERVED     -> READY
    state = PENDING   ∧ event = E_FAIL_OBSERVED      -> FAILED
    state = PENDING   ∧ event = E_TIMEOUT            -> TIMEOUT
    state ∈ { READY, FAILED, TIMEOUT }               -> state
    OTHER                                            -> state
  end

Totality condition:
  δ is total over State × Event.
```

### 6.4 Live-settlement canary lifecycle

```text
MODULE LiveSettlementCanaryLifecycle

State ::= {
  IDLE,
  SESSION_READY,
  PAYMENT_COMMITTED,
  PAID_WEBHOOK_OBSERVED,
  GRANT_RECORDED,
  REFUND_RECORDED,
  FAILED,
  TIMEOUT
}

Event ::= {
  E_SESSION_READY,
  E_PAYMENT_COMMITTED,
  E_PAID_WEBHOOK_OBSERVED,
  E_GRANT_RECORDED,
  E_REFUND_RECORDED,
  E_FAIL,
  E_TIMEOUT,
  E_NOOP
}

δ(state, event) =
  case
    state = IDLE                 ∧ event = E_SESSION_READY          -> SESSION_READY
    state = SESSION_READY        ∧ event = E_PAYMENT_COMMITTED      -> PAYMENT_COMMITTED
    state = PAYMENT_COMMITTED    ∧ event = E_PAID_WEBHOOK_OBSERVED  -> PAID_WEBHOOK_OBSERVED
    state = PAID_WEBHOOK_OBSERVED ∧ event = E_GRANT_RECORDED        -> GRANT_RECORDED
    state = GRANT_RECORDED       ∧ event = E_REFUND_RECORDED        -> REFUND_RECORDED

    state ∈ { SESSION_READY, PAYMENT_COMMITTED, PAID_WEBHOOK_OBSERVED, GRANT_RECORDED }
      ∧ event = E_FAIL                                            -> FAILED

    state ∈ { SESSION_READY, PAYMENT_COMMITTED, PAID_WEBHOOK_OBSERVED, GRANT_RECORDED }
      ∧ event = E_TIMEOUT                                         -> TIMEOUT

    state ∈ { REFUND_RECORDED, FAILED, TIMEOUT }                  -> state
    OTHER                                                         -> state
  end

Totality condition:
  Duplicate webhook delivery is abstracted out of this lifecycle and specified only in PaymentIdempotency.
  δ is total over State × Event.
```

---

## 7. TLA+ specifications

### 7.1 Deploy gate soundness

```tla
------------------------------ MODULE DeployGate ------------------------------
EXTENDS FiniteSets

CONSTANTS Domain, RequiredOnDeploy
ASSUME Domain = {"AUTH", "GENERATION", "CHECKOUT_SESSION", "LIVE_SETTLEMENT"}
ASSUME RequiredOnDeploy \subseteq Domain

Verdict == {"PENDING", "RUNNING", "PASSED", "FAILED", "TIMEOUT", "SKIPPED"}
TerminalVerdict == {"PASSED", "FAILED", "TIMEOUT", "SKIPPED"}

VARIABLES outcome, release_open

TypeOK ==
  /\ outcome \in [Domain -> Verdict]
  /\ release_open \in BOOLEAN

Init ==
  /\ outcome = [d \in Domain |-> "PENDING"]
  /\ release_open = FALSE

SetOutcome(d, v) ==
  /\ d \in Domain
  /\ v \in Verdict
  /\ outcome' = [outcome EXCEPT ![d] = v]
  /\ UNCHANGED release_open

OpenRelease ==
  /\ ~release_open
  /\ \A d \in RequiredOnDeploy : outcome[d] = "PASSED"
  /\ release_open' = TRUE
  /\ UNCHANGED outcome

Stutter == UNCHANGED <<outcome, release_open>>

Next ==
  \/ (\E d \in Domain : SetOutcome(d, "RUNNING"))
  \/ (\E d \in Domain : SetOutcome(d, "PASSED"))
  \/ (\E d \in Domain : SetOutcome(d, "FAILED"))
  \/ (\E d \in Domain : SetOutcome(d, "TIMEOUT"))
  \/ (\E d \in Domain : SetOutcome(d, "SKIPPED"))
  \/ OpenRelease
  \/ Stutter

Spec == Init /\ [][Next]_<<outcome, release_open>>

Safety_ReleaseRequiresRequiredPass ==
  [](release_open => \A d \in RequiredOnDeploy : outcome[d] = "PASSED")

Safety_FailureOrTimeoutBlocksRelease ==
  []((\E d \in RequiredOnDeploy : outcome[d] \in {"FAILED", "TIMEOUT", "SKIPPED"}) => ~release_open)

=============================================================================
```

### 7.2 Stripe settlement idempotency

```tla
--------------------------- MODULE PaymentIdempotency ---------------------------
EXTENDS Naturals

CONSTANTS MaxWebhookDeliveries
ASSUME MaxWebhookDeliveries \in 1..3

VARIABLES
  paid,
  deliveries,
  grant_count,
  authoritative_revenue_count,
  refund_count

TypeOK ==
  /\ paid \in BOOLEAN
  /\ deliveries \in 0..MaxWebhookDeliveries
  /\ grant_count \in 0..1
  /\ authoritative_revenue_count \in 0..1
  /\ refund_count \in 0..1

Init ==
  /\ paid = FALSE
  /\ deliveries = 0
  /\ grant_count = 0
  /\ authoritative_revenue_count = 0
  /\ refund_count = 0

CommitPayment ==
  /\ ~paid
  /\ paid' = TRUE
  /\ UNCHANGED <<deliveries, grant_count, authoritative_revenue_count, refund_count>>

DeliverWebhook ==
  /\ paid
  /\ deliveries < MaxWebhookDeliveries
  /\ deliveries' = deliveries + 1
  /\ UNCHANGED <<paid, grant_count, authoritative_revenue_count, refund_count>>

GrantAndEmit ==
  /\ deliveries > 0
  /\ grant_count = 0
  /\ authoritative_revenue_count = 0
  /\ grant_count' = 1
  /\ authoritative_revenue_count' = 1
  /\ UNCHANGED <<paid, deliveries, refund_count>>

Refund ==
  /\ grant_count = 1
  /\ refund_count = 0
  /\ refund_count' = 1
  /\ UNCHANGED <<paid, deliveries, grant_count, authoritative_revenue_count>>

Stutter == UNCHANGED <<paid, deliveries, grant_count, authoritative_revenue_count, refund_count>>

Next == CommitPayment \/ DeliverWebhook \/ GrantAndEmit \/ Refund \/ Stutter

Spec == Init /\ [][Next]_<<paid, deliveries, grant_count, authoritative_revenue_count, refund_count>>

Safety_AtMostOneGrant == [](grant_count <= 1)
Safety_AtMostOneAuthoritativeRevenueEvent == [](authoritative_revenue_count <= 1)
Safety_AuthoritativeRevenueImpliesGrant == [](authoritative_revenue_count = 1 => grant_count = 1)

=============================================================================
```

### 7.3 Generation completion or compensation

```tla
------------------------- MODULE GenerationCompensation -------------------------
EXTENDS Naturals

Phase == {"WHITE", "BLACK", "FINAL", "DONE"}

VARIABLES
  phase,
  failed,
  timed_out,
  refunded,
  artifact_present

TypeOK ==
  /\ phase \in Phase
  /\ failed \in BOOLEAN
  /\ timed_out \in BOOLEAN
  /\ refunded \in BOOLEAN
  /\ artifact_present \in BOOLEAN

Init ==
  /\ phase = "WHITE"
  /\ failed = FALSE
  /\ timed_out = FALSE
  /\ refunded = FALSE
  /\ artifact_present = FALSE

AdvanceWhite ==
  /\ phase = "WHITE"
  /\ ~failed /\ ~timed_out /\ ~artifact_present
  /\ phase' = "BLACK"
  /\ UNCHANGED <<failed, timed_out, refunded, artifact_present>>

AdvanceBlack ==
  /\ phase = "BLACK"
  /\ ~failed /\ ~timed_out /\ ~artifact_present
  /\ phase' = "FINAL"
  /\ UNCHANGED <<failed, timed_out, refunded, artifact_present>>

Complete ==
  /\ phase = "FINAL"
  /\ ~failed /\ ~timed_out /\ ~artifact_present
  /\ phase' = "DONE"
  /\ artifact_present' = TRUE
  /\ UNCHANGED <<failed, timed_out, refunded>>

Fail ==
  /\ phase \in {"WHITE", "BLACK", "FINAL"}
  /\ ~failed /\ ~timed_out /\ ~artifact_present
  /\ failed' = TRUE
  /\ UNCHANGED <<phase, timed_out, refunded, artifact_present>>

Timeout ==
  /\ phase \in {"WHITE", "BLACK", "FINAL"}
  /\ ~failed /\ ~timed_out /\ ~artifact_present
  /\ timed_out' = TRUE
  /\ UNCHANGED <<phase, failed, refunded, artifact_present>>

Refund ==
  /\ (failed \/ timed_out)
  /\ ~refunded
  /\ refunded' = TRUE
  /\ UNCHANGED <<phase, failed, timed_out, artifact_present>>

Stutter == UNCHANGED <<phase, failed, timed_out, refunded, artifact_present>>

Next == AdvanceWhite \/ AdvanceBlack \/ Complete \/ Fail \/ Timeout \/ Refund \/ Stutter

Spec == Init /\ [][Next]_<<phase, failed, timed_out, refunded, artifact_present>>

Safety_NoArtifactAndRefund == []~(artifact_present /\ refunded)
Safety_RefundRequiresFailureOrTimeout == [](refunded => (failed \/ timed_out))

=============================================================================
```

---

## 8. Temporal logic vocabulary

```text
Domain                    ::= { AUTH, GENERATION, CHECKOUT_SESSION, LIVE_SETTLEMENT }
requiredOnDeploy          ::= { AUTH, GENERATION, CHECKOUT_SESSION }
requiredOnSchedule        ::= { AUTH, GENERATION, CHECKOUT_SESSION, LIVE_SETTLEMENT }
verdict[d]                ::= current domain verdict for d ∈ Domain
release_open              ::= deploy gate admits promotion
authoritative_deploy_verdict ::= machine-evaluable release evidence derived from authoritative sources only
coordinator_started       ::= deploy verification coordinator has transitioned from IDLE to RUNNING
coordinator_failed        ::= coordinator terminal state = FAILED
payment_committed         ::= live payment has been irreversibly committed by the canary principal
grant_count               ::= number of authoritative credit grants for one payment intent in the bounded model
authoritative_revenue_count ::= number of authoritative revenue emissions for one payment intent in the bounded model
deliveries                ::= number of webhook deliveries observed for one payment intent in the bounded model
generation_requested      ::= generation canary request has been accepted
artifact_present          ::= generation terminal success artifact exists
failed                    ::= generation terminal failure observed
timed_out                 ::= generation timeout observed
refunded                  ::= compensating credit refund observed
client_signal_only        ::= evidence source set excludes authoritative server-side state transition evidence
```

---

## 9. Safety invariants and liveness guarantees

### 9.1 Safety invariants

```text
SI1  □(release_open ⇒ ∀ d ∈ requiredOnDeploy : verdict[d] = PASSED)
SI2  □(grant_count ≤ 1)
SI3  □(authoritative_revenue_count ≤ 1)
SI4  □(authoritative_revenue_count = 1 ⇒ grant_count = 1)
SI5  □¬(artifact_present ∧ refunded)
SI6  □(refunded ⇒ failed ∨ timed_out)
SI7  □(verdict[LIVE_SETTLEMENT] = PASSED ⇒ grant_count = 1 ∧ authoritative_revenue_count = 1)
SI8  □(client_signal_only ⇒ ¬authoritative_deploy_verdict)
```

### 9.2 Fairness assumptions

```text
FA1  Weak fairness on required-domain scheduling during deploy-scoped verification.
FA2  Weak fairness on webhook delivery retries until deliveries = MAX_WEBHOOK_DELIVERIES or settlement is proven.
FA3  Weak fairness on generation worker scheduling and stale-generation cleanup.
```

### 9.3 Liveness guarantees under fairness assumptions

```text
LG1  FA1 ⊨ □(coordinator_started ⇒ ◇(release_open ∨ coordinator_failed))
LG2  FA2 ⊨ □(payment_committed ⇒ ◇(grant_count = 1 ∨ deliveries = MAX_WEBHOOK_DELIVERIES))
LG3  FA3 ⊨ □(generation_requested ⇒ ◇(artifact_present ∨ refunded))
LG4  FA3 ⊨ □((failed ∨ timed_out) ⇒ ◇refunded)
```

---

## 10. Gap registry

### 10.1 Implemented in repository

```text
I1   COMPLETE — Library contract: src/lib/production-confidence.ts implements §5 vocabulary, GateConfig + DEFAULT_GATE_CONFIG,
     predicates (§14), evaluateReleaseDecision / buildDeploymentVerificationRun, coordinator and domain lifecycle transitions (§6),
     classifySettlementOutcome / classifyGenerationOutcome, and CANARY_PRINCIPAL_CONFIG (canonical emails and roles per BO2 shape).
I2   COMPLETE — Unit tests: src/lib/production-confidence.test.ts runs under pnpm test (vite.config.ts include pattern).
I3   COMPLETE — JSON Schema: src/lib/production-confidence-gate-config.schema.json matches GateConfig (requiredOnDeploy max 3 domains).
I4   COMPLETE — Settlement ledger on authoritative webhook: src/convex/http.ts calls internal.creditPackPurchase.onStripeCheckoutCompleted;
     purchaseSettlements + creditGrants rows; addresses former G9 / BO9 ledger gap for the production webhook path.
I5   COMPLETE — Persistence: src/convex/verification.ts implements ingestVerificationRun (writes verificationRuns + verificationEvidence)
     and upsertCanaryPrincipal (writes canaryPrincipals); production runner ingests results on every run.
I6   COMPLETE — Deploy-scoped verification: .github/workflows/production-verification.yml triggers on deployment_status
     (production success), workflow_call, workflow_dispatch, and weekly schedule; runner evaluates releaseDecision and exits non-zero on DENY.
I7   COMPLETE — Authenticated auth canary: scripts/production-verification.ts probes protectedRouteReachable via Playwright
     with pre-loaded storage state; required by default for POST_DEPLOY and SCHEDULED triggers.
I8   COMPLETE — Production canaries: scripts/production-verification.ts exercises AUTH, GENERATION, CHECKOUT_SESSION,
     and LIVE_SETTLEMENT (scheduled) canaries end-to-end against live infrastructure.
I9   COMPLETE — Refund automation: src/convex/creditPackPurchaseActions.ts issues Stripe refunds for destructive settlement canaries;
     runner calls /verification/canary/refund-settlement after settlement observation.
I10  COMPLETE — Canary principal provisioning: runner auto-provisions required canary principals via
     /verification/canary/upsert-principal before running probes (CF29).
```

### 10.2 Closed gaps

```text
G1   CLOSED — production-verification.yml fires on deployment_status for production deployments; runner computes
     and persists a full verdict vector over {AUTH, GENERATION, CHECKOUT_SESSION, LIVE_SETTLEMENT}.
G2   CLOSED — Auth canary proves protectedRouteReachable; required by default for POST_DEPLOY/SCHEDULED (CF30).
G3   CLOSED — Production generation canary exercises start-generation → poll → terminal status (CF25).
G4   CLOSED — Production checkout-session canary exercises start-checkout → poll → ready with hosted URL (CF25).
G5   CLOSED — Scheduled live-settlement canary exercises full pay → settle → refund lifecycle (CF25).
G6   CLOSED — ingestVerificationRun persists verificationRuns and verificationEvidence on every runner invocation (CF27).
G7   CLOSED — Runner exits non-zero on DENY; deployment_status trigger makes this a GitHub check on the deployment (CF26).
G8   CLOSED — Runner auto-provisions canary principals before probes via upsert-principal endpoint (CF29).
G9   CLOSED — creditPackPurchaseActions.refundCheckoutForCanary provides automated Stripe refunds for settlement canaries (CF31).
```

### 10.3 Remaining external configuration

```text
EC1  Vercel deployment protection rules referencing the production-verification check status (external to repo).
EC2  Canary WorkOS user accounts + app user rows must exist before first provisioning succeeds (one-time manual bootstrap).
EC3  GitHub secrets (VERIFICATION_RUNNER_SECRET, CONVEX_URL, AUTH_CANARY_BASE_URL, AUTH_CANARY_STORAGE_JSON) must be configured.
```

---

## 11. Build obligations

### 11.1 Required artifacts

```text
BO1  DONE — Schema + persistence: verificationRuns written by ingestVerificationRun on every runner invocation;
     one run row per deployment/trigger with per-domain verdict records and releaseDecision.
BO2  DONE — Canary principals: CANARY_PRINCIPAL_CONFIG + canaryPrincipals table + upsertCanaryPrincipal mutation;
     runner auto-provisions required principals before probes via /verification/canary/upsert-principal.
BO3  DONE — Authenticated auth canary: Playwright probes protectedRouteReachable with pre-loaded storage state;
     required by default for POST_DEPLOY/SCHEDULED triggers.
BO4  DONE — Production generation canary: runner exercises start-generation → poll → terminal status with pre-funded principal.
BO5  DONE — Production checkout-session canary: runner exercises start-checkout → poll → ready with hosted URL.
BO6  DONE — Scheduled live-settlement canary: runner exercises full pay → settle → grant observation → refund lifecycle.
BO7  DONE — Deploy gate: evaluateReleaseDecision invoked by runner; runner exits non-zero on DENY;
     deployment_status trigger on production-verification.yml creates a GitHub check on the deployment.
BO8  DONE — Evidence persistence: createEvidenceRef + verificationEvidence table; runner persists evidence payloads
     with evidenceRef on every terminal verdict via ingestVerificationRun.
BO9  DONE — recordPurchaseSettlementHelper on webhook path (see CF16); purchaseSettlements is first-class on settlement.
BO10 DONE — Release predicate enforced: evaluateReleaseDecision returns DENY → runner exits non-zero → workflow fails.
```

### 11.2 Recommended requirement partition

```text
RP1  REQUIRED_ON_DEPLOY   = { AUTH, GENERATION, CHECKOUT_SESSION }
RP2  REQUIRED_ON_SCHEDULE = { AUTH, GENERATION, CHECKOUT_SESSION, LIVE_SETTLEMENT }
RP3  OPTIONAL             = ∅
```

---

## 12. Verification obligations

### 12.1 Static and model obligations

```text
VO1  ModelCheck(DeployGate, TypeOK ∧ Safety_ReleaseRequiresRequiredPass ∧ Safety_FailureOrTimeoutBlocksRelease) — not automated in repo.
VO2  ModelCheck(PaymentIdempotency, TypeOK ∧ Safety_AtMostOneGrant ∧ Safety_AtMostOneAuthoritativeRevenueEvent) — not automated in repo.
VO3  ModelCheck(GenerationCompensation, TypeOK ∧ Safety_NoArtifactAndRefund ∧ Safety_RefundRequiresFailureOrTimeout) — not automated in repo.
VO4  PARTIAL — Unit tests exercise transitionCoordinator, transitionDomainVerdict, lifecycle transitions, and gate evaluation
      (src/lib/production-confidence.test.ts); full totality proofs for every OTHER branch are not enumerated in tests.
VO5  Not covered by automated proof; recordPurchaseSettlementHelper dedups by payment intent at the data layer.
```

### 12.2 Runtime obligations

```text
VO6   DONE — Runner ingests a full verification run (all domain verdicts + releaseDecision) to Convex via ingestVerificationRun.
VO7   DONE — Terminal verdicts per domain are emitted by the production runner and persisted as verificationRuns rows.
VO8   DONE — Auth canary collects protectedRouteReachable via Playwright; required by default for POST_DEPLOY/SCHEDULED.
VO9   DONE — Generation canary exercises start → poll → terminal status against live Convex + provider.
VO10  DONE — Checkout-session canary exercises start → poll → ready with hosted URL against live Stripe.
VO11  DONE — Live-settlement canary exercises pay → settle → grant → refund against live Stripe (scheduled trigger).
VO12  PARTIAL — Duplicate-delivery behavior enforced in settlement mutation (recordPurchaseSettlementHelper dedup by payment intent);
      no canary specifically asserts idempotency under synthetic duplicate webhook delivery end-to-end.
```

---

## 13. Evidence map

```text
EVIDENCE.CI_WORKFLOW                    = .github/workflows/ci.yml
EVIDENCE.PRODUCTION_VERIFICATION_WF     = .github/workflows/production-verification.yml
EVIDENCE.AUTH_CANARY_WORKFLOW           = .github/workflows/auth-canary.yml
EVIDENCE.PRODUCTION_VERIFICATION_RUNNER = scripts/production-verification.ts
EVIDENCE.AUTH_CANARY_SCRIPT             = scripts/check-auth-health.mjs
EVIDENCE.AUTH_CANARY_CONTRACT           = scripts/auth-canary-probe.mjs
EVIDENCE.AUTH_CANARY_CONTRACT_TEST      = scripts/auth-canary-probe.test.ts
EVIDENCE.AUTH_PRODUCT_DOC               = docs/product/authentication.md
EVIDENCE.CI_AND_CANARIES_RUNBOOK        = docs/runbooks/CI-AND-CANARIES.md
EVIDENCE.PENDING_CHECKOUT_MODEL         = src/convex/creditPackPurchase.ts
EVIDENCE.CHECKOUT_SESSION_CREATION      = src/convex/creditPackPurchaseActions.ts
EVIDENCE.CHECKOUT_SETTLEMENT_GUARD      = src/convex/lib/creditPackPurchase/lifecycle.ts
EVIDENCE.WEBHOOK_SETTLEMENT_PATH        = src/convex/http.ts (Stripe webhooks + verification canary HTTP routes)
EVIDENCE.CREDIT_GRANT_IDEMPOTENCY       = src/convex/lib/creditPackPurchase/lifecycle.ts
EVIDENCE.PURCHASE_SETTLEMENT_LEDGER     = src/convex/creditPackPurchase.ts + src/convex/lib/creditPackPurchase/lifecycle.ts
EVIDENCE.GENERATION_WORKFLOW            = src/convex/generations.ts
EVIDENCE.OBSERVABILITY_PRODUCT_DOC      = docs/product/observability.md
EVIDENCE.PRODUCTION_CONFIDENCE_LIB      = src/lib/production-confidence.ts
EVIDENCE.PRODUCTION_CONFIDENCE_TESTS    = src/lib/production-confidence.test.ts
EVIDENCE.GATE_CONFIG_SCHEMA             = src/lib/production-confidence-gate-config.schema.json
EVIDENCE.VERIFICATION_PERSISTENCE       = src/convex/verification.ts (ingestVerificationRun, upsertCanaryPrincipal)
EVIDENCE.VERIFICATION_SCHEMA            = src/convex/schema.ts (verificationRuns, verificationEvidence, canaryPrincipals)
EVIDENCE.STRIPE_REFUND_VERIFICATION     = src/convex/creditPackPurchaseActions.ts (refundCheckoutForCanary)
```

---

## 14. Terminal predicates

### 14.1 Acceptance predicate

```text
ACCEPT_DEPLOY ≜ ∀ d ∈ requiredOnDeploy : verdict[d] = PASSED
```

### 14.2 Rejection predicate

```text
REJECT_DEPLOY ≜ ∃ d ∈ requiredOnDeploy : verdict[d] ∈ { FAILED, TIMEOUT, SKIPPED }
```

### 14.3 Scheduled-health predicate

```text
SCHEDULED_SYSTEM_HEALTHY ≜ ∀ d ∈ requiredOnSchedule : verdict[d] = PASSED
```

---

## 15. Symbol glossary

```text
authoritative_deploy_verdict   machine-evaluable release evidence derived from server-side state transitions or probe outcomes
authoritative_revenue_count    bounded count of server-side authoritative revenue emissions for one payment intent
canary_principal               dedicated identity reserved for verification flows rather than end-user work
deploy_scoped_canary           canary execution tied to one candidate deployment
destructive_canary             canary that commits a live economic action and therefore requires explicit compensation policy
hostedCheckoutUrlPresent       predicate that the checkout session yielded a non-empty hosted checkout URL
pre_funded_principal           canary principal whose credits are provisioned before generation verification begins
terminal_verdict               verdict in { PASSED, FAILED, TIMEOUT, SKIPPED }
```
