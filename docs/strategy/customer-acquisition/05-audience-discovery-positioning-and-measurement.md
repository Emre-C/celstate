# Audience Discovery, Positioning, And Measurement Strategy

## Objective

Identify which customer segments value Celstate enough to adopt it and pay for it, while building a
measurement system that lets the team update positioning and channel priorities based on real usage.

This vertical exists because Celstate does not yet have enough customers to infer its best market
from revenue history alone.

## Strategic Thesis

Celstate should not try to lock in a single ICP too early. It should instead run a structured
discovery process around a stable product truth.

That stable truth is:

- Celstate generates images with a real transparent background from the start.
- It is most valuable when edge quality, alpha fidelity, and workflow speed matter.

Everything else should be treated as a hypothesis until real users prove otherwise.

## Role Of This Vertical

This memo is the foundation for the other four verticals.

It informs:

- which SEO spokes get built first
- which onboarding flows receive subject-specific guidance
- which content loops deserve more production effort
- whether paid acquisition is pointed at the right queries and audiences

## Candidate Segments To Evaluate First

These are not final personas. They are testable segment hypotheses.

## 1. Designers And Brand Builders

Likely use cases:

- logos
- icons
- mascots
- concept directions for client work

What they care about:

- crisp edges
- brand-ready export utility
- speed while exploring options

## 2. Ecommerce Sellers And Marketers

Likely use cases:

- transparent product assets
- merchandising graphics
- promo assets for storefronts and marketplaces

What they care about:

- clean cutouts
- reduced cleanup effort
- fast iteration for ads and listings

## 3. Game Developers And UI Asset Creators

Likely use cases:

- sprites
- item icons
- character cutouts
- interface assets

What they care about:

- silhouette clarity
- small-size readability
- export-ready transparent assets

## 4. Creators And Streamers

Likely use cases:

- stickers
- overlays
- thumbnails with transparent elements
- channel art components

What they care about:

- speed
- pack-style asset generation
- easy reuse across content

## 5. Print-On-Demand And Merch Sellers

Likely use cases:

- sticker designs
- transparent merch graphics
- packs of simple visual assets

What they care about:

- ready-to-upload transparent output
- iteration speed on design variants

## Positioning Framework

Celstate should keep one master positioning statement and test segment-specific translations of it.

### Master Positioning

Celstate is the AI generator for assets that need to be transparent from the start.

### Supporting Claims

- real alpha channel output
- no post-generation cleanup workflow
- better edge fidelity than removal-based workflows
- useful for production assets, not only inspiration images

### Segment Translation Examples

- for designers: "transparent brand assets without cleanup"
- for ecommerce: "transparent product graphics ready for storefront use"
- for game dev: "transparent UI and sprite assets generated from text"

## Measurement System

Celstate already has meaningful growth instrumentation foundations:

- growth events in [src/lib/analytics/growth-events.ts](file:///C:/Users/emrec/codebase/active-projects/celstate/src/lib/analytics/growth-events.ts#L1-L17)
- a growth-analysis workflow in [docs/runbooks/GROWTH-OPERATIONS.md](file:///C:/Users/emrec/codebase/active-projects/celstate/docs/runbooks/GROWTH-OPERATIONS.md#L18-L59)
- client and server analytics plumbing described in [docs/product/observability.md](file:///C:/Users/emrec/codebase/active-projects/celstate/docs/product/observability.md)

The next step is to make those events more segment-aware.

## Required Attribution Dimensions

Every major acquisition and activation event should be enrichable with:

- source channel
- landing page slug
- subject category
- seeded prompt id or prompt type
- aspect ratio if relevant
- whether the prompt was edited before submission

That turns raw funnel events into actual market insight.

## Qualitative Research Loops

Do not rely only on analytics. Add lightweight research loops.

Recommended loops:

- short post-signup question about intended use case
- short post-generation question once the user has seen value
- optional interview request for users who complete multiple generations
- review of early support or feedback themes if they appear

The goal is not to build a large survey program. The goal is to learn which problems users believe
Celstate solves for them.

## Product Signals To Watch Closely

These signals matter more than page views alone:

- which subject pages drive completed first generations
- which seeded prompts are used without major edits
- which users generate again in the same session
- which segment-like behaviors correlate with first purchase
- which segments react to credit depletion as an annoyance versus a reason to buy

## Decision Framework

Use a simple three-part lens for every segment hypothesis.

### 1. Intent Fit

Does the segment naturally search for, click on, or respond to transparent-background workflows?

### 2. Activation Fit

Can the segment get value quickly from the current Celstate product?

### 3. Monetization Fit

Does the segment have an obvious reason to buy more generations?

The best segment is not the one with the biggest traffic volume. It is the one with the strongest
combination of all three.

## How This Guides Other Verticals

### Programmatic SEO

Winning segments tell the team which spoke pages deserve expansion.

### Onboarding

Winning segments tell the team which seeded prompts, guidance, and first-run flows deserve more
customization.

### Content Distribution

Winning segments tell the team which proof assets and communities matter.

### Paid Acquisition

Winning segments tell the team which keywords and audiences deserve test budget.

## Risks

### Premature Certainty

The team may be tempted to over-commit to one segment based on anecdotal enthusiasm. Avoid that.

### Too Many Segment Labels

If every event has a dozen vague audience labels, the measurement layer becomes noisy. Keep the first
segment model simple.

### Traffic-Led Misinterpretation

A segment that brings clicks but not activation or purchase should not become the main focus just
because it is easier to attract.

## Immediate Deliverables

1. Define the first segment-hypothesis set and map it to subject pages.
2. Add source-, subject-, and prompt-aware attribution to acquisition and activation events.
3. Add one or two lightweight qualitative research prompts inside the product.
4. Review weekly data for intent fit, activation fit, and monetization fit by segment.
5. Use those findings to reprioritize SEO spokes, onboarding flows, content loops, and paid tests.
