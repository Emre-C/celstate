---
name: AI-Native Critical Path Ops
overview: Replace ad hoc observability spelunking with an agent-first ops substrate. The owner asks natural-language questions; the AI runs repo-owned investigation commands invisibly and answers the only product questions that matter for Celstate: can users log in, can they generate an image, and can they download the completed artifact?
todos:
  - id: ops-contract
    content: Add critical-path investigation types and pure verdict helpers with tests
    status: pending
  - id: convex-read-models
    content: Implement bounded Convex internal read models for generation, user, recent incidents, and latest production health
    status: pending
  - id: ops-cli
    content: Create scripts/ops/investigate.ts as an agent tool surface with Windows-safe Convex CLI calls and command presets for health, generation, user, and recent failures
    status: pending
  - id: agent-router
    content: Add an AI question router/runbook so agents map natural-language ops questions to the correct investigation command without asking the owner to run anything
    status: pending
  - id: download-proof
    content: Add artifact URL/download reachability checks to the CLI and production generation canary
    status: pending
  - id: alert-hints
    content: Add copy-paste investigate commands to generation/auth/signup Discord alerts
    status: pending
  - id: runbook-docs
    content: Add docs/runbooks/OPS-INVESTIGATION.md and wire it into AGENTS.md, agent-execution.mdc, observability.md, and production-confidence.md
    status: pending
  - id: verification
    content: Add unit tests, convex-test coverage for read models, CLI dry-run tests, and documented prod smoke commands
    status: pending
isProject: false
---

# AI-native critical path ops: the owner asks, the agent investigates

## Review of the junior plan

The junior plan correctly identifies the main failure: alerts contain useful primary keys, but there is no canonical path from an alert to an answer. The proposed `pnpm ops:investigate --generation <id>` is directionally right.

The plan needs these corrections before implementation:

1. It is too generation-failure-centric. Celstate's real operational surface is login, generation, and download. The CLI must answer all three, not just "did this generation fail?"
2. It makes PostHog part of the default answer path. Convex is authoritative for generation rows, retry/refund state, user rows, and storage IDs. PostHog is optional behavioral context only.
3. It omits downloadability. A completed generation with missing storage or a dead file URL is a failed product outcome.
4. It proposes `promptPreview`. Prompts can contain sensitive user intent and are not needed for incident triage. Do not include prompt text by default.
5. It suggests shell-string `execSync` for Convex. Use `spawnSync`/`execFileSync` style argv arrays so PowerShell quoting cannot corrupt JSON args.
6. It keeps the missing `getRecentGenerationOpsFeed` idea. Implement a bounded incident feed with existing indexes instead of documenting a full-scan query.
7. It does not reuse the existing production confidence system. `verificationRuns` already stores AUTH and GENERATION canary evidence; the ops CLI should expose the latest run.
8. It is not explicit enough that the human is not the operator. The CLI is for the AI agent, not a workflow the owner is expected to learn.

External docs checked before revising this plan:

- Convex CLI `run` supports public and internal functions, JSON args, and `--prod`: https://docs.convex.dev/cli/overview
- Convex `ctx.storage.getUrl(storageId)` returns a file URL or `null`: https://docs.convex.dev/file-storage/serve-files
- PostHog Query API supports HogQL through the project query endpoint: https://posthog.com/docs/api/query

## AI-native operating contract

The human interface is natural language:

```text
"A new user's generation failed. Did they retry?"
"Are users able to log in and generate right now?"
"This generation completed, but can they download it?"
"What happened with passenger.sieben@gmail.com?"
```

The AI agent is the operator. It translates the question into one or more deterministic repo commands, reads the JSON, optionally follows up with bounded secondary probes, and answers in plain English. The owner should not need to know that the CLI exists.

The hidden agent tool surface is:

```bash
pnpm ops:investigate health
pnpm ops:investigate generation --id <generationId>
pnpm ops:investigate user --email <email>
pnpm ops:investigate recent --limit 5
```

The CLI prints machine-readable JSON to stdout and a concise diagnostic summary to stderr. The AI should use stdout as evidence and return only the answer, not command instructions, unless the owner explicitly asks how the investigation was performed.

The agent's final answer should cover:

```text
AUTH: pass/fail/unknown
GENERATION: pass/fail/in-flight/unknown
DOWNLOAD: pass/fail/not-applicable/unknown
REFUND: refunded/not-refunded/not-applicable
USER RETRY: retried/recovered/no-retry/unknown
NEXT ACTION: one sentence
```

