/// <reference types="vite/client" />
import { convexTest } from 'convex-test';
import { describe, expect, it } from 'vitest';
import { internal } from './_generated/api.js';
import schema from './schema.js';

process.env.SITE_URL ??= 'http://127.0.0.1:4174';
process.env.AUTH_GOOGLE_ID ??= 'test-google-client-id';
process.env.AUTH_GOOGLE_SECRET ??= 'test-google-client-secret';

const modules = import.meta.glob([
	'/src/convex/**/*.ts',
	'!/src/convex/**/*.test.ts'
]);

describe('ops investigation read models', () => {
	it('assembles a generation report without prompt text and with retry/recovery evidence', async () => {
		const t = convexTest(schema, modules);
		const ids = await t.run(async (ctx) => {
			const userId = await ctx.db.insert('users', {
				clerkUserId: 'clerk_user',
				credits: 3,
				email: 'ops-user@celstate.test',
				tokenIdentifier: 'token'
			});
			const failedGenerationId = await ctx.db.insert('generations', {
				aspectRatio: '1:1',
				completedAt: 200,
				createdAt: 100,
				creditRefundedAt: 220,
				creditsCost: 1,
				error: 'The generation failed. Your credit was refunded.',
				failureKind: 'provider_error',
				failureStage: 'black_background',
				prompt: 'sensitive prompt that must not appear',
				retryCount: 1,
				status: 'failed',
				userId
			});
			await ctx.db.insert('generationOpsEvents', {
				createdAt: 120,
				eventType: 'stage_retry_scheduled',
				generationId: failedGenerationId,
				retryCount: 1,
				severity: 'warning',
				stage: 'black_background',
				totalRetryCount: 1,
				userId
			});
			await ctx.db.insert('generationOpsEvents', {
				createdAt: 200,
				error: 'Vertex provider returned 503',
				eventType: 'generation_failed',
				generationId: failedGenerationId,
				severity: 'critical',
				stage: 'black_background',
				userEmail: 'ops-user@celstate.test',
				userId
			});
			await ctx.db.insert('generations', {
				aspectRatio: '1:1',
				completedAt: 400,
				createdAt: 300,
				creditsCost: 1,
				prompt: 'later safe retry',
				status: 'complete',
				userId
			});
			return { failedGenerationId };
		});

		const readModel = await t.query(internal.ops.getGenerationInvestigation, {
			generationId: ids.failedGenerationId,
			now: 1_000
		});

		expect(readModel?.report.generation).toMatchObject({
			creditRefunded: true,
			failureKind: 'provider_error',
			failureStage: 'black_background',
			internalError: 'Vertex provider returned 503',
			retryCount: 1,
			status: 'failed'
		});
		expect(readModel?.report.user).toMatchObject({
			laterCompletedGenerations: 1,
			laterGenerations: 1
		});
		expect(readModel?.report.verdict).toMatchObject({
			download: 'not_applicable',
			refund: 'pass',
			userRecoveredAfterThis: true,
			userRetriedAfterThis: true
		});
		expect(JSON.stringify(readModel)).not.toContain('sensitive prompt');
	});

	it('classifies a completed generation with no artifact storage as failed product evidence', async () => {
		const t = convexTest(schema, modules);
		const generationId = await t.run(async (ctx) => {
			const userId = await ctx.db.insert('users', {
				credits: 2,
				email: 'missing-artifact@celstate.test'
			});
			return await ctx.db.insert('generations', {
				aspectRatio: '1:1',
				completedAt: 200,
				createdAt: 100,
				creditsCost: 1,
				prompt: 'transparent icon',
				status: 'complete',
				userId
			});
		});

		const readModel = await t.query(internal.ops.getGenerationInvestigation, {
			generationId,
			now: 1_000
		});

		expect(readModel?.report.artifacts).toMatchObject({
			optimizedStorageIdPresent: false,
			resultStorageIdPresent: false,
			resultUrlIssued: false
		});
		expect(readModel?.report.verdict.generation).toBe('fail');
		expect(readModel?.report.verdict.download).toBe('fail');
	});

	it('returns recent generation incidents from indexed event-type queries', async () => {
		const t = convexTest(schema, modules);
		await t.run(async (ctx) => {
			const userId = await ctx.db.insert('users', { email: 'recent@celstate.test' });
			const generationId = await ctx.db.insert('generations', {
				aspectRatio: '1:1',
				createdAt: 100,
				creditsCost: 1,
				prompt: 'recent incident',
				status: 'failed',
				userId
			});
			for (const [eventType, createdAt] of [
				['generation_failed', 200],
				['generation_stalled', 300],
				['alert_failed', 400]
			] as const) {
				await ctx.db.insert('generationOpsEvents', {
					createdAt,
					eventType,
					generationId,
					severity: 'critical',
					userId
				});
			}
		});

		const report = await t.query(internal.ops.getRecentGenerationIncidents, {
			limit: 2,
			now: 1_000
		});

		expect(report.incidents.map((incident) => incident.eventType)).toEqual([
			'alert_failed',
			'generation_stalled'
		]);
		expect(report.window.limit).toBe(2);
	});

	it('normalizes pasted email input for user investigations', async () => {
		const t = convexTest(schema, modules);
		await t.run(async (ctx) => {
			const userId = await ctx.db.insert('users', {
				clerkUserId: 'clerk_mixed',
				credits: 4,
				email: 'mixed-case@celstate.test',
				tokenIdentifier: 'token_mixed'
			});
			await ctx.db.insert('generations', {
				aspectRatio: '1:1',
				completedAt: 200,
				createdAt: 100,
				creditsCost: 1,
				prompt: 'transparent icon',
				status: 'complete',
				userId
			});
		});

		const report = await t.query(internal.ops.getUserInvestigation, {
			email: ' Mixed-Case@Celstate.TEST ',
			now: 1_000
		});

		expect(report?.user.email).toBe('mixed-case@celstate.test');
		expect(report?.authBinding).toMatchObject({
			clerkUserIdPresent: true,
			tokenIdentifierPresent: true
		});
		expect(report?.latestGenerations).toHaveLength(1);
	});

	it('surfaces latest production health and download proof evidence', async () => {
		const t = convexTest(schema, modules);
		await t.run(async (ctx) => {
			await ctx.db.insert('verificationRuns', {
				authVerdict: {
					domain: 'AUTH',
					evidenceRef: 'run:AUTH:1',
					finishedAt: 2,
					requirement: 'REQUIRED_ON_DEPLOY',
					startedAt: 1,
					trigger: 'POST_DEPLOY',
					verdict: 'PASSED'
				},
				generationVerdict: {
					domain: 'GENERATION',
					evidenceRef: 'run:GENERATION:1',
					finishedAt: 3,
					requirement: 'REQUIRED_ON_DEPLOY',
					startedAt: 2,
					trigger: 'POST_DEPLOY',
					verdict: 'PASSED'
				},
				releaseDecision: 'ALLOW',
				requiredDomains: ['AUTH', 'GENERATION', 'CHECKOUT_SESSION'],
				runKey: 'post_deploy:test',
				startedAt: 1,
				trigger: 'POST_DEPLOY'
			});
			await ctx.db.insert('verificationRuns', {
				authVerdict: {
					domain: 'AUTH',
					evidenceRef: 'run:AUTH:ci',
					finishedAt: 50_002,
					requirement: 'REQUIRED_ON_DEPLOY',
					startedAt: 50_001,
					trigger: 'PRE_MERGE_CI',
					verdict: 'FAILED'
				},
				generationVerdict: {
					domain: 'GENERATION',
					evidenceRef: 'run:GENERATION:ci',
					finishedAt: 50_003,
					requirement: 'REQUIRED_ON_DEPLOY',
					startedAt: 50_002,
					trigger: 'PRE_MERGE_CI',
					verdict: 'FAILED'
				},
				releaseDecision: 'DENY',
				requiredDomains: ['AUTH', 'GENERATION', 'CHECKOUT_SESSION'],
				runKey: 'pre_merge_ci:test',
				startedAt: 50_000,
				trigger: 'PRE_MERGE_CI'
			});
			await ctx.db.insert('verificationEvidence', {
				createdAt: 3,
				domain: 'GENERATION',
				evidenceRef: 'run:GENERATION:1',
				payloadJson: JSON.stringify({
					artifactDownloadReachable: true,
					terminalVerdict: 'COMPLETE'
				}),
				runKey: 'post_deploy:test',
				trigger: 'POST_DEPLOY'
			});
		});

		const report = await t.query(internal.ops.getLatestCriticalPathHealth, {
			now: 60_000
		});

		expect(report.verdict).toMatchObject({
			auth: 'pass',
			download: 'pass',
			generation: 'pass'
		});
		expect(report.latestRun?.runKey).toBe('post_deploy:test');
		expect(report.latestRun?.trigger).toBe('POST_DEPLOY');
		expect(report.evidence.generation?.payloadJson).toContain('artifactDownloadReachable');
	});
});
