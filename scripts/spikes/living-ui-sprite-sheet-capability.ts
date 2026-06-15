/**
 * THROWAWAY SPIKE — Living-UI generated sprite-sheet capability test.
 *
 * Question (from docs/product/LIVING-UI-ANIMATION-SPIKE.html §7 / G-gate):
 *   Can Gemini 3.0 Pro Image generate ONE coherent UI-behavior sprite sheet
 *   (a 4x3 / 12-frame "living button" press loop) that survives our existing
 *   white/black difference-matte transparency pipeline AND actually encodes the
 *   intended UI behaviour (idle -> press -> hold -> release)?
 *
 * This does NOT touch the production worker. It reuses prod auth
 * (readGeminiRuntimeConfigFromEnv / createGeminiClient) and the prod matte
 * (differenceMatte), but drives the verified Gemini 3 Pro Image model id
 * directly so the spike doesn't depend on GENERATION_CONFIG.model (Flash).
 *
 * Verified API facts (web docs, 2026-06-14):
 *   - model id (Vertex):        gemini-3-pro-image-preview   (honours imageSize; Flash ignores it — js-genai#1461)
 *   - imageConfig.imageSize:     "512" | "1K" | "2K" | "4K"
 *   - imageConfig.aspectRatio:   "1:1" ... "21:9" (square keeps max pixels — spike §3.8)
 *   - img2img / reference image: pass prior image as an inlineData base64 part alongside the text prompt
 *   - output:                    inlineData { mimeType: image/png, data: base64 }
 *
 * Run:
 *   doppler run --project celstate --config prd -- pnpm exec tsx scripts/spikes/living-ui-sprite-sheet-capability.ts
 * Flags: --model <id> --size <512|1K|2K|4K> --aspect <ratio> --out <dir>
 */
import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import sharp from "sharp";
import {
  createGeminiClient,
  normalizeGeminiImageMimeType,
  readGeminiRuntimeConfigFromEnv,
  type GeminiImageResult,
} from "../../src/convex/lib/gemini.js";
import { differenceMatte } from "../../src/convex/lib/generation/matte.js";

const execFileAsync = promisify(execFile);

const REQ_COLS = 4; // requested layout
const REQ_ROWS = 3;
const REQ_N = REQ_COLS * REQ_ROWS; // 12
const ALPHA_FG = 24; // alpha above this counts as foreground
const SILHOUETTE_T = 40; // luminance distance from pure bg to count as ink, for registration
const SHIFT_RANGE = 3; // px search window for white<->black silhouette registration
const FALLBACK_MODELS = ["gemini-3-pro-image-preview", "gemini-3-pro-image"];

interface DecodedRGBA {
  height: number;
  pixels: Uint8ClampedArray; // RGBA
  width: number;
}

interface CellRect {
  h: number;
  w: number;
  x: number;
  y: number;
}

interface BBox {
  area: number;
  cx: number; // alpha-weighted centroid (cell-local)
  cy: number;
  fillRatio: number;
  height: number;
  width: number;
  x0: number;
  x1: number;
  y0: number;
  y1: number;
}

// ---------------------------------------------------------------------------
// args
// ---------------------------------------------------------------------------
function parseArgs(argv: string[]): { aspect: string; cols?: number; from?: string; model?: string; out?: string; rows?: number; size: string } {
  const flags = new Map<string, string>();
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith("--")) continue;
    const [k, inline] = a.slice(2).split("=", 2);
    if (inline !== undefined) flags.set(k, inline);
    else if (argv[i + 1] && !argv[i + 1].startsWith("--")) flags.set(k, argv[++i]);
    else flags.set(k, "true");
  }
  return {
    aspect: flags.get("aspect") ?? "1:1",
    cols: flags.has("cols") ? Number(flags.get("cols")) : undefined,
    from: flags.get("from"), // re-analyze an existing dir's white.png/black.png without regenerating
    model: flags.get("model"),
    out: flags.get("out"),
    rows: flags.has("rows") ? Number(flags.get("rows")) : undefined,
    size: flags.get("size") ?? "2K",
  };
}

/**
 * Auto-detect the grid the model actually drew, from the matte alpha profile.
 * Counts contiguous "content bands" (runs where mean alpha clears a threshold)
 * along each axis; the gaps between them are the gutters the model left.
 */
function detectBands(density: Float64Array, minRun: number): Array<{ center: number; end: number; start: number; width: number }> {
  let max = 0;
  for (const d of density) if (d > max) max = d;
  const thr = max * 0.1;
  const bands: Array<{ center: number; end: number; start: number; width: number }> = [];
  let runStart = -1;
  for (let i = 0; i <= density.length; i++) {
    const on = i < density.length && density[i] > thr;
    if (on && runStart < 0) runStart = i;
    else if (!on && runStart >= 0) {
      const width = i - runStart;
      if (width >= minRun) bands.push({ center: (runStart + i) / 2, end: i, start: runStart, width });
      runStart = -1;
    }
  }
  return bands;
}

function detectGrid(alpha: Uint8ClampedArray, W: number, H: number): { colBands: number; rowBands: number; colEven: boolean; rowEven: boolean } {
  const colDensity = new Float64Array(W);
  const rowDensity = new Float64Array(H);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const a = alpha[y * W + x];
      colDensity[x] += a;
      rowDensity[y] += a;
    }
  }
  for (let x = 0; x < W; x++) colDensity[x] /= H;
  for (let y = 0; y < H; y++) rowDensity[y] /= W;
  const cols = detectBands(colDensity, Math.round(W * 0.05));
  const rows = detectBands(rowDensity, Math.round(H * 0.05));
  const even = (bands: Array<{ width: number }>) => {
    if (bands.length < 2) return true;
    const widths = bands.map((b) => b.width);
    const mean = widths.reduce((s, w) => s + w, 0) / widths.length;
    return widths.every((w) => Math.abs(w - mean) / mean < 0.25);
  };
  return { colBands: cols.length, colEven: even(cols), rowBands: rows.length, rowEven: even(rows) };
}

