import { ConvexError } from "convex/values";
import { GENERATION_CONFIG, isValidAspectRatio } from "../config.js";

export function validatePromptInput(prompt: string): string {
  const trimmed = prompt.trim();
  if (!trimmed) {
    throw new ConvexError("Prompt is required");
  }
  if (trimmed.length > GENERATION_CONFIG.maxPromptLength) {
    throw new ConvexError(
      `Prompt too long (max ${GENERATION_CONFIG.maxPromptLength} characters)`,
    );
  }
  return trimmed;
}

export function validateAspectRatioInput(value: string): string {
  if (!isValidAspectRatio(value)) {
    throw new ConvexError(`Unsupported aspect ratio: ${value}`);
  }
  return value;
}
