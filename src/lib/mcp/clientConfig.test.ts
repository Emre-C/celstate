import { describe, expect, it } from "vitest";
import {
  buildClaudeCodeCommand,
  buildHostedMcpUrl,
  buildMcpJsonConfig,
} from "./clientConfig.js";

describe("clientConfig", () => {
  it("converts convex cloud URLs to hosted MCP URLs", () => {
    expect(buildHostedMcpUrl("https://vivid-fox-123.convex.cloud")).toBe(
      "https://vivid-fox-123.convex.site/mcp",
    );
  });

  it("keeps non-convex-cloud hosts intact", () => {
    expect(buildHostedMcpUrl("https://api.celstate.com")).toBe(
      "https://api.celstate.com/mcp",
    );
  });

  it("throws when the public URL cannot be parsed", () => {
    expect(() => buildHostedMcpUrl("not-a-url")).toThrow(/Invalid PUBLIC_CONVEX_URL/);
  });

  it("builds a Claude Code command with the http transport", () => {
    expect(
      buildClaudeCodeCommand("https://example.com/mcp", "cel_test_key"),
    ).toBe(
      'claude mcp add --transport http celstate https://example.com/mcp --header "Authorization: Bearer cel_test_key"',
    );
  });

  it("builds JSON config with an explicit http type", () => {
    expect(
      JSON.parse(buildMcpJsonConfig("https://example.com/mcp", "cel_test_key")),
    ).toEqual({
      mcpServers: {
        celstate: {
          type: "http",
          url: "https://example.com/mcp",
          headers: {
            Authorization: "Bearer cel_test_key",
          },
        },
      },
    });
  });
});
