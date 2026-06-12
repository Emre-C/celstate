import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import {
	appendFile,
	copyFile,
	mkdir,
	readdir,
	readFile,
	rm,
	stat,
	writeFile,
} from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { GoogleGenAI, GenerateVideosOperation } from "@google/genai";
import type { Image, Video } from "@google/genai";
import sharp from "sharp";
import {
	chamferDistanceToMask,
	clampByte,
	colorDistanceSquared,
	createV6RgbaFrame,
	createV7RgbaFrame,
	distanceToTransparent,
	fillInwardCoreColors,
	keyDominance,
	normalizeHexColor,
	parseRgbColor,
	rgbToHex,
	smoothStep,
	summarizeMetric,
	type RawGrayImage,
	type RawRgbaImage,
	type RawRgbImage,
	type RgbColor,
	type V6ProjectionSettings,
} from "./alpha-compiler/core.js";
import {
	createChatSession,
	createGeminiClient,
	readGeminiRuntimeConfigFromEnv,
	type GeminiImageResult,
} from "../../src/convex/lib/gemini.js";

const execFileAsync = promisify(execFile);

const DEFAULT_ROOT = "tmp/transparent-animation-spike";
const DEFAULT_CHROMA_COLOR = "#00ff00";
const DEFAULT_CHROMA_SIMILARITY = 0.12;
const DEFAULT_CHROMA_BLEND = 0.08;
const DEFAULT_PROVIDER_IMAGE_MODEL = "gemini-3.1-flash-image-preview";
const DEFAULT_PROVIDER_VIDEO_MODEL = "veo-3.1-fast-generate-preview";
const DEFAULT_PROVIDER_ASPECT_RATIO = "16:9";
const DEFAULT_PROVIDER_IMAGE_SIZE = "1K";
const DEFAULT_PROVIDER_VIDEO_RESOLUTION = "720p";
const DEFAULT_PROVIDER_DURATION_SECONDS = 8;
const DEFAULT_PROVIDER_POLL_INTERVAL_MS = 10_000;
const DEFAULT_PROVIDER_MAX_WAIT_MS = 30 * 60 * 1000;

const STAGES = ["chroma-baseline", "matting-baseline", "celstate-alpha-v0", "celstate-alpha-v1-despill", "celstate-alpha-v2-trimap", "celstate-alpha-v3-core-fringe", "celstate-alpha-v4-prior-fusion", "celstate-alpha-v5-video-prior", "celstate-alpha-v6-projection", "celstate-alpha-v7", "video-prior"] as const;
type Stage = typeof STAGES[number];

const SOURCE_MODES = ["text-to-video", "image-to-video", "ingredients-to-video"] as const;
type SourceMode = typeof SOURCE_MODES[number];

const REFERENCE_ROLES = ["first-frame", "reference-image"] as const;
type ReferenceRole = typeof REFERENCE_ROLES[number];

const METRIC_KEYS = [
	"alphaUsability",
	"temporalCoherence",
	"edgeSpillHalo",
	"identityStability",
	"internalMotion",
	"secondaryMotionCoupling",
	"promptCompliance",
	"editorCompatibility",
	"overallAwe",
] as const;
type MetricKey = typeof METRIC_KEYS[number];

interface ParsedArgs {
	readonly command: string;
	readonly options: ReadonlyMap<string, readonly string[]>;
	readonly positionals: readonly string[];
}

interface PromptFixture {
	readonly chromaPrompt: string;
	readonly expectedHardParts: string;
	readonly id: string;
	readonly passCriteria: string;
	readonly prompt: string;
	readonly source: string;
	readonly tests: string;
	readonly title: string;
	readonly useCase: string;
}

interface ChromaSettings {
	readonly blend: number;
	readonly color: string;
	readonly similarity: number;
}

interface GenerationMetadata {
	readonly costUsd?: number;
	readonly latencySeconds?: number;
	readonly model?: string;
	readonly provider?: string;
	readonly seed?: string;
	readonly settings?: Record<string, string>;
}

interface RunInput {
	readonly chroma: ChromaSettings;
	readonly createdAt: string;
	readonly generation: GenerationMetadata;
	readonly prompt: PromptFixture;
	readonly reference?: {
		readonly normalized: string;
		readonly originalPath: string;
		readonly role: ReferenceRole;
		readonly storedOriginal: string;
	};
	readonly lastFrame?: {
		readonly normalized: string;
		readonly originalPath: string;
		readonly storedOriginal: string;
	};
	readonly runId: string;
	readonly sourceMode?: SourceMode;
	readonly source?: {
		readonly originalPath: string;
		readonly storedOriginal: string;
		readonly normalized: string;
	};
}

interface ManualScore {
	readonly aggregate: number;
	readonly artifactPath?: string;
	readonly createdAt: string;
	readonly failures: readonly string[];
	readonly metrics: Record<MetricKey, number>;
	readonly notes: string;
	readonly stage: Stage;
}

interface ScoresFile {
	readonly runId: string;
	readonly scores: Partial<Record<Stage, ManualScore>>;
	readonly updatedAt: string;
}

interface CommandResult {
	readonly logPath?: string;
	readonly stderr: string;
	readonly stdout: string;
}

interface RunContext {
	readonly directory: string;
	readonly runId: string;
}

interface RunEvent {
	readonly data?: Record<string, unknown>;
	readonly event: string;
	readonly level: "error" | "info" | "warn";
	readonly message: string;
	readonly runId: string;
	readonly stage?: string;
	readonly timestamp: string;
}

interface StepState {
	readonly commandLog?: string;
	readonly durationMs?: number;
	readonly endedAt?: string;
	readonly error?: string;
	readonly metadata?: Record<string, unknown>;
	readonly outputs?: readonly string[];
	readonly skippedBecauseComplete?: boolean;
	readonly startedAt?: string;
	readonly status: "failed" | "running" | "succeeded";
}

interface ProviderGenerationOptions {
	readonly aspectRatio: string;
	readonly durationSeconds: number;
	readonly estimatedProviderCostUsd?: number;
	readonly force: boolean;
	readonly imageSize: string;
	readonly maxWaitMs: number;
	readonly pollIntervalMs: number;
	readonly seed?: number;
	readonly videoModel: string;
	readonly videoResolution: string;
}

interface VideoOperationRecord {
	readonly config: {
		readonly aspectRatio: string;
		readonly durationSeconds: number;
		readonly resolution: string;
		readonly seed?: number;
	};
	readonly firstFrame: string;
	readonly lastFrame: string;
	readonly model: string;
	readonly operationName: string;
	readonly promptPath: string;
	readonly submittedAt: string;
}

interface PipelineState {
	readonly runId: string;
	readonly steps: Record<string, StepState>;
	readonly updatedAt: string;
}

interface ProviderCallSummary {
	readonly attemptId: string;
	readonly call: string;
	readonly durationMs?: number;
	readonly endedAt?: string;
	readonly error?: string;
	readonly metadata?: Record<string, unknown>;
	readonly model?: string;
	readonly startedAt: string;
	readonly status: "failed" | "running" | "succeeded";
}

function parseArgs(argv: readonly string[]): ParsedArgs {
	const [command = "help", ...rest] = argv;
	const options = new Map<string, string[]>();
	const positionals: string[] = [];

	for (let index = 0; index < rest.length; index += 1) {
		const token = rest[index];
		if (!token.startsWith("--")) {
			positionals.push(token);
			continue;
		}

		const withoutPrefix = token.slice(2);
		const equalsIndex = withoutPrefix.indexOf("=");
		if (equalsIndex >= 0) {
			appendOption(options, withoutPrefix.slice(0, equalsIndex), withoutPrefix.slice(equalsIndex + 1));
			continue;
		}

		const next = rest[index + 1];
		if (next && !next.startsWith("--")) {
			appendOption(options, withoutPrefix, next);
			index += 1;
			continue;
		}

		appendOption(options, withoutPrefix, "true");
	}

	return { command, options, positionals };
}

function appendOption(options: Map<string, string[]>, key: string, value: string): void {
	const current = options.get(key) ?? [];
	current.push(value);
	options.set(key, current);
}

function getOption(args: ParsedArgs, key: string): string | undefined {
	return args.options.get(key)?.[0];
}

function getOptions(args: ParsedArgs, key: string): readonly string[] {
	return args.options.get(key) ?? [];
}

function getRequiredOption(args: ParsedArgs, key: string): string {
	const value = getOption(args, key)?.trim();
	if (!value) {
		throw new Error(`Pass --${key} <value>.`);
	}
	return value;
}

function getNumberOption(args: ParsedArgs, key: string, fallback: number): number {
	const value = getOption(args, key);
	if (value === undefined) {
		return fallback;
	}
	const parsed = Number(value);
	if (!Number.isFinite(parsed)) {
		throw new Error(`--${key} must be a finite number. Got: ${value}`);
	}
	return parsed;
}

function getOptionalNumberOption(args: ParsedArgs, key: string): number | undefined {
	const value = getOption(args, key);
	if (value === undefined) {
		return undefined;
	}
	const parsed = Number(value);
	if (!Number.isFinite(parsed)) {
		throw new Error(`--${key} must be a finite number. Got: ${value}`);
	}
	return parsed;
}

function spikeRoot(args: ParsedArgs): string {
	return path.resolve(process.cwd(), getOption(args, "root") ?? DEFAULT_ROOT);
}

function runsRoot(root: string): string {
	return path.join(root, "runs");
}

function runDirectory(root: string, runId: string): string {
	return path.join(runsRoot(root), runId);
}

async function ensureDirectory(directory: string): Promise<void> {
	await mkdir(directory, { recursive: true });
}

async function readJson<T>(filePath: string): Promise<T> {
	return JSON.parse(await readFile(filePath, "utf8")) as T;
}

async function writeJson(filePath: string, value: unknown): Promise<void> {
	await writeFile(filePath, `${JSON.stringify(value, null, "\t")}\n`, "utf8");
}

function relativeToWorkspace(filePath: string): string {
	return path.relative(process.cwd(), filePath).replace(/\\/g, "/");
}

function statePath(directory: string): string {
	return path.join(directory, "pipeline-state.json");
}

function eventsPath(directory: string): string {
	return path.join(directory, "events.ndjson");
}

function providerCallsPath(directory: string): string {
	return path.join(directory, "provider-calls.json");
}

async function appendRunEvent(
	context: RunContext,
	event: Omit<RunEvent, "runId" | "timestamp">,
): Promise<void> {
	const line: RunEvent = {
		...event,
		runId: context.runId,
		timestamp: new Date().toISOString(),
	};
	await appendFile(eventsPath(context.directory), `${JSON.stringify(line)}\n`, "utf8");
}

async function readPipelineState(context: RunContext): Promise<PipelineState> {
	const filePath = statePath(context.directory);
	if (!existsSync(filePath)) {
		return { runId: context.runId, steps: {}, updatedAt: new Date().toISOString() };
	}
	return readJson<PipelineState>(filePath);
}

async function readProviderCalls(context: RunContext): Promise<ProviderCallSummary[]> {
	const filePath = providerCallsPath(context.directory);
	if (!existsSync(filePath)) {
		return [];
	}
	return readJson<ProviderCallSummary[]>(filePath);
}

async function upsertProviderCall(context: RunContext, summary: ProviderCallSummary): Promise<void> {
	const calls = await readProviderCalls(context);
	const next = calls.filter((call) => call.attemptId !== summary.attemptId);
	next.push(summary);
	await writeJson(providerCallsPath(context.directory), next);
}

async function runProviderCall<T>(
	context: RunContext,
	call: string,
	model: string,
	metadata: Record<string, unknown>,
	operation: () => Promise<T>,
): Promise<T> {
	const startedAt = new Date().toISOString();
	const attempt: ProviderCallSummary = {
		attemptId: `${timestampLabel()}-${slugify(call)}`,
		call,
		metadata,
		model,
		startedAt,
		status: "running",
	};
	await upsertProviderCall(context, attempt);
	await appendRunEvent(context, {
		data: { attemptId: attempt.attemptId, call, metadata, model },
		event: "provider_call_started",
		level: "info",
		message: `${call} started`,
		stage: call,
	});
	try {
		const result = await operation();
		const endedAt = new Date().toISOString();
		const completed: ProviderCallSummary = {
			...attempt,
			durationMs: Date.parse(endedAt) - Date.parse(startedAt),
			endedAt,
			status: "succeeded",
		};
		await upsertProviderCall(context, completed);
		await appendRunEvent(context, {
			data: { attemptId: attempt.attemptId, call, durationMs: completed.durationMs, model },
			event: "provider_call_succeeded",
			level: "info",
			message: `${call} succeeded`,
			stage: call,
		});
		return result;
	} catch (error) {
		const endedAt = new Date().toISOString();
		const message = error instanceof Error ? error.message : String(error);
		const failed: ProviderCallSummary = {
			...attempt,
			durationMs: Date.parse(endedAt) - Date.parse(startedAt),
			endedAt,
			error: message,
			status: "failed",
		};
		await upsertProviderCall(context, failed);
		await appendRunEvent(context, {
			data: { attemptId: attempt.attemptId, call, durationMs: failed.durationMs, error: message, model },
			event: "provider_call_failed",
			level: "error",
			message,
			stage: call,
		});
		throw error;
	}
}

async function updateStepState(context: RunContext, step: string, state: StepState): Promise<void> {
	const current = await readPipelineState(context);
	await writeJson(statePath(context.directory), {
		runId: context.runId,
		steps: {
			...current.steps,
			[step]: state,
		},
		updatedAt: new Date().toISOString(),
	} satisfies PipelineState);
}

async function markStepStarted(context: RunContext, step: string): Promise<string> {
	const startedAt = new Date().toISOString();
	await updateStepState(context, step, { startedAt, status: "running" });
	await appendRunEvent(context, {
		event: "step_started",
		level: "info",
		message: `${step} started`,
		stage: step,
	});
	return startedAt;
}

async function markStepSucceeded(
	context: RunContext,
	step: string,
	startedAt: string,
	options: {
		commandLog?: string;
		metadata?: Record<string, unknown>;
		outputs?: readonly string[];
		skippedBecauseComplete?: boolean;
	} = {},
): Promise<void> {
	const endedAt = new Date().toISOString();
	await updateStepState(context, step, {
		commandLog: options.commandLog,
		durationMs: Date.parse(endedAt) - Date.parse(startedAt),
		endedAt,
		metadata: options.metadata,
		outputs: options.outputs,
		skippedBecauseComplete: options.skippedBecauseComplete,
		startedAt,
		status: "succeeded",
	});
	await appendRunEvent(context, {
		data: options.outputs || options.metadata ? { metadata: options.metadata, outputs: options.outputs } : undefined,
		event: options.skippedBecauseComplete ? "step_skipped_complete" : "step_succeeded",
		level: "info",
		message: options.skippedBecauseComplete ? `${step} already complete` : `${step} succeeded`,
		stage: step,
	});
}

async function markStepFailed(
	context: RunContext,
	step: string,
	startedAt: string,
	error: unknown,
	commandLog?: string,
): Promise<void> {
	const endedAt = new Date().toISOString();
	const message = error instanceof Error ? error.message : String(error);
	const resolvedCommandLog = commandLog ?? extractCommandLog(message);
	await updateStepState(context, step, {
		commandLog: resolvedCommandLog,
		durationMs: Date.parse(endedAt) - Date.parse(startedAt),
		endedAt,
		error: message,
		startedAt,
		status: "failed",
	});
	await appendRunEvent(context, {
		data: resolvedCommandLog ? { commandLog: resolvedCommandLog } : undefined,
		event: "step_failed",
		level: "error",
		message,
		stage: step,
	});
}

function extractCommandLog(message: string): string | undefined {
	return message.match(/command log: ([^\r\n]+)/)?.[1];
}

function timestampLabel(): string {
	return new Date().toISOString().replace(/[:.]/g, "-");
}

function slugify(value: string): string {
	return value
		.trim()
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, "-")
		.replace(/^-+|-+$/g, "") || "run";
}

function compact<T>(values: readonly (T | undefined)[]): T[] {
	return values.filter((value): value is T => value !== undefined);
}

function chromaKeyDescription(color: string): string {
	const normalized = normalizeHexColor(color).toUpperCase();
	if (normalized === "#00FF00") {
		return "pure chroma green (#00FF00)";
	}
	if (normalized === "#FF00FF") {
		return "pure chroma magenta (#FF00FF)";
	}
	if (normalized === "#7F00FF") {
		return "electric violet (#7F00FF)";
	}
	return `flat key color ${normalized}`;
}

function chromaAdaptPrompt(prompt: string, keyColor = DEFAULT_CHROMA_COLOR): string {
	const color = chromaKeyDescription(keyColor);
	return [
		prompt,
		`Background: every pixel not occupied by the mascot or foreground leaves must be a perfectly flat, evenly lit ${color} color field.`,
		`Color exclusion rule: ${color} is reserved only for the background. Do not use this color on the mascot, costume, fur, eyes, edges, motion blur, leaves, particles, glow, smoke, reflections, shadows, or any foreground detail.`,
		"No text, no logo, no border, no background texture, no floor, no contact shadow, no gradient, no vignette, no camera shake.",
	].join(" ");
}

function imageAnchoredChromaPrompt(prompt: string, keyColor = DEFAULT_CHROMA_COLOR): string {
	const color = chromaKeyDescription(keyColor);
	return [
		"Use the provided still image as the exact first-frame composition and scene contract.",
		prompt,
		`Preserve the still image's ${color} background as a perfectly flat, evenly lit color field for the full clip.`,
		"Animate only the mascot and foreground leaves/particles; keep the background as a static color plate with no floor, horizon, contact shadow, studio lighting, gradient, vignette, reflections, text, logo, border, or camera movement.",
		`Color exclusion rule: ${color} is reserved only for the background. Do not use this color on the mascot, costume, fur, eyes, edges, motion blur, leaves, particles, glow, smoke, reflections, shadows, or any foreground detail.`,
	].join(" ");
}

function promptForSourceMode(prompt: string, keyColor: string, sourceMode: SourceMode): string {
	if (sourceMode === "image-to-video" || sourceMode === "ingredients-to-video") {
		return imageAnchoredChromaPrompt(prompt, keyColor);
	}
	return chromaAdaptPrompt(prompt, keyColor);
}

function blueScreenProbePrompt(): PromptFixture {
	const prompt =
		"Wide shot. A dark terracotta medallion logo drifts left to right across a flat blue field while small amber sparks trail behind it with independent motion.";
	return {
		chromaPrompt: chromaAdaptPrompt(prompt, "#2040ff"),
		expectedHardParts: "Non-green key color, detached particle motion, dark foreground on saturated blue.",
		id: "GP-01",
		passCriteria: "Compiler removes blue spill without crushing terracotta/amber foreground.",
		prompt,
		source: "docs/product/TRANSPARENT-ANIMATION-RD-SPIKE.md",
		tests: "key-agnostic spill repair, detached element color fidelity",
		title: "Blue-screen logo with amber sparks",
		useCase: "generalization_probe",
	};
}

function glowProbePrompt(): PromptFixture {
	const prompt =
		"Center frame. A soft white luminous orb breathes in and out while faint cream smoke wisps curl around it against a flat green field.";
	return {
		chromaPrompt: chromaAdaptPrompt(prompt),
		expectedHardParts: "Semi-transparent glow core, soft fringe, detached wisp motion.",
		id: "GP-02",
		passCriteria: "Soft alpha fringe stays stable without cyan ghosts or core color loss.",
		prompt,
		source: "docs/product/TRANSPARENT-ANIMATION-RD-SPIKE.md",
		tests: "soft alpha fringe, projection decontamination on glow edges",
		title: "Green-screen glow orb with smoke wisps",
		useCase: "generalization_probe",
	};
}

function flagshipPrompt(): PromptFixture {
	const prompt =
		"Wide horizontal shot. A warm editorial humanoid fox mascot crosses the canvas from left to right, pauses near the right third, turns back toward the viewer with a confident playful expression, then gestures as wind-blown terracotta leaves swirl coherently around the body and trail behind. The mascot's hair tufts, jacket hem, tail fur, and leaves all move with the same wind direction but independent secondary motion. Premium studio mascot animation style with clean silhouettes and restrained charm.";

	return {
		chromaPrompt: chromaAdaptPrompt(prompt),
		expectedHardParts:
			"Identity stability during traversal and turn-back, connected wind direction, independent hair/cloth/tail/leaves motion, no rigid sticker translation.",
		id: "MS-01",
		passCriteria:
			"Mascot crosses the canvas, turns back with readable personality, and leaves/particles move coherently with the character and wind.",
		prompt,
		source: "docs/product/TRANSPARENT-ANIMATION-RD-SPIKE.md",
		tests: "alpha usability, temporal stability, identity, internal motion, secondary-motion coupling, overall awe",
		title: "Flagship mascot traversal with coherent leaves",
		useCase: "mascot_traversal",
	};
}

async function selectedPromptSuite(): Promise<PromptFixture[]> {
	return [flagshipPrompt(), blueScreenProbePrompt(), glowProbePrompt()];
}

async function loadPromptSuite(root: string): Promise<PromptFixture[]> {
	const defaults = await selectedPromptSuite();
	const promptPath = path.join(root, "prompts.json");
	if (!existsSync(promptPath)) {
		return defaults;
	}
	const stored = await readJson<PromptFixture[]>(promptPath);
	const byId = new Map<string, PromptFixture>();
	for (const fixture of [...stored, ...defaults]) {
		byId.set(fixture.id, fixture);
	}
	return [...byId.values()];
}

function scoringTemplate(): Record<MetricKey, string> {
	return {
		alphaUsability: "1=breaks on arbitrary backgrounds; 5=usable on light/dark/video backgrounds",
		edgeSpillHalo: "1=heavy spill/halo; 5=clean edge with no visible key contamination",
		editorCompatibility: "1=does not import/play with alpha; 5=OBS/editor-ready",
		identityStability: "1=subject morphs or drifts; 5=same identity throughout",
		internalMotion: "1=rigid sticker motion only; 5=multiple authored components move independently",
		overallAwe: "1=commodity or unusable; 5=magical enough to justify next R&D cycle",
		promptCompliance: "1=misses critical prompt constraints; 5=strongly follows prompt",
		secondaryMotionCoupling: "1=secondary FX unrelated or missing; 5=hair/cloth/particles/smoke move with intent",
		temporalCoherence: "1=matte breathes/flickers; 5=stable edges across frames",
	};
}

async function writeReadme(root: string): Promise<void> {
	await writeFile(
		path.join(root, "README.md"),
		[
			"# Transparent Animation Spike Harness",
			"",
			"Throwaway local harness for `docs/product/TRANSPARENT-ANIMATION-RD-SPIKE.md`.",
			"It does not call production workers or video providers. The next flow is one Veo 3.1 mascot video generated from a verified reference frame on a flat chroma background, then local keying/refinement/scoring.",
			"",
			"## Typical flow",
			"",
			"```bash",
			"pnpm transparent-animation-spike init",
			"pnpm transparent-animation-spike list-prompts --verbose --source-mode image-to-video --key-color '#00ff00'",
			"pnpm transparent-animation-spike create-run --prompt-id MS-01 --source-mode image-to-video --key-color '#00ff00'",
			"pnpm transparent-animation-spike provider-generate-source --run-id <run-id> --process --estimated-provider-cost-usd 0.15",
			"pnpm transparent-animation-spike status --run-id <run-id>",
			"pnpm transparent-animation-spike score --run-id <run-id> --stage chroma-baseline --alpha-usability 2 --temporal-coherence 2 --edge-spill-halo 1 --identity-stability 4 --internal-motion 3 --secondary-motion-coupling 2 --prompt-compliance 4 --editor-compatibility 3 --overall-awe 2 --failure halo --failure matte_flicker --notes \"rough first pass\"",
			"pnpm transparent-animation-spike summary",
			"```",
			"",
			"`provider-generate-source` and `process-run` are resumable: they skip completed stages unless `--force` is passed, and rerun failed or incomplete stages.",
			"",
			"## Artifact contract",
			"",
			"Each run is stored under `runs/<run-id>/` with the artifact shape from the spike doc:",
			"`input.json`, `source.mp4`, `source-preview.png`, `events.ndjson`, `pipeline-state.json`, `provider-calls.json`, `logs/`, `chroma-baseline/`, `matting-baseline/`, `celstate-alpha-v0/`, `celstate-alpha-v1-despill/`, `celstate-alpha-v2-trimap/`, `celstate-alpha-v3-core-fringe/`, `celstate-alpha-v4-prior-fusion/`, and `scores.json`.",
			"",
			"`matting-baseline` is intentionally an ingestion point for off-the-shelf segmentation/matting tools:",
			"use `ingest-matting --run-id <run-id> --foreground <mov> --alpha <mp4> --tool <name>` after running that tool outside this repo.",
			"",
		].join("\n"),
		"utf8",
	);
}

