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

## Common Svelte 5 Mistakes
1. Using `let` without `$state` - Variables are not reactive without `$state()`
2. Using `$effect` for derived values - Use `$derived` instead
3. Using `on:click` syntax - Use `onclick` in Svelte 5
4. Using `createEventDispatcher` - Use callback props instead
5. Using `<slot>` - Use snippets with `{@render}`
6. Forgetting `$bindable()` - Required for `bind:` to work
7. Setting module-level state in SSR - Causes cross-request leaks
8. Sequential awaits in load functions - Use `Promise.all` for parallel requests