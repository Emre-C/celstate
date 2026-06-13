import { describe, expect, it } from "vitest";
import {
  buildClaudeCodeCommand,
  buildPublicMcpUrl,
  buildMcpJsonConfig,
} from "./clientConfig.js";

describe("clientConfig", () => {
  it("builds the public MCP URL from the app origin", () => {
    expect(buildPublicMcpUrl("https://celstate.com")).toBe("https://celstate.com/mcp");
  });

  it("normalizes trailing slashes before appending the MCP path", () => {
    expect(buildPublicMcpUrl("https://www.celstate.com/")).toBe("https://www.celstate.com/mcp");
  });

  it("rejects non-origin public site URLs", () => {
    expect(() => buildPublicMcpUrl("https://celstate.com/app")).toThrow(/Invalid PUBLIC_SITE_URL/);
    expect(() => buildPublicMcpUrl("https://celstate.com?preview=1")).toThrow(/Invalid PUBLIC_SITE_URL/);
  });

  it("throws when the public site URL cannot be parsed", () => {
    expect(() => buildPublicMcpUrl("not-a-url")).toThrow(/Invalid PUBLIC_SITE_URL/);
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
