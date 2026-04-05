# Celstate MCP Server

## Overview

A remote MCP server that lets AI assistants (Claude, ChatGPT, Cursor, etc.)
generate transparent-background images on behalf of authenticated users.

## Architecture

```
┌──────────────┐    Streamable HTTP     ┌─────────────────┐    Convex Client     ┌──────────┐
│  MCP Client  │ ──────────────────────▶│  MCP Server     │ ──────────────────▶  │  Convex  │
│  (Claude,    │    JSON-RPC 2.0        │  (Express +     │    queries/mutations │  Backend │
│   ChatGPT…)  │◀──────────────────────│   @mcp/sdk)     │◀──────────────────  │          │
└──────────────┘                        └─────────────────┘                      └──────────┘
```

### Transport

**Streamable HTTP (stateless, JSON response mode)** — the MCP server is deployed as a remote HTTP service.
Any MCP-compatible host connects via URL (e.g. `https://mcp.celstate.com/mcp`).
The implementation stays stateless on purpose: each request builds a fresh MCP server
and a fresh request-scoped Convex client, so auth and tool execution cannot leak across
concurrent users.

### Auth

Bearer token auth. Users generate an API key from Celstate settings.
The MCP server validates the token against Convex on each request before the SDK handles MCP traffic.

Future: OAuth 2.1 per the MCP spec for full third-party integration.

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
- `express` (HTTP server for Streamable HTTP transport)
- `zod` (parameter validation — required by MCP SDK)
- `convex` (request-scoped HTTP client + explicit typed function references via `makeFunctionReference`)

## Directory Structure

```
packages/mcp-server/
├── src/
│   ├── index.ts           # Server entry point
│   ├── constants.ts       # Shared MCP config/constants
│   ├── tools/
│   │   ├── generate.ts    # celstate_generate
│   │   ├── getImage.ts    # celstate_get_image
│   │   ├── listImages.ts  # celstate_list_images
│   │   └── credits.ts     # celstate_check_credits
│   ├── convex-api.ts      # Typed Convex function-reference contracts for MCP tools
│   ├── convex-client.ts   # Typed Convex wrappers (request-scoped)
│   ├── auth.ts            # Bearer auth + request context
│   └── tool-results.ts    # Shared tool response helpers
├── tsconfig.json
└── package.json
```

## Backend Query Shape

The MCP server depends on three public Convex reads/writes, all accessed through explicit typed function references:

- `generations:requestGeneration` — mutation used by `celstate_generate`
- `generations:getByUserAndIdWithUrls` — point lookup used by `celstate_get_image`
- `generations:listByUserWithUrls` — capped history query used by `celstate_list_images`
- `users:getMe` — auth + credit lookup

The dedicated point lookup and capped list query avoid the earlier anti-pattern of loading the user's
entire history just to poll one generation.

We intentionally avoid importing `src/convex/_generated/api.d.ts` inside `packages/mcp-server` because
its declaration graph pulls the entire Convex app into the package build, which is brittle in a monorepo.
The MCP package instead keeps a tiny, explicit contract for the four functions it calls while still using
first-class `FunctionReference` values at runtime.

## Deployment

Deployed as a standalone Node.js service (Vercel serverless or Railway).
Connected via `url` in MCP client configs:

```json
{
  "mcpServers": {
    "celstate": {
      "url": "https://mcp.celstate.com/mcp"
    }
  }
}
```
