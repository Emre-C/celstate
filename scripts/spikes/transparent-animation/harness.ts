import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { appendFile, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { getOption } from "./args.js";
import {
	DEFAULT_ROOT,
	type CommandResult,
	type ParsedArgs,
	type PipelineState,
	type ProviderCallSummary,
	type RunContext,
	type RunEvent,
	type StepState,
} from "./model.js";

const execFileAsync = promisify(execFile);

export function spikeRoot(args: ParsedArgs): string {
	return path.resolve(process.cwd(), getOption(args, "root") ?? DEFAULT_ROOT);
}

export function runsRoot(root: string): string {
	return path.join(root, "runs");
}

export function runDirectory(root: string, runId: string): string {
	return path.join(runsRoot(root), runId);
}

export async function ensureDirectory(directory: string): Promise<void> {
	await mkdir(directory, { recursive: true });
}

export async function readJson<T>(filePath: string): Promise<T> {
	return JSON.parse(await readFile(filePath, "utf8")) as T;
}

export async function writeJson(filePath: string, value: unknown): Promise<void> {
	await writeFile(filePath, `${JSON.stringify(value, null, "\t")}\n`, "utf8");
}

export function relativeToWorkspace(filePath: string): string {
	return path.relative(process.cwd(), filePath).replace(/\\/g, "/");
}

export function statePath(directory: string): string {
	return path.join(directory, "pipeline-state.json");
}

export function eventsPath(directory: string): string {
	return path.join(directory, "events.ndjson");
}

export function providerCallsPath(directory: string): string {
	return path.join(directory, "provider-calls.json");
}

export async function appendRunEvent(
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

export async function readPipelineState(context: RunContext): Promise<PipelineState> {
	const filePath = statePath(context.directory);
	if (!existsSync(filePath)) {
		return { runId: context.runId, steps: {}, updatedAt: new Date().toISOString() };
	}
	return readJson<PipelineState>(filePath);
}

export async function readProviderCalls(context: RunContext): Promise<ProviderCallSummary[]> {
	const filePath = providerCallsPath(context.directory);
	if (!existsSync(filePath)) {
		return [];
	}
	return readJson<ProviderCallSummary[]>(filePath);
}

export async function upsertProviderCall(context: RunContext, summary: ProviderCallSummary): Promise<void> {
	const calls = await readProviderCalls(context);
	const next = calls.filter((call) => call.attemptId !== summary.attemptId);
	next.push(summary);
	await writeJson(providerCallsPath(context.directory), next);
}

export async function runProviderCall<T>(
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

export async function updateStepState(context: RunContext, step: string, state: StepState): Promise<void> {
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

export async function markStepStarted(context: RunContext, step: string): Promise<string> {
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

export async function markStepSucceeded(
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

export async function markStepFailed(
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

export function extractCommandLog(message: string): string | undefined {
	return message.match(/command log: ([^\r\n]+)/)?.[1];
}

export function timestampLabel(): string {
	return new Date().toISOString().replace(/[:.]/g, "-");
}

export function slugify(value: string): string {
	return value
		.trim()
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, "-")
		.replace(/^-+|-+$/g, "") || "run";
}

export function compact<T>(values: readonly (T | undefined)[]): T[] {
	return values.filter((value): value is T => value !== undefined);
}

export async function command(commandName: string, args: readonly string[]): Promise<CommandResult> {
	return runCommand(commandName, args, commandName);
}

export async function runCommand(
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

export function commandErrorMessage(error: unknown): string {
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

export function commandOutput(error: unknown, key: "stderr" | "stdout"): string {
	if (error && typeof error === "object") {
		const value = (error as Record<string, unknown>)[key];
		return typeof value === "string" ? value : "";
	}
	return "";
}

export async function writeCommandLog(
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

export async function runFfmpeg(args: readonly string[], label: string, context?: RunContext): Promise<string | undefined> {
	try {
		const result = await runCommand("ffmpeg", ["-hide_banner", ...args], label, context);
		return result.logPath;
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		throw new Error(`${label} failed:\n${message}`);
	}
}

export async function ffprobeJson(filePath: string, context?: RunContext): Promise<unknown> {
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
