import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ url }) => {
	const email = url.searchParams.get('email');
	const token = url.searchParams.get('token');
	return { email: email ?? null, token: token ?? null };
};
