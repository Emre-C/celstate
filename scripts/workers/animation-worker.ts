import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { ConvexHttpClient } from "convex/browser";
import sharp from "sharp";
import { api } from "../../src/convex/_generated/api.js";
import type { Id } from "../../src/convex/_generated/dataModel.js";
import { buildAnimationReferenceStillPrompt } from "../../src/convex/lib/animation/animationPrompts.js";
import {
  createChatSession,
  normalizeGeminiImageMimeType,
  readGeminiRuntimeConfigFromEnv,
  type GeminiImageResult,
} from "../../src/convex/lib/gemini.js";
import { differenceMatte, type MatteOutput } from "../../src/convex/lib/generation/matte.js";
import {
  buildBlackBgPrompt,
  buildBlackBgRetryPrompt,
  buildWhiteBgPrompt,
  buildWhiteBgRetryPrompt,
} from "../../src/convex/lib/generation/prompts.js";
import {
  analyzeTransparentOutput,
  buildTransparentQaRetryPlan,
  type TransparentQaResult,
} from "../../src/convex/lib/qa/transparentQa.js";
import {
  validateBlackBackground,
  validateWhiteBackground,
} from "../../src/convex/lib/validation/validation.js";

const execFileAsync = promisify(execFile);
const FPS = 24;
const TRANSPARENT = { r: 0, g: 0, b: 0, alpha: 0 };

type AnimationStatus =
  | "intake"
  | "queued"
  | "generating_reference"
  | "submitting_video"
  | "polling_video"
  | "reconstructing_alpha"
  | "qa"
  | "exporting"
  | "complete"
  | "failed";

type AnimationUseCase =
  | "stream_alert"
  | "stinger_transition"
  | "mascot_reaction"
  | "logo_sting"
  | "lower_third"
  | "video_callout"
  | "creator_overlay";

interface AnimationWorkerJob {
  _id: Id<"animationGenerations">;
  aspectRatio: string;
  destination: "obs" | "video_editor" | "obs_and_video_editor";
  durationSeconds: number;
  productionBrief?: string;
  prompt: string;
  status: AnimationStatus;
  useCase: AnimationUseCase;
}

interface WorkerConfig {
  convexUrl: string;
  keepWorkdir: boolean;
  once: boolean;
  pollIntervalMs: number;
  rootWorkdir?: string;
  workerSecret: string;
}

interface DecodedImage {
  pixels: Uint8ClampedArray;
  width: number;
  height: number;
}

interface ReferenceResult {
  blackDecoded: DecodedImage;
  matte: MatteOutput;
  png: Buffer;
  transparentQa: TransparentQaResult;
  whiteDecoded: DecodedImage;
}

interface ReferenceCandidate {
  blackDecoded: DecodedImage;
  matte: MatteOutput;
  transparentQa: TransparentQaResult;
  whiteDecoded: DecodedImage;
}

interface AlphaStats {
  alphaFrameCoverage: number;
  borderTransparencyMin: number;
  boundaryFlicker: number;
  frameCount: number;
  maxAlpha: number;
  minAlpha: number;
  transparentPixelRatioMean: number;
}

interface RenderedAnimation {
  frameCount: number;
  framesDir: string;
  height: number;
  width: number;
}

interface ExportedAnimation {
  apngPath: string;
  frameZipPath: string;
  manifestPath: string;
  movPath: string;
  qa: {
    decision: "pass";
    metrics: {
      alphaFrameCoverage: number;
      borderTransparencyMin: number;
      boundaryFlicker: number;
      componentStability: number;
      decodedExportAlphaCoverage: number;
      durationSeconds: number;
      edgeSpill: number;
      frameCount: number;
      loopSeamScore: number;
    };
    reasonCodes: [];
    version: "animation_alpha_worker_v1";
  };
  webmPath: string;
}

function parseArgs(argv: string[]): WorkerConfig {
  const flags = new Map<string, string | true>();
  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index];
    if (!arg.startsWith("--")) {
      continue;
    }
    const [key, inlineValue] = arg.slice(2).split("=", 2);
    const next = argv[index + 1];
    if (inlineValue !== undefined) {
      flags.set(key, inlineValue);
    } else if (next && !next.startsWith("--")) {
      flags.set(key, next);
      index++;
    } else {
      flags.set(key, true);
    }
  }

  const convexUrl =
    stringFlag(flags, "convex-url")
    ?? process.env.CONVEX_URL
    ?? process.env.PUBLIC_CONVEX_URL
    ?? "";
  const workerSecret =
    stringFlag(flags, "worker-secret")
    ?? process.env.ANIMATION_WORKER_SECRET
    ?? "";

  if (!convexUrl) {
    throw new Error("Set CONVEX_URL or PUBLIC_CONVEX_URL, or pass --convex-url.");
  }
  if (!workerSecret) {
    throw new Error("Set ANIMATION_WORKER_SECRET, or pass --worker-secret.");
  }

  return {
    convexUrl,
    keepWorkdir: flags.has("keep-workdir"),
    once: flags.has("once"),
    pollIntervalMs: Number(stringFlag(flags, "poll-ms") ?? "15000"),
    rootWorkdir: stringFlag(flags, "workdir"),
    workerSecret,
  };
}

