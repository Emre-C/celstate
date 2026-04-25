import { describe, expect, it } from "vitest";
import {
  AspectRatioMismatchError,
  buildBlackBackgroundStagePrompt,
  shouldRecoverFinalizingWithFullRerender,
} from "./generation.js";

describe("generation helpers", () => {
  it("uses the retry prompt whenever a black-pass retry instruction is present", () => {
    const prompt = buildBlackBackgroundStagePrompt(
      "Use the white-background image as the exact subject reference.",
    );

    expect(prompt).toContain("MUST be pure solid black");
    expect(prompt).toContain("exact subject reference");
  });

  it("keeps the default black-pass prompt when no retry instruction exists", () => {
    const prompt = buildBlackBackgroundStagePrompt();

    expect(prompt).toContain("background, which must now be pure solid black");
    expect(prompt).not.toContain("CRITICAL FIXES FOR THIS RETRY");
  });

  it("rerenders upstream when finalizing hits an aspect-ratio mismatch", () => {
    expect(
      shouldRecoverFinalizingWithFullRerender(
        new AspectRatioMismatchError("white=1024x1024, black=1024x768"),
      ),
    ).toBe(true);
    expect(shouldRecoverFinalizingWithFullRerender(new Error("other failure"))).toBe(false);
  });
});
