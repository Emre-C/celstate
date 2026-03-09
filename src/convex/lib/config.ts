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

  // Image optimization (Normal Resolution variant)
  optimizedMaxDimension: 1024,
  optimizedPngQuality: 80,
  optimizedPngEffort: 7,
  optimizedPngColours: 256,
  optimizedPngDither: 0.5,
} as const;
