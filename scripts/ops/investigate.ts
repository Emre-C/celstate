import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { attachGenerationDownloadProbes, type DownloadProbe, type GenerationInvestigationReport } from '../../src/lib/ops/investigation.js';
import { mergedEnvForScripts } from '../lib/env-files.js';
import { readPostHogConfig, runHogQLQuery, type HogQLQueryResponse } from '../lib/posthog-api.js';

type Command = 'health' | 'generation' | 'user' | 'recent' | 'alerts' | 'check' | 'help';

interface ParsedArgs {
	readonly command: Command;
	readonly options: ReadonlyMap<string, string | true>;
	readonly positionals: readonly string[];
}

interface ConvexInvocation {
	readonly command: string;
	readonly args: readonly string[];
	readonly functionName: string;
	readonly jsonArgs: Record<string, unknown>;
}

interface PnpmInvocationBase {
	readonly command: string;
	readonly prefixArgs: readonly string[];
}

interface GenerationReadModel {
	readonly artifactUrls: {
		readonly optimizedUrl?: string;
		readonly resultUrl?: string;
	};
	readonly report: GenerationInvestigationReport;
}

const COMMANDS = new Set<Command>(['health', 'generation', 'user', 'recent', 'alerts', 'check', 'help']);
const DOWNLOAD_PROBE_TIMEOUT_MS = 10_000;

export function parseArgs(argv: readonly string[]): ParsedArgs {
	const [rawCommand = 'help', ...rest] = argv;
	const command = COMMANDS.has(rawCommand as Command) ? (rawCommand as Command) : 'help';
	const options = new Map<string, string | true>();
	const positionals: string[] = command === 'help' && rawCommand !== 'help' ? [rawCommand] : [];

	for (let index = 0; index < rest.length; index += 1) {
		const token = rest[index];
		if (!token.startsWith('--')) {
			positionals.push(token);
			continue;
		}

		const withoutPrefix = token.slice(2);
		const equalsIndex = withoutPrefix.indexOf('=');
		if (equalsIndex >= 0) {
			options.set(withoutPrefix.slice(0, equalsIndex), withoutPrefix.slice(equalsIndex + 1));
			continue;
		}

		const next = rest[index + 1];
		if (next && !next.startsWith('--')) {
			options.set(withoutPrefix, next);
			index += 1;
			continue;
		}

		options.set(withoutPrefix, true);
	}

	return { command, options, positionals };
}

function getOptionString(args: ParsedArgs, key: string): string | undefined {
	const value = args.options.get(key);
	return typeof value === 'string' ? value : undefined;
}

function normalizeEmailOption(email: string | undefined): string | undefined {
	const normalized = email?.trim().toLowerCase();
	return normalized && normalized.length > 0 ? normalized : undefined;
}

function hasFlag(args: ParsedArgs, key: string): boolean {
	return args.options.get(key) === true;
}

function getOptionNumber(args: ParsedArgs, key: string): number | undefined {
	const value = getOptionString(args, key);
	if (value === undefined) {
		return undefined;
	}
	const parsed = Number(value);
	if (!Number.isFinite(parsed)) {
		throw new Error(`--${key} must be a finite number`);
	}
	return parsed;
}

function pnpmInvocationBase(): PnpmInvocationBase {
	const npmExecPath = process.env.npm_execpath;
	if (npmExecPath && existsSync(npmExecPath)) {
		return {
			command: process.execPath,
			prefixArgs: [npmExecPath]
		};
	}

	if (process.platform === 'win32') {
		const appData = process.env.APPDATA;
		const candidate = appData
			? join(appData, 'npm', 'node_modules', 'pnpm', 'bin', 'pnpm.cjs')
			: undefined;
		if (candidate && existsSync(candidate)) {
			return {
				command: process.execPath,
				prefixArgs: [candidate]
			};
		}
	}

	return {
		command: 'pnpm',
		prefixArgs: []
	};
}

export function buildConvexRunInvocation(functionName: string, jsonArgs: Record<string, unknown>): ConvexInvocation {
	const pnpm = pnpmInvocationBase();
	return {
		args: [...pnpm.prefixArgs, 'exec', 'convex', 'run', '--prod', functionName, JSON.stringify(jsonArgs)],
		command: pnpm.command,
		functionName,
		jsonArgs
	};
}

