declare module "react" {
  export function useEffect(effect: () => void | (() => void), deps?: readonly unknown[]): void;
  export function useMemo<T>(factory: () => T, deps?: readonly unknown[]): T;
  const React: {
    createElement: (component: unknown, props?: Record<string, unknown> | null, ...children: unknown[]) => unknown;
  };
  export default React;
}

declare module "react-native" {
  export type ImageSourcePropType = unknown;
  export type ImageStyle = Record<string, unknown>;
  export type StyleProp<T> = T | readonly T[] | null | undefined;
  export type ViewStyle = Record<string, unknown>;
  export const Image: unknown;
  export const PixelRatio: {
    get: () => number;
  };
  export const StyleSheet: {
    create: <T extends Record<string, unknown>>(styles: T) => T;
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

  const Animated: {
    View: unknown;
  };
  export function useAnimatedStyle<T>(updater: () => T): T;
  export function useFrameCallback(
    callback: (frameInfo: FrameInfo) => void,
    autostart?: boolean,
  ): FrameCallback;
  export function useSharedValue<T>(initialValue: T): SharedValue<T>;
  export default Animated;
}
