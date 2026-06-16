/**
 * Living UI control core — the runtime-owned, model-free behaviour layer.
 *
 * Per LIVING-UI-ANIMATION-SPIKE.html §3.0, a UI control is not an animation: it
 * is a stateful function with visual output. The §3.9 capability result proved
 * generated sprite sheets cannot reliably own UI semantics (a button that does
 * not compress, `kappa_press = 0.998`), so controls are runtime-owned from the
 * start (§6, Path C). This module is the deterministic half of that contract:
 *
 *   Primitive P  = (U, Props, Theme, A, R)
 *   R_P          : U x Props x Theme x t -> transforms
 *   visual(t)    = compose(A, R_P(u(t), props, theme, t))
 *
 * Everything here is pure and framework-free. The React Native components in
 * `react-native.tsx` are thin Reanimated worklet shells that drive shared values
 * into these functions; keeping the behaviour pure is what makes the §7 P-gate
 * invariants (press compression, passive-center stability, slider exactness,
 * theming) machine-verifiable rather than a matter of taste.
 */

export const LIVING_CONTROL_RUNTIME = "celstate_living_ui_control_v1" as const;

// ---------------------------------------------------------------------------
// Shared scalar helpers
// ---------------------------------------------------------------------------

export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export function clamp01(value: number): number {
  return clamp(value, 0, 1);
}

export function lerp(from: number, to: number, t: number): number {
  return from + (to - from) * t;
}

// ---------------------------------------------------------------------------
// Button primitive — U_button and its transform field R_button
// ---------------------------------------------------------------------------

/**
 * U_button (§3.0). `pressed` and `held` are the active (compressing) states;
 * every other phase is passive and must share one resting transform so the body
 * center is invariant across passive frames (the §3.9 failure was passive frames
 * that drifted).
 */
export const BUTTON_PHASES = [
  "idle",
  "hover",
  "pressed",
  "held",
  "cancelled",
  "disabled",
  "loading",
  "success",
] as const;

export type ButtonPhase = (typeof BUTTON_PHASES)[number];

/** Phases in which the body is at rest (no press deformation applied). */
export const PASSIVE_BUTTON_PHASES: readonly ButtonPhase[] = [
  "idle",
  "hover",
  "cancelled",
  "disabled",
  "loading",
  "success",
];

/** Phases in which the body is actively pressed (compression target = 1). */
export const ACTIVE_BUTTON_PHASES: readonly ButtonPhase[] = ["pressed", "held"];

export type ButtonEvent =
  | { readonly type: "hoverIn" }
  | { readonly type: "hoverOut" }
  | { readonly type: "pressIn" }
  | { readonly type: "pressOut" } // released inside bounds -> fires onPress
  | { readonly type: "pointerLeave" } // dragged out -> cancel, no onPress
  | { readonly type: "holdElapsed" } // long-press threshold reached
  | { readonly type: "loadingChange"; readonly loading: boolean }
  | { readonly type: "disabledChange"; readonly disabled: boolean }
  | { readonly type: "successShown" }
  | { readonly type: "settle" }; // transient phase -> resting idle

/**
 * Press deformation constants. Squash-and-stretch: the body widens slightly and
 * compresses vertically while translating down, the way a physical key travels.
 * `kappa_press` is the height ratio at full press and MUST be < 1 — the explicit
 * fix for the §3.9 `kappa = 0.998` "no real press deformation" failure.
 */
export const BUTTON_PRESS = {
  /** translateY (dp) added at full press — the key travels down into the surface. */
  translateY: 3,
  /** scaleX at full press — slight widen (squash). */
  scaleX: 1.025,
  /** scaleY at full press — the compression ratio kappa_press. */
  scaleY: 0.92,
} as const;

/** Upper bound on the press height ratio for a press to count as "real" (§3.0). */
export const KAPPA_PRESS_MAX = 0.94;

export interface ButtonTransform {
  readonly translateY: number;
  readonly scaleX: number;
  readonly scaleY: number;
}

