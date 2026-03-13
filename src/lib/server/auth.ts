import type { Cookies } from '@sveltejs/kit';

export const BETTER_AUTH_COOKIE_PREFIX = 'better-auth';
export const BETTER_AUTH_CONVEX_JWT_COOKIE_NAME = 'convex_jwt';

export type InitialAuthState = {
	isAuthenticated: boolean;
};

export const getAuthCookieName = (prefix = BETTER_AUTH_COOKIE_PREFIX) =>
	`${prefix}.${BETTER_AUTH_CONVEX_JWT_COOKIE_NAME}`;

export const getAuthCookieCandidates = (prefix = BETTER_AUTH_COOKIE_PREFIX) => {
	const cookieName = getAuthCookieName(prefix);
	return [cookieName, `__Secure-${cookieName}`] as const;
};

export const getAuthTokenFromCookieGetter = (
	getCookie: (name: string) => string | undefined,
	prefix = BETTER_AUTH_COOKIE_PREFIX
) => {
	for (const cookieName of getAuthCookieCandidates(prefix)) {
		const token = getCookie(cookieName);
		if (token) {
			return token;
		}
	}

	return undefined;
};

export const getConvexJwtToken = (cookies: Cookies) => {
	return getAuthTokenFromCookieGetter((name) => cookies.get(name), BETTER_AUTH_COOKIE_PREFIX);
};

export const hasConvexJwtToken = (cookies: Cookies) => {
	return getConvexJwtToken(cookies) !== undefined;
};

export const getInitialAuthState = (cookies: Cookies): InitialAuthState => {
	return {
		isAuthenticated: hasConvexJwtToken(cookies)
	};
};
