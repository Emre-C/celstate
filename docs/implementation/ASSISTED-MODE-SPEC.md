# Assisted Mode — Technical Specification

## 1. System Overview

```
INVARIANT: Assisted mode adds zero credit cost. The designer LLM call is platform-subsidized.
INVARIANT: Assisted mode is a client-side orchestration layer. It does NOT alter the generation pipeline.
INVARIANT: The final output of assisted mode is a string prompt passed to the existing requestGeneration mutation.
INVARIANT: The designer LLM is Minimax-M2.7 via Anthropic-compatible API. It runs in a Convex "use node" action.
INVARIANT: User preference assistedModeEnabled persists in the users table.
```

### Boundary

```
┌─────────────────────────────────────────────────────────────┐
│ Assisted Mode Scope                                        │
│                                                            │
│  PromptInput (toggle) → Convex Action (designer LLM) →    │
│  Clarifying UI (inline) → Convex Action (prompt rewrite) → │
│  requestGeneration(enhancedPrompt, originalPrompt)          │
│                                                            │
└─────────────────────────────────────────────────────────────┘
```

## 2. Data Architecture

### 2.1. Schema Additions — `src/convex/schema.ts`

```typescript
// Patch to users table — add field
interface UsersPatch {
  assistedModeEnabled: v.optional(v.boolean()); // default: false
}

// New table
interface AssistedSessions {
  userId: Id<"users">;
  originalPrompt: string;
  status: "asking" | "rewriting" | "complete" | "failed" | "skipped";
  question: v.optional(string);
  options: v.optional(string[]); // length 3; 4th "Other" is implicit
  selectedOption: v.optional(string); // one of options[0..2] | freeform string
  selectedOptionIndex: v.optional(number); // 0..2 for preset, 3 for "Other"
  enhancedPrompt: v.optional(string);
  error: v.optional(string);
  createdAt: number;
  completedAt: v.optional(number);
}

// Index
// .index("by_user", ["userId", "createdAt"])
```

### 2.2. Convex Validators — `src/convex/lib/validators.ts`

```typescript
export const assistedSessionStatusValidator = v.union(
  v.literal("asking"),
  v.literal("rewriting"),
  v.literal("complete"),
  v.literal("failed"),
  v.literal("skipped"),
);
```

### 2.3. Generation Table Patch — `src/convex/schema.ts`

```typescript
// Add to existing generations table definition
interface GenerationsPatch {
  originalPrompt: v.optional(v.string());       // user's raw input (when assisted)
  assistedSessionId: v.optional(v.id("assistedSessions"));
}
// generations.prompt stores the final prompt sent to Vertex (enhanced or original).
// generations.originalPrompt stores the user's raw input when assisted mode produced it.
```

### 2.4. Config Constants — `src/convex/lib/config.ts`

```typescript
interface AssistedModeConfig {
  designerModel: "MiniMax-M2-80B";
  designerMaxTokens: 1024;
  designerTemperature: 0.7;
  maxOptionCount: 3;           // preset options returned by designer
  maxQuestionLength: 200;      // chars
  maxOptionLength: 80;         // chars per option
  maxEnhancedPromptLength: 2000;
  sessionTimeoutMs: 300_000;   // 5 min — auto-expire stale sessions
}
```

### 2.5. Environment Variable

```
MINIMAX_API_KEY         — Anthropic-compatible API key for Minimax-M2.7
MINIMAX_BASE_URL        — base URL for the Anthropic-compatible endpoint
```

## 3. Designer LLM Client — `src/convex/lib/designer.ts`

```typescript
// "use node" — runs in Convex Node action runtime

interface DesignerClient {
  askClarifyingQuestion(prompt: string): Promise<ClarifyingQuestionResult>;
  rewritePrompt(prompt: string, question: string, answer: string): Promise<RewriteResult>;
}

interface ClarifyingQuestionResult {
  question: string;
  options: [string, string, string]; // exactly 3
}

interface RewriteResult {
  enhancedPrompt: string;
}
```

### 3.1. HTTP Client

```typescript
// Anthropic-compatible messages API
// POST ${MINIMAX_BASE_URL}/v1/messages
// Headers: { "x-api-key": MINIMAX_API_KEY, "anthropic-version": "2023-06-01" }
// Model: "MiniMax-M2-80B"
// No SDK dependency. Raw fetch.
```

### 3.2. System Prompts — `src/convex/lib/designerPrompts.ts`

