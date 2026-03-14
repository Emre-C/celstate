import { describe, expect, it } from 'vitest';
import {
	getProtectedAppRedirectStrategy,
	getProtectedAppViewState
} from './protected-app.js';

describe('protected app auth state', () => {
	it('keeps the app visible while auth is revalidating after an authenticated session', () => {
		expect(
			getProtectedAppViewState({
				authIsAuthenticated: false,
				authIsLoading: true,
				hasAuthenticatedSession: true,
				hasSyncError: false,
				redirectScheduled: false,
				userReady: true
			})
		).toMatchObject({
			isEffectivelyAuthenticated: true,
			shouldRenderChildren: true,
			shouldShowLoading: false,
			shouldRedirectImmediately: false
		});
	});

	it('keeps the app visible during the recovery grace period after a transient unauthenticated read', () => {
		expect(
			getProtectedAppViewState({
				authIsAuthenticated: false,
				authIsLoading: false,
				hasAuthenticatedSession: true,
				hasSyncError: false,
				redirectScheduled: false,
				userReady: true
			})
		).toMatchObject({
			isEffectivelyAuthenticated: true,
			shouldRenderChildren: true,
			shouldShowLoading: false,
			shouldRedirectImmediately: false
		});
		expect(
			getProtectedAppRedirectStrategy({
				authIsAuthenticated: false,
				authIsLoading: false,
				hasAuthenticatedSession: true
			})
		).toBe('delayed');
	});

	it('redirects immediately only when the client is settled and no authenticated session is known', () => {
		expect(
			getProtectedAppViewState({
				authIsAuthenticated: false,
				authIsLoading: false,
				hasAuthenticatedSession: false,
				hasSyncError: false,
				redirectScheduled: false,
				userReady: false
			})
		).toMatchObject({
			isEffectivelyAuthenticated: false,
			shouldRenderChildren: false,
			shouldShowLoading: false,
			shouldRedirectImmediately: true
		});
		expect(
			getProtectedAppRedirectStrategy({
				authIsAuthenticated: false,
				authIsLoading: false,
				hasAuthenticatedSession: false
			})
		).toBe('immediate');
	});

	it('shows the workspace loading shell while the authenticated user bootstrap is incomplete', () => {
		expect(
			getProtectedAppViewState({
				authIsAuthenticated: true,
				authIsLoading: false,
				hasAuthenticatedSession: true,
				hasSyncError: false,
				redirectScheduled: false,
				userReady: false
			})
		).toMatchObject({
			isEffectivelyAuthenticated: true,
			shouldRenderChildren: false,
			shouldShowLoading: true,
			shouldRedirectImmediately: false
		});
	});
});
