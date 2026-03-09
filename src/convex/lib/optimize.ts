"use node";

import sharp from "sharp";
import { GENERATION_CONFIG } from "./config.js";

/**
 * Resize + palette-quantize a raw matte PNG buffer for web delivery.
 * Pure function: buffer in, buffer out. No Convex context, no side effects.
 */
export async function optimizeForWeb(pngBuffer: Buffer): Promise<Buffer> {
  const {
    optimizedMaxDimension,
    optimizedPngQuality,
    optimizedPngEffort,
    optimizedPngColours,
    optimizedPngDither,
  } = GENERATION_CONFIG;

  return sharp(pngBuffer)
    .resize(optimizedMaxDimension, optimizedMaxDimension, {
      fit: "inside",
      withoutEnlargement: true,
    })
    .png({
      palette: true,
      quality: optimizedPngQuality,
      effort: optimizedPngEffort,
      colours: optimizedPngColours,
      dither: optimizedPngDither,
    })
    .toBuffer();
}
