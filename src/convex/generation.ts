"use node";

import { v } from "convex/values";
import { internalAction } from "./_generated/server.js";
import { internal } from "./_generated/api.js";
import sharp from "sharp";
import { GENERATION_CONFIG } from "./lib/config.js";
import {
  createChatSession,
  type GeminiImageResult,
  readGeminiRuntimeConfigFromEnv,
} from "./lib/gemini.js";
import {
  buildWhiteBgPrompt,
  buildBlackBgPrompt,
  buildWhiteBgRetryPrompt,
  buildBlackBgRetryPrompt,
  buildWhiteBgPromptWithReference,
  buildWhiteBgRetryPromptWithReference,
} from "./lib/prompts.js";
import {
  validateWhiteBackground,
  validateBlackBackground,
  validateDimensionMatch,
} from "./lib/validation.js";
import { differenceMatte } from "./lib/matte.js";
import { optimizeForWeb } from "./lib/optimize.js";

/**
 * Decode any image format Gemini returns (PNG, JPEG, WebP, etc.) into raw RGBA
 * pixels via sharp. This eliminates the pngjs "unrecognized content at end of
 * stream" error class entirely — sharp handles trailing bytes, format
 * mismatches, and malformed chunks that pngjs cannot.
 */
async function decodeImage(
  base64: string,
  mimeType?: string,
): Promise<{ pixels: Uint8ClampedArray; width: number; height: number }> {
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

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
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

/**
 * Internal worker action scheduled by the requestGeneration mutation.
 * The generation row and credit deduction already exist when this runs.
 */
export const generateWorker = internalAction({
  args: {
    generationId: v.id("generations"),
    prompt: v.string(),
    referenceStorageIds: v.optional(v.array(v.id("_storage"))),
    aspectRatio: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const startTime = Date.now();
    const runtimeConfig = readGeminiRuntimeConfigFromEnv();

    // Look up the generation to get userId for potential refund
    const generation = await ctx.runQuery(internal.generations.getById, {
      generationId: args.generationId,
    });
    if (!generation) {
      throw new Error("Generation record not found");
    }

    // Load reference images if provided
    const referenceImages: GeminiImageResult[] = [];
    if (args.referenceStorageIds && args.referenceStorageIds.length > 0) {
      for (const storageId of args.referenceStorageIds) {
        const refBlob = await ctx.storage.get(storageId);
        if (!refBlob) {
          throw new Error("Reference image not found in storage");
        }
        const refBuffer = Buffer.from(await refBlob.arrayBuffer());
        const refBase64 = refBuffer.toString("base64");
        const mimeType = refBlob.type === "image/jpeg" ? "image/jpeg" as const : "image/png" as const;
        referenceImages.push({ imageBase64: refBase64, mimeType });
      }
    }

    let retryCount = 0;
    let dimensionMismatch = false;

    async function updateStatus(message: string) {
      await ctx.runMutation(internal.generations.updateStatusMessage, {
        generationId: args.generationId,
        statusMessage: message,
      });
    }

    try {
      for (let attempt = 0; attempt <= GENERATION_CONFIG.maxRetriesTotal; attempt++) {
        if (attempt > 0) {
          retryCount++;
          await updateStatus(`Still working on it (attempt ${attempt + 1})…`);
          await sleep(
            GENERATION_CONFIG.retryBaseDelayMs * Math.pow(2, attempt - 1),
          );
        }

        try {
          const result = await executeGenerationPipeline(
            ctx, runtimeConfig, args.prompt, updateStatus, referenceImages, args.aspectRatio,
          );
          dimensionMismatch = result.dimensionMismatch;
          await updateStatus("Saving your image…");

          let whiteBgStorageId;
          let blackBgStorageId;

          if (result.whiteBgPng) {
            const whiteBlob = new Blob([new Uint8Array(result.whiteBgPng)], { type: "image/png" });
            whiteBgStorageId = await ctx.storage.store(whiteBlob);
          }
          if (result.blackBgPng) {
            const blackBlob = new Blob([new Uint8Array(result.blackBgPng)], { type: "image/png" });
            blackBgStorageId = await ctx.storage.store(blackBlob);
          }

          const resultBlob = new Blob([new Uint8Array(result.finalPng)], { type: "image/png" });
          const resultStorageId = await ctx.storage.store(resultBlob);

          await updateStatus("Optimizing for download…");
          const optimizedPng = await optimizeForWeb(result.finalPng);
          const optimizedBlob = new Blob([new Uint8Array(optimizedPng)], { type: "image/png" });
          const optimizedStorageId = await ctx.storage.store(optimizedBlob);

          await ctx.runMutation(internal.generations.completeGeneration, {
            generationId: args.generationId,
            resultStorageId,
            optimizedStorageId,
            whiteBgStorageId,
            blackBgStorageId,
            generationTimeMs: Date.now() - startTime,
            retryCount,
            dimensionMismatch,
          });

          return;
        } catch (e) {
          if (attempt === GENERATION_CONFIG.maxRetriesTotal) {
            throw e;
          }
        }
      }

      throw new Error("Generation failed after all retries");
    } catch (e) {
      // Refund credits
      await ctx.runMutation(internal.generations.refundCredits, {
        userId: generation.userId,
        amount: generation.creditsCost,
      });

      const rawError =
        e instanceof Error ? e.message : "Unknown error occurred";
      console.error(`[generateWorker] generationId=${args.generationId} error=${rawError}`);
      const userMessage = "Something went wrong generating your image. Your credit has been refunded — please try again.";
      await ctx.runMutation(internal.generations.failGeneration, {
        generationId: args.generationId,
        error: userMessage,
      });
    }
  },
});

interface PipelineResult {
  finalPng: Buffer;
  whiteBgPng: Buffer | null;
  blackBgPng: Buffer | null;
  dimensionMismatch: boolean;
}

async function executeGenerationPipeline(
  ctx: { storage: { store: (blob: Blob) => Promise<string> } },
  runtimeConfig: ReturnType<typeof readGeminiRuntimeConfigFromEnv>,
  prompt: string,
  updateStatus: (message: string) => Promise<void>,
  referenceImages: GeminiImageResult[],
  aspectRatio?: string,
): Promise<PipelineResult> {
  const session = createChatSession(runtimeConfig, { aspectRatio });
  const hasReferences = referenceImages.length > 0;

  // === Pass 1: White background ===
  await updateStatus("Creating your image…");
  let whiteBgResult: GeminiImageResult | null = null;
  for (let retry = 0; retry <= GENERATION_CONFIG.maxRetriesPerPass; retry++) {
    if (retry > 0) {
      await updateStatus(`Refining details…`);
    }

    let result: GeminiImageResult;
    if (hasReferences) {
      const whiteBgPrompt =
        retry === 0
          ? buildWhiteBgPromptWithReference(prompt)
          : buildWhiteBgRetryPromptWithReference(prompt);
      result = await session.sendMessageWithImages(whiteBgPrompt, referenceImages);
    } else {
      const whiteBgPrompt =
        retry === 0
          ? buildWhiteBgPrompt(prompt)
          : buildWhiteBgRetryPrompt(prompt);
      result = await session.sendMessage(whiteBgPrompt);
    }

    // Decode and validate
    const decoded = await decodeImage(result.imageBase64, result.mimeType);
    const validation = validateWhiteBackground(
      decoded.pixels,
      decoded.width,
      decoded.height,
    );

    if (validation.valid) {
      whiteBgResult = result;
      break;
    }

    if (retry === GENERATION_CONFIG.maxRetriesPerPass) {
      throw new Error(
        `White background validation failed after ${retry + 1} attempts: ${validation.reason}`,
      );
    }
  }

  if (!whiteBgResult) {
    throw new Error("Failed to generate white background image");
  }

  // === Pass 2: Black background (same chat session) ===
  await updateStatus("Enhancing quality…");
  let blackBgResult: GeminiImageResult | null = null;
  for (let retry = 0; retry <= GENERATION_CONFIG.maxRetriesPerPass; retry++) {
    if (retry > 0) {
      await updateStatus(`Fine-tuning output…`);
    }
    const blackBgPrompt =
      retry === 0 ? buildBlackBgPrompt() : buildBlackBgRetryPrompt();

    // Send with white-bg image as reference for stronger fidelity
    const result = await session.sendMessageWithImages(
      blackBgPrompt,
      [whiteBgResult],
    );

    // Decode and validate
    const decoded = await decodeImage(result.imageBase64, result.mimeType);
    const validation = validateBlackBackground(
      decoded.pixels,
      decoded.width,
      decoded.height,
    );

    if (validation.valid) {
      blackBgResult = result;
      break;
    }

    if (retry === GENERATION_CONFIG.maxRetriesPerPass) {
      throw new Error(
        `Black background validation failed after ${retry + 1} attempts: ${validation.reason}`,
      );
    }
  }

  if (!blackBgResult) {
    throw new Error("Failed to generate black background image");
  }

  // === Decode both for matte ===
  await updateStatus("Extracting transparency…");
  let white = await decodeImage(whiteBgResult.imageBase64, whiteBgResult.mimeType);
  let black = await decodeImage(blackBgResult.imageBase64, blackBgResult.mimeType);

  // === Dimension check + resize ===
  let hadDimensionMismatch = false;
  if (!validateDimensionMatch(white.width, white.height, black.width, black.height)) {
    hadDimensionMismatch = true;

    // Check if aspect ratios fundamentally differ
    if (!aspectRatioMatches(white.width, white.height, black.width, black.height)) {
      throw new Error(
        `Aspect ratio mismatch: white=${white.width}x${white.height}, black=${black.width}x${black.height}. Retry required.`,
      );
    }

    // Resize larger to match smaller
    const targetWidth = Math.min(white.width, black.width);
    const targetHeight = Math.min(white.height, black.height);

    if (white.width !== targetWidth || white.height !== targetHeight) {
      white = {
        pixels: await resizeToMatch(
          white.pixels,
          white.width,
          white.height,
          targetWidth,
          targetHeight,
        ),
        width: targetWidth,
        height: targetHeight,
      };
    }

    if (black.width !== targetWidth || black.height !== targetHeight) {
      black = {
        pixels: await resizeToMatch(
          black.pixels,
          black.width,
          black.height,
          targetWidth,
          targetHeight,
        ),
        width: targetWidth,
        height: targetHeight,
      };
    }
  }

  // === Difference matte ===
  const matteOutput = differenceMatte({
    whiteBg: white.pixels,
    blackBg: black.pixels,
    width: white.width,
    height: white.height,
  });

  // === Encode final RGBA PNG ===
  await updateStatus("Preparing final image…");
  const finalPng = await encodePng(matteOutput.pixels, matteOutput.width, matteOutput.height);

  // Re-encode intermediates for storage
  const whiteBgPng = await encodePng(white.pixels, white.width, white.height);
  const blackBgPng = await encodePng(black.pixels, black.width, black.height);

  return {
    finalPng,
    whiteBgPng,
    blackBgPng,
    dimensionMismatch: hadDimensionMismatch,
  };
}