// ---------------------------------------------------------------------------
// generation
// ---------------------------------------------------------------------------
type GenPart = { inlineData: { data: string; mimeType: string } } | { text: string };

interface GenResult extends GeminiImageResult {
  modelId: string;
  text: string;
}

function extractImageAndText(
  response: {
    candidates?: Array<{ content?: { parts?: Array<{ inlineData?: { data?: string; mimeType?: string }; text?: string }> } }> | null;
  },
): { image: GeminiImageResult; text: string } {
  const parts = response.candidates?.[0]?.content?.parts;
  if (!parts || parts.length === 0) throw new Error("Gemini returned no parts");
  let image: GeminiImageResult | undefined;
  const texts: string[] = [];
  for (const part of parts) {
    if (part.inlineData?.data && !image) {
      image = { imageBase64: part.inlineData.data, mimeType: normalizeGeminiImageMimeType(part.inlineData.mimeType) };
    }
    if (part.text) texts.push(part.text);
  }
  if (!image) throw new Error(`Gemini returned no image (text only: ${texts.join(" ").slice(0, 400)})`);
  return { image, text: texts.join("\n").trim() };
}

function isModelNotFound(message: string): boolean {
  return /NOT_FOUND|not found|was not found|404|PERMISSION_DENIED|does not exist|is not allowed/i.test(message);
}

async function generate(
  client: ReturnType<typeof createGeminiClient>,
  preferredModels: string[],
  parts: GenPart[],
  config: { aspectRatio: string; imageSize: string },
): Promise<GenResult> {
  let lastErr: unknown;
  for (const modelId of preferredModels) {
    try {
      const response = await client.models.generateContent({
        model: modelId,
        contents: parts,
        config: {
          responseModalities: ["TEXT", "IMAGE"],
          imageConfig: { aspectRatio: config.aspectRatio, imageSize: config.imageSize },
        },
      });
      const { image, text } = extractImageAndText(response);
      return { ...image, modelId, text };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      lastErr = error;
      if (isModelNotFound(message) && preferredModels.length > 1) {
        console.warn(`[spike] model ${modelId} unavailable (${message.slice(0, 160)}); trying next id`);
        continue;
      }
      throw error;
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
}

// ---------------------------------------------------------------------------
// image helpers
// ---------------------------------------------------------------------------
async function decodeRGBA(image: GeminiImageResult): Promise<DecodedRGBA> {
  const { data, info } = await sharp(Buffer.from(image.imageBase64, "base64")).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  return { height: info.height, pixels: new Uint8ClampedArray(data), width: info.width };
}

async function resizeRGBA(img: DecodedRGBA, width: number, height: number): Promise<DecodedRGBA> {
  const { data } = await sharp(Buffer.from(img.pixels), { raw: { channels: 4, height: img.height, width: img.width } })
    .resize(width, height)
    .raw()
    .toBuffer({ resolveWithObject: true });
  return { height, pixels: new Uint8ClampedArray(data), width };
}

function encodePng(pixels: Uint8ClampedArray, width: number, height: number): Promise<Buffer> {
  return sharp(Buffer.from(pixels), { raw: { channels: 4, height, width } }).png().toBuffer();
}

function cropRGBA(img: DecodedRGBA, r: CellRect): Uint8ClampedArray {
  const out = new Uint8ClampedArray(r.w * r.h * 4);
  for (let j = 0; j < r.h; j++) {
    const srcRow = ((r.y + j) * img.width + r.x) * 4;
    out.set(img.pixels.subarray(srcRow, srcRow + r.w * 4), j * r.w * 4);
  }
  return out;
}

function cellRect(f: number, cols: number, cellW: number, cellH: number): CellRect {
  const col = f % cols;
  const row = Math.floor(f / cols);
  return { h: cellH, w: cellW, x: col * cellW, y: row * cellH };
}

function alphaOf(rgba: Uint8ClampedArray): Uint8ClampedArray {
  const a = new Uint8ClampedArray(rgba.length / 4);
  for (let i = 0; i < a.length; i++) a[i] = rgba[i * 4 + 3];
  return a;
}

function lumOf(rgba: Uint8ClampedArray): Uint8ClampedArray {
  const l = new Uint8ClampedArray(rgba.length / 4);
  for (let i = 0; i < l.length; i++) {
    l[i] = Math.round(0.299 * rgba[i * 4] + 0.587 * rgba[i * 4 + 1] + 0.114 * rgba[i * 4 + 2]);
  }
  return l;
}

function bboxFromAlpha(alpha: Uint8ClampedArray, w: number, h: number): BBox | null {
  let minx = w, miny = h, maxx = -1, maxy = -1, sa = 0, sx = 0, sy = 0, area = 0;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const a = alpha[y * w + x];
      if (a > ALPHA_FG) {
        area++;
        if (x < minx) minx = x;
        if (y < miny) miny = y;
        if (x > maxx) maxx = x;
        if (y > maxy) maxy = y;
        sa += a; sx += a * x; sy += a * y;
      }
    }
  }
  if (area === 0) return null;
  return {
    area,
    cx: sx / sa,
    cy: sy / sa,
    fillRatio: area / (w * h),
    height: maxy - miny + 1,
    width: maxx - minx + 1,
    x0: minx, x1: maxx, y0: miny, y1: maxy,
  };
}

/**
 * Segment the button BODY only (the bright pillow), excluding green leaves
 * (high chroma) and the model's dark grid lines (low luminance). This is what
 * the animation contract talks about ("the button body compresses"), so the
 * compression metric must be measured on it — not on the whole foreground,
 * whose extent is pinned to the full cell by swaying leaves + edge contamination.
 */
