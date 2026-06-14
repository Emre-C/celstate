import type { Id } from "../../_generated/dataModel.js";

export const ANIMATION_USE_CASES = {
  small_accent: {
    label: "Small accent / icon",
    briefLabel: "transparent living small-accent asset",
    motion:
      "subtle ambient motion that remains crisp at 48 dp, such as a swaying leaf, pulsing dot, or breathing icon",
    avoid:
      "soft volumetrics, tiny unreadable detail, full-scene backgrounds, extra subjects, cropped edges",
  },
  interactive_control: {
    label: "Interactive control",
    briefLabel: "transparent living interactive-control asset",
    motion:
      "structured motion that can respond to press or drag state, such as a slider riding rails or a tactile toggle",
    avoid:
      "baked-in app chrome, generated labels, complex physics, scene cuts, full-screen UI mockups",
  },
  button_overlay: {
    label: "Button overlay",
    briefLabel: "transparent living button-overlay asset",
    motion:
      "short ambient loop that can sit over a button without stealing attention, such as overgrown bushes swaying",
    avoid:
      "hard shadows, text, heavy particles, soft volumetric haze, edge-cropped branches",
  },
  ambient_background: {
    label: "Background / ambient field",
    briefLabel: "transparent living ambient-background element",
    motion:
      "procedural ambient drift or sway suitable for many runtime instances, such as fireflies, grass, or falling leaves",
    avoid:
      "one giant illustrated background plate, fog, glow clouds, dense noise, camera motion",
  },
  loader_feedback: {
    label: "Loader / state feedback",
    briefLabel: "transparent living loader or state-feedback asset",
    motion:
      "compact looping feedback with a readable state change, such as a living spinner or success bloom",
    avoid:
      "generic spinner templates, neon glow, text, confetti clutter, soft smoke bursts",
  },
} as const;

export type AnimationUseCase = keyof typeof ANIMATION_USE_CASES;

export const ANIMATION_DESTINATIONS = {
  react_native_runtime: {
    label: "React Native runtime",
    briefPrefix: "React-Native-ready",
    exportTarget: "a transparent runtime bundle with sprite sheet, procedural manifest, APNG preview, and frame sequence",
  },
  web_runtime: {
    label: "Web runtime",
    briefPrefix: "web-runtime-ready",
    exportTarget: "a transparent runtime bundle with sprite sheet, procedural manifest, APNG preview, and frame sequence",
  },
  runtime_bundle: {
    label: "Runtime bundle",
    briefPrefix: "runtime-ready",
    exportTarget: "transparent sprite sheet, runtime manifest, still reference, and preview exports",
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

export function buildAnimationReferenceStillPrompt(productionBrief: string): string {
  return [
    productionBrief,
    "Create the clean key visual for this motion asset as a single foreground subject or controlled motion-graphic element.",
    "The output will be converted into a transparent RGBA animation, so keep the subject centered, legible, and separated from the background.",
    "Do not render UI chrome, timeline controls, captions, watermarks, or explanatory text.",
  ].join("\n");
}