async function initHarness(args: ParsedArgs): Promise<void> {
	const root = spikeRoot(args);
	await ensureDirectory(root);
	await ensureDirectory(runsRoot(root));

	const prompts = await selectedPromptSuite();
	await writeJson(path.join(root, "prompts.json"), prompts);
	await writeJson(path.join(root, "scoring-template.json"), scoringTemplate());
	await writeReadme(root);

	console.log(`initialized ${root}`);
	console.log(`selected prompts: ${prompts.length} (default: flagship Veo 3.1 chroma mascot run)`);
}

function promptKeyColor(args: ParsedArgs): string {
	return normalizeHexColor(getOption(args, "key-color") ?? DEFAULT_CHROMA_COLOR);
}

function sourceModeOption(args: ParsedArgs): SourceMode {
	const value = getOption(args, "source-mode") ?? "text-to-video";
	if ((SOURCE_MODES as readonly string[]).includes(value)) {
		return value as SourceMode;
	}
	throw new Error(`--source-mode must be one of: ${SOURCE_MODES.join(", ")}`);
}

function referenceRoleOption(args: ParsedArgs): ReferenceRole {
	const value = getOption(args, "reference-role") ?? "first-frame";
	if ((REFERENCE_ROLES as readonly string[]).includes(value)) {
		return value as ReferenceRole;
	}
	throw new Error(`--reference-role must be one of: ${REFERENCE_ROLES.join(", ")}`);
}

function withChromaPrompt(prompt: PromptFixture, keyColor: string, sourceMode: SourceMode): PromptFixture {
	return {
		...prompt,
		chromaPrompt: promptForSourceMode(prompt.prompt, keyColor, sourceMode),
	};
}

function ffmpegColor(value: string): string {
	return `0x${normalizeHexColor(value).slice(1)}`;
}

function chromaSettings(args: ParsedArgs): ChromaSettings {
	return {
		blend: getNumberOption(args, "blend", DEFAULT_CHROMA_BLEND),
		color: normalizeHexColor(getOption(args, "key-color") ?? DEFAULT_CHROMA_COLOR),
		similarity: getNumberOption(args, "similarity", DEFAULT_CHROMA_SIMILARITY),
	};
}

function parseSettings(args: ParsedArgs): Record<string, string> | undefined {
	const entries = getOptions(args, "setting");
	if (entries.length === 0) {
		return undefined;
	}

	const settings: Record<string, string> = {};
	for (const entry of entries) {
		const equalsIndex = entry.indexOf("=");
		if (equalsIndex < 1) {
			throw new Error(`--setting values must be key=value. Got: ${entry}`);
		}
		settings[entry.slice(0, equalsIndex)] = entry.slice(equalsIndex + 1);
	}
	return settings;
}

async function command(commandName: string, args: readonly string[]): Promise<CommandResult> {
	return runCommand(commandName, args, commandName);
}

async function runCommand(
	commandName: string,
	args: readonly string[],
	label: string,
	context?: RunContext,
): Promise<CommandResult> {
	const startedAt = new Date().toISOString();
	const startMs = Date.now();
	let stdout = "";
	let stderr = "";
	let errorMessage: string | undefined;
	let logPath: string | undefined;

	try {
		const result = await execFileAsync(commandName, args, {
			encoding: "utf8",
			maxBuffer: 1024 * 1024 * 64,
			windowsHide: true,
		});
		stdout = String(result.stdout);
		stderr = String(result.stderr);
	} catch (error) {
		stdout = commandOutput(error, "stdout");
		stderr = commandOutput(error, "stderr");
		errorMessage = commandErrorMessage(error);
	}

	if (context) {
		logPath = await writeCommandLog(context, label, {
			args,
			commandName,
			durationMs: Date.now() - startMs,
			error: errorMessage,
			ok: errorMessage === undefined,
			startedAt,
			stderr,
			stdout,
		});
	}

	if (errorMessage) {
		throw new Error(`${errorMessage}${logPath ? `\ncommand log: ${logPath}` : ""}`);
	}

	return { logPath, stderr, stdout };
}

function commandErrorMessage(error: unknown): string {
	if (error && typeof error === "object") {
		const record = error as { message?: unknown; stderr?: unknown; stdout?: unknown };
		const stderr = typeof record.stderr === "string" ? record.stderr.trim() : "";
		const stdout = typeof record.stdout === "string" ? record.stdout.trim() : "";
		const message = typeof record.message === "string" ? record.message : "command failed";
		return [
			message,
			stderr && !message.includes(stderr) ? stderr : undefined,
			stdout && !message.includes(stdout) ? stdout : undefined,
		].filter(Boolean).join("\n");
	}
	return String(error);
}

function commandOutput(error: unknown, key: "stderr" | "stdout"): string {
	if (error && typeof error === "object") {
		const value = (error as Record<string, unknown>)[key];
		return typeof value === "string" ? value : "";
	}
	return "";
}

async function writeCommandLog(
	context: RunContext,
	label: string,
	log: Record<string, unknown>,
): Promise<string> {
	const logsDirectory = path.join(context.directory, "logs");
	await ensureDirectory(logsDirectory);
	const filePath = path.join(logsDirectory, `${timestampLabel()}-${slugify(label)}.json`);
	await writeJson(filePath, log);
	return relativeToWorkspace(filePath);
}

async function runFfmpeg(args: readonly string[], label: string, context?: RunContext): Promise<string | undefined> {
	try {
		const result = await runCommand("ffmpeg", ["-hide_banner", ...args], label, context);
		return result.logPath;
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		throw new Error(`${label} failed:\n${message}`);
	}
}

async function ffprobeJson(filePath: string, context?: RunContext): Promise<unknown> {
	const result = await runCommand("ffprobe", [
		"-v",
		"error",
		"-print_format",
		"json",
		"-show_format",
		"-show_streams",
		filePath,
	], `ffprobe ${path.basename(filePath)}`, context);
	return JSON.parse(result.stdout) as unknown;
}

async function createSourcePreview(sourcePath: string, outputPath: string, context?: RunContext): Promise<void> {
	await runFfmpeg(["-y", "-i", sourcePath, "-frames:v", "1", outputPath], "source preview export", context);
}

async function normalizeReferenceImage(source: string, destinationPng: string, context?: RunContext): Promise<void> {
	await runFfmpeg(
		["-y", "-i", source, "-map", "0:v:0", "-frames:v", "1", "-update", "1", destinationPng],
		"reference image normalize",
		context,
	);
}

async function normalizeSource(source: string, destinationMp4: string, context?: RunContext): Promise<void> {
	try {
		await runFfmpeg(["-y", "-i", source, "-map", "0:v:0", "-an", "-c:v", "copy", destinationMp4], "source remux", context);
	} catch {
		await runFfmpeg(
			[
				"-y",
				"-i",
				source,
				"-map",
				"0:v:0",
				"-an",
				"-c:v",
				"libx264",
				"-crf",
				"16",
				"-pix_fmt",
				"yuv420p",
				destinationMp4,
			],
			"source transcode",
			context,
		);
	}
}

async function attachSourceToRun(
	context: RunContext,
	input: RunInput,
	source: string,
	force: boolean,
): Promise<RunInput> {
	const normalizedPath = path.join(context.directory, "source.mp4");
	const previewPath = path.join(context.directory, "source-preview.png");
	if (!force && existsSync(normalizedPath) && existsSync(previewPath) && input.source) {
		console.log(`source already attached for ${context.runId}; pass --force to replace it.`);
		return input;
	}

	const sourcePath = path.resolve(process.cwd(), source);
	const extension = path.extname(sourcePath) || ".mp4";
	const storedOriginalName = `source-original${extension.toLowerCase()}`;
	const storedOriginalPath = path.join(context.directory, storedOriginalName);
	await copyFile(sourcePath, storedOriginalPath);
	await normalizeSource(storedOriginalPath, normalizedPath, context);
	await createSourcePreview(normalizedPath, previewPath, context);

	const updatedInput: RunInput = {
		...input,
		source: {
			originalPath: sourcePath,
			normalized: "source.mp4",
			storedOriginal: storedOriginalName,
		},
	};
	await writeJson(path.join(context.directory, "input.json"), updatedInput);
	return updatedInput;
}

async function attachReferenceToRun(
	context: RunContext,
	input: RunInput,
	reference: string,
	role: ReferenceRole,
	force: boolean,
): Promise<RunInput> {
	const normalizedPath = path.join(context.directory, "reference.png");
	if (!force && existsSync(normalizedPath) && input.reference) {
		console.log(`reference image already attached for ${context.runId}; pass --force to replace it.`);
		return input;
	}

	const referencePath = path.resolve(process.cwd(), reference);
	const extension = path.extname(referencePath) || ".png";
	const storedOriginalName = `reference-original${extension.toLowerCase()}`;
	const storedOriginalPath = path.join(context.directory, storedOriginalName);
	await copyFile(referencePath, storedOriginalPath);
	await normalizeReferenceImage(storedOriginalPath, normalizedPath, context);
	await ffprobeJson(normalizedPath, context);

	const updatedInput: RunInput = {
		...input,
		reference: {
			normalized: "reference.png",
			originalPath: referencePath,
			role,
			storedOriginal: storedOriginalName,
		},
	};
	await writeJson(path.join(context.directory, "input.json"), updatedInput);
	return updatedInput;
}

async function attachLastFrameToRun(
	context: RunContext,
	input: RunInput,
	lastFrame: string,
	force: boolean,
): Promise<RunInput> {
	const normalizedPath = path.join(context.directory, "last-frame.png");
	if (!force && existsSync(normalizedPath) && input.lastFrame) {
		console.log(`last frame already attached for ${context.runId}; pass --force to replace it.`);
		return input;
	}

	const lastFramePath = path.resolve(process.cwd(), lastFrame);
	const extension = path.extname(lastFramePath) || ".png";
	const storedOriginalName = `last-frame-original${extension.toLowerCase()}`;
	const storedOriginalPath = path.join(context.directory, storedOriginalName);
	await copyFile(lastFramePath, storedOriginalPath);
	await normalizeReferenceImage(storedOriginalPath, normalizedPath, context);
	await ffprobeJson(normalizedPath, context);

	const updatedInput: RunInput = {
		...input,
		lastFrame: {
			normalized: "last-frame.png",
			originalPath: lastFramePath,
			storedOriginal: storedOriginalName,
		},
	};
	await writeJson(path.join(context.directory, "input.json"), updatedInput);
	return updatedInput;
}

function providerDirectory(context: RunContext): string {
	return path.join(context.directory, "provider");
}

function providerPromptDirectory(context: RunContext): string {
	return path.join(providerDirectory(context), "prompts");
}

async function ensureProviderDirectories(context: RunContext): Promise<void> {
	await ensureDirectory(providerDirectory(context));
	await ensureDirectory(providerPromptDirectory(context));
}

function providerGenerationOptions(args: ParsedArgs): ProviderGenerationOptions {
	const durationSeconds = getNumberOption(args, "duration-seconds", DEFAULT_PROVIDER_DURATION_SECONDS);
	const pollIntervalMs = getNumberOption(args, "poll-interval-ms", DEFAULT_PROVIDER_POLL_INTERVAL_MS);
	const maxWaitMs = getNumberOption(args, "max-wait-ms", DEFAULT_PROVIDER_MAX_WAIT_MS);
	if (durationSeconds <= 0) {
		throw new Error(`--duration-seconds must be greater than zero. Got: ${durationSeconds}`);
	}
	if (pollIntervalMs < 1_000) {
		throw new Error(`--poll-interval-ms must be at least 1000. Got: ${pollIntervalMs}`);
	}
	if (maxWaitMs < pollIntervalMs) {
		throw new Error(`--max-wait-ms must be at least --poll-interval-ms. Got: ${maxWaitMs}`);
	}

	return {
		aspectRatio: getOption(args, "aspect-ratio") ?? DEFAULT_PROVIDER_ASPECT_RATIO,
		durationSeconds,
		force: forceRequested(args),
		imageSize: getOption(args, "image-size") ?? DEFAULT_PROVIDER_IMAGE_SIZE,
		maxWaitMs,
		pollIntervalMs,
		seed: getOptionalNumberOption(args, "seed"),
		videoModel: getOption(args, "video-model") ?? getOption(args, "model") ?? DEFAULT_PROVIDER_VIDEO_MODEL,
		videoResolution: getOption(args, "resolution") ?? DEFAULT_PROVIDER_VIDEO_RESOLUTION,
		estimatedProviderCostUsd: getOptionalNumberOption(args, "estimated-provider-cost-usd"),
	};
}

function createSpikeGeminiClient(): GoogleGenAI {
	const apiKey = process.env.GEMINI_API_KEY;
	if (apiKey) {
		return new GoogleGenAI({ apiKey });
	}
	return createGeminiClient(readGeminiRuntimeConfigFromEnv());
}

function firstFramePrompt(input: RunInput, options: ProviderGenerationOptions): string {
	const color = chromaKeyDescription(input.chroma.color);
	return [
		"Create one opaque RGB still image that will be used as the first frame of a video generation.",
		`Canvas: ${options.aspectRatio} horizontal composition, full-body mascot fully inside frame with generous empty key-color space around the subject.`,
		`Scene contract: ${input.prompt.prompt}`,
		"First-frame pose: the mascot is entering from the left third, mid-step toward screen right, readable silhouette, confident warm expression, leaves/particles just beginning to lift in the same wind direction.",
		`Background contract: every non-foreground pixel must be one perfectly flat, evenly lit ${color} color plate. The plate has no texture, floor, horizon, shadow, gradient, vignette, reflections, border, text, logo, or watermark.`,
		`Color exclusion rule: ${color} is reserved only for the background plate. Do not use it on the mascot, costume, fur, eyes, edges, motion blur, leaves, particles, glow, smoke, reflections, shadows, or any foreground detail.`,
		"Style: premium editorial mascot animation key art, clean silhouette, authored pose, no cheap sticker look.",
	].join("\n");
}

function lastFramePrompt(input: RunInput, options: ProviderGenerationOptions): string {
	const color = chromaKeyDescription(input.chroma.color);
	return [
		"Use the attached first-frame still as the exact character identity, costume, proportions, palette, line quality, and background contract.",
		"Create one opaque RGB still image that will be used as the final frame of the same video.",
		`Canvas: ${options.aspectRatio}. Keep the same camera, scale, lighting, and solid key-color plate.`,
		`End-frame action after ${options.durationSeconds} seconds: the same mascot has crossed to the right third, turns back toward the viewer with personality, and gestures while wind-blown leaves/particles trail coherently behind in the same wind direction.`,
		`Background contract: every non-foreground pixel remains the same perfectly flat, evenly lit ${color} color plate. No floor, horizon, contact shadow, studio gradient, vignette, reflection, border, text, logo, or watermark.`,
		`Color exclusion rule: ${color} is reserved only for the background plate. Do not use it on the mascot, costume, fur, eyes, edges, motion blur, leaves, particles, glow, smoke, reflections, shadows, or any foreground detail.`,
	].join("\n");
}

function videoPrompt(input: RunInput, options: ProviderGenerationOptions): string {
	const color = chromaKeyDescription(input.chroma.color);
	return [
		"Generate a single cohesive video from the supplied first and final frames.",
		`Duration: ${options.durationSeconds} seconds. Aspect ratio: ${options.aspectRatio}.`,
		"Honor the first frame as the exact opening frame and the supplied final frame as the exact ending target. Preserve character identity, costume, proportions, silhouette, and editorial style across the whole clip.",
		input.prompt.prompt,
		`The background must remain a static, perfectly flat ${color} color plate for every frame. Do not introduce a floor, horizon, camera move, gradient, vignette, shadow, reflection, texture, text, logo, watermark, or border.`,
		`The ${color} color is reserved only for the background plate. Do not use it on foreground details or motion blur.`,
		"Animate only the foreground mascot plus wind-blown leaves/particles. Hair tufts, jacket hem, tail fur, and leaves should move independently while sharing one coherent wind direction. Avoid rigid sticker translation and avoid identity morphing.",
	].join("\n");
}

function videoNegativePrompt(input: RunInput): string {
	const color = chromaKeyDescription(input.chroma.color);
	return [
		"text",
		"logo",
		"watermark",
		"border",
		"floor",
		"horizon",
		"shadow on background",
		"gradient background",
		"textured background",
		"camera shake",
		`${color} on foreground subject`,
	].join(", ");
}

function extensionForMimeType(mimeType: string): string {
	if (mimeType === "image/jpeg") {
		return ".jpg";
	}
	if (mimeType === "image/webp") {
		return ".webp";
	}
	if (mimeType === "image/heic") {
		return ".heic";
	}
	if (mimeType === "image/heif") {
		return ".heif";
	}
	return ".png";
}

function mimeTypeForImagePath(filePath: string): GeminiImageResult["mimeType"] {
	const extension = path.extname(filePath).toLowerCase();
	if (extension === ".jpg" || extension === ".jpeg") {
		return "image/jpeg";
	}
	if (extension === ".webp") {
		return "image/webp";
	}
	if (extension === ".heic") {
		return "image/heic";
	}
	if (extension === ".heif") {
		return "image/heif";
	}
	return "image/png";
}

async function saveGeminiImageResult(result: GeminiImageResult, outputPath: string): Promise<void> {
	await writeFile(outputPath, Buffer.from(result.imageBase64, "base64"));
}

async function geminiImageFromFile(filePath: string): Promise<GeminiImageResult> {
	return {
		imageBase64: (await readFile(filePath)).toString("base64"),
		mimeType: mimeTypeForImagePath(filePath),
	};
}

async function videoImageFromFile(filePath: string): Promise<Image> {
	const image = await geminiImageFromFile(filePath);
	return {
		imageBytes: image.imageBase64,
		mimeType: image.mimeType,
	};
}

function outputFilesComplete(context: RunContext, outputs: readonly string[]): boolean {
	return outputs.every((output) => existsSync(path.join(context.directory, output)));
}

async function skipCompletedRunStep(
	context: RunContext,
	step: string,
	outputs: readonly string[],
	force: boolean,
): Promise<boolean> {
	if (force || !outputFilesComplete(context, outputs)) {
		return false;
	}

	const current = await readPipelineState(context);
	if (!current.steps[step]) {
		const startedAt = new Date().toISOString();
		await markStepSucceeded(context, step, startedAt, { outputs, skippedBecauseComplete: true });
	} else {
		await appendRunEvent(context, {
			data: { outputs },
			event: "step_skipped_complete",
			level: "info",
			message: `${step} already complete`,
			stage: step,
		});
	}
	console.log(`${step} already complete for ${context.runId}; pass --force to rerun.`);
	return true;
}

async function generateProviderFirstFrame(
	context: RunContext,
	input: RunInput,
	options: ProviderGenerationOptions,
): Promise<RunInput> {
	const outputs = ["provider/prompts/first-frame.txt", "reference.png"] as const;
	if (await skipCompletedRunStep(context, "provider-first-frame", outputs, options.force)) {
		return readJson<RunInput>(path.join(context.directory, "input.json"));
	}

	let updatedInput = input;
	await runDurableStep(context, "provider-first-frame", async () => {
		await ensureProviderDirectories(context);
		const prompt = firstFramePrompt(input, options);
		const promptPath = path.join(providerPromptDirectory(context), "first-frame.txt");
		await writeFile(promptPath, `${prompt}\n`, "utf8");

		const spikeClient = createSpikeGeminiClient();
		const session = createChatSession(
			process.env.GEMINI_API_KEY ? { location: "global", project: "" } : readGeminiRuntimeConfigFromEnv(),
			{ aspectRatio: options.aspectRatio, imageSize: options.imageSize },
			spikeClient,
		);
		const result = await runProviderCall(
			context,
			"provider-first-frame",
			DEFAULT_PROVIDER_IMAGE_MODEL,
			{ estimatedProviderCostUsd: options.estimatedProviderCostUsd },
			() => session.sendMessage(prompt),
		);
		const generatedName = `first-frame-generated${extensionForMimeType(result.mimeType)}`;
		const generatedPath = path.join(providerDirectory(context), generatedName);
		await saveGeminiImageResult(result, generatedPath);
		updatedInput = await attachReferenceToRun(context, input, generatedPath, "first-frame", true);

		return {
			metadata: {
				aspectRatio: options.aspectRatio,
				imageModel: DEFAULT_PROVIDER_IMAGE_MODEL,
				imageSize: options.imageSize,
				mimeType: result.mimeType,
			},
			outputs: ["provider/prompts/first-frame.txt", `provider/${generatedName}`, "reference.png", "input.json"],
		};
	});
	return updatedInput;
}

async function generateProviderLastFrame(
	context: RunContext,
	input: RunInput,
	options: ProviderGenerationOptions,
): Promise<RunInput> {
	const outputs = ["provider/prompts/last-frame.txt", "last-frame.png"] as const;
	if (await skipCompletedRunStep(context, "provider-last-frame", outputs, options.force)) {
		return readJson<RunInput>(path.join(context.directory, "input.json"));
	}

	const firstFramePath = path.join(context.directory, "reference.png");
	if (!existsSync(firstFramePath)) {
		throw new Error("Missing reference.png. Generate or attach the first frame before generating the last frame.");
	}

	let updatedInput = input;
	await runDurableStep(context, "provider-last-frame", async () => {
		await ensureProviderDirectories(context);
		const prompt = lastFramePrompt(input, options);
		const promptPath = path.join(providerPromptDirectory(context), "last-frame.txt");
		await writeFile(promptPath, `${prompt}\n`, "utf8");

		const spikeClient = createSpikeGeminiClient();
		const session = createChatSession(
			process.env.GEMINI_API_KEY ? { location: "global", project: "" } : readGeminiRuntimeConfigFromEnv(),
			{ aspectRatio: options.aspectRatio, imageSize: options.imageSize },
			spikeClient,
		);
		const firstFrame = await geminiImageFromFile(firstFramePath);
		const result = await runProviderCall(
			context,
			"provider-last-frame",
			DEFAULT_PROVIDER_IMAGE_MODEL,
			{ estimatedProviderCostUsd: options.estimatedProviderCostUsd },
			() => session.sendMessageWithImages(prompt, [firstFrame]),
		);
		const generatedName = `last-frame-generated${extensionForMimeType(result.mimeType)}`;
		const generatedPath = path.join(providerDirectory(context), generatedName);
		await saveGeminiImageResult(result, generatedPath);
		updatedInput = await attachLastFrameToRun(context, input, generatedPath, true);

		return {
			metadata: {
				aspectRatio: options.aspectRatio,
				imageModel: DEFAULT_PROVIDER_IMAGE_MODEL,
				imageSize: options.imageSize,
				mimeType: result.mimeType,
			},
			outputs: ["provider/prompts/last-frame.txt", `provider/${generatedName}`, "last-frame.png", "input.json"],
		};
	});
	return updatedInput;
}

