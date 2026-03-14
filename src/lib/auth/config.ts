export const APPLE_TRUSTED_ORIGIN = 'https://appleid.apple.com';

export const CANONICAL_AUTH_SERVER_ENV = {
	siteUrl: 'SITE_URL',
	betterAuthSecret: 'BETTER_AUTH_SECRET',
	googleClientId: 'AUTH_GOOGLE_ID',
	googleClientSecret: 'AUTH_GOOGLE_SECRET',
	appleClientId: 'AUTH_APPLE_ID',
	appleClientSecret: 'AUTH_APPLE_SECRET',
	appleAppBundleIdentifier: 'AUTH_APPLE_APP_BUNDLE_IDENTIFIER'
} as const;

export const CANONICAL_AUTH_PUBLIC_ENV = {
	publicSiteUrl: 'PUBLIC_SITE_URL',
	publicConvexSiteUrl: 'PUBLIC_CONVEX_SITE_URL'
} as const;

export type EnvSource = Record<string, string | undefined>;

export type CanonicalAuthEnv = {
	siteUrl?: string;
	betterAuthSecret?: string;
	googleClientId?: string;
	googleClientSecret?: string;
	appleClientId?: string;
	appleClientSecret?: string;
	appleAppBundleIdentifier?: string;
};

export type ValidatedCanonicalAuthEnv = {
	siteUrl: string;
	betterAuthSecret: string;
	googleClientId: string;
	googleClientSecret: string;
	appleClientId?: string;
	appleClientSecret?: string;
	appleAppBundleIdentifier?: string;
};

const LOCAL_HOSTNAMES = new Set(['localhost', '127.0.0.1', '[::1]', '::1']);

const readEnvValue = (value?: string) => {
	const trimmed = value?.trim();
	return trimmed ? trimmed : undefined;
};

const toHttpUrl = (value?: string) => {
	if (!value) {
		return undefined;
	}

	try {
		const url = new URL(value);
		return url.protocol === 'http:' || url.protocol === 'https:' ? url : undefined;
	} catch {
		return undefined;
	}
};

const isIpHostname = (hostname: string) =>
	/^\d{1,3}(?:\.\d{1,3}){3}$/.test(hostname) || hostname.includes(':');

const supportsWwwAlias = (hostname: string) =>
	hostname.includes('.') && !LOCAL_HOSTNAMES.has(hostname) && !isIpHostname(hostname);

const isHttpsUrl = (value?: string) => {
	if (!value) {
		return false;
	}

	try {
		return new URL(value).protocol === 'https:';
	} catch {
		return false;
	}
};

export const getCanonicalSiteOrigins = (siteUrl?: string) => {
	const url = toHttpUrl(siteUrl);

	if (!url) {
		return [];
	}

	const origins = new Set([url.origin]);

	if (supportsWwwAlias(url.hostname)) {
		const alternateHostname = url.hostname.startsWith('www.')
			? url.hostname.slice(4)
			: `www.${url.hostname}`;
		origins.add(`${url.protocol}//${alternateHostname}${url.port ? `:${url.port}` : ''}`);
	}

	return [...origins];
};

export const readCanonicalAuthEnv = (env: EnvSource): CanonicalAuthEnv => ({
	siteUrl: readEnvValue(env[CANONICAL_AUTH_SERVER_ENV.siteUrl]),
	betterAuthSecret: readEnvValue(env[CANONICAL_AUTH_SERVER_ENV.betterAuthSecret]),
	googleClientId: readEnvValue(env[CANONICAL_AUTH_SERVER_ENV.googleClientId]),
	googleClientSecret: readEnvValue(env[CANONICAL_AUTH_SERVER_ENV.googleClientSecret]),
	appleClientId: readEnvValue(env[CANONICAL_AUTH_SERVER_ENV.appleClientId]),
	appleClientSecret: readEnvValue(env[CANONICAL_AUTH_SERVER_ENV.appleClientSecret]),
	appleAppBundleIdentifier: readEnvValue(env[CANONICAL_AUTH_SERVER_ENV.appleAppBundleIdentifier])
});

export const getAuthProviderAvailability = (env: CanonicalAuthEnv) => ({
	google: Boolean(env.googleClientId && env.googleClientSecret),
	apple: Boolean(env.appleClientId && env.appleClientSecret)
});

export const requiresAppleCredentials = (env: CanonicalAuthEnv) => isHttpsUrl(env.siteUrl);

export const getMissingCanonicalAuthEnvKeys = (envSource: EnvSource) => {
	const env = readCanonicalAuthEnv(envSource);
	const missing: string[] = [];

	if (!env.siteUrl) {
		missing.push(CANONICAL_AUTH_SERVER_ENV.siteUrl);
	}

	if (!env.betterAuthSecret) {
		missing.push(CANONICAL_AUTH_SERVER_ENV.betterAuthSecret);
	}

	if (!env.googleClientId) {
		missing.push(CANONICAL_AUTH_SERVER_ENV.googleClientId);
	}

	if (!env.googleClientSecret) {
		missing.push(CANONICAL_AUTH_SERVER_ENV.googleClientSecret);
	}

	// TODO: Re-enable Apple credential requirements once Apple Sign-In is back.
	// if (requiresAppleCredentials(env) && !env.appleClientId) {
	// 	missing.push(CANONICAL_AUTH_SERVER_ENV.appleClientId);
	// }
	//
	// if (requiresAppleCredentials(env) && !env.appleClientSecret) {
	// 	missing.push(CANONICAL_AUTH_SERVER_ENV.appleClientSecret);
	// }

	return missing;
};

export const assertCanonicalAuthEnv = (envSource: EnvSource): ValidatedCanonicalAuthEnv => {
	const missing = getMissingCanonicalAuthEnvKeys(envSource);

	if (missing.length > 0) {
		throw new Error(`Missing required auth environment variables: ${missing.join(', ')}`);
	}

	const env = readCanonicalAuthEnv(envSource);

	return {
		siteUrl: env.siteUrl!,
		betterAuthSecret: env.betterAuthSecret!,
		googleClientId: env.googleClientId!,
		googleClientSecret: env.googleClientSecret!,
		appleClientId: env.appleClientId!,
		appleClientSecret: env.appleClientSecret!,
		appleAppBundleIdentifier: env.appleAppBundleIdentifier
	};
};

export const getAllowedAuthHosts = (env: CanonicalAuthEnv) =>
	getCanonicalSiteOrigins(env.siteUrl).map((origin) => new URL(origin).host);

export const getTrustedOrigins = (env: CanonicalAuthEnv) => {
	const providers = getAuthProviderAvailability(env);
	const trustedOrigins = new Set(getCanonicalSiteOrigins(env.siteUrl));

	if (providers.apple) {
		trustedOrigins.add(APPLE_TRUSTED_ORIGIN);
	}

	return [...trustedOrigins];
};

export const buildSocialProviders = (env: ValidatedCanonicalAuthEnv) => ({
	google: {
		clientId: env.googleClientId,
		clientSecret: env.googleClientSecret,
		prompt: 'select_account' as const
	},
	...(env.appleClientId && env.appleClientSecret
		? {
				apple: {
					clientId: env.appleClientId,
					clientSecret: env.appleClientSecret,
					...(env.appleAppBundleIdentifier
						? { appBundleIdentifier: env.appleAppBundleIdentifier }
						: {})
				}
			}
		: {})
});
