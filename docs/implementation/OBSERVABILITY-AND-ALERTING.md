# Observability & Alerting

> **Status:** Research backlog
>
> **Purpose:** Capture the open work required to give Celstate production-grade visibility into failures, degraded flows, and suspicious user outcomes without waiting for users to report problems.

---

## Why This Exists

We want a system where we can detect and investigate issues proactively:

- image generation fails
- login or session refresh fails
- payments fail or credits do not reconcile
- background jobs stall
- users generate assets but never download them
- critical paths slow down without hard errors

User bug reports should become a fallback, not the primary discovery mechanism.

---

## Desired Outcomes

- Near-immediate awareness of customer-impacting failures
- Enough context to diagnose issues without reproducing them manually
- Visibility into both technical failures and product red flags
- Alerting that distinguishes noise from genuine incidents

---

## Why Sentry Is Relevant

Current research suggests Sentry for SvelteKit can provide several useful layers out of the box:

- error monitoring
- performance tracing
- session replay
- metrics
- cron / recurring job monitoring

This makes Sentry a strong candidate for the core observability plane, especially for frontend and server error visibility.

### Important Caveat

Sentry alone is not a full business observability system.

It can capture errors, traces, and custom metrics, but Celstate still needs a deliberate event model for product signals such as:

- generated but never downloaded
- repeated failed generations by the same user
- abnormal credit depletion
- sudden drop in signup-to-generation conversion

Those need explicit instrumentation and alert rules, not just SDK installation.

---

## Problem Categories We Need To Observe

### Authentication

- sign-in start
- callback failure
- token refresh failure
- logout anomalies
- repeated auth loops

### Image Generation

- generation request accepted
- upstream model call started
- upstream model call failed
- generation succeeded but downstream post-processing failed
- generation completed but asset was never downloaded
- excessive latency before completion

### Payments & Credits

- checkout started
- checkout succeeded
- checkout failed
- credits not granted after successful payment
- credits deducted without usable output

### Platform Reliability

- scheduled jobs missed or timed out
- unusual spike in function failures
- growing queue/backlog
- file storage or download anomalies

---

## Observability Layers To Evaluate

These are complementary layers, not mutually exclusive choices.

### Layer 1: Error Monitoring

Capture unhandled exceptions and explicitly reported failures from:

- SvelteKit client
- SvelteKit server
- Convex-facing integration points
- external provider wrappers

### Layer 2: Tracing & Latency

Measure where time is spent in core flows:

- login
- generation request lifecycle
- post-processing
- download preparation
- payment confirmation

### Layer 3: Session Replay

Useful for front-end failures and confusing UX states. Research shows Sentry masks text, images, and inputs by default, which is favorable for privacy, but replay still needs careful review around sensitive flows.

### Layer 4: Custom Metrics

Sentry metrics can emit counters, gauges, and distributions. That makes it plausible to track:

- generation failures
- download conversion
- auth callback errors
- time-to-image distributions
- retry counts

### Layer 5: Job Monitoring

Sentry cron monitoring is relevant for recurring health checks, aggregation jobs, reconciliation jobs, and backlog processors.

### Layer 6: Structured Product Events

Some of the most important red flags are not exceptions. We likely need explicit event emission for:

- generation completed but not downloaded within threshold
- repeated failures for one prompt / model / account
- suspiciously high abandonment after payment
- spike in background-removal QA failures

---

## What Convex Contributes Here

Convex is relevant, but mostly as an operational data source:

- logs for recent deployment/function activity
- log streams for exporting function execution events
- scheduler primitives for recurring checks
- storage egress signals that may help infer downloads

This is useful, but it still does not replace a full observability strategy.

### Especially Relevant Convex Signal

Convex log streams document `function_execution` events and `storage_api_bandwidth` events. Those may be useful for:

- detecting failed mutations/actions
- measuring operational throughput
- approximating completed downloads

However, the docs also note best-effort delivery and possible duplication, so these streams should not automatically be treated as the single source of truth for product analytics.

---

## Critical Open Design Questions

- Which incidents should page immediately versus create a backlog issue?
- Which signals belong in Sentry, which belong in business analytics, and which should live in both?
- Should "never downloaded" be inferred from storage egress, explicit UI download intent, or both?
- How long after generation should we wait before flagging a missing download?
- What privacy boundaries must be enforced for replay, logs, and prompt-related metadata?
- How do we correlate a frontend failure, backend function failure, provider error, and user-facing generation record into one traceable incident?

---

## Candidate Detection Rules To Research

These are intentionally phrased as investigation targets, not final alert policies.

- Generation failure rate exceeds threshold over rolling window
- Auth callback failures spike over baseline
- Payment succeeded but credits were not granted within threshold
- Completed images are not downloaded within threshold
- Generation latency drifts above acceptable range
- Scheduled reconciliation job misses execution window
- One provider/model variant becomes materially less reliable than others

---

## Minimum Incident Context We Probably Need

Every high-value event should be correlatable by:

- user identifier
- generation identifier
- payment identifier where relevant
- provider/model
- environment
- request / trace identifier
- timestamps for each lifecycle stage

Without this, alerting may tell us something is broken while still forcing manual archaeology.

---

## Privacy & Compliance Questions

- Can prompts be sent to Sentry, or must they be redacted / hashed?
- Can generated image URLs appear in telemetry?
- Should replay be disabled or restricted for authenticated app areas?
- Which user identifiers are acceptable to send to third-party observability tooling?

These questions should be answered before instrumentation expands.

---

## Research Findings To Preserve

- Sentry for SvelteKit supports Session Replay, tracing, metrics, and cron monitoring
- Sentry metrics are still documented as open beta
- Session Replay defaults to masking text, media, and input, but still needs privacy review
- Convex log streams can export operational events to webhook, Axiom, or Datadog
- Convex log streams require Pro and are best-effort, not perfect event accounting

---

## Recommended Research Work Before Implementation

1. Define the event taxonomy for core user and system flows
2. Classify signals into error, trace, metric, replay, and product-event layers
3. Decide what requires real-time alerting versus dashboard visibility only
4. Define privacy rules for prompts, images, user identity, and payments
5. Design correlation IDs across frontend, backend, provider, and storage events

---

## Non-Goals For This Document

- Not committing to Sentry as the only observability tool
- Not defining final alert thresholds
- Not defining final retention policy
- Not implementing instrumentation yet

This document exists to keep the observability work explicit, scoped, and research-first.
