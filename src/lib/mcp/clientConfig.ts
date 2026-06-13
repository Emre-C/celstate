export const MCP_SERVER_CONFIG_NAME = "celstate";

export function buildPublicMcpUrl(publicSiteUrl: string): string {
  let url: URL;
  try {
    url = new URL(publicSiteUrl.trim());
  } catch {
    throw new Error(
      "Invalid PUBLIC_SITE_URL: set an origin-only URL (for example https://celstate.com) so the public MCP endpoint can be derived.",
    );
  }

  if (
    (url.protocol !== "http:" && url.protocol !== "https:") ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    (url.pathname !== "/" && url.pathname !== "")
  ) {
    throw new Error(
      "Invalid PUBLIC_SITE_URL: set an origin-only URL (for example https://celstate.com) so the public MCP endpoint can be derived.",
    );
  }

  return `${url.origin}/mcp`;
}

export function buildClaudeCodeCommand(url: string, apiKey: string): string {
  return `claude mcp add --transport http ${MCP_SERVER_CONFIG_NAME} ${url} --header "Authorization: Bearer ${apiKey}"`;
}

export function buildMcpJsonConfig(url: string, apiKey: string): string {
  return JSON.stringify(
    {
      mcpServers: {
        [MCP_SERVER_CONFIG_NAME]: {
          type: "http",
          url,
          headers: {
            Authorization: `Bearer ${apiKey}`,
          },
        },
      },
    },
    null,
    2,
  );
}
