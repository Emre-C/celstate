import { createClient, type GenericCtx } from "@convex-dev/better-auth";
import { convex } from "@convex-dev/better-auth/plugins";
import { betterAuth, type BetterAuthOptions } from "better-auth/minimal";
import {
  assertCanonicalAuthEnv,
  buildSocialProviders,
  getTrustedOrigins,
} from "../lib/auth/config.js";
import { components } from "./_generated/api.js";
import type { DataModel } from "./_generated/dataModel.js";
import { internalAction, query } from "./_generated/server.js";
import authConfig from "./auth.config.js";

export const authComponent = createClient<DataModel>(components.betterAuth);
export const getValidatedAuthEnv = (envSource: Record<string, string | undefined> = process.env) =>
  assertCanonicalAuthEnv(envSource);

const AUTH_LOG_SCOPE = "auth";

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

export const createAuth = (ctx: GenericCtx<DataModel>) => {
  const authEnv = getValidatedAuthEnv();
  const options = {
    baseURL: authEnv.siteUrl,
    secret: authEnv.betterAuthSecret,
    database: authComponent.adapter(ctx),
    socialProviders: buildSocialProviders(authEnv),
    trustedOrigins: getTrustedOrigins(authEnv),
    advanced: {
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
        logAuthServerEvent("error", "better_auth_api_error", {
          error: summarizeAuthError(error),
          context: summarizeAuthContext(context),
        });
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
