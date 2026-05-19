import type { ResolvedAuthProvider } from '../../lib/auth/providers.js';
import type { GenerationStage } from './generationRun.js';

export const GENERATION_OPS_EVENT_TYPES = [
	'generation_requested',
	'stage_succeeded',
	'stage_retry_scheduled',
	'generation_completed',
	'generation_failed',
	'generation_stalled',
	'alert_sent',
	'alert_failed'
] as const;

export type GenerationOpsEventType = (typeof GENERATION_OPS_EVENT_TYPES)[number];

export const OPS_ALERT_SEVERITIES = ['info', 'warning', 'critical'] as const;

export type OpsAlertSeverity = (typeof OPS_ALERT_SEVERITIES)[number];

export const OPS_ALERT_WEBHOOK_KINDS = ['slack', 'discord', 'generic'] as const;

export type OpsAlertWebhookKind = (typeof OPS_ALERT_WEBHOOK_KINDS)[number];

export interface GenerationAlertContext {
	alertType: 'generation_failed' | 'generation_stalled';
	severity: Exclude<OpsAlertSeverity, 'info'>;
	generationId: string;
	userId: string;
	userEmail?: string;
	stage?: GenerationStage;
	retryCount?: number;
	totalRetryCount?: number;
	statusMessage?: string;
	error?: string;
	createdAt: number;
	generationDurationMs?: number;
}

export interface PurchaseAlertContext {
	amountUsd: number;
	creditsAdded: number;
	currency: string;
	stripePaymentIntentId: string;
	userEmail?: string;
	userId: string;
}

export interface SignupAlertContext {
	userId: string;
	userEmail?: string;
	name?: string;
	authProvider: ResolvedAuthProvider;
	initialCredits: number;
}

export interface SecretRotationReminderContext {
	cadenceLabel: string;
	gcpProjectId?: string;
	gcpServiceAccountEmail?: string;
}

export interface AuthAlertContext {
	alertType: 'auth_endpoint_5xx' | 'auth_kit_api_error';
	severity: Exclude<OpsAlertSeverity, 'info'>;
	pathname?: string;
	method?: string;
	host?: string;
	origin?: string;
	referer?: string;
	requestId?: string;
	status?: number;
	upstreamCfRay?: string;
	upstreamStatus?: number;
	attempts?: number;
	count?: number;
	windowMs?: number;
	error?: string;
	provider?: string;
	contextPath?: string;
	contextMethod?: string;
}

export interface OpsAlertRuntimeConfig {
	webhookKind: OpsAlertWebhookKind;
	webhookUrl?: string;
}

export interface GenerationOpsEventSummaryInput {
	eventType: GenerationOpsEventType;
	attemptDurationMs?: number;
	generationDurationMs?: number;
	totalRetryCount?: number;
}

export interface GenerationOpsSummary {
	totals: {
		requested: number;
		completed: number;
		failed: number;
		stalled: number;
		retries: number;
		alertFailures: number;
		successRate: number | null;
		failureRate: number | null;
	};
	performance: {
		avgGenerationTimeMs: number | null;
		p50GenerationTimeMs: number | null;
		p95GenerationTimeMs: number | null;
		avgAttemptTimeMs: number | null;
		p95AttemptTimeMs: number | null;
		avgRetriesPerCompletedGeneration: number | null;
	};
}

function isOpsAlertWebhookKind(value: string): value is OpsAlertWebhookKind {
	return OPS_ALERT_WEBHOOK_KINDS.includes(value as OpsAlertWebhookKind);
}

function roundMetric(value: number | null): number | null {
	if (value === null) {
		return null;
	}

	return Math.round(value * 100) / 100;
}

function average(values: number[]): number | null {
	if (values.length === 0) {
		return null;
	}

	return values.reduce((sum, value) => sum + value, 0) / values.length;
}

export function percentile(values: number[], percentileValue: number): number | null {
	if (values.length === 0) {
		return null;
	}

	const sorted = [...values].sort((left, right) => left - right);
	const index = Math.min(
		sorted.length - 1,
		Math.max(0, Math.ceil((percentileValue / 100) * sorted.length) - 1)
	);

	return sorted[index] ?? null;
}

