import posthog from 'posthog-js';
import { browser } from '$app/environment';
import { PUBLIC_POSTHOG_HOST, PUBLIC_POSTHOG_KEY } from '$env/static/public';

let initialized = false;

/** US PostHog Cloud app origin — toolbar and other UI links. Ingest uses `api_host` (`PUBLIC_POSTHOG_HOST`). */
const POSTHOG_UI_HOST = 'https://us.posthog.com';

/** Idempotent; safe to call before capture/identify if root onMount has not run yet. */
export function initPostHog(): boolean {
	if (!browser || initialized) {
		return initialized;
	}
	if (!PUBLIC_POSTHOG_KEY) {
		return false;
	}

	const apiHost = PUBLIC_POSTHOG_HOST || 'https://us.i.posthog.com';

	posthog.init(PUBLIC_POSTHOG_KEY, {
		api_host: apiHost,
		// Required when `api_host` is a managed proxy subdomain (see PostHog reverse proxy docs).
		ui_host: POSTHOG_UI_HOST,
		autocapture: true,
		capture_pageleave: true,
		defaults: '2026-01-30',
		person_profiles: 'identified_only',
	});

	initialized = true;
	return true;
}

export { posthog };
