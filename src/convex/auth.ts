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
import { query } from "./_generated/server.js";
import authConfig from "./auth.config.js";

export const authComponent = createClient<DataModel>(components.betterAuth);
export const getValidatedAuthEnv = (envSource: Record<string, string | undefined> = process.env) =>
  assertCanonicalAuthEnv(envSource);

export const createAuth = (ctx: GenericCtx<DataModel>) => {
  const authEnv = getValidatedAuthEnv();
  const options = {
    baseURL: authEnv.siteUrl,
    secret: authEnv.betterAuthSecret,
    database: authComponent.adapter(ctx),
    socialProviders: buildSocialProviders(authEnv),
    trustedOrigins: getTrustedOrigins(authEnv),
    plugins: [
      convex({
        authConfig,
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
