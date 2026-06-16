/**
 * Living UI art primitives — the framework-agnostic *shape* + *colour* layer.
 *
 * The §5.1 split is: behaviour is a function (control.ts), art is data. This file
 * is the data: SVG path strings, layer layouts, and palette-derived colour math.
 * It contains no React and no DOM, so the SAME leaf path and the SAME tint ramp
 * render on the web harness (inline <svg>) and on React Native (react-native-svg /
 * Skia <Path>). That portability is what stops the web proof from being a mockup —
 * it is the literal art the RN control will draw, driven by the shared motion core.
 *
 * Per §3.9/§12 this is hand-authored (Phase F: "hand-made art, no generation");
 * Phase G later fills the same vector slots with generated skins.
 */

// ---------------------------------------------------------------------------
// Colour math — derive a whole living palette from one accent token (§9.5)
// ---------------------------------------------------------------------------

function clampByte(n: number): number {
  return Math.max(0, Math.min(255, Math.round(n)));
}

function toHex2(n: number): string {
  return clampByte(n).toString(16).padStart(2, "0");
}

/** Parse #RGB or #RRGGBB into [r,g,b]; returns null for anything else. */
export function parseHex(hex: string): readonly [number, number, number] | null {
  const m = /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.exec(hex.trim());
  if (!m) {
    return null;
  }
  let body = m[1];
  if (body.length === 3) {
    body = body[0] + body[0] + body[1] + body[1] + body[2] + body[2];
  }
  return [
    parseInt(body.slice(0, 2), 16),
    parseInt(body.slice(2, 4), 16),
    parseInt(body.slice(4, 6), 16),
  ];
}

/** Append an alpha channel to a #RRGGBB hex (works as a fill in web SVG and RN). */
export function withAlpha(hex: string, alpha: number): string {
  const rgb = parseHex(hex);
  const a = toHex2(Math.max(0, Math.min(1, alpha)) * 255);
  return rgb ? `#${toHex2(rgb[0])}${toHex2(rgb[1])}${toHex2(rgb[2])}${a}` : hex;
}

/** Linear blend of two hex colours, t in [0,1]. Returns #RRGGBB. */
export function mix(from: string, to: string, t: number): string {
  const a = parseHex(from);
  const b = parseHex(to);
  if (!a || !b) {
    return from;
  }
  const k = Math.max(0, Math.min(1, t));
  return `#${toHex2(a[0] + (b[0] - a[0]) * k)}${toHex2(a[1] + (b[1] - a[1]) * k)}${toHex2(a[2] + (b[2] - a[2]) * k)}`;
}

/** Darken toward black by `amount` in [0,1]. */
export function shade(hex: string, amount: number): string {
  return mix(hex, "#000000", amount);
}

/** Lighten toward white by `amount` in [0,1]. */
export function tint(hex: string, amount: number): string {
  return mix(hex, "#ffffff", amount);
}

export interface LivingPalette {
  readonly accent: string;
  readonly accentDeep: string;
  readonly accentBright: string;
  readonly leaf: string;
  readonly leafDeep: string;
  readonly leafBright: string;
  readonly glow: string;
}

/**
 * A full living palette derived from one accent. The leaf greens are pulled a
 * little toward a botanical hue so the foliage reads as foliage, not "the accent
 * again" — but they still shift with the host accent so the kit stays coherent.
 */
export function livingPalette(accent: string, leafHint = "#3F6212"): LivingPalette {
  const leaf = mix(leafHint, accent, 0.22);
  return {
    accent,
    accentDeep: shade(accent, 0.28),
    accentBright: tint(accent, 0.32),
    leaf,
    leafDeep: shade(leaf, 0.3),
    leafBright: tint(leaf, 0.28),
    glow: tint(accent, 0.55),
  };
}

// ---------------------------------------------------------------------------
// Leaf geometry — one authored leaf, fanned into clusters
// ---------------------------------------------------------------------------

/** Authored in a 24×24 box, tip at top (0), stem at bottom (24). */
export const LEAF_VIEWBOX = 24;
export const LEAF_PATH = "M12 0 C19 6 19.5 16 12 24 C4.5 16 5 6 12 0 Z";
/** Midrib, drawn as a thin stroke for a touch of structure. */
export const LEAF_MIDRIB = "M12 3 C12 9 12 15 12 21";

export interface LeafPlacement {
  /** Offset of the leaf stem from the cluster anchor, in dp. */
  readonly ox: number;
  readonly oy: number;
  readonly rotateDeg: number;
  readonly scale: number;
  /** 0 = deepest leaf colour, 1 = brightest (depth shading). */
  readonly depth: number;
}

/**
 * The button's foliage cluster: a small bush the body sits within. Hand-tuned so
 * the leaves fan up and outward with believable asymmetry (life is not
 * symmetric). Back leaves are larger/darker, front leaves smaller/brighter.
 */
export const BUTTON_LEAF_CLUSTER: readonly LeafPlacement[] = [
  { ox: -86, oy: 6, rotateDeg: -52, scale: 1.5, depth: 0.0 },
  { ox: -58, oy: -10, rotateDeg: -30, scale: 1.7, depth: 0.15 },
  { ox: -20, oy: -18, rotateDeg: -10, scale: 1.85, depth: 0.35 },
  { ox: 20, oy: -17, rotateDeg: 12, scale: 1.8, depth: 0.3 },
  { ox: 58, oy: -8, rotateDeg: 32, scale: 1.65, depth: 0.12 },
  { ox: 88, oy: 8, rotateDeg: 55, scale: 1.45, depth: 0.0 },
  { ox: 40, oy: 2, rotateDeg: 22, scale: 1.1, depth: 0.7 },
  { ox: -44, oy: 4, rotateDeg: -22, scale: 1.05, depth: 0.75 },
];

/**
 * The slider's sprout positions along the track, as fractions in [0,1]. A sprout
 * "blooms" (opens + lifts) once the value passes it — so dragging the thumb grows
 * the vine: the visible reason the control exists.
 */
export const SLIDER_SPROUTS: readonly { readonly at: number; readonly side: 1 | -1; readonly scale: number }[] = [
  { at: 0.12, side: -1, scale: 0.9 },
  { at: 0.26, side: 1, scale: 1.05 },
  { at: 0.4, side: -1, scale: 0.95 },
  { at: 0.54, side: 1, scale: 1.1 },
  { at: 0.68, side: -1, scale: 1.0 },
  { at: 0.82, side: 1, scale: 0.9 },
];

/**
 * How open a sprout at fraction `at` is, given the current value in [0,1]. Opens
 * smoothly over a short band just after the thumb passes, then holds fully open.
 */
export function sproutOpenness(value: number, at: number, band = 0.12): number {
  const v = Math.max(0, Math.min(1, value));
  return Math.max(0, Math.min(1, (v - at) / band));
}
