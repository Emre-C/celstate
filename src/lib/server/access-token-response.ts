/**
 * Pure helpers for `/api/auth/access-token` JSON contract.
 * Session refresh is handled by `authKitHandle()` (`@workos/authkit-sveltekit`);
 * `authKit.refreshSession` is currently a library no-op — do not expose a "refresh" query flag.
 */

export const AUTH_ACCESS_TOKEN_NO_STORE = {
	"Cache-Control": "no-store, private",
} as const;

export type AccessTokenJsonBody = { token: string | null };

export function accessTokenJsonForConvex(accessToken: string | undefined): {
	body: AccessTokenJsonBody;
	status: number;
} {
	if (!accessToken?.trim()) {
		return { body: { token: null }, status: 401 };
	}
	return { body: { token: accessToken }, status: 200 };
}
