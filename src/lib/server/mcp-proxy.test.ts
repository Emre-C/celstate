import { describe, expect, it } from "vitest";
import {
	buildConvexMcpUpstreamUrl,
	buildUpstreamRequestHeaders,
	buildUpstreamRequestUrl,
	handleMcpProxyRequest,
} from "./mcp-proxy.js";

const logger = {
	errors: [] as string[],
	infos: [] as string[],
	error(message: string) {
		this.errors.push(message);
	},
	info(message: string) {
		this.infos.push(message);
	},
};

function encodeJson(value: unknown): Uint8Array {
	return new TextEncoder().encode(JSON.stringify(value));
}

function decodeBody(body: Uint8Array | undefined): string {
	return body ? new TextDecoder().decode(body) : "";
}

describe("mcp proxy", () => {
	it("maps the public Convex realtime URL to the Convex MCP site route", () => {
		expect(
			buildConvexMcpUpstreamUrl({
				publicConvexUrl: "https://original-jackal-530.convex.cloud",
			}).toString(),
		).toBe("https://original-jackal-530.convex.site/mcp");
	});

	it("preserves the upstream MCP path while forwarding query parameters", () => {
		expect(
			buildUpstreamRequestUrl(
				"/mcp?session=abc",
				new URL("https://original-jackal-530.convex.site/mcp"),
			).toString(),
		).toBe("https://original-jackal-530.convex.site/mcp?session=abc");
	});

	it("strips unsafe forwarding headers while preserving auth and content headers", () => {
		const headers = buildUpstreamRequestHeaders(
			new Headers({
				accept: "application/json, text/event-stream",
				authorization: "Bearer cel_test_key",
				connection: "keep-alive",
				"content-type": "application/json",
				host: "celstate.com",
				"x-forwarded-for": "203.0.113.1",
				"x-request-id": "caller-id",
			}),
			"req-123",
		);

		expect(headers.get("accept")).toBe("application/json, text/event-stream");
		expect(headers.get("authorization")).toBe("Bearer cel_test_key");
		expect(headers.get("content-type")).toBe("application/json");
		expect(headers.get("connection")).toBeNull();
		expect(headers.get("host")).toBeNull();
		expect(headers.get("x-forwarded-for")).toBeNull();
		expect(headers.get("x-request-id")).toBe("req-123");
	});

	it("returns a local 405 for standalone GET probes", async () => {
		const response = await handleMcpProxyRequest({
			logger,
			request: {
				headers: new Headers({ "x-request-id": "req-get" }),
				method: "GET",
				originalUrl: "/mcp",
			},
			upstreamMcpUrl: new URL("https://original-jackal-530.convex.site/mcp"),
		});

		expect(response.status).toBe(405);
		expect(response.headers.get("allow")).toBe("OPTIONS, POST");
		expect(response.headers.get("cache-control")).toBe("no-store");
		expect(response.headers.get("x-request-id")).toBe("req-get");
		expect(decodeBody(response.body)).toContain("Agent clients should POST JSON-RPC messages to /mcp");
	});

	it("forwards POST bodies without logging request bodies or API keys", async () => {
		logger.errors = [];
		logger.infos = [];
		const body = encodeJson({
			id: 1,
			jsonrpc: "2.0",
			method: "tools/call",
			params: { arguments: { prompt: "secret prompt body" }, name: "celstate_generate" },
		});

		const fetchImpl: typeof fetch = async (input, init) => {
			expect(input.toString()).toBe("https://original-jackal-530.convex.site/mcp?session=abc");
			expect((init?.headers as Headers).get("authorization")).toBe("Bearer cel_secret_key");
			expect((init?.headers as Headers).get("x-request-id")).toBe("req-forward");
			expect(await new Response(init?.body).text()).toBe(decodeBody(body));
			return new Response(JSON.stringify({ id: 1, jsonrpc: "2.0", result: { ok: true } }), {
				headers: {
					"content-type": "application/json",
					"transfer-encoding": "chunked",
				},
				status: 200,
			});
		};

		const response = await handleMcpProxyRequest({
			fetchImpl,
			logger,
			request: {
				body,
				headers: new Headers({
					authorization: "Bearer cel_secret_key",
					"content-type": "application/json",
					"x-request-id": "req-forward",
				}),
				method: "POST",
				originalUrl: "/mcp?session=abc",
			},
			upstreamMcpUrl: new URL("https://original-jackal-530.convex.site/mcp"),
		});

		expect(response.status).toBe(200);
		expect(response.headers.get("cache-control")).toBe("no-store");
		expect(response.headers.get("transfer-encoding")).toBeNull();
		expect(decodeBody(response.body)).toContain('"ok":true');

		const logs = [...logger.errors, ...logger.infos].join("\n");
		expect(logs).not.toContain("cel_secret_key");
		expect(logs).not.toContain("secret prompt body");
	});
});
