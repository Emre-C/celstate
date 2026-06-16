"use node";

import { v } from "convex/values";
import { internalAction, type ActionCtx } from "./_generated/server.js";
import { internal } from "./_generated/api.js";
import type { Doc, Id } from "./_generated/dataModel.js";
import sharp from "sharp";
import { GENERATION_CONFIG } from "./lib/config.js";
import {
  createChatSession,
  type GeminiImageResult,
  normalizeGeminiImageMimeType,
  readGeminiRuntimeConfigFromEnv,
} from "./lib/gemini.js";
import {
  getGenerationRunRetryStatusMessage,
  getGenerationRunStageRetryCount,
  hasGenerationRunStageRetryCapacity,
  isGenerationRunStageRunnable,
  type GenerationStage,
} from "./lib/generation/generationRun.js";
import {
  buildWhiteBgPrompt,
  buildBlackBgPrompt,
  buildWhiteBgRetryPrompt,
  buildBlackBgRetryPrompt,
  buildWhiteBgPromptWithReference,
  buildWhiteBgRetryPromptWithReference,
} from "./lib/generation/prompts.js";
import {
  buildRepairInstruction,
  validateWhiteBackground,
  validateBlackBackground,
  validateDimensionMatch,
} from "./lib/validation/validation.js";
import { differenceMatte, type DecodedImage, type MatteOutput } from "./lib/generation/matte.js";
import { optimizeForWeb } from "./lib/generation/optimize.js";
import {
  analyzeTransparentOutput,
  buildTransparentQaRetryPlan,
  type TransparentQaDecision,
  type TransparentQaReasonCode,
  type TransparentQaResult,
} from "./lib/qa/transparentQa.js";

export class AspectRatioMismatchError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AspectRatioMismatchError";
  }
}

export function buildBlackBackgroundStagePrompt(retryInstruction?: string): string {
  return retryInstruction ? buildBlackBgRetryPrompt(retryInstruction) : buildBlackBgPrompt();
}

export function shouldRecoverFinalizingWithFullRerender(
  error: unknown,
): error is AspectRatioMismatchError {
  return error instanceof AspectRatioMismatchError;
}

function aspectRatioMatches(
  w1: number,
  h1: number,
  w2: number,
  h2: number,
): boolean {
  const ratio1 = w1 / h1;
  const ratio2 = w2 / h2;
  // Allow 5% tolerance for aspect ratio comparison
  return Math.abs(ratio1 - ratio2) / Math.max(ratio1, ratio2) < 0.05;
}

async function decodeImage(
  base64: string,
  mimeType?: string,
): Promise<DecodedImage> {
  const raw = Buffer.from(base64, "base64");

  if (raw.length === 0) {
    throw new Error(
      `Gemini returned empty image payload (reported mimeType=${mimeType ?? "unknown"})`,
    );
  }

  // Log diagnostic info for production debugging
  const signature = raw.subarray(0, 8).toString("hex");
  const isPng = raw.length >= 8 && raw[0] === 0x89 && raw[1] === 0x50 && raw[2] === 0x4e && raw[3] === 0x47;
  const isJpeg = raw.length >= 2 && raw[0] === 0xff && raw[1] === 0xd8;
  const detectedFormat = isPng ? "png" : isJpeg ? "jpeg" : "other";
  console.log(
    `[decodeImage] mimeType=${mimeType ?? "unknown"} detectedFormat=${detectedFormat} ` +
    `bufferLength=${raw.length} signature=${signature}`,
  );

  try {
    const { data, info } = await sharp(raw)
      .ensureAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });

    return {
      pixels: new Uint8ClampedArray(data),
      width: info.width,
      height: info.height,
    };
  } catch (sharpErr) {
    const msg = sharpErr instanceof Error ? sharpErr.message : String(sharpErr);
    throw new Error(
      `Failed to decode image: ${msg} (mimeType=${mimeType ?? "unknown"}, ` +
      `detectedFormat=${detectedFormat}, bufferLength=${raw.length})`,
    );
  }
}

