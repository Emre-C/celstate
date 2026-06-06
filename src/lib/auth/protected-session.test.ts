import { describe, expect, it } from 'vitest';
import {
	AUTH_SESSION_RECOVERY_GRACE_PERIOD_MS,
	beginUserSyncAttempt,
	createInitialUserSyncStatus,
	getProtectedSessionRedirectPlan,
	getProtectedSessionViewState,
	getUserSyncAutoRetryDelayMs,
	getUserSyncErrorMessage,
	hasUserSyncError,
	isUserSyncInFlight,
	markUserSyncFailure,
	markUserSyncSuccess,
	shouldAutoRetryUserSync,
	shouldSurfaceUserSyncError,
	USER_SYNC_BACKOFF_BASE_MS,
	USER_SYNC_MAX_AUTO_ATTEMPTS,
	type UserSyncStatus
} from './protected-session.js';

describe('protected session', () => {
	it('keeps the app visible while auth is revalidating after an authenticated session', () => {
		expect(
			getProtectedSessionViewState({
				authIsAuthenticated: false,
				authIsLoading: true,
				hasAuthenticatedSession: true,
				hasSyncError: false,
				redirectScheduled: false
			})
		).toMatchObject({
			isEffectivelyAuthenticated: true,
			shouldRenderChildren: true,
			shouldShowLoading: false
		});
	});

	it('keeps the app visible during the recovery grace period after a transient unauthenticated read', () => {
		expect(
			getProtectedSessionViewState({
				authIsAuthenticated: false,
				authIsLoading: false,
				hasAuthenticatedSession: true,
				hasSyncError: false,
				redirectScheduled: false
			})
		).toMatchObject({
			isEffectivelyAuthenticated: true,
			shouldRenderChildren: true,
			shouldShowLoading: false
		});
		expect(
			getProtectedSessionRedirectPlan({
				pathname: '/app',
				search: '?source=tab-return',
				authIsAuthenticated: false,
				authIsLoading: false,
				hasAuthenticatedSession: true
			})
		).toEqual({
			kind: 'delayed',
			location: '/api/auth/initiate?returnTo=%2Fapp%3Fsource%3Dtab-return',
			delayMs: AUTH_SESSION_RECOVERY_GRACE_PERIOD_MS
		});
	});

	it('redirects immediately only when the client is settled and no authenticated session is known', () => {
		expect(
			getProtectedSessionViewState({
				authIsAuthenticated: false,
				authIsLoading: false,
				hasAuthenticatedSession: false,
				hasSyncError: false,
				redirectScheduled: false
			})
		).toMatchObject({
			isEffectivelyAuthenticated: false,
			shouldRenderChildren: false,
			shouldShowLoading: false
		});
		expect(
			getProtectedSessionRedirectPlan({
				pathname: '/app',
				search: '',
				authIsAuthenticated: false,
				authIsLoading: false,
				hasAuthenticatedSession: false
			})
		).toEqual({
			kind: 'immediate',
			location: '/api/auth/initiate?returnTo=%2Fapp'
		});
	});

	it('renders the workspace while authenticated user bootstrap runs in the background', () => {
		expect(
			getProtectedSessionViewState({
				authIsAuthenticated: true,
				authIsLoading: false,
				hasAuthenticatedSession: true,
				hasSyncError: false,
				redirectScheduled: false
			})
		).toMatchObject({
			isEffectivelyAuthenticated: true,
			shouldRenderChildren: true,
			shouldShowLoading: false
		});
	});
});

describe('user sync state machine', () => {
	it('starts in an idle state and reports no error', () => {
		const initial = createInitialUserSyncStatus();

		expect(initial).toEqual({ kind: 'idle' });
		expect(hasUserSyncError(initial)).toBe(false);
		expect(isUserSyncInFlight(initial)).toBe(false);
		expect(shouldAutoRetryUserSync(initial)).toBe(false);
		expect(getUserSyncErrorMessage(initial)).toBe('');
	});

	it('increments the attempt counter on each transition into running', () => {
		const first = beginUserSyncAttempt(createInitialUserSyncStatus());
		expect(first).toEqual({ kind: 'running', attempt: 1 });

		const failure = markUserSyncFailure({ prev: first, error: new Error('boom') });
		const second = beginUserSyncAttempt(failure);
		expect(second).toEqual({ kind: 'running', attempt: 2 });
	});

	it('preserves the in-flight attempt count when marking success', () => {
		const running: UserSyncStatus = { kind: 'running', attempt: 2 };
		expect(markUserSyncSuccess(running)).toEqual({ kind: 'success', attempt: 2 });
	});

	it('captures the error message and computes the next auto-retry delay', () => {
		const running: UserSyncStatus = { kind: 'running', attempt: 1 };
		const failed = markUserSyncFailure({ prev: running, error: new Error('network blip') });

		expect(failed).toEqual({
			kind: 'error',
			attempt: 1,
			message: 'network blip',
			autoRetryDelayMs: USER_SYNC_BACKOFF_BASE_MS
		});
		expect(hasUserSyncError(failed)).toBe(true);
		expect(shouldAutoRetryUserSync(failed)).toBe(true);
		expect(shouldSurfaceUserSyncError(failed)).toBe(false);
		expect(getUserSyncErrorMessage(failed)).toBe('network blip');
	});

	it('falls back to a generic message for non-Error rejections', () => {
		const failed = markUserSyncFailure({
			prev: { kind: 'running', attempt: 1 },
			error: undefined
		});
		expect(failed).toMatchObject({
			kind: 'error',
			message: 'Unable to initialize your account.'
		});
	});

	it('exhausts the auto-retry budget after the configured maximum attempts', () => {
		expect(getUserSyncAutoRetryDelayMs(1)).toBeNull();
		expect(getUserSyncAutoRetryDelayMs(2)).toBe(USER_SYNC_BACKOFF_BASE_MS);
		expect(getUserSyncAutoRetryDelayMs(USER_SYNC_MAX_AUTO_ATTEMPTS)).toBeGreaterThan(0);
		expect(getUserSyncAutoRetryDelayMs(USER_SYNC_MAX_AUTO_ATTEMPTS + 1)).toBeNull();

		const exhausted = markUserSyncFailure({
			prev: { kind: 'running', attempt: USER_SYNC_MAX_AUTO_ATTEMPTS },
			error: new Error('still down')
		});
		expect(exhausted).toMatchObject({
			kind: 'error',
			attempt: USER_SYNC_MAX_AUTO_ATTEMPTS,
			autoRetryDelayMs: null
		});
		expect(shouldAutoRetryUserSync(exhausted)).toBe(false);
		expect(shouldSurfaceUserSyncError(exhausted)).toBe(true);
	});

	it('lets a manual retry replace an exhausted error with a fresh running attempt', () => {
		const exhausted = markUserSyncFailure({
			prev: { kind: 'running', attempt: USER_SYNC_MAX_AUTO_ATTEMPTS },
			error: new Error('still down')
		});
		const manualRetry = beginUserSyncAttempt(exhausted);
		expect(manualRetry).toEqual({
			kind: 'running',
			attempt: USER_SYNC_MAX_AUTO_ATTEMPTS + 1
		});

		// And a recovery on that manual attempt should be reflected as success.
		expect(markUserSyncSuccess(manualRetry)).toEqual({
			kind: 'success',
			attempt: USER_SYNC_MAX_AUTO_ATTEMPTS + 1
		});
	});
});
