import { GENERATION_CONFIG } from "./config.js";
import type { MatteOutput } from "./matte.js";

export const TRANSPARENT_QA_VERSION = "deterministic_v1" as const;

export const TRANSPARENT_QA_DECISIONS = [
  "pass",
  "retry_black",
  "retry_white_and_black",
  "review",
] as const;

export type TransparentQaDecision = (typeof TRANSPARENT_QA_DECISIONS)[number];

export const TRANSPARENT_QA_REASON_CODES = [
  "white_recomposition_residual_high",
  "black_recomposition_residual_high",
  "channel_disagreement_high",
  "alpha_residual_high",
  "alpha_presence_low",
  "border_transparency_ratio_low",
  "dimension_mismatch",
  "boundary_error_rate_high",
  "external_spill_high",
  "halo_tail_high",
  "fragment_noise_high",
  "topology_volatility_high",
  "expected_hole_missing",
] as const;

export type TransparentQaReasonCode = (typeof TRANSPARENT_QA_REASON_CODES)[number];

export interface TransparentQaTopologySample {
  threshold: number;
  foregroundAreaRatio: number;
  foregroundComponentCount: number;
  holeCount: number;
  holeAreaRatio: number;
}

export interface TransparentQaMetrics {
  alphaPresence: number;
  transparentPixelRatio: number;
  borderTransparencyRatio: number;
  whiteRecompositionResidual: number;
  blackRecompositionResidual: number;
  recompositionResidual: number;
  channelDisagreement: number;
  alphaResidual: number;
  boundaryErrorRate: number;
  externalSpill: number;
  haloTail: number;
  persistentHoleCount: number;
  persistentHoleAreaRatio: number;
  fragileHoleCount: number;
  topologyVolatility: number;
  fragmentNoise: number;
  dimensionMismatchPenalty: number;
  holeKeywordMatched: boolean;
  holeKeywordCount: number;
  topologySamples: TransparentQaTopologySample[];
}

export const TRANSPARENT_QA_NUMERIC_METRIC_KEYS = [
  "alphaPresence",
  "transparentPixelRatio",
  "borderTransparencyRatio",
  "whiteRecompositionResidual",
  "blackRecompositionResidual",
  "recompositionResidual",
  "channelDisagreement",
  "alphaResidual",
  "boundaryErrorRate",
  "externalSpill",
  "haloTail",
  "persistentHoleCount",
  "persistentHoleAreaRatio",
  "fragileHoleCount",
  "topologyVolatility",
  "fragmentNoise",
  "dimensionMismatchPenalty",
  "holeKeywordCount",
] as const;

export type TransparentQaNumericMetricKey =
  (typeof TRANSPARENT_QA_NUMERIC_METRIC_KEYS)[number];

export interface TransparentQaResult {
  version: typeof TRANSPARENT_QA_VERSION;
  decision: TransparentQaDecision;
  reasonCodes: TransparentQaReasonCode[];
  metrics: TransparentQaMetrics;
}

export interface AnalyzeTransparentOutputArgs {
  whiteBg: Uint8ClampedArray;
  blackBg: Uint8ClampedArray;
  matte: MatteOutput;
  width: number;
  height: number;
  prompt: string;
  dimensionMismatch: boolean;
}

export interface TransparentQaRetryPlan {
  retryInstruction?: string;
  downstreamRetryInstruction?: string;
}

interface RecompositionMetrics {
  alphaPresence: number;
  transparentPixelRatio: number;
  borderTransparencyRatio: number;
  whiteRecompositionResidual: number;
  blackRecompositionResidual: number;
  recompositionResidual: number;
  channelDisagreement: number;
  alphaResidual: number;
}

interface TopologyAnalysis {
  persistentHoleCount: number;
  persistentHoleAreaRatio: number;
  fragileHoleCount: number;
  topologyVolatility: number;
  fragmentNoise: number;
  topologySamples: TransparentQaTopologySample[];
}

interface ShellAnalysis {
  boundaryErrorRate: number;
  externalSpill: number;
  haloTail: number;
}

type Connectivity = 4 | 8;

const FOUR_CONNECTED_NEIGHBORS = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
] as const;

const EIGHT_CONNECTED_NEIGHBORS = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
  [1, 1],
  [-1, -1],
  [1, -1],
  [-1, 1],
] as const;

