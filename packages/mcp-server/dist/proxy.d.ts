import express, { type Request as ExpressRequest, type Response as ExpressResponse } from "express";
export declare const DEFAULT_HOST = "127.0.0.1";
export declare const DEFAULT_PORT = 3100;
export declare const DEFAULT_UPSTREAM_TIMEOUT_MS = 30000;
export declare const HEALTH_ENDPOINT_PATH = "/health";
export declare const MCP_ENDPOINT_PATH = "/mcp";
type HeaderValue = string | string[] | number | undefined;
type Logger = Pick<typeof console, "error" | "info">;
export type McpProxyRuntimeConfig = {
    host: string;
    port: number;
    timeoutMs: number;
    upstreamMcpUrl: URL;
};
export type McpProxyRequest = {
    body?: Uint8Array;
    headers: Record<string, HeaderValue>;
    method: string;
    originalUrl: string;
};
export type McpProxyResponse = {
    body?: Uint8Array;
    headers: Headers;
    status: number;
};
export type McpProxyHandlerOptions = {
    fetchImpl?: typeof fetch;
    logger?: Logger;
    request: McpProxyRequest;
    timeoutMs?: number;
    upstreamMcpUrl: URL;
};
export declare function parsePort(portValue: string | undefined): number;
export declare function parseTimeoutMs(timeoutValue: string | undefined): number;
export declare function getUpstreamMcpUrl(env?: NodeJS.ProcessEnv): URL;
export declare function readRuntimeConfig(env?: NodeJS.ProcessEnv): McpProxyRuntimeConfig;
export declare function resolveRequestId(headers: Record<string, HeaderValue>): string;
export declare function buildUpstreamRequestUrl(originalUrl: string, upstreamMcpUrl: URL): URL;
export declare function buildUpstreamRequestHeaders(headers: Record<string, HeaderValue>, requestId: string): Headers;
export declare function handleMcpProxyRequest({ fetchImpl, logger, request, timeoutMs, upstreamMcpUrl, }: McpProxyHandlerOptions): Promise<McpProxyResponse>;
export declare function readRequestBody(req: ExpressRequest): Promise<Uint8Array | undefined>;
export declare function writeProxyResponse(res: ExpressResponse, proxyResponse: McpProxyResponse): Promise<void>;
export declare function createMcpProxyApp(config: McpProxyRuntimeConfig): express.Express;
export {};