export interface ButtonVisualMetrics {
  readonly transform: ButtonTransform;
  /** Vertical center of the body after the transform, given a base center. */
  readonly bodyCenterY: number;
  /** Height ratio vs the resting body (scaleY); <= KAPPA_PRESS_MAX when pressed. */
  readonly heightScale: number;
}

/**
 * Continuous press progress target for a phase: 1 while actively pressed, 0 at
 * rest. The React Native shell springs the live shared value toward this target;
 * the rebound/overshoot is the spring's job, not a keyframe.
 */
export function pressProgressForPhase(phase: ButtonPhase): number {
  return ACTIVE_BUTTON_PHASES.includes(phase) ? 1 : 0;
}

/**
 * R_button: map a continuous press progress p in [0,1] to the transform field.
 * Scaling is about the body center, so a passive body (p = 0) keeps the resting
 * center exactly; only the press translateY moves it.
 */
export function buttonTransform(pressProgress: number): ButtonTransform {
  const p = clamp01(pressProgress);
  return {
    translateY: lerp(0, BUTTON_PRESS.translateY, p),
    scaleX: lerp(1, BUTTON_PRESS.scaleX, p),
    scaleY: lerp(1, BUTTON_PRESS.scaleY, p),
  };
}

export interface ButtonVisualInput {
  readonly pressProgress: number;
  /** Resting vertical center of the body in dp (defaults to half of bodyHeight). */
  readonly baseCenterY?: number;
  readonly bodyHeight?: number;
}

/** Full visual metrics for a press progress — what tests assert against. */
export function buttonVisualMetrics(input: ButtonVisualInput): ButtonVisualMetrics {
  const bodyHeight = assertPositive(input.bodyHeight ?? 56, "bodyHeight");
  const baseCenterY = input.baseCenterY ?? bodyHeight / 2;
  const transform = buttonTransform(input.pressProgress);
  return {
    bodyCenterY: baseCenterY + transform.translateY,
    heightScale: transform.scaleY,
    transform,
  };
}

// ---------------------------------------------------------------------------
// Press spring — the single source of truth for press/release physics
// ---------------------------------------------------------------------------

/**
 * Spring parameters shared by every surface that animates press progress. The
 * React Native shell feeds these straight into Reanimated's native `withSpring`;
 * the web/measurement harness feeds them into `springStep` below. Both surfaces
 * therefore animate the *same documented spring*, not divergent hand-tuned
 * constants — that is what makes the rebound "feel" measured on the web proxy a
 * faithful read of the on-device config rather than a re-tuned look-alike.
 */
export interface SpringConfig {
  readonly damping: number;
  readonly mass: number;
  readonly stiffness: number;
}

/** Press-in: snappier (lower mass, higher stiffness) for an immediate key travel. */
export const PRESS_SPRING_CONFIG: SpringConfig = { damping: 18, mass: 0.7, stiffness: 320 };
/** Release: a touch looser so the body rebounds past rest before settling. */
export const RELEASE_SPRING_CONFIG: SpringConfig = { damping: 12, mass: 0.9, stiffness: 220 };

export interface SpringState {
  readonly value: number;
  readonly velocity: number;
}

/** Below these thresholds the spring is treated as at rest and snapped exactly. */
const SPRING_REST_DISPLACEMENT = 1e-3;
const SPRING_REST_VELOCITY = 1e-3;
/** Cap the step so a backgrounded tab (huge dt) cannot integrate to a blow-up. */
const SPRING_MAX_STEP_MS = 32;

/**
 * One semi-implicit Euler step of a damped harmonic oscillator toward `target`.
 * Deterministic and framework-free, so the harness rebound is testable and the
 * physics lives here rather than as loose numbers in a `<script>`.
 */
export function springStep(
  state: SpringState,
  target: number,
  config: SpringConfig,
  dtMs: number,
): SpringState {
  const dt = clamp(dtMs, 0, SPRING_MAX_STEP_MS) / 1000;
  if (dt === 0) {
    return state;
  }
  const accel = (config.stiffness * (target - state.value) - config.damping * state.velocity) / config.mass;
  const velocity = state.velocity + accel * dt;
  const value = state.value + velocity * dt;
  if (Math.abs(target - value) < SPRING_REST_DISPLACEMENT && Math.abs(velocity) < SPRING_REST_VELOCITY) {
    return { value: target, velocity: 0 };
  }
  return { value, velocity };
}

