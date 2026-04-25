import { describe, expect, it } from "vitest";
import { differenceMatte } from "./matte.js";
import { analyzeTransparentOutput, buildTransparentQaRetryPlan } from "./transparentQa.js";

type Pixel = {
  alpha: number;
  color: [number, number, number];
};

function composePasses(
  width: number,
  height: number,
  sampler: (x: number, y: number) => Pixel,
): {
  whiteBg: Uint8ClampedArray;
  blackBg: Uint8ClampedArray;
} {
  const whiteBg = new Uint8ClampedArray(width * height * 4);
  const blackBg = new Uint8ClampedArray(width * height * 4);

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const { alpha, color } = sampler(x, y);
      const offset = (y * width + x) * 4;
      const alphaFraction = alpha / 255;

      for (let channel = 0; channel < 3; channel++) {
        const premultiplied = Math.round(color[channel] * alphaFraction);
        blackBg[offset + channel] = premultiplied;
        whiteBg[offset + channel] = Math.min(255, premultiplied + (255 - alpha));
      }

      blackBg[offset + 3] = 255;
      whiteBg[offset + 3] = 255;
    }
  }

  return { whiteBg, blackBg };
}

function analyzeFromPasses(args: {
  whiteBg: Uint8ClampedArray;
  blackBg: Uint8ClampedArray;
  width: number;
  height: number;
  prompt: string;
}) {
  const matte = differenceMatte({
    whiteBg: args.whiteBg,
    blackBg: args.blackBg,
    width: args.width,
    height: args.height,
  });

  return analyzeTransparentOutput({
    whiteBg: args.whiteBg,
    blackBg: args.blackBg,
    matte,
    width: args.width,
    height: args.height,
    prompt: args.prompt,
    dimensionMismatch: false,
  });
}

function makeRingSampler(radiusInner: number, radiusOuter: number) {
  return (x: number, y: number): Pixel => {
    const centerX = 32;
    const centerY = 32;
    const dx = x - centerX;
    const dy = y - centerY;
    const distance = Math.sqrt(dx * dx + dy * dy);
    if (distance >= radiusInner && distance <= radiusOuter) {
      return { alpha: 255, color: [214, 111, 52] };
    }
    return { alpha: 0, color: [0, 0, 0] };
  };
}

