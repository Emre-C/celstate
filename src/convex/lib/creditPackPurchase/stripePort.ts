import type Stripe from "stripe";

/**
 * The slim Stripe surface that the credit-pack purchase lifecycle requires.
 * Two adapters implement this:
 *   - `productionStripeAdapter.ts` — wraps `@convex-dev/stripe`'s
 *     `StripeSubscriptions.getOrCreateCustomer` and the raw Stripe SDK
 *     for `checkout.sessions.create` and `refunds.create`.
 *   - `inMemoryStripeAdapter.ts` — deterministic, idempotency-key-aware
 *     test double used by `creditPackPurchase.test.ts`.
 *
 * The port intentionally exposes only what the lifecycle exercises today.
 * Subscriptions, prices, customers list/edit/delete, etc. are out of scope
 * (see DEEPENING.md §2 — no subscriptions, no catalog growth).
 */
export type CreditPackStripePort = {
  /**
   * Returns a Stripe customer for the given internal user, creating one if
   * necessary. Production implementation uses `@convex-dev/stripe`'s
   * `StripeSubscriptions.getOrCreateCustomer`, which is itself idempotent
   * on `userId`. The lifecycle layer additionally caches the resulting
   * `customerId` on the `users` table so subsequent purchases skip this.
   */
  getOrCreateCustomer(args: {
    userId: string;
    email?: string;
    name?: string;
  }): Promise<{ customerId: string }>;

  /**
   * Creates a Stripe Checkout Session, replaying the same response when
   * called twice with the same idempotencyKey. The lifecycle layer derives
   * the key from the `pendingCheckouts` row id so action retries replay the
   * same session id rather than minting a duplicate hosted page.
   */
  createCheckoutSession(args: {
    params: Stripe.Checkout.SessionCreateParams;
    idempotencyKey: string;
  }): Promise<{ id: string; url: string | null }>;

  /**
   * Creates a Stripe refund against a payment intent. Idempotency-key
   * scoped to a `pendingCheckouts` id ensures duplicate refund webhook
   * deliveries during canary runs replay the same refund instead of
   * issuing two.
   */
  createRefund(args: {
    paymentIntentId: string;
    idempotencyKey: string;
  }): Promise<{ id: string; amountCents: number }>;
};
