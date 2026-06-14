import { describe, expect, it } from "vitest";
import {
  LIVING_UI_PIPELINE,
  assertLivingUiManifest,
  chooseSpriteSheetExport,
  frameIndexAtTimeMs,
  getRightSizeResult,
  getSpriteFrameRect,
  getSpriteSheetTranslate,
  normalizeFrameRange,
  type LivingUiManifest,
} from "./index.js";

const manifest = {
  assetClass: "small_accent",
  assetLabel: "Small accent / icon",
  aspectRatio: "1:1",
  destination: "react_native_runtime",
  durationSeconds: 2,
  exports: {
    apng: "preview.apng",
    frames: "frames.zip",
    spriteSheetPng: "sheet.png",
    spriteSheetWebp: "sheet.webp",
    webm: "preview.webm",
  },
  fps: 24,
  frameCount: 48,
  generatedAt: "2026-06-14T00:00:00.000Z",
  height: 512,
  motionPath: "procedural_still",
  pipeline: LIVING_UI_PIPELINE,
  prompt: "swaying leaf icon",
  runtime: {
    component: "LivingAccent",
    densityMax: 3,
    displayDpMax: 48,
    interaction: "loop",
    rightSizeMaxScale: 0.28125,
    rightSizePass: true,
    targets: ["react-native", "web-preview"],
  },
  schemaVersion: 1,
  spriteSheet: {
    cellHeight: 512,
    cellWidth: 512,
    cols: 4,
    fps: 12,
    frameCount: 12,
    height: 1536,
    pngBytes: 1000,
    rows: 3,
    webpBytes: 800,
    width: 2048,
  },
  useCase: "small_accent",
  width: 512,
} satisfies LivingUiManifest;

describe("living UI runtime manifest helpers", () => {
  it("validates the worker manifest contract", () => {
    expect(() => assertLivingUiManifest(manifest)).not.toThrow();
  });

  it("prefers the WebP sprite sheet export", () => {
    expect(chooseSpriteSheetExport(manifest)).toEqual({
      format: "webp",
      path: "sheet.webp",
    });
  });

  it("computes looped frame indexes with optional ranges", () => {
    expect(frameIndexAtTimeMs({ elapsedMs: 0, fps: 12, frameCount: 12 })).toBe(0);
    expect(frameIndexAtTimeMs({ elapsedMs: 1000, fps: 12, frameCount: 12 })).toBe(0);
    expect(frameIndexAtTimeMs({
      elapsedMs: 500,
      fps: 12,
      frameCount: 12,
      frameRange: { end: 7, start: 4 },
    })).toBe(6);
    expect(frameIndexAtTimeMs({
      elapsedMs: 500,
      fps: 12,
      frameCount: 12,
      frameRange: { end: 7, start: 4 },
      reverse: true,
    })).toBe(5);
  });

  it("normalizes invalid frame ranges into the manifest bounds", () => {
    expect(normalizeFrameRange(12, { end: 99, start: -10 })).toEqual({
      end: 11,
      start: 0,
    });
  });

  it("maps frame indexes to sprite cells and translation offsets", () => {
    expect(getSpriteFrameRect(manifest.spriteSheet, 6)).toEqual({
      col: 2,
      height: 512,
      index: 6,
      row: 1,
      width: 512,
      x: 1024,
      y: 512,
    });
    expect(getSpriteSheetTranslate(manifest.spriteSheet, 6)).toEqual({
      translateX: -1024,
      translateY: -512,
    });
  });

  it("calculates the right-size pass/fail boundary", () => {
    expect(getRightSizeResult({
      cellHeight: 512,
      cellWidth: 512,
      density: 3,
      displayWidthDp: 48,
    })).toMatchObject({
      pass: true,
      requiredHeightPx: 144,
      requiredWidthPx: 144,
    });
    expect(getRightSizeResult({
      cellHeight: 512,
      cellWidth: 512,
      density: 3,
      displayWidthDp: 256,
    })).toMatchObject({
      pass: false,
      requiredHeightPx: 768,
      requiredWidthPx: 768,
    });
  });
});
