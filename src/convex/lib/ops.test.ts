import { describe, expect, it } from 'vitest';
import {
	buildGenerationAlertRequest,
	formatDurationMs,
	readOpsAlertRuntimeConfig,
	summarizeGenerationOpsEvents
} from './ops.js';

describe('ops helpers', () => {
	it('detects slack webhook configuration from the webhook host', () => {
		const config = readOpsAlertRuntimeConfig({
			OPS_ALERT_WEBHOOK_URL: 'https://hooks.slack.com/services/T000/B000/secret'
		});

		expect(config).toEqual({
			webhookKind: 'slack',
			webhookUrl: 'https://hooks.slack.com/services/T000/B000/secret'
		});
	});

	it('builds slack-compatible webhook payloads', () => {
		const request = buildGenerationAlertRequest(
			{
				webhookKind: 'slack',
				webhookUrl: 'https://hooks.slack.com/services/T000/B000/secret'
			},
			{
				alertType: 'generation_failed',
				createdAt: 1,
				error: 'Vertex quota exhausted',
				generationDurationMs: 83_000,
				generationId: 'gen_123',
				retryCount: 1,
				severity: 'critical',
				stage: 'black_background',
				statusMessage: 'Fine-tuning output…',
				totalRetryCount: 2,
				userEmail: 'founder@celstate.com',
				userId: 'user_123'
			}
		);

		const body = JSON.parse(request.body) as {
			text: string;
			blocks: Array<{ type: string; text?: { text: string } }>;
		};

		expect(request.headers['content-type']).toBe('application/json');
		expect(body.text).toContain('CRITICAL: Celstate generation failed');
		expect(body.text).toContain('founder@celstate.com');
		expect(body.text).toContain('Vertex quota exhausted');
		expect(body.blocks[0]?.type).toBe('header');
	});

	it('summarizes generation ops metrics for AI-readable inspection', () => {
		const summary = summarizeGenerationOpsEvents([
			{ eventType: 'generation_requested', generationDurationMs: 0 },
			{ eventType: 'generation_requested', generationDurationMs: 0 },
			{ eventType: 'stage_retry_scheduled', attemptDurationMs: 5_000 },
			{ eventType: 'generation_completed', generationDurationMs: 20_000, totalRetryCount: 1 },
			{ eventType: 'generation_failed', generationDurationMs: 40_000 },
			{ eventType: 'alert_failed', generationDurationMs: 40_000 }
		]);

		expect(summary.totals.requested).toBe(2);
		expect(summary.totals.completed).toBe(1);
		expect(summary.totals.failed).toBe(1);
		expect(summary.totals.retries).toBe(1);
		expect(summary.totals.alertFailures).toBe(1);
		expect(summary.totals.successRate).toBe(50);
		expect(summary.totals.failureRate).toBe(50);
		expect(summary.performance.avgGenerationTimeMs).toBe(20_000);
		expect(summary.performance.avgAttemptTimeMs).toBe(5_000);
		expect(summary.performance.avgRetriesPerCompletedGeneration).toBe(1);
	});

	it('formats durations into readable alert text', () => {
		expect(formatDurationMs(850)).toBe('850ms');
		expect(formatDurationMs(61_000)).toBe('1m 1s');
		expect(formatDurationMs(3_661_000)).toBe('1h 1m 1s');
	});
});
