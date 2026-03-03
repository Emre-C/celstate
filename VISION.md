# Celstate — Vision & Technical Blueprint

## What We're Building

Celstate is a focused, opinionated tool for people who need images with transparent backgrounds — and don't want to learn APIs, wrangle Photoshop, or sift through generic AI output to get them.

Our users are creators, small business owners, marketers, and makers. They type what they want, we generate it with a transparent background, and they download a production-ready PNG. No accounts with 47 tabs. No prompt engineering. No background-removal step after the fact.

We wrap a best-in-class text-to-image model API behind an interface so clean and fast that the technology disappears.

## The Problem

Every existing image generation tool produces images on opaque backgrounds. Users who need transparency (logos, product shots, stickers, icons, UI assets) are forced into a multi-step workflow: generate → download → upload to background remover → hope the edges aren't butchered → download again. The results are inconsistent, the edges are often degraded, and the process is tedious.

Celstate generates transparent-background images natively in a single step, with quality that makes the difference obvious at a glance.

## Core User Flow

```
Landing Page → Sign Up / Sign In → Generate → Review → Download
```

### 1. Landing Page

The first thing a visitor sees is proof. Side-by-side comparisons: images generated through typical services (opaque background, removed after the fact with visible artifacts) vs. Celstate output (clean, native transparency). No marketing fluff. The quality difference sells itself.

- Hero with a single compelling example (before/after)
- Gallery of comparison pairs across use cases (logos, product shots, stickers, icons)
- Clear CTA to sign up
- Credit pricing — simple, transparent, no subscriptions

### 2. Authentication

Users authenticate to access the generation tool and manage their credits.

- Email/password and OAuth (Google at minimum)
- Powered by Convex Auth (built-in, first-party — no third-party auth libraries)
- Session management handled server-side

### 3. Image Generation

The core experience. A single text input. Nothing else competing for attention.

- User types a description of what they want
- Hits generate (or Enter)
- A processing indicator communicates that work is happening — not a generic spinner, something that feels alive and intentional
- The generated image appears on a checkerboard transparency preview (so they can actually see the transparency)
- Download button gives them a production-ready PNG with alpha channel

### 4. Credit System

Users purchase credits to generate images. No subscriptions, no tiers, no "pro plans."

- Credits are purchased in $10 increments
- Each generation consumes a defined number of credits (exact cost depends on the upstream API pricing, will be determined during integration)
- Credit balance is always visible in the UI
- Purchase flow via Stripe (direct integration, no wrappers)
- Credits do not expire

### 5. Image History & Retention

Every generated image is stored and accessible to the user for a minimum retention period.

- Users can view their generation history (prompt + result)
- Images are stored for a minimum of 30 days
- Users can re-download any image within the retention window
- After retention expires, images are purged (with advance notice in the UI)

### 6. Admin Considerations (Internal)

- Usage analytics: generations per day, credit purchases, active users
- Ability to monitor API costs vs. revenue
- User management basics (view users, disable accounts if needed)

## Tech Stack

### Frontend
- **Svelte 5** with **SvelteKit** — file-based routing, SSR/SSG where appropriate, runes for reactivity
- **TypeScript** throughout — strict mode, no `any`, interfaces over types
- **Tailwind CSS v4** — utility-first styling

### UI Components
- We will evaluate whether shadcn-svelte can be used as a *foundation* that we aggressively re-skin to establish a distinct visual identity. If we cannot make it look unmistakably ours — not another purple-hued, rounded-corner, indistinguishable-from-every-other-AI-tool interface — we build our own component primitives on top of bits-ui for accessibility. The bar is: if a user has seen any other AI SaaS tool, our interface should feel nothing like it.

### Backend
- **Convex** — real-time database, serverless functions, file storage, scheduled functions
- **Convex Auth** — the recently released built-in authentication system (not Better Auth, not Auth.js, not any third-party auth wrapper)

### Payments
- **Stripe** — direct integration for credit purchases. No billing wrappers (no Autumn, no Lemon Squeezy abstractions). We own the integration.

