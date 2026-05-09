import type { CreditPackStripePort } from "./stripePort.js";

/**
 * Deterministic in-memory implementation of `CreditPackStripePort` used by
 * lifecycle tests. The two production-replication contracts that matter:
 *
 *   1. Idempotency-key replay — calling `createCheckoutSession` or
 *      `createRefund` twice with the same `idempotencyKey` returns the
 *      same response object. This is exactly what Stripe's API does and
 *      it's the property the action's "crash after Stripe accepted but
 *      before we observed" recovery depends on.
 *   2. Deterministic ids — `cs_test_<key>`, `re_test_<key>`,
 *      `cus_test_<userId>` — so test assertions don't need to bother with
 *      randomness.
 *
 * Inspection surface (`getCallLog`, `failNextCall`, `setRefundAmountCents`,
 * `setCheckoutUrl`) is intentionally tiny and used only by tests. Production
 * code never sees this adapter.
 */

export type InMemoryStripeCallLogEntry =
  | { kind: "getOrCreateCustomer"; userId: string }
  | { kind: "createCheckoutSession"; idempotencyKey: string; replay: boolean }
  | { kind: "createRefund"; idempotencyKey: string; replay: boolean };

export type InMemoryStripePort = CreditPackStripePort & {
  getCallLog(): InMemoryStripeCallLogEntry[];
  /** Forces the next non-replay call (any method) to throw with this error. */
  failNextCall(error: Error): void;
  /** Optional override for the `amountCents` returned by `createRefund`. */
  setRefundAmountCents(amountCents: number): void;
  /** Optional override for the `url` returned by `createCheckoutSession`. */
  setCheckoutUrl(url: string): void;
};

export function createInMemoryStripePort(): InMemoryStripePort {
  const callLog: InMemoryStripeCallLogEntry[] = [];
  const checkoutSessionByKey = new Map<string, { id: string; url: string | null }>();
  const refundByKey = new Map<string, { id: string; amountCents: number }>();
  let nextError: Error | null = null;
  let refundAmountCents = 500;
  let defaultCheckoutUrl: string | null = "https://checkout.stripe.test/cs_test_default";

  const consumeNextError = () => {
    if (nextError) {
      const err = nextError;
      nextError = null;
      throw err;
    }
  };

  return {
    async getOrCreateCustomer({ userId }) {
      consumeNextError();
      callLog.push({ kind: "getOrCreateCustomer", userId });
      return { customerId: `cus_test_${userId}` };
    },

    async createCheckoutSession({ idempotencyKey }) {
      const replay = checkoutSessionByKey.has(idempotencyKey);
      if (!replay) consumeNextError();
      callLog.push({ kind: "createCheckoutSession", idempotencyKey, replay });
      const existing = checkoutSessionByKey.get(idempotencyKey);
      if (existing) return existing;
      const session = {
        id: `cs_test_${idempotencyKey}`,
        url: defaultCheckoutUrl,
      };
      checkoutSessionByKey.set(idempotencyKey, session);
      return session;
    },

    async createRefund({ idempotencyKey }) {
      const replay = refundByKey.has(idempotencyKey);
      if (!replay) consumeNextError();
      callLog.push({ kind: "createRefund", idempotencyKey, replay });
      const existing = refundByKey.get(idempotencyKey);
      if (existing) return existing;
      const refund = {
        id: `re_test_${idempotencyKey}`,
        amountCents: refundAmountCents,
      };
      refundByKey.set(idempotencyKey, refund);
      return refund;
    },

    getCallLog() {
      return [...callLog];
    },

    failNextCall(error) {
      nextError = error;
    },

    setRefundAmountCents(amountCents) {
      refundAmountCents = amountCents;
    },

    setCheckoutUrl(url) {
      defaultCheckoutUrl = url;
    },
  };
}
