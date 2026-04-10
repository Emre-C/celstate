import { httpRouter } from "convex/server";
import { httpAction } from "./_generated/server.js";
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

const jsonResponse = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });

const parseBearer = (request: Request): string => {
  const auth = request.headers.get("authorization");
  return auth?.startsWith("Bearer ") ? auth.slice(7).trim() : "";
};

authComponent.registerRoutes(http, createAuth);

http.route({
  path: "/verification/ingest",
  method: "POST",
  handler: httpAction(async (ctx, request) => {
    const token = parseBearer(request);
    try {
      const body = (await request.json()) as Record<string, unknown>;
      const result = await ctx.runMutation(internal.verification.ingestVerificationRun, {
        runnerSecret: token,
        runKey: body.runKey as string,
        trigger: body.trigger as "PRE_MERGE_CI" | "POST_DEPLOY" | "SCHEDULED",
        deploymentId: body.deploymentId as string | undefined,
        gitSha: body.gitSha as string | undefined,
        siteUrl: body.siteUrl as string | undefined,
        workflowRunId: body.workflowRunId as string | undefined,
        startedAt: body.startedAt as number,
        finishedAt: body.finishedAt as number,
        gateConfig: body.gateConfig as never,
        authVerdict: body.authVerdict as never,
        generationVerdict: body.generationVerdict as never,
        checkoutSessionVerdict: body.checkoutSessionVerdict as never,
        liveSettlementVerdict: body.liveSettlementVerdict as never,
        evidenceRows: (body.evidenceRows ?? []) as never[],
      });
      return jsonResponse(result);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      const status = msg === "Unauthorized" ? 401 : 400;
      return jsonResponse({ error: msg }, status);
    }
  }),
});

http.route({
  path: "/verification/canary/start-generation",
  method: "POST",
  handler: httpAction(async (ctx, request) => {
    const token = parseBearer(request);
    try {
      const body = (await request.json()) as { prompt?: string };
      const generationId = await ctx.runMutation(internal.generations.requestGenerationForCanaryRunner, {
        runnerSecret: token,
        prompt: typeof body.prompt === "string" ? body.prompt : "Celstate production canary",
      });
      return jsonResponse({ generationId });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      const status = msg === "Unauthorized" ? 401 : 400;
      return jsonResponse({ error: msg }, status);
    }
  }),
});

http.route({
  path: "/verification/canary/generation-status",
  method: "GET",
  handler: httpAction(async (ctx, request) => {
    const token = parseBearer(request);
    const generationId = new URL(request.url).searchParams.get("generationId");
    if (!generationId) {
      return jsonResponse({ error: "generationId required" }, 400);
    }
    try {
      const status = await ctx.runQuery(internal.generations.getGenerationStatusForCanaryRunner, {
        runnerSecret: token,
        generationId: generationId as Id<"generations">,
      });
      return jsonResponse({ status });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      const status = msg === "Unauthorized" ? 401 : 400;
      return jsonResponse({ error: msg }, status);
    }
  }),
});

http.route({
  path: "/verification/canary/start-checkout",
  method: "POST",
  handler: httpAction(async (ctx, request) => {
    const token = parseBearer(request);
    try {
      const body = (await request.json()) as { priceId?: string };
      const checkoutId = await ctx.runMutation(internal.pendingCheckouts.requestCheckoutForCanaryRunner, {
        runnerSecret: token,
        priceId: body.priceId,
      });
      return jsonResponse({ checkoutId });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      const status = msg === "Unauthorized" ? 401 : 400;
      return jsonResponse({ error: msg }, status);
    }
  }),
});

http.route({
  path: "/verification/canary/checkout-status",
  method: "GET",
  handler: httpAction(async (ctx, request) => {
    const token = parseBearer(request);
    const checkoutId = new URL(request.url).searchParams.get("checkoutId");
    if (!checkoutId) {
      return jsonResponse({ error: "checkoutId required" }, 400);
    }
    try {
      const status = await ctx.runQuery(internal.pendingCheckouts.getCheckoutStatusForCanaryRunner, {
        runnerSecret: token,
        checkoutId: checkoutId as Id<"pendingCheckouts">,
      });
      return jsonResponse({ status });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      const status = msg === "Unauthorized" ? 401 : 400;
      return jsonResponse({ error: msg }, status);
    }
  }),
});

