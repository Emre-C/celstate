import { describe, expect, it } from "vitest";
import {
  ambientDrift,
  pressReaction,
  DEFAULT_FIREFLY_DRIFT,
} from "./control.js";
import {
  livingPalette,
  mix,
  parseHex,
  shade,
  sproutOpenness,
  tint,
  withAlpha,
  SLIDER_SPROUTS,
} from "./art.js";

describe("colour math (one accent -> a living palette)", () => {
  it("parses #RGB and #RRGGBB and rejects junk", () => {
    expect(parseHex("#fff")).toEqual([255, 255, 255]);
    expect(parseHex("#C2410C")).toEqual([194, 65, 12]);
    expect(parseHex("rgb(1,2,3)")).toBeNull();
    expect(parseHex("#12")).toBeNull();
  });

  it("mixes, shades, tints, and adds alpha deterministically", () => {
    expect(mix("#000000", "#ffffff", 0.5)).toBe("#808080");
    expect(shade("#C2410C", 0)).toBe("#c2410c");
    expect(tint("#000000", 1)).toBe("#ffffff");
    expect(withAlpha("#C2410C", 0.5)).toBe("#c2410c80");
    expect(withAlpha("#C2410C", 0)).toBe("#c2410c00");
    // Invalid input is returned unchanged rather than throwing.
    expect(withAlpha("transparent", 0.5)).toBe("transparent");
  });

  it("derives a coherent palette that shifts with the host accent", () => {
    const a = livingPalette("#C2410C");
    const b = livingPalette("#1E40AF");
    // Deep is darker than accent, bright is lighter (a real depth ramp).
    expect(parseHex(a.accentDeep)![0]).toBeLessThan(parseHex(a.accent)![0]);
    expect(parseHex(a.accentBright)![0]).toBeGreaterThan(parseHex(a.accent)![0]);
    // The whole palette reskins with the accent — no two accents share a leaf.
    expect(a.leaf).not.toBe(b.leaf);
    expect(a.glow).not.toBe(b.glow);
  });
});

describe("firefly drift (ambient micro-life, §3.5 seamless)", () => {
  it("returns to its start over one loop and stays within its radii", () => {
    const start = ambientDrift(0);
    const end = ambientDrift(DEFAULT_FIREFLY_DRIFT.periodMs);
    expect(end.x).toBeCloseTo(start.x, 9);
    expect(end.y).toBeCloseTo(start.y, 9);
    expect(end.glow).toBeCloseTo(start.glow, 9);
    for (let t = 0; t <= DEFAULT_FIREFLY_DRIFT.periodMs; t += 60) {
      const d = ambientDrift(t);
      expect(Math.abs(d.x)).toBeLessThanOrEqual(DEFAULT_FIREFLY_DRIFT.radiusX + 1e-9);
      expect(Math.abs(d.y)).toBeLessThanOrEqual(DEFAULT_FIREFLY_DRIFT.radiusY + 1e-9);
      expect(d.glow).toBeGreaterThanOrEqual(-1e-9);
      expect(d.glow).toBeLessThanOrEqual(1 + 1e-9);
    }
  });

  it("actually moves in 2D (not a degenerate line)", () => {
    const xs = new Set<number>();
    const ys = new Set<number>();
    for (let i = 0; i < 8; i++) {
      const d = ambientDrift((DEFAULT_FIREFLY_DRIFT.periodMs * i) / 8);
      xs.add(+d.x.toFixed(3));
      ys.add(+d.y.toFixed(3));
    }
    expect(xs.size).toBeGreaterThan(2);
    expect(ys.size).toBeGreaterThan(2);
  });
});

describe("press reaction (the surround reacts in lockstep with the squash)", () => {
  it("recoils, blooms, and dampens breath as press rises; rest is inert", () => {
    expect(pressReaction(0)).toEqual({ recoilDp: 0, bloom: 0, breathDamping: 1 });
    const mid = pressReaction(0.5);
    const full = pressReaction(1);
    expect(full.recoilDp).toBeGreaterThan(mid.recoilDp);
    expect(full.bloom).toBeGreaterThan(mid.bloom);
    expect(full.breathDamping).toBeLessThan(mid.breathDamping); // life holds its breath
    expect(full.breathDamping).toBeGreaterThan(0);
    // Clamps out-of-range progress.
    expect(pressReaction(5)).toEqual(pressReaction(1));
  });
});

describe("slider sprouts (value bound to visible growth)", () => {
  it("blooms each sprout only after the value passes it", () => {
    const first = SLIDER_SPROUTS[0].at;
    expect(sproutOpenness(0, first)).toBe(0); // nothing grown at value 0
    expect(sproutOpenness(first, first)).toBe(0); // just reached -> still closed
    expect(sproutOpenness(first + 0.2, first)).toBe(1); // well past -> fully open
    // Monotonic non-decreasing in value.
    let prev = -1;
    for (let v = 0; v <= 1.0001; v += 0.1) {
      const o = sproutOpenness(v, 0.5);
      expect(o).toBeGreaterThanOrEqual(prev);
      prev = o;
    }
    // At value 1 every sprout is open -> the whole vine is grown.
    for (const s of SLIDER_SPROUTS) {
      expect(sproutOpenness(1, s.at)).toBe(1);
    }
  });
});