async function encodePng(
  pixels: Uint8ClampedArray,
  width: number,
  height: number,
): Promise<Buffer> {
  return sharp(Buffer.from(pixels), {
    raw: { width, height, channels: 4 },
  })
    .png()
    .toBuffer();
}

async function resizeToMatch(
  pixels: Uint8ClampedArray,
  srcWidth: number,
  srcHeight: number,
  dstWidth: number,
  dstHeight: number,
): Promise<Uint8ClampedArray> {
  const { data } = await sharp(Buffer.from(pixels), {
    raw: { width: srcWidth, height: srcHeight, channels: 4 },
  })
    .resize(dstWidth, dstHeight)
    .raw()
    .toBuffer({ resolveWithObject: true });

  return new Uint8ClampedArray(data);
}

type StageActionContext = Pick<ActionCtx, "runMutation" | "runQuery" | "storage">;

interface PipelineResult {
  matteOutput: MatteOutput;
  whiteDecoded: DecodedImage;
  blackDecoded: DecodedImage;
  dimensionMismatch: boolean;
}

async function updateStatus(
  ctx: StageActionContext,
  generationId: Id<"generations">,
  stage: GenerationStage,
  statusMessage: string,
): Promise<void> {
  await ctx.runMutation(internal.generations.updateStatusMessage, {
    generationId,
    stage,
    statusMessage,
  });
}

async function getGeneration(
  ctx: StageActionContext,
  generationId: Id<"generations">,
): Promise<Doc<"generations"> | null> {
  return await ctx.runQuery(internal.generations.getById, { generationId });
}

async function loadStoredImage(
  ctx: StageActionContext,
  storageId: Id<"_storage">,
): Promise<GeminiImageResult> {
  const blob = await ctx.storage.get(storageId);
  if (!blob) {
    throw new Error("Stored image not found");
  }

  const buffer = Buffer.from(await blob.arrayBuffer());
  return {
    imageBase64: buffer.toString("base64"),
    mimeType: normalizeGeminiImageMimeType(blob.type),
  };
}

async function loadStoredImages(
  ctx: StageActionContext,
  storageIds: Id<"_storage">[] | undefined,
): Promise<GeminiImageResult[]> {
  if (!storageIds || storageIds.length === 0) {
    return [];
  }

  return Promise.all(storageIds.map((storageId) => loadStoredImage(ctx, storageId)));
}

async function storeGeneratedImage(
  ctx: StageActionContext,
  image: GeminiImageResult,
): Promise<Id<"_storage">> {
  const bytes = Buffer.from(image.imageBase64, "base64");
  const blob = new Blob([new Uint8Array(bytes)], { type: image.mimeType });
  return await ctx.storage.store(blob);
}

function createUserFacingFailureMessage(): string {
  return "Something went wrong generating your image. Your credit has been refunded — please try again.";
}

function throwStageValidationFailure(
  stage: "white_background" | "black_background",
  reason: string | undefined,
  retryInstruction: string | undefined,
): never {
  const stageLabel = stage === "white_background" ? "White" : "Black";
  throw Object.assign(
    new Error(`${stageLabel} background validation failed: ${reason ?? "unknown reason"}`),
    { retryInstruction },
  );
}

async function handleStageFailure(
  ctx: StageActionContext,
  generationId: Id<"generations">,
  stage: GenerationStage,
  retryCount: number,
  error: unknown,
  retryInstruction?: string,
): Promise<void> {
  const rawError = error instanceof Error ? error.message : String(error);
  console.error(`[${stage}] generationId=${generationId} error=${rawError}`);

  if (hasGenerationRunStageRetryCapacity(stage, retryCount)) {
    await ctx.runMutation(internal.generations.scheduleStageRetry, {
      generationId,
      retryCount: retryCount + 1,
      retryInstruction,
      stage,
    });
    return;
  }

  await ctx.runMutation(internal.generations.failGeneration, {
    generationId,
    error: createUserFacingFailureMessage(),
    internalError: rawError,
  });
}

