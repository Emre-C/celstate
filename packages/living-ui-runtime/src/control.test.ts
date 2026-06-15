import { describe, expect, it } from "vitest";
import {
  ACTIVE_BUTTON_PHASES,
  BUTTON_FOLIAGE,
  BUTTON_PRESS,
  DEFAULT_AMBIENT_BREATH,
  KAPPA_PRESS_MAX,
  LIVING_CONTROL_RUNTIME,
  PASSIVE_BUTTON_PHASES,
  PRESS_SPRING_CONFIG,
  RELEASE_SPRING_CONFIG,
  SLIDER_MOSS,
  ambientBreath,
  assertLivingControlManifest,
  buttonTransform,
  buttonVisualMetrics,
  foliageTransform,
  nextButtonPhase,
  normalizeSliderValue,
  pressOutFiresOnPress,
  pressProgressForPhase,
  resolveLayerTints,
  snapSliderValue,
  springStep,
  stepSliderValue,
  thumbXForValue,
  valueForThumbX,
  type ButtonPhase,
  type LivingControlManifest,
  type LivingLayerSpec,
  type SpringState,
} from "./control.js";

/** Integrate the press spring to rest at 60fps, returning the trajectory. */
function springTrajectory(target: number, config = PRESS_SPRING_CONFIG, maxFrames = 600): number[] {
  let state: SpringState = { value: 0, velocity: 0 };
  const trajectory: number[] = [state.value];
  for (let i = 0; i < maxFrames; i++) {
    state = springStep(state, target, config, 1000 / 60);
    trajectory.push(state.value);
    if (state.value === target && state.velocity === 0) {
      break;
    }
  }
  return trajectory;
}

describe("LivingButton transform field (R_button, §3.0)", () => {
  it("keeps the body center invariant across every passive phase (§3.9 fix)", () => {
    const centers = PASSIVE_BUTTON_PHASES.map((phase) =>
      buttonVisualMetrics({ pressProgress: pressProgressForPhase(phase), bodyHeight: 56 }).bodyCenterY,
    );
    for (const center of centers) {
      expect(center).toBeCloseTo(centers[0], 10);
    }
    // Passive bodies are at full rest height — no compression at idle.
    for (const phase of PASSIVE_BUTTON_PHASES) {
      expect(buttonVisualMetrics({ pressProgress: pressProgressForPhase(phase) }).heightScale).toBe(1);
    }
  });

  it("produces a REAL press compression: kappa_press < 1 (vs the §3.9 0.998 failure)", () => {
    for (const phase of ACTIVE_BUTTON_PHASES) {
      const metrics = buttonVisualMetrics({ pressProgress: pressProgressForPhase(phase) });
      expect(metrics.heightScale).toBeLessThanOrEqual(KAPPA_PRESS_MAX);
      expect(metrics.heightScale).toBeLessThan(1);
      expect(metrics.heightScale).toBe(BUTTON_PRESS.scaleY);
    }
    expect(KAPPA_PRESS_MAX).toBeLessThan(1);
  });

  it("squashes and translates monotonically as press progress rises", () => {
    const samples = [0, 0.25, 0.5, 0.75, 1].map((p) => buttonTransform(p));
    for (let i = 1; i < samples.length; i++) {
      expect(samples[i].translateY).toBeGreaterThan(samples[i - 1].translateY);
      expect(samples[i].scaleY).toBeLessThan(samples[i - 1].scaleY);
      expect(samples[i].scaleX).toBeGreaterThan(samples[i - 1].scaleX);
    }
    expect(buttonTransform(0)).toEqual({ translateY: 0, scaleX: 1, scaleY: 1 });
  });

  it("clamps press progress to [0,1]", () => {
    expect(buttonTransform(-5)).toEqual(buttonTransform(0));
    expect(buttonTransform(9)).toEqual(buttonTransform(1));
  });
});

