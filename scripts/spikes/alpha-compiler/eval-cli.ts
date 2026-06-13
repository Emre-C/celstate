/**
 * Synthetic ground-truth evaluation loop for the Alpha Compiler.
 *
 * Pipeline per scenario:
 *   1. generate deterministic RGBA truth frames (known alpha + foreground RGB);
 *   2. composite them over a noisy chroma plate;
 *   3. push the composites through a realistic lossy video path (H.264 yuv420p);
 *   4. extract decoded frames + sharp chroma alpha exactly like the spike harness;
 *   5. prepare the matting prior (--prior):
 *        simulated  truth alpha with detached elements removed, gaussian-blurred
 *                   (deterministic, model-free — the canonical CI leg);
 *        bria       real BRIA RMBG prior via `uvx rembg` over the decoded lossy
 *                   frames (real-prior evidence leg, machine/toolchain dependent);
 *        dir        externally produced gray alpha frames, e.g. a MatAnyone2 `pha/`
 *                   tree generated on a CUDA box (--prior-alpha-dir);
 *   6. run the real v6/v7 compiler core on the lossy inputs;
 *   7. compare the output against the stored truth, frame by frame.
 *
 * The `priorAlphaMae` metric records the prior-quality floor in every mode so
 * compiler scores can be read against it. Real-prior runs write to their own
 * roots and baseline files (suffixed with the prior mode) so they never clobber
 * the canonical simulated report or gate against the wrong baseline.
 *
 * Commands:
 *   pnpm alpha-eval run              [--root tmp/alpha-compiler-eval] [--scenario <id>] [--frames 48] [--width 640] [--height 360] [--crf 23] [--compiler v6|v7] [--prior simulated|bria|dir] [--prior-alpha-dir <dir>]
 *   pnpm alpha-eval compare          [--root ...] [--scenario <id>] [--allow-unbaselined] [--baseline ...] [--prior ...]
 *   pnpm alpha-eval update-baseline  [--root ...] [--baseline ...] [--prior ...]
 *
 * The workflow is idempotent: scenario directories are wiped and rebuilt on every run.
 */

