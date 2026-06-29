# Creating and maintaining documentation

Runbook for creating, updating, and archiving Celstate documentation. Use this whenever you ship a feature, fix a bug, make a product decision, or notice docs are out of sync with code.

Complements [`docs/README.md`](../README.md) (the docs map) and [`docs/runbooks/CODEBASE-HYGIENE.md`](./CODEBASE-HYGIENE.md) (static analysis gates).

## Why this runbook exists

Celstate is AI-coded and moves fast. Documentation is not an after-the-fact reference manual — it is **durable product memory**. It must answer three questions quickly and reliably:

1. **What are we trying to build?**
2. **What has actually been built, including the product and business decisions encoded in the code?**
3. **What remains, what is broken?**

The founder should be able to open one visually organized document and understand where the app stands. AI agents should be able to open structured YAML and understand feature purpose, current state, intentional decisions, remaining work, and known debt without rediscovering context from scratch.

## Core principles

1. **Documentation is product memory.** Preserve reasoning, not just file lists. Make intentional product choices explicit so future agents do not accidentally overwrite them.
2. **YAML is for structured truth.** Use YAML for feature state, implemented behavior, business decisions, remaining work, and defects. Keep it concise and structured — not long essays.
3. **HTML is for founder readability.** The product vision HTML is hand-coded by the AI agent, prioritizing visual hierarchy and fast comprehension. No build system.
4. **Code is the ultimate source for implementation facts.** If a doc says something is built, it must be supported by code references. If unclear, mark as unverified rather than guessing.
5. **Keep the system small enough to maintain every time code changes.** No custom generators, validators, or complex workflows unless the simple version proves insufficient.

## Documentation structure

```text
docs/
  README.md              ← map of what lives where
  runbooks/              ← operational workflows (this file lives here)
  conventions/           ← coding rules that prevent known bug classes
  product/
    vision.html          ← founder-readable product vision and status
    design-system.md     ← canonical design system tokens and rules
  features/
    *.yaml               ← structured feature state (one per major feature)
  registers/
    defects.yaml         ← known bugs, defects, tech debt, design debt, test gaps
  implementation/        ← temporary specs for unshipped work only; prune after ship
  strategy/              ← durable strategy and operating-model memos
  archive/               ← superseded docs retained for historical reference only
```

## When to use this runbook

| Trigger | Action |
---------|--------
| **Shipping a new feature** | Create a `docs/features/<feature-id>.yaml` file. Update `docs/product/vision.html`. |
| **Changing feature behavior** | Update the relevant `docs/features/*.yaml`. Bump `last_reviewed`. |
| **Encoding a product decision in code** | Add it as a `business_decisions` entry in the relevant feature YAML with `encoded_in` code references. |
| **Finding a bug, defect, or tech debt** | Add an item to `docs/registers/defects.yaml`. |
| **Resolving a defect** | Set `status: resolved` and `resolved:` date in the defects register. Do not delete immediately. |
| **Overall product state, vision, or beta readiness changes** | Update `docs/product/vision.html`. |
| **A doc is superseded** | Migrate useful info to the canonical location, then move the old doc to `docs/archive/`. Delete only if clearly obsolete with no unique value. |
| **Creating a new operational procedure** | Add a runbook in `docs/runbooks/`. |

## How to create a feature YAML

A feature deserves its own YAML file when it has at least one of:

- distinct user-facing behavior
- meaningful business logic
- dedicated screens or flows
- product decisions that future agents must preserve
- beta readiness implications

Do **not** create YAML files for tiny implementation details, one-off utilities, or purely technical modules unless they represent a major product capability.

### Schema

```yaml
id: onboarding
name: Onboarding
status: partial # not_started | planned | partial | functional | beta_ready | deferred
confidence: medium # low | medium | high

purpose:
  summary: >
    Short explanation of why this feature exists.
  vision_alignment:
    - How this feature supports the app's larger promise.
    - What user or business outcome it enables.

implemented:
  summary: >
    Short factual summary of what is currently implemented.
  user_visible_behavior:
    - Behavior the user can currently experience.
  internal_behavior:
    - Important implementation behavior that affects the product.

business_decisions:
  - decision: Short description of an intentional choice.
    rationale: Why this choice exists.
    encoded_in:
      - path/to/relevant/file.ts

implementation:
  primary_files:
    - path/to/primary/file.tsx
  related_files:
    - path/to/related/file.ts
  notes: >
    Optional short notes about ownership boundaries or important dependencies.

remaining:
  beta_blockers:
    - Work that must be complete before beta.
  planned:
    - Work that is planned but not necessarily beta-blocking.
  post_beta:
    - Work that should explicitly wait until after beta.

risks:
  - Risk, mismatch, or uncertainty related to this feature.

open_questions:
  - Product or technical question needing founder or engineering judgment.

acceptance_criteria:
  beta_ready:
    - Observable condition that means this feature is ready for beta.

last_reviewed: 2026-06-28
```

