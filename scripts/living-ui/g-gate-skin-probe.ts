/**
 * G-gate skin probe — can generation produce the rig's still SKIN LAYERS?
 *
 * The §7 G-gate question, isolated from motion. The sprite-sheet spike already
 * proved generation must NOT own behaviour (κ_press = 0.998, boil). This probe
 * asks the *other* half — the half the whole vision rests on:
 *
 *   Can Gemini generate a CLEAN, ISOLATED, TRANSPARENT still layer for a defined
 *   rig slot (foliage cluster, button face, accent), that survives our white/black
 *   difference-matte and drops into the runtime with no manual surgery?
 *
 * It reuses prod auth (readGeminiRuntimeConfigFromEnv / createGeminiClient) and the
 * prod matte (differenceMatte), and drives the Pro image model that honours
 * imageSize. It writes matted PNGs over a checkerboard (so the result is visible)
 * plus a JSON report with the G-gate-relevant measures:
 *   - registration drift (white↔black, px)   §3.1 / G-gate "≤ 1 px"
 *   - isolation (border transparency)         decomposition: a layer, not a scene
 *   - alpha coverage                          there is a subject, matted cleanly
 *   - size honoured                           §3.8
 *
 * Run (from repo root):
 *   pnpm exec tsx scripts/living-ui/g-gate-skin-probe.ts --slots foliage,button-face --repeats 2 --size 1K
 * Flags: --slots <csv> --repeats <n> --size <512|1K|2K|4K> --aspect <ratio> --model <id> --out <dir>
 */
import { readFileSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";
import {
  createGeminiClient,
  normalizeGeminiImageMimeType,
  readGeminiRuntimeConfigFromEnv,
  type GeminiImageResult,
} from "../../src/convex/lib/gemini.js";
import { differenceMatte } from "../../src/convex/lib/generation/matte.js";

const FALLBACK_MODELS = ["gemini-3-pro-image-preview", "gemini-3-pro-image"];
const ALPHA_FG = 24; // alpha above this counts as foreground
const SILHOUETTE_T = 40; // luminance distance from pure bg to count as ink
const SHIFT_RANGE = 3; // px search window for white<->black registration

// ---------------------------------------------------------------------------
// slot prompts — each is one ISOLATED transparent layer (not a scene, not a sheet)
// ---------------------------------------------------------------------------
interface SlotSpec {
  readonly id: string;
  readonly white: string;
  readonly black: string;
}

const ISOLATION =
  "Centered, filling ~70% of the frame. The background MUST be perfectly flat solid white #FFFFFF — " +
  "no gradient, no vignette, no drop shadow cast on the background, no ground plane, no container, no UI " +
  "chrome, no text, no border. A single isolated subject only, so it can be cleanly matted out.";

function blackPrompt(subject: string): string {
  return (
    `Regenerate the EXACT SAME ${subject} from the reference image — identical shape, position, scale, and ` +
    `every detail — but place it on a perfectly flat SOLID BLACK #000000 background. Change ONLY the background ` +
    `colour from white to black; keep the subject pixel-identical. No shadows or glow on the background.`
  );
}

const SLOTS: Record<string, SlotSpec> = {
  foliage: {
    id: "foliage",
    white:
      "A single isolated cluster of stylized, softly painterly leaves — a small botanical sprig used as a UI " +
      "accent layer in a premium mobile game. Warm sage-and-forest greens, gentle front-to-back depth, soft " +
      "studio light, hand-illustrated but crisp. " +
      ISOLATION,
    black: blackPrompt("leaf cluster"),
  },
  "button-face": {
    id: "button-face",
    white:
      "An isolated stylized mobile-game UI button face: a soft rounded-rectangle pill with a warm terracotta " +
      "gradient (lighter top, deeper bottom), a subtle top highlight and gentle bevel, premium and tactile, " +
      "matte finish. NO label text on it. " +
      ISOLATION,
    black: blackPrompt("rounded button face"),
  },
  seed: {
    id: "seed",
    white:
      "An isolated glowing seed-pod thumb for a UI slider: a small rounded organic pod with a warm inner glow " +
      "and a tiny sprout on top, premium game art. " +
      ISOLATION,
    black: blackPrompt("glowing seed-pod"),
  },
  background: {
    id: "background",
    white:
      "An isolated decorative botanical overlay band for a mobile-game UI background: a few scattered ferns, " +
      "drifting leaves and tiny light motes arranged across the lower frame with lots of empty negative space, " +
      "painterly, soft, premium, restrained. " +
      ISOLATION,
    black: blackPrompt("scattered botanical overlay"),
  },
  bloom: {
    id: "bloom",
    white:
      "An isolated soft success bloom for game UI feedback: a gentle radiant burst of light petals and a few " +
      "sparkles opening outward with a warm glow. " +
      ISOLATION,
    black: blackPrompt("soft light bloom"),
  },
};

// ---------------------------------------------------------------------------
// args
// ---------------------------------------------------------------------------
function parseArgs(argv: string[]) {
  const get = (flag: string) => {
    const i = argv.indexOf(flag);
    return i >= 0 ? argv[i + 1] : undefined;
  };
  return {
    slots: (get("--slots") ?? "foliage").split(",").map((s) => s.trim()).filter(Boolean),
    repeats: Number(get("--repeats") ?? 1),
    size: get("--size") ?? "1K",
    aspect: get("--aspect") ?? "1:1",
    model: get("--model"),
    out: get("--out") ?? `scripts/living-ui/.gctte-out/${fsTimestamp()}`,
  };
}

function fsTimestamp(): string {
  return new Date().toISOString().replace(/[:.]/g, "-").replace("T", "_").slice(0, 19);
}

// ---------------------------------------------------------------------------
// generation (model fallback, mirrors the prod auth path)
// ---------------------------------------------------------------------------
function ensureProject() {
  if (process.env.VERTEX_AI_PROJECT_ID || process.env.GOOGLE_CLOUD_PROJECT || process.env.GCLOUD_PROJECT) {
    return;
  }
  const keyFile = process.env.GOOGLE_APPLICATION_CREDENTIALS;
  if (keyFile) {
    try {
      const sa = JSON.parse(readFileSync(keyFile, "utf8"));
      if (sa.project_id) {
        process.env.GOOGLE_CLOUD_PROJECT = sa.project_id;
      }
    } catch {
      /* fall through to the explicit error in readGeminiRuntimeConfigFromEnv */
    }
  }
}

async function decodeRGBA(image: GeminiImageResult) {
  const buf = Buffer.from(image.imageBase64, "base64");
  const { data, info } = await sharp(buf).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  return { pixels: new Uint8ClampedArray(data), width: info.width, height: info.height };
}

async function resizeRGBA(img: { pixels: Uint8ClampedArray; width: number; height: number }, w: number, h: number) {
  if (img.width === w && img.height === h) {
    return img;
  }
  const { data } = await sharp(Buffer.from(img.pixels), { raw: { width: img.width, height: img.height, channels: 4 } })
    .resize(w, h, { fit: "fill" })
    .raw()
    .toBuffer({ resolveWithObject: true });
  return { pixels: new Uint8ClampedArray(data), width: w, height: h };
}

// ---------------------------------------------------------------------------
// analysis
// ---------------------------------------------------------------------------
function silhouetteFromBg(rgba: Uint8ClampedArray, bgWhite: boolean): Uint8Array {
  const n = rgba.length / 4;
  const sil = new Uint8Array(n);
  for (let i = 0; i < n; i++) {
    const r = rgba[i * 4], g = rgba[i * 4 + 1], b = rgba[i * 4 + 2];
    const lum = 0.299 * r + 0.587 * g + 0.114 * b;
    const dist = bgWhite ? 255 - lum : lum;
    sil[i] = dist > SILHOUETTE_T ? 1 : 0;
  }
  return sil;
}

function registrationDrift(white: Uint8ClampedArray, black: Uint8ClampedArray, w: number, h: number) {
  const a = silhouetteFromBg(white, true);
  const b = silhouetteFromBg(black, false);
  let best = { dx: 0, dy: 0, xor: Number.POSITIVE_INFINITY };
  for (let dy = -SHIFT_RANGE; dy <= SHIFT_RANGE; dy++) {
    for (let dx = -SHIFT_RANGE; dx <= SHIFT_RANGE; dx++) {
      let xor = 0, count = 0;
      for (let y = 0; y < h; y += 2) {
        const sy = y + dy;
        if (sy < 0 || sy >= h) continue;
        for (let x = 0; x < w; x += 2) {
          const sx = x + dx;
          if (sx < 0 || sx >= w) continue;
          xor += a[y * w + x] ^ b[sy * w + sx];
          count++;
        }
      }
      const rate = count ? xor / count : 1;
      if (rate < best.xor) best = { dx, dy, xor: rate };
    }
  }
  return { driftPx: Math.max(Math.abs(best.dx), Math.abs(best.dy)), mismatchRate: round(best.xor) };
}

function analyzeMatte(matte: Uint8ClampedArray, w: number, h: number) {
  const n = w * h;
  let fg = 0, borderTotal = 0, borderTransparent = 0, edgeAlphaSum = 0, edgeCount = 0;
  const border = Math.max(2, Math.round(Math.min(w, h) * 0.02));
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const a = matte[(y * w + x) * 4 + 3];
      if (a > ALPHA_FG) fg++;
      const isBorder = x < border || y < border || x >= w - border || y >= h - border;
      if (isBorder) {
        borderTotal++;
        if (a <= ALPHA_FG) borderTransparent++;
      }
      // partial-alpha edge pixels (fringe quality)
      if (a > 8 && a < 247) { edgeAlphaSum += a; edgeCount++; }
    }
  }
  return {
    alphaCoveragePct: round((fg / n) * 100),
    borderTransparencyPct: round((borderTransparent / Math.max(1, borderTotal)) * 100),
    softEdgePct: round((edgeCount / n) * 100),
  };
}

function round(n: number): number {
  return Math.round(n * 1000) / 1000;
}

