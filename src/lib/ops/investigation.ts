import {
	type GenerationFailureKind,
	type GenerationOpsEventType,
	type GenerationStage,
	type GenerationStatus,
} from '../generation-types.js';

export const CRITICAL_PATH_VERDICTS = [
	'pass',
	'fail',
	'in_flight',
	'not_applicable',
	'unknown'
] as const;

export type CriticalPathVerdict = (typeof CRITICAL_PATH_VERDICTS)[number];

export interface DownloadProbe {
	readonly ok: boolean;
	readonly status?: number;
	readonly contentType?: string;
	readonly contentLength?: number;
	readonly digestHeaderPresent: boolean;
	readonly error?: string;
}

export interface GenerationArtifacts {
	readonly resultStorageIdPresent: boolean;
	readonly optimizedStorageIdPresent: boolean;
	readonly resultUrlIssued: boolean;
	readonly optimizedUrlIssued: boolean;
	readonly resultDownloadProbe?: DownloadProbe;
	readonly optimizedDownloadProbe?: DownloadProbe;
}

export interface OpsTimelineEvent {
	readonly attemptDurationMs?: number;
	readonly createdAt: number;
	readonly error?: string;
	readonly eventType: GenerationOpsEventType;
	readonly generationDurationMs?: number;
	readonly retryCount?: number;
	readonly severity?: 'info' | 'warning' | 'critical';
	readonly stage?: GenerationStage;
	readonly statusMessage?: string;
	readonly totalRetryCount?: number;
}

export interface GenerationInvestigationReport {
	readonly generation: {
		readonly id: string;
		readonly userId: string;
		readonly status: GenerationStatus;
		readonly stage?: GenerationStage;
		readonly failureKind?: GenerationFailureKind;
		readonly failureStage?: GenerationStage;
		readonly userFacingError?: string;
		readonly internalError?: string;
		readonly creditRefunded: boolean;
		readonly retryCount: number;
		readonly createdAt: number;
		readonly completedAt?: number;
		readonly generationTimeMs?: number;
	};
	readonly user: {
		readonly id: string;
		readonly email?: string;
		readonly credits?: number;
		readonly totalGenerations: number;
		readonly completedGenerations: number;
		readonly failedGenerations: number;
		readonly laterGenerations: number;
		readonly laterCompletedGenerations: number;
	};
	readonly artifacts: GenerationArtifacts;
	readonly opsTimeline: readonly OpsTimelineEvent[];
	readonly verdict: GenerationInvestigationVerdict;
}

export interface GenerationInvestigationVerdict {
	readonly auth: CriticalPathVerdict;
	readonly generation: CriticalPathVerdict;
	readonly download: CriticalPathVerdict;
	readonly refund: CriticalPathVerdict;
	readonly systemRecovered: boolean;
	readonly userRetriedAfterThis: boolean;
	readonly userRecoveredAfterThis: boolean;
	readonly recommendedAction: string;
}

export interface GenerationInvestigationVerdictInput {
	readonly artifacts: GenerationArtifacts;
	readonly creditRefunded: boolean;
	readonly createdAt: number;
	readonly laterCompletedGenerations: number;
	readonly laterGenerations: number;
	readonly now: number;
	readonly opsTimeline?: readonly OpsTimelineEvent[];
	readonly retryCount: number;
	readonly staleAfterMs?: number;
	readonly status: GenerationStatus;
}

export const DEFAULT_STALE_GENERATION_MS = 15 * 60 * 1000;

const hasAnyArtifactStorageId = (artifacts: GenerationArtifacts): boolean =>
	artifacts.resultStorageIdPresent || artifacts.optimizedStorageIdPresent;

const presentArtifactChecks = (artifacts: GenerationArtifacts): Array<{
	readonly probe?: DownloadProbe;
	readonly urlIssued: boolean;
}> => {
	const checks: Array<{ probe?: DownloadProbe; urlIssued: boolean }> = [];
	if (artifacts.resultStorageIdPresent) {
		checks.push({
			probe: artifacts.resultDownloadProbe,
			urlIssued: artifacts.resultUrlIssued
		});
	}
	if (artifacts.optimizedStorageIdPresent) {
		checks.push({
			probe: artifacts.optimizedDownloadProbe,
			urlIssued: artifacts.optimizedUrlIssued
		});
	}
	return checks;
};

export function classifyGenerationCriticalPath(input: GenerationInvestigationVerdictInput): CriticalPathVerdict {
	if (input.status === 'failed') {
		return 'fail';
	}
	if (input.status === 'generating') {
		const staleAfterMs = input.staleAfterMs ?? DEFAULT_STALE_GENERATION_MS;
		return input.now - input.createdAt >= staleAfterMs ? 'fail' : 'in_flight';
	}
	return hasAnyArtifactStorageId(input.artifacts) ? 'pass' : 'fail';
}