async function scheduleFullRerenderOrFail(
  ctx: StageActionContext,
  generation: Doc<"generations">,
  options: {
    internalError: string;
    reasonCodes: TransparentQaReasonCode[];
    transparentQa?: TransparentQaResult;
    userFacingError?: string;
  },
): Promise<void> {
  const retryCount = getGenerationRunStageRetryCount(generation, "white_background");
  if (!hasGenerationRunStageRetryCapacity("white_background", retryCount)) {
    await ctx.runMutation(internal.generations.failGeneration, {
      generationId: generation._id,
      error: options.userFacingError ?? createUserFacingFailureMessage(),
      internalError: options.internalError,
      transparentQa: options.transparentQa,
    });
    return;
  }

  const retryPlan = buildTransparentQaRetryPlan("retry_white_and_black", options.reasonCodes);
  await ctx.runMutation(internal.generations.scheduleStageRetry, {
    generationId: generation._id,
    expectedStage: "finalizing",
    retryCount: retryCount + 1,
    retryInstruction: retryPlan.retryInstruction,
    downstreamRetryInstruction: retryPlan.downstreamRetryInstruction,
    stage: "white_background",
    transparentQa: options.transparentQa,
  });
}

function buildTransparentQaInternalError(result: TransparentQaResult): string {
  const metrics = result.metrics;
  const summary = [
    `decision=${result.decision}`,
    `alphaPresence=${metrics.alphaPresence.toFixed(4)}`,
    `borderTransparencyRatio=${metrics.borderTransparencyRatio.toFixed(4)}`,
    `recomposition=${metrics.recompositionResidual.toFixed(4)}`,
    `channelDisagreement=${metrics.channelDisagreement.toFixed(4)}`,
    `alphaResidual=${metrics.alphaResidual.toFixed(4)}`,
    `externalSpill=${metrics.externalSpill.toFixed(4)}`,
    `haloTail=${metrics.haloTail.toFixed(4)}`,
    `topologyVolatility=${metrics.topologyVolatility.toFixed(4)}`,
    `persistentHoles=${metrics.persistentHoleCount}`,
    `fragileHoles=${metrics.fragileHoleCount}`,
  ].join(" ");
  const reasonCodes = result.reasonCodes.length > 0 ? result.reasonCodes.join(",") : "none";
  return `Transparent background QA failed (${reasonCodes}) ${summary}`;
}

async function handleTransparentQaFailure(
  ctx: StageActionContext,
  generation: Doc<"generations">,
  qa: TransparentQaResult,
): Promise<void> {
  const internalError = buildTransparentQaInternalError(qa);
  const userFacingError =
    qa.decision === "review"
      ? "We couldn't verify a production-ready transparent background for this image. Your credit has been refunded — please try again."
      : createUserFacingFailureMessage();

  if (qa.decision === "review") {
    await ctx.runMutation(internal.generations.failGeneration, {
      generationId: generation._id,
      error: userFacingError,
      internalError,
      transparentQa: qa,
    });
    return;
  }

  if (qa.decision === "retry_white_and_black") {
    await scheduleFullRerenderOrFail(ctx, generation, {
      internalError,
      reasonCodes: qa.reasonCodes,
      transparentQa: qa,
      userFacingError,
    });
    return;
  }

  const retryStage: "black_background" = "black_background";
  const retryCount = getGenerationRunStageRetryCount(generation, retryStage);
  if (hasGenerationRunStageRetryCapacity(retryStage, retryCount)) {
    const retryPlan = buildTransparentQaRetryPlan("retry_black", qa.reasonCodes);
    await ctx.runMutation(internal.generations.scheduleStageRetry, {
      generationId: generation._id,
      expectedStage: "finalizing",
      retryCount: retryCount + 1,
      retryInstruction: retryPlan.retryInstruction,
      stage: retryStage,
      transparentQa: qa,
    });
    return;
  }

  await scheduleFullRerenderOrFail(ctx, generation, {
    internalError,
    reasonCodes: qa.reasonCodes,
    transparentQa: {
      ...qa,
      decision: "retry_white_and_black",
    },
    userFacingError,
  });
}