export function formatDurationMs(durationMs?: number): string | undefined {
	if (durationMs === undefined || durationMs < 0) {
		return undefined;
	}

	if (durationMs < 1000) {
		return `${durationMs}ms`;
	}

	const totalSeconds = Math.round(durationMs / 1000);
	const hours = Math.floor(totalSeconds / 3600);
	const minutes = Math.floor((totalSeconds % 3600) / 60);
	const seconds = totalSeconds % 60;
	const parts: string[] = [];

	if (hours > 0) {
		parts.push(`${hours}h`);
	}

	if (minutes > 0) {
		parts.push(`${minutes}m`);
	}

	if (seconds > 0 || parts.length === 0) {
		parts.push(`${seconds}s`);
	}

	return parts.join(' ');
}

export function readOpsAlertRuntimeConfig(
	env: Record<string, string | undefined> = process.env
): OpsAlertRuntimeConfig {
	const webhookUrl = env.OPS_ALERT_WEBHOOK_URL?.trim() || undefined;
	const configuredKind = env.OPS_ALERT_WEBHOOK_KIND?.trim().toLowerCase();

	if (configuredKind && isOpsAlertWebhookKind(configuredKind)) {
		return {
			webhookKind: configuredKind,
			webhookUrl
		};
	}

	if (!webhookUrl) {
		return {
			webhookKind: 'generic'
		};
	}

	try {
		const hostname = new URL(webhookUrl).hostname.toLowerCase();

		if (hostname.includes('slack.com')) {
			return {
				webhookKind: 'slack',
				webhookUrl
			};
		}

		if (hostname.includes('discord.com') || hostname.includes('discordapp.com')) {
			return {
				webhookKind: 'discord',
				webhookUrl
			};
		}
	} catch {
		return {
			webhookKind: 'generic',
			webhookUrl
		};
	}

	return {
		webhookKind: 'generic',
		webhookUrl
	};
}

function truncateError(error?: string, maxLength = 300): string | undefined {
	if (!error) {
		return undefined;
	}

	return error.length <= maxLength ? error : `${error.slice(0, maxLength - 1)}…`;
}

function buildAlertTitle(context: GenerationAlertContext): string {
	return context.alertType === 'generation_failed'
		? 'Celstate generation failed'
		: 'Celstate generation appears stalled';
}

function buildAlertFacts(context: GenerationAlertContext): string[] {
	const facts = [
		`Severity: ${context.severity}`,
		`Generation: ${context.generationId}`,
		`User: ${context.userEmail ?? context.userId}`
	];

	if (context.stage) {
		facts.push(`Stage: ${context.stage}`);
	}

	if (context.retryCount !== undefined) {
		facts.push(`Stage retries: ${context.retryCount}`);
	}

	if (context.totalRetryCount !== undefined) {
		facts.push(`Total retries: ${context.totalRetryCount}`);
	}

	const duration = formatDurationMs(context.generationDurationMs);
	if (duration) {
		facts.push(`Elapsed: ${duration}`);
	}

	if (context.statusMessage) {
		facts.push(`Status: ${context.statusMessage}`);
	}

	const error = truncateError(context.error);
	if (error) {
		facts.push(`Error: ${error}`);
	}

	return facts;
}

function buildPurchaseAlertFacts(context: PurchaseAlertContext): string[] {
	return [
		`Credits: +${context.creditsAdded}`,
		`Amount: $${context.amountUsd.toFixed(2)} ${context.currency.toUpperCase()}`,
		`User: ${context.userEmail ?? context.userId}`,
		`Payment: ${context.stripePaymentIntentId}`
	];
}

function buildSignupAlertFacts(context: SignupAlertContext): string[] {
	const facts = [`User: ${context.userEmail ?? context.userId}`];
	if (context.name) {
		facts.push(`Name: ${context.name}`);
	}
	facts.push(`Provider: ${context.authProvider}`);
	facts.push(`Starting credits: ${context.initialCredits}`);
	return facts;
}

function buildAuthAlertTitle(context: AuthAlertContext): string {
	switch (context.alertType) {
		case 'auth_kit_api_error':
			return 'Celstate WorkOS AuthKit API error';
		default:
			return 'Celstate auth endpoint returned repeated 5xx responses';
	}
}

