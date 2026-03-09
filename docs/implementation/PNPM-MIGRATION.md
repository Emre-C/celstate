# pnpm Migration

> **Status:** Research backlog
>
> **Purpose:** Plan and de-risk a possible migration from `npm` to `pnpm` in order to reduce dependency-install inefficiency, improve reproducibility, and tighten CI/CD and deployment behavior without prematurely deciding that `pnpm` is automatically the right answer.

---

## Why This Exists

We are currently using `npm`, and there is concern that the current setup may be carrying unnecessary inefficiency across:

- local installs
- CI/CD dependency restoration
- deployment build environments
- disk usage
- lockfile determinism
- repeated ad hoc package execution

Even if `npm run build` is the visible pain point, the underlying waste may actually be in dependency install, cache invalidation, and script execution patterns rather than in Vite itself.

---

## Important Framing

This migration should not start from the assumption that:

- `pnpm` will automatically make every build faster
- package manager choice is the only source of waste
- the current bottleneck is definitely `npm` itself

Current repo context suggests:

- this is a **single-package** app, not yet a monorepo
- the main build command is simply `vite build`
- the repo currently uses `package-lock.json`
- scripts include `npx convex dev` and `npx tsx`, which may deserve scrutiny during migration

This means the migration must distinguish between:

- **install-time efficiency**
- **script/runtime ergonomics**
- **actual build-time performance**

---

## What pnpm Is Attractive For

Based on current pnpm documentation, the main reasons to evaluate `pnpm` are:

- content-addressable package store
- stronger dependency strictness
- lockfile-based reproducibility
- improved disk efficiency across repeated installs
- better long-term fit if Celstate ever becomes a workspace/monorepo

### CI/CD Relevance

`pnpm` is especially interesting if dependency installation and cache churn are costing money or slowing delivery. That is where the strongest upside is most likely to be found.

---

## What pnpm May Improve

### Dependency Installation

- Faster repeated installs in some environments
- Better disk reuse via shared store
- Cleaner caching model keyed off `pnpm-lock.yaml`

### Reproducibility

- Tighter package-manager version pinning through Corepack and `packageManager`
- More predictable dependency tree across machines and CI

### Dependency Hygiene

- Stricter resolution can surface missing or improperly declared dependencies earlier
- This is valuable even if it temporarily makes migration noisier

---

## What pnpm Will Not Automatically Fix

`pnpm` alone does not guarantee improvement in:

- Vite compile time
- Svelte warnings
- oversized bundles
- suboptimal build scripts
- unnecessary runtime work in app code

If `npm run build` feels inefficient, we should treat package-manager migration as one possible lever, not the whole diagnosis.

---

## Current Repo Observations

At the time of writing:

- `package.json` contains a simple app-level script set
- `build` is `vite build`
- `dev` uses `concurrently "vite dev" "npx convex dev"`
- `test:auth` uses `npx tsx scripts/test-auth-contract.ts`
- there is no `pnpm-lock.yaml`
- there is no `pnpm-workspace.yaml`
- there is no visible repo-level CI config checked in

### Why This Matters

This is a relatively favorable migration shape because:

- we are not dealing with a multi-package workspace yet
- there is only one existing lockfile to replace
- the main complexity is likely to be tooling compatibility, CI wiring, and deployment expectations

---

## Research Findings To Preserve

### Installation & Version Pinning

pnpm currently recommends using Corepack and pinning the package manager version via the `packageManager` field in `package.json`.

### CI

pnpm documents dedicated CI patterns and cache support, but also explicitly notes that caching the pnpm store is **optional** and not guaranteed to improve speed in every job shape.

### Production / Deployment

pnpm emphasizes committing the lockfile and using that lockfile consistently in production environments.

### Node Modules Layout

pnpm uses a symlinked `node_modules` structure backed by a content-addressable store. This is compatible with Node's module resolution, but it can expose broken packages or platform assumptions that happen to pass under flatter dependency trees.

