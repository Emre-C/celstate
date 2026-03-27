import { createClient, type GenericCtx } from "@convex-dev/better-auth";
import { convex } from "@convex-dev/better-auth/plugins";
import { betterAuth, type BetterAuthOptions } from "better-auth/minimal";
import {
  AUTH_PROXY_CLIENT_IP_HEADER,
  assertCanonicalAuthEnv,
  buildSocialProviders,
  getTrustedOrigins,
} from "../lib/auth/config.js";
import { components } from "./_generated/api.js";
import type { DataModel } from "./_generated/dataModel.js";
import { internalAction, query } from "./_generated/server.js";
import authConfig from "./auth.config.js";
import { assertOkWebhookResponse, buildAuthAlertRequest, readOpsAlertRuntimeConfig } from "./lib/ops.js";

export const authComponent = createClient<DataModel>(components.betterAuth);
export const getValidatedAuthEnv = (envSource: Record<string, string | undefined> = process.env) =>
  assertCanonicalAuthEnv(envSource);

const AUTH_LOG_SCOPE = "auth";
const BETTER_AUTH_ALERT_COOLDOWN_MS = 5 * 60 * 1000;
/** Best-effort process-local cooldown; not durable across cold starts or isolate recycling. */
let lastBetterAuthApiAlertAt = 0;

const toConsoleMethod = (level: string) => {
  switch (level) {
    case "error":
      return console.error;
    case "warn":
      return console.warn;
    default:
      return console.info;
  }
};

const summarizeAuthError = (error: unknown) => {
  if (error instanceof Error) {
    return {
      name: error.name,
      message: error.message,
    };
  }

  return {
    value: String(error),
  };
};

const summarizeAuthContext = (context: unknown) => {
  if (!context || typeof context !== "object") {
    return undefined;
  }

  const record = context as Record<string, unknown>;

  return {
    keys: Object.keys(record).sort(),
    method: typeof record.method === "string" ? record.method : undefined,
    path: typeof record.path === "string" ? record.path : undefined,
  };
};

const logAuthServerEvent = (
  level: "info" | "warn" | "error",
  event: string,
  data: Record<string, unknown>,
) => {
  toConsoleMethod(level)(
    JSON.stringify({
      scope: AUTH_LOG_SCOPE,
      event,
      timestamp: new Date().toISOString(),
      ...data,
    }),
  );
};

const sendBetterAuthApiErrorAlert = async (error: unknown, context: ReturnType<typeof summarizeAuthContext>) => {
  const now = Date.now();
  if (now - lastBetterAuthApiAlertAt < BETTER_AUTH_ALERT_COOLDOWN_MS) {
    return;
  }

  lastBetterAuthApiAlertAt = now;
  const config = readOpsAlertRuntimeConfig();
  if (!config.webhookUrl) {
    return;
  }

  try {
    const request = buildAuthAlertRequest(config, {
      alertType: "better_auth_api_error",
      severity: "critical",
      error: error instanceof Error ? error.message : String(error),
      method: context?.method,
      pathname: context?.path,
      provider: "better-auth",
    });
    const response = await fetch(request.url, {
      method: "POST",
      headers: request.headers,
      body: request.body,
    });

    assertOkWebhookResponse(response);
  } catch (alertError) {
    logAuthServerEvent("error", "better_auth_api_error_alert_failed", {
      error: summarizeAuthError(alertError),
    });
  }
};

export const createAuth = (ctx: GenericCtx<DataModel>) => {
  const authEnv = getValidatedAuthEnv();
  const options = {
    baseURL: authEnv.siteUrl,
    secret: authEnv.betterAuthSecret,
    database: authComponent.adapter(ctx),
    socialProviders: buildSocialProviders(authEnv),
    trustedOrigins: getTrustedOrigins(authEnv),
    advanced: {
      ipAddress: {
        ipAddressHeaders: [AUTH_PROXY_CLIENT_IP_HEADER],
      },
      trustedProxyHeaders: true,
    },
    logger: {
      level: process.env.NODE_ENV === "production" ? "warn" : "info",
      log: (level, message) => {
        logAuthServerEvent(level === "error" ? "error" : level === "warn" ? "warn" : "info", "better_auth_log", {
          message,
        });
      },
    },
    onAPIError: {
      errorURL: "/auth",
      onError: (error, context) => {
        const summarizedContext = summarizeAuthContext(context);
        logAuthServerEvent("error", "better_auth_api_error", {
          error: summarizeAuthError(error),
          context: summarizedContext,
        });
        void sendBetterAuthApiErrorAlert(error, summarizedContext);
      },
    },
    plugins: [
      convex({
        authConfig,
        jwksRotateOnTokenGenerationError: true,
      }),
    ],
  } satisfies BetterAuthOptions;

  return betterAuth(options);
};

export const getCurrentUser = query({
  args: {},
  handler: async (ctx) => {
    return (await authComponent.safeGetAuthUser(ctx)) ?? null;
  },
});

export const rotateKeys = internalAction({
  args: {},
  handler: async (ctx) => {
    const auth = createAuth(ctx);
    await auth.api.rotateKeys();
    return { rotated: true };
  },
});