/**
 * The button state machine (the discrete half of U_button). Pure reducer so
 * hold / cancel / release semantics are testable without a device. `disabled`
 * and `loading` are modal: while set, presses are inert.
 */
export function nextButtonPhase(phase: ButtonPhase, event: ButtonEvent): ButtonPhase {
  // Modal overrides apply from any phase.
  if (event.type === "disabledChange") {
    return event.disabled ? "disabled" : "idle";
  }
  if (event.type === "loadingChange") {
    return event.loading ? "loading" : "idle";
  }
  if (phase === "disabled" || phase === "loading") {
    // Inert to pointer events until the modal flag clears.
    return phase;
  }

  switch (event.type) {
    case "hoverIn":
      return phase === "idle" ? "hover" : phase;
    case "hoverOut":
      return phase === "hover" ? "idle" : phase;
    case "pressIn":
      return phase === "idle" || phase === "hover" ? "pressed" : phase;
    case "holdElapsed":
      return phase === "pressed" ? "held" : phase;
    case "pressOut":
      // Release inside bounds: the press is committed; settle to rest.
      return phase === "pressed" || phase === "held" ? "idle" : phase;
    case "pointerLeave":
      return phase === "pressed" || phase === "held" ? "cancelled" : phase;
    case "successShown":
      return "success";
    case "settle":
      return phase === "cancelled" || phase === "success" ? "idle" : phase;
    default:
      return phase;
  }
}

/** Whether a release in this phase should fire the caller's onPress. */
export function pressOutFiresOnPress(phase: ButtonPhase): boolean {
  return phase === "pressed" || phase === "held";
}

// ---------------------------------------------------------------------------
// Slider primitive — value-owned geometry (§3.0 slider invariant)
// ---------------------------------------------------------------------------

/** Thumb geometry, shared by the RN component, the web harness, and tests. */
export const SLIDER_THUMB_DIAMETER = 28;
export const SLIDER_THUMB_RADIUS = SLIDER_THUMB_DIAMETER / 2;

export interface SliderTrack {
  /** Thumb-center x (dp) at value = min. */
  readonly start: number;
  /** Thumb-center x (dp) at value = max. */
  readonly end: number;
}

export interface SliderRange {
  readonly min: number;
  readonly max: number;
  /** Optional snap increment in value units. */
  readonly step?: number;
}

export const DEFAULT_SLIDER_RANGE: SliderRange = { min: 0, max: 1 };

/** Normalize a value to [0,1] within its range. */
export function normalizeSliderValue(value: number, range: SliderRange = DEFAULT_SLIDER_RANGE): number {
  const span = range.max - range.min;
  if (!(span > 0)) {
    throw new Error("slider range max must be greater than min");
  }
  return clamp01((value - range.min) / span);
}

/**
 * The slider invariant (§3.0): thumbX(value) = lerp(trackStart, trackEnd, value).
 * Exact and monotonic in value — the position is a function of the value, never
 * sprite-owned.
 */
export function thumbXForValue(
  value: number,
  track: SliderTrack,
  range: SliderRange = DEFAULT_SLIDER_RANGE,
): number {
  return lerp(track.start, track.end, normalizeSliderValue(value, range));
}

/** Snap a value to the range's step grid (if any) and clamp into [min,max]. */
export function snapSliderValue(value: number, range: SliderRange = DEFAULT_SLIDER_RANGE): number {
  const clamped = clamp(value, range.min, range.max);
  if (!range.step || !(range.step > 0)) {
    return clamped;
  }
  const steps = Math.round((clamped - range.min) / range.step);
  return clamp(range.min + steps * range.step, range.min, range.max);
}

/**
 * Inverse mapping for drag: thumb-center x (dp) -> value, snapped and clamped.
 * Monotonic non-decreasing in x.
 */
