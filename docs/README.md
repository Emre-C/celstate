# Celstate Documentation

## Where to start

- **Founder?** Open `docs/product/vision.html` in a browser for a visual overview of the product vision, feature status, beta readiness, and open decisions.
- **AI agent?** Read the feature YAML files in `docs/features/` for structured context on what's built, why, and what remains. Check `docs/registers/defects.yaml` for known issues.
- **Operator?** Start with `docs/runbooks/` for deploy, secrets, and verification procedures.

## Documentation structure

```
docs/
  README.md              ← this file (map, not a strategy document)
  document_strategy.md   ← the strategy behind this documentation system

  product/
    vision.html          ← founder-readable product vision and status (HTML)
    design-system.md     ← canonical design system tokens and rules
    illustrated-ui-ornament-vision.md ← illustrated ornament slot contract

  features/
    *.yaml               ← structured feature state (purpose, implementation, decisions, remaining work)

  registers/
    defects.yaml         ← known bugs, defects, tech debt, design debt, test gaps, product gaps

  runbooks/              ← operational workflows, deploy gates, rotations, verification
  conventions/           ← coding rules that prevent known bug classes
  implementation/        ← temporary specs for unshipped work only; prune after implementation
  strategy/              ← durable strategy and operating-model memos
  archive/               ← superseded docs retained for historical reference only
```

## Source-of-truth rules

- **Feature state:** `docs/features/*.yaml` is the canonical structured source. Superseded detailed engineering references are in `docs/archive/`.
- **Defects and debt:** `docs/registers/defects.yaml` is the single register. Don't scatter bugs across other docs.
- **Product vision:** `docs/product/vision.html` is the founder-facing synthesis of the feature YAMLs and defects register.
- **Design system:** `docs/product/design-system.md` is the canonical token/component reference.
- **Code is still the ultimate source for implementation facts.** If a doc says something is built, it should be supported by code references. If something is unclear, mark it as unverified.

## Ongoing maintenance rule

Every meaningful product or implementation change should update docs in the same pass:

- If feature behavior changes, update the relevant `docs/features/*.yaml` file.
- If a bug, defect, debt item, or test gap is found, update `docs/registers/defects.yaml`.
- If the overall product state, vision, or beta readiness changes, update `docs/product/vision.html`.
- If a product decision is encoded in code, document it as a business decision in the relevant feature YAML.

This rule matters because the app is AI-coded. The docs are how future agents inherit context instead of repeatedly rediscovering or accidentally reversing prior decisions.

## What to keep vs what to delete

Keep a document only when it records one of these:

- a product or architecture decision that future changes must respect
- an operational procedure that prevents production, billing, or secrets mistakes
- a design-system rule or brand constraint that is not obvious from component code
- a domain invariant, threat model, or failure mode that spans multiple files
- a strategy memo that guides work across more than one implementation task

Do not keep repository docs for:

- one-off handoff notes, personal task lists, or "next steps"
- copied upstream framework docs
- plans that have already shipped and are now obvious from code
- backlog items better represented as issues
- code maps that only restate filenames and function names

When a temporary implementation note produces durable knowledge, promote only the durable part into `docs/product/`, `docs/runbooks/`, or `docs/conventions/`, then delete the note.

