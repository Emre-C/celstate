import { describe, expect, it } from "vitest";
import {
  buildAnimationProductionBrief,
  normalizeAnimationPromptForBrief,
} from "./animationPrompts.js";

describe("animation prompt helpers", () => {
  it("normalizes direct style references into original art direction", () => {
    const normalized = normalizeAnimationPromptForBrief(
      "A mascot in the style of Studio Ghibli by Jane Doe",
    );

    expect(normalized).toContain("original Celstate art direction");
    expect(normalized).not.toMatch(/Studio Ghibli|Jane Doe/i);
  });

  it("preserves ordinary location phrases that use by", () => {
    const normalized = normalizeAnimationPromptForBrief(
      "cozy forest spirit by the river with warm lanterns",
    );

    expect(normalized).toBe("cozy forest spirit by the river with warm lanterns");
  });

  it("builds a use-case and destination specific production brief", () => {
    const brief = buildAnimationProductionBrief({
      brandInputs: {
        channelName: "Celstate Live",
        colors: ["#C2410C", "warm cream"],
        creatorHandle: "@celstate",
      },
      destination: "runtime_bundle",
      durationSeconds: 4,
      prompt: "tactile slider riding brass rails",
      useCase: "interactive_control",
    });

    expect(brief).toContain("runtime-ready");
    expect(brief).toContain("transparent living interactive-control asset");
    expect(brief).toContain("tactile slider riding brass rails");
    expect(brief).toContain("channel name: Celstate Live");
    expect(brief).toContain("Duration target: 4 seconds");
    expect(brief).toContain("generous transparent padding");
  });

  it("builds a living UI runtime production brief", () => {
    const brief = buildAnimationProductionBrief({
      brandInputs: {
        colors: ["#F5F3ED", "#C2410C"],
      },
      destination: "react_native_runtime",
      durationSeconds: 2,
      prompt: "swaying leaf icon",
      useCase: "small_accent",
    });

    expect(brief).toContain("React-Native-ready");
    expect(brief).toContain("transparent living small-accent asset");
    expect(brief).toContain("sprite sheet");
    expect(brief).toContain("runtime bundle");
    expect(brief).toContain("soft volumetrics");
  });
});
