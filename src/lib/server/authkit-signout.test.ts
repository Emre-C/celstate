import { describe, expect, it } from "vitest";
import { AUTHKIT_SESSION_COOKIE } from "./authkit-constants.js";

/**
 * Pure test helper extracted from signOutPostProcessHandle in hooks.server.ts.
 * Verifies that when a clear-cookie and a re-set cookie both appear for the
 * AuthKit session name, only the clear-cookie survives.
 */
function simulateSignOutCookieCleanup(cookies: string[]): string[] {
	const sessionCookies = cookies.filter((c) =>
		c.startsWith(`${AUTHKIT_SESSION_COOKIE}=`),
	);
	const clearCookies = sessionCookies.filter(
		(c) => c.includes("Max-Age=0") || c.includes("Expires=Thu, 01 Jan 1970"),
	);

	if (clearCookies.length === 0 || sessionCookies.length === clearCookies.length) {
		return cookies;
	}

	return cookies.filter(
		(c) =>
			!c.startsWith(`${AUTHKIT_SESSION_COOKIE}=`) ||
			c.includes("Max-Age=0") ||
			c.includes("Expires=Thu, 01 Jan 1970"),
	);
}

describe("sign-out post-process cookie cleanup", () => {
	it("passes through when no session cookies are present", () => {
		const input = ["other=value; Path=/"];
		expect(simulateSignOutCookieCleanup(input)).toEqual(input);
	});

	it("passes through when only a clear-cookie is present", () => {
		const input = [`${AUTHKIT_SESSION_COOKIE}=; Max-Age=0; Path=/; HttpOnly`];
		expect(simulateSignOutCookieCleanup(input)).toEqual(input);
	});

	it("strips re-set session cookies when a clear-cookie is also present", () => {
		const input = [
			`${AUTHKIT_SESSION_COOKIE}=abc123; Path=/; HttpOnly`,
			`${AUTHKIT_SESSION_COOKIE}=; Max-Age=0; Path=/; HttpOnly`,
		];
		const result = simulateSignOutCookieCleanup(input);
		expect(result).toHaveLength(1);
		expect(result[0]).toContain("Max-Age=0");
	});

	it("strips multiple re-sets while keeping the single clear-cookie", () => {
		const input = [
			`${AUTHKIT_SESSION_COOKIE}=abc123; Path=/; HttpOnly`,
			`${AUTHKIT_SESSION_COOKIE}=def456; Path=/; HttpOnly`,
			`${AUTHKIT_SESSION_COOKIE}=; Max-Age=0; Path=/; HttpOnly`,
		];
		const result = simulateSignOutCookieCleanup(input);
		expect(result).toHaveLength(1);
		expect(result[0]).toContain("Max-Age=0");
	});

	it("preserves non-session cookies during cleanup", () => {
		const input = [
			"other=value; Path=/",
			`${AUTHKIT_SESSION_COOKIE}=abc123; Path=/; HttpOnly`,
			`${AUTHKIT_SESSION_COOKIE}=; Max-Age=0; Path=/; HttpOnly`,
		];
		const result = simulateSignOutCookieCleanup(input);
		expect(result).toHaveLength(2);
		expect(result[0]).toBe("other=value; Path=/");
		expect(result[1]).toContain("Max-Age=0");
	});
});