Convex is the default source of truth. PostHog is allowed only behind an explicit `--with-journey` flag.

## Natural-language router

Add this routing table to `docs/runbooks/OPS-INVESTIGATION.md` and `.cursor/rules/agent-execution.mdc`. The agent should run the command, synthesize the result, and not hand the command back to the owner.

| Owner asks | Agent action | Evidence returned |
| --- | --- | --- |
| "Is production healthy?" | `pnpm ops:investigate health` | latest AUTH, GENERATION, DOWNLOAD canary evidence |
| "A generation failed" + ID | `pnpm ops:investigate generation --id <id>` | status, failure, retry, refund, later user generations |
| "Can they download it?" + ID | `pnpm ops:investigate generation --id <id>` | artifact storage IDs, issued URLs, HTTP probe verdict |
| "New user..." + email | `pnpm ops:investigate user --email <email>` | account binding, credits, latest generations |
| "New user..." without email/ID | `pnpm ops:investigate recent --limit 5`, then inspect likely user/generation | recent signup/failure candidates |
| "Did they come back?" | Start with Convex user/generation investigation; add `--with-journey` only if browser behavior matters | later generation rows first, PostHog journey second |

The answer format should be optimized for the owner:

```text
No. The generation failed at black_background after one internal retry. The credit was refunded, and there is no later generation from that user. Download is not applicable because no artifact completed.
```

Not:

```text
Run pnpm ops:investigate generation --id ...
```

## Source map

| Question | Authoritative source | Secondary source | Do not start with |
| --- | --- | --- | --- |
| Can users log in? | Latest `verificationRuns` AUTH verdict; auth webhook/Sentry alert for endpoint 5xx | Sentry auth issue details | PostHog |
| Did this generation run succeed? | `generations` row + `generationOpsEvents` by generation | PostHog event timing | Sentry |
| Did the system recover internally? | `generationOpsEvents` timeline + final generation status | none | PostHog |
| Did the user retry after failure? | Later `generations` rows for same user | PostHog journey with `--with-journey` | Sentry |
| Was the credit refunded? | `generations.creditRefundedAt` | user credit delta only if needed | PostHog |
| Can the image be downloaded? | `resultStorageId`/`optimizedStorageId` + `ctx.storage.getUrl` + CLI HTTP probe | Convex log stream if needed | PostHog |

## Implementation plan

### 1. Shared critical-path contract

Add pure types and verdict helpers under `src/lib/ops/investigation.ts`. Keep Convex validators in `src/convex/lib/opsInvestigation.ts`.

Do not include prompt text by default. If prompt inspection is ever needed, add an explicit `--include-prompt` flag later and keep it out of Discord and PostHog.

Core report shape:

```typescript
type CriticalPathVerdict = "pass" | "fail" | "in_flight" | "not_applicable" | "unknown";

interface GenerationInvestigationReport {
  generation: {
    id: string;
    userId: string;
    status: "generating" | "complete" | "failed";
    stage?: "white_background" | "black_background" | "finalizing";
    failureKind?: "timeout" | "provider_error" | "processing_error" | "unknown";
    failureStage?: "white_background" | "black_background" | "finalizing";
    userFacingError?: string;
    internalError?: string;
    creditRefunded: boolean;
    retryCount: number;
    createdAt: number;
    completedAt?: number;
    generationTimeMs?: number;
  };
  user: {
    id: string;
    email?: string;
    credits?: number;
    totalGenerations: number;
    completedGenerations: number;
    failedGenerations: number;
    laterGenerations: number;
    laterCompletedGenerations: number;
  };
  artifacts: {
    resultStorageIdPresent: boolean;
    optimizedStorageIdPresent: boolean;
    resultUrlIssued: boolean;
    optimizedUrlIssued: boolean;
    resultDownloadProbe?: DownloadProbe;
    optimizedDownloadProbe?: DownloadProbe;
  };
  opsTimeline: OpsTimelineEvent[];
  verdict: {
    auth: CriticalPathVerdict;
    generation: CriticalPathVerdict;
    download: CriticalPathVerdict;
    refund: CriticalPathVerdict;
    systemRecovered: boolean;
    userRetriedAfterThis: boolean;
    userRecoveredAfterThis: boolean;
    recommendedAction: string;
  };
}

interface DownloadProbe {
  ok: boolean;
  status?: number;
  contentType?: string;
  contentLength?: number;
  digestHeaderPresent: boolean;
  error?: string;
}
```

