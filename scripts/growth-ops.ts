import { execSync } from 'node:child_process';
import { basename, resolve } from 'node:path';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { mergedEnvForScripts } from './lib/env-files.js';
import {
	ANALYSIS_QUEUE,
	CORE_GROWTH_EVENTS,
	HYPOTHESIS_BACKLOG,
	PRODUCT_DEFINITION,
	PRICING_MODEL,
	type AnalysisPhase
} from './lib/growth-runbook.js';
import {
	GROWTH_QUERY_PRESETS,
	GROWTH_QUERY_PRESET_BY_ARTIFACT,
	type GrowthQueryPreset
} from './lib/growth-query-presets.js';
import {
	createAnnotation,
	listEventDefinitions,
	readPostHogConfig,
	runHogQLQuery
} from './lib/posthog-api.js';

interface ParsedArgs {
	readonly command: string;
	readonly options: ReadonlyMap<string, string | true>;
	readonly positionals: readonly string[];
}

interface CursorPluginStatus {
	readonly enabled: boolean | null;
	readonly plugin: string;
}

interface GrowthRunManifest {
	readonly analysisQueue: typeof ANALYSIS_QUEUE;
	readonly createdAt: string;
	readonly hypotheses: typeof HYPOTHESIS_BACKLOG;
	readonly pricingModel: typeof PRICING_MODEL;
	readonly product: typeof PRODUCT_DEFINITION;
	readonly runId: string;
}

interface SubcheckResult {
	readonly name: string;
	readonly ok: boolean;
	readonly output: string;
}

const VALID_PHASES: readonly AnalysisPhase[] = [
	'P0_funnel_baseline',
	'P1_activation_rate',
	'P2_revenue_metrics',
	'P3_attribution_roi',
	'P4_retention'
] as const;

