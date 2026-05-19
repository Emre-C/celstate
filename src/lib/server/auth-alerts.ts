import * as Sentry from '@sentry/sveltekit';
import {
	assertOkWebhookResponse,
	buildAuthAlertRequest,
	readOpsAlertRuntimeConfig,
	type AuthAlertContext
} from '../../convex/lib/ops.js';

type AlertWindowState = {
	count: number;
	lastAlertAt: number | null;
	windowStartedAt: number;
};

type AuthRequestMetadata = {
	host: string;
	method: string;
	origin?: string;
	pathname: string;
	referer?: string;
	requestId?: string;
};

type AuthEndpoint5xxInput = AuthRequestMetadata & {
	status: number;
};

const AUTH_5XX_THRESHOLD = 3;
const AUTH_5XX_WINDOW_MS = 60_000;
const AUTH_ALERT_COOLDOWN_MS = 5 * 60_000;
const authAlertWindows = new Map<string, AlertWindowState>();

const takeRateLimitedAlert = (options: {
	cooldownMs: number;
	key: string;
	now?: number;
	threshold: number;
	windowMs: number;
}) => {
	const now = options.now ?? Date.now();
	const existing = authAlertWindows.get(options.key);
	let state = existing;

	if (!state || now - state.windowStartedAt > options.windowMs) {
		state = {
			count: 0,
			lastAlertAt: existing?.lastAlertAt ?? null,
			windowStartedAt: now
		};
	}

	state.count += 1;

	const shouldAlert =
		state.count >= options.threshold &&
		(state.lastAlertAt === null || now - state.lastAlertAt >= options.cooldownMs);

	if (shouldAlert) {
		state.lastAlertAt = now;
	}

	authAlertWindows.set(options.key, state);

	return {
		count: state.count,
		shouldAlert
	};
};

const sendAuthWebhookAlert = async (context: AuthAlertContext) => {
	const config = readOpsAlertRuntimeConfig();
	if (!config.webhookUrl) {
		return;
	}

	try {
		const request = buildAuthAlertRequest(config, context);
		const response = await fetch(request.url, {
			method: 'POST',
			headers: request.headers,
			body: request.body
		});
		assertOkWebhookResponse(response);
	} catch (error) {
		Sentry.captureException(error, {
			level: 'error',
			tags: {
				auth_alert: 'true',
				alert_type: 'auth_alert_delivery_failed'
			},
			extra: {
				context
			}
		});
	}
};

export const recordRepeatedAuthEndpoint5xx = async (input: AuthEndpoint5xxInput) => {
	const { count, shouldAlert } = takeRateLimitedAlert({
		key: `auth_endpoint_5xx:${input.pathname}:${input.status}`,
		threshold: AUTH_5XX_THRESHOLD,
		windowMs: AUTH_5XX_WINDOW_MS,
		cooldownMs: AUTH_ALERT_COOLDOWN_MS
	});

	if (!shouldAlert) {
		return;
	}

	Sentry.captureMessage('Auth endpoint returned 5xx', {
		level: 'error',
		tags: {
			auth_alert: 'true',
			alert_type: 'auth_endpoint_5xx',
			pathname: input.pathname,
			status: String(input.status)
		},
		extra: {
			host: input.host,
			method: input.method,
			origin: input.origin,
			pathname: input.pathname,
			referer: input.referer,
			requestId: input.requestId,
			status: input.status
		},
		fingerprint: ['auth', 'endpoint-5xx', input.pathname, String(input.status)]
	});

	await sendAuthWebhookAlert({
		alertType: 'auth_endpoint_5xx',
		severity: 'critical',
		count,
		host: input.host,
		method: input.method,
		origin: input.origin,
		pathname: input.pathname,
		referer: input.referer,
		requestId: input.requestId,
		status: input.status,
		windowMs: AUTH_5XX_WINDOW_MS
	});
};

export const resetAuthAlertStateForTests = () => {
	authAlertWindows.clear();
};
