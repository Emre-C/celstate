/**
 * Living UI controls — Tier 1 semantic Reanimated components (§5, §5.2).
 *
 * These are the runtime-owned, model-free controls the spike's Phase F/P prove:
 * `CelstateLivingButton` and `CelstateLivingSlider`. Behaviour comes entirely
 * from the pure core in `control.ts` (the tested spec); these components are thin
 * Reanimated shells that drive shared values into that behaviour.
 *
 * Reanimated worklets cannot call arbitrary imported JS, so each animated style
 * MIRRORS its pure function using the same shared constants (BUTTON_PRESS,
 * DEFAULT_AMBIENT_BREATH). The pure function remains the single source of truth
 * and the test oracle; the worklet is its UI-thread mirror. Value semantics
 * (slider value <-> position) round-trip through the tested pure functions via
 * runOnJS so nothing about correctness lives only in a worklet.
 *
 * Art is source-agnostic: the MVP renders hand-made styled layers (Phase F:
 * "hand-made art, no generation"), and the same component accepts generated skin
 * Images later (Phase G) without a rewrite.
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Pressable,
  StyleSheet,
  Text,
  View,
  type LayoutChangeEvent,
  type StyleProp,
  type ViewStyle,
} from "react-native";
import Animated, {
  interpolate,
  runOnJS,
  useAnimatedStyle,
  useFrameCallback,
  useSharedValue,
  withSpring,
  withTiming,
} from "react-native-reanimated";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import {
  BUTTON_FOLIAGE,
  BUTTON_PRESS,
  DEFAULT_AMBIENT_BREATH,
  PRESS_SPRING_CONFIG,
  RELEASE_SPRING_CONFIG,
  SLIDER_MOSS,
  SLIDER_THUMB_DIAMETER,
  SLIDER_THUMB_RADIUS,
  clamp,
  nextButtonPhase,
  pressProgressForPhase,
  stepSliderValue,
  thumbXForValue,
  valueForThumbX,
  type ButtonEvent,
  type ButtonPhase,
  type LivingThemeTokens,
  type SliderRange,
} from "./control.js";

const h = React.createElement;

const TWO_PI = Math.PI * 2;

export interface LivingControlTheme {
  readonly accent: string;
  readonly onAccent: string;
  readonly surface: string;
  readonly border: string;
  readonly text: string;
}

const DEFAULT_CONTROL_THEME: LivingControlTheme = {
  accent: "#C2410C",
  onAccent: "#FFFFFF",
  surface: "#FAF8F4",
  border: "#E2DED6",
  text: "#1C1917",
};

function resolveControlTheme(tokens?: LivingThemeTokens): LivingControlTheme {
  if (!tokens) {
    return DEFAULT_CONTROL_THEME;
  }
  return {
    accent: tokens.accent ?? DEFAULT_CONTROL_THEME.accent,
    onAccent: tokens.onAccent ?? DEFAULT_CONTROL_THEME.onAccent,
    surface: tokens.surface ?? DEFAULT_CONTROL_THEME.surface,
    border: tokens.border ?? DEFAULT_CONTROL_THEME.border,
    text: tokens.text ?? DEFAULT_CONTROL_THEME.text,
  };
}

// ---------------------------------------------------------------------------
// CelstateLivingButton
// ---------------------------------------------------------------------------

export interface CelstateLivingButtonProps {
  readonly label: string;
  readonly onPress: () => void;
  readonly disabled?: boolean;
  readonly loading?: boolean;
  readonly theme?: LivingThemeTokens;
  /** Label shown while `loading` is true (defaults to "Working…"). */
  readonly loadingLabel?: string;
  readonly accessibilityLabel?: string;
  readonly testID?: string;
  readonly style?: StyleProp<ViewStyle>;
}

