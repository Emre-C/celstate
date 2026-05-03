/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type * as auth from "../auth.js";
import type * as creditGrants from "../creditGrants.js";
import type * as crons from "../crons.js";
import type * as generation from "../generation.js";
import type * as generationReports from "../generationReports.js";
import type * as generations from "../generations.js";
import type * as http from "../http.js";
import type * as lib_config from "../lib/config.js";
import type * as lib_gemini from "../lib/gemini.js";
import type * as lib_generationOpsEvents from "../lib/generationOpsEvents.js";
import type * as lib_generationRun from "../lib/generationRun.js";
import type * as lib_matte from "../lib/matte.js";
import type * as lib_ops from "../lib/ops.js";
import type * as lib_optimize from "../lib/optimize.js";
import type * as lib_prompts from "../lib/prompts.js";
import type * as lib_qaUserResetSecret from "../lib/qaUserResetSecret.js";
import type * as lib_referenceStorageIds from "../lib/referenceStorageIds.js";
import type * as lib_stripeCheckout from "../lib/stripeCheckout.js";
import type * as lib_stripeEnv from "../lib/stripeEnv.js";
import type * as lib_transparentQa from "../lib/transparentQa.js";
import type * as lib_validation from "../lib/validation.js";
import type * as lib_validators from "../lib/validators.js";
import type * as lib_verificationRunnerSecret from "../lib/verificationRunnerSecret.js";
import type * as mcp_constants from "../mcp/constants.js";
import type * as mcp_context from "../mcp/context.js";
import type * as mcp_handler from "../mcp/handler.js";
import type * as mcp_keys from "../mcp/keys.js";
import type * as mcp_toolResults from "../mcp/toolResults.js";
import type * as mcp_tools_credits from "../mcp/tools/credits.js";
import type * as mcp_tools_generate from "../mcp/tools/generate.js";
import type * as mcp_tools_getImage from "../mcp/tools/getImage.js";
import type * as mcp_tools_listImages from "../mcp/tools/listImages.js";
import type * as ops from "../ops.js";
import type * as pendingCheckouts from "../pendingCheckouts.js";
import type * as posthog from "../posthog.js";
import type * as qaUserReset from "../qaUserReset.js";
import type * as stripe from "../stripe.js";
import type * as stripeRefundVerification from "../stripeRefundVerification.js";
import type * as users from "../users.js";
import type * as verification from "../verification.js";
import type * as verificationRuns from "../verificationRuns.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  auth: typeof auth;
  creditGrants: typeof creditGrants;
  crons: typeof crons;
  generation: typeof generation;
  generationReports: typeof generationReports;
  generations: typeof generations;
  http: typeof http;
  "lib/config": typeof lib_config;
  "lib/gemini": typeof lib_gemini;
  "lib/generationOpsEvents": typeof lib_generationOpsEvents;
  "lib/generationRun": typeof lib_generationRun;
  "lib/matte": typeof lib_matte;
  "lib/ops": typeof lib_ops;
  "lib/optimize": typeof lib_optimize;
  "lib/prompts": typeof lib_prompts;
  "lib/qaUserResetSecret": typeof lib_qaUserResetSecret;
  "lib/referenceStorageIds": typeof lib_referenceStorageIds;
  "lib/stripeCheckout": typeof lib_stripeCheckout;
  "lib/stripeEnv": typeof lib_stripeEnv;
  "lib/transparentQa": typeof lib_transparentQa;
  "lib/validation": typeof lib_validation;
  "lib/validators": typeof lib_validators;
  "lib/verificationRunnerSecret": typeof lib_verificationRunnerSecret;
  "mcp/constants": typeof mcp_constants;
  "mcp/context": typeof mcp_context;
  "mcp/handler": typeof mcp_handler;
  "mcp/keys": typeof mcp_keys;
  "mcp/toolResults": typeof mcp_toolResults;
  "mcp/tools/credits": typeof mcp_tools_credits;
  "mcp/tools/generate": typeof mcp_tools_generate;
  "mcp/tools/getImage": typeof mcp_tools_getImage;
  "mcp/tools/listImages": typeof mcp_tools_listImages;
  ops: typeof ops;
  pendingCheckouts: typeof pendingCheckouts;
  posthog: typeof posthog;
  qaUserReset: typeof qaUserReset;
  stripe: typeof stripe;
  stripeRefundVerification: typeof stripeRefundVerification;
  users: typeof users;
  verification: typeof verification;
  verificationRuns: typeof verificationRuns;
}>;

/**
 * A utility for referencing Convex functions in your app's public API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = api.myModule.myFunction;
 * ```
 */
export declare const api: FilterApi<
  typeof fullApi,
  FunctionReference<any, "public">
>;

/**
 * A utility for referencing Convex functions in your app's internal API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = internal.myModule.myFunction;
 * ```
 */
export declare const internal: FilterApi<
  typeof fullApi,
  FunctionReference<any, "internal">
>;

export declare const components: {
  betterAuth: import("@convex-dev/better-auth/_generated/component.js").ComponentApi<"betterAuth">;
  stripe: import("@convex-dev/stripe/_generated/component.js").ComponentApi<"stripe">;
  posthog: import("@posthog/convex/_generated/component.js").ComponentApi<"posthog">;
};
