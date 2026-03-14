export const AUTH_SESSION_RECOVERY_GRACE_PERIOD_MS = 1000;

export type ProtectedAppViewState = {
	authIsAuthenticated: boolean;
	authIsLoading: boolean;
	hasAuthenticatedSession: boolean;
	hasSyncError: boolean;
	redirectScheduled: boolean;
	userReady: boolean;
};

export const getProtectedAppRedirectStrategy = ({
	authIsAuthenticated,
	authIsLoading,
	hasAuthenticatedSession
}: Pick<ProtectedAppViewState, 'authIsAuthenticated' | 'authIsLoading' | 'hasAuthenticatedSession'>) => {
	if (authIsAuthenticated || authIsLoading) {
		return 'none' as const;
	}

	return hasAuthenticatedSession ? 'delayed' : 'immediate';
};

export const getProtectedAppViewState = ({
	authIsAuthenticated,
	authIsLoading,
	hasAuthenticatedSession,
	hasSyncError,
	redirectScheduled,
	userReady
}: ProtectedAppViewState) => {
	const isEffectivelyAuthenticated = hasAuthenticatedSession || authIsAuthenticated;

	return {
		isEffectivelyAuthenticated,
		shouldRedirectImmediately:
			getProtectedAppRedirectStrategy({
				authIsAuthenticated,
				authIsLoading,
				hasAuthenticatedSession
			}) === 'immediate',
		shouldRenderChildren:
			isEffectivelyAuthenticated && userReady && !hasSyncError && !redirectScheduled,
		shouldShowLoading:
			redirectScheduled ||
			(!isEffectivelyAuthenticated && authIsLoading) ||
			(isEffectivelyAuthenticated && !userReady && !hasSyncError),
		shouldShowSyncError: hasSyncError && !redirectScheduled
	};
};