describe("press spring (shared with the RN withSpring config and the web harness)", () => {
  it("converges exactly to its target and then holds at rest", () => {
    const trajectory = springTrajectory(1);
    const settled = trajectory[trajectory.length - 1];
    expect(settled).toBe(1);
    // Reached rest well within a second (the press must feel immediate).
    expect(trajectory.length).toBeLessThan(60);
    // Once snapped to target, a further step does not drift.
    expect(springStep({ value: 1, velocity: 0 }, 1, PRESS_SPRING_CONFIG, 1000 / 60)).toEqual({
      value: 1,
      velocity: 0,
    });
  });

  it("rebounds past rest (squash-and-stretch) but stays bounded", () => {
    const peak = Math.max(...springTrajectory(1, RELEASE_SPRING_CONFIG));
    expect(peak).toBeGreaterThan(1); // underdamped: a real overshoot, not a dead ramp
    expect(peak).toBeLessThan(1.3); // but never a wild, distracting bounce
  });

  it("never integrates to a blow-up when a backgrounded tab hands it a huge dt", () => {
    const state = springStep({ value: 0, velocity: 0 }, 1, PRESS_SPRING_CONFIG, 5000);
    expect(Number.isFinite(state.value)).toBe(true);
    expect(Math.abs(state.value)).toBeLessThan(5);
    // A zero/negative dt is a no-op rather than a NaN.
    expect(springStep({ value: 0.4, velocity: 2 }, 1, PRESS_SPRING_CONFIG, 0)).toEqual({
      value: 0.4,
      velocity: 2,
    });
  });
});

describe("foliage layers (shared ambient config for RN worklets and the harness)", () => {
  it("scales each layer's sway and offsets its phase off the base breath", () => {
    const t = 900;
    const front = foliageTransform(t, BUTTON_FOLIAGE.front);
    const expected = ambientBreath(t, { ...DEFAULT_AMBIENT_BREATH, phase: BUTTON_FOLIAGE.front.phase });
    expect(front.translateY).toBeCloseTo(expected.translateY * BUTTON_FOLIAGE.front.swayScale, 10);
    expect(front.scale).toBeCloseTo(expected.scale, 10);
    // Back and front do not move in lockstep.
    expect(foliageTransform(t, BUTTON_FOLIAGE.back).translateY).not.toBeCloseTo(front.translateY, 3);
    // The moss travels least of all.
    expect(SLIDER_MOSS.swayScale).toBeLessThan(BUTTON_FOLIAGE.front.swayScale);
  });

  it("stays seamless over one period (the §3.5 loop condition is preserved)", () => {
    for (const layer of [BUTTON_FOLIAGE.back, BUTTON_FOLIAGE.front, SLIDER_MOSS]) {
      const start = foliageTransform(0, layer);
      const end = foliageTransform(DEFAULT_AMBIENT_BREATH.periodMs, layer);
      expect(end.translateY).toBeCloseTo(start.translateY, 9);
      expect(end.scale).toBeCloseTo(start.scale, 9);
    }
  });
});