function buildAuthAlertFacts(context: AuthAlertContext): string[] {
	const facts = [`Severity: ${context.severity}`];

	if (context.pathname) {
		facts.push(`Path: ${context.pathname}`);
	}

	if (context.method) {
		facts.push(`Method: ${context.method}`);
	}

	if (context.status !== undefined) {
		facts.push(`Status: ${context.status}`);
	}

	if (context.upstreamStatus !== undefined) {
		facts.push(`Upstream status: ${context.upstreamStatus}`);
	}

	if (context.upstreamCfRay) {
		facts.push(`Upstream cf-ray: ${context.upstreamCfRay}`);
	}

	if (context.host) {
		facts.push(`Host: ${context.host}`);
	}

	if (context.origin) {
		facts.push(`Origin: ${context.origin}`);
	}

	if (context.referer) {
		facts.push(`Referer: ${context.referer}`);
	}

	if (context.requestId) {
		facts.push(`Request ID: ${context.requestId}`);
	}

	if (context.attempts !== undefined) {
		facts.push(`Attempts: ${context.attempts}`);
	}

	if (context.count !== undefined) {
		facts.push(`Failure count: ${context.count}`);
	}

	if (context.windowMs !== undefined) {
		const duration = formatDurationMs(context.windowMs);
		if (duration) {
			facts.push(`Window: ${duration}`);
		}
	}

	if (context.provider) {
		facts.push(`Provider: ${context.provider}`);
	}

	if (context.contextMethod) {
		facts.push(`Context method: ${context.contextMethod}`);
	}

	if (context.contextPath) {
		facts.push(`Context path: ${context.contextPath}`);
	}

	const error = truncateError(context.error);
	if (error) {
		facts.push(`Error: ${error}`);
	}

	return facts;
}

function buildWebhookRequest(
	config: OpsAlertRuntimeConfig,
	payload: {
		summaryLine: string;
		headerEmoji: string;
		headerText: string;
		facts: string[];
		genericBody: Record<string, unknown>;
	}
): { body: string; headers: Record<string, string>; url: string } {
	if (!config.webhookUrl) {
		throw new Error('OPS_ALERT_WEBHOOK_URL is not configured');
	}

	const headers = { 'content-type': 'application/json' };

	if (config.webhookKind === 'slack') {
		return {
			url: config.webhookUrl,
			headers,
			body: JSON.stringify({
				text: [payload.summaryLine, ...payload.facts].join('\n'),
				blocks: [
					{
						type: 'header',
						text: {
							type: 'plain_text',
							text: `${payload.headerEmoji} ${payload.headerText}`
						}
					},
					{
						type: 'section',
						text: {
							type: 'mrkdwn',
							text: payload.facts.map((fact) => `• ${fact}`).join('\n')
						}
					}
				]
			})
		};
	}

	if (config.webhookKind === 'discord') {
		return {
			url: config.webhookUrl,
			headers,
			body: JSON.stringify({
				content: [payload.summaryLine, ...payload.facts].join('\n')
			})
		};
	}

	return {
		url: config.webhookUrl,
		headers,
		body: JSON.stringify(payload.genericBody)
	};
}

export function buildGenerationAlertRequest(config: OpsAlertRuntimeConfig, context: GenerationAlertContext): {
	body: string;
	headers: Record<string, string>;
	url: string;
} {
	const title = buildAlertTitle(context);
	const facts = buildAlertFacts(context);

	return buildWebhookRequest(config, {
		summaryLine: `${context.severity.toUpperCase()}: ${title}`,
		headerEmoji: context.severity === 'critical' ? '🚨' : '⚠️',
		headerText: title,
		facts,
		genericBody: {
			title,
			severity: context.severity,
			alertType: context.alertType,
			context
		}
	});
}

export function buildPurchaseAlertRequest(config: OpsAlertRuntimeConfig, context: PurchaseAlertContext): {
	body: string;
	headers: Record<string, string>;
	url: string;
} {
	const facts = buildPurchaseAlertFacts(context);
	const summaryLine = '💰 New Purchase';

	return buildWebhookRequest(config, {
		summaryLine,
		headerEmoji: '💰',
		headerText: 'New Purchase',
		facts,
		genericBody: {
			event: 'purchase_new',
			credits_added: context.creditsAdded,
			currency: context.currency,
			amount_usd: context.amountUsd,
			stripe_payment_intent_id: context.stripePaymentIntentId,
			user_id: context.userId,
			user_email: context.userEmail,
			title: 'Celstate purchase completed'
		}
	});
}

export function buildSignupAlertRequest(config: OpsAlertRuntimeConfig, context: SignupAlertContext): {
	body: string;
	headers: Record<string, string>;
	url: string;
} {
	const facts = buildSignupAlertFacts(context);
	const summaryLine = '👋 New signup';

	return buildWebhookRequest(config, {
		summaryLine,
		headerEmoji: '👋',
		headerText: 'New signup',
		facts,
		genericBody: {
			event: 'signup_new',
			auth_provider: context.authProvider,
			initial_credits: context.initialCredits,
			name: context.name,
			title: 'Celstate new user signup',
			user_email: context.userEmail,
			user_id: context.userId
		}
	});
}