### Schema guidance

- Keep each field short and useful. Prefer bullets over paragraphs.
- Include code references for implemented behavior and business decisions.
- Do not list every file touched by the feature; list the files that orient future work.
- If the code does not support a claim, do not write the claim.
- If a fact is likely but unverified, mark it explicitly as unverified.
- Update `last_reviewed` whenever you touch the file.

### Status definitions

- `not_started`: concept exists, but implementation has not begun.
- `planned`: intentionally planned, but not materially implemented.
- `partial`: some implementation exists, but incomplete or not coherent enough for beta.
- `functional`: works in a meaningful way, but may still need polish, testing, or alignment.
- `beta_ready`: ready for beta expectations.
- `deferred`: intentionally out of scope for beta or current product direction.

### Confidence definitions

- `low`: docs are based on incomplete review or unclear implementation.
- `medium`: directionally reliable but may need deeper verification.
- `high`: supported by recent code review and clear evidence.

## How to update the defects register

Path: `docs/registers/defects.yaml`

```yaml
items:
  - id: defect-001
    type: bug # bug | defect | tech_debt | design_debt | test_gap | product_gap
    severity: medium # low | medium | high | blocker
    status: open # open | in_progress | resolved | deferred
    area: onboarding
    summary: Short description of the issue.
    evidence: >
      What proves or suggests this issue exists.
    impact: >
      Why this matters for users, beta readiness, maintainability, or product quality.
    proposed_resolution: >
      The smallest likely fix or next step.
    related_files:
      - path/to/relevant/file.ts
    created: 2026-06-28
    resolved: null
```

### Register guidance

- Keep it actionable, not emotional.
- Separate actual bugs from vague cleanup.
- Every item needs an impact and a proposed next step.
- Use `product_gap` when something is missing from the product experience but not technically broken.
- Use `design_debt` when the implementation violates the intended visual or interaction quality.
- Use `test_gap` when behavior exists but confidence is low because meaningful coverage is missing.
- Resolved items may remain briefly for continuity, but the register should not become a changelog.

## How to update the vision HTML

Path: `docs/product/vision.html`

The HTML is the founder-facing synthesis of the feature YAMLs and defects register. Update it when:

- a feature ships or changes maturity
- beta readiness shifts
- major risks or open decisions change
- the product thesis or vision evolves

### Sections to maintain

- North star vision
- Product thesis
- Target user and core promise
- Current app shape
- Feature status overview
- Beta readiness snapshot
- Major product gaps
- Major technical or design risks
- Open founder decisions
- Recently completed meaningful progress

### Implementation guidance

- Use static HTML and CSS. Single self-contained file. No build system.
- Use visual hierarchy: cards, sections, status badges, tables, callouts, summaries.
- The HTML may summarize information from the feature YAML files and defects register, but it does not need to be automatically generated.
- Since this is a human-readable artifact, **verify it visually after changes** — open it in a browser and confirm it renders correctly.

## How to archive or remove superseded docs

After useful information has been migrated to the canonical location:

1. **Archive** superseded docs that may still have historical value → `docs/archive/`.
2. **Delete** only docs that are clearly obsolete and contain no unique useful information.
3. **Avoid keeping multiple conflicting sources of truth.** When in doubt, archive first and delete later.

## How to update the docs README

Path: `docs/README.md`

Keep it short — it is a map, not a strategy document. Update it when:

- a new document type or directory is added
- source-of-truth assignments change
- the "what to keep vs what to delete" rules need updating

## Ongoing maintenance rule

Every meaningful product or implementation change should update docs in the same pass:

- If feature behavior changes, update the relevant `docs/features/*.yaml` file.
- If a bug, defect, debt item, or test gap is found, update `docs/registers/defects.yaml`.
- If the overall product state, vision, or beta readiness changes, update `docs/product/vision.html`.
- If a product decision is encoded in code, document it as a business decision in the relevant feature YAML.

This rule matters because the app is AI-coded. The docs are how future agents inherit context instead of repeatedly rediscovering or accidentally reversing prior decisions.

## What not to do

- Do not create a large documentation framework.
- Do not add a generator unless the manual AI-maintained HTML becomes painful.
- Do not turn YAML into long narrative essays.
- Do not duplicate every implementation detail from the code.
- Do not document guessed behavior as fact.
- Do not keep old docs around if they conflict with the current source of truth.
- Do not mix roadmap, bugs, defects, and tech debt without clear types and severity.

## Related docs

- [`docs/README.md`](../README.md) — docs map and source-of-truth rules
- [`docs/runbooks/CODEBASE-HYGIENE.md`](./CODEBASE-HYGIENE.md) — local quality gates and static analysis
- [`docs/product/design-system.md`](../product/design-system.md) — canonical design tokens and rules
