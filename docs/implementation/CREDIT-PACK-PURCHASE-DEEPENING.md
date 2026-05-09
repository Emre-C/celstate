# Credit Pack Purchase — Module Deepening Plan

> Status: design-locked, not yet implemented.
> Owner: TBD (this doc was produced by the `improve-codebase-architecture` skill, grilling-loop output).
> Risk: medium. Money path. Stripe webhooks tolerate idempotent replays during cutover.
> Companion docs: [docs/product/payments-system.md](../product/payments-system.md), [docs/conventions/convex.md](../conventions/convex.md).

---

## 1. Goal

Deepen the credit-pack purchase lifecycle (request → Stripe Checkout Session → settlement → refund) into a single `creditPackPurchase` module that owns the composed invariant:

> **Exactly one credit grant per Stripe payment intent, ever — even under retries, webhook replays, or process crashes — and at most one clawback per settlement.**

Today this invariant is enforced by **four cooperating check surfaces** spread across five files. After deepening, the invariant lives behind one module boundary, with one named entry point per lifecycle transition. External callers (HTTP webhook handlers, canary runner endpoints, the QA reset path, the refund verification probe) become thin callers that pass raw inputs and receive structured outcomes.

## 2. Non-goals

- **No subscription support.** Confirmed: no Stripe subscriptions exist or are planned. The `StripeSubscriptions` import in [src/convex/stripe.ts](../../src/convex/stripe.ts) is used only for `getOrCreateCustomer` and `apiKey` accessors. The deepened module's Stripe port models one-time Checkout Sessions only.
- **No catalog growth.** Confirmed: only the existing `starter` (15 credits) and `pro` (40 credits) packs. The catalog stays as an internal constant inside the module, not injected.
- **No webhook signature verification refactor.** [http.ts](../../src/convex/http.ts) keeps registering routes via `@convex-dev/stripe`. The HMAC seam is intentionally distinct from the lifecycle seam — convex.md flags `/verification/*` and `/mcp` Bearer-parsing as separate concerns.
- **No credit-balance refactor.** `applyCreditsToUser` (in [src/convex/users.ts](../../src/convex/users.ts)) stays where it is. The deepened module depends on it but does not own it.
- **No schema migration of existing rows.** `pendingCheckouts` and `purchaseSettlements` keep their current row shapes. We add one missing index (see §9) but do not move data.

---

## 3. Why now — the case in concrete terms

### 3.1 The composed invariant lives in four places

To reason about "exactly once" today you must hold all four in your head:

| Surface                        | Where                                                                                                                                                                                                                                                                                | What it defends                                                                                                                            |
| ------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------ |
| Atomic processing lease        | [pendingCheckouts.ts: `claimCheckoutForProcessing`](../../src/convex/pendingCheckouts.ts), `markReady`, `markFailed`                                                                                                                                                                 | Two concurrent `processCheckout` actions cannot both create a Stripe Checkout Session for the same `pendingCheckouts` row.                 |
| Stripe-side idempotency key    | [stripe.ts: `processCheckout`](../../src/convex/stripe.ts) consuming `buildCreditPackCheckoutSessionIdempotencyKey` from [lib/stripeCheckout.ts](../../src/convex/lib/stripeCheckout.ts)                                                                                             | If the action crashed after Stripe accepted the POST but before we observed the response, a retry replays the same key and Stripe returns the same session. |
| Settlement uniqueness          | [lib/stripeCheckout.ts: `recordCreditPackPurchaseSettlement`](../../src/convex/lib/stripeCheckout.ts) — three reads: `purchaseSettlements by_pending_checkout`, `purchaseSettlements by_payment_intent`, `creditGrants by_payment_intent`                                            | Webhook redelivery, async-payment-succeeded after completed, or a manual replay cannot grant credits twice for the same payment intent.   |
| Refund clawback gate           | [creditGrants.ts: `recordRefundForPendingCheckout`](../../src/convex/creditGrants.ts) — `refundedAt` set + `stripeRefundId` mismatch detection                                                                                                                                       | Duplicate refund webhook delivery cannot deduct already-clawed-back credits twice.                                                          |

The prior architectural review (see thread T-019df4fd-…) named the first three. The fourth is the same shape applied to the refund tail — folding it in is part of this deepening.

### 3.2 The lifecycle is fragmented across files

