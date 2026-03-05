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
import type * as generation from "../generation.js";
import type * as generations from "../generations.js";
import type * as http from "../http.js";
import type * as lib_config from "../lib/config.js";
import type * as lib_gemini from "../lib/gemini.js";
import type * as lib_matte from "../lib/matte.js";
import type * as lib_prompts from "../lib/prompts.js";
import type * as lib_validation from "../lib/validation.js";
import type * as users from "../users.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  auth: typeof auth;
  generation: typeof generation;
  generations: typeof generations;
  http: typeof http;
  "lib/config": typeof lib_config;
  "lib/gemini": typeof lib_gemini;
  "lib/matte": typeof lib_matte;
  "lib/prompts": typeof lib_prompts;
  "lib/validation": typeof lib_validation;
  users: typeof users;
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

export declare const components: {};