export function valueForThumbX(
  x: number,
  track: SliderTrack,
  range: SliderRange = DEFAULT_SLIDER_RANGE,
): number {
  const span = track.end - track.start;
  const t = span === 0 ? 0 : clamp01((x - track.start) / span);
  return snapSliderValue(range.min + t * (range.max - range.min), range);
}

/** Default keyboard/assistive nudge when a range declares no explicit step. */
export const SLIDER_DEFAULT_STEPS = 10;

/**
 * Move a value by one increment for an assistive-technology adjust action
 * (`direction` = +1 / -1). Uses the range's `step` when present, else a tenth of
 * the span, then snaps and clamps through the same tested mapping the drag uses —
 * so screen-reader adjustment lands on exactly the values a drag can reach. This
 * is the §3.0 `focused ∈ Bool` half of U_slider made operable, not just visible.
 *
 * `value` is expected to be the current (already-snapped) slider value, which is
 * the invariant the component maintains by feeding every change back through
 * `valueForThumbX` / `snapSliderValue`.
 */
export function stepSliderValue(
  value: number,
  direction: 1 | -1,
  range: SliderRange = DEFAULT_SLIDER_RANGE,
): number {
  const span = range.max - range.min;
  if (!(span > 0)) {
    throw new Error("slider range max must be greater than min");
  }
  const increment = range.step && range.step > 0 ? range.step : span / SLIDER_DEFAULT_STEPS;
  return snapSliderValue(clamp(value, range.min, range.max) + direction * increment, range);
}

// ---------------------------------------------------------------------------
// Ambient motion — the "living surround" (Path C, deterministic & seamless)
// ---------------------------------------------------------------------------

export interface AmbientBreathConfig {
  /** Loop period in milliseconds. */
  readonly periodMs: number;
  /** Peak vertical sway in dp. */
  readonly swayDp: number;
  /** Peak scale deviation (e.g. 0.02 -> breathes between 0.98 and 1.02). */
  readonly scaleAmplitude: number;
  /** Phase offset in [0,1) so stacked layers do not move in lockstep. */
  readonly phase?: number;
}

export const DEFAULT_AMBIENT_BREATH: AmbientBreathConfig = {
  periodMs: 4200,
  swayDp: 2,
  scaleAmplitude: 0.015,
};

export interface AmbientBreathOutput {
  readonly translateY: number;
  readonly scale: number;
}

/**
 * Deterministic, seamless ambient breathing for foliage/accent layers. A pure
 * sine of time -> the loop seam is continuous by construction (S_{end} -> S_0),
 * satisfying the §3.5 seamless-loop condition without a synthesis step.
 */
export function ambientBreath(timeMs: number, config: AmbientBreathConfig = DEFAULT_AMBIENT_BREATH): AmbientBreathOutput {
  const period = assertPositive(config.periodMs, "periodMs");
  const phase = config.phase ?? 0;
  const theta = 2 * Math.PI * ((timeMs / period + phase) % 1);
  return {
    translateY: Math.sin(theta) * config.swayDp,
    scale: 1 + Math.cos(theta) * config.scaleAmplitude,
  };
}

/**
 * A breathing accent layer (foliage, moss): a phase offset so stacked layers do
 * not move in lockstep, plus a sway scale so a small front frond travels less
 * than the body-sized cluster behind it. Named here so the RN worklets and the
 * web harness mirror identical motion instead of re-deriving 0.4 / 0.6 inline.
 */
export interface FoliageLayer {
  readonly phase: number;
  readonly swayScale: number;
}

/** The button's two foliage clusters (back is body-sized, front is a small frond). */
export const BUTTON_FOLIAGE = {
  back: { phase: 0, swayScale: 1 },
  front: { phase: 0.4, swayScale: 0.6 },
} as const satisfies Record<string, FoliageLayer>;

/** The slider's moss along the filled rail. */
export const SLIDER_MOSS: FoliageLayer = { phase: 0, swayScale: 0.4 };

/** Ambient breath for one foliage layer, with its sway scaled (scale unchanged). */
export function foliageTransform(
  timeMs: number,
  layer: FoliageLayer,
  config: AmbientBreathConfig = DEFAULT_AMBIENT_BREATH,
): AmbientBreathOutput {
  const breath = ambientBreath(timeMs, { ...config, phase: (config.phase ?? 0) + layer.phase });
  return { translateY: breath.translateY * layer.swayScale, scale: breath.scale };
}

