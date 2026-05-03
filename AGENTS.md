## Important Guidelines
- The current year is 2026. Technology has rapidly evolved past your training data cutoff. 
- The AI LLM powering you is super-intelligent and capable of elite software engineering. 
- Code generation is no longer the bottleneck. Do not make trade-offs based on perceived complexity or time constraints.
- If you are working with a dependency library or framework, **you must use your web search tools** to retrieve the latest version's stable documentation. Assume your knowledge of schemas, APIs, best practices, or conventions is outdated.
- You are prone to overconfidence and diving down rabbit holes when you do not actually know the implementation details. If your confidence in a proposed solution is Medium or Low, **STOP**. Do not write code. Ask for help, state your knowledge gap, and explicitly outline the path required to move from low confidence to high confidence. Only execute when you possess verifiable High confidence.
- In today's reality, there is either a Model Context Protocol (MCP) server or Command Line Interface (CLI) to give you any tool you need to succeed. For example, Playwright CLI gives you "vision" to test UI, and Sentry MCP gives you full access to observability. If a hypothetical tool would help you increase your odds of success for a complex task, you don't need to know what the tool is, just describe what you need and the user will provide it to you.
- Prioritize referential transparency, data-oriented design, and strict type safety.
- Produce code with minimal cyclomatic complexity and clear separation of concerns.
- Treat every interface and function signature as a strict mathematical contract.
- DO NOT use npm, use pnpm instead.
- **Secrets management**: Doppler is the single source of truth (project `celstate`, configs `dev`/`stg`/`prd`). Edit secrets in Doppler and run `pnpm secrets:sync:convex` (or `:vercel` / `:gh`) to propagate. **Never run `convex env list` (any flag)** — it prints plaintext values and that exact command leaked the entire prod env in 2026-04. Use `pnpm secrets:diff` for safe inspection (names only). Rotation scripts: `pnpm secrets:rotate`, `pnpm secrets:rotate-gcp`. Full details in `docs/runbooks/SECRETS-MANAGEMENT.md`; click-paths for vendor-only rotations (Stripe, Google OAuth, Discord) in `docs/runbooks/MANUAL-SECRET-ROTATION-GUIDE.md`.
- **Convex + Stripe**: Live keys only on prod; live Stripe keys live in Doppler `prd` and reach Convex via sync — `docs/runbooks/STRIPE-CONVEX-ENVIRONMENTS.md`.
- **Convex**: Follow `docs/conventions/convex.md` — idempotency inside mutations (no query-then-mutation TOCTOU), and index every field used in filters or indexed lookups.
- **CI / verify:** For a **fast local gate**, use `pnpm check`, `pnpm typecheck:tsc`, `pnpm lint:ts`, and `pnpm test`. `pnpm verify` runs the **full** gate including Knip, jscpd, `pnpm build`, and `pnpm test:e2e` (Playwright Chromium against `vite preview`). Knip caveats and audit commands: `docs/runbooks/CODEBASE-HYGIENE.md`. CI uses `PUBLIC_SITE_URL=http://127.0.0.1:4174` so canonical redirects align with the preview origin—see `docs/runbooks/PUBLIC-ENV-CHECKLIST.md`. Production **deploy** confidence (live probes: auth with protected-route proof, generation, checkout, scheduled settlement) is separate—`docs/runbooks/CI-AND-CANARIES.md`, `docs/product/production-confidence.md`.

## Common Svelte 5 Mistakes
1. Using `let` without `$state` - Variables are not reactive without `$state()`
2. Using `$effect` for derived values - Use `$derived` instead
3. Using `on:click` syntax - Use `onclick` in Svelte 5
4. Using `createEventDispatcher` - Use callback props instead
5. Using `<slot>` - Use snippets with `{@render}`
6. Forgetting `$bindable()` - Required for `bind:` to work
7. Setting module-level state in SSR - Causes cross-request leaks
8. Sequential awaits in load functions - Use `Promise.all` for parallel requests

## Design Context

### Users
Professionals in focused productivity mode — they arrive with intent, not to browse. They need transparent-background images (logos, icons, characters, stickers) and want to describe what they need and get it fast. They have refined visual taste and will notice cheap design. The app should respect their time and reward their focus.

### Brand Personality
**Warm, confident, editorial.**

Celstate feels like a well-designed studio tool, not a tech demo. It has the quiet authority of a print magazine — every element is intentional, nothing is decorative filler. The warmth comes from the parchment palette and serif headings; the confidence comes from generous whitespace and restrained animation; the editorial quality comes from typography-first hierarchy and strict visual discipline.

### Aesthetic Direction
- **Visual tone**: Warm maximalism in craft, minimalism in chrome. The code can be rich and detailed — micro-interactions, thoughtful transitions, alive-feeling surfaces — but the visual result should feel curated, not busy.
- **Theme**: Light-mode only. Warm parchment cream (#F5F3ED), burnt terracotta accent (#C2410C), stone grays. Never pure white, never pure black, never dark backgrounds.
- **Typography**: DM Sans for body (warm humanist sans), Instrument Serif italic for display headings (editorial authority). Never monospace. Never Inter.
- **Anti-references**: No sterile modern SaaS (linear gradients, glassmorphism, neon-on-dark). No clinical AI lab aesthetic. No Discord-style chaos. No cheerful consumer Canva energy. No "every website looks the same" template feel.
- **Alive, not animated**: The app should feel responsive and present — elements that breathe, transitions that acknowledge user actions, surfaces that react. But never bouncy, never elastic, never gratuitous. Performance is the hard constraint; perceived aliveness is the goal.

### Design Principles
1. **Editorial over decorative** — Every visual choice must serve hierarchy or meaning. No gradients, glows, or effects for atmosphere alone.
2. **Warm over neutral** — Stone-tinted grays, cream backgrounds, terracotta accents. The palette has temperature. Cold grays and pure whites are rejected.
3. **Alive over static** — Micro-interactions, breathing animations, opacity transitions that make the interface feel present. But performance is sacred — 60fps or it doesn't ship.
4. **Confident over cautious** — Generous whitespace, decisive typography scale, clear visual hierarchy. The design doesn't hedge or cram.
5. **Craft over convention** — We have no code budget constraints. If a detail improves the experience, implement it. But the result should look effortless, not overwrought.

 **Design System**: All UI must conform to `docs/product/design-system.md` — color tokens, typography rules, button hierarchy, component inventory, and prohibited patterns. Read it before creating or modifying any frontend component.

### Documentation Hierarchy
1. **`docs/product/design-system.md`** — Canonical token/component reference. The single source of truth for color tokens, typography, button hierarchy, anti-patterns, and lessons learned. All UI must conform to this.
2. **`AGENTS.md` (this file)** — Brand personality, aesthetic direction, design principles. Guides *intent* and *tone*; does not override specific tokens or component specs.
3. **Feature design specs** (e.g., `docs/implementation/ASSISTED-MODE-FRONTEND-DESIGN.md`) — Feature-specific UI specs. May define purposeful overrides to the design system (e.g., `rounded-none` option buttons for editorial feel) but must explicitly note any deviation.
