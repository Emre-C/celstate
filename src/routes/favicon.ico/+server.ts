import type { RequestHandler } from '@sveltejs/kit';

export const GET: RequestHandler = ({ url }) =>
	new Response(null, {
		status: 308,
		headers: {
			location: new URL('/favicon.svg', url).toString()
		}
	});