export function buildInvocationForCommand(args: ParsedArgs, now: number): ConvexInvocation {
	switch (args.command) {
		case 'health':
			return buildConvexRunInvocation('ops:getLatestCriticalPathHealth', { now });
		case 'generation': {
			const generationId = getOptionString(args, 'id') ?? args.positionals[0];
			if (!generationId) {
				throw new Error('generation requires --id <generationId>');
			}
			return buildConvexRunInvocation('ops:getGenerationInvestigation', {
				generationId,
				now
			});
		}
		case 'user': {
			const email = normalizeEmailOption(getOptionString(args, 'email'));
			const userId = getOptionString(args, 'id') ?? getOptionString(args, 'user-id');
			if (!email && !userId) {
				throw new Error('user requires --email <email> or --id <userId>');
			}
			return buildConvexRunInvocation('ops:getUserInvestigation', {
				...(email ? { email } : {}),
				...(userId ? { userId } : {}),
				limit: getOptionNumber(args, 'limit'),
				now
			});
		}
		case 'recent':
			return buildConvexRunInvocation('ops:getRecentGenerationIncidents', {
				hoursWindow: getOptionNumber(args, 'hours'),
				limit: getOptionNumber(args, 'limit'),
				now
			});
		case 'alerts':
			return buildConvexRunInvocation('ops:getRecentOpsAlertEvents', {
				hoursWindow: getOptionNumber(args, 'hours'),
				limit: getOptionNumber(args, 'limit'),
				now
			});
		case 'check':
		case 'help':
			throw new Error(`${args.command} does not map to a Convex read model`);
	}
}

function parseJsonOutput(stdout: string): unknown {
	const trimmed = stdout.trim();
	if (!trimmed) {
		throw new Error('Convex returned an empty response');
	}
	try {
		return JSON.parse(trimmed);
	} catch {
		const lines = trimmed.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
		for (let index = lines.length - 1; index >= 0; index -= 1) {
			const line = lines[index];
			if (!line.startsWith('{') && !line.startsWith('[') && line !== 'null') {
				continue;
			}
			try {
				return JSON.parse(line);
			} catch {
				// Keep looking for the final JSON payload.
			}
		}
	}
	throw new Error(`Unable to parse Convex JSON output: ${trimmed.slice(0, 500)}`);
}

/**
 * Strips inline comments from CONVEX_DEPLOYMENT before passing it to child
 * processes. The Convex CLI's `stripDeploymentTypePrefix` splits on `:` and
 * takes the last segment — if the value contains a comment with colons (e.g.
 * `dev:llama-123 # team: foo, project: bar`), the last segment becomes
 * ` bar` from the comment instead of the real deployment name. We also remove
 * the env var entirely when `--prod` is already in the args, so the CLI uses
 * the `--prod` flag instead of a dev deployment from the environment.
 */
function sanitizedConvexEnv(args: readonly string[]): Record<string, string | undefined> {
	const env = { ...process.env };
	const hasProdFlag = args.includes('--prod');
	if (hasProdFlag) {
		delete env.CONVEX_DEPLOYMENT;
	} else if (env.CONVEX_DEPLOYMENT) {
		const hashIndex = env.CONVEX_DEPLOYMENT.indexOf('#');
		if (hashIndex >= 0) {
			env.CONVEX_DEPLOYMENT = env.CONVEX_DEPLOYMENT.slice(0, hashIndex).trim();
		}
	}
	return env;
}

function runConvexJson(invocation: ConvexInvocation): unknown {
	const result = spawnSync(invocation.command, invocation.args, {
		cwd: process.cwd(),
		encoding: 'utf8',
		env: sanitizedConvexEnv(invocation.args),
		stdio: ['ignore', 'pipe', 'pipe']
	});
	if (result.error) {
		throw result.error;
	}
	if (result.status !== 0) {
		const detail = `${result.stdout ?? ''}${result.stderr ?? ''}`.trim();
		throw new Error(detail || `Convex command exited with ${result.status ?? 'unknown status'}`);
	}
	return parseJsonOutput(result.stdout ?? '');
}

