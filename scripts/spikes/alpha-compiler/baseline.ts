/**
 * Regression-baseline logic for the synthetic Alpha Compiler evaluation.
 *
 * A baseline file pins, per scenario and per metric, the accepted mean and worst-frame
 * values plus explicit absolute tolerances and direction. `compareReportToBaseline` is
 * pure so the pass/fail behavior is unit-testable; the CLI handles file I/O and exit codes.
 */

import type { MetricAggregate, MetricDirection, MetricName } from "./metrics.js";
import { METRIC_NAMES } from "./metrics.js";

export interface BaselineMetricEntry {
	readonly direction: MetricDirection;
	readonly mean: number;
	/** Absolute tolerance on the mean before the comparison fails. */
	readonly meanTolerance: number;
	readonly worstTolerance: number;
	readonly worstValue: number;
}

export interface BaselineFile {
	readonly generatedAt: string;
	readonly scenarios: Readonly<Record<string, Readonly<Record<string, BaselineMetricEntry>>>>;
	readonly schemaVersion: 1;
	readonly toolchain?: Readonly<Record<string, string>>;
}

export interface ScenarioAggregates {
	readonly aggregates: Readonly<Record<MetricName, MetricAggregate>>;
	readonly id: string;
}

export type ComparisonStatus =
	| "fail"
	| "improved"
	| "missing"
	| "pass"
	| "unbaselined"
	| "unbaselined-metric";

export interface ComparisonRow {
	readonly baselineMean: number | null;
	readonly baselineWorstValue: number | null;
	readonly currentMean: number | null;
	readonly currentWorstFrame: number | null;
	readonly currentWorstValue: number | null;
	readonly direction: MetricDirection | null;
	readonly meanDelta: number | null;
	readonly meanTolerance: number | null;
	readonly metric: string;
	readonly scenario: string;
	readonly status: ComparisonStatus;
	readonly worstDelta: number | null;
	readonly worstTolerance: number | null;
}

export interface ComparisonResult {
	readonly failures: number;
	readonly rows: readonly ComparisonRow[];
	readonly unbaselinedWarnings: number;
}

export interface CompareReportOptions {
	/** When true, unbaselined scenarios/metrics log as pass with a warning count instead of failing. */
	readonly allowUnbaselined?: boolean;
}

function compareValue(direction: MetricDirection, baseline: number, current: number, tolerance: number): ComparisonStatus {
	const delta = current - baseline;
	if (direction === "lower-is-better") {
		if (delta > tolerance) {
			return "fail";
		}
		return delta < -tolerance ? "improved" : "pass";
	}
	if (delta < -tolerance) {
		return "fail";
	}
	return delta > tolerance ? "improved" : "pass";
}

function rowStatus(entry: BaselineMetricEntry, currentMean: number, currentWorstValue: number): ComparisonStatus {
	const meanStatus = compareValue(entry.direction, entry.mean, currentMean, entry.meanTolerance);
	const worstStatus = compareValue(entry.direction, entry.worstValue, currentWorstValue, entry.worstTolerance);
	if (meanStatus === "fail" || worstStatus === "fail") {
		return "fail";
	}
	if (meanStatus === "improved" || worstStatus === "improved") {
		return "improved";
	}
	return "pass";
}

function assertBaselineMetricEntry(scenarioId: string, metricName: string, entry: BaselineMetricEntry): void {
	const numbers = [entry.mean, entry.meanTolerance, entry.worstValue, entry.worstTolerance];
	if (!numbers.every(Number.isFinite)) {
		throw new Error(
			`Baseline entry ${scenarioId}.${metricName} is missing mean/worst-value fields. Rerun \`pnpm alpha-eval update-baseline\` with the current schema.`,
		);
	}
}

function unbaselinedStatus(allowUnbaselined: boolean, raw: "unbaselined" | "unbaselined-metric"): ComparisonStatus {
	return allowUnbaselined ? "pass" : raw;
}

