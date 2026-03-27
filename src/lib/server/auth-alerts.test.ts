import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@sentry/sveltekit', () => ({
	captureException: vi.fn(),
	captureMessage: vi.fn()
}));

import * as Sentry from '@sentry/sveltekit';

import {
	recordRepeatedAuthEndpoint5xx,
	reportAuthProxyFailure,
	resetAuthAlertStateForTests
} from './auth-alerts.js';

describe('auth alerting', () => {
	beforeEach(() => {
		process.env.OPS_ALERT_WEBHOOK_KIND = 'discord';
		process.env.OPS_ALERT_WEBHOOK_URL = 'https://discord.com/api/webhooks/test/test';
		resetAuthAlertStateForTests();
		vi.clearAllMocks();
		vi.useFakeTimers();
		vi.setSystemTime(new Date('2026-03-26T04:15:00.000Z'));
		vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(null, { status: 200, statusText: 'OK' })));
	});

	afterEach(() => {
		delete process.env.OPS_ALERT_WEBHOOK_KIND;
		delete process.env.OPS_ALERT_WEBHOOK_URL;
		vi.useRealTimers();
		vi.unstubAllGlobals();
		vi.restoreAllMocks();
	});

	it('alerts only after repeated auth 5xx responses cross the threshold', async () => {
		await recordRepeatedAuthEndpoint5xx({
			host: 'celstate.com',
			method: 'GET',
			pathname: '/api/auth/get-session',
			requestId: 'req-1',
			status: 503
		});
		await recordRepeatedAuthEndpoint5xx({
			host: 'celstate.com',
			method: 'GET',
			pathname: '/api/auth/get-session',
			requestId: 'req-2',
			status: 503
		});

		expect(vi.mocked(Sentry.captureMessage)).not.toHaveBeenCalled();
		expect(fetch).not.toHaveBeenCalled();

		await recordRepeatedAuthEndpoint5xx({
			host: 'celstate.com',
			method: 'GET',
			pathname: '/api/auth/get-session',
			requestId: 'req-3',
			status: 503
		});

		expect(vi.mocked(Sentry.captureMessage)).toHaveBeenCalledTimes(1);
		expect(fetch).toHaveBeenCalledTimes(1);
		const [, options] = vi.mocked(fetch).mock.calls[0] ?? [];
		const body = JSON.parse(String(options?.body));
		expect(body.content).toContain('CRITICAL: Celstate auth endpoint returned repeated 5xx responses');
		expect(body.content).toContain('Path: /api/auth/get-session');
		expect(body.content).toContain('Failure count: 3');
		expect(body.content).toContain('Status: 503');
	});

	it('rate limits repeated auth proxy outage webhook alerts', async () => {
		await reportAuthProxyFailure({
			attempts: 3,
			error: 'fetch failed',
			host: 'celstate.com',
			method: 'GET',
			pathname: '/api/auth/get-session',
			requestId: 'req-1'
		});
		await reportAuthProxyFailure({
			attempts: 3,
			error: 'fetch failed',
			host: 'celstate.com',
			method: 'GET',
			pathname: '/api/auth/get-session',
			requestId: 'req-2'
		});

		expect(vi.mocked(Sentry.captureMessage)).toHaveBeenCalledTimes(1);
		expect(fetch).toHaveBeenCalledTimes(1);
	});
});
