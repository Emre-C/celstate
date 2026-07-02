import { json, text } from '@sveltejs/kit';
import { ConvexHttpClient } from 'convex/browser';
import { PUBLIC_CONVEX_URL } from '$env/static/public';
import { api } from '../../../convex/_generated/api.js';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ url }) => {
	const email = url.searchParams.get('email');
	const token = url.searchParams.get('token');
	if (!email || !token) {
		return text('Missing email or token parameter.', { status: 400 });
	}

	const client = new ConvexHttpClient(PUBLIC_CONVEX_URL);

	try {
		const ok = await client.mutation(api.emails.unsubscribe, { email, token });
		if (ok) {
			return text('You have been unsubscribed from Celstate emails. You will not receive any further messages from us.');
		}
		return text('Email address not found or token invalid. If you believe this is an error, reply to the email and ask to be unsubscribed.', { status: 404 });
	} catch {
		return text('Something went wrong. Please reply to the email and ask to be unsubscribed.', { status: 500 });
	}
};

export const POST: RequestHandler = async ({ url, request }) => {
	// RFC 8058 one-click unsubscribe sends params in the query string.
	// Some clients also send form-encoded body, so check both.
	let email = url.searchParams.get('email');
	let token = url.searchParams.get('token');

	if (!email || !token) {
		const formData = await request.formData().catch(() => null);
		email = formData?.get('email') as string | null ?? email;
		token = formData?.get('token') as string | null ?? token;
	}

	if (!email || !token) {
		return json({ ok: false }, { status: 400 });
	}

	const client = new ConvexHttpClient(PUBLIC_CONVEX_URL);

	try {
		const ok = await client.mutation(api.emails.unsubscribe, { email, token });
		return json({ ok });
	} catch {
		return json({ ok: false }, { status: 500 });
	}
};
