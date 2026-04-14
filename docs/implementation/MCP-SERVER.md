# Celstate MCP Server

## Overview

Celstate ships a remote, Convex-hosted MCP endpoint for agentic clients such as Claude Code and Cursor.
It lets authenticated agents generate transparent-background images, inspect progress, and check recent work on behalf of a signed-in Celstate user.

## Architecture

```
┌──────────────┐    Streamable HTTP    ┌──────────────────────┐    internal     ┌──────────┐
│ MCP Client   │ ─────────────────────▶│ Convex HTTP action   │ ───────────────▶ │ Convex   │
│ (Claude,     │    JSON-RPC 2.0       │ `/mcp` + MCP SDK     │    queries &     │ database │
│ Cursor, etc) │◀───────────────────── │ stateless transport   │    mutations     │ storage  │
└──────────────┘                       └──────────────────────┘                  └──────────┘
```

### Transport

**Streamable HTTP (stateless, JSON response mode)** — the canonical endpoint is the hosted Convex route at:

```text
https://<deployment>.convex.site/mcp
```

The server stays stateless on purpose: every POST creates a fresh MCP server instance and a fresh transport so request IDs, auth context, and tool execution cannot bleed across users or clients.

Celstate intentionally does **not** expose standalone SSE or session termination today:

- `POST /mcp` handles JSON-RPC traffic.
- `GET /mcp` returns `405 Method Not Allowed` with guidance to use POST.
- `DELETE /mcp` returns `405 Method Not Allowed` because there are no MCP sessions to terminate.
- `OPTIONS /mcp` returns `204 No Content` for polite preflight/probing support.

That shape is deliberate for AI harnesses. It matches the MCP spec's expectations for a stateless HTTP server without taking on unused session or SSE complexity.

### Origin and auth policy

- The endpoint accepts requests with **no** `Origin` header, which is the normal case for agent clients.
- If an `Origin` header is present, Celstate accepts only the request origin itself or explicit values from `MCP_ALLOWED_ORIGINS` and rejects everything else with `403`.
- Every non-OPTIONS request must include `Authorization: Bearer <celstate_api_key>`.

### Auth

Bearer token auth backed by user-generated Celstate API keys stored in Convex.

The hosted handler authenticates each request by hashing the presented key and calling one internal Convex mutation that:

1. finds the key by hash,
2. rejects revoked or unknown keys,
3. loads the owning user,
4. updates `lastUsedAt` in the same mutation.

This keeps the UI's "last used" timestamp trustworthy instead of best-effort.

## Tool Design (Context Rot Prevention)

Following Anthropic's 2026 guidance on avoiding context bloat:

### Principles Applied

1. **Minimal tool count** — 4 tools, ~1,500 tokens total for all definitions
2. **Concise descriptions** — each tool description < 80 words
3. **Token-efficient responses** — return only user-actionable fields, no internal IDs
4. **Pagination by default** — `celstate_list_images` returns max 10 results
5. **Actionable errors** — error messages tell the agent exactly what to fix
6. **Tool annotations** — `readOnlyHint`, `destructiveHint`, `idempotentHint`, and `openWorldHint` on each tool
7. **Namespaced** — all tools prefixed with `celstate_` to avoid collision

### Tools

| Tool                     | Annotations              | Purpose                                              |
| ------------------------ | ------------------------ | ---------------------------------------------------- |
| `celstate_generate`      | destructive, open-world, non-idempotent | Generate a transparent-background image from a prompt |
| `celstate_get_image`     | read-only, idempotent    | Get status/download URL for a generation              |
| `celstate_list_images`   | read-only, idempotent    | List recent generations (paginated, max 10)           |
| `celstate_check_credits` | read-only, idempotent    | Check remaining credits                               |

### What We Intentionally Don't Expose

- ❌ `list_all_images` (unbounded, context-destroying)
- ❌ `delete_image` (destructive, rarely needed via agent)
- ❌ `buy_credits` (financial action should stay in browser)
- ❌ `upload_reference_image` (binary data over MCP is complex)

## Tech Stack

- `@modelcontextprotocol/sdk` v1.x (TypeScript SDK)
- `zod` (parameter validation — required by MCP SDK)
- `convex` HTTP actions, internal queries, and internal mutations

## Source Of Truth

The hosted Convex implementation is the only real MCP server implementation.

Relevant files:

```text
src/convex/http.ts
src/convex/mcp/handler.ts
src/convex/mcp/keys.ts
src/convex/mcp/tools/*.ts
src/convex/generations.ts
```

`packages/mcp-server` is now only an optional reverse proxy for environments that want a local URL in front of the hosted endpoint. It no longer defines its own tools, auth, or transport contract.

## Optional Proxy Package

```
packages/mcp-server/
├── src/
│   └── index.ts           # Thin reverse proxy to the hosted `/mcp` endpoint
├── tsconfig.json
└── package.json
```

Set `MCP_UPSTREAM_URL` to your hosted Celstate MCP URL before starting the proxy.

## Backend Query Shape

The hosted MCP handler uses internal Convex functions tailored for agent auth and tool calls:

- `mcp.keys:authenticateKeyByHash` — auth + durable `lastUsedAt`
- `generations:requestGenerationForMcp` — mutation used by `celstate_generate`
- `generations:getGenerationForMcp` — point lookup used by `celstate_get_image`
- `generations:listGenerationsForMcp` — capped history query used by `celstate_list_images`
- `generations:getCreditsForMcp` — credit lookup used by `celstate_check_credits`

The dedicated point lookup and capped list query avoid the earlier anti-pattern of loading a user's entire history just to poll one generation.

## Client Setup

### Claude Code

```bash
claude mcp add --transport http celstate https://<deployment>.convex.site/mcp \
  --header "Authorization: Bearer <your_api_key>"
```

### Manual JSON config

```json
{
  "mcpServers": {
    "celstate": {
      "type": "http",
      "url": "https://<deployment>.convex.site/mcp",
      "headers": {
        "Authorization": "Bearer <your_api_key>"
      }
    }
  }
}
```

## Deployment

The production path is the hosted Convex endpoint.

If you need a local hop for enterprise networking, start the optional proxy package with:

```bash
MCP_UPSTREAM_URL=https://<deployment>.convex.site/mcp pnpm --dir packages/mcp-server dev
```
