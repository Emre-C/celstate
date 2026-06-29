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
    "",
    "## LOTTIE JSON STRUCTURE RULES (from diffusionstudio/lottie authoring spec)",
    "",
    "1. Root document must include: v, fr, ip, op, w, h, nm, assets (empty array), layers.",
    '2. Every shape element MUST be wrapped in a group (ty: "gr"). A flat list of shapes + fills directly in a layer\'s shapes array renders blank. Always nest geometry, fill/stroke, and a group transform (ty: "tr") inside a group\'s it array.',
    '3. Group structure: { ty: "gr", nm: "...", it: [ <geometry>, <fill-or-stroke>, <transform> ] }. The transform item (ty: "tr") must be the last element in the it array.',
    "4. Shape types allowed: el (ellipse), rc (rectangle), sr (star), sh (path), fl (fill), st (stroke), tr (transform), tm (trim path), rd (round corners), rp (repeater), mm (merge), pb (pucker & bloat). Never use image assets, raster data, text layers (ty: 5), font tables, audio, video, expressions, or plugins.",
    "5. Animated properties use { a: 1, k: [ { t: <frame>, s: <value>, i: { x: [...], y: [...] }, o: { x: [...], y: [...] } }, ... ] }. Static properties use { a: 0, k: <value> }.",
    "6. Easing: every animated keyframe MUST have i (in-tangent) and o (out-tangent) bezier handles. Never use linear easing for spatial movement. Primary easing (80% of animations): Material standard i: { x: [0.4], y: [0] }, o: { x: [0.2], y: [1] }. Secondary easing (remaining 20%): classic ease-in-out i: { x: [0.42], y: [1] }, o: { x: [0.58], y: [0] }. Use ease-out for entrances (fast start, gentle landing). Use ease-in for exits (gentle start, fast departure).",
    "7. Slot controls (sid): only expose when they genuinely aid reuse. Every property using sid MUST also include a normal k fallback value so the animation renders standalone.",
    "8. Layer types allowed: ty 4 (shape layer) and ty 3 (null layer) only. Never use effects (ef), track mattes (tt/td), or masks (masksProperties).",
    "9. Set assets to an empty array. The animation must be entirely vector and self-contained.",
    "10. Give the document a root nm (name) string.",
    "",
    "## MOTION CRAFT RULES (from LottieFiles motion-design principles)",
    "",
    "1. Three motion layers: every animation must have primary (main action), secondary (supporting richness — shadows, icons shifting), and ambient (background life — subtle pulses, gradients) layers. Flat animation = missing layers.",
    "2. Never use linear easing for spatial movement. Linear is only for spinners and progress bars.",
    "3. Never rely on opacity-only for important state changes. Combine with position or scale.",
    "4. Never exceed 1/3 of the canvas distance without an intermediate keyframe.",
    "5. Entrance animations use deceleration (ease-out family). Exit animations use acceleration (ease-in family). On-screen motion uses ease-in-out. Looping ambient uses sine-based ease-in-out.",
    "6. Stagger related elements for rhythm — don't animate everything simultaneously. Offset keyframes by 2-6 frames between related elements.",
    "7. Apply anticipation (small reverse motion before main action) and follow-through (overshoot/settle after main action) for believable physics.",
    "8. Duration scales with distance: 100px = base duration. 200px = 1.3x. 400px = 1.6x. Entrances are 30-50% longer than exits.",
    "",
    "## CELSTATE HOUSE STYLE",
    "",
    "Warm, editorial, and confident — like a well-designed studio tool, not a tech demo.",
    "- Motion personality: Premium (350-600ms equivalent in frame count). Elegant, minimal, sophisticated. Zero overshoot for UI, 3-5% for illustrations.",
    "- Signature easing: cubic-bezier(0.4, 0, 0.2, 1) for 80% of animations (see rule 6 for bezier handle values). Classic ease-in-out for the remaining 20%.",
    "- Color: burnt terracotta accent (#C2410C = [0.761, 0.255, 0.047, 1] in RGBA 0-1) on warm neutral tones (stone grays, cream). Never neon, never pure black (0,0,0), never pure white (1,1,1).",
    "- Alive but never bouncy, elastic, or gratuitous. Favor restrained, intentional movement with generous negative space.",
    "- Loop cleanly: the first and last frames must be visually compatible so the animation repeats without a visible seam.",
    "- Think like a camera operator: express pushes, pans, and zooms through parented group (gr) transforms rather than re-animating every element individually.",
  ].join("\n");
}

export function buildLottieGenerationPrompt(args: BuildLottiePromptArgs): string {
  const dimensions = getLottieDimensions(args.aspectRatio);
  const fps = args.fps ?? LOTTIE_GENERATION_CONFIG.defaultFps;
  const totalFrames = args.durationSeconds * fps;

  const lines = [
    "Create a transparent-background Lottie animation as compact JSON.",
    `Canvas: ${dimensions.width}x${dimensions.height}.`,
    `Timing: ${fps} fps, ip 0, op ${totalFrames}, duration ${args.durationSeconds} seconds.`,
    "Required root fields: v, fr, ip, op, w, h, nm, assets (empty array), layers.",
    "CRITICAL: Every shape element MUST be wrapped in a group (ty: \"gr\"). A flat list of shapes + fills directly in a layer's shapes array renders blank. Each group's it array must contain geometry, fill/stroke, and a transform (ty: \"tr\") as the last item.",
    "Use shape layers (ty: 4) and null layers (ty: 3) only. No text layers, effects, track mattes, or masks.",
    "Include three motion layers: primary (main action), secondary (supporting richness), and ambient (subtle background life).",
    "Use expressive vector shapes, trim paths, group transforms, opacity, and ease-in-out timing with real bezier handles (i/o) on every animated keyframe.",
    "Stagger related elements by 2-6 frames for rhythm. Apply anticipation and follow-through for believable physics.",
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