Pure helper tests should cover:

- terminal failure with refund and no later generations
- terminal failure followed by a later complete generation
- internal retry followed by completion
- complete generation with missing artifact
- complete generation with artifact URL issued but HTTP probe failed
- in-flight generation older than stale threshold

### 2. Convex internal read models

Implement these in `src/convex/ops.ts`:

```typescript
internal.ops.getGenerationInvestigation
args: { generationId: v.id("generations"), now: v.number() }
```

Behavior:

- Load the generation by ID.
- Load user by `generation.userId`.
- Load ops events through `generationOpsEvents.by_generation`.
- Load same-user generations through `generations.by_user`, bounded to a practical cap such as 100 newest rows.
- Compute retry and recovery counts from Convex rows, not PostHog.
- Resolve artifact URLs with `ctx.storage.getUrl` for `resultStorageId` and `optimizedStorageId`.
- Return a typed report without making outbound HTTP requests.

```typescript
internal.ops.getUserInvestigation
args: { email?: v.string(), userId?: v.id("users"), now: v.number(), limit?: v.number() }
```

Behavior:

- Support email lookup through `users.email` and ID lookup through direct `db.get`.
- Return auth binding presence (`clerkUserId`, `tokenIdentifier`), current credits, and latest generation summaries.
- Use this for "new user" or "can this account generate?" questions.

```typescript
internal.ops.getRecentGenerationIncidents
args: { now: v.number(), hoursWindow?: v.number(), limit?: v.number() }
```

Behavior:

- Query `generationOpsEvents.by_eventType_createdAt` separately for `generation_failed`, `generation_stalled`, and `alert_failed`.
- Merge and sort in memory after bounded `take(limit)` calls.
- Do not add or document a full-scan `getRecentGenerationOpsFeed`.

```typescript
internal.ops.getLatestCriticalPathHealth
args: { now: v.number() }
```

Behavior:

- Read latest `verificationRuns` by `by_trigger_startedAt`.
- Return latest AUTH and GENERATION verdicts and evidence refs.
- Include the timestamp age so the CLI can flag stale canary evidence.

Convex convention notes:

- Pass `now` from the CLI; do not call `Date.now()` inside queries that should be cache-stable.
- Use existing indexes only unless a query requires a new one. If a new filter is introduced, add the matching index in the same change.
- Keep mutations out of this plan; investigation is read-only.

### 3. Agent tool CLI

Create `scripts/ops/investigate.ts` and package scripts. This is an agent-operated tool, not a human dashboard:

```json
"ops:investigate": "tsx scripts/ops/investigate.ts",
"check:ops-tooling": "tsx scripts/ops/investigate.ts check"
```

Commands:

```bash
pnpm ops:investigate health
pnpm ops:investigate generation --id <generationId>
pnpm ops:investigate user --email <email>
pnpm ops:investigate user --id <userId>
pnpm ops:investigate recent --limit 5
pnpm ops:investigate check
```

Implementation requirements:

- Use `pnpm exec convex run --prod <functionName> <jsonArgs>` via argv arrays (`spawnSync` or `execFileSync`), not shell-joined strings.
- Always pass `{ now: Date.now() }` to Convex read models.
- Parse Convex JSON output into typed objects before rendering summaries.
- For completed generations, probe issued artifact URLs from Node with a small bounded request. Prefer `GET` with `Range: bytes=0-0`; fall back to an abortable `GET` if range is ignored. Never download full files during routine investigation.
- Default output is JSON stdout plus concise stderr summary. Add `--human` for summary only if useful.
- Add `--with-journey` to call PostHog through `scripts/lib/posthog-api.ts` for recent browser behavior. Keep this optional and never required for "did the user retry?"
- Add `--json` as the stable default contract and keep fields deterministic so agents can parse the output without natural-language scraping.
- Avoid interactive prompts. Missing args should produce a short error plus examples for agents.
- Redact or omit prompt text, raw image URLs in summaries, and unnecessary PII. JSON may include email when it is required to answer the owner's question.

Exit codes:

