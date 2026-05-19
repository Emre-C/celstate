import { describe, expect, it } from "vitest";
import { accessTokenJsonForConvex } from "./access-token-response.js";

describe("accessTokenJsonForConvex", () => {
	it("returns 401 with null token when access token is missing", () => {
		expect(accessTokenJsonForConvex(undefined)).toEqual({
			body: { token: null },
			status: 401,
		});
	});

	it("returns 401 for blank token", () => {
		expect(accessTokenJsonForConvex("  ")).toEqual({
			body: { token: null },
			status: 401,
		});
	});

	it("returns 200 with token when set", () => {
		expect(accessTokenJsonForConvex("jwt.stub")).toEqual({
			body: { token: "jwt.stub" },
			status: 200,
		});
	});
});
