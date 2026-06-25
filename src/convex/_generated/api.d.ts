/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type * as creditPackPurchase from "../creditPackPurchase.js";
import type * as creditPackPurchaseActions from "../creditPackPurchaseActions.js";
import type * as crons from "../crons.js";
import type * as generation from "../generation.js";
import type * as generationArtifactRetention from "../generationArtifactRetention.js";
import type * as generationReports from "../generationReports.js";
import type * as generations from "../generations.js";
import type * as http from "../http.js";
import type * as lib_config from "../lib/config.js";
import type * as lib_creditPackPurchase_catalog from "../lib/creditPackPurchase/catalog.js";
import type * as lib_creditPackPurchase_inMemoryStripeAdapter from "../lib/creditPackPurchase/inMemoryStripeAdapter.js";
import type * as lib_creditPackPurchase_lifecycle from "../lib/creditPackPurchase/lifecycle.js";
import type * as lib_creditPackPurchase_productionStripeAdapter from "../lib/creditPackPurchase/productionStripeAdapter.js";
import type * as lib_creditPackPurchase_stripePort from "../lib/creditPackPurchase/stripePort.js";
import type * as lib_gemini from "../lib/gemini.js";
import type * as lib_generationArtifactStorage from "../lib/generationArtifactStorage.js";
import type * as lib_generation_generationOpsEvents from "../lib/generation/generationOpsEvents.js";
import type * as lib_generation_generationRun from "../lib/generation/generationRun.js";
import type * as lib_generation_matte from "../lib/generation/matte.js";
import type * as lib_generation_optimize from "../lib/generation/optimize.js";
import type * as lib_generation_prompts from "../lib/generation/prompts.js";
import type * as lib_generation_userArtifactDeletion from "../lib/generation/userArtifactDeletion.js";
import type * as lib_generation_validation from "../lib/generation/validation.js";
import type * as lib_lottie_lottieGenerationRun from "../lib/lottie/lottieGenerationRun.js";
import type * as lib_lottie_lottiePrompt from "../lib/lottie/lottiePrompt.js";
import type * as lib_lottie_lottieValidation from "../lib/lottie/lottieValidation.js";
import type * as lib_ops from "../lib/ops.js";
import type * as lib_opsInvestigation from "../lib/opsInvestigation.js";
import type * as lib_qa_qaUserResetSecret from "../lib/qa/qaUserResetSecret.js";
import type * as lib_qa_transparentQa from "../lib/qa/transparentQa.js";
import type * as lib_referenceStorageIds from "../lib/referenceStorageIds.js";
import type * as lib_stripeEnv from "../lib/stripeEnv.js";
import type * as lib_validation_validation from "../lib/validation/validation.js";
import type * as lib_validation_validators from "../lib/validation/validators.js";
import type * as lib_verification_verificationRunnerSecret from "../lib/verification/verificationRunnerSecret.js";
import type * as lottieGeneration from "../lottieGeneration.js";
import type * as lottieGenerations from "../lottieGenerations.js";
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
import type * as posthog from "../posthog.js";
import type * as qaUserReset from "../qaUserReset.js";
import type * as users from "../users.js";
import type * as verification from "../verification.js";
import type * as verificationRuns from "../verificationRuns.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  creditPackPurchase: typeof creditPackPurchase;
  creditPackPurchaseActions: typeof creditPackPurchaseActions;
  crons: typeof crons;
  generation: typeof generation;
  generationArtifactRetention: typeof generationArtifactRetention;
  generationReports: typeof generationReports;
  generations: typeof generations;
  http: typeof http;
  "lib/config": typeof lib_config;
  "lib/creditPackPurchase/catalog": typeof lib_creditPackPurchase_catalog;
  "lib/creditPackPurchase/inMemoryStripeAdapter": typeof lib_creditPackPurchase_inMemoryStripeAdapter;
  "lib/creditPackPurchase/lifecycle": typeof lib_creditPackPurchase_lifecycle;
  "lib/creditPackPurchase/productionStripeAdapter": typeof lib_creditPackPurchase_productionStripeAdapter;
  "lib/creditPackPurchase/stripePort": typeof lib_creditPackPurchase_stripePort;
  "lib/gemini": typeof lib_gemini;
  "lib/generationArtifactStorage": typeof lib_generationArtifactStorage;
  "lib/generation/generationOpsEvents": typeof lib_generation_generationOpsEvents;
  "lib/generation/generationRun": typeof lib_generation_generationRun;
  "lib/generation/matte": typeof lib_generation_matte;
  "lib/generation/optimize": typeof lib_generation_optimize;
  "lib/generation/prompts": typeof lib_generation_prompts;
  "lib/generation/userArtifactDeletion": typeof lib_generation_userArtifactDeletion;
  "lib/generation/validation": typeof lib_generation_validation;
  "lib/lottie/lottieGenerationRun": typeof lib_lottie_lottieGenerationRun;
  "lib/lottie/lottiePrompt": typeof lib_lottie_lottiePrompt;
  "lib/lottie/lottieValidation": typeof lib_lottie_lottieValidation;
  "lib/ops": typeof lib_ops;
  "lib/opsInvestigation": typeof lib_opsInvestigation;
  "lib/qa/qaUserResetSecret": typeof lib_qa_qaUserResetSecret;
  "lib/qa/transparentQa": typeof lib_qa_transparentQa;
  "lib/referenceStorageIds": typeof lib_referenceStorageIds;
  "lib/stripeEnv": typeof lib_stripeEnv;
  "lib/validation/validation": typeof lib_validation_validation;
  "lib/validation/validators": typeof lib_validation_validators;
  "lib/verification/verificationRunnerSecret": typeof lib_verification_verificationRunnerSecret;
  lottieGeneration: typeof lottieGeneration;
  lottieGenerations: typeof lottieGenerations;
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
  posthog: typeof posthog;
  qaUserReset: typeof qaUserReset;
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
  stripe: import("@convex-dev/stripe/_generated/component.js").ComponentApi<"stripe">;
  posthog: import("@posthog/convex/_generated/component.js").ComponentApi<"posthog">;
};