```typescript
interface DesignerPrompts {
  clarifyingQuestion: string;
  // Instructs the designer to:
  // 1. Analyze the user prompt for ambiguity
  // 2. Identify the single most impactful clarifying question
  // 3. Return exactly 3 preset answer options
  // 4. Output strict JSON: { "question": string, "options": [string, string, string] }

  rewritePrompt: string;
  // Instructs the designer to:
  // 1. Combine original prompt + question + answer
  // 2. Craft a detailed image generation prompt
  // 3. MUST include: "with a transparent background"
  // 4. Output strict JSON: { "enhancedPrompt": string }
}
```

## 4. Convex API Surface

### 4.1. Mutations

```typescript
// src/convex/assistedMode.ts

/** Toggle persistence */
setAssistedModeEnabled: mutation({
  args: { enabled: v.boolean() },
  returns: v.null(),
  // handler: patch current user's assistedModeEnabled field
});
```

### 4.2. Actions

```typescript
/** Step 1: Generate clarifying question */
generateClarifyingQuestion: internalAction({
  args: { sessionId: v.id("assistedSessions") },
  returns: v.null(),
  // 1. Read session via runQuery
  // 2. Call designerClient.askClarifyingQuestion(originalPrompt)
  // 3. Parse + validate response (3 options, length limits)
  // 4. runMutation to patch session: status → "asking", question, options
  // On error: runMutation to patch session: status → "failed", error
});

/** Step 2: Rewrite prompt with user's answer */
rewritePromptWithAnswer: internalAction({
  args: { sessionId: v.id("assistedSessions") },
  returns: v.null(),
  // 1. Read session via runQuery
  // 2. Call designerClient.rewritePrompt(originalPrompt, question, selectedOption)
  // 3. Parse + validate response (length limit)
  // 4. runMutation to patch session: status → "complete", enhancedPrompt, completedAt
  // On error: runMutation to patch session: status → "failed", error
});
```

### 4.3. Public Mutations (client-callable)

```typescript
/** Create session + schedule question generation */
startAssistedSession: mutation({
  args: { prompt: v.string() },
  returns: v.id("assistedSessions"),
  // 1. Auth check
  // 2. Validate prompt (non-empty, length ≤ maxPromptLength)
  // 3. Insert assistedSessions row: status "asking", originalPrompt
  // 4. Schedule generateClarifyingQuestion action
  // 5. Return sessionId
});

/** User selects an option or writes freeform answer */
submitAssistedAnswer: mutation({
  args: {
    sessionId: v.id("assistedSessions"),
    selectedOptionIndex: v.number(),        // 0..3 (3 = Other)
    freeformAnswer: v.optional(v.string()),  // required when index === 3
  },
  returns: v.null(),
  // 1. Auth check + ownership check
  // 2. Validate session status === "asking"
  // 3. Resolve selectedOption: options[index] or freeformAnswer
  // 4. Patch session: selectedOption, selectedOptionIndex, status → "rewriting"
  // 5. Schedule rewritePromptWithAnswer action
});

/** User skips the clarifying question */
skipAssistedSession: mutation({
  args: { sessionId: v.id("assistedSessions") },
  returns: v.null(),
  // 1. Auth check + ownership check
  // 2. Validate session status === "asking"
  // 3. Patch session: status → "skipped", completedAt
});
```

### 4.4. Queries

```typescript
/** Reactive query for session state */
getAssistedSession: query({
  args: { sessionId: v.id("assistedSessions") },
  returns: v.union(assistedSessionDoc, v.null()),
  // Auth check + ownership check
  // Return full session document
});
```

## 5. State Machine

### 5.1. Assisted Session Lifecycle

```
          startAssistedSession(prompt)
                    │
                    ▼
             ┌──────────┐
             │  asking   │◄── generateClarifyingQuestion scheduled
             └────┬──┬──┘
                  │  │
    ┌─────────────┘  └──────────────┐
    │ submitAssistedAnswer           │ skipAssistedSession
    ▼                                ▼
┌───────────┐                  ┌──────────┐
│ rewriting │                  │ skipped  │ → use originalPrompt
└─────┬─────┘                  └──────────┘
      │ rewritePromptWithAnswer
      ▼
┌───────────┐
│ complete  │ → use enhancedPrompt
└───────────┘

Any state except "complete" | "skipped" can transition to:
┌──────────┐
│  failed  │ → fallback: use originalPrompt
└──────────┘
```

### 5.2. TLA+ Specification