function contentLengthOf(headers: Headers): number | undefined {
	const raw = headers.get('content-length');
	if (!raw) {
		return undefined;
	}
	const parsed = Number(raw);
	return Number.isFinite(parsed) ? parsed : undefined;
}

async function probeDownloadUrl(url: string): Promise<DownloadProbe> {
	const controller = new AbortController();
	const timeout = setTimeout(() => controller.abort(), DOWNLOAD_PROBE_TIMEOUT_MS);
	try {
		const response = await fetch(url, {
			headers: {
				accept: 'image/*,*/*;q=0.1',
				range: 'bytes=0-0'
			},
			method: 'GET',
			signal: controller.signal
		});
		await response.body?.cancel().catch(() => undefined);
		return {
			contentLength: contentLengthOf(response.headers),
			contentType: response.headers.get('content-type') ?? undefined,
			digestHeaderPresent: response.headers.has('digest'),
			ok: response.ok,
			status: response.status
		};
	} catch (error) {
		return {
			digestHeaderPresent: false,
			error: error instanceof Error ? error.message : String(error),
			ok: false
		};
	} finally {
		clearTimeout(timeout);
	}
}

async function attachDownloadProbeEvidence(readModel: GenerationReadModel, now: number): Promise<GenerationInvestigationReport> {
	const probes: {
		optimizedDownloadProbe?: DownloadProbe;
		resultDownloadProbe?: DownloadProbe;
	} = {};

	if (readModel.report.artifacts.resultUrlIssued && readModel.artifactUrls.resultUrl) {
		probes.resultDownloadProbe = await probeDownloadUrl(readModel.artifactUrls.resultUrl);
	}
	if (readModel.report.artifacts.optimizedUrlIssued && readModel.artifactUrls.optimizedUrl) {
		probes.optimizedDownloadProbe = await probeDownloadUrl(readModel.artifactUrls.optimizedUrl);
	}

	return attachGenerationDownloadProbes(readModel.report, probes, now);
}

function verdictLabel(value: string): string {
	return value.toUpperCase().replace('_', ' ');
}

function refundLabel(report: GenerationInvestigationReport): string {
	if (report.verdict.refund === 'not_applicable') {
		return 'not-applicable';
	}
	return report.generation.creditRefunded ? 'refunded' : 'not-refunded';
}

function retryLabel(report: GenerationInvestigationReport): string {
	if (report.verdict.userRecoveredAfterThis) {
		return 'recovered';
	}
	if (report.verdict.userRetriedAfterThis) {
		return 'retried';
	}
	return report.generation.status === 'failed' ? 'no-retry' : 'unknown';
}

function summarizeGeneration(report: GenerationInvestigationReport): string {
	return [
		`AUTH: ${verdictLabel(report.verdict.auth)}`,
		`GENERATION: ${verdictLabel(report.verdict.generation)}`,
		`DOWNLOAD: ${verdictLabel(report.verdict.download)}`,
		`REFUND: ${refundLabel(report)}`,
		`USER RETRY: ${retryLabel(report)}`,
		`NEXT ACTION: ${report.verdict.recommendedAction}`
	].join('\n');
}

function summarizeHealth(report: {
	readonly verdict: {
		readonly auth: string;
		readonly download: string;
		readonly generation: string;
		readonly recommendedAction: string;
	};
}): string {
	return [
		`AUTH: ${verdictLabel(report.verdict.auth)}`,
		`GENERATION: ${verdictLabel(report.verdict.generation)}`,
		`DOWNLOAD: ${verdictLabel(report.verdict.download)}`,
		`NEXT ACTION: ${report.verdict.recommendedAction}`
	].join('\n');
}

function summarizeUser(report: {
	readonly latestGenerations: readonly unknown[];
	readonly user: { readonly email?: string; readonly id: string };
	readonly verdict: {
		readonly auth: string;
		readonly download: string;
		readonly generation: string;
		readonly recommendedAction: string;
	};
}): string {
	return [
		`USER: ${report.user.email ?? report.user.id}`,
		`AUTH: ${verdictLabel(report.verdict.auth)}`,
		`GENERATION: ${verdictLabel(report.verdict.generation)}`,
		`DOWNLOAD: ${verdictLabel(report.verdict.download)}`,
		`RECENT GENERATIONS: ${report.latestGenerations.length}`,
		`NEXT ACTION: ${report.verdict.recommendedAction}`
	].join('\n');
}

