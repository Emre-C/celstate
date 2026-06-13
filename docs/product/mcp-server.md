# Celstate MCP Server

This is product documentation for the shipped remote MCP surface. The server is implemented and live in the current codebase, so it belongs in `docs/product` rather than `docs/implementation`.

## Overview

Celstate ships a remote MCP endpoint for agentic clients such as Claude Code and Cursor.
The public endpoint lives on the Celstate app origin:

```text
https://celstate.com/mcp
```

In non-production environments, replace `https://celstate.com` with the configured `PUBLIC_SITE_URL` origin. Convex remains the upstream implementation detail for auth, tools, and durable data.

## Architecture

```
┌──────────────┐    Streamable HTTP    ┌──────────────────────┐    proxy        ┌──────────────────────┐    internal     ┌──────────┐
│ MCP Client   │ ─────────────────────▶│ SvelteKit app route  │ ──────────────▶│ Convex HTTP action   │ ───────────────▶ │ Convex   │
│ (Claude,     │    JSON-RPC 2.0       │ `/mcp` on app origin │                │ `/mcp` + MCP SDK     │    queries &     │ database │
│ Cursor, etc) │◀───────────────────── │ public endpoint      │◀────────────── │ stateless transport  │    mutations     │ storage  │
└──────────────┘                       └──────────────────────┘                 └──────────────────────┘                  └──────────┘
```

### Transport

**Streamable HTTP (stateless, JSON response mode)** — the canonical user-facing endpoint is the app-domain route at:

```text
https://<PUBLIC_SITE_URL origin>/mcp
```

The SvelteKit route proxies to the matching Convex HTTP action derived from `PUBLIC_CONVEX_URL` / optional `PUBLIC_CONVEX_SITE_URL`. The Convex handler stays stateless on purpose: every POST creates a fresh MCP server instance and a fresh transport so request IDs, auth context, and tool execution cannot bleed across users or clients.

Celstate intentionally does **not** expose standalone SSE or session termination today:

- `POST /mcp` handles JSON-RPC traffic.
- `GET /mcp` returns `405 Method Not Allowed` with guidance to use POST.
- `DELETE /mcp` returns `405 Method Not Allowed` because there are no MCP sessions to terminate.
- `OPTIONS /mcp` returns `204 No Content` for polite preflight/probing support.

That shape is deliberate for AI harnesses. It matches the MCP spec's expectations for a stateless HTTP server without taking on unused session or SSE complexity.

### Origin and auth policy

- The endpoint accepts requests with **no** `Origin` header, which is the normal case for agent clients.
- If an `Origin` header is present, the upstream Convex handler accepts only the request origin itself or explicit values from `MCP_ALLOWED_ORIGINS` and rejects everything else with `403`.
- Every non-OPTIONS request must include `Authorization: Bearer <celstate_api_key>`.

### Auth

Bearer token auth backed by user-generated Celstate API keys stored in Convex.

**Bearer header semantics (MCP only):** the MCP handler accepts a standard `Authorization: Bearer <key>` header and parses the prefix **case-insensitively** (`bearer` / `Bearer`). A missing or malformed header yields **401** before any MCP JSON-RPC handling. This is **not** the same helper as `/verification/*` routes in `src/convex/http.ts`, which use a **case-sensitive** `Bearer ` check and feed runner-secret verification; that divergence is **intentional** (see [`docs/conventions/convex.md`](../conventions/convex.md)).

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

Registration order in the hosted server (and therefore in MCP **`tools/list`**) is fixed:

1. `celstate_check_credits`
2. `celstate_generate`
3. `celstate_get_image`
4. `celstate_list_images`

| Tool                     | Annotations              | Purpose                                              |
| ------------------------ | ------------------------ | ---------------------------------------------------- |
| `celstate_check_credits` | read-only, idempotent    | Check remaining credits                               |
| `celstate_generate`      | destructive, open-world, non-idempotent | Generate a transparent-background image from a prompt |
| `celstate_get_image`     | read-only, idempotent    | Get status/download URL for a generation              |
| `celstate_list_images`   | read-only, idempotent    | List recent generations (paginated, max 10)           |

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

**Regression tests:** `src/convex/mcp/http.test.ts` exercises CORS rejection, `initialize`, durable key `lastUsedAt`, deliberate `405` on standalone `GET`, and a **`tools/list` smoke check** after `initialize` so the exposed tool **names** stay aligned with registration order above.

Relevant files:

```text
src/routes/mcp/+server.ts
src/lib/server/mcp-proxy.ts
src/convex/http.ts
src/convex/mcp/handler.ts
src/convex/mcp/keys.ts
src/convex/mcp/tools/*.ts
src/convex/generations.ts
src/convex/mcp/http.test.ts
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

Set `MCP_UPSTREAM_URL` to the app-domain Celstate MCP URL before starting the proxy.

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
claude mcp add --transport http celstate https://celstate.com/mcp \
  --header "Authorization: Bearer <your_api_key>"
```

### Manual JSON config

```json
{
  "mcpServers": {
    "celstate": {
      "type": "http",
      "url": "https://celstate.com/mcp",
      "headers": {
        "Authorization": "Bearer <your_api_key>"
      }
    }
  }
}
```

## Deployment

The production path is the app-domain endpoint:

```text
https://celstate.com/mcp
```

The app route proxies to the hosted Convex endpoint internally.

If you need a local hop for enterprise networking, start the optional proxy package with:

```bash
MCP_UPSTREAM_URL=https://celstate.com/mcp pnpm --dir packages/mcp-server dev
```
