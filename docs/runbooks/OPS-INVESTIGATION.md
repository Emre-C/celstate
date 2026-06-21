# Ops Investigation

The owner should ask natural-language questions. The agent runs the repo-owned command invisibly, reads JSON stdout as evidence, and answers the product question directly.

## Command Surface

```bash
pnpm ops:investigate health
pnpm ops:investigate generation --id <generationId>
pnpm ops:investigate user --email <email>
pnpm ops:investigate user --id <userId>
pnpm ops:investigate recent --limit 5
pnpm ops:investigate check
```

Default output is JSON stdout plus a concise diagnostic summary on stderr. The CLI uses Convex as the authoritative source of truth and only calls PostHog when `--with-journey` is explicitly requested.

## Router

| Owner asks | Agent action | Evidence returned |
| --- | --- | --- |
| "Is production healthy?" | `pnpm ops:investigate health` | latest production-scoped AUTH, GENERATION, DOWNLOAD canary evidence (`POST_DEPLOY` or `SCHEDULED`) |
| "A generation failed" + ID | `pnpm ops:investigate generation --id <id>` | status, failure, retry, refund, later user generations |
| "Can they download it?" + ID | `pnpm ops:investigate generation --id <id>` | artifact storage presence, URL issuance, HTTP probe verdict |
| "New user..." + email | `pnpm ops:investigate user --email <email>` | auth binding, credits, latest generations |
| "New user..." without email/ID | `pnpm ops:investigate recent --limit 5`, then inspect likely user/generation | recent signup/failure candidates |
| "Did they come back?" | Start with Convex user/generation investigation; add `--with-journey` only if browser behavior matters | later generation rows first, PostHog journey second |

## Decision Tree

1. If the user asks "is production healthy?", run `pnpm ops:investigate health`.
2. If there is a Discord generation alert, run `pnpm ops:investigate generation --id <generationId>`.
3. If the question says "new user" or gives an email, run `pnpm ops:investigate user --email <email>`.
4. If there is no ID or email, run `pnpm ops:investigate recent --limit 5`.
5. Only add `--with-journey` when the Convex report answers the product state but not the user's browsing behavior.
6. Do not search Sentry for generation pipeline failures. Use Sentry only for auth/frontend exceptions surfaced by health or auth alerts.
7. Final response must answer the question directly. Do not tell the owner to run the command unless they ask for the command.

## Answer Shape

Answer in plain English, optimized for the owner:

```text
No. The generation failed at black_background after one internal retry. The credit was refunded, and there is no later generation from that user. Download is not applicable because no artifact completed.
```

When a structured summary is useful, include:

```text
AUTH: pass/fail/unknown
GENERATION: pass/fail/in-flight/unknown
DOWNLOAD: pass/fail/not-applicable/unknown
REFUND: refunded/not-refunded/not-applicable
USER RETRY: retried/recovered/no-retry/unknown
NEXT ACTION: one sentence
```

Do not include prompt text, raw artifact URLs, image bytes, or provider payloads in owner-facing summaries.
