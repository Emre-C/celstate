import { describe, expect, it } from "vitest";
import { requireClerkSession } from "./clerk-guard.js";

describe("requireClerkSession", () => {
	it("redirects unauthenticated browser flows with pathname + query preserved", () => {
		const event = {
			url: new URL("https://celstate.test/app/team?invite=abc"),
			locals: {
				auth: () => ({ userId: null }),
			},
		} as Parameters<typeof requireClerkSession>[0];

		try {
			requireClerkSession(event);
			expect.fail("expected redirect");
		} catch (e: unknown) {
			expect(e).toMatchObject({
				status: 303,
				location: "/api/auth/initiate?returnTo=%2Fapp%2Fteam%3Finvite%3Dabc",
			});
		}
	});

	it("allows requests when Clerk user is present", () => {
		const event = {
			url: new URL("https://celstate.test/app"),
			locals: {
				auth: () => ({ userId: "user_1" }),
			},
		} as Parameters<typeof requireClerkSession>[0];

		expect(() => requireClerkSession(event)).not.toThrow();
	});
});