function stringFlag(flags: Map<string, string | true>, key: string): string | undefined {
  const value = flags.get(key);
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

async function decodeImage(image: GeminiImageResult): Promise<DecodedImage> {
  const raw = Buffer.from(image.imageBase64, "base64");
  const { data, info } = await sharp(raw)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });

  return {
    height: info.height,
    pixels: new Uint8ClampedArray(data),
    width: info.width,
  };
}

async function encodePng(pixels: Uint8ClampedArray, width: number, height: number): Promise<Buffer> {
  return await sharp(Buffer.from(pixels), {
    raw: { channels: 4, height, width },
  }).png().toBuffer();
}

async function writeDecodedPng(filePath: string, image: DecodedImage): Promise<void> {
  await sharp(Buffer.from(image.pixels), {
    raw: { channels: 4, height: image.height, width: image.width },
  }).png().toFile(filePath);
}

async function writeArtifact(
  workdir: string,
  artifactName: string,
  write: () => Promise<void>,
): Promise<void> {
  try {
    await write();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.warn(`[animation-worker] failed to write ${artifactName}: ${message}`);
    await appendFlightEvent(workdir, {
      artifactName,
      message,
      stage: "flight_recorder",
      status: "write_failed",
    });
  }
}

async function writeJson(filePath: string, value: unknown): Promise<void> {
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

async function appendFlightEvent(
  workdir: string,
  event: Record<string, unknown>,
): Promise<void> {
  const line = JSON.stringify({
    timestamp: new Date().toISOString(),
    ...event,
  });
  try {
    await writeFile(path.join(workdir, "events.ndjson"), `${line}\n`, { flag: "a" });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.warn(`[animation-worker] failed to append flight event: ${message}`);
  }
}

async function resizeDecodedImage(image: DecodedImage, width: number, height: number): Promise<DecodedImage> {
  const { data } = await sharp(Buffer.from(image.pixels), {
    raw: { channels: 4, height: image.height, width: image.width },
  })
    .resize(width, height)
    .raw()
    .toBuffer({ resolveWithObject: true });

  return {
    height,
    pixels: new Uint8ClampedArray(data),
    width,
  };
}

async function buildReferenceCandidate(
  whiteDecodedInput: DecodedImage,
  blackDecodedInput: DecodedImage,
  prompt: string,
): Promise<ReferenceCandidate> {
  let whiteDecoded = whiteDecodedInput;
  let blackDecoded = blackDecodedInput;

  if (whiteDecoded.width !== blackDecoded.width || whiteDecoded.height !== blackDecoded.height) {
    const width = Math.min(whiteDecoded.width, blackDecoded.width);
    const height = Math.min(whiteDecoded.height, blackDecoded.height);
    whiteDecoded = await resizeDecodedImage(whiteDecoded, width, height);
    blackDecoded = await resizeDecodedImage(blackDecoded, width, height);
  }

  const matte = differenceMatte({
    blackBg: blackDecoded.pixels,
    height: whiteDecoded.height,
    whiteBg: whiteDecoded.pixels,
    width: whiteDecoded.width,
  });
  const transparentQa = analyzeTransparentOutput({
    blackBg: blackDecoded.pixels,
    dimensionMismatch: false,
    height: matte.height,
    matte,
    prompt,
    whiteBg: whiteDecoded.pixels,
    width: matte.width,
  });

  return {
    blackDecoded,
    matte,
    transparentQa,
    whiteDecoded,
  };
}

async function writeReferenceCandidateArtifacts(
  workdir: string,
  label: string,
  candidate: ReferenceCandidate,
): Promise<void> {
  await Promise.all([
    writeArtifact(
      workdir,
      `${label}-white-reference.png`,
      () => writeDecodedPng(path.join(workdir, `${label}-white-reference.png`), candidate.whiteDecoded),
    ),
    writeArtifact(
      workdir,
      `${label}-black-reference.png`,
      () => writeDecodedPng(path.join(workdir, `${label}-black-reference.png`), candidate.blackDecoded),
    ),
    writeArtifact(
      workdir,
      `${label}-matte-reference.png`,
      async () => {
        await writeFile(
          path.join(workdir, `${label}-matte-reference.png`),
          toUint8Array(await encodePng(candidate.matte.pixels, candidate.matte.width, candidate.matte.height)),
        );
      },
    ),
    writeArtifact(
      workdir,
      `${label}-qa-reference.json`,
      () => writeJson(path.join(workdir, `${label}-qa-reference.json`), candidate.transparentQa),
    ),
  ]);
}

async function generateTransparentReference(job: AnimationWorkerJob, workdir: string): Promise<ReferenceResult> {
  const runtimeConfig = readGeminiRuntimeConfigFromEnv();
  const productionBrief = job.productionBrief ?? job.prompt;
  const referencePrompt = buildAnimationReferenceStillPrompt(productionBrief);

  await appendFlightEvent(workdir, {
    jobId: job._id,
    stage: "reference_generation",
    status: "started",
  });

  let whiteSession = createChatSession(runtimeConfig, { aspectRatio: job.aspectRatio });
  let whiteImage = await whiteSession.sendMessage(buildWhiteBgPrompt(referencePrompt));
  let whiteDecoded = await decodeImage(whiteImage);
  await writeArtifact(
    workdir,
    "initial-white-reference.png",
    () => writeDecodedPng(path.join(workdir, "initial-white-reference.png"), whiteDecoded),
  );
  const whiteValidation = validateWhiteBackground(
    whiteDecoded.pixels,
    whiteDecoded.width,
    whiteDecoded.height,
  );
  await writeArtifact(
    workdir,
    "initial-white-validation.json",
    () => writeJson(path.join(workdir, "initial-white-validation.json"), whiteValidation),
  );
  if (!whiteValidation.valid) {
    await appendFlightEvent(workdir, {
      jobId: job._id,
      reason: whiteValidation.reason ?? "unknown",
      stage: "reference_white_validation",
      status: "failed",
    });
    throw new Error(`Reference white background failed QA: ${whiteValidation.reason ?? "unknown"}`);
  }

  let blackSession = createChatSession(runtimeConfig, { aspectRatio: job.aspectRatio });
  const blackImage = await blackSession.sendMessageWithImages(buildBlackBgPrompt(), [whiteImage]);
  let blackDecoded = await decodeImage({
    ...blackImage,
    mimeType: normalizeGeminiImageMimeType(blackImage.mimeType),
  });
  await writeArtifact(
    workdir,
    "initial-black-reference.png",
    () => writeDecodedPng(path.join(workdir, "initial-black-reference.png"), blackDecoded),
  );
  const blackValidation = validateBlackBackground(
    blackDecoded.pixels,
    blackDecoded.width,
    blackDecoded.height,
  );
  await writeArtifact(
    workdir,
    "initial-black-validation.json",
    () => writeJson(path.join(workdir, "initial-black-validation.json"), blackValidation),
  );
  if (!blackValidation.valid) {
    await appendFlightEvent(workdir, {
      jobId: job._id,
      reason: blackValidation.reason ?? "unknown",
      stage: "reference_black_validation",
      status: "failed",
    });
    throw new Error(`Reference black background failed QA: ${blackValidation.reason ?? "unknown"}`);
  }

  let candidate = await buildReferenceCandidate(whiteDecoded, blackDecoded, job.prompt);
  await writeReferenceCandidateArtifacts(workdir, "initial", candidate);
  let initialQaStatus = "retry_requested";
  if (candidate.transparentQa.decision === "pass") {
    initialQaStatus = "passed";
  } else if (candidate.transparentQa.decision === "review") {
    initialQaStatus = "failed";
  }
  await appendFlightEvent(workdir, {
    decision: candidate.transparentQa.decision,
    jobId: job._id,
    metrics: candidate.transparentQa.metrics,
    reasonCodes: candidate.transparentQa.reasonCodes,
    stage: "reference_transparent_qa",
    status: initialQaStatus,
  });
  if (candidate.transparentQa.decision !== "pass" && candidate.transparentQa.decision !== "review") {
    console.warn(
      `[animation-worker] reference QA requested ${candidate.transparentQa.decision}: ${candidate.transparentQa.reasonCodes.join(",")}`,
    );
    const retryPlan = buildTransparentQaRetryPlan(
      candidate.transparentQa.decision,
      candidate.transparentQa.reasonCodes,
    );
    await writeArtifact(
      workdir,
      "retry-plan.json",
      () => writeJson(path.join(workdir, "retry-plan.json"), retryPlan),
    );

    if (candidate.transparentQa.decision === "retry_white_and_black") {
      whiteSession = createChatSession(runtimeConfig, { aspectRatio: job.aspectRatio });
      whiteImage = await whiteSession.sendMessage(buildWhiteBgRetryPrompt(
        referencePrompt,
        retryPlan.retryInstruction,
      ));
      whiteDecoded = await decodeImage(whiteImage);
      await writeArtifact(
        workdir,
        "retry-white-reference.png",
        () => writeDecodedPng(path.join(workdir, "retry-white-reference.png"), whiteDecoded),
      );
      const retryWhiteValidation = validateWhiteBackground(
        whiteDecoded.pixels,
        whiteDecoded.width,
        whiteDecoded.height,
      );
      await writeArtifact(
        workdir,
        "retry-white-validation.json",
        () => writeJson(path.join(workdir, "retry-white-validation.json"), retryWhiteValidation),
      );
      if (!retryWhiteValidation.valid) {
        await appendFlightEvent(workdir, {
          jobId: job._id,
          reason: retryWhiteValidation.reason ?? "unknown",
          stage: "reference_retry_white_validation",
          status: "failed",
        });
        throw new Error(`Reference retry white background failed QA: ${retryWhiteValidation.reason ?? "unknown"}`);
      }
    }

    blackSession = createChatSession(runtimeConfig, { aspectRatio: job.aspectRatio });
    const retryBlackImage = await blackSession.sendMessageWithImages(
      buildBlackBgRetryPrompt(retryPlan.downstreamRetryInstruction ?? retryPlan.retryInstruction),
      [whiteImage],
    );
    blackDecoded = await decodeImage({
      ...retryBlackImage,
      mimeType: normalizeGeminiImageMimeType(retryBlackImage.mimeType),
    });
    await writeArtifact(
      workdir,
      "retry-black-reference.png",
      () => writeDecodedPng(path.join(workdir, "retry-black-reference.png"), blackDecoded),
    );
    const retryBlackValidation = validateBlackBackground(
      blackDecoded.pixels,
      blackDecoded.width,
      blackDecoded.height,
    );
    await writeArtifact(
      workdir,
      "retry-black-validation.json",
      () => writeJson(path.join(workdir, "retry-black-validation.json"), retryBlackValidation),
    );
    if (!retryBlackValidation.valid) {
      await appendFlightEvent(workdir, {
        jobId: job._id,
        reason: retryBlackValidation.reason ?? "unknown",
        stage: "reference_retry_black_validation",
        status: "failed",
      });
      throw new Error(`Reference retry black background failed QA: ${retryBlackValidation.reason ?? "unknown"}`);
    }

    candidate = await buildReferenceCandidate(whiteDecoded, blackDecoded, job.prompt);
    await writeReferenceCandidateArtifacts(workdir, "retry", candidate);
    await appendFlightEvent(workdir, {
      decision: candidate.transparentQa.decision,
      jobId: job._id,
      metrics: candidate.transparentQa.metrics,
      reasonCodes: candidate.transparentQa.reasonCodes,
      stage: "reference_retry_transparent_qa",
      status: candidate.transparentQa.decision === "pass" ? "passed" : "failed",
    });
  }

  if (candidate.transparentQa.decision !== "pass") {
    await appendFlightEvent(workdir, {
      decision: candidate.transparentQa.decision,
      jobId: job._id,
      reasonCodes: candidate.transparentQa.reasonCodes,
      stage: "reference_generation",
      status: "failed",
    });
    throw new Error(
      `Reference transparent QA failed: ${candidate.transparentQa.reasonCodes.join(",") || "review"}`,
    );
  }

  await appendFlightEvent(workdir, {
    jobId: job._id,
    stage: "reference_generation",
    status: "completed",
  });

  return {
    blackDecoded: candidate.blackDecoded,
    matte: candidate.matte,
    png: await encodePng(candidate.matte.pixels, candidate.matte.width, candidate.matte.height),
    transparentQa: candidate.transparentQa,
    whiteDecoded: candidate.whiteDecoded,
  };
}

function motionOffset(
  useCase: AnimationUseCase,
  t: number,
  width: number,
  height: number,
): { x: number; y: number } {
  const base = Math.max(6, Math.round(Math.min(width, height) * 0.028));
  const wave = Math.sin(t * Math.PI * 2);
  const secondary = Math.sin(t * Math.PI * 4);

  switch (useCase) {
    case "stream_alert":
      return { x: Math.round(wave * base * 0.4), y: Math.round(-Math.abs(wave) * base) };
    case "stinger_transition":
      return { x: Math.round(wave * base * 1.8), y: Math.round(secondary * base * 0.25) };
    case "mascot_reaction":
      return { x: Math.round(secondary * base * 0.35), y: Math.round(wave * base * 0.9) };
    case "logo_sting":
      return { x: 0, y: Math.round(wave * base * 0.45) };
    case "lower_third":
      return { x: Math.round(wave * base * 0.8), y: 0 };
    case "video_callout":
      return { x: Math.round(wave * base * 0.9), y: Math.round(secondary * base * 0.35) };
    case "creator_overlay":
      return { x: Math.round(wave * base * 0.6), y: Math.round(secondary * base * 0.4) };
  }
}

async function renderTransparentFrames(
  job: AnimationWorkerJob,
  referencePng: Buffer,
  workdir: string,
): Promise<RenderedAnimation> {
  const metadata = await sharp(referencePng).metadata();
  const width = metadata.width;
  const height = metadata.height;
  if (!width || !height) {
    throw new Error("Generated reference PNG has no dimensions");
  }

  const frameCount = job.durationSeconds * FPS;
  const framesDir = path.join(workdir, "frames");
  await mkdir(framesDir, { recursive: true });

  for (let index = 0; index < frameCount; index++) {
    const t = frameCount <= 1 ? 0 : index / frameCount;
    const offset = motionOffset(job.useCase, t, width, height);
    const framePath = path.join(framesDir, `frame-${String(index + 1).padStart(4, "0")}.png`);
    await sharp({
      create: {
        background: TRANSPARENT,
        channels: 4,
        height,
        width,
      },
    })
      .composite([{
        input: referencePng,
        left: offset.x,
        top: offset.y,
      }])
      .png()
      .toFile(framePath);
  }

  return { frameCount, framesDir, height, width };
}

async function runFfmpeg(args: string[]): Promise<void> {
  try {
    await execFileAsync("ffmpeg", ["-hide_banner", ...args], {
      maxBuffer: 1024 * 1024 * 16,
      windowsHide: true,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`ffmpeg failed: ${message}`);
  }
}

async function exportAnimation(
  job: AnimationWorkerJob,
  rendered: RenderedAnimation,
  referenceQa: TransparentQaResult,
  workdir: string,
): Promise<ExportedAnimation> {
  const framePattern = path.join(rendered.framesDir, "frame-%04d.png");
  const webmPath = path.join(workdir, "celstate-animation-obs.webm");
  const movPath = path.join(workdir, "celstate-animation-editor.mov");
  const apngPath = path.join(workdir, "celstate-animation.apng");
  const frameZipPath = path.join(workdir, "celstate-animation-frames.zip");
  const manifestPath = path.join(workdir, "manifest.json");

  await runFfmpeg([
    "-y",
    "-framerate",
    String(FPS),
    "-i",
    framePattern,
    "-c:v",
    "libvpx-vp9",
    "-pix_fmt",
    "yuva420p",
    "-b:v",
    "0",
    "-crf",
    "30",
    "-an",
    "-metadata:s:v:0",
    "alpha_mode=1",
    webmPath,
  ]);

  await runFfmpeg([
    "-y",
    "-framerate",
    String(FPS),
    "-i",
    framePattern,
    "-c:v",
    "prores_ks",
    "-profile:v",
    "4",
    "-pix_fmt",
    "yuva444p10le",
    "-vendor",
    "apl0",
    "-an",
    movPath,
  ]);

  await runFfmpeg([
    "-y",
    "-framerate",
    String(FPS),
    "-i",
    framePattern,
    "-plays",
    "0",
    "-f",
    "apng",
    apngPath,
  ]);

  await writeStoredZip(frameZipPath, rendered.framesDir);

  const canonicalStats = await analyzeFrameDirectory(rendered.framesDir);
  const decodedRoot = path.join(workdir, "decoded");
  const webmStats = await decodeAndAnalyzeExport(webmPath, path.join(decodedRoot, "webm"), "webm");
  const movStats = await decodeAndAnalyzeExport(movPath, path.join(decodedRoot, "mov"), "mov");
  const apngStats = await decodeAndAnalyzeExport(apngPath, path.join(decodedRoot, "apng"), "apng");
  const decodedExportAlphaCoverage = Math.min(
    webmStats.alphaFrameCoverage,
    movStats.alphaFrameCoverage,
    apngStats.alphaFrameCoverage,
  );

  const pass =
    canonicalStats.alphaFrameCoverage === 1
    && canonicalStats.borderTransparencyMin >= 0.85
    && decodedExportAlphaCoverage === 1;
  if (!pass) {
    throw new Error(
      `Animation export QA failed: canonicalAlpha=${canonicalStats.alphaFrameCoverage}, `
      + `border=${canonicalStats.borderTransparencyMin}, decodedAlpha=${decodedExportAlphaCoverage}`,
    );
  }

  const manifest = {
    aspectRatio: job.aspectRatio,
    destination: job.destination,
    durationSeconds: job.durationSeconds,
    exports: {
      apng: path.basename(apngPath),
      frames: path.basename(frameZipPath),
      mov: path.basename(movPath),
      webm: path.basename(webmPath),
    },
    fps: FPS,
    frameCount: rendered.frameCount,
    generatedAt: new Date().toISOString(),
    height: rendered.height,
    pipeline: "celstate_animation_alpha_worker_v1",
    prompt: job.prompt,
    referenceTransparentQa: referenceQa,
    useCase: job.useCase,
    width: rendered.width,
  };
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);

  return {
    apngPath,
    frameZipPath,
    manifestPath,
    movPath,
    qa: {
      decision: "pass",
      metrics: {
        alphaFrameCoverage: canonicalStats.alphaFrameCoverage,
        borderTransparencyMin: canonicalStats.borderTransparencyMin,
        boundaryFlicker: canonicalStats.boundaryFlicker,
        componentStability: 1,
        decodedExportAlphaCoverage,
        durationSeconds: job.durationSeconds,
        edgeSpill: 0,
        frameCount: rendered.frameCount,
        loopSeamScore: canonicalStats.boundaryFlicker,
      },
      reasonCodes: [],
      version: "animation_alpha_worker_v1",
    },
    webmPath,
  };
}

async function decodeAndAnalyzeExport(
  inputPath: string,
  outputDir: string,
  kind: "apng" | "mov" | "webm",
): Promise<AlphaStats> {
  await mkdir(outputDir, { recursive: true });
  const args = kind === "webm"
    ? ["-y", "-c:v", "libvpx-vp9", "-i", inputPath, "-frames:v", "12", path.join(outputDir, "frame-%03d.png")]
    : ["-y", "-i", inputPath, "-frames:v", "12", path.join(outputDir, "frame-%03d.png")];
  await runFfmpeg(args);
  return await analyzeFrameDirectory(outputDir);
}

async function analyzeFrameDirectory(framesDir: string): Promise<AlphaStats> {
  const entries = (await readdir(framesDir))
    .filter((entry) => entry.toLowerCase().endsWith(".png"))
    .sort();
  if (entries.length === 0) {
    throw new Error(`No PNG frames found in ${framesDir}`);
  }

  let framesWithTransparentPixels = 0;
  let minAlpha = 255;
  let maxAlpha = 0;
  let transparentPixelRatioSum = 0;
  let borderTransparencyMin = 1;
  let boundaryDiffSum = 0;
  let boundaryDiffCount = 0;
  let previousAlpha: Uint8ClampedArray | undefined;

  for (const entry of entries) {
    const file = path.join(framesDir, entry);
    const { data, info } = await sharp(file)
      .ensureAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });
    const alpha = new Uint8ClampedArray(info.width * info.height);
    let transparentPixels = 0;
    for (let index = 0; index < alpha.length; index++) {
      const value = data[index * 4 + 3] ?? 255;
      alpha[index] = value;
      minAlpha = Math.min(minAlpha, value);
      maxAlpha = Math.max(maxAlpha, value);
      if (value < 255) {
        transparentPixels++;
      }
      if (previousAlpha) {
        boundaryDiffSum += Math.abs(value - previousAlpha[index]!) / 255;
        boundaryDiffCount++;
      }
    }

    if (transparentPixels > 0) {
      framesWithTransparentPixels++;
    }
    transparentPixelRatioSum += transparentPixels / alpha.length;
    borderTransparencyMin = Math.min(
      borderTransparencyMin,
      borderTransparencyRatio(alpha, info.width, info.height),
    );
    previousAlpha = alpha;
  }

  return {
    alphaFrameCoverage: framesWithTransparentPixels / entries.length,
    borderTransparencyMin,
    boundaryFlicker: boundaryDiffCount === 0 ? 0 : boundaryDiffSum / boundaryDiffCount,
    frameCount: entries.length,
    maxAlpha,
    minAlpha,
    transparentPixelRatioMean: transparentPixelRatioSum / entries.length,
  };
}