function clampUnit(value: number): number {
  if (!Number.isFinite(value)) {
    return 0;
  }
  return Math.max(0, Math.min(1, value));
}

function escapeRegexLiteral(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function getNeighbors(connectivity: Connectivity) {
  return connectivity === 4 ? FOUR_CONNECTED_NEIGHBORS : EIGHT_CONNECTED_NEIGHBORS;
}

function getStride(pixels: Uint8ClampedArray, width: number, height: number): number {
  const pixelCount = width * height;
  return pixels.length === pixelCount * 4 ? 4 : 3;
}

function buildAlphaArray(pixels: Uint8ClampedArray, width: number, height: number): Uint8ClampedArray {
  const alpha = new Uint8ClampedArray(width * height);
  const stride = getStride(pixels, width, height);
  if (stride === 4) {
    for (let index = 0; index < alpha.length; index++) {
      alpha[index] = pixels[index * 4 + 3];
    }
    return alpha;
  }

  alpha.fill(255);
  return alpha;
}

function createBinaryMask(alpha: Uint8ClampedArray, threshold: number): Uint8Array {
  const mask = new Uint8Array(alpha.length);
  for (let index = 0; index < alpha.length; index++) {
    if (alpha[index] >= threshold) {
      mask[index] = 1;
    }
  }
  return mask;
}

function createInverseMask(mask: Uint8Array): Uint8Array {
  const inverse = new Uint8Array(mask.length);
  for (let index = 0; index < mask.length; index++) {
    inverse[index] = mask[index] === 0 ? 1 : 0;
  }
  return inverse;
}

function floodConnectedRegion(
  mask: Uint8Array,
  visited: Uint8Array,
  queue: Int32Array,
  width: number,
  height: number,
  neighbors: readonly (readonly [number, number])[],
  initialTail: number,
): number {
  let head = 0;
  let tail = initialTail;

  while (head < tail) {
    const current = queue[head++];
    const x = current % width;
    const y = (current - x) / width;

    for (const [offsetX, offsetY] of neighbors) {
      const nextX = x + offsetX;
      const nextY = y + offsetY;
      if (nextX < 0 || nextX >= width || nextY < 0 || nextY >= height) {
        continue;
      }

      const nextIndex = nextY * width + nextX;
      if (mask[nextIndex] === 1 && visited[nextIndex] === 0) {
        visited[nextIndex] = 1;
        queue[tail++] = nextIndex;
      }
    }
  }

  return tail;
}

function forEachConnectedRegion(
  mask: Uint8Array,
  width: number,
  height: number,
  connectivity: Connectivity,
  visitRegion: (componentSize: number, queue: Int32Array) => void,
): void {
  const visited = new Uint8Array(mask.length);
  const queue = new Int32Array(mask.length);
  const neighbors = getNeighbors(connectivity);

  for (let index = 0; index < mask.length; index++) {
    if (mask[index] === 0 || visited[index] === 1) {
      continue;
    }

    visited[index] = 1;
    queue[0] = index;
    const componentSize = floodConnectedRegion(mask, visited, queue, width, height, neighbors, 1);
    visitRegion(componentSize, queue);
  }
}

function floodBorderConnected(mask: Uint8Array, width: number, height: number, connectivity: Connectivity): Uint8Array {
  const visited = new Uint8Array(mask.length);
  const queue = new Int32Array(mask.length);
  let tail = 0;
  const neighbors = getNeighbors(connectivity);

  const enqueue = (index: number) => {
    if (mask[index] === 0 || visited[index] === 1) {
      return;
    }
    visited[index] = 1;
    queue[tail++] = index;
  };

  for (let x = 0; x < width; x++) {
    enqueue(x);
    enqueue((height - 1) * width + x);
  }

  for (let y = 1; y < height - 1; y++) {
    enqueue(y * width);
    enqueue(y * width + (width - 1));
  }

  floodConnectedRegion(mask, visited, queue, width, height, neighbors, tail);

  return visited;
}

function summarizeComponents(
  mask: Uint8Array,
  width: number,
  height: number,
  connectivity: Connectivity,
  significantAreaThreshold: number,
): {
  totalArea: number;
  significantCount: number;
  largestArea: number;
  smallArea: number;
} {
  let totalArea = 0;
  let significantCount = 0;
  let largestArea = 0;
  let smallArea = 0;

  forEachConnectedRegion(mask, width, height, connectivity, (componentSize) => {
    totalArea += componentSize;
    largestArea = Math.max(largestArea, componentSize);
    if (componentSize >= significantAreaThreshold) {
      significantCount += 1;
    } else {
      smallArea += componentSize;
    }
  });

  return {
    totalArea,
    significantCount,
    largestArea,
    smallArea,
  };
}

function extractSignificantMask(
  mask: Uint8Array,
  width: number,
  height: number,
  connectivity: Connectivity,
  minArea: number,
): {
  mask: Uint8Array;
  count: number;
  area: number;
} {
  const significantMask = new Uint8Array(mask.length);
  let count = 0;
  let area = 0;

  forEachConnectedRegion(mask, width, height, connectivity, (componentSize, queue) => {
    if (componentSize >= minArea) {
      count += 1;
      area += componentSize;
      for (let queueIndex = 0; queueIndex < componentSize; queueIndex++) {
        significantMask[queue[queueIndex]] = 1;
      }
    }
  });

  return { mask: significantMask, count, area };
}

function calculateMaskDelta(left: Uint8Array, right: Uint8Array): number {
  let unionCount = 0;
  let symmetricDifferenceCount = 0;

  for (let index = 0; index < left.length; index++) {
    const inLeft = left[index] === 1;
    const inRight = right[index] === 1;
    if (inLeft || inRight) {
      unionCount += 1;
    }
    if (inLeft !== inRight) {
      symmetricDifferenceCount += 1;
    }
  }

  if (unionCount === 0) {
    return 0;
  }

  return symmetricDifferenceCount / unionCount;
}

function dilateMask(mask: Uint8Array, width: number, height: number, radius: number): Uint8Array {
  let current = mask;
  for (let step = 0; step < radius; step++) {
    const next = current.slice();
    for (let index = 0; index < current.length; index++) {
      if (current[index] === 0) {
        continue;
      }

      const x = index % width;
      const y = (index - x) / width;
      for (const [offsetX, offsetY] of EIGHT_CONNECTED_NEIGHBORS) {
        const nextX = x + offsetX;
        const nextY = y + offsetY;
        if (nextX < 0 || nextX >= width || nextY < 0 || nextY >= height) {
          continue;
        }
        next[nextY * width + nextX] = 1;
      }
    }
    current = next;
  }

  return current;
}

function analyzeRecomposition(
  whiteBg: Uint8ClampedArray,
  blackBg: Uint8ClampedArray,
  matte: MatteOutput,
): RecompositionMetrics {
  const pixelCount = matte.width * matte.height;
  const mattePixels = matte.pixels;
  const whiteStride = getStride(whiteBg, matte.width, matte.height);
  const blackStride = getStride(blackBg, matte.width, matte.height);
  const alpha = buildAlphaArray(mattePixels, matte.width, matte.height);

  let nonOpaqueCount = 0;
  let transparentPixelCount = 0;
  let whiteResidualSum = 0;
  let blackResidualSum = 0;
  let channelDisagreementSum = 0;
  let alphaResidualSum = 0;

  for (let index = 0; index < pixelCount; index++) {
    const matteOffset = index * 4;
    const whiteOffset = index * whiteStride;
    const blackOffset = index * blackStride;
    const alphaValue = alpha[index];
    if (alphaValue < 250) {
      nonOpaqueCount += 1;
    }
    if (alphaValue <= GENERATION_CONFIG.alphaFloorThreshold) {
      transparentPixelCount += 1;
    }

    const expectedDelta = 255 - alphaValue;
    const channelDeltas = [
      whiteBg[whiteOffset] - blackBg[blackOffset],
      whiteBg[whiteOffset + 1] - blackBg[blackOffset + 1],
      whiteBg[whiteOffset + 2] - blackBg[blackOffset + 2],
    ];
    const channelMax = Math.max(...channelDeltas);
    const channelMin = Math.min(...channelDeltas);
    channelDisagreementSum += (channelMax - channelMin) / 255;

    const alphaResidual = Math.max(
      Math.abs(channelDeltas[0] - expectedDelta),
      Math.abs(channelDeltas[1] - expectedDelta),
      Math.abs(channelDeltas[2] - expectedDelta),
    );
    alphaResidualSum += alphaResidual / 255;

    const premultiplied = [
      Math.round((mattePixels[matteOffset] * alphaValue) / 255),
      Math.round((mattePixels[matteOffset + 1] * alphaValue) / 255),
      Math.round((mattePixels[matteOffset + 2] * alphaValue) / 255),
    ];

    const recomposedWhite = [
      Math.min(255, premultiplied[0] + (255 - alphaValue)),
      Math.min(255, premultiplied[1] + (255 - alphaValue)),
      Math.min(255, premultiplied[2] + (255 - alphaValue)),
    ];

    whiteResidualSum += (
      Math.abs(recomposedWhite[0] - whiteBg[whiteOffset])
      + Math.abs(recomposedWhite[1] - whiteBg[whiteOffset + 1])
      + Math.abs(recomposedWhite[2] - whiteBg[whiteOffset + 2])
    ) / (3 * 255);

    blackResidualSum += (
      Math.abs(premultiplied[0] - blackBg[blackOffset])
      + Math.abs(premultiplied[1] - blackBg[blackOffset + 1])
      + Math.abs(premultiplied[2] - blackBg[blackOffset + 2])
    ) / (3 * 255);
  }

  return {
    alphaPresence: nonOpaqueCount / pixelCount,
    transparentPixelRatio: transparentPixelCount / pixelCount,
    borderTransparencyRatio: calculateBorderTransparencyRatio(alpha, matte.width, matte.height),
    whiteRecompositionResidual: whiteResidualSum / pixelCount,
    blackRecompositionResidual: blackResidualSum / pixelCount,
    recompositionResidual: Math.max(whiteResidualSum, blackResidualSum) / pixelCount,
    channelDisagreement: channelDisagreementSum / pixelCount,
    alphaResidual: alphaResidualSum / pixelCount,
  };
}

function calculateBorderTransparencyRatio(alpha: Uint8ClampedArray, width: number, height: number): number {
  const seen = new Set<number>();
  let transparentCount = 0;

  const visit = (index: number) => {
    if (seen.has(index)) {
      return;
    }
    seen.add(index);
    if (alpha[index] <= GENERATION_CONFIG.alphaFloorThreshold) {
      transparentCount += 1;
    }
  };

  for (let x = 0; x < width; x++) {
    visit(x);
    visit((height - 1) * width + x);
  }

  for (let y = 1; y < height - 1; y++) {
    visit(y * width);
    visit(y * width + (width - 1));
  }

  if (seen.size === 0) {
    return 0;
  }

  return transparentCount / seen.size;
}

function analyzeTopology(alpha: Uint8ClampedArray, width: number, height: number): TopologyAnalysis {
  const pixelCount = width * height;
  const minHoleArea = Math.max(12, Math.round(pixelCount * GENERATION_CONFIG.transparentQaHoleMinAreaRatio));
  const minFragmentArea = Math.max(8, Math.round(pixelCount * GENERATION_CONFIG.transparentQaFragmentMinAreaRatio));
  const thresholds = GENERATION_CONFIG.transparentQaTopologyThresholds;
  const holeFrequency = new Uint8Array(pixelCount);
  const foregroundMasks: Uint8Array[] = [];
  const topologySamples: TransparentQaTopologySample[] = [];

  for (const threshold of thresholds) {
    const foregroundMask = createBinaryMask(alpha, threshold);
    foregroundMasks.push(foregroundMask);

    const foregroundSummary = summarizeComponents(
      foregroundMask,
      width,
      height,
      4,
      minFragmentArea,
    );

    const backgroundMask = createInverseMask(foregroundMask);
    const borderConnectedBackground = floodBorderConnected(backgroundMask, width, height, 8);
    const holeMask = new Uint8Array(pixelCount);
    for (let index = 0; index < pixelCount; index++) {
      if (backgroundMask[index] === 1 && borderConnectedBackground[index] === 0) {
        holeMask[index] = 1;
      }
    }

    const significantHoles = extractSignificantMask(holeMask, width, height, 8, minHoleArea);
    for (let index = 0; index < pixelCount; index++) {
      if (significantHoles.mask[index] === 1) {
        holeFrequency[index] += 1;
      }
    }

    topologySamples.push({
      threshold,
      foregroundAreaRatio: foregroundSummary.totalArea / pixelCount,
      foregroundComponentCount: foregroundSummary.significantCount,
      holeCount: significantHoles.count,
      holeAreaRatio: significantHoles.area / pixelCount,
    });
  }

  let volatilityAccumulator = 0;
  for (let index = 1; index < foregroundMasks.length; index++) {
    volatilityAccumulator += calculateMaskDelta(foregroundMasks[index - 1], foregroundMasks[index]);
  }
  const topologyVolatility = foregroundMasks.length > 1
    ? volatilityAccumulator / (foregroundMasks.length - 1)
    : 0;

  const persistentHoleMask = new Uint8Array(pixelCount);
  const fragileHoleMask = new Uint8Array(pixelCount);
  for (let index = 0; index < pixelCount; index++) {
    const frequency = holeFrequency[index];
    if (frequency >= GENERATION_CONFIG.transparentQaPersistentThresholdCount) {
      persistentHoleMask[index] = 1;
    } else if (frequency > 0) {
      fragileHoleMask[index] = 1;
    }
  }

  const persistentHoles = extractSignificantMask(persistentHoleMask, width, height, 8, minHoleArea);
  const fragileHoles = extractSignificantMask(fragileHoleMask, width, height, 8, minHoleArea);
  const lowThresholdMask = createBinaryMask(alpha, GENERATION_CONFIG.transparentQaSilhouetteThreshold);
  const fragmentSummary = summarizeComponents(lowThresholdMask, width, height, 4, minFragmentArea);

  return {
    persistentHoleCount: persistentHoles.count,
    persistentHoleAreaRatio: persistentHoles.area / pixelCount,
    fragileHoleCount: fragileHoles.count,
    topologyVolatility,
    fragmentNoise: fragmentSummary.totalArea === 0
      ? 0
      : fragmentSummary.smallArea / fragmentSummary.totalArea,
    topologySamples,
  };
}

function analyzeShell(alpha: Uint8ClampedArray, width: number, height: number): ShellAnalysis {
  const silhouetteMask = createBinaryMask(alpha, GENERATION_CONFIG.transparentQaSilhouetteThreshold);
  const externalRegion = floodBorderConnected(createInverseMask(silhouetteMask), width, height, 8);
  const nearDilated = dilateMask(silhouetteMask, width, height, GENERATION_CONFIG.transparentQaNearShellRadiusPx);
  const farDilated = dilateMask(silhouetteMask, width, height, GENERATION_CONFIG.transparentQaFarShellRadiusPx);

  let nearRingCount = 0;
  let farRingCount = 0;
  let nearAlphaSum = 0;
  let farAlphaSum = 0;
  let boundaryErrorCount = 0;

  for (let index = 0; index < alpha.length; index++) {
    const isExternal = externalRegion[index] === 1;
    const inSilhouette = silhouetteMask[index] === 1;
    if (!isExternal || inSilhouette) {
      continue;
    }

    const alphaValue = alpha[index];
    const inNearRing = nearDilated[index] === 1;
    const inFarRing = farDilated[index] === 1 && !inNearRing;

    if (inNearRing) {
      nearRingCount += 1;
      nearAlphaSum += alphaValue;
      if (alphaValue >= GENERATION_CONFIG.transparentQaBoundaryAlphaThreshold) {
        boundaryErrorCount += 1;
      }
    } else if (inFarRing) {
      farRingCount += 1;
      farAlphaSum += alphaValue;
    }
  }

  return {
    boundaryErrorRate: nearRingCount === 0 ? 0 : boundaryErrorCount / nearRingCount,
    externalSpill: nearRingCount === 0 ? 0 : nearAlphaSum / (nearRingCount * 255),
    haloTail: farRingCount === 0 ? 0 : farAlphaSum / (farRingCount * 255),
  };
}

function getMatchedHoleKeywords(prompt: string): string[] {
  const lowerPrompt = prompt.toLowerCase();
  return GENERATION_CONFIG.transparentQaHoleKeywords.filter((keyword) => {
    const boundaryPattern = new RegExp(
      `(^|[^a-z0-9])${escapeRegexLiteral(keyword)}($|[^a-z0-9])`,
      "i",
    );
    return boundaryPattern.test(lowerPrompt);
  });
}

function shouldTreatKeywordsAsHoleRisk(matchedKeywords: string[]): boolean {
  if (matchedKeywords.length === 0) {
    return false;
  }

  return matchedKeywords.some((keyword) => keyword !== "logo");
}

function determineReasonCodes(
  metrics: TransparentQaMetrics,
  strongHoleKeywordSignal: boolean,
): TransparentQaReasonCode[] {
  const reasonCodes: TransparentQaReasonCode[] = [];

  if (metrics.whiteRecompositionResidual > GENERATION_CONFIG.transparentQaMaxRecompositionResidual) {
    reasonCodes.push("white_recomposition_residual_high");
  }
  if (metrics.blackRecompositionResidual > GENERATION_CONFIG.transparentQaMaxRecompositionResidual) {
    reasonCodes.push("black_recomposition_residual_high");
  }
  if (metrics.channelDisagreement > GENERATION_CONFIG.transparentQaMaxChannelDisagreement) {
    reasonCodes.push("channel_disagreement_high");
  }
  if (metrics.alphaResidual > GENERATION_CONFIG.transparentQaMaxAlphaResidual) {
    reasonCodes.push("alpha_residual_high");
  }
  if (metrics.alphaPresence < GENERATION_CONFIG.transparentQaMinAlphaPresence) {
    reasonCodes.push("alpha_presence_low");
  }
  if (
    metrics.borderTransparencyRatio < GENERATION_CONFIG.transparentQaMinBorderTransparencyRatio
  ) {
    reasonCodes.push("border_transparency_ratio_low");
  }
  if (metrics.dimensionMismatchPenalty > 0) {
    reasonCodes.push("dimension_mismatch");
  }
  if (metrics.boundaryErrorRate > GENERATION_CONFIG.transparentQaMaxBoundaryErrorRate) {
    reasonCodes.push("boundary_error_rate_high");
  }
  if (metrics.externalSpill > GENERATION_CONFIG.transparentQaMaxExternalSpill) {
    reasonCodes.push("external_spill_high");
  }
  if (metrics.haloTail > GENERATION_CONFIG.transparentQaMaxHaloTail) {
    reasonCodes.push("halo_tail_high");
  }
  if (metrics.fragmentNoise > GENERATION_CONFIG.transparentQaMaxFragmentNoise) {
    reasonCodes.push("fragment_noise_high");
  }
  if (metrics.topologyVolatility > GENERATION_CONFIG.transparentQaMaxTopologyVolatility) {
    reasonCodes.push("topology_volatility_high");
  }
  if (strongHoleKeywordSignal && metrics.persistentHoleCount === 0) {
    reasonCodes.push("expected_hole_missing");
  }

  return reasonCodes;
}

export function buildTransparentQaRetryPlan(
  decision: TransparentQaDecision,
  reasonCodes: TransparentQaReasonCode[],
): TransparentQaRetryPlan {
  if (decision === "pass" || decision === "review") {
    return {};
  }

  const geometryLine = decision === "retry_black"
    ? "Use the white-background image as the exact subject reference. Change only the background to pure black."
    : "Render the exact same subject in both passes. Only the background color may change between the white and black renders.";

  const lines = [
    "CRITICAL FIXES FOR THIS RETRY:",
    geometryLine,
  ];

  if (
    reasonCodes.includes("alpha_presence_low")
    || reasonCodes.includes("border_transparency_ratio_low")
  ) {
    lines.push(
      "Keep the subject comfortably inside the frame with transparent padding on every edge. Do not crop or let opaque pixels touch the canvas border.",
    );
  }

  if (
    reasonCodes.includes("boundary_error_rate_high")
    || reasonCodes.includes("external_spill_high")
    || reasonCodes.includes("halo_tail_high")
  ) {
    lines.push(
      "Keep the silhouette edge clean with no halo, fringe, glow, haze, gray spill, or semi-transparent contamination outside the subject.",
    );
  }

  if (
    reasonCodes.includes("topology_volatility_high")
    || reasonCodes.includes("expected_hole_missing")
  ) {
    lines.push(
      "Preserve true internal cutouts and negative space. Do not fill donut centers, ring interiors, handles, frames, stencil cutouts, or glasses gaps.",
    );
  }

  if (reasonCodes.includes("fragment_noise_high")) {
    lines.push("Do not create detached specks, crumbs, or floating fragments in the background.");
  }

  if (
    reasonCodes.includes("white_recomposition_residual_high")
    || reasonCodes.includes("black_recomposition_residual_high")
    || reasonCodes.includes("channel_disagreement_high")
    || reasonCodes.includes("alpha_residual_high")
    || reasonCodes.includes("dimension_mismatch")
  ) {
    lines.push("The subject geometry, edge treatment, and transparency must stay physically consistent across both background colors.");
  }

  if (reasonCodes.includes("dimension_mismatch")) {
    lines.push("Keep the subject framing and canvas aspect ratio identical across both renders. Do not crop, zoom, resize, or recompose between passes.");
  }

  lines.push("All outer background pixels must stay pure and uniform with no texture, shadow, or vignette.");

  if (decision === "retry_black") {
    return {
      retryInstruction: lines.join("\n"),
    };
  }

  return {
    retryInstruction: lines.join("\n"),
    downstreamRetryInstruction: [
      "CRITICAL FIXES FOR THIS RETRY:",
      "Use the white-background image as the exact subject reference. Change only the background to pure black.",
      ...lines.slice(2),
    ].join("\n"),
  };
}

export function analyzeTransparentOutput(args: AnalyzeTransparentOutputArgs): TransparentQaResult {
  const alpha = buildAlphaArray(args.matte.pixels, args.width, args.height);
  const recomposition = analyzeRecomposition(args.whiteBg, args.blackBg, args.matte);
  const topology = analyzeTopology(alpha, args.width, args.height);
  const shell = analyzeShell(alpha, args.width, args.height);
  const matchedHoleKeywords = getMatchedHoleKeywords(args.prompt);
  const strongHoleKeywordSignal = shouldTreatKeywordsAsHoleRisk(matchedHoleKeywords);

  const metrics: TransparentQaMetrics = {
    alphaPresence: clampUnit(recomposition.alphaPresence),
    transparentPixelRatio: clampUnit(recomposition.transparentPixelRatio),
    borderTransparencyRatio: clampUnit(recomposition.borderTransparencyRatio),
    whiteRecompositionResidual: clampUnit(recomposition.whiteRecompositionResidual),
    blackRecompositionResidual: clampUnit(recomposition.blackRecompositionResidual),
    recompositionResidual: clampUnit(recomposition.recompositionResidual),
    channelDisagreement: clampUnit(recomposition.channelDisagreement),
    alphaResidual: clampUnit(recomposition.alphaResidual),
    boundaryErrorRate: clampUnit(shell.boundaryErrorRate),
    externalSpill: clampUnit(shell.externalSpill),
    haloTail: clampUnit(shell.haloTail),
    persistentHoleCount: topology.persistentHoleCount,
    persistentHoleAreaRatio: clampUnit(topology.persistentHoleAreaRatio),
    fragileHoleCount: topology.fragileHoleCount,
    topologyVolatility: clampUnit(topology.topologyVolatility),
    fragmentNoise: clampUnit(topology.fragmentNoise),
    dimensionMismatchPenalty: args.dimensionMismatch ? 1 : 0,
    holeKeywordMatched: matchedHoleKeywords.length > 0,
    holeKeywordCount: matchedHoleKeywords.length,
    topologySamples: topology.topologySamples,
  };

  const reasonCodes = determineReasonCodes(metrics, strongHoleKeywordSignal);
  const hasPhysicsFailure = reasonCodes.some((code) =>
    code === "white_recomposition_residual_high"
    || code === "black_recomposition_residual_high"
    || code === "channel_disagreement_high"
    || code === "alpha_residual_high"
    || code === "dimension_mismatch"
  );
  const hasCoverageFailure = reasonCodes.some((code) =>
    code === "alpha_presence_low"
    || code === "border_transparency_ratio_low"
  );
  const hasHaloOrSpillFailure = reasonCodes.some((code) =>
    code === "boundary_error_rate_high"
    || code === "external_spill_high"
    || code === "halo_tail_high"
  );
  const hasStructureFailure = reasonCodes.some((code) =>
    code === "fragment_noise_high"
    || code === "topology_volatility_high"
  );
  const hasHoleRiskFailure = strongHoleKeywordSignal
    && (metrics.persistentHoleCount === 0
      || metrics.topologyVolatility > GENERATION_CONFIG.transparentQaMaxTopologyVolatility);

  let decision: TransparentQaDecision = "pass";
  if (hasPhysicsFailure) {
    decision = "retry_white_and_black";
  } else if (hasCoverageFailure) {
    decision = "retry_white_and_black";
  } else if (hasHoleRiskFailure) {
    decision = "retry_white_and_black";
  } else if (hasStructureFailure) {
    decision = "retry_white_and_black";
  } else if (hasHaloOrSpillFailure) {
    decision = "retry_black";
  }

  return {
    version: TRANSPARENT_QA_VERSION,
    decision,
    reasonCodes,
    metrics,
  };
}
