# Audit 03: Find and Remove Unused Code (Knip)

**Date:** 2026-06-24  
**Scope:** Full project  
**Tool:** `knip` (v8.0.0)

---

## Summary

**Knip reports zero issues.** The codebase has no unused exports, unused files, unused dependencies, or unlisted dependencies.

```
$ pnpm exec knip --reporter json
{"issues":[]}
```

---

## Analysis

### Why knip is clean

The local diff (uncommitted changes) already removed a large volume of dead code:

- **`archive/transparent-animation/`** — entire directory deleted (~5,500 lines)
- **`bundles/`** — entire directory deleted (Living UI bundles, harnesses, manifests)
- **`packages/living-ui-runtime/`** — entire package deleted (~3,000 lines)
- **`scripts/living-ui/`** — deleted (bundle contracts, evidence eval, G-gate probe)
- **`scripts/workers/`** — deleted (animation worker + report)
- **`scripts/spikes/living-ui-sprite-sheet-capability.ts`** — deleted (~900 lines)
- **`docs/archive/transparent-animation/`** — deleted (4 R&D docs)
- **`src/convex/animationGenerations.ts`** + test — deleted (~1,200 lines)
- **`src/convex/lib/animation/`** — deleted (animationGenerationRun, animationPrompts)
- **`src/lib/components/AnimationGenerationCard.svelte`** — deleted
- **`docs/runbooks/ANIMATION-WORKER.md`** — deleted
- **`docs/product/LIVING-UI-ANIMATION-SPIKE.html`** — deleted

This was a major cleanup pass. The remaining code is actively referenced.

### Knip configuration

The `knip.json` file was modified in the local diff (7 lines removed), suggesting the config was tightened as part of the cleanup.

### Potential blind spots

Knip detects unused exports and files, but it cannot detect:

1. **Dead code paths within functions** — e.g. unreachable branches, unused variables inside functions
2. **Over-abstractive code** — functions that exist and are called but whose abstraction adds no value
3. **Schema fields that are written but never read** — Convex schema fields like `workosUserId` (see Audit 07)
4. **Validators that are exported but only used in schema** — these appear "used" but may validate fields that are never queried

**Recommendation:** No action needed from knip. The codebase is clean. For the blind spots above, see the relevant audits (Audit 07 for legacy fields, Audit 08 for over-commented code).

---

## Implementation Priority

| Priority | Item | Action |
|----------|------|--------|
| None | Knip issues | No issues found — no action required |