- `0`: data found and report generated, even if the product verdict is fail
- `1`: invalid args, generation/user not found, or required local tooling/env unavailable
- `2`: report generated but the CLI itself could not complete secondary probes, such as download URL HTTP checks

### 4. Download proof

Update the generation investigation path and production generation canary:

- `GenerationInvestigationReport.artifacts` must distinguish storage ID present, URL issued, and URL reachable.
- The existing production generation canary currently treats `resultStorageId` as artifact proof. Strengthen it to issue a storage URL and probe the URL so deploy/scheduled evidence covers the actual download path.
- Keep browser download click telemetry out of scope. For this app, server-side artifact reachability is the meaningful operational signal.

This aligns with Convex storage behavior: `ctx.storage.getUrl` returning `null` means the file no longer exists or cannot be served.

### 5. Alert hints

Generation failed/stalled alerts should include only fields needed to start investigation:

```text
Generation: <id>
User: <email-or-id>
Stage: <stage>
Total retries: <count>
Credit refunded: yes/no
Investigate: pnpm ops:investigate generation --id <id>
```

Signup alerts should include:

```text
Investigate: pnpm ops:investigate user --email <email>
```

Auth endpoint alerts should include:

```text
Investigate: pnpm ops:investigate health
```

Do not include prompts, image bytes, or full provider payloads in alerts.

### 6. Runbook and agent rules

Create `docs/runbooks/OPS-INVESTIGATION.md` with this decision tree:

```text
The owner should ask natural-language questions. The agent runs these commands invisibly.

1. If the user asks "is production healthy?" run:
   pnpm ops:investigate health

2. If there is a Discord generation alert, run:
   pnpm ops:investigate generation --id <generationId>

3. If the question says "new user" or gives an email, run:
   pnpm ops:investigate user --email <email>

4. If there is no ID or email, run:
   pnpm ops:investigate recent --limit 5

5. Only add --with-journey when the Convex report answers the product state but not the user's browsing behavior.

6. Do not search Sentry for generation pipeline failures. Use Sentry only for auth/frontend exceptions surfaced by health or auth alerts.

7. Final response must answer the question directly. Do not tell the owner to run the command unless they ask for the command.
```

Update:

- `.cursor/rules/agent-execution.mdc`: ops/incident questions run `pnpm ops:investigate ...` first.
- `AGENTS.md`: one-line pointer to the runbook.
- `docs/product/observability.md`: replace the missing `getRecentGenerationOpsFeed` reference with the implemented read models.
- `docs/product/production-confidence.md`: note that ops health surfaces latest verification run evidence.

### 7. Verification

Automated:

- Unit tests for pure verdict helpers.
- `convex-test` coverage for read model assembly using synthetic users, generations, ops events, and storage-ID-null cases.
- CLI dry-run tests for argument parsing and Convex command argv construction on Windows-safe paths.
- Alert builder tests for the new investigate command lines and refund fact.
- Production-confidence tests for download URL probe evidence if the canary contract changes.

Local gate:

```bash
pnpm check
pnpm typecheck:tsc
pnpm lint:ts
pnpm test
```

Manual prod smoke after deployment:

```bash
pnpm ops:investigate check
pnpm ops:investigate health
pnpm ops:investigate recent --limit 5
pnpm ops:investigate generation --id <known-generation-id>
```

Do not use `convex env list`.

## What this plan explicitly avoids

- No new dashboard.
- No broad APM project.
- No Sentry import into Convex.
- No loosening Convex MCP production PII guardrails.
- No PostHog dependency for authoritative incident answers.
- No prompt text in default reports or alerts.
- No extra client telemetry for download clicks unless a future product question genuinely requires it.

## Expected outcome

The target owner experience becomes:

```text
Owner: A new user's generation failed. Did they retry?
Agent: No. The failed generation was refunded, there is no later generation row for that user, and the user has not recovered with a successful retry.
```

Behind the scenes, the agent ran the relevant `pnpm ops:investigate ...` command and used its JSON report as evidence.

For a failed generation, the hidden command answers in one pass: final status, failure stage/kind, internal retry history, refund state, later user retries, later recovery, and whether a completed artifact is downloadable when one exists.

For general production health, the hidden command surfaces the latest AUTH, GENERATION, and DOWNLOAD evidence so the owner does not have to inspect GitHub Actions, Vercel, Convex, and Sentry separately for the basic question: can users log in, generate, and download?