describe("LivingButton state machine (discrete U_button)", () => {
  const drive = (start: ButtonPhase, events: Parameters<typeof nextButtonPhase>[1][]): ButtonPhase =>
    events.reduce((phase, event) => nextButtonPhase(phase, event), start);

  it("walks idle -> press -> hold -> release", () => {
    expect(nextButtonPhase("idle", { type: "pressIn" })).toBe("pressed");
    expect(nextButtonPhase("pressed", { type: "holdElapsed" })).toBe("held");
    expect(nextButtonPhase("held", { type: "pressOut" })).toBe("idle");
    expect(pressOutFiresOnPress("pressed")).toBe(true);
    expect(pressOutFiresOnPress("held")).toBe(true);
  });

  it("cancels (no onPress) when the pointer leaves while pressed or held", () => {
    expect(nextButtonPhase("pressed", { type: "pointerLeave" })).toBe("cancelled");
    expect(nextButtonPhase("held", { type: "pointerLeave" })).toBe("cancelled");
    expect(pressOutFiresOnPress("cancelled")).toBe(false);
    expect(drive("cancelled", [{ type: "settle" }])).toBe("idle");
  });

  it("treats disabled and loading as modal and inert to presses", () => {
    expect(nextButtonPhase("idle", { type: "disabledChange", disabled: true })).toBe("disabled");
    expect(nextButtonPhase("disabled", { type: "pressIn" })).toBe("disabled");
    expect(nextButtonPhase("disabled", { type: "disabledChange", disabled: false })).toBe("idle");

    expect(nextButtonPhase("idle", { type: "loadingChange", loading: true })).toBe("loading");
    expect(nextButtonPhase("loading", { type: "pressIn" })).toBe("loading");
    expect(nextButtonPhase("loading", { type: "loadingChange", loading: false })).toBe("idle");
  });

  it("handles hover and success transitions", () => {
    expect(nextButtonPhase("idle", { type: "hoverIn" })).toBe("hover");
    expect(nextButtonPhase("hover", { type: "hoverOut" })).toBe("idle");
    expect(nextButtonPhase("hover", { type: "pressIn" })).toBe("pressed");
    expect(drive("held", [{ type: "pressOut" }, { type: "successShown" }, { type: "settle" }])).toBe("idle");
  });

  it("every phase is observable from the resting state via some event path", () => {
    // P-gate: idle, pressed, held, cancelled, released(=idle after pressOut), disabled, loading observable.
    expect(nextButtonPhase("idle", { type: "pressIn" })).toBe("pressed");
    expect(drive("idle", [{ type: "pressIn" }, { type: "holdElapsed" }])).toBe("held");
    expect(drive("idle", [{ type: "pressIn" }, { type: "pointerLeave" }])).toBe("cancelled");
    expect(nextButtonPhase("idle", { type: "successShown" })).toBe("success");
  });
});

describe("LivingSlider geometry (value-owned, §3.0 invariant)", () => {
  const track = { start: 16, end: 280 };

  it("thumbX(value) = lerp(trackStart, trackEnd, value), exact within 1px and monotonic", () => {
    let previous = -Infinity;
    for (let i = 0; i <= 10; i++) {
      const value = i / 10;
      const expected = track.start + value * (track.end - track.start);
      const actual = thumbXForValue(value, track);
      expect(Math.abs(actual - expected)).toBeLessThanOrEqual(1);
      expect(actual).toBeGreaterThanOrEqual(previous);
      previous = actual;
    }
    expect(thumbXForValue(0, track)).toBe(track.start);
    expect(thumbXForValue(1, track)).toBe(track.end);
  });

  it("honors a custom range and clamps out-of-range values", () => {
    const range = { min: 0, max: 100 };
    expect(thumbXForValue(50, track, range)).toBeCloseTo(148, 6);
    expect(thumbXForValue(-20, track, range)).toBe(track.start);
    expect(thumbXForValue(200, track, range)).toBe(track.end);
    expect(normalizeSliderValue(25, range)).toBeCloseTo(0.25, 10);
  });

  it("inverts thumbX -> value and round-trips within 1px", () => {
    const range = { min: 0, max: 1 };
    for (let i = 0; i <= 10; i++) {
      const value = i / 10;
      const x = thumbXForValue(value, track, range);
      expect(valueForThumbX(x, track, range)).toBeCloseTo(value, 6);
    }
    // Drag beyond the track clamps to the endpoints.
    expect(valueForThumbX(-100, track, range)).toBe(0);
    expect(valueForThumbX(9999, track, range)).toBe(1);
  });

  it("snaps to a step grid", () => {
    const range = { min: 0, max: 10, step: 2 };
    expect(snapSliderValue(5.4, range)).toBe(6);
    expect(snapSliderValue(0.9, range)).toBe(0);
    expect(snapSliderValue(11, range)).toBe(10);
    expect(valueForThumbX((track.start + track.end) / 2, track, range)).toBe(6);
  });

  it("rejects a degenerate range", () => {
    expect(() => normalizeSliderValue(1, { min: 5, max: 5 })).toThrow();
  });

  it("steps for assistive-tech adjust actions, snapped and clamped (focused half of U_slider)", () => {
    // No explicit step -> a tenth of the span, landing on drag-reachable values.
    expect(stepSliderValue(0.5, 1)).toBeCloseTo(0.6, 10);
    expect(stepSliderValue(0.5, -1)).toBeCloseTo(0.4, 10);
    // Honors an explicit step: from an on-grid value (the component always
    // feeds back a snapped value) an adjust moves exactly one cell.
    const stepped = { min: 0, max: 10, step: 2 };
    expect(stepSliderValue(4, 1, stepped)).toBe(6);
    expect(stepSliderValue(4, -1, stepped)).toBe(2);
    // Clamps at the ends rather than running past them.
    expect(stepSliderValue(1, 1)).toBe(1);
    expect(stepSliderValue(0, -1)).toBe(0);
    expect(() => stepSliderValue(0, 1, { min: 5, max: 5 })).toThrow();
  });
});

