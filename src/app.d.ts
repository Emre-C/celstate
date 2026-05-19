declare global {
	namespace App {
		interface Locals {
			requestId: string;
			/** WorkOS access token for Convex `setAuth` (when session present). */
			token: string | undefined;
			auth: import("@workos/authkit-sveltekit").AuthKitAuth;
		}
	}
}

export {};
