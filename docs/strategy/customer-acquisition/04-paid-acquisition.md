# Paid Acquisition Strategy

## Objective

Use paid acquisition as a disciplined learning and scaling channel only after Celstate has the
minimum funnel readiness needed to convert and attribute paid traffic intelligently.

## Strategic Thesis

Paid acquisition is not Celstate's first growth lever. It is a later-stage accelerator once the team
can do three things reliably:

- convert intent into activation,
- attribute outcomes to channel and landing subject,
- decide quickly which experiments deserve more spend.

Until then, paid should be treated as a constrained experiment budget, not as a traffic-growth
program.

## Why Paid Is Not First

Celstate currently has a strong marketing narrative and useful analytics foundations, but its
marketing-to-app handoff is not yet mature enough to justify broad paid scaling.

The app route currently focuses on Stripe return state in
[src/routes/(app)/app/+page.svelte](file:///C:/Users/emrec/codebase/active-projects/celstate/src/routes/%28app%29/app/%2Bpage.svelte#L30-L44), and the prompt field does not yet provide a first-class seeded entry experience in
[src/lib/components/PromptInput.svelte](file:///C:/Users/emrec/codebase/active-projects/celstate/src/lib/components/PromptInput.svelte#L24-L29).

That means Celstate risks paying for clicks before it has the best possible way to capture the value
of those clicks.

## Funnel Prerequisites

Do not expand paid testing until these conditions are met.

### Required

- landing pages for key subject clusters exist
- the app supports seeded prompt handoff from paid landers
- subject- and source-level attribution is wired through signup and first generation
- basic activation and purchase funnel reporting is live

### Strongly Preferred

- at least one SEO or earned channel landing flow has already shown credible activation
- the team has evidence that one or more subjects create first purchases

## Channel Priorities

## 1. High-Intent Paid Search

This is the best paid channel to test first because the product solves a narrow, explicit problem.

Start with query classes that imply tool intent, such as:

- transparent png generator
- transparent logo generator
- transparent icon generator
- transparent sticker generator
- transparent mascot generator

Do not begin with broad AI art terms. Those will attract high-click, low-fit traffic.

## 2. Retargeting

Retargeting should likely launch before cold paid social.

Retarget:

- visitors who reached subject pages
- visitors who clicked into the app but did not sign up
- signed-up users who did not complete a generation
- activated users who reached low-credit states but did not purchase

Retargeting message examples:

- "Your transparent logo workflow, without cleanup."
- "Generate the transparent sticker set you already started."
- "Try the prompt you were about to generate."

## 3. Narrow Paid Social Tests

Only test cold paid social after Celstate has:

- a strong proof-led creative system
- high-quality subject-specific landing pages
- reliable activation measurement

Cold paid social should be framed as creative and audience discovery, not as a scaling engine on day
one.

## Landing-Page Requirements For Paid Traffic

Paid traffic should not land on the generic homepage by default.

Each paid campaign should have a matching landing destination with:

- tight message match to the ad
- one primary subject or job to be done
- real proof assets
- seeded app CTA
- minimal distraction

Examples:

- logo ads -> transparent logo landing page
- sticker ads -> transparent sticker landing page
- product ads -> transparent product landing page

## Budget Discipline

Paid should run with stage-gated budget rules.

### Stage 1: Validation Budget

Purpose:

- learn which keyword clusters and subject pages produce activated users

Budget behavior:

- low daily caps
- few campaigns
- no broad expansion

### Stage 2: Efficiency Budget

Purpose:

- improve CPA to activated user and CPA to first purchase

Budget behavior:

- keep budgets capped by performance thresholds
- scale only winning clusters

### Stage 3: Growth Budget

Purpose:

- expand only after Celstate has evidence of repeatable economics and segment fit

Budget behavior:

- expand within winning subjects and audiences first
- avoid opening too many new campaigns simultaneously

## Experiment Design

Every paid test should isolate one of these variables:

- subject cluster
- ad message
- proof asset style
- landing-page CTA framing
- seeded prompt framing

Do not change all of them at once. Paid is expensive confusion when experiment design is sloppy.

## Recommended Early Tests

## Test 1: Search By Subject

Create separate ad groups for:

- logo
- icon
- sticker
- product

Success question:

- Which subject produces the best ratio of click -> signup -> first generation?

## Test 2: Native Transparency Positioning

Compare messaging angles:

- "Generate transparent PNGs from text"
- "No background removal needed"
- "Real alpha channel from the start"

Success question:

- Which angle earns the best click quality, not just CTR?

## Test 3: Retargeting To Incomplete Activation

Target visitors or signups who never completed a first generation.

Success question:

- Can Celstate recover users who showed intent but stalled before the aha moment?

## Kill / Scale Criteria

The exact thresholds will evolve, but the rule framework should be explicit from day one.

### Kill When

- message match is weak and bounce is high
- signup rate is too low to justify more spend
- activation rate stays poor even after landing-page fixes
- no subject cluster shows credible first-purchase behavior
- the team cannot explain where the funnel is breaking

### Scale When

- one or more subject clusters consistently create activated users
- a landing page has clear message match and strong CTA performance
- subject-aware attribution is reliable
- retargeting shows efficient recovery behavior
- the team has at least one repeatable paid narrative that matches the product truth

## Metrics

Primary:

- CPA to signup
- CPA to first completed generation
- CPA to first purchase
- activation rate from paid traffic

Secondary:

- CTR by keyword cluster or audience
- landing-page conversion rate
- seeded-prompt usage rate by campaign
- assisted conversions from retargeting

## Risks

### Paying Before Learning

The biggest risk is spending money to discover problems the product funnel could have exposed for
free through SEO and earned traffic.

### Broad Keywords

Broad AI creative terms may look attractive on impression volume but can easily generate low-fit,
high-cost traffic.

### Weak Attribution

If source, subject, and prompt-seed data do not survive into activation and purchase events, paid
optimization becomes guesswork.

## Immediate Deliverables

1. Finish subject-aware app handoff and attribution plumbing.
2. Build campaign-specific landing pages for a small subject set.
3. Start with tightly scoped paid search and retargeting, not broad paid social.
4. Set explicit kill and scale rules before launching campaigns.
5. Review paid experiments against activation and first-purchase outcomes, not just top-of-funnel clicks.