http.route({
  path: "/verification/canary/settlement-by-checkout",
  method: "GET",
  handler: httpAction(async (ctx, request) => {
    const token = parseBearer(request);
    const checkoutId = new URL(request.url).searchParams.get("checkoutId");
    if (!checkoutId) {
      return jsonResponse({ error: "checkoutId required" }, 400);
    }
    try {
      const settlement = await ctx.runQuery(internal.creditGrants.getSettlementByPendingCheckoutForCanaryRunner, {
        runnerSecret: token,
        pendingCheckoutId: checkoutId as Id<"pendingCheckouts">,
      });
      return jsonResponse({ settlement });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      const status = msg === "Unauthorized" ? 401 : 400;
      return jsonResponse({ error: msg }, status);
    }
  }),
});

http.route({
  path: "/verification/canary/refund-settlement",
  method: "POST",
  handler: httpAction(async (ctx, request) => {
    const token = parseBearer(request);
    const body = (await request.json()) as { pendingCheckoutId?: string };
    if (!body.pendingCheckoutId) {
      return jsonResponse({ error: "pendingCheckoutId required" }, 400);
    }
    try {
      const result = await ctx.runAction(internal.stripeRefundVerification.refundSettlementByPendingCheckoutForCanary, {
        runnerSecret: token,
        pendingCheckoutId: body.pendingCheckoutId as Id<"pendingCheckouts">,
      });
      return jsonResponse(result);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      const status = msg === "Unauthorized" ? 401 : 400;
      return jsonResponse({ error: msg }, status);
    }
  }),
});

http.route({
  path: "/verification/canary/upsert-principal",
  method: "POST",
  handler: httpAction(async (ctx, request) => {
    const token = parseBearer(request);
    const body = (await request.json()) as {
      principalId?: "CANARY_AUTH" | "CANARY_GENERATION" | "CANARY_CHECKOUT" | "CANARY_SETTLEMENT";
    };
    if (!body.principalId) {
      return jsonResponse({ error: "principalId required" }, 400);
    }
    try {
      const id = await ctx.runMutation(internal.verification.upsertCanaryPrincipal, {
        runnerSecret: token,
        principalId: body.principalId,
      });
      return jsonResponse({ canaryPrincipalId: id });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      const status = msg === "Unauthorized" ? 401 : 400;
      return jsonResponse({ error: msg }, status);
    }
  }),
});

http.route({
  path: "/verification/canary/start-settlement-checkout",
  method: "POST",
  handler: httpAction(async (ctx, request) => {
    const token = parseBearer(request);
    try {
      const body = (await request.json()) as { priceId?: string };
      const checkoutId = await ctx.runMutation(internal.pendingCheckouts.requestSettlementCheckoutForCanaryRunner, {
        runnerSecret: token,
        priceId: body.priceId,
      });
      return jsonResponse({ checkoutId });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      const status = msg === "Unauthorized" ? 401 : 400;
      return jsonResponse({ error: msg }, status);
    }
  }),
});

http.route({
  path: "/verification/canary/settlement-checkout-status",
  method: "GET",
  handler: httpAction(async (ctx, request) => {
    const token = parseBearer(request);
    const checkoutId = new URL(request.url).searchParams.get("checkoutId");
    if (!checkoutId) {
      return jsonResponse({ error: "checkoutId required" }, 400);
    }
    try {
      const status = await ctx.runQuery(internal.pendingCheckouts.getSettlementCheckoutStatusForCanaryRunner, {
        runnerSecret: token,
        checkoutId: checkoutId as Id<"pendingCheckouts">,
      });
      return jsonResponse({ status });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      const status = msg === "Unauthorized" ? 401 : 400;
      return jsonResponse({ error: msg }, status);
    }
  }),
});

const handleCreditPackCheckout = async (
  ctx: CreditPackCheckoutEventContext,
  event: CreditPackCheckoutEvent,
) => {
  const stripeEnv = assertStripeEnv();
  const CREDIT_PACKS: Record<string, number> = {
    [stripeEnv.stripePriceStarter]: 15,
    [stripeEnv.stripePricePro]: 40,
  };

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

  const amountUsd = (session.amount_total ?? 0) / 100;
  const currency = session.currency ?? "usd";

  const pendingCheckoutId = await ctx.runQuery(
    internal.pendingCheckouts.getByStripeCheckoutSessionId,
    { stripeCheckoutSessionId: session.id },
  );

  const settlement = await ctx.runMutation(internal.creditGrants.recordPurchaseSettlement, {
    userId: userId as Id<"users">,
    creditsGranted: credits,
    priceId: priceId!,
    stripePaymentIntentId: paymentIntentId,
    stripeCheckoutSessionId: session.id,
    pendingCheckoutId: pendingCheckoutId ?? undefined,
    amountUsd,
    currency,
  });

  if (settlement.alreadyRecorded) {
    console.log("Purchase settlement already recorded (webhook dedup) for", paymentIntentId);
    return;
  }

  if (!settlement.created) {
    console.error("recordPurchaseSettlement did not create settlement row for", session.id);
    return;
  }

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
