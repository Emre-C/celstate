import { describe, expect, it, vi } from 'vitest';
import {
	assertOkWebhookResponse,
	buildAuthAlertRequest,
	buildGenerationAlertRequest,
	buildPurchaseAlertRequest,
	buildSecretRotationReminderRequest,
	buildSignupAlertRequest,
	formatDurationMs,
	readOpsAlertRuntimeConfig,
	sendOpsWebhook,
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
				creditRefunded: true,
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
		expect(body.text).toContain('Credit refunded: yes');
		expect(body.text).toContain('Investigate: pnpm ops:investigate generation --id gen_123');
		expect(body.text).toContain('Vertex quota exhausted');
		expect(body.blocks[0]?.type).toBe('header');
	});

	it('builds generic purchase webhook payloads', () => {
		const request = buildPurchaseAlertRequest(
			{
				webhookKind: 'generic',
				webhookUrl: 'https://ops.example.com/webhook'
			},
			{
				amountUsd: 10,
				creditsAdded: 40,
				currency: 'usd',
				stripePaymentIntentId: 'pi_123',
				userEmail: 'founder@celstate.com',
				userId: 'user_123'
			}
		);

		expect(request.headers['content-type']).toBe('application/json');
		expect(JSON.parse(request.body)).toEqual({
			event: 'purchase_new',
			credits_added: 40,
			currency: 'usd',
			amount_usd: 10,
			stripe_payment_intent_id: 'pi_123',
			user_id: 'user_123',
			user_email: 'founder@celstate.com',
			title: 'Celstate purchase completed'
		});
	});

	it('builds generic signup webhook payloads', () => {
		const request = buildSignupAlertRequest(
			{
				webhookKind: 'generic',
				webhookUrl: 'https://ops.example.com/webhook'
			},
			{
				authProvider: 'google',
				initialCredits: 3,
				name: 'Ada',
				userEmail: 'ada@example.com',
				userId: 'user_456'
			}
		);

		expect(request.headers['content-type']).toBe('application/json');
		expect(JSON.parse(request.body)).toEqual({
			event: 'signup_new',
			auth_provider: 'google',
			initial_credits: 3,
			investigate_command: 'pnpm ops:investigate user --email ada@example.com',
			name: 'Ada',
			title: 'Celstate new user signup',
			user_email: 'ada@example.com',
			user_id: 'user_456'
		});
	});

	it('builds generic auth outage webhook payloads', () => {
		const request = buildAuthAlertRequest(
			{
				webhookKind: 'generic',
				webhookUrl: 'https://ops.example.com/webhook'
			},
			{
				alertType: 'auth_endpoint_5xx',
				severity: 'critical',
				count: 3,
				windowMs: 60_000,
				host: 'celstate.com',
				method: 'GET',
				pathname: '/api/auth/session',
				requestId: 'req-123',
				status: 503
			}
		);

		expect(request.headers['content-type']).toBe('application/json');
		expect(JSON.parse(request.body)).toEqual({
			event: 'auth_outage',
			title: 'Celstate auth endpoint returned repeated 5xx responses',
			severity: 'critical',
			alert_type: 'auth_endpoint_5xx',
			investigate_command: 'pnpm ops:investigate health',
			context: {
				alertType: 'auth_endpoint_5xx',
				severity: 'critical',
				count: 3,
				windowMs: 60_000,
				host: 'celstate.com',
				method: 'GET',
				pathname: '/api/auth/session',
				requestId: 'req-123',
				status: 503
			}
		});
	});

	it('builds discord-formatted secret rotation reminder payloads', () => {
		const request = buildSecretRotationReminderRequest(
			{
				webhookKind: 'discord',
				webhookUrl: 'https://discord.com/api/webhooks/123/abc'
			},
			{
				cadenceLabel: 'quarterly',
				gcpProjectId: 'celstate-489304',
				gcpServiceAccountEmail: 'vertex-express@celstate-489304.iam.gserviceaccount.com'
			}
		);

		const body = JSON.parse(request.body) as { content: string };
		expect(request.headers['content-type']).toBe('application/json');
		expect(body.content).toContain('Celstate quarterly secret rotation reminder');
		expect(body.content).toContain('pnpm secrets:rotate');
		expect(body.content).toContain('pnpm secrets:sync:convex');
		expect(body.content).toContain(
			'pnpm secrets:rotate-gcp -- --service-account=vertex-express@celstate-489304.iam.gserviceaccount.com --project=celstate-489304 --old-key-id=<current>'
		);
		expect(body.content).toContain('Stripe Secret Key');
		expect(body.content).toContain('Google OAuth Secret');
		expect(body.content).toContain('rotation invalidates all active sessions');
	});

	it('omits gcp args from the rotation reminder when project metadata is missing', () => {
		const request = buildSecretRotationReminderRequest(
			{
				webhookKind: 'generic',
				webhookUrl: 'https://ops.example.com/webhook'
			},
			{ cadenceLabel: 'quarterly' }
		);

		const body = JSON.parse(request.body) as Record<string, unknown>;
		expect(body.event).toBe('secret_rotation_reminder');
		expect(body.cadence).toBe('quarterly');
		expect(body.gcp_project_id).toBeUndefined();
		expect(body.gcp_service_account_email).toBeUndefined();
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

	it('assertOkWebhookResponse passes when response is ok', () => {
		const response = new Response(null, { status: 200, statusText: 'OK' });
		expect(() => assertOkWebhookResponse(response)).not.toThrow();
	});

	it('assertOkWebhookResponse throws with status when response is not ok', () => {
		const response = new Response(null, { status: 502, statusText: 'Bad Gateway' });
		expect(() => assertOkWebhookResponse(response)).toThrow(
			'Webhook responded with 502 Bad Gateway'
		);
	});

	it('sendOpsWebhook returns { ok: true } on successful delivery', async () => {
		const mockResponse = new Response(null, { status: 200, statusText: 'OK' });
		const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(mockResponse);

		const result = await sendOpsWebhook({
			url: 'https://example.com/webhook',
			headers: { 'content-type': 'application/json' },
			body: '{"test":true}',
		});

		expect(result).toEqual({ ok: true });
		fetchSpy.mockRestore();
	});

	it('sendOpsWebhook returns { ok: false } on failure when onError is provided', async () => {
		const fetchSpy = vi.spyOn(globalThis, 'fetch').mockRejectedValueOnce(new Error('Network error'));
		const onError = vi.fn();

		const result = await sendOpsWebhook(
			{
				url: 'https://example.com/webhook',
				headers: { 'content-type': 'application/json' },
				body: '{"test":true}',
			},
			{ onError },
		);

		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(result.error).toBeInstanceOf(Error);
		}
		expect(onError).toHaveBeenCalledOnce();
		fetchSpy.mockRestore();
	});

	it('sendOpsWebhook throws on failure when no onError is provided', async () => {
		const fetchSpy = vi.spyOn(globalThis, 'fetch').mockRejectedValueOnce(new Error('Network error'));

		await expect(
			sendOpsWebhook({
				url: 'https://example.com/webhook',
				headers: { 'content-type': 'application/json' },
				body: '{"test":true}',
			}),
		).rejects.toThrow('Network error');

		fetchSpy.mockRestore();
	});
});