async function finalizePipeline(
  ctx: StageActionContext,
  generation: Doc<"generations">,
): Promise<PipelineResult> {
  await updateStatus(ctx, generation._id, "finalizing", "Extracting transparency…");
  // Both storage IDs are written by the preceding pipeline stages; assert non-null.
  let white = await loadStoredImage(ctx, generation.whiteBgStorageId!);
  let black = await loadStoredImage(ctx, generation.blackBgStorageId!);

  let whiteDecoded = await decodeImage(white.imageBase64, white.mimeType);
  let blackDecoded = await decodeImage(black.imageBase64, black.mimeType);

  let hadDimensionMismatch = false;
  if (!validateDimensionMatch(
    whiteDecoded.width,
    whiteDecoded.height,
    blackDecoded.width,
    blackDecoded.height,
  )) {
    hadDimensionMismatch = true;

    if (!aspectRatioMatches(
      whiteDecoded.width,
      whiteDecoded.height,
      blackDecoded.width,
      blackDecoded.height,
    )) {
      throw new AspectRatioMismatchError(
        `Aspect ratio mismatch: white=${whiteDecoded.width}x${whiteDecoded.height}, black=${blackDecoded.width}x${blackDecoded.height}.`,
      );
    }

    const targetWidth = Math.min(whiteDecoded.width, blackDecoded.width);
    const targetHeight = Math.min(whiteDecoded.height, blackDecoded.height);

    if (whiteDecoded.width !== targetWidth || whiteDecoded.height !== targetHeight) {
      whiteDecoded = {
        pixels: await resizeToMatch(
          whiteDecoded.pixels,
          whiteDecoded.width,
          whiteDecoded.height,
          targetWidth,
          targetHeight,
        ),
        width: targetWidth,
        height: targetHeight,
      };
    }

    if (blackDecoded.width !== targetWidth || blackDecoded.height !== targetHeight) {
      blackDecoded = {
        pixels: await resizeToMatch(
          blackDecoded.pixels,
          blackDecoded.width,
          blackDecoded.height,
          targetWidth,
          targetHeight,
        ),
        width: targetWidth,
        height: targetHeight,
      };
    }
  }

  const matteOutput = differenceMatte({
    whiteBg: whiteDecoded.pixels,
    blackBg: blackDecoded.pixels,
    width: whiteDecoded.width,
    height: whiteDecoded.height,
  });

  return {
    matteOutput,
    whiteDecoded,
    blackDecoded,
    dimensionMismatch: hadDimensionMismatch,
  };
}

const generationIdActionArgs = {
  generationId: v.id("generations"),
};