```diagram
         requestCheckout                      processCheckout                     checkout.session.{completed,async_payment_succeeded}
            (mutation)                         (action: lease + Stripe)            (webhook → http.ts)
   ╭──────╮      [pendingCheckouts.ts]      ╭─────────╮      [stripe.ts]          ╭───────╮      [http.ts → creditGrants.ts]      ╭──────────╮
   │ User │──────────────────────────────▶ │ pending │──────────────────────────▶│ ready │──────────────────────────────────────▶│ settled  │
   ╰──────╯                                 ╰────┬────╯                          ╰───┬───╯                                         ╰────┬─────╯
                                                 │ Stripe error                       │                                                  │
                                                 ▼                                    │                                                  │ refund webhook (NOT WIRED today)
                                           ╭────────╮                                 │                                                  │ canary refund probe
                                           │ failed │                                 │                                                  ▼
                                           ╰────────╯                                 │                                            ╭──────────╮
                                                                                       │                                            │ refunded │
                                                                                       └── manual canary path goes through ──────▶│          │
                                                                                          [stripeRefundVerification.ts]            ╰──────────╯
```

Each transition lives in a different file. The composed invariant emerges from the way they cooperate, not from any single declaration.

### 3.3 Concrete LoC reduction target

| File                                                                                            | Today (lines) | After (estimate) |
| ----------------------------------------------------------------------------------------------- | ------------- | ---------------- |
| [src/convex/pendingCheckouts.ts](../../src/convex/pendingCheckouts.ts)                          | 421           | ~30 (re-exports) |
| [src/convex/stripe.ts](../../src/convex/stripe.ts)                                              | 143           | absorbed         |
| [src/convex/creditGrants.ts](../../src/convex/creditGrants.ts)                                  | 264           | ~80              |
| [src/convex/lib/stripeCheckout.ts](../../src/convex/lib/stripeCheckout.ts)                      | 442           | absorbed         |
| [src/convex/stripeRefundVerification.ts](../../src/convex/stripeRefundVerification.ts)          | 79            | ~30              |
| (relevant slice of) [src/convex/qaUserReset.ts](../../src/convex/qaUserReset.ts)                | ~25 inline    | 1 call           |
| (relevant slice of) [src/convex/http.ts](../../src/convex/http.ts) `handleCreditPackCheckout`   | ~95           | ~55              |
| **`src/convex/creditPackPurchase/` (new module)**                                               | —             | ~600             |
| **Net**                                                                                         | ~1469         | ~795             |

Numbers are estimates; actual reduction depends on the test plan (§11) and how much of the canary support code becomes module-private.

---

## 4. Target shape — the `creditPackPurchase` module

### 4.1 Boundary

A new directory `src/convex/creditPackPurchase/` containing:

```
src/convex/creditPackPurchase/
  index.ts              # public Convex functions (mutations, queries, actions) — the API surface other Convex code uses
  lifecycle.ts          # internal: state machine, ACID transitions, idempotency checks
  catalog.ts            # internal: CREDIT_PACK_CATALOG + price-id lookup; reads stripeEnv at module load
  stripePort.ts         # the injected port (interface + production adapter)
  inMemoryStripeAdapter.ts  # test adapter used by lifecycle tests
  CREDIT-PACK-PURCHASE.md   # short README pointing at this plan
```

The module **owns** (private state, no caller touches them directly):

- The `pendingCheckouts` table and its lease semantics.
- The `purchaseSettlements` table and its idempotency / refund semantics.
- The subset of `creditGrants` rows tagged `reason: "purchase"` (note: `creditGrants` itself is shared with the non-purchase grant path — see §6.3).
- The catalog: `{ starter: 15 credits, pro: 40 credits }` keyed by env-derived price ids.
- Construction of Stripe-side idempotency keys (checkout session create, refund create).
- Parsing of Stripe Checkout Session payloads into settlement candidates.

The module **does not own** (depends on, treats as a primitive):

- `applyCreditsToUser` from [users.ts](../../src/convex/users.ts) — credit balance mutation primitive.
- `upsertCurrentUser` / `getCurrentAppUser` — user identity, distinct concern.
- `assertVerificationRunnerSecret` / `assertQaUserResetSecret` — auth seams, kept in their existing locations and called by callers before they invoke the module.
- `stripeEnv` — read at module load via `assertStripeEnv()` to seed the catalog and webhook config.
- The HTTP boundary in [http.ts](../../src/convex/http.ts) — webhook signature verification stays where it is.
- `posthog.capture` and ops-alert dispatch — these are post-settlement side effects, kept in the http.ts caller. The module returns a structured "settlement happened" outcome that the caller reacts to.

### 4.2 Public API surface (named lifecycle entry points)

These are recommendations to drive the next step (interface design / parallel sub-agent fan-out). Final signatures are deferred to that step. Names and shape are stable.

#### 4.2.1 User-facing lifecycle