function summarizeRecent(report: { readonly incidents: readonly unknown[] }): string {
	return [`RECENT INCIDENTS: ${report.incidents.length}`, 'NEXT ACTION: Inspect a generation ID from the incident list.'].join('\n');
}

function summarizeAlerts(report: {
	readonly events: readonly {
		readonly alertType: string;
		readonly createdAt: number;
		readonly error?: string;
		readonly outcome: string;
	}[];
	readonly window: { readonly hoursWindow: number; readonly since: number };
}): string {
	const failures = report.events.filter((event) => event.outcome === 'failed');
	if (report.events.length === 0) {
		return `OPS ALERTS: 0 events in last ${report.window.hoursWindow}h\nNEXT ACTION: No webhook delivery issues detected.`;
	}
	const lines = [
		`OPS ALERTS: ${report.events.length} events (${failures.length} failed) in last ${report.window.hoursWindow}h`
	];
	for (const event of report.events.slice(0, 10)) {
		const time = new Date(event.createdAt).toISOString();
		const detail = event.outcome === 'failed' && event.error ? ` — ${event.error}` : '';
		lines.push(`  ${event.outcome.toUpperCase()} ${event.alertType} @ ${time}${detail}`);
	}
	if (failures.length > 0) {
		lines.push('NEXT ACTION: Investigate webhook URL or network connectivity for failed deliveries.');
	} else {
		lines.push('NEXT ACTION: All deliveries succeeded. No action needed.');
	}
	return lines.join('\n');
}

function escapeHogql(value: string): string {
	return `'${value.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`;
}

async function readJourney(args: ParsedArgs): Promise<HogQLQueryResponse | null> {
	if (!hasFlag(args, 'with-journey')) {
		return null;
	}
	const env = mergedEnvForScripts();
	const config = readPostHogConfig(env);
	const generationId = args.command === 'generation' ? getOptionString(args, 'id') ?? args.positionals[0] : undefined;
	const userId = args.command === 'user' ? getOptionString(args, 'id') ?? getOptionString(args, 'user-id') : undefined;
	const email = args.command === 'user' ? getOptionString(args, 'email') : undefined;
	const filters = [
		generationId ? `properties.generation_id = ${escapeHogql(generationId)}` : undefined,
		userId ? `(distinct_id = ${escapeHogql(userId)} OR properties.user_id = ${escapeHogql(userId)})` : undefined,
		email
			? `(properties.email = ${escapeHogql(email)} OR properties.user_email = ${escapeHogql(email)} OR person.properties.email = ${escapeHogql(email)})`
			: undefined
	].filter((filter): filter is string => filter !== undefined);
	if (filters.length === 0) {
		throw new Error('--with-journey requires a generation ID, user ID, or email filter');
	}

	return runHogQLQuery({
		config,
		name: 'celstate-ops-investigation-journey',
		query: `
SELECT
  timestamp,
  event,
  distinct_id,
  properties.generation_id,
  properties.failure_kind,
  properties.failure_stage,
  properties.$current_url
FROM events
WHERE timestamp > now() - INTERVAL 14 DAY
  AND (${filters.join(' OR ')})
ORDER BY timestamp DESC
LIMIT 25
`.trim(),
		refresh: 'blocking'
	});
}

function writeJson(value: unknown): void {
	process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
}

function writeSummary(summary: string, humanOnly: boolean): void {
	if (humanOnly) {
		process.stdout.write(`${summary}\n`);
		return;
	}
	process.stderr.write(`${summary}\n`);
}

function printHelp(): void {
	process.stdout.write(`Celstate ops investigation CLI

Commands:
  pnpm ops:investigate health
  pnpm ops:investigate generation --id <generationId>
  pnpm ops:investigate user --email <email>
  pnpm ops:investigate user --id <userId>
  pnpm ops:investigate recent --limit 5
  pnpm ops:investigate alerts --hours 24
  pnpm ops:investigate check

Options:
  --with-journey   Add bounded PostHog browser context for generation/user investigations.
  --human          Print only the concise summary.
  --dry-run        Print the Convex argv contract without running it.
`);
}