function parseArgs(argv: readonly string[]): ParsedArgs {
	const [command = 'help', ...rest] = argv;
	const options = new Map<string, string | true>();
	const positionals: string[] = [];

	for (let index = 0; index < rest.length; index += 1) {
		const token = rest[index];
		if (!token.startsWith('--')) {
			positionals.push(token);
			continue;
		}

		const withoutPrefix = token.slice(2);
		const equalsIndex = withoutPrefix.indexOf('=');
		if (equalsIndex >= 0) {
			const key = withoutPrefix.slice(0, equalsIndex);
			const value = withoutPrefix.slice(equalsIndex + 1);
			options.set(key, value);
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

function writeJson(filePath: string, value: unknown): void {
	writeFileSync(filePath, `${JSON.stringify(value, null, '\t')}\n`, 'utf8');
}

function writeText(filePath: string, value: string): void {
	writeFileSync(filePath, value, 'utf8');
}

function timestampLabel(): string {
	return new Date().toISOString().replace(/[:.]/g, '-');
}

function slugify(value: string): string {
	const normalized = value
		.trim()
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, '-')
		.replace(/^-+|-+$/g, '');
	return normalized || 'growth-run';
}

function ensureDirectory(directoryPath: string): void {
	mkdirSync(directoryPath, { recursive: true });
}

function growthRoot(): string {
	return resolve(process.cwd(), '.growth');
}

function growthRunsRoot(): string {
	const directory = resolve(growthRoot(), 'runs');
	ensureDirectory(directory);
	return directory;
}

function manifestPathForRun(runDirectory: string): string {
	return resolve(runDirectory, 'manifest.json');
}

function readManifest(runDirectory: string): GrowthRunManifest | null {
	const filePath = manifestPathForRun(runDirectory);
	if (!existsSync(filePath)) {
		return null;
	}
	return JSON.parse(readFileSync(filePath, 'utf8')) as GrowthRunManifest;
}

function createRunDirectory(label: string): string {
	const runDirectory = resolve(growthRunsRoot(), `${timestampLabel()}-${slugify(label)}`);
	ensureDirectory(runDirectory);
	ensureDirectory(resolve(runDirectory, 'artifacts'));
	return runDirectory;
}

function scaffoldRun(runDirectory: string): GrowthRunManifest {
	const manifest: GrowthRunManifest = {
		analysisQueue: ANALYSIS_QUEUE,
		createdAt: new Date().toISOString(),
		hypotheses: HYPOTHESIS_BACKLOG,
		pricingModel: PRICING_MODEL,
		product: PRODUCT_DEFINITION,
		runId: basename(runDirectory)
	};
	writeJson(manifestPathForRun(runDirectory), manifest);
	writeText(
		resolve(runDirectory, 'assistant-brief.md'),
		[
			`# Growth run ${manifest.runId}`,
			'',
			'## Baseline signals',
			'-',
			'',
			'## Bottleneck identified',
			'-',
			'',
			'## Hypothesis selected',
			'-',
			'',
			'## Change to ship',
			'-',
			'',
			'## Measurement window',
			'-',
			'',
			'## PostHog annotation',
			'-'
		].join('\n') + '\n'
	);
	return manifest;
}

function ensureRunDirectory(runDirectoryOption: string | undefined, label: string): string {
	const runDirectory = runDirectoryOption
		? resolve(process.cwd(), runDirectoryOption)
		: createRunDirectory(label);
	ensureDirectory(runDirectory);
	ensureDirectory(resolve(runDirectory, 'artifacts'));
	if (!readManifest(runDirectory)) {
		scaffoldRun(runDirectory);
	}
	return runDirectory;
}

function readCursorPluginStatuses(): readonly CursorPluginStatus[] {
	const filePath = resolve(process.cwd(), '.cursor/settings.json');
	if (!existsSync(filePath)) {
		return [
			{ enabled: null, plugin: 'posthog' },
			{ enabled: null, plugin: 'convex' },
			{ enabled: null, plugin: 'vercel' }
		] as const;
	}

	const parsed = JSON.parse(readFileSync(filePath, 'utf8')) as {
		readonly plugins?: Record<string, { readonly enabled?: boolean }>;
	};
	return ['posthog', 'convex', 'vercel'].map((plugin) => ({
		enabled: typeof parsed.plugins?.[plugin]?.enabled === 'boolean' ? parsed.plugins[plugin].enabled : null,
		plugin
	}));
}

function runSubcheck(name: string, command: string): SubcheckResult {
	try {
		const output = execSync(command, {
			cwd: process.cwd(),
			encoding: 'utf8',
			stdio: ['pipe', 'pipe', 'pipe']
		});
		return { name, ok: true, output: output.trim() };
	} catch (error) {
		const processError = error as Error & {
			readonly stderr?: Buffer | string;
			readonly stdout?: Buffer | string;
		};
		const stderr = typeof processError.stderr === 'string'
			? processError.stderr
			: processError.stderr?.toString('utf8') ?? '';
		const stdout = typeof processError.stdout === 'string'
			? processError.stdout
			: processError.stdout?.toString('utf8') ?? '';
		const output = `${stdout}${stderr}`.trim() || processError.message;
		return { name, ok: false, output };
	}
}

function readPhaseOption(value: string | undefined): AnalysisPhase | 'all' {
	if (!value || value === 'all') {
		return value === 'all' ? 'all' : 'P0_funnel_baseline';
	}
	if (VALID_PHASES.includes(value as AnalysisPhase)) {
		return value as AnalysisPhase;
	}
	throw new Error(`Unknown phase: ${value}`);
}

function readQueryPresetSelection(args: ParsedArgs): readonly GrowthQueryPreset[] {
	const artifact = getOptionString(args, 'artifact');
	if (artifact) {
		const preset = GROWTH_QUERY_PRESET_BY_ARTIFACT.get(artifact);
		if (!preset) {
			throw new Error(`Unknown artifact preset: ${artifact}`);
		}
		return [preset];
	}

	const phase = readPhaseOption(getOptionString(args, 'phase'));
	if (phase === 'all') {
		return GROWTH_QUERY_PRESETS;
	}
	return GROWTH_QUERY_PRESETS.filter((preset) => preset.phase === phase);
}

async function commandCheck(): Promise<void> {
	const env = mergedEnvForScripts();
	const posthogConfig = readPostHogConfig(env);
	const cursorStatuses = readCursorPluginStatuses();
	const subchecks = [
		runSubcheck('public-env', 'pnpm exec tsx scripts/check-public-env.ts'),
		runSubcheck('posthog-env', 'pnpm exec tsx scripts/check-posthog-env.ts'),
		runSubcheck('stripe-env', 'pnpm exec tsx scripts/check-stripe-env.ts')
	];
	const eventDefinitions = await listEventDefinitions(posthogConfig);
	const eventNames = new Set(eventDefinitions.map((definition) => definition.name));
	const missingEvents = CORE_GROWTH_EVENTS.filter((eventName) => !eventNames.has(eventName));
	const smokeQuery = await runHogQLQuery({
		config: posthogConfig,
		name: 'celstate-growth-tooling-smoke-query',
		query: `SELECT event, COUNT() AS event_count
FROM events
WHERE event IN (${CORE_GROWTH_EVENTS.map((eventName) => `'${eventName}'`).join(', ')})
GROUP BY event
ORDER BY event_count DESC`,
		refresh: 'blocking'
	});

	console.log('Growth tooling readiness\n');
	console.log(`PostHog host: ${posthogConfig.appHost}`);
	console.log(`PostHog project: ${posthogConfig.projectId}`);
	console.log();
	console.log('Cursor plugin status');
	for (const status of cursorStatuses) {
		const suffix =
			status.enabled === null ? 'not configured in .cursor/settings.json' : status.enabled ? 'enabled' : 'disabled';
		console.log(`- ${status.plugin}: ${suffix}`);
	}
	console.log();
	console.log('Local + Convex checks');
	for (const subcheck of subchecks) {
		console.log(`- ${subcheck.name}: ${subcheck.ok ? 'pass' : 'fail'}`);
		if (subcheck.output) {
			console.log(subcheck.output);
			console.log();
		}
	}
	console.log('PostHog core events');
	console.log(`- discovered definitions: ${eventDefinitions.length}`);
	if (missingEvents.length > 0) {
		console.log(`- missing required events: ${missingEvents.join(', ')}`);
	} else {
		console.log('- all required Celstate growth events are present');
	}
	console.log();
	console.log('Smoke query result');
	writeJson(resolve(growthRoot(), 'last-check.json'), {
		checkedAt: new Date().toISOString(),
		coreEvents: CORE_GROWTH_EVENTS,
		cursorStatuses,
		eventDefinitionsDiscovered: eventDefinitions.length,
		missingEvents,
		smokeQuery,
		subchecks
	});
	console.log(JSON.stringify(smokeQuery, null, 2));

	const failedSubchecks = subchecks.filter((subcheck) => !subcheck.ok);
	if (failedSubchecks.length > 0 || missingEvents.length > 0) {
		throw new Error('Growth tooling is not ready yet. See output above.');
	}

	console.log('\n✅ Growth tooling is ready.');
	console.log(`   Last check snapshot: ${resolve(growthRoot(), 'last-check.json')}`);
}

function commandScaffold(args: ParsedArgs): void {
	const label = getOptionString(args, 'label') ?? 'growth-cycle';
	const runDirectory = ensureRunDirectory(getOptionString(args, 'run-dir'), label);
	console.log(`✅ Growth run scaffolded at ${runDirectory}`);
}

async function commandSnapshot(args: ParsedArgs): Promise<void> {
	const env = mergedEnvForScripts();
	const posthogConfig = readPostHogConfig(env);
	const presets = readQueryPresetSelection(args);
	const label = getOptionString(args, 'label') ?? 'growth-snapshot';
	const runDirectory = ensureRunDirectory(getOptionString(args, 'run-dir'), label);
	const artifactsDirectory = resolve(runDirectory, 'artifacts');
	const outputs: Array<Record<string, unknown>> = [];

	for (const preset of presets) {
		const response = await runHogQLQuery({
			config: posthogConfig,
			name: `celstate-${preset.outputArtifact}`,
			query: preset.query,
			refresh: 'blocking'
		});
		const filePath = resolve(artifactsDirectory, `${preset.outputArtifact}.json`);
		const payload = {
			executedAt: new Date().toISOString(),
			preset,
			response
		};
		writeJson(filePath, payload);
		outputs.push({
			artifact: preset.outputArtifact,
			filePath,
			phase: preset.phase,
			rows: response.results?.length ?? 0
		});
	}

	writeJson(resolve(runDirectory, 'snapshot-summary.json'), {
		executedAt: new Date().toISOString(),
		outputs,
		selectedArtifacts: presets.map((preset) => preset.outputArtifact)
	});

	console.log(`✅ Snapshot complete: ${runDirectory}`);
	for (const output of outputs) {
		console.log(`- ${String(output.artifact)} (${String(output.phase)}): ${String(output.filePath)}`);
	}
}

async function commandAnnotate(args: ParsedArgs): Promise<void> {
	const env = mergedEnvForScripts();
	const posthogConfig = readPostHogConfig(env);
	const content = getOptionString(args, 'content') ?? args.positionals.join(' ').trim();
	if (!content) {
		throw new Error('Annotation content is required. Use --content="...".');
	}
	const dateMarker = getOptionString(args, 'date') ?? new Date().toISOString();
	const annotation = await createAnnotation({
		config: posthogConfig,
		content,
		dateMarker
	});
	const runDirectoryOption = getOptionString(args, 'run-dir');
	if (runDirectoryOption) {
		const runDirectory = ensureRunDirectory(runDirectoryOption, 'growth-annotation');
		writeJson(resolve(runDirectory, 'annotation.json'), {
			annotation,
			createdAt: new Date().toISOString()
		});
	}
	console.log(`✅ Annotation created: ${annotation.id}`);
	console.log(JSON.stringify(annotation, null, 2));
}

function commandList(): void {
	console.log('Available query presets\n');
	for (const preset of GROWTH_QUERY_PRESETS) {
		console.log(`- ${preset.outputArtifact} [${preset.phase}]`);
		console.log(`  ${preset.description}`);
	}
}

function commandHelp(): void {
	console.log(`Growth operations CLI

Commands:
  check
    Verify growth envs, Convex analytics envs, and PostHog event/query readiness.

  scaffold [--label growth-cycle] [--run-dir .growth/runs/custom]
    Create a timestamped growth run directory with manifest + assistant brief.

  snapshot [--phase P0_funnel_baseline|P1_activation_rate|P2_revenue_metrics|P3_attribution_roi|P4_retention|all]
           [--artifact revenue_summary]
           [--label growth-snapshot]
           [--run-dir .growth/runs/custom]
    Execute built-in HogQL presets and write JSON artifacts.

  annotate --content "Shipped onboarding CTA simplification" [--date 2026-03-27T12:00:00Z] [--run-dir .growth/runs/custom]
    Create a PostHog annotation for a shipped growth change.

  list
    Print the available built-in snapshot presets.
`);
}

async function main(): Promise<void> {
	const args = parseArgs(process.argv.slice(2));
	ensureDirectory(growthRoot());

	if (args.command === 'help' || args.command === '--help' || args.command === '-h') {
		commandHelp();
		return;
	}
	if (args.command === 'check') {
		await commandCheck();
		return;
	}
	if (args.command === 'scaffold') {
		commandScaffold(args);
		return;
	}
	if (args.command === 'snapshot') {
		await commandSnapshot(args);
		return;
	}
	if (args.command === 'annotate') {
		await commandAnnotate(args);
		return;
	}
	if (args.command === 'list') {
		commandList();
		return;
	}

	throw new Error(`Unknown command: ${args.command}`);
}

main().catch((error) => {
	const message = error instanceof Error ? error.message : String(error);
	console.error(`❌ ${message}`);
	process.exit(1);
});
