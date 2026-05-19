import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import {
	appendFile,
	copyFile,
	mkdir,
	readdir,
	readFile,
	stat,
	writeFile,
} from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

const DEFAULT_ROOT = "tmp/transparent-animation-spike";
const DEFAULT_CHROMA_COLOR = "#00ff00";
const DEFAULT_CHROMA_SIMILARITY = 0.12;
const DEFAULT_CHROMA_BLEND = 0.08;

const STAGES = ["chroma-baseline", "matting-baseline", "celstate-alpha-v0"] as const;
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
	readonly outputs?: readonly string[];
	readonly skippedBecauseComplete?: boolean;
	readonly startedAt?: string;
	readonly status: "failed" | "running" | "succeeded";
}

interface PipelineState {
	readonly runId: string;
	readonly steps: Record<string, StepState>;
	readonly updatedAt: string;
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
	options: { commandLog?: string; outputs?: readonly string[]; skippedBecauseComplete?: boolean } = {},
): Promise<void> {
	const endedAt = new Date().toISOString();
	await updateStepState(context, step, {
		commandLog: options.commandLog,
		durationMs: Date.parse(endedAt) - Date.parse(startedAt),
		endedAt,
		outputs: options.outputs,
		skippedBecauseComplete: options.skippedBecauseComplete,
		startedAt,
		status: "succeeded",
	});
	await appendRunEvent(context, {
		data: options.outputs ? { outputs: options.outputs } : undefined,
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
	return [flagshipPrompt()];
}

async function loadPromptSuite(root: string): Promise<PromptFixture[]> {
	const promptPath = path.join(root, "prompts.json");
	if (existsSync(promptPath)) {
		return readJson<PromptFixture[]>(promptPath);
	}
	return selectedPromptSuite();
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
			"pnpm transparent-animation-spike list-prompts --verbose --source-mode image-to-video --key-color '#ff00ff'  # copy the MS-01 image-to-video prompt into Veo 3.1",
			"pnpm transparent-animation-spike create-run --prompt-id MS-01 --provider google --model veo-3.1 --source-mode image-to-video --key-color '#ff00ff' --reference path/to/reference-frame.png",
			"# Generate the Veo source from reference-frame.png + the printed prompt, then attach the returned mp4:",
			"pnpm transparent-animation-spike attach-source --run-id <run-id> --source path/to/veo-output.mp4",
			"pnpm transparent-animation-spike process-run --run-id <run-id>",
			"pnpm transparent-animation-spike status --run-id <run-id>",
			"pnpm transparent-animation-spike score --run-id <run-id> --stage chroma-baseline --alpha-usability 2 --temporal-coherence 2 --edge-spill-halo 1 --identity-stability 4 --internal-motion 3 --secondary-motion-coupling 2 --prompt-compliance 4 --editor-compatibility 3 --overall-awe 2 --failure halo --failure matte_flicker --notes \"rough first pass\"",
			"pnpm transparent-animation-spike summary",
			"```",
			"",
			"`process-run` is resumable: it skips completed stages unless `--force` is passed, and reruns failed or incomplete stages.",
			"",
			"## Artifact contract",
			"",
			"Each run is stored under `runs/<run-id>/` with the artifact shape from the spike doc:",
			"`input.json`, optional `reference.png`, `source.mp4`, `source-preview.png`, `events.ndjson`, `pipeline-state.json`, `logs/`, `chroma-baseline/`, `matting-baseline/`, `celstate-alpha-v0/`, and `scores.json`.",
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

function normalizeHexColor(value: string): string {
	const trimmed = value.trim().toLowerCase();
	const match = trimmed.match(/^(?:#|0x)?([0-9a-f]{6})$/);
	if (!match) {
		throw new Error(`Expected a 6-digit RGB hex color. Got: ${value}`);
	}
	return `#${match[1]}`;
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
	operation: () => Promise<{ commandLog?: string; outputs?: readonly string[] } | void>,
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

	console.log(`run: ${runId}`);
	console.log(`directory: ${directory}`);
	console.log(`prompt: ${input.prompt.id} ${input.prompt.title}`);
	console.log(`source mode: ${input.sourceMode ?? "text-to-video"}`);
	console.log(`reference: ${existsSync(path.join(directory, "reference.png")) ? `present (${input.reference?.role ?? "unknown-role"})` : "missing"}`);
	console.log(`source: ${existsSync(path.join(directory, "source.mp4")) ? "present" : "missing"}`);
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
		const row: Record<string, unknown> = {
			model: input.generation.model ?? "",
			promptId: input.prompt.id,
			provider: input.generation.provider ?? "",
			reference: input.reference?.role ?? "",
			runId: input.runId,
			sourceMode: input.sourceMode ?? "text-to-video",
			useCase: input.prompt.useCase,
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
		console.log(
			`${String(row.runId)}\t${String(row.promptId)}\tchroma=${String(row["chroma-baselineAggregate"] ?? "n/a")}\tmatting=${String(row["matting-baselineAggregate"] ?? "n/a")}\tv0=${String(row["celstate-alpha-v0Aggregate"] ?? "n/a")}`,
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
		"  attach-reference --run-id <id> --reference <image> [--reference-role first-frame|reference-image] [--force]",
		"  attach-source --run-id <id> --source <video> [--force]",
		"  process-run --run-id <id> [--force]",
		"  chroma-baseline --run-id <id> [--key-color #00ff00] [--similarity 0.12] [--blend 0.08]",
		"  ingest-matting --run-id <id> --foreground <mov> --alpha <mp4> [--tool <name>]",
		"  celstate-alpha-v0 --run-id <id> [--key-color #00ff00] [--similarity 0.12] [--blend 0.08]",
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
