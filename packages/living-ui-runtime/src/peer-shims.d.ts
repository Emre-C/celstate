declare module "react" {
  export type ReactNode = unknown;
  export function useEffect(effect: () => void | (() => void), deps?: readonly unknown[]): void;
  export function useMemo<T>(factory: () => T, deps?: readonly unknown[]): T;
  export function useState<T>(initial: T | (() => T)): [T, (next: T | ((prev: T) => T)) => void];
  export function useCallback<T>(callback: T, deps?: readonly unknown[]): T;
  export function useRef<T>(initial: T): { current: T };
  const React: {
    createElement: (component: unknown, props?: Record<string, unknown> | null, ...children: unknown[]) => unknown;
    Fragment: unknown;
  };
  export default React;
}

declare module "react-native" {
  export type ColorValue = string;
  export type ImageSourcePropType = unknown;
  export type ImageStyle = Record<string, unknown>;
  export type TextStyle = Record<string, unknown>;
  export type StyleProp<T> = T | readonly T[] | null | undefined;
  export type ViewStyle = Record<string, unknown>;
  export type AccessibilityRole = string;
  export interface AccessibilityState {
    readonly disabled?: boolean;
    readonly busy?: boolean;
    readonly selected?: boolean;
  }
  export interface GestureResponderEvent {
    readonly nativeEvent: Record<string, unknown>;
  }
  export interface LayoutChangeEvent {
    readonly nativeEvent: { readonly layout: { readonly width: number; readonly height: number; readonly x: number; readonly y: number } };
  }
  export const Image: unknown;
  export const Text: unknown;
  export const Pressable: unknown;
  export const PixelRatio: {
    get: () => number;
  };
  export const Platform: {
    OS: "ios" | "android" | "web" | string;
    select: <T>(spec: Record<string, T>) => T | undefined;
  };
  export const StyleSheet: {
    create: <T extends Record<string, unknown>>(styles: T) => T;
    absoluteFillObject: ViewStyle;
    hairlineWidth: number;
  };
  export const View: unknown;
}

declare module "react-native-reanimated" {
  export interface SharedValue<T> {
    value: T;
  }

  export interface FrameInfo {
    timestamp: number;
    timeSinceFirstFrame: number;
    timeSincePreviousFrame: number | null;
  }

  export interface FrameCallback {
    callbackId: number;
    isActive: boolean;
    setActive: (isActive: boolean) => void;
  }

  export interface WithSpringConfig {
    readonly damping?: number;
    readonly stiffness?: number;
    readonly mass?: number;
    readonly overshootClamping?: boolean;
  }

  export interface WithTimingConfig {
    readonly duration?: number;
  }

  export const Extrapolation: {
    readonly CLAMP: "clamp";
    readonly EXTEND: "extend";
    readonly IDENTITY: "identity";
  };

  const Animated: {
    View: unknown;
    Text: unknown;
    Image: unknown;
  };
  export function useAnimatedStyle<T>(updater: () => T, deps?: readonly unknown[]): T;
  export function useDerivedValue<T>(updater: () => T, deps?: readonly unknown[]): SharedValue<T>;
  export function useFrameCallback(
    callback: (frameInfo: FrameInfo) => void,
    autostart?: boolean,
  ): FrameCallback;
  export function useSharedValue<T>(initialValue: T): SharedValue<T>;
  export function withSpring<T>(toValue: T, config?: WithSpringConfig): T;
  export function withTiming<T>(toValue: T, config?: WithTimingConfig): T;
  export function interpolate(
    value: number,
    inputRange: readonly number[],
    outputRange: readonly number[],
    extrapolation?: "clamp" | "extend" | "identity",
  ): number;
  export function runOnJS<A extends readonly unknown[]>(fn: (...args: A) => unknown): (...args: A) => void;
  export default Animated;
}

declare module "react-native-gesture-handler" {
  export interface PanUpdateEvent {
    readonly translationX: number;
    readonly translationY: number;
    readonly changeX: number;
    readonly changeY: number;
    readonly x: number;
    readonly y: number;
    readonly absoluteX: number;
    readonly absoluteY: number;
  }

  export interface PanGesture {
    enabled(enabled: boolean): PanGesture;
    onBegin(cb: (event: PanUpdateEvent) => void): PanGesture;
    onStart(cb: (event: PanUpdateEvent) => void): PanGesture;
    onUpdate(cb: (event: PanUpdateEvent) => void): PanGesture;
    onChange(cb: (event: PanUpdateEvent) => void): PanGesture;
    onFinalize(cb: (event: PanUpdateEvent) => void): PanGesture;
    minDistance(distance: number): PanGesture;
  }

  export const Gesture: {
    Pan: () => PanGesture;
  };

  export const GestureDetector: unknown;
}
