import { GENERATION_CONFIG } from "../config.js";

export interface MatteInput {
  whiteBg: Uint8ClampedArray;
  blackBg: Uint8ClampedArray;
  width: number;
  height: number;
}

export interface MatteOutput {
  pixels: Uint8ClampedArray;
  width: number;
  height: number;
}

export function differenceMatte(input: MatteInput): MatteOutput {
  const { whiteBg, blackBg, width, height } = input;
  const pixelCount = width * height;
  const output = new Uint8ClampedArray(pixelCount * 4);

  const totalValues = whiteBg.length;
  const stride = totalValues === pixelCount * 4 ? 4 : 3;

  const { alphaFloorThreshold, alphaCeilThreshold } = GENERATION_CONFIG;

  for (let i = 0; i < pixelCount; i++) {
    const srcIdx = i * stride;
    const dstIdx = i * 4;

    const whiteR = whiteBg[srcIdx];
    const whiteG = whiteBg[srcIdx + 1];
    const whiteB = whiteBg[srcIdx + 2];

    const blackR = blackBg[srcIdx];
    const blackG = blackBg[srcIdx + 1];
    const blackB = blackBg[srcIdx + 2];

    const diffR = whiteR - blackR;
    const diffG = whiteG - blackG;
    const diffB = whiteB - blackB;

    const maxDiff = Math.max(diffR, diffG, diffB);
    let alpha = 255 - maxDiff;
    alpha = Math.max(0, Math.min(255, alpha));

    if (alpha < alphaFloorThreshold) {
      output[dstIdx] = 0;
      output[dstIdx + 1] = 0;
      output[dstIdx + 2] = 0;
      output[dstIdx + 3] = 0;
    } else {
      if (alpha > alphaCeilThreshold) {
        alpha = 255;
      }

      const alphaFraction = alpha / 255;
      output[dstIdx] = Math.max(0, Math.min(255, Math.round(blackR / alphaFraction)));
      output[dstIdx + 1] = Math.max(0, Math.min(255, Math.round(blackG / alphaFraction)));
      output[dstIdx + 2] = Math.max(0, Math.min(255, Math.round(blackB / alphaFraction)));
      output[dstIdx + 3] = alpha;
    }
  }

  return { pixels: output, width, height };
}
