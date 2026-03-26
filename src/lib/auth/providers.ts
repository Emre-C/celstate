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
	// TODO: Remove `comingSoon` flag once Apple Sign-In is re-enabled
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

export const getAuthProviderDescriptors = (siteUrl: string): RuntimeAuthProviderDescriptor[] => {
	return AUTH_PROVIDER_DESCRIPTORS.map((provider) => {
		// TODO: Remove this early-return block once Apple Sign-In is re-enabled.
		// Apple auth is fully implemented but temporarily paused on Apple's side.
		// The auth config, server logic, and UI are all intact — just flip this flag.
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
