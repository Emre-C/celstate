import express, { type Request as ExpressRequest, type Response as ExpressResponse } from "express";

const DEFAULT_HOST = "127.0.0.1";
const DEFAULT_PORT = 3100;
const HEALTH_ENDPOINT_PATH = "/health";
const MCP_ENDPOINT_PATH = "/mcp";

const PORT = parsePort(process.env.PORT);
const HOST = process.env.HOST ?? DEFAULT_HOST;
const UPSTREAM_MCP_URL = getUpstreamMcpUrl();

function parsePort(portValue: string | undefined): number {
  const parsedPort = parseInt(portValue ?? `${DEFAULT_PORT}`, 10);
  return Number.isFinite(parsedPort) && parsedPort > 0 ? parsedPort : DEFAULT_PORT;
}

function getUpstreamMcpUrl(): URL {
  const value = process.env.MCP_UPSTREAM_URL;
  if (!value) {
    throw new Error(
      "MCP_UPSTREAM_URL is required. Point it at the canonical hosted Celstate MCP endpoint, for example https://your-deployment.convex.site/mcp.",
    );
  }

  return new URL(value);
}

function copyRequestHeaders(req: ExpressRequest): Headers {
  const headers = new Headers();

  for (const [key, value] of Object.entries(req.headers)) {
    if (value === undefined) {
      continue;
    }

    const lowerKey = key.toLowerCase();
    if (lowerKey === "host" || lowerKey === "connection" || lowerKey === "content-length") {
      continue;
    }

    headers.set(key, Array.isArray(value) ? value.join(", ") : value);
  }

  return headers;
}

async function readRequestBody(req: ExpressRequest): Promise<string | undefined> {
  if (req.method === "GET" || req.method === "HEAD" || req.method === "OPTIONS") {
    return undefined;
  }

  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(typeof chunk === "string" ? Buffer.from(chunk) : Buffer.from(chunk));
  }

  return chunks.length > 0 ? Buffer.concat(chunks).toString("utf8") : undefined;
}

function buildUpstreamRequestUrl(req: ExpressRequest): URL {
  return new URL(req.originalUrl, UPSTREAM_MCP_URL);
}

async function writeProxyResponse(
  res: ExpressResponse,
  upstreamResponse: globalThis.Response,
): Promise<void> {
  res.status(upstreamResponse.status);

  upstreamResponse.headers.forEach((value, key) => {
    if (key.toLowerCase() === "transfer-encoding") {
      return;
    }

    res.setHeader(key, value);
  });

  const body = Buffer.from(await upstreamResponse.arrayBuffer());
  res.send(body);
}

const app = express();
app.disable("x-powered-by");

app.get(HEALTH_ENDPOINT_PATH, (_req, res) => {
  res.json({
    mode: "proxy",
    status: "ok",
    upstream: UPSTREAM_MCP_URL.toString(),
  });
});

app.all(MCP_ENDPOINT_PATH, async (req, res) => {
  try {
    const upstreamResponse = await fetch(buildUpstreamRequestUrl(req), {
      method: req.method,
      headers: copyRequestHeaders(req),
      body: await readRequestBody(req),
      redirect: "manual",
    });

    await writeProxyResponse(res, upstreamResponse);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Proxy request failed";
    res.status(502).json({ error: message });
  }
});

app.listen(PORT, HOST, () => {
  console.info(
    JSON.stringify({
      event: "mcp_proxy_listening",
      healthUrl: `http://${HOST}:${PORT}${HEALTH_ENDPOINT_PATH}`,
      mcpUrl: `http://${HOST}:${PORT}${MCP_ENDPOINT_PATH}`,
      upstream: UPSTREAM_MCP_URL.toString(),
    }),
  );
});