describe("ambient motion (Path C, seamless loop §3.5)", () => {
  it("returns to its start over one period (seam is continuous)", () => {
    const start = ambientBreath(0);
    const end = ambientBreath(DEFAULT_AMBIENT_BREATH.periodMs);
    expect(end.translateY).toBeCloseTo(start.translateY, 9);
    expect(end.scale).toBeCloseTo(start.scale, 9);
  });

  it("stays within its configured amplitude", () => {
    for (let t = 0; t <= DEFAULT_AMBIENT_BREATH.periodMs; t += 50) {
      const out = ambientBreath(t);
      expect(Math.abs(out.translateY)).toBeLessThanOrEqual(DEFAULT_AMBIENT_BREATH.swayDp + 1e-9);
      expect(Math.abs(out.scale - 1)).toBeLessThanOrEqual(DEFAULT_AMBIENT_BREATH.scaleAmplitude + 1e-9);
    }
  });

  it("phase-offsets layers so they do not move in lockstep", () => {
    const a = ambientBreath(0, { ...DEFAULT_AMBIENT_BREATH, phase: 0 });
    const b = ambientBreath(0, { ...DEFAULT_AMBIENT_BREATH, phase: 0.25 });
    expect(a.translateY).not.toBeCloseTo(b.translateY, 3);
  });
});

describe("theming — manifest tokens applied by the runtime (§9.5)", () => {
  const layers: readonly LivingLayerSpec[] = [
    { id: "body", role: "structural" },
    { id: "shadow", role: "structural" },
    { id: "foliage", role: "tintable", token: "accent" },
    { id: "glow", role: "tintable", token: "surface" },
  ];

  it("leaves structural layers untouched and multiplies tintable layers", () => {
    const tints = resolveLayerTints(layers, { accent: "#C2410C", surface: "#F5F3ED" });
    expect(tints).toEqual([
      { layerId: "body", mode: "none", tintColor: null },
      { layerId: "shadow", mode: "none", tintColor: null },
      { layerId: "foliage", mode: "multiply", tintColor: "#C2410C" },
      { layerId: "glow", mode: "multiply", tintColor: "#F5F3ED" },
    ]);
  });

  it("reskins deterministically across >= 3 host palettes (G-gate row)", () => {
    const palettes = [
      { accent: "#C2410C", surface: "#F5F3ED" },
      { accent: "#166534", surface: "#F0FDF4" },
      { accent: "#1E40AF", surface: "#EFF6FF" },
    ];
    const accents = palettes.map(
      (tokens) => resolveLayerTints(layers, tokens).find((t) => t.layerId === "foliage")?.tintColor,
    );
    expect(new Set(accents).size).toBe(3);
  });

  it("rejects a tintable layer whose token is absent from the palette", () => {
    expect(() => resolveLayerTints(layers, { accent: "#C2410C" })).toThrow();
    expect(() => resolveLayerTints([{ id: "x", role: "tintable" }], { accent: "#000" })).toThrow();
  });
});