export function CelstateLivingButton(props: CelstateLivingButtonProps) {
  const { label, onPress, disabled = false, loading = false, theme, loadingLabel, accessibilityLabel, testID, style } =
    props;
  const colors = resolveControlTheme(theme);

  // Discrete U_button, driven by the pure reducer.
  const [phase, setPhase] = useState<ButtonPhase>("idle");
  const phaseRef = useRef<ButtonPhase>("idle");
  const dispatch = useCallback((event: ButtonEvent) => {
    const next = nextButtonPhase(phaseRef.current, event);
    if (next !== phaseRef.current) {
      phaseRef.current = next;
      setPhase(next);
    }
  }, []);

  // Modal flags flow through the same reducer so they cannot desync.
  useEffect(() => dispatch({ type: "disabledChange", disabled }), [disabled, dispatch]);
  useEffect(() => dispatch({ type: "loadingChange", loading }), [loading, dispatch]);

  // Continuous press progress on the UI thread. No JS timer; <=1 frame latency.
  const pressProgress = useSharedValue(0);
  useEffect(() => {
    const target = pressProgressForPhase(phase);
    pressProgress.value = withSpring(target, target === 1 ? PRESS_SPRING_CONFIG : RELEASE_SPRING_CONFIG);
  }, [phase, pressProgress]);

  // Ambient clock for the breathing surround (seamless, GPU-paced).
  const elapsed = useSharedValue(0);
  useFrameCallback((frame) => {
    "worklet";
    elapsed.value = frame.timeSinceFirstFrame;
  }, true);

  // Body transform mirrors buttonTransform() via the shared BUTTON_PRESS constants.
  const bodyStyle = useAnimatedStyle(() => {
    "worklet";
    const p = pressProgress.value;
    return {
      transform: [
        { translateY: interpolate(p, [0, 1], [0, BUTTON_PRESS.translateY]) },
        { scaleX: interpolate(p, [0, 1], [1, BUTTON_PRESS.scaleX]) },
        { scaleY: interpolate(p, [0, 1], [1, BUTTON_PRESS.scaleY]) },
      ],
    };
  });

  // Two foliage clusters breathe out of phase — each worklet mirrors
  // foliageTransform() via the shared BUTTON_FOLIAGE constants.
  const foliageBackStyle = useAnimatedStyle(() => {
    "worklet";
    const period = DEFAULT_AMBIENT_BREATH.periodMs;
    const theta = TWO_PI * ((elapsed.value / period + BUTTON_FOLIAGE.back.phase) % 1);
    return {
      transform: [
        { translateY: Math.sin(theta) * DEFAULT_AMBIENT_BREATH.swayDp * BUTTON_FOLIAGE.back.swayScale },
        { scale: 1 + Math.cos(theta) * DEFAULT_AMBIENT_BREATH.scaleAmplitude },
      ],
    };
  });
  const foliageFrontStyle = useAnimatedStyle(() => {
    "worklet";
    const period = DEFAULT_AMBIENT_BREATH.periodMs;
    const theta = TWO_PI * ((elapsed.value / period + BUTTON_FOLIAGE.front.phase) % 1);
    return {
      transform: [
        { translateY: Math.sin(theta) * DEFAULT_AMBIENT_BREATH.swayDp * BUTTON_FOLIAGE.front.swayScale },
        { scale: 1 + Math.cos(theta) * DEFAULT_AMBIENT_BREATH.scaleAmplitude },
      ],
    };
  });

  const isInert = disabled || loading;
  const labelText = loading ? (loadingLabel ?? "Working…") : label;

  const handlePressOut = useCallback(() => {
    const committed = phaseRef.current === "pressed" || phaseRef.current === "held";
    dispatch({ type: "pressOut" });
    if (committed && !isInert) {
      onPress();
    }
  }, [dispatch, isInert, onPress]);

  return h(
    View,
    { style: [styles.buttonContainer, style], testID },
    h(Animated.View, {
      key: "foliage-back",
      pointerEvents: "none",
      style: [styles.foliageBack, { backgroundColor: withAlpha(colors.accent, 0.18) }, foliageBackStyle],
    }),
    h(
      Pressable,
      {
        key: "pressable",
        accessibilityRole: "button",
        accessibilityLabel: accessibilityLabel ?? label,
        accessibilityState: { disabled, busy: loading },
        delayLongPress: 350,
        disabled: isInert,
        onHoverIn: () => dispatch({ type: "hoverIn" }),
        onHoverOut: () => dispatch({ type: "hoverOut" }),
        onLongPress: () => dispatch({ type: "holdElapsed" }),
        onPressIn: () => dispatch({ type: "pressIn" }),
        onPressOut: handlePressOut,
        testID: testID ? `${testID}-pressable` : undefined,
      },
      h(
        Animated.View,
        {
          style: [
            styles.buttonBody,
            { backgroundColor: colors.accent, borderColor: withAlpha(colors.text, 0.08) },
            isInert ? styles.inert : null,
            bodyStyle,
          ],
        },
        h(Text, { style: [styles.buttonLabel, { color: colors.onAccent }] }, labelText),
      ),
    ),
    h(Animated.View, {
      key: "foliage-front",
      pointerEvents: "none",
      style: [styles.foliageFront, { backgroundColor: withAlpha(colors.accent, 0.28) }, foliageFrontStyle],
    }),
  );
}

