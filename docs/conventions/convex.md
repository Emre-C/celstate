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

## References

- Preventive tooling: `docs/implementation/hardening.md`
- Agent guidance: `AGENTS.md`
