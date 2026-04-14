export const MCP_SERVER_CONFIG_NAME = "celstate";
export const MCP_URL_FALLBACK = "https://your-deployment.convex.site/mcp";

export function buildHostedMcpUrl(publicConvexUrl: string): string {
  try {
    const url = new URL(publicConvexUrl);
    const hostname = url.hostname.endsWith(".convex.cloud")
      ? url.hostname.replace(/\.convex\.cloud$/, ".convex.site")
      : url.hostname;

    return `${url.protocol}//${hostname}/mcp`;
  } catch {
    return MCP_URL_FALLBACK;
  }
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
