import { describe, expect, it } from 'vitest';
import {
	attachGenerationDownloadProbes,
	buildGenerationInvestigationVerdict,
	type GenerationInvestigationReport,
	type GenerationInvestigationVerdictInput
} from './investigation.js';

const now = 1_000_000;

const baseInput = (
	partial: Partial<GenerationInvestigationVerdictInput> = {}
): GenerationInvestigationVerdictInput => ({
	artifacts: {
		optimizedStorageIdPresent: false,
		optimizedUrlIssued: false,
		resultStorageIdPresent: false,
		resultUrlIssued: false
	},
	createdAt: now - 1_000,
	creditRefunded: false,
	laterCompletedGenerations: 0,
	laterGenerations: 0,
	now,
	retryCount: 0,
	status: 'failed',
	...partial
});

describe('generation investigation verdicts', () => {
	it('classifies terminal failure with refund and no later generations', () => {
		const verdict = buildGenerationInvestigationVerdict(
			baseInput({
				creditRefunded: true,
				status: 'failed'
			})
		);

		expect(verdict).toMatchObject({
			generation: 'fail',
			download: 'not_applicable',
			refund: 'pass',
			userRetriedAfterThis: false,
			userRecoveredAfterThis: false
		});
	});

	it('classifies terminal failure followed by a later complete generation', () => {
		const verdict = buildGenerationInvestigationVerdict(
			baseInput({
				creditRefunded: true,
				laterCompletedGenerations: 1,
				laterGenerations: 2,
				status: 'failed'
			})
		);

		expect(verdict.userRetriedAfterThis).toBe(true);
		expect(verdict.userRecoveredAfterThis).toBe(true);
		expect(verdict.recommendedAction).toContain('later recovered');
	});

	it('classifies an internal retry followed by completion as system recovery', () => {
		const verdict = buildGenerationInvestigationVerdict(
			baseInput({
				artifacts: {
					optimizedStorageIdPresent: false,
					optimizedUrlIssued: false,
					resultDownloadProbe: {
						digestHeaderPresent: true,
						ok: true,
						status: 206
					},
					resultStorageIdPresent: true,
					resultUrlIssued: true
				},
				opsTimeline: [
					{
						createdAt: now - 500,
						eventType: 'stage_retry_scheduled',
						stage: 'black_background'
					}
				],
				retryCount: 1,
				status: 'complete'
			})
		);

		expect(verdict).toMatchObject({
			generation: 'pass',
			download: 'pass',
			refund: 'not_applicable',
			systemRecovered: true
		});
	});

	it('fails a complete generation with missing artifact storage', () => {
		const verdict = buildGenerationInvestigationVerdict(
			baseInput({
				status: 'complete'
			})
		);

		expect(verdict.generation).toBe('fail');
		expect(verdict.download).toBe('fail');
	});

	it('fails download when an issued artifact URL fails its HTTP probe', () => {
		const verdict = buildGenerationInvestigationVerdict(
			baseInput({
				artifacts: {
					optimizedStorageIdPresent: false,
					optimizedUrlIssued: false,
					resultDownloadProbe: {
						digestHeaderPresent: false,
						error: 'HTTP 403',
						ok: false,
						status: 403
					},
					resultStorageIdPresent: true,
					resultUrlIssued: true
				},
				status: 'complete'
			})
		);

		expect(verdict.generation).toBe('pass');
		expect(verdict.download).toBe('fail');
	});

	it('fails an in-flight generation older than the stale threshold', () => {
		const verdict = buildGenerationInvestigationVerdict(
			baseInput({
				createdAt: now - 30_000,
				staleAfterMs: 10_000,
				status: 'generating'
			})
		);

		expect(verdict.generation).toBe('fail');
		expect(verdict.download).toBe('unknown');
	});

	it('recomputes the report verdict after probes are attached', () => {
		const report: GenerationInvestigationReport = {
			artifacts: {
				optimizedStorageIdPresent: false,
				optimizedUrlIssued: false,
				resultStorageIdPresent: true,
				resultUrlIssued: true
			},
			generation: {
				createdAt: now - 100,
				creditRefunded: false,
				id: 'generation',
				retryCount: 0,
				status: 'complete',
				userId: 'user'
			},
			opsTimeline: [],
			user: {
				completedGenerations: 1,
				failedGenerations: 0,
				id: 'user',
				laterCompletedGenerations: 0,
				laterGenerations: 0,
				totalGenerations: 1
			},
			verdict: buildGenerationInvestigationVerdict(
				baseInput({
					artifacts: {
						optimizedStorageIdPresent: false,
						optimizedUrlIssued: false,
						resultStorageIdPresent: true,
						resultUrlIssued: true
					},
					status: 'complete'
				})
			)
		};

		expect(report.verdict.download).toBe('unknown');
		const probed = attachGenerationDownloadProbes(
			report,
			{
				resultDownloadProbe: {
					digestHeaderPresent: true,
					ok: true,
					status: 206
				}
			},
			now
		);

		expect(probed.verdict.download).toBe('pass');
	});
});
