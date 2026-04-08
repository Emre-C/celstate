# Customer Acquisition Strategy

This folder contains Celstate's current customer-acquisition strategy: **five vertical workstreams**
plus **synthesis**, **gap-register**, and **AI-native overlay** memos. Each vertical focuses on one major workstream that can
drive qualified traffic, improve activation, or convert that traffic into paying customers.

## Context

Celstate does not yet have real customer volume or a validated ideal customer profile. That changes
how strategy should be written and executed:

- We should avoid pretending we already know the winning segment.
- We should make a small number of strong bets that fit the product truth.
- We should instrument those bets so the first real customer signals teach us where to double down.

The product truth that anchors every memo is simple: Celstate generates images with a real
transparent background from the start. It is not a background-removal tool.

## Vertical Docs

- [01-programmatic-seo.md](./01-programmatic-seo.md) — hub-and-spoke SEO strategy for subject-specific generator pages.
- [02-product-led-conversion-and-onboarding.md](./02-product-led-conversion-and-onboarding.md) — homepage, signup, first-generation, and credit-pack conversion strategy.
- [03-content-distribution-and-earned-channels.md](./03-content-distribution-and-earned-channels.md) — social, communities, proof assets, and reusable content loops.
- [04-paid-acquisition.md](./04-paid-acquisition.md) — paid search, retargeting, budget discipline, and kill/scale rules.
- [05-audience-discovery-positioning-and-measurement.md](./05-audience-discovery-positioning-and-measurement.md) — segment discovery, positioning refinement, and the measurement layer that guides all other bets.
- [06-strategy-synthesis-gaps-and-operating-model.md](./06-strategy-synthesis-gaps-and-operating-model.md) — full strategy synthesis, comprehensive gap register, cold-start playbook, and metric phases for the zero-to-low-customer stage.
- [07-ai-native-discovery-and-agent-leverage.md](./07-ai-native-discovery-and-agent-leverage.md) — assistant/generative discovery, MCP as agent distribution, AI-accelerated artifacts with QA, and governance for AI-assisted social (read alongside 01–06).

## Recommended Order

These verticals should not all be executed with equal urgency.

1. Audience discovery, positioning, and measurement.
2. Product-led conversion and onboarding.
3. Programmatic SEO.
4. Content distribution and earned channels.
5. Paid acquisition.

## Why This Order

### 1. Measurement before scale

If Celstate cannot tell which subjects, prompts, pages, and channels create activated users and
first purchases, every acquisition motion becomes guesswork. The measurement memo defines the
minimum viable learning system.

### 2. Conversion before amplification

Traffic only matters if users reach the product, understand what to do, generate a successful
image quickly, and see a credible path to paying. That is why onboarding and conversion work comes
before aggressive SEO or paid spend.

### 3. SEO as the main near-term acquisition engine

Celstate has a crisp product promise and server-rendered marketing pages. That makes
subject-specific SEO pages the strongest near-term organic growth bet, provided they are high
quality and tightly connected to the product experience.

### 4. Content as proof distribution, not filler

The most useful content for Celstate is proof-driven content: examples, edge-quality breakdowns,
prompt packs, and workflow demonstrations. Content should amplify product truth, not become a
generic brand-awareness program.

### 5. Paid after the funnel is ready

Paid acquisition should be gated until Celstate has cleaner landing-page handoff, stronger
activation rates, and reliable attribution. Otherwise the team will buy clicks before it knows what
good traffic looks like.

## Current Repo Implications

The current codebase already provides strong raw materials for this strategy:

- The homepage has SSR metadata, canonical tags, and JSON-LD in [src/routes/(marketing)/+page.svelte](file:///C:/Users/emrec/codebase/active-projects/celstate/src/routes/%28marketing%29/%2Bpage.svelte#L16-L107).
- Growth events already exist in [src/lib/analytics/growth-events.ts](file:///C:/Users/emrec/codebase/active-projects/celstate/src/lib/analytics/growth-events.ts#L1-L17).
- The growth analysis loop is already documented in [docs/runbooks/GROWTH-OPERATIONS.md](file:///C:/Users/emrec/codebase/active-projects/celstate/docs/runbooks/GROWTH-OPERATIONS.md#L18-L59).

There are also important gaps that show up across multiple memos:

- There is no sitemap implementation in the repo today.
- The app route mainly reads query params for Stripe return state in [src/routes/(app)/app/+page.svelte](file:///C:/Users/emrec/codebase/active-projects/celstate/src/routes/%28app%29/app/%2Bpage.svelte#L30-L44), not for marketing-to-product handoff.
- The prompt field is locally owned in [src/lib/components/PromptInput.svelte](file:///C:/Users/emrec/codebase/active-projects/celstate/src/lib/components/PromptInput.svelte#L12-L29), so seeded landing-page prompts are not yet a first-class experience.

## Success Definition

This strategy is working when Celstate can answer these questions with real data instead of
intuition:

- Which subjects drive the highest-quality organic traffic?
- Which landing pages create the highest signup and first-generation rates?
- Which user segments care enough about native transparency to pay for it?
- Which earned channels produce reusable traffic loops?
- Which paid campaigns deserve more capital, and which should be shut off quickly?

Until those answers exist, the goal is not scale. The goal is learning fast without creating SEO,
paid, or product debt.
