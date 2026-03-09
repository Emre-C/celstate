# Owner Dashboard & Growth Analytics

> **Status:** Research backlog
>
> **Purpose:** Track the requirements and open questions for a private, owner-only dashboard covering Celstate growth, revenue, generation activity, and model cost exposure without prematurely choosing an implementation.

---

## Why This Exists

We need an internal dashboard that answers business and operational questions in one place:

- How many new users signed up today, this week, and this month?
- How many images were generated, downloaded, abandoned, retried, or failed?
- How much revenue was collected and how quickly are credits being consumed?
- What are Gemini image generation costs, and are they aligned with product pricing?
- Are there user or cohort patterns that indicate friction, abuse, or silent failure?

This dashboard must be accessible to **Emre only**. No normal user, collaborator, or future support role should inherit access by default.

---

## What Convex Provides Out Of The Box

Current research suggests Convex provides strong **operational** tooling, but not a finished owner analytics product:

- Convex Dashboard for project/deployment management
- Deployment logs for recent function execution visibility
- History and audit-style deployment events
- Log Streams to Axiom, Datadog, or a custom webhook
- Scheduler primitives for recurring aggregation jobs

### Important Limitation

Convex does **not** appear to provide a turnkey business dashboard for:

- owner-only product analytics
- signup/payment funnel reporting
- Gemini cost attribution per generation
- cohort retention views
- custom revenue intelligence

Conclusion: Convex likely gives us infrastructure primitives, not the final dashboard we want.

---

## Core Requirements

### Access Control

- Must be private to Emre only
- Must fail closed
- Must be protected both in UI routing and in backend data access
- Must be auditable if the allowlist/admin model changes later

### Growth Metrics

- New sign-ups
- Active users by day/week/month
- Returning users
- Conversion from signup to first generation
- Conversion from first generation to first payment

### Monetization Metrics

- Payments
- Credits purchased
- Credits consumed
- Credits refunded or manually granted
- Revenue by day/week/month

### Generation Metrics

- Generations requested
- Generations completed
- Generations failed
- Average time to completed image
- Download rate after successful generation
- Re-generation / retry rate

### Cost Metrics

- Gemini requests by model and output size
- Estimated cost per generation attempt
- Estimated cost per successful asset
- Daily and monthly Gemini spend
- Margin view: revenue versus generation cost

---

## Special Concern: Gemini Cost Tracking

This area needs extra rigor. "Usage" and "billed cost" are not always the same thing.

### Research Direction

The most robust approach appears to be separating:

- **product-side cost estimation** recorded at generation time
- **billing-side reconciliation** from Google Cloud billing exports

Google Cloud documents billing export to BigQuery, which looks like the most credible source of truth for actual billed usage over time. That likely makes it more trustworthy than relying only on application-side estimates.

### Open Question

We need to determine whether Celstate should:

1. show fast near-real-time estimated Gemini cost in the owner dashboard
2. reconcile that later against actual billed cost from Google Cloud exports
3. or avoid near-real-time cost display until we have reliable billing ingestion

---

## Candidate Architecture Directions

These are options to evaluate, not commitments.

### Option A: Convex-Native Admin Surface

- Owner-only route inside the main app
- Metrics stored in Convex tables
- Convex scheduled jobs compute rollups
- Good for simplicity and shared auth context

### Option B: Convex as Event Store, External BI for Visualization

- Celstate writes business events into Convex
- Convex log streams and scheduled exports feed external analytics storage
- Visualization happens in a BI tool or monitoring platform
- Good for richer dashboards and lower UI build cost

### Option C: Hybrid

- High-value top-line metrics inside a private Celstate dashboard
- Deep drill-downs in an external observability / analytics system
- Likely strongest long-term candidate, but needs careful security boundaries

---

## Data We Likely Need To Capture Explicitly

Convex logs alone will not answer all business questions. We likely need first-class event records for:

- user signed up
- user logged in
- generation requested
- generation started
- generation succeeded
- generation failed
- generation downloaded
- payment initiated
- payment succeeded
- payment failed
- credit balance changed
- manual admin action performed

Each event should likely capture enough metadata for later analysis without storing unnecessary sensitive payloads.

---

## Security Questions

- Should owner access be controlled by a hardcoded email allowlist, role table, separate auth provider claim, or deployment-level isolation?
- Should the dashboard live inside the main app or a separate internal surface?
- What is the safest way to ensure no future admin UI accidentally becomes available to non-owner users?
- What audit trail is required for future admin actions such as refunds or manual credit grants?

---

## Metrics That Need Definitions Before Implementation

Several metrics sound obvious but are easy to mis-measure:

- **Sign-up:** first user row created, first verified login, or first completed onboarding?
- **Payment:** successful checkout completion, settled payment, or credits granted?
- **Generated image:** generation request accepted, first preview returned, or final downloadable asset stored?
- **Download:** explicit user click, completed file transfer, or any storage egress event?
- **Failure:** model/provider failure only, or also timeouts, retries, validation errors, and post-processing issues?

These definitions must be locked before we build any dashboard.

---

## Research Findings To Preserve

- Convex Dashboard is primarily for project/deployment management, not product analytics
- Convex Log Streams can send operational data to webhook/Axiom/Datadog, but require Convex Pro
- Convex scheduler primitives are relevant for metric rollups and integrity checks
- Google Cloud billing export to BigQuery appears to be the strongest source for authoritative Gemini cost reconciliation

---

## Recommended Research Work Before Implementation

1. Define the owner-auth model for a strictly private dashboard
2. Define the event taxonomy and metric definitions
3. Compare Convex-only, hybrid, and external-BI approaches
4. Validate how Gemini cost data can be reconciled with billing exports
5. Decide which metrics must be real-time versus daily reconciled

---

## Non-Goals For This Document

- Not choosing a final dashboard framework
- Not choosing a final admin auth scheme
- Not defining final schemas yet
- Not implementing analytics or billing exports yet

This document exists only to keep the work visible and research-oriented.
