/**
 * Aspect ratio definitions for image generation.
 * Grouped by user-facing category for UI rendering.
 * Only ratios supported by gemini-3.1-flash-image-preview:
 * 1:1, 3:2, 2:3, 3:4, 4:1, 4:3, 4:5, 5:4, 8:1, 9:16, 16:9, 21:9
 */
export const ASPECT_RATIOS = {
  "1:1":  { label: "Square",     category: "common" },
  "4:3":  { label: "Landscape",  category: "common" },
  "3:4":  { label: "Portrait",   category: "common" },
  "16:9": { label: "Widescreen", category: "common" },
  "9:16": { label: "Tall",       category: "common" },
  "3:2":  { label: "Photo",      category: "more" },
  "2:3":  { label: "Photo tall", category: "more" },
  "5:4":  { label: "Print",      category: "more" },
  "4:5":  { label: "Social",     category: "more" },
  "21:9": { label: "Cinematic",  category: "more" },
  "4:1":  { label: "Banner",     category: "more" },
  "1:4":  { label: "Tall banner", category: "more" },
  "8:1":  { label: "Strip",      category: "more" },
  "1:8":  { label: "Tall strip", category: "more" },
} as const;

export type AspectRatioKey = keyof typeof ASPECT_RATIOS;

const VALID_ASPECT_RATIOS = new Set<string>(Object.keys(ASPECT_RATIOS));

export function isValidAspectRatio(value: string): value is AspectRatioKey {
  return VALID_ASPECT_RATIOS.has(value);
}

export const GENERATION_CONFIG = {
  model: "gemini-3.1-flash-image-preview",
  defaultAspectRatio: "1:1",
  defaultImageSize: "1K",
  responseModalities: ["IMAGE"] as const,

  // Retry policy
  maxRetriesPerPass: 1,
  maxRetriesTotal: 0,
  maxFinalizeRetries: 1,
  retryBaseDelayMs: 1500,
  stalledGenerationWarningMs: 5 * 60 * 1000,
  staleGenerationTimeoutMs: 15 * 60 * 1000,

  // Background purity validation
  cornerPatchSize: 32,
  whiteBgMinMean: 245,
  blackBgMaxMean: 10,
  bgMaxStdDev: 5,

  // Matte cleanup
  alphaFloorThreshold: 3,
  alphaCeilThreshold: 252,

  // Deterministic transparent-background QA
  transparentQaTopologyThresholds: [8, 16, 24, 40, 64, 96, 160, 224],
  transparentQaPersistentThresholdCount: 3,
  transparentQaSilhouetteThreshold: 16,
  transparentQaBoundaryAlphaThreshold: 24,
  transparentQaNearShellRadiusPx: 2,
  transparentQaFarShellRadiusPx: 6,
  transparentQaHoleMinAreaRatio: 0.00002,
  transparentQaFragmentMinAreaRatio: 0.00001,
  transparentQaMaxRecompositionResidual: 0.008,
  transparentQaMaxChannelDisagreement: 0.03,
  transparentQaMaxAlphaResidual: 0.03,
  transparentQaMinAlphaPresence: 0.2,
  transparentQaMinBorderTransparencyRatio: 0.9,
  transparentQaMaxBoundaryErrorRate: 0.12,
  transparentQaMaxExternalSpill: 0.04,
  transparentQaMaxHaloTail: 0.02,
  transparentQaMaxFragmentNoise: 0.015,
  transparentQaMaxTopologyVolatility: 0.18,
  transparentQaHoleKeywords: [
    "donut",
    "ring",
    "wheel",
    "frame",
    "cutout",
    "logo",
    "stencil",
    "mesh",
    "glasses",
    "handle",
  ] as const,

  // Credits
  creditsPerGeneration: 1,
  initialCredits: 3,
  weeklyDripCap: 1,

  // Abuse prevention
  maxConcurrentGenerations: 3,
  maxPromptLength: 20_000,
  uploadUrlIssueWindowMs: 15 * 60 * 1000,
  maxUploadUrlIssuesPerWindow: 3 * 14,

  // Reference image constraints
  referenceMaxSizeBytes: 7 * 1024 * 1024, // 7 MB
  maxReferenceImages: 14,
  orphanedUploadMaxAgeMs: 60 * 60 * 1000, // 1 hour
  orphanedUploadCleanupBatchSize: 100,

  // Image optimization (Normal Resolution variant)
  optimizedMaxDimension: 1024,
  optimizedPngQuality: 80,
  optimizedPngEffort: 7,
  optimizedPngColours: 256,
  optimizedPngDither: 0.5,
} as const;

export const ANIMATION_ASPECT_RATIOS = {
  "16:9": { label: "Widescreen" },
  "9:16": { label: "Vertical" },
} as const;

export type AnimationAspectRatioKey = keyof typeof ANIMATION_ASPECT_RATIOS;

const VALID_ANIMATION_ASPECT_RATIOS = new Set<string>(
  Object.keys(ANIMATION_ASPECT_RATIOS),
);

export function isValidAnimationAspectRatio(
  value: string,
): value is AnimationAspectRatioKey {
  return VALID_ANIMATION_ASPECT_RATIOS.has(value);
}

export const ANIMATION_DURATIONS_SECONDS = [4, 6, 8] as const;

export type AnimationDurationSeconds = (typeof ANIMATION_DURATIONS_SECONDS)[number];

const VALID_ANIMATION_DURATIONS_SECONDS = new Set<number>(
  ANIMATION_DURATIONS_SECONDS,
);

export function isValidAnimationDurationSeconds(
  value: number,
): value is AnimationDurationSeconds {
  return VALID_ANIMATION_DURATIONS_SECONDS.has(value);
}

export const ANIMATION_GENERATION_CONFIG = {
  defaultAspectRatio: "16:9" as AnimationAspectRatioKey,
  defaultDurationSeconds: 4 as AnimationDurationSeconds,
  maxActiveAnimationGenerations: 5,
  maxAttributionValueLength: 120,
  maxBrandColors: 6,
  maxBrandInputLength: 80,
  maxPromptLength: 4_000,
  maxReferenceImages: 4,
  maxRequestsPerWindow: 20,
  requestWindowMs: 24 * 60 * 60 * 1000,

  // Phase -1 concierge validation records requests without charging credits.
  // The automated pipeline can raise this when Veo + alpha reconstruction are live.
  creditsPerAnimationRequest: 0,
} as const;
