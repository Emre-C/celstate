export type AuthProviderId = 'google' | 'apple';

export type AuthProviderDescriptor = {
	id: AuthProviderId;
	label: string;
	description: string;
	requiresHttps?: boolean;
};

export type RuntimeAuthProviderDescriptor = AuthProviderDescriptor & {
	available: boolean;
	availabilityHint?: string;
};

export const AUTH_PROVIDER_DESCRIPTORS: AuthProviderDescriptor[] = [
	{
		id: 'google',
		label: 'Continue with Google',
		description: 'Use your Google account for a trusted, passwordless sign-in.'
	},
	{
		id: 'apple',
		label: 'Continue with Apple',
		description: 'Use Sign in with Apple when you are on an HTTPS origin.',
		requiresHttps: true
	}
];

export const isHttpsUrl = (url: string) => {
	try {
		return new URL(url).protocol === 'https:';
	} catch {
		return false;
	}
};

export const getAuthProviderDescriptors = (siteUrl: string): RuntimeAuthProviderDescriptor[] => {
	const https = isHttpsUrl(siteUrl);

	return AUTH_PROVIDER_DESCRIPTORS.map((provider) => {
		if (provider.id === 'apple' && !https) {
			return {
				...provider,
				available: false,
				availabilityHint: 'Apple Sign in requires HTTPS and cannot complete on local http:// development URLs.'
			};
		}

		return {
			...provider,
			available: true
		};
	});
};
