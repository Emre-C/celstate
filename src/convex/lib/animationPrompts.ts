import type { Id } from "../_generated/dataModel.js";

export const ANIMATION_USE_CASES = {
  stream_alert: {
    label: "Stream alert",
    briefLabel: "OBS-ready transparent stream alert",
    motion:
      "short celebratory entrance, readable at webcam-overlay scale, then a clean hold",
    avoid:
      "scene backgrounds, tiny confetti noise, unreadable text, cropped subject, camera cuts",
  },
  stinger_transition: {
    label: "Stinger transition",
    briefLabel: "OBS-ready transparent stinger transition element",
    motion:
      "decisive sweep or emblem motion that can sit over a scene change without becoming a full scene",
    avoid:
      "full-screen environments, hard scene cuts, text baked into the generated subject, edge-cropped motion",
  },
  mascot_reaction: {
    label: "Mascot reaction",
    briefLabel: "transparent creator mascot reaction",
    motion:
      "expressive character reaction with a stable silhouette and no identity drift",
    avoid:
      "extra characters, complex dialogue acting, lip sync, fast spins, self-occlusion",
  },
  logo_sting: {
    label: "Logo sting",
    briefLabel: "transparent logo sting",
    motion:
      "premium emblem reveal with a short settle, keeping logo geometry recognizable",
    avoid:
      "brand mimicry, illegible lettering, reflections on a floor, background plates",
  },
  lower_third: {
    label: "Lower third",
    briefLabel: "editor-ready transparent lower-third motion accent",
    motion:
      "clean editorial reveal with deterministic text reserved for Celstate layout, not model-rendered text",
    avoid:
      "baked-in paragraphs, noisy templates, heavy shadows, full-frame panels",
  },
  video_callout: {
    label: "Video callout",
    briefLabel: "editor-ready transparent video callout",
    motion:
      "attention-directing motion that reads clearly over footage without obscuring the subject",
    avoid:
      "stock-template clutter, glowing arrows, full backgrounds, illegible labels",
  },
  creator_overlay: {
    label: "Creator overlay",
    briefLabel: "transparent creator/editor overlay asset",
    motion:
      "compact branded flourish with a stable central subject and generous transparent padding",
    avoid:
      "generic full-scene animation, platform UI mimicry, clutter, cropped edges",
  },
} as const;

export type AnimationUseCase = keyof typeof ANIMATION_USE_CASES;

export const ANIMATION_DESTINATIONS = {
  obs: {
    label: "OBS / streaming",
    briefPrefix: "OBS-ready",
    exportTarget: "transparent WebM with alpha and stream-overlay-safe framing",
  },
  video_editor: {
    label: "Video editor",
    briefPrefix: "editor-ready",
    exportTarget: "transparent editor assets, including ProRes-style MOV when available",
  },
  obs_and_video_editor: {
    label: "Both",
    briefPrefix: "OBS-ready and editor-ready",
    exportTarget: "transparent WebM plus editor-ready transparent video exports",
  },
} as const;

export type AnimationDestination = keyof typeof ANIMATION_DESTINATIONS;

export interface AnimationBrandInputs {
  channelName?: string;
  colors?: string[];
  creatorHandle?: string;
  logoStorageId?: Id<"_storage">;
}

export interface BuildAnimationProductionBriefArgs {
  brandInputs?: AnimationBrandInputs;
  destination: AnimationDestination;
  durationSeconds: number;
  prompt: string;
  useCase: AnimationUseCase;
}

const STYLE_REFERENCE_REPLACEMENTS: Array<[RegExp, string]> = [
  [/\bin\s+the\s+style\s+of\s+[^,.]+/gi, "with original Celstate art direction"],
  [/\bby\s+[A-Z][a-z]+(?:\s+[A-Z][a-z]+){0,3}(?=$|[,.])/g, "with original Celstate art direction"],
  [/\bstudio\s+ghibli\b/gi, "hand-painted storybook animation craft"],
  [/\bpixar\b/gi, "polished character-animation appeal"],
  [/\bdisney\b/gi, "classic family-animation warmth"],
  [/\bmarvel\b/gi, "premium comic-book energy"],
  [/\bnintendo\b/gi, "playful game-inspired charm"],
];

function normalizeWhitespace(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

export function normalizeAnimationPromptForBrief(prompt: string): string {
  let normalized = normalizeWhitespace(prompt);
  for (const [pattern, replacement] of STYLE_REFERENCE_REPLACEMENTS) {
    normalized = normalized.replace(pattern, replacement);
  }
  return normalizeWhitespace(normalized);
}

function buildBrandLine(brandInputs: AnimationBrandInputs | undefined): string | null {
  if (!brandInputs) {
    return null;
  }

  const details: string[] = [];
  if (brandInputs.channelName) {
    details.push(`channel name: ${brandInputs.channelName}`);
  }
  if (brandInputs.creatorHandle) {
    details.push(`creator handle: ${brandInputs.creatorHandle}`);
  }
  if (brandInputs.colors && brandInputs.colors.length > 0) {
    details.push(`brand colors: ${brandInputs.colors.join(", ")}`);
  }
  if (brandInputs.logoStorageId) {
    details.push("logo reference supplied");
  }

  return details.length > 0 ? `Brand inputs: ${details.join("; ")}.` : null;
}

export function buildAnimationProductionBrief(
  args: BuildAnimationProductionBriefArgs,
): string {
  const useCase = ANIMATION_USE_CASES[args.useCase];
  const destination = ANIMATION_DESTINATIONS[args.destination];
  const normalizedPrompt = normalizeAnimationPromptForBrief(args.prompt);
  const brandLine = buildBrandLine(args.brandInputs);

  return [
    `${destination.briefPrefix} ${useCase.briefLabel}.`,
    `User intent: ${normalizedPrompt}.`,
    brandLine,
    `Motion direction: ${useCase.motion}.`,
    `Duration target: ${args.durationSeconds} seconds, 24 fps source-compatible timing.`,
    `Export target: ${destination.exportTarget}.`,
    "Composition: one clear foreground asset or one controlled motion-graphic layout, centered with generous transparent padding for every frame.",
    "Transparency plan: isolate the subject for alpha reconstruction, preserve soft edges and motion blur, and avoid canvas-edge contact.",
    `Avoid: ${useCase.avoid}; no floor plane, no shadows baked into a background, no extra subjects, no camera cuts, no generated text unless it is explicitly a deterministic layout element.`,
  ].filter((line): line is string => line !== null).join("\n");
}

export function buildVeoMotionPrompt(productionBrief: string): string {
  return [
    productionBrief,
    "Generate an opaque source video suitable for Celstate temporal alpha reconstruction.",
    "Keep the background visually simple and separable from the foreground. Keep subject scale and identity stable across the full clip.",
  ].join("\n");
}

export function buildAnimationReferenceStillPrompt(productionBrief: string): string {
  return [
    productionBrief,
    "Create the clean key visual for this motion asset as a single foreground subject or controlled motion-graphic element.",
    "The output will be converted into a transparent RGBA animation, so keep the subject centered, legible, and separated from the background.",
    "Do not render UI chrome, timeline controls, captions, watermarks, or explanatory text.",
  ].join("\n");
}