```tla+
---- MODULE AssistedSession ----
EXTENDS Naturals, FiniteSets

CONSTANTS MAX_CLIENTS

VARIABLES state, pc

States == {"idle", "asking", "rewriting", "complete", "skipped", "failed"}

TypeInvariant ==
  /\ state \in States
  /\ pc \in {"start", "submit", "skip", "done"}

Init ==
  /\ state = "idle"
  /\ pc = "start"

StartSession ==
  /\ state = "idle"
  /\ pc = "start"
  /\ state' = "asking"
  /\ pc' = "submit"

SubmitAnswer ==
  /\ state = "asking"
  /\ pc = "submit"
  /\ state' = "rewriting"
  /\ pc' = "done"

SkipQuestion ==
  /\ state = "asking"
  /\ pc = "submit"
  /\ state' = "skipped"
  /\ pc' = "done"

CompleteRewrite ==
  /\ state = "rewriting"
  /\ state' = "complete"
  /\ pc' = "done"

Fail ==
  /\ state \in {"asking", "rewriting"}
  /\ state' = "failed"
  /\ pc' = "done"

Next ==
  \/ StartSession
  \/ SubmitAnswer
  \/ SkipQuestion
  \/ CompleteRewrite
  \/ Fail

\* Safety: no transition from terminal states
SafetyInvariant ==
  state \in {"complete", "skipped", "failed"} => pc = "done"

\* Liveness: every session eventually terminates
Liveness == <>(state \in {"complete", "skipped", "failed"})

\* No credit deduction occurs within this module
CreditInvariant == TRUE

Spec == Init /\ [][Next]_<<state, pc>> /\ WF_<<state, pc>>(Next)

====
```

## 6. Client-Side Orchestration — `PromptInput.svelte`

### 6.1. Component State

```typescript
interface AssistedModeUIState {
  assistedEnabled: boolean;         // bound to user preference
  sessionId: Id<"assistedSessions"> | null;
  phase: "input" | "loading_question" | "answering" | "loading_rewrite" | "done";
}
```

### 6.2. Phase Transitions (UI)

```
input ──[user submits + assisted=true]──► loading_question
loading_question ──[session.status="asking"]──► answering
answering ──[user selects option]──► loading_rewrite
answering ──[user clicks skip]──► done (use originalPrompt)
loading_rewrite ──[session.status="complete"]──► done (use enhancedPrompt)
loading_rewrite ──[session.status="failed"]──► done (fallback: use originalPrompt)
loading_question ──[session.status="failed"]──► done (fallback: use originalPrompt)

input ──[user submits + assisted=false]──► done (use originalPrompt, no session)
```

### 6.3. Inline UI Replacement

```
INVARIANT: When phase ∈ {"loading_question", "answering", "loading_rewrite"},
           the prompt input field is replaced inline with the assisted mode panel.
INVARIANT: The assisted mode panel occupies the same DOM region as the prompt input.
INVARIANT: Transition between input ↔ panel uses CSS opacity+height animation (300ms, ease-out).
INVARIANT: No modal. No overlay. No separate route.
```

### 6.4. Answering Phase Layout

```
┌─────────────────────────────────────────────────┐
│ [Question text from designer LLM]               │
│                                                 │
│ ┌─────────────┐ ┌─────────────┐ ┌────────────┐ │
│ │  Option 1   │ │  Option 2   │ │  Option 3  │ │
│ └─────────────┘ └─────────────┘ └────────────┘ │
│ ┌─────────────────────────────────────────────┐ │
│ │  Other: [freeform input________________]    │ │
│ └─────────────────────────────────────────────┘ │
│                                                 │
│ [Skip — use my prompt as-is]                    │
└─────────────────────────────────────────────────┘
```

### 6.5. Toggle Placement

```
INVARIANT: Toggle renders below the AspectRatioSelector, above helper text.
INVARIANT: Toggle label: "Assisted"
INVARIANT: Toggle uses design system active/inactive states:
           Active:   border-accent/60 bg-accent/10 text-accent
           Inactive: border-border text-dim hover:border-accent/30 hover:text-text
INVARIANT: Toggle change calls setAssistedModeEnabled mutation (debounced, fire-and-forget).
```

## 7. Integration with Existing Pipeline

### 7.1. Modified `handleGenerate` — `+page.svelte`

```typescript
// Pseudocode for the orchestration in +page.svelte

async function handleGenerate(prompt, referenceStorageIds?, aspectRatio?) {
  if (assistedEnabled && !referenceStorageIds?.length) {
    // Start assisted flow
    const sessionId = await client.mutation(startAssistedSession, { prompt });
    // UI subscribes to getAssistedSession(sessionId)
    // On terminal state:
    //   "complete" → call requestGeneration(enhancedPrompt, refs, ratio, originalPrompt)
    //   "skipped"  → call requestGeneration(prompt, refs, ratio)
    //   "failed"   → call requestGeneration(prompt, refs, ratio)
  } else {
    // Direct flow (unchanged)
    await client.mutation(requestGeneration, { prompt, referenceStorageIds, aspectRatio });
  }
}
```

### 7.2. `requestGeneration` Mutation Patch