// ---------------------------------------------------------------------------
// rendering helpers (visible output)
// ---------------------------------------------------------------------------
async function checker(w: number, h: number, sq = 16): Promise<Buffer> {
  const px = Buffer.alloc(w * h * 4);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const on = ((x / sq) | 0) % 2 === ((y / sq) | 0) % 2;
      const v = on ? 220 : 180;
      const i = (y * w + x) * 4;
      px[i] = v; px[i + 1] = v; px[i + 2] = v; px[i + 3] = 255;
    }
  }
  return sharp(px, { raw: { width: w, height: h, channels: 4 } }).png().toBuffer();
}

async function pngFromRGBA(pixels: Uint8ClampedArray, w: number, h: number): Promise<Buffer> {
  return sharp(Buffer.from(pixels), { raw: { width: w, height: h, channels: 4 } }).png().toBuffer();
}

// ---------------------------------------------------------------------------
// main
// ---------------------------------------------------------------------------
async function main() {
  const args = parseArgs(process.argv.slice(2));
  ensureProject();
  const runtime = readGeminiRuntimeConfigFromEnv();
  const client = createGeminiClient(runtime);
  const outDir = path.resolve(args.out);
  await mkdir(outDir, { recursive: true });

  const models = args.model ? [args.model] : FALLBACK_MODELS;
  console.log(`G-gate skin probe → ${outDir}`);
  console.log(`  slots=${args.slots.join(",")} repeats=${args.repeats} size=${args.size} aspect=${args.aspect}`);

  const results: unknown[] = [];
  let calls = 0;

  for (const slotId of args.slots) {
    const spec = SLOTS[slotId];
    if (!spec) {
      console.warn(`  ! unknown slot "${slotId}" (have: ${Object.keys(SLOTS).join(", ")})`);
      continue;
    }
    for (let rep = 0; rep < args.repeats; rep++) {
      const tag = `${slotId}-${rep + 1}`;
      try {
        // Each pass is a FRESH chat so the white pass isn't biased; the black pass
        // is img2img anchored on the white image (the §3.1 registration path).
        const wSession = client.chats.create({
          model: models[0],
          config: { responseModalities: ["IMAGE"], imageConfig: { aspectRatio: args.aspect, imageSize: args.size } },
        });
        const wResp = await wSession.sendMessage({ message: spec.white });
        calls++;
        const white = extractImage(wResp, tag, "white");

        const bResp = await wSession.sendMessage({
          message: [
            { inlineData: { data: white.imageBase64, mimeType: white.mimeType } },
            { text: spec.black },
          ],
        });
        calls++;
        const black = extractImage(bResp, tag, "black");

        const wImg = await decodeRGBA(white);
        let bImg = await decodeRGBA(black);
        bImg = await resizeRGBA(bImg, wImg.width, wImg.height);

        const reg = registrationDrift(wImg.pixels, bImg.pixels, wImg.width, wImg.height);
        const matte = differenceMatte({ whiteBg: wImg.pixels, blackBg: bImg.pixels, width: wImg.width, height: wImg.height });
        const stats = analyzeMatte(matte.pixels, matte.width, matte.height);

        // visible artifacts
        const ck = await checker(matte.width, matte.height);
        const matteOverChecker = await sharp(ck)
          .composite([{ input: await pngFromRGBA(matte.pixels, matte.width, matte.height), blend: "over" }])
          .png()
          .toBuffer();
        await writeFile(path.join(outDir, `${tag}-white.png`), Buffer.from(white.imageBase64, "base64"));
        await writeFile(path.join(outDir, `${tag}-black.png`), Buffer.from(black.imageBase64, "base64"));
        await writeFile(path.join(outDir, `${tag}-matte.png`), matteOverChecker);

        const row = {
          slot: slotId,
          rep: rep + 1,
          size: `${wImg.width}x${wImg.height}`,
          sizeHonored: wImg.width >= 960,
          registrationDriftPx: reg.driftPx,
          registrationMismatchRate: reg.mismatchRate,
          ...stats,
        };
        results.push(row);
        console.log(`  ✓ ${tag}: ${row.size} drift=${reg.driftPx}px isolation=${stats.borderTransparencyPct}% coverage=${stats.alphaCoveragePct}%`);
      } catch (err) {
        console.error(`  ✗ ${tag}: ${String(err).slice(0, 160)}`);
        results.push({ slot: slotId, rep: rep + 1, error: String(err).slice(0, 200) });
      }
    }
  }

  const report = { generatedAt: new Date().toISOString(), model: models[0], size: args.size, aspect: args.aspect, calls, results };
  await writeFile(path.join(outDir, "report.json"), JSON.stringify(report, null, 2));
  console.log(`\n  ${calls} image calls. Report + PNGs in ${outDir}`);
}

function extractImage(response: any, tag: string, pass: string): GeminiImageResult {
  const parts = response?.candidates?.[0]?.content?.parts ?? [];
  for (const p of parts) {
    if (p?.inlineData?.data) {
      return { imageBase64: p.inlineData.data, mimeType: normalizeGeminiImageMimeType(p.inlineData.mimeType) };
    }
  }
  throw new Error(`${tag} ${pass}: no image in response`);
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