/**
 * A drifting mote of life (firefly / pollen / spark): a closed Lissajous path so
 * the surround is never "still" even at rest. Integer `freqX`/`freqY` keep the
 * loop seamless (§3.5). `glow` pulses in [0,1] for an alpha/scale that says the
 * mote is alive, not a static dot. This is the cheap, deterministic micro-motion
 * that reads as "alive" before any interaction happens.
 */
export interface AmbientDriftConfig {
  readonly periodMs: number;
  readonly radiusX: number;
  readonly radiusY: number;
  /** Integer x-frequency over one loop (keeps the path closed). */
  readonly freqX: number;
  /** Integer y-frequency over one loop. */
  readonly freqY: number;
  readonly phase?: number;
}

export const DEFAULT_FIREFLY_DRIFT: AmbientDriftConfig = {
  periodMs: 5200,
  radiusX: 22,
  radiusY: 13,
  freqX: 1,
  freqY: 2,
};

export interface AmbientDriftOutput {
  readonly x: number;
  readonly y: number;
  readonly glow: number;
}

export function ambientDrift(timeMs: number, config: AmbientDriftConfig = DEFAULT_FIREFLY_DRIFT): AmbientDriftOutput {
  const period = assertPositive(config.periodMs, "periodMs");
  const phase = config.phase ?? 0;
  const theta = 2 * Math.PI * ((timeMs / period + phase) % 1);
  return {
    x: Math.sin(theta * config.freqX) * config.radiusX,
    y: Math.cos(theta * config.freqY) * config.radiusY,
    glow: 0.5 + 0.5 * Math.sin(theta * config.freqX * 2),
  };
}

/**
 * Press reaction for the living surround. A press is not just the body squashing
 * — the life around it reacts: foliage recoils inward, a soft light blooms, the
 * resting breath is briefly suppressed. All derived from the same `pressProgress`
 * that drives `buttonTransform`, so the reaction is in lockstep with the squash.
 */
export interface PressReaction {
  /** Inward recoil of the foliage, in dp (peaks at full press). */
  readonly recoilDp: number;
  /** Opacity of the light bloom behind the body, in [0,1]. */
  readonly bloom: number;
  /** Multiplier on the ambient breath amplitude (life holds its breath on press). */
  readonly breathDamping: number;
}

export function pressReaction(pressProgress: number): PressReaction {
  const p = clamp01(pressProgress);
  return {
    recoilDp: lerp(0, 4, p),
    // Bloom rises fast then is strongest near full press (a soft, brief flash).
    bloom: Math.sin(p * Math.PI * 0.5) * 0.55,
    breathDamping: lerp(1, 0.35, p),
  };
}

// ---------------------------------------------------------------------------
// Theming — manifest theme tokens applied by the runtime (§9.5)
// ---------------------------------------------------------------------------

/**
 * Layer roles (§9.5). `structural` art (form, shadow, geometry) ships
 * palette-neutral and is used as-is. `tintable` art (foliage, accent, glow) is
 * authored neutral/grayscale-with-alpha; the runtime multiplies the host token
 * colour through it. Runtime tint of baked-in colour is rejected by the spec.
 */
export type LivingLayerRole = "structural" | "tintable";

/**
 * How a layer's art is produced. `procedural` layers are drawn by the runtime
 * (the model-free Phase F MVP: styled views, no raster). `raster` layers carry a
 * generated transparent skin file (Phase G). The distinction keeps the manifest
 * honest — a procedural control claims no PNGs it does not ship.
 */
export type LivingLayerSource = "procedural" | "raster";

export interface LivingLayerSpec {
  readonly id: string;
  readonly role: LivingLayerRole;
  /** For tintable layers: the theme-token key whose colour multiplies through. */
  readonly token?: string;
  /** Defaults to "raster" when omitted. */
  readonly source?: LivingLayerSource;
}

export type LivingThemeTokens = Readonly<Record<string, string>>;

