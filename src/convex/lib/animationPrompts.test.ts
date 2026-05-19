import { describe, expect, it } from "vitest";
import {
  buildAnimationProductionBrief,
  buildVeoMotionPrompt,
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
      destination: "obs_and_video_editor",
      durationSeconds: 4,
      prompt: "cozy forest-spirit raid alert",
      useCase: "stream_alert",
    });

    expect(brief).toContain("OBS-ready and editor-ready");
    expect(brief).toContain("transparent stream alert");
    expect(brief).toContain("cozy forest-spirit raid alert");
    expect(brief).toContain("channel name: Celstate Live");
    expect(brief).toContain("Duration target: 4 seconds");
    expect(brief).toContain("generous transparent padding");
  });

  it("adds source-video constraints to the Veo prompt without exposing model controls", () => {
    const prompt = buildVeoMotionPrompt("Production brief");

    expect(prompt).toContain("Production brief");
    expect(prompt).toContain("alpha reconstruction");
    expect(prompt).not.toContain("model ID");
    expect(prompt).not.toContain("GCS");
  });
});
