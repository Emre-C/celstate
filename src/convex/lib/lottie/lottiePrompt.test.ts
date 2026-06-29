import { describe, expect, it } from "vitest";
import {
  buildLottieGenerationPrompt,
  buildLottieRepairPrompt,
  formatLottieValidationErrors,
  LOTTIE_RESPONSE_SCHEMA,
} from "./lottiePrompt.js";
import type { LottieValidationResult } from "./lottieValidation.js";

describe("lottiePrompt", () => {
  it("builds a constrained transparent Lottie generation prompt", () => {
    const prompt = buildLottieGenerationPrompt({
      aspectRatio: "16:9",
      durationSeconds: 4,
      fps: 60,
      prompt: "A terracotta badge draws itself on.",
    });

    expect(prompt).toContain("Canvas: 960x540");
    expect(prompt).toContain("op 240");
    expect(prompt).toContain("assets (empty array)");
    expect(prompt).toContain("transparent-background");
    expect(prompt).toContain('wrapped in a group (ty: "gr")');
    expect(prompt).toContain("three motion layers");
    expect(LOTTIE_RESPONSE_SCHEMA.properties.lottie_json.type).toBe("string");
  });

  it("formats validation errors for repair prompts", () => {
    const validation: LottieValidationResult = {
      decision: "fail",
      errors: ["Missing root field \"assets\"", "Frame rate must be 60"],
      warnings: [],
      version: "lottie-v1",
    };

    expect(formatLottieValidationErrors(validation)).toContain("1. Missing root field");
    expect(
      buildLottieRepairPrompt({
        aspectRatio: "1:1",
        durationSeconds: 2,
        fps: 60,
        invalidLottieJson: "{\"bad\":true}",
        prompt: "repair it",
        validation,
      }),
    ).toContain("Repair the Lottie JSON");
  });
});
