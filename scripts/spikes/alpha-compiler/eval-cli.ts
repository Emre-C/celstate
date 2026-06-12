/**
 * Synthetic ground-truth evaluation loop for the Alpha Compiler.
 *
 * Pipeline per scenario:
 *   1. generate deterministic RGBA truth frames (known alpha + foreground RGB);
 *   2. composite them over a noisy chroma plate;
 *   3. push the composites through a realistic lossy video path (H.264 yuv420p);
 *   4. extract decoded frames + sharp chroma alpha exactly like the spike harness;
 *   5. derive a simulated matting prior from the truth alpha (detached elements
 *      removed, gaussian-blurred) so the run is deterministic and model-free;
 *   6. run the real v6 compiler core (createV6RgbaFrame) on the lossy inputs;
 *   7. compare the output against the stored truth, frame by frame.
 *
 * Honest limitation: the matting prior is simulated from truth, not produced by
 * MatAnyone2/BRIA. The eval therefore measures the compiler core given a prior of
 * fixed, documented quality - it does not measure prior-model quality. The
 * `priorAlphaMae` metric records that floor so compiler scores can be read against it.
 *
 * Commands:
 *   pnpm alpha-eval run              [--root tmp/alpha-compiler-eval] [--scenario <id>] [--frames 48] [--width 640] [--height 360] [--crf 23]
 *   pnpm alpha-eval compare          [--root ...] [--scenario <id>] [--allow-unbaselined] [--baseline ...]
 *   pnpm alpha-eval update-baseline  [--root ...] [--baseline ...]
 *
 * The workflow is idempotent: scenario directories are wiped and rebuilt on every run.
 */

import { execFile } from "node:child_process";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
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
	assertComparableEvalReport,
	buildBaseline,
	compareReportToBaseline,
	formatComparisonTable,
	selectScenariosForCompare,
	type BaselineFile,
	type EvalRunScope,
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

function evalV6Settings(keyColor: string): V6ProjectionSettings {
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
		priorAlphaDir: "synthetic-truth-derived",
		priorModel: "synthetic-truth-prior",
		priorPackage: "none",
		selectedFrame: 1,
		subjectAlphaThreshold: 32,
		transparentCutoff: 2,
	};
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
		readonly priorBlurSigma: number;
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

async function runScenario(scenario: ScenarioSpec, root: string, crf: number, compiler: CompilerVersion): Promise<ScenarioReport> {
	const scenarioDir = path.join(root, scenario.id);
	await rm(scenarioDir, { force: true, recursive: true });
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

	console.log(`[${scenario.id}] running ${compiler} compiler core + truth comparison`);
	const compileFrame = COMPILERS[compiler];
	const settings = evalV6Settings(keyColor);
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
		const priorSource = new Uint8Array(truthAlpha);
		const detachedMask = detachedMasks[index];
		for (let pixel = 0; pixel < priorSource.length; pixel += 1) {
			if (detachedMask[pixel] === 1) {
				priorSource[pixel] = 0;
			}
		}
		const priorData = await blurGray(priorSource, width, height, PRIOR_BLUR_SIGMA);
		await writeGrayPng(priorData, width, height, path.join(directories.prior, frameName(index)));
		const prior: RawGrayImage = { data: priorData, height, width };

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
			priorAlpha: new Uint8Array(priorData),
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
			priorBlurSigma: PRIOR_BLUR_SIGMA,
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
	readonly runScope: EvalRunScope;
	readonly scenarios: ScenarioReport[];
	readonly schemaVersion: 1;
	readonly toolchain: Record<string, string>;
}

async function commandRun(args: EvalArgs): Promise<void> {
	const root = args.options.get("root") ?? DEFAULT_EVAL_ROOT;
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
		...Object.fromEntries(Object.entries(sharp.versions).map(([key, value]) => [`sharp-${key}`, String(value)])),
	};
	const reports: ScenarioReport[] = [];
	for (const scenario of scenarios) {
		reports.push(await runScenario(scenario, root, crf, compiler));
	}
	const runScope: EvalRunScope = scenarioFilter === undefined ? "full" : "partial";
	const includedScenarioIds = reports.map((report) => report.id);
	const report: EvalReport = {
		createdAt: new Date().toISOString(),
		includedScenarioIds,
		runScope,
		scenarios: reports,
		schemaVersion: 1,
		toolchain,
	};
	await writeFile(path.join(root, "report.json"), JSON.stringify(report, null, "\t"));
	console.log(`wrote ${path.join(root, "report.json")} (${runScope}, scenarios: ${includedScenarioIds.join(", ")})`);
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
	const root = args.options.get("root") ?? DEFAULT_EVAL_ROOT;
	const baselinePath = args.options.get("baseline") ?? DEFAULT_BASELINE_PATH;
	const scenarioFilter = args.options.get("scenario");
	const allowUnbaselined = args.options.has("allow-unbaselined");
	const report = await readEvalReport(root);
	assertComparableEvalReport(report, scenarioFilter, CANONICAL_SCENARIO_IDS);
	const baseline = JSON.parse(await readFile(baselinePath, "utf8")) as BaselineFile;
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
	const root = args.options.get("root") ?? DEFAULT_EVAL_ROOT;
	const baselinePath = args.options.get("baseline") ?? DEFAULT_BASELINE_PATH;
	const report = await readEvalReport(root);
	const baseline = buildBaseline(toScenarioAggregates(report), new Date().toISOString(), report.toolchain);
	await mkdir(path.dirname(baselinePath), { recursive: true });
	await writeFile(baselinePath, JSON.stringify(baseline, null, "\t") + "\n");
	console.log(`wrote ${baselinePath}`);
}

function printHelp(): void {
	console.log([
		"Alpha Compiler synthetic ground-truth evaluation",
		"",
		"Commands:",
		"  run              [--root tmp/alpha-compiler-eval] [--scenario gt-sparks|gt-smoke|gt-tassels] [--frames 48] [--width 640] [--height 360] [--crf 23] [--compiler v6|v7]",
		"  compare          [--root tmp/alpha-compiler-eval] [--scenario gt-sparks|gt-smoke|gt-tassels] [--allow-unbaselined] [--baseline ...]",
		"                   Partial reports require --scenario. Full reports must include all canonical scenarios.",
		"  update-baseline  [--root tmp/alpha-compiler-eval] [--baseline ...]",
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
