export interface PostHogConfig {
	readonly appHost: string;
	readonly personalApiKey: string;
	readonly projectId: string;
}

export interface HogQLQueryResponse {
	readonly columns?: string[];
	readonly clickhouse?: string;
	readonly hogql?: string;
	readonly is_cached?: boolean;
	readonly query?: string;
	readonly results?: unknown[][];
	readonly timings?: Record<string, unknown>;
	readonly types?: string[];
}

export interface PostHogEventDefinition {
	readonly id: string;
	readonly last_seen_at?: string;
	readonly name: string;
	readonly updated_at?: string;
	readonly verified?: boolean;
}

export interface PostHogAnnotation {
	readonly content: string;
	readonly created_at?: string;
	readonly date_marker?: string;
	readonly id: number;
	readonly scope?: string;
	readonly updated_at?: string;
}

interface PaginatedResponse<T> {
	readonly count: number;
	readonly next: string | null;
	readonly previous: string | null;
	readonly results: T[];
}

function normalizeOrigin(name: string, value: string | undefined, fallback?: string): string {
	const trimmed = value?.trim() || fallback;
	if (!trimmed) {
		throw new Error(`${name} is required.`);
	}

	let parsed: URL;
	try {
		parsed = new URL(trimmed);
	} catch {
		throw new Error(`${name} must be a valid http(s) origin. Got: ${trimmed}`);
	}

	if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
		throw new Error(`${name} must use http:// or https://. Got: ${trimmed}`);
	}
	if (parsed.username || parsed.password || parsed.search || parsed.hash) {
		throw new Error(`${name} must be origin-only with no auth, query, or hash. Got: ${trimmed}`);
	}
	if (parsed.pathname !== '/' && parsed.pathname !== '') {
		throw new Error(`${name} must not include a path. Got: ${trimmed}`);
	}

	return parsed.origin;
}

export function readPostHogConfig(env: Record<string, string | undefined>): PostHogConfig {
	const personalApiKey = env.POSTHOG_PERSONAL_API_KEY?.trim();
	if (!personalApiKey) {
		throw new Error('POSTHOG_PERSONAL_API_KEY is required for growth tooling.');
	}
	if (!personalApiKey.startsWith('phx_')) {
		throw new Error('POSTHOG_PERSONAL_API_KEY must use the phx_ prefix.');
	}

	const projectId = env.POSTHOG_PROJECT_ID?.trim();
	if (!projectId) {
		throw new Error('POSTHOG_PROJECT_ID is required for growth tooling.');
	}
	if (projectId.includes('/')) {
		throw new Error('POSTHOG_PROJECT_ID must not contain a slash.');
	}

	return {
		appHost: normalizeOrigin('POSTHOG_APP_HOST', env.POSTHOG_APP_HOST, 'https://us.posthog.com'),
		personalApiKey,
		projectId
	};
}

function buildRequestUrl(config: PostHogConfig, pathOrUrl: string): string {
	if (pathOrUrl.startsWith('http://') || pathOrUrl.startsWith('https://')) {
		return pathOrUrl;
	}
	return new URL(pathOrUrl, config.appHost).toString();
}

async function readJsonResponse<T>(response: Response): Promise<T | null> {
	const text = await response.text();
	if (!text.trim()) {
		return null;
	}
	return JSON.parse(text) as T;
}

function formatErrorPayload(payload: unknown): string {
	if (!payload || typeof payload !== 'object') {
		return 'unknown error payload';
	}
	const record = payload as Record<string, unknown>;
	const detail = typeof record.detail === 'string' ? record.detail : undefined;
	const message = typeof record.message === 'string' ? record.message : undefined;
	const code = typeof record.code === 'string' ? record.code : undefined;
	const nonFieldErrors = Array.isArray(record.non_field_errors)
		? record.non_field_errors.filter((entry): entry is string => typeof entry === 'string')
		: [];
	const fallback = JSON.stringify(payload);
	return [detail, message, code, ...nonFieldErrors].filter(Boolean).join(' | ') || fallback;
}

async function postHogRequestJson<T>(args: {
	readonly body?: BodyInit;
	readonly config: PostHogConfig;
	readonly headers?: Record<string, string>;
	readonly method?: 'GET' | 'POST';
	readonly pathOrUrl: string;
}): Promise<T> {
	const response = await fetch(buildRequestUrl(args.config, args.pathOrUrl), {
		body: args.body,
		headers: {
			Authorization: `Bearer ${args.config.personalApiKey}`,
			...(args.headers ?? {})
		},
		method: args.method ?? 'GET'
	});

	const payload = await readJsonResponse<T | Record<string, unknown>>(response);
	if (!response.ok) {
		throw new Error(
			`PostHog request failed (${response.status} ${response.statusText}): ${formatErrorPayload(payload)}`
		);
	}
	if (payload === null) {
		throw new Error('PostHog returned an empty response body.');
	}
	return payload as T;
}

export async function runHogQLQuery(args: {
	readonly config: PostHogConfig;
	readonly name: string;
	readonly query: string;
	readonly refresh?:
		| 'async'
		| 'async_except_on_cache_miss'
		| 'blocking'
		| 'force_async'
		| 'force_blocking'
		| 'force_cache'
		| 'lazy_async';
}): Promise<HogQLQueryResponse> {
	return postHogRequestJson<HogQLQueryResponse>({
		body: JSON.stringify({
			name: args.name,
			query: {
				kind: 'HogQLQuery',
				query: args.query
			},
			...(args.refresh ? { refresh: args.refresh } : {})
		}),
		config: args.config,
		headers: {
			'Content-Type': 'application/json'
		},
		method: 'POST',
		pathOrUrl: `/api/projects/${encodeURIComponent(args.config.projectId)}/query/`
	});
}

export async function listEventDefinitions(config: PostHogConfig): Promise<PostHogEventDefinition[]> {
	const definitions: PostHogEventDefinition[] = [];
	let nextUrl: string | null = `/api/projects/${encodeURIComponent(config.projectId)}/event_definitions/?limit=200`;

	while (nextUrl) {
		const page: PaginatedResponse<PostHogEventDefinition> = await postHogRequestJson<
			PaginatedResponse<PostHogEventDefinition>
		>({
			config,
			method: 'GET',
			pathOrUrl: nextUrl
		});
		definitions.push(...page.results);
		nextUrl = page.next;
	}

	return definitions;
}

export async function createAnnotation(args: {
	readonly config: PostHogConfig;
	readonly content: string;
	readonly dateMarker?: string;
}): Promise<PostHogAnnotation> {
	const body = new URLSearchParams();
	body.set('content', args.content);
	if (args.dateMarker) {
		body.set('date_marker', args.dateMarker);
	}

	return postHogRequestJson<PostHogAnnotation>({
		body,
		config: args.config,
		headers: {
			'Content-Type': 'application/x-www-form-urlencoded'
		},
		method: 'POST',
		pathOrUrl: `/api/projects/${encodeURIComponent(args.config.projectId)}/annotations/`
	});
}
