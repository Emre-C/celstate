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

const stripeEnv = assertStripeEnv();

const CREDIT_PACKS: Record<string, number> = {
  [stripeEnv.stripePriceStarter]: 15,
  [stripeEnv.stripePricePro]: 40,
};

const http = httpRouter();

authComponent.registerRoutes(http, createAuth);

registerRoutes(http, components.stripe, {
  events: {
    "checkout.session.completed": async (ctx, event: Stripe.CheckoutSessionCompletedEvent) => {
      const session = event.data.object;
      const paymentIntentId = typeof session.payment_intent === "string"
        ? session.payment_intent
        : session.payment_intent?.id;

      if (!paymentIntentId) {
        console.error("No payment_intent on checkout session", session.id);
        return;
      }

      const priceId = session.metadata?.priceId;
      const credits = priceId ? CREDIT_PACKS[priceId] : undefined;
      if (!credits) {
        console.error("Unknown priceId or no credits mapping", priceId, session.id);
        return;
      }

      const userId = session.metadata?.userId;
      if (!userId) {
        console.error("No userId metadata on checkout session", session.id);
        return;
      }

      // Idempotency: check if we've already granted credits for this paymentIntentId
      const existing = await ctx.runQuery(
        internal.creditGrants.getByPaymentIntentId,
        { stripePaymentIntentId: paymentIntentId },
      );
      if (existing) {
        console.log("Credits already granted for", paymentIntentId);
        return;
      }

      // Grant credits and record audit trail (mutation is the authoritative idempotency gate)
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

      // Server-side authoritative revenue event (exact-once, inside idempotency gate)
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

      // Discord purchase notification (exact-once, inside idempotency gate)
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
    },
  },
});

export default http;