export const generateWhiteBackground = internalAction({
  args: generationIdActionArgs,
  returns: v.null(),
  handler: async (ctx, args) => {
    const generation = await getGeneration(ctx, args.generationId);
    if (!isGenerationRunStageRunnable(generation, "white_background")) {
      return null;
    }

    const retryCount = generation.whiteBgRetryCount ?? 0;
    await ctx.runMutation(internal.generations.markStageAttemptStarted, {
      generationId: args.generationId,
      stage: "white_background",
    });
    await updateStatus(ctx, args.generationId, "white_background", getGenerationRunRetryStatusMessage("white_background", retryCount));

    try {
      const runtimeConfig = readGeminiRuntimeConfigFromEnv();
      const referenceImages = await loadStoredImages(ctx, generation.referenceStorageIds ?? []);
      const session = createChatSession(runtimeConfig, { aspectRatio: generation.aspectRatio });
      const retryInstruction = retryCount > 0 ? generation.whiteBgRetryInstruction : undefined;
      const prompt = referenceImages.length > 0
        ? (retryCount === 0 ? buildWhiteBgPromptWithReference(generation.prompt) : buildWhiteBgRetryPromptWithReference(generation.prompt, retryInstruction))
        : (retryCount === 0 ? buildWhiteBgPrompt(generation.prompt) : buildWhiteBgRetryPrompt(generation.prompt, retryInstruction));

      let result;
      let rawError: string | undefined;
      try {
        result = referenceImages.length > 0
          ? await session.sendMessageWithImages(prompt, referenceImages)
          : await session.sendMessage(prompt);
      } catch (err) {
        rawError = err instanceof Error ? err.message : String(err);
        const repair = buildRepairInstruction("white_background", undefined, rawError);
        throw Object.assign(err instanceof Error ? err : new Error(rawError), { retryInstruction: repair });
      }

      const decoded = await decodeImage(result.imageBase64, result.mimeType);
      const validation = validateWhiteBackground(decoded.pixels, decoded.width, decoded.height);
      if (!validation.valid) {
        const repair = buildRepairInstruction("white_background", validation);
        throwStageValidationFailure("white_background", validation.reason, repair);
      }

      const whiteBgStorageId = await storeGeneratedImage(ctx, result);
      await ctx.runMutation(internal.generations.recordWhiteBackgroundSuccess, {
        generationId: args.generationId,
        retryCount,
        whiteBgStorageId,
      });
    } catch (error) {
      const repair = (error as { retryInstruction?: string })?.retryInstruction;
      await handleStageFailure(ctx, args.generationId, "white_background", retryCount, error, repair);
    }

    return null;
  },
});

export const generateBlackBackground = internalAction({
  args: generationIdActionArgs,
  returns: v.null(),
  handler: async (ctx, args) => {
    const generation = await getGeneration(ctx, args.generationId);
    if (!isGenerationRunStageRunnable(generation, "black_background")) {
      return null;
    }

    if (!generation.whiteBgStorageId) {
      await ctx.runMutation(internal.generations.failGeneration, {
        generationId: args.generationId,
        error: createUserFacingFailureMessage(),
        internalError: "Missing white background image before black background generation",
      });
      return null;
    }

    const retryCount = generation.blackBgRetryCount ?? 0;
    await ctx.runMutation(internal.generations.markStageAttemptStarted, {
      generationId: args.generationId,
      stage: "black_background",
    });
    await updateStatus(ctx, args.generationId, "black_background", getGenerationRunRetryStatusMessage("black_background", retryCount));

    try {
      const runtimeConfig = readGeminiRuntimeConfigFromEnv();
      const session = createChatSession(runtimeConfig, { aspectRatio: generation.aspectRatio });
      const whiteBgImage = await loadStoredImage(ctx, generation.whiteBgStorageId!);
      const retryInstruction = generation.blackBgRetryInstruction;
      const prompt = buildBlackBackgroundStagePrompt(retryInstruction);

      let result;
      let rawError: string | undefined;
      try {
        result = await session.sendMessageWithImages(prompt, [whiteBgImage]);
      } catch (err) {
        rawError = err instanceof Error ? err.message : String(err);
        const repair = buildRepairInstruction("black_background", undefined, rawError);
        throw Object.assign(err instanceof Error ? err : new Error(rawError), { retryInstruction: repair });
      }

      const decoded = await decodeImage(result.imageBase64, result.mimeType);
      const validation = validateBlackBackground(decoded.pixels, decoded.width, decoded.height);
      if (!validation.valid) {
        const repair = buildRepairInstruction("black_background", validation);
        throwStageValidationFailure("black_background", validation.reason, repair);
      }

      const blackBgStorageId = await storeGeneratedImage(ctx, result);
      await ctx.runMutation(internal.generations.recordBlackBackgroundSuccess, {
        blackBgStorageId,
        generationId: args.generationId,
        retryCount,
      });
    } catch (error) {
      const repair = (error as { retryInstruction?: string })?.retryInstruction;
      await handleStageFailure(ctx, args.generationId, "black_background", retryCount, error, repair);
    }

    return null;
  },
});