function bodyBBox(rgba: Uint8ClampedArray, w: number, h: number): BBox | null {
  let minx = w, miny = h, maxx = -1, maxy = -1, sx = 0, sy = 0, area = 0;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      const r = rgba[i], g = rgba[i + 1], b = rgba[i + 2], a = rgba[i + 3];
      const lum = 0.299 * r + 0.587 * g + 0.114 * b;
      const chroma = Math.max(r, g, b) - Math.min(r, g, b);
      if (a > 180 && lum > 170 && chroma < 40) {
        area++;
        if (x < minx) minx = x;
        if (y < miny) miny = y;
        if (x > maxx) maxx = x;
        if (y > maxy) maxy = y;
        sx += x; sy += y;
      }
    }
  }
  if (area < w * h * 0.005) return null; // too little body signal
  return {
    area, cx: sx / area, cy: sy / area, fillRatio: area / (w * h),
    height: maxy - miny + 1, width: maxx - minx + 1, x0: minx, x1: maxx, y0: miny, y1: maxy,
  };
}

function iou(a: Uint8ClampedArray, b: Uint8ClampedArray): number {
  let inter = 0, uni = 0;
  for (let i = 0; i < a.length; i++) {
    const fa = a[i] > ALPHA_FG ? 1 : 0;
    const fb = b[i] > ALPHA_FG ? 1 : 0;
    if (fa || fb) uni++;
    if (fa && fb) inter++;
  }
  return uni === 0 ? 0 : inter / uni;
}

function meanAbsAlphaDiff(a: Uint8ClampedArray, b: Uint8ClampedArray): number {
  let s = 0;
  for (let i = 0; i < a.length; i++) s += Math.abs(a[i] - b[i]);
  return s / a.length;
}

/** Mean abs alpha diff after shifting `b` by (-dx,-dy) to compensate centroid translation. */
function residualAfterShift(a: Uint8ClampedArray, b: Uint8ClampedArray, w: number, h: number, dx: number, dy: number): number {
  let s = 0, c = 0;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const bx = x + dx, by = y + dy;
      if (bx < 0 || bx >= w || by < 0 || by >= h) continue;
      s += Math.abs(a[y * w + x] - b[by * w + bx]);
      c++;
    }
  }
  return c === 0 ? 0 : s / c;
}

// ---------------------------------------------------------------------------
// white<->black per-cell registration via silhouette XOR alignment
// ---------------------------------------------------------------------------
interface Registration {
  bestXorRatio: number;
  cell: number;
  driftPx: number;
  dx: number;
  dy: number;
  lowSignal: boolean;
  zeroShiftXorRatio: number;
}

function registerCell(whiteLum: Uint8ClampedArray, blackLum: Uint8ClampedArray, w: number, h: number, cell: number): Registration {
  // foreground silhouette in each pass, independent of the other
  const whiteMask = new Uint8Array(w * h); // ink = clearly darker than white
  const blackMask = new Uint8Array(w * h); // ink = clearly brighter than black
  let fg = 0;
  for (let i = 0; i < w * h; i++) {
    whiteMask[i] = 255 - whiteLum[i] > SILHOUETTE_T ? 1 : 0;
    blackMask[i] = blackLum[i] > SILHOUETTE_T ? 1 : 0;
    if (whiteMask[i] || blackMask[i]) fg++;
  }
  let best = { dx: 0, dy: 0, ratio: Number.POSITIVE_INFINITY };
  let zero = Number.POSITIVE_INFINITY;
  for (let dy = -SHIFT_RANGE; dy <= SHIFT_RANGE; dy++) {
    for (let dx = -SHIFT_RANGE; dx <= SHIFT_RANGE; dx++) {
      let xor = 0, valid = 0;
      for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
          const wx = x + dx, wy = y + dy;
          if (wx < 0 || wx >= w || wy < 0 || wy >= h) continue;
          valid++;
          if (blackMask[y * w + x] !== whiteMask[wy * w + wx]) xor++;
        }
      }
      const ratio = valid === 0 ? 1 : xor / valid;
      if (dx === 0 && dy === 0) zero = ratio;
      if (ratio < best.ratio) best = { dx, dy, ratio };
    }
  }
  return {
    bestXorRatio: best.ratio,
    cell,
    driftPx: Math.hypot(best.dx, best.dy),
    dx: best.dx,
    dy: best.dy,
    lowSignal: fg < w * h * 0.01,
    zeroShiftXorRatio: zero,
  };
}

// ---------------------------------------------------------------------------
// grid separability from the matte alpha profile
// ---------------------------------------------------------------------------
function gridSeparability(alpha: Uint8ClampedArray, W: number, H: number, cols: number, rows: number, cellW: number, cellH: number) {
  const colDensity = new Float64Array(W);
  const rowDensity = new Float64Array(H);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const a = alpha[y * W + x];
      colDensity[x] += a;
      rowDensity[y] += a;
    }
  }
  for (let x = 0; x < W; x++) colDensity[x] /= H;
  for (let y = 0; y < H; y++) rowDensity[y] /= W;

  const interiorMean = (density: Float64Array, count: number, cell: number) => {
    // mean density sampled at cell centres
    let s = 0;
    for (let k = 0; k < count; k++) {
      const c = Math.round((k + 0.5) * cell);
      s += density[Math.min(density.length - 1, c)];
    }
    return s / count;
  };
  const colInterior = interiorMean(colDensity, cols, cellW);
  const rowInterior = interiorMean(rowDensity, rows, cellH);

  const gutterRatio = (density: Float64Array, lines: number, cell: number, interior: number) => {
    const out: Array<{ line: number; min: number; ratio: number }> = [];
    const win = Math.max(2, Math.round(cell * 0.12));
    for (let k = 1; k < lines; k++) {
      const g = k * cell;
      let min = Number.POSITIVE_INFINITY;
      for (let x = Math.max(0, g - win); x <= Math.min(density.length - 1, g + win); x++) min = Math.min(min, density[x]);
      out.push({ line: g, min, ratio: interior > 0 ? min / interior : 1 });
    }
    return out;
  };

  return {
    colGutters: gutterRatio(colDensity, cols, cellW, colInterior),
    colInteriorMean: colInterior,
    rowGutters: gutterRatio(rowDensity, rows, cellH, rowInterior),
    rowInteriorMean: rowInterior,
  };
}

