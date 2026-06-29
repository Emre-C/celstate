# Convex conventions

These rules prevent classes of bugs that static analysis cannot catch (for example
time-of-check-time-of-use races and full-table scans). They apply to all Convex
code in this repository.

## Idempotency and uniqueness

**Rule:** All idempotency and uniqueness checks MUST run inside the same
`mutation` (or `internalMutation`) that performs the write. Do not use a
separate `query` to “check first” and then call a mutation to insert or update.

Reading in one Convex function and writing in another creates a TOCTOU gap:
another client can insert between the read and the write.

**Bad:**

```ts
const existing = await ctx.runQuery(api.creditGrants.getByPaymentIntent, { id });
if (existing) return;
await ctx.runMutation(api.creditGrants.create, { id, credits });
```

**Good:**

```ts
export const createCreditGrant = mutation({
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("creditGrants")
      .withIndex("by_stripePaymentIntentId", (q) =>
        q.eq("stripePaymentIntentId", args.id)
      )
      .unique();
    if (existing) return existing._id;
    return await ctx.db.insert("creditGrants", { /* ... */ });
  },
});
```

## Indexes for filters

**Rule:** Every field used in `.filter()` or in `.eq()` / `.withIndex()` chain
arguments MUST have a matching index in `schema.ts` (or equivalent). Avoid
unbounded table scans in production paths.

When adding a new query or filter, add or extend an index first, then write
the query against that index.

## HTTP authentication boundaries (verification vs MCP)

**Rule:** Do not unify Bearer parsing between **`/verification/*` routes** and **`/mcp`** without an explicit product/API decision. Today they are intentionally different:

- **`src/convex/http.ts`** — Runner and canary routes use an inline `parseBearer(request)` that requires a canonical `Bearer ` prefix (case-sensitive) and yields an **empty string** when missing. That flows into verification-specific auth and error classification (`jsonRouteHandler` / `Unauthorized`).
- **`src/convex/mcp/handler.ts`** — `parseBearerToken` matches `Bearer` **case-insensitively** and returns **`null`** when the header is missing or malformed, so MCP returns **401** at the HTTP layer before MCP protocol handling.

MCP product semantics and client expectations: [`docs/features/mcp-server.yaml`](../features/mcp-server.yaml). Operational context: [`docs/runbooks/CODEBASE-HYGIENE.md`](../runbooks/CODEBASE-HYGIENE.md).

## References

- Related safeguards: `docs/features/credits-and-payments.yaml`
- Agent guidance: `AGENTS.md`
- Code hygiene and audits: `docs/runbooks/CODEBASE-HYGIENE.md`