export type LayerTintMode = "multiply" | "none";

export interface ResolvedLayerTint {
  readonly layerId: string;
  readonly mode: LayerTintMode;
  readonly tintColor: string | null;
}

/**
 * Resolve per-layer tint instructions for a host palette. Deterministic: feeding
 * three distinct token sets yields three reskins with no model call — exactly the
 * G-gate "reskins to >= 3 host palettes" measurement (§7, §9.5).
 */
export function resolveLayerTints(
  layers: readonly LivingLayerSpec[],
  tokens: LivingThemeTokens,
): readonly ResolvedLayerTint[] {
  return layers.map((layer) => {
    if (layer.role === "structural") {
      return { layerId: layer.id, mode: "none", tintColor: null };
    }
    const token = layer.token;
    if (!token) {
      throw new Error(`tintable layer "${layer.id}" must name a theme token`);
    }
    const tintColor = tokens[token];
    if (typeof tintColor !== "string" || tintColor.trim().length === 0) {
      throw new Error(`theme tokens are missing colour for token "${token}" (layer "${layer.id}")`);
    }
    return { layerId: layer.id, mode: "multiply", tintColor };
  });
}

// ---------------------------------------------------------------------------
// Control bundle manifest — the agent-installable §5.1 contract
// ---------------------------------------------------------------------------

export type LivingControlPrimitive = "button" | "slider";

/**
 * Control motion paths (§6). Controls are runtime-owned: procedural motion
 * (Path C, the MVP default) or an authored rig (Path B). A control may NEVER be
 * sourced from a generated sprite sheet (Path A) — that is the §3.9/§12 durable
 * lesson, enforced here at the manifest contract.
 */
export type LivingControlMotionPath = "procedural_still" | "rigged_deformation";

export interface LivingControlProp {
  readonly name: string;
  readonly type: string;
  readonly required: boolean;
  readonly description: string;
}

export interface LivingControlTiming {
  readonly pressInMs: number;
  readonly releaseMs: number;
  readonly holdThresholdMs: number;
  readonly ambientPeriodMs: number;
}

export interface LivingControlDimensions {
  readonly widthDp: number;
  readonly heightDp: number;
  readonly densityMax: number;
}

export interface LivingControlManifest {
  readonly pipeline: typeof LIVING_CONTROL_RUNTIME;
  readonly schemaVersion: 1;
  readonly primitive: LivingControlPrimitive;
  readonly component: string;
  readonly label: string;
  /** Observable UI states the runtime exposes (drives the P-gate semantics row). */
  readonly states: readonly string[];
  readonly props: readonly LivingControlProp[];
  readonly layers: readonly LivingLayerSpec[];
  readonly dimensions: LivingControlDimensions;
  readonly timing: LivingControlTiming;
  /** Default host palette; structural layers ignore it, tintable layers use it. */
  readonly themeTokens: LivingThemeTokens;
  readonly motionPath: LivingControlMotionPath;
  readonly generatedAt: string;
  /** layerId -> relative asset path within the bundle's assets/ dir. */
  readonly assets: Readonly<Record<string, string>>;
}

/** Observable states a button bundle must expose to clear the P-gate (§7). */
export const REQUIRED_BUTTON_STATES = [
  "idle",
  "pressed",
  "held",
  "cancelled",
  "released",
  "disabled",
  "loading",
] as const;

/** Observable states a slider bundle must expose to clear the P-gate (§7). */
export const REQUIRED_SLIDER_STATES = ["value", "dragging", "disabled", "focused"] as const;

