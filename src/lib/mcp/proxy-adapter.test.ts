import { describe, expect, it } from "vitest";
import {
  buildUpstreamRequestHeaders,
  buildUpstreamRequestUrl,
  handleMcpProxyRequest,
} from "../../../packages/mcp-server/src/proxy.js";

const upstreamMcpUrl = new URL("https://convex.example/mcp");
const logger = {
  error: () => undefined,
  info: () => undefined,
};

function encodeJson(value: unknown): Uint8Array {
  return new TextEncoder().encode(JSON.stringify(value));
}

describe("MCP proxy adapter", () => {
  it("normalizes forwarded headers and propagates a trusted request id", () => {
    const headers = buildUpstreamRequestHeaders(
      {
        accept: "application/json, text/event-stream",
        authorization: "Bearer cel_test",
        connection: "keep-alive",
        host: "127.0.0.1:3100",
        "x-forwarded-for": "203.0.113.1",
        "x-request-id": "caller-controlled",
      },
      "req-123",
    );

    expect(headers.get("accept")).toBe("application/json, text/event-stream");
    expect(headers.get("authorization")).toBe("Bearer cel_test");
    expect(headers.get("connection")).toBeNull();
    expect(headers.get("host")).toBeNull();
    expect(headers.get("x-forwarded-for")).toBeNull();
    expect(headers.get("x-request-id")).toBe("req-123");
  });

  it("preserves the hosted MCP path while forwarding query parameters", () => {
    expect(buildUpstreamRequestUrl("/mcp?session=abc", upstreamMcpUrl).toString()).toBe(
      "https://convex.example/mcp?session=abc",
    );
  });

  it("returns a local 405 for standalone GET probes", async () => {
    const response = await handleMcpProxyRequest({
      logger,
      request: {
        headers: { "x-request-id": "req-get" },
        method: "GET",
        originalUrl: "/mcp",
      },
      upstreamMcpUrl,
    });

    expect(response.status).toBe(405);
    expect(response.headers.get("allow")).toBe("OPTIONS, POST");
    expect(response.headers.get("x-request-id")).toBe("req-get");
  });

  it("retries transient upstream failures only for safe JSON-RPC methods", async () => {
    let calls = 0;
    const fetchImpl: typeof fetch = async (_input, init) => {
      calls += 1;
      expect((init?.headers as Headers).get("x-request-id")).toBe("req-safe");
      if (calls === 1) {
        return new Response("temporary", { status: 503 });
      }

      return new Response(JSON.stringify({ jsonrpc: "2.0", id: 1, result: {} }), {
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
        body: encodeJson({ jsonrpc: "2.0", id: 1, method: "initialize", params: {} }),
        headers: {
          accept: "application/json, text/event-stream",
          "content-type": "application/json",
          "x-request-id": "req-safe",
        },
        method: "POST",
        originalUrl: "/mcp",
      },
      upstreamMcpUrl,
    });

    expect(calls).toBe(2);
    expect(response.status).toBe(200);
    expect(response.headers.get("transfer-encoding")).toBeNull();
    expect(response.headers.get("x-request-id")).toBe("req-safe");
  });

  it("does not retry potentially side-effectful tool calls", async () => {
    let calls = 0;
    const fetchImpl: typeof fetch = async () => {
      calls += 1;
      return new Response("temporary", { status: 503 });
    };

    const response = await handleMcpProxyRequest({
      fetchImpl,
      logger,
      request: {
        body: encodeJson({
          jsonrpc: "2.0",
          id: 1,
          method: "tools/call",
          params: { name: "celstate_generate", arguments: { prompt: "logo" } },
        }),
        headers: { "content-type": "application/json" },
        method: "POST",
        originalUrl: "/mcp",
      },
      upstreamMcpUrl,
    });

    expect(calls).toBe(1);
    expect(response.status).toBe(503);
  });
});