describe("control bundle manifest contract (§5.1)", () => {
  const buttonManifest: LivingControlManifest = {
    pipeline: LIVING_CONTROL_RUNTIME,
    schemaVersion: 1,
    primitive: "button",
    component: "CelstateLivingButton",
    label: "Living Button",
    states: ["idle", "hover", "pressed", "held", "cancelled", "released", "disabled", "loading", "success"],
    props: [
      { name: "label", type: "string", required: true, description: "Button text." },
      { name: "onPress", type: "() => void", required: true, description: "Fires on committed release." },
      { name: "disabled", type: "boolean", required: false, description: "Modal disabled state." },
      { name: "loading", type: "boolean", required: false, description: "Modal loading state." },
    ],
    layers: [
      { id: "body", role: "structural" },
      { id: "foliageFront", role: "tintable", token: "accent" },
      { id: "foliageBack", role: "tintable", token: "accent" },
    ],
    dimensions: { widthDp: 220, heightDp: 56, densityMax: 3 },
    timing: { pressInMs: 90, releaseMs: 220, holdThresholdMs: 350, ambientPeriodMs: 4200 },
    themeTokens: { accent: "#C2410C", surface: "#F5F3ED" },
    motionPath: "procedural_still",
    generatedAt: "2026-06-14T00:00:00.000Z",
    assets: {
      body: "assets/body.png",
      foliageFront: "assets/foliage-front.png",
      foliageBack: "assets/foliage-back.png",
    },
  };

  const sliderManifest: LivingControlManifest = {
    pipeline: LIVING_CONTROL_RUNTIME,
    schemaVersion: 1,
    primitive: "slider",
    component: "CelstateLivingSlider",
    label: "Living Slider",
    states: ["value", "dragging", "disabled", "focused"],
    props: [
      { name: "value", type: "number", required: true, description: "Current value." },
      { name: "onValueChange", type: "(v: number) => void", required: true, description: "Drag callback." },
    ],
    layers: [
      { id: "rail", role: "structural" },
      { id: "thumb", role: "structural" },
      { id: "moss", role: "tintable", token: "accent" },
    ],
    dimensions: { widthDp: 296, heightDp: 44, densityMax: 3 },
    timing: { pressInMs: 60, releaseMs: 180, holdThresholdMs: 350, ambientPeriodMs: 5200 },
    themeTokens: { accent: "#C2410C" },
    motionPath: "procedural_still",
    generatedAt: "2026-06-14T00:00:00.000Z",
    assets: { rail: "assets/rail.png", thumb: "assets/thumb.png", moss: "assets/moss.png" },
  };

  it("accepts valid button and slider manifests", () => {
    expect(() => assertLivingControlManifest(buttonManifest)).not.toThrow();
    expect(() => assertLivingControlManifest(sliderManifest)).not.toThrow();
  });

  it("rejects a control sourced from a sprite sheet (Path A) — §12 durable lesson", () => {
    expect(() =>
      assertLivingControlManifest({ ...buttonManifest, motionPath: "generated_sprite_sheet" }),
    ).toThrow(/procedural_still or rigged_deformation/);
  });

  it("rejects a button manifest missing a required observable state", () => {
    expect(() =>
      assertLivingControlManifest({
        ...buttonManifest,
        states: buttonManifest.states.filter((s) => s !== "held"),
      }),
    ).toThrow(/held/);
  });

  it("rejects a layer with no backing asset file", () => {
    const { foliageBack: _omitted, ...assets } = buttonManifest.assets;
    expect(() => assertLivingControlManifest({ ...buttonManifest, assets })).toThrow(/foliageBack/);
  });

  it("rejects a tintable layer whose token is missing from the default palette", () => {
    expect(() =>
      assertLivingControlManifest({ ...buttonManifest, themeTokens: { surface: "#F5F3ED" } }),
    ).toThrow();
  });

  it("accepts an authored-rig (Path B) control", () => {
    expect(() =>
      assertLivingControlManifest({ ...buttonManifest, motionPath: "rigged_deformation" }),
    ).not.toThrow();
  });

  it("accepts procedural (model-free) layers with no raster assets", () => {
    const procedural: LivingControlManifest = {
      ...buttonManifest,
      layers: [
        { id: "body", role: "structural", source: "procedural" },
        { id: "foliageFront", role: "tintable", token: "accent", source: "procedural" },
        { id: "foliageBack", role: "tintable", token: "accent", source: "procedural" },
      ],
      assets: {},
    };
    expect(() => assertLivingControlManifest(procedural)).not.toThrow();
  });
});
