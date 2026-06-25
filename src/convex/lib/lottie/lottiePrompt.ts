import {
  getLottieDimensions,
  LOTTIE_GENERATION_CONFIG,
  type LottieAspectRatioKey,
  type LottieDurationSeconds,
} from "../config.js";
import type { LottieValidationResult } from "./lottieValidation.js";

export const LOTTIE_RESPONSE_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    lottie_json: {
      type: "string",
      description:
        "A compact stringified Bodymovin/Lottie JSON document. It must parse as JSON.",
    },
    notes: {
      type: "array",
      items: { type: "string" },
      description: "Short implementation notes for internal debugging.",
    },
  },
  required: ["lottie_json"],
} as const;

interface BuildLottiePromptArgs {
  aspectRatio: LottieAspectRatioKey;
  durationSeconds: LottieDurationSeconds;
  fps?: number;
  grounding?: string;
  prompt: string;
}

interface BuildLottieRepairPromptArgs extends BuildLottiePromptArgs {
  invalidLottieJson: string;
  validation: LottieValidationResult;
}

export function buildLottieSystemInstruction(): string {
  return [
    "You are a senior motion designer who authors production-ready Bodymovin/Lottie JSON for Celstate.",
    "Return only the structured JSON requested by the response schema.",
    "The Lottie document itself must be transparent, vector-only, and render correctly in lottie-web.",
    "Never use external image assets, raster assets, text layers, font tables, audio, video, expressions, or plugins.",
    "Motion craft: drive every meaningful keyframe with deliberate easing via bezier handles (the i and o fields); prefer ease-in-out, avoid accidental linear motion, and stagger related elements for rhythm.",
    "Think like a camera operator: express pushes, pans, and zooms through parented group (gr) transforms rather than re-animating every element individually.",
    "Celstate house style: warm, editorial, and confident; alive but never bouncy, elastic, or gratuitous. Favor a burnt-terracotta accent (#C2410C) on warm neutral tones, generous negative space, and restrained, intentional movement. Never neon, never pure black or pure white fills.",
    "Loop cleanly: the first and last frames must be visually compatible so the animation repeats without a visible seam.",
  ].join(" ");
}

export function buildLottieGenerationPrompt(args: BuildLottiePromptArgs): string {
  const dimensions = getLottieDimensions(args.aspectRatio);
  const fps = args.fps ?? LOTTIE_GENERATION_CONFIG.defaultFps;
  const totalFrames = args.durationSeconds * fps;

  const lines = [
    "Create a transparent-background Lottie animation as compact JSON.",
    `Canvas: ${dimensions.width}x${dimensions.height}.`,
    `Timing: ${fps} fps, ip 0, op ${totalFrames}, duration ${args.durationSeconds} seconds.`,
    "Required root fields: v, fr, ip, op, w, h, nm, assets, layers.",
    "Set assets to an empty array. Use shape layers and null layers only.",
    "Use expressive vector shapes, trim paths, group transforms, opacity, and ease-in-out timing with real bezier handles (i/o) on keyframes.",
    "Simulate any camera movement (push, pan, zoom) through parented group transforms, not by moving every shape separately.",
    "Only expose slot controls (sid) when they genuinely aid reuse; every property that uses sid must also include a normal k fallback value so the animation renders standalone.",
    "Do not draw a background rectangle, checkerboard, text, labels, watermarks, UI chrome, shadows baked into a background, or full-screen scene plate.",
    "Keep motion loop-friendly and polished, with the first and final frames visually compatible.",
  ];

  if (args.grounding?.trim()) {
    lines.push(
      "Ground the animation strictly in the reference below: preserve its geometry, proportions, and color relationships, and animate it rather than redrawing it from scratch.",
      "Reference:",
      args.grounding.trim(),
    );
  }

  lines.push(`User brief: ${args.prompt.trim()}`);

  return lines.join("\n");
}

export function formatLottieValidationErrors(validation: LottieValidationResult): string {
  return validation.errors
    .map((error, index) => `${index + 1}. ${error}`)
    .join("\n");
}

function truncateForRepair(value: string): string {
  const maxLength = 18_000;
  return value.length <= maxLength
    ? value
    : `${value.slice(0, maxLength)}\n... truncated ...`;
}

export function buildLottieRepairPrompt(args: BuildLottieRepairPromptArgs): string {
  return [
    "Repair the Lottie JSON so it passes Celstate v1 validation.",
    buildLottieGenerationPrompt(args),
    "Validation errors to fix:",
    formatLottieValidationErrors(args.validation),
    "Invalid JSON candidate:",
    truncateForRepair(args.invalidLottieJson),
  ].join("\n\n");
}
