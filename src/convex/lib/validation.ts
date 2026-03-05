import { GENERATION_CONFIG } from "./config.js";

export interface ValidationResult {
  valid: boolean;
  reason?: string;
  diagnostics?: {
    cornerMeans: [number, number, number, number];
    cornerStdDevs: [number, number, number, number];
  };
}

/**
 * Sample a square patch of pixels and compute mean and standard deviation
 * of channel values (averaged across R, G, B).
 */
function samplePatch(
  pixels: Uint8ClampedArray,
  width: number,
  startX: number,
  startY: number,
  patchSize: number,
  stride: number,
): { mean: number; stdDev: number } {
  let sum = 0;
  let sumSq = 0;
  let count = 0;

  for (let y = startY; y < startY + patchSize; y++) {
    for (let x = startX; x < startX + patchSize; x++) {
      const idx = (y * width + x) * stride;
      // Average across R, G, B channels
      const avg = (pixels[idx] + pixels[idx + 1] + pixels[idx + 2]) / 3;
      sum += avg;
      sumSq += avg * avg;
      count++;
    }
  }

  const mean = sum / count;
  const variance = sumSq / count - mean * mean;
  const stdDev = Math.sqrt(Math.max(0, variance));

  return { mean, stdDev };
}

/**
 * Get corner patch positions for validation.
 * Returns [topLeft, topRight, bottomLeft, bottomRight] start coordinates.
 */
function getCornerPositions(
  width: number,
  height: number,
  patchSize: number,
): Array<{ x: number; y: number }> {
  return [
    { x: 0, y: 0 },                                    // top-left
    { x: width - patchSize, y: 0 },                     // top-right
    { x: 0, y: height - patchSize },                    // bottom-left
    { x: width - patchSize, y: height - patchSize },    // bottom-right
  ];
}

function validateBackground(
  pixels: Uint8ClampedArray,
  width: number,
  height: number,
  minMean: number | null,
  maxMean: number | null,
  label: string,
): ValidationResult {
  const patchSize = GENERATION_CONFIG.cornerPatchSize;
  const maxStdDev = GENERATION_CONFIG.bgMaxStdDev;

  // Determine stride
  const totalValues = pixels.length;
  const pixelCount = width * height;
  const stride = totalValues === pixelCount * 4 ? 4 : 3;

  // Ensure image is large enough for patches
  if (width < patchSize || height < patchSize) {
    return {
      valid: false,
      reason: `Image too small for ${patchSize}x${patchSize} corner patches (${width}x${height})`,
    };
  }

  const corners = getCornerPositions(width, height, patchSize);
  const cornerMeans: [number, number, number, number] = [0, 0, 0, 0];
  const cornerStdDevs: [number, number, number, number] = [0, 0, 0, 0];

  for (let i = 0; i < 4; i++) {
    const { mean, stdDev } = samplePatch(
      pixels, width, corners[i].x, corners[i].y, patchSize, stride,
    );
    cornerMeans[i] = mean;
    cornerStdDevs[i] = stdDev;

    if (minMean !== null && mean < minMean) {
      return {
        valid: false,
        reason: `${label} corner ${i} mean ${mean.toFixed(1)} below threshold ${minMean}`,
        diagnostics: { cornerMeans, cornerStdDevs },
      };
    }

    if (maxMean !== null && mean > maxMean) {
      return {
        valid: false,
        reason: `${label} corner ${i} mean ${mean.toFixed(1)} above threshold ${maxMean}`,
        diagnostics: { cornerMeans, cornerStdDevs },
      };
    }

    if (stdDev > maxStdDev) {
      return {
        valid: false,
        reason: `${label} corner ${i} stddev ${stdDev.toFixed(1)} exceeds threshold ${maxStdDev}`,
        diagnostics: { cornerMeans, cornerStdDevs },
      };
    }
  }

  return {
    valid: true,
    diagnostics: { cornerMeans, cornerStdDevs },
  };
}

export function validateWhiteBackground(
  pixels: Uint8ClampedArray,
  width: number,
  height: number,
): ValidationResult {
  return validateBackground(
    pixels, width, height,
    GENERATION_CONFIG.whiteBgMinMean, null,
    "White background",
  );
}

export function validateBlackBackground(
  pixels: Uint8ClampedArray,
  width: number,
  height: number,
): ValidationResult {
  return validateBackground(
    pixels, width, height,
    null, GENERATION_CONFIG.blackBgMaxMean,
    "Black background",
  );
}

export function validateDimensionMatch(
  w1: number,
  h1: number,
  w2: number,
  h2: number,
): boolean {
  return w1 === w2 && h1 === h2;
}