- **`requestCheckout(priceId)`** — `mutation`. Replaces today's [`pendingCheckouts:requestCheckout`](../../src/convex/pendingCheckouts.ts). Authenticates via `upsertCurrentUser`, validates `priceId` against the catalog, inserts the `pendingCheckouts` row, schedules `processCheckout`, returns the row id.
- **`getCheckoutStatus(checkoutId)`** — `query`. Returns `{ status: "pending" } | { status: "ready", checkoutUrl } | { status: "failed", error } | null`. Authorization: caller must own the row.

#### 4.2.2 Background / Stripe-side

- **`processCheckout(checkoutId, …)`** — `internalAction`. Owns lease acquisition, Stripe customer-or-cache, Stripe Checkout Session creation, terminal transition. Internally uses the Stripe port (§7).
- **`onStripeCheckoutCompleted(rawSession)`** — `internalMutation`. Single named entry point invoked by `handleCreditPackCheckout` in http.ts on `checkout.session.completed` and `checkout.session.async_payment_succeeded`. Inside one ACID mutation it: parses the session payload (today's `getCreditPackSettlementCandidate`), looks up `pendingCheckoutId` by `stripeCheckoutSessionId`, performs all three uniqueness checks, calls `applyCreditsToUser`, inserts `creditGrants` and `purchaseSettlements` rows. Returns `{ outcome: "skipped", reason } | { outcome: "alreadyRecorded", settlement } | { outcome: "settled", settlement }`. The caller in http.ts uses the structured outcome to drive PostHog and Discord side effects — those stay in http.ts.
- **`onStripeChargeRefunded(rawCharge)`** — `internalMutation`. **NEW.** Hooked from a new `charge.refunded` registration in `registerRoutes(http, components.stripe, …)`. Same shape as the canary path but driven by the webhook. Closes the durability hole described in §3.

#### 4.2.3 Refund / canary

- **`refundCheckoutForCanary({ runnerSecret, pendingCheckoutId })`** — `internalAction`. Replaces [`stripeRefundVerification:refundSettlementByPendingCheckoutForCanary`](../../src/convex/stripeRefundVerification.ts). Validates the runner secret, asserts the settlement belongs to `CANARY_SETTLEMENT`, calls Stripe via the port with an idempotency key derived from `pendingCheckoutId`, records the refund through the same internal mutation that the webhook uses.

#### 4.2.4 Canary runner support

- **`requestCheckoutForCanaryRunner({ runnerSecret, priceId? })`**
- **`requestSettlementCheckoutForCanaryRunner({ runnerSecret, priceId? })`** — preserves the "no concurrent destructive run" assertion that today lives in `assertNoActiveSettlementCanary`.
- **`getCheckoutStatusForCanaryRunner({ runnerSecret, checkoutId })`**
- **`getSettlementCheckoutStatusForCanaryRunner({ runnerSecret, checkoutId })`**
- **`getSettlementByPendingCheckoutForCanaryRunner({ runnerSecret, pendingCheckoutId })`**

These are kept inside the module (per locked answer #2). The "no concurrent destructive run" rule is a real lifecycle invariant — the canary runner is just another caller that must respect uniqueness of in-flight destructive runs.

#### 4.2.5 QA support

- **`purgeUserPurchaseStateForQa(userId)`** — `internalMutation` exposed only through `internal.creditPackPurchase.…`. Deletes all `pendingCheckouts`, `purchaseSettlements` (using the new `by_user` index — see §9), and `creditGrants` rows scoped to the user. Authorization is the caller's responsibility — `qaUserReset.resetAllowlistedTestUser` validates the QA secret + email allowlist before invoking this.

### 4.3 What disappears

- [src/convex/stripe.ts](../../src/convex/stripe.ts) ceases to contain the credit-pack purchase action — only re-exports for back-compat during migration, then deleted.
- [src/convex/lib/stripeCheckout.ts](../../src/convex/lib/stripeCheckout.ts) is fully absorbed. Its helpers (`buildStripeCheckoutSessionCreateParams`, `getCreditPackSettlementCandidate`, `recordCreditPackPurchaseSettlement`, `requestCreditPackCheckout`, `toCreditPackCheckoutStatus`, `buildCreditPackCheckoutSessionIdempotencyKey`, `assertKnownCreditPackPriceId`, `getKnownCreditPackPriceIds`, `getCreditPackCatalog`, `getCreditPackByPriceId`, `canGrantCreditsForCheckoutSession`, `isKnownCreditPackPriceId`, `CREDIT_PACK_CHECKOUT_PROCESSING_LEASE_MS`) become internal to the module.
- [src/convex/pendingCheckouts.ts](../../src/convex/pendingCheckouts.ts) reduces to thin re-exports of the public API (`requestCheckout`, `getCheckoutStatus`) so existing client-side `api.pendingCheckouts.…` references keep resolving during cutover. Eventually the file is deleted and clients call `api.creditPackPurchase.…` directly.
- [src/convex/creditGrants.ts](../../src/convex/creditGrants.ts) loses the purchase-settlement mutations. It keeps `recordGrant` (the non-purchase grant primitive used elsewhere in the codebase — verify usage during implementation) and the audit query helpers, or those move to a much smaller `src/convex/credits.ts`.

---

## 5. Dependency classification (per DEEPENING.md)

| Dependency                                                                  | Category         | Decision                                                                                                                                                                                                                                          |
| --------------------------------------------------------------------------- | ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Stripe SDK (`new Stripe(…).checkout.sessions.create`, `.refunds.create`)    | 4 (true-external) | **Port required.** Two adapters justified: production (real Stripe) + in-memory (deterministic, used by lifecycle tests). Two-adapter rule satisfied.                                                                                              |
| `@convex-dev/stripe` `StripeSubscriptions.getOrCreateCustomer` + `.apiKey`  | 4 (true-external) | Folded into the same Stripe port. The port exposes `getOrCreateCustomer(userId, email?, name?)` and internally chooses the StripeSubscriptions component vs a stub.                                                                              |
| Convex `ctx.db`                                                              | 2 (local-substitutable) | **No port.** Convex test framework already provides an in-memory substitute. Direct `ctx.db` calls inside module mutations are fine.                                                                                                            |
| Convex `ctx.scheduler.runAfter`                                              | 2                | **No port.** Same reason.                                                                                                                                                                                                                         |
| `applyCreditsToUser` from users.ts                                           | 1 (in-process)   | **No port.** Direct import. Idempotent per its own contract; called inside the module's settlement mutation so check-then-write stays atomic.                                                                                                     |
| `assertStripeEnv` from lib/stripeEnv.ts                                      | 1                | **No port.** Read once at module load to seed the catalog.                                                                                                                                                                                        |
| `assertVerificationRunnerSecret` / `assertQaUserResetSecret`                 | 1                | **No port.** Imported and called inside the canary/QA entry points. Auth check stays in the same mutation that does the write.                                                                                                                   |
| `posthog.capture`, ops-alert webhook                                         | n/a              | **Not a module dependency.** These are post-settlement side effects in [http.ts](../../src/convex/http.ts). The module returns structured outcomes; the caller reacts.                                                                            |

---

## 6. The Stripe port

### 6.1 Surface

The port is a TypeScript interface describing exactly what the deepened module needs from Stripe — nothing more. Tentatively:

```ts
type CreditPackStripePort = {
  getOrCreateCustomer(args: {
    userId: string;
    email?: string;
    name?: string;
  }): Promise<{ customerId: string }>;

  createCheckoutSession(args: {
    params: Stripe.Checkout.SessionCreateParams;
    idempotencyKey: string;
  }): Promise<{ id: string; url: string | null }>;

  createRefund(args: {
    paymentIntentId: string;
    idempotencyKey: string;
  }): Promise<{ id: string; amountCents: number }>;
};
```

Final signatures are deferred to the interface-design step. The shape above is the floor.

### 6.2 Production adapter

A single file `stripePort.ts` exporting `createProductionStripePort()` that wraps:

- `new StripeSubscriptions(components.stripe, {})` for `getOrCreateCustomer` (preserves the existing customer-cache + idempotency the component provides).
- `new Stripe(stripeClient.apiKey)` for `createCheckoutSession` and `createRefund`.

### 6.3 In-memory adapter

`inMemoryStripeAdapter.ts` exports `createInMemoryStripePort()`:

- Generates deterministic ids: `cus_test_<userId>`, `cs_test_<idempotencyKey>`, `re_test_<idempotencyKey>`.
- Tracks `seenIdempotencyKeys` so a replay returns the same response object — exactly what the production Stripe API does. This is what makes lifecycle tests valuable.
- Exposes a small inspection surface (`getCallLog`, `failNextCall(error)`) used only by tests.

This adapter is what makes the existing Stripe-call edge cases (action crash after Stripe returned, action retry after lease expiry, webhook replay after settlement) exercisable in deterministic unit tests instead of in canary roundtrips.

### 6.4 Note on `creditGrants` reuse

The `creditGrants` table is also written by [creditGrants.ts: `recordGrant`](../../src/convex/creditGrants.ts), which is the primitive used for non-purchase grants (e.g., promotional or refund-related). After deepening:

- The module owns rows tagged `reason: "purchase"`.
- Other reasons (verify during implementation by `rg "recordGrant\\("`) keep flowing through the existing `recordGrant` mutation.
- The shared table is fine — it's an audit log keyed by id, and the module's invariant only cares about `stripePaymentIntentId`-tagged rows. The shared `by_payment_intent` index already exists.

---

## 7. Refund path — the clearly-better answer (resolves §3 question)

The framing "refund inside vs alongside" had no real trade-off. The strictly-better outcome:

1. **Refund stays inside the module.** `onStripeChargeRefunded`, `refundCheckoutForCanary`, and the refund clawback gate all live with the rest of the lifecycle. The "exactly once" reasoning is unified.
2. **Add the missing `charge.refunded` webhook registration.** Today the only way a refund reaches the DB is through the manual canary action. Production refunds initiated from the Stripe dashboard or CLI silently desync. After deepening:
   ```ts
   registerRoutes(http, components.stripe, {
     events: {
       "checkout.session.async_payment_succeeded": handleCheckoutCompleted,
       "checkout.session.completed": handleCheckoutCompleted,
       "charge.refunded": handleChargeRefunded,
     },
   });
   ```
   `handleChargeRefunded` is a thin caller into `creditPackPurchase.onStripeChargeRefunded`. Idempotency is handled inside the mutation by the existing `refundedAt` gate (extended to look up by `paymentIntentId` since the refund webhook payload is a charge, not a settlement).
3. **Confirm via Stripe docs which event to register** during implementation. Stripe emits both `charge.refunded` and `refund.created` / `refund.updated`. Using `charge.refunded` is the historically-stable choice; if `refund.created` is more appropriate for our SDK version we use that. Decided in the implementation step, not here.

The refund verification probe ([scripts and src/convex/stripeRefundVerification.ts](../../src/convex/stripeRefundVerification.ts)) keeps existing — it's a reconciliation backstop. After deepening it becomes:

- One thin internalAction that validates the runner secret and forwards to `creditPackPurchase.refundCheckoutForCanary`.
- The probe's job is "reconcile any settlements where Stripe reports a refund we missed." Future improvement: have it call `creditPackPurchase.findUnverifiedRefundCandidates()` and apply each. Out of scope for this deepening, but the seam is now in place.

---

## 8. Latent bugs surfaced opportunistically

These come along for free because the deepening forces us to look at all five files at once. None requires a dedicated task — fix them as part of the migration.

1. **No `by_user` index on `purchaseSettlements`.** [schema.ts:152-172](../../src/convex/schema.ts#L152-L172) only has `by_payment_intent`, `by_checkout_session`, `by_pending_checkout`, `by_createdAt`. [qaUserReset.ts:178-183](../../src/convex/qaUserReset.ts#L178-L183) does `q.filter(q.eq(q.field("userId"), userId))` — full-table scan, [convex.md](../conventions/convex.md) violation. **Fix:** add `.index("by_user", ["userId"])` to the schema, switch the QA reset (now inside `purgeUserPurchaseStateForQa`) to use it.
2. **Refund webhook missing.** Documented in §7. The fix is part of the deepening.
3. **`stripeCustomerId` cache leak across QA reset.** When [qaUserReset.ts](../../src/convex/qaUserReset.ts) deletes a user, it does NOT delete the Stripe customer (line 95-96 explicitly says so). When a fresh signup reuses that email, `pendingCheckouts:cacheStripeCustomerId` will mint a new customer ID, leaving the old Stripe customer orphaned. **Out of scope** — but document it in CONTEXT.md so a future explorer doesn't think the deepening introduced it.
4. **`recordRefundForPendingCheckout` throws on multiple settlements per pending checkout.** Today's [creditGrants.ts:179-183](../../src/convex/creditGrants.ts#L179-L183) treats `> 1` as a hard error. After deepening this defensive check stays — but the new module also enforces uniqueness on insert (today's `by_pending_checkout` settlement check), so the throw becomes truly unreachable. Keep the throw as a safety net.

---

## 9. Migration plan — staged, low-risk

Stripe webhooks will continue to fire during the migration. All transitions inside the deepened module remain idempotent. We can ship in stages.

### Stage 1 — preparatory schema change (deployable independently)
- Add `purchaseSettlements.by_user` index to [schema.ts](../../src/convex/schema.ts).
- Switch [qaUserReset.ts:178-183](../../src/convex/qaUserReset.ts#L178-L183) to use the new index.
- Verify `pnpm typecheck:tsc` + `pnpm test`. Deploy.

### Stage 2 — introduce module skeleton + tests, no callers wired
- Create `src/convex/creditPackPurchase/` with:
  - The Stripe port (production + in-memory adapters).
  - The full lifecycle mutations/queries/actions, sharing schema with the existing tables.
  - The new internal entry point `onStripeChargeRefunded`.
  - All canary entry points.
  - Comprehensive lifecycle tests (§11).
- Existing files unchanged. Module exists but no caller uses it yet.
- All tests pass (existing + new).
- Deploy. Module is dormant.

### Stage 3 — switch webhook handler to call the module
- Modify [http.ts: `handleCreditPackCheckout`](../../src/convex/http.ts) to call `internal.creditPackPurchase.onStripeCheckoutCompleted` instead of `internal.creditGrants.recordPurchaseSettlement`.
- Both paths are idempotent on `stripePaymentIntentId`. A webhook delivered during cutover still settles exactly once regardless of which mutation handled it.
- Add the `charge.refunded` registration pointing at `creditPackPurchase.onStripeChargeRefunded`.
- Deploy. Verify via canary the live settlement path works end-to-end.

### Stage 4 — switch `requestCheckout` and `processCheckout`
- Replace [pendingCheckouts.ts: `requestCheckout`](../../src/convex/pendingCheckouts.ts) body to call `requestCreditPackCheckout` from the new module (it already does — only the location changes).
- Replace [stripe.ts: `processCheckout`](../../src/convex/stripe.ts) body with a thin forwarder, then delete it once `internal.creditPackPurchase.processCheckout` is referenced everywhere.
- The lease-and-Stripe path is moving en bloc — no in-flight `pendingCheckouts` row spans the cutover (the lease TTL is 60 s, the deploy is faster). Even if one does, `claim → markReady`/`markFailed` is keyed off `processingLeaseId` per [pendingCheckouts.ts:325, 355](../../src/convex/pendingCheckouts.ts), so an old action cannot clobber a new one.
- Deploy.

### Stage 5 — switch canary runner endpoints
- Update each `/verification/canary/*` route in [http.ts](../../src/convex/http.ts) to reference `internal.creditPackPurchase.…` for the lifecycle calls.
- The canary runner secret check stays at the entry point; the module re-asserts it for defense-in-depth.
- Deploy.

### Stage 6 — switch QA reset
- Replace the inline deletes in [qaUserReset.ts:164-184](../../src/convex/qaUserReset.ts#L164-L184) with `await ctx.runMutation(internal.creditPackPurchase.purgeUserPurchaseStateForQa, { userId })`. (Or call directly if running in the same MutationCtx — verify Convex calling convention during implementation.)
- Deploy.

### Stage 7 — delete the corpses
- Remove [src/convex/lib/stripeCheckout.ts](../../src/convex/lib/stripeCheckout.ts) (now empty / re-exports only).
- Remove [src/convex/stripe.ts](../../src/convex/stripe.ts) credit-pack action.
- Remove [src/convex/stripeRefundVerification.ts](../../src/convex/stripeRefundVerification.ts), now reduced to a thin forwarder, **only** if no external script (`scripts/`) imports it. Otherwise keep as a 30-line forwarder.
- Reduce [src/convex/pendingCheckouts.ts](../../src/convex/pendingCheckouts.ts) to re-exports, then delete once client-side references are migrated to `api.creditPackPurchase.…`.
- Reduce [src/convex/creditGrants.ts](../../src/convex/creditGrants.ts) to the non-purchase grant primitive (`recordGrant`) and audit queries used elsewhere, or move those to `src/convex/credits.ts` and delete the file.
- Run `pnpm verify` end-to-end (typecheck, lint, test, knip, jscpd, build, e2e). Deploy.

### Rollback at any stage
- Stages 1–2 are append-only. Rollback = revert.
- Stage 3 onwards: revert the http.ts/pendingCheckouts.ts/stripe.ts callers. The new module stays in tree, dormant, available for the next attempt. No data migration, no schema rollback (the new index is harmless).

---

## 10. Test plan — replace, don't layer

### 10.1 Tests that disappear (delete in stage 7)

These are unit tests over helpers that become module-internal. Their behavior is fully covered by the new lifecycle tests through the module's interface.

- `src/convex/pendingCheckouts.test.ts` (lease semantics — now an internal detail covered by lifecycle tests).
- `src/convex/lib/stripeCheckout.test.ts` (helpers: builders, idempotency-key derivation, settlement-candidate parsing — all internal).
- The portions of `src/convex/creditGrants.test.ts` that exercise `recordPurchaseSettlement` / `recordRefundForPendingCheckout` directly. The `recordGrant` (non-purchase) tests stay.

> Verify these test files exist before promising deletion. If a name above doesn't match a real file, drop it from this list during implementation.

### 10.2 Tests that survive

- `src/convex/lib/stripeEnv.test.ts` — env-validation seam, separate concern.
- Any tests on `applyCreditsToUser` in users.ts.
- HTTP-level tests over [http.ts](../../src/convex/http.ts) routing/auth — those exercise the seam, not the lifecycle.

### 10.3 New lifecycle tests (write in stage 2)

Located in `src/convex/creditPackPurchase/lifecycle.test.ts`. Use the in-memory Stripe adapter.

| Test                                                                                                | Asserts                                                                                                                  |
| --------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| `requestCheckout → processCheckout → onStripeCheckoutCompleted` happy path                          | Row transitions pending → ready, then settled. Credits applied exactly once. Settlement and grant rows inserted.         |
| `processCheckout` retried after action crash before `markReady`                                     | Stripe port returns the same session id on replay (idempotency-key matched). Row eventually transitions to ready, exactly once. |
| `processCheckout` retried after lease TTL expired                                                   | New invocation acquires lease, replays Stripe call (same key, same response), terminal transition uses new lease id.      |
| Two `processCheckout` actions race on the same checkout                                             | Second invocation gets `claim.ok: false reason: "lease_held"` and returns without touching Stripe.                       |
| `onStripeCheckoutCompleted` delivered twice (webhook replay)                                        | Second call returns `outcome: "alreadyRecorded"`. No duplicate grant.                                                    |
| `onStripeCheckoutCompleted` delivered after `async_payment_succeeded` already settled the same PI   | Same as above (`alreadyRecorded`).                                                                                       |
| `onStripeChargeRefunded` happy path                                                                 | Settlement row gets `refundedAt`/`stripeRefundId`/`refundAmountUsd`. User credits clawed back, clamped to ≥ 0.           |
| `onStripeChargeRefunded` delivered twice                                                            | Second call returns `outcome: "alreadyRefunded"`. No double clawback.                                                    |
| `refundCheckoutForCanary` — happy path                                                              | Stripe port called with idempotency key derived from `pendingCheckoutId`. Settlement updated. Result returned.           |
| `refundCheckoutForCanary` — already-refunded                                                        | Returns `alreadyRefunded: true` without calling Stripe.                                                                  |
| Stripe `checkout.sessions.create` rejects                                                           | Row transitions pending → failed. No partial state on the row. Lease cleared.                                            |
| User has spent some purchased credits before refund                                                 | Clawback clamped to current balance. No negative balance.                                                                |
| `purgeUserPurchaseStateForQa` deletes all three tables for the user                                  | Counts match. Other users' rows untouched.                                                                                |

### 10.4 Webhook integration tests

Keep one HTTP-level test that posts a synthesized `checkout.session.completed` event and asserts the module mutation was invoked. The signature-verification path stays exercised by the existing `@convex-dev/stripe` test setup.

---

## 11. Files affected — cheat sheet

| File                                                                                            | Stage  | Verb                                                                                                       |
| ----------------------------------------------------------------------------------------------- | ------ | ---------------------------------------------------------------------------------------------------------- |
| [src/convex/schema.ts](../../src/convex/schema.ts)                                              | 1      | Add `purchaseSettlements.by_user` index.                                                                   |
| [src/convex/qaUserReset.ts](../../src/convex/qaUserReset.ts)                                    | 1, 6   | Use new index in stage 1; replace inline deletes with module call in stage 6.                              |
| `src/convex/creditPackPurchase/` (new)                                                          | 2      | Create module + Stripe port + adapters + tests.                                                            |
| [src/convex/http.ts](../../src/convex/http.ts)                                                  | 3, 5   | Switch settlement/refund callers; add `charge.refunded` registration; switch canary endpoints.             |
| [src/convex/pendingCheckouts.ts](../../src/convex/pendingCheckouts.ts)                          | 4, 7   | Reduce to re-exports in stage 4; delete in stage 7.                                                         |
| [src/convex/stripe.ts](../../src/convex/stripe.ts)                                              | 4, 7   | Forwarder in stage 4; delete the credit-pack action in stage 7. (File may survive if other Stripe needs land later — out of scope.) |
| [src/convex/lib/stripeCheckout.ts](../../src/convex/lib/stripeCheckout.ts)                      | 4, 7   | Re-exports in stage 4; delete in stage 7.                                                                   |
| [src/convex/stripeRefundVerification.ts](../../src/convex/stripeRefundVerification.ts)          | 5, 7   | Forwarder in stage 5; delete in stage 7 if no external scripts depend on it.                                |
| [src/convex/creditGrants.ts](../../src/convex/creditGrants.ts)                                  | 5, 7   | Drop purchase-settlement mutations + queries (now in the module) in stage 5; reduce or relocate remainder in stage 7. |
| Existing client-side `api.pendingCheckouts.…` references                                        | 7      | Migrate to `api.creditPackPurchase.…` and delete the re-export shim.                                       |
| Test files (see §10.1)                                                                          | 7      | Delete.                                                                                                     |

---

## 12. CONTEXT.md and ADR additions

Per the skill, do these lazily and only when needed.

### 12.1 CONTEXT.md (create on first commit of stage 2)

Add at minimum the domain term `CreditPackPurchase` if and only if we name the deepened module after the concept. Example seed:

```md
# Project domain glossary

- **Generation** — A single image-generation request from a user. See `src/convex/generations.ts`.
- **Stage** — A step within a generation's pipeline (e.g., `transparent_qa`, `optimization`).
- **CreditPackPurchase** — The end-to-end lifecycle that takes a user from "I want a credit pack" to "credits in my balance" (and, if needed, "credits clawed back on refund"). One Stripe Checkout Session, one payment intent, one credit grant. Owned by `src/convex/creditPackPurchase/`.
- **PendingCheckout** — Module-private: a row representing the request-to-Stripe phase of a CreditPackPurchase.
- **PurchaseSettlement** — Module-private: the money record. The thing that, once created, says "credits were granted."
- **CreditGrant** — A credit-balance audit log entry. Shared with non-purchase grants.
- **TransparentQa**, **Canary**, etc. — short blurbs from existing docs.
```

Don't bloat — add terms when callers need shared vocabulary, not preemptively.

### 12.2 ADR (only if a candidate is rejected for a load-bearing reason)

If during the grilling loop a future explorer would benefit from knowing "we considered X and rejected it for reason Y", create `docs/adr/000X-credit-pack-purchase-deepening.md` with the decision. Likely candidates:

- "Why the module owns canary entry points instead of leaving them in `pendingCheckouts.ts`." Load-bearing because future contributors will expect canary affordances to live in test-only files.
- "Why we did not introduce a port for `ctx.db`." Two-adapter rule — preempts a future "let's mock the DB" instinct.

Skip ADRs for things we accepted (the whole plan above is the rationale for those).

---

## 13. Open questions deferred to the interface-design step

Either pick one canonical interface and grill it, or run the parallel sub-agent fan-out from INTERFACE-DESIGN.md (minimal / max-flexibility / common-case-trivial / ports-and-adapters). Specific questions the design step needs to answer:

1. **Outcome shape for `onStripeCheckoutCompleted`.** Discriminated union vs. `{ alreadyRecorded, created, creditApplied }` shape (today's). Discriminated union is friendlier to consumers (today's http.ts has three sequential `if`s — see [http.ts:315-326](../../src/convex/http.ts#L315-L326)).
2. **Where session-payload parsing lives.** Today's `getCreditPackSettlementCandidate` runs inside http.ts. Two reasonable options:
   - Keep parsing in the caller (http.ts), pass the parsed candidate to the module mutation. Module sees structured args.
   - Move parsing inside the module mutation, pass the raw session. Module owns the "is this a credit pack settlement?" judgment. Caller just forwards.
   The second is more cohesive — the module owns its own input validation. Recommended, but the design step can reconsider.
3. **Canary entry-point naming.** Five canary functions today. Do they collapse to fewer (e.g., one `requestCheckoutForCanary({ principalId, priceId? })` that branches on `principalId`), or stay as separate named functions? Symmetry argument for collapsing; readability argument for keeping separate. Design step decides.
4. **`charge.refunded` vs `refund.created`.** Confirm with current Stripe SDK + our @convex-dev/stripe component version which event is emitted reliably.
5. **Whether `purchaseSettlements` and `pendingCheckouts` merge.** Default answer: no (§2 — no schema migration). But the design step should sanity-check whether there's a cleaner one-table design that doesn't require migrating data (e.g., a phased migration where new rows write to one table while old rows are read from both). My current expectation is "not worth it" — the FK from settlement → checkout is correct but rare and the lease/processing concerns don't belong on the money row.

---

## 14. Done checklist

- [ ] Stage 1 schema + qaUserReset index switch shipped.
- [ ] Stage 2 module + Stripe port + in-memory adapter + lifecycle tests shipped.
- [ ] Stage 3 webhook caller switched + `charge.refunded` registered. Live canary settlement run green.
- [ ] Stage 4 `requestCheckout` + `processCheckout` switched. Live canary checkout run green.
- [ ] Stage 5 canary runner endpoints switched. All `/verification/canary/*` routes hit the module.
- [ ] Stage 6 QA reset switched. `pnpm reset-qa` against staging works end-to-end.
- [ ] Stage 7 corpses deleted. `pnpm verify` green. CONTEXT.md updated. ADR(s) written if applicable.
- [ ] No remaining references to `lib/stripeCheckout`, `internal.creditGrants.recordPurchaseSettlement`, or `internal.creditGrants.recordRefundForPendingCheckout` outside the deprecated re-export shims.
- [ ] All four idempotency surfaces (lease, Stripe key, settlement uniqueness, refund clawback) live inside one module, with one test file asserting their composed behavior.
