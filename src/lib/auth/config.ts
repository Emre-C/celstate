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

const readEnvValue = (value?: string) => {
	const trimmed = value?.trim();
	return trimmed ? trimmed : undefined;
};

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

	if (requiresAppleCredentials(env) && !env.appleClientId) {
		missing.push(CANONICAL_AUTH_SERVER_ENV.appleClientId);
	}

	if (requiresAppleCredentials(env) && !env.appleClientSecret) {
		missing.push(CANONICAL_AUTH_SERVER_ENV.appleClientSecret);
	}

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

export const getTrustedOrigins = (env: CanonicalAuthEnv) => {
	const providers = getAuthProviderAvailability(env);
	return providers.apple ? [APPLE_TRUSTED_ORIGIN] : [];
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
