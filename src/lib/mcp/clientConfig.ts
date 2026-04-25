export const MCP_SERVER_CONFIG_NAME = "celstate";

export function buildHostedMcpUrl(publicConvexUrl: string): string {
  let url: URL;
  try {
    url = new URL(publicConvexUrl);
  } catch {
    throw new Error(
      "Invalid PUBLIC_CONVEX_URL: set a full deployment URL (for example https://<deployment>.convex.cloud) so the hosted MCP endpoint can be derived.",
    );
  }
  const hostname = url.hostname.endsWith(".convex.cloud")
    ? url.hostname.replace(/\.convex\.cloud$/, ".convex.site")
    : url.hostname;

  return `${url.protocol}//${hostname}/mcp`;
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