export function compareReportToBaseline(
	scenarios: readonly ScenarioAggregates[],
	baseline: BaselineFile,
	options: CompareReportOptions = {},
): ComparisonResult {
	const allowUnbaselined = options.allowUnbaselined === true;
	const byId = new Map(scenarios.map((scenario) => [scenario.id, scenario]));
	const rows: ComparisonRow[] = [];
	let failures = 0;
	let unbaselinedWarnings = 0;

	for (const [scenarioId, metrics] of Object.entries(baseline.scenarios)) {
		const current = byId.get(scenarioId);
		for (const [metricName, entry] of Object.entries(metrics)) {
			assertBaselineMetricEntry(scenarioId, metricName, entry);
			const aggregate = current?.aggregates[metricName as MetricName];
			const applies = aggregate !== undefined && aggregate.frames > 0;
			const currentMean = applies ? aggregate.mean : null;
			const currentWorstValue = applies ? aggregate.worstValue : null;
			const currentWorstFrame = applies ? aggregate.worstFrame : null;
			const status: ComparisonStatus = currentMean === null || currentWorstValue === null ? "missing" : rowStatus(entry, currentMean, currentWorstValue);
			if (status === "fail" || status === "missing") {
				failures += 1;
			}
			rows.push({
				baselineMean: entry.mean,
				baselineWorstValue: entry.worstValue,
				currentMean,
				currentWorstFrame,
				currentWorstValue,
				direction: entry.direction,
				meanDelta: currentMean === null ? null : currentMean - entry.mean,
				meanTolerance: entry.meanTolerance,
				metric: metricName,
				scenario: scenarioId,
				status,
				worstDelta: currentWorstValue === null ? null : currentWorstValue - entry.worstValue,
				worstTolerance: entry.worstTolerance,
			});
		}
	}

	for (const scenario of scenarios) {
		const baselineMetrics = baseline.scenarios[scenario.id];
		if (baselineMetrics === undefined) {
			const status = unbaselinedStatus(allowUnbaselined, "unbaselined");
			if (status === "unbaselined") {
				failures += 1;
			} else {
				unbaselinedWarnings += 1;
			}
			rows.push({
				baselineMean: null,
				baselineWorstValue: null,
				currentMean: null,
				currentWorstFrame: null,
				currentWorstValue: null,
				direction: null,
				meanDelta: null,
				meanTolerance: null,
				metric: "(scenario)",
				scenario: scenario.id,
				status,
				worstDelta: null,
				worstTolerance: null,
			});
			continue;
		}
		for (const metricName of METRIC_NAMES) {
			const aggregate = scenario.aggregates[metricName];
			if (!aggregate || aggregate.frames === 0) {
				continue;
			}
			if (baselineMetrics[metricName] !== undefined) {
				continue;
			}
			const status = unbaselinedStatus(allowUnbaselined, "unbaselined-metric");
			if (status === "unbaselined-metric") {
				failures += 1;
			} else {
				unbaselinedWarnings += 1;
			}
			rows.push({
				baselineMean: null,
				baselineWorstValue: null,
				currentMean: aggregate.mean,
				currentWorstFrame: aggregate.worstFrame,
				currentWorstValue: aggregate.worstValue,
				direction: aggregate.direction,
				meanDelta: null,
				meanTolerance: null,
				metric: metricName,
				scenario: scenario.id,
				status,
				worstDelta: null,
				worstTolerance: null,
			});
		}
	}

	return { failures, rows, unbaselinedWarnings };
}

export type EvalRunScope = "full" | "partial";

export interface EvalReportScope {
	readonly includedScenarioIds?: readonly string[];
	readonly runScope?: EvalRunScope;
	readonly scenarios: readonly { readonly id: string }[];
}

/** Restrict comparison to one scenario when --scenario is passed on compare. */
export function selectScenariosForCompare<T extends ScenarioAggregates>(
	scenarios: readonly T[],
	scenarioFilter: string | undefined,
): T[] {
	if (scenarioFilter === undefined) {
		return [...scenarios];
	}
	const selected = scenarios.filter((scenario) => scenario.id === scenarioFilter);
	if (selected.length === 0) {
		throw new Error(`Report does not include scenario ${scenarioFilter}.`);
	}
	return selected;
}

/**
 * Reject stale or incomplete reports before baseline comparison.
 * Throws with an actionable message when compare would be misleading.
 */