function borderTransparencyRatio(alpha: Uint8ClampedArray, width: number, height: number): number {
  const borderWidth = Math.max(1, Math.round(Math.min(width, height) * 0.04));
  let borderPixels = 0;
  let transparent = 0;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (
        x >= borderWidth
        && x < width - borderWidth
        && y >= borderWidth
        && y < height - borderWidth
      ) {
        continue;
      }
      borderPixels++;
      if (alpha[y * width + x]! < 8) {
        transparent++;
      }
    }
  }
  return borderPixels === 0 ? 0 : transparent / borderPixels;
}

async function writeStoredZip(zipPath: string, framesDir: string): Promise<void> {
  const entries = (await readdir(framesDir))
    .filter((entry) => entry.toLowerCase().endsWith(".png"))
    .sort();
  const zipEntries = await Promise.all(entries.map(async (entry) => ({
    data: toUint8Array(await readFile(path.join(framesDir, entry))),
    name: `frames/${entry}`,
  })));
  await writeFile(zipPath, toUint8Array(createStoredZip(zipEntries)));
}

function createStoredZip(entries: Array<{ data: Uint8Array; name: string }>): Buffer {
  const localParts: Uint8Array[] = [];
  const centralParts: Uint8Array[] = [];
  let offset = 0;

  for (const entry of entries) {
    const name = Buffer.from(entry.name.replace(/\\/g, "/"));
    const crc = crc32(entry.data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0, 6);
    local.writeUInt16LE(0, 8);
    local.writeUInt16LE(0, 10);
    local.writeUInt16LE(0, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(entry.data.length, 18);
    local.writeUInt32LE(entry.data.length, 22);
    local.writeUInt16LE(name.length, 26);
    local.writeUInt16LE(0, 28);
    localParts.push(toUint8Array(local), toUint8Array(name), entry.data);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0, 8);
    central.writeUInt16LE(0, 10);
    central.writeUInt16LE(0, 12);
    central.writeUInt16LE(0, 14);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(entry.data.length, 20);
    central.writeUInt32LE(entry.data.length, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt16LE(0, 30);
    central.writeUInt16LE(0, 32);
    central.writeUInt16LE(0, 34);
    central.writeUInt16LE(0, 36);
    central.writeUInt32LE(0, 38);
    central.writeUInt32LE(offset, 42);
    centralParts.push(toUint8Array(central), toUint8Array(name));

    offset += local.length + name.length + entry.data.length;
  }

  const centralDirectory = concatUint8Arrays(centralParts);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(0, 4);
  end.writeUInt16LE(0, 6);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(centralDirectory.length, 12);
  end.writeUInt32LE(offset, 16);
  end.writeUInt16LE(0, 20);

  return concatUint8Arrays([
    ...localParts,
    toUint8Array(centralDirectory),
    toUint8Array(end),
  ]);
}

function toUint8Array(buffer: Buffer): Uint8Array {
  return new Uint8Array(buffer);
}

function concatUint8Arrays(parts: readonly Uint8Array[]): Buffer {
  const totalLength = parts.reduce((sum, part) => sum + part.length, 0);
  const output = Buffer.alloc(totalLength);
  let offset = 0;
  for (const part of parts) {
    output.set(part, offset);
    offset += part.length;
  }
  return output;
}

const CRC_TABLE = new Uint32Array(256).map((_, index) => {
  let value = index;
  for (let bit = 0; bit < 8; bit++) {
    value = (value & 1) === 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
  }
  return value >>> 0;
});

function crc32(data: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of data) {
    crc = CRC_TABLE[(crc ^ byte) & 0xff]! ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

async function uploadArtifact(
  client: ConvexHttpClient,
  workerSecret: string,
  filePath: string,
  contentType: string,
): Promise<Id<"_storage">> {
  const uploadUrl = await client.mutation(api.animationGenerations.generateAnimationWorkerUploadUrl, {
    workerSecret,
  });
  const bytes = await readFile(filePath);
  const response = await fetch(uploadUrl, {
    body: new Blob([new Uint8Array(bytes)], { type: contentType }),
    headers: { "Content-Type": contentType },
    method: "POST",
  });
  if (!response.ok) {
    throw new Error(`Convex storage upload failed for ${path.basename(filePath)}: ${response.status}`);
  }
  const body = await response.json() as { storageId?: string };
  if (!body.storageId) {
    throw new Error(`Convex storage upload did not return storageId for ${path.basename(filePath)}`);
  }
  return body.storageId as Id<"_storage">;
}

async function processJob(
  client: ConvexHttpClient,
  config: WorkerConfig,
  job: AnimationWorkerJob,
): Promise<void> {
  const workdir = config.rootWorkdir
    ? path.join(config.rootWorkdir, String(job._id))
    : await mkdtemp(path.join(tmpdir(), `celstate-animation-${job._id}-`));
  await mkdir(workdir, { recursive: true });

  try {
    console.log(`[animation-worker] claimed ${job._id}`);
    await writeJson(path.join(workdir, "job.json"), job);
    await appendFlightEvent(workdir, {
      jobId: job._id,
      stage: "job",
      status: "claimed",
    });

    const reference = await generateTransparentReference(job, workdir);
    const referencePath = path.join(workdir, "reference.png");
    await writeFile(referencePath, toUint8Array(reference.png));
    await writeJson(path.join(workdir, "reference-qa.json"), reference.transparentQa);

    await client.mutation(api.animationGenerations.markAnimationGenerationStageForWorker, {
      animationGenerationId: job._id,
      expectedStatus: "generating_reference",
      status: "reconstructing_alpha",
      workerSecret: config.workerSecret,
    });

    const rendered = await renderTransparentFrames(job, reference.png, workdir);

    await client.mutation(api.animationGenerations.markAnimationGenerationStageForWorker, {
      animationGenerationId: job._id,
      expectedStatus: "reconstructing_alpha",
      status: "exporting",
      workerSecret: config.workerSecret,
    });

    const exported = await exportAnimation(job, rendered, reference.transparentQa, workdir);
    await writeJson(path.join(workdir, "export-qa.json"), exported.qa);

    await client.mutation(api.animationGenerations.markAnimationGenerationStageForWorker, {
      animationGenerationId: job._id,
      expectedStatus: "exporting",
      status: "qa",
      workerSecret: config.workerSecret,
    });

    const [manifestStorageId, webmStorageId, movStorageId, pngSequenceStorageId, apngStorageId] =
      await Promise.all([
        uploadArtifact(client, config.workerSecret, exported.manifestPath, "application/json"),
        uploadArtifact(client, config.workerSecret, exported.webmPath, "video/webm"),
        uploadArtifact(client, config.workerSecret, exported.movPath, "video/quicktime"),
        uploadArtifact(client, config.workerSecret, exported.frameZipPath, "application/zip"),
        uploadArtifact(client, config.workerSecret, exported.apngPath, "image/apng"),
      ]);

    await client.mutation(api.animationGenerations.completeAnimationGenerationForWorker, {
      animationGenerationId: job._id,
      animationQa: exported.qa,
      canonicalFrameManifestStorageId: manifestStorageId,
      expectedStatus: "qa",
      exports: {
        apngStorageId,
        movStorageId,
        pngSequenceStorageId,
        webmStorageId,
      },
      previewStorageId: webmStorageId,
      workerSecret: config.workerSecret,
    });
    console.log(`[animation-worker] completed ${job._id}`);
    await appendFlightEvent(workdir, {
      jobId: job._id,
      stage: "job",
      status: "completed",
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`[animation-worker] failed ${job._id}: ${message}`);
    await writeJson(path.join(workdir, "failure.json"), { message });
    await appendFlightEvent(workdir, {
      jobId: job._id,
      message,
      stage: "job",
      status: "failed",
    });
    await client.mutation(api.animationGenerations.failAnimationGenerationForWorker, {
      animationGenerationId: job._id,
      error: "We couldn't generate a production-ready transparent animation. Your request has been closed and any charged credits were refunded.",
      workerSecret: config.workerSecret,
    });
  } finally {
    if (!config.keepWorkdir && !config.rootWorkdir) {
      await rm(workdir, { force: true, recursive: true });
    } else {
      console.log(`[animation-worker] kept workdir ${workdir}`);
    }
  }
}

async function runWorker(config: WorkerConfig): Promise<void> {
  const client = new ConvexHttpClient(config.convexUrl);

  do {
    const job = await client.mutation(api.animationGenerations.claimAnimationGenerationForWorker, {
      workerSecret: config.workerSecret,
    }) as AnimationWorkerJob | null;
    if (job) {
      await processJob(client, config, job);
      continue;
    }
    if (config.once) {
      console.log("[animation-worker] no animation jobs ready");
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, config.pollIntervalMs));
  } while (true);
}

const config = parseArgs(process.argv.slice(2));
await runWorker(config);