// ---------------------------------------------------------------------------
// CelstateLivingSlider
// ---------------------------------------------------------------------------

export interface CelstateLivingSliderProps {
  readonly value: number;
  readonly onValueChange: (value: number) => void;
  readonly min?: number;
  readonly max?: number;
  readonly step?: number;
  readonly disabled?: boolean;
  readonly theme?: LivingThemeTokens;
  readonly testID?: string;
  readonly style?: StyleProp<ViewStyle>;
}

export function CelstateLivingSlider(props: CelstateLivingSliderProps) {
  const { value, onValueChange, min = 0, max = 1, step, disabled = false, theme, testID, style } = props;
  const colors = resolveControlTheme(theme);

  const [trackWidth, setTrackWidth] = useState(0);
  const [dragging, setDragging] = useState(false);
  const [focused, setFocused] = useState(false);

  const trackStart = SLIDER_THUMB_RADIUS;
  const trackEnd = Math.max(SLIDER_THUMB_RADIUS, trackWidth - SLIDER_THUMB_RADIUS);

  // Range built from primitives so exactOptionalPropertyTypes stays satisfied.
  const range: SliderRange = useMemo(
    () => (step === undefined ? { min, max } : { min, max, step }),
    [min, max, step],
  );

  // Assistive-technology / keyboard adjustment: nudge by one step through the
  // same tested mapping the drag uses, so AT lands on drag-reachable values.
  const adjust = useCallback(
    (direction: 1 | -1) => {
      if (disabled) {
        return;
      }
      onValueChange(stepSliderValue(value, direction, range));
    },
    [disabled, onValueChange, value, range],
  );
  const onAccessibilityAction = useCallback(
    (event: { readonly nativeEvent: { readonly actionName: string } }) => {
      if (event.nativeEvent.actionName === "increment") {
        adjust(1);
      } else if (event.nativeEvent.actionName === "decrement") {
        adjust(-1);
      }
    },
    [adjust],
  );

  const thumbX = useSharedValue(trackStart);

  // Controlled sync: thumb position is a function of value (§3.0 invariant),
  // computed by the tested pure function on the JS thread.
  useEffect(() => {
    const target = thumbXForValue(value, { start: trackStart, end: trackEnd }, range);
    thumbX.value = dragging ? target : withTiming(target, { duration: 140 });
  }, [value, trackStart, trackEnd, range, dragging, thumbX]);

  // Report a dragged position back through the tested inverse mapping.
  const reportValue = useCallback(
    (x: number) => {
      onValueChange(valueForThumbX(x, { start: trackStart, end: trackEnd }, range));
    },
    [onValueChange, trackStart, trackEnd, range],
  );

  const pan = useMemo(
    () =>
      Gesture.Pan()
        .enabled(!disabled && trackEnd > trackStart)
        .minDistance(0)
        .onBegin(() => {
          "worklet";
          runOnJS(setDragging)(true);
        })
        .onChange((event) => {
          "worklet";
          // Inline clamp: imported JS (clamp) cannot run on the UI thread.
          const next = thumbX.value + event.changeX;
          thumbX.value = next < trackStart ? trackStart : next > trackEnd ? trackEnd : next;
          runOnJS(reportValue)(thumbX.value);
        })
        .onFinalize(() => {
          "worklet";
          runOnJS(setDragging)(false);
        }),
    [disabled, trackStart, trackEnd, reportValue, thumbX],
  );

  const elapsed = useSharedValue(0);
  useFrameCallback((frame) => {
    "worklet";
    elapsed.value = frame.timeSinceFirstFrame;
  }, true);

  const fillStyle = useAnimatedStyle(() => {
    "worklet";
    return { width: thumbX.value };
  });

  const thumbStyle = useAnimatedStyle(() => {
    "worklet";
    return { transform: [{ translateX: thumbX.value - SLIDER_THUMB_RADIUS }] };
  });

  // Moss along the filled rail breathes — mirrors foliageTransform(SLIDER_MOSS).
  const mossStyle = useAnimatedStyle(() => {
    "worklet";
    const period = DEFAULT_AMBIENT_BREATH.periodMs;
    const theta = TWO_PI * ((elapsed.value / period + SLIDER_MOSS.phase) % 1);
    return {
      width: thumbX.value,
      transform: [{ translateY: Math.sin(theta) * DEFAULT_AMBIENT_BREATH.swayDp * SLIDER_MOSS.swayScale }],
    };
  });

  const onLayout = useCallback((event: LayoutChangeEvent) => {
    setTrackWidth(event.nativeEvent.layout.width);
  }, []);

  return h(
    View,
    {
      accessibilityRole: "adjustable",
      accessibilityState: { disabled },
      accessibilityValue: { min, max, now: value },
      accessibilityActions: [{ name: "increment" }, { name: "decrement" }],
      onAccessibilityAction,
      focusable: !disabled,
      onFocus: () => setFocused(true),
      onBlur: () => setFocused(false),
      onLayout,
      style: [styles.sliderContainer, disabled ? styles.inert : null, style],
      testID,
    },
    h(
      GestureDetector,
      { gesture: pan },
      h(
        View,
        { style: styles.sliderTrackArea },
        h(View, { key: "rail", style: [styles.rail, { backgroundColor: colors.border }] }),
        h(Animated.View, { key: "fill", style: [styles.railFill, { backgroundColor: colors.accent }, fillStyle] }),
        h(Animated.View, {
          key: "moss",
          pointerEvents: "none",
          style: [styles.moss, { backgroundColor: withAlpha(colors.accent, 0.35) }, mossStyle],
        }),
        h(Animated.View, {
          key: "thumb",
          style: [
            styles.thumb,
            { backgroundColor: colors.surface, borderColor: colors.accent },
            // Focus ring: a brighter, accent-coloured glow on the thumb.
            focused ? { shadowColor: colors.accent, shadowOpacity: 0.5 } : null,
            dragging ? styles.thumbDragging : null,
            focused ? styles.thumbFocused : null,
            thumbStyle,
          ],
        }),
      ),
    ),
  );
}

