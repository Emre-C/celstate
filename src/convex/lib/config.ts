/**
 * Aspect ratio definitions for image generation.
 * Grouped by user-facing category for UI rendering.
 * Complete set supported by gemini-3.1-flash-image-preview.
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
  maxRetriesPerPass: 2,
  maxRetriesTotal: 3,
  retryBaseDelayMs: 1000,

  // Background purity validation
  cornerPatchSize: 32,
  whiteBgMinMean: 245,
  blackBgMaxMean: 10,
  bgMaxStdDev: 5,

  // Matte cleanup
  alphaFloorThreshold: 3,
  alphaCeilThreshold: 252,

  // Credits
  creditsPerGeneration: 1,
  initialCredits: 3,

  // Reference image constraints
  referenceMaxSizeBytes: 10 * 1024 * 1024, // 10 MB

  // Image optimization (Normal Resolution variant)
  optimizedMaxDimension: 1024,
  optimizedPngQuality: 80,
  optimizedPngEffort: 7,
  optimizedPngColours: 256,
  optimizedPngDither: 0.5,
} as const;
