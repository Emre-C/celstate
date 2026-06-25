"use node";

import { v } from "convex/values";
import { internalAction, type ActionCtx } from "./_generated/server.js";
import { internal } from "./_generated/api.js";
import type { Doc, Id } from "./_generated/dataModel.js";
import {
  isValidLottieAspectRatio,
  LOTTIE_GENERATION_CONFIG,
  type LottieAspectRatioKey,
  type LottieDurationSeconds,
} from "./lib/config.js";
import {
  generateStructuredText,
  readGeminiRuntimeConfigFromEnv,
} from "./lib/gemini.js";
import {
  buildLottieGenerationPrompt,
  buildLottieRepairPrompt,
  buildLottieSystemInstruction,
  LOTTIE_RESPONSE_SCHEMA,
} from "./lib/lottie/lottiePrompt.js";
import { getErrorMessage } from "../lib/utils/errors.js";
import {
  normalizeLottieJsonForStorage,
  parseLottieModelResponse,
  validateLottieDocument,
  type LottieValidationResult,
} from "./lib/lottie/lottieValidation.js";

type LottieGenerationDoc = Doc<"lottieGenerations">;

function readLottieGenerationModelFromEnv(
  env: Record<string, string | undefined> = process.env,
): string {
  return env.LOTTIE_GENERATION_MODEL?.trim() || LOTTIE_GENERATION_CONFIG.defaultModel;
}


function createValidationFailure(errors: string[]): LottieValidationResult {
  return {
    decision: "fail",
    errors,
    warnings: [],
    version: "lottie-v1",
  };
}

function normalizeDurationSeconds(value: number): LottieDurationSeconds {
  if (value === 2 || value === 4 || value === 6 || value === 8) {
    return value;
  }
  throw new Error(`Unsupported stored Lottie duration: ${value}`);
}

function normalizeAspectRatio(value: string): LottieAspectRatioKey {
  if (isValidLottieAspectRatio(value)) {
    return value;
  }
  throw new Error(`Unsupported stored Lottie aspect ratio: ${value}`);
}

function parseAndValidateLottieResponse(
  rawResponse: string,
  generation: Pick<LottieGenerationDoc, "aspectRatio" | "durationSeconds" | "fps">,
): {
  lottie: unknown | null;
  rawLottieJson: string;
  validation: LottieValidationResult;
} {
  try {
    const parsed = parseLottieModelResponse(rawResponse);
    return {
      lottie: parsed.lottie,
      rawLottieJson: parsed.rawLottieJson,
      validation: validateLottieDocument({
        aspectRatio: normalizeAspectRatio(generation.aspectRatio),
        durationSeconds: generation.durationSeconds,
        fps: generation.fps,
        lottie: parsed.lottie,
      }),
    };
  } catch (error) {
    return {
      lottie: null,
      rawLottieJson: rawResponse,
      validation: createValidationFailure([
        `Response parsing failed: ${getErrorMessage(error)}`,
      ]),
    };
  }
}

async function storeLottieJson(
  ctx: Pick<ActionCtx, "storage">,
  lottie: unknown,
): Promise<Id<"_storage">> {
  const blob = new Blob(
    [normalizeLottieJsonForStorage(lottie)],
    { type: "application/json" },
  );
  return await ctx.storage.store(blob);
}

async function completeGeneration(
  ctx: Pick<ActionCtx, "runMutation" | "storage">,
  generation: LottieGenerationDoc,
  expectedStatus: "generating" | "repairing",
  lottie: unknown,
  validation: LottieValidationResult,
): Promise<void> {
  let lottieStorageId: Id<"_storage">;
  try {
    lottieStorageId = await storeLottieJson(ctx, lottie);
  } catch (error) {
    await failGeneration(
      ctx,
      generation,
      expectedStatus,
      "We generated a Lottie animation but could not store it. Please try again.",
      createValidationFailure([getErrorMessage(error)]),
    );
    return;
  }

  await ctx.runMutation(internal.lottieGenerations.completeLottieGeneration, {
    expectedStatus,
    lottieGenerationId: generation._id,
    lottieStorageId,
    validation,
  });
}