// ---------------------------------------------------------------------------
// preview + contact sheet rendering
// ---------------------------------------------------------------------------
async function checkerboard(w: number, h: number, sq = 24): Promise<Buffer> {
  const px = Buffer.alloc(w * h * 4);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const c = (Math.floor(x / sq) + Math.floor(y / sq)) % 2 === 0 ? 0xf2 : 0xd6;
      const i = (y * w + x) * 4;
      px[i] = c; px[i + 1] = c; px[i + 2] = c; px[i + 3] = 255;
    }
  }
  return sharp(px, { raw: { channels: 4, height: h, width: w } }).png().toBuffer();
}

async function compositeOverChecker(framePng: Buffer, checker: Buffer): Promise<Buffer> {
  return sharp(checker).composite([{ input: framePng }]).png().toBuffer();
}

async function buildApng(framePngs: Buffer[], outPath: string, fps: number): Promise<void> {
  const dir = await mkdtemp(path.join(tmpdir(), "spike-apng-"));
  try {
    await Promise.all(framePngs.map((b, i) => writeFile(path.join(dir, `frame-${String(i).padStart(3, "0")}.png`), b)));
    await execFileAsync("ffmpeg", [
      "-hide_banner", "-y", "-framerate", String(fps),
      "-i", path.join(dir, "frame-%03d.png"),
      "-plays", "0", "-f", "apng", outPath,
    ], { windowsHide: true });
  } finally {
    await rm(dir, { force: true, recursive: true });
  }
}

async function buildContactSheet(
  cellPngs: Buffer[],
  bboxes: Array<BBox | null>,
  cols: number,
  rows: number,
  cellW: number,
  cellH: number,
  phaseOf: (f: number) => string,
  outPath: string,
): Promise<void> {
  const thumbW = 300;
  const thumbH = Math.round((thumbW * cellH) / cellW);
  const sx = thumbW / cellW;
  const sy = thumbH / cellH;
  const pad = 16;
  const labelH = 24;
  const tileW = thumbW + pad;
  const tileH = thumbH + labelH + pad;
  const sheetW = cols * tileW + pad;
  const sheetH = rows * tileH + pad;
  const checker = await checkerboard(thumbW, thumbH, 16);

  const tiles = await Promise.all(cellPngs.map(async (png) => {
    const scaled = await sharp(png).resize(thumbW, thumbH, { fit: "fill" }).png().toBuffer();
    return compositeOverChecker(scaled, checker);
  }));

  const composites = tiles.map((input, f) => {
    const col = f % cols;
    const row = Math.floor(f / cols);
    return { input, left: pad + col * tileW, top: pad + labelH + row * tileH };
  });

  const labels = cellPngs.map((_, f) => {
    const col = f % cols;
    const row = Math.floor(f / cols);
    const tx = pad + col * tileW;
    const ty = pad + row * tileH;
    const bb = bboxes[f];
    const rect = bb
      ? `<rect x="${(tx + bb.x0 * sx).toFixed(1)}" y="${(ty + labelH + bb.y0 * sy).toFixed(1)}" width="${(bb.width * sx).toFixed(1)}" height="${(bb.height * sy).toFixed(1)}" fill="none" stroke="#e23" stroke-width="2"/>`
      : "";
    return `<text x="${tx + 2}" y="${ty + 17}" font-family="monospace" font-size="15" fill="#1c1917">f${String(f).padStart(2, "0")} ${phaseOf(f)}${bb ? ` h=${bb.height}` : " (empty)"}</text>${rect}`;
  });

  // transparent SVG overlay (labels + bbox rects only) so the tiles stay visible underneath
  const svg = `<svg width="${sheetW}" height="${sheetH}" xmlns="http://www.w3.org/2000/svg">${labels.join("")}</svg>`;

  await sharp({ create: { background: { alpha: 1, b: 244, g: 248, r: 250 }, channels: 4, height: sheetH, width: sheetW } })
    .composite([...composites, { input: Buffer.from(svg), top: 0, left: 0 }])
    .png()
    .toFile(outPath);
}

async function buildOverview(white: DecodedRGBA, black: DecodedRGBA, matte: { height: number; pixels: Uint8ClampedArray; width: number }, outPath: string): Promise<void> {
  const tw = 360;
  const th = Math.round((tw * white.height) / white.width);
  const checker = await checkerboard(tw, th, 18);
  const wb = await sharp(Buffer.from(white.pixels), { raw: { channels: 4, height: white.height, width: white.width } }).resize(tw, th).png().toBuffer();
  const bb = await sharp(Buffer.from(black.pixels), { raw: { channels: 4, height: black.height, width: black.width } }).resize(tw, th).png().toBuffer();
  const mScaled = await sharp(Buffer.from(matte.pixels), { raw: { channels: 4, height: matte.height, width: matte.width } }).resize(tw, th).png().toBuffer();
  const mb = await compositeOverChecker(mScaled, checker);
  const pad = 12;
  const W = tw * 3 + pad * 4;
  const H = th + pad * 2 + 22;
  const svg = `<svg width="${W}" height="${H}" xmlns="http://www.w3.org/2000/svg"><text x="${pad}" y="${th + pad + 18}" font-family="monospace" font-size="14" fill="#333">white pass</text><text x="${pad * 2 + tw}" y="${th + pad + 18}" font-family="monospace" font-size="14" fill="#333">black pass (img2img)</text><text x="${pad * 3 + tw * 2}" y="${th + pad + 18}" font-family="monospace" font-size="14" fill="#333">recovered matte (on checker)</text></svg>`;
  await sharp({ create: { background: { alpha: 1, b: 244, g: 248, r: 250 }, channels: 4, height: H, width: W } })
    .composite([
      { input: wb, left: pad, top: pad },
      { input: bb, left: pad * 2 + tw, top: pad },
      { input: mb, left: pad * 3 + tw * 2, top: pad },
      { input: Buffer.from(svg), left: 0, top: 0 },
    ])
    .png()
    .toFile(outPath);
}

