import { describe, expect, it } from "vitest";
import {
  normalizeLottieJsonForStorage,
  parseLottieModelResponse,
  validateLottieDocument,
} from "./lottieValidation.js";

function validLottie() {
  return {
    v: "5.7.0",
    fr: 60,
    ip: 0,
    op: 240,
    w: 512,
    h: 512,
    nm: "Terracotta leaf",
    assets: [],
    layers: [
      {
        ty: 4,
        nm: "leaf",
        ip: 0,
        op: 240,
        st: 0,
        ks: {
          o: { a: 0, k: 100 },
          r: { a: 0, k: 0 },
          a: { a: 0, k: [0, 0, 0] },
          s: { a: 0, k: [100, 100, 100] },
          p: { a: 0, k: [256, 256, 0] },
        },
        shapes: [
          {
            ty: "gr",
            nm: "leaf group",
            it: [
              { ty: "el", p: { a: 0, k: [0, 0] }, s: { a: 0, k: [120, 80] } },
              { ty: "fl", c: { a: 0, k: [0.76, 0.25, 0.05, 1] }, o: { a: 0, k: 100 } },
              {
                ty: "tr",
                p: { a: 0, k: [0, 0] },
                a: { a: 0, k: [0, 0] },
                s: { a: 0, k: [100, 100] },
                r: { a: 0, k: 0 },
                o: { a: 0, k: 100 },
              },
            ],
          },
        ],
      },
    ],
  };
}

describe("lottieValidation", () => {
  it("parses structured Gemini lottie_json responses", () => {
    const parsed = parseLottieModelResponse(JSON.stringify({
      lottie_json: JSON.stringify(validLottie()),
      notes: ["ok"],
    }));

    expect(parsed.lottie).toMatchObject({ nm: "Terracotta leaf" });
    expect(parsed.rawLottieJson).toContain("Terracotta leaf");
  });

  it("accepts a vector-only transparent Lottie document", () => {
    const result = validateLottieDocument({
      aspectRatio: "1:1",
      durationSeconds: 4,
      fps: 60,
      lottie: validLottie(),
    });

    expect(result.decision).toBe("pass");
    expect(result.errors).toEqual([]);
  });

  it("rejects external assets, text layers, timing drift, and slot-only values", () => {
    const lottie = {
      ...validLottie(),
      op: 180,
      assets: [{ id: "image_0", p: "asset.png" }],
      layers: [
        {
          ty: 5,
          nm: "text",
          ip: 0,
          op: 180,
          ks: { o: { sid: "opacitySlot", x: "time * 10" } },
        },
      ],
    };

    const result = validateLottieDocument({
      aspectRatio: "1:1",
      durationSeconds: 4,
      fps: 60,
      lottie,
    });

    expect(result.decision).toBe("fail");
    expect(result.errors).toEqual(
      expect.arrayContaining([
        "End frame op must be 240",
        "V1 Lottie output must be vector-only and cannot contain assets",
      ]),
    );
    expect(result.errors.some((error) => error.includes("sid"))).toBe(true);
    expect(result.errors.some((error) => error.includes("expression string"))).toBe(true);
    expect(normalizeLottieJsonForStorage(validLottie()).endsWith("\n")).toBe(true);
  });

  it("rejects flat shapes not wrapped in groups and groups missing trailing transforms", () => {
    const lottie = {
      ...validLottie(),
      layers: [
        {
          ty: 4,
          nm: "bad-layer",
          ip: 0,
          op: 240,
          st: 0,
          ks: {
            o: { a: 0, k: 100 },
            p: { a: 0, k: [256, 256, 0] },
          },
          shapes: [
            { ty: "el", p: { a: 0, k: [0, 0] }, s: { a: 0, k: [100, 100] } },
            {
              ty: "gr",
              nm: "group-no-tr",
              it: [
                { ty: "el", p: { a: 0, k: [0, 0] }, s: { a: 0, k: [50, 50] } },
                { ty: "fl", c: { a: 0, k: [1, 0, 0, 1] }, o: { a: 0, k: 100 } },
              ],
            },
          ],
        },
      ],
    };

    const result = validateLottieDocument({
      aspectRatio: "1:1",
      durationSeconds: 4,
      fps: 60,
      lottie,
    });

    expect(result.decision).toBe("fail");
    expect(result.errors.some((e) => e.includes('not wrapped in a group (ty: "gr")'))).toBe(true);
    expect(result.errors.some((e) => e.includes('must end with a transform (ty: "tr")'))).toBe(true);
  });

  it("rejects nested groups missing trailing transforms", () => {
    const lottie = {
      ...validLottie(),
      layers: [
        {
          ty: 4,
          nm: "nested-group-layer",
          ip: 0,
          op: 240,
          st: 0,
          ks: {
            o: { a: 0, k: 100 },
            p: { a: 0, k: [256, 256, 0] },
          },
          shapes: [
            {
              ty: "gr",
              nm: "outer-group",
              it: [
                {
                  ty: "gr",
                  nm: "inner-group-no-tr",
                  it: [
                    { ty: "el", p: { a: 0, k: [0, 0] }, s: { a: 0, k: [50, 50] } },
                    { ty: "fl", c: { a: 0, k: [1, 0, 0, 1] }, o: { a: 0, k: 100 } },
                  ],
                },
                { ty: "fl", c: { a: 0, k: [0.76, 0.25, 0.05, 1] }, o: { a: 0, k: 100 } },
                {
                  ty: "tr",
                  p: { a: 0, k: [0, 0] },
                  a: { a: 0, k: [0, 0] },
                  s: { a: 0, k: [100, 100] },
                  r: { a: 0, k: 0 },
                  o: { a: 0, k: 100 },
                },
              ],
            },
          ],
        },
      ],
    };

    const result = validateLottieDocument({
      aspectRatio: "1:1",
      durationSeconds: 4,
      fps: 60,
      lottie,
    });

    expect(result.decision).toBe("fail");
    expect(result.errors.some((e) => e.includes("nested group 0") && e.includes('must end with a transform (ty: "tr")'))).toBe(true);
  });
});
