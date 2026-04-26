/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { describe, expect, it } from "vitest";
import { api } from "../_generated/api.js";
import schema from "../schema.js";

process.env.SITE_URL ??= "http://127.0.0.1:4174";
process.env.BETTER_AUTH_SECRET ??= "test-better-auth-secret";
process.env.AUTH_GOOGLE_ID ??= "test-google-client-id";
process.env.AUTH_GOOGLE_SECRET ??= "test-google-client-secret";

const modules = import.meta.glob([
  "/src/convex/**/*.ts",
  "!/src/convex/**/*.test.ts",
]);

const initializeRequest = {
  jsonrpc: "2.0",
  id: 1,
  method: "initialize",
  params: {
    protocolVersion: "2025-03-26",
    capabilities: {},
    clientInfo: {
      name: "vitest",
      version: "1.0.0",
    },
  },
};

/** Registration order in `createMcpServer` — `tools/list` must stay aligned. */
const EXPECTED_MCP_TOOL_NAMES = [
  "celstate_check_credits",
  "celstate_generate",
  "celstate_get_image",
  "celstate_list_images",
] as const;

async function seedAuthenticatedUser(tokenIdentifier: string) {
  const t = convexTest(schema, modules);
  const identity = t.withIdentity({
    tokenIdentifier,
    email: "mcp-test@celstate.test",
    name: "MCP Test",
  });

  await t.run(async (ctx) => {
    await ctx.db.insert("users", {
      tokenIdentifier,
      email: "mcp-test@celstate.test",
      name: "MCP Test",
      credits: 4,
    });
  });

  const created = await identity.action(api.mcp.keys.createKey, {
    name: "Claude Code",
  });

  return { created, identity, t };
}

describe("/mcp http action", () => {
  it("rejects invalid origins before touching MCP auth", async () => {
    const { created, t } = await seedAuthenticatedUser("origin-test-token");

    const response = await t.fetch("/mcp", {
      method: "POST",
      headers: {
        accept: "application/json, text/event-stream",
        authorization: `Bearer ${created.rawKey}`,
        "content-type": "application/json",
        origin: "https://evil.example",
      },
      body: JSON.stringify(initializeRequest),
    });

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toMatchObject({
      error: expect.stringContaining("Forbidden origin"),
    });
  });

  it("handles initialize requests and records durable key usage", async () => {
    const { created, identity, t } = await seedAuthenticatedUser("initialize-test-token");

    const before = await identity.query(api.mcp.keys.listKeys, {});
    expect(before[0]?.lastUsedAt).toBeUndefined();

    const response = await t.fetch("/mcp", {
      method: "POST",
      headers: {
        accept: "application/json, text/event-stream",
        authorization: `Bearer ${created.rawKey}`,
        "content-type": "application/json",
      },
      body: JSON.stringify(initializeRequest),
    });

    expect(response.status).toBe(200);
    expect(response.headers.get("x-request-id")).toBeTruthy();

    const payload = await response.json();
    expect(payload).toMatchObject({
      jsonrpc: "2.0",
      id: 1,
      result: {
        serverInfo: {
          name: "celstate",
        },
      },
    });

    const after = await identity.query(api.mcp.keys.listKeys, {});
    expect(after[0]?.lastUsedAt).toEqual(expect.any(Number));
  });

  it("exposes the registered tool set via tools/list after initialize", async () => {
    const { created, t } = await seedAuthenticatedUser("tools-list-token");

    const initRes = await t.fetch("/mcp", {
      method: "POST",
      headers: {
        accept: "application/json, text/event-stream",
        authorization: `Bearer ${created.rawKey}`,
        "content-type": "application/json",
      },
      body: JSON.stringify(initializeRequest),
    });
    expect(initRes.status).toBe(200);

    const listBody = {
      jsonrpc: "2.0",
      id: 2,
      method: "tools/list",
      params: {},
    };

    const listRes = await t.fetch("/mcp", {
      method: "POST",
      headers: {
        accept: "application/json, text/event-stream",
        authorization: `Bearer ${created.rawKey}`,
        "content-type": "application/json",
      },
      body: JSON.stringify(listBody),
    });

    expect(listRes.status).toBe(200);
    const listPayload = await listRes.json();
    expect(listPayload).toMatchObject({ jsonrpc: "2.0", id: 2 });
    const tools = listPayload?.result?.tools;
    expect(Array.isArray(tools)).toBe(true);
    const names = tools.map((tool: { name: string }) => tool.name);
    expect(names).toEqual([...EXPECTED_MCP_TOOL_NAMES]);
  });

  it("returns a deliberate 405 for standalone GET probes", async () => {
    const { t } = await seedAuthenticatedUser("get-method-token");

    const response = await t.fetch("/mcp", {
      method: "GET",
      headers: {
        accept: "text/event-stream",
      },
    });

    expect(response.status).toBe(405);
    expect(response.headers.get("allow")).toBe("OPTIONS, POST");
    await expect(response.json()).resolves.toMatchObject({
      error: expect.stringContaining("does not expose a standalone SSE stream"),
    });
  });
});
