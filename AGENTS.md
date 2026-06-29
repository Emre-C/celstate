## Important Guidelines
- The current year is 2026. Technology has rapidly evolved past your training data cutoff. 
- If you are working with a dependency library or framework, **you must use your web search tools** to retrieve the latest version's stable documentation. Assume your knowledge of schemas, APIs, best practices, or conventions is outdated.
- In today's reality, there is either a Model Context Protocol (MCP) server or Command Line Interface (CLI) to give you any tool you need to succeed. For example, Playwright CLI gives you "vision" to test UI, and Sentry MCP gives you full access to observability. If a hypothetical tool would help you increase your odds of success for a complex task, you don't need to know what the tool is, just describe what you need and the user will provide it to you.
- DO NOT use npm, use pnpm instead.


## Task Routing

- Secrets, env, Doppler → `docs/runbooks/SECRETS-MANAGEMENT.md`
- Deploying (Convex/Vercel) → `docs/runbooks/VERCEL-DEPLOYMENT.md`, `docs/runbooks/CONVEX-VERCEL-ENVIRONMENTS.md`
- CI, canaries, production verification → `docs/runbooks/CI-AND-CANARIES.md`
- Ops/incident investigation → `docs/runbooks/OPS-INVESTIGATION.md` — run `pnpm ops:investigate` first
- Convex schema/mutations → `docs/conventions/convex.md`
- Stripe/payments → `docs/runbooks/STRIPE-CONVEX-ENVIRONMENTS.md`
- Designing or modifying UI → `docs/product/design-system.md`
- Illustrated UI ornaments → `docs/product/illustrated-ui-ornament-vision.md`

**Hard guardrails (always apply):**
- **Never run `convex env list`** — it prints plaintext secrets. Use `pnpm secrets:diff` (names only).
- Doppler is the single source of truth for secrets. Never hardcode secrets in code or `.env`.
- Convex mutations must be idempotent (no query-then-mutation TOCTOU). Index every field used in filters or indexed lookups.
- For a fast local gate: `pnpm check`, `pnpm typecheck:tsc`, `pnpm lint:ts`, `pnpm test`. Full gate: `pnpm verify`.

## Svelte 5 Rules
- Use `$state()`, `$derived()`, `onclick`, callback props, `{@render}` snippets, `$bindable()`. Never use `on:click`, `createEventDispatcher`, `<slot>`, or `let` for reactive state.
- Use `Promise.all` for parallel requests in load functions. Never set module-level state in SSR.

## Design Guardrails

**Brand:** Warm, confident, editorial. Studio tool, not tech demo.

**Hard constraints:**
- Light-mode only. Warm parchment cream (#F5F3ED), burnt terracotta (#C2410C), stone grays. Never pure white, pure black, or dark backgrounds.
- DM Sans for body, Instrument Serif italic for display headings. Never monospace. Never Inter.
- No glassmorphism, neon-on-dark, linear gradients, or sterile SaaS aesthetics.
- 60fps or it doesn't ship. Alive, not animated — never bouncy or elastic.

**Before creating or modifying any UI**, read `docs/product/design-system.md` (canonical tokens, components, prohibited patterns).
**For illustrated ornaments**, read `docs/product/illustrated-ui-ornament-vision.md` first.