### Image Generation
- External text-to-image API (specific provider TBD — will be selected based on native transparency support, quality benchmarks, and cost per generation)
- Images stored in Convex file storage during retention period

### Deployment
- **Cloudflare Pages** (or Vercel) for the frontend
- Convex cloud for the backend

### Quality Standards

This section is not aspirational. It is the minimum bar.

- **No `any` types.** Every function, every parameter, every return value is typed.
- **No eslint-disable comments** in application code. If the linter complains, fix the code.
- **Server-side auth guards.** Protected routes are protected on the server. Client-side checks are supplementary, never primary.
- **Mutations are mutations, queries are queries.** Read-only operations are queries. State-changing operations are mutations. No exceptions.
- **No dead code, no placeholder links, no lorem ipsum in committed code.**
- **Tests exist and are meaningful.** Not "h1 is visible." Tests cover auth flows, credit operations, and generation lifecycle.
- **Every component earns its place.** If it's not used, it doesn't exist in the codebase. No component libraries "just in case."
- **Error handling is intentional.** Errors are surfaced to users with clear messaging. Console.error is not a UX strategy.
- **Accessibility is not optional.** Semantic HTML, ARIA where needed, keyboard navigation, sufficient contrast.

## Visual Identity Principles

- **No default shadcn aesthetic.** No soft purples, no generic rounded cards, no "every AI startup looks like this" energy.
- **Confidence over cleverness.** Bold, clear, high-contrast. The interface should feel like a precision tool, not a toy.
- **Transparency is the brand.** The checkerboard pattern, the concept of "nothing hidden" — this should echo through the visual language.
- **Motion with purpose.** The processing indicator, transitions between states — these should feel crafted, not dropped in from a library.
- **Dense where it matters, spacious where it doesn't.** The generation interface is focused and minimal. The history view is scannable and efficient.

## What Success Looks Like

A user lands on the page, immediately understands the value proposition from the visual proof, signs up in under 30 seconds, buys $10 in credits, generates their first transparent-background image in under a minute, downloads it, and uses it. The entire experience feels fast, intentional, and unlike anything else they've used.

## Svelte 5 Best Practices

---
name: svelte5-best-practices
description: "Svelte 5 runes, snippets, SvelteKit patterns, and modern best practices for TypeScript and component development. Use when writing, reviewing, or refactoring Svelte 5 components and SvelteKit applications. Triggers on: Svelte components, runes ($state, $derived, $effect, $props, $bindable, $inspect), snippets ({#snippet}, {@render}), event handling, SvelteKit data loading, form actions, Svelte 4 to Svelte 5 migration, store to rune migration, slots to snippets migration, TypeScript props typing, generic components, SSR state isolation, performance optimization, or component testing."
license: MIT
metadata:
  author: ejirocodes
  version: '1.0.0'
---

# Svelte 5 Essential Patterns

### Reactive State

```svelte
<script>
  let count = $state(0);           // Reactive state
  let doubled = $derived(count * 2); // Computed value
</script>
```

### Component Props

```svelte
<script>
  let { name, count = 0 } = $props();
  let { value = $bindable() } = $props(); // Two-way binding
</script>
```

### Snippets (replacing slots)

```svelte
<script>
  let { children, header } = $props();
</script>

{@render header?.()}
{@render children()}
```

### Event Handlers

```svelte
<!-- Svelte 5: use onclick, not on:click -->
<button onclick={() => count++}>Click</button>
```

### Callback Props (replacing createEventDispatcher)

```svelte
<script>
  let { onclick } = $props();
</script>

<button onclick={() => onclick?.({ data })}>Click</button>
```

### Common Mistakes

1. **Using `let` without `$state`** - Variables are not reactive without `$state()`
2. **Using `$effect` for derived values** - Use `$derived` instead
3. **Using `on:click` syntax** - Use `onclick` in Svelte 5
4. **Using `createEventDispatcher`** - Use callback props instead
5. **Using `<slot>`** - Use snippets with `{@render}`
6. **Forgetting `$bindable()`** - Required for `bind:` to work
7. **Setting module-level state in SSR** - Causes cross-request leaks
8. **Sequential awaits in load functions** - Use `Promise.all` for parallel requests