---

## Main Migration Questions

### Performance Questions

- Are our real costs dominated by install time, build time, or both?
- Which environments matter most: local dev, CI, preview deploys, or production builds?
- Would pnpm materially reduce cold-install time, warm-install time, or storage churn?

### Compatibility Questions

- Do `convex`, `convex-svelte`, `sharp`, and related tooling behave cleanly under pnpm's stricter dependency model?
- Do our hosting and deployment targets fully support pnpm and symlinked installs?
- Are any hidden transitive dependency assumptions currently masked by npm's behavior?

### Workflow Questions

- Should we pin pnpm via Corepack in-repo?
- Should we keep commands package-manager-agnostic where possible, or explicitly standardize on `pnpm` commands everywhere?
- Should `npx` usage be eliminated in favor of `pnpm exec` or direct package scripts?

---

## Candidate Migration Scope

These are planning areas, not approved steps.

### Scope A: Minimal Lockfile Swap

- add pnpm via Corepack
- generate `pnpm-lock.yaml`
- remove `package-lock.json`
- keep script behavior functionally equivalent

This is the lowest-risk way to test whether `pnpm` alone yields meaningful value.

### Scope B: Lockfile + Script Hygiene

In addition to the above:

- review `npx` usage in scripts
- standardize local and CI package execution
- tighten reproducibility rules

This is probably a more honest migration target if efficiency is the actual concern.

### Scope C: Broader Build Pipeline Audit

In addition to the package-manager migration:

- profile build/install timings
- review cache strategy
- review deployment build commands
- review native dependency installation behavior

This is likely the most useful framing if cost reduction is the true business goal.

---

## Risk Areas

### Tooling Compatibility

Some tools or packages in the ecosystem still assume flatter dependency trees or undeclared transitive access. pnpm's strictness may surface these issues immediately.

### Native Dependencies

Packages such as `sharp` deserve validation because native/binary dependencies often behave differently across local, CI, and hosting environments.

### Deployment Platform Assumptions

Any platform that makes assumptions about install commands, lockfiles, or symlink handling needs to be verified before migration.

### Windows Developer Experience

pnpm's own docs note Windows-specific installation considerations and possible Microsoft Defender overhead. This should be part of the migration evaluation because local developer experience matters too.

---

## Validation Criteria Before We Commit

We should not decide based on sentiment alone. The migration should be judged against measurable outcomes such as:

- cold install time
- warm install time
- CI dependency restore time
- CI total job time
- deployment build duration
- lockfile stability
- local disk usage
- frequency of toolchain breakage

If these do not improve in a meaningful way, the migration may not be worth the churn.

---

## Candidate Verification Checklist

Before adopting pnpm, we should verify at minimum:

1. clean install works locally on Windows
2. `dev` workflow works with Convex
3. `vite build` still succeeds
4. test script execution works without ad hoc package resolution surprises
5. deployment/hosting environment accepts pnpm lockfile and install flow
6. CI cache strategy is proven with actual timings, not assumptions

---

## Research Work Before Implementation

1. Benchmark current npm install/build timings locally and in CI
2. Identify whether `npx` usage is adding avoidable variability or network work
3. Confirm hosting/deployment support for pnpm
4. Trial pnpm in a branch with exact timing comparison
5. Decide whether the real problem is package manager choice or broader build-pipeline hygiene

---

## Likely Deliverables Of A Future Migration

- `package-lock.json` removed
- `pnpm-lock.yaml` added
- `packageManager` field added to `package.json`
- local setup instructions updated
- CI install/cache steps updated
- deployment install/build commands updated if necessary
- script execution patterns reviewed for `npx` usage

---

## Non-Goals For This Document

- Not approving the migration yet
- Not claiming `pnpm` is categorically faster for Celstate
- Not rewriting scripts yet
- Not changing CI or deployment configuration yet

This document exists to keep the migration decision evidence-based and tied to real cost and performance outcomes.