export function classifyDownloadCriticalPath(input: GenerationInvestigationVerdictInput): CriticalPathVerdict {
	if (input.status === 'failed') {
		return 'not_applicable';
	}
	if (input.status === 'generating') {
		return 'unknown';
	}
	if (!hasAnyArtifactStorageId(input.artifacts)) {
		return 'fail';
	}

	const checks = presentArtifactChecks(input.artifacts);
	if (checks.some((check) => !check.urlIssued)) {
		return 'fail';
	}
	if (checks.some((check) => check.probe === undefined)) {
		return 'unknown';
	}
	return checks.every((check) => check.probe?.ok === true) ? 'pass' : 'fail';
}

export function classifyRefundCriticalPath(input: GenerationInvestigationVerdictInput): CriticalPathVerdict {
	if (input.status !== 'failed') {
		return 'not_applicable';
	}
	return input.creditRefunded ? 'pass' : 'fail';
}

function hasInternalRetry(input: GenerationInvestigationVerdictInput): boolean {
	if (input.retryCount > 0) {
		return true;
	}
	return Boolean(input.opsTimeline?.some((event) => event.eventType === 'stage_retry_scheduled'));
}

function recommendedActionFor(input: GenerationInvestigationVerdictInput): string {
	const generation = classifyGenerationCriticalPath(input);
	const download = classifyDownloadCriticalPath(input);
	const refund = classifyRefundCriticalPath(input);
	const userRecovered = input.laterCompletedGenerations > 0;

	if (input.status === 'complete' && generation === 'pass' && download === 'pass') {
		return 'No action needed; the generation completed and its artifact is reachable.';
	}
	if (input.status === 'complete' && download === 'unknown') {
		return 'Run the download probe before closing the investigation.';
	}
	if (input.status === 'complete') {
		return 'Restore or regenerate the missing artifact, then verify download reachability.';
	}
	if (input.status === 'failed' && refund === 'fail') {
		return 'Refund the generation credit or inspect the refund path.';
	}
	if (input.status === 'failed' && userRecovered) {
		return 'No action needed; the credit was refunded and the user later recovered.';
	}
	if (input.status === 'failed' && input.laterGenerations > 0) {
		return 'Inspect the later retry outcome and consider outreach if it did not complete.';
	}
	if (input.status === 'failed') {
		return 'No product-side recovery is visible; consider outreach if this was a new user.';
	}
	if (generation === 'fail') {
		return 'Inspect the worker path for a stale in-flight generation and refund if needed.';
	}
	return 'Wait for a terminal status unless the generation crosses the stale threshold.';
}

export function buildGenerationInvestigationVerdict(
	input: GenerationInvestigationVerdictInput
): GenerationInvestigationVerdict {
	const systemRecovered = input.status === 'complete' && hasInternalRetry(input);

	return {
		auth: 'unknown',
		generation: classifyGenerationCriticalPath(input),
		download: classifyDownloadCriticalPath(input),
		refund: classifyRefundCriticalPath(input),
		systemRecovered,
		userRetriedAfterThis: input.laterGenerations > 0,
		userRecoveredAfterThis: input.laterCompletedGenerations > 0,
		recommendedAction: recommendedActionFor(input)
	};
}

export function buildGenerationVerdictInputFromReport(
	report: GenerationInvestigationReport,
	now: number,
	staleAfterMs = DEFAULT_STALE_GENERATION_MS
): GenerationInvestigationVerdictInput {
	return {
		artifacts: report.artifacts,
		creditRefunded: report.generation.creditRefunded,
		createdAt: report.generation.createdAt,
		laterCompletedGenerations: report.user.laterCompletedGenerations,
		laterGenerations: report.user.laterGenerations,
		now,
		opsTimeline: report.opsTimeline,
		retryCount: report.generation.retryCount,
		staleAfterMs,
		status: report.generation.status
	};
}

export function attachGenerationDownloadProbes(
	report: GenerationInvestigationReport,
	probes: Pick<GenerationArtifacts, 'resultDownloadProbe' | 'optimizedDownloadProbe'>,
	now: number,
	staleAfterMs = DEFAULT_STALE_GENERATION_MS
): GenerationInvestigationReport {
	const artifacts = {
		...report.artifacts,
		...probes
	};
	const nextReport = {
		...report,
		artifacts
	};

	return {
		...nextReport,
		verdict: buildGenerationInvestigationVerdict(
			buildGenerationVerdictInputFromReport(nextReport, now, staleAfterMs)
		)
	};
}
