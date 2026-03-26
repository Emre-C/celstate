import { httpRouter } from "convex/server";
import { components, internal } from "./_generated/api.js";
import type { Id } from "./_generated/dataModel.js";
import { registerRoutes } from "@convex-dev/stripe";
import type Stripe from "stripe";
import { authComponent, createAuth } from "./auth.js";
import { assertStripeEnv } from "./lib/stripeEnv.js";
import { posthog } from "./posthog.js";
import {
  assertOkWebhookResponse,
  buildPurchaseAlertRequest,
  readOpsAlertRuntimeConfig,
} from "./lib/ops.js";
import { canGrantCreditsForCheckoutSession } from "./lib/stripeCheckout.js";

const stripeEnv = assertStripeEnv();

const CREDIT_PACKS: Record<string, number> = {
  [stripeEnv.stripePriceStarter]: 15,
  [stripeEnv.stripePricePro]: 40,
};

type CreditPackCheckoutEvent =
  | Stripe.CheckoutSessionAsyncPaymentSucceededEvent
  | Stripe.CheckoutSessionCompletedEvent;

type CreditPackCheckoutEventContext = {
  scheduler: {
    cancel: (...args: any[]) => Promise<any>;
    runAfter: (...args: any[]) => Promise<any>;
    runAt: (...args: any[]) => Promise<any>;
  };
  runMutation: (...args: any[]) => Promise<any>;
  runQuery: (...args: any[]) => Promise<any>;
};

const http = httpRouter();

authComponent.registerRoutes(http, createAuth);

const handleCreditPackCheckout = async (
  ctx: CreditPackCheckoutEventContext,
  event: CreditPackCheckoutEvent,
) => {
  const session = event.data.object;
  const grantEligibility = canGrantCreditsForCheckoutSession(session);

  if (!grantEligibility.ok) {
    console.log(
      "Skipping credit grant for checkout session",
      session.id,
      event.type,
      grantEligibility.reason,
    );
    return;
  }

  const paymentIntentId = typeof session.payment_intent === "string"
    ? session.payment_intent
    : session.payment_intent?.id;

  if (!paymentIntentId) {
    console.error("No payment_intent on checkout session", session.id);
    return;
  }

  const priceId = session.metadata?.priceId;
  const credits = priceId ? CREDIT_PACKS[priceId] : undefined;
  if (credits === undefined) {
    console.error("Unknown priceId or no credits mapping", priceId, session.id);
    return;
  }

  const userId = session.metadata?.userId;
  if (!userId) {
    console.error("No userId metadata on checkout session", session.id);
    return;
  }

  const granted = await ctx.runMutation(internal.creditGrants.recordGrant, {
    userId: userId as Id<"users">,
    amount: credits,
    reason: "purchase",
    stripePaymentIntentId: paymentIntentId,
  });

  if (!granted) {
    console.log("Credits already granted (mutation dedup) for", paymentIntentId);
    return;
  }

  const amountUsd = (session.amount_total ?? 0) / 100;
  const currency = session.currency ?? "usd";

  if (!process.env.POSTHOG_API_KEY?.trim()) {
    console.error(
      "POSTHOG_API_KEY is unset on this Convex deployment: credits_purchase_completed will not reach PostHog. " +
        "Set POSTHOG_API_KEY (same phc_ key as PUBLIC_POSTHOG_KEY) and POSTHOG_HOST (https://us.i.posthog.com or https://eu.i.posthog.com). " +
        "Run `pnpm check:posthog-env` against production.",
    );
  }

  await posthog.capture(ctx, {
    distinctId: String(userId),
    event: "credits_purchase_completed",
    properties: {
      credits_added: credits,
      amount_usd: amountUsd,
      currency,
      stripe_payment_intent_id: paymentIntentId,
      user_id: String(userId),
    },
  });

  const opsConfig = readOpsAlertRuntimeConfig();
  if (opsConfig.webhookUrl) {
    const user = await ctx.runQuery(internal.users.getById, {
      userId: userId as Id<"users">,
    });

    try {
      const request = buildPurchaseAlertRequest(opsConfig, {
        amountUsd,
        creditsAdded: credits,
        currency,
        stripePaymentIntentId: paymentIntentId,
        userEmail: user?.email ?? undefined,
        userId: String(userId),
      });

      const response = await fetch(request.url, {
        method: "POST",
        headers: request.headers,
        body: request.body,
      });

      assertOkWebhookResponse(response);
    } catch (error) {
      console.error("Failed to send purchase Discord notification", error);
    }
  }
};

registerRoutes(http, components.stripe, {
  events: {
    "checkout.session.async_payment_succeeded": handleCreditPackCheckout,
    "checkout.session.completed": handleCreditPackCheckout,
  },
});

export default http;
