# Documentation Standard

Celstate documentation exists to preserve knowledge that is hard to recover from a quick code read.

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

## Folder Roles

- `docs/product/` — shipped behavior, product contracts, architecture, and cross-file invariants
- `docs/runbooks/` — operational workflows, deploy gates, rotations, verification, and incident-prone procedures
- `docs/conventions/` — coding rules that prevent known bug classes
- `docs/implementation/` — temporary specs for unshipped work only; prune after implementation or abandonment
- `docs/strategy/` — durable strategy and operating-model memos

