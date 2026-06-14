import React, { useEffect, useMemo } from "react";
import {
  Image,
  PixelRatio,
  StyleSheet,
  View,
  type ImageSourcePropType,
  type ImageStyle,
  type StyleProp,
  type ViewStyle,
} from "react-native";
import Animated, {
  useAnimatedStyle,
  useFrameCallback,
  useSharedValue,
} from "react-native-reanimated";
import {
  assertLivingUiManifest,
  getRightSizeResult,
  normalizeFrameRange,
  type FrameRange,
  type LivingUiManifest,
  type RightSizeResult,
} from "./index.js";

export interface LivingSpriteSize {
  readonly heightDp: number;
  readonly widthDp: number;
}

export interface LivingSpriteProps {
  readonly displaySize?: Partial<LivingSpriteSize>;
  readonly frameRange?: FrameRange;
  readonly imageStyle?: StyleProp<ImageStyle>;
  readonly manifest: LivingUiManifest;
  readonly paused?: boolean;
  readonly source: ImageSourcePropType;
  readonly speed?: number;
  readonly style?: StyleProp<ViewStyle>;
  readonly testID?: string;
}

export function getLivingSpriteSize(manifest: LivingUiManifest, displaySize?: Partial<LivingSpriteSize>): LivingSpriteSize {
  const widthDp = displaySize?.widthDp ?? manifest.runtime.displayDpMax;
  const heightDp =
    displaySize?.heightDp ?? widthDp * (manifest.spriteSheet.cellHeight / manifest.spriteSheet.cellWidth);
  return { heightDp, widthDp };
}

export function getLivingSpriteRightSize(
  manifest: LivingUiManifest,
  displaySize?: Partial<LivingSpriteSize>,
  density = PixelRatio.get(),
): RightSizeResult {
  const size = getLivingSpriteSize(manifest, displaySize);
  return getRightSizeResult({
    cellHeight: manifest.spriteSheet.cellHeight,
    cellWidth: manifest.spriteSheet.cellWidth,
    density,
    displayHeightDp: size.heightDp,
    displayWidthDp: size.widthDp,
  });
}

export function LivingSprite({
  displaySize,
  frameRange,
  imageStyle,
  manifest,
  paused = false,
  source,
  speed = 1,
  style,
  testID,
}: LivingSpriteProps) {
  assertLivingUiManifest(manifest);

  const size = useMemo(() => getLivingSpriteSize(manifest, displaySize), [displaySize, manifest]);
  const normalizedRange = useMemo(
    () => normalizeFrameRange(manifest.spriteSheet.frameCount, frameRange),
    [frameRange, manifest.spriteSheet.frameCount],
  );
  const elapsedMs = useSharedValue(0);
  const rangeFrameCount = normalizedRange.end - normalizedRange.start + 1;
  const rangeStart = normalizedRange.start;
  const sheetCols = manifest.spriteSheet.cols;
  const spriteFps = manifest.spriteSheet.fps;
  const sheetWidthDp = size.widthDp * manifest.spriteSheet.cols;
  const sheetHeightDp = size.heightDp * manifest.spriteSheet.rows;

  const frameCallback = useFrameCallback((frameInfo) => {
    "worklet";
    elapsedMs.value = frameInfo.timeSinceFirstFrame * speed;
  }, !paused);

  useEffect(() => {
    frameCallback.setActive(!paused);
  }, [frameCallback, paused]);

  const animatedStyle = useAnimatedStyle(() => {
    "worklet";
    const elapsedFrames = Math.floor(Math.max(0, elapsedMs.value) * spriteFps / 1000);
    const frameIndex = rangeStart + (elapsedFrames % rangeFrameCount);
    const col = frameIndex % sheetCols;
    const row = Math.floor(frameIndex / sheetCols);
    return {
      transform: [
        { translateX: -col * size.widthDp },
        { translateY: -row * size.heightDp },
      ],
    };
  });

  return React.createElement(
    View,
    {
      style: [styles.viewport, { height: size.heightDp, width: size.widthDp }, style],
      testID,
    },
    React.createElement(
      Animated.View,
      { style: animatedStyle },
      React.createElement(Image, {
        resizeMode: "stretch",
        source,
        style: [
          {
            height: sheetHeightDp,
            width: sheetWidthDp,
          },
          imageStyle,
        ],
      }),
    ),
  );
}

export const LivingAccent = LivingSprite;
export const LivingButtonOverlay = LivingSprite;
export const LivingFeedback = LivingSprite;

const styles = StyleSheet.create({
  viewport: {
    overflow: "hidden",
  },
});
