import { GENERATION_CONFIG } from "./config.js";

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

  // Determine stride: 3 for RGB, 4 for RGBA
  const totalValues = whiteBg.length;
  const stride = totalValues === pixelCount * 4 ? 4 : 3;

  for (let i = 0; i < pixelCount; i++) {
    const srcIdx = i * stride;
    const dstIdx = i * 4;

    const whiteR = whiteBg[srcIdx];
    const whiteG = whiteBg[srcIdx + 1];
    const whiteB = whiteBg[srcIdx + 2];

    const blackR = blackBg[srcIdx];
    const blackG = blackBg[srcIdx + 1];
    const blackB = blackBg[srcIdx + 2];

    // Solve alpha from compositing equation:
    // C_w = F·α + 255·(1 - α)
    // C_b = F·α
    // C_w - C_b = 255·(1 - α)
    // α = 1 - (C_w - C_b) / 255
    const diffR = whiteR - blackR;
    const diffG = whiteG - blackG;
    const diffB = whiteB - blackB;

    // Use max channel difference for most robust alpha estimate
    const maxDiff = Math.max(diffR, diffG, diffB);
    let alpha = 255 - maxDiff;

    // Clamp alpha to valid range (handle noise)
    alpha = Math.max(0, Math.min(255, alpha));

    // Recover foreground color from black-bg image
    // On black bg: C_b = F·α → F = C_b / (α/255)
    let finalR: number;
    let finalG: number;
    let finalB: number;

    if (alpha > 0) {
      const alphaFraction = alpha / 255;
      finalR = Math.max(0, Math.min(255, Math.round(blackR / alphaFraction)));
      finalG = Math.max(0, Math.min(255, Math.round(blackG / alphaFraction)));
      finalB = Math.max(0, Math.min(255, Math.round(blackB / alphaFraction)));
    } else {
      finalR = 0;
      finalG = 0;
      finalB = 0;
    }

    output[dstIdx] = finalR;
    output[dstIdx + 1] = finalG;
    output[dstIdx + 2] = finalB;
    output[dstIdx + 3] = alpha;
  }

  // Edge refinement cleanup pass
  const { alphaFloorThreshold, alphaCeilThreshold } = GENERATION_CONFIG;

  for (let i = 0; i < pixelCount; i++) {
    const alphaIdx = i * 4 + 3;
    const a = output[alphaIdx];
    if (a < alphaFloorThreshold) {
      output[alphaIdx] = 0;
      output[i * 4] = 0;
      output[i * 4 + 1] = 0;
      output[i * 4 + 2] = 0;
    } else if (a > alphaCeilThreshold) {
      output[alphaIdx] = 255;
    }
  }

  return { pixels: output, width, height };
}