async function submitOrReadProviderVideoOperation(
	context: RunContext,
	input: RunInput,
	options: ProviderGenerationOptions,
): Promise<VideoOperationRecord> {
	const operationPath = path.join(providerDirectory(context), "video-operation.json");
	const outputs = ["provider/prompts/video.txt", "provider/video-operation.json"] as const;
	if (await skipCompletedRunStep(context, "provider-video-request", outputs, options.force)) {
		return readJson<VideoOperationRecord>(operationPath);
	}

	const firstFramePath = path.join(context.directory, "reference.png");
	const lastFramePath = path.join(context.directory, "last-frame.png");
	if (!existsSync(firstFramePath) || !existsSync(lastFramePath)) {
		throw new Error("Missing first or last frame. Generate provider frames before requesting video.");
	}

	let record: VideoOperationRecord | undefined;
	await runDurableStep(context, "provider-video-request", async () => {
		await ensureProviderDirectories(context);
		const prompt = videoPrompt(input, options);
		const promptPath = path.join(providerPromptDirectory(context), "video.txt");
		await writeFile(promptPath, `${prompt}\n`, "utf8");

		const firstFrame = await videoImageFromFile(firstFramePath);
		const lastFrame = await videoImageFromFile(lastFramePath);
		const requestMetadata = {
			config: {
				aspectRatio: options.aspectRatio,
				durationSeconds: options.durationSeconds,
				generateAudio: false,
				numberOfVideos: 1,
				resolution: options.videoResolution,
				seed: options.seed,
			},
			firstFrame: "reference.png",
			lastFrame: "last-frame.png",
			model: options.videoModel,
			negativePrompt: videoNegativePrompt(input),
			promptPath: "provider/prompts/video.txt",
		};
		await writeJson(path.join(providerDirectory(context), "video-request.json"), requestMetadata);

		const client = createSpikeGeminiClient();
		const operation = await runProviderCall(
			context,
			"provider-video-request",
			options.videoModel,
			{ estimatedProviderCostUsd: options.estimatedProviderCostUsd },
			() =>
				client.models.generateVideos({
					config: {
						aspectRatio: options.aspectRatio,
						durationSeconds: options.durationSeconds,
						lastFrame,
						negativePrompt: videoNegativePrompt(input),
						numberOfVideos: 1,
						resolution: options.videoResolution,
						seed: options.seed,
					},
					model: options.videoModel,
					source: {
						image: firstFrame,
						prompt,
					},
				}),
		);

		if (!operation.name) {
			throw new Error("Veo returned an operation without a name; cannot resume polling.");
		}

		record = {
			config: {
				aspectRatio: options.aspectRatio,
				durationSeconds: options.durationSeconds,
				resolution: options.videoResolution,
				seed: options.seed,
			},
			firstFrame: "reference.png",
			lastFrame: "last-frame.png",
			model: options.videoModel,
			operationName: operation.name,
			promptPath: "provider/prompts/video.txt",
			submittedAt: new Date().toISOString(),
		};
		await writeJson(operationPath, record);
		await writeJson(path.join(providerDirectory(context), "video-operation-submitted.json"), operation);

		return {
			metadata: { model: options.videoModel, operationName: operation.name },
			outputs: [
				"provider/prompts/video.txt",
				"provider/video-request.json",
				"provider/video-operation.json",
				"provider/video-operation-submitted.json",
			],
		};
	});

	if (!record) {
		throw new Error("Provider video request did not produce an operation record.");
	}
	return record;
}

