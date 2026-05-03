import {
  HEALTH_ENDPOINT_PATH,
  MCP_ENDPOINT_PATH,
  createMcpProxyApp,
  readRuntimeConfig,
} from "./proxy.js";

const config = readRuntimeConfig();
const app = createMcpProxyApp(config);

app.listen(config.port, config.host, () => {
  console.info(
    JSON.stringify({
      event: "mcp_proxy_listening",
      healthUrl: `http://${config.host}:${config.port}${HEALTH_ENDPOINT_PATH}`,
      mcpUrl: `http://${config.host}:${config.port}${MCP_ENDPOINT_PATH}`,
      upstream: config.upstreamMcpUrl.toString(),
    }),
  );
});