```typescript
// Add optional args to existing requestGeneration
interface RequestGenerationArgsPatch {
  originalPrompt: v.optional(v.string());
  assistedSessionId: v.optional(v.id("assistedSessions"));
}

// In handler: store originalPrompt and assistedSessionId on the generation row
// when provided. No other behavioral change.
```

### 7.3. Constraint: Reference Images + Assisted Mode

```
INVARIANT: Assisted mode is disabled when referenceStorageIds is non-empty.
RATIONALE: Reference images already constrain generation sufficiently.
           The designer LLM has no access to reference image content.
UI RULE:   When reference images are attached, the toggle is visually disabled
           with title="Assisted mode is not available with reference images".
```

## 8. Error Handling

### 8.1. Designer LLM Failure Modes

```typescript
type DesignerFailureMode =
  | "api_unreachable"      // network error / timeout
  | "invalid_response"     // non-JSON or schema mismatch
  | "content_filter"       // model refusal
  | "rate_limited";        // 429

// All failure modes → session.status = "failed"
// Client-side: detect "failed" → auto-fallback to originalPrompt
// User sees: brief inline message "Couldn't generate suggestions — using your prompt directly"
// Duration: message visible 3s, then auto-proceeds to generation
```

### 8.2. Timeout

```
INVARIANT: Designer LLM HTTP calls use 15s timeout.
INVARIANT: Session rows older than sessionTimeoutMs (5 min) in non-terminal state
           are NOT cleaned up by cron. They are inert. Client abandons stale sessions.
```

## 9. Analytics — PostHog Events

```typescript
interface AssistedModeEvents {
  "assisted_mode_toggled":    { enabled: boolean };
  "assisted_session_started": { prompt_length: number };
  "assisted_question_shown":  { session_id: string; question_length: number };
  "assisted_option_selected": { session_id: string; option_index: number; is_freeform: boolean };
  "assisted_session_skipped": { session_id: string };
  "assisted_session_failed":  { session_id: string; error: string };
  "assisted_prompt_used":     { session_id: string; original_length: number; enhanced_length: number };
}
```

## 10. `getByUserWithUrls` Query Patch

```typescript
// Add originalPrompt to the returned object so GenerationCard can display it
interface GetByUserWithUrlsPatch {
  originalPrompt: string | undefined;
}
```

## 11. File Manifest

```
CREATE  src/convex/assistedMode.ts              — mutations, queries, actions
CREATE  src/convex/lib/designer.ts              — Minimax HTTP client
CREATE  src/convex/lib/designerPrompts.ts       — system prompts for designer LLM
MODIFY  src/convex/schema.ts                    — add assistedSessions table, patch users + generations
MODIFY  src/convex/lib/config.ts                — add ASSISTED_MODE_CONFIG
MODIFY  src/convex/lib/validators.ts            — add assistedSessionStatusValidator
MODIFY  src/convex/generations.ts               — add originalPrompt + assistedSessionId args to requestGeneration
MODIFY  src/lib/components/PromptInput.svelte   — toggle, inline assisted panel, phase state machine
MODIFY  src/routes/(app)/app/+page.svelte       — orchestrate assisted flow before requestGeneration
```

## 12. Temporal Logic Properties

```
□ (session.status = "complete" → session.enhancedPrompt ≠ ∅)
□ (session.status = "skipped" → session.enhancedPrompt = ∅)
□ (session.status = "failed" → generation uses originalPrompt)
□ (generation.originalPrompt ≠ ∅ ↔ generation.assistedSessionId ≠ ∅)
□ (referenceStorageIds.length > 0 → assistedEnabled = false)
□ (¬∃ credit deduction in assisted session lifecycle)
◇ (session.status ∈ {"complete", "skipped", "failed"})  — liveness
□ (session.status ∈ {"complete", "skipped", "failed"} → □ session.status unchanged) — terminal stability
```

## 13. Concurrency Constraints

```
INVARIANT: A user may have at most 1 assistedSession in non-terminal state at any time.
INVARIANT: startAssistedSession checks for existing non-terminal session and rejects with ConvexError.
INVARIANT: submitAssistedAnswer and skipAssistedSession are idempotent on terminal states (no-op, no error).
INVARIANT: The reactive query getAssistedSession drives all UI transitions. No client-side polling.
```

## 14. Security

```
INVARIANT: MINIMAX_API_KEY stored as Convex environment variable. Never exposed to client.
INVARIANT: All assisted mode mutations/queries enforce auth + ownership (userId === session.userId).
INVARIANT: Designer LLM input is the user's prompt only. No PII, no auth tokens, no internal state.
INVARIANT: Designer LLM output is validated against length bounds before storage.
```