// ---------------------------------------------------------------------------
// prompts (self-contained; the contract is encoded here, not in prod prompts)
// ---------------------------------------------------------------------------
function whiteSheetPrompt(): string {
  return [
    "A single flat 2D sprite sheet for a stylized mobile UI button, laid out as a STRICT REGULAR GRID of EXACTLY 4 columns and 3 rows = 12 cells total, read left-to-right, top-to-bottom as one animation sequence.",
    "",
    "Subject (identical in every cell): the SAME stylized pillowy rounded-rectangle game-UI button overgrown with small lush green leaves and little bushes around its edges — a 'living' button. Soft 3D candy-UI shading, vibrant, clean.",
    "",
    "GRID RULES:",
    "- 4 equal-width columns and 3 equal-height rows. Every cell is exactly the same size.",
    "- Each frame is centered and fully isolated inside its own cell with clear empty margin; nothing crosses a cell boundary.",
    "- The button is registered to the SAME center point in every cell (it does not slide around between cells).",
    "",
    "ANIMATION CONTRACT across the 12 frames:",
    "- Frames 1-3 (top row): IDLE. The button BODY is completely still and unchanged; ONLY the surrounding leaves/bushes sway gently (slightly different leaf positions each frame).",
    "- Frames 4-6 (middle row): PRESS DOWN. The button body visibly COMPRESSES / squashes downward and inward (shorter, slightly wider), as if pushed, while staying centered on the same point. Leaves keep swaying.",
    "- Frames 7-9: HELD. The button body STAYS in its compressed pressed-down shape; leaves keep moving.",
    "- Frames 10-12 (bottom row): RELEASE. The button body springs back up, rebounding so that frame 12 matches frame 1's idle button shape.",
    "",
    "HARD CONSTRAINTS:",
    "- NO text, NO numbers, NO letters, NO labels anywhere.",
    "- NO app screenshot, NO phone/device frame, NO scene or environment, NO drop shadows on the background, NO gradient background.",
    "- Do NOT draw grid lines or borders — separate the cells purely with equal empty white space.",
    "- Background is pure solid flat white #FFFFFF behind and between all cells.",
  ].join("\n");
}

function blackSheetPrompt(): string {
  return [
    "Attached is a finished 4x3 (12-cell) sprite sheet.",
    "Regenerate the EXACT same sprite sheet: identical grid layout, identical 4 columns x 3 rows, and every single cell's button + leaves PIXEL-IDENTICAL in shape, pose, position, size, colour and detail to the attached image.",
    "The ONLY change: replace the white background with pure solid flat black #000000 behind and between all cells.",
    "No shadows, no reflections, no gradients, no grid lines, no text. Everything except the background colour must stay pixel-for-pixel the same as the attached sheet.",
  ].join("\n");
}

// ---------------------------------------------------------------------------
// main
// ---------------------------------------------------------------------------
function fsTimestamp(): string {
  return new Date().toISOString().replace(/[:.]/g, "-").replace("T", "_").slice(0, 19);
}