import { execFile } from "node:child_process";
import { mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import sharp from "sharp";
import {
	createV6RgbaFrame,
	createV7RgbaFrame,
	normalizeHexColor,
	parseRgbColor,
	summarizeMetric,
	type RawGrayImage,
	type RawRgbImage,
	type V6FrameResult,
	type V6ProjectionSettings,
} from "./core.js";
import {
	aggregateFrameMetrics,
	computeFrameMetrics,
	extractAlphaChannel,
	METRIC_NAMES,
	type FrameMetrics,
	type MetricAggregate,
	type MetricName,
} from "./metrics.js";
import {
	assertBaselinePriorMatchesReport,
	assertComparableEvalReport,
	buildBaseline,
	compareReportToBaseline,
	defaultBaselinePathForPrior,
	defaultEvalRootForPrior,
	formatComparisonTable,
	parsePriorMode,
	selectScenariosForCompare,
	type BaselineFile,
	type EvalRunScope,
	type PriorMode,
	type ScenarioAggregates,
} from "./baseline.js";
import {
	CANONICAL_SCENARIO_IDS,
	compositeOverPlate,
	createScenarios,
	renderPlateRgb,
	type ScenarioSpec,
} from "./truth.js";

const execFileAsync = promisify(execFile);

const DEFAULT_EVAL_ROOT = "tmp/alpha-compiler-eval";
const DEFAULT_BASELINE_PATH = "scripts/spikes/alpha-compiler/baselines/synthetic-eval.json";
const CHROMA_SIMILARITY = 0.12;
const CHROMA_BLEND = 0.08;
const PRIOR_BLUR_SIGMA = 2;

type CompilerVersion = "v6" | "v7";
const DEFAULT_COMPILER: CompilerVersion = "v7";
const COMPILERS: Record<CompilerVersion, typeof createV6RgbaFrame> = {
	v6: createV6RgbaFrame,
	v7: createV7RgbaFrame,
};

function compilerOption(args: EvalArgs): CompilerVersion {
	const raw = args.options.get("compiler") ?? DEFAULT_COMPILER;
	if (raw !== "v6" && raw !== "v7") {
		throw new Error(`--compiler must be v6 or v7. Got: ${raw}`);
	}
	return raw;
}

interface EvalArgs {
	readonly command: string;
	readonly options: Map<string, string>;
}

function parseEvalArgs(argv: readonly string[]): EvalArgs {
	const [command = "help", ...rest] = argv;
	const options = new Map<string, string>();
	for (let index = 0; index < rest.length; index += 1) {
		const token = rest[index];
		if (!token.startsWith("--")) {
			throw new Error(`Unexpected positional argument: ${token}`);
		}
		const key = token.slice(2);
		const next = rest[index + 1];
		if (next !== undefined && !next.startsWith("--")) {
			options.set(key, next);
			index += 1;
		} else {
			options.set(key, "true");
		}
	}
	return { command, options };
}

function numberOption(args: EvalArgs, key: string, fallback: number): number {
	const raw = args.options.get(key);
	if (raw === undefined) {
		return fallback;
	}
	const parsed = Number(raw);
	if (!Number.isFinite(parsed)) {
		throw new Error(`--${key} must be a number. Got: ${raw}`);
	}
	return parsed;
}

async function runFfmpeg(ffmpegArgs: readonly string[]): Promise<void> {
	try {
		await execFileAsync("ffmpeg", [...ffmpegArgs], { maxBuffer: 64 * 1024 * 1024 });
	} catch (error) {
		const stderr = error && typeof error === "object" && "stderr" in error ? String((error as { stderr: unknown }).stderr) : "";
		throw new Error(`ffmpeg failed: ffmpeg ${ffmpegArgs.join(" ")}\n${stderr.slice(-2000)}`);
	}
}

async function ffmpegVersion(): Promise<string> {
	try {
		const { stdout } = await execFileAsync("ffmpeg", ["-version"]);
		return stdout.split(/\r?\n/, 1)[0] ?? "unknown";
	} catch {
		return "unavailable";
	}
}

function frameName(index: number): string {
	return `frame-${String(index + 1).padStart(5, "0")}.png`;
}

async function writeRgbaPng(data: Buffer, width: number, height: number, filePath: string): Promise<void> {
	await sharp(data, { raw: { channels: 4, height, width } }).png().toFile(filePath);
}

async function writeRgbPng(data: Buffer, width: number, height: number, filePath: string): Promise<void> {
	await sharp(data, { raw: { channels: 3, height, width } }).png().toFile(filePath);
}

async function writeGrayPng(data: Buffer | Uint8Array, width: number, height: number, filePath: string): Promise<void> {
	await sharp(Buffer.from(data), { raw: { channels: 1, height, width } }).png().toFile(filePath);
}

async function readRgbPng(filePath: string): Promise<RawRgbImage> {
	const { data, info } = await sharp(filePath).removeAlpha().raw().toBuffer({ resolveWithObject: true });
	return { data, height: info.height, width: info.width };
}

async function readGrayPng(filePath: string): Promise<RawGrayImage> {
	const { data, info } = await sharp(filePath).greyscale().raw().toBuffer({ resolveWithObject: true });
	if (info.channels !== 1) {
		throw new Error(`Expected single-channel gray image: ${filePath}`);
	}
	return { data, height: info.height, width: info.width };
}

async function blurGray(data: Uint8Array, width: number, height: number, sigma: number): Promise<Buffer> {
	// sharp's blur pipeline silently expands raw single-channel input to 3 channels;
	// force it back to one channel and verify, otherwise the caller would read garbage.
	const { data: blurred, info } = await sharp(Buffer.from(data), { raw: { channels: 1, height, width } })
		.blur(sigma)
		.toColourspace("b-w")
		.raw()
		.toBuffer({ resolveWithObject: true });
	if (info.channels !== 1 || blurred.length !== width * height) {
		throw new Error(`blurGray expected ${width * height} single-channel bytes, got ${blurred.length} (${info.channels} channels).`);
	}
	return blurred;
}

interface PriorPreparation {
	readonly briaModel: string;
	readonly briaPackage: string;
	readonly externalDir?: string;
	readonly mode: PriorMode;
}

const DEFAULT_BRIA_MODEL = "bria-rmbg";
const DEFAULT_BRIA_PACKAGE = "rembg[cpu,cli]";

function priorSettingLabels(prior: PriorPreparation): Pick<V6ProjectionSettings, "priorAlphaDir" | "priorModel" | "priorPackage"> {
	if (prior.mode === "bria") {
		return { priorAlphaDir: "prior-alpha", priorModel: prior.briaModel, priorPackage: prior.briaPackage };
	}
	if (prior.mode === "dir") {
		return { priorAlphaDir: prior.externalDir ?? "external", priorModel: "external-dir", priorPackage: "external" };
	}
	return { priorAlphaDir: "synthetic-truth-derived", priorModel: "synthetic-truth-prior", priorPackage: "none" };
}

function evalV6Settings(keyColor: string, prior: PriorPreparation): V6ProjectionSettings {
	return {
		bgPlateIterations: 24,
		chromaTransparentCutoff: 8,
		coreAlphaThreshold: 235,
		coreProjectionBand: 20,
		fringeRadius: 6,
		guardRadius: 8,
		keyColor: normalizeHexColor(keyColor),
		leafAlphaFloor: 24,
		leafEdgeBand: 4,
		leafGateRamp: 4,
		leafInteriorMinDistance: 3,
		...priorSettingLabels(prior),
		selectedFrame: 1,
		subjectAlphaThreshold: 32,
		transparentCutoff: 2,
	};
}

/** Simulated prior: truth alpha with detached elements zeroed, gaussian-blurred. */
async function prepareSimulatedPrior(
	truthFrames: readonly Buffer[],
	detachedMasks: readonly Uint8Array[],
	width: number,
	height: number,
	priorDir: string,
): Promise<void> {
	for (let index = 0; index < truthFrames.length; index += 1) {
		const truthAlpha = extractAlphaChannel(truthFrames[index], width * height);
		const priorSource = new Uint8Array(truthAlpha);
		const detachedMask = detachedMasks[index];
		for (let pixel = 0; pixel < priorSource.length; pixel += 1) {
			if (detachedMask[pixel] === 1) {
				priorSource[pixel] = 0;
			}
		}
		const priorData = await blurGray(priorSource, width, height, PRIOR_BLUR_SIGMA);
		await writeGrayPng(priorData, width, height, path.join(priorDir, frameName(index)));
	}
}

const BRIA_BATCH_SIZE = 12;
const BRIA_BATCH_TIMEOUT_MS = 7 * 60 * 1000;
const BRIA_BATCH_ATTEMPTS = 3;

async function killStrayRembg(): Promise<void> {
	// rembg p hangs occasionally (thread-pool deadlock observed on macOS); after a
	// watchdog timeout the uvx wrapper may die while the python child survives.
	try {
		await execFileAsync("pkill", ["-f", "rembg p -m"]);
	} catch {
		// no matching process — fine
	}
}

/**
 * Real BRIA prior: rembg cutouts over the decoded lossy frames, alpha channel extracted to gray.
 *
 * Inference is resumable and hang-proof: existing cutouts in prior-rgba/ are reused
 * (runScenario preserves that directory for bria runs), and missing frames are
 * processed in small per-process batches with a hard timeout and retries, because a
 * single `rembg p` over the full directory has been observed to deadlock mid-batch.
 */
async function prepareBriaPrior(
	decodedDir: string,
	scenarioDir: string,
	priorDir: string,
	frameCount: number,
	prior: PriorPreparation,
	scenarioId: string,
): Promise<void> {
	const rgbaDir = path.join(scenarioDir, "prior-rgba");
	await mkdir(rgbaDir, { recursive: true });
	const missing: number[] = [];
	for (let index = 0; index < frameCount; index += 1) {
		try {
			// full decode so a cutout truncated by a killed run counts as missing
			await sharp(path.join(rgbaDir, frameName(index))).raw().toBuffer();
		} catch {
			missing.push(index);
		}
	}
	if (missing.length > 0) {
		console.log(`[${scenarioId}] bria prior: ${frameCount - missing.length}/${frameCount} cutouts reused, inferring ${missing.length}`);
	}
	const batchRoot = path.join(scenarioDir, "prior-batch-in");
	for (let offset = 0; offset < missing.length; offset += BRIA_BATCH_SIZE) {
		const batch = missing.slice(offset, offset + BRIA_BATCH_SIZE);
		await rm(batchRoot, { force: true, recursive: true });
		await mkdir(batchRoot, { recursive: true });
		for (const index of batch) {
			await sharp(path.join(decodedDir, frameName(index))).png().toFile(path.join(batchRoot, frameName(index)));
		}
		const batchLabel = `batch ${Math.floor(offset / BRIA_BATCH_SIZE) + 1}/${Math.ceil(missing.length / BRIA_BATCH_SIZE)}`;
		let lastError: unknown;
		let succeeded = false;
		for (let attempt = 1; attempt <= BRIA_BATCH_ATTEMPTS && !succeeded; attempt += 1) {
			console.log(`[${scenarioId}] bria prior ${batchLabel} (${batch.length} frames, attempt ${attempt}/${BRIA_BATCH_ATTEMPTS})`);
			try {
				await execFileAsync(
					"uvx",
					["--from", prior.briaPackage, "rembg", "p", "-m", prior.briaModel, batchRoot, rgbaDir],
					{ killSignal: "SIGKILL", maxBuffer: 64 * 1024 * 1024, timeout: BRIA_BATCH_TIMEOUT_MS },
				);
				succeeded = true;
			} catch (error) {
				lastError = error;
				await killStrayRembg();
			}
		}
		if (!succeeded) {
			const stderr =
				lastError && typeof lastError === "object" && "stderr" in lastError
					? String((lastError as { stderr: unknown }).stderr)
					: String(lastError);
			throw new Error(`rembg prior extraction failed after ${BRIA_BATCH_ATTEMPTS} attempts (is uvx installed?): ${stderr.slice(-2000)}`);
		}
	}
	await rm(batchRoot, { force: true, recursive: true });
	for (let index = 0; index < frameCount; index += 1) {
		const cutoutPath = path.join(rgbaDir, frameName(index));
		const { data, info } = await sharp(cutoutPath).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
		if (info.channels !== 4) {
			throw new Error(`Expected RGBA rembg cutout at ${cutoutPath}, got ${info.channels} channels.`);
		}
		const alpha = extractAlphaChannel(data, info.width * info.height);
		await writeGrayPng(alpha, info.width, info.height, path.join(priorDir, frameName(index)));
	}
}

/**
 * External prior: gray alpha frames produced outside this CLI (e.g. MatAnyone2 `pha/`).
 * Resolves `<root>/<scenario-id>` when present so one root can serve all scenarios.
 */
async function prepareExternalPrior(
	externalDir: string,
	scenarioId: string,
	frameCount: number,
	width: number,
	height: number,
	priorDir: string,
): Promise<void> {
	const scenarioScoped = path.join(externalDir, scenarioId);
	let resolvedDir = externalDir;
	try {
		const scoped = await readdir(scenarioScoped);
		if (scoped.some((file) => /\.png$/iu.test(file))) {
			resolvedDir = scenarioScoped;
		}
	} catch {
		// fall through to the root directory
	}
	const files = (await readdir(resolvedDir)).filter((file) => /\.png$/iu.test(file)).sort();
	if (files.length !== frameCount) {
		throw new Error(`External prior dir ${resolvedDir} has ${files.length} png frame(s); expected ${frameCount}.`);
	}
	for (let index = 0; index < frameCount; index += 1) {
		const gray = await readGrayPng(path.join(resolvedDir, files[index]));
		if (gray.width !== width || gray.height !== height) {
			throw new Error(
				`External prior frame ${files[index]} is ${gray.width}x${gray.height}; expected ${width}x${height}. Run the prior model at eval resolution.`,
			);
		}
		await writeGrayPng(gray.data, width, height, path.join(priorDir, frameName(index)));
	}
}

type CompilerStatName =
	| "alphaCoverage"
	| "coreCoverage"
	| "detachedColorFidelity"
	| "fringeCoverage"
	| "leafAddedCoverage"
	| "priorCoverage"
	| "projectedCoverage"
	| "residualSpill"
	| "temporalAlphaDelta";

const COMPILER_STAT_NAMES: readonly CompilerStatName[] = [
	"alphaCoverage",
	"coreCoverage",
	"detachedColorFidelity",
	"fringeCoverage",
	"leafAddedCoverage",
	"priorCoverage",
	"projectedCoverage",
	"residualSpill",
	"temporalAlphaDelta",
];

interface ScenarioReport {
	readonly aggregates: Record<MetricName, MetricAggregate>;
	readonly compilerStats: Record<CompilerStatName, ReturnType<typeof summarizeMetric>>;
	readonly config: {
		readonly chromaBlend: number;
		readonly chromaSimilarity: number;
		readonly crf: number;
		readonly frameCount: number;
		readonly frameRate: number;
		readonly height: number;
		readonly keyColor: string;
		readonly prior: PriorMode;
		/** Gaussian sigma applied to the simulated prior; 0 for real priors. */
		readonly priorBlurSigma: number;
		readonly priorModel: string;
		readonly width: number;
	};
	readonly compiler: CompilerVersion;
	readonly id: string;
	readonly perFramePath: string;
	readonly title: string;
}

function roundAggregate(aggregate: MetricAggregate): MetricAggregate {
	return {
		direction: aggregate.direction,
		frames: aggregate.frames,
		max: Number(aggregate.max.toFixed(6)),
		mean: Number(aggregate.mean.toFixed(6)),
		min: Number(aggregate.min.toFixed(6)),
		worstFrame: aggregate.worstFrame,
		worstValue: Number(aggregate.worstValue.toFixed(6)),
	};
}

function roundFrameMetrics(metrics: FrameMetrics): FrameMetrics {
	const rounded = {} as Record<MetricName, number | null>;
	for (const name of METRIC_NAMES) {
		const value = metrics[name];
		rounded[name] = value === null ? null : Number(value.toFixed(6));
	}
	return rounded as unknown as FrameMetrics;
}

async function runScenario(
	scenario: ScenarioSpec,
	root: string,
	crf: number,
	compiler: CompilerVersion,
	priorPreparation: PriorPreparation,
): Promise<ScenarioReport> {
	const scenarioDir = path.join(root, scenario.id);
	if (priorPreparation.mode === "bria") {
		// preserve prior-rgba/ so completed (deterministic-input) rembg cutouts are
		// reused when a run is interrupted; everything else is rebuilt from scratch
		try {
			for (const entry of await readdir(scenarioDir)) {
				if (entry !== "prior-rgba") {
					await rm(path.join(scenarioDir, entry), { force: true, recursive: true });
				}
			}
		} catch {
			// scenario directory does not exist yet
		}
	} else {
		await rm(scenarioDir, { force: true, recursive: true });
	}
	const directories = {
		chromaAlpha: path.join(scenarioDir, "chroma-alpha"),
		decoded: path.join(scenarioDir, "decoded-frames"),
		out: path.join(scenarioDir, "out-frames"),
		plate: path.join(scenarioDir, "plate-frames"),
		prior: path.join(scenarioDir, "prior-alpha"),
		truth: path.join(scenarioDir, "truth"),
		truthDetached: path.join(scenarioDir, "truth-detached"),
	};
	for (const directory of Object.values(directories)) {
		await mkdir(directory, { recursive: true });
	}

	const { frameCount, height, keyColor, width } = scenario;
	const plate = renderPlateRgb(width, height, keyColor);
	console.log(`[${scenario.id}] generating ${frameCount} truth frames (${width}x${height})`);

	const truthFrames: Buffer[] = [];
	const detachedMasks: Uint8Array[] = [];
	for (let index = 0; index < frameCount; index += 1) {
		const frame = scenario.generateFrame(index);
		truthFrames.push(frame.rgba);
		detachedMasks.push(frame.detachedMask);
		await writeRgbaPng(frame.rgba, width, height, path.join(directories.truth, frameName(index)));
		const maskBytes = Buffer.alloc(width * height);
		for (let pixel = 0; pixel < maskBytes.length; pixel += 1) {
			maskBytes[pixel] = frame.detachedMask[pixel] === 1 ? 255 : 0;
		}
		await writeGrayPng(maskBytes, width, height, path.join(directories.truthDetached, frameName(index)));
		const composite = compositeOverPlate(frame.rgba, plate, width, height);
		await writeRgbPng(composite, width, height, path.join(directories.plate, frameName(index)));
	}

	console.log(`[${scenario.id}] lossy H.264 yuv420p round trip (crf ${crf})`);
	const sourcePath = path.join(scenarioDir, "source.mp4");
	await runFfmpeg([
		"-y",
		"-framerate",
		String(scenario.frameRate),
		"-i",
		path.join(directories.plate, "frame-%05d.png"),
		"-c:v",
		"libx264",
		"-pix_fmt",
		"yuv420p",
		"-crf",
		String(crf),
		"-preset",
		"medium",
		sourcePath,
	]);
	await runFfmpeg(["-y", "-i", sourcePath, "-vsync", "0", path.join(directories.decoded, "frame-%05d.png")]);
	const keyHex = `0x${normalizeHexColor(keyColor).slice(1)}`;
	await runFfmpeg([
		"-y",
		"-i",
		sourcePath,
		"-vf",
		`format=rgba,colorkey=${keyHex}:${CHROMA_SIMILARITY}:${CHROMA_BLEND},alphaextract,format=gray`,
		"-vsync",
		"0",
		path.join(directories.chromaAlpha, "frame-%05d.png"),
	]);

	console.log(`[${scenario.id}] preparing ${priorPreparation.mode} matting prior`);
	if (priorPreparation.mode === "simulated") {
		await prepareSimulatedPrior(truthFrames, detachedMasks, width, height, directories.prior);
	} else if (priorPreparation.mode === "bria") {
		await prepareBriaPrior(directories.decoded, scenarioDir, directories.prior, frameCount, priorPreparation, scenario.id);
	} else {
		if (!priorPreparation.externalDir) {
			throw new Error("--prior dir requires --prior-alpha-dir <dir>.");
		}
		await prepareExternalPrior(priorPreparation.externalDir, scenario.id, frameCount, width, height, directories.prior);
	}

	console.log(`[${scenario.id}] running ${compiler} compiler core + truth comparison`);
	const compileFrame = COMPILERS[compiler];
	const settings = evalV6Settings(keyColor, priorPreparation);
	const keyRgb = parseRgbColor(keyColor);
	const frameMetricsList: FrameMetrics[] = [];
	const compilerStats: Record<CompilerStatName, number[]> = {
		alphaCoverage: [],
		coreCoverage: [],
		detachedColorFidelity: [],
		fringeCoverage: [],
		leafAddedCoverage: [],
		priorCoverage: [],
		projectedCoverage: [],
		residualSpill: [],
		temporalAlphaDelta: [],
	};
	let previousCompilerAlpha: Uint8Array | undefined;
	let previousOutputAlpha: Uint8Array | undefined;
	let previousTruthAlpha: Uint8Array | undefined;
	const perFrameRecords: Array<{ compiler: Record<CompilerStatName, number>; frame: number; metrics: FrameMetrics }> = [];

	for (let index = 0; index < frameCount; index += 1) {
		const decoded = await readRgbPng(path.join(directories.decoded, frameName(index)));
		if (decoded.width !== width || decoded.height !== height) {
			throw new Error(`Decoded frame ${index + 1} has unexpected dimensions ${decoded.width}x${decoded.height}.`);
		}
		const chromaAlpha = await readGrayPng(path.join(directories.chromaAlpha, frameName(index)));
		const truthAlpha = extractAlphaChannel(truthFrames[index], width * height);
		const detachedMask = detachedMasks[index];
		const prior: RawGrayImage = await readGrayPng(path.join(directories.prior, frameName(index)));
		if (prior.width !== width || prior.height !== height) {
			throw new Error(`Prior frame ${index + 1} is ${prior.width}x${prior.height}; expected ${width}x${height}.`);
		}

		const result: V6FrameResult = compileFrame(decoded, prior, chromaAlpha, settings, previousCompilerAlpha, false);
		await writeRgbaPng(result.data, width, height, path.join(directories.out, frameName(index)));

		for (const stat of COMPILER_STAT_NAMES) {
			compilerStats[stat].push(result[stat]);
		}

		const outputAlpha = extractAlphaChannel(result.data, width * height);
		const metrics = computeFrameMetrics({
			detachedMask,
			height,
			keyColor: keyRgb,
			output: result.data,
			previousOutputAlpha,
			previousTruthAlpha,
			priorAlpha: new Uint8Array(prior.data),
			truth: truthFrames[index],
			width,
		});
		frameMetricsList.push(metrics);
		const compilerRecord = {} as Record<CompilerStatName, number>;
		for (const stat of COMPILER_STAT_NAMES) {
			compilerRecord[stat] = Number(result[stat].toFixed(6));
		}
		perFrameRecords.push({ compiler: compilerRecord, frame: index + 1, metrics: roundFrameMetrics(metrics) });

		previousCompilerAlpha = outputAlpha;
		previousOutputAlpha = outputAlpha;
		previousTruthAlpha = truthAlpha;
	}

	const aggregatesRaw = aggregateFrameMetrics(frameMetricsList);
	const aggregates = {} as Record<MetricName, MetricAggregate>;
	for (const name of METRIC_NAMES) {
		aggregates[name] = roundAggregate(aggregatesRaw[name]);
	}
	const compilerStatSummaries = {} as Record<CompilerStatName, ReturnType<typeof summarizeMetric>>;
	for (const stat of COMPILER_STAT_NAMES) {
		compilerStatSummaries[stat] = summarizeMetric(compilerStats[stat]);
	}

	await writeFile(path.join(scenarioDir, "frames.json"), JSON.stringify(perFrameRecords, null, "\t"));
	const report: ScenarioReport = {
		aggregates,
		compiler,
		compilerStats: compilerStatSummaries,
		config: {
			chromaBlend: CHROMA_BLEND,
			chromaSimilarity: CHROMA_SIMILARITY,
			crf,
			frameCount,
			frameRate: scenario.frameRate,
			height,
			keyColor: normalizeHexColor(keyColor),
			prior: priorPreparation.mode,
			priorBlurSigma: priorPreparation.mode === "simulated" ? PRIOR_BLUR_SIGMA : 0,
			priorModel: priorSettingLabels(priorPreparation).priorModel,
			width,
		},
		id: scenario.id,
		perFramePath: `${scenario.id}/frames.json`,
		title: scenario.title,
	};
	await writeFile(path.join(scenarioDir, "report.json"), JSON.stringify(report, null, "\t"));
	return report;
}

interface EvalReport {
	readonly createdAt: string;
	readonly includedScenarioIds: string[];
	readonly prior?: PriorMode;
	readonly runScope: EvalRunScope;
	readonly scenarios: ScenarioReport[];
	readonly schemaVersion: 1;
	readonly toolchain: Record<string, string>;
}

function priorPreparationFromArgs(args: EvalArgs): PriorPreparation {
	const mode = parsePriorMode(args.options.get("prior"));
	const preparation: PriorPreparation = {
		briaModel: args.options.get("prior-model") ?? DEFAULT_BRIA_MODEL,
		briaPackage: args.options.get("prior-package") ?? DEFAULT_BRIA_PACKAGE,
		externalDir: args.options.get("prior-alpha-dir"),
		mode,
	};
	if (mode === "dir" && preparation.externalDir === undefined) {
		throw new Error("--prior dir requires --prior-alpha-dir <dir> (gray alpha frames, e.g. a MatAnyone2 pha/ tree).");
	}
	return preparation;
}

async function commandRun(args: EvalArgs): Promise<void> {
	const priorPreparation = priorPreparationFromArgs(args);
	const root = args.options.get("root") ?? defaultEvalRootForPrior(priorPreparation.mode, DEFAULT_EVAL_ROOT);
	const width = numberOption(args, "width", 640);
	const height = numberOption(args, "height", 360);
	const frameCount = numberOption(args, "frames", 48);
	const crf = numberOption(args, "crf", 23);
	const compiler = compilerOption(args);
	const scenarioFilter = args.options.get("scenario");
	await mkdir(root, { recursive: true });
	const scenarios = createScenarios({ frameCount, height, width })
		.filter((scenario) => scenarioFilter === undefined || scenario.id === scenarioFilter);
	if (scenarios.length === 0) {
		throw new Error(`No scenario matches --scenario ${scenarioFilter}. Known: ${createScenarios().map((s) => s.id).join(", ")}`);
	}
	const toolchain: Record<string, string> = {
		compiler,
		ffmpeg: await ffmpegVersion(),
		node: process.version,
		prior: priorPreparation.mode,
		...(priorPreparation.mode === "bria"
			? { "prior-model": priorPreparation.briaModel, "prior-package": priorPreparation.briaPackage }
			: {}),
		...Object.fromEntries(Object.entries(sharp.versions).map(([key, value]) => [`sharp-${key}`, String(value)])),
	};
	const reports: ScenarioReport[] = [];
	for (const scenario of scenarios) {
		reports.push(await runScenario(scenario, root, crf, compiler, priorPreparation));
	}
	const runScope: EvalRunScope = scenarioFilter === undefined ? "full" : "partial";
	const includedScenarioIds = reports.map((report) => report.id);
	const report: EvalReport = {
		createdAt: new Date().toISOString(),
		includedScenarioIds,
		prior: priorPreparation.mode,
		runScope,
		scenarios: reports,
		schemaVersion: 1,
		toolchain,
	};
	await writeFile(path.join(root, "report.json"), JSON.stringify(report, null, "\t"));
	console.log(`wrote ${path.join(root, "report.json")} (${runScope}, prior: ${priorPreparation.mode}, scenarios: ${includedScenarioIds.join(", ")})`);
	for (const report of reports) {
		console.log(`\n[${report.id}] ${report.title}`);
		for (const name of METRIC_NAMES) {
			const aggregate = report.aggregates[name];
			if (aggregate.frames === 0) {
				continue;
			}
			console.log(
				`  ${name.padEnd(26)} mean=${aggregate.mean.toFixed(5)} worst=${aggregate.worstValue.toFixed(5)} @frame ${aggregate.worstFrame}`,
			);
		}
	}
}

async function readEvalReport(root: string): Promise<EvalReport> {
	const reportPath = path.join(root, "report.json");
	try {
		return JSON.parse(await readFile(reportPath, "utf8")) as EvalReport;
	} catch (error) {
		throw new Error(`Could not read ${reportPath}. Run \`pnpm alpha-eval run\` first. (${String(error)})`);
	}
}

function toScenarioAggregates(report: EvalReport): ScenarioAggregates[] {
	return report.scenarios.map((scenario) => ({ aggregates: scenario.aggregates, id: scenario.id }));
}

async function commandCompare(args: EvalArgs): Promise<void> {
	const priorOption = args.options.has("prior") ? parsePriorMode(args.options.get("prior")) : undefined;
	const root = args.options.get("root") ?? defaultEvalRootForPrior(priorOption ?? "simulated", DEFAULT_EVAL_ROOT);
	const scenarioFilter = args.options.get("scenario");
	const allowUnbaselined = args.options.has("allow-unbaselined");
	const report = await readEvalReport(root);
	const reportPrior: PriorMode = report.prior ?? "simulated";
	if (priorOption !== undefined && priorOption !== reportPrior) {
		throw new Error(`--prior ${priorOption} does not match the report at ${root} (prior: ${reportPrior}).`);
	}
	const baselinePath = args.options.get("baseline") ?? defaultBaselinePathForPrior(reportPrior, DEFAULT_BASELINE_PATH);
	assertComparableEvalReport(report, scenarioFilter, CANONICAL_SCENARIO_IDS);
	let baselineRaw: string;
	try {
		baselineRaw = await readFile(baselinePath, "utf8");
	} catch (error) {
		throw new Error(
			`Could not read baseline ${baselinePath} (${String(error)}). `
				+ `For a new prior mode, accept a first run with \`pnpm alpha-eval update-baseline --prior ${reportPrior}\` and commit the baseline.`,
		);
	}
	const baseline = JSON.parse(baselineRaw) as BaselineFile;
	assertBaselinePriorMatchesReport(reportPrior, baseline);
	const scenarios = selectScenariosForCompare(toScenarioAggregates(report), scenarioFilter);
	const comparedScenarioIds = new Set(scenarios.map((scenario) => scenario.id));
	const scopedBaseline: BaselineFile = {
		...baseline,
		scenarios: Object.fromEntries(
			Object.entries(baseline.scenarios).filter(([scenarioId]) => comparedScenarioIds.has(scenarioId)),
		),
	};
	const result = compareReportToBaseline(scenarios, scopedBaseline, { allowUnbaselined });
	console.log(formatComparisonTable(result));
	const improved = result.rows.filter((row) => row.status === "improved").length;
	const passes = result.rows.length - result.failures - improved;
	console.log(`\n${result.rows.length} checks: ${passes} pass, ${improved} improved, ${result.failures} fail`);
	if (result.unbaselinedWarnings > 0) {
		console.warn(`${result.unbaselinedWarnings} unbaselined row(s) allowed via --allow-unbaselined (not suitable for CI).`);
	}
	if (result.failures > 0) {
		console.error("BASELINE COMPARISON FAILED. If the regression is intentional, rerun `pnpm alpha-eval update-baseline` and commit the new baseline with justification.");
		process.exitCode = 1;
		return;
	}
	if (improved > 0) {
		console.log("Improvements beyond tolerance detected. Consider `pnpm alpha-eval update-baseline` to lock them in.");
	}
	console.log("baseline comparison passed");
}

async function commandUpdateBaseline(args: EvalArgs): Promise<void> {
	const priorOption = args.options.has("prior") ? parsePriorMode(args.options.get("prior")) : undefined;
	const root = args.options.get("root") ?? defaultEvalRootForPrior(priorOption ?? "simulated", DEFAULT_EVAL_ROOT);
	const report = await readEvalReport(root);
	const reportPrior: PriorMode = report.prior ?? "simulated";
	if (priorOption !== undefined && priorOption !== reportPrior) {
		throw new Error(`--prior ${priorOption} does not match the report at ${root} (prior: ${reportPrior}).`);
	}
	const baselinePath = args.options.get("baseline") ?? defaultBaselinePathForPrior(reportPrior, DEFAULT_BASELINE_PATH);
	const baseline = buildBaseline(toScenarioAggregates(report), new Date().toISOString(), report.toolchain, undefined, reportPrior);
	await mkdir(path.dirname(baselinePath), { recursive: true });
	await writeFile(baselinePath, JSON.stringify(baseline, null, "\t") + "\n");
	console.log(`wrote ${baselinePath} (prior: ${reportPrior})`);
}

function printHelp(): void {
	console.log([
		"Alpha Compiler synthetic ground-truth evaluation",
		"",
		"Commands:",
		"  run              [--root tmp/alpha-compiler-eval] [--scenario gt-sparks|gt-smoke|gt-tassels] [--frames 48] [--width 640] [--height 360] [--crf 23] [--compiler v6|v7]",
		"                   [--prior simulated|bria|dir] [--prior-alpha-dir <dir>] [--prior-model bria-rmbg] [--prior-package 'rembg[cpu,cli]']",
		"  compare          [--root tmp/alpha-compiler-eval] [--scenario gt-sparks|gt-smoke|gt-tassels] [--allow-unbaselined] [--baseline ...] [--prior ...]",
		"                   Partial reports require --scenario. Full reports must include all canonical scenarios.",
		"  update-baseline  [--root tmp/alpha-compiler-eval] [--baseline ...] [--prior ...]",
		"",
		"Prior modes: simulated (truth-derived, canonical CI leg), bria (real BRIA RMBG via uvx rembg),",
		"dir (external gray alpha frames, e.g. MatAnyone2 pha/; per-scenario subdirs resolved automatically).",
		"Non-simulated runs default to <root>-<prior> and <baseline>-<prior>.json so they never clobber the canonical leg.",
		"",
		"Per-frame metrics: <root>/<scenario>/frames.json; aggregates with worst-frame pointers: <root>/<scenario>/report.json.",
	].join("\n"));
}

async function main(): Promise<void> {
	const args = parseEvalArgs(process.argv.slice(2));
	switch (args.command) {
		case "run":
			await commandRun(args);
			return;
		case "compare":
			await commandCompare(args);
			return;
		case "update-baseline":
			await commandUpdateBaseline(args);
			return;
		case "help":
		case "--help":
		case "-h":
			printHelp();
			return;
		default:
			printHelp();
			throw new Error(`Unknown command: ${args.command}`);
	}
}

main().catch((error: unknown) => {
	console.error(error instanceof Error ? error.message : error);
	process.exitCode = 1;
});
