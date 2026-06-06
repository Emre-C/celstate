export type AuthProviderId = 'google' | 'apple';

/**
 * The auth provider actually attached to a given user, including `'unknown'`
 * for the fallback case where identity metadata does not resolve to a
 * recognised provider (e.g. legacy accounts, rare upstream shapes).
 */
export type ResolvedAuthProvider = AuthProviderId | 'unknown';