export function assertComparableEvalReport(
	report: EvalReportScope,
	scenarioFilter: string | undefined,
	canonicalScenarioIds: readonly string[],
): void {
	const runScope = report.runScope ?? "full";
	const includedIds = report.includedScenarioIds ?? report.scenarios.map((scenario) => scenario.id);

	if (runScope === "partial" && scenarioFilter === undefined) {
		throw new Error(
			`Report is partial (covers [${includedIds.join(", ")}] only). `
				+ "Run a full eval (`pnpm alpha-eval run`) or pass `--scenario <id>` to compare a single scenario.",
		);
	}

	if (runScope === "full" && scenarioFilter === undefined) {
		const missing = canonicalScenarioIds.filter((id) => !includedIds.includes(id));
		if (missing.length > 0) {
			throw new Error(
				`Full eval report is missing canonical scenario(s): ${missing.join(", ")}. Rerun \`pnpm alpha-eval run\` without --scenario.`,
			);
		}
	}

	if (scenarioFilter !== undefined && !includedIds.includes(scenarioFilter)) {
		throw new Error(`Report does not include scenario ${scenarioFilter}. Included: [${includedIds.join(", ")}].`);
	}
}

/**
 * Tolerance policy for new baselines: an absolute floor absorbs toolchain jitter
 * (ffmpeg/x264/sharp version drift), a relative component scales with the metric.
 */
export function defaultTolerance(value: number): number {
	return Number(Math.max(0.005, Math.abs(value) * 0.15).toFixed(4));
}

export function buildBaseline(
	scenarios: readonly ScenarioAggregates[],
	generatedAt: string,
	toolchain: Readonly<Record<string, string>>,
	toleranceFor: (metric: MetricName, value: number) => number = (_, value) => defaultTolerance(value),
): BaselineFile {
	const baselineScenarios: Record<string, Record<string, BaselineMetricEntry>> = {};
	for (const scenario of scenarios) {
		const metrics: Record<string, BaselineMetricEntry> = {};
		for (const metric of METRIC_NAMES) {
			const aggregate = scenario.aggregates[metric];
			if (!aggregate || aggregate.frames === 0) {
				continue;
			}
			metrics[metric] = {
				direction: aggregate.direction,
				mean: Number(aggregate.mean.toFixed(5)),
				meanTolerance: toleranceFor(metric, aggregate.mean),
				worstTolerance: toleranceFor(metric, aggregate.worstValue),
				worstValue: Number(aggregate.worstValue.toFixed(5)),
			};
		}
		baselineScenarios[scenario.id] = metrics;
	}
	return {
		generatedAt,
		scenarios: baselineScenarios,
		schemaVersion: 1,
		toolchain,
	};
}

export function formatComparisonTable(result: ComparisonResult): string {
	const lines: string[] = [];
	const header = `${"scenario".padEnd(12)} ${"metric".padEnd(26)} ${"mean base".padStart(10)} ${"mean curr".padStart(10)} ${"mean Δ".padStart(10)} ${"mean tol".padStart(8)} ${"worst base".padStart(10)} ${"worst curr".padStart(10)} ${"worst Δ".padStart(10)} ${"worst @".padStart(7)} ${"worst tol".padStart(9)}  status`;
	lines.push(header);
	lines.push("-".repeat(header.length));
	for (const row of result.rows) {
		const baselineMean = row.baselineMean === null ? "n/a" : row.baselineMean.toFixed(5);
		const currentMean = row.currentMean === null ? "n/a" : row.currentMean.toFixed(5);
		const meanDelta = row.meanDelta === null ? "n/a" : (row.meanDelta >= 0 ? "+" : "") + row.meanDelta.toFixed(5);
		const meanTolerance = row.meanTolerance === null ? "n/a" : row.meanTolerance.toFixed(4);
		const baselineWorst = row.baselineWorstValue === null ? "n/a" : row.baselineWorstValue.toFixed(5);
		const currentWorstValue = row.currentWorstValue === null ? "n/a" : row.currentWorstValue.toFixed(5);
		const worstDelta = row.worstDelta === null ? "n/a" : (row.worstDelta >= 0 ? "+" : "") + row.worstDelta.toFixed(5);
		const worstFrame = row.currentWorstFrame === null ? "n/a" : String(row.currentWorstFrame);
		const worstTolerance = row.worstTolerance === null ? "n/a" : row.worstTolerance.toFixed(4);
		lines.push(
			`${row.scenario.padEnd(12)} ${row.metric.padEnd(26)} ${baselineMean.padStart(10)} ${currentMean.padStart(10)} ${meanDelta.padStart(10)} ${meanTolerance.padStart(8)} ${baselineWorst.padStart(10)} ${currentWorstValue.padStart(10)} ${worstDelta.padStart(10)} ${worstFrame.padStart(7)} ${worstTolerance.padStart(9)}  ${row.status.toUpperCase()}`,
		);
	}
	return lines.join("\n");
}