export function buildSecretRotationReminderRequest(
	config: OpsAlertRuntimeConfig,
	context: SecretRotationReminderContext
): {
	body: string;
	headers: Record<string, string>;
	url: string;
} {
	const title = `Celstate ${context.cadenceLabel} secret rotation reminder`;
	const gcpRotateLine =
		context.gcpServiceAccountEmail && context.gcpProjectId
			? `pnpm secrets:rotate-gcp -- --service-account=${context.gcpServiceAccountEmail} --project=${context.gcpProjectId} --old-key-id=<current>`
			: 'pnpm secrets:rotate-gcp -- --service-account=<email> --project=<gcp-project> --old-key-id=<current>';

	const facts = [
		'Run from repo root:',
		'• pnpm secrets:rotate',
		`• ${gcpRotateLine}`,
		'• pnpm secrets:sync:convex',
		'• pnpm secrets:sync:gh',
		'',
		'Manual (vendor dashboards, see MANUAL-SECRET-ROTATION-GUIDE.md):',
		'• Stripe Secret Key — dashboard.stripe.com/apikeys',
		'• Stripe Webhook Secret — dashboard.stripe.com/webhooks',
		'• Google OAuth Secret — console.developers.google.com/auth/clients',
		'',
		'Heads up: rotation invalidates all active sessions.'
	];

	return buildWebhookRequest(config, {
		summaryLine: `🔐 ${title}`,
		headerEmoji: '🔐',
		headerText: title,
		facts,
		genericBody: {
			event: 'secret_rotation_reminder',
			title,
			cadence: context.cadenceLabel,
			gcp_project_id: context.gcpProjectId,
			gcp_service_account_email: context.gcpServiceAccountEmail
		}
	});
}

export function buildAuthAlertRequest(config: OpsAlertRuntimeConfig, context: AuthAlertContext): {
	body: string;
	headers: Record<string, string>;
	url: string;
} {
	const title = buildAuthAlertTitle(context);
	const facts = buildAuthAlertFacts(context);

	return buildWebhookRequest(config, {
		summaryLine: `${context.severity.toUpperCase()}: ${title}`,
		headerEmoji: context.severity === 'critical' ? '🚨' : '⚠️',
		headerText: title,
		facts,
		genericBody: {
			event: 'auth_outage',
			title,
			severity: context.severity,
			alert_type: context.alertType,
			context
		}
	});
}

export function summarizeGenerationOpsEvents(
	events: GenerationOpsEventSummaryInput[]
): GenerationOpsSummary {
	const totals = {
		requested: events.filter((event) => event.eventType === 'generation_requested').length,
		completed: events.filter((event) => event.eventType === 'generation_completed').length,
		failed: events.filter((event) => event.eventType === 'generation_failed').length,
		stalled: events.filter((event) => event.eventType === 'generation_stalled').length,
		retries: events.filter((event) => event.eventType === 'stage_retry_scheduled').length,
		alertFailures: events.filter((event) => event.eventType === 'alert_failed').length,
		successRate: null as number | null,
		failureRate: null as number | null
	};

	if (totals.requested > 0) {
		totals.successRate = roundMetric((totals.completed / totals.requested) * 100);
		totals.failureRate = roundMetric((totals.failed / totals.requested) * 100);
	}

	const generationDurations = events
		.filter((event) => event.eventType === 'generation_completed')
		.map((event) => event.generationDurationMs)
		.filter((value): value is number => value !== undefined);

	const attemptDurations = events
		.map((event) => event.attemptDurationMs)
		.filter((value): value is number => value !== undefined);

	const completedRetries = events
		.filter((event) => event.eventType === 'generation_completed')
		.map((event) => event.totalRetryCount ?? 0);

	return {
		totals,
		performance: {
			avgGenerationTimeMs: roundMetric(average(generationDurations)),
			p50GenerationTimeMs: percentile(generationDurations, 50),
			p95GenerationTimeMs: percentile(generationDurations, 95),
			avgAttemptTimeMs: roundMetric(average(attemptDurations)),
			p95AttemptTimeMs: percentile(attemptDurations, 95),
			avgRetriesPerCompletedGeneration: roundMetric(average(completedRetries))
		}
	};
}

/** Ensures ops webhook returned 2xx; throws with status line otherwise. */
export function assertOkWebhookResponse(response: Response): void {
	if (!response.ok) {
		throw new Error(`Webhook responded with ${response.status} ${response.statusText}`);
	}
}