function sleep(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

function operationForName(operationName: string): GenerateVideosOperation {
	const op = new GenerateVideosOperation();
	op.name = operationName;
	return op;
}

async function downloadGeneratedVideo(client: ReturnType<typeof createGeminiClient>, video: Video, outputPath: string): Promise<void> {
	if (video.videoBytes) {
		await writeFile(outputPath, Buffer.from(video.videoBytes, "base64"));
		return;
	}
	if (video.uri) {
		await client.files.download({ downloadPath: outputPath, file: video });
		return;
	}
	throw new Error("Veo generated a video response without video bytes or a downloadable URI.");
}

async function pollAndDownloadProviderVideo(
	context: RunContext,
	record: VideoOperationRecord,
	options: ProviderGenerationOptions,
): Promise<string> {
	const providerSourcePath = path.join(providerDirectory(context), "source-provider.mp4");
	const outputs = ["provider/source-provider.mp4", "provider/video-operation-final.json"] as const;
	if (await skipCompletedRunStep(context, "provider-video-download", outputs, options.force)) {
		return providerSourcePath;
	}

	await runDurableStep(context, "provider-video-download", async () => {
		await ensureProviderDirectories(context);
		const client = createSpikeGeminiClient();
		let operation = operationForName(record.operationName);
		const startedMs = Date.now();
		let pollCount = 0;

		for (;;) {
			operation = (await client.operations.get({
			operation,
		})) as GenerateVideosOperation;
			pollCount += 1;
			await writeJson(path.join(providerDirectory(context), "video-operation-latest.json"), operation);
			await appendRunEvent(context, {
				data: {
					done: operation.done ?? false,
					operationName: record.operationName,
					pollCount,
				},
				event: "provider_video_poll",
				level: "info",
				message: operation.done ? "provider video operation completed" : "provider video operation still running",
				stage: "provider-video-download",
			});

			if (operation.done) {
				break;
			}
			if (Date.now() - startedMs > options.maxWaitMs) {
				throw new Error(
					`Timed out waiting for Veo operation ${record.operationName} after ${options.maxWaitMs}ms. Rerun the same command to resume polling.`,
				);
			}
			await sleep(options.pollIntervalMs);
		}

		await writeJson(path.join(providerDirectory(context), "video-operation-final.json"), operation);
		if (operation.error) {
			throw new Error(`Veo operation failed: ${JSON.stringify(operation.error)}`);
		}
		const generatedVideo = operation.response?.generatedVideos?.[0]?.video;
		if (!generatedVideo) {
			throw new Error("Veo operation completed without a generated video.");
		}
		await downloadGeneratedVideo(client, generatedVideo, providerSourcePath);

		return {
			metadata: {
				model: record.model,
				operationName: record.operationName,
				pollCount,
			},
			outputs: ["provider/source-provider.mp4", "provider/video-operation-final.json", "provider/video-operation-latest.json"],
		};
	});
	return providerSourcePath;
}

async function writeProviderGenerationMetadata(
	context: RunContext,
	input: RunInput,
	options: ProviderGenerationOptions,
): Promise<RunInput> {
	const updatedInput: RunInput = {
		...input,
		generation: {
			...input.generation,
			model: options.videoModel,
			provider: input.generation.provider ?? "google",
			seed: options.seed === undefined ? input.generation.seed : String(options.seed),
			settings: {
				...input.generation.settings,
				providerAspectRatio: options.aspectRatio,
				providerDurationSeconds: String(options.durationSeconds),
				providerImageModel: DEFAULT_PROVIDER_IMAGE_MODEL,
				providerImageSize: options.imageSize,
				providerVideoResolution: options.videoResolution,
			},
		},
		sourceMode: input.sourceMode ?? "image-to-video",
	};
	await writeJson(path.join(context.directory, "input.json"), updatedInput);
	return updatedInput;
}

async function providerGenerateSource(args: ParsedArgs): Promise<void> {
	const root = spikeRoot(args);
	const runId = getRequiredOption(args, "run-id");
	const { directory, input } = await requireRunInput(root, runId);
	const context: RunContext = { directory, runId };
	const options = providerGenerationOptions(args);
	if (!options.force && existsSync(path.join(directory, "source.mp4")) && input.source) {
		console.log(`source already exists for ${runId}; pass --force to regenerate provider frames and source video.`);
		if (getOption(args, "process") === "true") {
			await processRun(args);
		}
		return;
	}

	let runInput = await writeProviderGenerationMetadata(context, input, options);
	runInput = await generateProviderFirstFrame(context, runInput, options);
	runInput = await generateProviderLastFrame(context, runInput, options);
	const operationRecord = await submitOrReadProviderVideoOperation(context, runInput, options);
	const providerSource = await pollAndDownloadProviderVideo(context, operationRecord, options);
	runInput = await readJson<RunInput>(path.join(directory, "input.json"));
	await runDurableStep(context, "source-ingest", async () => {
		const attachedInput = await attachSourceToRun(context, runInput, providerSource, true);
		await writeProviderGenerationMetadata(context, attachedInput, options);
		return { outputs: ["input.json", "source.mp4", "source-preview.png"] };
	});

	console.log(`generated provider source for ${runId}`);
	console.log(`source: ${relativeToWorkspace(path.join(directory, "source.mp4"))}`);
	console.log(`provider artifacts: ${relativeToWorkspace(providerDirectory(context))}`);
	if (getOption(args, "process") === "true") {
		await processRun(args);
	}
}

async function createRun(args: ParsedArgs): Promise<void> {
	const root = spikeRoot(args);
	await ensureDirectory(root);
	await ensureDirectory(runsRoot(root));

	const prompts = await loadPromptSuite(root);
	const promptId = getRequiredOption(args, "prompt-id").toUpperCase();
	const promptFixture = prompts.find((fixture) => fixture.id === promptId);
	if (!promptFixture) {
		throw new Error(`Unknown prompt id ${promptId}. Run list-prompts to inspect the selected suite.`);
	}
	const chroma = chromaSettings(args);
	const sourceMode = sourceModeOption(args);
	const prompt = withChromaPrompt(promptFixture, chroma.color, sourceMode);

	const runId = getOption(args, "run-id") ?? `${timestampLabel()}-${prompt.id.toLowerCase()}-${slugify(prompt.title)}`;
	const directory = runDirectory(root, runId);
	if (existsSync(directory)) {
		throw new Error(`Run already exists: ${directory}`);
	}
	await ensureDirectory(directory);
	for (const stage of STAGES) {
		await ensureDirectory(path.join(directory, stage));
	}
	await ensureDirectory(path.join(directory, "logs"));

	const reference = getOption(args, "reference");
	const source = getOption(args, "source");
	const input: RunInput = {
		chroma,
		createdAt: new Date().toISOString(),
		generation: {
			costUsd: getOptionalNumberOption(args, "cost-usd"),
			latencySeconds: getOptionalNumberOption(args, "latency-seconds"),
			model: getOption(args, "model"),
			provider: getOption(args, "provider"),
			seed: getOption(args, "seed"),
			settings: parseSettings(args),
		},
		prompt,
		runId,
		sourceMode,
	};

	const context: RunContext = { directory, runId };
	await writeJson(path.join(directory, "input.json"), input);
	const startedAt = await markStepStarted(context, "create-run");
	await markStepSucceeded(context, "create-run", startedAt, { outputs: ["input.json"] });
	let runInput = input;

	if (reference) {
		await runDurableStep(context, "reference-ingest", async () => {
			runInput = await attachReferenceToRun(context, runInput, reference, referenceRoleOption(args), true);
			return { outputs: ["input.json", "reference.png"] };
		});
	}

	if (source) {
		await runDurableStep(context, "source-ingest", async () => {
			runInput = await attachSourceToRun(context, runInput, source, true);
			return { outputs: ["input.json", "source.mp4", "source-preview.png"] };
		});
	}

	console.log(`created run ${runId}`);
	console.log(directory);
	if ((sourceMode === "image-to-video" || sourceMode === "ingredients-to-video") && !reference) {
		console.log("no reference image supplied yet; run attach-reference --run-id <run-id> --reference <image> before generating the Veo source.");
	}
	if (!source) {
		console.log("no source video supplied yet; run attach-source --run-id <run-id> --source <video> before baselines.");
	}
}

async function attachSource(args: ParsedArgs): Promise<void> {
	const root = spikeRoot(args);
	const runId = getRequiredOption(args, "run-id");
	const source = getRequiredOption(args, "source");
	const { directory, input } = await requireRunInput(root, runId);
	const context: RunContext = { directory, runId };
	await runDurableStep(context, "source-ingest", async () => {
		await attachSourceToRun(context, input, source, forceRequested(args));
		return { outputs: ["input.json", "source.mp4", "source-preview.png"] };
	});
	console.log(`attached source for ${runId}`);
}

async function attachReference(args: ParsedArgs): Promise<void> {
	const root = spikeRoot(args);
	const runId = getRequiredOption(args, "run-id");
	const reference = getRequiredOption(args, "reference");
	const { directory, input } = await requireRunInput(root, runId);
	const context: RunContext = { directory, runId };
	await runDurableStep(context, "reference-ingest", async () => {
		await attachReferenceToRun(context, input, reference, referenceRoleOption(args), forceRequested(args));
		return { outputs: ["input.json", "reference.png"] };
	});
	console.log(`attached reference image for ${runId}`);
}

async function requireRunInput(root: string, runId: string): Promise<{ directory: string; input: RunInput }> {
	const directory = runDirectory(root, runId);
	if (!existsSync(directory)) {
		throw new Error(`Run does not exist: ${directory}`);
	}
	return { directory, input: await readJson<RunInput>(path.join(directory, "input.json")) };
}

function requireStage(value: string): Stage {
	if ((STAGES as readonly string[]).includes(value)) {
		return value as Stage;
	}
	throw new Error(`--stage must be one of: ${STAGES.join(", ")}`);
}

async function requireSourceMp4(directory: string): Promise<string> {
	const source = path.join(directory, "source.mp4");
	if (!existsSync(source)) {
		throw new Error(`Missing ${source}. Create the run with --source or copy a normalized source.mp4 into the run.`);
	}
	return source;
}

function forceRequested(args: ParsedArgs): boolean {
	return getOption(args, "force") === "true";
}

function stageComplete(directory: string, stage: Stage, outputs: readonly string[]): boolean {
	return outputs.every((output) => existsSync(path.join(directory, stage, output)));
}

async function skipCompletedStage(
	context: RunContext,
	stage: Stage,
	outputs: readonly string[],
	force: boolean,
): Promise<boolean> {
	if (force || !stageComplete(context.directory, stage, outputs)) {
		return false;
	}

	const current = await readPipelineState(context);
	if (!current.steps[stage]) {
		const startedAt = new Date().toISOString();
		await markStepSucceeded(context, stage, startedAt, {
			outputs: outputs.map((output) => `${stage}/${output}`),
			skippedBecauseComplete: true,
		});
	} else {
		await appendRunEvent(context, {
			data: { outputs: outputs.map((output) => `${stage}/${output}`) },
			event: "step_skipped_complete",
			level: "info",
			message: `${stage} already complete`,
			stage,
		});
	}
	console.log(`${stage} already complete for ${context.runId}; pass --force to rerun.`);
	return true;
}

async function runDurableStep(
	context: RunContext,
	step: string,
	operation: () => Promise<{ commandLog?: string; metadata?: Record<string, unknown>; outputs?: readonly string[] } | void>,
): Promise<void> {
	const startedAt = await markStepStarted(context, step);
	try {
		const result = await operation();
		await markStepSucceeded(context, step, startedAt, result ?? {});
	} catch (error) {
		await markStepFailed(context, step, startedAt, error);
		throw error;
	}
}

function keyFilter(settings: ChromaSettings): string {
	return `format=rgba,colorkey=${ffmpegColor(settings.color)}:${settings.similarity}:${settings.blend}`;
}

function celstateAlphaGraph(settings: ChromaSettings): string {
	const keyed = keyFilter(settings);
	return `[0:v]${keyed},split[keyed][rgb];[keyed]alphaextract,tmix=frames=3:weights='1 2 1',format=gray[alpha];[rgb][alpha]alphamerge,format=yuva444p10le[out]`;
}

function despillParams(color: string, mix: number): string {
	const normalized = normalizeHexColor(color).toUpperCase();
	// FFmpeg 8.x despill AVOptions: type, mix, expand, red, green, blue, brightness, alpha
	// Defaults: type=green, mix=0.5, green=-1, red=0, blue=0
	if (normalized === "#00FF00") {
		return `despill=type=green:mix=${mix}`;
	}
	if (normalized === "#0000FF") {
		return `despill=type=blue:blue=-1:green=0:mix=${mix}`;
	}
	const r = parseInt(normalized.slice(1, 3), 16);
	const g = parseInt(normalized.slice(3, 5), 16);
	const b = parseInt(normalized.slice(5, 7), 16);
	const maxChannel = Math.max(r, g, b);
	if (maxChannel === g && g > 100) {
		return `despill=type=green:mix=${mix}`;
	}
	if (maxChannel === b && b > 100) {
		return `despill=type=blue:blue=-1:green=0:mix=${mix}`;
	}
	if (maxChannel === r && r > 100) {
		return `despill=type=green:red=-1:green=0:mix=${mix}`;
	}
	return `despill=type=green:mix=${mix}`;
}

function celstateAlphaV1DespillGraph(settings: ChromaSettings, despillMix: number): string {
	const keyed = keyFilter(settings);
	const despill = despillParams(settings.color, despillMix);
	// Key first to create alpha, then despill the keyed RGB. Despill preserves
	// alpha by default (alpha=false), so the keyed background stays transparent.
	// Alpha is extracted from the keyed stream, temporally smoothed, then merged
	// with the despilled RGB for the final output.
	return `[0:v]${keyed},split[keyed][rgb];[keyed]alphaextract,tmix=frames=3:weights='1 2 1',format=gray[alpha];[rgb]${despill}[despilled];[despilled][alpha]alphamerge,format=yuva444p10le[out]`;
}

async function writeStageReport(
	directory: string,
	stage: Stage,
	report: Record<string, unknown>,
): Promise<void> {
	await writeJson(path.join(directory, stage, "report.json"), {
		createdAt: new Date().toISOString(),
		stage,
		...report,
	});
}

async function runChromaBaseline(args: ParsedArgs): Promise<void> {
	const root = spikeRoot(args);
	const runId = getRequiredOption(args, "run-id");
	const { directory, input } = await requireRunInput(root, runId);
	const context: RunContext = { directory, runId };
	const stage: Stage = "chroma-baseline";
	const requiredOutputs = ["alpha.mp4", "foreground.mov", "report.json"] as const;
	if (await skipCompletedStage(context, stage, requiredOutputs, forceRequested(args))) {
		return;
	}

	const stageDirectory = path.join(directory, stage);
	await ensureDirectory(stageDirectory);

	await runDurableStep(context, stage, async () => {
		const source = await requireSourceMp4(directory);
		const settings = chromaSettingsFromInputAndArgs(input, args);
		const filter = keyFilter(settings);
		const foreground = path.join(stageDirectory, "foreground.mov");
		const alpha = path.join(stageDirectory, "alpha.mp4");
		const commandLogs: string[] = [];

		commandLogs.push(...compact([
			await runFfmpeg(
				[
					"-y",
					"-i",
					source,
					"-vf",
					`${filter},format=yuva444p10le`,
					"-c:v",
					"prores_ks",
					"-profile:v",
					"4",
					"-pix_fmt",
					"yuva444p10le",
					"-vendor",
					"apl0",
					"-an",
					foreground,
				],
				"chroma foreground export",
				context,
			),
			await runFfmpeg(
				[
					"-y",
					"-i",
					source,
					"-vf",
					`${filter},alphaextract,format=yuv420p`,
					"-c:v",
					"libx264",
					"-crf",
					"16",
					"-pix_fmt",
					"yuv420p",
					"-an",
					alpha,
				],
				"chroma alpha export",
				context,
			),
		]));

		await writeStageReport(directory, stage, {
			commandLogs,
			outputs: {
				alpha: "alpha.mp4",
				foreground: "foreground.mov",
			},
			settings,
			sourceProbe: await ffprobeJson(source, context),
		});

		return { commandLog: commandLogs[commandLogs.length - 1], outputs: requiredOutputs.map((output) => `${stage}/${output}`) };
	});

	console.log(`wrote chroma baseline for ${runId}`);
}

function chromaSettingsFromInputAndArgs(input: RunInput, args: ParsedArgs): ChromaSettings {
	const hasOverride = getOption(args, "key-color") || getOption(args, "similarity") || getOption(args, "blend");
	return hasOverride ? chromaSettings(args) : input.chroma;
}

async function runCelstateAlphaV0(args: ParsedArgs): Promise<void> {
	const root = spikeRoot(args);
	const runId = getRequiredOption(args, "run-id");
	const { directory, input } = await requireRunInput(root, runId);
	const context: RunContext = { directory, runId };
	const stage: Stage = "celstate-alpha-v0";
	const requiredOutputs = ["alpha.mp4", "foreground.mov", "webm.webm", "prores.mov", "apng.png", "report.json"] as const;
	if (await skipCompletedStage(context, stage, requiredOutputs, forceRequested(args))) {
		return;
	}

	const stageDirectory = path.join(directory, stage);
	await ensureDirectory(stageDirectory);

	await runDurableStep(context, stage, async () => {
		const source = await requireSourceMp4(directory);
		const settings = chromaSettingsFromInputAndArgs(input, args);
		const graph = celstateAlphaGraph(settings);
		const foreground = path.join(stageDirectory, "foreground.mov");
		const prores = path.join(stageDirectory, "prores.mov");
		const webm = path.join(stageDirectory, "webm.webm");
		const apng = path.join(stageDirectory, "apng.png");
		const alpha = path.join(stageDirectory, "alpha.mp4");
		const commandLogs: string[] = [];

		commandLogs.push(...compact([
			await runFfmpeg(
				[
					"-y",
					"-i",
					source,
					"-filter_complex",
					graph,
					"-map",
					"[out]",
					"-c:v",
					"prores_ks",
					"-profile:v",
					"4",
					"-pix_fmt",
					"yuva444p10le",
					"-vendor",
					"apl0",
					"-an",
					foreground,
				],
				"celstate alpha v0 foreground export",
				context,
			),
		]));
		await copyFile(foreground, prores);

		commandLogs.push(...compact([
			await runFfmpeg(
				[
					"-y",
					"-i",
					source,
					"-filter_complex",
					graph,
					"-map",
					"[out]",
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
					webm,
				],
				"celstate alpha v0 webm export",
				context,
			),
			await runFfmpeg(
				[
					"-y",
					"-i",
					source,
					"-filter_complex",
					graph,
					"-map",
					"[out]",
					"-plays",
					"0",
					"-f",
					"apng",
					apng,
				],
				"celstate alpha v0 apng export",
				context,
			),
			await runFfmpeg(
				[
					"-y",
					"-i",
					source,
					"-filter_complex",
					`${graph};[out]alphaextract,format=yuv420p[alpha]`,
					"-map",
					"[alpha]",
					"-c:v",
					"libx264",
					"-crf",
					"16",
					"-pix_fmt",
					"yuv420p",
					"-an",
					alpha,
				],
				"celstate alpha v0 alpha export",
				context,
			),
		]));

		await writeStageReport(directory, stage, {
			commandLogs,
			note:
				"Experimental v0: adaptive chroma matte with a 3-frame weighted temporal alpha stabilizer. This is a first failure-probing layer, not the final Alpha Compiler.",
			outputs: {
				alpha: "alpha.mp4",
				apng: "apng.png",
				foreground: "foreground.mov",
				prores: "prores.mov",
				webm: "webm.webm",
			},
			settings,
			sourceProbe: await ffprobeJson(source, context),
		});

		return { commandLog: commandLogs[commandLogs.length - 1], outputs: requiredOutputs.map((output) => `${stage}/${output}`) };
	});

	console.log(`wrote Celstate alpha v0 for ${runId}`);
}

function despillMixOption(args: ParsedArgs): number {
	return getNumberOption(args, "despill-mix", 0.5);
}

async function runCelstateAlphaV1Despill(args: ParsedArgs): Promise<void> {
	const root = spikeRoot(args);
	const runId = getRequiredOption(args, "run-id");
	const { directory, input } = await requireRunInput(root, runId);
	const context: RunContext = { directory, runId };
	const stage: Stage = "celstate-alpha-v1-despill";
	const requiredOutputs = ["alpha.mp4", "foreground.mov", "webm.webm", "prores.mov", "apng.png", "report.json"] as const;
	if (await skipCompletedStage(context, stage, requiredOutputs, forceRequested(args))) {
		return;
	}

	const stageDirectory = path.join(directory, stage);
	await ensureDirectory(stageDirectory);

	await runDurableStep(context, stage, async () => {
		const source = await requireSourceMp4(directory);
		const settings = chromaSettingsFromInputAndArgs(input, args);
		const despillMix = despillMixOption(args);
		const graph = celstateAlphaV1DespillGraph(settings, despillMix);
		const foreground = path.join(stageDirectory, "foreground.mov");
		const prores = path.join(stageDirectory, "prores.mov");
		const webm = path.join(stageDirectory, "webm.webm");
		const apng = path.join(stageDirectory, "apng.png");
		const alpha = path.join(stageDirectory, "alpha.mp4");
		const commandLogs: string[] = [];

		commandLogs.push(...compact([
			await runFfmpeg(
				[
					"-y",
					"-i",
					source,
					"-filter_complex",
					graph,
					"-map",
					"[out]",
					"-c:v",
					"prores_ks",
					"-profile:v",
					"4",
					"-pix_fmt",
					"yuva444p10le",
					"-vendor",
					"apl0",
					"-an",
					foreground,
				],
				"celstate alpha v1 despill foreground export",
				context,
			),
		]));
		await copyFile(foreground, prores);

		commandLogs.push(...compact([
			await runFfmpeg(
				[
					"-y",
					"-i",
					source,
					"-filter_complex",
					graph,
					"-map",
					"[out]",
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
					webm,
				],
				"celstate alpha v1 despill webm export",
				context,
			),
			await runFfmpeg(
				[
					"-y",
					"-i",
					source,
					"-filter_complex",
					graph,
					"-map",
					"[out]",
					"-plays",
					"0",
					"-f",
					"apng",
					apng,
				],
				"celstate alpha v1 despill apng export",
				context,
			),
			await runFfmpeg(
				[
					"-y",
					"-i",
					source,
					"-filter_complex",
					`${graph};[out]alphaextract,format=yuv420p[alpha]`,
					"-map",
					"[alpha]",
					"-c:v",
					"libx264",
					"-crf",
					"16",
					"-pix_fmt",
					"yuv420p",
					"-an",
					alpha,
				],
				"celstate alpha v1 despill alpha export",
				context,
			),
		]));

		await writeStageReport(directory, stage, {
			commandLogs,
			despillMix,
			note:
				"Alpha Compiler v1: key-first chroma matte with post-key FFmpeg despill RGB repair, plus 3-frame temporal alpha stabilizer. Despill preserves the keyed alpha and is not used as the alpha generator.",
			outputs: {
				alpha: "alpha.mp4",
				apng: "apng.png",
				foreground: "foreground.mov",
				prores: "prores.mov",
				webm: "webm.webm",
			},
			settings,
			sourceProbe: await ffprobeJson(source, context),
		});

		return { commandLog: commandLogs[commandLogs.length - 1], outputs: requiredOutputs.map((output) => `${stage}/${output}`) };
	});

	console.log(`wrote Celstate alpha v1 despill for ${runId}`);
}

interface V2TrimapSettings {
	readonly backgroundSampleCount: number;
	readonly backgroundThreshold: number;
	readonly despillMix: number;
	readonly foregroundThreshold: number;
	readonly keyColor: string;
	readonly selectedFrame: number;
	readonly transparentCutoff: number;
}

interface V3CoreFringeSettings {
	readonly coreAlphaThreshold: number;
	readonly despillMix: number;
	readonly fringeRadius: number;
	readonly keyColor: string;
	readonly selectedFrame: number;
	readonly transparentCutoff: number;
}

interface V4PriorFusionSettings {
	readonly chromaBackgroundAlphaScale: number;
	readonly chromaTransparentCutoff: number;
	readonly coreAlphaThreshold: number;
	readonly despillMix: number;
	readonly fringeRadius: number;
	readonly keyColor: string;
	readonly priorAlphaFloor: number;
	readonly priorModel: string;
	readonly priorPackage: string;
	readonly selectedFrame: number;
	readonly transparentCutoff: number;
}

interface V5VideoPriorSettings {
	readonly chromaLeafDespillMix: number;
	readonly coreAlphaThreshold: number;
	readonly coreDespillBand: number;
	readonly coreDespillMix: number;
	readonly fringeRadius: number;
	readonly guardRadius: number;
	readonly keyColor: string;
	readonly leafAlphaFloor: number;
	readonly leafGateRamp: number;
	readonly priorAlphaDir: string;
	readonly residualDespillMix: number;
	readonly selectedFrame: number;
	readonly spillGain: number;
	readonly spillPullMax: number;
	readonly subjectAlphaThreshold: number;
	readonly transparentCutoff: number;
}

interface VideoPriorSettings {
	readonly matanyoneCommand: string;
	readonly matanyonePackage: string;
	readonly matanyoneViaWsl: boolean;
	readonly maskThreshold: number;
	readonly maxSize: number | undefined;
	readonly priorModel: string;
	readonly priorPackage: string;
}

async function readRgbImage(filePath: string): Promise<RawRgbImage> {
	const { data, info } = await sharp(filePath)
		.removeAlpha()
		.raw()
		.toBuffer({ resolveWithObject: true });
	return {
		data,
		height: info.height,
		width: info.width,
	};
}

async function readGrayImage(filePath: string): Promise<RawGrayImage> {
	const { data, info } = await sharp(filePath)
		.greyscale()
		.raw()
		.toBuffer({ resolveWithObject: true });
	if (info.channels !== 1) {
		throw new Error(`Expected a single-channel grayscale image. Got ${info.channels} channels for ${filePath}.`);
	}
	return {
		data,
		height: info.height,
		width: info.width,
	};
}

async function readRgbaImage(filePath: string): Promise<RawRgbaImage> {
	const { data, info } = await sharp(filePath)
		.ensureAlpha()
		.raw()
		.toBuffer({ resolveWithObject: true });
	if (info.channels !== 4) {
		throw new Error(`Expected a four-channel RGBA image. Got ${info.channels} channels for ${filePath}.`);
	}
	return {
		data,
		height: info.height,
		width: info.width,
	};
}

async function writeRgbImage(image: RawRgbImage, filePath: string): Promise<void> {
	await sharp(image.data, {
		raw: {
			channels: 3,
			height: image.height,
			width: image.width,
		},
	}).png().toFile(filePath);
}

async function writeRgbaImage(data: Buffer, width: number, height: number, filePath: string): Promise<void> {
	await sharp(data, {
		raw: {
			channels: 4,
			height,
			width,
		},
	}).png().toFile(filePath);
}

async function listFrameFiles(directory: string): Promise<string[]> {
	const files = await readdir(directory);
	return files
		.filter((file) => /^frame-\d+\.png$/u.test(file))
		.sort()
		.map((file) => path.join(directory, file));
}

function sampleFramePaths(frames: readonly string[], count: number): string[] {
	if (frames.length <= count) {
		return [...frames];
	}
	const selected = new Set<number>();
	for (let index = 0; index < count; index += 1) {
		selected.add(Math.round((index * (frames.length - 1)) / Math.max(1, count - 1)));
	}
	return [...selected].sort((a, b) => a - b).map((index) => frames[index]);
}

async function extractSourceFrames(source: string, framesDirectory: string, context: RunContext): Promise<string[]> {
	await rm(framesDirectory, { force: true, recursive: true });
	await ensureDirectory(framesDirectory);
	await runFfmpeg(
		["-y", "-i", source, "-vsync", "0", path.join(framesDirectory, "frame-%05d.png")],
		"celstate alpha v2 source frame extraction",
		context,
	);
	return listFrameFiles(framesDirectory);
}

async function extractSharpChromaAlphaFrames(source: string, framesDirectory: string, settings: ChromaSettings, context: RunContext): Promise<string[]> {
	await rm(framesDirectory, { force: true, recursive: true });
	await ensureDirectory(framesDirectory);
	await runFfmpeg(
		[
			"-y",
			"-i",
			source,
			"-vf",
			`${keyFilter(settings)},alphaextract,format=gray`,
			"-vsync",
			"0",
			path.join(framesDirectory, "frame-%05d.png"),
		],
		"celstate alpha v5 sharp chroma alpha extraction",
		context,
	);
	return listFrameFiles(framesDirectory);
}

async function extractRoughAlphaFrames(source: string, framesDirectory: string, settings: ChromaSettings, context: RunContext): Promise<string[]> {
	await rm(framesDirectory, { force: true, recursive: true });
	await ensureDirectory(framesDirectory);
	await runFfmpeg(
		[
			"-y",
			"-i",
			source,
			"-vf",
			`${keyFilter(settings)},alphaextract,tmix=frames=3:weights='1 2 1',format=gray`,
			"-vsync",
			"0",
			path.join(framesDirectory, "frame-%05d.png"),
		],
		"celstate alpha v3 rough alpha extraction",
		context,
	);
	return listFrameFiles(framesDirectory);
}

function frameRateFromProbe(probe: unknown): string {
	if (probe && typeof probe === "object") {
		const streams = (probe as { streams?: Array<{ r_frame_rate?: unknown }> }).streams;
		const frameRate = streams?.[0]?.r_frame_rate;
		if (typeof frameRate === "string" && frameRate !== "0/0") {
			return frameRate;
		}
	}
	return "24";
}

function estimatePlateColor(samples: readonly RawRgbImage[], fallback: RgbColor): RgbColor {
	let b = 0;
	let g = 0;
	let r = 0;
	let totalWeight = 0;
	for (const sample of samples) {
		const band = Math.max(8, Math.round(Math.min(sample.width, sample.height) * 0.035));
		for (let y = 0; y < sample.height; y += 8) {
			for (let x = 0; x < sample.width; x += 8) {
				if (x >= band && x < sample.width - band && y >= band && y < sample.height - band) {
					continue;
				}
				const offset = (y * sample.width + x) * 3;
				const pr = sample.data[offset];
				const pg = sample.data[offset + 1];
				const pb = sample.data[offset + 2];
				const distance = colorDistanceSquared(pr, pg, pb, fallback);
				const weight = 1 / (1 + distance);
				r += pr * weight;
				g += pg * weight;
				b += pb * weight;
				totalWeight += weight;
			}
		}
	}
	if (totalWeight === 0) {
		return fallback;
	}
	return {
		b: clampByte(b / totalWeight),
		g: clampByte(g / totalWeight),
		r: clampByte(r / totalWeight),
	};
}

function buildBackgroundImage(samples: readonly RawRgbImage[], keyColor: RgbColor): RawRgbImage {
	const first = samples[0];
	if (!first) {
		throw new Error("Cannot build a background plate without sampled frames.");
	}
	const pixelCount = first.width * first.height;
	const background = Buffer.alloc(pixelCount * 3);
	for (const sample of samples) {
		if (sample.width !== first.width || sample.height !== first.height) {
			throw new Error("All sampled frames must have identical dimensions.");
		}
	}
	for (let pixel = 0; pixel < pixelCount; pixel += 1) {
		const offset = pixel * 3;
		let bestDistance = Number.POSITIVE_INFINITY;
		let bestR = first.data[offset];
		let bestG = first.data[offset + 1];
		let bestB = first.data[offset + 2];
		for (const sample of samples) {
			const r = sample.data[offset];
			const g = sample.data[offset + 1];
			const b = sample.data[offset + 2];
			const distance = colorDistanceSquared(r, g, b, keyColor);
			if (distance < bestDistance) {
				bestDistance = distance;
				bestR = r;
				bestG = g;
				bestB = b;
			}
		}
		background[offset] = bestR;
		background[offset + 1] = bestG;
		background[offset + 2] = bestB;
	}
	return {
		data: background,
		height: first.height,
		width: first.width,
	};
}

function connectedBackgroundMask(candidates: Uint8Array, width: number, height: number): Uint8Array {
	const pixelCount = width * height;
	const connected = new Uint8Array(pixelCount);
	const queue = new Int32Array(pixelCount);
	let head = 0;
	let tail = 0;
	const push = (pixel: number): void => {
		if (candidates[pixel] === 0 || connected[pixel] === 1) {
			return;
		}
		connected[pixel] = 1;
		queue[tail] = pixel;
		tail += 1;
	};
	for (let x = 0; x < width; x += 1) {
		push(x);
		push((height - 1) * width + x);
	}
	for (let y = 1; y < height - 1; y += 1) {
		push(y * width);
		push(y * width + width - 1);
	}
	while (head < tail) {
		const pixel = queue[head];
		head += 1;
		const x = pixel % width;
		if (x > 0) {
			push(pixel - 1);
		}
		if (x < width - 1) {
			push(pixel + 1);
		}
		if (pixel >= width) {
			push(pixel - width);
		}
		if (pixel < pixelCount - width) {
			push(pixel + width);
		}
	}
	return connected;
}

function recoverForegroundChannel(channel: number, background: number, alpha: number): number {
	if (alpha <= 0.08) {
		return 0;
	}
	return clampByte((channel - (1 - alpha) * background) / alpha);
}

function despillGreen(r: number, g: number, b: number, alpha: number, mix: number): RgbColor {
	const spill = Math.max(0, g - Math.max(r, b));
	const fringe = alpha < 0.98 ? smoothStep((1 - alpha) / 0.8) : 0;
	return {
		b,
		g: clampByte(g - spill * mix * fringe),
		r,
	};
}

function createV2RgbaFrame(frame: RawRgbImage, background: RawRgbImage, settings: V2TrimapSettings): { readonly alphaCoverage: number; readonly data: Buffer } {
	if (frame.width !== background.width || frame.height !== background.height) {
		throw new Error("Frame and background plate dimensions do not match.");
	}
	const pixelCount = frame.width * frame.height;
	const lowSquared = settings.backgroundThreshold * settings.backgroundThreshold;
	const highSquared = settings.foregroundThreshold * settings.foregroundThreshold;
	const spanSquared = Math.max(1, highSquared - lowSquared);
	const candidates = new Uint8Array(pixelCount);
	const distances = new Float64Array(pixelCount);
	for (let pixel = 0; pixel < pixelCount; pixel += 1) {
		const offset = pixel * 3;
		const dr = frame.data[offset] - background.data[offset];
		const dg = frame.data[offset + 1] - background.data[offset + 1];
		const db = frame.data[offset + 2] - background.data[offset + 2];
		const distance = dr * dr + dg * dg + db * db;
		distances[pixel] = distance;
		candidates[pixel] = distance <= lowSquared ? 1 : 0;
	}
	const connected = connectedBackgroundMask(candidates, frame.width, frame.height);
	const rgba = Buffer.alloc(pixelCount * 4);
	let alphaSum = 0;
	for (let pixel = 0; pixel < pixelCount; pixel += 1) {
		const rgbOffset = pixel * 3;
		const rgbaOffset = pixel * 4;
		let alpha = 0;
		if (distances[pixel] <= lowSquared) {
			alpha = 0;
		} else if (connected[pixel] === 0) {
			if (distances[pixel] <= lowSquared) {
				alpha = 255;
			} else {
				alpha = clampByte(255 * smoothStep((distances[pixel] - lowSquared) / spanSquared));
			}
			if (alpha < settings.transparentCutoff) {
				alpha = 0;
			}
		}
		if (alpha === 0) {
			rgba[rgbaOffset] = 0;
			rgba[rgbaOffset + 1] = 0;
			rgba[rgbaOffset + 2] = 0;
			rgba[rgbaOffset + 3] = 0;
			continue;
		}
		const normalizedAlpha = alpha / 255;
		const recovered = normalizedAlpha < 0.995
			? {
				b: recoverForegroundChannel(frame.data[rgbOffset + 2], background.data[rgbOffset + 2], normalizedAlpha),
				g: recoverForegroundChannel(frame.data[rgbOffset + 1], background.data[rgbOffset + 1], normalizedAlpha),
				r: recoverForegroundChannel(frame.data[rgbOffset], background.data[rgbOffset], normalizedAlpha),
			}
			: {
				b: frame.data[rgbOffset + 2],
				g: frame.data[rgbOffset + 1],
				r: frame.data[rgbOffset],
			};
		const despilled = despillGreen(recovered.r, recovered.g, recovered.b, normalizedAlpha, settings.despillMix);
		rgba[rgbaOffset] = despilled.r;
		rgba[rgbaOffset + 1] = despilled.g;
		rgba[rgbaOffset + 2] = despilled.b;
		rgba[rgbaOffset + 3] = alpha;
		alphaSum += alpha;
	}
	return {
		alphaCoverage: alphaSum / (pixelCount * 255),
		data: rgba,
	};
}

function despillDominantChannel(r: number, g: number, b: number, keyColor: RgbColor, mix: number): { readonly color: RgbColor; readonly reduction: number } {
	if (keyColor.g >= keyColor.r && keyColor.g >= keyColor.b) {
		const spill = Math.max(0, g - Math.max(r, b));
		const reduction = spill * mix;
		return { color: { b, g: clampByte(g - reduction), r }, reduction };
	}
	if (keyColor.b >= keyColor.r && keyColor.b >= keyColor.g) {
		const spill = Math.max(0, b - Math.max(r, g));
		const reduction = spill * mix;
		return { color: { b: clampByte(b - reduction), g, r }, reduction };
	}
	const spill = Math.max(0, r - Math.max(g, b));
	const reduction = spill * mix;
	return { color: { b, g, r: clampByte(r - reduction) }, reduction };
}

function v3EdgeWeight(distance: number, roughAlpha: number, settings: V3CoreFringeSettings): number {
	const distanceWeight = distance <= settings.fringeRadius
		? 1 - Math.max(0, distance - 1) / Math.max(1, settings.fringeRadius)
		: 0;
	const partialWeight = roughAlpha < settings.coreAlphaThreshold
		? 1 - roughAlpha / Math.max(1, settings.coreAlphaThreshold)
		: 0;
	return smoothStep(Math.max(distanceWeight, partialWeight));
}

function createV3RgbaFrame(
	frame: RawRgbImage,
	roughAlpha: RawGrayImage,
	settings: V3CoreFringeSettings,
): {
	readonly alphaCoverage: number;
	readonly averageDominantChannelReduction: number;
	readonly coreCoverage: number;
	readonly data: Buffer;
	readonly fringeCoverage: number;
	readonly repairedFringeCoverage: number;
} {
	if (frame.width !== roughAlpha.width || frame.height !== roughAlpha.height) {
		throw new Error("Frame and rough alpha dimensions do not match.");
	}
	const pixelCount = frame.width * frame.height;
	const distances = distanceToTransparent(roughAlpha, settings.transparentCutoff, settings.fringeRadius);
	const rgba = Buffer.alloc(pixelCount * 4);
	const keyColor = parseRgbColor(settings.keyColor);
	let alphaSum = 0;
	let corePixels = 0;
	let fringePixels = 0;
	let repairedFringePixels = 0;
	let dominantChannelReductionSum = 0;
	for (let pixel = 0; pixel < pixelCount; pixel += 1) {
		const rgbOffset = pixel * 3;
		const rgbaOffset = pixel * 4;
		const sourceAlpha = roughAlpha.data[pixel];
		if (sourceAlpha <= settings.transparentCutoff) {
			rgba[rgbaOffset] = 0;
			rgba[rgbaOffset + 1] = 0;
			rgba[rgbaOffset + 2] = 0;
			rgba[rgbaOffset + 3] = 0;
			continue;
		}
		const isCore = sourceAlpha >= settings.coreAlphaThreshold && distances[pixel] > settings.fringeRadius;
		const alpha = isCore
			? 255
			: clampByte(255 * smoothStep((sourceAlpha - settings.transparentCutoff) / Math.max(1, settings.coreAlphaThreshold - settings.transparentCutoff)));
		if (isCore) {
			rgba[rgbaOffset] = frame.data[rgbOffset];
			rgba[rgbaOffset + 1] = frame.data[rgbOffset + 1];
			rgba[rgbaOffset + 2] = frame.data[rgbOffset + 2];
			rgba[rgbaOffset + 3] = alpha;
			corePixels += 1;
			alphaSum += alpha;
			continue;
		}
		fringePixels += 1;
		const normalizedAlpha = alpha / 255;
		const recovered = normalizedAlpha < 0.995 && normalizedAlpha > 0.08
			? {
				b: recoverForegroundChannel(frame.data[rgbOffset + 2], keyColor.b, normalizedAlpha),
				g: recoverForegroundChannel(frame.data[rgbOffset + 1], keyColor.g, normalizedAlpha),
				r: recoverForegroundChannel(frame.data[rgbOffset], keyColor.r, normalizedAlpha),
			}
			: {
				b: frame.data[rgbOffset + 2],
				g: frame.data[rgbOffset + 1],
				r: frame.data[rgbOffset],
			};
		const edgeWeight = v3EdgeWeight(distances[pixel], sourceAlpha, settings);
		const repaired = despillDominantChannel(recovered.r, recovered.g, recovered.b, keyColor, settings.despillMix * edgeWeight);
		if (repaired.reduction > 0) {
			repairedFringePixels += 1;
			dominantChannelReductionSum += repaired.reduction;
		}
		rgba[rgbaOffset] = repaired.color.r;
		rgba[rgbaOffset + 1] = repaired.color.g;
		rgba[rgbaOffset + 2] = repaired.color.b;
		rgba[rgbaOffset + 3] = alpha;
		alphaSum += alpha;
	}
	return {
		alphaCoverage: alphaSum / (pixelCount * 255),
		averageDominantChannelReduction: repairedFringePixels === 0 ? 0 : dominantChannelReductionSum / repairedFringePixels,
		coreCoverage: corePixels / pixelCount,
		data: rgba,
		fringeCoverage: fringePixels / pixelCount,
		repairedFringeCoverage: repairedFringePixels / pixelCount,
	};
}

function alphaChannelFromRgba(image: RawRgbaImage): RawGrayImage {
	const pixelCount = image.width * image.height;
	const alpha = Buffer.alloc(pixelCount);
	for (let pixel = 0; pixel < pixelCount; pixel += 1) {
		alpha[pixel] = image.data[pixel * 4 + 3];
	}
	return {
		data: alpha,
		height: image.height,
		width: image.width,
	};
}

function createV4RgbaFrame(
	frame: RawRgbImage,
	prior: RawRgbaImage,
	roughAlpha: RawGrayImage,
	settings: V4PriorFusionSettings,
): {
	readonly alphaCoverage: number;
	readonly averageDominantChannelReduction: number;
	readonly chromaSuppressedCoverage: number;
	readonly coreCoverage: number;
	readonly data: Buffer;
	readonly fringeCoverage: number;
	readonly repairedFringeCoverage: number;
} {
	if (frame.width !== prior.width || frame.height !== prior.height) {
		throw new Error("Frame and prior dimensions do not match.");
	}
	if (frame.width !== roughAlpha.width || frame.height !== roughAlpha.height) {
		throw new Error("Frame and rough alpha dimensions do not match.");
	}
	const pixelCount = frame.width * frame.height;
	const priorAlpha = alphaChannelFromRgba(prior);
	const distances = distanceToTransparent(priorAlpha, settings.transparentCutoff, settings.fringeRadius);
	const rgba = Buffer.alloc(pixelCount * 4);
	const keyColor = parseRgbColor(settings.keyColor);
	let alphaSum = 0;
	let chromaSuppressedPixels = 0;
	let corePixels = 0;
	let fringePixels = 0;
	let repairedFringePixels = 0;
	let dominantChannelReductionSum = 0;
	for (let pixel = 0; pixel < pixelCount; pixel += 1) {
		const rgbOffset = pixel * 3;
		const rgbaOffset = pixel * 4;
		const priorOffset = pixel * 4;
		const sourceAlpha = prior.data[priorOffset + 3];
		const chromaAlpha = roughAlpha.data[pixel];
		let alpha = sourceAlpha;
		if (alpha <= settings.transparentCutoff) {
			alpha = 0;
		} else if (chromaAlpha <= settings.chromaTransparentCutoff && alpha < settings.coreAlphaThreshold) {
			alpha = clampByte(alpha * settings.chromaBackgroundAlphaScale);
			chromaSuppressedPixels += 1;
		}
		if (alpha <= settings.priorAlphaFloor) {
			rgba[rgbaOffset] = 0;
			rgba[rgbaOffset + 1] = 0;
			rgba[rgbaOffset + 2] = 0;
			rgba[rgbaOffset + 3] = 0;
			continue;
		}
		const isCore = alpha >= settings.coreAlphaThreshold && distances[pixel] > settings.fringeRadius;
		const outputAlpha = isCore ? 255 : alpha;
		if (isCore) {
			rgba[rgbaOffset] = frame.data[rgbOffset];
			rgba[rgbaOffset + 1] = frame.data[rgbOffset + 1];
			rgba[rgbaOffset + 2] = frame.data[rgbOffset + 2];
			rgba[rgbaOffset + 3] = outputAlpha;
			corePixels += 1;
			alphaSum += outputAlpha;
			continue;
		}
		fringePixels += 1;
		const edgeWeight = v3EdgeWeight(distances[pixel], alpha, {
			coreAlphaThreshold: settings.coreAlphaThreshold,
			despillMix: settings.despillMix,
			fringeRadius: settings.fringeRadius,
			keyColor: settings.keyColor,
			selectedFrame: settings.selectedFrame,
			transparentCutoff: settings.transparentCutoff,
		});
		const repaired = despillDominantChannel(
			frame.data[rgbOffset],
			frame.data[rgbOffset + 1],
			frame.data[rgbOffset + 2],
			keyColor,
			settings.despillMix * edgeWeight,
		);
		if (repaired.reduction > 0) {
			repairedFringePixels += 1;
			dominantChannelReductionSum += repaired.reduction;
		}
		rgba[rgbaOffset] = repaired.color.r;
		rgba[rgbaOffset + 1] = repaired.color.g;
		rgba[rgbaOffset + 2] = repaired.color.b;
		rgba[rgbaOffset + 3] = outputAlpha;
		alphaSum += outputAlpha;
	}
	return {
		alphaCoverage: alphaSum / (pixelCount * 255),
		averageDominantChannelReduction: repairedFringePixels === 0 ? 0 : dominantChannelReductionSum / repairedFringePixels,
		chromaSuppressedCoverage: chromaSuppressedPixels / pixelCount,
		coreCoverage: corePixels / pixelCount,
		data: rgba,
		fringeCoverage: fringePixels / pixelCount,
		repairedFringeCoverage: repairedFringePixels / pixelCount,
	};
}

async function writeSpillHeatmap(heatmap: Uint8Array, width: number, height: number, filePath: string): Promise<void> {
	const data = Buffer.alloc(width * height * 3);
	for (let pixel = 0; pixel < width * height; pixel += 1) {
		const offset = pixel * 3;
		const value = heatmap[pixel] ?? 0;
		data[offset] = value;
		data[offset + 1] = Math.round(value * 0.35);
		data[offset + 2] = 0;
	}
	await writeRgbImage({ data, height, width }, filePath);
}

function createV5RgbaFrame(
	frame: RawRgbImage,
	priorAlpha: RawGrayImage,
	chromaAlpha: RawGrayImage,
	settings: V5VideoPriorSettings,
): {
	readonly alphaCoverage: number;
	readonly averageSpillPull: number;
	readonly coreCoverage: number;
	readonly data: Buffer;
	readonly fringeCoverage: number;
	readonly leafAddedCoverage: number;
	readonly priorCoverage: number;
	readonly pulledFringeCoverage: number;
} {
	if (frame.width !== priorAlpha.width || frame.height !== priorAlpha.height) {
		throw new Error("Frame and prior alpha dimensions do not match.");
	}
	if (frame.width !== chromaAlpha.width || frame.height !== chromaAlpha.height) {
		throw new Error("Frame and chroma alpha dimensions do not match.");
	}
	const width = frame.width;
	const height = frame.height;
	const pixelCount = width * height;
	const keyColor = parseRgbColor(settings.keyColor);
	const distanceCap = Math.max(settings.fringeRadius, settings.coreDespillBand);
	const distancesToTransparent = distanceToTransparent(priorAlpha, settings.transparentCutoff, distanceCap);
	const subjectMask = new Uint8Array(pixelCount);
	const coreMask = new Uint8Array(pixelCount);
	for (let pixel = 0; pixel < pixelCount; pixel += 1) {
		if (priorAlpha.data[pixel] > settings.subjectAlphaThreshold) {
			subjectMask[pixel] = 1;
		}
		if (priorAlpha.data[pixel] >= settings.coreAlphaThreshold && distancesToTransparent[pixel] > settings.fringeRadius) {
			coreMask[pixel] = 1;
		}
	}
	const distancesToSubject = chamferDistanceToMask(subjectMask, width, height, settings.guardRadius + settings.leafGateRamp);
	const inward = fillInwardCoreColors(frame, coreMask, settings.fringeRadius + 10);
	const rgba = Buffer.alloc(pixelCount * 4);
	let alphaSum = 0;
	let priorSum = 0;
	let leafAddedSum = 0;
	let corePixels = 0;
	let fringePixels = 0;
	let pulledFringePixels = 0;
	let spillPullSum = 0;
	for (let pixel = 0; pixel < pixelCount; pixel += 1) {
		const rgbOffset = pixel * 3;
		const rgbaOffset = pixel * 4;
		const prior = priorAlpha.data[pixel];
		priorSum += prior;
		const r = frame.data[rgbOffset];
		const g = frame.data[rgbOffset + 1];
		const b = frame.data[rgbOffset + 2];
		if (prior > settings.transparentCutoff) {
			const isCore = coreMask[pixel] === 1;
			if (isCore) {
				const bandDistance = distancesToTransparent[pixel];
				let coreR = r;
				let coreG = g;
				let coreB = b;
				if (bandDistance <= settings.coreDespillBand) {
					const bandWeight = 1 - Math.max(0, bandDistance - settings.fringeRadius) / Math.max(1, settings.coreDespillBand - settings.fringeRadius);
					const repairedCore = despillDominantChannel(r, g, b, keyColor, settings.coreDespillMix * smoothStep(bandWeight));
					coreR = repairedCore.color.r;
					coreG = repairedCore.color.g;
					coreB = repairedCore.color.b;
				}
				rgba[rgbaOffset] = coreR;
				rgba[rgbaOffset + 1] = coreG;
				rgba[rgbaOffset + 2] = coreB;
				rgba[rgbaOffset + 3] = 255;
				corePixels += 1;
				alphaSum += 255;
				continue;
			}
			fringePixels += 1;
			const distanceWeight = distancesToTransparent[pixel] <= settings.fringeRadius
				? 1 - Math.max(0, distancesToTransparent[pixel] - 1) / Math.max(1, settings.fringeRadius)
				: 0;
			const partialWeight = prior < settings.coreAlphaThreshold
				? 1 - prior / Math.max(1, settings.coreAlphaThreshold)
				: 0;
			const edgeWeight = smoothStep(Math.max(distanceWeight, partialWeight));
			let outR = r;
			let outG = g;
			let outB = b;
			let residualMix = settings.residualDespillMix;
			if (inward.filled[pixel] === 1) {
				const inwardOffset = pixel * 3;
				const inwardR = inward.colors[inwardOffset];
				const inwardG = inward.colors[inwardOffset + 1];
				const inwardB = inward.colors[inwardOffset + 2];
				const ownDominance = keyDominance(r, g, b, keyColor);
				const inwardDominance = keyDominance(inwardR, inwardG, inwardB, keyColor);
				const excess = Math.max(0, ownDominance - inwardDominance);
				const pull = Math.min(settings.spillPullMax, (excess / 255) * settings.spillGain) * edgeWeight;
				if (pull > 0) {
					outR = r + (inwardR - r) * pull;
					outG = g + (inwardG - g) * pull;
					outB = b + (inwardB - b) * pull;
					pulledFringePixels += 1;
					spillPullSum += pull;
				}
			} else {
				residualMix = 1;
			}
			const residual = despillDominantChannel(outR, outG, outB, keyColor, residualMix * edgeWeight);
			rgba[rgbaOffset] = clampByte(residual.color.r);
			rgba[rgbaOffset + 1] = clampByte(residual.color.g);
			rgba[rgbaOffset + 2] = clampByte(residual.color.b);
			rgba[rgbaOffset + 3] = prior;
			alphaSum += prior;
			continue;
		}
		const guardDistance = distancesToSubject[pixel];
		if (guardDistance > settings.guardRadius) {
			const leafGate = smoothStep((guardDistance - settings.guardRadius) / settings.leafGateRamp);
			const leafAlpha = clampByte(chromaAlpha.data[pixel] * leafGate);
			if (leafAlpha > settings.leafAlphaFloor) {
				const repaired = despillDominantChannel(r, g, b, keyColor, settings.chromaLeafDespillMix);
				rgba[rgbaOffset] = repaired.color.r;
				rgba[rgbaOffset + 1] = repaired.color.g;
				rgba[rgbaOffset + 2] = repaired.color.b;
				rgba[rgbaOffset + 3] = leafAlpha;
				alphaSum += leafAlpha;
				leafAddedSum += leafAlpha;
				continue;
			}
		}
		rgba[rgbaOffset] = 0;
		rgba[rgbaOffset + 1] = 0;
		rgba[rgbaOffset + 2] = 0;
		rgba[rgbaOffset + 3] = 0;
	}
	return {
		alphaCoverage: alphaSum / (pixelCount * 255),
		averageSpillPull: pulledFringePixels === 0 ? 0 : spillPullSum / pulledFringePixels,
		coreCoverage: corePixels / pixelCount,
		data: rgba,
		fringeCoverage: fringePixels / pixelCount,
		leafAddedCoverage: leafAddedSum / (pixelCount * 255),
		priorCoverage: priorSum / (pixelCount * 255),
		pulledFringeCoverage: pulledFringePixels / pixelCount,
	};
}

function v2TrimapSettings(input: RunInput, args: ParsedArgs): V2TrimapSettings {
	return {
		backgroundSampleCount: Math.max(2, Math.round(getNumberOption(args, "background-samples", 24))),
		backgroundThreshold: getNumberOption(args, "background-threshold", 28),
		despillMix: getNumberOption(args, "despill-mix", 0.8),
		foregroundThreshold: getNumberOption(args, "foreground-threshold", 76),
		keyColor: normalizeHexColor(getOption(args, "key-color") ?? input.chroma.color),
		selectedFrame: Math.max(1, Math.round(getNumberOption(args, "still-frame", 96))),
		transparentCutoff: getNumberOption(args, "transparent-cutoff", 10),
	};
}

function v3CoreFringeSettings(input: RunInput, args: ParsedArgs): V3CoreFringeSettings {
	return {
		coreAlphaThreshold: getNumberOption(args, "core-alpha", 242),
		despillMix: getNumberOption(args, "despill-mix", 1.25),
		fringeRadius: Math.max(1, Math.round(getNumberOption(args, "fringe-radius", 4))),
		keyColor: normalizeHexColor(getOption(args, "key-color") ?? input.chroma.color),
		selectedFrame: Math.max(1, Math.round(getNumberOption(args, "still-frame", 96))),
		transparentCutoff: getNumberOption(args, "transparent-cutoff", 4),
	};
}

function v5VideoPriorSettings(input: RunInput, args: ParsedArgs, stageDirectory: string): V5VideoPriorSettings {
	return {
		chromaLeafDespillMix: getNumberOption(args, "leaf-despill-mix", 0.55),
		coreAlphaThreshold: getNumberOption(args, "core-alpha", 235),
		coreDespillBand: Math.max(1, Math.round(getNumberOption(args, "core-despill-band", 20))),
		coreDespillMix: getNumberOption(args, "core-despill-mix", 0.6),
		fringeRadius: Math.max(1, Math.round(getNumberOption(args, "fringe-radius", 6))),
		guardRadius: Math.max(1, Math.round(getNumberOption(args, "guard-radius", 8))),
		keyColor: normalizeHexColor(getOption(args, "key-color") ?? input.chroma.color),
		leafAlphaFloor: getNumberOption(args, "leaf-alpha-floor", 24),
		leafGateRamp: Math.max(1, Math.round(getNumberOption(args, "leaf-gate-ramp", 4))),
		priorAlphaDir: getOption(args, "prior-alpha-dir") ?? path.join(stageDirectory, "matanyone2", "source-frames", "pha"),
		residualDespillMix: getNumberOption(args, "residual-despill-mix", 0.6),
		selectedFrame: Math.max(1, Math.round(getNumberOption(args, "still-frame", 96))),
		spillGain: getNumberOption(args, "spill-gain", 3),
		spillPullMax: getNumberOption(args, "spill-pull-max", 0.85),
		subjectAlphaThreshold: getNumberOption(args, "subject-alpha", 32),
		transparentCutoff: getNumberOption(args, "transparent-cutoff", 2),
	};
}

function resolvePriorAlphaDirectory(stageDirectory: string, runDirectory: string, args: ParsedArgs): string {
	const explicit = getOption(args, "prior-alpha-dir");
	if (explicit) {
		return explicit;
	}
	const candidates = [
		path.join(stageDirectory, "matanyone2"),
		path.join(runDirectory, "video-prior", "matanyone2"),
		path.join(runDirectory, "celstate-alpha-v5-video-prior", "matanyone2"),
	];
	for (const candidate of candidates) {
		for (const suffix of ["source-frames/pha", "source/pha"]) {
			const direct = path.join(candidate, ...suffix.split("/"));
			if (existsSync(direct)) {
				return direct;
			}
		}
	}
	return path.join(stageDirectory, "matanyone2", "source", "pha");
}

function v6ProjectionSettings(input: RunInput, args: ParsedArgs, stageDirectory: string, runDirectory: string): V6ProjectionSettings {
	return {
		bgPlateIterations: Math.max(4, Math.round(getNumberOption(args, "bg-plate-iterations", 24))),
		chromaTransparentCutoff: getNumberOption(args, "chroma-transparent-cutoff", 8),
		coreAlphaThreshold: getNumberOption(args, "core-alpha", 235),
		coreProjectionBand: Math.max(1, Math.round(getNumberOption(args, "core-projection-band", 20))),
		fringeRadius: Math.max(1, Math.round(getNumberOption(args, "fringe-radius", 6))),
		guardRadius: Math.max(1, Math.round(getNumberOption(args, "guard-radius", 8))),
		keyColor: normalizeHexColor(getOption(args, "key-color") ?? input.chroma.color),
		leafAlphaFloor: getNumberOption(args, "leaf-alpha-floor", 24),
		leafEdgeBand: Math.max(1, Math.round(getNumberOption(args, "leaf-edge-band", 4))),
		leafGateRamp: Math.max(1, Math.round(getNumberOption(args, "leaf-gate-ramp", 4))),
		leafInteriorMinDistance: Math.max(1, Math.round(getNumberOption(args, "leaf-interior-min-distance", 3))),
		priorAlphaDir: resolvePriorAlphaDirectory(stageDirectory, runDirectory, args),
		priorModel: getOption(args, "prior-model") ?? "bria-rmbg",
		priorPackage: getOption(args, "prior-package") ?? "rembg[cpu,cli]",
		selectedFrame: Math.max(1, Math.round(getNumberOption(args, "still-frame", 96))),
		subjectAlphaThreshold: getNumberOption(args, "subject-alpha", 32),
		transparentCutoff: getNumberOption(args, "transparent-cutoff", 2),
	};
}

function videoPriorSettings(args: ParsedArgs): VideoPriorSettings {
	const maxSizeOption = getOption(args, "max-size");
	return {
		maskThreshold: getNumberOption(args, "mask-threshold", 16),
		matanyoneCommand: getOption(args, "matanyone-command") ?? "matanyone2",
		matanyonePackage: getOption(args, "matanyone-package") ?? "matanyone2@git+https://github.com/pq-yang/MatAnyone2.git",
		matanyoneViaWsl: getOption(args, "matanyone-via-wsl") === "true",
		maxSize: maxSizeOption === undefined ? undefined : Math.max(64, Math.round(Number(maxSizeOption))),
		priorModel: getOption(args, "prior-model") ?? "bria-rmbg",
		priorPackage: getOption(args, "prior-package") ?? "rembg[cpu,cli]",
	};
}

function v4PriorFusionSettings(input: RunInput, args: ParsedArgs): V4PriorFusionSettings {
	return {
		chromaBackgroundAlphaScale: getNumberOption(args, "chroma-background-alpha-scale", 0.35),
		chromaTransparentCutoff: getNumberOption(args, "chroma-transparent-cutoff", 8),
		coreAlphaThreshold: getNumberOption(args, "core-alpha", 244),
		despillMix: getNumberOption(args, "despill-mix", 0.65),
		fringeRadius: Math.max(1, Math.round(getNumberOption(args, "fringe-radius", 3))),
		keyColor: normalizeHexColor(getOption(args, "key-color") ?? input.chroma.color),
		priorAlphaFloor: getNumberOption(args, "prior-alpha-floor", 4),
		priorModel: getOption(args, "prior-model") ?? "bria-rmbg",
		priorPackage: getOption(args, "prior-package") ?? "rembg[cpu,cli]",
		selectedFrame: Math.max(1, Math.round(getNumberOption(args, "still-frame", 96))),
		transparentCutoff: getNumberOption(args, "transparent-cutoff", 3),
	};
}

async function writeTexturedBackground(stageDirectory: string, width: number, height: number): Promise<string> {
	const data = Buffer.alloc(width * height * 3);
	for (let y = 0; y < height; y += 1) {
		for (let x = 0; x < width; x += 1) {
			const offset = (y * width + x) * 3;
			const wave = Math.sin(x / 29) + Math.sin(y / 23) + Math.sin((x + y) / 47);
			const hash = ((x * 73856093) ^ (y * 19349663)) & 255;
			const noise = hash / 255 - 0.5;
			data[offset] = clampByte(245 + wave * 2.2 + noise * 4);
			data[offset + 1] = clampByte(243 + wave * 1.8 + noise * 3);
			data[offset + 2] = clampByte(237 + wave * 1.4 + noise * 3);
		}
	}
	const texture = path.join(stageDirectory, "texture-background.png");
	await writeRgbImage({ data, height, width }, texture);
	return texture;
}

async function writeCompositeStill(stageDirectory: string, still: string, width: number, height: number, context: RunContext): Promise<string[]> {
	const texture = await writeTexturedBackground(stageDirectory, width, height);
	return compact([
		await runFfmpeg(
			[
				"-y",
				"-f",
				"lavfi",
				"-i",
				`color=c=0xf5f3ed:s=${width}x${height}`,
				"-i",
				still,
				"-filter_complex",
				"[0:v][1:v]overlay=0:0:format=auto[out]",
				"-map",
				"[out]",
				"-frames:v",
				"1",
				path.join(stageDirectory, "still-on-cream.png"),
			],
			"transparent animation still cream composite",
			context,
		),
		await runFfmpeg(
			[
				"-y",
				"-f",
				"lavfi",
				"-i",
				`color=c=0xff0000:s=${width}x${height}`,
				"-i",
				still,
				"-filter_complex",
				"[0:v][1:v]overlay=0:0:format=auto[out]",
				"-map",
				"[out]",
				"-frames:v",
				"1",
				path.join(stageDirectory, "still-on-red.png"),
			],
			"transparent animation still red composite",
			context,
		),
		await runFfmpeg(
			[
				"-y",
				"-f",
				"lavfi",
				"-i",
				`color=c=0x2b2925:s=${width}x${height}`,
				"-i",
				still,
				"-filter_complex",
				"[0:v][1:v]overlay=0:0:format=auto[out]",
				"-map",
				"[out]",
				"-frames:v",
				"1",
				path.join(stageDirectory, "still-on-dark.png"),
			],
			"transparent animation still dark composite",
			context,
		),
		await runFfmpeg(
			[
				"-y",
				"-i",
				texture,
				"-i",
				still,
				"-filter_complex",
				"[0:v][1:v]overlay=0:0:format=auto[out]",
				"-map",
				"[out]",
				"-frames:v",
				"1",
				path.join(stageDirectory, "still-on-texture.png"),
			],
			"transparent animation still texture composite",
			context,
		),
	]);
}

async function encodeRgbaFrameOutputs(stageDirectory: string, frameRate: string, width: number, height: number, context: RunContext): Promise<string[]> {
	const framePattern = path.join(stageDirectory, "rgba-frames", "frame-%05d.png");
	const prores = path.join(stageDirectory, "prores.mov");
	const foreground = path.join(stageDirectory, "foreground.mov");
	const webm = path.join(stageDirectory, "webm.webm");
	const apng = path.join(stageDirectory, "apng.png");
	const alpha = path.join(stageDirectory, "alpha.mp4");
	const creamPreview = path.join(stageDirectory, "preview-on-cream.mp4");
	const commandLogs = compact([
		await runFfmpeg(
			[
				"-y",
				"-framerate",
				frameRate,
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
				foreground,
			],
			"transparent animation prores export",
			context,
		),
	]);
	await copyFile(foreground, prores);
	commandLogs.push(...compact([
		await runFfmpeg(
			[
				"-y",
				"-framerate",
				frameRate,
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
				webm,
			],
			"transparent animation webm export",
			context,
		),
		await runFfmpeg(
			[
				"-y",
				"-framerate",
				frameRate,
				"-i",
				framePattern,
				"-plays",
				"0",
				"-f",
				"apng",
				apng,
			],
			"transparent animation apng export",
			context,
		),
		await runFfmpeg(
			[
				"-y",
				"-framerate",
				frameRate,
				"-i",
				framePattern,
				"-vf",
				"alphaextract,format=yuv420p",
				"-c:v",
				"libx264",
				"-crf",
				"16",
				"-pix_fmt",
				"yuv420p",
				"-an",
				alpha,
			],
			"transparent animation alpha export",
			context,
		),
		await runFfmpeg(
			[
				"-y",
				"-f",
				"lavfi",
				"-i",
				`color=c=0xf5f3ed:s=${width}x${height}:r=${frameRate}`,
				"-i",
				foreground,
				"-filter_complex",
				"[0:v][1:v]overlay=shortest=1:format=auto[out]",
				"-map",
				"[out]",
				"-c:v",
				"libx264",
				"-crf",
				"18",
				"-pix_fmt",
				"yuv420p",
				"-an",
				creamPreview,
			],
			"transparent animation cream preview export",
			context,
		),
	]));
	return commandLogs;
}

async function runRembgPriorFrames(
	sourceFramesDirectory: string,
	priorFramesDirectory: string,
	settings: V4PriorFusionSettings,
	context: RunContext,
	forcePrior: boolean,
): Promise<string | undefined> {
	if (forcePrior) {
		await rm(priorFramesDirectory, { force: true, recursive: true });
	}
	await ensureDirectory(priorFramesDirectory);
	const sourceFramePaths = await listFrameFiles(sourceFramesDirectory);
	const existingPriorNames = new Set((await listFrameFiles(priorFramesDirectory)).map((frame) => path.basename(frame)));
	const missingSourceFramePaths = sourceFramePaths.filter((frame) => !existingPriorNames.has(path.basename(frame)));
	if (missingSourceFramePaths.length === 0) {
		return undefined;
	}
	const priorSourceFramesDirectory = path.join(path.dirname(priorFramesDirectory), "prior-source-frames");
	await rm(priorSourceFramesDirectory, { force: true, recursive: true });
	await ensureDirectory(priorSourceFramesDirectory);
	for (const framePath of missingSourceFramePaths) {
		await copyFile(framePath, path.join(priorSourceFramesDirectory, path.basename(framePath)));
	}
	const result = await runCommand(
		"uvx",
		["--from", settings.priorPackage, "rembg", "p", "-m", settings.priorModel, priorSourceFramesDirectory, priorFramesDirectory],
		"celstate alpha v4 rembg prior extraction",
		context,
	);
	await rm(priorSourceFramesDirectory, { force: true, recursive: true });
	return result.logPath;
}

async function runCelstateAlphaV2Trimap(args: ParsedArgs): Promise<void> {
	const root = spikeRoot(args);
	const runId = getRequiredOption(args, "run-id");
	const { directory, input } = await requireRunInput(root, runId);
	const context: RunContext = { directory, runId };
	const stage: Stage = "celstate-alpha-v2-trimap";
	const requiredOutputs = ["alpha.mp4", "foreground.mov", "webm.webm", "prores.mov", "apng.png", "still.png", "report.json"] as const;
	if (await skipCompletedStage(context, stage, requiredOutputs, forceRequested(args))) {
		return;
	}

	const stageDirectory = path.join(directory, stage);
	await ensureDirectory(stageDirectory);

	await runDurableStep(context, stage, async () => {
		const source = await requireSourceMp4(directory);
		const settings = v2TrimapSettings(input, args);
		const sourceProbe = await ffprobeJson(source, context);
		const frameRate = frameRateFromProbe(sourceProbe);
		const sourceFramesDirectory = path.join(stageDirectory, "source-frames");
		const rgbaFramesDirectory = path.join(stageDirectory, "rgba-frames");
		const framePaths = await extractSourceFrames(source, sourceFramesDirectory, context);
		await rm(rgbaFramesDirectory, { force: true, recursive: true });
		await ensureDirectory(rgbaFramesDirectory);
		const samplePaths = sampleFramePaths(framePaths, settings.backgroundSampleCount);
		const samples = await Promise.all(samplePaths.map((frame) => readRgbImage(frame)));
		const estimatedKeyColor = estimatePlateColor(samples, parseRgbColor(settings.keyColor));
		const background = buildBackgroundImage(samples, estimatedKeyColor);
		await writeRgbImage(background, path.join(stageDirectory, "background-plate.png"));
		const alphaCoverages: number[] = [];
		let width = background.width;
		let height = background.height;
		const selectedFrameIndex = Math.min(framePaths.length - 1, settings.selectedFrame - 1);
		for (let index = 0; index < framePaths.length; index += 1) {
			const frame = await readRgbImage(framePaths[index]);
			width = frame.width;
			height = frame.height;
			const rgba = createV2RgbaFrame(frame, background, settings);
			alphaCoverages.push(rgba.alphaCoverage);
			const output = path.join(rgbaFramesDirectory, `frame-${String(index + 1).padStart(5, "0")}.png`);
			await writeRgbaImage(rgba.data, frame.width, frame.height, output);
			if (index === selectedFrameIndex) {
				await copyFile(output, path.join(stageDirectory, "still.png"));
			}
		}
		const commandLogs = [
			...await writeCompositeStill(stageDirectory, path.join(stageDirectory, "still.png"), width, height, context),
			...await encodeRgbaFrameOutputs(stageDirectory, frameRate, width, height, context),
		];
		await writeStageReport(directory, stage, {
			alphaCoverage: {
				average: Number((alphaCoverages.reduce((sum, value) => sum + value, 0) / alphaCoverages.length).toFixed(4)),
				max: Number(Math.max(...alphaCoverages).toFixed(4)),
				min: Number(Math.min(...alphaCoverages).toFixed(4)),
			},
			commandLogs,
			estimatedKeyColor: rgbToHex(estimatedKeyColor),
			frameCount: framePaths.length,
			frameRate,
			note:
				"Alpha Compiler v2: temporal background-plate selection, border-connected sure-background removal, foreground-preserving alpha clamp, edge foreground color recovery, and fringe-gated despill.",
			outputs: {
				alpha: "alpha.mp4",
				apng: "apng.png",
				background: "background-plate.png",
				foreground: "foreground.mov",
				previewOnCream: "preview-on-cream.mp4",
				prores: "prores.mov",
				still: "still.png",
				stillOnCream: "still-on-cream.png",
				stillOnRed: "still-on-red.png",
				webm: "webm.webm",
			},
			settings,
			sourceProbe,
		});

		return { commandLog: commandLogs[commandLogs.length - 1], outputs: requiredOutputs.map((output) => `${stage}/${output}`) };
	});

	console.log(`wrote Celstate alpha v2 trimap for ${runId}`);
}

async function runCelstateAlphaV3CoreFringe(args: ParsedArgs): Promise<void> {
	const root = spikeRoot(args);
	const runId = getRequiredOption(args, "run-id");
	const { directory, input } = await requireRunInput(root, runId);
	const context: RunContext = { directory, runId };
	const stage: Stage = "celstate-alpha-v3-core-fringe";
	const requiredOutputs = ["alpha.mp4", "foreground.mov", "webm.webm", "prores.mov", "apng.png", "still.png", "report.json"] as const;
	if (await skipCompletedStage(context, stage, requiredOutputs, forceRequested(args))) {
		return;
	}

	const stageDirectory = path.join(directory, stage);
	await ensureDirectory(stageDirectory);

	await runDurableStep(context, stage, async () => {
		const source = await requireSourceMp4(directory);
		const chroma = chromaSettingsFromInputAndArgs(input, args);
		const settings = v3CoreFringeSettings(input, args);
		const sourceProbe = await ffprobeJson(source, context);
		const frameRate = frameRateFromProbe(sourceProbe);
		const sourceFramesDirectory = path.join(stageDirectory, "source-frames");
		const alphaFramesDirectory = path.join(stageDirectory, "rough-alpha-frames");
		const rgbaFramesDirectory = path.join(stageDirectory, "rgba-frames");
		const framePaths = await extractSourceFrames(source, sourceFramesDirectory, context);
		const alphaPaths = await extractRoughAlphaFrames(source, alphaFramesDirectory, chroma, context);
		if (framePaths.length !== alphaPaths.length) {
			throw new Error(`Source frame count ${framePaths.length} does not match alpha frame count ${alphaPaths.length}.`);
		}
		await rm(rgbaFramesDirectory, { force: true, recursive: true });
		await ensureDirectory(rgbaFramesDirectory);
		const alphaCoverages: number[] = [];
		const coreCoverages: number[] = [];
		const fringeCoverages: number[] = [];
		const repairedFringeCoverages: number[] = [];
		const dominantChannelReductions: number[] = [];
		let width = 0;
		let height = 0;
		const selectedFrameIndex = Math.min(framePaths.length - 1, settings.selectedFrame - 1);
		for (let index = 0; index < framePaths.length; index += 1) {
			const frame = await readRgbImage(framePaths[index]);
			const roughAlpha = await readGrayImage(alphaPaths[index]);
			width = frame.width;
			height = frame.height;
			const rgba = createV3RgbaFrame(frame, roughAlpha, settings);
			alphaCoverages.push(rgba.alphaCoverage);
			coreCoverages.push(rgba.coreCoverage);
			fringeCoverages.push(rgba.fringeCoverage);
			repairedFringeCoverages.push(rgba.repairedFringeCoverage);
			dominantChannelReductions.push(rgba.averageDominantChannelReduction);
			const output = path.join(rgbaFramesDirectory, `frame-${String(index + 1).padStart(5, "0")}.png`);
			await writeRgbaImage(rgba.data, frame.width, frame.height, output);
			if (index === selectedFrameIndex) {
				await copyFile(output, path.join(stageDirectory, "still.png"));
			}
		}
		const commandLogs = [
			...await writeCompositeStill(stageDirectory, path.join(stageDirectory, "still.png"), width, height, context),
			...await encodeRgbaFrameOutputs(stageDirectory, frameRate, width, height, context),
		];
		await writeStageReport(directory, stage, {
			alphaCoverage: summarizeMetric(alphaCoverages),
			chroma,
			commandLogs,
			coreCoverage: summarizeMetric(coreCoverages),
			dominantChannelReduction: summarizeMetric(dominantChannelReductions),
			frameCount: framePaths.length,
			frameRate,
			fringeCoverage: summarizeMetric(fringeCoverages),
			note:
				"Alpha Compiler v3: rough chroma alpha is split into protected foreground core and edge fringe. Core RGB stays untouched while partial/near-edge pixels get stronger key-color decontamination and partial-alpha foreground recovery.",
			outputs: {
				alpha: "alpha.mp4",
				apng: "apng.png",
				foreground: "foreground.mov",
				previewOnCream: "preview-on-cream.mp4",
				prores: "prores.mov",
				repairedFringeCoverage: "reported",
				still: "still.png",
				stillOnCream: "still-on-cream.png",
				stillOnDark: "still-on-dark.png",
				stillOnRed: "still-on-red.png",
				stillOnTexture: "still-on-texture.png",
				textureBackground: "texture-background.png",
				webm: "webm.webm",
			},
			repairedFringeCoverage: summarizeMetric(repairedFringeCoverages),
			settings,
			sourceProbe,
		});

		return { commandLog: commandLogs[commandLogs.length - 1], outputs: requiredOutputs.map((output) => `${stage}/${output}`) };
	});

	console.log(`wrote Celstate alpha v3 core/fringe for ${runId}`);
}

async function runCelstateAlphaV4PriorFusion(args: ParsedArgs): Promise<void> {
	const root = spikeRoot(args);
	const runId = getRequiredOption(args, "run-id");
	const { directory, input } = await requireRunInput(root, runId);
	const context: RunContext = { directory, runId };
	const stage: Stage = "celstate-alpha-v4-prior-fusion";
	const requiredOutputs = ["alpha.mp4", "foreground.mov", "webm.webm", "prores.mov", "apng.png", "still.png", "report.json"] as const;
	if (await skipCompletedStage(context, stage, requiredOutputs, forceRequested(args))) {
		return;
	}

	const stageDirectory = path.join(directory, stage);
	await ensureDirectory(stageDirectory);

	await runDurableStep(context, stage, async () => {
		const source = await requireSourceMp4(directory);
		const chroma = chromaSettingsFromInputAndArgs(input, args);
		const settings = v4PriorFusionSettings(input, args);
		const sourceProbe = await ffprobeJson(source, context);
		const frameRate = frameRateFromProbe(sourceProbe);
		const sourceFramesDirectory = path.join(stageDirectory, "source-frames");
		const alphaFramesDirectory = path.join(stageDirectory, "rough-alpha-frames");
		const priorFramesDirectory = path.join(stageDirectory, "prior-frames");
		const rgbaFramesDirectory = path.join(stageDirectory, "rgba-frames");
		const framePaths = await extractSourceFrames(source, sourceFramesDirectory, context);
		const alphaPaths = await extractRoughAlphaFrames(source, alphaFramesDirectory, chroma, context);
		const priorCommandLog = await runRembgPriorFrames(sourceFramesDirectory, priorFramesDirectory, settings, context, getOption(args, "force-prior") === "true");
		const priorPaths = await listFrameFiles(priorFramesDirectory);
		if (framePaths.length !== alphaPaths.length) {
			throw new Error(`Source frame count ${framePaths.length} does not match rough alpha frame count ${alphaPaths.length}.`);
		}
		if (framePaths.length !== priorPaths.length) {
			throw new Error(`Source frame count ${framePaths.length} does not match prior frame count ${priorPaths.length}.`);
		}
		await rm(rgbaFramesDirectory, { force: true, recursive: true });
		await ensureDirectory(rgbaFramesDirectory);
		const alphaCoverages: number[] = [];
		const chromaSuppressedCoverages: number[] = [];
		const coreCoverages: number[] = [];
		const fringeCoverages: number[] = [];
		const repairedFringeCoverages: number[] = [];
		const dominantChannelReductions: number[] = [];
		let width = 0;
		let height = 0;
		const selectedFrameIndex = Math.min(framePaths.length - 1, settings.selectedFrame - 1);
		for (let index = 0; index < framePaths.length; index += 1) {
			const frame = await readRgbImage(framePaths[index]);
			const prior = await readRgbaImage(priorPaths[index]);
			const roughAlpha = await readGrayImage(alphaPaths[index]);
			width = frame.width;
			height = frame.height;
			const rgba = createV4RgbaFrame(frame, prior, roughAlpha, settings);
			alphaCoverages.push(rgba.alphaCoverage);
			chromaSuppressedCoverages.push(rgba.chromaSuppressedCoverage);
			coreCoverages.push(rgba.coreCoverage);
			fringeCoverages.push(rgba.fringeCoverage);
			repairedFringeCoverages.push(rgba.repairedFringeCoverage);
			dominantChannelReductions.push(rgba.averageDominantChannelReduction);
			const output = path.join(rgbaFramesDirectory, `frame-${String(index + 1).padStart(5, "0")}.png`);
			await writeRgbaImage(rgba.data, frame.width, frame.height, output);
			if (index === selectedFrameIndex) {
				await copyFile(output, path.join(stageDirectory, "still.png"));
				await copyFile(priorPaths[index], path.join(stageDirectory, "prior-still.png"));
			}
		}
		const commandLogs = [
			...compact([priorCommandLog]),
			...await writeCompositeStill(stageDirectory, path.join(stageDirectory, "still.png"), width, height, context),
			...await encodeRgbaFrameOutputs(stageDirectory, frameRate, width, height, context),
		];
		await writeStageReport(directory, stage, {
			alphaCoverage: summarizeMetric(alphaCoverages),
			chroma,
			chromaSuppressedCoverage: summarizeMetric(chromaSuppressedCoverages),
			commandLogs,
			coreCoverage: summarizeMetric(coreCoverages),
			dominantChannelReduction: summarizeMetric(dominantChannelReductions),
			frameCount: framePaths.length,
			frameRate,
			fringeCoverage: summarizeMetric(fringeCoverages),
			note:
				"Alpha Compiler v4: off-the-shelf rembg prior fused with chroma evidence. The external prior supplies the matte, chroma only suppresses likely background leakage, and Celstate preserves core RGB while applying conservative fringe despill.",
			outputs: {
				alpha: "alpha.mp4",
				apng: "apng.png",
				foreground: "foreground.mov",
				previewOnCream: "preview-on-cream.mp4",
				priorStill: "prior-still.png",
				prores: "prores.mov",
				repairedFringeCoverage: "reported",
				still: "still.png",
				stillOnCream: "still-on-cream.png",
				stillOnDark: "still-on-dark.png",
				stillOnRed: "still-on-red.png",
				stillOnTexture: "still-on-texture.png",
				textureBackground: "texture-background.png",
				webm: "webm.webm",
			},
			repairedFringeCoverage: summarizeMetric(repairedFringeCoverages),
			settings,
			sourceProbe,
		});

		return { commandLog: commandLogs[commandLogs.length - 1], outputs: requiredOutputs.map((output) => `${stage}/${output}`) };
	});

	console.log(`wrote Celstate alpha v4 prior fusion for ${runId}`);
}

async function discoverPriorAlphaDirectory(matanyoneRoot: string): Promise<string | undefined> {
	if (!existsSync(matanyoneRoot)) {
		return undefined;
	}
	const entries = await readdir(matanyoneRoot, { withFileTypes: true });
	for (const entry of entries) {
		if (!entry.isDirectory()) {
			continue;
		}
		const phaDirectory = path.join(matanyoneRoot, entry.name, "pha");
		if (!existsSync(phaDirectory)) {
			continue;
		}
		const files = await readdir(phaDirectory);
		if (files.some((file) => /\.png$/iu.test(file))) {
			return phaDirectory;
		}
	}
	return undefined;
}

async function listPriorAlphaFiles(directory: string): Promise<string[]> {
	if (!existsSync(directory)) {
		throw new Error(
			`Missing prior alpha directory: ${directory}. Run video-prior or MatAnyone2 with --save-image, then pass --prior-alpha-dir if the alpha frames live elsewhere.`,
		);
	}
	const files = await readdir(directory);
	return files
		.filter((file) => /\.png$/iu.test(file))
		.sort()
		.map((file) => path.join(directory, file));
}

async function runCelstateAlphaV5VideoPrior(args: ParsedArgs): Promise<void> {
	const root = spikeRoot(args);
	const runId = getRequiredOption(args, "run-id");
	const { directory, input } = await requireRunInput(root, runId);
	const context: RunContext = { directory, runId };
	const stage: Stage = "celstate-alpha-v5-video-prior";
	const requiredOutputs = ["alpha.mp4", "foreground.mov", "webm.webm", "prores.mov", "apng.png", "still.png", "report.json"] as const;
	if (await skipCompletedStage(context, stage, requiredOutputs, forceRequested(args))) {
		return;
	}

	const stageDirectory = path.join(directory, stage);
	await ensureDirectory(stageDirectory);

	await runDurableStep(context, stage, async () => {
		const source = await requireSourceMp4(directory);
		const chroma = chromaSettingsFromInputAndArgs(input, args);
		const settings = v5VideoPriorSettings(input, args, stageDirectory);
		const sourceProbe = await ffprobeJson(source, context);
		const frameRate = frameRateFromProbe(sourceProbe);
		const sourceFramesDirectory = path.join(stageDirectory, "fusion-source-frames");
		const alphaFramesDirectory = path.join(stageDirectory, "rough-alpha-frames");
		const rgbaFramesDirectory = path.join(stageDirectory, "rgba-frames");
		const framePaths = await extractSourceFrames(source, sourceFramesDirectory, context);
		const alphaPaths = await extractSharpChromaAlphaFrames(source, alphaFramesDirectory, chroma, context);
		const priorPaths = await listPriorAlphaFiles(settings.priorAlphaDir);
		if (framePaths.length !== alphaPaths.length) {
			throw new Error(`Source frame count ${framePaths.length} does not match rough alpha frame count ${alphaPaths.length}.`);
		}
		if (framePaths.length !== priorPaths.length) {
			throw new Error(
				`Source frame count ${framePaths.length} does not match video prior alpha frame count ${priorPaths.length} in ${settings.priorAlphaDir}.`,
			);
		}
		await rm(rgbaFramesDirectory, { force: true, recursive: true });
		await ensureDirectory(rgbaFramesDirectory);
		const alphaCoverages: number[] = [];
		const coreCoverages: number[] = [];
		const fringeCoverages: number[] = [];
		const leafAddedCoverages: number[] = [];
		const priorCoverages: number[] = [];
		const pulledFringeCoverages: number[] = [];
		const spillPulls: number[] = [];
		let width = 0;
		let height = 0;
		const selectedFrameIndex = Math.min(framePaths.length - 1, settings.selectedFrame - 1);
		for (let index = 0; index < framePaths.length; index += 1) {
			const frame = await readRgbImage(framePaths[index]);
			const priorAlpha = await readGrayImage(priorPaths[index]);
			const chromaAlpha = await readGrayImage(alphaPaths[index]);
			width = frame.width;
			height = frame.height;
			const rgba = createV5RgbaFrame(frame, priorAlpha, chromaAlpha, settings);
			alphaCoverages.push(rgba.alphaCoverage);
			coreCoverages.push(rgba.coreCoverage);
			fringeCoverages.push(rgba.fringeCoverage);
			leafAddedCoverages.push(rgba.leafAddedCoverage);
			priorCoverages.push(rgba.priorCoverage);
			pulledFringeCoverages.push(rgba.pulledFringeCoverage);
			spillPulls.push(rgba.averageSpillPull);
			const output = path.join(rgbaFramesDirectory, `frame-${String(index + 1).padStart(5, "0")}.png`);
			await writeRgbaImage(rgba.data, frame.width, frame.height, output);
			if (index === selectedFrameIndex) {
				await copyFile(output, path.join(stageDirectory, "still.png"));
				await copyFile(priorPaths[index], path.join(stageDirectory, "prior-alpha-still.png"));
			}
		}
		const commandLogs = [
			...await writeCompositeStill(stageDirectory, path.join(stageDirectory, "still.png"), width, height, context),
			...await encodeRgbaFrameOutputs(stageDirectory, frameRate, width, height, context),
		];
		await writeStageReport(directory, stage, {
			alphaCoverage: summarizeMetric(alphaCoverages),
			chroma,
			commandLogs,
			coreCoverage: summarizeMetric(coreCoverages),
			frameCount: framePaths.length,
			frameRate,
			fringeCoverage: summarizeMetric(fringeCoverages),
			leafAddedCoverage: summarizeMetric(leafAddedCoverages),
			note:
				"Alpha Compiler v5: temporally propagated video matting prior (MatAnyone2 seeded from a first-frame mask) supplies the subject matte. Chroma evidence only re-adds detached secondary elements (falling leaves) away from the subject guard band. Fringe RGB is repaired by pulling toward inward core colors gated by key-channel spill confidence, plus a light residual despill; no partial-alpha chroma equation recovery.",
			outputs: {
				alpha: "alpha.mp4",
				apng: "apng.png",
				foreground: "foreground.mov",
				previewOnCream: "preview-on-cream.mp4",
				priorAlphaStill: "prior-alpha-still.png",
				prores: "prores.mov",
				still: "still.png",
				stillOnCream: "still-on-cream.png",
				stillOnDark: "still-on-dark.png",
				stillOnRed: "still-on-red.png",
				stillOnTexture: "still-on-texture.png",
				textureBackground: "texture-background.png",
				webm: "webm.webm",
			},
			priorAlphaDir: relativeToWorkspace(settings.priorAlphaDir),
			priorCoverage: summarizeMetric(priorCoverages),
			pulledFringeCoverage: summarizeMetric(pulledFringeCoverages),
			settings,
			sourceProbe,
			spillPull: summarizeMetric(spillPulls),
		});

		return { commandLog: commandLogs[commandLogs.length - 1], outputs: requiredOutputs.map((output) => `${stage}/${output}`) };
	});

	console.log(`wrote Celstate alpha v5 video prior for ${runId}`);
}

async function createSeedMaskFromPrior(
	priorRgbaPath: string,
	maskPath: string,
	threshold: number,
): Promise<void> {
	const prior = await readRgbaImage(priorRgbaPath);
	const pixelCount = prior.width * prior.height;
	const mask = Buffer.alloc(pixelCount);
	for (let pixel = 0; pixel < pixelCount; pixel += 1) {
		const alpha = prior.data[pixel * 4 + 3];
		mask[pixel] = alpha >= threshold ? 255 : 0;
	}
	await sharp(mask, {
		raw: {
			channels: 1,
			height: prior.height,
			width: prior.width,
		},
	}).png().toFile(maskPath);
}

async function runVideoPrior(args: ParsedArgs): Promise<void> {
	const root = spikeRoot(args);
	const runId = getRequiredOption(args, "run-id");
	const { directory, input } = await requireRunInput(root, runId);
	const context: RunContext = { directory, runId };
	const stage: Stage = "video-prior";
	const requiredOutputs = ["first-frame-mask.png", "report.json"] as const;
	if (await skipCompletedStage(context, stage, requiredOutputs, forceRequested(args))) {
		return;
	}

	const stageDirectory = path.join(directory, stage);
	await ensureDirectory(stageDirectory);

	await runDurableStep(context, stage, async () => {
		const source = await requireSourceMp4(directory);
		const settings = videoPriorSettings(args);
		const sourceProbe = await ffprobeJson(source, context);
		const firstFramePath = path.join(stageDirectory, "first-frame.png");
		const firstFramePriorPath = path.join(stageDirectory, "first-frame-prior.png");
		const firstFrameMaskPath = path.join(stageDirectory, "first-frame-mask.png");
		const matanyoneOutputRoot = path.join(stageDirectory, "matanyone2");
		let priorAlphaDir = path.join(matanyoneOutputRoot, path.parse(source).name, "pha");
		const commandLogs: string[] = [];

		const firstFrameLog = await runFfmpeg(
			["-y", "-i", source, "-frames:v", "1", firstFramePath],
			"video prior first frame extraction",
			context,
		);
		if (firstFrameLog) {
			commandLogs.push(firstFrameLog);
		}

		const rembgResult = await runCommand(
			"uvx",
			["--from", settings.priorPackage, "rembg", "i", "-m", settings.priorModel, firstFramePath, firstFramePriorPath],
			"video prior rembg first-frame seed",
			context,
		);
		if (rembgResult.logPath) {
			commandLogs.push(rembgResult.logPath);
		}

		await createSeedMaskFromPrior(firstFramePriorPath, firstFrameMaskPath, settings.maskThreshold);

		const matanyoneCliArgs = [
			"-i",
			source,
			"-m",
			firstFrameMaskPath,
			"-o",
			matanyoneOutputRoot,
			"--save-image",
		];
		if (settings.maxSize !== undefined) {
			matanyoneCliArgs.push("--max-size", String(settings.maxSize));
		}

		let matanyoneStatus: "failed" | "skipped" | "succeeded" = "skipped";
		let matanyoneError: string | undefined;
		try {
			const matanyoneResult = settings.matanyoneViaWsl
				? await runCommand(
						"powershell",
						["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", path.join(process.cwd(), "scripts", "wsl", "matanyone2.ps1"), ...matanyoneCliArgs],
						"video prior matanyone2 inference (wsl)",
						context,
					)
				: await runCommand(
						"uvx",
						["--from", settings.matanyonePackage, settings.matanyoneCommand, ...matanyoneCliArgs],
						"video prior matanyone2 inference",
						context,
					);
			if (matanyoneResult.logPath) {
				commandLogs.push(matanyoneResult.logPath);
			}
			matanyoneStatus = "succeeded";
		} catch (error: unknown) {
			matanyoneStatus = "failed";
			matanyoneError = error instanceof Error ? error.message : String(error);
		}

		const discoveredPriorAlphaDir = await discoverPriorAlphaDirectory(matanyoneOutputRoot);
		if (discoveredPriorAlphaDir) {
			priorAlphaDir = discoveredPriorAlphaDir;
		}
		const priorPaths = existsSync(priorAlphaDir) ? await listPriorAlphaFiles(priorAlphaDir) : [];
		await writeStageReport(directory, stage, {
			commandLogs,
			frameCount: priorPaths.length,
			matanyoneError,
			matanyoneStatus,
			note:
				"Video prior stage: rembg bria-rmbg seeds a first-frame mask, then MatAnyone2 propagates alpha across the clip. Re-run with --force if MatAnyone2 was unavailable; pass --prior-alpha-dir to v6 when reusing an existing prior.",
			outputs: {
				firstFrame: "first-frame.png",
				firstFrameMask: "first-frame-mask.png",
				firstFramePrior: "first-frame-prior.png",
				priorAlphaDir: existsSync(priorAlphaDir) ? relativeToWorkspace(priorAlphaDir) : undefined,
			},
			priorAlphaDir: existsSync(priorAlphaDir) ? relativeToWorkspace(priorAlphaDir) : undefined,
			settings,
			sourceProbe,
		});

		return {
			commandLog: commandLogs[commandLogs.length - 1],
			outputs: [
				...requiredOutputs,
				...(priorPaths.length > 0 ? ["matanyone2/"] : []),
			],
		};
	});

	console.log(`wrote video prior artifacts for ${runId}`);
}

async function extractPriorAlphaFromRgbaFrames(rgbaFramesDirectory: string, alphaFramesDirectory: string): Promise<string[]> {
	await rm(alphaFramesDirectory, { force: true, recursive: true });
	await ensureDirectory(alphaFramesDirectory);
	const rgbaPaths = await listFrameFiles(rgbaFramesDirectory);
	const alphaPaths: string[] = [];
	for (const rgbaPath of rgbaPaths) {
		const rgba = await readRgbaImage(rgbaPath);
		const alpha = Buffer.alloc(rgba.width * rgba.height);
		for (let pixel = 0; pixel < alpha.length; pixel += 1) {
			alpha[pixel] = rgba.data[pixel * 4 + 3] ?? 0;
		}
		const output = path.join(alphaFramesDirectory, path.basename(rgbaPath));
		await sharp(alpha, {
			raw: {
				channels: 1,
				height: rgba.height,
				width: rgba.width,
			},
		}).png().toFile(output);
		alphaPaths.push(output);
	}
	return alphaPaths;
}

async function runPerFramePrior(args: ParsedArgs): Promise<void> {
	const root = spikeRoot(args);
	const runId = getRequiredOption(args, "run-id");
	const { directory } = await requireRunInput(root, runId);
	const context: RunContext = { directory, runId };
	const stage: Stage = "video-prior";
	const stageDirectory = path.join(directory, stage);
	const priorSettings = videoPriorSettings(args);
	const priorRgbaDirectory = path.join(stageDirectory, "per-frame-prior-rgba");
	const priorAlphaDirectory = getOption(args, "prior-alpha-dir") ?? path.join(stageDirectory, "per-frame-prior-alpha");
	const sourceFramesDirectory = path.join(stageDirectory, "source-frames");
	const source = await requireSourceMp4(directory);
	await ensureDirectory(stageDirectory);
	const sourceFramePaths = await extractSourceFrames(source, sourceFramesDirectory, context);
	await runRembgPriorFrames(
		sourceFramesDirectory,
		priorRgbaDirectory,
		{
			chromaBackgroundAlphaScale: 0.35,
			chromaTransparentCutoff: 8,
			coreAlphaThreshold: 244,
			despillMix: 0.65,
			fringeRadius: 3,
			keyColor: DEFAULT_CHROMA_COLOR,
			priorAlphaFloor: 4,
			priorModel: priorSettings.priorModel,
			priorPackage: priorSettings.priorPackage,
			selectedFrame: 1,
			transparentCutoff: 3,
		},
		context,
		forceRequested(args),
	);
	const alphaPaths = await extractPriorAlphaFromRgbaFrames(priorRgbaDirectory, priorAlphaDirectory);
	console.log(`wrote ${alphaPaths.length} per-frame prior alpha frames to ${relativeToWorkspace(priorAlphaDirectory)}`);
}

const GENERALIZATION_PROBE_BANNER =
	"Plumbing smoke test only — not quality evidence. Use `pnpm alpha-eval run && pnpm alpha-eval compare` for regression gating.";

async function generateProbeSources(args: ParsedArgs, options: { skipBanner?: boolean } = {}): Promise<void> {
	if (!options.skipBanner) {
		console.warn(GENERALIZATION_PROBE_BANNER);
	}
	const root = spikeRoot(args);
	const probeDirectory = path.join(root, "probes");
	await ensureDirectory(probeDirectory);
	const context: RunContext = { directory: probeDirectory, runId: "probe-generation" };
	const blueSource = path.join(probeDirectory, "probe-blue-screen.mp4");
	const glowSource = path.join(probeDirectory, "probe-green-glow.mp4");
	const durationSeconds = getNumberOption(args, "probe-duration", 1);
	const frameRate = "24";
	const size = "1280x720";
	await runFfmpeg(
		[
			"-y",
			"-f",
			"lavfi",
			"-i",
			`color=c=0x2040ff:s=${size}:r=${frameRate}:d=${durationSeconds}`,
			"-vf",
			"geq=r='if(lt(hypot(X-320+mod(T*90\\,520)\\,Y-360)\\,88)\\,178\\,32)':g='if(lt(hypot(X-320+mod(T*90\\,520)\\,Y-360)\\,88)\\,88\\,64)':b='if(lt(hypot(X-320+mod(T*90\\,520)\\,Y-360)\\,88)\\,48\\,255)'",
			"-c:v",
			"libx264",
			"-pix_fmt",
			"yuv420p",
			blueSource,
		],
		"generalization probe blue-screen source",
		context,
	);
	await runFfmpeg(
		[
			"-y",
			"-f",
			"lavfi",
			"-i",
			`color=c=0x23af42:s=${size}:r=${frameRate}:d=${durationSeconds}`,
			"-vf",
			"geq=r='if(lt(hypot(X-640\\,Y-360)\\,120+40*sin(2*PI*T/2))\\,245\\,35)':g='if(lt(hypot(X-640\\,Y-360)\\,120+40*sin(2*PI*T/2))\\,245\\,175)':b='if(lt(hypot(X-640\\,Y-360)\\,120+40*sin(2*PI*T/2))\\,245\\,66)'",
			"-c:v",
			"libx264",
			"-pix_fmt",
			"yuv420p",
			glowSource,
		],
		"generalization probe green-glow source",
		context,
	);
	console.log(`wrote probe sources:\n  ${relativeToWorkspace(blueSource)}\n  ${relativeToWorkspace(glowSource)}`);
}

async function promoteReviewCandidate(args: ParsedArgs): Promise<void> {
	const root = spikeRoot(args);
	const runId = getRequiredOption(args, "run-id");
	const stage = (getOption(args, "stage") ?? "celstate-alpha-v7") as Stage;
	const { directory } = await requireRunInput(root, runId);
	const stageDirectory = path.join(directory, stage);
	const reviewDirectory = path.join(root, "review", runId);
	await rm(reviewDirectory, { force: true, recursive: true });
	await ensureDirectory(reviewDirectory);
	const copyMap: Record<string, string> = {
		"animation-on-cream-preview.mp4": "preview-on-cream.mp4",
		"report.json": "report.json",
		"spill-heatmap.png": "spill-heatmap.png",
		"transparent-animation-prores.mov": "prores.mov",
		"transparent-animation.webm": "webm.webm",
		"transparent-still-on-cream.png": "still-on-cream.png",
		"transparent-still-on-dark.png": "still-on-dark.png",
		"transparent-still-on-red.png": "still-on-red.png",
		"transparent-still-on-texture.png": "still-on-texture.png",
		"transparent-still.png": "still.png",
	};
	const files = Object.keys(copyMap);
	for (const destinationName of files) {
		const sourceName = copyMap[destinationName];
		const sourcePath = path.join(stageDirectory, sourceName);
		if (!existsSync(sourcePath)) {
			throw new Error(`Missing review source artifact: ${sourcePath}`);
		}
		await copyFile(sourcePath, path.join(reviewDirectory, destinationName));
	}
	console.log(`promoted ${stage} review candidate to ${relativeToWorkspace(reviewDirectory)}`);
}

async function runGeneralizationProbes(args: ParsedArgs): Promise<void> {
	console.warn(GENERALIZATION_PROBE_BANNER);
	await generateProbeSources(args, { skipBanner: true });
	const root = spikeRoot(args);
	const probeDirectory = path.join(root, "probes");
	const blueRunId = getOption(args, "blue-run-id") ?? "probe-blue-screen-gp01";
	const glowRunId = getOption(args, "glow-run-id") ?? "probe-green-glow-gp02";
	const probes = [
		{
			keyColor: "#2040ff",
			promptId: "GP-01",
			runId: blueRunId,
			source: path.join(probeDirectory, "probe-blue-screen.mp4"),
		},
		{
			keyColor: "#23af42",
			promptId: "GP-02",
			runId: glowRunId,
			source: path.join(probeDirectory, "probe-green-glow.mp4"),
		},
	] as const;
	for (const probe of probes) {
		const probeRunDirectory = path.join(runsRoot(root), probe.runId);
		if (existsSync(path.join(probeRunDirectory, "input.json"))) {
			console.log(`reusing existing probe run ${probe.runId}`);
		} else {
			await createRun({
				command: "create-run",
				options: new Map([
					["prompt-id", [probe.promptId]],
					["source-mode", ["text-to-video"]],
					["key-color", [probe.keyColor]],
					["run-id", [probe.runId]],
				]),
				positionals: [],
			});
		}
		await attachSource({
			command: "attach-source",
			options: new Map([
				["run-id", [probe.runId]],
				["source", [probe.source]],
				["force", ["true"]],
			]),
			positionals: [],
		});
		const probeArgs: ParsedArgs = {
			command: "per-frame-prior",
			options: new Map([
				["run-id", [probe.runId]],
				...(forceRequested(args) ? [["force", ["true"]] as const] : []),
			]),
			positionals: [],
		};
		await runPerFramePrior(probeArgs);
		const priorAlphaDir = path.join(runsRoot(root), probe.runId, "video-prior", "per-frame-prior-alpha");
		await runCelstateAlphaV6Projection({
			command: "celstate-alpha-v6-projection",
			options: new Map([
				["run-id", [probe.runId]],
				["key-color", [probe.keyColor]],
				["prior-alpha-dir", [priorAlphaDir]],
				["force", ["true"]],
			]),
			positionals: [],
		});
	}
	console.log("generalization probes complete");
}

async function runCelstateAlphaV6Projection(args: ParsedArgs): Promise<void> {
	const root = spikeRoot(args);
	const runId = getRequiredOption(args, "run-id");
	const { directory, input } = await requireRunInput(root, runId);
	const context: RunContext = { directory, runId };
	const stage: Stage = "celstate-alpha-v6-projection";
	const requiredOutputs = ["alpha.mp4", "foreground.mov", "webm.webm", "prores.mov", "apng.png", "still.png", "report.json", "spill-heatmap.png"] as const;
	if (await skipCompletedStage(context, stage, requiredOutputs, forceRequested(args))) {
		return;
	}

	const stageDirectory = path.join(directory, stage);
	await ensureDirectory(stageDirectory);

	await runDurableStep(context, stage, async () => {
		const source = await requireSourceMp4(directory);
		const chroma = chromaSettingsFromInputAndArgs(input, args);
		const settings = v6ProjectionSettings(input, args, stageDirectory, directory);
		const sourceProbe = await ffprobeJson(source, context);
		const frameRate = frameRateFromProbe(sourceProbe);
		const sourceFramesDirectory = path.join(stageDirectory, "fusion-source-frames");
		const alphaFramesDirectory = path.join(stageDirectory, "rough-alpha-frames");
		const rgbaFramesDirectory = path.join(stageDirectory, "rgba-frames");
		const framePaths = await extractSourceFrames(source, sourceFramesDirectory, context);
		const alphaPaths = await extractSharpChromaAlphaFrames(source, alphaFramesDirectory, chroma, context);
		const priorPaths = await listPriorAlphaFiles(settings.priorAlphaDir);
		if (framePaths.length !== alphaPaths.length) {
			throw new Error(`Source frame count ${framePaths.length} does not match rough alpha frame count ${alphaPaths.length}.`);
		}
		if (framePaths.length !== priorPaths.length) {
			throw new Error(
				`Source frame count ${framePaths.length} does not match video prior alpha frame count ${priorPaths.length} in ${settings.priorAlphaDir}.`,
			);
		}
		await rm(rgbaFramesDirectory, { force: true, recursive: true });
		await ensureDirectory(rgbaFramesDirectory);
		const alphaCoverages: number[] = [];
		const coreCoverages: number[] = [];
		const fringeCoverages: number[] = [];
		const leafAddedCoverages: number[] = [];
		const priorCoverages: number[] = [];
		const projectedCoverages: number[] = [];
		const residualSpills: number[] = [];
		const detachedColorFidelities: number[] = [];
		const temporalAlphaDeltas: number[] = [];
		const perFrameMetrics: Array<Record<string, number>> = [];
		let width = 0;
		let height = 0;
		let previousAlpha: Uint8Array | undefined;
		const selectedFrameIndex = Math.min(framePaths.length - 1, settings.selectedFrame - 1);
		let selectedHeatmap: Uint8Array | undefined;
		for (let index = 0; index < framePaths.length; index += 1) {
			const frame = await readRgbImage(framePaths[index]);
			const priorAlpha = await readGrayImage(priorPaths[index]);
			const chromaAlpha = await readGrayImage(alphaPaths[index]);
			width = frame.width;
			height = frame.height;
			const rgba = createV6RgbaFrame(
				frame,
				priorAlpha,
				chromaAlpha,
				settings,
				previousAlpha,
				index === selectedFrameIndex,
			);
			alphaCoverages.push(rgba.alphaCoverage);
			coreCoverages.push(rgba.coreCoverage);
			fringeCoverages.push(rgba.fringeCoverage);
			leafAddedCoverages.push(rgba.leafAddedCoverage);
			priorCoverages.push(rgba.priorCoverage);
			projectedCoverages.push(rgba.projectedCoverage);
			residualSpills.push(rgba.residualSpill);
			detachedColorFidelities.push(rgba.detachedColorFidelity);
			temporalAlphaDeltas.push(rgba.temporalAlphaDelta);
			perFrameMetrics.push({
				alphaCoverage: Number(rgba.alphaCoverage.toFixed(6)),
				coreCoverage: Number(rgba.coreCoverage.toFixed(6)),
				detachedColorFidelity: Number(rgba.detachedColorFidelity.toFixed(6)),
				frame: index + 1,
				fringeCoverage: Number(rgba.fringeCoverage.toFixed(6)),
				leafAddedCoverage: Number(rgba.leafAddedCoverage.toFixed(6)),
				priorCoverage: Number(rgba.priorCoverage.toFixed(6)),
				projectedCoverage: Number(rgba.projectedCoverage.toFixed(6)),
				residualSpill: Number(rgba.residualSpill.toFixed(6)),
				temporalAlphaDelta: Number(rgba.temporalAlphaDelta.toFixed(6)),
			});
			const output = path.join(rgbaFramesDirectory, `frame-${String(index + 1).padStart(5, "0")}.png`);
			await writeRgbaImage(rgba.data, frame.width, frame.height, output);
			if (index === selectedFrameIndex) {
				await copyFile(output, path.join(stageDirectory, "still.png"));
				await copyFile(priorPaths[index], path.join(stageDirectory, "prior-alpha-still.png"));
				selectedHeatmap = rgba.spillHeatmap;
			}
			previousAlpha = new Uint8Array(frame.width * frame.height);
			for (let pixel = 0; pixel < previousAlpha.length; pixel += 1) {
				previousAlpha[pixel] = rgba.data[pixel * 4 + 3] ?? 0;
			}
		}
		if (selectedHeatmap) {
			await writeSpillHeatmap(selectedHeatmap, width, height, path.join(stageDirectory, "spill-heatmap.png"));
		}
		const commandLogs = [
			...await writeCompositeStill(stageDirectory, path.join(stageDirectory, "still.png"), width, height, context),
			...await encodeRgbaFrameOutputs(stageDirectory, frameRate, width, height, context),
		];
		await writeJson(path.join(stageDirectory, "per-frame-metrics.json"), perFrameMetrics);
		await writeStageReport(directory, stage, {
			alphaCoverage: summarizeMetric(alphaCoverages),
			chroma,
			commandLogs,
			coreCoverage: summarizeMetric(coreCoverages),
			detachedColorFidelity: summarizeMetric(detachedColorFidelities),
			frameCount: framePaths.length,
			frameRate,
			fringeCoverage: summarizeMetric(fringeCoverages),
			leafAddedCoverage: summarizeMetric(leafAddedCoverages),
			note:
				"Alpha Compiler v6: MatAnyone2 subject matte plus sharp chroma detached elements. RGB repair uses projection decontamination along the local background-to-reference axis with per-frame background plates and dual inward reference fills. Detached interiors keep source color; only edge bands are repaired.",
			outputs: {
				alpha: "alpha.mp4",
				apng: "apng.png",
				foreground: "foreground.mov",
				perFrameMetrics: "per-frame-metrics.json",
				previewOnCream: "preview-on-cream.mp4",
				priorAlphaStill: "prior-alpha-still.png",
				prores: "prores.mov",
				spillHeatmap: "spill-heatmap.png",
				still: "still.png",
				stillOnCream: "still-on-cream.png",
				stillOnDark: "still-on-dark.png",
				stillOnRed: "still-on-red.png",
				stillOnTexture: "still-on-texture.png",
				textureBackground: "texture-background.png",
				webm: "webm.webm",
			},
			priorAlphaDir: relativeToWorkspace(settings.priorAlphaDir),
			priorCoverage: summarizeMetric(priorCoverages),
			projectedCoverage: summarizeMetric(projectedCoverages),
			residualSpill: summarizeMetric(residualSpills),
			settings,
			sourceProbe,
			temporalAlphaDelta: summarizeMetric(temporalAlphaDeltas),
		});

		return { commandLog: commandLogs[commandLogs.length - 1], outputs: requiredOutputs.map((output) => `${stage}/${output}`) };
	});

	console.log(`wrote Celstate alpha v6 projection for ${runId}`);
}

async function runCelstateAlphaV7(args: ParsedArgs): Promise<void> {
	const root = spikeRoot(args);
	const runId = getRequiredOption(args, "run-id");
	const { directory, input } = await requireRunInput(root, runId);
	const context: RunContext = { directory, runId };
	const stage: Stage = "celstate-alpha-v7";
	const requiredOutputs = ["alpha.mp4", "foreground.mov", "webm.webm", "prores.mov", "apng.png", "still.png", "report.json", "spill-heatmap.png"] as const;
	if (await skipCompletedStage(context, stage, requiredOutputs, forceRequested(args))) {
		return;
	}

	const stageDirectory = path.join(directory, stage);
	await ensureDirectory(stageDirectory);

	await runDurableStep(context, stage, async () => {
		const source = await requireSourceMp4(directory);
		const chroma = chromaSettingsFromInputAndArgs(input, args);
		const settings = v6ProjectionSettings(input, args, stageDirectory, directory);
		const sourceProbe = await ffprobeJson(source, context);
		const frameRate = frameRateFromProbe(sourceProbe);
		const sourceFramesDirectory = path.join(stageDirectory, "fusion-source-frames");
		const alphaFramesDirectory = path.join(stageDirectory, "rough-alpha-frames");
		const rgbaFramesDirectory = path.join(stageDirectory, "rgba-frames");
		const framePaths = await extractSourceFrames(source, sourceFramesDirectory, context);
		const alphaPaths = await extractSharpChromaAlphaFrames(source, alphaFramesDirectory, chroma, context);
		const priorPaths = await listPriorAlphaFiles(settings.priorAlphaDir);
		if (framePaths.length !== alphaPaths.length) {
			throw new Error(`Source frame count ${framePaths.length} does not match rough alpha frame count ${alphaPaths.length}.`);
		}
		if (framePaths.length !== priorPaths.length) {
			throw new Error(
				`Source frame count ${framePaths.length} does not match video prior alpha frame count ${priorPaths.length} in ${settings.priorAlphaDir}.`,
			);
		}
		await rm(rgbaFramesDirectory, { force: true, recursive: true });
		await ensureDirectory(rgbaFramesDirectory);
		const alphaCoverages: number[] = [];
		const coreCoverages: number[] = [];
		const fringeCoverages: number[] = [];
		const leafAddedCoverages: number[] = [];
		const priorCoverages: number[] = [];
		const projectedCoverages: number[] = [];
		const residualSpills: number[] = [];
		const detachedColorFidelities: number[] = [];
		const temporalAlphaDeltas: number[] = [];
		const perFrameMetrics: Array<Record<string, number>> = [];
		let width = 0;
		let height = 0;
		let previousAlpha: Uint8Array | undefined;
		const selectedFrameIndex = Math.min(framePaths.length - 1, settings.selectedFrame - 1);
		let selectedHeatmap: Uint8Array | undefined;
		for (let index = 0; index < framePaths.length; index += 1) {
			const frame = await readRgbImage(framePaths[index]);
			const priorAlpha = await readGrayImage(priorPaths[index]);
			const chromaAlpha = await readGrayImage(alphaPaths[index]);
			width = frame.width;
			height = frame.height;
			const rgba = createV7RgbaFrame(
				frame,
				priorAlpha,
				chromaAlpha,
				settings,
				previousAlpha,
				index === selectedFrameIndex,
			);
			alphaCoverages.push(rgba.alphaCoverage);
			coreCoverages.push(rgba.coreCoverage);
			fringeCoverages.push(rgba.fringeCoverage);
			leafAddedCoverages.push(rgba.leafAddedCoverage);
			priorCoverages.push(rgba.priorCoverage);
			projectedCoverages.push(rgba.projectedCoverage);
			residualSpills.push(rgba.residualSpill);
			detachedColorFidelities.push(rgba.detachedColorFidelity);
			temporalAlphaDeltas.push(rgba.temporalAlphaDelta);
			perFrameMetrics.push({
				alphaCoverage: Number(rgba.alphaCoverage.toFixed(6)),
				coreCoverage: Number(rgba.coreCoverage.toFixed(6)),
				detachedColorFidelity: Number(rgba.detachedColorFidelity.toFixed(6)),
				frame: index + 1,
				fringeCoverage: Number(rgba.fringeCoverage.toFixed(6)),
				leafAddedCoverage: Number(rgba.leafAddedCoverage.toFixed(6)),
				priorCoverage: Number(rgba.priorCoverage.toFixed(6)),
				projectedCoverage: Number(rgba.projectedCoverage.toFixed(6)),
				residualSpill: Number(rgba.residualSpill.toFixed(6)),
				temporalAlphaDelta: Number(rgba.temporalAlphaDelta.toFixed(6)),
			});
			const output = path.join(rgbaFramesDirectory, `frame-${String(index + 1).padStart(5, "0")}.png`);
			await writeRgbaImage(rgba.data, frame.width, frame.height, output);
			if (index === selectedFrameIndex) {
				await copyFile(output, path.join(stageDirectory, "still.png"));
				await copyFile(priorPaths[index], path.join(stageDirectory, "prior-alpha-still.png"));
				selectedHeatmap = rgba.spillHeatmap;
			}
			previousAlpha = new Uint8Array(frame.width * frame.height);
			for (let pixel = 0; pixel < previousAlpha.length; pixel += 1) {
				previousAlpha[pixel] = rgba.data[pixel * 4 + 3] ?? 0;
			}
		}
		if (selectedHeatmap) {
			await writeSpillHeatmap(selectedHeatmap, width, height, path.join(stageDirectory, "spill-heatmap.png"));
		}
		const commandLogs = [
			...await writeCompositeStill(stageDirectory, path.join(stageDirectory, "still.png"), width, height, context),
			...await encodeRgbaFrameOutputs(stageDirectory, frameRate, width, height, context),
		];
		await writeJson(path.join(stageDirectory, "per-frame-metrics.json"), perFrameMetrics);
		await writeStageReport(directory, stage, {
			alphaCoverage: summarizeMetric(alphaCoverages),
			chroma,
			commandLogs,
			coreCoverage: summarizeMetric(coreCoverages),
			detachedColorFidelity: summarizeMetric(detachedColorFidelities),
			frameCount: framePaths.length,
			frameRate,
			fringeCoverage: summarizeMetric(fringeCoverages),
			leafAddedCoverage: summarizeMetric(leafAddedCoverages),
			note:
				"Alpha Compiler v7: Color-line alpha fusion + matting-equation foreground recovery + evidence-gated detached path. Per-pixel alpha is fused from the prior with a two-color line estimate; RGB is recovered by inverting straight-alpha compositing against a per-frame background plate. Detached elements are gated by color evidence rather than hard distance. Reference seeds are filtered by core proximity to prevent contaminated edges from polluting the fill.",
			outputs: {
				alpha: "alpha.mp4",
				apng: "apng.png",
				foreground: "foreground.mov",
				perFrameMetrics: "per-frame-metrics.json",
				previewOnCream: "preview-on-cream.mp4",
				priorAlphaStill: "prior-alpha-still.png",
				prores: "prores.mov",
				spillHeatmap: "spill-heatmap.png",
				still: "still.png",
				stillOnCream: "still-on-cream.png",
				stillOnDark: "still-on-dark.png",
				stillOnRed: "still-on-red.png",
				stillOnTexture: "still-on-texture.png",
				textureBackground: "texture-background.png",
				webm: "webm.webm",
			},
			priorAlphaDir: relativeToWorkspace(settings.priorAlphaDir),
			priorCoverage: summarizeMetric(priorCoverages),
			projectedCoverage: summarizeMetric(projectedCoverages),
			residualSpill: summarizeMetric(residualSpills),
			settings,
			sourceProbe,
			temporalAlphaDelta: summarizeMetric(temporalAlphaDeltas),
		});

		return { commandLog: commandLogs[commandLogs.length - 1], outputs: requiredOutputs.map((output) => `${stage}/${output}`) };
	});

	console.log(`wrote Celstate alpha v7 for ${runId}`);
}

async function ingestMattingBaseline(args: ParsedArgs): Promise<void> {
	const root = spikeRoot(args);
	const runId = getRequiredOption(args, "run-id");
	const { directory } = await requireRunInput(root, runId);
	const context: RunContext = { directory, runId };
	const stage: Stage = "matting-baseline";
	const requiredOutputs = ["alpha.mp4", "foreground.mov", "report.json"] as const;
	if (await skipCompletedStage(context, stage, requiredOutputs, forceRequested(args))) {
		return;
	}

	const stageDirectory = path.join(directory, stage);
	await ensureDirectory(stageDirectory);

	await runDurableStep(context, stage, async () => {
		const foreground = path.resolve(process.cwd(), getRequiredOption(args, "foreground"));
		const alpha = path.resolve(process.cwd(), getRequiredOption(args, "alpha"));
		await copyFile(foreground, path.join(stageDirectory, "foreground.mov"));
		await copyFile(alpha, path.join(stageDirectory, "alpha.mp4"));

		await writeStageReport(directory, stage, {
			notes: getOption(args, "notes") ?? "",
			outputs: {
				alpha: "alpha.mp4",
				foreground: "foreground.mov",
			},
			tool: getOption(args, "tool") ?? "external-matting-baseline",
		});

		return { outputs: requiredOutputs.map((output) => `${stage}/${output}`) };
	});

	console.log(`ingested matting baseline for ${runId}`);
}

function optionNameForMetric(metric: MetricKey): string {
	return metric.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`);
}

function readMetricScore(args: ParsedArgs, metric: MetricKey): number {
	const optionName = optionNameForMetric(metric);
	const value = getRequiredOption(args, optionName);
	const parsed = Number(value);
	if (!Number.isFinite(parsed) || parsed < 1 || parsed > 5) {
		throw new Error(`--${optionName} must be a number from 1 to 5. Got: ${value}`);
	}
	return parsed;
}

async function scoreRun(args: ParsedArgs): Promise<void> {
	const root = spikeRoot(args);
	const runId = getRequiredOption(args, "run-id");
	const stage = requireStage(getRequiredOption(args, "stage"));
	const { directory } = await requireRunInput(root, runId);
	const context: RunContext = { directory, runId };
	const metrics = Object.fromEntries(
		METRIC_KEYS.map((metric) => [metric, readMetricScore(args, metric)]),
	) as Record<MetricKey, number>;
	const aggregate = METRIC_KEYS.reduce((sum, metric) => sum + metrics[metric], 0) / METRIC_KEYS.length;
	const score: ManualScore = {
		aggregate: Number(aggregate.toFixed(2)),
		artifactPath: getOption(args, "artifact"),
		createdAt: new Date().toISOString(),
		failures: getOptions(args, "failure").map((failure) => slugify(failure)),
		metrics,
		notes: getOption(args, "notes") ?? "",
		stage,
	};

	const scoresPath = path.join(directory, "scores.json");
	const existing = existsSync(scoresPath)
		? await readJson<ScoresFile>(scoresPath)
		: { runId, scores: {}, updatedAt: new Date().toISOString() };
	await writeJson(scoresPath, {
		runId,
		scores: {
			...existing.scores,
			[stage]: score,
		},
		updatedAt: new Date().toISOString(),
	} satisfies ScoresFile);
	await appendRunEvent(context, {
		data: { aggregate: score.aggregate, failures: score.failures, scoredStage: stage },
		event: "stage_scored",
		level: "info",
		message: `${stage} scored ${score.aggregate.toFixed(2)}/5`,
		stage,
	});

	console.log(`${runId} ${stage} aggregate=${score.aggregate.toFixed(2)}/5`);
}

async function listPrompts(args: ParsedArgs): Promise<void> {
	const root = spikeRoot(args);
	const prompts = await loadPromptSuite(root);
	const keyColor = promptKeyColor(args);
	const sourceMode = sourceModeOption(args);
	for (const prompt of prompts) {
		console.log(`${prompt.id}\t${prompt.useCase}\t${prompt.title}`);
		if (getOption(args, "verbose") === "true") {
			console.log(`  base: ${prompt.prompt}`);
			console.log(`  chroma ${sourceMode} (${chromaKeyDescription(keyColor)}): ${promptForSourceMode(prompt.prompt, keyColor, sourceMode)}`);
		}
	}
}

async function processRun(args: ParsedArgs): Promise<void> {
	const root = spikeRoot(args);
	const runId = getRequiredOption(args, "run-id");
	await requireRunInput(root, runId);
	await runChromaBaseline(args);
	await runCelstateAlphaV0(args);
	await runCelstateAlphaV1Despill(args);
	await runCelstateAlphaV2Trimap(args);
	await runCelstateAlphaV3CoreFringe(args);
	await runCelstateAlphaV4PriorFusion(args);
	console.log(`processed local baselines for ${runId}`);
}

async function readRunEvents(directory: string, limit: number): Promise<RunEvent[]> {
	const filePath = eventsPath(directory);
	if (!existsSync(filePath)) {
		return [];
	}
	const lines = (await readFile(filePath, "utf8")).split(/\r?\n/).filter(Boolean);
	return lines
		.slice(Math.max(0, lines.length - limit))
		.map((line) => JSON.parse(line) as RunEvent);
}

async function printRunStatus(args: ParsedArgs): Promise<void> {
	const root = spikeRoot(args);
	const runId = getRequiredOption(args, "run-id");
	const { directory, input } = await requireRunInput(root, runId);
	const context: RunContext = { directory, runId };
	const state = await readPipelineState(context);
	const events = await readRunEvents(directory, getNumberOption(args, "events", 12));
	const providerCalls = await readProviderCalls(context);

	console.log(`run: ${runId}`);
	console.log(`directory: ${directory}`);
	console.log(`prompt: ${input.prompt.id} ${input.prompt.title}`);
	console.log(`source mode: ${input.sourceMode ?? "text-to-video"}`);
	console.log(`reference: ${existsSync(path.join(directory, "reference.png")) ? `present (${input.reference?.role ?? "unknown-role"})` : "missing"}`);
	console.log(`last frame: ${existsSync(path.join(directory, "last-frame.png")) ? "present" : "missing"}`);
	console.log(`source: ${existsSync(path.join(directory, "source.mp4")) ? "present" : "missing"}`);
	console.log(`provider artifacts: ${existsSync(providerDirectory(context)) ? relativeToWorkspace(providerDirectory(context)) : "missing"}`);
	console.log("steps:");
	for (const [step, stepState] of Object.entries(state.steps)) {
		const duration = stepState.durationMs === undefined ? "" : ` ${stepState.durationMs}ms`;
		const error = stepState.error ? ` error=${stepState.error.split(/\r?\n/)[0]}` : "";
		const log = stepState.commandLog ? ` log=${stepState.commandLog}` : "";
		console.log(`  ${step}: ${stepState.status}${duration}${log}${error}`);
	}
	if (Object.keys(state.steps).length === 0) {
		console.log("  none yet");
	}
	console.log("recent events:");
	for (const event of events) {
		console.log(`  ${event.timestamp} ${event.level} ${event.stage ?? "run"} ${event.event}: ${event.message}`);
	}
	if (events.length === 0) {
		console.log("  none yet");
	}
	console.log("provider calls:");
	for (const call of providerCalls) {
		const cost = call.metadata && typeof call.metadata.estimatedProviderCostUsd === "number" ? ` cost=$${call.metadata.estimatedProviderCostUsd}` : "";
		const duration = call.durationMs === undefined ? "" : ` ${call.durationMs}ms`;
		const error = call.error ? ` error=${call.error.split(/\r?\n/)[0]}` : "";
		console.log(`  ${call.call}: ${call.status}${duration}${cost}${error}`);
	}
	if (providerCalls.length === 0) {
		console.log("  none yet");
	}
	console.log(`logs: ${relativeToWorkspace(path.join(directory, "logs"))}`);
}

async function summary(args: ParsedArgs): Promise<void> {
	const root = spikeRoot(args);
	const runRoot = runsRoot(root);
	await ensureDirectory(runRoot);
	const entries = await readdir(runRoot);
	const rows: Array<Record<string, unknown>> = [];
	const failures = new Map<string, number>();

	for (const entry of entries.sort()) {
		const directory = path.join(runRoot, entry);
		const entryStat = await stat(directory);
		if (!entryStat.isDirectory() || !existsSync(path.join(directory, "input.json"))) {
			continue;
		}

		const input = await readJson<RunInput>(path.join(directory, "input.json"));
		const scoresPath = path.join(directory, "scores.json");
		const scores = existsSync(scoresPath) ? await readJson<ScoresFile>(scoresPath) : null;
		const providerCallsPath = path.join(directory, "provider-calls.json");
		const providerCalls = existsSync(providerCallsPath) ? await readJson<ProviderCallSummary[]>(providerCallsPath) : [];
		const estimatedCostUsd = providerCalls.reduce((sum, call) => {
			const cost = call.metadata && typeof call.metadata.estimatedProviderCostUsd === "number" ? call.metadata.estimatedProviderCostUsd : 0;
			return sum + cost;
		}, 0);
		const row: Record<string, unknown> = {
			model: input.generation.model ?? "",
			promptId: input.prompt.id,
			provider: input.generation.provider ?? "",
			reference: input.reference?.role ?? "",
			runId: input.runId,
			sourceMode: input.sourceMode ?? "text-to-video",
			useCase: input.prompt.useCase,
			estimatedCostUsd: estimatedCostUsd > 0 ? Number(estimatedCostUsd.toFixed(4)) : null,
		};

		for (const stage of STAGES) {
			const score = scores?.scores[stage];
			row[`${stage}Aggregate`] = score?.aggregate ?? null;
			for (const failure of score?.failures ?? []) {
				failures.set(failure, (failures.get(failure) ?? 0) + 1);
			}
		}
		rows.push(row);
	}

	const failureTaxonomy = [...failures.entries()]
		.sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
		.map(([failure, count]) => ({ count, failure }));
	const output = {
		createdAt: new Date().toISOString(),
		failureTaxonomy,
		runCount: rows.length,
		runs: rows,
	};

	await writeJson(path.join(root, "summary.json"), output);
	console.log(`runs: ${rows.length}`);
	for (const row of rows) {
		const cost = row.estimatedCostUsd ? ` cost=$${String(row.estimatedCostUsd)}` : "";
		console.log(
			`${String(row.runId)}\t${String(row.promptId)}\tchroma=${String(row["chroma-baselineAggregate"] ?? "n/a")}\tmatting=${String(row["matting-baselineAggregate"] ?? "n/a")}\tv0=${String(row["celstate-alpha-v0Aggregate"] ?? "n/a")}\tv1=${String(row["celstate-alpha-v1-despillAggregate"] ?? "n/a")}\tv2=${String(row["celstate-alpha-v2-trimapAggregate"] ?? "n/a")}\tv3=${String(row["celstate-alpha-v3-core-fringeAggregate"] ?? "n/a")}\tv4=${String(row["celstate-alpha-v4-prior-fusionAggregate"] ?? "n/a")}${cost}`,
		);
	}
	if (failureTaxonomy.length > 0) {
		console.log("failures:");
		for (const failure of failureTaxonomy) {
			console.log(`  ${failure.failure}: ${failure.count}`);
		}
	}
}

async function checkTools(): Promise<void> {
	const ffmpeg = await command("ffmpeg", ["-version"]);
	const ffprobe = await command("ffprobe", ["-version"]);
	console.log(firstLine(ffmpeg.stdout));
	console.log(firstLine(ffprobe.stdout));
}

function firstLine(value: string): string {
	return value.split(/\r?\n/)[0] ?? "";
}

function printHelp(): void {
	console.log([
		"Transparent animation R&D spike harness",
		"",
		"Commands:",
		"  init",
		"  list-prompts [--verbose] [--key-color #00ff00] [--source-mode text-to-video|image-to-video|ingredients-to-video]",
		"  create-run --prompt-id <id> [--source-mode image-to-video] [--reference <image>] [--source <video>] [--provider <name>] [--model <name>] [--seed <seed>] [--key-color #00ff00]",
		"  provider-generate-source --run-id <id> [--video-model veo-3.1-fast-generate-preview] [--duration-seconds 8] [--aspect-ratio 16:9] [--resolution 720p] [--seed <number>] [--process] [--force]",
		"  attach-reference --run-id <id> --reference <image> [--reference-role first-frame|reference-image] [--force]",
		"  attach-source --run-id <id> --source <video> [--force]",
		"  process-run --run-id <id> [--force]",
		"  chroma-baseline --run-id <id> [--key-color #00ff00] [--similarity 0.12] [--blend 0.08]",
		"  ingest-matting --run-id <id> --foreground <mov> --alpha <mp4> [--tool <name>]",
		"  celstate-alpha-v0 --run-id <id> [--key-color #00ff00] [--similarity 0.12] [--blend 0.08]",
		"  celstate-alpha-v1-despill --run-id <id> [--key-color #00ff00] [--similarity 0.12] [--blend 0.08] [--despill-mix 0.5]",
		"  celstate-alpha-v2-trimap --run-id <id> [--key-color #00ff00] [--background-samples 24] [--background-threshold 28] [--foreground-threshold 76] [--still-frame 96] [--despill-mix 0.8]",
		"  celstate-alpha-v3-core-fringe --run-id <id> [--key-color #00ff00] [--similarity 0.12] [--blend 0.08] [--core-alpha 242] [--fringe-radius 4] [--transparent-cutoff 4] [--still-frame 96] [--despill-mix 1.25]",
		"  celstate-alpha-v4-prior-fusion --run-id <id> [--prior-model bria-rmbg] [--prior-package rembg[cpu,cli]] [--key-color #00ff00] [--similarity 0.12] [--blend 0.08] [--core-alpha 244] [--fringe-radius 3] [--transparent-cutoff 3] [--chroma-transparent-cutoff 8] [--still-frame 96] [--despill-mix 0.65]",
		"  celstate-alpha-v5-video-prior --run-id <id> [--prior-alpha-dir <dir>] [--key-color #00ff00] [--similarity 0.12] [--blend 0.08] [--core-alpha 235] [--core-despill-band 20] [--core-despill-mix 0.6] [--fringe-radius 6] [--guard-radius 8] [--subject-alpha 32] [--transparent-cutoff 2] [--spill-gain 3] [--spill-pull-max 0.85] [--residual-despill-mix 0.6] [--leaf-despill-mix 0.55] [--leaf-alpha-floor 24] [--leaf-gate-ramp 4] [--still-frame 96]",
		"  video-prior --run-id <id> [--prior-model bria-rmbg] [--prior-package rembg[cpu,cli]] [--mask-threshold 16] [--matanyone-package matanyone2@git+https://github.com/pq-yang/MatAnyone2.git] [--matanyone-command matanyone2] [--matanyone-via-wsl] [--max-size 1280] [--force]",
		"  celstate-alpha-v6-projection --run-id <id> [--prior-alpha-dir <dir>] [--key-color #00ff00] [--similarity 0.12] [--blend 0.08] [--core-alpha 235] [--core-projection-band 20] [--fringe-radius 6] [--guard-radius 8] [--subject-alpha 32] [--transparent-cutoff 2] [--chroma-transparent-cutoff 8] [--leaf-alpha-floor 24] [--leaf-edge-band 4] [--leaf-interior-min-distance 3] [--leaf-gate-ramp 4] [--bg-plate-iterations 24] [--still-frame 96]",
		"  celstate-alpha-v7 --run-id <id> [--prior-alpha-dir <dir>] [--key-color #00ff00] [--similarity 0.12] [--blend 0.08] [--core-alpha 235] [--core-projection-band 20] [--fringe-radius 6] [--guard-radius 8] [--subject-alpha 32] [--transparent-cutoff 2] [--chroma-transparent-cutoff 8] [--leaf-alpha-floor 24] [--leaf-edge-band 4] [--leaf-interior-min-distance 3] [--leaf-gate-ramp 4] [--bg-plate-iterations 24] [--still-frame 96]",
		"  generate-probe-sources [--probe-duration 1]  (plumbing smoke test — not quality eval; see pnpm alpha-eval)",
		"  per-frame-prior --run-id <id> [--prior-model bria-rmbg] [--prior-package rembg[cpu,cli]] [--prior-alpha-dir <dir>] [--force]",
		"  generalization-probes [--probe-duration 1] [--blue-run-id probe-blue-screen-gp01] [--glow-run-id probe-green-glow-gp02] [--force]  (plumbing smoke test — not quality eval; see pnpm alpha-eval)",
		"  promote-review --run-id <id> [--stage celstate-alpha-v7]",
		"  score --run-id <id> --stage <stage> --alpha-usability 1..5 --temporal-coherence 1..5 --edge-spill-halo 1..5 --identity-stability 1..5 --internal-motion 1..5 --secondary-motion-coupling 1..5 --prompt-compliance 1..5 --editor-compatibility 1..5 --overall-awe 1..5 [--failure <name>] [--notes <text>]",
		"  status --run-id <id> [--events 12]",
		"  summary",
		"  check-tools",
		"",
		`Default root: ${DEFAULT_ROOT}`,
		"Pass --root <path> to override.",
	].join("\n"));
}

async function main(): Promise<void> {
	const args = parseArgs(process.argv.slice(2));
	switch (args.command) {
		case "help":
		case "--help":
		case "-h":
			printHelp();
			return;
		case "init":
			await initHarness(args);
			return;
		case "list-prompts":
			await listPrompts(args);
			return;
		case "create-run":
			await createRun(args);
			return;
		case "provider-generate-source":
			await providerGenerateSource(args);
			return;
		case "attach-reference":
			await attachReference(args);
			return;
		case "attach-source":
			await attachSource(args);
			return;
		case "process-run":
			await processRun(args);
			return;
		case "chroma-baseline":
			await runChromaBaseline(args);
			return;
		case "ingest-matting":
			await ingestMattingBaseline(args);
			return;
		case "celstate-alpha-v0":
			await runCelstateAlphaV0(args);
			return;
		case "celstate-alpha-v1-despill":
			await runCelstateAlphaV1Despill(args);
			return;
		case "celstate-alpha-v2-trimap":
			await runCelstateAlphaV2Trimap(args);
			return;
		case "celstate-alpha-v3-core-fringe":
			await runCelstateAlphaV3CoreFringe(args);
			return;
		case "celstate-alpha-v4-prior-fusion":
			await runCelstateAlphaV4PriorFusion(args);
			return;
		case "celstate-alpha-v5-video-prior":
			await runCelstateAlphaV5VideoPrior(args);
			return;
		case "video-prior":
			await runVideoPrior(args);
			return;
		case "celstate-alpha-v6-projection":
			await runCelstateAlphaV6Projection(args);
			return;
		case "celstate-alpha-v7":
			await runCelstateAlphaV7(args);
			return;
		case "generate-probe-sources":
			await generateProbeSources(args);
			return;
		case "per-frame-prior":
			await runPerFramePrior(args);
			return;
		case "generalization-probes":
			await runGeneralizationProbes(args);
			return;
		case "promote-review":
			await promoteReviewCandidate(args);
			return;
		case "score":
			await scoreRun(args);
			return;
		case "status":
			await printRunStatus(args);
			return;
		case "summary":
			await summary(args);
			return;
		case "check-tools":
			await checkTools();
			return;
		default:
			throw new Error(`Unknown command: ${args.command}. Run help for usage.`);
	}
}

main().catch((error: unknown) => {
	const message = error instanceof Error ? error.message : String(error);
	console.error(`transparent-animation-spike failed:\n${message}`);
	process.exit(1);
});