describe("analyzeTransparentOutput", () => {
  it("passes a clean ring with a persistent interior hole", () => {
    const width = 64;
    const height = 64;
    const { whiteBg, blackBg } = composePasses(width, height, makeRingSampler(10, 18));

    const result = analyzeFromPasses({
      whiteBg,
      blackBg,
      width,
      height,
      prompt: "burnt terracotta ring icon",
    });

    expect(result.decision).toBe("pass");
    expect(result.metrics.persistentHoleCount).toBeGreaterThanOrEqual(1);
    expect(result.reasonCodes).toEqual([]);
  });

  it("routes consistent halo contamination to a black-pass retry", () => {
    const width = 64;
    const height = 64;
    const centerX = 32;
    const centerY = 32;
    const { whiteBg, blackBg } = composePasses(width, height, (x, y) => {
      const dx = x - centerX;
      const dy = y - centerY;
      const distance = Math.sqrt(dx * dx + dy * dy);
      if (distance <= 14) {
        return { alpha: 255, color: [71, 110, 214] };
      }
      if (distance <= 18) {
        const alpha = Math.max(12, Math.round((18 - distance) * 28));
        return { alpha, color: [71, 110, 214] };
      }
      return { alpha: 0, color: [0, 0, 0] };
    });

    const result = analyzeFromPasses({
      whiteBg,
      blackBg,
      width,
      height,
      prompt: "blue sticker silhouette",
    });

    expect(result.decision).toBe("retry_black");
    expect(result.reasonCodes).toContain("external_spill_high");
    expect(result.metrics.externalSpill).toBeGreaterThan(0);
  });

  it("routes dual-pass subject inconsistency to a full rerender", () => {
    const width = 64;
    const height = 64;
    const whitePasses = composePasses(width, height, makeRingSampler(10, 18));
    const blackPasses = composePasses(width, height, (x, y) => makeRingSampler(10, 18)(Math.max(0, x - 2), y));

    const result = analyzeFromPasses({
      whiteBg: whitePasses.whiteBg,
      blackBg: blackPasses.blackBg,
      width,
      height,
      prompt: "terracotta ring icon",
    });

    expect(result.decision).toBe("retry_white_and_black");
    expect(result.reasonCodes).toContain("white_recomposition_residual_high");
    expect(result.reasonCodes).toContain("alpha_residual_high");
  });

  it("routes missing cutouts to a full rerender when the prompt implies a hole", () => {
    const width = 64;
    const height = 64;
    const { whiteBg, blackBg } = composePasses(width, height, (x, y) => {
      const dx = x - 32;
      const dy = y - 32;
      const distance = Math.sqrt(dx * dx + dy * dy);
      if (distance <= 18) {
        return { alpha: 255, color: [214, 111, 52] };
      }
      return { alpha: 0, color: [0, 0, 0] };
    });

    const result = analyzeFromPasses({
      whiteBg,
      blackBg,
      width,
      height,
      prompt: "minimal donut logo mark",
    });

    expect(result.decision).toBe("retry_white_and_black");
    expect(result.reasonCodes).toContain("expected_hole_missing");
    expect(result.metrics.persistentHoleCount).toBe(0);
  });

  it("adds explicit aspect-ratio guidance to a full rerender retry plan", () => {
    const retryPlan = buildTransparentQaRetryPlan("retry_white_and_black", ["dimension_mismatch"]);

    expect(retryPlan.retryInstruction).toContain("canvas aspect ratio identical across both renders");
    expect(retryPlan.downstreamRetryInstruction).toContain("canvas aspect ratio identical across both renders");
  });

  it("does not treat substring matches as hole-risk keywords", () => {
    const width = 64;
    const height = 64;
    const { whiteBg, blackBg } = composePasses(width, height, (x, y) => {
      const dx = x - 32;
      const dy = y - 32;
      const distance = Math.sqrt(dx * dx + dy * dy);
      if (distance <= 18) {
        return { alpha: 255, color: [214, 111, 52] };
      }
      return { alpha: 0, color: [0, 0, 0] };
    });

    const result = analyzeFromPasses({
      whiteBg,
      blackBg,
      width,
      height,
      prompt: "editorial framework poster",
    });

    expect(result.decision).toBe("pass");
    expect(result.reasonCodes).not.toContain("expected_hole_missing");
  });

  it("treats resized dual-pass inputs as a full rerender failure", () => {
    const width = 64;
    const height = 64;
    const { whiteBg, blackBg } = composePasses(width, height, makeRingSampler(10, 18));
    const matte = differenceMatte({
      whiteBg,
      blackBg,
      width,
      height,
    });

    const result = analyzeTransparentOutput({
      whiteBg,
      blackBg,
      matte,
      width,
      height,
      prompt: "burnt terracotta ring icon",
      dimensionMismatch: true,
    });

    expect(result.decision).toBe("retry_white_and_black");
    expect(result.reasonCodes).toContain("dimension_mismatch");
  });

  it("routes nearly full-frame opaque outputs to a full rerender when alpha presence is too low", () => {
    const width = 64;
    const height = 64;
    const { whiteBg, blackBg } = composePasses(width, height, (x, y) => {
      const isTransparentBorder = x === 0 || x === width - 1 || y === 0 || y === height - 1;
      if (isTransparentBorder) {
        return { alpha: 0, color: [0, 0, 0] };
      }
      return { alpha: 255, color: [214, 111, 52] };
    });

    const result = analyzeFromPasses({
      whiteBg,
      blackBg,
      width,
      height,
      prompt: "flat terracotta tile asset",
    });

    expect(result.decision).toBe("retry_white_and_black");
    expect(result.reasonCodes).toContain("alpha_presence_low");
    expect(result.reasonCodes).not.toContain("border_transparency_ratio_low");
  });

  it("routes opaque border occupancy to a full rerender when the canvas edge is not transparent", () => {
    const width = 64;
    const height = 64;
    const { whiteBg, blackBg } = composePasses(width, height, (x, y) => {
      const isOpaqueBorder = x === 0 || x === width - 1 || y === 0 || y === height - 1;
      if (isOpaqueBorder) {
        return { alpha: 255, color: [52, 108, 214] };
      }
      return { alpha: 0, color: [0, 0, 0] };
    });

    const result = analyzeFromPasses({
      whiteBg,
      blackBg,
      width,
      height,
      prompt: "minimal frame icon",
    });

    expect(result.decision).toBe("retry_white_and_black");
    expect(result.reasonCodes).toContain("border_transparency_ratio_low");
    expect(result.reasonCodes).not.toContain("alpha_presence_low");
  });
});
