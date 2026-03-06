"use node";

import { v } from "convex/values";
import { internalAction } from "./_generated/server.js";
import { internal } from "./_generated/api.js";
import { PNG } from "pngjs";
import { GENERATION_CONFIG } from "./lib/config.js";
import {
  createChatSession,
  type GeminiImageResult,
} from "./lib/gemini.js";
import {
  buildWhiteBgPrompt,
  buildBlackBgPrompt,
  buildWhiteBgRetryPrompt,
  buildBlackBgRetryPrompt,
} from "./lib/prompts.js";
import {
  validateWhiteBackground,
  validateBlackBackground,
  validateDimensionMatch,
} from "./lib/validation.js";
import { differenceMatte } from "./lib/matte.js";

function decodePng(base64: string): { pixels: Uint8ClampedArray; width: number; height: number } {
  const buffer = Buffer.from(base64, "base64");
  const png = PNG.sync.read(buffer);
  return {
    pixels: new Uint8ClampedArray(png.data),
    width: png.width,
    height: png.height,
  };
}

function encodePng(
  pixels: Uint8ClampedArray,
  width: number,
  height: number,
): Buffer {
  const png = new PNG({ width, height });
  png.data = Buffer.from(pixels);
  return PNG.sync.write(png);
}

function resizeToMatch(
  pixels: Uint8ClampedArray,
  srcWidth: number,
  srcHeight: number,
  dstWidth: number,
  dstHeight: number,
): Uint8ClampedArray {
  // Lanczos-like resize via bilinear interpolation (pure JS fallback)
  // For production quality, sharp would be preferred, but this handles
  // the typical case of minor dimension mismatches (a few pixels off)
  const output = new Uint8ClampedArray(dstWidth * dstHeight * 4);
  const xRatio = srcWidth / dstWidth;
  const yRatio = srcHeight / dstHeight;

  for (let y = 0; y < dstHeight; y++) {
    for (let x = 0; x < dstWidth; x++) {
      const srcX = x * xRatio;
      const srcY = y * yRatio;
      const x0 = Math.floor(srcX);
      const y0 = Math.floor(srcY);
      const x1 = Math.min(x0 + 1, srcWidth - 1);
      const y1 = Math.min(y0 + 1, srcHeight - 1);
      const xFrac = srcX - x0;
      const yFrac = srcY - y0;

      const dstIdx = (y * dstWidth + x) * 4;
      for (let c = 0; c < 4; c++) {
        const topLeft = pixels[(y0 * srcWidth + x0) * 4 + c];
        const topRight = pixels[(y0 * srcWidth + x1) * 4 + c];
        const bottomLeft = pixels[(y1 * srcWidth + x0) * 4 + c];
        const bottomRight = pixels[(y1 * srcWidth + x1) * 4 + c];

        const top = topLeft + (topRight - topLeft) * xFrac;
        const bottom = bottomLeft + (bottomRight - bottomLeft) * xFrac;
        output[dstIdx + c] = Math.round(top + (bottom - top) * yFrac);
      }
    }
  }
  return output;
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
  },
  handler: async (ctx, args) => {
    const startTime = Date.now();
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      throw new Error("GEMINI_API_KEY environment variable not set");
    }

    // Look up the generation to get userId for potential refund
    const generation = await ctx.runQuery(internal.generations.getById, {
      generationId: args.generationId,
    });
    if (!generation) {
      throw new Error("Generation record not found");
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
          await updateStatus(`Retrying (attempt ${attempt + 1})…`);
          await sleep(
            GENERATION_CONFIG.retryBaseDelayMs * Math.pow(2, attempt - 1),
          );
        }

        try {
          const result = await executeGenerationPipeline(
            ctx, apiKey, args.prompt, updateStatus,
          );
          dimensionMismatch = result.dimensionMismatch;
          await updateStatus("Storing result…");

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

          await ctx.runMutation(internal.generations.completeGeneration, {
            generationId: args.generationId,
            resultStorageId,
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

      const errorMessage =
        e instanceof Error ? e.message : "Unknown error occurred";
      await ctx.runMutation(internal.generations.failGeneration, {
        generationId: args.generationId,
        error: errorMessage,
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
  apiKey: string,
  prompt: string,
  updateStatus: (message: string) => Promise<void>,
): Promise<PipelineResult> {
  const session = createChatSession(apiKey);

  // === Pass 1: White background ===
  await updateStatus("Generating white background pass…");
  let whiteBgResult: GeminiImageResult | null = null;
  for (let retry = 0; retry <= GENERATION_CONFIG.maxRetriesPerPass; retry++) {
    if (retry > 0) {
      await updateStatus(`White background pass (retry ${retry})…`);
    }
    const whiteBgPrompt =
      retry === 0
        ? buildWhiteBgPrompt(prompt)
        : buildWhiteBgRetryPrompt(prompt);

    const result = await session.sendMessage(whiteBgPrompt);

    // Decode and validate
    const decoded = decodePng(result.imageBase64);
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
  await updateStatus("Generating black background pass…");
  let blackBgResult: GeminiImageResult | null = null;
  for (let retry = 0; retry <= GENERATION_CONFIG.maxRetriesPerPass; retry++) {
    if (retry > 0) {
      await updateStatus(`Black background pass (retry ${retry})…`);
    }
    const blackBgPrompt =
      retry === 0 ? buildBlackBgPrompt() : buildBlackBgRetryPrompt();

    // Send with white-bg image as reference for stronger fidelity
    const result = await session.sendMessageWithImage(
      blackBgPrompt,
      whiteBgResult,
    );

    // Decode and validate
    const decoded = decodePng(result.imageBase64);
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
  await updateStatus("Processing transparency matte…");
  let white = decodePng(whiteBgResult.imageBase64);
  let black = decodePng(blackBgResult.imageBase64);

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
        pixels: resizeToMatch(
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
        pixels: resizeToMatch(
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
  await updateStatus("Encoding final image…");
  const finalPng = encodePng(matteOutput.pixels, matteOutput.width, matteOutput.height);

  // Re-encode intermediates for storage
  const whiteBgPng = encodePng(white.pixels, white.width, white.height);
  const blackBgPng = encodePng(black.pixels, black.width, black.height);

  return {
    finalPng,
    whiteBgPng,
    blackBgPng,
    dimensionMismatch: hadDimensionMismatch,
  };
}