async function commandCheck(args: ParsedArgs): Promise<number> {
	const pnpm = pnpmInvocationBase();
	const pnpmVersion = spawnSync(pnpm.command, [...pnpm.prefixArgs, '--version'], {
		encoding: 'utf8',
		stdio: ['ignore', 'pipe', 'pipe']
	});
	const convexVersion = spawnSync(pnpm.command, [...pnpm.prefixArgs, 'exec', 'convex', '--version'], {
		encoding: 'utf8',
		stdio: ['ignore', 'pipe', 'pipe']
	});
	const checks = [
		{
			name: 'pnpm',
			ok: pnpmVersion.status === 0,
			output: (pnpmVersion.stdout || pnpmVersion.stderr || pnpmVersion.error?.message || '').trim()
		},
		{
			name: 'convex-cli',
			ok: convexVersion.status === 0,
			output: (convexVersion.stdout || convexVersion.stderr || convexVersion.error?.message || '').trim()
		}
	];
	const ok = checks.every((check) => check.ok);
	const payload = {
		checks,
		ok,
		usage: [
			'pnpm ops:investigate health',
			'pnpm ops:investigate recent --limit 5',
			'pnpm ops:investigate generation --id <generationId>'
		]
	};
	const summary = ok
		? 'OPS TOOLING: pass'
		: 'OPS TOOLING: fail';
	writeSummary(summary, hasFlag(args, 'human'));
	if (!hasFlag(args, 'human')) {
		writeJson(payload);
	}
	return ok ? 0 : 1;
}

async function run(args: ParsedArgs): Promise<number> {
	if (args.command === 'help') {
		printHelp();
		return 0;
	}
	if (args.command === 'check') {
		return commandCheck(args);
	}

	const now = Date.now();
	const invocation = buildInvocationForCommand(args, now);
	if (hasFlag(args, 'dry-run')) {
		writeJson(invocation);
		return 0;
	}

	const rawReport = runConvexJson(invocation);
	const humanOnly = hasFlag(args, 'human');
	const journey = await readJourney(args);

	if (args.command === 'generation') {
		if (rawReport === null) {
			throw new Error('generation not found');
		}
		const report = await attachDownloadProbeEvidence(rawReport as GenerationReadModel, now);
		writeSummary(summarizeGeneration(report), humanOnly);
		if (!humanOnly) {
			writeJson({
				command: args.command,
				journey,
				report
			});
		}
		const probes = [
			report.artifacts.resultDownloadProbe,
			report.artifacts.optimizedDownloadProbe
		].filter((probe): probe is DownloadProbe => probe !== undefined);
		return probes.some((probe) => !probe.ok) ? 2 : 0;
	}

	if (args.command === 'health') {
		const report = rawReport as Parameters<typeof summarizeHealth>[0];
		writeSummary(summarizeHealth(report), humanOnly);
		if (!humanOnly) {
			writeJson({
				command: args.command,
				report
			});
		}
		return 0;
	}

	if (args.command === 'user') {
		if (rawReport === null) {
			throw new Error('user not found');
		}
		const report = rawReport as Parameters<typeof summarizeUser>[0];
		writeSummary(summarizeUser(report), humanOnly);
		if (!humanOnly) {
			writeJson({
				command: args.command,
				journey,
				report
			});
		}
		return 0;
	}

	if (args.command === 'alerts') {
		const report = rawReport as Parameters<typeof summarizeAlerts>[0];
		writeSummary(summarizeAlerts(report), humanOnly);
		if (!humanOnly) {
			writeJson({
				command: args.command,
				report
			});
		}
		const hasFailures = report.events.some((event) => event.outcome === 'failed');
		return hasFailures ? 2 : 0;
	}

	const report = rawReport as Parameters<typeof summarizeRecent>[0];
	writeSummary(summarizeRecent(report), humanOnly);
	if (!humanOnly) {
		writeJson({
			command: args.command,
			report
		});
	}
	return 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
	run(parseArgs(process.argv.slice(2))).then((exitCode) => {
		process.exitCode = exitCode;
	}).catch((error) => {
		const message = error instanceof Error ? error.message : String(error);
		process.stderr.write(`ERROR: ${message}\n\n`);
		printHelp();
		process.exitCode = 1;
	});
}
