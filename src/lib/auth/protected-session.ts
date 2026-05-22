import { buildAuthInitiateTarget } from '$lib/auth/redirect.js';

export const AUTH_SESSION_RECOVERY_GRACE_PERIOD_MS = 1000;

export type ProtectedSessionBootstrap = {
	isAuthenticated: boolean;
};

type ProtectedSessionStatus = {
	authIsAuthenticated: boolean;
	authIsLoading: boolean;
	hasAuthenticatedSession: boolean;
};

export type ProtectedSessionViewState = ProtectedSessionStatus & {
	hasSyncError: boolean;
	redirectScheduled: boolean;
};

export type ProtectedSessionRequestResult =
	| { kind: 'ready'; bootstrap: ProtectedSessionBootstrap }
	| { kind: 'redirect'; location: string };

export type ProtectedSessionRedirectPlan =
	| { kind: 'none' }
	| { kind: 'immediate'; location: string }
	| { kind: 'delayed'; location: string; delayMs: number };

export const getProtectedSessionBootstrap = (
	token: string | undefined
): ProtectedSessionBootstrap => ({
	isAuthenticated: token !== undefined
});

export const resolveProtectedSessionRequest = ({
	pathname,
	search,
	token
}: {
	pathname: string;
	search: string;
	token: string | undefined;
}): ProtectedSessionRequestResult => {
	const bootstrap = getProtectedSessionBootstrap(token);

	if (!bootstrap.isAuthenticated) {
		return {
			kind: 'redirect',
			location: buildAuthInitiateTarget(pathname, search)
		};
	}

	return {
		kind: 'ready',
		bootstrap
	};
};

export const getProtectedSessionRedirectPlan = ({
	pathname,
	search,
	authIsAuthenticated,
	authIsLoading,
	hasAuthenticatedSession
}: ProtectedSessionStatus & {
	pathname: string;
	search: string;
}): ProtectedSessionRedirectPlan => {
	if (authIsAuthenticated || authIsLoading) {
		return {
			kind: 'none'
		};
	}

	const location = buildAuthInitiateTarget(pathname, search);

	if (hasAuthenticatedSession) {
		return {
			kind: 'delayed',
			location,
			delayMs: AUTH_SESSION_RECOVERY_GRACE_PERIOD_MS
		};
	}

	return {
		kind: 'immediate',
		location
	};
};

export const getProtectedSessionViewState = ({
	authIsAuthenticated,
	authIsLoading,
	hasAuthenticatedSession,
	hasSyncError,
	redirectScheduled
}: ProtectedSessionViewState) => {
	const isEffectivelyAuthenticated = hasAuthenticatedSession || authIsAuthenticated;

	return {
		isEffectivelyAuthenticated,
		shouldRenderChildren: isEffectivelyAuthenticated && !hasSyncError && !redirectScheduled,
		shouldShowLoading: redirectScheduled || (!isEffectivelyAuthenticated && authIsLoading),
		shouldShowSyncError: hasSyncError && !redirectScheduled
	};
};

// User-sync retry policy lives here so the route adapter cannot accidentally drop a
// failed bootstrap on the floor (the historical bug: a transient mutation rejection
// would leave `startedUserSync = true` with no recovery path until a full reload).
//
// Bounded auto-retry with exponential backoff prevents a stuck account screen for
// transient Convex-side failures (cold function start, brief network hiccup, etc.)
// while still surfacing a manual recovery affordance once the budget is exhausted
// — at which point the failure is more likely structural and warrants user action.
export const USER_SYNC_MAX_AUTO_ATTEMPTS = 3;
export const USER_SYNC_BACKOFF_BASE_MS = 500;
export const USER_SYNC_BACKOFF_MAX_MS = 4_000;
const USER_SYNC_GENERIC_ERROR_MESSAGE = 'Unable to initialize your account.';

export type UserSyncStatus =
	| { kind: 'idle' }
	| { kind: 'running'; attempt: number }
	| { kind: 'success'; attempt: number }
	| {
			kind: 'error';
			attempt: number;
			message: string;
			// When non-null, the route adapter should schedule another attempt after
			// this many milliseconds. When null, the auto-retry budget is spent and
			// only an explicit user gesture should re-enter the running state.
			autoRetryDelayMs: number | null;
	  };

export const createInitialUserSyncStatus = (): UserSyncStatus => ({ kind: 'idle' });

const previousAttemptCount = (prev: UserSyncStatus): number => {
	if (prev.kind === 'idle') {
		return 0;
	}
	return prev.attempt;
};

export const beginUserSyncAttempt = (prev: UserSyncStatus): UserSyncStatus => ({
	kind: 'running',
	attempt: previousAttemptCount(prev) + 1
});

export const markUserSyncSuccess = (prev: UserSyncStatus): UserSyncStatus => ({
	kind: 'success',
	// Anchor on the in-flight attempt so the resulting status reflects how many
	// tries it actually took to reach a healthy account state.
	attempt: prev.kind === 'running' ? prev.attempt : Math.max(1, previousAttemptCount(prev))
});

export const getUserSyncAutoRetryDelayMs = (nextAttempt: number): number | null => {
	if (nextAttempt < 2) {
		return null;
	}
	if (nextAttempt > USER_SYNC_MAX_AUTO_ATTEMPTS) {
		return null;
	}
	const exponent = nextAttempt - 2;
	const delay = USER_SYNC_BACKOFF_BASE_MS * 2 ** exponent;
	return Math.min(delay, USER_SYNC_BACKOFF_MAX_MS);
};

const normalizeUserSyncErrorMessage = (error: unknown): string => {
	if (error instanceof Error && error.message.trim().length > 0) {
		return error.message;
	}
	if (typeof error === 'string' && error.trim().length > 0) {
		return error;
	}
	return USER_SYNC_GENERIC_ERROR_MESSAGE;
};

export const markUserSyncFailure = ({
	prev,
	error
}: {
	prev: UserSyncStatus;
	error: unknown;
}): UserSyncStatus => {
	const attempt = prev.kind === 'running' ? prev.attempt : Math.max(1, previousAttemptCount(prev));
	return {
		kind: 'error',
		attempt,
		message: normalizeUserSyncErrorMessage(error),
		autoRetryDelayMs: getUserSyncAutoRetryDelayMs(attempt + 1)
	};
};

export const hasUserSyncError = (status: UserSyncStatus): boolean => status.kind === 'error';

export const isUserSyncInFlight = (status: UserSyncStatus): boolean => status.kind === 'running';

export const shouldAutoRetryUserSync = (status: UserSyncStatus): boolean =>
	status.kind === 'error' && status.autoRetryDelayMs !== null;

export const getUserSyncErrorMessage = (status: UserSyncStatus): string =>
	status.kind === 'error' ? status.message : '';