// ---------------------------------------------------------------------------
// helpers + styles
// ---------------------------------------------------------------------------

/** Append an alpha channel to a #RRGGBB hex (theme tints multiply through). */
function withAlpha(hex: string, alpha: number): string {
  const a = Math.round(clamp(alpha, 0, 1) * 255)
    .toString(16)
    .padStart(2, "0");
  return /^#[0-9a-fA-F]{6}$/.test(hex) ? `${hex}${a}` : hex;
}

const styles = StyleSheet.create({
  buttonContainer: {
    alignItems: "center",
    justifyContent: "center",
    minHeight: 56,
    minWidth: 200,
    paddingHorizontal: 18,
    paddingVertical: 10,
  },
  buttonBody: {
    alignItems: "center",
    borderRadius: 14,
    borderWidth: StyleSheet.hairlineWidth,
    elevation: 3,
    justifyContent: "center",
    minHeight: 52,
    minWidth: 180,
    paddingHorizontal: 28,
    paddingVertical: 14,
    shadowColor: "#1C1917",
    shadowOffset: { height: 4, width: 0 },
    shadowOpacity: 0.18,
    shadowRadius: 8,
  },
  buttonLabel: {
    fontSize: 16,
    fontWeight: "600",
    letterSpacing: 0.2,
  },
  foliageBack: {
    borderRadius: 18,
    bottom: 2,
    left: 8,
    position: "absolute",
    right: 8,
    top: 6,
  },
  foliageFront: {
    borderRadius: 10,
    bottom: 4,
    height: 10,
    position: "absolute",
    right: 18,
    width: 26,
  },
  inert: {
    opacity: 0.55,
  },
  sliderContainer: {
    justifyContent: "center",
    minHeight: 44,
    paddingHorizontal: 4,
    width: "100%",
  },
  sliderTrackArea: {
    height: SLIDER_THUMB_DIAMETER,
    justifyContent: "center",
    width: "100%",
  },
  rail: {
    borderRadius: 3,
    height: 6,
    width: "100%",
  },
  railFill: {
    borderRadius: 3,
    height: 6,
    left: 0,
    position: "absolute",
  },
  moss: {
    borderRadius: 4,
    bottom: 4,
    height: 4,
    left: 0,
    position: "absolute",
  },
  thumb: {
    borderRadius: SLIDER_THUMB_RADIUS,
    borderWidth: 2,
    elevation: 4,
    height: SLIDER_THUMB_DIAMETER,
    left: 0,
    position: "absolute",
    shadowColor: "#1C1917",
    shadowOffset: { height: 2, width: 0 },
    shadowOpacity: 0.2,
    shadowRadius: 4,
    top: 0,
    width: SLIDER_THUMB_DIAMETER,
  },
  thumbDragging: {
    transform: [{ scale: 1.08 }],
  },
  thumbFocused: {
    borderWidth: 3,
    elevation: 6,
    shadowRadius: 6,
  },
});
