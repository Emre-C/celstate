export type AuthProviderId = 'google' | 'apple';

/**
 * The auth provider actually attached to a given user, including `'unknown'`
 * for the fallback case where identity metadata does not resolve to a
 * recognised provider (e.g. legacy accounts, rare upstream shapes via WorkOS).
 */
export type ResolvedAuthProvider = AuthProviderId | 'unknown';

export type AuthProviderDescriptor = {
	id: AuthProviderId;
	label: string;
	description: string;
	requiresHttps?: boolean;
};

export type RuntimeAuthProviderDescriptor = AuthProviderDescriptor & {
	available: boolean;
	availabilityHint?: string;
	comingSoon?: boolean;
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

export const getAuthProviderDescriptors = (): RuntimeAuthProviderDescriptor[] => {
	return AUTH_PROVIDER_DESCRIPTORS.map((provider) => {
		if (provider.id === 'apple') {
			return {
				...provider,
				available: false,
				comingSoon: true,
				availabilityHint: 'Apple Sign-In is coming soon. Use Google to sign in for now.'
			};
		}

		return {
			...provider,
			available: true
		};
	});
};
