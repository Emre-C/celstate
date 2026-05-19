import { describe, expect, it } from "vitest";
import { requireAuthKitSession } from "./authkit-guard.js";

describe("requireAuthKitSession", () => {
	it("redirects unauthenticated browser flows with pathname + query preserved", () => {
		const event = {
			url: new URL("https://celstate.test/app/team?invite=abc"),
			locals: {
				auth: { user: null },
			},
		} as Parameters<typeof requireAuthKitSession>[0];

		try {
			requireAuthKitSession(event);
			expect.fail("expected redirect");
		} catch (e: unknown) {
			expect(e).toMatchObject({
				status: 303,
				location: "/auth?redirectTo=%2Fapp%2Fteam%3Finvite%3Dabc",
			});
		}
	});

	it("allows requests when AuthKit user is present", () => {
		const event = {
			url: new URL("https://celstate.test/app"),
			locals: {
				auth: {
					user: { id: "user_1" },
				},
			},
		} as Parameters<typeof requireAuthKitSession>[0];

		expect(() => requireAuthKitSession(event)).not.toThrow();
	});
});