async function failGeneration(
  ctx: Pick<ActionCtx, "runMutation">,
  generation: LottieGenerationDoc,
  expectedStatus: "generating" | "repairing" | "queued",
  error: string,
  validation?: LottieValidationResult,
): Promise<void> {
  await ctx.runMutation(internal.lottieGenerations.failLottieGeneration, {
    error,
    expectedStatus,
    lottieGenerationId: generation._id,
    validation,
  });
}

export const generateLottie = internalAction({
  args: {
    lottieGenerationId: v.id("lottieGenerations"),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const generation: LottieGenerationDoc | null = await ctx.runQuery(
      internal.lottieGenerations.getById,
      { lottieGenerationId: args.lottieGenerationId },
    );
    if (!generation || generation.status !== "queued") {
      return null;
    }

    await ctx.runMutation(internal.lottieGenerations.markAttemptStarted, {
      attemptCount: 1,
      expectedStatus: "queued",
      lottieGenerationId: generation._id,
      status: "generating",
    });

    const runtimeConfig = readGeminiRuntimeConfigFromEnv();
    const model = readLottieGenerationModelFromEnv();
    const durationSeconds = normalizeDurationSeconds(generation.durationSeconds);
    const aspectRatio = normalizeAspectRatio(generation.aspectRatio);

    let first;
    try {
      first = await generateStructuredText(runtimeConfig, {
        model,
        prompt: buildLottieGenerationPrompt({
          aspectRatio,
          durationSeconds,
          fps: generation.fps,
          grounding: generation.grounding,
          prompt: generation.prompt,
        }),
        responseSchema: LOTTIE_RESPONSE_SCHEMA,
        systemInstruction: buildLottieSystemInstruction(),
      });
    } catch (error) {
      await failGeneration(
        ctx,
        generation,
        "generating",
        "We could not generate a valid Lottie JSON file. Please try again.",
        createValidationFailure([getErrorMessage(error)]),
      );
      return null;
    }

    const firstAttempt = parseAndValidateLottieResponse(first, generation);
    if (firstAttempt.validation.decision === "pass" && firstAttempt.lottie) {
      await completeGeneration(ctx, generation, "generating", firstAttempt.lottie, firstAttempt.validation);
      return null;
    }

    await ctx.runMutation(internal.lottieGenerations.markAttemptStarted, {
      attemptCount: 2,
      expectedStatus: "generating",
      lottieGenerationId: generation._id,
      status: "repairing",
      validation: firstAttempt.validation,
    });

    let repair;
    try {
      repair = await generateStructuredText(runtimeConfig, {
        model,
        prompt: buildLottieRepairPrompt({
          aspectRatio,
          durationSeconds,
          fps: generation.fps,
          grounding: generation.grounding,
          invalidLottieJson: firstAttempt.rawLottieJson,
          prompt: generation.prompt,
          validation: firstAttempt.validation,
        }),
        responseSchema: LOTTIE_RESPONSE_SCHEMA,
        systemInstruction: buildLottieSystemInstruction(),
      });
    } catch (error) {
      await failGeneration(
        ctx,
        generation,
        "repairing",
        "We could not repair the generated Lottie JSON. Please try again.",
        createValidationFailure([getErrorMessage(error)]),
      );
      return null;
    }

    const repairedAttempt = parseAndValidateLottieResponse(repair, generation);
    if (repairedAttempt.validation.decision === "pass" && repairedAttempt.lottie) {
      await completeGeneration(ctx, generation, "repairing", repairedAttempt.lottie, repairedAttempt.validation);
      return null;
    }

    await failGeneration(
      ctx,
      generation,
      "repairing",
      "We could not generate a valid production Lottie JSON file. Please refine the prompt and try again.",
      repairedAttempt.validation,
    );

    return null;
  },
});
