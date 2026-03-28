import { isFinalGetSessionProbeOk } from './auth-canary-probe.mjs';

const baseUrl = process.env.AUTH_CANARY_BASE_URL?.trim();
const webhookUrl = process.env.OPS_ALERT_WEBHOOK_URL?.trim();
const webhookKind = process.env.OPS_ALERT_WEBHOOK_KIND?.trim().toLowerCase() || 'discord';

if (!baseUrl) {
	throw new Error('AUTH_CANARY_BASE_URL is required');
}

const normalizedBaseUrl = baseUrl.endsWith('/') ? baseUrl.slice(0, -1) : baseUrl;

/** @param {string} pathname */
const joinUrl = (pathname) => `${normalizedBaseUrl}${pathname}`;

const checkAuthPage = async () => {
	const controller = new AbortController();
	const timeout = setTimeout(() => controller.abort(), 15_000);

	try {
		const response = await fetch(joinUrl('/auth'), {
			headers: { accept: 'text/html' },
			signal: controller.signal
		});

		if (!response.ok) {
			throw new Error(`/auth returned ${response.status}`);
		}

		const html = await response.text();
		if (!html.includes('data-testid="auth-page"')) {
			throw new Error('/auth did not render the expected auth page marker');
		}
		if (!html.includes('data-provider="google"')) {
			throw new Error('/auth did not render the Google sign-in provider');
		}

		return { name: 'auth_page', status: response.status };
	} finally {
		clearTimeout(timeout);
	}
};

const checkSessionEndpoint = async () => {
	const controller = new AbortController();
	const timeout = setTimeout(() => controller.abort(), 15_000);

	try {
		// Follow redirects (default). Apex → www (308) must not be treated as failure.
		const response = await fetch(joinUrl('/api/auth/get-session'), {
			headers: { accept: 'application/json' },
			signal: controller.signal
		});

		if (!isFinalGetSessionProbeOk(response.status)) {
			throw new Error(`/api/auth/get-session returned ${response.status}`);
		}

		const contentType = response.headers.get('content-type')?.toLowerCase() ?? '';
		if (!contentType.includes('application/json')) {
			throw new Error(`/api/auth/get-session returned unexpected content-type: ${contentType || 'missing'}`);
		}

		const text = await response.text();
		if (text.length > 0) {
			JSON.parse(text);
		}

		return { name: 'get_session', status: response.status };
	} finally {
		clearTimeout(timeout);
	}
};

/** @param {string} message */
const sendAlert = async (message) => {
	if (!webhookUrl) {
		return;
	}

	const body =
		webhookKind === 'slack'
			? JSON.stringify({ text: message })
			: webhookKind === 'discord'
				? JSON.stringify({ content: message })
				: JSON.stringify({ message });

	const response = await fetch(webhookUrl, {
		method: 'POST',
		headers: { 'content-type': 'application/json' },
		body
	});

	if (!response.ok) {
		throw new Error(`Ops webhook returned ${response.status} ${response.statusText}`);
	}
};

const main = async () => {
	const failures = [];
	const results = [];

	for (const check of [checkAuthPage, checkSessionEndpoint]) {
		try {
			results.push(await check());
		} catch (error) {
			failures.push(error instanceof Error ? error.message : String(error));
		}
	}

	if (failures.length === 0) {
		console.log(JSON.stringify({ baseUrl: normalizedBaseUrl, results }, null, 2));
		return;
	}

	const message = [
		'🚨 CRITICAL: Celstate auth canary failed',
		`Base URL: ${normalizedBaseUrl}`,
		...failures.map((failure) => `- ${failure}`)
	].join('\n');

	try {
		await sendAlert(message);
	} catch (alertError) {
		console.error('Failed to send auth canary alert', alertError);
	}

	throw new Error(message);
};

await main();