export const finalizeGeneration = internalAction({
  args: generationIdActionArgs,
  returns: v.null(),
  handler: async (ctx, args) => {
    const generation = await getGeneration(ctx, args.generationId);
    if (!isGenerationRunStageRunnable(generation, "finalizing")) {
      return null;
    }

    if (!generation.whiteBgStorageId || !generation.blackBgStorageId) {
      await ctx.runMutation(internal.generations.failGeneration, {
        generationId: args.generationId,
        error: createUserFacingFailureMessage(),
        internalError: "Missing background images before finalizing generation",
      });
      return null;
    }

    const retryCount = generation.finalizeRetryCount ?? 0;
    await ctx.runMutation(internal.generations.markStageAttemptStarted, {
      generationId: args.generationId,
      stage: "finalizing",
    });
    await updateStatus(ctx, args.generationId, "finalizing", getGenerationRunRetryStatusMessage("finalizing", retryCount));

    try {
      const result = await finalizePipeline(ctx, generation);
      await updateStatus(ctx, args.generationId, "finalizing", "Verifying transparency…");
      const transparentQa = analyzeTransparentOutput({
        whiteBg: result.whiteDecoded.pixels,
        blackBg: result.blackDecoded.pixels,
        matte: result.matteOutput,
        width: result.matteOutput.width,
        height: result.matteOutput.height,
        prompt: generation.prompt,
        dimensionMismatch: result.dimensionMismatch,
      });

      if (transparentQa.decision !== "pass") {
        await handleTransparentQaFailure(ctx, generation, transparentQa);
        return null;
      }

      await updateStatus(ctx, args.generationId, "finalizing", "Preparing final image…");
      const [finalPng, whiteBgPng, blackBgPng] = await Promise.all([
        encodePng(result.matteOutput.pixels, result.matteOutput.width, result.matteOutput.height),
        encodePng(result.whiteDecoded.pixels, result.whiteDecoded.width, result.whiteDecoded.height),
        encodePng(result.blackDecoded.pixels, result.blackDecoded.width, result.blackDecoded.height),
      ]);

      const whiteBgBlob = new Blob([new Uint8Array(whiteBgPng)], { type: "image/png" });
      const whiteBgStorageId = await ctx.storage.store(whiteBgBlob);
      const blackBgBlob = new Blob([new Uint8Array(blackBgPng)], { type: "image/png" });
      const blackBgStorageId = await ctx.storage.store(blackBgBlob);
      const resultBlob = new Blob([new Uint8Array(finalPng)], { type: "image/png" });
      const resultStorageId = await ctx.storage.store(resultBlob);

      await updateStatus(ctx, args.generationId, "finalizing", "Optimizing for download…");
      const optimizedPng = await optimizeForWeb(finalPng);
      const optimizedBlob = new Blob([new Uint8Array(optimizedPng)], { type: "image/png" });
      const optimizedStorageId = await ctx.storage.store(optimizedBlob);

      await ctx.runMutation(internal.generations.completeGeneration, {
        blackBgStorageId,
        dimensionMismatch: result.dimensionMismatch,
        generationId: args.generationId,
        generationTimeMs: Date.now() - generation.createdAt,
        optimizedStorageId,
        resultStorageId,
        retryCount: generation.retryCount ?? 0,
        transparentQa,
        whiteBgStorageId,
      });
    } catch (error) {
      if (shouldRecoverFinalizingWithFullRerender(error)) {
        await scheduleFullRerenderOrFail(ctx, generation, {
          internalError: error.message,
          reasonCodes: ["dimension_mismatch"],
        });
        return null;
      }
      await handleStageFailure(ctx, args.generationId, "finalizing", retryCount, error);
    }

    return null;
  },
});