export function assertLivingControlManifest(value: unknown): asserts value is LivingControlManifest {
  if (!isRecord(value)) {
    throw new Error("control manifest must be an object");
  }
  if (value.pipeline !== LIVING_CONTROL_RUNTIME) {
    throw new Error(`unsupported living UI control pipeline: ${String(value.pipeline)}`);
  }
  if (value.primitive !== "button" && value.primitive !== "slider") {
    throw new Error(`unsupported control primitive: ${String(value.primitive)}`);
  }
  // §12 durable lesson: controls are never sprite-sheet (Path A) sourced.
  if (value.motionPath !== "procedural_still" && value.motionPath !== "rigged_deformation") {
    throw new Error(
      `control motionPath must be procedural_still or rigged_deformation (never generated_sprite_sheet); got ${String(value.motionPath)}`,
    );
  }
  assertNonEmptyString(value.component, "component");
  assertNonEmptyString(value.label, "label");
  assertNonEmptyString(value.generatedAt, "generatedAt");

  if (!Array.isArray(value.states) || value.states.length === 0) {
    throw new Error("control manifest states must be a non-empty array");
  }
  const stateSet = new Set(value.states as readonly string[]);
  const required = value.primitive === "button" ? REQUIRED_BUTTON_STATES : REQUIRED_SLIDER_STATES;
  for (const state of required) {
    if (!stateSet.has(state)) {
      throw new Error(`control manifest is missing required ${value.primitive} state "${state}"`);
    }
  }

  if (!Array.isArray(value.props) || value.props.length === 0) {
    throw new Error("control manifest props must be a non-empty array");
  }
  for (const prop of value.props as readonly unknown[]) {
    if (!isRecord(prop)) {
      throw new Error("each control prop must be an object");
    }
    assertNonEmptyString(prop.name, "prop.name");
    assertNonEmptyString(prop.type, "prop.type");
    assertNonEmptyString(prop.description, "prop.description");
    if (typeof prop.required !== "boolean") {
      throw new Error(`prop "${String(prop.name)}" must declare a boolean "required"`);
    }
  }

  if (!Array.isArray(value.layers) || value.layers.length === 0) {
    throw new Error("control manifest layers must be a non-empty array");
  }
  const layers = value.layers as readonly LivingLayerSpec[];
  for (const layer of layers) {
    if (!isRecord(layer)) {
      throw new Error("each layer must be an object");
    }
    assertNonEmptyString(layer.id, "layer.id");
    if (layer.role !== "structural" && layer.role !== "tintable") {
      throw new Error(`layer "${String(layer.id)}" has invalid role ${String(layer.role)}`);
    }
    if (layer.source !== undefined && layer.source !== "procedural" && layer.source !== "raster") {
      throw new Error(`layer "${String(layer.id)}" has invalid source ${String(layer.source)}`);
    }
  }

  if (!isRecord(value.themeTokens)) {
    throw new Error("control manifest themeTokens must be an object");
  }
  // Throws if any tintable layer lacks a resolvable token in the default palette.
  resolveLayerTints(layers, value.themeTokens as LivingThemeTokens);

  if (!isRecord(value.dimensions)) {
    throw new Error("control manifest dimensions must be an object");
  }
  assertPositive(value.dimensions.widthDp, "dimensions.widthDp");
  assertPositive(value.dimensions.heightDp, "dimensions.heightDp");
  assertPositive(value.dimensions.densityMax, "dimensions.densityMax");

  if (!isRecord(value.timing)) {
    throw new Error("control manifest timing must be an object");
  }
  assertPositive(value.timing.pressInMs, "timing.pressInMs");
  assertPositive(value.timing.releaseMs, "timing.releaseMs");
  assertPositive(value.timing.holdThresholdMs, "timing.holdThresholdMs");
  assertPositive(value.timing.ambientPeriodMs, "timing.ambientPeriodMs");

  if (!isRecord(value.assets)) {
    throw new Error("control manifest assets must be an object");
  }
  for (const layer of layers) {
    // Procedural layers are runtime-drawn and ship no raster file.
    if (layer.source === "procedural") {
      continue;
    }
    const assetPath = (value.assets as Record<string, unknown>)[layer.id];
    if (typeof assetPath !== "string" || assetPath.trim().length === 0) {
      throw new Error(`control manifest assets is missing a file for layer "${layer.id}"`);
    }
  }
}

// ---------------------------------------------------------------------------
// internal
// ---------------------------------------------------------------------------

function assertNonEmptyString(value: unknown, field: string): asserts value is string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`${field} must be a non-empty string`);
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function assertPositive(value: unknown, field: string): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    throw new Error(`${field} must be a positive finite number`);
  }
  return value;
}
