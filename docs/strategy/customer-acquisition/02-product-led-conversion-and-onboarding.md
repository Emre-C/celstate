# Product-Led Conversion And Onboarding Strategy

## Objective

Maximize the percentage of qualified visitors who:

1. understand why Celstate is different,
2. sign up,
3. complete a first successful generation quickly,
4. reach a credible reason to buy a credit pack.

This vertical turns acquisition into customers. Without it, SEO, content, and paid channels mostly
buy curiosity instead of meaningful product use.

## Strategic Thesis

Celstate should optimize for the fastest path to a successful first transparent image.

The core experience should communicate this sequence clearly:

- You came for transparent output.
- Celstate generates native transparency.
- Here is the exact kind of prompt to start with.
- Here is your first result.
- Here is why paying for more generations makes sense.

## Core Funnel

The main acquisition-to-product funnel is:

- landing page view
- CTA click
- auth start
- signup complete
- first generation started
- first generation completed
- repeat generation or first purchase

The existing growth runbook already treats this as a top-level measurement problem in
[docs/runbooks/GROWTH-OPERATIONS.md](file:///C:/Users/emrec/codebase/active-projects/celstate/docs/runbooks/GROWTH-OPERATIONS.md#L54-L59).

## The Main Conversion Problem To Solve Now

Celstate's marketing story is sharp, but the handoff into the app is still too generic.

The current app route reads query params mainly for checkout return state in
[src/routes/(app)/app/+page.svelte](file:///C:/Users/emrec/codebase/active-projects/celstate/src/routes/%28app%29/app/%2Bpage.svelte#L30-L44). The prompt input itself owns its text locally in
[src/lib/components/PromptInput.svelte](file:///C:/Users/emrec/codebase/active-projects/celstate/src/lib/components/PromptInput.svelte#L24-L29).

That means a user can arrive from a subject-specific landing page with high intent and still land in
an almost blank state.

## Priority Workstreams

## 1. Marketing-To-App Handoff

Landing pages should not send users to a generic `/app` state. They should send them to a guided
generation state.

Recommended query parameters or route state:

- `subject`
- `prompt`
- `aspectRatio`
- `source`
- `cta`

Example:

- `/app?source=seo&subject=logo&prompt=minimal%20veterinary%20clinic%20logo%2C%20transparent%20background`

### Why This Matters

It reduces the cognitive gap between the query, the page, and the product action. That is one of
the highest-leverage changes in the entire acquisition stack.

## 2. First-Generation Activation

The first-run experience should be designed around a fast win.

That means:

- The initial prompt should already be useful.
- The subject should be obvious.
- The user should understand what a good prompt looks like.
- The user should know what to expect from the first output.

### Recommended Activation Aids

- seeded starter prompt from the landing page
- optional small prompt variations beneath the input
- empty-state examples tied to the subject
- one-line explanation that Celstate already outputs transparency, so no post-processing is needed

## 3. Signup Friction Review

Auth is already live with Google sign-in and protected app routes. That is fine for now, but the
team should still treat signup friction as an ongoing measurement problem.

Questions to answer:

- How many users click from landing page to app but never start auth?
- How many start auth but never complete signup?
- How many sign up and then fail to start a generation?

If there is meaningful drop-off between CTA click and signup completion, Celstate should simplify
the path rather than just trying to acquire more traffic.

## 4. Credit-Pack Conversion Surfaces

Celstate already has some conversion instrumentation and purchase surfaces, including zero-credit and
post-generation prompts in [src/lib/components/PromptInput.svelte](file:///C:/Users/emrec/codebase/active-projects/celstate/src/lib/components/PromptInput.svelte#L162-L176) and [src/routes/(app)/app/+page.svelte](file:///C:/Users/emrec/codebase/active-projects/celstate/src/routes/%28app%29/app/%2Bpage.svelte#L166-L197).

The strategy now is not to add more prompts everywhere. It is to make each prompt more contextually
correct.

Recommended conversion surfaces:

- after a successful first generation when credits are still healthy
- when the user reaches one credit remaining
- when the user attempts another generation at zero credits
- on the credits page with subject-aware framing

### Messaging Principle

The purchase message should be tied to continued output quality and workflow continuity, not to
artificial scarcity.

Good framing:

- "Keep generating production-ready transparent assets."
- "Create the next logo variation without resetting your workflow."

Weak framing:

- generic urgency
- generic "upgrade now" SaaS language

## 5. Subject-Aware Onboarding

Celstate does not yet know which segment will become the strongest customer base. The onboarding
system should help answer that question.

For each entry path, capture:

- landing subject
- seeded prompt subject
- whether the user edited the seeded prompt
- whether the first generation completed successfully
- whether the user tried another prompt immediately after

That lets the team learn which entry points produce real creative momentum.

## Recommended Experiments

## Experiment 1: Prompt Seeding vs Blank State

Hypothesis:

- Users arriving with a subject-specific seeded prompt will start and complete first generation at a
  meaningfully higher rate than users dropped into a blank state.

Success criteria:

- higher first-generation start rate
- higher first-generation completion rate
- lower time to first generation

## Experiment 2: Single CTA vs Dual CTA

Test whether the highest-intent pages convert better when the CTA is framed as:

- "Start generating"
- "Generate a transparent [subject]"

The second may better preserve user intent from the query.

## Experiment 3: First Success Banner

After the first successful generation, test a small banner that frames the next step around use,
not around spending.

Examples:

- "Try a second logo direction."
- "Generate a transparent dark-mode version."
- "Create a full sticker set from this style."

Only then surface the credit-pack message naturally.

## Metrics

Primary:

- landing-page CTA to signup rate
- signup to first-generation start rate
- signup to first-generation completion rate
- time to first generation
- first purchase rate by landing subject

Secondary:

- seeded-prompt usage rate
- seeded-prompt edit rate
- first-session generations per user
- credit CTA click-through by surface

The current growth events live in [src/lib/analytics/growth-events.ts](file:///C:/Users/emrec/codebase/active-projects/celstate/src/lib/analytics/growth-events.ts#L1-L17). This file should expand carefully as the team adds subject-aware attribution.

## Risks

### Blank-State Waste

If traffic reaches the app and stalls at the prompt box, Celstate will under-convert even with good
acquisition.

### Over-Instrumentation Without Decisions

Analytics only matter if they lead to experiments and shipping decisions. Avoid creating an event
catalog without a clear question behind each event.

### Aggressive Monetization Too Early

If the app pushes credit packs before the user has seen Celstate's value, purchase prompts will feel
premature and trust-eroding.

## Immediate Deliverables

1. Add prompt seeding and source-aware app deep links.
2. Make the prompt input accept initial value and subject context.
3. Add subject-aware first-run guidance for SEO and content entry paths.
4. Expand event properties so landing subject and prompt seed are carried through activation.
5. Run prompt-seeding and CTA experiments before scaling acquisition channels.