async function loadSheetFromDisk(dir: string, name: string): Promise<GenResult> {
  const buf = await readFile(path.join(dir, name));
  return { imageBase64: Buffer.from(buf).toString("base64"), mimeType: "image/png", modelId: "(from-disk)", text: "" };
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const models = args.model ? [args.model] : FALLBACK_MODELS;
  const ts = fsTimestamp();
  const outDir = args.from ?? args.out ?? path.join("tmp", "living-ui-sprite-sheet-capability", ts);
  const framesDir = path.join(outDir, "frames");
  await mkdir(framesDir, { recursive: true });
  const whitePrompt = whiteSheetPrompt();
  const blackPrompt = blackSheetPrompt();
  console.log(`[spike] out: ${outDir}`);

  let white: GenResult;
  let black: GenResult;

  if (args.from) {
    // ---- re-analyze an already-generated pair (no API cost) --------------
    console.log(`[spike] re-analyzing existing sheets in ${args.from} (no generation)`);
    white = await loadSheetFromDisk(args.from, "white.png");
    black = await loadSheetFromDisk(args.from, "black.png");
  } else {
    console.log(`[spike] models: ${models.join(", ")}  size=${args.size}  aspect=${args.aspect}`);
    const runtimeConfig = readGeminiRuntimeConfigFromEnv();
    const client = createGeminiClient(runtimeConfig);
    const genConfig = { aspectRatio: args.aspect, imageSize: args.size };
    await writeFile(path.join(outDir, "prompts.json"), `${JSON.stringify({ aspect: args.aspect, blackPrompt, size: args.size, whitePrompt }, null, 2)}\n`);

    // ---- white pass ------------------------------------------------------
    console.log("[spike] generating WHITE sprite sheet …");
    white = await generate(client, models, [{ text: whitePrompt }], genConfig);
    await writeFile(path.join(outDir, "white.png"), new Uint8Array(Buffer.from(white.imageBase64, "base64")));
    console.log(`[spike] white ok via ${white.modelId} (${white.mimeType})`);

    // ---- black pass (img2img conditioned on white) -----------------------
    console.log("[spike] generating BLACK sprite sheet (img2img on white) …");
    try {
      black = await generate(
        client,
        [white.modelId], // pin to whichever model produced the white sheet
        [{ inlineData: { data: white.imageBase64, mimeType: white.mimeType } }, { text: blackPrompt }],
        genConfig,
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await writeFile(path.join(outDir, "MATTE-PATH-UNTESTABLE.txt"),
        `Black img2img pass failed — cannot test the difference-matte path with this API path.\nModel: ${white.modelId}\nError: ${message}\n`);
      console.error(`[spike] STOP: black img2img pass failed; matte path cannot be tested. ${message}`);
      throw error;
    }
    await writeFile(path.join(outDir, "black.png"), new Uint8Array(Buffer.from(black.imageBase64, "base64")));
    console.log(`[spike] black ok via ${black.modelId} (${black.mimeType})`);

    if (white.text || black.text) {
      await writeFile(path.join(outDir, "model-text.json"), `${JSON.stringify({ blackText: black.text, whiteText: white.text }, null, 2)}\n`);
    }
  }

  // ---- decode + register dims --------------------------------------------
  let whiteDec = await decodeRGBA(white);
  let blackDec = await decodeRGBA(black);
  const rawDims = {
    black: { height: blackDec.height, width: blackDec.width },
    white: { height: whiteDec.height, width: whiteDec.width },
  };
  let resized = false;
  if (whiteDec.width !== blackDec.width || whiteDec.height !== blackDec.height) {
    resized = true;
    const w = Math.min(whiteDec.width, blackDec.width);
    const h = Math.min(whiteDec.height, blackDec.height);
    whiteDec = await resizeRGBA(whiteDec, w, h);
    blackDec = await resizeRGBA(blackDec, w, h);
  }
  const W = whiteDec.width;
  const H = whiteDec.height;

  // ---- difference matte ---------------------------------------------------
  const matte = differenceMatte({ blackBg: blackDec.pixels, height: H, whiteBg: whiteDec.pixels, width: W });
  await writeFile(path.join(outDir, "transparent-sheet.png"), new Uint8Array(await encodePng(matte.pixels, matte.width, matte.height)));

  // ---- detect the grid the model ACTUALLY drew ---------------------------
  const matteAlpha = alphaOf(matte.pixels);
  const detected = detectGrid(matteAlpha, W, H);
  const detectedMatchesN = detected.colBands * detected.rowBands === REQ_N;
  const cols = args.cols ?? (detectedMatchesN ? detected.colBands : REQ_COLS);
  const rows = args.rows ?? (detectedMatchesN ? detected.rowBands : REQ_ROWS);
  const n = cols * rows;
  const cellW = Math.floor(W / cols);
  const cellH = Math.floor(H / rows);
  const transposed = detectedMatchesN && detected.colBands === REQ_ROWS && detected.rowBands === REQ_COLS;
  console.log(`[spike] sheet ${W}x${H}  requested ${REQ_COLS}x${REQ_ROWS}  detected ${detected.colBands}x${detected.rowBands} (even col=${detected.colEven} row=${detected.rowEven})  using ${cols}x${rows}  cell ${cellW}x${cellH}${transposed ? "  [TRANSPOSED]" : ""}`);

  // phase grouping: split the n frames into 4 equal phase groups (idle/press/hold/release)
  const q = Math.floor(n / 4);
  const phaseLabels = ["idle", "press", "hold", "release"] as const;
  const phaseOf = (f: number): string => phaseLabels[Math.min(3, Math.floor(f / q))];
  const idleIdx = Array.from({ length: q }, (_, i) => i);
  const pressIdx = Array.from({ length: q }, (_, i) => q + i);
  const heldIdx = Array.from({ length: q }, (_, i) => 2 * q + i);

  // ---- slice into transparent cells --------------------------------------
  const cellRgba: Uint8ClampedArray[] = [];
  const cellPng: Buffer[] = [];
  for (let f = 0; f < n; f++) {
    const r = cellRect(f, cols, cellW, cellH);
    const crop = cropRGBA({ height: H, pixels: matte.pixels, width: W }, r);
    cellRgba.push(crop);
    const png = await encodePng(crop, cellW, cellH);
    cellPng.push(png);
    await writeFile(path.join(framesDir, `frame-${String(f).padStart(2, "0")}.png`), new Uint8Array(png));
  }

  // ---- per-cell alpha analysis -------------------------------------------
  const cellAlpha = cellRgba.map((c) => alphaOf(c));
  const bboxes = cellAlpha.map((a) => bboxFromAlpha(a, cellW, cellH)); // whole foreground (button + leaves)
  const bodyBoxes = cellRgba.map((c) => bodyBBox(c, cellW, cellH)); // button body only (the pillow)

  // ---- white<->black registration per cell -------------------------------
  const registrations: Registration[] = [];
  for (let f = 0; f < n; f++) {
    const r = cellRect(f, cols, cellW, cellH);
    const wl = lumOf(cropRGBA(whiteDec, r));
    const bl = lumOf(cropRGBA(blackDec, r));
    registrations.push(registerCell(wl, bl, cellW, cellH, f));
  }
  const regSignal = registrations.filter((r) => !r.lowSignal);
  const maxDriftPx = regSignal.reduce((m, r) => Math.max(m, r.driftPx), 0);
  const cellsWithin1px = regSignal.filter((r) => r.driftPx <= 1).length;

  // ---- transition metrics (centroid drift / size / translation vs deform) -
  const transitions = [];
  for (let f = 0; f < n - 1; f++) {
    const a = bboxes[f];
    const b = bboxes[f + 1];
    const interiorChange = meanAbsAlphaDiff(cellAlpha[f], cellAlpha[f + 1]);
    let centroidDrift = 0, widthChange = 0, heightChange = 0, residual = 0, ioU = 0;
    if (a && b) {
      centroidDrift = Math.hypot(b.cx - a.cx, b.cy - a.cy);
      widthChange = b.width - a.width;
      heightChange = b.height - a.height;
      residual = residualAfterShift(cellAlpha[f], cellAlpha[f + 1], cellW, cellH, Math.round(b.cx - a.cx), Math.round(b.cy - a.cy));
      ioU = iou(cellAlpha[f], cellAlpha[f + 1]);
    }
    const transPx = cellW * 0.03;
    const kind = !a || !b ? "missing" : centroidDrift > transPx ? "translation" : interiorChange > 0.5 ? "internal-deformation/effect" : "near-static";
    transitions.push({
      centroidDrift: round(centroidDrift),
      from: f, heightChange, interiorChange: round(interiorChange),
      iou: round(ioU), kind, residualAfterTranslation: round(residual), to: f + 1, widthChange,
    });
  }

  // ---- behaviour verdicts (measured on the BUTTON BODY, not whole fg) -----
  const bodyOk = bodyBoxes.every((b) => b);
  const meanH = (idxs: number[]) => idxs.reduce((s, i) => s + (bodyBoxes[i]?.height ?? 0), 0) / idxs.length;
  const meanBottom = (idxs: number[]) => idxs.reduce((s, i) => s + (bodyBoxes[i]?.y1 ?? 0), 0) / idxs.length;
  const meanTop = (idxs: number[]) => idxs.reduce((s, i) => s + (bodyBoxes[i]?.y0 ?? 0), 0) / idxs.length;

  const idleH = meanH(idleIdx);
  const pressH = meanH(pressIdx);
  const heldH = meanH(heldIdx);
  const idleBottom = meanBottom(idleIdx);
  const pressBottom = meanBottom(pressIdx);
  const idleTop = meanTop(idleIdx);
  const pressTop = meanTop(pressIdx);

  // passive: BODY centroid stationary within idle group, but whole-fg effect present (leaves move)
  const bodyCentroidDrift = (f: number, g: number) => {
    const a = bodyBoxes[f], b = bodyBoxes[g];
    return a && b ? Math.hypot(b.cx - a.cx, b.cy - a.cy) : Infinity;
  };
  const idlePairDrifts = idleIdx.slice(0, -1).map((f) => bodyCentroidDrift(f, f + 1));
  const passiveBodyStationaryPx = idlePairDrifts.length ? Math.max(...idlePairDrifts) : 0;
  const passivePairs = transitions.filter((t) => t.to <= q - 1); // transitions fully inside the idle group
  const passiveEffectChange = passivePairs.length ? Math.min(...passivePairs.map((t) => t.interiorChange)) : 0;

  const compressionRatio = idleH > 0 ? pressH / idleH : 1; // <1 => body compressed during press
  const heldRatio = idleH > 0 ? heldH / idleH : 1;
  const bottomShiftPress = pressBottom - idleBottom; // ~0 => compression anchored at bottom
  const topShiftPress = pressTop - idleTop; // >0 => top edge moved down (compression)

  const release0 = bodyBoxes[0];
  const releaseLast = bodyBoxes[n - 1];
  const releaseHeightRatio = release0 && releaseLast ? releaseLast.height / release0.height : 0;
  const releaseCentroidDist = release0 && releaseLast ? Math.hypot(releaseLast.cx - release0.cx, releaseLast.cy - release0.cy) : Infinity;
  const releaseIoU = iou(cellAlpha[0], cellAlpha[n - 1]); // whole-fg overlap, for loop usability

  // ---- grid separability --------------------------------------------------
  const sep = gridSeparability(matteAlpha, W, H, cols, rows, cellW, cellH);
  const maxColGutterRatio = sep.colGutters.length ? Math.max(...sep.colGutters.map((g) => g.ratio)) : 0;
  const maxRowGutterRatio = sep.rowGutters.length ? Math.max(...sep.rowGutters.map((g) => g.ratio)) : 0;

  const verdicts: Record<string, unknown> = {
    grid_12cell_present: bboxes.every((b) => b && b.fillRatio > 0.01),
    grid_matches_requested_4x3: cols === REQ_COLS && rows === REQ_ROWS,
    grid_orientation_note: transposed ? `model drew ${cols}x${rows} (transposed from requested ${REQ_COLS}x${REQ_ROWS})` : `${cols}x${rows}`,
    cells_equal_and_separable: maxColGutterRatio < 0.5 && maxRowGutterRatio < 0.5 && detected.colEven && detected.rowEven,
    registration_white_black_within_1px: regSignal.length > 0 && maxDriftPx <= 1,
    passive_body_stationary: bodyOk && passiveBodyStationaryPx <= cellH * 0.02,
    passive_effect_animates: passiveEffectChange > 0.5,
    press_shows_compression: bodyOk && compressionRatio < 0.95 && Math.abs(bottomShiftPress) < cellH * 0.06 && topShiftPress > 0,
    held_stays_compressed: bodyOk && heldRatio < 0.97,
    release_returns_to_idle: releaseHeightRatio > 0.9 && releaseHeightRatio < 1.1 && releaseIoU > 0.6 && releaseCentroidDist < cellH * 0.05,
    avoided_text_chrome_scene: "manual-review",
    loop_usable_as_ui_state_asset: (releaseIoU > 0.6) ? "likely (auto)" : "manual-review",
  };

  // ---- previews -----------------------------------------------------------
  console.log("[spike] rendering previews + contact sheet …");
  const checker = await checkerboard(cellW, cellH, 24);
  const overCells = await Promise.all(cellPng.map((p) => compositeOverChecker(p, checker)));
  let previewPassive: string | null = null;
  let previewPressRelease: string | null = null;
  try {
    await buildApng(idleIdx.map((i) => overCells[i]), path.join(outDir, "preview-passive.apng"), 6);
    previewPassive = "preview-passive.apng";
    await buildApng(overCells, path.join(outDir, "preview-press-release.apng"), 8);
    previewPressRelease = "preview-press-release.apng";
  } catch (error) {
    console.warn(`[spike] ffmpeg preview failed (non-fatal): ${error instanceof Error ? error.message : String(error)}`);
  }

  await buildContactSheet(cellPng, bboxes, cols, rows, cellW, cellH, phaseOf, path.join(outDir, "contact-sheet.png"));
  await buildOverview(whiteDec, blackDec, matte, path.join(outDir, "overview.png"));

  // ---- analysis.json ------------------------------------------------------
  const analysis = {
    spike: "living-ui-sprite-sheet-capability",
    question: "Can Gemini 3 Pro Image generate one coherent UI-behaviour sprite sheet that survives the white/black difference-matte pipeline?",
    generatedAt: new Date().toISOString(),
    model: { requested: models, whiteVia: white.modelId, blackVia: black.modelId, imageSize: args.size, aspectRatio: args.aspect, reanalyzedFromDisk: Boolean(args.from) },
    grid: { requested: { cols: REQ_COLS, rows: REQ_ROWS }, detected: { cols: detected.colBands, rows: detected.rowBands, colEven: detected.colEven, rowEven: detected.rowEven }, used: { cols, rows, n }, transposed },
    sheet: { rawDims, resizedToCommon: resized, matteWidth: W, matteHeight: H, cellW, cellH },
    perCell: bboxes.map((b, f) => ({
      frame: f,
      phase: phaseOf(f),
      bbox: b && { x0: b.x0, y0: b.y0, x1: b.x1, y1: b.y1, width: b.width, height: b.height, fillRatio: round(b.fillRatio), centroid: [round(b.cx), round(b.cy)] },
      body: bodyBoxes[f] && { x0: bodyBoxes[f]!.x0, y0: bodyBoxes[f]!.y0, x1: bodyBoxes[f]!.x1, y1: bodyBoxes[f]!.y1, width: bodyBoxes[f]!.width, height: bodyBoxes[f]!.height, centroid: [round(bodyBoxes[f]!.cx), round(bodyBoxes[f]!.cy)] },
      registration: registrations[f] && {
        driftPx: round(registrations[f].driftPx), shift: [registrations[f].dx, registrations[f].dy],
        bestXorRatio: round(registrations[f].bestXorRatio), zeroShiftXorRatio: round(registrations[f].zeroShiftXorRatio), lowSignal: registrations[f].lowSignal,
      },
    })),
    transitions,
    gridSeparability: {
      colGutters: sep.colGutters.map((g) => ({ line: g.line, ratio: round(g.ratio) })),
      rowGutters: sep.rowGutters.map((g) => ({ line: g.line, ratio: round(g.ratio) })),
      colInteriorMean: round(sep.colInteriorMean), rowInteriorMean: round(sep.rowInteriorMean),
      maxColGutterRatio: round(maxColGutterRatio), maxRowGutterRatio: round(maxRowGutterRatio),
      note: "ratio = min alpha-density in the gutter band / mean density at cell centres. ~0 = clean separable gutter; ~1 = no gutter (content bleeds across the grid line).",
    },
    registrationSummary: { cellsWithSignal: regSignal.length, maxDriftPx: round(maxDriftPx), cellsWithin1px, note: "drift = integer px shift that best aligns the white-pass silhouette to the black-pass silhouette (XOR-minimising), per cell." },
    behaviour: {
      measuredOn: "button-body (bright low-chroma pillow; leaves + grid-lines excluded)",
      bodySegmentedCells: bodyBoxes.filter(Boolean).length,
      idleBodyHeight: round(idleH), pressBodyHeight: round(pressH), heldBodyHeight: round(heldH),
      compressionRatio: round(compressionRatio), heldRatio: round(heldRatio),
      bottomShiftPressPx: round(bottomShiftPress), topShiftPressPx: round(topShiftPress),
      passiveBodyMaxCentroidDriftPx: round(passiveBodyStationaryPx), passiveMinInteriorChange: round(passiveEffectChange),
      releaseBodyHeightRatio: round(releaseHeightRatio), releaseBodyCentroidDistPx: round(releaseCentroidDist), releaseWholeFgIoU: round(releaseIoU),
    },
    verdicts,
    thresholds: { ALPHA_FG, SILHOUETTE_T, SHIFT_RANGE, transTranslationPx: round(cellW * 0.03), passiveStationaryPx: round(cellH * 0.02) },
    manualReviewNotes: null,
    exports: {
      white: "white.png", black: "black.png", transparentSheet: "transparent-sheet.png",
      frames: "frames/frame-00.png … frame-11.png", contactSheet: "contact-sheet.png", overview: "overview.png",
      previewPassive, previewPressRelease,
    },
  };
  await writeFile(path.join(outDir, "analysis.json"), `${JSON.stringify(analysis, null, 2)}\n`);

  // ---- console summary ----------------------------------------------------
  console.log("\n=== SPIKE SUMMARY ===");
  console.log(`sheet           ${W}x${H}  cell ${cellW}x${cellH}  (raw white ${rawDims.white.width}x${rawDims.white.height}, black ${rawDims.black.width}x${rawDims.black.height})`);
  console.log(`grid            requested ${REQ_COLS}x${REQ_ROWS}  detected ${detected.colBands}x${detected.rowBands}  using ${cols}x${rows}${transposed ? "  [TRANSPOSED]" : ""}  (even col=${detected.colEven} row=${detected.rowEven})`);
  console.log(`grid gutters    col max ratio ${round(maxColGutterRatio)}  row max ratio ${round(maxRowGutterRatio)}  (lower=better, <0.5 separable)`);
  console.log(`registration    maxDrift ${round(maxDriftPx)}px  cells<=1px ${cellsWithin1px}/${regSignal.length}`);
  console.log(`compression     idleH ${round(idleH)} pressH ${round(pressH)} heldH ${round(heldH)}  ratio ${round(compressionRatio)}  bottomShift ${round(bottomShiftPress)} topShift ${round(topShiftPress)}`);
  console.log(`release         heightRatio ${round(releaseHeightRatio)} IoU(0,last) ${round(releaseIoU)} centroidDist ${round(releaseCentroidDist)}px`);
  console.log("verdicts:");
  for (const [k, v] of Object.entries(verdicts)) console.log(`  ${k.padEnd(38)} ${String(v)}`);
  console.log(`\n[spike] artifacts in ${outDir}`);
}

function round(n: number): number {
  return Math.round(n * 1000) / 1000;
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
